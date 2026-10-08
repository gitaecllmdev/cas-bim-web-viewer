// Framing layout for one wall (pure functions, tested in tests/shop-drawings.test.js). Shared by the takeoff (Demo 2)
// and the shop drawings (Demo 6), so their stud counts and cut lengths are identical.
// Units: inches. Elevation coordinates: x from the left end of the wall, y from the bottom of the wall.
// Member lengths are cut lengths rounded DOWN to 1/8" (so a member never runs long). Shop-drawing labels follow the
// CAS convention: vertical members C0, C1, … and horizontal members T0, T1, …, one label per member type + length.

export const round16 = (inches) => Math.round(inches * 16) / 16;
export const round8 = (inches) => Math.round(inches * 8) / 8;
export const floor8 = (inches) => Math.floor(inches * 8 + 1e-6) / 8; // cut-length precision: 1/8", rounded down

// 55 3/8 -> 4'-7 3/8" (to the nearest 1/8")
export function fmtFtIn(inches) {
    const total = round8(inches);
    const sign = total < 0 ? '-' : '';
    const abs = Math.abs(total);
    let feet = Math.floor(abs / 12);
    let rest = abs - feet * 12;
    if (rest >= 12 - 1e-9) { feet++; rest = 0; }
    const whole = Math.floor(rest + 1e-9);
    let n = Math.round((rest - whole) * 8), d = 8;
    while (n && n % 2 === 0) { n /= 2; d /= 2; }
    const inch = n ? `${whole} ${n}/${d}` : `${whole}`; // architectural: 11'-0 7/16"
    return `${sign}${feet}'-${inch}"`;
}

// SSMA-style designation: 362S162-33 (3 5/8" stud, 1 5/8" flange, 33 mil), 362T125-33 for track.
export function memberType(studIn, kind, mils, member = 'stud') {
    if (member === 'furring channel') return `${fmtInchesShort(studIn)} FURRING CHANNEL`;
    const depth = String(Math.floor(studIn * 100 + 1e-6)).padStart(3, '0'); // SSMA truncates: 3 5/8" -> 362
    return kind === 'track' ? `${depth}T125-${mils}` : `${depth}S162-${mils}`;
}

function fmtInchesShort(inches) {
    const whole = Math.floor(inches), frac = Math.round((inches - whole) * 8);
    const [n, d] = frac % 4 === 0 ? [frac / 4, 2] : frac % 2 === 0 ? [frac / 2, 4] : [frac, 8];
    return frac ? `${whole ? whole + ' ' : ''}${n}/${d}"` : `${whole}"`;
}

// Openings from the model scan: { left, right, bottom, top } in inches. A door reaches the floor (bottom ≈ 0).
export const isDoor = (o) => o.bottom <= 1;

// CAS shop-drawing function codes (the FUNCTION column of the cut list and the sheet legend).
export const FUNCTIONS = {
    TTOP: 'TOP TRACK', TBOT: 'BOTTOM TRACK', HDD: 'DOOR HEADER', HDW: 'WINDOW HEADER', SBW: 'WINDOW SILL',
    HDM: 'MEP OPENING HEADER', SBM: 'MEP OPENING SILL', SBS: 'STEEL OPENING SILL',
    EV: 'END STUD', SV: 'STUD', SD: 'JAMB STUD', CR: 'CRIPPLE STUD',
};
// Opening kinds beyond doors and windows (opening.kind): an MEP opening (framed like a window) and a steel penetration
// (opening.through: up through the top of the wall, the top track cut there; jambs and a sill, no header).
export const OPENING_KINDS = { door: 'DOOR', window: 'WINDOW', mep: 'MEP OPENING', steel: 'STEEL OPENING' };
export const openingKind = (o) => (o.kind && OPENING_KINDS[o.kind] ? o.kind : o.through ? 'steel' : isDoor(o) ? 'door' : 'window');
const FUNC_OF_ROLE = { 'top track': 'TTOP', 'bottom track': 'TBOT', 'sill track': 'SBW', 'end stud': 'EV', stud: 'SV', 'jamb stud': 'SD', cripple: 'CR' };

// The same panel seen from its other face (side B): mirrored left to right, labels unchanged. Ordinates on the
// sheet then run from the other end. Pure: returns a new layout.
export function flipLayout(layout) {
    const L = layout.lengthIn;
    const mirror = (pts) => pts.map(([x, y]) => [round16(L - x), y]).reverse(); // reversed: still counter-clockwise
    return {
        ...layout, flipped: !layout.flipped,
        members: layout.members.map(m => ({ ...m, x: round16(L - m.x - m.w), ...(m.pts ? { pts: mirror(m.pts) } : {}) })),
        openings: layout.openings.map(o => ({ ...o, left: round16(L - o.right), right: round16(L - o.left) })).sort((a, b) => a.left - b.left),
        ticks: [...new Set(layout.members.filter(m => m.orient === 'v').map(m => round16(L - m.x - m.w)))].sort((a, b) => a - b),
        ...(layout.top ? { top: mirror(layout.top) } : {}),
    };
}

// --- Sloped tops (a rake or a gable) ------------------------------------------------------------------------------
// The top of the wall as points [x, height] from the left end to the right end (inches, x increasing). Returns them
// tidied (rounded to 1/16", ends at 0 and L, points on a straight line dropped), or null for a flat top. A step (two
// heights at one x) is not a sloped top: the later point is kept (frame a step as two panels).
export function wallTop(top, lengthIn) {
    if (!Array.isArray(top) || top.length < 2) return null;
    const L = round16(lengthIn);
    const pts = top.map(p => [Number(p?.[0]), Number(p?.[1])]).filter(([x, h]) => Number.isFinite(x) && Number.isFinite(h) && h > 0)
        .map(([x, h]) => [round16(Math.min(L, Math.max(0, x))), round16(h)]).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const p of pts) {
        if (out.length && p[0] - out[out.length - 1][0] < 1 / 8) out[out.length - 1] = p;
        else out.push(p);
    }
    if (!out.length) return null;
    if (out[0][0] > 0) out.unshift([0, out[0][1]]);
    if (out[out.length - 1][0] < L) out.push([L, out[out.length - 1][1]]);
    const kept = [out[0]];
    for (let i = 1; i < out.length - 1; i++) {
        const a = kept[kept.length - 1], b = out[i], c = out[i + 1];
        const onLine = a[1] + ((c[1] - a[1]) * (b[0] - a[0])) / (c[0] - a[0]);
        if (Math.abs(onLine - b[1]) >= 1 / 32) kept.push(b);
    }
    kept.push(out[out.length - 1]);
    return kept.every(p => Math.abs(p[1] - kept[0][1]) < 1e-9) ? null : kept;
}

// Height of the top of the wall at x (H for a flat top).
export function topAt(top, x, H) {
    if (!top) return H;
    for (let i = 1; i < top.length; i++) {
        const [x0, h0] = top[i - 1], [x1, h1] = top[i];
        if (x <= x1 + 1e-9 || i === top.length - 1) return h0 + ((h1 - h0) * (Math.min(Math.max(x, x0), x1) - x0)) / (x1 - x0);
    }
    return H;
}
// The lowest top of the wall over [x0, x1].
export const topMin = (top, x0, x1, H) => (top ? Math.min(topAt(top, x0, H), topAt(top, x1, H), ...top.filter(p => p[0] > x0 && p[0] < x1).map(p => p[1])) : H);

// Underside of the top track at x: the top less the track leg, measured square to a sloped track (leg x √(1 + slope²)
// plumb). At a peak or break, the lower of the two runs.
export function underAt(top, x, H, leg) {
    if (!top) return H - leg;
    let u = Infinity;
    for (let i = 1; i < top.length; i++) {
        const [x0, h0] = top[i - 1], [x1, h1] = top[i];
        if (x < x0 - 1e-9 || x > x1 + 1e-9) continue;
        const k = (h1 - h0) / (x1 - x0);
        u = Math.min(u, h0 + k * (x - x0) - leg * Math.hypot(1, k));
    }
    return Number.isFinite(u) ? u : topAt(top, x, H) - leg;
}
// The lowest underside of the top track over [x0, x1].
export const underMin = (top, x0, x1, H, leg) => (top ? Math.min(...[x0, x1, ...top.map(p => p[0]).filter(x => x > x0 && x < x1)].map(x => underAt(top, x, H, leg))) : H - leg);

// Roof-style pitch of a slope (rise per 12" of run, to the nearest 1/8"): 0.375 -> '4 1/2:12'.
export function pitchText(slope) {
    const rise = round8(Math.abs(slope) * 12), whole = Math.floor(rise + 1e-9);
    let n = Math.round((rise - whole) * 8), d = 8;
    while (n && n % 2 === 0) { n /= 2; d /= 2; }
    return `${n ? `${whole ? `${whole} ` : ''}${n}/${d}` : whole}:12`;
}

// Polygons ([x, y] corners, either winding): area, and the area two of them share (at least one convex: the other is
// clipped to it, Sutherland-Hodgman). null when both are concave.
const polyArea = (P) => P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const ccw = (P) => (polyArea(P) < 0 ? [...P].reverse() : P);
function isConvex(P) {
    let sign = 0;
    for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length], c = P[(i + 2) % P.length];
        const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(z) < 1e-9) continue;
        if (sign && Math.sign(z) !== sign) return false;
        sign = Math.sign(z);
    }
    return true;
}
function clipTo(subject, clip) {
    let out = subject;
    for (let i = 0; i < clip.length && out.length; i++) {
        const a = clip[i], b = clip[(i + 1) % clip.length], f = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        const input = out;
        out = [];
        for (let j = 0; j < input.length; j++) {
            const p = input[j], q = input[(j + 1) % input.length], fp = f(p), fq = f(q);
            if (fp >= 0) out.push(p);
            if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
        }
    }
    return out;
}
export function sharedArea(A, B) {
    const a = ccw(A), b = ccw(B);
    if (isConvex(b)) return Math.abs(polyArea(clipTo(a, b)));
    if (isConvex(a)) return Math.abs(polyArea(clipTo(b, a)));
    return null;
}
const cornersOf = (m) => m.pts || [[m.x, m.y], [m.x + m.w, m.y], [m.x + m.w, m.y + m.h], [m.x, m.y + m.h]];

// Seat allowance: studs are cut 1/16" short of the track-to-track height (the CAS CF engine's total seat allowance).
export const SEAT_ALLOWANCE_IN = 1 / 16;

// All members for a wall. Returns { members, cutList, ticks, notes, lifts, … }.
// liftIn: walls taller than this are framed as stacked panels (lifts) of equal height, each with its own
// top and bottom track; Infinity (default) = one-piece studs full height.
// top: a sloped top (a rake or a gable; wallTop): points [x, height]; heightIn is then the highest of them. A sloped
// wall is one lift; its top track is one piece per run of the slope, cut along it.
export function frameWall({ lengthIn, heightIn, openings = [], rows = 1, liftIn = Infinity, top = null, ...panel }) {
    const L = round16(lengthIn), T = wallTop(top, L), H = T ? Math.max(...T.map(p => p[1])) : round16(heightIn);
    const lifts = !T && H > liftIn ? Math.ceil(H / liftIn - 1e-9) : 1;
    const liftH = H / lifts;
    const members = [];
    let first = null;
    for (let i = 0; i < lifts; i++) {
        const y0 = i * liftH;
        const ops = openings.map(o => ({ ...o, bottom: Math.max(0, o.bottom - y0), top: o.through ? liftH : Math.min(liftH, o.top - y0) })).filter(o => o.top - o.bottom > 0); // through the top: whatever its top says
        const p = framePanel({ lengthIn: L, heightIn: liftH, openings: ops, ...panel, top: T });
        first ??= p;
        for (const m of p.members) members.push({ ...m, y: m.y + y0, ...(m.pts ? { pts: m.pts.map(([x, y]) => [x, y + y0]) } : {}), lift: i + 1 });
    }
    const leg = panel.trackLegIn ?? 1.25;
    const ops = clipOpenings(openings, L, H, leg, T);
    const { cutList } = labelMembers(members, rows);
    // Stud layout ticks (left face of each vertical) for the ordinate dimensions and track layout strips.
    const ticks = [...new Set(members.filter(m => m.orient === 'v').map(m => round16(m.x)))].sort((a, b) => a - b);
    const notes = [];
    if (rows > 1) notes.push(`${rows} stud rows: elevation shows one row; quantities are for all rows.`);
    if (lifts > 1) notes.push(`${lifts} lifts of ${fmtFtIn(liftH)}: each lift has its own top and bottom track.`);
    if (T) notes.push('Sloped top: stud lengths are at the long point; cut the stud tops to the slope.');
    const sp = panel.spacingIn ?? 16;
    if (panel.layoutStartIn > 0 && Math.abs(panel.layoutStartIn - sp) > 1e-6) notes.push(`Stud layout: first stud ${fmtFtIn(panel.layoutStartIn)} from the left end (center), then ${sp}" o.c.`);
    const layout = { lengthIn: L, heightIn: H, lifts, openings: ops, members, cutList, ticks, notes, studIn: panel.studIn ?? 3.625,
        studType: first.studType, trackType: first.trackType, spacingIn: first.spacingIn, ...(T ? { top: T, trackLegIn: leg } : {}),
        ...(panel.layoutStartIn > 0 ? { layoutStartIn: panel.layoutStartIn } : {}) };
    layout.issues = checkLayout(layout, { flangeIn: panel.flangeIn ?? 1.625 }); // fail-safe: see checkLayout
    return layout;
}

// Openings clipped to the panel: at least 6" each way, and never into the top track (a scanned gap that runs to the
// top of the wall is an opening up to the underside of the top track; under a sloped top, its lowest point over the
// opening). An opening through the top (o.through: a steel penetration) runs to the top of the wall, its highest point
// over the opening. Other fields (an opening's framing) are kept.
function clipOpenings(openings, L, H, trackLegIn, top = null) {
    return openings.map(o => {
        const left = round16(Math.max(0, o.left)), right = round16(Math.min(L, o.right));
        const upTo = o.through ? (top ? Math.max(topAt(top, left, H), topAt(top, right, H), ...top.filter(p => p[0] > left && p[0] < right).map(p => p[1])) : H)
            : Math.min(top ? Math.floor(underMin(top, left, right, H, trackLegIn) * 16) / 16 : H - trackLegIn, o.top);
        return { ...o, left, right, bottom: round16(Math.max(0, o.bottom)), top: round16(upTo) };
    }).filter(o => o.right - o.left >= 6 && o.top - o.bottom >= 6)
        .sort((a, b) => a.left - b.left);
}

// One panel (a whole wall, or one lift of a tall wall): members without labels.
// Every vertical (end stud, jamb stud, layout stud) is cut around ALL the openings in its bay, with their head and sill
// tracks: it only runs where the wall is solid. Openings stacked in one bay (a door under a high window or a soffit gap)
// get a piece between them, never a stud through either one. checkLayout() verifies the result.
// studName / trackName / topTrackName: the engineer's SSMA members when known (e.g. 600S200-54 on 600T125-54 with a
// 600SLT250-54 slip track at the top); else named from depth and gauge. An opening can carry its own framing,
// o.framing = { head, jamb, sill: [{ qty, name }], source } (the takeoff's criteria): its header, jamb and sill
// members then take the first part's name, and all parts (e.g. a box header of (2) studs WITH (2) tracks) go in
// member.parts for the counts; the geometry stays one member each.
// top: a sloped top (wallTop), H its highest point. Members under it carry their outline as pts ([x, y] corners,
// counter-clockwise) beside their bounding box (x, y, w, h): the top track's sloped runs, and the verticals that reach
// the track (atTop), their tops cut to the slope.
function framePanel({ lengthIn, heightIn, openings = [], studIn = 3.625, spacingIn = 16, mils = 33,
    member = 'stud', flangeIn = 1.625, trackLegIn = 1.25, cutbackIn = SEAT_ALLOWANCE_IN, studName, trackName, topTrackName, top = null, layoutStartIn = null }) {
    const L = round16(lengthIn), H = heightIn, LEG = trackLegIn, T = top;
    const ops = clipOpenings(openings, L, H, LEG, T);
    const studType = studName || memberType(studIn, 'stud', mils, member), trackType = trackName || memberType(studIn, 'track', mils, member);
    const members = [];
    const add = (m) => members.push({ func: FUNC_OF_ROLE[m.role], ...m, lengthIn: floor8(m.lengthIn) });
    const under = (x0, x1) => underMin(T, x0, x1, H, LEG); // the underside of the top track over [x0, x1]
    const reachesTop = (o) => o.through || (T ? o.top >= under(o.left, o.right) - 1 : o.top >= H - LEG - 1);
    // The top track runs everywhere but through the openings that go up through the top.
    const cuts = ops.filter(o => o.through).map(o => [o.left, o.right]);
    const uncut = (a, b) => cuts.reduce((parts, [l, r]) => parts.flatMap(([p, q]) => (r <= p || l >= q ? [[p, q]] : [[p, l], [r, q]].filter(([s, e]) => e - s > 1e-6))), [[a, b]]);

    // Tracks: top full length (under a sloped top, one piece per run, its length along the slope; cut at a steel
    // penetration); bottom broken at door openings.
    for (const [a, b] of T ? [] : uncut(0, L)) add({ role: 'top track', orient: 'h', type: topTrackName || trackType, x: a, y: H - LEG, w: b - a, h: LEG, lengthIn: b - a });
    for (let i = 1; T && i < T.length; i++) {
        const [x0, h0] = T[i - 1], [x1, h1] = T[i], k = (h1 - h0) / (x1 - x0), t = LEG * Math.hypot(1, k), at = (x) => h0 + k * (x - x0);
        for (const [a, b] of uncut(x0, x1)) {
            const ha = at(a), hb = at(b);
            add({ role: 'top track', orient: 'h', type: topTrackName || trackType, x: a, y: Math.min(ha, hb) - t, w: b - a, h: Math.abs(hb - ha) + t,
                lengthIn: Math.hypot(b - a, hb - ha), ...(k ? { pts: [[a, ha - t], [b, hb - t], [b, hb], [a, ha]], slope: k } : {}) });
        }
    }
    let start = 0;
    for (const door of ops.filter(isDoor)) {
        if (door.left - start > 1) add({ role: 'bottom track', orient: 'h', type: trackType, x: start, y: 0, w: door.left - start, h: LEG, lengthIn: door.left - start });
        start = Math.max(start, door.right);
    }
    if (L - start > 1) add({ role: 'bottom track', orient: 'h', type: trackType, x: start, y: 0, w: L - start, h: LEG, lengthIn: L - start });

    // Head track over each opening (none when it runs up to the top track), sill track under each window. They reach
    // one flange past the opening each side (the tabs fastened to the jambs). A sill that would sit on the head track
    // of an opening right below it is left out: that head track carries it.
    // An opening's own framing for a member (see above): { type, parts, src } or nothing.
    const framed = (o, what) => (o.framing?.[what]?.length ? { type: o.framing[what][0].name, parts: o.framing[what], src: o.framing.source } : {});
    const heads = [];
    for (const o of ops) {
        const x0 = Math.max(0, o.left - flangeIn), x1 = Math.min(L, o.right + flangeIn);
        if (!reachesTop(o)) {
            const head = { role: 'head track', func: o.kind === 'mep' ? 'HDM' : isDoor(o) ? 'HDD' : 'HDW', orient: 'h', type: trackType, x: x0, y: o.top, w: x1 - x0, h: LEG, lengthIn: x1 - x0, ...framed(o, 'head') };
            heads.push(head);
            add(head);
        }
    }
    for (const o of ops.filter(o => !isDoor(o))) {
        const x0 = Math.max(0, o.left - flangeIn), x1 = Math.min(L, o.right + flangeIn), y = o.bottom - LEG;
        const onHead = heads.some(h => x1 > h.x && x0 < h.x + h.w && y < h.y + h.h && y + LEG > h.y);
        const func = openingKind(o) === 'mep' ? 'SBM' : openingKind(o) === 'steel' ? 'SBS' : 'SBW';
        if (!onHead && y >= LEG) add({ role: 'sill track', func, orient: 'h', type: trackType, x: x0, y, w: x1 - x0, h: LEG, lengthIn: x1 - x0, ...framed(o, 'sill') });
    }

    // Where a vertical at x can run: between the tracks, minus every opening in its bay with its head and sill track.
    const topOf = (x) => (T ? under(x, x + flangeIn) : H - LEG); // where a vertical at x meets the top track
    const solidAt = (x) => {
        const blocked = ops.filter(o => x + flangeIn > o.left + 0.01 && x < o.right - 0.01)
            .map(o => [isDoor(o) ? 0 : o.bottom - LEG, reachesTop(o) ? H : o.top + LEG])
            .sort((a, b) => a[0] - b[0]);
        const free = [], hi = topOf(x);
        let cur = LEG;
        for (const [a, b] of blocked) {
            if (a > cur) free.push([cur, Math.min(a, hi)]);
            cur = Math.max(cur, b);
        }
        if (cur < hi) free.push([cur, hi]);
        return free.filter(([a, b]) => b - a > 3);
    };
    // Verticals already placed, with their height ranges: a second vertical on (nearly) the same line only fills the
    // heights the first leaves open. (A door's jamb can share its line with the jamb of a window above and beside it.)
    const placed = [];
    const cut = ([a, b], [c, d]) => (d <= a || c >= b ? [[a, b]] : [[a, c], [d, b]].filter(([p, q]) => q - p > 1e-6));
    // A vertical in pieces where it has to be: a full-height piece keeps its role; a piece of a layout stud, or any
    // piece that doesn't stand on the bottom track, is a cripple. Returns true for a full-height vertical, false for
    // pieces, null when there was no room for any.
    const vertical = (x, role, own = {}) => {
        let pieces = solidAt(x);
        for (const p of placed.filter(p => x < p.x1 + 0.5 && x + flangeIn > p.x0 - 0.5)) pieces = pieces.flatMap(r => cut(r, [p.y0, p.y1]));
        pieces = pieces.filter(([a, b]) => b - a > 3);
        if (!pieces.length) return null;
        const hi = topOf(x);
        const full = pieces.length === 1 && pieces[0][0] <= LEG + 1e-6 && pieces[0][1] >= hi - 1e-6;
        for (const [a, b] of pieces) {
            placed.push({ x0: x, x1: x + flangeIn, y0: a, y1: b });
            const r = full ? role : role !== 'stud' && a <= LEG + 1e-6 ? role : 'cripple';
            // Cut lengths as before: a full-height stud is the panel height less the seat allowance (it sits in the tracks);
            // a piece is its track-to-track length less the seat allowance.
            let geo = { y: a, h: b - a }, len = (full ? H : b - a) - cutbackIn;
            if (T && b >= hi - 1e-6) {
                // Up to a sloped top track: the top follows its underside; the length is at the long point.
                const tops = [x + flangeIn, ...T.map(p => p[0]).filter(px => px > x + 1e-6 && px < x + flangeIn - 1e-6).reverse(), x].map(px => [px, underAt(T, px, H, LEG)]);
                const ys = tops.map(p => p[1]), uHi = Math.max(...ys);
                geo = { y: a, h: uHi - a, atTop: true, ...(uHi - Math.min(...ys) > 1e-6 ? { pts: [[x, a], [x + flangeIn, a], ...tops] } : {}) };
                len = (full ? Math.max(topAt(T, x, H), topAt(T, x + flangeIn, H)) : uHi - a) - cutbackIn;
            }
            add({ role: r, orient: 'v', type: studType, x, w: flangeIn, ...geo, lengthIn: len, ...(r === 'jamb stud' ? own : {}) });
        }
        return full;
    };

    // End studs and a jamb stud each side of every opening (only where no vertical within 1/2" already runs).
    const place = (x, role, own) => vertical(Math.min(Math.max(0, x), L - flangeIn), role, own);
    place(0, 'end stud');
    place(L - flangeIn, 'end stud');
    for (const o of ops) {
        place(o.left - flangeIn, 'jamb stud', framed(o, 'jamb'));
        place(o.right, 'jamb stud', framed(o, 'jamb'));
    }

    // Studs on layout (centers at k × spacing from the left end, or from the first stud at layoutStartIn); in an
    // opening's bay they become cripples.
    const first = layoutStartIn > 0 ? layoutStartIn : spacingIn;
    for (let k = 0; first + k * spacingIn < L; k++) {
        const x = first + k * spacingIn - flangeIn / 2;
        if (x + flangeIn > L - flangeIn - 3) break;
        // Skip a layout stud that would land within 3" (clear) of an end or jamb stud.
        if (placed.some(p => x < p.x1 + 3 && x + flangeIn > p.x0 - 3)) continue;
        vertical(x, 'stud');
    }

    return { members, studType, trackType, spacingIn };
}

// Fail-safe check of a layout (pure). Returns [{ code, message }]; an empty list means it passed:
//   no member inside an opening; no stud across a track or another stud (a head or sill track's end tabs over its
//   jambs are fine); every member inside the wall and with a length; every opening with a jamb each side (unless it
//   is at a wall end), a head track (unless it reaches the top track) and, for a window, a sill track.
// Under a sloped top (layout.top), members with an outline (pts) are checked by their outline, and "inside the wall"
// means under the slope.
export function checkLayout(layout, { flangeIn = 1.625 } = {}) {
    const { lengthIn: L, heightIn: H, members, openings } = layout;
    const T = layout.top || null, LEG = layout.trackLegIn ?? 1.25;
    const eps = 1 / 32, issues = [];
    const boxes = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > eps && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > eps;
    const overlap = (a, b) => {
        if (!a.pts && !b.pts) return boxes(a, b);
        if (!boxes(a, b)) return false;
        const shared = sharedArea(cornersOf(a), cornersOf(b));
        return shared == null ? true : shared > eps * eps;
    };
    const outside = (m) => (m.pts ? m.pts.some(([x, y]) => x < -eps || x > L + eps || y < -eps || y > topAt(T, x, H) + eps)
        : m.x < -eps || m.y < -eps || m.x + m.w > L + eps || m.y + m.h > topMin(T, m.x, m.x + m.w, H) + eps);
    const name = (m) => `${m.mark || '?'} (${m.role})`;
    const what = (o) => `${isDoor(o) ? 'door' : 'opening'} at ${fmtFtIn(o.left)} to ${fmtFtIn(o.right)}`;
    const vs = members.filter(m => m.orient === 'v'), hs = members.filter(m => m.orient === 'h');
    for (const m of members) {
        if (!(m.lengthIn > 0) || !(m.w > 0) || !(m.h > 0)) issues.push({ code: 'size', message: `${name(m)} has no length` });
        if (outside(m)) issues.push({ code: 'bounds', message: `${name(m)} is outside the wall` });
        for (const o of openings) {
            if (overlap(m, { x: o.left, y: o.bottom, w: o.right - o.left, h: o.top - o.bottom })) issues.push({ code: 'through-opening', message: `${name(m)} runs through the ${what(o)}` });
        }
    }
    for (const v of vs) {
        for (const h of hs) {
            if (!overlap(v, h)) continue;
            const tab = (h.role === 'head track' || h.role === 'sill track') && (v.x + v.w <= h.x + flangeIn + eps || v.x >= h.x + h.w - flangeIn - eps);
            if (!tab) issues.push({ code: 'crossing', message: `${name(v)} crosses ${name(h)} at ${fmtFtIn(v.x)}` });
        }
    }
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
        if (overlap(vs[i], vs[j])) issues.push({ code: 'overlap', message: `${name(vs[i])} and ${name(vs[j])} overlap at ${fmtFtIn(vs[i].x)}` });
    }
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
        if (overlap(hs[i], hs[j])) issues.push({ code: 'overlap', message: `${name(hs[i])} and ${name(hs[j])} overlap` });
    }
    const near = (a, b) => Math.abs(a - b) <= 1 / 8;
    const nearJamb = (a, b) => Math.abs(a - b) <= 0.5 + 1 / 16; // an end stud within 1/2" of the opening serves as its jamb (shimmed)
    for (const o of openings) {
        const beside = (v, x) => nearJamb(x, v.x) && v.y < o.top && v.y + v.h > o.bottom;
        // Say how much wall there is between the opening and the nearest stud on that side: usually less than a stud.
        const gapTo = (side) => {
            const along = vs.filter(v => v.y < o.top && v.y + v.h > o.bottom);
            const gaps = side === 'left' ? along.filter(v => v.x + v.w <= o.left + eps).map(v => o.left - (v.x + v.w)) : along.filter(v => v.x >= o.right - eps).map(v => v.x - o.right);
            return gaps.length ? Math.min(...gaps) : null;
        };
        const noJamb = (side) => {
            const gap = gapTo(side);
            return { code: 'no-jamb', message: `No jamb stud on the ${side} of the ${what(o)}`
                + (gap != null && gap < flangeIn ? `: only ${fmtFtIn(gap)} to the next stud, less than a stud; shift or shim the rough opening` : '') };
        };
        if (o.left >= flangeIn && !vs.some(v => beside(v, o.left - v.w))) issues.push(noJamb('left'));
        if (o.right <= L - flangeIn && !vs.some(v => beside(v, o.right))) issues.push(noJamb('right'));
        const spans = (h) => h.x <= o.left + eps && h.x + h.w >= o.right - eps;
        const topTrack = hs.find(h => h.role === 'top track');
        const atTop = T ? o.top >= underMin(T, o.left, o.right, H, LEG) - 1 : topTrack && o.top >= topTrack.y - 1;
        if (!atTop && !hs.some(h => near(h.y, o.top) && spans(h))) issues.push({ code: 'no-head', message: `No head track over the ${what(o)}` });
        if (!isDoor(o) && !hs.some(h => near(h.y + h.h, o.bottom) && spans(h))) issues.push({ code: 'no-sill', message: `No sill track under the ${what(o)}` });
    }
    return issues;
}

// CAS labels: C for vertical, T for horizontal; one label per type + rounded length; numbered by length.
// A built-up member (member.parts: a box header of (2) studs WITH (1) track, a double jamb) counts each part in the cut
// list: its quantity under the part's own label. The member is tagged with its first part's label (mark); with more
// than one part, marks lists them all.
function labelMembers(members, rows) {
    const groups = new Map();
    for (const m of members) {
        const parts = m.parts?.length ? m.parts : [{ name: m.type, qty: 1 }];
        parts.forEach((p, i) => {
            const key = `${m.orient === 'v' ? 'C' : 'T'}|${p.name}|${m.lengthIn}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ m, qty: p.qty || 1, part: i });
        });
    }
    const keys = [...groups.keys()].sort((a, b) => {
        const [pa, ta, la] = a.split('|'), [pb, tb, lb] = b.split('|');
        return pa.localeCompare(pb) || ta.localeCompare(tb) || Number(lb) - Number(la);
    });
    const counters = { C: 0, T: 0 };
    const cutList = [];
    for (const key of keys) {
        const [prefix, type, len] = key.split('|');
        const mark = `${prefix}${counters[prefix]++}`;
        const list = groups.get(key);
        for (const e of list) {
            if (e.part === 0) e.m.mark = mark;
            if (e.m.parts?.length > 1) (e.m.marks ||= [])[e.part] = mark;
        }
        const roles = [...new Set(list.map(e => e.m.role))].join(', ');
        const func = [...new Set(list.map(e => e.m.func))].join('/');
        cutList.push({ mark, qty: list.reduce((n, e) => n + e.qty, 0) * rows, type, lengthIn: Number(len), roles, func });
    }
    cutList.sort((a, b) => a.mark[0].localeCompare(b.mark[0]) || Number(a.mark.slice(1)) - Number(b.mark.slice(1)));
    return { cutList };
}
