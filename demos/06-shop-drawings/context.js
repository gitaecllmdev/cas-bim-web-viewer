// Framing context for one wall, read from the model (what ./conditions.mjs interprets). Documented Viewer calls only:
//   Rooms beside the wall: Viewer3D.hitTest on the wall's level plan (Revit plans carry the rooms as selectable areas;
//     the 3D views don't). Head and base: vertical hit tests (clientToWorld) inside a cut-plane column over and under
//     the wall, so the first hit is the slab above or below it. Within 1 ft: elevation hit tests from both sides with
//     the wall hidden, inside the context box. clientToWorld honors the cut planes (checked on the Snowdon model).
// Viewer3D (hitTest, clientToWorld, worldToClient, setCutPlanes, isolate, hide, show, fitToView, getBulkProperties):
//   https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Navigation (setView, setCameraUpVector, setVerticalFov): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Navigation/
import { getBulkProperties, propValue } from '../../helpers.js';

const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
// Wait until the camera stops moving (fitToView and sheet loads animate it), up to about 3 s.
async function settle(viewer, maxFrames = 90) {
    let last = '', same = 0;
    for (let i = 0; i < maxFrames && same < 3; i++) {
        await frame();
        const c = viewer.getCamera();
        const key = [c.position.x, c.position.y, c.position.z, c.target?.x, c.target?.y, c.orthoScale, c.fov].map(n => Number(n || 0).toFixed(4)).join();
        same = key === last ? same + 1 : 0;
        last = key;
    }
}
const norm2 = ([x, y]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const Z = () => new THREE.Vector3(0, 0, 1);

// Wall frame (see wallscan.js): s along u from the left end, d into the wall from side A (0 = side A face), z absolute.
export function wallPoint(g, s, d, z) {
    const p = g.origin.clone().add(g.u.clone().multiplyScalar(s)).add(g.n.clone().multiplyScalar(-d));
    p.z = z;
    return p;
}
export const wallSize = (g) => ({ L: g.lengthIn / 12, H: g.heightIn / 12, D: (g.depthIn || 12) / 12, base: g.origin.z, top: g.origin.z + g.heightIn / 12 });

// Cut planes keeping lo <= (p - origin) . axis <= hi for each bound (ax + by + cz + d > 0 is cut away).
export function boxPlanes(origin, bounds) {
    const planes = [];
    for (const { axis, lo, hi } of bounds) {
        const o = origin.dot(axis);
        planes.push(new THREE.Vector4(axis.x, axis.y, axis.z, -(o + hi)));
        planes.push(new THREE.Vector4(-axis.x, -axis.y, -axis.z, o + lo));
    }
    return planes;
}

// The context box: pad feet past the wall on every side (the wall runs back from side A along -n).
export function contextBox(g, pad) {
    const { L, H, D } = wallSize(g);
    return boxPlanes(g.origin, [{ axis: g.u, lo: -pad, hi: L + pad }, { axis: Z(), lo: -pad, hi: H + pad }, { axis: g.n, lo: -D - 0.01 - pad, hi: pad }]);
}

// Category and type name for hits, grouped per model (all views of one Revit file share one property database).
async function describe(hits) {
    const byModel = new Map();
    for (const h of hits) {
        if (!byModel.has(h.model)) byModel.set(h.model, new Set());
        byModel.get(h.model).add(h.dbId);
    }
    const info = new Map();
    for (const [model, ids] of byModel) {
        for (const r of await getBulkProperties(model, [...ids], ['Category', 'Type Name'])) {
            info.set(r.dbId, { category: propValue(r, 'Category') || '', name: propValue(r, 'Type Name') || r.name || '' });
        }
    }
    return info;
}

// --- Rooms beside the wall, from its level plan in the 2D pane --------------------------------------------------

// Returns { A: { number, name }, B: {...} } or { note } when the plan can't be read.
export async function roomsBeside(views, g, dbId) {
    const v2 = views.viewer2d, m2 = views.model2d;
    if (!views.showing2d || !v2 || !m2 || !v2.container.clientWidth) return { note: 'Show the plan (Split layout) to read the rooms beside the wall.' };
    const { L, D } = wallSize(g);
    // A sheet that was just opened is still streaming in (Model.isLoadDone), and its fit animates the view.
    for (let i = 0; i < 150 && !m2.isLoadDone(); i++) await new Promise(r => setTimeout(r, 100));
    await settle(v2);
    v2.fitToView([dbId], m2, true);
    v2.isolate([], m2); // the rooms must be visible to hit-test them
    const W = v2.container.clientWidth, H = v2.container.clientHeight, cx = W / 2, cy = H / 2;
    // Plans show the model from above: model +x to the right, +y up the screen (screen y runs down).
    const us = norm2([g.u.x, -g.u.y]), ns = norm2([g.n.x, -g.n.y]);
    // The pick buffer is re-drawn over a few frames: wait until the wall answers somewhere along its axis (the middle
    // can be a doorway), up to about 1.5 s.
    const seesWall = () => [0, -0.3, 0.3, -0.15, 0.15].some(f => v2.hitTest(cx + us[0] * f * W, cy + us[1] * f * W, false)?.dbId === dbId);
    for (let i = 0; i < 45 && !seesWall(); i++) await frame();
    try {
        const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
        // The wall's extent on screen, walking its axis from the middle of the (fitted) view.
        const reach = Math.hypot(W, H) / 2;
        let lo = Infinity, hi = -Infinity, found = 0;
        for (let t = -reach; t <= reach; t += 3) {
            for (const o of [-1, 1]) {
                const x = cx + us[0] * t + ns[0] * o, y = cy + us[1] * t + ns[1] * o;
                if (!inside(x, y)) continue;
                if (v2.hitTest(x, y, false)?.dbId === dbId) { lo = Math.min(lo, t); hi = Math.max(hi, t); found++; }
            }
        }
        if (found < 6 || hi - lo < 20) return { note: `The wall is not on ${m2.getDocumentNode()?.name?.() || 'this plan'}; open its level plan to read the rooms.` };
        const pxPerFt = (hi - lo) / L, mid = (lo + hi) / 2;
        const sample = () => {
            const hits = { A: [], B: [] };
            for (const [side, sgn] of [['A', 1], ['B', -1]]) {
                for (const dFt of [1.5, 3, 5]) {
                    for (const f of [-0.35, -0.15, 0.15, 0.35]) {
                        const t = mid + f * (hi - lo), off = (D / 2 + dFt) * pxPerFt * sgn;
                        const x = cx + us[0] * t + ns[0] * off, y = cy + us[1] * t + ns[1] * off;
                        if (!inside(x, y)) continue;
                        const h = v2.hitTest(x, y, false);
                        if (h?.dbId > 0 && h.dbId !== dbId) hits[side].push(h.dbId);
                    }
                }
            }
            return hits;
        };
        let hits = sample();
        if (!hits.A.length && !hits.B.length) { // room fills can land a few frames after the walls
            for (let i = 0; i < 20; i++) await frame();
            hits = sample();
        }
        const ids = [...new Set([...hits.A, ...hits.B])];
        const rooms = new Map();
        for (const r of ids.length ? await getBulkProperties(views.viewer3d.model, ids, ['Category', 'Name', 'Number']) : []) {
            if (/rooms?$/i.test(propValue(r, 'Category') || '')) rooms.set(r.dbId, { dbId: r.dbId, number: propValue(r, 'Number') || '', name: propValue(r, 'Name') || '' });
        }
        const pickRoom = (list) => {
            const counts = new Map();
            for (const id of list) if (rooms.has(id)) counts.set(id, (counts.get(id) || 0) + 1);
            const best = [...counts].sort((a, b) => b[1] - a[1])[0];
            return best ? rooms.get(best[0]) : null;
        };
        return { A: pickRoom(hits.A), B: pickRoom(hits.B), plan: m2.getDocumentNode()?.name?.() || '' };
    } finally {
        views.applyColors(v2, m2); // plans show isolation with colors, never Viewer isolation (views.js)
        views.frame2d();
    }
}

// --- Slab above and below: vertical probes in a column over / under the wall ------------------------------------

// Columns (depth ranges from side A, feet): over the wall itself, and 3" to 12" beside each face. Floors are cut by the
// walls standing on them and slabs stop at shaft openings, so the surface next to the wall often tells more.
const EDGE = 0.1; // feet
const COLUMNS = (D) => [{ where: 'over the wall', d0: -0.02, d1: D + 0.02 }, { where: 'beside side A', d0: -1, d1: -0.25 }, { where: 'beside side B', d0: D + 0.25, d1: D + 1 }];

async function probeColumn(viewer, g, up, col) {
    const v = viewer, nav = v.navigation, { L, D, base, top } = wallSize(g);
    // The column starts 1 1/4" inside the wall's height (the wall is hidden): a cut exactly at the slab face would remove
    // that face, and the ray would go on through the open cut to the far side of the slab.
    const zLo = up ? top - EDGE : base - 40, zHi = up ? top + 40 : base + EDGE;
    v.setCutPlanes(boxPlanes(g.origin, [{ axis: g.u, lo: 0.02 * L, hi: 0.98 * L }, { axis: g.n, lo: -col.d1, hi: -col.d0 },
        { axis: Z(), lo: zLo - g.origin.z, hi: zHi - g.origin.z }]));
    const dMid = (col.d0 + col.d1) / 2;
    const eye = wallPoint(g, L / 2, dMid, up ? top + 0.05 : base - 0.05);
    const dist = Math.max(L * 1.3, 8), span = Math.max(L, D) * 1.15 + 1;
    nav.setVerticalFov((2 * Math.atan(span / 2 / dist) * 180) / Math.PI, false); // the whole wall length on screen
    nav.setView(eye, eye.clone().add(Z().multiplyScalar(up ? dist : -dist)));
    nav.setCameraUpVector(g.u.clone()); // the wall's length runs up the screen
    await frame();
    const hits = [], W = v.container.clientWidth, Hc = v.container.clientHeight;
    for (const f of [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92]) {
        for (const t of [0.3, 0.7]) {
            const sc = v.worldToClient(wallPoint(g, f * L, col.d0 + t * (col.d1 - col.d0), up ? top + 1 : base - 1));
            if (sc.x < 0 || sc.y < 0 || sc.x >= W || sc.y >= Hc) continue;
            const h = v.clientToWorld(sc.x, sc.y, true);
            if (h?.model && h.dbId > 0 && (up ? h.point.z > top - EDGE : h.point.z < base + EDGE)) hits.push({ dbId: h.dbId, model: h.model, z: h.point.z, where: col.where });
        }
    }
    return hits;
}

const STRUCTURE = /floors?$|roofs?$|structural|ceilings?$|slab/i;

// Nearest slab (or roof, ceiling) over and under the wall: { above: { z, category, name, dbId, where } | null, below }.
export async function probeSlabs(viewer, g, dbId) {
    const upHits = [], downHits = [];
    viewer.hide(dbId, viewer.model);
    try {
        for (const col of COLUMNS(wallSize(g).D)) {
            upHits.push(...await probeColumn(viewer, g, true, col));
            downHits.push(...await probeColumn(viewer, g, false, col));
        }
    } finally {
        viewer.setCutPlanes([]);
        viewer.show(dbId, viewer.model);
    }
    const info = await describe([...upHits, ...downHits]);
    const pick = (hits, up) => {
        const withInfo = hits.map(h => ({ ...h, ...(info.get(h.dbId) || {}) }));
        const slabs = withInfo.filter(h => STRUCTURE.test(h.category));
        const list = slabs.length ? slabs : withInfo;
        if (!list.length) return null;
        // Nearest surface: the lowest hit above, the highest below (median of the nearest few for noise).
        const sorted = [...list].sort((a, b) => (up ? a.z - b.z : b.z - a.z));
        const best = sorted[Math.floor(Math.min(sorted.length - 1, 1))];
        return { z: best.z, dbId: best.dbId, category: best.category, name: best.name, where: best.where, zMin: Math.min(...list.map(h => h.z)), zMax: Math.max(...list.map(h => h.z)) };
    };
    return { above: pick(upHits, true), below: pick(downHits, false) };
}

// --- Everything within pad feet of the wall: elevation hit tests from side A and side B, the wall hidden ------------

export async function probeNearby(viewer, g, dbId, pad = 1) {
    const v = viewer, nav = v.navigation, { L, H, D, base } = wallSize(g);
    v.hide(dbId, v.model);
    v.setCutPlanes(contextBox(g, pad));
    const items = new Map();
    try {
        const step = Math.max(0.75, Math.max(L, H) / 50); // feet; about 800 hit tests a side
        for (const side of [1, -1]) {
            const target = wallPoint(g, L / 2, D / 2, base + H / 2);
            nav.setView(target.clone().add(g.n.clone().multiplyScalar(200 * side)), target);
            nav.setCameraUpVector(Z());
            const span = Math.max(L, H) + 2 * pad + 2;
            nav.setVerticalFov(2 * Math.atan(span / 2 / 200) * 180 / Math.PI * 1.1, false);
            await frame();
            const W = v.container.clientWidth, Hc = v.container.clientHeight;
            for (let s = -pad; s <= L + pad; s += step) {
                for (let z = base - pad; z <= base + H + pad; z += step) {
                    const sc = v.worldToClient(wallPoint(g, s, side > 0 ? -pad : D + pad, z));
                    if (sc.x < 0 || sc.y < 0 || sc.x >= W || sc.y >= Hc) continue;
                    const h = v.clientToWorld(sc.x, sc.y, true);
                    if (!h?.model || !(h.dbId > 0) || h.dbId === dbId) continue;
                    const key = `${h.model.id}:${h.dbId}`;
                    const sAlong = new THREE.Vector3().subVectors(h.point, g.origin).dot(g.u);
                    const prev = items.get(key);
                    // For walls keep the hit nearest an end, so a wall meeting the end is recognized as such.
                    const endDist = Math.min(Math.abs(sAlong), Math.abs(L - sAlong));
                    if (!prev || endDist < prev.endDist) items.set(key, { dbId: h.dbId, model: h.model, s: sAlong, endDist });
                }
            }
        }
    } finally {
        v.setCutPlanes([]);
        v.show(dbId, v.model);
    }
    const list = [...items.values()];
    const info = await describe(list);
    return list.map(it => ({ dbId: it.dbId, s: it.s, ...(info.get(it.dbId) || {}) }));
}
