// The set's cut list and a stock-length plan for buying and cutting: every panel's pieces (its cut list: one row per
// member type and cut length, built-up members by their parts) gathered by member type, then fitted into stock lengths:
// best fit, longest piece first, into bars of the longest stock; each bar then bought at the shortest stock length that
// holds it. The saw kerf is taken between cuts. A piece longer than every stock length is ordered cut to length.
// Pure: panels' cut lists in, plans out; lengths in inches. Purchasing aid, not an engineering output.
import { fmtFtIn } from '../common/framing.mjs';

export const DEFAULT_STOCK_IN = [120, 144, 168, 192, 240]; // 10', 12', 14', 16', 20'
export const DEFAULT_KERF_IN = 0.125;
const r4 = (v) => Math.round(v * 10000) / 10000;

// items: [{ panel: its mark, cutList: [{ mark, qty, type, lengthIn, func }] }] -> one row per type and length, with
// where each comes from: [{ type, lengthIn, qty, uses: [{ panel, mark, qty }] }], by type then longest first.
export function setCutList(items) {
    const rows = new Map();
    for (const it of items) for (const c of it.cutList || []) {
        if (!(c.qty > 0) || !(c.lengthIn > 0) || !c.type) continue;
        const k = `${c.type}|${r4(c.lengthIn)}`, row = rows.get(k) || rows.set(k, { type: c.type, lengthIn: r4(c.lengthIn), qty: 0, uses: [] }).get(k);
        row.qty += c.qty;
        row.uses.push({ panel: it.panel, mark: c.mark, qty: c.qty });
    }
    return [...rows.values()].sort((a, b) => a.type.localeCompare(b.type) || b.lengthIn - a.lengthIn);
}

// The stock plan: { types: [{ type, pieces, cutIn, bars: [{ stockIn, cuts: [{ lengthIn, panel, mark }], usedIn, wasteIn }],
// long: [{ lengthIn, panel, mark }], buy: [{ stockIn, count }], orderedIn, wasteIn, wastePct }], totals: { pieces, cutIn,
// orderedIn, wasteIn, wastePct, bars }, stockIn, kerfIn }.
export function nestStock(items, { stockIn = DEFAULT_STOCK_IN, kerfIn = DEFAULT_KERF_IN } = {}) {
    const stocks = [...new Set(stockIn.map(Number).filter(v => v > 0))].sort((a, b) => a - b), kerf = Math.max(0, Number(kerfIn) || 0);
    if (!stocks.length) throw new Error('Give at least one stock length.');
    const maxS = stocks[stocks.length - 1], byType = new Map();
    for (const row of setCutList(items)) for (const u of row.uses) for (let k = 0; k < u.qty; k++) {
        (byType.get(row.type) || byType.set(row.type, []).get(row.type)).push({ lengthIn: row.lengthIn, panel: u.panel, mark: u.mark });
    }
    const types = [...byType].sort(([a], [b]) => a.localeCompare(b)).map(([type, pieces]) => {
        pieces.sort((a, b) => b.lengthIn - a.lengthIn || String(a.panel).localeCompare(String(b.panel)));
        const bars = [], long = [];
        for (const pc of pieces) {
            if (pc.lengthIn > maxS + 1e-9) { long.push(pc); continue; }
            // Best fit: the open bar with the least room left that still takes it (the kerf before it when not the first cut).
            let best = null, room = Infinity;
            for (const b of bars) { const left = maxS - b.usedIn - kerf; if (left + 1e-9 >= pc.lengthIn && left - pc.lengthIn < room) { best = b; room = left - pc.lengthIn; } }
            if (best) { best.cuts.push(pc); best.usedIn = r4(best.usedIn + kerf + pc.lengthIn); } else bars.push({ cuts: [pc], usedIn: pc.lengthIn });
        }
        for (const b of bars) { b.stockIn = stocks.find(s => s + 1e-9 >= b.usedIn); b.wasteIn = r4(b.stockIn - b.cuts.reduce((n, c) => n + c.lengthIn, 0)); }
        bars.sort((a, b) => b.stockIn - a.stockIn || b.usedIn - a.usedIn);
        const buy = stocks.slice().reverse().map(s => ({ stockIn: s, count: bars.filter(b => b.stockIn === s).length })).filter(x => x.count);
        const cutIn = r4(pieces.reduce((n, p) => n + p.lengthIn, 0)), longIn = r4(long.reduce((n, p) => n + p.lengthIn, 0));
        const orderedIn = r4(bars.reduce((n, b) => n + b.stockIn, 0) + longIn), wasteIn = r4(orderedIn - cutIn);
        return { type, pieces: pieces.length, cutIn, bars, long, buy, orderedIn, wasteIn, wastePct: orderedIn > 0 ? r4((wasteIn / orderedIn) * 100) : 0 };
    });
    const sum = (k) => r4(types.reduce((n, t) => n + t[k], 0)), orderedIn = sum('orderedIn'), wasteIn = sum('wasteIn');
    return { types, stockIn: stocks, kerfIn: kerf,
        totals: { pieces: types.reduce((n, t) => n + t.pieces, 0), cutIn: sum('cutIn'), orderedIn, wasteIn, wastePct: orderedIn > 0 ? r4((wasteIn / orderedIn) * 100) : 0, bars: types.reduce((n, t) => n + t.bars.length, 0) } };
}

// CSV (RFC 4180 quoting): what to buy (type, stock length, bars, plus pieces ordered cut to length) and the cut plan
// (each bar: its cuts, longest first).
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
export function purchaseCsv(plan) {
    const rows = [['Member type', 'Stock length', 'Stock length (in)', 'Quantity', 'Note']];
    for (const t of plan.types) {
        for (const b of t.buy) rows.push([t.type, fmtFtIn(b.stockIn), b.stockIn, b.count, '']);
        for (const p of t.long) rows.push([t.type, fmtFtIn(p.lengthIn), p.lengthIn, 1, `Longer than the stock lengths: order cut to length (${p.panel} ${p.mark})`]);
    }
    return csv(rows);
}
export function cutPlanCsv(plan) {
    const rows = [['Member type', 'Bar', 'Stock length', 'Cut', 'Cut length', 'Cut length (in)', 'Panel', 'Mark', 'Waste on bar (in)']];
    for (const t of plan.types) t.bars.forEach((b, i) => b.cuts.forEach((c, k) => rows.push([t.type, i + 1, fmtFtIn(b.stockIn), k + 1, fmtFtIn(c.lengthIn), c.lengthIn, c.panel, c.mark, k ? '' : b.wasteIn])));
    return csv(rows);
}
export function setCutListCsv(rows) {
    return csv([['Member type', 'Cut length', 'Cut length (in)', 'Quantity', 'Where (panel mark x qty)'],
        ...rows.map(r => [r.type, fmtFtIn(r.lengthIn), r.lengthIn, r.qty, r.uses.map(u => `${u.panel} ${u.mark} x${u.qty}`).join('; ')])]);
}
// Stock lengths typed as a list ("10', 12', 20'" or "120 144"): each parsed by the caller's length parser.
export function parseStockList(text, parseLength) {
    return String(text || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean)
        .flatMap(s => { const v = parseLength(s); return v != null ? [v] : s.split(/\s+/).map(parseLength); }).filter(v => v != null && v > 0);
}
