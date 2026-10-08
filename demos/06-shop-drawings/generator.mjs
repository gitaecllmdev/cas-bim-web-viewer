// Panel Shop Generator (core/client/shop-generator.html): framing shop drawings without a model. A panel is typed in
// by hand (its shape: a rectangle, a single slope, a gable or a drawn top; its doors and windows; its members) and
// framed with the same engine and sheet as the model's shop drawings (../common/framing.mjs, ./sheet.mjs).
// Pure; tested in tests/shop-generator.test.js. Units: inches.
//
// A panel: { id, mark, level, wallType, group, sideB,
//   shape: { kind: 'rect' | 'rake' | 'gable' | 'custom', lengthIn, heightIn (rect), leftIn, rightIn (rake, gable eaves),
//            peakIn, peakAtIn (gable), points: [[x, height], ...] (custom: the top, left end to right end) },
//   openings: [{ kind: 'door' | 'window' | 'mep' | 'steel', leftIn (from the panel's left end), widthIn, heightIn,
//                sillIn (not a door), head, jamb, sill (this opening's members: '' = the panel's, '=stud' = as the
//                on-center stud, '=track' = as the bottom track; a steel penetration has no header, a door no sill) }],
//   members: { stud (on center), track (bottom track; '' = as the stud), topTrack ('' = as the bottom track), spacingIn,
//              header, jamb, sill (the openings' members; '' = as the bottom track / the stud) } } (SSMA names).
// A set (the JSON file, see exportSet): { format, version, project, drawnBy, panels: [panel] }.
import { frameWall, flipLayout, fmtFtIn, round16, underMin, wallTop, topAt, topMin } from '../common/framing.mjs';
import { parseDesignator, parseMemberSpec, parseFeetInches } from '../02-takeoff/criteria.mjs';

export const FORMAT = 'cas-panel-shops';
export const VERSION = 1;

// A length as typed: 10'-6", 10' 6", 10'6, 126, 126 1/2, 10.5', 3/4" -> inches (to 1/16"); null if unreadable.
// A bare number is inches.
export function parseLength(text) {
    if (typeof text === 'number') return Number.isFinite(text) && text >= 0 ? round16(text) : null;
    const s = String(text ?? '').trim().replace(/\s*(?:ft|feet)\b\.?/i, "'").replace(/\s*(?:in|inch|inches)\b\.?/i, '"').replace(/'\s+(?=\d)/, "'-");
    if (!s) return null;
    const v = parseFeetInches(s);
    return v != null && Number.isFinite(v) && v >= 0 ? round16(v) : null;
}

// SSMA size codes in inches: 362 -> 3 5/8, 162 -> 1 5/8, 137 -> 1 3/8, 125 -> 1 1/4, 600 -> 6 (the code truncates).
export const ssmaInches = (code) => { const n = Number(code); return [12, 37, 62, 87].includes(n % 100) ? n / 100 + 0.005 : n / 100; };

// One SSMA member: '362S162-33', '(2) 600S200-54' -> { qty, name, profile, depthIn, flangeIn, mils }; null if unreadable.
export function parseMember(text) {
    const d = parseDesignator(text);
    if (!d) return null;
    const m = /^(\d{3,4})[A-Z]{1,3}(\d{3})?-/.exec(d.name);
    return { ...d, depthIn: ssmaInches(m ? m[1] : Math.round(d.depthIn * 100)), flangeIn: m?.[2] ? ssmaInches(m[2]) : null };
}
const isStud = (d) => /^(S|CS|CT)$/.test(d?.profile || '');
const isTrack = (d) => !!d && !isStud(d);

// The track that goes with a stud: same depth and thickness, 1 1/4" legs (362S162-33 -> 362T125-33).
export function trackFor(stud) {
    const m = /^(\d{3,4})[A-Z]{1,3}\d*-(\d{2,3})$/.exec(parseMember(stud)?.name || '');
    return m ? `${m[1]}T125-${m[2]}` : '';
}

// Pick lists: common SSMA studs and tracks, and the opening members that go with the panel's stud and track. Typed
// values are fine too (anything parseMember / parseMemberSpec reads); the page adds the ones used in this browser.
export const STUDS = ['250S125-18', '362S125-18', '362S125-30', '362S162-33', '362S162-43', '362S162-54', '400S162-33', '400S162-43', '400S162-54',
    '600S162-33', '600S162-43', '600S162-54', '600S200-54', '600S200-68', '800S162-43', '800S162-54', '800S200-68'];
export const SPACINGS = [12, 16, 19.2, 24];
export function memberChoices(members = {}) {
    const stud = parseMember(members.stud)?.name || '362S162-33', track = parseMember(members.track)?.name || trackFor(stud);
    const [, depth, mils] = /^(\d{3,4})[A-Z]{1,3}\d*-(\d{2,3})$/.exec(stud) || [null, '362', '33'];
    return {
        stud: STUDS,
        track: [...new Set([trackFor(stud), `${depth}T200-${mils}`, ...STUDS.map(trackFor)])].filter(Boolean),
        topTrack: [`${depth}T200-${mils}`, `${depth}T250-${mils}`, track],
        header: [track, `(2) ${stud}`, `(2) ${stud} WITH (1) ${track}`, `(2) ${stud} WITH (2) ${track}`],
        jamb: [stud, `(2) ${stud}`, `(3) ${stud}`],
        sill: [track, `(2) ${track}`, `(1) ${stud} WITH (1) ${track}`],
    };
}

// The panel's members after its stud changed from one size to another: the track and every member written in the old
// stud's depth and thickness (a box header, double jambs, a deflection track) follow to the new one; members typed in
// another size are left as they are. '' (as the stud) stays ''.
export function followStud(members, oldStud, newStud) {
    const a = parseMember(oldStud), b = parseMember(newStud);
    if (!a || !b || a.name === b.name) return { ...members };
    const code = (d) => /^(\d{3,4})[A-Z]{1,3}\d*-(\d{2,3})$/.exec(d.name).slice(1);
    const [da, ma] = code(a), [db, mb] = code(b);
    const swap = (text) => String(text || '').replaceAll(a.name, b.name).replace(/\b(\d{3,4})([A-Z]{1,3})(\d{3})?-(\d{2,3})\b/g,
        (m, d, prof, fl, mils) => (d === da && mils === ma ? `${db}${prof}${fl || ''}-${mb}` : m));
    return { ...members, track: members.track ? swap(members.track) : '', topTrack: swap(members.topTrack), header: swap(members.header), jamb: swap(members.jamb), sill: swap(members.sill) };
}

// Member combos to start from: typical sets, not an engineered design (the project's framing criteria govern).
export const COMBOS = [
    { name: '3 5/8" 33 mil @ 16" o.c.', members: { stud: '362S162-33', track: '362T125-33', topTrack: '', spacingIn: 16, header: '', jamb: '', sill: '' } },
    { name: '3 5/8" 43 mil @ 16" o.c., box header, double jambs', members: { stud: '362S162-43', track: '362T125-43', topTrack: '', spacingIn: 16,
        header: '(2) 362S162-43 WITH (1) 362T125-43', jamb: '(2) 362S162-43', sill: '362T125-43' } },
    { name: '6" 43 mil @ 16" o.c.', members: { stud: '600S162-43', track: '600T125-43', topTrack: '', spacingIn: 16, header: '', jamb: '', sill: '' } },
    { name: '6" 54 mil @ 16" o.c., box header, double jambs', members: { stud: '600S162-54', track: '600T125-54', topTrack: '', spacingIn: 16,
        header: '(2) 600S162-54 WITH (2) 600T125-54', jamb: '(2) 600S162-54', sill: '600T125-54' } },
    { name: '6" 54 mil @ 12" o.c., deflection top track', members: { stud: '600S162-54', track: '600T125-54', topTrack: '600T200-54', spacingIn: 12,
        header: '(2) 600S162-54 WITH (2) 600T125-54', jamb: '(2) 600S162-54', sill: '600T125-54' } },
];
export const DEFAULT_MEMBERS = { ...COMBOS[0].members, track: '' }; // the track follows the stud unless one is given

export const SHAPES = [
    { kind: 'rect', name: 'Rectangle', hint: 'Length and height' },
    { kind: 'rake', name: 'Single slope', hint: 'A height at each end' },
    { kind: 'gable', name: 'Gable', hint: 'Eaves and a peak' },
    { kind: 'custom', name: 'Draw the top', hint: 'Points along the top' },
];

// The top of the wall from its shape: { lengthIn, heightIn (highest point), top: points [x, h] or null (flat) }.
export function shapeTop(shape = {}) {
    const L = Math.max(0, Number(shape.lengthIn) || 0), H = Math.max(0, Number(shape.heightIn) || 0);
    const left = Number(shape.leftIn) || H, right = Number(shape.rightIn) || left;
    let pts = null;
    if (shape.kind === 'rake') pts = [[0, left], [L, right]];
    else if (shape.kind === 'gable') pts = [[0, left], [Math.min(L, Math.max(0, shape.peakAtIn ?? L / 2)), Number(shape.peakIn) || Math.max(left, right)], [L, right]];
    else if (shape.kind === 'custom' && Array.isArray(shape.points) && shape.points.length >= 2) pts = shape.points;
    const top = pts ? wallTop(pts, L) : null;
    const flatH = pts && !top ? Math.max(...pts.map(p => Number(p[1]) || 0)) : H; // a "slope" with level ends is flat
    return { lengthIn: round16(L), heightIn: top ? Math.max(...top.map(p => p[1])) : round16(flatH), top };
}

// The shape changed to another kind, keeping its sizes: a rectangle's height becomes the eaves and the drawn points.
export function changeShape(shape, kind) {
    const { lengthIn: L, heightIn: H, top } = shapeTop(shape);
    const at = (x) => topAt(top, x, H);
    const eaveL = top ? at(0) : H, eaveR = top ? at(L) : H;
    if (kind === 'rect') return { kind, lengthIn: L, heightIn: H };
    if (kind === 'rake') return { kind, lengthIn: L, leftIn: eaveL, rightIn: eaveR === eaveL ? round16(eaveL + L / 6) : eaveR };
    if (kind === 'gable') return { kind, lengthIn: L, leftIn: eaveL, rightIn: eaveR, peakAtIn: round16(shape.peakAtIn ?? L / 2), peakIn: round16(Math.max(H, eaveL, eaveR) > eaveL ? H : eaveL + L / 4) };
    return { kind: 'custom', lengthIn: L, points: top ? top.map(p => [...p]) : [[0, H], [L, H]] };
}

// --- Opening kinds ---------------------------------------------------------------------------------------------------
// What each kind of opening is framed with (the members the page asks for), its letter and its size when added.
// A steel penetration runs from its sill up through the top of the wall: the top track is cut there, no header.
export const OPENING_TYPES = {
    door: { name: 'Door', letter: 'D', members: ['jamb', 'head'], size: { widthIn: 36, heightIn: 84, sillIn: 0 } },
    window: { name: 'Window', letter: 'W', members: ['jamb', 'head', 'sill'], size: { widthIn: 48, heightIn: 48, sillIn: 36 } },
    mep: { name: 'MEP opening', letter: 'M', members: ['jamb', 'head', 'sill'], size: { widthIn: 24, heightIn: 16, sillIn: 84 } },
    steel: { name: 'Steel penetration', letter: 'S', members: ['jamb', 'sill'], size: { widthIn: 16, heightIn: 0, sillIn: null } },
};
export const MEMBER_LABELS = { jamb: 'Jambs', head: 'Header', sill: 'Sill' };
// A kind's name inside a sentence: 'door', 'window', 'MEP opening', 'steel penetration'.
export const kindWord = (kind) => OPENING_TYPES[kind].name.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());
export const kindOf = (o) => (OPENING_TYPES[o?.kind] ? o.kind : 'door');
const panelKey = (k) => (k === 'head' ? 'header' : k); // an opening's head is the panel's header
export const SAME_STUD = '=stud', SAME_TRACK = '=track';
const isSame = (v) => v === SAME_STUD || v === SAME_TRACK;
// D1, W1, M1 (MEP), S1 (steel), counted by kind in the panel's order.
export const openingName = (openings, i) => `${OPENING_TYPES[kindOf(openings[i])].letter}${openings.slice(0, i + 1).filter(o => kindOf(o) === kindOf(openings[i])).length}`;
// "1 door · 2 windows · 1 MEP opening" (or "no openings").
export function openingsSummary(openings = []) {
    const n = (k) => openings.filter(o => kindOf(o) === k).length;
    return Object.entries(OPENING_TYPES).filter(([k]) => n(k)).map(([k, t]) => `${n(k)} ${kindWord(k)}${n(k) > 1 ? 's' : ''}`).join(' · ') || 'no openings';
}
// An opening on the panel: { left, right, bottom, top, kind } (the rough opening); a steel penetration from its sill up
// through the top of the wall (H: the wall's highest point), marked through.
export const openingBox = (o, H = Infinity) => {
    const kind = kindOf(o), left = Number(o.leftIn) || 0, right = left + (Number(o.widthIn) || 0);
    if (kind === 'steel') return { left, right, bottom: Number(o.sillIn) || 0, top: H, through: true, kind };
    const bottom = kind === 'door' ? 0 : Number(o.sillIn) || 0;
    return { left, right, bottom, top: bottom + (Number(o.heightIn) || 0), kind };
};

// A drawn outline (an elevation polygon, flat at the bottom: a future export of wall outlines) as a shape: the length
// across it and its top edge as points; a rectangle when the top is level.
export function outlineShape(outline) {
    const r = perimeterToPanel(outline);
    return r.errors.length ? null : r.shape;
}

// A perimeter drawn around the panel (its corners in order, either way round) as the panel's shape and the openings it
// leaves: a rectangular notch up from the bottom is a door, one down from the top a steel penetration. The ends are
// plumb, the bottom flat; the top may slope (a step in it is two panels). Returns { shape, openings, errors }.
export function perimeterToPanel(points) {
    const fail = (message) => ({ shape: null, openings: [], errors: [message] });
    let P = (points || []).map(p => [round16(Number(p?.[0])), round16(Number(p?.[1]))]).filter(p => p.every(Number.isFinite));
    const eq = (u, v) => Math.abs(u - v) < 1e-6;
    for (let changed = true; changed && P.length > 2;) { // no repeated points, none on a straight line
        changed = false;
        for (let i = 0; i < P.length && P.length > 2; i++) {
            const a = P[(i - 1 + P.length) % P.length], b = P[i], c = P[(i + 1) % P.length];
            if ((eq(a[0], b[0]) && eq(a[1], b[1])) || Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-6) { P.splice(i, 1); changed = true; i--; }
        }
    }
    if (P.length < 4) return fail('Draw at least four corners: the two ends of the panel, its bottom and its top.');
    const x0 = Math.min(...P.map(p => p[0])), y0 = Math.min(...P.map(p => p[1]));
    P = P.map(([x, y]) => [round16(x - x0), round16(y - y0)]);
    const L = Math.max(...P.map(p => p[0]));
    if (P.reduce((sum, p, i) => { const q = P[(i + 1) % P.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) < 0) P.reverse(); // counter-clockwise
    const s0 = P.findIndex(p => eq(p[0], 0) && eq(p[1], 0)), sR = P.findIndex(p => eq(p[0], L) && eq(p[1], 0));
    if (s0 < 0 || sR < 0) return fail('The bottom of a panel is flat, from end to end, and its ends are plumb: start at a bottom corner and keep the bottom level.');
    P = [...P.slice(s0), ...P.slice(0, s0)];
    const iR = (sR - s0 + P.length) % P.length;
    const openings = [], blank = { head: '', jamb: '', sill: '' };
    // The bottom, left to right: level, but for doors (up, across, down).
    const bottom = P.slice(0, iR + 1);
    for (let i = 0; i < bottom.length - 1;) {
        const [p, q, r, t] = [bottom[i], bottom[i + 1], bottom[i + 2], bottom[i + 3]];
        if (eq(q[1], 0)) { i += 1; continue; }
        if (r && t && eq(p[1], 0) && eq(q[0], p[0]) && eq(r[1], q[1]) && r[0] > q[0] && eq(t[0], r[0]) && eq(t[1], 0)) {
            openings.push({ kind: 'door', leftIn: q[0], widthIn: round16(r[0] - q[0]), heightIn: q[1], sillIn: 0, ...blank });
            i += 3;
            continue;
        }
        return fail('The bottom of a panel is level: only a door (a rectangle up from the bottom) may break it.');
    }
    // The top, right to left from the top of the right end to the top of the left end; steel penetrations are dips
    // down from it (down, across, up).
    const right = P[iR + 1], left = P[P.length - 1];
    if (!right || !eq(right[0], L) || !left || !eq(left[0], 0)) return fail('Both ends of a panel are plumb: draw them straight up from the bottom corners.');
    let chain = P.slice(iR + 1);
    for (let i = 0; i + 3 < chain.length; i++) {
        const [p, q, r, t] = chain.slice(i, i + 4);
        if (eq(q[0], p[0]) && q[1] < p[1] && eq(r[1], q[1]) && r[0] < q[0] && eq(t[0], r[0]) && t[1] > r[1]) {
            openings.push({ kind: 'steel', leftIn: r[0], widthIn: round16(q[0] - r[0]), heightIn: 0, sillIn: q[1], ...blank });
            chain = [...chain.slice(0, i + 1), ...chain.slice(i + 3)];
            i = -1;
        }
    }
    for (let i = 1; i < chain.length; i++) {
        if (!(chain[i][0] < chain[i - 1][0])) return fail(`The top has a step at ${fmtFtIn(chain[i][0])} from the left (two heights at one point): make it two panels, or slope it.`);
    }
    const pts = chain.reverse(), top = wallTop(pts, L);
    let shape;
    if (!top) shape = { kind: 'rect', lengthIn: L, heightIn: pts[0][1] };
    else if (top.length === 2) shape = { kind: 'rake', lengthIn: L, leftIn: top[0][1], rightIn: top[1][1] };
    else if (top.length === 3 && top[1][1] > Math.max(top[0][1], top[2][1])) shape = { kind: 'gable', lengthIn: L, leftIn: top[0][1], rightIn: top[2][1], peakIn: top[1][1], peakAtIn: top[1][0] };
    else shape = { kind: 'custom', lengthIn: L, points: top };
    return { shape, openings: openings.sort((u, v) => u.leftIn - v.leftIn), errors: [] };
}

// --- A panel to the framing engine -------------------------------------------------------------------------------

const specOf = (text) => { const s = String(text || '').trim(); return s && !isSame(s) ? parseMemberSpec(s) : null; };
// What an opening's member (or with o null, the panel's default for openings) comes to: { spec, base } where base says
// it is just the on-center stud ('stud') or the bottom track ('track').
export function memberFor(panel, o, what) {
    const m = { ...DEFAULT_MEMBERS, ...(panel.members || {}) }, own = o ? o[what] : '';
    const stud = parseMember(m.stud)?.name || m.stud, track = parseMember(m.track)?.name || trackFor(m.stud);
    const spec = isSame(own) ? '' : own || m[panelKey(what)] || '';
    if (spec) return { spec, base: null };
    return what === 'jamb' ? { spec: stud, base: 'stud' } : { spec: track, base: 'track' };
}
// A member in words: '(2) 362S162-43 WITH (1) 362T125-43' -> '2 studs 362S162-43 + 1 track 362T125-43'.
export function specText(spec) {
    const parts = specOf(spec)?.parts;
    return parts ? parts.map(p => `${p.qty} ${isStud(parseMember(p.name)) ? 'stud' : 'track'}${p.qty > 1 ? 's' : ''} ${p.name}`).join(' + ') : '';
}

// What is wrong with a panel's inputs, in plain words: [{ where, message }] (empty: it can be framed).
export function panelErrors(panel) {
    const errors = [], { lengthIn: L, heightIn: H, top } = shapeTop(panel.shape);
    const add = (where, message) => errors.push({ where, message });
    if (!(L >= 12)) add('shape', 'Give the panel a length (at least 1\'-0").');
    if (!(H >= 12)) add('shape', 'Give the panel a height (at least 1\'-0").');
    if (panel.shape?.kind === 'custom') {
        const xs = (panel.shape.points || []).map(p => p[0]);
        if (xs.some((x, i) => i && x <= xs[i - 1])) add('shape', 'Each point of the top must be further right than the one before it (a step is two panels).');
    }
    const m = panel.members || {};
    const stud = parseMember(m.stud), track = m.track ? parseMember(m.track) : null;
    if (!stud || !isStud(stud)) add('members', `Can't read the on-center stud "${m.stud || ''}": type an SSMA stud such as 362S162-33.`);
    if (m.track && !isTrack(track)) add('members', `Can't read the bottom track "${m.track}": type an SSMA track such as 362T125-33.`);
    if (m.topTrack && !isTrack(parseMember(m.topTrack))) add('members', `Can't read the top track "${m.topTrack}": type an SSMA track such as 362T200-33, or keep it as the bottom track.`);
    const sp = Number(m.spacingIn);
    if (!(sp >= 4 && sp <= 48)) add('members', 'Stud spacing should be between 4" and 48" (16" o.c. is typical).');
    for (const [k, label] of [['header', 'Headers'], ['jamb', 'Jambs'], ['sill', 'Sills']]) {
        if (m[k] && !isSame(m[k]) && !specOf(m[k])) add('members', `${label}: can't read "${m[k]}". Type it like (2) 362S162-43 WITH (1) 362T125-43.`);
    }
    // One depth through the wall: every track, header, jamb and sill part as deep as the studs.
    if (stud) {
        const depthOf = (name) => parseMember(name)?.depthIn;
        const named = [['bottom track', m.track], ['top track', m.topTrack], ['headers', m.header], ['jambs', m.jamb], ['sills', m.sill],
            ...(panel.openings || []).flatMap((o, i) => OPENING_TYPES[kindOf(o)].members.map(k => [`${openingName(panel.openings, i)} ${MEMBER_LABELS[k].toLowerCase()}`, o[k]]))];
        for (const [label, text] of named) {
            const parts = specOf(text)?.parts || [];
            const off = parts.find(p => depthOf(p.name) != null && Math.abs(depthOf(p.name) - stud.depthIn) > 1e-6);
            if (off) add('members', `The ${label} (${off.name}) is ${fmtFtIn(depthOf(off.name)).replace(/^0'-/, '')} deep but the studs are ${fmtFtIn(stud.depthIn).replace(/^0'-/, '')}: use one depth through the wall.`);
        }
    }
    if (errors.some(e => e.where === 'shape')) return errors;
    const leg = track?.flangeIn ?? 1.25, flange = stud?.flangeIn ?? 1.625, inch = (v) => fmtFtIn(v).replace(/^0'-/, '');
    const boxes = (panel.openings || []).map(o => openingBox(o, H));
    (panel.openings || []).forEach((o, i) => {
        const n = openingName(panel.openings, i), b = boxes[i], kind = kindOf(o), where = `opening-${i}`;
        for (const k of OPENING_TYPES[kind].members) if (o[k] && !isSame(o[k]) && !specOf(o[k])) add(where, `${n} ${MEMBER_LABELS[k].toLowerCase()}: can't read "${o[k]}".`);
        if (!(Number(o.widthIn) >= 6) || (kind !== 'steel' && !(Number(o.heightIn) >= 6))) { add(where, `${n}: give it a width${kind === 'steel' ? '' : ' and a height'} (at least 6").`); return; }
        if (b.left < 0 || b.right > L) add(where, `${n} runs past the ${b.left < 0 ? 'left' : 'right'} end of the panel.`);
        if (kind === 'steel') {
            const lowTop = topMin(top, Math.max(0, b.left), Math.min(L, b.right), H);
            if (lowTop - b.bottom < 6) add(where, `${n}: its sill (${fmtFtIn(b.bottom)}) needs to be at least 6" below the top of the wall (${fmtFtIn(lowTop)} there).`);
        } else {
            const under = underMin(top, Math.max(0, b.left), Math.min(L, b.right), H, leg);
            if (b.top > under + 1 / 32) add(where, `${n}'s top (${fmtFtIn(b.top)}) is above the underside of the top track there (${fmtFtIn(under)}).`);
            // Its header: a track's leg above the opening, a stud flange past each side, under the top track (or the
            // opening runs up to the top track: no header).
            else if (b.top < under - 1) {
                const room = underMin(top, Math.max(0, b.left - flange), Math.min(L, b.right + flange), H, leg) - b.top;
                if (room < leg - 1 / 32) add(where, `${n}: no room for its header under the top track (${inch(Math.max(0, room))} above it, ${inch(leg)} needed). Lower it, or raise it to the top track.`);
            }
        }
        if (kind !== 'door' && b.bottom < 2 * leg) add(where, `${n}: its sill is too low for a sill track${kind === 'steel' ? '' : '; make it a door, or raise the sill'}.`);
        boxes.forEach((c, j) => {
            if (j > i && Math.min(b.right, c.right) - Math.max(b.left, c.left) > 0 && Math.min(b.top, c.top) - Math.max(b.bottom, c.bottom) > 0) {
                add(where, `${n} overlaps ${openingName(panel.openings, j)}.`);
            }
        });
    });
    return errors;
}

// The frameWall() inputs for a panel (its members, shape and openings with their own framing).
export function frameInputs(panel) {
    const m = { ...DEFAULT_MEMBERS, ...(panel.members || {}) };
    const stud = parseMember(m.stud) || parseMember(DEFAULT_MEMBERS.stud);
    const track = parseMember(m.track) || parseMember(trackFor(stud.name));
    const topTrack = m.topTrack ? parseMember(m.topTrack) : null;
    const { lengthIn, heightIn, top } = shapeTop(panel.shape);
    const openings = (panel.openings || []).map(o => {
        const framing = {};
        for (const k of OPENING_TYPES[kindOf(o)].members) {
            const parts = specOf(memberFor(panel, o, k).spec)?.parts;
            if (parts && memberFor(panel, o, k).base == null) framing[k] = parts;
        }
        return { ...openingBox(o, heightIn), ...(Object.keys(framing).length ? { framing: { ...framing, source: 'entered' } } : {}) };
    });
    return { lengthIn, heightIn, top, openings, studIn: stud.depthIn, flangeIn: stud.flangeIn ?? 1.625, mils: stud.mils, studName: stud.name,
        trackName: track.name, trackLegIn: track.flangeIn ?? 1.25, topTrackName: topTrack?.name, spacingIn: Number(m.spacingIn) || 16 };
}

// The panel framed: the layout as drawn (side B: mirrored), with a note for each built-up opening member.
export function panelLayout(panel) {
    const inputs = frameInputs(panel);
    const layout = frameWall(inputs);
    const builtUp = new Set();
    (panel.openings || []).forEach((o) => {
        const type = OPENING_TYPES[kindOf(o)];
        const parts = type.members.map(k => [MEMBER_LABELS[k].toLowerCase(), memberFor(panel, o, k).spec])
            .filter(([, spec]) => (specOf(spec)?.parts || []).reduce((n, p) => n + p.qty, 0) > 1).map(([k, spec]) => `${k} ${spec}`);
        if (parts.length) builtUp.add(`${type.name} framing: ${parts.join('; ')}.`);
    });
    if (inputs.topTrackName) builtUp.add(`Top track ${inputs.topTrackName}.`);
    layout.notes.push(...builtUp);
    return panel.sideB ? flipLayout(layout) : layout;
}

// --- New panels, marks, the set -------------------------------------------------------------------------------------

const rid = () => `p-${Math.random().toString(36).slice(2, 10)}`;
// P-101 -> P-102, A9 -> A10, PANEL -> PANEL-2.
export function nextMark(mark) {
    const m = /^(.*?)(\d+)(\D*)$/.exec(String(mark || '').trim());
    if (!m) return `${String(mark || 'P').trim() || 'P'}-2`;
    return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, '0')}${m[3]}`;
}

// A new panel: the previous one's level, wall type, group, shape and members (the next mark), so a run of similar
// panels is quick to enter; the first one a plain 10 ft x 10 ft wall.
export function newPanel(prev = null, marks = []) {
    let mark = prev ? nextMark(prev.mark) : 'P-101';
    while (marks.includes(mark)) mark = nextMark(mark);
    if (!prev) return { id: rid(), mark, level: '', wallType: '', group: '', sideB: false, shape: { kind: 'rect', lengthIn: 120, heightIn: 120 }, openings: [], members: { ...DEFAULT_MEMBERS } };
    return { ...structuredClone(prev), id: rid(), mark, openings: [] };
}
export const copyPanel = (panel, marks = []) => {
    let mark = nextMark(panel.mark);
    while (marks.includes(mark)) mark = nextMark(mark);
    return { ...structuredClone(panel), id: rid(), mark };
};

// The members of one panel given to others (the checked panels, or a group).
export function assignMembers(panels, ids, members) {
    const want = new Set(ids);
    return panels.map(p => (want.has(p.id) ? { ...p, members: { ...members } } : p));
}

// The set as a JSON file, and a file read back (this format; or a plain list of panels or of wall outlines, e.g. from a
// model export: { mark, outline: [[x, y], ...], openings, members }). Returns { set, warnings }.
export function exportSet(set) {
    return { format: FORMAT, version: VERSION, project: set.project || '', drawnBy: set.drawnBy || '', savedAt: new Date().toISOString(),
        panels: (set.panels || []).map(cleanPanel) };
}
export function importSet(json) {
    const warnings = [];
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const list = Array.isArray(data) ? data : Array.isArray(data?.panels) ? data.panels : Array.isArray(data?.walls) ? data.walls : null;
    if (!list) throw new Error('No panels in this file (expected "panels": [...]).');
    if (data?.format && data.format !== FORMAT) warnings.push(`This file says it is "${data.format}", not ${FORMAT}; read what could be read.`);
    const panels = [];
    list.forEach((raw, i) => {
        const name = `Panel ${i + 1}${raw?.mark ? ` (${raw.mark})` : ''}`;
        if (raw?.outline) { // a wall outline: its notches are its doors and steel penetrations
            const r = perimeterToPanel(raw.outline);
            if (r.errors.length) { warnings.push(`${name}: ${r.errors[0]} Skipped.`); return; }
            panels.push(cleanPanel({ ...raw, shape: r.shape, openings: [...r.openings, ...(raw.openings || [])] }));
            return;
        }
        if (!raw?.shape) { warnings.push(`${name}: no shape or outline; skipped.`); return; }
        panels.push(cleanPanel(raw));
    });
    return { set: { project: String(data?.project || ''), drawnBy: String(data?.drawnBy || ''), panels }, warnings };
}

const len = (v) => { const n = parseLength(v); return n == null ? undefined : n; };
// A panel with only the fields this tool uses, lengths as inches (typed text like 10'-6" is read too).
export function cleanPanel(p = {}) {
    const s = p.shape || {}, kind = SHAPES.some(k => k.kind === s.kind) ? s.kind : 'rect';
    const shape = { kind, lengthIn: len(s.lengthIn) ?? 120 };
    if (kind === 'rect') shape.heightIn = len(s.heightIn) ?? 120;
    if (kind === 'rake' || kind === 'gable') { shape.leftIn = len(s.leftIn) ?? 96; shape.rightIn = len(s.rightIn) ?? shape.leftIn; }
    if (kind === 'gable') { shape.peakIn = len(s.peakIn) ?? shape.leftIn + 24; shape.peakAtIn = len(s.peakAtIn) ?? shape.lengthIn / 2; }
    if (kind === 'custom') shape.points = (s.points || []).map(pt => [len(pt?.[0]) ?? 0, len(pt?.[1]) ?? 0]);
    const str = (v, n = 80) => String(v ?? '').trim().slice(0, n);
    const members = { ...DEFAULT_MEMBERS, ...Object.fromEntries(Object.entries(p.members || {}).map(([k, v]) => [k, k === 'spacingIn' ? Number(v) || 16 : str(v)])) };
    return {
        id: str(p.id, 40) || rid(), mark: str(p.mark, 40) || 'P-101', level: str(p.level), wallType: str(p.wallType, 120), group: str(p.group), sideB: !!p.sideB,
        shape, members: Object.fromEntries(Object.keys(DEFAULT_MEMBERS).map(k => [k, members[k]])),
        openings: (p.openings || []).map(o => {
            const kind = kindOf(o), size = OPENING_TYPES[kind].size, H = shapeTop(shape).heightIn;
            return { kind, leftIn: len(o?.leftIn) ?? 0, widthIn: len(o?.widthIn) ?? size.widthIn, heightIn: kind === 'steel' ? 0 : len(o?.heightIn) ?? size.heightIn,
                sillIn: kind === 'door' ? 0 : len(o?.sillIn) ?? size.sillIn ?? Math.max(0, H - 24),
                head: kind === 'steel' ? '' : str(o?.head), jamb: str(o?.jamb), sill: kind === 'door' ? '' : str(o?.sill) };
        }),
    };
}

// Remembered inputs: the value first, no repeats (case aside), at most max of them.
export function remember(list, value, max = 10) {
    const v = String(value ?? '').trim();
    if (!v) return list || [];
    return [v, ...(list || []).filter(x => x.toUpperCase() !== v.toUpperCase())].slice(0, max);
}

// A panel in a link (the QR code on its sheet opens it in the generator): its values in a fixed order (no field names),
// JSON, base64url; short, so a QR code of it stays coarse enough to scan off the sheet.
//   [1, mark, level, wallType, group, sideB, [shape kind, ...its sizes], [stud, track, topTrack, spacing, header, jamb, sill],
//    [[0 door | 1 window, left, width, height, sill, head, jamb, sill], ...]]  (trailing empty values left out)
const SHAPE_KEYS = { rect: ['lengthIn', 'heightIn'], rake: ['lengthIn', 'leftIn', 'rightIn'], gable: ['lengthIn', 'leftIn', 'rightIn', 'peakIn', 'peakAtIn'], custom: ['lengthIn', 'points'] };
const MEMBER_KEYS = ['stud', 'track', 'topTrack', 'spacingIn', 'header', 'jamb', 'sill'];
const KIND_CODES = ['door', 'window', 'mep', 'steel'];
const trim = (a) => { const out = [...a]; while (out.length && (out[out.length - 1] === '' || out[out.length - 1] == null)) out.pop(); return out; };
export function encodePanel(panel) {
    const p = cleanPanel(panel);
    const packed = trim([1, p.mark, p.level, p.wallType, p.group, p.sideB ? 1 : 0, [p.shape.kind, ...SHAPE_KEYS[p.shape.kind].map(k => p.shape[k])],
        trim(MEMBER_KEYS.map(k => p.members[k])), p.openings.map(o => trim([KIND_CODES.indexOf(o.kind), o.leftIn, o.widthIn, o.heightIn, o.sillIn, o.head, o.jamb, o.sill]))]);
    const bytes = new TextEncoder().encode(JSON.stringify(packed));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodePanel(code) {
    const bin = atob(String(code || '').replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    if (!Array.isArray(data) || data[0] !== 1) return cleanPanel(data); // a link written as the panel itself
    const [, mark, level, wallType, group, sideB, shape = [], members = [], openings = []] = data;
    return cleanPanel({ mark, level, wallType, group, sideB: !!sideB,
        shape: { kind: shape[0], ...Object.fromEntries((SHAPE_KEYS[shape[0]] || []).map((k, i) => [k, shape[i + 1]])) },
        members: Object.fromEntries(MEMBER_KEYS.map((k, i) => [k, members[i] ?? (k === 'spacingIn' ? 16 : '')])),
        openings: openings.map(([w, leftIn, widthIn, heightIn, sillIn, head, jamb, sill]) => ({ kind: KIND_CODES[w] || 'door', leftIn, widthIn, heightIn, sillIn, head, jamb, sill })) });
}
