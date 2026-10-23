// Walls that meet a panel, from a model's set (Batch Sheets): where another exported wall of the same level tees into
// this one, where this one butts into another, and the corners. Context only, like levels and grids (context-lines.mjs):
// nothing here adds, moves or checks a member, the plan or the cut list. Pure; tested in tests/junctions.test.js.
//
// From each panel's revit export (locationLine start/end, orientation, sideA, leftEnd, thicknessIn, levelName,
// outlineOffsetIn, elementId). Approximate: the export does not say which face a location line is on, so each wall is
// taken as centered on its line (positions can be off by up to a finish layer).
//
// wallJunctions(set, panel) -> [{ kind: 'tee' | 'corner', role: 'through' | 'butts', end: 'left' | 'right' | null,
//   xIn, fromIn, toIn (through: the other wall's faces along this panel, clamped to it), side: 'A' | 'B' | null (through:
//   the face the other wall is on), other: { id, mark, uniqueId, thicknessIn }, text }], sorted by xIn.
// At a corner the longer wall (location line) runs through; equal lengths: the lower element id (the older wall).
import { shapeTop } from './generator.mjs';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const xyOf = (p) => (Array.isArray(p) && p.length >= 2 && finite(p[0]) && finite(p[1]) ? [p[0], p[1]] : null);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const r16 = (v) => Math.round(v * 16) / 16;
const SLACK = 1; // inches past a face or an end still counted as meeting
const PARALLEL = Math.cos(10 * Math.PI / 180); // walls within 10 degrees of each other never tee or corner

// The wall in plan: its ends, direction, length, side A's outward normal, thickness, level, where its left end is.
export function wallInPlan(panel) {
    const r = panel?.revit;
    const s = xyOf(r?.locationLine?.start), e = xyOf(r?.locationLine?.end);
    if (!r || !s || !e || !(finite(r.thicknessIn) && r.thicknessIn > 0) || !Array.isArray(r.orientation)) return null;
    const v = sub(e, s), len = Math.hypot(...v), n = Math.hypot(r.orientation[0], r.orientation[1]);
    if (!(len > 1e-6) || !(n > 1e-9)) return null;
    const sign = r.sideA === 'interior' ? -1 : 1;
    return {
        s, e, dir: [v[0] / len, v[1] / len], len, sideA: [sign * r.orientation[0] / n, sign * r.orientation[1] / n], t: r.thicknessIn,
        level: r.levelName ?? null, z: Array.isArray(r.locationLine.start) && finite(r.locationLine.start[2]) ? r.locationLine.start[2] : null,
        leftAtEnd: /(^|-)end$/.test(String(r.leftEnd || '')), offset: Array.isArray(r.outlineOffsetIn) && finite(r.outlineOffsetIn[0]) ? r.outlineOffsetIn[0] : 0,
        elementId: finite(Number(r.elementId)) ? Number(r.elementId) : null, uniqueId: String(r.uniqueId || ''),
    };
}
const sameLevel = (a, b) => (a.level != null && b.level != null ? a.level === b.level : a.z != null && b.z != null && Math.abs(a.z - b.z) <= 0.5);
// Which wall runs through a corner: the longer; equal lengths, the lower element id (else the UniqueId).
export function runsThrough(a, b) {
    if (Math.abs(a.len - b.len) > 1 / 16) return a.len > b.len;
    if (a.elementId != null && b.elementId != null && a.elementId !== b.elementId) return a.elementId < b.elementId;
    return a.uniqueId < b.uniqueId;
}

export function wallJunctions(set, panel) {
    const me = wallInPlan(panel);
    if (!me) return [];
    const L = shapeTop(panel.shape).lengthIn;
    // Along this wall's location line from its start -> this panel's x from its left end (the panel face's datum).
    const xOf = (u) => (me.leftAtEnd ? me.len - u : u) - me.offset;
    const endOf = (k) => ((k === 0) !== me.leftAtEnd ? 'left' : 'right'); // k: 0 the line's start, 1 its end
    const clamp = (v) => r16(Math.min(Math.max(v, 0), L > 0 ? L : v));
    const out = [];
    for (const other of set?.panels || []) {
        if (!other || other === panel || other.id === panel.id) continue;
        const it = wallInPlan(other);
        if (!it || !sameLevel(me, it) || Math.abs(dot(me.dir, it.dir)) > PARALLEL) continue;
        const ref = { id: other.id ?? null, mark: String(other.mark || ''), uniqueId: it.uniqueId, thicknessIn: it.t };
        const name = ref.mark || 'another wall';
        const myEnds = [me.s, me.e], itsEnds = [it.s, it.e], cornerTol = (me.t + it.t) / 2 + SLACK;
        const usedMine = new Set(), usedIts = new Set();
        // Corners: an end of each wall at the same place.
        for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) {
            if (usedMine.has(k) || usedIts.has(j) || Math.hypot(...sub(myEnds[k], itsEnds[j])) > cornerTol) continue;
            usedMine.add(k); usedIts.add(j);
            const through = runsThrough(me, it), x = xOf(dot(sub(itsEnds[j], me.s), me.dir));
            const away = sub(itsEnds[1 - j], itsEnds[j]), side = dot(away, me.sideA) >= 0 ? 'A' : 'B';
            out.push(through
                ? { kind: 'corner', role: 'through', end: endOf(k), xIn: clamp(x), fromIn: clamp(x - it.t / 2), toIn: clamp(x + it.t / 2), side, other: ref,
                    text: `Corner: runs through; ${name} meets side ${side}` }
                : { kind: 'corner', role: 'butts', end: endOf(k), xIn: endOf(k) === 'left' ? 0 : r16(L), fromIn: null, toIn: null, side: null, other: ref,
                    text: `Corner: butts into ${name}` });
        }
        // Tees: the other wall's end on this wall (this one runs through).
        for (let j = 0; j < 2; j++) {
            if (usedIts.has(j)) continue;
            const w = sub(itsEnds[j], me.s), u = dot(w, me.dir), perp = Math.abs(w[0] * me.dir[1] - w[1] * me.dir[0]);
            if (perp > me.t + SLACK || u < -SLACK || u > me.len + SLACK) continue;
            const x = xOf(u), side = dot(sub(itsEnds[1 - j], itsEnds[j]), me.sideA) >= 0 ? 'A' : 'B';
            out.push({ kind: 'tee', role: 'through', end: null, xIn: clamp(x), fromIn: clamp(x - it.t / 2), toIn: clamp(x + it.t / 2), side, other: ref,
                text: `${name} meets side ${side}` });
        }
        // Tees: this wall's end on the other wall (the other runs through).
        for (let k = 0; k < 2; k++) {
            if (usedMine.has(k)) continue;
            const w = sub(myEnds[k], it.s), u = dot(w, it.dir), perp = Math.abs(w[0] * it.dir[1] - w[1] * it.dir[0]);
            if (perp > it.t + SLACK || u < -SLACK || u > it.len + SLACK) continue;
            out.push({ kind: 'tee', role: 'butts', end: endOf(k), xIn: endOf(k) === 'left' ? 0 : r16(L), fromIn: null, toIn: null, side: null, other: ref,
                text: `Butts into ${name}` });
        }
    }
    return out.sort((a, b) => a.xIn - b.xIn || a.other.mark.localeCompare(b.other.mark));
}

export const APPROXIMATE = 'Approximate: each wall is taken as centered on its location line (the export does not say which face the line is on).';
