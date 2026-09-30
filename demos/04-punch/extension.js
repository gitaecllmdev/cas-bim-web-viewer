// Demo 04: Field QC / Punch Viewer
// Spec and acceptance criteria: demos/04-punch/README.md
// Pins can be dropped in 3D or on the 2D plan/sheet. Walls with open items are colored by type in both views
// (core/client/views.js); each pin shows as a sprite in the view it was placed in.
// Data Visualization sprites: https://aps.autodesk.com/en/docs/dataviz/v1/developers_guide/examples/sprites/
// Sprite events: https://aps.autodesk.com/en/docs/dataviz/v1/developers_guide/sprite-events/
// DataVisualization reference: https://aps.autodesk.com/en/docs/dataviz/v1/reference/DataVisualization/DataVisualization/
// MarkupsCore: https://aps.autodesk.com/en/docs/viewer/v7/reference/Extensions/MarkupsCore/
// Viewer3D (clientToWorld, hitTest, getState, restoreState, fitToView): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Navigation (setView, getTarget, setPivotPoint) for "Jump to 3D": https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Navigation/
import { loadPropertyMap, getWallData, onModelReady, loadState, saveState, downloadCsv, escapeHtml, buildingCenter, stateFor } from '../../helpers.js';

const EXTENSION_ID = 'Drywall.Punch';
const STATE_NAME = 'punch';
const ICONS = new URL('./icons/', import.meta.url).href;
const TYPES = [
    { name: 'Damage', icon: 'damage.svg', color: '#d7263d' },
    { name: 'Missing board', icon: 'missing-board.svg', color: '#f28e2b' },
    { name: 'Fire caulk', icon: 'fire-caulk.svg', color: '#8e1b8e' },
    { name: 'Other', icon: 'other.svg', color: '#4e79a7' },
];
const MARKUP_TOOLS = { Arrow: 'EditModeArrow', Cloud: 'EditModeCloud', Text: 'EditModeText' };
const MARKUP_LAYER = 'punch';
const DATAVIZ = 'Autodesk.DataVisualization';

const guidOf = (model) => model?.getDocumentNode()?.data?.guid;

class PunchExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.panel = this.options.panel;
        this.items = [];
        this.filter = { type: '', status: 'open' };
        this.sprites = { '3d': new Map(), '2d': new Map() }; // sprite dbId -> item id, per view
        this.taps = new Map(); // viewer -> { down, up } pointer handlers while adding
        this.panel.innerHTML = `<div class="demo-panel"><h2>Field QC / Punch</h2><p class="muted" data-status>Waiting for a model…</p></div>`;
        this.onSprite = (kind) => (ev) => {
            const item = this.items.find(i => i.id === this.sprites[kind].get(ev.dbId));
            if (!item || this.adding) return;
            this.selectItem(item.id, false);
            if (kind === '2d') this.jumpTo3d(item); // from the plan: show where it is in 3D
        };
        this.onSprite3d = this.onSprite('3d');
        this.onSprite2d = this.onSprite('2d');
        this.views.use2d(DATAVIZ, {});
        this.stops = [
            onModelReady(this.viewer, (model) => this.init(model)),
            this.views.on('viewer2d', (viewer2d) => {
                viewer2d.addEventListener('DATAVIZ_OBJECT_CLICK', this.onSprite2d);
                this.viewer2dClickBound = viewer2d;
            }),
            this.views.on('sheet', () => this.refresh2dSprites()),
            this.views.on('level', () => { if (this.dataViz) this.renderList(); }),
        ];
        return true;
    }

    unload() {
        this.stops.forEach(stop => stop());
        this.setAdding(false);
        if (this.dataViz) this.viewer.removeEventListener(Autodesk.DataVisualization.Core.MOUSE_CLICK, this.onSprite3d);
        this.viewer2dClickBound?.removeEventListener('DATAVIZ_OBJECT_CLICK', this.onSprite2d);
        this.dataViz?.removeAllViewables();
        this.views.viewer2d?.getExtension(DATAVIZ)?.removeAllViewables();
        this.views.clearColors();
        this.markups?.hide();
        this.panel.innerHTML = '';
        return true;
    }

    async init(model) {
        this.model = model;
        try {
            this.stateName = await stateFor(STATE_NAME); // per model (the sample model keeps 'punch')
            const [map, saved] = await Promise.all([loadPropertyMap(), loadState(this.stateName)]);
            this.items = saved.items || [];
            const walls = (await getWallData(model, map)).walls;
            this.byDbId = new Map(walls.map(w => [w.dbId, w]));
            const byExternalId = new Map(walls.map(w => [w.externalId, w.dbId]));
            this.items.forEach(i => { i.dbId ??= byExternalId.get(i.externalId); i.sheetPoints ??= {}; });
            this.dataViz = await this.viewer.loadExtension(DATAVIZ);
            const Core = Autodesk.DataVisualization.Core;
            this.styles = Object.fromEntries(TYPES.map(t => [t.name, new Core.ViewableStyle(Core.ViewableType.SPRITE, new THREE.Color(0xffffff), ICONS + t.icon)]));
            this.closedStyle = new Core.ViewableStyle(Core.ViewableType.SPRITE, new THREE.Color(0xffffff), ICONS + 'closed.svg');
            this.viewer.addEventListener(Core.MOUSE_CLICK, this.onSprite3d);
            this.render();
            await this.refreshAll();
        } catch (err) {
            this.panel.querySelector('[data-status]').textContent = `Could not start the punch viewer: ${err.message || err}`;
        }
    }

    render() {
        this.panel.innerHTML = `<div class="demo-panel"><h2>Field QC / Punch</h2>
            <div class="row"><button data-add>+ Add pin</button><button data-csv>Export CSV</button></div>
            <p data-hint class="muted">Add a pin, then click a point on a wall in 3D or on the plan.</p>
            <div data-form hidden>
                <h3>New punch item</h3>
                <p class="muted" data-where></p>
                <div class="row"><label>Type <select data-type>${TYPES.map(t => `<option>${t.name}</option>`).join('')}</select></label></div>
                <textarea data-note rows="3" style="width:100%" placeholder="Note (e.g. 2 ft crack at door head)"></textarea>
                <div class="row"><button data-save>Save pin</button><button data-cancel>Cancel</button></div>
            </div>
            <div data-detail></div>
            <h3>Punch list <span class="muted" data-scope></span></h3>
            <div class="row">
                <select data-ftype><option value="">All types</option>${TYPES.map(t => `<option>${t.name}</option>`).join('')}</select>
                <select data-fstatus><option value="open">Open</option><option value="closed">Closed</option><option value="">All</option></select>
            </div>
            <table><thead><tr><th>#</th><th>Type</th><th>Where</th><th>Status</th><th></th></tr></thead><tbody data-list></tbody></table>
            <p class="note">Walls with open items are colored by type in 3D and on the plan. Saved to a local JSON file (data/punch.json).
                Syncing to ACC / Forma Issues needs 3-legged auth and is a follow-up.</p></div>`;
        const $ = (s) => this.panel.querySelector(s);
        $('[data-add]').onclick = () => this.setAdding(!this.adding);
        $('[data-csv]').onclick = () => this.exportCsv();
        $('[data-cancel]').onclick = () => { this.pending = null; $('[data-form]').hidden = true; };
        $('[data-save]').onclick = () => this.addItem($('[data-type]').value, $('[data-note]').value.trim());
        $('[data-ftype]').value = this.filter.type;
        $('[data-fstatus]').value = this.filter.status;
        $('[data-ftype]').onchange = (e) => { this.filter.type = e.target.value; this.renderList(); };
        $('[data-fstatus]').onchange = (e) => { this.filter.status = e.target.value; this.renderList(); };
        this.renderList();
        this.renderDetail();
    }

    renderList() {
        const list = this.panel.querySelector('[data-list]');
        const level = this.views.level?.name;
        this.panel.querySelector('[data-scope]').textContent = level ? `(${level})` : '(all levels)';
        const shown = this.items.filter(i => (!this.filter.type || i.type === this.filter.type)
            && (!this.filter.status || i.status === this.filter.status) && (!level || i.level === level));
        list.innerHTML = shown.length ? '' : '<tr><td colspan="5" class="muted">No punch items match.</td></tr>';
        for (const item of shown) {
            const color = TYPES.find(t => t.name === item.type)?.color || '#999';
            const where = [item.point && '3D', Object.keys(item.sheetPoints).length && '2D'].filter(Boolean).join('+');
            const tr = document.createElement('tr');
            tr.className = `clickable ${item.id === this.selectedId ? 'selected' : ''}`;
            tr.innerHTML = `<td>${item.id}</td><td><span class="swatch" style="background:${color}"></span>${escapeHtml(item.type)}</td>
                <td>${escapeHtml(item.level || '')} <span class="muted">${where}</span></td><td>${item.status}${item.markup ? ' ✎' : ''}</td>
                <td><button data-jump title="Jump to 3D: cut at the level, look at the wall with the rooms around it">3D</button></td>`;
            tr.onclick = () => this.selectItem(item.id, true);
            tr.querySelector('[data-jump]').onclick = (e) => { e.stopPropagation(); this.selectItem(item.id, false); this.jumpTo3d(item); };
            list.appendChild(tr);
        }
    }

    renderDetail() {
        const box = this.panel.querySelector('[data-detail]');
        const item = this.items.find(i => i.id === this.selectedId);
        if (!item) { box.innerHTML = ''; return; }
        const editing = this.markupItemId === item.id;
        const sheets = Object.keys(item.sheetPoints).map(g => this.views.sheets.find(s => s.node.data.guid === g)?.node.name()).filter(Boolean);
        box.innerHTML = `<h3>${item.id} · ${escapeHtml(item.type)} <span class="muted">(${item.status})</span></h3>
            <p>${escapeHtml(item.note) || '<span class="muted">No note.</span>'}</p>
            <p class="muted">${escapeHtml(item.wallType || 'Unknown wall')} · ${escapeHtml(item.level || 'Unknown level')}
                ${sheets.length ? `<br>Pinned on ${sheets.map(escapeHtml).join(', ')}` : ''}
                <br>Added ${new Date(item.createdAt).toLocaleString()}${item.closedAt ? ` · closed ${new Date(item.closedAt).toLocaleString()}` : ''}</p>
            <div class="row"><button data-toggle>${item.status === 'open' ? 'Mark closed' : 'Reopen'}</button>
                <button data-fly>Fly to</button><button data-jump3d>Jump to 3D</button>
                ${item.markup && !editing ? `<button data-show-markup>${this.markupShownFor === item.id ? 'Hide markup' : 'Show markup'}</button>` : ''}
                ${editing ? '' : `<button data-draw>${item.markup ? 'Redraw markup' : 'Add markup'}</button>`}</div>
            ${editing ? `<div class="row">${Object.keys(MARKUP_TOOLS).map(t => `<button data-tool="${t}">${t}</button>`).join('')}
                <button data-markup-save>Save markup</button><button data-markup-cancel>Cancel</button></div>
                <p class="muted">Draw on the 3D view. Text: click, then type.</p>` : ''}`;
        const $ = (s) => box.querySelector(s);
        $('[data-toggle]').onclick = () => this.toggleStatus(item);
        $('[data-fly]').onclick = () => this.flyTo(item);
        $('[data-jump3d]').onclick = () => this.jumpTo3d(item);
        if ($('[data-show-markup]')) $('[data-show-markup]').onclick = () => this.toggleMarkup(item);
        if ($('[data-draw]')) $('[data-draw]').onclick = () => this.startMarkup(item);
        box.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => this.setMarkupTool(b.dataset.tool));
        if ($('[data-markup-save]')) $('[data-markup-save]').onclick = () => this.finishMarkup(true);
        if ($('[data-markup-cancel]')) $('[data-markup-cancel]').onclick = () => this.finishMarkup(false);
    }

    // --- Adding pins (3D or 2D) ------------------------------------------------------------------

    setAdding(on) {
        this.adding = on;
        for (const [viewer, { down, up }] of this.taps) {
            viewer.canvas.removeEventListener('pointerdown', down);
            viewer.canvas.removeEventListener('pointerup', up);
        }
        this.taps.clear();
        if (on) {
            for (const [viewer] of this.views.active) {
                const handlers = { down: (ev) => { this.down = { x: ev.clientX, y: ev.clientY }; }, up: (ev) => this.onTap(viewer, ev) };
                viewer.canvas.addEventListener('pointerdown', handlers.down);
                viewer.canvas.addEventListener('pointerup', handlers.up);
                this.taps.set(viewer, handlers);
            }
        }
        const btn = this.panel.querySelector('[data-add]');
        if (btn) { btn.classList.toggle('active', on); btn.textContent = on ? 'Adding… (click a wall)' : '+ Add pin'; }
    }

    // A tap (not a drag) while adding: find the wall and point under the cursor.
    // 3D: clientToWorld gives point + dbId. 2D sheets: hitTest gives dbId + intersectPoint.
    onTap(viewer, ev) {
        if (!this.down || Math.hypot(ev.clientX - this.down.x, ev.clientY - this.down.y) > 5) return;
        const rect = viewer.container.getBoundingClientRect();
        const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
        const is2d = viewer.model.is2d();
        const hit = is2d ? viewer.hitTest(x, y, true) : viewer.clientToWorld(x, y, true);
        const point = hit && (hit.intersectPoint || hit.point);
        const wall = hit && this.byDbId.get(hit.dbId);
        const hint = this.panel.querySelector('[data-hint]');
        if (!wall || !point) { hint.innerHTML = '<span class="warn">That is not a wall. Click on a wall.</span>'; return; }
        const p = { x: point.x, y: point.y, z: point.z || 0 };
        this.pending = is2d ? { wall, sheet: { guid: guidOf(viewer.model), point: p } } : { wall, point: p };
        this.setAdding(false);
        hint.textContent = 'Add a pin, then click a point on a wall in 3D or on the plan.';
        this.panel.querySelector('[data-where]').textContent = `${wall.wallType || 'Wall'} · ${wall.level || 'unknown level'} · ${is2d ? viewer.model.getDocumentNode().name() : '3D'}`;
        this.panel.querySelector('[data-form]').hidden = false;
        this.panel.querySelector('[data-note]').focus();
    }

    async addItem(type, note) {
        if (!this.pending) return;
        const { point, sheet, wall } = this.pending;
        const next = Math.max(0, ...this.items.map(i => Number(i.id.slice(2)) || 0)) + 1;
        const item = {
            id: `P-${String(next).padStart(3, '0')}`, type, note, status: 'open',
            dbId: wall.dbId, externalId: wall.externalId, wallType: wall.wallType, level: wall.level,
            point, view: point ? this.viewer.getState({ viewport: true }) : undefined,
            sheetPoints: sheet ? { [sheet.guid]: sheet.point } : {},
            createdAt: new Date().toISOString(),
        };
        this.items.push(item);
        this.pending = null;
        this.selectedId = item.id;
        this.filter.status = 'open';
        this.render();
        await this.save();
    }

    // --- List actions ---------------------------------------------------------------------------

    selectItem(id, fly) {
        this.selectedId = id;
        this.renderList();
        this.renderDetail();
        const item = this.items.find(i => i.id === id);
        if (fly && item) this.flyTo(item);
    }

    // 3D: the saved camera, else zoom to the wall. 2D: the sheet it was pinned on (if any), zoomed to the wall.
    async flyTo(item) {
        if (item.view) this.viewer.restoreState(item.view, null, false);
        else if (item.dbId) this.viewer.fitToView([item.dbId], this.viewer.model);
        const guid = Object.keys(item.sheetPoints)[0];
        const node = guid && this.views.sheets.find(s => s.node.data.guid === guid)?.node;
        if (node && guidOf(this.views.model2d) !== guid) await this.views.openSheet(node);
        if (this.views.model2d && item.dbId) this.views.viewer2d.fitToView([item.dbId], this.views.model2d);
        if (item.dbId) this.views.select([item.dbId]);
    }

    // Jump to 3D with context: cut the model at the item's level, then look at the pin (or the wall's center)
    // from about 35° above, standing on the building-interior side of the wall, far enough back to see the rooms.
    async jumpTo3d(item) {
        const viewer = this.viewer, model = viewer.model;
        if (!model || !item.dbId) return;
        if (this.views.layout === '2d') this.views.setLayout('split');
        if (item.level && this.views.level?.name !== item.level) await this.views.setLevel(item.level);
        viewer.fitToView([item.dbId], model, true); // immediate: the camera target is now the wall's center
        const nav = viewer.navigation;
        const wallCenter = nav.getTarget().clone();
        const fitDistance = nav.getEyeVector().length();
        const poi = item.point ? new THREE.Vector3(item.point.x, item.point.y, item.point.z) : wallCenter;
        const center = buildingCenter(model); // the middle of the building (its walls), not of objects far off the site
        const toCenter = new THREE.Vector3(center.x - poi.x, center.y - poi.y, 0);
        if (toCenter.length() < 1) toCenter.set(1, -1, 0); // pin near the middle: a standard 3/4 view
        toCenter.normalize();
        const distance = Math.max(30, fitDistance * 1.2); // model units are feet: at least ~30 ft back
        const pitch = (35 * Math.PI) / 180;
        const eye = poi.clone()
            .add(toCenter.multiplyScalar(distance * Math.cos(pitch)))
            .add(new THREE.Vector3(0, 0, distance * Math.sin(pitch)));
        nav.setView(eye, poi, new THREE.Vector3(0, 0, 1));
        nav.setPivotPoint(poi);
        this.views.select([item.dbId]);
    }

    async toggleStatus(item) {
        item.status = item.status === 'open' ? 'closed' : 'open';
        item.closedAt = item.status === 'closed' ? new Date().toISOString() : undefined;
        this.renderList();
        this.renderDetail();
        await this.save();
    }

    async save() {
        await this.refreshAll();
        try {
            await saveState(this.stateName, { items: this.items, updatedAt: new Date().toISOString() });
        } catch (err) {
            alert(`Punch list not saved: ${err.message}`);
        }
    }

    async refreshAll() {
        const colors = new Map();
        for (const item of this.items) {
            if (item.status === 'open' && item.dbId) colors.set(item.dbId, TYPES.find(t => t.name === item.type)?.color || '#999');
        }
        this.views.setColors(colors);
        await this.refreshSprites(this.dataViz, this.sprites['3d'], this.items.filter(i => i.point).map(i => [i, i.point]));
        await this.refresh2dSprites();
    }

    async refresh2dSprites() {
        const viewer2d = this.views.viewer2d;
        const guid = guidOf(this.views.model2d);
        if (!this.styles || !guid) return;
        const dataViz = viewer2d.getExtension(DATAVIZ) || await viewer2d.loadExtension(DATAVIZ);
        await this.refreshSprites(dataViz, this.sprites['2d'], this.items.filter(i => i.sheetPoints[guid]).map(i => [i, i.sheetPoints[guid]]));
    }

    // Rebuild one viewer's sprites, styled by type (grey check when closed).
    async refreshSprites(dataViz, ids, pins) {
        const Core = Autodesk.DataVisualization.Core;
        dataViz.removeAllViewables();
        ids.clear();
        if (!pins.length) return;
        const data = new Core.ViewableData();
        data.spriteSize = 28;
        pins.forEach(([item, { x, y, z }], i) => {
            ids.set(i + 1, item.id);
            const style = item.status === 'closed' ? this.closedStyle : (this.styles[item.type] || this.styles.Other);
            data.addViewable(new Core.SpriteViewable(new THREE.Vector3(x, y, z), style, i + 1));
        });
        await data.finish();
        dataViz.addViewables(data);
    }

    // --- Markups (MarkupsCore, on the 3D view) ----------------------------------------------------

    async getMarkups() {
        this.markups ??= await this.viewer.loadExtension('Autodesk.Viewing.MarkupsCore');
        return this.markups;
    }

    async startMarkup(item) {
        const markups = await this.getMarkups();
        if (item.view) this.viewer.restoreState(item.view, null, true); // markups belong to the pin's saved view
        markups.hide();
        markups.show();
        markups.enterEditMode();
        this.markupItemId = item.id;
        this.markupShownFor = null;
        this.setMarkupTool('Arrow');
        this.renderDetail();
    }

    setMarkupTool(tool) {
        const Core = Autodesk.Viewing.Extensions.Markups.Core;
        this.markups.changeEditMode(new Core[MARKUP_TOOLS[tool]](this.markups));
        this.panel.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    }

    async finishMarkup(keep) {
        const item = this.items.find(i => i.id === this.markupItemId);
        if (keep && item) {
            item.markup = this.markups.generateData();
            item.view = this.viewer.getState({ viewport: true });
        }
        this.markups.leaveEditMode();
        this.markups.hide();
        this.markupItemId = null;
        this.renderList();
        this.renderDetail();
        if (keep) await this.save();
    }

    async toggleMarkup(item) {
        const markups = await this.getMarkups();
        if (this.markupShownFor === item.id) {
            markups.hide();
            this.markupShownFor = null;
        } else {
            this.viewer.restoreState(item.view, null, true);
            markups.hide();
            markups.show();
            markups.loadMarkups(item.markup, MARKUP_LAYER);
            this.markupShownFor = item.id;
        }
        this.renderDetail();
    }

    exportCsv() {
        const sheetName = (g) => this.views.sheets.find(s => s.node.data.guid === g)?.node.name() || g;
        const header = ['ID', 'Type', 'Status', 'Note', 'Wall type', 'Level', 'Wall externalId', 'Created', 'Closed', 'X', 'Y', 'Z', 'Sheets', 'Has markup'];
        const rows = this.items.map(i => [i.id, i.type, i.status, i.note, i.wallType, i.level, i.externalId, i.createdAt, i.closedAt || '',
            i.point?.x.toFixed(3) ?? '', i.point?.y.toFixed(3) ?? '', i.point?.z.toFixed(3) ?? '',
            Object.keys(i.sheetPoints).map(sheetName).join('; '), i.markup ? 'yes' : 'no']);
        downloadCsv('punch-list.csv', [header, ...rows]);
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, PunchExtension);
