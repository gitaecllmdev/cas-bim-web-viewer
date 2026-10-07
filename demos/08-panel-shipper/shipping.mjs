// Panel shipping (pure; tested in tests/shipper.test.js): one floor's framed panels packed on trucks as tightly as
// they go, the order to load them, and what each truck carries against what its trailer can. Panels lie flat: length
// along the deck, height across it, stud depth up (plus dunnage). On a truck, a panel goes on top of a stack whose
// footprint covers it, else beside the stacks of a row while the deck's width allows (narrow panels side by side),
// else in a new row behind; within the trailer's length, stack height and weight. A concept for planning loads, not
// load engineering: framing steel only (no board).
export const TRAILERS = {
    flat48: { name: "48' flatbed", lengthIn: 576, widthIn: 102, stackIn: 102, maxLb: 48000, deckIn: 60 },
    flat53: { name: "53' flatbed", lengthIn: 636, widthIn: 102, stackIn: 102, maxLb: 48000, deckIn: 60 },
    step48: { name: "48' step deck", lengthIn: 576, widthIn: 102, stackIn: 120, maxLb: 48000, deckIn: 42 },
    flat40: { name: "40' flatbed", lengthIn: 480, widthIn: 102, stackIn: 102, maxLb: 40000, deckIn: 60 },
};
export const PERMIT_WIDTH_IN = 168; // a panel over 14 ft across cannot ship flat
const GAP_IN = 6, DUNNAGE_IN = 0.5;
const STEEL_LB_PER_IN3 = 0.2836; // 490 lb/ft3

// Weight of a CFS member per foot from its SSMA designation ("362S162-33": web 3.62", flange 1.62", 33 mils): the
// developed width (web + flanges + lips) x the design thickness x steel. Unknown designations: 1 lb/ft.
export function memberLbPerFt(type) {
    const m = /^(\d{3})([STUF])(\d{3})-(\d{2,3})$/.exec(String(type || '').trim());
    if (!m) return 1;
    const web = Number(m[1]) / 100, flange = Number(m[3]) / 100, t = (Number(m[4]) / 1000) * 1.05;
    const lip = m[2] === 'S' ? (flange >= 2 ? 0.625 : 0.5) : 0;
    return (web + 2 * flange + 2 * lip) * t * 12 * STEEL_LB_PER_IN3;
}

// A panel's framing weight (lb) and its studs (members of an S designation) from its cut list.
export const panelWeight = (layout) => (layout?.cutList || []).reduce((sum, r) => sum + r.qty * (r.lengthIn / 12) * memberLbPerFt(r.type), 0);
export const studCount = (layout) => (layout?.cutList || []).filter(r => /^\d{3}S\d{3}-/.test(String(r.type || ''))).reduce((n, r) => n + r.qty, 0);

// Can it go on any truck? (Longer than the trailer, or too wide to ship flat: no.)
export const shippable = (p, trailer) => p.lengthIn <= trailer.lengthIn && p.heightIn <= PERMIT_WIDTH_IN;

const order = (a, b) => b.lengthIn - a.lengthIn || b.heightIn - a.heightIn || String(a.mark).localeCompare(String(b.mark));

export function emptyTruck(trailer = TRAILERS.flat48) {
    return { trailer, rows: [], lengthIn: 0, weightLb: 0, panels: 0, studs: 0, overflow: [], placed: [] }; // placed: keys in the order they went on
}

// Puts a panel on the truck if it fits (see above); true when it did.
export function place(t, p) {
    const tr = t.trailer, thick = p.thickIn + DUNNAGE_IN;
    if (!shippable(p, tr) || t.weightLb + p.weightLb > tr.maxLb) return false;
    const add = (stack) => { stack.panels.push({ ...p, z: stack.heightIn }); stack.heightIn += thick; t.weightLb += p.weightLb; t.panels++; t.studs += p.studs || 0; t.placed.push(p.key); return true; };
    for (const r of t.rows) for (const s of r.stacks) {
        if (p.lengthIn <= s.lengthIn + 0.01 && p.heightIn <= s.widthIn + 0.01 && s.heightIn + thick <= tr.stackIn) return add(s);
    }
    if (thick > tr.stackIn) return false;
    for (const r of t.rows) {
        if (p.lengthIn <= r.lengthIn + 0.01 && r.widthUsed + p.heightIn <= tr.widthIn + 0.01) {
            const s = { x: r.x, y: r.widthUsed, lengthIn: p.lengthIn, widthIn: p.heightIn, heightIn: 0, panels: [] };
            r.stacks.push(s);
            r.widthUsed += p.heightIn;
            return add(s);
        }
    }
    const x = t.rows.length ? t.lengthIn + GAP_IN : 0;
    if (x + p.lengthIn > tr.lengthIn) return false;
    const s = { x, y: 0, lengthIn: p.lengthIn, widthIn: p.heightIn, heightIn: 0, panels: [] };
    t.rows.push({ x, lengthIn: p.lengthIn, widthUsed: p.heightIn, stacks: [s] });
    t.lengthIn = x + p.lengthIn;
    return add(s);
}

// One truck loaded with these panels, largest first (or in the order given, keepOrder: the same load again, a panel
// added by hand going where it went); what does not fit is left in overflow.
export function packTruck(panels, trailer = TRAILERS.flat48, { keepOrder = false } = {}) {
    const t = emptyTruck(trailer);
    for (const p of keepOrder ? panels : [...panels].sort(order)) if (!place(t, p)) t.overflow.push(p);
    return t;
}

// A floor's panels on as few trucks as they go: each panel (largest first) on the first truck it fits, else a new one.
// Returns { trucks, unshippable }.
export function autoPack(panels, trailer = TRAILERS.flat48) {
    const trucks = [], unshippable = [];
    for (const p of [...panels].sort(order)) {
        if (!shippable(p, trailer)) { unshippable.push(p); continue; }
        if (trucks.some(t => place(t, p))) continue;
        const t = emptyTruck(trailer);
        trucks.push(t);
        place(t, p);
    }
    return { trucks, unshippable };
}

// More panels onto a truck: from these (largest first), every one that still fits. Returns those placed.
export function fill(t, panels) {
    const placed = [];
    for (const p of [...panels].sort(order)) if (place(t, p)) placed.push(p);
    return placed;
}

// The order to load: rows front to back (the cab end first), stacks across from the driver's side, each bottom to top.
// Unloading is the reverse. [{ n, panel, row, lane, level, stack }]
export function loadSequence(t) {
    const out = [];
    t.rows.forEach((r, ri) => r.stacks.forEach((s, li) => s.panels.forEach((p, k) => out.push({ n: out.length + 1, panel: p, row: ri + 1, lane: li + 1, level: k + 1, stack: s }))));
    return out;
}

// What the truck carries against what its trailer can (0-1, over 1 when overloaded): deck length, weight, stack height;
// and flags.
export function capacity(t) {
    const tr = t.trailer, tall = Math.max(0, ...t.rows.flatMap(r => r.stacks.map(s => s.heightIn)));
    return { deck: t.lengthIn / tr.lengthIn, weight: t.weightLb / tr.maxLb, height: tall / tr.stackIn, tallIn: tall,
        wide: t.rows.some(r => r.widthUsed > tr.widthIn), full: !!t.overflow.length };
}
