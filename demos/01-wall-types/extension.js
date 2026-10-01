// Demo 01: Wall Type & Fire-Rating Explorer
// Spec and acceptance criteria: demos/01-wall-types/README.md
// Colors and isolation go through core/client/views.js, so they show on the 3D model and the 2D plan/sheet.
// Viewer3D (setThemingColor, clearThemingColors, isolate, fitToView): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Model (getBulkProperties, getObjectTree): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Model/
import { loadPropertyMap, getWallData, onModelReady, paletteColor, NOT_SET_COLOR, escapeHtml } from '../../helpers.js';
import { DemoToolbar } from '../../toolbar.js';

const EXTENSION_ID = 'Drywall.WallTypes';
const NOT_SET = 'Not set';
// Fire ratings read as a heat scale; anything else falls back to the shared palette.
const FIRE_COLORS = { 'NR': '#76b7b2', '1 HR': '#f2c14e', '2 HR': '#f78154', '3 HR': '#d7263d', '4 HR': '#8e1b2c' };
const MODES = { wallType: 'Wall type', fireRating: 'Fire rating' };

class WallTypesExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.mode = 'wallType';
        this.colored = true; // Reset turns coloring off until a mode or level is picked again
        this.panel = this.options.panel;
        this.panel.innerHTML = `<div class="demo-panel"><h2>Wall Type &amp; Fire-Rating Explorer</h2>
            <p class="muted" data-status>Waiting for a model…</p></div>`;
        this.stops = [
            onModelReady(this.viewer, (model) => this.init(model)),
            this.views.on('level', () => { if (this.walls && !this.resetting) { this.colored = true; this.render(); } }),
            this.views.on('ready', () => { if (this.walls) this.render(); }),
        ];
        return true;
    }

    unload() {
        this.stops.forEach(stop => stop());
        this.bar?.remove();
        this.views.clearColors();
        this.views.isolate(null, { fit: false });
        this.panel.innerHTML = '';
        return true;
    }

    // The 3D toolbar: color by wall type or fire rating, and isolate the picked wall's type or rating.
    // Extension.onToolbarCreated: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Extension/
    onToolbarCreated() {
        if (this.bar) return;
        this.bar = new DemoToolbar(this.viewer, 'dw-walltypes', [
            { key: 'color', icon: 'dw-icon-colors', tip: 'Color the walls by wall type or fire rating', items: [
                ...Object.entries(MODES).map(([k, label]) => ({ key: k, icon: `dw-icon-mode-${k}`, tip: `Color by ${label.toLowerCase()}`, run: () => this.setMode(k), on: () => this.colored && this.mode === k })),
                { key: 'off', icon: 'dw-icon-mode-off', tip: 'No colors', run: () => { this.colored = false; this.render(); }, on: () => !this.colored },
            ] },
            { key: 'same', icon: 'dw-icon-iso-same', tip: 'Show only the walls like the picked one (same wall type, or same fire rating when coloring by rating)', run: () => this.isolateLikePicked() },
        ]);
    }

    setMode(mode) {
        this.mode = mode;
        this.colored = true;
        this.render();
        this.bar?.refresh();
    }

    // The picked wall's type (or fire rating), all levels or the header's level: isolated in 3D and on the plan.
    isolateLikePicked() {
        if (!this.walls) return;
        const picked = this.walls.find(w => w.dbId === this.viewer.getSelection()[0]);
        if (!picked) return;
        const key = picked[this.mode] ?? NOT_SET;
        this.views.isolate(this.walls.filter(w => (w[this.mode] ?? NOT_SET) === key && (!this.level || (w.level ?? NOT_SET) === this.level)).map(w => w.dbId));
    }

    async init(model) {
        this.model = model;
        try {
            this.map = await loadPropertyMap();
            const { walls, missing } = await getWallData(model, this.map);
            this.walls = walls;
            this.missing = missing;
            this.render();
        } catch (err) {
            this.panel.querySelector('[data-status]').textContent = `Could not read wall properties: ${err.message || err}`;
        }
    }

    get level() {
        return this.views.level?.name || '';
    }

    render() {
        // Levels in elevation order when known (views.levels), else by name.
        const wallLevels = new Set(this.walls.map(w => w.level ?? NOT_SET));
        const levels = this.views.levels.length ? this.views.levels.map(l => l.name).filter(n => wallLevels.has(n))
            : [...wallLevels].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const missingNote = this.missing.length
            ? `<p class="warn">No wall has ${this.missing.map(k => `"${escapeHtml(this.map[k])}"`).join(', ')}. Fix the name in samples/property-map.json.</p>` : '';
        this.panel.innerHTML = `<div class="demo-panel"><h2>Wall Type &amp; Fire-Rating Explorer</h2>
            <p class="muted">${this.walls.length} walls in this model. Colors show on the 3D model and the 2D plan.</p>${missingNote}
            <div class="row">Color by
                ${Object.entries(MODES).map(([k, label]) => `<button data-mode="${k}" class="${k === this.mode ? 'active' : ''}">${label}</button>`).join('')}
            </div>
            <div class="row"><label>Level <select data-level>
                <option value="">All levels</option>
                ${levels.map(l => `<option value="${escapeHtml(l)}" ${l === this.level ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
            </select></label><button data-reset>Reset</button></div>
            <p class="muted">${this.level ? `Showing ${escapeHtml(this.level)}: the 3D view is cut at this floor and the 2D pane shows its plan.` : 'Pick a level to cut the 3D view at that floor and open its plan.'}</p>
            <h3>${MODES[this.mode]} legend <span class="muted">(click a row to isolate)</span></h3>
            <table><thead><tr><th>${MODES[this.mode]}</th><th class="num">Walls</th></tr></thead><tbody data-legend></tbody></table>
            <p class="note">Property names from samples/property-map.json: ${escapeHtml(this.map[this.mode])}, level = ${escapeHtml(this.map.level)}.</p></div>`;
        this.panel.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => this.setMode(b.dataset.mode));
        this.panel.querySelector('[data-level]').onchange = (e) => this.views.setLevel(e.target.value || null);
        this.panel.querySelector('[data-reset]').onclick = () => this.reset();
        this.apply();
    }

    // Color the walls by the current mode and build the legend (counts for the current level).
    apply() {
        const visible = this.walls.filter(w => !this.level || (w.level ?? NOT_SET) === this.level);
        const groups = new Map();
        for (const w of visible) {
            const key = w[this.mode] ?? NOT_SET;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(w.dbId);
        }
        const entries = [...groups.entries()].sort((a, b) => (a[0] === NOT_SET) - (b[0] === NOT_SET) || b[1].length - a[1].length);
        let paletteIndex = 0;
        const colorOf = (key) => key === NOT_SET ? NOT_SET_COLOR : (this.mode === 'fireRating' && FIRE_COLORS[key]) || paletteColor(paletteIndex++);

        const colors = new Map();
        const legend = this.panel.querySelector('[data-legend]');
        legend.innerHTML = '';
        for (const [key, ids] of entries) {
            const color = colorOf(key);
            if (this.colored) ids.forEach(id => colors.set(id, color));
            const tr = document.createElement('tr');
            tr.className = 'clickable';
            tr.innerHTML = `<td><span class="swatch" style="background:${color}"></span>${escapeHtml(key)}</td><td class="num">${ids.length}</td>`;
            tr.onclick = () => {
                legend.querySelectorAll('tr').forEach(r => r.classList.toggle('selected', r === tr));
                this.views.isolate(ids);
            };
            legend.appendChild(tr);
        }
        if (!entries.length) legend.innerHTML = '<tr><td colspan="2" class="muted">No walls on this level.</td></tr>';
        this.views.setColors(colors);
        this.views.isolate(null, { fit: false });
        this.bar?.refresh();
    }

    // Clear colors, isolation and the level section.
    async reset() {
        this.resetting = true;
        try {
            await this.views.setLevel(null);
        } finally {
            this.resetting = false;
        }
        this.colored = false;
        this.views.isolate(null);
        this.render();
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, WallTypesExtension);
