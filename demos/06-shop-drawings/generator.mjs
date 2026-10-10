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
//   optimizeOpenings: false (default: studs on center from the left end) | true (the opening optimizer: the first stud
//   placed so the openings take the fewest stud pieces, every bay within the spacing), layoutStartIn (set by hand: the
//   first layout stud's center; wins over the optimizer), layoutFromRight (Flip panel: the layout, and the plan
//   ordinates, from the right end), flipStuds (Flip studs: layout studs face the other way), each opening's toLayout
//   (its jambs moved out to the nearest layout studs, which then serve as its jambs), revit (kept as it came: the model's wall this panel is, its place by the grids;
//   see docs/panel-exchange.md) }.
// A set (the JSON file, see exportSet): { format, version, project, drawnBy, source, grids, levels, panels: [panel] }.
import { frameWall, flipLayout, fmtFtIn, round16, underMin, wallTop, topAt, topMin, webOnRight } from '../common/framing.mjs';
const inchText = (v) => fmtFtIn(v).replace(/^0'-/, '').replace(/^0 (?=\d+\/)/, ''); // 0'-6" -> 6", 0'-0 1/2" -> 1/2"
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

// --- An opening's framing details ------------------------------------------------------------------------------------
// The framing offset: the rough opening is the opening as typed plus this much each side, over it (a door, window or
// MEP opening) and under it (a window, MEP opening or steel penetration), so its frame or sleeve fits. Typed per
// opening (offsetIn; 0 frames it as typed); these are the defaults.
export const FRAMING_OFFSETS = { door: 2.25, window: 0.5, mep: 0.5, steel: 0.5 };
export const offsetOf = (o) => { const v = o?.offsetIn; return v === '' || v == null || !Number.isFinite(Number(v)) ? FRAMING_OFFSETS[kindOf(o)] : Math.max(0, Number(v)); };
// The rough opening: the opening as typed with its framing offset (what the members frame around).
export function roughOpening(o, H = Infinity) {
    const b = openingBox(o, H), d = offsetOf(o);
    return { ...b, left: round16(b.left - d), right: round16(b.right + d), top: b.through ? b.top : round16(b.top + d), bottom: b.kind === 'door' ? b.bottom : round16(b.bottom - d) };
}
// How the jamb studs sit (two or more each side), the header and sill built of studs, and what the header bears on.
export const JAMB_STYLES = { box: 'Boxed (toe to toe)', back: 'Back to back', same: 'Same way (webs to the opening)' };
export const HEAD_STYLES = { track: 'Track', box: 'Box (toe to toe)', back: 'Back to back' };
export const HEAD_BEARINGS = { between: 'Between the jambs', jacks: 'On jack studs' };
// A member spec as studs and tracks: { studs, tracks: [{ qty, name }], studQty, trackQty, depthIn: the studs' web depth
// (a header or sill built of studs is that deep) }.
export function specParts(spec) {
    const parts = specOf(spec)?.parts || [];
    const studs = parts.filter(p => isStud(parseMember(p.name))), tracks = parts.filter(p => !isStud(parseMember(p.name)));
    return { studs, tracks, studQty: studs.reduce((n, p) => n + p.qty, 0), trackQty: tracks.reduce((n, p) => n + p.qty, 0),
        depthIn: Math.max(0, ...studs.map(p => parseMember(p.name)?.depthIn || 0)) };
}
// An opening's framing as resolved (for the framing dialog, the notes and the engine): its rough opening, jambs
// (plies, style), header and sill (spec, style, depth), what the header bears on, cripples at the ends.
export function openingFraming(panel, o, H = shapeTop(panel.shape).heightIn) {
    const kind = kindOf(o), types = OPENING_TYPES[kind].members;
    const jamb = specParts(memberFor(panel, o, 'jamb').spec), head = types.includes('head') ? specParts(memberFor(panel, o, 'head').spec) : null;
    const sill = types.includes('sill') ? specParts(memberFor(panel, o, 'sill').spec) : null;
    const plies = Math.max(1, Math.min(4, jamb.studQty || 1));
    return { offsetIn: offsetOf(o), ro: roughOpening(o, H), plies, jambStyle: JAMB_STYLES[o.jambStyle] ? o.jambStyle : 'box',
        head: head && { spec: memberFor(panel, o, 'head').spec, style: head.studQty ? (o.headStyle === 'back' ? 'back' : 'box') : 'track', depthIn: head.studQty ? head.depthIn : 0 },
        sill: sill && { spec: memberFor(panel, o, 'sill').spec, style: sill.studQty ? (o.sillStyle === 'back' ? 'back' : 'box') : 'track', depthIn: sill.studQty ? sill.depthIn : 0 },
        bearing: o.headBearing === 'jacks' && plies >= 2 && head ? 'jacks' : 'between', crippleEnds: !!o.crippleEnds };
}

// --- Grips (the elevation editor's shape handles, like Revit's): pure, each from the state before the drag ------------
// The top of the panel as points, left end to right end, whatever its kind.
export function shapePoints(shape) {
    const { lengthIn: L, heightIn: H, top } = shapeTop(shape);
    return top ? top.map(p => [...p]) : [[0, H], [L, H]];
}
const minH = 12;
// An end of the panel moved to x (in the panel's inches as it was; the left end below 0 extends it to the left), the
// openings left where they are on the wall; never past an opening, the peak, a drawn point, or under 1 ft long.
export function moveEnd(panel, side, to) {
    const p = structuredClone(panel), s = p.shape, L = shapeTop(s).lengthIn, ops = p.openings || [];
    const pts = s.kind === 'custom' ? s.points : null, peakAt = s.kind === 'gable' ? s.peakAtIn ?? L / 2 : null;
    if (side === 'right') {
        const newL = round16(Math.max(to, 12, ...ops.map(o => o.leftIn + o.widthIn), peakAt != null ? peakAt + 1 : 0, pts ? pts[pts.length - 2][0] + 1 : 0));
        s.lengthIn = newL;
        if (pts) pts[pts.length - 1][0] = newL;
        return p;
    }
    const d = round16(Math.min(to, L - 12, ...ops.map(o => o.leftIn), peakAt != null ? peakAt - 1 : Infinity, pts ? pts[1][0] - 1 : Infinity));
    s.lengthIn = round16(L - d);
    if (peakAt != null) s.peakAtIn = round16(peakAt - d);
    if (pts) s.points = pts.map(([x, h], i) => [i === 0 ? 0 : round16(x - d), h]);
    for (const o of ops) o.leftIn = round16(o.leftIn - d);
    return p;
}
// The height at an end (a rectangle stays one: both ends).
export function setEndHeight(shape, side, h) {
    const s = structuredClone(shape), v = round16(Math.max(minH, h));
    if (s.kind === 'rect') s.heightIn = v;
    else if (s.kind === 'custom') s.points[side === 'left' ? 0 : s.points.length - 1][1] = v;
    else s[side === 'left' ? 'leftIn' : 'rightIn'] = v;
    return s;
}
// A run of the top (i: 1 for the first, between points i-1 and i) moved up or down by dy.
export function moveRun(shape, i, dy) {
    const s = structuredClone(shape), up = (v) => round16(Math.max(minH, v + dy));
    if (s.kind === 'rect') s.heightIn = up(s.heightIn);
    else if (s.kind === 'rake') { s.leftIn = up(s.leftIn); s.rightIn = up(s.rightIn); }
    else if (s.kind === 'gable') { s.peakIn = up(s.peakIn); if (i === 1) s.leftIn = up(s.leftIn); else s.rightIn = up(s.rightIn); }
    else { s.points[i - 1][1] = up(s.points[i - 1][1]); s.points[i][1] = up(s.points[i][1]); }
    return s;
}
// An opening resized by a grip: 'l', 'r', 't', 'b' (an edge) or 'tl', 'tr', 'bl', 'br' (a corner) dragged to [x, y];
// at least 6" each way, inside the panel, under maxTop. A door's bottom stays on the floor, a steel penetration's top
// up through the top of the wall.
export function resizeOpening(o, grip, [x, y], { L, maxTop = Infinity }) {
    const kind = kindOf(o), b = openingBox(o, Infinity);
    let { left, right, bottom, top } = b;
    if (grip.includes('l')) left = Math.min(right - 6, Math.max(0, x));
    if (grip.includes('r')) right = Math.max(left + 6, Math.min(L, x));
    if (grip.includes('t') && kind !== 'steel') top = Math.min(maxTop, Math.max(bottom + 6, y));
    if (grip.includes('b') && kind !== 'door') bottom = Math.max(3, Math.min(kind === 'steel' ? y : top - 6, y));
    return { ...o, leftIn: round16(left), widthIn: round16(right - left), sillIn: kind === 'door' ? 0 : round16(bottom), heightIn: kind === 'steel' ? 0 : round16(top - bottom) };
}

// A drawn outline (an elevation polygon, flat at the bottom: a future export of wall outlines) as a shape: the length
// across it and its top edge as points; a rectangle when the top is level.
export function outlineShape(outline) {
    const r = perimeterToPanel(outline);
    return r.errors.length ? null : r.shape;
}

// A perimeter drawn around the panel (its corners in order, either way round) as the panel's shape and the openings it
// leaves: a rectangular notch up from the bottom is a door, one down from the top a steel penetration. The ends are
// plumb, the bottom flat; the top may slope (a step in it is two panels). Returns { shape, openings, errors }.
// Where the line through a and b meets the line through c and d (null when parallel).
function crossing(a, b, c, d) {
    const den = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
    if (Math.abs(den) < 1e-9) return null;
    const u = a[0] * b[1] - a[1] * b[0], v = c[0] * d[1] - c[1] * d[0];
    return [(u * (c[0] - d[0]) - (a[0] - b[0]) * v) / den, (u * (c[1] - d[1]) - (a[1] - b[1]) * v) / den];
}
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
            // Across it, the top as it would run without it: where the runs either side meet over it (a peak the
            // penetration cut through), else straight across.
            const before = chain[i - 1], after = chain[i + 4], meet = before && after ? crossing(before, p, t, after) : null;
            const over = meet && meet[0] > r[0] + 1e-6 && meet[0] < q[0] - 1e-6 && meet[1] > Math.max(p[1], t[1]) ? [[round16(meet[0]), round16(meet[1])]] : [];
            chain = [...chain.slice(0, i + 1), ...over, ...chain.slice(i + 3)];
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
        // (A header or sill built of studs is as deep as those studs, up and down: their depth is free. Its tracks, and
        // every jamb part, go through the wall.)
        const named = [['bottom track', m.track], ['top track', m.topTrack], ['headers', m.header, 'head'], ['jambs', m.jamb], ['sills', m.sill, 'sill'],
            ...(panel.openings || []).flatMap((o, i) => OPENING_TYPES[kindOf(o)].members.map(k => [`${openingName(panel.openings, i)} ${MEMBER_LABELS[k].toLowerCase()}`, o[k], k]))];
        for (const [label, text, k] of named) {
            const parts = (specOf(text)?.parts || []).filter(p => !((k === 'head' || k === 'sill') && isStud(parseMember(p.name))));
            const off = parts.find(p => depthOf(p.name) != null && Math.abs(depthOf(p.name) - stud.depthIn) > 1e-6);
            if (off) add('members', `The ${label} (${off.name}) is ${fmtFtIn(depthOf(off.name)).replace(/^0'-/, '')} deep but the studs are ${fmtFtIn(stud.depthIn).replace(/^0'-/, '')}: use one depth through the wall.`);
        }
    }
    if (errors.some(e => e.where === 'shape')) return errors;
    const leg = track?.flangeIn ?? 1.25, flange = stud?.flangeIn ?? 1.625, inch = inchText;
    const boxes = (panel.openings || []).map(o => roughOpening(o, H)); // with their framing offsets
    (panel.openings || []).forEach((o, i) => {
        const n = openingName(panel.openings, i), b = boxes[i], kind = kindOf(o), where = `opening-${i}`;
        for (const k of OPENING_TYPES[kind].members) if (o[k] && !isSame(o[k]) && !specOf(o[k])) add(where, `${n} ${MEMBER_LABELS[k].toLowerCase()}: can't read "${o[k]}".`);
        if (!(Number(o.widthIn) >= 6) || (kind !== 'steel' && !(Number(o.heightIn) >= 6))) { add(where, `${n}: give it a width${kind === 'steel' ? '' : ' and a height'} (at least 6").`); return; }
        const typed = openingBox(o, H), off = offsetOf(o), withOff = off > 0 ? ` (with its ${inch(off)} framing offset)` : '';
        if (typed.left < 0 || typed.right > L) add(where, `${n} runs past the ${typed.left < 0 ? 'left' : 'right'} end of the panel.`);
        else if (b.left < 0 || b.right > L) add(where, `${n}'s rough opening${withOff} runs past the ${b.left < 0 ? 'left' : 'right'} end of the panel: move it in, or make the offset smaller.`);
        const fr = openingFraming(panel, o, H), headH = Math.max(leg, fr.head?.depthIn || 0), sillH = Math.max(leg, fr.sill?.depthIn || 0);
        if (o.headBearing === 'jacks' && fr.plies < 2) add(where, `${n}: a header on jack studs needs 2 or more jamb studs each side (one is the jack under it, the next the king).`);
        if (kind === 'steel') {
            const lowTop = topMin(top, Math.max(0, b.left), Math.min(L, b.right), H);
            if (lowTop - b.bottom < 6) add(where, `${n}: its sill (${fmtFtIn(typed.bottom)}${off > 0 ? `, ${fmtFtIn(b.bottom)} with its framing offset` : ''}) needs to be at least 6" below the top of the wall (${fmtFtIn(lowTop)} there).`);
        } else {
            const under = underMin(top, Math.max(0, b.left), Math.min(L, b.right), H, leg);
            if (b.top > under + 1 / 32) add(where, `${n}'s top${withOff ? ` with its framing offset` : ''} (${fmtFtIn(b.top)}) is above the underside of the top track there (${fmtFtIn(under)}).`);
            // Its header: a track's leg above the opening, a stud flange past each side, under the top track (or the
            // opening runs up to the top track: no header).
            else if (b.top < under - 1) {
                const room = underMin(top, Math.max(0, b.left - flange), Math.min(L, b.right + flange), H, leg) - b.top;
                if (room < headH - 1 / 32) add(where, `${n}: no room for its header under the top track (${inch(Math.max(0, room))} above it, ${inch(headH)} needed${headH > leg ? ` for its ${inch(headH)} deep header` : ''}). Lower it, use a shallower header, or raise it to the top track.`);
            }
        }
        if (kind !== 'door' && b.bottom < leg + sillH) add(where, `${n}: its sill is too low for a sill${sillH > leg ? ` ${inch(sillH)} deep` : ' track'}${kind === 'steel' ? '' : '; make it a door, or raise the sill'}.`);
        boxes.forEach((c, j) => {
            if (j > i && Math.min(b.right, c.right) - Math.max(b.left, c.left) > 0 && Math.min(b.top, c.top) - Math.max(b.bottom, c.bottom) > 0) {
                add(where, `${n} overlaps ${openingName(panel.openings, j)}.`);
            }
        });
    });
    // Openings framed out to the stud layout: the framed opening must not run into another one.
    if (!errors.length && (panel.openings || []).some(o => o.toLayout)) {
        const framed = frameInputs(panel).openings;
        framed.forEach((b, i) => {
            if (!b.requested) return;
            framed.forEach((c, j) => {
                if (j !== i && Math.min(b.right, c.right) - Math.max(b.left, c.left) > 1 / 16 && Math.min(b.top, c.top) - Math.max(b.bottom, c.bottom) > 0) {
                    add(`opening-${i}`, `${openingName(panel.openings, i)} framed out to the stud layout runs into ${openingName(panel.openings, j)}: turn off "Jambs on the layout" for one of them, or move it.`);
                }
            });
        });
    }
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
        const fr = openingFraming(panel, o, heightIn);
        Object.assign(framing, { jambPlies: fr.plies, jambStyle: fr.jambStyle, ...(fr.head?.depthIn ? { headDepthIn: fr.head.depthIn } : {}), ...(fr.sill?.depthIn ? { sillDepthIn: fr.sill.depthIn } : {}),
            ...(fr.bearing === 'jacks' ? { headBearing: 'jacks' } : {}), ...(fr.crippleEnds ? { crippleEnds: true } : {}) });
        return { ...fr.ro, ...(fr.offsetIn > 0 ? { clear: openingBox(o, heightIn) } : {}), ...(o.toLayout ? { toLayout: true } : {}), framing: { ...framing, source: 'entered' } };
    });
    const inputs = { lengthIn, heightIn, top, openings, studIn: stud.depthIn, flangeIn: stud.flangeIn ?? 1.625, mils: stud.mils, studName: stud.name,
        trackName: track.name, trackLegIn: track.flangeIn ?? 1.25, topTrackName: topTrack?.name, spacingIn: Number(m.spacingIn) || 16 };
    if (panel.layoutFromRight) inputs.layoutFromRight = true;
    if (panel.flipStuds) inputs.flipStuds = true;
    if (panel.studFlips?.length) inputs.studFlips = [...panel.studFlips];
    const sp = inputs.spacingIn, framedOut = (start) => openingsToLayout(inputs.openings, { L: lengthIn, start, spacing: sp, fromRight: !!panel.layoutFromRight, flange: inputs.flangeIn });
    const start = panel.layoutStartIn > 0 ? panel.layoutStartIn : panel.optimizeOpenings ? bestLayoutStart(inputs, framedOut) : sp;
    inputs.openings = framedOut(start);
    if (start !== sp) inputs.layoutStartIn = start;
    return inputs;
}

// --- Stud layout around the openings ---------------------------------------------------------------------------------
// The first stud's place that frames the panel with the fewest stud pieces (studs, jambs and cripples: a layout stud
// on a jamb's line, or a small opening between two layout studs, saves pieces), then the least stud length; a tie keeps
// the standard layout (on center from the left end). Tried in 1" steps; a layout the framing check fails never wins.
const pieces = (lay) => lay.members.filter(m => m.orient === 'v').length;
// Stud bays wider than the spacing: at each height (every 6"), between neighbouring verticals with no opening between
// them; a bay beside a jamb may be up to 3" + a flange wider (the engine leaves out a layout stud that close to a jamb).
// Counted once per pair. A shifted layout never gets more of them than the standard one.
export function wideBays(lay, spacing, flange = 1.625) {
    const vs = lay.members.filter(m => m.orient === 'v'), wide = new Set();
    for (let y = 6; y < lay.heightIn - 3; y += 6) {
        const at = vs.filter(m => m.y <= y && m.y + m.h >= y).map(m => ({ c: m.x + m.w / 2, jamb: m.role === 'jamb stud' })).sort((a, b) => a.c - b.c);
        const gaps = lay.openings.filter(o => o.bottom <= y && o.top >= y);
        for (let i = 1; i < at.length; i++) {
            const a = at[i - 1], b = at[i];
            if (gaps.some(o => o.left >= a.c - 1e-6 && o.right <= b.c + 1e-6)) continue;
            if (b.c - a.c > spacing + (a.jamb || b.jamb ? 3 + flange : 0) + 1 / 16) wide.add(`${a.c.toFixed(2)}|${b.c.toFixed(2)}`);
        }
    }
    return wide.size;
}
const layoutCost = (lay, sp) => (lay.issues.length ? 1e9 : 0) + wideBays(lay, sp) * 1e6 + pieces(lay) * 1000 + lay.members.filter(m => m.orient === 'v').reduce((n, m) => n + m.lengthIn, 0) / 12;
const bestCache = new Map();
// openingsFor(start): the openings for a layout starting there (those framed out to the layout move with it).
export function bestLayoutStart(inputs, openingsFor = null) {
    const sp = inputs.spacingIn || 16, key = JSON.stringify({ ...inputs, layoutStartIn: undefined });
    if (bestCache.has(key)) return bestCache.get(key);
    const at = (st) => ({ ...inputs, layoutStartIn: st === sp ? undefined : st, openings: openingsFor ? openingsFor(st) : inputs.openings });
    let best = { start: sp, cost: layoutCost(frameWall(at(sp)), sp) - 0.5 };
    for (let st = 1; st < sp - 1e-9; st += 1) {
        const cost = layoutCost(frameWall(at(st)), sp);
        if (cost < best.cost) best = { start: st, cost };
    }
    if (bestCache.size > 80) bestCache.delete(bestCache.keys().next().value);
    bestCache.set(key, best.start);
    return best.start;
}
// What the layout is for the page: { optimized, start (the first stud's center from the left end), spacing, pieces,
// standardPieces }.
// manual: the first stud set by hand; fromRight: the layout from the right end.
export function layoutInfo(panel) {
    const inputs = frameInputs(panel), sp = inputs.spacingIn;
    const standard = pieces(frameWall(frameInputs({ ...panel, optimizeOpenings: false, layoutStartIn: null })));
    return { optimized: !!panel.optimizeOpenings, manual: panel.layoutStartIn > 0 ? panel.layoutStartIn : null, fromRight: !!panel.layoutFromRight,
        start: inputs.layoutStartIn || sp, spacing: sp, pieces: pieces(frameWall(inputs)), standardPieces: standard };
}

// --- Jambs on the stud layout -------------------------------------------------------------------------------------------
// An opening framed out to the layout (toLayout): its jambs moved out to the nearest layout studs, which are then its
// jambs (no extra studs beside them). The framed opening runs from the right face of the last layout stud at or left of
// it to the left face of the first at or right of it; at a panel end, to the end stud. The opening as asked for is kept
// as requested (the sheet draws it inside).
export function openingsToLayout(openings, { L, start, spacing, fromRight = false, flange = 1.625 }) {
    const centers = [];
    for (let k = 0; start + k * spacing < L; k++) centers.push(fromRight ? L - (start + k * spacing) : start + k * spacing);
    return openings.map(o => {
        if (!o.toLayout) return o;
        const lefts = centers.filter(c => c + flange / 2 <= o.left + 1e-6 && c - flange / 2 >= flange + 3), rights = centers.filter(c => c - flange / 2 >= o.right - 1e-6 && c + flange / 2 <= L - flange - 3);
        const left = lefts.length ? Math.max(...lefts) + flange / 2 : flange, right = rights.length ? Math.min(...rights) - flange / 2 : L - flange;
        return { ...o, left: round16(Math.min(o.left, left)), right: round16(Math.max(o.right, right)), requested: { left: o.left, right: o.right } };
    });
}
// What framing one opening out to the layout saves (negative: costs), for the toggle's label: stud pieces, and steel
// (inches of every member, the wider header and sill counted against the studs left out).
export function toLayoutEffect(panel, i) {
    const lay = (on) => frameWall(frameInputs({ ...panel, openings: panel.openings.map((o, j) => (j === i ? { ...o, toLayout: on } : o)) }));
    const steel = (l) => l.members.reduce((n, m) => n + m.lengthIn, 0);
    try { const off = lay(false), on = lay(true); return { pieces: pieces(off) - pieces(on), lengthIn: round16(steel(off) - steel(on)) }; } catch { return { pieces: 0, lengthIn: 0 }; }
}
export const toLayoutSaving = (panel, i) => toLayoutEffect(panel, i).pieces;

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
    inputs.openings.forEach((o, i) => { // framed out to the layout: between the jambs, against the opening asked for
        if (o.requested) builtUp.add(`${openingName(panel.openings, i)} framed to the stud layout: ${fmtFtIn(o.right - o.left)} between jambs (rough opening ${fmtFtIn(o.requested.right - o.requested.left)}).`);
    });
    for (const line of framingNotes(panel)) builtUp.add(line); // after the members: the rough openings, then the details
    layout.notes.push(...builtUp);
    Object.assign(layout, placeClips(layout, panel.clips));
    if (layout.clipList.length) layout.notes.push(`Clips: ${layout.clipList.map(c => `${c.mark} ${c.type} (${c.qty})`).join(', ')}; on each stud's web.`);
    return panel.sideB ? flipLayout(layout) : layout;
}
// One note per opening with framing beyond the plain one: its rough opening (when offset), its jamb studs, a header or
// sill built of studs, a header on jack studs, cripples at the ends.
export function framingNotes(panel) {
    const H = shapeTop(panel.shape).heightIn;
    return (panel.openings || []).map((o, i) => {
        const fr = openingFraming(panel, o, H), b = openingBox(o, H), bits = [];
        if (fr.offsetIn > 0) bits.push(`rough opening ${fmtFtIn(fr.ro.right - fr.ro.left)}${b.through ? '' : ` x ${fmtFtIn(fr.ro.top - fr.ro.bottom)}`} (${inchText(fr.offsetIn)} framing offset)`);
        if (fr.plies > 1) bits.push(`${fr.plies} jamb studs each side, ${JAMB_STYLES[fr.jambStyle].toLowerCase()}`);
        if (fr.head?.depthIn) bits.push(`header ${HEAD_STYLES[fr.head.style].toLowerCase()}, ${inchText(fr.head.depthIn)} deep${fr.bearing === 'jacks' ? ', on jack studs' : ''}`);
        else if (fr.bearing === 'jacks') bits.push('header on jack studs');
        if (fr.sill?.depthIn) bits.push(`sill ${HEAD_STYLES[fr.sill.style].toLowerCase()}, ${inchText(fr.sill.depthIn)} deep`);
        if (fr.crippleEnds) bits.push('cripples at the header and sill ends');
        if (!bits.length) return '';
        const size = b.through ? `${fmtFtIn(b.right - b.left)} wide` : `${fmtFtIn(b.right - b.left)} x ${fmtFtIn(b.top - b.bottom)}`;
        return `${openingName(panel.openings, i)} ${size}: ${bits.join('; ')}.`;
    }).filter(Boolean);
}

// --- Clips ---------------------------------------------------------------------------------------------------------
// Clips (deflection, bridging, ...) placed by a point: each goes on the nearest vertical (by its center) running
// through that height, on its web (a clip fastens to the web), and follows it when the layout moves. Typed names are
// fine; these are the usual ones.
export const CLIP_TYPES = ['Deflection clip', 'Bridging clip', 'Rigid clip', 'Angle clip'];
// The clips as placed on a layout (side A): { clips: [{ i (in panel.clips), type, mark, x (the web's face), y, side 'L' |
// 'R', member (its index), stud (its mark) }], clipList: [{ mark, type, qty }] (marks CL0, CL1, ... by type), missing:
// [i] (no stud at that height) }. Two clips on one stud within 1" of each other count once.
export function placeClips(layout, clips = []) {
    const vs = layout.members.map((m, k) => [m, k]).filter(([m]) => m.orient === 'v');
    const placed = [], missing = [];
    (clips || []).forEach((c, i) => {
        const y = Number(c?.y), x = Number(c?.x);
        const at = vs.filter(([m]) => y >= m.y - 1e-6 && y <= m.y + m.h + 1e-6);
        if (!at.length || !Number.isFinite(x) || !Number.isFinite(y)) { missing.push(i); return; }
        const [m, k] = at.reduce((a, b) => (Math.abs(b[0].x + b[0].w / 2 - x) < Math.abs(a[0].x + a[0].w / 2 - x) ? b : a));
        if (placed.some(p => p.member === k && Math.abs(p.y - y) < 1)) return;
        // on its web; at a panel end, on the inside face (a clip never hangs off the panel)
        const right = m.x <= 0.5 ? true : m.x + m.w >= layout.lengthIn - 0.5 ? false : webOnRight(m, layout);
        placed.push({ i, type: String(c.type || CLIP_TYPES[0]).trim() || CLIP_TYPES[0], x: right ? m.x + m.w : m.x, y: round16(y), side: right ? 'R' : 'L', member: k });
    });
    const types = [...new Set(placed.map(c => c.type))];
    for (const c of placed) { c.mark = `CL${types.indexOf(c.type)}`; c.stud = layout.members[c.member].mark || ''; }
    return { clips: placed, clipList: types.map((type, n) => ({ mark: `CL${n}`, type, qty: placed.filter(c => c.type === type).length })), missing };
}
// A clip 2" under the top of every vertical that reaches the top track (deflection clips).
export function clipsAtTop(layout, type = CLIP_TYPES[0]) {
    return layout.members.filter(m => m.orient === 'v' && (m.atTop || m.y + m.h >= layout.heightIn - 3))
        .map(m => { const top = m.pts ? Math.min(...m.pts.filter(q => q[1] > m.y + 1e-6).map(q => q[1])) : m.y + m.h; return { type, x: round16(m.x + m.w / 2), y: round16(top - 2) }; });
}
// A clip on every vertical running through height y (one each), for "Clip every stud".
export function clipsOnEveryStud(layout, y, type = CLIP_TYPES[0]) {
    return layout.members.filter(m => m.orient === 'v' && y >= m.y - 1e-6 && y <= m.y + m.h + 1e-6)
        .map(m => ({ type, x: round16(m.x + m.w / 2), y: round16(y) }));
}

// --- New panels, marks, the set -------------------------------------------------------------------------------------

const rid = () => `p-${Math.random().toString(36).slice(2, 10)}`;
// P-101 -> P-102, A9 -> A10, PANEL -> PANEL-2.
export function nextMark(mark) {
    const m = /^(.*?)(\d+)(\D*)$/.exec(String(mark || '').trim());
    if (!m) return `${String(mark || 'P').trim() || 'P'}-2`;
    return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, '0')}${m[3]}`;
}

// --- Panels from the model: their perimeter and openings locked ---------------------------------------------------
// A panel exported from Revit (it has a revit block) keeps the model's geometry: its shape, and every opening that came
// with it (locked), stay exactly as they came, so the trip back finds each wall, door, window and penetration where the
// model has it. Its members, stud layout, side B and names can change; an opening added here is new (not locked: the
// importer reports it, it does not move anything of the model's).
export const isFromModel = (p) => !!(p && p.revit && typeof p.revit === 'object');
export const isLockedOpening = (p, o) => isFromModel(p) && !!o?.locked;
// Whether a field may change, by its path on the panel ('shape.lengthIn', 'openings.2.leftIn', 'openings.2' to remove
// it): never the shape of a panel from the model, nor where, how big or what kind a locked opening is.
export function canEdit(panel, path) {
    if (!isFromModel(panel)) return true;
    if (/^shape(\.|$)/.test(path)) return false;
    const m = /^openings\.(\d+)(?:\.(\w+))?$/.exec(path);
    if (m && isLockedOpening(panel, panel.openings?.[Number(m[1])])) return !(m[2] == null || /^(kind|leftIn|widthIn|heightIn|sillIn|__right)$/.test(m[2]));
    return true;
}
// A copy that is not the model's wall: no revit block, nothing locked.
function unlinked(panel) {
    const { revit, ...rest } = structuredClone(panel);
    return { ...rest, openings: (rest.openings || []).map(({ locked, ...o }) => o) };
}

// A new panel: the previous one's level, wall type, group, shape and members (the next mark), so a run of similar
// panels is quick to enter; the first one a plain 10 ft x 10 ft wall. Never linked to a model's wall.
export function newPanel(prev = null, marks = []) {
    let mark = prev ? nextMark(prev.mark) : 'P-101';
    while (marks.includes(mark)) mark = nextMark(mark);
    if (!prev) return { id: rid(), mark, level: '', wallType: '', group: '', sideB: false, optimizeOpenings: false, shape: { kind: 'rect', lengthIn: 120, heightIn: 120 }, openings: [], members: { ...DEFAULT_MEMBERS } };
    const { layoutStartIn, ...rest } = unlinked(prev);
    return { ...rest, id: rid(), mark, openings: [] };
}
// A copy (a free panel even when the original is the model's: one wall, one panel).
export const copyPanel = (panel, marks = []) => {
    let mark = nextMark(panel.mark);
    while (marks.includes(mark)) mark = nextMark(mark);
    return { ...unlinked(panel), id: rid(), mark };
};

// The members of one panel given to others (the checked panels, or a group).
export function assignMembers(panels, ids, members) {
    const want = new Set(ids);
    return panels.map(p => (want.has(p.id) ? { ...p, members: { ...members } } : p));
}

// The set as a JSON file, and a file read back (this format; or a plain list of panels or of wall outlines, e.g. from a
// model export: { mark, outline: [[x, y], ...], openings, members }). Returns { set, warnings }.
export function exportSet(set, { framing = true } = {}) {
    const context = Object.fromEntries(['source', 'grids', 'levels'].filter(k => set[k] != null).map(k => [k, structuredClone(set[k])]));
    return { format: FORMAT, version: VERSION, project: set.project || '', drawnBy: set.drawnBy || '', savedAt: new Date().toISOString(), ...context,
        panels: (set.panels || []).map(p => { const c = cleanPanel(p); return framing ? { ...c, framing: framingOf(c) } : c; }) };
}
// A panel's framing as this tool lays it out (side A; inches from the left end and the bottom), for the model side to
// compare with or place from; ignored when read back (it is computed again). null when the inputs need fixing.
export function framingOf(panel) {
    if (panelErrors(panel).length) return null;
    const inputs = frameInputs(panel), lay = frameWall(inputs);
    return { layoutStartIn: inputs.layoutStartIn || inputs.spacingIn, spacingIn: inputs.spacingIn, ...(inputs.layoutFromRight ? { layoutFromRight: true } : {}), ...(inputs.flipStuds ? { flipStuds: true } : {}),
        studType: lay.studType, trackType: lay.trackType,
        openings: inputs.openings.map(({ framing, ...o }) => o), // as framed: one with jambs on the stud layout wider, its rough opening as requested
        members: lay.members.map(m => ({ mark: m.mark, ...(m.marks ? { marks: m.marks } : {}), role: m.role, func: m.func, type: m.type, ...(m.parts ? { parts: m.parts } : {}),
            x: m.x, y: m.y, w: m.w, h: m.h, lengthIn: m.lengthIn, ...(m.pts ? { pts: m.pts } : {}), ...(m.orient === 'v' ? { webRight: webOnRight(m, lay) } : {}) })),
        cutList: lay.cutList.map(({ mark, qty, type, lengthIn, func }) => ({ mark, qty, type, lengthIn, func })), issues: lay.issues.map(i => i.message),
        ...(() => { const c = placeClips(lay, panel.clips); return c.clips.length ? { clips: c.clips.map(({ i, ...k }) => ({ ...k, member: lay.members[k.member]?.mark || '' })), clipList: c.clipList } : {}; })() };
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
            const fromModel = raw.revit && typeof raw.revit === 'object';
            panels.push(cleanPanel({ ...raw, shape: r.shape, openings: [...r.openings, ...(raw.openings || [])].map(o => (fromModel ? { ...o, locked: true } : o)) }));
            return;
        }
        if (!raw?.shape) { warnings.push(`${name}: no shape or outline; skipped.`); return; }
        panels.push(cleanPanel(raw));
    });
    const context = Object.fromEntries(['source', 'grids', 'levels'].filter(k => data?.[k] != null).map(k => [k, structuredClone(data[k])])); // a model's export: kept for the trip back
    return { set: { project: String(data?.project || ''), drawnBy: String(data?.drawnBy || ''), ...context, panels }, warnings };
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
        optimizeOpenings: !!p.optimizeOpenings, // the opening optimizer: off unless asked for
        ...(Number(p.layoutStartIn) > 0 ? { layoutStartIn: round16(Number(p.layoutStartIn)) } : {}), ...(p.layoutFromRight ? { layoutFromRight: true } : {}), ...(p.flipStuds ? { flipStuds: true } : {}),
        ...(Array.isArray(p.studFlips) && p.studFlips.length ? { studFlips: [...new Set(p.studFlips.map(Number).filter(Number.isFinite).map(round16))] } : {}),
        ...(Array.isArray(p.clips) && p.clips.length ? { clips: p.clips.filter(c => Number.isFinite(len(c?.x)) && Number.isFinite(len(c?.y))).map(c => ({ type: str(c.type, 60) || CLIP_TYPES[0], x: round16(len(c.x)), y: round16(len(c.y)) })) } : {}),
        ...(p.revit && typeof p.revit === 'object' ? { revit: structuredClone(p.revit) } : {}), // the model's wall: kept as it came, for the trip back
        shape, members: Object.fromEntries(Object.keys(DEFAULT_MEMBERS).map(k => [k, members[k]])),
        openings: (p.openings || []).map(o => {
            const kind = kindOf(o), size = OPENING_TYPES[kind].size, H = shapeTop(shape).heightIn;
            return { kind, leftIn: len(o?.leftIn) ?? 0, widthIn: len(o?.widthIn) ?? size.widthIn, heightIn: kind === 'steel' ? 0 : len(o?.heightIn) ?? size.heightIn,
                sillIn: kind === 'door' ? 0 : len(o?.sillIn) ?? size.sillIn ?? Math.max(0, H - 24),
                head: kind === 'steel' ? '' : str(o?.head), jamb: str(o?.jamb), sill: kind === 'door' ? '' : str(o?.sill), ...(o?.locked && p.revit ? { locked: true } : {}), ...(o?.toLayout ? { toLayout: true } : {}),
                ...(o?.offsetIn !== '' && o?.offsetIn != null && Number.isFinite(len(o.offsetIn)) ? { offsetIn: round16(Math.max(0, len(o.offsetIn))) } : {}),
                ...(JAMB_STYLES[o?.jambStyle] && o.jambStyle !== 'box' ? { jambStyle: o.jambStyle } : {}), ...(o?.headStyle === 'back' && kind !== 'steel' ? { headStyle: 'back' } : {}),
                ...(o?.sillStyle === 'back' && kind !== 'door' ? { sillStyle: 'back' } : {}), ...(o?.headBearing === 'jacks' && kind !== 'steel' ? { headBearing: 'jacks' } : {}), ...(o?.crippleEnds ? { crippleEnds: true } : {}) };
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
        trim(MEMBER_KEYS.map(k => p.members[k])), p.openings.map(o => trim([KIND_CODES.indexOf(o.kind), o.leftIn, o.widthIn, o.heightIn, o.sillIn, o.head, o.jamb, o.sill, o.toLayout ? 1 : '',
            o.offsetIn ?? '', o.jambStyle || '', o.headStyle || '', o.sillStyle || '', o.headBearing === 'jacks' ? 1 : '', o.crippleEnds ? 1 : ''])), '', p.optimizeOpenings ? 1 : '',
        p.flipStuds ? 1 : '', p.layoutFromRight ? 1 : '', p.layoutStartIn || '', (p.clips || []).map(c => [c.type, c.x, c.y]), p.studFlips || '']);
    const bytes = new TextEncoder().encode(JSON.stringify(packed));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodePanel(code) {
    const bin = atob(String(code || '').replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    if (!Array.isArray(data) || data[0] !== 1) return cleanPanel(data); // a link written as the panel itself
    const [, mark, level, wallType, group, sideB, shape = [], members = [], openings = [], , optimize, flipStuds, fromRight, startIn, clips = [], studFlips = []] = data;
    return cleanPanel({ mark, level, wallType, group, sideB: !!sideB, optimizeOpenings: optimize === 1, flipStuds: flipStuds === 1, layoutFromRight: fromRight === 1, layoutStartIn: startIn,
        clips: Array.isArray(clips) ? clips.map(([type, x, y]) => ({ type, x, y })) : [], studFlips: Array.isArray(studFlips) ? studFlips : [],
        shape: { kind: shape[0], ...Object.fromEntries((SHAPE_KEYS[shape[0]] || []).map((k, i) => [k, shape[i + 1]])) },
        members: Object.fromEntries(MEMBER_KEYS.map((k, i) => [k, members[i] ?? (k === 'spacingIn' ? 16 : '')])),
        openings: openings.map(([w, leftIn, widthIn, heightIn, sillIn, head, jamb, sill, toLayout, offsetIn, jambStyle, headStyle, sillStyle, jacks, crippleEnds]) => ({ kind: KIND_CODES[w] || 'door', leftIn, widthIn, heightIn, sillIn, head, jamb, sill,
            toLayout: toLayout === 1, offsetIn, jambStyle, headStyle, sillStyle, headBearing: jacks === 1 ? 'jacks' : '', crippleEnds: crippleEnds === 1 })) });
}
