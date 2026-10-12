// Drawing-only opening facts: original clear envelope, framed R.O. and outward
// allowances. Actual geometry stays full precision; displayed dimensions use 1/8".
import { fmtFtIn, openingKind } from '../common/framing.mjs';
import { formatDimension } from '../common/dimensions.mjs';

export function openingCallout(o) {
    const c = o.clear || o, through = !!o.through;
    const original = { widthIn: c.right - c.left, heightIn: through ? null : c.top - c.bottom };
    const rough = { widthIn: o.right - o.left, heightIn: through ? null : o.top - o.bottom };
    const sides = { left: c.left - o.left, right: o.right - c.right,
        top: through ? null : o.top - c.top, bottom: openingKind(o) === 'door' ? 0 : c.bottom - o.bottom };
    const size = (b) => b.heightIn == null ? `${fmtFtIn(b.widthIn)} WIDE / THROUGH TOP` : `${fmtFtIn(b.widthIn)} x ${fmtFtIn(b.heightIn)}`;
    return { original, rough, sides, lines: [`Original ${size(original)}`, `R.O. ${size(rough)}${o.unframed ? ' (unframed)' : ''}`] };
}

export function allowanceArrows(o, { X, Y, scale, color = '#24658d' }) {
    const { sides } = openingCallout(o), width = (o.right - o.left) * scale, height = (o.top - o.bottom) * scale;
    // Arrows are explanatory glyphs, not scaled fabrication offsets. Numeric
    // labels give the actual allowance, including asymmetric and zero sides.
    if (!(width > 0 && height > 0) || o.unframed) return [];
    const length = Math.min(0.14, width * 0.16, height * 0.16), size = 0.05;
    const cx = X((o.left + o.right) / 2), cy = Y((o.bottom + o.top) / 2);
    const specs = [
        ['left', X(o.left) + 0.025, cy, -1, 0], ['right', X(o.right) - 0.025, cy, 1, 0],
        ['top', cx, Y(o.top) + 0.025, 0, -1], ['bottom', cx, Y(o.bottom) - 0.025, 0, 1],
    ];
    const out = [];
    for (const [side, x, y, dx, dy] of specs) {
        if (sides[side] == null) continue;
        const tail = [x - dx * length, y - dy * length], half = 0.022;
        out.push({ t: 'line', x1: tail[0], y1: tail[1], x2: x, y2: y, stroke: color, width: 0.006, allowanceSide: side });
        out.push({ t: 'poly', pts: [[x, y], [x - dx * 0.04 - dy * half, y - dy * 0.04 + dx * half],
            [x - dx * 0.04 + dy * half, y - dy * 0.04 - dx * half]], fill: color, stroke: 'none', width: 0, allowanceSide: side });
        const label = `${side[0].toUpperCase()} +${formatDimension(Math.max(0, sides[side]), { style: 'inches' })}`;
        out.push({ t: 'text', x: tail[0] - dx * 0.035, y: tail[1] - dy * 0.04 + (dy ? 0 : 0.015), s: label,
            size, anchor: dx === -1 ? 'start' : dx === 1 ? 'end' : 'middle', weight: 'normal', rotate: 0, fill: color });
    }
    return out;
}
