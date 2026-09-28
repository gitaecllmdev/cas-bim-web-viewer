// The 3D model and a 2D plan/sheet from the same document, side by side.
// Revit 2D views and sheets use the same dbIds as the 3D model, so colors, isolation, hiding and
// selection set through this object show in both viewers, and are re-applied when another sheet opens.
// Demos get it as `this.options.views` and call views.* instead of viewer.* for those operations.
// Viewer3D (setThemingColor, isolate, hide, showAll, select, fitToView, resize, loadDocumentNode):
//   https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Model (isLoadDone: frame the plan only once its geometry is in): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Model/
// Section extension (setSectionBox, deactivate): https://aps.autodesk.com/en/docs/viewer/v7/reference/Extensions/SectionExtension/
// Document / BubbleNode (search for 2D viewables; levelName comes from the Revit manifest):
//   https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Document/
import { toThemingColor, getLevels, loadPropertyMap, findWalls, getBulkProperties, propValue, escapeHtml, fetchJson, loadState, saveState } from './helpers.js';

const LAYOUTS = ['3d', 'split', '2d'];

export class Views {
    constructor(viewer3d) {
        this.viewer3d = viewer3d;
        this.viewer2d = null; // created the first time the 2D pane is shown
        this.colors = new Map(); // dbId -> hex
        this.isolated = null; // dbIds, or null for no isolation
        this.hidden = [];
        this.level = null; // level object from getLevels(), or null for the whole building
        this.levels = [];
        this.wallsByLevel = new Map(); // level name -> wall dbIds (used to frame the 2D plan)
        this.sheets = []; // { node, folder, levelName }
        this.masters = {}; // level name -> master 2D view name (samples/level-views.json, then the user's ★ choices)
        this.extensions2d = new Map(); // extension id -> options, (re)loaded on the 2D viewer after each sheet
        this.listeners = { level: new Set(), sheet: new Set(), ready: new Set(), viewer2d: new Set() };
        this.el = {
            views: document.getElementById('views'),
            levels: document.getElementById('levels'),
            sheets: document.getElementById('sheets'),
            master: document.getElementById('master'),
            sheetStatus: document.getElementById('sheet-status'),
            container2d: document.getElementById('viewer2d'),
            layoutButtons: [...document.querySelectorAll('[data-layout]')],
        };
        this.el.levels.onchange = () => this.setLevel(this.el.levels.value || null);
        this.el.sheets.onchange = () => this.openSheet(this.sheets[Number(this.el.sheets.value)]?.node);
        this.el.layoutButtons.forEach(b => b.onclick = () => this.setLayout(b.dataset.layout));
        this.el.master.onclick = () => this.setMaster();
        this.syncSelection(viewer3d);
        const wanted = new URLSearchParams(location.search).get('layout');
        this.setLayout(LAYOUTS.includes(wanted) ? wanted : 'split', { open: false });
    }

    // --- Events: 'level' (level|null), 'sheet' (model2d), 'ready' (after a 3D model's levels/sheets are known),
    // 'viewer2d' (the 2D viewer, once created; fires immediately if it already exists)

    on(event, fn) {
        this.listeners[event].add(fn);
        if (event === 'viewer2d' && this.viewer2d) fn(this.viewer2d);
        return () => this.listeners[event].delete(fn);
    }

    emit(event, arg) {
        for (const fn of this.listeners[event]) {
            try { fn(arg); } catch (err) { console.error(err); }
        }
    }

    // [viewer, model] for each viewer that has a model loaded.
    get active() {
        return [this.viewer3d, this.viewer2d].filter(v => v?.model).map(v => [v, v.model]);
    }

    get model2d() {
        return this.viewer2d?.model || null;
    }

    // --- Shared visual state -------------------------------------------------------------------

    setColors(colors) {
        this.colors = new Map(colors);
        for (const [viewer, model] of this.active) this.applyColors(viewer, model);
    }

    clearColors() {
        this.setColors([]);
    }

    applyColors(viewer, model) {
        viewer.clearThemingColors(model);
        for (const [dbId, hex] of this.colors) viewer.setThemingColor(dbId, toThemingColor(hex), model);
    }

    // Isolate dbIds in both viewers (null/empty = show everything again). Fits the 3D view.
    isolate(ids, { fit = true } = {}) {
        this.isolated = ids?.length ? [...ids] : null;
        for (const [viewer, model] of this.active) viewer.isolate(this.isolated || [], model);
        if (fit && this.viewer3d.model) this.viewer3d.fitToView(this.isolated, this.viewer3d.model);
        if (fit && this.model2d) this.frame2d();
    }

    hide(ids) {
        this.hidden = [...new Set([...this.hidden, ...ids])];
        for (const [viewer, model] of this.active) viewer.hide(ids, model);
    }

    showAll() {
        this.isolated = null;
        this.hidden = [];
        for (const [viewer] of this.active) viewer.showAll();
    }

    select(ids) {
        if (this.viewer3d.model) this.viewer3d.select(ids, this.viewer3d.model); // mirrored to 2D by syncSelection
    }

    // Selecting in one viewer selects the same dbIds in the other.
    syncSelection(viewer) {
        viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, () => {
            const other = viewer === this.viewer3d ? this.viewer2d : this.viewer3d;
            if (this.syncing || !other?.model) return;
            const ids = viewer.getSelection();
            const current = other.getSelection();
            if (ids.length === current.length && ids.every(id => current.includes(id))) return;
            this.syncing = true;
            try {
                if (ids.length) other.select(ids, other.model); else other.clearSelection();
            } finally {
                this.syncing = false;
            }
        });
    }

    // --- Levels: section box in 3D + that level's plan in 2D -------------------------------------

    async setLevel(name) {
        const level = this.levels.find(l => l.name === name) || null;
        this.level = level;
        const params = new URLSearchParams(location.search); // keep the level in the link, so it can be sent
        if (level) params.set('level', level.name); else params.delete('level');
        history.replaceState(null, '', `?${params}${location.hash}`);
        this.el.levels.value = level?.name || '';
        const section = this.viewer3d.getExtension('Autodesk.Section') || await this.viewer3d.loadExtension('Autodesk.Section');
        if (level && this.viewer3d.model) {
            const world = this.viewer3d.model.getBoundingBox();
            section.setSectionBox(new THREE.Box3(
                new THREE.Vector3(world.min.x - 1, world.min.y - 1, level.bottom),
                new THREE.Vector3(world.max.x + 1, world.max.y + 1, level.top)));
        } else {
            section.deactivate(false);
        }
        if (this.showing2d) {
            const plan = this.planFor(level?.name);
            if (plan && plan !== this.viewer2d?.model?.getDocumentNode()) await this.openSheet(plan);
            else this.frame2d();
        }
        this.updateMasterButton();
        this.emit('level', level);
    }

    // The 2D view for a level: its master view (samples/level-views.json or the user's ★ choice), else a sheet
    // for that level, else a plan view. For "all levels": the master of the level with the most walls.
    planFor(levelName) {
        if (!levelName) {
            const busiest = [...this.wallsByLevel].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
            return busiest ? this.planFor(busiest) : this.sheets[0]?.node || null;
        }
        const master = this.masters[levelName] && this.sheets.find(s => s.node.name() === this.masters[levelName]);
        if (master) return master.node;
        const matches = this.sheets.filter(s => s.levelName === levelName);
        return (matches.find(s => s.folder === 'Sheets') || matches[0])?.node || null;
    }

    // ★ Master: make the open 2D view the one this level opens with (saved per user).
    async setMaster() {
        const name = this.model2d?.getDocumentNode().name();
        if (!this.level || !name) return;
        this.userMasters = { ...this.userMasters, [this.level.name]: name };
        this.masters[this.level.name] = name;
        this.updateMasterButton();
        await saveState('level-views', { masters: this.userMasters }).catch(err => console.warn('Master view not saved:', err.message));
    }

    updateMasterButton() {
        const b = this.el.master;
        const name = this.model2d?.getDocumentNode().name();
        b.disabled = !this.level || !name;
        const isMaster = this.level && name && this.masters[this.level.name] === name;
        b.classList.toggle('active', !!isMaster);
        b.textContent = isMaster ? '★ Master view' : '☆ Set as master';
        b.title = this.level ? `${isMaster ? 'This is' : 'Make this'} the view ${this.level.name} opens with` : 'Pick a level first';
    }

    // Zoom the 2D view to the isolated walls, else the current level's walls, else all walls
    // (fitToView ignores ids that aren't on the sheet, so this frames the plan, not the title block).
    // Not while the sheet is still loading: openSheet frames it once its geometry is in.
    frame2d() {
        const ids = this.isolated || (this.level ? this.wallsByLevel.get(this.level.name) : [...this.wallsByLevel.values()].flat());
        if (this.model2d?.isLoadDone() && ids?.length) this.viewer2d.fitToView(ids, this.model2d);
    }

    setSheetStatus(text, kind = '') {
        if (!this.el.sheetStatus) return;
        this.el.sheetStatus.textContent = text;
        this.el.sheetStatus.className = kind;
    }

    // --- 2D pane ---------------------------------------------------------------------------------

    get showing2d() {
        return this.layout !== '3d';
    }

    setLayout(layout, { open = true } = {}) {
        this.layout = layout;
        this.el.views.className = `layout-${layout}`;
        this.el.layoutButtons.forEach(b => b.classList.toggle('active', b.dataset.layout === layout));
        const params = new URLSearchParams(location.search);
        params.set('layout', layout);
        history.replaceState(null, '', `?${params}${location.hash}`);
        if (this.showing2d) this.ensureViewer2d();
        // Containers changed size; let both viewers re-measure their canvases.
        requestAnimationFrame(() => this.resize());
        if (open && this.showing2d && !this.model2d) this.openSheet(this.planFor(this.level?.name));
    }

    // After the containers change size (layout, the dock-bottom split bar): both viewers re-measure their canvases.
    resize() {
        [this.viewer3d, this.viewer2d].forEach(v => v?.resize());
    }

    ensureViewer2d() {
        if (this.viewer2d) return this.viewer2d;
        const viewer = new Autodesk.Viewing.GuiViewer3D(this.el.container2d, { extensions: [] });
        viewer.start();
        viewer.setTheme('light-theme');
        this.viewer2d = viewer;
        this.syncSelection(viewer);
        this.emit('viewer2d', viewer);
        return viewer;
    }

    // Load an extension on the 2D viewer now and after every sheet change (replacing the sheet unloads extensions).
    use2d(id, options) {
        this.extensions2d.set(id, options);
        if (this.viewer2d) this.viewer2d.loadExtension(id, options);
    }

    async openSheet(node) {
        if (!node || !this.doc) return null;
        if (!this.showing2d) this.setLayout('split', { open: false });
        const viewer = this.ensureViewer2d();
        this.setSheetStatus('Loading the plan…', 'loading');
        let model;
        try {
            model = await viewer.loadDocumentNode(this.doc, node);
        } catch (err) {
            this.setSheetStatus(`The plan didn't load (${err?.message || err}). Pick it again to retry.`, 'error');
            throw err;
        }
        for (const [id, options] of this.extensions2d) {
            if (!viewer.getExtension(id)) await viewer.loadExtension(id, options);
        }
        const index = this.sheets.findIndex(s => s.node === node);
        if (index >= 0) this.el.sheets.value = String(index);
        // Re-apply the shared state once the sheet's objects are there.
        const apply = () => {
            if (viewer.model !== model) return;
            this.applyColors(viewer, model);
            viewer.isolate(this.isolated || [], model);
            if (this.hidden.length) viewer.hide(this.hidden, model);
            const selection = this.viewer3d.getSelection();
            if (selection.length) viewer.select(selection, model);
            this.frame2d();
        };
        apply();
        const loaded = () => { if (viewer.model === model) this.setSheetStatus(''); apply(); };
        if (model.isLoadDone()) loaded();
        else {
            viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, function onLoaded(ev) {
                if (ev.model !== model) return;
                viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onLoaded);
                loaded();
            });
        }
        this.updateMasterButton();
        this.emit('sheet', model);
        return model;
    }

    // --- New 3D model: read its levels and 2D viewables, fill the header pickers ----------------------

    async setModel(model3d) {
        this.doc = model3d.getDocumentNode().getDocument();
        this.sheets = this.doc.getRoot().search({ type: 'geometry', role: '2d' }).map(node => ({
            node, folder: node.parent?.name?.() || '', levelName: node.data.levelName || '',
        }));
        const [map, masterFile, userMasters] = await Promise.all([loadPropertyMap(),
            fetchJson('samples/level-views.json').catch(() => ({})), loadState('level-views').catch(() => ({}))]);
        this.userMasters = userMasters.masters || {};
        this.masters = { ...masterFile.masterViews, ...this.userMasters };
        this.levels = await getLevels(model3d, map).catch(() => []);
        this.wallsByLevel = new Map();
        for (const r of await getBulkProperties(model3d, await findWalls(model3d, map), [map.level]).catch(() => [])) {
            const level = propValue(r, map.level);
            if (!this.wallsByLevel.has(level)) this.wallsByLevel.set(level, []);
            this.wallsByLevel.get(level).push(r.dbId);
        }
        this.el.levels.innerHTML = '<option value="">All levels</option>' +
            this.levels.map(l => `<option value="${escapeHtml(l.name)}">${escapeHtml(l.name)}</option>`).join('');
        const groups = new Map();
        this.sheets.forEach((s, i) => {
            const label = s.folder === 'Sheets' ? 'Sheets' : `Views${s.folder ? ` (${s.folder})` : ''}`;
            if (!groups.has(label)) groups.set(label, []);
            const star = Object.values(this.masters).includes(s.node.name()) ? '★ ' : '';
            groups.get(label).push(`<option value="${i}">${star}${escapeHtml(s.node.name())}${s.levelName ? ` · ${escapeHtml(s.levelName)}` : ''}</option>`);
        });
        this.el.sheets.innerHTML = [...groups].map(([label, opts]) => `<optgroup label="${escapeHtml(label)}">${opts.join('')}</optgroup>`).join('')
            || '<option>No 2D views in this model</option>';
        this.el.sheets.disabled = !this.sheets.length;
        this.level = null;
        this.emit('ready', this);
        const wanted = new URLSearchParams(location.search).get('level');
        if (wanted && this.levelOf(wanted)) await this.setLevel(wanted); // a shared link opens at its level
        else if (this.showing2d) await this.openSheet(this.planFor(null));
    }

    levelOf(name) {
        return this.levels.find(l => l.name === name) || null;
    }
}
