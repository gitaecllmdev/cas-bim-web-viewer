// Reads a wall's frame and openings from the model geometry, for the shop drawings (Demo 6) and the takeoff (Demo 2).
// The Snowdon 3D view has no door/window objects, so openings are the holes in the wall. Documented Viewer calls only:
//   1) Top view: hit points on the wall footprint -> the wall's long axis (u), its ends, and the face we look at.
//   2) Elevation view (narrow field of view): hit-test the face on a ~1" grid; gaps inside the wall are openings.
// Viewer3D (isolate, fitToView, clientToWorld, worldToClient, setGhosting, getState, restoreState):
//   https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Navigation (setView, getTarget, getEyeVector, setVerticalFov): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Navigation/
// Scans are saved per wall (externalId) in the 'wall-openings' state, shared by both demos.
import { loadState, saveState, buildingCenter, stateFor } from '../../helpers.js';
import { fmtFtIn } from './framing.mjs';

const STATE_NAME = 'wall-openings';
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

// The scan reads the rendered 3D view, so it must be on screen: with the 2D-only layout, switch to Split.
export async function ensure3dShown(viewer, views) {
    if (viewer.container.clientWidth > 0 && viewer.container.clientHeight > 0) return;
    views?.setLayout('split');
    viewer.resize();
    await frame();
}

// Look straight at side A of the wall with a narrow field of view (near-orthographic).
export async function lookAtWall(viewer, elevation) {
    const nav = viewer.navigation;
    nav.setVerticalFov(10, false);
    nav.setView(elevation.target.clone().add(elevation.n.clone().multiplyScalar(200)), elevation.target, elevation.up);
    viewer.fitToView([elevation.dbId], viewer.model, true);
    await frame();
}

// wall: { level (level object from views.levelOf, or null), heightFt (Revit Unconnected Height), baseOffsetFt }.
// Returns { origin, u, n, up, lengthIn, heightIn, depthIn, openings, notes, elevation }: origin is the bottom left corner of
// side A (the face we look at), u runs along the wall, up is +Z, n points out of side A. Leaves the wall isolated in elevation;
// the caller restores the view (see scanWalls).
export async function scanWall(viewer, dbId, { level, heightFt, baseOffsetFt = 0 } = {}) {
    const v = viewer, model = v.model, nav = v.navigation;
    if (!v.container.clientWidth || !v.container.clientHeight) throw new Error('the 3D view is hidden; switch the layout to 3D or Split');
    v.getExtension('Autodesk.Section')?.deactivate(false); // the level cut would clip tall walls
    v.setGhosting(false);
    v.isolate([dbId], model);
    v.fitToView([dbId], model, true);
    const c0 = nav.getTarget().clone(), d0 = nav.getEyeVector().length();
    nav.setView(new THREE.Vector3(c0.x, c0.y, c0.z + d0 * 2), c0, new THREE.Vector3(0, 1, 0));
    v.fitToView([dbId], model, true);
    await frame();
    try {
        // 1) Footprint points from above.
        const rect = v.container.getBoundingClientRect();
        const pts = [];
        for (let x = 0; x < rect.width; x += 3) for (let y = 0; y < rect.height; y += 3) {
            const hit = v.clientToWorld(x, y, true);
            if (hit && hit.dbId === dbId) pts.push(hit.point);
        }
        if (pts.length < 8) throw new Error('the wall was not found in the top view');
        const mean = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
        let sxx = 0, sxy = 0, syy = 0;
        for (const p of pts) { const dx = p.x - mean.x, dy = p.y - mean.y; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
        const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        const u = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
        const n = new THREE.Vector3(-u.y, u.x, 0);
        const up = new THREE.Vector3(0, 0, 1);
        // Look from the building-interior side ("side A"); make screen-right = +u so the drawing matches the view.
        const center = buildingCenter(model); // the building's walls, not objects far off the site
        if (new THREE.Vector3().subVectors(center, mean).dot(n) < 0) n.multiplyScalar(-1);
        const right = new THREE.Vector3().crossVectors(n.clone().multiplyScalar(-1), up);
        if (right.dot(u) < 0) u.multiplyScalar(-1);
        const ns = pts.map(p => new THREE.Vector3().subVectors(p, mean).dot(n));
        const faceT = Math.max(...ns) + 0.01; // just in front of the face
        const depthIn = (Math.max(...ns) - Math.min(...ns)) * 12; // wall thickness (the footprint's width)
        const ss = pts.map(p => new THREE.Vector3().subVectors(p, mean).dot(u));
        const sMin = Math.min(...ss) - 0.2, sMax = Math.max(...ss) + 0.2; // feet; widened, trimmed by the face scan

        // 2) Elevation.
        const target = mean.clone().add(u.clone().multiplyScalar((sMin + sMax) / 2));
        const elevation = { target, n, u, up, dbId };
        await lookAtWall(v, elevation);
        const ray = (s, z) => {
            const p = mean.clone().add(u.clone().multiplyScalar(s)).add(n.clone().multiplyScalar(faceT));
            p.z = z;
            const sc = v.worldToClient(p);
            const hit = v.clientToWorld(sc.x, sc.y, true);
            return !!(hit && hit.dbId === dbId);
        };
        // The geometry's lowest and highest points, from a few columns across the wall.
        let gLo = Infinity, gHi = -Infinity;
        const box = model.getBoundingBox(); // heights only (objects far off the site are off to the side, not above)
        for (const f of [0.05, 0.15, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 0.95]) {
            const s = sMin + (sMax - sMin) * f;
            for (let z = box.min.z; z <= box.max.z; z += 1 / 12) if (ray(s, z)) { gLo = Math.min(gLo, z); gHi = Math.max(gHi, z); }
        }
        if (!Number.isFinite(gLo)) throw new Error('the wall face was not found in elevation');
        // Base from Revit (level + Base Offset): a storefront or door can take out the bottom of the face.
        // Top: where the geometry stops, capped at the Revit height (Unconnected Height).
        let zLo, zHi, fromModel = false;
        if (level && heightFt > 0) {
            zLo = level.z + baseOffsetFt;
            zHi = Math.min(zLo + heightFt, gHi + 1 / 24);
            fromModel = zHi > zLo + 0.5;
        }
        if (!fromModel) { zLo = gLo - 1 / 24; zHi = gHi + 1 / 24; }
        // Fine grid (about 1" steps, coarser on very large walls).
        const lengthFt = sMax - sMin, hFt = zHi - zLo;
        const step = Math.max(1 / 12, Math.max(lengthFt, hFt) / 320);
        const cols = Math.ceil(lengthFt / step), rows = Math.ceil(hFt / step);
        const grid = new Uint8Array(cols * rows);
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) grid[j * cols + i] = ray(sMin + (i + 0.5) * step, zLo + (j + 0.5) * step) ? 1 : 0;
        const hitCols = [], hitRows = [];
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if (grid[j * cols + i]) { hitCols.push(i); hitRows.push(j); }
        if (!hitCols.length) throw new Error('the wall face was not found in elevation');
        const i0 = Math.min(...hitCols), i1 = Math.max(...hitCols);
        const j0 = fromModel ? 0 : Math.min(...hitRows), j1 = fromModel ? rows - 1 : Math.max(...hitRows);
        // Openings: groups of misses inside the wall's extent (with a scanned height: only those clear of its ends and top).
        const openings = [], notes = [];
        const seen = new Uint8Array(cols * rows);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const k = j * cols + i;
            if (grid[k] || seen[k]) continue;
            const stack = [[i, j]]; seen[k] = 1;
            let minI = i, maxI = i, minJ = j, maxJ = j, edge = false;
            while (stack.length) {
                const [a, b] = stack.pop();
                minI = Math.min(minI, a); maxI = Math.max(maxI, a); minJ = Math.min(minJ, b); maxJ = Math.max(maxJ, b);
                if (!fromModel && (a === i0 || a === i1 || b === j1)) edge = true; // known extent: every gap inside it is an opening
                for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const x = a + da, y = b + db;
                    if (x < i0 || x > i1 || y < j0 || y > j1) continue;
                    const kk = y * cols + x;
                    if (!grid[kk] && !seen[kk]) { seen[kk] = 1; stack.push([x, y]); }
                }
            }
            if (edge) continue;
            const toIn = (cells) => cells * step * 12;
            const o = { left: toIn(minI - i0), right: toIn(maxI - i0 + 1), bottom: minJ === j0 ? 0 : toIn(minJ - j0), top: maxJ === j1 ? toIn(j1 - j0 + 1) : toIn(maxJ - j0 + 1) };
            // A gap across (nearly) the whole wall is a beam, slab or soffit passing through, or a stepped top, not an opening.
            if (maxI - minI + 1 >= 0.9 * (i1 - i0 + 1) && minJ !== j0) {
                notes.push(`Gap across the wall from ${fmtFtIn(o.bottom)} to ${fmtFtIn(o.top)} (beam, slab or stepped top?): not framed as an opening. Verify the top of wall.`);
                continue;
            }
            // A tall opening that starts within 12" of the bottom is a door (the wall starts below the finished floor).
            if (o.bottom > 0 && o.bottom < 12 && o.top - o.bottom > 72) o.bottom = 0;
            openings.push(o);
        }
        const origin = mean.clone().add(u.clone().multiplyScalar(sMin + i0 * step)).add(n.clone().multiplyScalar(faceT));
        origin.z = zLo + j0 * step;
        return { origin, u, n, up, lengthIn: (i1 - i0 + 1) * step * 12, heightIn: (j1 - j0 + 1) * step * 12, depthIn, openings, notes, elevation };
    } finally {
        v.setGhosting(true);
    }
}

// Saved scans: externalId -> { lengthIn, heightIn, openings, notes, at }.
export const loadScans = async () => loadState(await stateFor(STATE_NAME)).catch(() => ({})); // per model
export async function saveScan(externalId, geom) {
    if (!externalId) return;
    const scans = await loadScans();
    scans[externalId] = { lengthIn: geom.lengthIn, heightIn: geom.heightIn, openings: geom.openings, notes: geom.notes, at: new Date().toISOString() };
    await saveState(await stateFor(STATE_NAME), scans);
}

// Scan many walls, then put the view back (camera, field of view, isolation, level cut).
// walls: [{ dbId, externalId, level, heightFt, baseOffsetFt }]; onProgress(done, total); isCancelled() -> true to stop.
export async function scanWalls(viewer, views, walls, { onProgress, isCancelled } = {}) {
    await ensure3dShown(viewer, views);
    const saved = viewer.getState({ viewport: true });
    const fov = viewer.getCamera().fov;
    const scans = await loadScans();
    let done = 0, failed = 0;
    try {
        for (const w of walls) {
            if (isCancelled?.()) break;
            try {
                const g = await scanWall(viewer, w.dbId, { level: views.levelOf(w.level), heightFt: w.heightFt, baseOffsetFt: w.baseOffsetFt });
                if (w.externalId) scans[w.externalId] = { lengthIn: g.lengthIn, heightIn: g.heightIn, openings: g.openings, notes: g.notes, at: new Date().toISOString() };
            } catch (err) {
                failed++;
                console.warn(`Wall ${w.dbId} not scanned: ${err.message || err}`);
            }
            done++;
            onProgress?.(done, walls.length);
            if (done % 20 === 0) await saveState(await stateFor(STATE_NAME), scans); // keep progress if the page is closed
        }
    } finally {
        await saveState(await stateFor(STATE_NAME), scans).catch(err => console.warn('Scans not saved:', err.message));
        viewer.navigation.setVerticalFov(fov, false);
        views.isolate(views.isolated, { fit: false });
        if (!views.isolated) viewer.isolate([], viewer.model);
        viewer.restoreState(saved, null, true);
        await views.setLevel(views.level?.name || null); // re-applies the level cut
    }
    return { scans, done, failed };
}
