// Member labels for the shop floor: one per piece (a cut list row of 8 is 8 labels, "1/8" to "8/8"), each with its
// panel, mark, function, member type and cut length, on Avery 5160-size sheets (letter, 3 x 10 labels of 2 5/8" x 1").
// Drawing primitives in inches, y down (pdf.mjs toPdfPages draws them). Pure.
import { textWidth } from './pdf.mjs';

export const AVERY_5160 = Object.freeze({ pageW: 8.5, pageH: 11, cols: 3, rows: 10, w: 2.625, h: 1, left: 0.1875, top: 0.5, pitchX: 2.75, pitchY: 1 });
// items: [{ panel, cutList: [{ mark, qty, func, type, lengthIn }] }] -> pieces in panel order, longest first within each.
export function labelPieces(items) {
    const out = [];
    for (const it of items) {
        for (const c of [...(it.cutList || [])].sort((a, b) => String(a.mark).localeCompare(String(b.mark), undefined, { numeric: true }))) {
            for (let k = 1; k <= (c.qty || 0); k++) out.push({ panel: it.panel, mark: c.mark, func: c.func || '', type: c.type, lengthIn: c.lengthIn, k, n: c.qty });
        }
    }
    return out;
}
const text = (x, y, s, { size = 0.1, anchor = 'start', weight = 'normal', fill = '#000' } = {}) => ({ t: 'text', x, y, s: String(s ?? ''), size, anchor, weight, rotate: 0, fill });
const fit = (s, size, maxW, bold) => { let t = String(s ?? ''); while (t.length > 1 && textWidth(t, size, bold) > maxW) t = t.slice(0, -1); return t; };
// The pages: { ops, widthIn, heightIn } each, labels across then down. fmt: the length formatter; project: under each.
export function labelPages(pieces, { fmt = (v) => `${v}"`, project = '', layout = AVERY_5160 } = {}) {
    const L = layout, per = L.cols * L.rows, pages = [];
    for (let i = 0; i < pieces.length; i += per) {
        const ops = [];
        pieces.slice(i, i + per).forEach((p, j) => {
            const x = L.left + (j % L.cols) * L.pitchX + 0.1, y = L.top + Math.floor(j / L.cols) * L.pitchY, w = L.w - 0.2;
            const len = fmt(p.lengthIn), lw = textWidth(len, 0.17, true);
            ops.push(text(x, y + 0.2, fit(p.panel, 0.1, w - 0.45, true), { size: 0.1, weight: 'bold' }));
            ops.push(text(x + w, y + 0.2, `${p.k}/${p.n}`, { size: 0.085, anchor: 'end', fill: '#444' }));
            ops.push(text(x, y + 0.5, p.mark, { size: 0.22, weight: 'bold' }));
            ops.push(text(x + textWidth(p.mark, 0.22, true) + 0.06, y + 0.5, fit(p.func, 0.085, w - lw - textWidth(p.mark, 0.22, true) - 0.15, false), { size: 0.085, fill: '#444' }));
            ops.push(text(x + w, y + 0.5, len, { size: 0.17, anchor: 'end', weight: 'bold' }));
            ops.push(text(x, y + 0.7, fit(p.type, 0.1, w, false), { size: 0.1 }));
            if (project) ops.push(text(x, y + 0.87, fit(project, 0.07, w, false), { size: 0.07, fill: '#666' }));
        });
        pages.push({ ops, widthIn: L.pageW, heightIn: L.pageH });
    }
    return pages;
}
