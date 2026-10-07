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
import { PlanPop } from './plan-pop.mjs';
import { toThemingColor, getLevels, loadPropertyMap, findWalls, findCategory, findIgnored, setBuildingCenter, getBulkProperties, propValue, escapeHtml, fetchJson, loadState, saveState, markCopiesOf, unmarkCopiesOf } from './helpers.js';

const LAYOUTS = ['3d', 'split', '2d'];
const PLAN_OTHER_WALLS = '#e1e5e9'; // on the plan, walls outside the isolated set (faded)
const PLAN_ISOLATED = '#1f3b57';    // isolated walls without a color of their own
const PLAN_CONTEXT = 3;              // a picked wall on the plan: shown in a frame this many times its own,
const PLAN_MIN_FRAME = 1 / 6;        // and at least this share of the sheet (a short wall still shows its rooms)
const MODEL_CONTEXT = 2.5;           // in 3D: this many times its own frame

export class Views {
    constructor(viewer3d) {
        this.viewer3d = viewer3d;
        this.viewer2d = null; // created the first time the 2D pane is shown
        this.colors = new Map(); // dbId -> hex
        this.appliedTo = new WeakMap(); // model -> the colors map last applied to it in full or by changes (setColors)
        this.isolated = null; // dbIds, or null for no isolation
        this.isolateOnPlan = true; // false: isolated in 3D only, the plan shows every wall in its color (isolate { plan })
        this.hidden = [];
        this.level = null; // level object from getLevels(), or null for the whole building
        this.levels = [];
        this.wallsByLevel = new Map(); // level name -> wall dbIds (used to frame the 2D plan)
        this.wallLevel = new Map(); // wall dbId -> level name
        // One wall picked: zoom to it in 3D and on its floor's plan (Options > Navigate on the toolbar turns it off).
        this.zoomPick = (() => { try { return localStorage.getItem('drywall-demos:zoom-pick') !== 'off'; } catch { return true; } })();
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
        // Floor labels with the floors apart follow the 3D camera.
        viewer3d.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, () => {
            if (this.apart && this.apartLabelOf && !this.apartLabelFrame) this.apartLabelFrame = requestAnimationFrame(() => { this.apartLabelFrame = null; this.placeApartLabels(); });
        });
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

    get planIsolated() {
        return !!this.isolated && this.isolateOnPlan;
    }

    // [viewer, model] for each viewer that has a model loaded; with the floors apart (setLevelsApart), each floor's copy
    // in 3D instead of the (hidden) building model.
    get active() {
        const out = [this.viewer3d, this.viewer2d].filter(v => v?.model).map(v => [v, v.model]);
        if (!this.apart) return out;
        return [...out.filter(([v]) => v !== this.viewer3d), ...[...this.apart.models.values()].map(m => [this.viewer3d, m])];
    }

    get model2d() {
        return this.viewer2d?.model || null;
    }

    // --- Shared visual state -------------------------------------------------------------------

    // New colors: where a model already shows the previous ones, only the walls whose color changed are themed again
    // (a played schedule changes a few walls a day, not thousands); else in full. The plan pane under the floor plans
    // (setPlanCovered) is left until it shows again.
    setColors(colors) {
        const prev = this.colors;
        this.colors = new Map(colors);
        for (const [viewer, model] of this.active) {
            if (viewer === this.viewer2d && this.planCovered) { this.appliedTo.delete(model); continue; }
            if (this.appliedTo.get(model) === prev && !(viewer === this.viewer2d && this.planIsolated)) this.recolor(viewer, model, prev);
            else this.applyColors(viewer, model);
        }
    }

    // The walls whose color differs from prev, themed again (no color: intensity 0, the material as it is).
    // Viewer3D setThemingColor (r, g, b, intensity): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
    recolor(viewer, model, prev) {
        const floor = this.apart?.idsOf.get(model), only = floor ? new Set(floor) : null, none = new THREE.Vector4(0, 0, 0, 0);
        for (const [id, hex] of this.colors) if (prev.get(id) !== hex && (!only || only.has(id))) viewer.setThemingColor(id, toThemingColor(hex), model);
        for (const id of prev.keys()) if (!this.colors.has(id) && (!only || only.has(id))) viewer.setThemingColor(id, none, model);
        this.appliedTo.set(model, this.colors);
        if (viewer === this.viewer2d) this.planPop?.setColors([...this.colors.values()]);
    }

    // The plan pane is covered (Demo 3's floor plans): no coloring there meanwhile; colored again when it shows.
    setPlanCovered(on) {
        this.planCovered = on;
        if (!on && this.viewer2d?.model) this.applyColors(this.viewer2d, this.viewer2d.model);
    }

    clearColors() {
        this.setColors([]);
    }

    // On the plan, isolated walls are highlighted with the plan's selection highlight over their color, and the other
    // walls fade to light grey, while everything else (room names, doors, grids) stays at full strength: Viewer
    // isolation would fade the whole drawing. The highlight stays on the plan (not mirrored to the 3D selection).
    applyColors(viewer, model) {
        viewer.clearThemingColors(model);
        const floor = this.apart?.idsOf.get(model);
        if (floor) {
            for (const id of floor) { const hex = this.colors.get(id); if (hex) viewer.setThemingColor(id, toThemingColor(hex), model); }
            this.appliedTo.set(model, this.colors);
            return;
        }
        if (viewer === this.viewer2d && this.planIsolated) {
            const iso = new Set(this.isolated);
            for (const walls of this.wallsByLevel.values()) for (const id of walls) if (!iso.has(id)) viewer.setThemingColor(id, toThemingColor(PLAN_OTHER_WALLS), model);
            for (const id of iso) viewer.setThemingColor(id, toThemingColor(this.colors.get(id) || PLAN_ISOLATED), model);
            this.highlightPlan(viewer, model, this.isolated);
            this.planPop?.setColors([...iso].map(id => this.colors.get(id) || PLAN_ISOLATED)); // seen from far, thicker
            this.appliedTo.delete(model); // the faded walls too: in full next time
            return;
        }
        for (const [dbId, hex] of this.colors) viewer.setThemingColor(dbId, toThemingColor(hex), model);
        this.appliedTo.set(model, this.colors);
        if (viewer === this.viewer2d) {
            this.highlightPlan(viewer, model, null);
            this.planPop?.setColors([...this.colors.values()]); // seen from far, thicker
        }
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
    // colors instead (applyColors); plan: false leaves the plan as it is (every wall in its color: when the isolated set
    // is most of the walls, e.g. every panel of the Panel Tracker, and the colors already say which).
    isolate(ids, { fit = true, plan = true } = {}) {
        this.isolated = ids?.length ? [...ids] : null;
        this.isolateOnPlan = plan;
        for (const [viewer, model] of this.active) {
            if (viewer === this.viewer2d) this.applyColors(viewer, model);
            else this.isolateIn(viewer, model);
        }
        if (fit && this.viewer3d.model && !this.apart) this.viewer3d.fitToView(this.isolated, this.viewer3d.model);
        if (fit && this.model2d) this.frame2d();
    }

    // The isolated walls in one 3D model: on a floor's copy, those of its floor (none of them: the floor hidden).
    isolateIn(viewer, model) {
        const floor = this.apart?.idsOf.get(model);
        if (!floor || !this.isolated) { viewer.isolate(this.isolated || [], model); return; }
        const set = new Set(this.isolated), mine = floor.filter(id => set.has(id));
        if (mine.length) viewer.isolate(mine, model); else { viewer.isolate([], model); viewer.hide(floor, model); }
    }

    // --- Floors apart: every floor's walls at once, each lifted by a gap over the one below ------------------------
    // Each floor's walls are loaded again from the same view as their own model (Viewer3D.loadDocumentNode with
    // keepCurrentModels, ids and placementTransform: documented loadModel options), lifted by its place in the stack
    // times the gap, and the building model is hidden meanwhile. Colors and isolation set through views reach every
    // floor (active, applyColors, isolateIn). names: the floors, bottom to top (null: back to the building).
    // Viewer3D loadDocumentNode, hideModel, showModel, unloadModel; Model getData (globalOffset), getUnitString;
    // Navigation fitBounds: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
    async setLevelsApart(names, { onProgress = () => {} } = {}) {
        const views = this, viewer = this.viewer3d, run = (this.apartRun = (this.apartRun || 0) + 1);
        if (this.apart) {
            const { main, models } = this.apart;
            this.apart = null;
            for (const m of models.values()) viewer.unloadModel(m);
            unmarkCopiesOf(main);
            viewer.showModel(main);
            this.applyColors(viewer, main);
            this.isolateIn(viewer, main);
            this.placeApartLabels();
            if (!names?.length) { this.frameBuilding(); return; }
        }
        const main = viewer.model;
        if (!names?.length || !main) return;
        if (this.level) await this.setLevel(null); // no section cut: every floor shows
        const floors = this.levels.filter(l => names.includes(l.name) && this.wallsByLevel.get(l.name)?.length);
        if (!floors.length) return;
        const gap = main.getUnitString?.() === 'm' ? 7.5 : 25; // between floors, over their own height
        markCopiesOf(main);
        this.apart = { main, gap, floors, models: new Map(), idsOf: new Map() };
        viewer.hideModel(main);
        this.frameApart();
        const node = main.getDocumentNode(), globalOffset = main.getData().globalOffset;
        for (let i = 0; i < floors.length; i++) {
            if (run !== this.apartRun) return; // switched off or restarted meanwhile
            onProgress(i, floors.length, floors[i].name);
            const ids = this.wallsByLevel.get(floors[i].name);
            const model = await viewer.loadDocumentNode(this.doc, node, { keepCurrentModels: true, ids, globalOffset,
                placementTransform: new THREE.Matrix4().makeTranslation(0, 0, i * gap) });
            await new Promise(res => model.getObjectTree(res, res)); // colors and isolation need its object tree (Model.getObjectTree)
            if (run !== this.apartRun) { viewer.unloadModel(model); return; }
            this.apart.models.set(floors[i].name, model);
            this.apart.idsOf.set(model, ids);
            if (!model.isLoadDone()) viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, function placed(ev) {
                if (ev.model !== model) return;
                viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, placed);
                views.placeApartLabels();
            });
            this.applyColors(viewer, model);
            this.isolateIn(viewer, model);
            if (i === 0) this.frameApart(); // the first one loaded takes the viewer to the model's own (far) extents
            this.placeApartLabels();
        }
        this.frameApart();
        onProgress(floors.length, floors.length, '');
    }

    // Labels for the floors apart: labelOf(level name) -> { title, text, done, plan } (done and plan in %, plan null)
    // or null. One small line per floor, next to that floor's walls: just left of the floor's corner nearest the left
    // of the view (right of its far corner when there is no room), at the floor's mid-height, a bar under it (done
    // filled, plan marked); moved apart when floors are close on screen. Re-placed whenever the camera moves.
    // Where the floor is: its copy's own bounds (only that floor is loaded in it), Model.getFuzzyBox with every
    // instance (quantil 1); Viewer3D.worldToClient: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Model/
    setApartLabels(labelOf) {
        this.apartLabelOf = labelOf || null;
        this.placeApartLabels();
    }

    // A floor copy's bounds in the scene (cached once it has finished loading).
    apartBox(model) {
        const known = this.apart.boxes.get(model);
        if (known) return known;
        const box = model.getFuzzyBox?.({ quantil: 1 });
        if (!box || box.isEmpty()) return null;
        if (model.isLoadDone()) this.apart.boxes.set(model, box);
        return box;
    }

    placeApartLabels() {
        const host = this.viewer3d.container;
        let layer = host.querySelector('.apart-labels');
        const a = this.apart;
        if (!a || !this.apartLabelOf) { layer?.remove(); return; }
        if (!layer) { layer = document.createElement('div'); layer.className = 'apart-labels'; host.appendChild(layer); }
        a.boxes ??= new Map();
        const W = host.clientWidth, H = host.clientHeight, items = [];
        for (const floor of a.floors) {
            const model = a.models.get(floor.name), label = model && this.apartLabelOf(floor.name);
            const box = label && this.apartBox(model);
            if (!box) continue;
            const z = (box.min.z + box.max.z) / 2;
            const corners = [[box.min.x, box.min.y], [box.max.x, box.min.y], [box.min.x, box.max.y], [box.max.x, box.max.y]]
                .map(([x, y]) => this.viewer3d.worldToClient(new THREE.Vector3(x, y, z))).filter(Boolean);
            if (!corners.length) continue;
            const left = corners.reduce((p, c) => (c.x < p.x ? c : p)), right = corners.reduce((p, c) => (c.x > p.x ? c : p));
            const onLeft = left.x > 140 || right.x > W - 140; // room for the label left of the floor
            items.push({ label, x: onLeft ? left.x - 6 : right.x + 6, y: onLeft ? left.y : right.y, onLeft });
        }
        // Close floors on screen: each label at least a line below the one above it.
        items.sort((p, q) => p.y - q.y);
        for (let i = 1; i < items.length; i++) items[i].y = Math.max(items[i].y, items[i - 1].y + 17);
        layer.innerHTML = items.filter(it => it.y > -10 && it.y < H + 10).map(({ label, x, y, onLeft }) => {
            const bar = label.done != null ? `<span class="al-bar"><i style="width:${label.done}%"></i>${label.plan != null ? `<b style="left:${label.plan}%"></b>` : ''}</span>` : '';
            const tip = `${label.title}${label.text ? `: ${label.text}` : ''}`;
            return `<div class="apart-label ${onLeft ? 'left' : 'right'}${label.focus ? ' focus' : ''}" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px" title="${escapeHtml(tip)}"><b>${escapeHtml(label.title)}</b> ${escapeHtml(label.text || '')}${bar}</div>`;
        }).join('');
    }

    // The stack of floors in view: the building's plan size, from the lowest floor to the top one lifted.
    frameApart() {
        const a = this.apart, b = this.building;
        if (!a || !b) return;
        const r = b.radius * 0.28, low = a.floors[0], high = a.floors.at(-1);
        const top = Math.min(high.top, high.bottom + a.gap) + (a.floors.length - 1) * a.gap; // the top level's own top can be the model's far extents
        this.viewer3d.navigation.fitBounds(false, new THREE.Box3(
            new THREE.Vector3(b.center.x - r, b.center.y - r, low.bottom), new THREE.Vector3(b.center.x + r, b.center.y + r, top)));
    }

    frameBuilding() {
        const walls = [...this.wallsByLevel.values()].flat();
        if (walls.length && this.viewer3d.model) this.viewer3d.fitToView(walls, this.viewer3d.model);
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
        if (this.ignored?.length && this.viewer3d.model) this.viewer3d.hide(this.ignored, this.viewer3d.model);
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
            // Swapping the plan's sheet clears its selection: that isn't the user's, so it isn't mirrored to 3D.
            if (viewer === this.viewer2d && this.swappingSheet) return;
            if (this.syncing || performance.now() < (this.quietUntil || 0)) return; // the plan's own highlight: not mirrored
            const other = viewer === this.viewer3d ? this.viewer2d : this.viewer3d;
            const ids = viewer.getSelection();
            const current = other?.model ? other.getSelection() : [];
            if (other?.model && !(ids.length === current.length && ids.every(id => current.includes(id)))) {
                this.syncing = true;
                try {
                    if (ids.length) other.select(ids, other.model); else other.clearSelection();
                } finally {
                    this.syncing = false;
                }
            }
            this.zoomToPick(ids);
        });
    }

    // Fly to an object with room around it: fit it (immediately, to measure its frame), put the camera back before
    // anything is drawn, then animate to a box `factor` times that frame (on a sheet, at least `minShare` of the
    // sheet). Viewer3D fitToView / clientToWorld; Navigation getPosition / getTarget / getEyeVector / setView / fitBounds;
    // Model getBoundingBox: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Navigation/
    frameWithContext(viewer, model, id, factor, minShare) {
        const nav = viewer.navigation, from = nav.getPosition().clone(), to = nav.getTarget().clone();
        viewer.fitToView([id], model, true);
        const center = nav.getTarget().clone();
        let half;
        if (model.is2d()) {
            const c = viewer.container, a = viewer.clientToWorld(0, 0, true), b = viewer.clientToWorld(c.clientWidth, c.clientHeight, true);
            const sheet = model.getBoundingBox().getSize(new THREE.Vector3());
            const w = a && b ? Math.abs(b.point.x - a.point.x) : sheet.x / 20, h = a && b ? Math.abs(b.point.y - a.point.y) : sheet.y / 20;
            half = new THREE.Vector3(Math.max(w * factor, sheet.x * minShare) / 2, Math.max(h * factor, sheet.y * minShare) / 2, 1);
        } else {
            const r = nav.getEyeVector().length() * 0.5 * factor;
            half = new THREE.Vector3(r, r, r);
        }
        nav.setView(from, to); // nothing has been drawn at the tight fit
        nav.fitBounds(false, new THREE.Box3(center.clone().sub(half), center.clone().add(half)));
    }

    setZoomPick(on) {
        this.zoomPick = on;
        try { localStorage.setItem('drywall-demos:zoom-pick', on ? 'on' : 'off'); } catch { /* storage blocked */ }
    }

    // One wall picked (in either viewer, or by a demo): zoom to it in 3D, and on the plan of its floor (opened if another
    // floor's is showing) with room around it to see where it is. Viewer3D fitToView, GEOMETRY_LOADED_EVENT;
    // Navigation getPosition / getTarget / setView: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
    // and https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Navigation/
    async zoomToPick(ids) {
        if (!this.zoomPick || this.applyingSheet || ids.length !== 1 || !this.wallLevel.has(ids[0])) return;
        const id = ids[0], token = (this.pickToken = (this.pickToken || 0) + 1);
        if (this.viewer3d.model && !this.apart) this.frameWithContext(this.viewer3d, this.viewer3d.model, id, MODEL_CONTEXT, 0);
        if (!this.showing2d) return;
        const plan = this.planFor(this.wallLevel.get(id));
        if (plan && plan !== this.model2d?.getDocumentNode()) await this.openSheet(plan);
        const viewer = this.viewer2d, model = this.model2d;
        if (!model || token !== this.pickToken) return;
        const zoom = () => { if (viewer.model === model && token === this.pickToken) this.frameWithContext(viewer, model, id, PLAN_CONTEXT, PLAN_MIN_FRAME); };
        if (model.isLoadDone()) zoom();
        else viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, function once(ev) {
            if (ev.model !== model) return;
            viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, once);
            zoom();
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
        // Sheet units per grid step, from the sheet's extents on screen (worldToClient): clientToWorld finds nothing off the
        // sheet, e.g. in the margin above a wide sheet. Model.getBoundingBox: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Model/
        const size = (() => {
            const box = model.getBoundingBox(), a = v.worldToClient(box.min), b = v.worldToClient(new THREE.Vector3(box.max.x, box.min.y, box.min.z));
            const px = a && b ? Math.abs(b.x - a.x) : 0;
            return px ? ((box.max.x - box.min.x) / px) * step : 0;
        })();
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
            // Around the building (its walls), not the whole model: ignored objects far off would stretch the box.
            const world = this.viewer3d.model.getBoundingBox();
            const b = this.building, r = b ? b.radius * 1.5 : 0;
            const min = b ? new THREE.Vector3(b.center.x - r, b.center.y - r, 0) : world.min, max = b ? new THREE.Vector3(b.center.x + r, b.center.y + r, 0) : world.max;
            // Cut 1.5 ft below the next level: the slab above hangs below its level line and would roof the floor over.
            const top = Math.max(level.bottom + 4, level.top - 1.4);
            section.setSectionBox(new THREE.Box3(
                new THREE.Vector3(min.x - 1, min.y - 1, level.bottom),
                new THREE.Vector3(max.x + 1, max.y + 1, top)));
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
        this.planPop = new PlanPop(viewer); // colored walls still show on a whole sheet (plan-pop.mjs)
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

    // One sheet load at a time, in order, and only the latest wanted: two loads at once (the opening plan still
    // streaming while a picked wall asks for its floor's) would leave whichever finished last on screen.
    openSheet(node) {
        this.sheetWanted = node;
        const run = () => (node === this.sheetWanted ? this.loadSheet(node) : this.model2d);
        this.sheetQueue = (this.sheetQueue || Promise.resolve()).then(run, run);
        return this.sheetQueue;
    }

    async loadSheet(node) {
        if (!node || !this.doc) return null;
        if (!this.showing2d) this.setLayout('split', { open: false });
        const viewer = this.ensureViewer2d();
        this.setSheetStatus('Loading the plan…', 'loading');
        let model;
        this.swappingSheet = true; // the old sheet's selection goes with it (see syncSelection)
        try {
            model = await viewer.loadDocumentNode(this.doc, node);
        } catch (err) {
            this.setSheetStatus(`The plan didn't load (${err?.message || err}). Pick it again to retry.`, 'error');
            throw err;
        } finally {
            this.swappingSheet = false;
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
            this.applyingSheet = true; // re-selecting what 3D has selected is not a new pick (no zoomToPick)
            try {
                if (selection.length) viewer.select(selection, model);
            } finally {
                this.applyingSheet = false;
            }
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
        this.wallLevel = new Map();
        for (const r of await getBulkProperties(model3d, await findWalls(model3d, map), [map.level]).catch(() => [])) {
            const level = propValue(r, map.level);
            if (!this.wallsByLevel.has(level)) this.wallsByLevel.set(level, []);
            this.wallsByLevel.get(level).push(r.dbId);
            this.wallLevel.set(r.dbId, level);
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
        // Once the geometry is in (GEOMETRY_LOADED_EVENT): objects that aren't the building (property-map "ignore":
        // model lines, level datums, imported site CAD, sometimes miles from the site) are hidden and left out of
        // everything; the middle and size of the building come from its walls (fitToView measures them, then the
        // camera goes back, unless the model's extents run far past the building, when it stays on the walls).
        // Viewer3D fitToView / hide, Navigation getTarget / setView: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
        const walls = [...this.wallsByLevel.values()].flat();
        const ignoredP = findIgnored(model3d, map).catch(() => []);
        const frameWalls = async () => {
            if (this.viewer3d.model !== model3d || !walls.length) return;
            this.ignored = await ignoredP;
            if (this.ignored.length) this.viewer3d.hide(this.ignored, model3d);
            const nav = this.viewer3d.navigation;
            const eye = nav.getPosition().clone(), target = nav.getTarget().clone();
            const up = new THREE.Vector3().fromArray(model3d.getUpVector?.() || [0, 0, 1]); // Model.getUpVector (docs above)
            this.viewer3d.fitToView(walls, model3d, true);
            this.building = { center: nav.getTarget().clone(), radius: nav.getEyeVector().length() };
            setBuildingCenter(model3d, this.building.center);
            const size = model3d.getBoundingBox()?.getSize(new THREE.Vector3());
            this.farExtents = !!(size && Math.max(size.x, size.y) > Math.max(20000, this.building.radius * 20));
            if (!this.farExtents) nav.setView(eye, target, up); // a normal model keeps its own opening view
        };
        this.building = null;
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
