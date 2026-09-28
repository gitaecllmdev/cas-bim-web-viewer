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
    EV: 'END STUD', SV: 'STUD', SD: 'JAMB STUD', CR: 'CRIPPLE STUD',
};
const FUNC_OF_ROLE = { 'top track': 'TTOP', 'bottom track': 'TBOT', 'sill track': 'SBW', 'end stud': 'EV', stud: 'SV', 'jamb stud': 'SD', cripple: 'CR' };

// The same panel seen from its other face (side B): mirrored left to right, labels unchanged. Ordinates on the
// sheet then run from the other end. Pure: returns a new layout.
export function flipLayout(layout) {
    const L = layout.lengthIn;
    return {
        ...layout, flipped: !layout.flipped,
        members: layout.members.map(m => ({ ...m, x: round16(L - m.x - m.w) })),
        openings: layout.openings.map(o => ({ ...o, left: round16(L - o.right), right: round16(L - o.left) })).sort((a, b) => a.left - b.left),
        ticks: [...new Set(layout.members.filter(m => m.orient === 'v').map(m => round16(L - m.x - m.w)))].sort((a, b) => a - b),
    };
}

// Seat allowance: studs are cut 1/16" short of the track-to-track height (the CAS CF engine's total seat allowance).
export const SEAT_ALLOWANCE_IN = 1 / 16;

// All members for a wall. Returns { members, cutList, ticks, notes, lifts, … }.
// liftIn: walls taller than this are framed as stacked panels (lifts) of equal height, each with its own
// top and bottom track; Infinity (default) = one-piece studs full height.
export function frameWall({ lengthIn, heightIn, openings = [], rows = 1, liftIn = Infinity, ...panel }) {
    const L = round16(lengthIn), H = round16(heightIn);
    const lifts = H > liftIn ? Math.ceil(H / liftIn - 1e-9) : 1;
    const liftH = H / lifts;
    const members = [];
    let first = null;
    for (let i = 0; i < lifts; i++) {
        const y0 = i * liftH;
        const ops = openings.map(o => ({ ...o, bottom: Math.max(0, o.bottom - y0), top: Math.min(liftH, o.top - y0) })).filter(o => o.top - o.bottom > 0);
        const p = framePanel({ lengthIn: L, heightIn: liftH, openings: ops, ...panel });
        first ??= p;
        for (const m of p.members) members.push({ ...m, y: m.y + y0, lift: i + 1 });
    }
    const ops = clipOpenings(openings, L, H, panel.trackLegIn ?? 1.25);
    const { cutList } = labelMembers(members, rows);
    // Stud layout ticks (left face of each vertical) for the ordinate dimensions and track layout strips.
    const ticks = [...new Set(members.filter(m => m.orient === 'v').map(m => round16(m.x)))].sort((a, b) => a - b);
    const notes = [];
    if (rows > 1) notes.push(`${rows} stud rows: elevation shows one row; quantities are for all rows.`);
    if (lifts > 1) notes.push(`${lifts} lifts of ${fmtFtIn(liftH)}: each lift has its own top and bottom track.`);
    const layout = { lengthIn: L, heightIn: H, lifts, openings: ops, members, cutList, ticks, notes, studIn: panel.studIn ?? 3.625,
        studType: first.studType, trackType: first.trackType, spacingIn: first.spacingIn };
    layout.issues = checkLayout(layout, { flangeIn: panel.flangeIn ?? 1.625 }); // fail-safe: see checkLayout
    return layout;
}

// Openings clipped to the panel: at least 6" each way, and never into the top track (a scanned gap that runs to the
// top of the wall is an opening up to the underside of the top track).
function clipOpenings(openings, L, H, trackLegIn) {
    return openings.map(o => ({ left: round16(Math.max(0, o.left)), right: round16(Math.min(L, o.right)), bottom: round16(Math.max(0, o.bottom)), top: round16(Math.min(H - trackLegIn, o.top)) }))
        .filter(o => o.right - o.left >= 6 && o.top - o.bottom >= 6)
        .sort((a, b) => a.left - b.left);
}

// One panel (a whole wall, or one lift of a tall wall): members without labels.
// Every vertical (end stud, jamb stud, layout stud) is cut around ALL the openings in its bay, with their head and sill
// tracks: it only runs where the wall is solid. Openings stacked in one bay (a door under a high window or a soffit gap)
// get a piece between them, never a stud through either one. checkLayout() verifies the result.
// studName / trackName / topTrackName: the engineer's SSMA members when known (e.g. 600S200-54 on 600T125-54 with a
// 600SLT250-54 slip track at the top); else named from depth and gauge.
function framePanel({ lengthIn, heightIn, openings = [], studIn = 3.625, spacingIn = 16, mils = 33,
    member = 'stud', flangeIn = 1.625, trackLegIn = 1.25, cutbackIn = SEAT_ALLOWANCE_IN, studName, trackName, topTrackName }) {
    const L = round16(lengthIn), H = heightIn, LEG = trackLegIn;
    const ops = clipOpenings(openings, L, H, LEG);
    const studType = studName || memberType(studIn, 'stud', mils, member), trackType = trackName || memberType(studIn, 'track', mils, member);
    const members = [];
    const add = (m) => members.push({ func: FUNC_OF_ROLE[m.role], ...m, lengthIn: floor8(m.lengthIn) });
    const reachesTop = (o) => o.top >= H - LEG - 1;

    // Tracks: top full length; bottom broken at door openings.
    add({ role: 'top track', orient: 'h', type: topTrackName || trackType, x: 0, y: H - LEG, w: L, h: LEG, lengthIn: L });
    let start = 0;
    for (const door of ops.filter(isDoor)) {
        if (door.left - start > 1) add({ role: 'bottom track', orient: 'h', type: trackType, x: start, y: 0, w: door.left - start, h: LEG, lengthIn: door.left - start });
        start = Math.max(start, door.right);
    }
    if (L - start > 1) add({ role: 'bottom track', orient: 'h', type: trackType, x: start, y: 0, w: L - start, h: LEG, lengthIn: L - start });

    // Head track over each opening (none when it runs up to the top track), sill track under each window. They reach
    // one flange past the opening each side (the tabs fastened to the jambs). A sill that would sit on the head track
    // of an opening right below it is left out: that head track carries it.
    const heads = [];
    for (const o of ops) {
        const x0 = Math.max(0, o.left - flangeIn), x1 = Math.min(L, o.right + flangeIn);
        if (!reachesTop(o)) {
            const head = { role: 'head track', func: isDoor(o) ? 'HDD' : 'HDW', orient: 'h', type: trackType, x: x0, y: o.top, w: x1 - x0, h: LEG, lengthIn: x1 - x0 };
            heads.push(head);
            add(head);
        }
    }
    for (const o of ops.filter(o => !isDoor(o))) {
        const x0 = Math.max(0, o.left - flangeIn), x1 = Math.min(L, o.right + flangeIn), y = o.bottom - LEG;
        const onHead = heads.some(h => x1 > h.x && x0 < h.x + h.w && y < h.y + h.h && y + LEG > h.y);
        if (!onHead && y >= LEG) add({ role: 'sill track', orient: 'h', type: trackType, x: x0, y, w: x1 - x0, h: LEG, lengthIn: x1 - x0 });
    }

    // Where a vertical at x can run: between the tracks, minus every opening in its bay with its head and sill track.
    const solidAt = (x) => {
        const blocked = ops.filter(o => x + flangeIn > o.left + 0.01 && x < o.right - 0.01)
            .map(o => [isDoor(o) ? 0 : o.bottom - LEG, reachesTop(o) ? H : o.top + LEG])
            .sort((a, b) => a[0] - b[0]);
        const free = [];
        let cur = LEG;
        for (const [a, b] of blocked) {
            if (a > cur) free.push([cur, Math.min(a, H - LEG)]);
            cur = Math.max(cur, b);
        }
        if (cur < H - LEG) free.push([cur, H - LEG]);
        return free.filter(([a, b]) => b - a > 3);
    };
    // Verticals already placed, with their height ranges: a second vertical on (nearly) the same line only fills the
    // heights the first leaves open. (A door's jamb can share its line with the jamb of a window above and beside it.)
    const placed = [];
    const cut = ([a, b], [c, d]) => (d <= a || c >= b ? [[a, b]] : [[a, c], [d, b]].filter(([p, q]) => q - p > 1e-6));
    // A vertical in pieces where it has to be: a full-height piece keeps its role; a piece of a layout stud, or any
    // piece that doesn't stand on the bottom track, is a cripple. Returns true for a full-height vertical, false for
    // pieces, null when there was no room for any.
    const vertical = (x, role) => {
        let pieces = solidAt(x);
        for (const p of placed.filter(p => x < p.x1 + 0.5 && x + flangeIn > p.x0 - 0.5)) pieces = pieces.flatMap(r => cut(r, [p.y0, p.y1]));
        pieces = pieces.filter(([a, b]) => b - a > 3);
        if (!pieces.length) return null;
        const full = pieces.length === 1 && pieces[0][0] <= LEG + 1e-6 && pieces[0][1] >= H - LEG - 1e-6;
        for (const [a, b] of pieces) {
            placed.push({ x0: x, x1: x + flangeIn, y0: a, y1: b });
            const r = full ? role : role !== 'stud' && a <= LEG + 1e-6 ? role : 'cripple';
            // Cut lengths as before: a full-height stud is the panel height less the seat allowance (it sits in the tracks);
            // a piece is its track-to-track length less the seat allowance.
            add({ role: r, orient: 'v', type: studType, x, y: a, w: flangeIn, h: b - a, lengthIn: (full ? H : b - a) - cutbackIn });
        }
        return full;
    };

    // End studs and a jamb stud each side of every opening (only where no vertical within 1/2" already runs).
    const place = (x, role) => vertical(Math.min(Math.max(0, x), L - flangeIn), role);
    place(0, 'end stud');
    place(L - flangeIn, 'end stud');
    for (const o of ops) {
        place(o.left - flangeIn, 'jamb stud');
        place(o.right, 'jamb stud');
    }

    // Studs on layout (centers at k × spacing from the left end); in an opening's bay they become cripples.
    for (let k = 1; k * spacingIn < L; k++) {
        const x = k * spacingIn - flangeIn / 2;
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
export function checkLayout(layout, { flangeIn = 1.625 } = {}) {
    const { lengthIn: L, heightIn: H, members, openings } = layout;
    const eps = 1 / 32, issues = [];
    const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > eps && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > eps;
    const name = (m) => `${m.mark || '?'} (${m.role})`;
    const what = (o) => `${isDoor(o) ? 'door' : 'opening'} at ${fmtFtIn(o.left)} to ${fmtFtIn(o.right)}`;
    const vs = members.filter(m => m.orient === 'v'), hs = members.filter(m => m.orient === 'h');
    for (const m of members) {
        if (!(m.lengthIn > 0) || !(m.w > 0) || !(m.h > 0)) issues.push({ code: 'size', message: `${name(m)} has no length` });
        if (m.x < -eps || m.y < -eps || m.x + m.w > L + eps || m.y + m.h > H + eps) issues.push({ code: 'bounds', message: `${name(m)} is outside the wall` });
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
        const atTop = topTrack && o.top >= topTrack.y - 1;
        if (!atTop && !hs.some(h => near(h.y, o.top) && spans(h))) issues.push({ code: 'no-head', message: `No head track over the ${what(o)}` });
        if (!isDoor(o) && !hs.some(h => near(h.y + h.h, o.bottom) && spans(h))) issues.push({ code: 'no-sill', message: `No sill track under the ${what(o)}` });
    }
    return issues;
}

// CAS labels: C for vertical, T for horizontal; one label per type + rounded length; numbered by length.
function labelMembers(members, rows) {
    const groups = new Map();
    for (const m of members) {
        const key = `${m.orient === 'v' ? 'C' : 'T'}|${m.type}|${m.lengthIn}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(m);
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
        list.forEach(m => { m.mark = mark; });
        const roles = [...new Set(list.map(m => m.role))].join(', ');
        const func = [...new Set(list.map(m => m.func))].join('/');
        cutList.push({ mark, qty: list.length * rows, type, lengthIn: Number(len), roles, func });
    }
    cutList.sort((a, b) => a.mark[0].localeCompare(b.mark[0]) || Number(a.mark.slice(1)) - Number(b.mark.slice(1)));
    return { cutList };
}
