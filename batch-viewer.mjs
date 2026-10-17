// Batch Sheets' 3D model view: the exported walls (demos/06-shop-drawings/wall-model.mjs) drawn with three.js, loaded
// from a pinned CDN build (board-approved 2026-10-16; no npm dependency, no bundling). A small subset of a model
// viewer: orbit (drag), pan (right drag or Shift+drag), zoom (wheel, toward the pointer), fit, top and 3D views, a
// level filter, a horizontal section at the level, click to pick (Ctrl/Shift to add), hover for the mark, and walls
// colored by framing state. Display only: picking reports panel ids; it never changes panels.
export const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

export const STATE_COLORS = { framed: '#4caf50', preliminary: '#f2b233', failed: '#e57373', 'not-framed': '#9e9e9e' };
const CURRENT = '#1e88e5', CHECKED = '#64b5f6';

export async function createModelView(host, { onPick = () => {}, onHover = () => {} } = {}) {
    const THREE = await import(THREE_URL);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0xf4f6f8, 1);
    host.appendChild(renderer.domElement);
    renderer.domElement.className = 'model-canvas';
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('aria-label', 'Model walls in 3D: drag to orbit, right-drag to pan, wheel to zoom, click a wall to open it');

    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    camera.up.set(0, 1, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(0.6, 1, 0.4); scene.add(sun);
    const group = new THREE.Group(); scene.add(group);
    const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

    let meshes = new Map(), offset = [0, 0, 0], current = null, checked = new Set(), level = '', section = false, states = new Map();
    let target = new THREE.Vector3(), radius = 50, theta = -Math.PI / 4, phi = Math.PI / 3.2, frame = 0;

    // Export inches (X, Y plan, Z up) to scene feet (x, y up, z = -Y), about the model's center so large site
    // coordinates keep full float precision in WebGL.
    const toScene = (x, y, z) => [(x - offset[0]) / 12, (z - offset[2]) / 12, -(y - offset[1]) / 12];

    function setWalls(walls) {
        for (const m of meshes.values()) { group.remove(m); m.geometry.dispose(); m.material.dispose(); }
        meshes = new Map();
        const all = walls.flatMap(w => w.positions);
        if (all.length) {
            const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
            for (let i = 0; i < all.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], all[i + k]); hi[k] = Math.max(hi[k], all[i + k]); }
            offset = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]];
        }
        for (const w of walls) {
            const pos = new Float32Array(w.positions.length);
            for (let i = 0; i < w.positions.length; i += 3) pos.set(toScene(w.positions[i], w.positions[i + 1], w.positions[i + 2]), i);
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
            const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: STATE_COLORS['not-framed'], side: THREE.DoubleSide, clippingPlanes: [] }));
            mesh.userData = { id: w.id, mark: w.mark, level: w.level, base: (w.base - offset[2]) / 12 };
            meshes.set(w.id, mesh); group.add(mesh);
        }
        restyle(); fit();
    }
    function restyle() {
        for (const [id, m] of meshes) {
            const lit = id === current ? CURRENT : checked.has(id) ? CHECKED : STATE_COLORS[states.get(id) || 'not-framed'];
            m.material.color.set(lit);
            m.material.emissive?.set(id === current ? 0x0d47a1 : 0x000000);
            m.visible = !level || m.userData.level === level;
            m.material.clippingPlanes = section ? [cut] : [];
            m.material.needsUpdate = true;
        }
        if (section) {
            const bases = [...meshes.values()].filter(m => m.visible).map(m => m.userData.base);
            cut.constant = (bases.length ? Math.min(...bases) : 0) + 4; // 4 ft above the level: a plan cut
        }
        draw();
    }
    function visibleBox() {
        const box = new THREE.Box3();
        for (const m of meshes.values()) if (m.visible) box.union(m.geometry.boundingBox);
        return box;
    }
    function fit(ids = null) {
        const box = new THREE.Box3();
        for (const [id, m] of meshes) if (m.visible && (!ids || ids.has(id))) box.union(m.geometry.boundingBox);
        if (box.isEmpty()) { box.copy(visibleBox()); if (box.isEmpty()) { draw(); return; } }
        box.getCenter(target);
        radius = Math.max(8, box.getSize(new THREE.Vector3()).length() * 0.9);
        draw();
    }
    function place() {
        const r = radius;
        camera.position.set(target.x + r * Math.sin(phi) * Math.cos(theta), target.y + r * Math.cos(phi), target.z + r * Math.sin(phi) * Math.sin(theta));
        camera.near = Math.max(0.05, r / 500); camera.far = r * 50;
        camera.lookAt(target); camera.updateProjectionMatrix();
    }
    function draw() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; place(); renderer.render(scene, camera); }); }
    function resize() {
        const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
        renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
        camera.aspect = w / h;
        place(); renderer.render(scene, camera); // resizing clears the canvas: redraw now, not on a later frame
    }
    const observer = new ResizeObserver(resize); observer.observe(host); resize();

    // Pointer: drag orbits (pans with the right button or Shift), a click without movement picks.
    const ray = new THREE.Raycaster();
    const hit = (e) => {
        const r = renderer.domElement.getBoundingClientRect();
        ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
        const found = ray.intersectObjects([...meshes.values()].filter(m => m.visible), false)
            .find(h => !section || h.point.y <= cut.constant + 1e-6);
        return found?.object.userData || null;
    };
    let down = null;
    const el = renderer.domElement;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey && e.button === 0 && !e.ctrlKey, moved: false }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => {
        if (!down) { const h = hit(e); onHover(h ? { id: h.id, mark: h.mark, level: h.level } : null); el.style.cursor = h ? 'pointer' : 'grab'; return; }
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!down.moved && Math.hypot(dx, dy) < 4) return;
        down.moved = true; down.x = e.clientX; down.y = e.clientY;
        if (down.pan) {
            const s = radius * 0.0016, right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
            target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
        } else { theta += dx * 0.008; phi = Math.min(Math.PI - 0.05, Math.max(0.05, phi - dy * 0.008)); }
        draw();
    });
    el.addEventListener('pointerup', e => {
        const d = down; down = null;
        if (d && !d.moved && e.button === 0) { const h = hit(e); onPick(h?.id ?? null, { additive: e.ctrlKey || e.metaKey || e.shiftKey }); }
    });
    el.addEventListener('wheel', e => {
        e.preventDefault();
        const f = Math.exp(Math.sign(e.deltaY) * 0.12), h = hit(e);
        if (h) { const m = meshes.get(h.id); const c = m.geometry.boundingSphere.center; target.lerp(c, 1 - f > 0 ? 0.15 : 0); }
        radius = Math.min(20000, Math.max(1, radius * f)); draw();
    }, { passive: false });

    return {
        setWalls,
        setStates(map) { states = new Map(map); restyle(); },
        setSelection(cur, set) { current = cur; checked = new Set(set); restyle(); },
        setLevel(name) { level = name || ''; restyle(); fit(); },
        setSection(on) { section = !!on; restyle(); },
        view(kind) { if (kind === 'top') { phi = 0.0001; theta = -Math.PI / 2; } else { theta = -Math.PI / 4; phi = Math.PI / 3.2; } fit(); },
        fit,
        focus(id) { if (meshes.has(id)) fit(new Set([id])); },
        snapshot() { place(); renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
        count: () => meshes.size,
        dispose() { observer.disconnect(); for (const m of meshes.values()) { m.geometry.dispose(); m.material.dispose(); } renderer.dispose(); el.remove(); },
    };
}
