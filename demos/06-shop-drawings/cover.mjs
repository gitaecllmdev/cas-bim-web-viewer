// The set's cover sheet (11 x 17, before the panels' sheets in the set PDF): the project, the panel index (each panel's
// sheet number, size, level, wall type, check, typical and revision) and what to buy (stock.mjs nestStock); a long index
// continues on more cover pages. Drawing primitives in sheet inches, y down (as sheet.mjs; pdf.mjs draws them).
import { textWidth } from './pdf.mjs';

const W = 17, H = 11, ROW = 0.19, TOP = 2.35, BOTTOM = 10.2;
const text = (x, y, s, { size = 0.1, anchor = 'start', weight = 'normal', fill = '#000' } = {}) => ({ t: 'text', x, y, s: String(s ?? ''), size, anchor, weight, rotate: 0, fill });
const line = (x1, y1, x2, y2, { stroke = '#000', width = 0.008 } = {}) => ({ t: 'line', x1, y1, x2, y2, stroke, width });
const rect = (x, y, w, h, { fill = 'none', stroke = '#000', width = 0.008 } = {}) => ({ t: 'rect', x, y, w, h, fill, stroke, width });
// Text cut to a width ("..." when cut: the PDF's standard fonts have no ellipsis character).
const fit = (s, size, maxW, bold = false) => {
    let t = String(s ?? '');
    if (textWidth(t, size, bold) <= maxW) return t;
    while (t.length > 1 && textWidth(`${t}...`, size, bold) > maxW) t = t.slice(0, -1);
    return `${t}...`;
};
const INDEX = [['SHEET', 0.6, 0.5], ['PANEL', 1.15, 3.15], ['SIZE', 4.4, 1.45], ['LEVEL', 5.95, 0.8], ['WALL TYPE', 6.8, 2.35], ['CHECK', 9.25, 1.0], ['TYPICAL / REV', 10.3, 1.05]];

// cover: { project, date, drawnBy, rows: [{ sheet, mark, size, level, wallType, check, typical, rev }], stock: plan or
// null, notes: [string] } -> pages [{ ops, widthIn, heightIn }].
export function coverPages({ project = '', date = '', drawnBy = '', rows = [], stock = null, notes = [] }, fmt = (v) => `${v}"`) {
    const per = Math.floor((BOTTOM - TOP - ROW) / ROW), chunks = [];
    for (let i = 0; i < Math.max(1, rows.length); i += per) chunks.push(rows.slice(i, i + per));
    return chunks.map((chunk, k) => {
        const out = [rect(0.25, 0.25, W - 0.5, H - 0.5, { width: 0.02 })];
        out.push(text(0.6, 1.0, fit(project || 'PROJECT', 0.3, 11.5, true), { size: 0.3, weight: 'bold' }));
        out.push(text(0.6, 1.38, k ? 'FRAMING SHOP DRAWINGS: PANEL INDEX (CONTINUED)' : 'FRAMING SHOP DRAWINGS', { size: 0.18, weight: 'bold' }));
        out.push(text(0.6, 1.68, `DATE ${date}  ·  DRAWN ${drawnBy || '-'}  ·  ${rows.length} PANEL SHEET${rows.length === 1 ? '' : 'S'}${chunks.length > 1 ? `  ·  COVER ${k + 1} OF ${chunks.length}` : ''}`, { size: 0.11 }));
        out.push(text(W - 0.6, 1.0, 'FOR REVIEW', { size: 0.16, anchor: 'end', weight: 'bold', fill: '#b00020' }));
        out.push(text(W - 0.6, 1.25, 'NOT FOR CONSTRUCTION', { size: 0.12, anchor: 'end', weight: 'bold', fill: '#b00020' }));
        // The panel index.
        out.push(text(0.6, TOP - 0.25, 'PANEL INDEX', { size: 0.12, weight: 'bold' }));
        out.push(rect(0.55, TOP - 0.14, 10.85, ROW, { fill: '#e8ecf1', stroke: 'none', width: 0 }));
        for (const [h, x] of INDEX) out.push(text(x, TOP, h, { size: 0.08, weight: 'bold', fill: '#444' }));
        chunk.forEach((r, i) => {
            const y = TOP + (i + 1) * ROW, cells = [r.sheet, r.mark, r.size, r.level, r.wallType, r.check, r.typical];
            if (i % 2) out.push(rect(0.55, y - 0.14, 10.85, ROW, { fill: '#f6f8fa', stroke: 'none', width: 0 }));
            INDEX.forEach(([, x, w], c) => out.push(text(x, y, fit(cells[c] ?? '', 0.09, w - 0.08, c === 1), { size: 0.09, weight: c === 1 ? 'bold' : 'normal', fill: c === 5 && /FAIL|NOT/.test(r.check) ? '#b00020' : '#000' })));
        });
        out.push(line(0.55, TOP + (chunk.length + 1) * ROW - 0.12, 11.4, TOP + (chunk.length + 1) * ROW - 0.12, { stroke: '#9aa0a6', width: 0.006 }));
        // What to buy (the first cover page).
        if (!k && stock?.types?.length) {
            const x0 = 11.75, x1 = W - 0.6;
            out.push(text(x0, TOP - 0.25, 'WHAT TO BUY', { size: 0.12, weight: 'bold' }));
            out.push(rect(x0 - 0.05, TOP - 0.14, x1 - x0 + 0.1, ROW, { fill: '#e8ecf1', stroke: 'none', width: 0 }));
            for (const [h, x, a] of [['MEMBER TYPE', x0, 'start'], ['PCS', x0 + 1.55, 'start'], ['BUY', x0 + 2.05, 'start'], ['LF', x1, 'end']]) out.push(text(x, TOP, h, { size: 0.08, weight: 'bold', fill: '#444', anchor: a }));
            let y = TOP;
            for (const t of stock.types) {
                const buy = [...t.buy.map(b => `${b.count} x ${fmt(b.stockIn)}`), ...(t.long.length ? [`${t.long.length} cut to length`] : [])].join(', ');
                const lines = [];
                let cur = '';
                for (const part of buy.split(', ')) { const next = cur ? `${cur}, ${part}` : part; if (textWidth(next, 0.085, false) > x1 - x0 - 2.05 - 0.5 && cur) { lines.push(cur); cur = part; } else cur = next; }
                lines.push(cur);
                y += ROW;
                out.push(text(x0, y, fit(t.type, 0.09, 1.5, true), { size: 0.09, weight: 'bold' }));
                out.push(text(x0 + 1.55, y, String(t.pieces), { size: 0.09 }));
                lines.forEach((ln, i) => out.push(text(x0 + 2.05, y + i * 0.14, ln, { size: 0.085 })));
                out.push(text(x1, y, Math.round(t.orderedIn / 12).toLocaleString('en-US'), { size: 0.09, anchor: 'end' }));
                y += (lines.length - 1) * 0.14;
            }
            const tt = stock.totals;
            y += ROW + 0.05;
            out.push(line(x0 - 0.05, y - 0.15, x1 + 0.05, y - 0.15, { stroke: '#9aa0a6', width: 0.006 }));
            out.push(text(x0, y, `${tt.pieces} PIECES · ${Math.round(tt.cutIn / 12).toLocaleString('en-US')} LF CUT · ${Math.round(tt.orderedIn / 12).toLocaleString('en-US')} LF TO BUY · ${tt.wastePct.toFixed(1)}% OFFCUT`, { size: 0.085, weight: 'bold' }));
            out.push(text(x0, y + 0.16, fit(`STOCK ${stock.stockIn.map(fmt).join(', ')} · KERF ${fmt(stock.kerfIn)} · A PURCHASING AID: CHECK IT`, 0.075, x1 - x0), { size: 0.075, fill: '#555' }));
        }
        // Notes (the first page).
        if (!k) notes.filter(Boolean).forEach((n, i) => out.push(text(0.6, H - 0.55 - (notes.length - 1 - i) * 0.17, fit(String(n).toUpperCase(), 0.085, W - 1.2), { size: 0.085, fill: '#1f3a5f', weight: 'bold' })));
        return { ops: out, widthIn: W, heightIn: H };
    });
}
