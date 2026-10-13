// Drawing-only opening facts: original clear envelope, framed R.O. and outward
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

const DIRS = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
const allowanceText = (side, v) => `${side[0].toUpperCase()} +${formatDimension(Math.max(0, v), { style: 'inches' })}`;
// One outward arrow, its tip at (x, y) just inside the opening's edge on that side. Arrows are explanatory glyphs, not
// scaled fabrication offsets: the labels give the actual allowance, including asymmetric and zero sides.
function arrow(side, x, y, length, color) {
    const [dx, dy] = DIRS[side], tail = [x - dx * length, y - dy * length], half = 0.022;
    return { tail, ops: [{ t: 'line', x1: tail[0], y1: tail[1], x2: x, y2: y, stroke: color, width: 0.006, allowanceSide: side },
        { t: 'poly', pts: [[x, y], [x - dx * 0.04 - dy * half, y - dy * 0.04 + dx * half], [x - dx * 0.04 + dy * half, y - dy * 0.04 - dx * half]],
            fill: color, stroke: 'none', width: 0, allowanceSide: side }] };
}

// The four arrows at the middle of each side with their labels (as a reference; the sheet uses openingAnnotations).
export function allowanceArrows(o, { X, Y, scale, color = '#24658d' }) {
    const { sides } = openingCallout(o), width = (o.right - o.left) * scale, height = (o.top - o.bottom) * scale;
    if (!(width > 0 && height > 0) || o.unframed) return [];
    const length = Math.min(0.14, width * 0.16, height * 0.16), size = 0.05;
    const cx = X((o.left + o.right) / 2), cy = Y((o.bottom + o.top) / 2);
    const out = [];
    for (const [side, x, y] of [['left', X(o.left) + 0.025, cy], ['right', X(o.right) - 0.025, cy], ['top', cx, Y(o.top) + 0.025], ['bottom', cx, Y(o.bottom) - 0.025]]) {
        if (sides[side] == null) continue;
        const [dx, dy] = DIRS[side], a = arrow(side, x, y, length, color);
        out.push(...a.ops, { t: 'text', x: a.tail[0] - dx * 0.035, y: a.tail[1] - dy * 0.04 + (dy ? 0 : 0.015), s: allowanceText(side, sides[side]),
            size, anchor: dx === -1 ? 'start' : dx === 1 ? 'end' : 'middle', weight: 'normal', rotate: 0, fill: color });
    }
    return out;
}

// Boxes are sheet inches, y down: { x0, x1, y0, y1 }.
const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const within = (a, b) => a.x0 >= b.x0 - 1e-9 && a.x1 <= b.x1 + 1e-9 && a.y0 >= b.y0 - 1e-9 && a.y1 <= b.y1 + 1e-9;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const textOp = (x, y, s, size, fill, more = {}) => ({ t: 'text', x, y, s, size, anchor: 'start', weight: 'normal', rotate: 0, fill, ...more });
const labelBox = (x, y, s, size, anchor, bold) => {
    const w = textWidth(s, size, bold), x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    return { x0: x0 - 0.01, x1: x0 + w + 0.01, y0: y - size * 0.8, y1: y + size * 0.25 };
};

// Every annotation of one opening, placed clear of what is drawn already (busy: tags, notes, dimension lines; a box with
// line: true is a thin line an arrow may cross, text not) and of each other. Tried in turn, the first that fits wins:
//   full:    an arrow at each side with its allowance by it, and the callout (its name, original size, R.O., the model's
//            family : type) inside the opening: across it, or along a tall narrow one (a quarter turn), smaller if need be;
//   compact: the arrows alone, the allowances as a row of the callout;
//   tag:     the arrows alone (none on a tiny opening) and its name: inside, else just outside with a leader, clear of the
//            members too. The opening's note under the cut list carries its sizes and allowances.
// Each arrow and label slides along its side to miss a tag (a header's or sill's, a jamb's). -> { ops, boxes, mode }
export function openingAnnotations(o, { X, Y, scale, name = '', kindText = '', modelName = '', busy = [], solid = [],
    color = '#a01818', nameColor = color, tagColor = color } = {}) {
    const L = X(o.left), R = X(o.right), T = Y(o.top), B = Y(o.bottom), w = R - L, h = B - T;
    if (!(w > 0 && h > 0)) return { ops: [], boxes: [], mode: 'none' };
    const pad = 0.02, inner = { x0: L + pad, x1: R - pad, y0: T + pad, y1: B - pad }, cx = (L + R) / 2, cy = (T + B) / 2;
    const call = openingCallout(o), sides = o.unframed ? [] : Object.keys(DIRS)
        .filter(k => call.sides[k] != null && !(k === 'bottom' && openingKind(o) === 'door')).map(k => [k, call.sides[k]]); // a door: none at its floor
    const free = (b, placed, glyph = false) => !busy.some(t => !(glyph && t.line) && hit(b, t)) && !placed.some(t => hit(b, t));
    const fits = (b, placed, glyph = false) => within(b, inner) && free(b, placed, glyph);
    const arrows = sides.length && w >= 0.12 && h >= 0.12, len = Math.min(0.14, w * 0.16, h * 0.16);

    // The arrows (with their labels when labelled) at the first free spot along each side; null when a label finds none.
    const placeArrows = (labelled, placed) => {
        const ops = [], boxes = [], size = 0.05;
        for (const [side, v] of sides) {
            const [dx, dy] = DIRS[side], label = allowanceText(side, v);
            const along = dx ? [0, -0.12, 0.12, -0.24, 0.24, -0.36, 0.36].map(d => cy + d) : [0, -0.25, 0.25, -0.35, 0.35].map(f => cx + f * w);
            let done = false;
            for (const a of along) {
                const x = dx ? (dx < 0 ? L + 0.025 : R - 0.025) : a, y = dy ? (dy < 0 ? T + 0.025 : B - 0.025) : a;
                const g = arrow(side, x, y, len, color), [tx, ty] = g.tail, across = 0.025;
                const own = [{ x0: Math.min(x, tx) - (dy ? across : 0), x1: Math.max(x, tx) + (dy ? across : 0), y0: Math.min(y, ty) - (dx ? across : 0), y1: Math.max(y, ty) + (dx ? across : 0) }];
                let lop = null;
                if (labelled) {
                    const anchor = dx < 0 ? 'start' : dx > 0 ? 'end' : 'middle', lx = tx - dx * 0.035;
                    const ly = dx ? ty + size * 0.3 : dy < 0 ? ty + 0.012 + size * 0.8 : ty - 0.012 - size * 0.25;
                    own.push(labelBox(lx, ly, label, size, anchor, false));
                    lop = textOp(lx, ly, label, size, color, { anchor });
                }
                if (!own.every((b, k) => fits(b, [...placed, ...boxes], k === 0))) continue; // [0]: the arrow itself
                ops.push(...g.ops, ...(lop ? [lop] : [])); boxes.push(...own); done = true;
                break;
            }
            if (!done && labelled) return null;
        }
        return { ops, boxes };
    };

    // The callout: rows of parts (the first row bold), on a white ground, across the opening or a quarter turn along it.
    const rowsOf = (allowances, model) => [
        ...(name || kindText ? [{ parts: [name, kindText].filter(Boolean), bold: true, fill: tagColor }] : []),
        { parts: [call.lines[0]] }, { parts: [call.lines[1]] },
        ...(allowances && sides.length ? [{ parts: sides.map(([k, v]) => allowanceText(k, v)) }] : []),
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

    const combine = (mode, ...parts) => ({ mode, ops: parts.flatMap(p => p.ops), boxes: parts.flatMap(p => p.boxes) });
    const none = { ops: [], boxes: [] };
    // full
    const labelled = arrows ? placeArrows(true, []) : sides.length ? null : none;
    if (labelled) {
        for (const model of [true, false]) for (const size of [0.065, 0.055, 0.045]) {
            const c = placeCallout(rowsOf(false, model), size, labelled.boxes);
            if (c) return combine('full', labelled, c);
        }
    }
    // compact
    const bare = arrows ? placeArrows(false, []) : none;
    for (const model of [true, false]) for (const size of [0.06, 0.05, 0.042]) {
        const c = placeCallout(rowsOf(true, model), size, bare.boxes);
        if (c) return combine('compact', bare, c);
    }
    // tag
    return combine('tag', bare, placeTag(bare.boxes));
}
