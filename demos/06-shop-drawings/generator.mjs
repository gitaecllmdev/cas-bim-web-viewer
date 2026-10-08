// Panel Shop Generator (core/client/shop-generator.html): framing shop drawings without a model. A panel is typed in
// by hand (its shape: a rectangle, a single slope, a gable or a drawn top; its doors and windows; its members) and
// framed with the same engine and sheet as the model's shop drawings (../common/framing.mjs, ./sheet.mjs).
// Pure; tested in tests/shop-generator.test.js. Units: inches.
//
// A panel: { id, mark, level, wallType, group, sideB,
//   shape: { kind: 'rect' | 'rake' | 'gable' | 'custom', lengthIn, heightIn (rect), leftIn, rightIn (rake, gable eaves),
//            peakIn, peakAtIn (gable), points: [[x, height], ...] (custom: the top, left end to right end) },
//   openings: [{ kind: 'door' | 'window', leftIn (from the panel's left end), widthIn, heightIn, sillIn (window),
//                head, jamb, sill (this opening's members; '' = the panel's) }],
//   members: { stud, track, topTrack, spacingIn, header, jamb, sill } } (SSMA names; '' = as the stud and track).
// A set (the JSON file, see exportSet): { format, version, project, drawnBy, panels: [panel] }.
import { frameWall, flipLayout, fmtFtIn, round16, underMin, wallTop, topAt } from '../common/framing.mjs';
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

// A drawn outline (an elevation polygon, flat at the bottom: a future export of wall outlines) as a shape: the length
// across it and its top edge as points; a rectangle when the top is level.
export function outlineShape(outline) {
    const pts = (outline || []).map(p => [Number(p?.[0]), Number(p?.[1])]).filter(p => p.every(Number.isFinite));
    if (pts.length < 3) return null;
    const x0 = Math.min(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), L = Math.max(...pts.map(p => p[0])) - x0;
    const topPts = new Map();
    for (const [x, y] of pts) if (y - y0 > 1e-6) { const k = round16(x - x0); topPts.set(k, Math.max(topPts.get(k) ?? 0, round16(y - y0))); }
    const points = [...topPts].sort((a, b) => a[0] - b[0]);
    if (!(L > 0) || points.length < 2) return null;
    const top = wallTop(points, L);
    return top ? { kind: 'custom', lengthIn: round16(L), points: top } : { kind: 'rect', lengthIn: round16(L), heightIn: points[0][1] };
}

// --- A panel to the framing engine -------------------------------------------------------------------------------

const specOf = (text) => { const s = String(text || '').trim(); return s ? parseMemberSpec(s) : null; };
const doorOf = (o) => o.kind === 'door';
// D1, D2, … for doors and W1, W2, … for windows, in the panel's order.
export const openingName = (openings, i) => `${doorOf(openings[i]) ? 'D' : 'W'}${openings.slice(0, i + 1).filter(o => o.kind === openings[i].kind).length}`;
// An opening on the panel: { left, right, bottom, top } (the rough opening).
export const openingBox = (o) => {
    const bottom = doorOf(o) ? 0 : Number(o.sillIn) || 0, left = Number(o.leftIn) || 0;
    return { left, right: left + (Number(o.widthIn) || 0), bottom, top: bottom + (Number(o.heightIn) || 0) };
};

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
    if (!stud || !isStud(stud)) add('members', `Can't read the stud "${m.stud || ''}": type an SSMA stud such as 362S162-33.`);
    if (m.track && !isTrack(track)) add('members', `Can't read the track "${m.track}": type an SSMA track such as 362T125-33.`);
    if (m.topTrack && !isTrack(parseMember(m.topTrack))) add('members', `Can't read the top track "${m.topTrack}": type an SSMA track such as 362T200-33, or leave it empty.`);
    const sp = Number(m.spacingIn);
    if (!(sp >= 4 && sp <= 48)) add('members', 'Stud spacing should be between 4" and 48" (16" o.c. is typical).');
    for (const [k, label] of [['header', 'Header'], ['jamb', 'Jambs'], ['sill', 'Sill']]) {
        if (m[k] && !specOf(m[k])) add('members', `${label}: can't read "${m[k]}". Type it like (2) 362S162-43 WITH (1) 362T125-43.`);
    }
    // One depth through the wall: every track, header, jamb and sill part as deep as the studs.
    if (stud) {
        const depthOf = (name) => parseMember(name)?.depthIn;
        const named = [['track', m.track], ['top track', m.topTrack], ['headers', m.header], ['jambs', m.jamb], ['sills', m.sill],
            ...(panel.openings || []).flatMap((o, i) => [[`${openingName(panel.openings, i)} header`, o.head], [`${openingName(panel.openings, i)} jambs`, o.jamb], [`${openingName(panel.openings, i)} sill`, o.sill]])];
        for (const [label, text] of named) {
            const parts = text ? (specOf(text)?.parts || []) : [];
            const off = parts.find(p => depthOf(p.name) != null && Math.abs(depthOf(p.name) - stud.depthIn) > 1e-6);
            if (off) add('members', `The ${label} (${off.name}) is ${fmtFtIn(depthOf(off.name)).replace(/^0'-/, '')} deep but the studs are ${fmtFtIn(stud.depthIn).replace(/^0'-/, '')}: use one depth through the wall.`);
        }
    }
    if (errors.some(e => e.where === 'shape')) return errors;
    const leg = track?.flangeIn ?? 1.25;
    const boxes = (panel.openings || []).map(openingBox);
    (panel.openings || []).forEach((o, i) => {
        const n = openingName(panel.openings, i), b = boxes[i];
        for (const [k, label] of [['head', 'header'], ['jamb', 'jambs'], ['sill', 'sill']]) {
            if (o[k] && !specOf(o[k])) add(`opening-${i}`, `${n} ${label}: can't read "${o[k]}".`);
        }
        if (!(Number(o.widthIn) >= 6) || !(Number(o.heightIn) >= 6)) { add(`opening-${i}`, `${n}: give it a width and a height (at least 6").`); return; }
        if (b.left < 0 || b.right > L) add(`opening-${i}`, `${n} runs past the ${b.left < 0 ? 'left' : 'right'} end of the panel.`);
        const under = underMin(top, Math.max(0, b.left), Math.min(L, b.right), H, leg);
        if (b.top > under + 1 / 32) add(`opening-${i}`, `${n}'s top (${fmtFtIn(b.top)}) is above the underside of the top track there (${fmtFtIn(under)}).`);
        // Its header: a track's leg above the opening, reaching a stud flange past each side, under the top track (or
        // the opening runs up to the top track: no header).
        else if (b.top < under - 1) {
            const flange = stud?.flangeIn ?? 1.625, room = underMin(top, Math.max(0, b.left - flange), Math.min(L, b.right + flange), H, leg) - b.top;
            if (room < leg - 1 / 32) add(`opening-${i}`, `${n}: no room for its header under the top track (${fmtFtIn(Math.max(0, room)).replace(/^0'-/, '')} above it, ${fmtFtIn(leg).replace(/^0'-/, '')} needed). Lower it, or raise it to the top track.`);
        }
        if (!doorOf(o) && b.bottom < 2 * leg) add(`opening-${i}`, `${n}: its sill is too low for a sill track; make it a door, or raise the sill.`);
        boxes.forEach((c, j) => {
            if (j > i && Math.min(b.right, c.right) - Math.max(b.left, c.left) > 0 && Math.min(b.top, c.top) - Math.max(b.bottom, c.bottom) > 0) {
                add(`opening-${i}`, `${n} overlaps ${openingName(panel.openings, j)}.`);
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
        for (const [k, def] of [['head', m.header], ['jamb', m.jamb], ['sill', m.sill]]) {
            const parts = specOf(o[k] || def)?.parts;
            if (parts) framing[k] = parts;
        }
        return { ...openingBox(o), ...(Object.keys(framing).length ? { framing: { ...framing, source: 'entered' } } : {}) };
    });
    return { lengthIn, heightIn, top, openings, studIn: stud.depthIn, flangeIn: stud.flangeIn ?? 1.625, mils: stud.mils, studName: stud.name,
        trackName: track.name, trackLegIn: track.flangeIn ?? 1.25, topTrackName: topTrack?.name, spacingIn: Number(m.spacingIn) || 16 };
}

// The panel framed: the layout as drawn (side B: mirrored), with a note for each built-up opening member.
export function panelLayout(panel) {
    const inputs = frameInputs(panel);
    const layout = frameWall(inputs);
    const m = { ...DEFAULT_MEMBERS, ...(panel.members || {}) };
    const builtUp = new Set();
    (panel.openings || []).forEach((o) => {
        const parts = [['header', o.head || m.header], ['jambs', o.jamb || m.jamb], ['sill', o.kind === 'door' ? '' : o.sill || m.sill]]
            .filter(([, spec]) => (specOf(spec)?.parts || []).reduce((n, p) => n + p.qty, 0) > 1).map(([k, spec]) => `${k} ${spec}`);
        if (parts.length) builtUp.add(`${o.kind === 'door' ? 'Door' : 'Window'} framing: ${parts.join('; ')}.`);
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
        const shape = raw?.outline ? outlineShape(raw.outline) : raw?.shape;
        if (!shape) { warnings.push(`Panel ${i + 1}${raw?.mark ? ` (${raw.mark})` : ''}: no shape or outline; skipped.`); return; }
        panels.push(cleanPanel({ ...raw, shape }));
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
        openings: (p.openings || []).map(o => ({ kind: o?.kind === 'window' ? 'window' : 'door', leftIn: len(o?.leftIn) ?? 0, widthIn: len(o?.widthIn) ?? 36,
            heightIn: len(o?.heightIn) ?? (o?.kind === 'window' ? 48 : 84), sillIn: o?.kind === 'window' ? len(o?.sillIn) ?? 36 : 0, head: str(o?.head), jamb: str(o?.jamb), sill: str(o?.sill) })),
    };
}

// Remembered inputs: the value first, no repeats (case aside), at most max of them.
export function remember(list, value, max = 10) {
    const v = String(value ?? '').trim();
    if (!v) return list || [];
    return [v, ...(list || []).filter(x => x.toUpperCase() !== v.toUpperCase())].slice(0, max);
}

// A panel in a link (the QR code on its sheet opens it in the generator): compact JSON, base64url.
export function encodePanel(panel) {
    const p = cleanPanel(panel);
    const json = JSON.stringify({ ...p, id: undefined });
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodePanel(code) {
    const bin = atob(String(code || '').replace(/-/g, '+').replace(/_/g, '/'));
    return cleanPanel(JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))));
}
