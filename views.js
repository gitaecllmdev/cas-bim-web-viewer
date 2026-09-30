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
import { toThemingColor, getLevels, loadPropertyMap, findWalls, findCategory, getBulkProperties, propValue, escapeHtml, fetchJson, loadState, saveState } from './helpers.js';

const LAYOUTS = ['3d', 'split', '2d'];
const PLAN_OTHER_WALLS = '#e1e5e9'; // on the plan, walls outside the isolated set (faded)
const PLAN_ISOLATED = '#1f3b57';    // isolated walls without a color of their own

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

    // On the plan, isolated walls are highlighted with the plan's selection highlight over their color, and the other
    // walls fade to light grey, while everything else (room names, doors, grids) stays at full strength: Viewer
    // isolation would fade the whole drawing. The highlight stays on the plan (not mirrored to the 3D selection).
    applyColors(viewer, model) {
        viewer.clearThemingColors(model);
        if (viewer === this.viewer2d && this.isolated) {
            const iso = new Set(this.isolated);
            for (const walls of this.wallsByLevel.values()) for (const id of walls) if (!iso.has(id)) viewer.setThemingColor(id, toThemingColor(PLAN_OTHER_WALLS), model);
            for (const id of iso) viewer.setThemingColor(id, toThemingColor(this.colors.get(id) || PLAN_ISOLATED), model);
            this.highlightPlan(viewer, model, this.isolated);
            return;
        }
        for (const [dbId, hex] of this.colors) viewer.setThemingColor(dbId, toThemingColor(hex), model);
        if (viewer === this.viewer2d) this.highlightPlan(viewer, model, null);
    }

    // The plan's selection highlight for the isolated walls (null: take it off, if it is still ours).
    // Viewer3D select / clearSelection / getSelection: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
    highlightPlan(viewer, model, ids) {
        const current = viewer.getSelection();
        const same = (a, b) => a.length === b.length && a.every(id => b.includes(id));
        if (ids?.length) {
            // Already shown, or the user has picked something on the plan or in 3D since: leave their pick.
            if (this.planHighlight && (same(current, ids) || (current.length && !same(current, this.planHighlight)))) return;
            this.planHighlight = [...ids];
            this.quietUntil = performance.now() + 300; // don't mirror this selection to the 3D view
            viewer.select(ids, model);
        } else if (this.planHighlight) {
            const ours = same(current, this.planHighlight);
            this.planHighlight = null;
            this.quietUntil = performance.now() + 300;
            if (ours) viewer.clearSelection();
        }
    }

    // Isolate dbIds in both viewers (null/empty = show everything again). Fits the 3D view. The plan shows it with
    // colors instead (applyColors).
    isolate(ids, { fit = true } = {}) {
        this.isolated = ids?.length ? [...ids] : null;
        for (const [viewer, model] of this.active) {
            if (viewer === this.viewer2d) this.applyColors(viewer, model);
            else viewer.isolate(this.isolated || [], model);
        }
        if (fit && this.viewer3d.model) this.viewer3d.fitToView(this.isolated, this.viewer3d.model);
        if (fit && this.model2d) this.frame2d();
    }

    // Open the plan of the level where most of these walls are (none: the header level's plan), if it isn't open.
    async showPlanFor(ids) {
        let best = this.level?.name || null, most = 0;
        if (ids?.length) {
            const set = new Set(ids);
            for (const [name, walls] of this.wallsByLevel) {
                const n = walls.reduce((k, id) => k + (set.has(id) ? 1 : 0), 0);
                if (n > most) { most = n; best = name; }
            }
        }
        const plan = this.planFor(best);
        if (this.showing2d && plan && plan !== this.model2d?.getDocumentNode()) await this.openSheet(plan);
    }

    hide(ids) {
        this.hidden = [...new Set([...this.hidden, ...ids])];
        for (const [viewer, model] of this.active) viewer.hide(ids, model);
    }

    showAll() {
        this.isolated = null;
        this.hidden = [];
        for (const [viewer, model] of this.active) {
            viewer.showAll();
            if (viewer === this.viewer2d) this.applyColors(viewer, model);
        }
        this.applyCeilings();
    }

    // With one level shown, its ceilings are hidden in 3D: seen from above in the section they cover the walls (a
    // model with modeled ceilings, like a hotel). Found once per model. Viewer3D hide / show:
    // https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
    async applyCeilings() {
        const model = this.viewer3d.model;
        if (!model) return;
        if (this.ceilingsOf !== model) { this.ceilingsOf = model; this.ceilings = await findCategory(model, 'Revit Ceilings').catch(() => []); }
        if (!this.ceilings.length || this.viewer3d.model !== model) return;
        if (this.level) this.viewer3d.hide(this.ceilings, model); else this.viewer3d.show(this.ceilings, model);
    }

    select(ids) {
        if (this.viewer3d.model) this.viewer3d.select(ids, this.viewer3d.model); // mirrored to 2D by syncSelection
    }

    // Selecting in one viewer selects the same dbIds in the other.
    syncSelection(viewer) {
        viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, () => {
            const other = viewer === this.viewer3d ? this.viewer2d : this.viewer3d;
            if (this.syncing || !other?.model || performance.now() < (this.quietUntil || 0)) return; // the plan's own highlight: not mirrored
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

    // --- Plan labels: text on the walls of the plan (e.g. the wall type or its SSMA stud), in the wall's color ------
    // labelOf(dbId) -> { text, color } | null (null: no label for that object). Where each wall is drawn on the sheet is
    // not in the 2D data, so the plan is sampled where it is shown: Viewer3D.hitTest (which object) and clientToWorld
    // (where on the sheet) on a grid, in small batches while the view is still. Each sheet's samples are kept and grow
    // as the user pans and zooms; a label goes at the middle of the wall's samples, along the wall; labels that would
    // overlap are left out. Viewer3D hitTest, clientToWorld, worldToClient, CAMERA_CHANGE_EVENT:
    // https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/

    setPlanLabels(labelOf) {
        this.planLabelOf = labelOf || null;
        if (!labelOf) { this.viewer2d?.container.querySelector('.plan-labels')?.remove(); return; }
        this.schedulePlanLabels(50);
    }

    schedulePlanLabels(delay = 350) {
        clearTimeout(this.planLabelTimer);
        this.planLabelTimer = setTimeout(() => this.drawPlanLabels(), delay);
    }

    async drawPlanLabels() {
        const v = this.viewer2d, model = this.model2d;
        if (!this.planLabelOf || !v || !model?.isLoadDone() || !v.container.clientWidth) return;
        const run = (this.planLabelRun = (this.planLabelRun || 0) + 1);
        this.planSamples ??= new Map();
        const key = model.getDocumentNode()?.guid?.() || model.id;
        if (!this.planSamples.has(key)) this.planSamples.set(key, { cells: new Set(), walls: new Map() });
        const store = this.planSamples.get(key);
        this.placePlanLabels(store); // what is known already, right away
        // Sample the view on a 7 px grid, ~250 points per step so the page stays responsive.
        const W = v.container.clientWidth, H = v.container.clientHeight, step = 7;
        const size = (() => { const a = v.clientToWorld(0, 0)?.point, b = v.clientToWorld(step, 0)?.point; return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0; })();
        if (!size) return;
        const pts = [];
        for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) pts.push([x, y]);
        for (let i = 0; i < pts.length; i += 250) {
            if (run !== this.planLabelRun || this.model2d !== model) return; // the view moved or the sheet changed
            for (const [x, y] of pts.slice(i, i + 250)) {
                const w = v.clientToWorld(x, y)?.point;
                if (!w) continue;
                const cell = `${Math.round(w.x / size)},${Math.round(w.y / size)}`;
                if (store.cells.has(cell)) continue; // sampled before, at this zoom or finer
                store.cells.add(cell);
                const id = v.hitTest(x, y, false)?.dbId;
                if (!(id > 0)) continue;
                if (!store.walls.has(id)) store.walls.set(id, []);
                store.walls.get(id).push(w.x, w.y);
            }
            await new Promise(r => setTimeout(r, 0));
        }
        if (run === this.planLabelRun) this.placePlanLabels(store);
    }

    placePlanLabels(store) {
        const v = this.viewer2d;
        let layer = v.container.querySelector('.plan-labels');
        if (!layer) { layer = document.createElement('div'); layer.className = 'plan-labels'; v.container.appendChild(layer); }
        const W = v.container.clientWidth, H = v.container.clientHeight, placed = [], html = [];
        for (const [id, p] of store.walls) {
            if (p.length < 6) continue;
            const label = this.planLabelOf(id);
            if (!label?.text) continue;
            // Middle and direction of the wall's samples (principal axis).
            let sx = 0, sy = 0; const n = p.length / 2;
            for (let i = 0; i < p.length; i += 2) { sx += p[i]; sy += p[i + 1]; }
            const cx = sx / n, cy = sy / n;
            let xx = 0, yy = 0, xy = 0;
            for (let i = 0; i < p.length; i += 2) { const dx = p[i] - cx, dy = p[i + 1] - cy; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
            const a = 0.5 * Math.atan2(2 * xy, xx - yy);
            const c = v.worldToClient(new THREE.Vector3(cx, cy, 0)), d = v.worldToClient(new THREE.Vector3(cx + Math.cos(a), cy + Math.sin(a), 0));
            if (!c || c.x < 0 || c.y < 0 || c.x > W || c.y > H) continue;
            let deg = (Math.atan2(d.y - c.y, d.x - c.x) * 180) / Math.PI;
            if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
            const w = label.text.length * 6.4 + 10, h = 15, r = (Math.abs(deg) * Math.PI) / 180;
            const bw = w * Math.cos(r) + h * Math.sin(r), bh = w * Math.sin(r) + h * Math.cos(r);
            const box = [c.x - bw / 2, c.y - bh / 2, c.x + bw / 2, c.y + bh / 2];
            if (placed.some(q => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) continue;
            placed.push(box);
            html.push(`<div class="plan-label" style="left:${c.x.toFixed(1)}px;top:${c.y.toFixed(1)}px;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);border-color:${label.color || '#1f3b57'}">`
                + `<i style="background:${label.color || '#1f3b57'}"></i>${escapeHtml(label.text)}</div>`);
        }
        layer.innerHTML = html.join('');
        layer.classList.remove('moving');
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
            // Cut 1.5 ft below the next level: the slab above hangs below its level line and would roof the floor over.
            const top = Math.max(level.bottom + 4, level.top - 1.4);
            section.setSectionBox(new THREE.Box3(
                new THREE.Vector3(world.min.x - 1, world.min.y - 1, level.bottom),
                new THREE.Vector3(world.max.x + 1, world.max.y + 1, top)));
        } else {
            section.deactivate(false);
        }
        await this.applyCeilings();
        // A model with far-away extents (see setModel): frame the level's walls, or the cut is lost in the distance.
        if (this.farExtents && this.viewer3d.model) {
            const walls = level ? this.wallsByLevel.get(level.name) : [...this.wallsByLevel.values()].flat();
            if (walls?.length) this.viewer3d.fitToView(walls, this.viewer3d.model);
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
        // Plan labels follow the camera: dimmed while it moves, re-placed (and the new view sampled) when it stops.
        viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, () => {
            if (!this.planLabelOf) return;
            viewer.container.querySelector('.plan-labels')?.classList.add('moving');
            this.schedulePlanLabels();
        });
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
            this.applyColors(viewer, model); // with the isolated walls highlighted (no Viewer isolation on plans)
            if (this.hidden.length) viewer.hide(this.hidden, model);
            const selection = this.viewer3d.getSelection();
            if (selection.length) viewer.select(selection, model);
            this.frame2d();
        };
        apply();
        const loaded = () => { if (viewer.model === model) this.setSheetStatus(''); apply(); if (this.planLabelOf) this.schedulePlanLabels(100); };
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
        // A model whose extents are far bigger than any building (an element left miles from the site in Revit) opens
        // as a dot: frame its walls instead. Model.getBoundingBox, Viewer3D.fitToView:
        // https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Model/ and .../reference/Viewing/Viewer3D/
        // Checked once the geometry is in (GEOMETRY_LOADED_EVENT): before that the extents are only partly known.
        const walls = [...this.wallsByLevel.values()].flat();
        const frameWalls = () => {
            if (this.viewer3d.model !== model3d || !walls.length) return;
            const size = model3d.getBoundingBox()?.getSize(new THREE.Vector3());
            this.farExtents = !!(size && Math.max(size.x, size.y) > 20000);
            if (this.farExtents) this.viewer3d.fitToView(walls, model3d, true);
        };
        if (model3d.isLoadDone()) frameWalls();
        else {
            const once = (e) => { if (e.model !== model3d) return; this.viewer3d.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, once); frameWalls(); };
            this.viewer3d.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, once);
        }
        this.emit('ready', this);
        const wanted = new URLSearchParams(location.search).get('level');
        if (wanted && this.levelOf(wanted)) await this.setLevel(wanted); // a shared link opens at its level
        else if (this.showing2d) await this.openSheet(this.planFor(null));
    }

    levelOf(name) {
        return this.levels.find(l => l.name === name) || null;
    }
}
