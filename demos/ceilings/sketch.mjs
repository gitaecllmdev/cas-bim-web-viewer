// Shared value-only sketch edits. The browser handles gestures; these functions retain exact local coordinates.
import { bounds, piecesInBox, validateOutline } from './geometry.mjs';

export const snap = (v, step = 1) => Math.round(v / step) * step;
export function boundaryCursor(point, points, { step = 1, tolerance = 3 } = {}) {
    let p = point.map(v => snap(v, step));
    const first = points[0], last = points.at(-1);
    if (points.length >= 3 && Math.hypot(point[0] - first[0], point[1] - first[1]) <= tolerance) return { point: [...first], closing: true };
    if (last) {
        const horizontal = Math.abs(point[0] - last[0]) >= Math.abs(point[1] - last[1]);
        p = horizontal ? [p[0], last[1]] : [last[0], p[1]];
        const axis = horizontal ? 0 : 1;
        const aligned = points.map(q => q[axis]).find(v => Math.abs(v - p[axis]) <= tolerance);
        if (aligned != null) p[axis] = aligned;
    }
    return { point: p, closing: false };
}
export function closeBoundary(points) {
    const p = points.map(q => [...q]);
    if (p.length > 1 && Math.hypot(p.at(-1)[0] - p[0][0], p.at(-1)[1] - p[0][1]) < .001) p.pop();
    if (p.length < 3) return { error: 'Place at least three corners before closing the footprint.' };
    const first = p[0], last = p.at(-1);
    if (first[0] !== last[0] && first[1] !== last[1]) { const before = p.at(-2); p.push(before[0] === last[0] ? [first[0], last[1]] : [last[0], first[1]]); }
    // Collinear clicks are harmless; remove them so grip edits remain orthogonal.
    let changed = true;
    while (changed && p.length > 4) { changed = false; for (let i = 0; i < p.length; i++) { const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length]; if ((a[0] === b[0] && b[0] === c[0] && (b[1]-a[1])*(c[1]-b[1]) >= 0) || (a[1] === b[1] && b[1] === c[1] && (b[0]-a[0])*(c[0]-b[0]) >= 0)) { p.splice(i, 1); changed = true; break; } } }
    const error = validateOutline(p); return error ? { error } : { outline: p };
}
export function rectFromPoints(a, b) { return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), depth: Math.abs(b[1] - a[1]) }; }
export function moveOpening(opening, delta, step = 1) { return { ...opening, x: snap(opening.x + delta[0], step), y: snap(opening.y + delta[1], step) }; }
export function resizeOpening(opening, corner, point, step = 1) {
    const opposite = [corner.includes('w') ? opening.x + opening.width : opening.x, corner.includes('s') ? opening.y + opening.depth : opening.y];
    return { ...opening, ...rectFromPoints(opposite, point.map(v => snap(v, step))) };
}
export function openingError(outline, opening, others = []) {
    if (opening.width < 1 || opening.depth < 1) return 'Draw an opening at least 1 inch wide and deep.';
    const box = { minX: opening.x, maxX: opening.x + opening.width, minY: opening.y, maxY: opening.y + opening.depth };
    const covered = piecesInBox(outline, [], box).reduce((sum, r) => sum + r.width * r.depth, 0);
    if (Math.abs(covered - opening.width * opening.depth) > 1e-6) return 'Keep the opening inside the ceiling footprint.';
    if (others.some(o => o.id !== opening.id && Math.min(o.x+o.width, opening.x+opening.width)-Math.max(o.x, opening.x) > 1e-7 && Math.min(o.y+o.depth, opening.y+opening.depth)-Math.max(o.y, opening.y) > 1e-7)) return 'Openings and fixtures cannot overlap.';
    return null;
}
export function moveCorner(outline, index, point, step = 1) {
    const p = outline.map(q => [...q]), n = p.length, before = (index + n - 1) % n, after = (index + 1) % n, old = p[index], next = point.map(v => snap(v, step));
    const beforeAxis = p[before][0] === old[0] ? 0 : 1, afterAxis = p[after][0] === old[0] ? 0 : 1;
    p[before][beforeAxis] = next[beforeAxis]; p[after][afterAxis] = next[afterAxis]; p[index] = next;
    return p;
}
export function moveEdge(outline, index, delta, step = 1) {
    const p = outline.map(q => [...q]), next = (index + 1) % p.length, axis = p[index][0] === p[next][0] ? 0 : 1;
    const value = snap(p[index][axis] + delta[axis], step); p[index][axis] = value; p[next][axis] = value; return p;
}
export function outlineEdit(ceiling, outline) {
    const error = validateOutline(outline) || ceiling.openings.map(o => openingError(outline, o)).find(Boolean);
    if (error) return { error };
    const b = bounds(outline); return { outline, shape: 'custom', lengthIn: b.maxX - b.minX, depthIn: b.maxY - b.minY };
}
