// Drawing-only opening facts: original clear envelope, framed R.O. and compact
// allowances. Actual geometry stays full precision; displayed dimensions use 1/8".
// openingAnnotations places them on the sheet clear of every tag and of each other.
import { fmtFtIn, openingKind } from '../common/framing.mjs';
import { formatDimension } from '../common/dimensions.mjs';
import { textWidth } from './pdf.mjs';

export function openingCallout(o) {
    const c = o.clear || o, through = !!o.through;
    const original = { widthIn: c.right - c.left, heightIn: through ? null : c.top - c.bottom };
    const rough = { widthIn: o.right - o.left, heightIn: through ? null : o.top - o.bottom };
    const sides = { left: c.left - o.left, right: o.right - c.right,
        top: through ? null : o.top - c.top, bottom: openingKind(o) === 'door' ? 0 : c.bottom - o.bottom };
    const size = (b) => b.heightIn == null ? `${fmtFtIn(b.widthIn)} WIDE / THROUGH TOP` : `${fmtFtIn(b.widthIn)} x ${fmtFtIn(b.heightIn)}`;
    return { original, rough, sides, lines: [`Original ${size(original)}`, `R.O. ${size(rough)}${o.unframed ? ' (unframed)' : ''}`] };
}

// One summary beside the sizes. Equal allowances collapse to one value; asymmetric
// allowances keep their side names. Doors have no bottom allowance, steel no top.
export function openingAllowanceText(o) {
    if (o.unframed) return '';
    const { sides } = openingCallout(o);
    const values = Object.entries(sides).filter(([k, v]) => v != null && !(k === 'bottom' && openingKind(o) === 'door'));
    if (!values.some(([, v]) => v > 1e-9)) return '';
    const inches = v => `+${formatDimension(Math.max(0, v), { style: 'inches' })}`;
    if (values.every(([, v]) => Math.abs(v - values[0][1]) < 1e-9)) {
        return `Allowance ${inches(values[0][1])} ${values.length === 4 ? 'all sides' : values.map(([k]) => k[0].toUpperCase()).join('/')}`;
    }
    return `Allowance ${values.map(([k, v]) => `${k[0].toUpperCase()} ${inches(v)}`).join(' / ')}`;
}

// Boxes are sheet inches, y down: { x0, x1, y0, y1 }.
const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const within = (a, b) => a.x0 >= b.x0 - 1e-9 && a.x1 <= b.x1 + 1e-9 && a.y0 >= b.y0 - 1e-9 && a.y1 <= b.y1 + 1e-9;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const textOp = (x, y, s, size, fill, more = {}) => ({ t: 'text', x, y, s, size, anchor: 'start', weight: 'normal', rotate: 0, fill, ...more });
// One compact block with the name, original/R.O. sizes and allowance summary.
// It avoids existing labels and dimension lines, rotating along narrow openings.
// Tiny openings retain their name/leader; their note carries sizes and allowances.
export function openingAnnotations(o, { X, Y, scale, name = '', kindText = '', modelName = '', busy = [], solid = [],
    color = '#a01818', nameColor = color, tagColor = color } = {}) {
    const L = X(o.left), R = X(o.right), T = Y(o.top), B = Y(o.bottom), w = R - L, h = B - T;
    if (!(w > 0 && h > 0)) return { ops: [], boxes: [], mode: 'none' };
    const pad = 0.02, inner = { x0: L + pad, x1: R - pad, y0: T + pad, y1: B - pad }, cx = (L + R) / 2, cy = (T + B) / 2;
    const call = openingCallout(o), allowance = openingAllowanceText(o);
    const free = (b, placed) => !busy.some(t => hit(b, t)) && !placed.some(t => hit(b, t));
    const fits = (b, placed) => within(b, inner) && free(b, placed);

    // The callout: rows of parts (the first row bold), on a white ground, across the opening or a quarter turn along it.
    const rowsOf = (model) => [
        ...(name || kindText ? [{ parts: [name, kindText].filter(Boolean), bold: true, fill: tagColor }] : []),
        { parts: [call.lines[0]] }, { parts: [call.lines[1]] },
        ...(allowance ? [{ parts: [allowance] }] : []),
        ...(model && modelName ? [{ parts: [modelName], small: true, fill: nameColor }] : []),
    ];
    const placeCallout = (rows, size, placed) => {
        const gap = size * 0.7, sz = (r) => (r.small ? size * 0.85 : size);
        const widths = rows.map(r => r.parts.map(p => textWidth(p, sz(r), !!r.bold)));
        const lineLen = widths.map(ws => ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1));
        const long = Math.max(...lineLen) + 0.04, thick = rows.length * size * 1.25 + 0.03, f = [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8];
        const tries = f.map(k => ({ rot: false, x: cx, y: inner.y0 + (inner.y1 - inner.y0) * k }));
        if (h > w) for (const k of f) for (const kx of [0.5, 0.3, 0.7]) tries.push({ rot: true, x: inner.x0 + (inner.x1 - inner.x0) * kx, y: inner.y0 + (inner.y1 - inner.y0) * k });
        for (const t of tries) {
            const bw = t.rot ? thick : long, bh = t.rot ? long : thick, box = { x0: t.x - bw / 2, x1: t.x + bw / 2, y0: t.y - bh / 2, y1: t.y + bh / 2 };
            if (!fits(box, placed)) continue;
            const ops = [{ t: 'rect', x: box.x0, y: box.y0, w: bw, h: bh, fill: '#ffffff', stroke: 'none', width: 0 }];
            rows.forEach((r, k) => {
                const base = 0.015 + size * 0.85 + k * size * 1.25; // from the block's top (across) or left (along)
                let at = -lineLen[k] / 2;
                r.parts.forEach((p, j) => {
                    const more = { weight: r.bold ? 'bold' : 'normal' };
                    ops.push(t.rot ? textOp(box.x0 + base, t.y - at, p, sz(r), r.fill || color, { ...more, rotate: -90 }) : textOp(t.x + at, box.y0 + base, p, sz(r), r.fill || color, more));
                    at += widths[k][j] + gap;
                });
            });
            return { ops, boxes: [box] };
        }
        return null;
    };

    // The name alone in a small box: inside, else the nearest free spot around the opening with a leader to it.
    const placeTag = (placed) => {
        const parts = [name, kindText].filter(Boolean), size = 0.06, gap = size * 0.5, pw = parts.map(p => textWidth(p, size, true));
        if (!parts.length) return { ops: [], boxes: [] };
        const textW = pw.reduce((a, b) => a + b, 0) + gap * (parts.length - 1);
        const tw = textW + 0.05, th = size + 0.045, at = (x, y) => ({ x0: x - tw / 2, x1: x + tw / 2, y0: y - th / 2, y1: y + th / 2 });
        const draw = (b, leader) => {
            const ops = [];
            if (leader) {
                const px = clamp((b.x0 + b.x1) / 2, L, R), py = clamp((b.y0 + b.y1) / 2, T, B);
                ops.push({ t: 'line', x1: px, y1: py, x2: clamp(px, b.x0, b.x1), y2: clamp(py, b.y0, b.y1), stroke: tagColor, width: 0.005 });
            }
            ops.push({ t: 'rect', x: b.x0, y: b.y0, w: tw, h: th, fill: '#ffffff', stroke: tagColor, width: 0.006 });
            let x = b.x0 + 0.025;
            parts.forEach((p, k) => { ops.push(textOp(x, b.y1 - 0.0225 - size * 0.2, p, size, tagColor, { weight: 'bold' })); x += pw[k] + gap; });
            return { ops, boxes: [b] };
        };
        for (const k of [0.5, 0.35, 0.65, 0.2, 0.8]) { const b = at(cx, inner.y0 + (inner.y1 - inner.y0) * k); if (fits(b, placed)) return draw(b, false); }
        for (const r of [0.06, 0.16, 0.3]) {
            for (const [x, y] of [[R + r + tw / 2, cy], [L - r - tw / 2, cy], [cx, T - r - th / 2], [cx, B + r + th / 2],
                [R + r + tw / 2, T - r - th / 2], [L - r - tw / 2, T - r - th / 2], [R + r + tw / 2, B + r + th / 2], [L - r - tw / 2, B + r + th / 2]]) {
                const b = at(x, y);
                if (free(b, placed) && !solid.some(t => hit(b, t))) return draw(b, true);
            }
        }
        return draw(at(R + 0.06 + tw / 2, cy), true); // nowhere clear: beside it, on its white ground
    };

    for (const model of [true, false]) for (const size of [0.065, 0.055, 0.045, 0.042]) {
        const c = placeCallout(rowsOf(model), size, []);
        if (c) return { mode: 'compact', ...c };
    }
    return { mode: 'tag', ...placeTag([]) };
}
