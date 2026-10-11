// Context lines for a panel: the level at its bottom and the level at its top, and the grids along it, drawn in the
// sketch and (the levels) on the sheet when the user turns them on. Context only: they never change a member, the plan,
// the cut list or the check. Pure.
//
// panel.context = { show, levels: { bottom: Level | null, top: Level | null }, grids: [{ name, xIn }] }
//   Level = { name, place: 'at' | 'above' | 'below', offsetIn }: relative to the panel's bottom (bottom) or its top
//   (top). A grid: its distance from the panel's left end (as drawn on side A).
// A model's panel (panel.revit, in a set with levels and grids) has defaults from the model: its base level (the panel
// sits baseOffsetIn above it), the next level up (from the panel's top), and every grid that crosses the wall's location
// line, measured along it from the panel's left end (revit.leftEnd).
import { formatDimension } from '../common/dimensions.mjs';
import { shapeTop } from './generator.mjs';

export const PLACES = ['at', 'above', 'below'];
const r16 = (v) => Math.round(v * 16) / 16;
const relative = (y) => (Math.abs(y) < 1 / 32 ? { place: 'at', offsetIn: 0 } : { place: y > 0 ? 'above' : 'below', offsetIn: r16(Math.abs(y)) });
const str = (v, n = 40) => String(v ?? '').trim().slice(0, n);

// The model's defaults (null when the panel is not a model's or the set has no levels or grids for it).
export function modelContext(set, panel) {
    const r = panel?.revit;
    if (!r || typeof r !== 'object') return null;
    const H = panelTop(panel);
    const levels = (Array.isArray(set?.levels) ? set.levels : []).filter(l => l && Number.isFinite(l.elevationIn) && str(l.name)).sort((a, b) => a.elevationIn - b.elevationIn);
    const base = levels.find(l => l.name === r.levelName) || null, offset = Number.isFinite(r.baseOffsetIn) ? r.baseOffsetIn : 0;
    const bottomZ = base ? base.elevationIn + offset : null, next = base ? levels.find(l => l.elevationIn > base.elevationIn + 1e-6) : null;
    const out = {
        levels: { bottom: base ? { name: base.name, ...relative(base.elevationIn - bottomZ) } : null, top: next ? { name: next.name, ...relative(next.elevationIn - (bottomZ + H)) } : null },
        grids: gridsAlong(set?.grids, r, shapeTop(panel.shape).lengthIn),
    };
    return out.levels.bottom || out.levels.top || out.grids.length ? out : null;
}
// Where each grid crosses the wall's location line, from the panel's left end (inches). Parallel grids never cross.
export function gridsAlong(grids, revit, lengthIn) {
    const s = revit?.locationLine?.start, e = revit?.locationLine?.end;
    if (!Array.isArray(grids) || !Array.isArray(s) || !Array.isArray(e)) return [];
    const dx = e[0] - s[0], dy = e[1] - s[1], len = Math.hypot(dx, dy);
    if (!(len > 0)) return [];
    const out = [];
    for (const g of grids) {
        const a = g?.start, b = g?.end;
        if (!str(g?.name) || !Array.isArray(a) || !Array.isArray(b)) continue;
        const gx = b[0] - a[0], gy = b[1] - a[1], den = dx * gy - dy * gx;
        if (Math.abs(den) < 1e-9 * len * Math.hypot(gx, gy)) continue; // parallel (or along the wall)
        const t = ((a[0] - s[0]) * gy - (a[1] - s[1]) * gx) / den; // along the wall, 0..1
        if (t < -1e-6 || t > 1 + 1e-6) continue;
        const along = t * len, fromLeft = /(^|-)end$/.test(String(revit.leftEnd || '')) ? len - along : along; // 'end' or 'wall-end'
        if (fromLeft < -1 / 32 || fromLeft > lengthIn + 1 / 32) continue;
        out.push({ name: str(g.name), xIn: r16(Math.min(lengthIn, Math.max(0, fromLeft))) });
    }
    return out.sort((p, q) => p.xIn - q.xIn || p.name.localeCompare(q.name));
}
const panelTop = (panel) => { const { heightIn, top } = shapeTop(panel.shape); return top ? Math.max(...top.map(q => q[1])) : heightIn; };

// A panel's context as stored: only what this tool uses (dropped when empty).
export function cleanContext(c) {
    if (!c || typeof c !== 'object') return null;
    const level = (l) => (l && typeof l === 'object' && PLACES.includes(l.place) ? { name: str(l.name), place: l.place, offsetIn: l.place === 'at' ? 0 : r16(Math.max(0, Number(l.offsetIn) || 0)) } : null);
    const grids = (Array.isArray(c.grids) ? c.grids : []).filter(g => g && Number.isFinite(Number(g.xIn))).map(g => ({ name: str(g.name, 12), xIn: r16(Number(g.xIn)) })).slice(0, 60);
    const out = { show: !!c.show, levels: { bottom: level(c.levels?.bottom), top: level(c.levels?.top) }, grids };
    return out.show || out.levels.bottom || out.levels.top || grids.length ? out : null;
}

// What to draw: the panel's own context, else the model's defaults. -> { show, levels: [{ which, name, yIn, text }],
// grids: [{ name, xIn }], fromModel }
export function contextLines(panel, set = null) {
    const own = cleanContext(panel?.context), model = modelContext(set, panel), src = own || model || { levels: {}, grids: [] };
    const H = panelTop(panel), levels = [];
    for (const which of ['bottom', 'top']) {
        const l = src.levels?.[which];
        if (!l) continue;
        const sign = l.place === 'above' ? 1 : l.place === 'below' ? -1 : 0, y = (which === 'bottom' ? 0 : H) + sign * (l.offsetIn || 0);
        const where = l.place === 'at' ? `at the panel's ${which}` : `${fmtIn(l.offsetIn)} ${l.place} the panel's ${which}`;
        levels.push({ which, name: l.name || (which === 'bottom' ? 'Level' : 'Level above'), yIn: y, text: where });
    }
    return { show: !!own?.show, levels, grids: (src.grids || []).map(g => ({ ...g })), fromModel: !own && !!model };
}
// Inches as a drawing writes them: 1'-0", 8", 1/2".
export const fmtIn = (v) => formatDimension(Math.abs(v), { compactFeet: true });
// The sheet's level lines (sheet.mjs info.elev.levels: { name, y } from the panel's bottom).
export const sheetLevels = (ctx) => (ctx.show ? ctx.levels.map(l => ({ name: l.name, y: l.yIn })) : []);
