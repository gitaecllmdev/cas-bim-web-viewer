// Demo 7, "2D + 3D" tab: the plan beside the model, picks shown in both, floor by floor, measuring and drawing areas
// on the plan. The plan is the shared 2D viewer of core/client/views.js.
// Viewer3D (select, fitToView, getExtension, loadExtension, toolController, GEOMETRY_LOADED_EVENT): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// MeasureExtension (activate 'distance' | 'area' | 'arc' | 'calibrate', deactivate): https://aps.autodesk.com/en/docs/viewer/v7/reference/Extensions/MeasureExtension/
// Edit2D (registerDefaultTools, defaultTools.polygonTool / polygonEditTool, setAreaLabelVisible, defaultContext.clearLayer):
//   https://aps.autodesk.com/en/docs/viewer/v7/developers_guide/advanced_options/edit2d-setup/
//   https://aps.autodesk.com/en/docs/viewer/v7/developers_guide/advanced_options/edit2d-use/
//   https://aps.autodesk.com/en/docs/viewer/v7/developers_guide/advanced_options/edit2d-manual/
import { escapeHtml } from '../../helpers.js';

const MEASURE_2D = { distance: 'Distance', area: 'Area', arc: 'Arc', calibrate: 'Calibrate' };
const PICKS = { framing: 'a framing wall', shaft: 'a shaft wall', doors: 'a door', mep: 'an MEP fixture' };

export class TwoD {
    constructor(tour) {
        this.tour = tour;
        this.views = tour.views;
        this.registered = new WeakSet(); // Edit2D extensions whose default tools are registered (one per sheet load)
    }

    html() {
        return `<section class="ex-sec" data-sec="layout"><h3><span>1</span> The plan beside the model</h3>
                <p class="ex-note">One Revit file gives the 3D model and its <span data-sheet-count>sheets and views</span>: pick any of them in <b>Plan / sheet</b> above. Both viewers share what is picked, isolated and colored.</p>
                <div class="ex-row"><div class="tk-tabs">${[['3d', '3D'], ['split', '3D + plan'], ['2d', 'Plan only']].map(([k, l]) => `<button data-lay="${k}">${l}</button>`).join('')}</div>
                    <span class="muted" data-sheet-name></span></div></section>
            <section class="ex-sec" data-sec="link"><h3><span>2</span> Pick in either, see it in both</h3>
                <div class="ex-row">${Object.entries(PICKS).map(([k, l]) => `<button class="pg-btn" data-pick-random="${k}">Pick ${l}</button>`).join('')}</div>
                <div class="ex-row"><span class="ex-lbl">Colors</span><button class="pg-btn" data-plan-color="studs">Walls by stud size</button>
                    <button class="pg-btn" data-plan-color="level">By level</button><button class="pg-btn" data-plan-color="off">Off</button></div>
                <p class="ex-note" data-link-note>Pick something in 3D and its floor plan opens with it highlighted; pick a wall on the plan and the 3D view selects it. Colors and isolation show on both.</p></section>
            <section class="ex-sec" data-sec="floors"><h3><span>3</span> Floor by floor</h3>
                <div class="ex-row"><button class="pg-btn" data-floor="-1">▼ Floor below</button><span class="ex-floor" data-floor-name></span>
                    <button class="pg-btn" data-floor="1">Floor above ▲</button><button class="pg-btn" data-floor="0">All floors</button></div>
                <p class="ex-note">The 3D view is cut at the floor (its ceilings hidden) and the plan switches to that floor's sheet.</p></section>
            <section class="ex-sec" data-sec="measure2d"><h3><span>4</span> Measure on the plan</h3>
                <div class="ex-row">${Object.entries(MEASURE_2D).map(([k, l]) => `<button class="pg-btn" data-m2="${k}">${l}</button>`).join('')}<button class="pg-btn" data-m2="off">Stop</button></div>
                <p class="ex-note">Measures on a Revit sheet come out in real units, through each view's scale. Area and arc are 2D tools; Calibrate sets the scale of any drawing from a known length.</p></section>
            <section class="ex-sec" data-sec="edit2d"><h3><span>5</span> Draw areas on the plan</h3>
                <div class="ex-row"><button class="pg-btn" data-e2="draw">▱ Draw an area</button><button class="pg-btn" data-e2="edit">Move or reshape</button>
                    <button class="pg-btn" data-e2="clear">Clear</button><button class="pg-btn" data-e2="off">Stop</button></div>
                <p class="ex-note" data-e2-note>Click the corners and double-click to finish, or drag a rectangle; each shape shows its area. Shapes stay on this sheet until it changes.</p></section>`;
    }

    bind(root) {
        root.querySelectorAll('[data-lay]').forEach(b => b.onclick = () => { this.views.setLayout(b.dataset.lay); this.refresh(); });
        root.querySelectorAll('[data-pick-random]').forEach(b => b.onclick = () => this.pickRandom(b.dataset.pickRandom));
        root.querySelectorAll('[data-plan-color]').forEach(b => b.onclick = () => this.tour.setColorMode(b.dataset.planColor));
        root.querySelectorAll('[data-floor]').forEach(b => b.onclick = () => this.tour.stepFloor(Number(b.dataset.floor)));
        root.querySelectorAll('[data-m2]').forEach(b => b.onclick = () => this.measure(b.dataset.m2));
        root.querySelectorAll('[data-e2]').forEach(b => b.onclick = () => this.edit2d(b.dataset.e2));
        this.root = root;
        this.refresh();
    }

    // The layout buttons, the open sheet's name and the floor follow the header.
    refresh() {
        if (!this.root) return;
        this.root.querySelectorAll('[data-lay]').forEach(b => b.classList.toggle('active', b.dataset.lay === this.views.layout));
        const name = this.views.model2d?.getDocumentNode()?.name();
        this.root.querySelector('[data-sheet-name]').textContent = name ? `Plan: ${name}` : '';
        this.root.querySelector('[data-floor-name]').textContent = this.views.level?.name || 'Whole building';
        const sheets = this.views.sheets.length;
        if (sheets) this.root.querySelector('[data-sheet-count]').textContent = `${sheets.toLocaleString()} sheets and views`;
    }

    // The plan viewer with a sheet loaded (opens the split layout and waits for the sheet if needed).
    async plan() {
        if (!this.views.showing2d) this.views.setLayout('split');
        if (!this.views.model2d) await new Promise(resolve => { const off = this.views.on('sheet', () => { off(); resolve(); }); });
        this.refresh();
        return this.views.viewer2d;
    }

    // A random object of a group: selected in 3D (mirrored to the plan by views.syncSelection), its floor's plan opened.
    async pickRandom(group) {
        const note = this.root.querySelector('[data-link-note]');
        const pool = this.tour.objects.filter(o => o.group === group && o.level && this.views.levels.some(l => l.name === o.level));
        if (!pool.length) { note.textContent = `No ${PICKS[group].replace(/^an? /, '')} with a level in this model.`; return; }
        const o = pool[Math.floor(Math.random() * pool.length)];
        this.tour.showGroupsFor(o);
        // The plan first: swapping the sheet clears the plan's selection, and with it the 3D one (they mirror each other).
        const viewer2d = await this.plan();
        const sheet = this.views.planFor(o.level);
        if (sheet && sheet !== this.views.model2d?.getDocumentNode()) await this.views.openSheet(sheet);
        const model2d = this.views.model2d;
        // A wall: views.zoomToPick frames it in 3D and on the plan when it is selected. Anything else: framed here the
        // same way (views.frameWithContext), with room around it.
        const show = () => {
            this.views.select([o.dbId]); // mirrored to the plan (views.syncSelection)
            if (this.views.zoomPick && this.views.wallLevel.has(o.dbId)) return;
            this.views.frameWithContext(this.tour.viewer, this.tour.model, o.dbId, 2.5, 0);
            if (model2d && this.views.model2d === model2d && model2d.isLoadDone()) this.views.frameWithContext(viewer2d, model2d, o.dbId, 3, 1 / 6);
        };
        show();
        // Once the plan's objects are all there, select and zoom it there too.
        if (model2d && !model2d.isLoadDone()) viewer2d.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, function once(ev) {
            if (ev.model !== model2d) return;
            viewer2d.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, once);
            show();
        });
        this.refresh();
        note.innerHTML = `Picked <b>${escapeHtml(o.type || o.cat)}</b> on ${escapeHtml(o.level)}: selected in 3D and on ${escapeHtml(this.views.model2d?.getDocumentNode()?.name() || 'the plan')}.`;
    }

    async measure(mode) {
        this.tour.stopTools();
        const viewer2d = await this.plan();
        await this.stopEdit2d(viewer2d);
        const ext = viewer2d.getExtension('Autodesk.Measure') || await viewer2d.loadExtension('Autodesk.Measure');
        this.root.querySelectorAll('[data-m2]').forEach(b => b.classList.toggle('active', b.dataset.m2 === mode && mode !== 'off'));
        if (mode === 'off') ext.deactivate(); else ext.activate(mode);
    }

    async edit2d(action) {
        this.tour.stopTools();
        const viewer2d = await this.plan();
        viewer2d.getExtension('Autodesk.Measure')?.deactivate();
        this.root.querySelectorAll('[data-m2]').forEach(b => b.classList.remove('active'));
        const ed = viewer2d.getExtension('Autodesk.Edit2D') || await viewer2d.loadExtension('Autodesk.Edit2D');
        if (!this.registered.has(ed)) {
            ed.registerDefaultTools();
            ed.defaultTools.polygonTool.setAreaLabelVisible(true);
            ed.defaultTools.polygonEditTool.setAreaLabelVisible(true);
            this.registered.add(ed);
        }
        if (action === 'clear') { ed.defaultContext.clearLayer(); return; }
        await this.stopEdit2d(viewer2d);
        const tool = { draw: ed.defaultTools.polygonTool, edit: ed.defaultTools.polygonEditTool }[action];
        if (tool) viewer2d.toolController.activateTool(tool.getName());
        this.root.querySelectorAll('[data-e2]').forEach(b => b.classList.toggle('active', b.dataset.e2 === action && !!tool));
    }

    // Leave any Edit2D tool (the Edit2D guide's tool switching: deactivate the active "Edit2..." tool).
    async stopEdit2d(viewer2d = this.views.viewer2d) {
        const active = viewer2d?.toolController.getActiveTool();
        if (active?.getName().startsWith('Edit2')) viewer2d.toolController.deactivateTool(active.getName());
        this.root?.querySelectorAll('[data-e2]').forEach(b => b.classList.remove('active'));
    }

    stop() {
        this.views.viewer2d?.getExtension('Autodesk.Measure')?.deactivate();
        this.stopEdit2d();
        this.root?.querySelectorAll('[data-m2]').forEach(b => b.classList.remove('active'));
    }
}
