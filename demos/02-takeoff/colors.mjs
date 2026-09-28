// Takeoff colors (Demo 2). Fixed, so a color means the same thing on every level (and on every project):
//   framing type: one color per stud depth, picked to stay apart from each other, from the grey of walls that aren't
//                 ours and under 3D shading (2 1/2" green, 3 5/8" blue, 6" red: the common three are the most apart); tests/criteria.test.js checks the spacing.
//   SSMA stud: shades of its depth's color (lighter for lighter gauges and narrower flanges);
//   finish, layers, anything else: a 12-color palette in a stable (sorted) order over the whole project.
import { parseDesignator } from './criteria.mjs';

export const NOT_OURS = '#d9d9d9';
export const NEEDS_REVIEW = '#111111'; // a wall type no rule matches (set it in the Assemblies tab)
const DEPTH_COLORS = [[0.875, '#7b3fa0'], [1.625, '#f28e1c'], [2.5, '#2ca02c'], [3.625, '#1f6fd1'], [4, '#f0e442'], [6, '#d62728'], [8, '#e7298a'], [10, '#e377c2'], [12, '#4d4d4d']];
const PALETTE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#17becf', '#8c564b', '#e377c2', '#bcbd22', '#393b79', '#ad494a', '#637939'];

export function depthColor(depthIn) {
    return DEPTH_COLORS.reduce((best, c) => (Math.abs(c[0] - depthIn) < Math.abs(best[0] - depthIn) ? c : best))[1];
}

// Stud depth in inches from a framing label (3 5/8" framing, 7/8" furring) or an SSMA name (600S162-33).
export function depthOf(text) {
    const ssma = parseDesignator(text);
    if (ssma) return ssma.depthIn;
    const m = /^(\d+)(?: (\d+)\/(\d+))?"|^(\d+)\/(\d+)"/.exec(text || '');
    return !m ? NaN : m[4] ? m[4] / m[5] : Number(m[1]) + (m[2] ? m[2] / m[3] : 0);
}

// value -> hex for one dimension's values (all of the project's values, so the colors don't shift with the slicers).
const SYSTEM_COLORS = { 'Framed wall': '#1f6fd1', 'Shaft wall': '#ff7f0e', Furring: '#7b3fa0' };
export function colorMap(dim, values) {
    const list = [...new Set(values)].filter(v => v != null && v !== '');
    if (dim === 'system') return new Map(list.map(v => [v, SYSTEM_COLORS[v] || NOT_OURS]));
    if (dim === 'insulation') {
        const insulated = list.filter(v => v !== 'None').sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
        return new Map([['None', '#b8c2cc'], ...insulated.map((v, i) => [v, PALETTE[(i + 1) % PALETTE.length]])]);
    }
    if (dim === 'framing') return new Map(list.map(v => [v, Number.isFinite(depthOf(v)) ? depthColor(depthOf(v)) : NOT_OURS]));
    if (dim === 'stud') {
        const byDepth = new Map();
        for (const v of list) {
            const d = depthOf(v);
            if (!byDepth.has(d)) byDepth.set(d, []);
            byDepth.get(d).push(v);
        }
        const out = new Map();
        for (const [d, names] of byDepth) {
            const weight = (n) => { const s = parseDesignator(n); return s ? s.mils * 10 + (s.flangeIn || 0) : 0; };
            names.sort((a, b) => weight(a) - weight(b)).forEach((n, i) => {
                const t = names.length > 1 ? 0.28 - (0.5 * i) / (names.length - 1) : 0; // light to dark
                out.set(n, shade(Number.isFinite(d) ? depthColor(d) : NOT_OURS, t));
            });
        }
        return out;
    }
    return new Map(list.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })).map((v, i) => [v, PALETTE[i % PALETTE.length]]));
}

// Lighter (t > 0) or darker (t < 0), in HSL lightness.
export function shade(hex, t) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    const h = !d ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    const L = Math.min(0.85, Math.max(0.15, l + t));
    const c = (1 - Math.abs(2 * L - 1)) * s, x = c * (1 - Math.abs((h % 2 + 2) % 2 - 1)), m = L - c / 2;
    const [r1, g1, b1] = h < 0 ? [c, 0, x] : h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    return `#${[r1, g1, b1].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}
