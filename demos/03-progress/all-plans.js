// All floor plans at once, beside the schedule (Demo 3): the master plan of every floor the schedule works on, side by
// side in a 2D viewer of its own over the plan pane, the walls colored like the model, so the sequence shows floor by
// floor while the schedule plays (as planned on the timeline's date, or as installed). It does not touch the shared
// views (one plan pane): its own viewer, its own colors, closed with its button or by the demo.
// Several sheets in one viewer: Viewer3D.loadDocumentNode with keepCurrentModels and placementTransform (documented
// loadModel options); Viewer3D start, finish, setThemingColor, clearThemingColors, worldToClient, CAMERA_CHANGE_EVENT;
// Model getBoundingBox; Navigation fitBounds: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
import { toThemingColor, escapeHtml } from '../../helpers.js';
import { PlanPop } from '../../plan-pop.mjs';

export class AllPlans {
    constructor(views) {
        this.views = views;
        this.cells = []; // { names (the levels the plan shows), label, model, x, y } in grid order, bottom floor first
        this.colors = new Map();
    }

    get isOpen() {
        return !!this.viewer;
    }

    // levels: [{ name }] bottom to top. onProgress(done, total, name); onClose(): the user closed it.
    async open(levels, { onProgress = () => {}, onClose = () => {} } = {}) {
        const views = this.views;
        this.close();
        if (!views.showing2d) views.setLayout('split');
        views.setPlanCovered(true); // nothing to color under it meanwhile
        this.loading = true;
        let loaded;
        this.opening = new Promise(r => { loaded = r; });
        try {
            await this.load(levels, { onProgress, onClose });
        } finally {
            this.loading = false;
            loaded();
        }
    }

    // The plans are in and their colors drawn (a schedule playing waits for this before each next day).
    async settled() {
        if (this.loading) await this.opening;
        await Promise.race([this.pop?.whenDrawn(), new Promise(r => setTimeout(r, 2000))]);
    }

    async load(levels, { onProgress, onClose }) {
        const views = this.views;
        const pane = views.el.container2d.parentElement;
        const run = (this.run = (this.run || 0) + 1);
        const box = this.box = document.createElement('div');
        box.className = 'all-plans';
        box.innerHTML = `<div class="ap-bar"><b>All floor plans</b> <span class="muted" data-ap-status></span>
            <button data-ap-close title="Back to one floor's plan">✕ Close</button></div>
            <div class="ap-view" data-ap-view><div class="ap-labels" data-ap-labels></div></div>`;
        pane.appendChild(box);
        box.querySelector('[data-ap-close]').onclick = () => { this.close(); onClose(); };
        const viewer = this.viewer = new Autodesk.Viewing.Viewer3D(box.querySelector('[data-ap-view]'), {});
        viewer.start();
        viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, () => this.placeLabels());
        this.pop = new PlanPop(viewer); // the colored walls thicker while the plans are small (plan-pop.mjs)
        // The pane changes size (layout, dock): the viewer re-measures and the plans are framed again.
        this.resizer = new ResizeObserver(() => { if (this.viewer) { this.viewer.resize(); this.frame(); } });
        this.resizer.observe(box);
        // One cell per plan (two levels drawn on one plan share it), bottom floor first.
        const plans = [];
        for (const l of levels) {
            const node = views.planFor(l.name);
            if (!node) continue;
            const same = plans.find(p => p.node === node);
            if (same) same.names.push(l.name); else plans.push({ node, names: [l.name] });
        }
        const view = box.querySelector('[data-ap-view]');
        let size = null, cols = 1;
        for (let i = 0; i < plans.length; i++) {
            if (run !== this.run) return;
            onProgress(i, plans.length, plans[i].names.join(' / '));
            this.status(`Loading ${i + 1} of ${plans.length}: ${plans[i].names.join(' / ')}…`);
            const col = i % cols, row = Math.floor(i / cols);
            const x = size ? col * size.x * 1.04 : 0, y = size ? -row * size.y * 1.08 : 0;
            const model = await viewer.loadDocumentNode(views.doc, plans[i].node, { keepCurrentModels: true, placementTransform: new THREE.Matrix4().makeTranslation(x, y, 0) });
            // Colors need its objects (Model.getObjectTree) and its geometry (GEOMETRY_LOADED_EVENT).
            await new Promise(res => model.getObjectTree(res, res));
            if (!model.isLoadDone()) {
                await new Promise(res => viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, function once(ev) {
                    if (ev.model === model) { viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, once); res(); }
                }));
            }
            if (run !== this.run) return;
            if (!size) {
                // The first sheet sets the cell size; as many columns as suit the pane's shape for this many sheets.
                size = model.getBoundingBox().getSize(new THREE.Vector3());
                const W = view.clientWidth || 1, H = view.clientHeight || 1;
                let best = 0;
                for (let c = 1; c <= plans.length; c++) {
                    const r = Math.ceil(plans.length / c), scale = Math.min(W / (c * size.x * 1.04), H / (r * size.y * 1.08));
                    if (scale > best) { best = scale; cols = c; }
                }
            }
            this.cells.push({ names: plans[i].names, model, x, y, w: size.x, h: size.y });
            this.colorCell(this.cells.at(-1));
            this.frame();
        }
        this.status(`${this.cells.length} plans`);
        this.pop?.setColors([...this.colors.values()]);
        onProgress(plans.length, plans.length, '');
    }

    status(text) {
        const el = this.box?.querySelector('[data-ap-status]');
        if (el) el.textContent = text;
    }

    frame() {
        if (!this.cells.length) return;
        const xs = this.cells.flatMap(c => [c.x, c.x + c.w]), ys = this.cells.flatMap(c => [c.y, c.y + c.h]);
        this.viewer.navigation.fitBounds(true, new THREE.Box3(new THREE.Vector3(Math.min(...xs), Math.min(...ys), -1), new THREE.Vector3(Math.max(...xs), Math.max(...ys), 1)));
        this.placeLabels();
    }

    // The floor's name over the top left corner of its sheet.
    placeLabels() {
        const layer = this.box?.querySelector('[data-ap-labels]');
        if (!layer || !this.viewer) return;
        layer.innerHTML = this.cells.map(c => {
            const p = this.viewer.worldToClient(new THREE.Vector3(c.x, c.y + c.h, 0));
            return p ? `<div class="ap-label" style="left:${p.x.toFixed(0)}px;top:${p.y.toFixed(0)}px">${escapeHtml(c.names.join(' / '))}</div>` : '';
        }).join('');
    }

    // colors: Map dbId -> hex, as the model shows them; each plan colors its own floors' walls.
    setColors(colors) {
        const prev = this.colors;
        this.colors = colors;
        for (const c of this.cells) this.colorCell(c, prev);
        this.pop?.setColors([...colors.values()]);
    }

    // A plan's walls in their colors: in full the first time, then only those whose color changed (no color:
    // intensity 0, the drawing as it is). Viewer3D setThemingColor: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
    colorCell(c, prev = null) {
        if (!this.viewer) return;
        c.ids ??= c.names.flatMap(name => this.views.wallsByLevel.get(name) || []);
        if (!prev || !c.colored) {
            this.viewer.clearThemingColors(c.model);
            for (const id of c.ids) { const hex = this.colors.get(id); if (hex) this.viewer.setThemingColor(id, toThemingColor(hex), c.model); }
            c.colored = true;
            return;
        }
        const none = new THREE.Vector4(0, 0, 0, 0);
        for (const id of c.ids) {
            const was = prev.get(id), now = this.colors.get(id);
            if (was !== now) this.viewer.setThemingColor(id, now ? toThemingColor(now) : none, c.model);
        }
    }

    close() {
        this.run = (this.run || 0) + 1;
        this.resizer?.disconnect();
        this.resizer = null;
        this.pop?.remove();
        this.pop = null;
        if (this.box || this.viewer) this.views.setPlanCovered(false); // the plan pane shows again: its colors back
        this.viewer?.finish();
        this.viewer = null;
        this.box?.remove();
        this.box = null;
        this.cells = [];
    }
}
