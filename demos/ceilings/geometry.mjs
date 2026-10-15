// Value-only, orthogonal ceiling geometry. Inches, x/y in the ceiling plane; no DOM or Revit dependencies.
export const EPS = 1e-7;
export const area = p => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
export function bounds(p) {
    return { minX: Math.min(...p.map(q => q[0])), maxX: Math.max(...p.map(q => q[0])), minY: Math.min(...p.map(q => q[1])), maxY: Math.max(...p.map(q => q[1])) };
}
export function inside(p, polygon) {
    let yes = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
    }
    return yes;
}
export const rectPolygon = r => [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.depth], [r.x, r.y + r.depth]];
export function onSegment(p, a, b) {
    return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) < EPS &&
        p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}
export function subtractRectangles(a, b, rectangles) {
    const axis = Math.abs(b[0] - a[0]) > EPS ? 0 : 1, other = 1 - axis, lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis]);
    const relevant = rectangles.filter(r => a[other] >= (other === 0 ? r.x : r.y) - EPS && a[other] <= (other === 0 ? r.x + r.width : r.y + r.depth) + EPS);
    const cuts = unique([lo, hi, ...relevant.flatMap(r => axis === 0 ? [r.x, r.x + r.width] : [r.y, r.y + r.depth]).filter(n => n > lo && n < hi)]), result = [];
    for (let i = 1; i < cuts.length; i++) {
        const mid = (cuts[i - 1] + cuts[i]) / 2;
        if (relevant.some(r => mid >= (axis === 0 ? r.x : r.y) - EPS && mid <= (axis === 0 ? r.x + r.width : r.y + r.depth) + EPS)) continue;
        const p = [...a], q = [...a]; p[axis] = cuts[i - 1]; q[axis] = cuts[i]; result.push([p, q]);
    }
    return result;
}
const unique = ns => [...new Set(ns)].sort((a, b) => a - b);
export function validateOutline(p) {
    if (!Array.isArray(p) || p.length < 4 || p.length > 48 || p.some(q => !Array.isArray(q) || q.length !== 2 || q.some(n => !Number.isFinite(n) || Math.abs(n) > 12000))) return 'Use 4–48 finite footprint corners within 1,000 feet of the local origin.';
    const n = p.length;
    for (let i = 0; i < n; i++) {
        const a = p[i], b = p[(i + 1) % n];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS || (Math.abs(a[0] - b[0]) > EPS && Math.abs(a[1] - b[1]) > EPS)) return 'This base version supports horizontal and vertical footprint edges. Remove repeated corners and diagonal edges.';
        for (let j = i + 1; j < n; j++) {
            if (j === i + 1 || (i === 0 && j === n - 1)) continue;
            const c = p[j], d = p[(j + 1) % n];
            if (Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) + EPS &&
                Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) + EPS) return 'Footprint edges must not cross or touch other edges.';
        }
    }
    return area(p) > EPS ? null : 'The footprint must have a positive area.';
}
// Partition only at actual boundary coordinates. This handles concave outlines and subtracts a UNION of holes.
export function piecesInBox(polygon, holes, box) {
    const all = polygon.concat(...holes.map(rectPolygon));
    const xs = unique([box.minX, box.maxX, ...all.map(p => p[0]).filter(x => x > box.minX && x < box.maxX)]);
    const ys = unique([box.minY, box.maxY, ...all.map(p => p[1]).filter(y => y > box.minY && y < box.maxY)]);
    const result = [];
    for (let i = 1; i < xs.length; i++) for (let j = 1; j < ys.length; j++) {
        const point = [(xs[i - 1] + xs[i]) / 2, (ys[j - 1] + ys[j]) / 2];
        if (inside(point, polygon) && !holes.some(r => point[0] > r.x - EPS && point[0] < r.x + r.width + EPS && point[1] > r.y - EPS && point[1] < r.y + r.depth + EPS)) result.push({ x: xs[i - 1], y: ys[j - 1], width: xs[i] - xs[i - 1], depth: ys[j] - ys[j - 1] });
    }
    return result;
}
// Main/cross member centerlines. Stations on the perimeter are supplied by the perimeter members instead.
export function clipStation(polygon, holes, vertical, station) {
    const loops = [polygon, ...holes.map(rectPolygon)], cuts = [];
    for (const loop of loops) for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length], u = vertical ? 0 : 1, v = 1 - u;
        if ((a[u] <= station && b[u] > station) || (b[u] <= station && a[u] > station)) cuts.push(a[v] + (station - a[u]) / (b[u] - a[u]) * (b[v] - a[v]));
    }
    const sorted = unique(cuts), result = [];
    for (let i = 1; i < sorted.length; i++) {
        const mid = (sorted[i - 1] + sorted[i]) / 2, point = vertical ? [station, mid] : [mid, station];
        if (inside(point, polygon) && !holes.some(r => inside(point, rectPolygon(r)))) result.push(vertical ? [[station, sorted[i - 1]], [station, sorted[i]]] : [[sorted[i - 1], station], [sorted[i], station]]);
    }
    return result;
}
