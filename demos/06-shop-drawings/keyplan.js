// Key plan for the title block of a framing shop drawing (sheet.mjs draws it): captured from the viewers by Demo 6.
// ext: the Demo 6 extension (its views, 3D viewer, plainBackdrop, drawOverlay, contextShown). The capture themes walls on
// its own for a moment (the wall red, the floor's walls blue or slate) and always puts the shared colors and isolation
// back through views (applyColors / isolate) and the cameras as they were, so the demo's own coloring is unchanged.
// The wall's floor plan around it, as drawn (the wall in red, the room names), with the whole floor inset (walls in
// blue, the wall marked): captured from the plan pane on the level's master 2D view and saved with the panel as a
// JPEG. Where the wall is on the sheet is not in the 2D data, so it is found in the image (the red of its theming
// color). Viewer3D getScreenShot (the canvas image as a Blob URL), fitToView, clientToWorld, worldToClient,
// setThemingColor, clearThemingColors, clearSelection, GEOMETRY_LOADED_EVENT; Navigation fitBounds, getPosition,
// getTarget, setView: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/ and
// https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Navigation/

// The level's master plan first, then its other sheets (a wall can be missing from the floor plan); a wall on no
// sheet (a soffit or valance, above the plan's cut) gets a key plan from the 3D model instead (keyplanFrom3d).
// The plan pane is put back on the sheet it showed.
export async function captureKeyplan(ext, c) {
    const views = ext.views;
    if (!views.showing2d) return null;
    const master = views.planFor(c.wall.level), was = views.model2d?.getDocumentNode() || null;
    const others = views.sheets.filter(x => x.levelName === c.wall.level && x.node !== master).map(x => x.node);
    try {
        for (const plan of [master, ...others].filter(Boolean)) {
            const keyplan = await keyplanOn(ext, c, plan);
            if (keyplan) return keyplan;
        }
    } finally {
        if (was && views.model2d?.getDocumentNode() !== was) await views.openSheet(was);
    }
    return ext.contextShown ? null : keyplanFrom3d(ext, c); // the context box would hide the floor
}

// The key plan from one 2D view, or null when the wall is not on it.
async function keyplanOn(ext, c, plan) {
    const views = ext.views;
    if (plan !== views.model2d?.getDocumentNode()) await views.openSheet(plan);
    const viewer = views.viewer2d, model = views.model2d;
    if (!viewer || !model || model.getDocumentNode() !== plan) return null;
    if (!model.isLoadDone()) {
        await new Promise(res => viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, function once(ev) {
            if (ev.model === model) { viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, once); res(); }
        }));
    }
    const cw = viewer.container.clientWidth, ch = viewer.container.clientHeight;
    if (!cw || !ch) return null;
    const nav = viewer.navigation, from = nav.getPosition().clone(), to = nav.getTarget().clone();
    const settle = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 600)));
    const shot = () => new Promise((res, rej) => viewer.getScreenShot(0, 0, (url) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = url; }));
    const pixels = (img) => { const cv = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }); const g = cv.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height); };
    // Bounding box [x0, y0, x1, y1] in image pixels of the pixels that pass test(r, g, b, index), or null.
    const bboxOf = (data, test) => {
        let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
        const { width, height, data: d } = data;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (test(d[i], d[i + 1], d[i + 2], i)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        return x1 < 0 ? null : [x0, y0, x1, y1];
    };
    const isRed = (r, g, b) => r > 150 && r - g > 80 && r - b > 80, isBlue = (r, g, b) => b > 150 && b - r > 60 && b - g > 30;
    const KW = 820, KH = 288, A = KW / KH; // the title block cell's shape (sheet.mjs)
    const red = new THREE.Vector4(0.86, 0.06, 0.08, 1), blue = new THREE.Vector4(0.18, 0.43, 0.84, 1);
    try {
        viewer.clearSelection();
        viewer.clearThemingColors(model);
        // 1. The wall alone, to find it on the sheet: what turns red when it is themed (the sheet may have red of its own).
        viewer.fitToView([c.dbId], model, true);
        await settle();
        const plain = pixels(await shot());
        viewer.setThemingColor(c.dbId, red, model);
        await settle();
        let img = await shot(), k = img.width / cw; // image pixels per client pixel
        const themed = pixels(img);
        let wb = null;
        if (plain.width === themed.width && plain.height === themed.height) {
            const d0 = plain.data, d1 = themed.data;
            wb = bboxOf(themed, (r, g, b, i) => isRed(r, g, b) && Math.abs(d0[i] - d1[i]) + Math.abs(d0[i + 1] - d1[i + 1]) + Math.abs(d0[i + 2] - d1[i + 2]) > 90);
        }
        if (!wb) return null; // not on this plan
        const world = (x, y) => viewer.clientToWorld(x / k, y / k, true)?.point;
        const p0 = world(wb[0], wb[1]), p1 = world(wb[2], wb[3]);
        if (!p0 || !p1) return null;
        const center = new THREE.Vector3((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, 0);
        const wallW = Math.abs(p1.x - p0.x), wallH = Math.abs(p1.y - p0.y), sheet = model.getBoundingBox().getSize(new THREE.Vector3());
        // 2. The detail: the wall with the rooms around it (a short wall: at least a ninth of the sheet across), the wall
        // outlined and named.
        const halfW = Math.max(wallW * 0.7, wallH * 0.6 * A, sheet.x / 18), halfH = halfW / A;
        nav.fitBounds(true, new THREE.Box3(new THREE.Vector3(center.x - halfW, center.y - halfH, -1), new THREE.Vector3(center.x + halfW, center.y + halfH, 1)));
        await settle();
        img = await shot(); k = img.width / cw;
        const q0 = viewer.worldToClient(new THREE.Vector3(center.x - halfW, center.y + halfH, 0)), q1 = viewer.worldToClient(new THREE.Vector3(center.x + halfW, center.y - halfH, 0));
        const out = Object.assign(document.createElement('canvas'), { width: KW, height: KH }), g = out.getContext('2d');
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, KW, KH);
        g.drawImage(img, q0.x * k, q0.y * k, (q1.x - q0.x) * k, (q1.y - q0.y) * k, 0, 0, KW, KH);
        const toKp = (p) => { const v = viewer.worldToClient(new THREE.Vector3(p.x, p.y, 0)); return [((v.x - q0.x) / (q1.x - q0.x)) * KW, ((v.y - q0.y) / (q1.y - q0.y)) * KH]; };
        const [ax, ay] = toKp(p0), [bx, by] = toKp(p1);
        const wx0 = Math.min(ax, bx) - 5, wy0 = Math.min(ay, by) - 5, wx1 = Math.max(ax, bx) + 5, wy1 = Math.max(ay, by) + 5;
        g.strokeStyle = '#d90f14';
        g.lineWidth = 2.5;
        g.strokeRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
        const label = String(c.mark || ''), fs = 15;
        g.font = `bold ${fs}px Arial, Helvetica, sans-serif`;
        const tw = g.measureText(label).width + 10;
        let lx = Math.min(Math.max((wx0 + wx1) / 2 - tw / 2, 2), KW - tw - 2), ly = wy0 - fs - 8;
        if (ly < 2) ly = Math.min(wy1 + 4, KH - fs - 8);
        g.fillStyle = '#ffffff';
        g.fillRect(lx, ly, tw, fs + 6);
        g.strokeRect(lx, ly, tw, fs + 6);
        g.fillStyle = '#d90f14';
        g.fillText(label, lx + 5, ly + fs);
        // 3. The whole floor: this level's walls in blue, cropped to them, inset in the corner farthest from the wall,
        // with the wall circled.
        const walls = views.wallsByLevel.get(c.wall.level) || [];
        for (const id of walls) if (id !== c.dbId) viewer.setThemingColor(id, blue, model);
        viewer.fitToView(walls.length ? walls : [c.dbId], model, true);
        await settle();
        img = await shot(); k = img.width / cw;
        const fb = bboxOf(pixels(img), isBlue) || [0, 0, img.width - 1, img.height - 1];
        const spot = viewer.worldToClient(center);
        const pad = Math.max(fb[2] - fb[0], fb[3] - fb[1]) * 0.03, sx = fb[0] - pad, sy = fb[1] - pad, sw = fb[2] - fb[0] + 2 * pad, sh = fb[3] - fb[1] + 2 * pad;
        const sc = Math.min(250 / sw, 120 / sh), iw = sw * sc, ih = sh * sc, bw = iw + 8, bh = ih + 8;
        const corners = [[4, 4], [KW - bw - 4, 4], [4, KH - bh - 4], [KW - bw - 4, KH - bh - 4]];
        const clear = ([x, y]) => x > wx1 + 6 || x + bw < wx0 - 6 || y > wy1 + 6 || y + bh < wy0 - 6;
        const far = ([x, y]) => -Math.hypot(x + bw / 2 - (wx0 + wx1) / 2, y + bh / 2 - (wy0 + wy1) / 2);
        const [ix, iy] = corners.find(clear) || [...corners].sort((p, q) => far(p) - far(q))[0];
        g.fillStyle = '#ffffff';
        g.fillRect(ix, iy, bw, bh);
        g.strokeStyle = '#7d848c';
        g.lineWidth = 1.5;
        g.strokeRect(ix, iy, bw, bh);
        g.drawImage(img, sx, sy, sw, sh, ix + 4, iy + 4, iw, ih);
        const mx = ix + 4 + (spot.x * k - sx) * sc, my = iy + 4 + (spot.y * k - sy) * sc;
        g.strokeStyle = '#d90f14';
        g.lineWidth = 3;
        g.beginPath(); g.arc(mx, my, 11, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#d90f14';
        g.beginPath(); g.arc(mx, my, 3.5, 0, Math.PI * 2); g.fill();
        return { href: out.toDataURL('image/jpeg', 0.85), w: KW, h: KH, level: c.wall.level || '', sheet: plan.name?.() || '', at: new Date().toISOString() };
    } finally {
        nav.setView(from, to);
        views.applyColors(viewer, model); // the shared colors and the isolated wall's highlight back
    }
}

// A key plan from the 3D model, for a wall on no 2D view: the floor's walls from above (orthographic, north up), this
// one in red and circled; no room names (the model's 3D has none), so it says where it came from. The 3D view's
// camera, isolation and colors are put back. Viewer3D getState / restoreState, isolate, setThemingColor, fitToView,
// getScreenShot; Navigation setVerticalFov, getTarget, getPosition, setView, orientCameraUp:
// https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/ and .../Viewing/Navigation/
async function keyplanFrom3d(ext, c) {
    const v = ext.viewer, model = v.model, views = ext.views;
    const walls = views.wallsByLevel.get(c.wall.level) || [];
    if (!model || !walls.length || !v.container.clientWidth) return null;
    const state = v.getState({ viewport: true }), isolated = views.isolated, cw = v.container.clientWidth;
    const settle = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 800)));
    const shot = () => new Promise((res, rej) => v.getScreenShot(0, 0, (url) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = url; }));
    const KW = 820, KH = 288;
    try {
        ext.plainBackdrop(); // white, no environment: the floor is what differs from the background
        v.isolate(walls, model);
        v.clearThemingColors(model);
        const slate = new THREE.Vector4(0.36, 0.4, 0.46, 1), red = new THREE.Vector4(0.86, 0.06, 0.08, 1);
        for (const id of walls) v.setThemingColor(id, id === c.dbId ? red : slate, model);
        const nav = v.navigation;
        nav.setVerticalFov(5, true); // nearly orthographic: the floor reads to scale from end to end
        v.fitToView(walls, model, true);
        const target = nav.getTarget().clone(), dist = nav.getPosition().distanceTo(target);
        // From straight above (Revit models are Z up), a hair to the south so north is up on the screen.
        nav.setView(target.clone().add(new THREE.Vector3(0, -dist * 1e-3, dist)), target);
        nav.orientCameraUp();
        v.fitToView(walls, model, true);
        await settle();
        const img = await shot(), k = img.width / cw;
        const cv = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), cg = cv.getContext('2d');
        cg.drawImage(img, 0, 0);
        const d = cg.getImageData(0, 0, img.width, img.height).data;
        let fb = [Infinity, Infinity, -1, -1], rb = [Infinity, Infinity, -1, -1];
        const bg = [d[0], d[1], d[2]]; // the corner: background
        for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
            const i = (y * img.width + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
            const grow = (bb) => { if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y; };
            if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 45) grow(fb);
            if (r > 150 && r - g > 80 && r - b > 80) grow(rb);
        }
        if (fb[2] < 0) return null;
        // The floor, fitted in the key plan's shape, centered; the wall circled.
        const pad = 6 * k, sw0 = fb[2] - fb[0] + 2 * pad, sh0 = fb[3] - fb[1] + 2 * pad;
        const sc = Math.min(KW / sw0, KH / sh0), sw = KW / sc, sh = KH / sc;
        const sx = (fb[0] + fb[2]) / 2 - sw / 2, sy = (fb[1] + fb[3]) / 2 - sh / 2;
        const out = Object.assign(document.createElement('canvas'), { width: KW, height: KH }), g = out.getContext('2d');
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, KW, KH);
        g.drawImage(img, sx, sy, sw, sh, 0, 0, KW, KH);
        if (rb[2] >= 0) {
            const mx = ((rb[0] + rb[2]) / 2 - sx) * sc, my = ((rb[1] + rb[3]) / 2 - sy) * sc;
            g.strokeStyle = '#d90f14';
            g.lineWidth = 3;
            g.beginPath(); g.arc(mx, my, Math.max(14, ((rb[2] - rb[0]) * sc) / 2 + 8), 0, Math.PI * 2); g.stroke();
            const label = String(c.mark || '');
            g.font = 'bold 15px Arial, Helvetica, sans-serif';
            const tw = g.measureText(label).width + 10, lx = Math.min(Math.max(mx - tw / 2, 2), KW - tw - 2), ly = my > KH / 2 ? Math.max(my - 44, 2) : Math.min(my + 22, KH - 23);
            g.fillStyle = '#ffffff'; g.fillRect(lx, ly, tw, 21); g.lineWidth = 2; g.strokeRect(lx, ly, tw, 21);
            g.fillStyle = '#d90f14'; g.fillText(label, lx + 5, ly + 16);
        }
        g.font = 'bold 13px Arial, Helvetica, sans-serif';
        const note = 'FROM THE 3D MODEL: NOT ON THE FLOOR PLAN (NO ROOM NAMES)', nw = g.measureText(note).width + 10;
        g.fillStyle = '#ffffff'; g.fillRect(KW - nw - 4, KH - 22, nw, 18);
        g.fillStyle = '#5f6368'; g.fillText(note, KW - nw + 1, KH - 8);
        return { href: out.toDataURL('image/jpeg', 0.85), w: KW, h: KH, level: c.wall.level || '', sheet: '3D model', at: new Date().toISOString() };
    } finally {
        v.clearThemingColors(model);
        v.restoreState(state, null, true);
        views.isolate(isolated, { fit: false }); // both views' isolation and colors as they were
        ext.drawOverlay?.();
    }
}
