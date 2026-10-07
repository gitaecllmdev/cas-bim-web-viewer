// Panel shipping plan (pure; tested in tests/shipper.test.js): the framed panels of the shop drawings (Demo 6), in
// delivery batches (one per floor, in the order the floors are built) on 48 ft flatbed trailers, laid flat in
// stacks (panel length along the deck, its height across, its stud depth up). A concept for planning loads, not a
// load engineering tool: framing steel only (no board), the trailer's deck and limits below.
export const TRAILER = { name: '48 ft flatbed', lengthIn: 48 * 12, widthIn: 102, stackIn: 96, maxLb: 45000, deckIn: 60, gapIn: 6 };
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

// A panel's framing weight (lb) from its cut list.
export function panelWeight(layout) {
    return (layout?.cutList || []).reduce((sum, r) => sum + r.qty * (r.lengthIn / 12) * memberLbPerFt(r.type), 0);
}

// Batches: panels grouped by floor, floors in levelOrder (bottom to top), then any others by name.
// panels: [{ key, mark, level, lengthIn, heightIn, thickIn, weightLb, ... }]. needBy: { level: 'YYYY-MM-DD' } (optional).
export function planBatches(panels, { levelOrder = [], needBy = {}, trailer = TRAILER } = {}) {
    const levels = [...new Set(panels.map(p => p.level || 'No level'))]
        .sort((a, b) => rank(levelOrder, a) - rank(levelOrder, b) || a.localeCompare(b, undefined, { numeric: true }));
    let truckNo = 0;
    return levels.map((level, i) => {
        const trucks = planTrucks(panels.filter(p => (p.level || 'No level') === level), trailer);
        for (const t of trucks) t.no = ++truckNo;
        return { id: `B${i + 1}`, no: i + 1, level, needBy: needBy[level] || '', trucks,
            panels: trucks.reduce((n, t) => n + t.panels, 0), weightLb: trucks.reduce((n, t) => n + t.weightLb, 0) };
    });
}
const rank = (order, level) => { const i = order.indexOf(level); return i < 0 ? order.length : i; };

// Trucks for one batch: longest panels first; a panel goes on top of a stack whose footprint covers it (no
// overhang beyond the panel under it) while the stack stays under the height limit and the truck under its weight,
// else it starts a new stack behind the last one (a new truck when the deck is full). A panel longer than the deck
// gets a truck of its own, flagged.
export function planTrucks(panels, trailer = TRAILER) {
    const trucks = [];
    const sorted = [...panels].sort((a, b) => b.lengthIn - a.lengthIn || b.heightIn - a.heightIn || String(a.mark).localeCompare(String(b.mark)));
    for (const p of sorted) {
        const thick = p.thickIn + 0.5; // with dunnage
        let placed = false;
        for (const t of trucks) {
            if (t.over || t.weightLb + p.weightLb > trailer.maxLb) continue;
            const s = t.stacks.find(s => p.lengthIn <= s.lengthIn + 0.01 && p.heightIn <= s.widthIn + 0.01 && s.heightIn + thick <= trailer.stackIn);
            if (!s) continue;
            s.panels.push({ ...p, z: s.heightIn });
            s.heightIn += thick;
            t.weightLb += p.weightLb;
            t.panels++;
            placed = true;
            break;
        }
        if (placed) continue;
        const over = p.lengthIn > trailer.lengthIn;
        let t = over ? null : trucks.find(t => !t.over && t.lengthIn + p.lengthIn <= trailer.lengthIn && t.weightLb + p.weightLb <= trailer.maxLb);
        if (!t) { t = { stacks: [], lengthIn: 0, weightLb: 0, panels: 0, over }; trucks.push(t); }
        t.stacks.push({ x: t.lengthIn, lengthIn: p.lengthIn, widthIn: p.heightIn, heightIn: thick, panels: [{ ...p, z: 0 }] });
        t.lengthIn += p.lengthIn + trailer.gapIn;
        t.weightLb += p.weightLb;
        t.panels++;
    }
    for (const t of trucks) {
        t.lengthIn = Math.max(0, t.lengthIn - trailer.gapIn); // no gap after the last stack
        t.wide = t.stacks.some(s => s.widthIn > trailer.widthIn);
        t.tall = Math.max(0, ...t.stacks.map(s => s.heightIn));
    }
    return trucks;
}
