// The model's walls in 3D, for Batch Sheets (core/client/batch-sheets.html): pure, no DOM or WebGL (tested in
// tests/batch-sheets.test.js). A Revit-exported panel (cas-panel-shops: revit.locationLine, orientation, sideA,
// thicknessIn, the panel's shape and locked openings) becomes solid vertical strips in panel coordinates, then
// triangles in the export's own coordinates (inches; X, Y plan, Z up). Display only: the wall is centered on its
// location line (the export does not say which face the line is on), and nothing here feeds framing or placement.
import { shapeTop, openingBox, isFromModel } from './generator.mjs';
import { topAt } from '../common/framing.mjs';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const point3 = (p) => Array.isArray(p) && p.length === 3 && p.every(finite);

// The panel frame the Revit exporter used (CAS_BIM_Tools.Core ElevationFrame): X runs to the right of someone looking
// at side A, from the panel's left end; Y is up from the panel's base.
export function panelFrame(panel, levels = []) {
    const r = panel?.revit;
    if (!r || !point3(r.locationLine?.start) || !point3(r.locationLine?.end) || !Array.isArray(r.orientation) || !finite(r.thicknessIn) || !(r.thicknessIn > 0))
        return { error: 'The export gives no location line, orientation or thickness for this wall.' };
    const [nx, ny] = r.orientation, h = Math.hypot(nx, ny);
    if (!(h > 1e-9)) return { error: 'The wall orientation is not a horizontal direction.' };
    const sign = r.sideA === 'interior' ? -1 : 1, z = (v) => v + 0; // + 0: no negative zero in reported directions
    const right = [z(-ny / h * sign), z(nx / h * sign)], outward = [z(nx / h * sign), z(ny / h * sign)];
    const s = r.locationLine.start, e = r.locationLine.end;
    const leftEnd = s[0] * right[0] + s[1] * right[1] <= e[0] * right[0] + e[1] * right[1] ? 'start' : 'end';
    const left = leftEnd === 'start' ? s : e;
    const level = levels.find(l => l?.name === r.levelName && finite(l.elevationIn));
    const base = level ? level.elevationIn + (finite(r.baseOffsetIn) ? r.baseOffsetIn : 0) : left[2];
    return { origin: [left[0], left[1], base], right, outward, leftEnd, thicknessIn: r.thicknessIn, levelName: r.levelName || panel.level || '',
        lengthIn: Math.hypot(e[0] - s[0], e[1] - s[1]) };
}

// Solid pieces of the panel face: vertical strips between every x where the top line or an opening changes; in each
// strip, the panel height minus the openings that cross it. { x0, x1, b0, b1, t0, t1 }: bottom and top at x0 and x1
// (a strip's top follows a sloped top line; an opening's edges are level).
export function wallSolids(panel) {
    const { lengthIn: L, heightIn: H, top } = shapeTop(panel.shape);
    if (!(L > 0) || !(H > 0)) return [];
    const yTop = (x) => topAt(top, x, H);
    const boxes = (panel.openings || []).filter(o => !isFromModel(panel) || o.locked).map(o => openingBox(o, Infinity))
        .filter(b => b.right > b.left && b.right > 0 && b.left < L);
    const xs = [...new Set([0, L, ...(top || []).map(q => q[0]), ...boxes.flatMap(b => [b.left, b.right])]
        .map(x => Math.min(L, Math.max(0, x))))].sort((a, b) => a - b);
    const solids = [];
    for (let i = 1; i < xs.length; i++) {
        const x0 = xs[i - 1], x1 = xs[i];
        if (x1 - x0 < 1e-6) continue;
        const mid = (x0 + x1) / 2, cuts = boxes.filter(b => b.left <= mid && b.right >= mid).map(b => [Math.max(0, b.bottom), b.top]).sort((a, b) => a[0] - b[0]);
        let y = 0;
        const push = (b, t, sloped) => solids.push({ x0, x1, b0: b, b1: b, t0: sloped ? yTop(x0) : t, t1: sloped ? yTop(x1) : t });
        for (const [lo, hi] of cuts) {
            if (lo > y + 1e-6) push(y, Math.min(lo, yTop(mid)), false);
            y = Math.max(y, hi);
        }
        if (y < yTop(mid) - 1e-6) push(y, null, true);
    }
    return solids;
}

// World triangles (export coordinates, inches) for one wall: 12 per solid strip, the strip's box from -t/2 to +t/2
// about the location line. Returns null with a reason when the export cannot place the wall.
export function wallMesh(panel, levels = []) {
    if (!isFromModel(panel)) return { error: 'Typed-in panel: it has no place in the model.' };
    const f = panelFrame(panel, levels);
    if (f.error) return f;
    const solids = wallSolids(panel);
    if (!solids.length) return { error: 'The panel has no solid face to show.' };
    const half = f.thicknessIn / 2, [ox, oy, oz] = f.origin, [rx, ry] = f.right, [nx, ny] = f.outward;
    const at = (x, y, d) => [ox + rx * x + nx * d, oy + ry * x + ny * d, oz + y];
    const positions = [];
    const quad = (a, b, c, d) => positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (const s of solids) {
        const p = (x, y, d) => at(x, y, d);
        const A0 = p(s.x0, s.b0, half), A1 = p(s.x1, s.b1, half), A2 = p(s.x1, s.t1, half), A3 = p(s.x0, s.t0, half);
        const B0 = p(s.x0, s.b0, -half), B1 = p(s.x1, s.b1, -half), B2 = p(s.x1, s.t1, -half), B3 = p(s.x0, s.t0, -half);
        quad(A0, A1, A2, A3); quad(B1, B0, B3, B2); // side A, side B
        quad(B0, B1, A1, A0); quad(A3, A2, B2, B3); // bottom, top
        quad(B0, A0, A3, B3); quad(A1, B1, B2, A2); // left, right ends
    }
    return { positions, solids: solids.length, frame: f };
}

// Every exported wall of a set: meshes, the levels they are on (in elevation order) and the panels left out with why.
export function setModel(set) {
    const levels = Array.isArray(set?.levels) ? set.levels : [];
    const walls = [], skipped = [];
    for (const p of set?.panels || []) {
        const m = wallMesh(p, levels);
        if (m.error) skipped.push({ id: p.id, mark: p.mark, reason: m.error });
        else walls.push({ id: p.id, mark: p.mark, level: m.frame.levelName, wallType: p.wallType || '', group: p.group || '', positions: m.positions, base: m.frame.origin[2] });
    }
    const order = new Map(levels.filter(l => finite(l?.elevationIn)).map(l => [l.name, l.elevationIn]));
    const names = [...new Set(walls.map(w => w.level))].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || String(a).localeCompare(String(b)));
    return { walls, skipped, levels: names };
}
