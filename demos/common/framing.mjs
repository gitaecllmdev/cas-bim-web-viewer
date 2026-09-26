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
    const ops = openings.map(o => ({ left: round16(Math.max(0, o.left)), right: round16(Math.min(L, o.right)), bottom: round16(Math.max(0, o.bottom)), top: round16(Math.min(H, o.top)) }))
        .filter(o => o.right - o.left >= 6 && o.top - o.bottom >= 6).sort((a, b) => a.left - b.left);
    const { cutList } = labelMembers(members, rows);
    // Stud layout ticks (left face of each vertical) for the ordinate dimensions and track layout strips.
    const ticks = [...new Set(members.filter(m => m.orient === 'v').map(m => round16(m.x)))].sort((a, b) => a - b);
    const notes = [];
    if (rows > 1) notes.push(`${rows} stud rows: elevation shows one row; quantities are for all rows.`);
    if (lifts > 1) notes.push(`${lifts} lifts of ${fmtFtIn(liftH)}: each lift has its own top and bottom track.`);
    return { lengthIn: L, heightIn: H, lifts, openings: ops, members, cutList, ticks, notes,
        studType: first.studType, trackType: first.trackType, spacingIn: first.spacingIn };
}

// One panel (a whole wall, or one lift of a tall wall): members without labels.
function framePanel({ lengthIn, heightIn, openings = [], studIn = 3.625, spacingIn = 16, mils = 33,
    member = 'stud', flangeIn = 1.625, trackLegIn = 1.25, cutbackIn = SEAT_ALLOWANCE_IN }) {
    const L = round16(lengthIn), H = heightIn;
    const ops = openings.map(o => ({ left: round16(Math.max(0, o.left)), right: round16(Math.min(L, o.right)), bottom: round16(Math.max(0, o.bottom)), top: round16(Math.min(H, o.top)) }))
        .filter(o => o.right - o.left >= 6 && o.top - o.bottom >= 6)
        .sort((a, b) => a.left - b.left);
    const studType = memberType(studIn, 'stud', mils, member), trackType = memberType(studIn, 'track', mils, member);
    const members = [];
    const add = (m) => members.push({ ...m, lengthIn: floor8(m.lengthIn) });
    const studLen = (bottom, top) => top - bottom - cutbackIn; // studs are cut short of the track-to-track height

    // Tracks: top full length; bottom broken at door openings.
    add({ role: 'top track', orient: 'h', type: trackType, x: 0, y: H - trackLegIn, w: L, h: trackLegIn, lengthIn: L });
    let start = 0;
    for (const door of ops.filter(isDoor)) {
        if (door.left - start > 1) add({ role: 'bottom track', orient: 'h', type: trackType, x: start, y: 0, w: door.left - start, h: trackLegIn, lengthIn: door.left - start });
        start = door.right;
    }
    if (L - start > 1) add({ role: 'bottom track', orient: 'h', type: trackType, x: start, y: 0, w: L - start, h: trackLegIn, lengthIn: L - start });

    // Full-height verticals: end studs and a jamb stud on each side of every opening.
    const full = (x, role) => add({ role, orient: 'v', type: studType, x, y: trackLegIn, w: flangeIn, h: H - 2 * trackLegIn, lengthIn: studLen(0, H) });
    const taken = []; // x ranges already holding a vertical
    const place = (x, role) => {
        x = Math.min(Math.max(0, x), L - flangeIn);
        if (taken.some(([a, b]) => x < b + 0.5 && x + flangeIn > a - 0.5)) return;
        taken.push([x, x + flangeIn]);
        full(x, role);
    };
    place(0, 'end stud');
    place(L - flangeIn, 'end stud');
    for (const o of ops) {
        place(o.left - flangeIn, 'jamb stud');
        place(o.right, 'jamb stud');
        // Head track over the opening; sill track under a window. Kept within the wall ends; no head track when the
        // opening runs up to the top track.
        const x0 = Math.max(0, o.left - flangeIn), x1 = Math.min(L, o.right + flangeIn);
        if (o.top < H - trackLegIn - 1) add({ role: 'head track', orient: 'h', type: trackType, x: x0, y: o.top, w: x1 - x0, h: trackLegIn, lengthIn: x1 - x0 });
        if (!isDoor(o)) add({ role: 'sill track', orient: 'h', type: trackType, x: x0, y: o.bottom - trackLegIn, w: x1 - x0, h: trackLegIn, lengthIn: x1 - x0 });
    }

    // Studs on layout (centers at k × spacing from the left end); inside an opening they become cripples.
    for (let k = 1; k * spacingIn < L; k++) {
        const x = k * spacingIn - flangeIn / 2;
        if (x + flangeIn > L - flangeIn - 3) break;
        // Skip a layout stud that would land within 3" (clear) of an end or jamb stud.
        if (taken.some(([a, b]) => x < b + 3 && x + flangeIn > a - 3)) continue;
        const opening = ops.find(o => x + flangeIn > o.left - flangeIn && x < o.right + flangeIn);
        if (!opening) { taken.push([x, x + flangeIn]); full(x, 'stud'); continue; }
        const above = [opening.top + trackLegIn, H - trackLegIn];
        if (above[1] - above[0] > 3) add({ role: 'cripple', orient: 'v', type: studType, x, y: above[0], w: flangeIn, h: above[1] - above[0], lengthIn: above[1] - above[0] - cutbackIn });
        if (!isDoor(opening)) {
            const below = [trackLegIn, opening.bottom - trackLegIn];
            if (below[1] - below[0] > 3) add({ role: 'cripple', orient: 'v', type: studType, x, y: below[0], w: flangeIn, h: below[1] - below[0], lengthIn: below[1] - below[0] - cutbackIn });
        }
    }

    return { members, studType, trackType, spacingIn };
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
        cutList.push({ mark, qty: list.length * rows, type, lengthIn: Number(len), roles });
    }
    cutList.sort((a, b) => a.mark[0].localeCompare(b.mark[0]) || Number(a.mark.slice(1)) - Number(b.mark.slice(1)));
    return { cutList };
}
