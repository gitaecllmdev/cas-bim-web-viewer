// Demo 07: 3D Model Explorer: a tour of what the 3D viewer can do with a BIM model.
// Spec and acceptance criteria: demos/07-explorer/README.md
// Viewer3D (isolate, hide, show, showAll, setGhosting, explode, setDisplayEdges, setLightPreset, setGroundShadow,
//   setQualityLevel, setBackgroundColor, fitToView, getSelection, SELECTION_CHANGED_EVENT, loadExtension, getExtension):
//   https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Navigation (getTarget, getEyeVector, setView): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Navigation/
// Built-in extensions: Autodesk.Section (setSectionPlane, deactivate), Autodesk.BimWalk (activate, deactivate),
//   Autodesk.Measure (activate, deactivate): https://aps.autodesk.com/en/docs/viewer/v7/reference/Extensions/
// Colors and isolation go through core/client/views.js, so the 2D plan follows the 3D view.
import { loadPropertyMap, onModelReady, getBulkProperties, getLeafDbIds, propValue, escapeHtml, fetchJson } from '../../helpers.js';
import { assemblyFor } from '../02-takeoff/calc.mjs';
import { depthColor } from '../02-takeoff/colors.mjs';

const EXTENSION_ID = 'Drywall.Explorer';

// What each object is, from its Revit category (first match wins). Framing walls come from the takeoff rules.
const GROUPS = [
    { key: 'framing', label: 'Framing walls (CFS)', color: '#1f6fd1', test: (o) => o.cat === 'Revit Walls' && o.framed && !o.shaft },
    { key: 'shaft', label: 'Shaft walls', color: '#ff7f0e', test: (o) => o.cat === 'Revit Walls' && o.shaft },
    { key: 'otherWalls', label: 'Other walls', color: '#7f7f7f', test: (o) => o.cat === 'Revit Walls' },
    { key: 'curtain', label: 'Curtain wall & windows', color: '#17becf', test: (o) => /Curtain|Windows/.test(o.cat) },
    { key: 'doors', label: 'Doors', color: '#8c564b', test: (o) => o.cat === 'Revit Doors' },
    { key: 'floors', label: 'Floors & roofs', color: '#bcbd22', test: (o) => /Floors|Roofs/.test(o.cat) },
    { key: 'ceilings', label: 'Ceilings', color: '#c5b0d5', test: (o) => /Ceilings/.test(o.cat) },
    { key: 'structure', label: 'Structure', color: '#d62728', test: (o) => /Structural|Columns|Foundation/.test(o.cat) },
    { key: 'mep', label: 'MEP', color: '#2ca02c', test: (o) => /Lighting|Plumbing|Air Terminal|Electrical|Fire Alarm|Sprinkler|Mechanical|Duct|Pipe|Conduit|Cable|Data Devices|Communication|Security|Telephone/.test(o.cat) },
    { key: 'stairs', label: 'Stairs & railings', color: '#9467bd', test: (o) => /Stairs|Railings|Rails|Ramps|Handrails/.test(o.cat) },
    { key: 'interiors', label: 'Casework & furniture', color: '#e377c2', test: (o) => /Casework|Furniture|Specialty|Generic Models|Entourage|Planting/.test(o.cat) },
    { key: 'site', label: 'Site', color: '#637939', test: (o) => /Topography|Toposolid|Site|Parking/.test(o.cat) },
    { key: 'other', label: 'Everything else', color: '#bdbdbd', test: () => true },
];
const MODES = { isolate: 'Isolate', ghost: 'Ghost the rest', hide: 'Hide' };
const COLORS = { off: 'Off', group: 'By group', studs: 'Walls by stud size', level: 'By level' };
const PALETTE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#17becf', '#8c564b', '#e377c2', '#bcbd22', '#393b79', '#ad494a', '#637939', '#e7ba52', '#6b6ecf'];
const VIEWS = { top: 'Top', front: 'Front', side: 'Side', iso: '3/4 view' };
const LEVEL_PROPS = ['Base Constraint', 'Level', 'Reference Level', 'Schedule Level'];

class ExplorerExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.panel = this.options.panel;
        this.panel.classList.add('wide');
        this.mode = 'isolate';
        this.colorMode = 'off';
        this.picked = new Set(); // group keys in use
        this.panel.innerHTML = '<div class="demo-panel ex"><h2>3D Model Explorer</h2><p class="muted" data-status>Waiting for a model…</p></div>';
        this.onSelection = () => this.showPick();
        this.viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection);
        this.stops = [onModelReady(this.viewer, (model) => this.init(model)), this.views.on('level', () => this.renderCut())];
        return true;
    }

    unload() {
        this.stops.forEach(stop => stop());
        this.stopOrbit();
        this.viewer.removeEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection);
        this.views.clearColors();
        this.views.showAll();
        this.viewer.explode(0);
        this.viewer.setGhosting(true);
        this.panel.classList.remove('wide');
        this.panel.innerHTML = '';
        return true;
    }

    // Every object's category, type and level (one property query), sorted into the groups.
    async init(model) {
        this.model = model;
        const status = this.panel.querySelector('[data-status]');
        try {
            const [map, rules] = await Promise.all([loadPropertyMap(), fetchJson('samples/takeoff-rules.json')]);
            const rows = await getBulkProperties(model, await getLeafDbIds(model), ['Category', 'Type Name', ...LEVEL_PROPS]);
            const ignore = new Set(map.ignore?.categories || []), ignoreRe = map.ignore?.categoryPattern ? new RegExp(map.ignore.categoryPattern, 'i') : null;
            this.objects = [];
            const levelRefs = new Map(); // object -> dbId of its level (doors, curtain panels: only a reference to it)
            for (const r of rows) {
                const cat = propValue(r, 'Category') || '';
                if (!cat || ignore.has(cat) || ignoreRe?.test(cat) || /<Room Separation>|Lines/.test(cat)) continue;
                const type = propValue(r, 'Type Name') || '';
                const named = r.properties.find(p => LEVEL_PROPS.includes(p.displayName) && !p.displayCategory?.startsWith('__') && typeof p.displayValue === 'string' && p.displayValue);
                const o = { dbId: r.dbId, cat, type, level: named?.displayValue || '' };
                if (!o.level) {
                    const ref = r.properties.find(p => p.displayName === 'Level' && p.displayCategory === '__internalref__' && Number.isInteger(p.displayValue));
                    if (ref) levelRefs.set(o, ref.displayValue);
                }
                if (cat === 'Revit Walls') {
                    const a = assemblyFor(type, rules);
                    o.framed = a.scope === 'framed';
                    o.shaft = o.framed && (a.finishClass === 'SHAFT' || /shaft/i.test(type));
                    o.studIn = o.framed ? a.studIn : null;
                }
                o.group = GROUPS.find(g => g.test(o)).key;
                this.objects.push(o);
            }
            // Level references: the level element's name ("10TH FLOOR [22165688]" -> "10TH FLOOR").
            if (levelRefs.size) {
                const names = new Map((await getBulkProperties(model, [...new Set(levelRefs.values())], ['name'])).map(r => [r.dbId, String(r.name || '').replace(/\s*\[\d+\]$/, '')]));
                for (const [o, id] of levelRefs) o.level = names.get(id) || '';
            }
            this.byDbId = new Map(this.objects.map(o => [o.dbId, o]));
            this.render();
        } catch (err) {
            if (status) status.textContent = `Could not read the model: ${err.message || err}`;
        }
    }

    idsOf(keys) {
        return this.objects.filter(o => keys.has(o.group)).map(o => o.dbId);
    }

    render() {
        const counts = new Map(GROUPS.map(g => [g.key, 0]));
        for (const o of this.objects) counts.set(o.group, counts.get(o.group) + 1);
        const chip = (g) => `<button class="ex-chip" data-g="${g.key}" title="Click: this group only · Ctrl+click: add or remove it"><i style="background:${g.color}"></i>${g.label} <b>${counts.get(g.key).toLocaleString()}</b></button>`;
        this.panel.innerHTML = `<div class="demo-panel ex">
            <h2>3D Model Explorer</h2>
            <p class="muted">What the web viewer can do with a BIM model: ${this.objects.length.toLocaleString()} objects, read with their properties. Pick what to see, color it, cut it, explode it, walk through it.</p>
            <section class="ex-sec"><h3><span>1</span> Isolate by what it is</h3>
                <div class="ex-row"><div class="tk-tabs">${Object.entries(MODES).map(([k, l]) => `<button data-mode="${k}" class="${k === this.mode ? 'active' : ''}">${l}</button>`).join('')}</div>
                    <button class="pg-btn" data-all>Show everything</button></div>
                <div class="ex-groups">${GROUPS.filter(g => counts.get(g.key)).map(chip).join('')}</div>
                <p class="ex-note" data-iso-note>Isolate shows only the group; Ghost keeps the rest see-through for context; Hide takes the group away.</p></section>
            <section class="ex-sec"><h3><span>2</span> Color the model</h3>
                <div class="ex-row"><div class="tk-tabs">${Object.entries(COLORS).map(([k, l]) => `<button data-color="${k}" class="${k === this.colorMode ? 'active' : ''}">${l}</button>`).join('')}</div></div>
                <div class="ex-legend" data-legend></div></section>
            <section class="ex-sec"><h3><span>3</span> Cut and explode</h3>
                <div class="ex-row"><span class="ex-lbl">Section</span><button class="pg-btn" data-cut="z" title="A horizontal cut, like a floor plan">Plan cut</button>
                    <button class="pg-btn" data-cut="x" title="A vertical cut across the building">Cut across</button><button class="pg-btn" data-cut="y" title="A vertical cut along the building">Cut along</button>
                    <button class="pg-btn" data-cut="off">No cut</button></div>
                <div class="ex-row"><span class="ex-lbl">Floors</span><button class="pg-btn" data-floor="-1">▼ Floor below</button><span class="ex-floor" data-floor-name></span>
                    <button class="pg-btn" data-floor="1">Floor above ▲</button><button class="pg-btn" data-floor="0">Whole building</button></div>
                <div class="ex-row"><span class="ex-lbl">Explode</span><input type="range" data-explode min="0" max="1" step="0.01" value="0" aria-label="Explode the model">
                    <span class="muted" data-explode-val>0%</span></div></section>
            <section class="ex-sec"><h3><span>4</span> Move around</h3>
                <div class="ex-row">${Object.entries(VIEWS).map(([k, l]) => `<button class="pg-btn" data-view="${k}">${l}</button>`).join('')}
                    <button class="pg-btn" data-orbit title="Turn around the building">⟳ Orbit</button></div>
                <div class="ex-row"><button class="pg-btn" data-walk title="First person: W A S D to walk, the mouse to look around">🚶 Walk inside</button>
                    <button class="pg-btn" data-measure title="Click two points to measure">📏 Measure</button><span class="muted" data-tool-note></span></div></section>
            <section class="ex-sec"><h3><span>5</span> Display</h3>
                <div class="ex-row"><label class="pg-check"><input type="checkbox" data-disp="edges" checked> Edges</label>
                    <label class="pg-check"><input type="checkbox" data-disp="ao" checked> Ambient shadows</label>
                    <label class="pg-check"><input type="checkbox" data-disp="ground"> Ground shadow</label>
                    <select data-light title="Lighting">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<option value="${i}">Lighting ${i + 1}</option>`).join('')}</select>
                    <select data-bg title="Background"><option value="light">Light background</option><option value="sky">Sky</option><option value="dark">Dark</option></select></div></section>
            <section class="ex-sec"><h3>Picked object</h3><div data-pick class="muted">Click anything in the model to see what it is.</div></section>
            <details class="ex-sec ex-howto"><summary>How it works: 3D concepts</summary>
                <p><b>A model of objects, not a picture.</b> Revit's model is translated once into a streamable 3D format. Every wall, door and light keeps an id and its Revit properties (category, type, level…), which is how this page finds "all framing walls" in a moment.</p>
                <p><b>Isolate, ghost, hide.</b> The same objects can be shown alone, shown with the rest faded for context, or taken away, without changing the model.</p>
                <p><b>Theming colors</b> paint objects by any property (group, stud size, level, install stage in the progress tracker) on the 3D model and on the 2D sheets at once, because both share the same ids.</p>
                <p><b>Sections and floors.</b> A cutting plane or box shows inside the building; a floor cut plus that floor's sheet is how the other demos show a level.</p>
                <p><b>Explode</b> pulls objects apart from the middle to show how they stack. <b>Walk</b> is a first-person camera; <b>Measure</b> snaps to the real geometry.</p>
                <p><b>Same data, other tools.</b> The takeoff, shop drawings, punch list and schedule all read these objects and properties; nothing is re-modeled.</p></details>
        </div>`;
        const p = this.panel;
        p.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { this.mode = b.dataset.mode; p.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x === b)); this.applyGroups(); });
        p.querySelectorAll('[data-g]').forEach(b => b.onclick = (e) => {
            const k = b.dataset.g;
            if (e.ctrlKey || e.metaKey) { this.picked.has(k) ? this.picked.delete(k) : this.picked.add(k); }
            else this.picked = this.picked.size === 1 && this.picked.has(k) ? new Set() : new Set([k]);
            this.applyGroups();
        });
        p.querySelector('[data-all]').onclick = () => { this.picked = new Set(); this.applyGroups(); this.frame(); };
        p.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { this.colorMode = b.dataset.color; p.querySelectorAll('[data-color]').forEach(x => x.classList.toggle('active', x === b)); this.applyColors(); });
        p.querySelectorAll('[data-cut]').forEach(b => b.onclick = () => this.cut(b.dataset.cut));
        p.querySelectorAll('[data-floor]').forEach(b => b.onclick = () => this.stepFloor(Number(b.dataset.floor)));
        p.querySelector('[data-explode]').oninput = (e) => { this.viewer.explode(Number(e.target.value)); p.querySelector('[data-explode-val]').textContent = `${Math.round(e.target.value * 100)}%`; };
        p.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { this.stopOrbit(); this.look(b.dataset.view); });
        p.querySelector('[data-orbit]').onclick = () => (this.orbitTimer ? this.stopOrbit() : this.orbit());
        p.querySelector('[data-walk]').onclick = () => this.toggleTool('Autodesk.BimWalk', 'walk');
        p.querySelector('[data-measure]').onclick = () => this.toggleTool('Autodesk.Measure', 'measure');
        p.querySelectorAll('[data-disp]').forEach(c => c.onchange = () => this.applyDisplay());
        p.querySelector('[data-light]').onchange = (e) => this.viewer.setLightPreset(Number(e.target.value));
        p.querySelector('[data-bg]').onchange = (e) => this.background(e.target.value);
        this.applyGroups();
        this.applyColors();
        this.renderCut();
        this.showPick();
    }

    // --- 1. Isolate / ghost / hide groups -------------------------------------------------------------------------
    applyGroups() {
        this.panel.querySelectorAll('[data-g]').forEach(b => b.classList.toggle('on', this.picked.has(b.dataset.g)));
        const note = this.panel.querySelector('[data-iso-note]');
        if (!this.picked.size) {
            this.viewer.setGhosting(true);
            this.views.showAll();
            if (note) note.textContent = 'Isolate shows only the group; Ghost keeps the rest see-through for context; Hide takes the group away. Ctrl+click to combine groups.';
            return;
        }
        const ids = this.idsOf(this.picked);
        const names = GROUPS.filter(g => this.picked.has(g.key)).map(g => g.label).join(' + ');
        if (this.mode === 'hide') {
            this.views.showAll();
            this.views.hide(ids);
        } else {
            this.viewer.setGhosting(this.mode === 'ghost');
            this.views.isolate(ids, { fit: this.mode === 'isolate' });
        }
        if (note) note.textContent = `${MODES[this.mode]}: ${names} (${ids.length.toLocaleString()} objects).`;
    }

    // --- 2. Colors -----------------------------------------------------------------------------------------------------
    applyColors() {
        const legend = this.panel.querySelector('[data-legend]');
        const colors = new Map(), keys = [];
        if (this.colorMode === 'group') {
            const g = new Map(GROUPS.map(x => [x.key, x]));
            for (const o of this.objects) if (o.group !== 'other') colors.set(o.dbId, g.get(o.group).color);
            keys.push(...GROUPS.filter(x => x.key !== 'other' && this.objects.some(o => o.group === x.key)).map(x => [x.label, x.color]));
        } else if (this.colorMode === 'studs') {
            const sizes = new Map();
            for (const o of this.objects) if (o.studIn) { const c = depthColor(o.studIn); colors.set(o.dbId, c); sizes.set(o.studIn, c); }
            keys.push(...[...sizes].sort((a, b) => a[0] - b[0]).map(([s, c]) => [`${fmtIn(s)} stud`, c]));
        } else if (this.colorMode === 'level') {
            const order = this.views.levels.map(l => l.name), names = [...new Set(this.objects.map(o => o.level).filter(Boolean))];
            names.sort((a, b) => ((order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)) || a.localeCompare(b, undefined, { numeric: true }));
            const c = new Map(names.map((n, i) => [n, PALETTE[i % PALETTE.length]]));
            for (const o of this.objects) if (o.level) colors.set(o.dbId, c.get(o.level));
            keys.push(...names.map(n => [n, c.get(n)]));
        }
        this.views.setColors(colors);
        legend.innerHTML = keys.length ? keys.map(([l, c]) => `<span class="tk-key"><span class="swatch" style="background:${c}"></span>${escapeHtml(l)}</span>`).join('')
            : '<span class="muted">The model in its own materials.</span>';
    }

    // --- 3. Sections, floors, explode ------------------------------------------------------------------------------
    async cut(axis) {
        const section = this.viewer.getExtension('Autodesk.Section') || await this.viewer.loadExtension('Autodesk.Section');
        if (axis === 'off') {
            section.deactivate(false);
            if (this.views.level) await this.views.setLevel(this.views.level.name); // the floor cut comes back
            return;
        }
        const c = this.center();
        const normal = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }[axis];
        section.setSectionPlane(normal, c.point);
    }

    async stepFloor(step) {
        const levels = this.views.levels;
        if (!step) { await this.views.setLevel(null); return; }
        const at = levels.findIndex(l => l.name === this.views.level?.name);
        const next = levels[Math.max(0, Math.min(levels.length - 1, at < 0 ? (step > 0 ? 0 : levels.length - 1) : at + step))];
        if (next) await this.views.setLevel(next.name);
    }

    renderCut() {
        const el = this.panel.querySelector('[data-floor-name]');
        if (el) el.textContent = this.views.level?.name || 'Whole building';
    }

    // --- 4. Camera -------------------------------------------------------------------------------------------------------
    center() {
        const b = this.views.building;
        if (b) return { point: b.center.clone(), radius: b.radius };
        const box = this.model.getBoundingBox();
        return { point: new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5), radius: box.getSize(new THREE.Vector3()).length() / 2 };
    }

    frame() {
        this.viewer.fitToView(this.shown(), this.model);
    }

    // What is on screen: the isolated objects, else the building's walls.
    shown() {
        return this.views.isolated || this.objects.filter(o => o.cat === 'Revit Walls').map(o => o.dbId);
    }

    // Look from a direction, then fit what is on screen (fitToView keeps the view direction).
    look(view) {
        const { point: c, radius: r } = this.center(), up = new THREE.Vector3(0, 0, 1);
        const dir = { top: [0, -0.001, 1], front: [0, -1, 0.12], side: [1, 0, 0.12], iso: [1, -1, 0.8] }[view];
        const eye = c.clone().add(new THREE.Vector3(...dir).normalize().multiplyScalar(r * 2));
        this.viewer.navigation.setView(eye, c, view === 'top' ? new THREE.Vector3(0, 1, 0) : up);
        this.viewer.fitToView(this.shown(), this.model, true);
    }

    // Turn around the point looked at, at the same distance and height.
    orbit() {
        const nav = this.viewer.navigation, c = nav.getTarget().clone(), eye0 = nav.getPosition().clone();
        const radius = Math.hypot(eye0.x - c.x, eye0.y - c.y) || this.center().radius * 2;
        const start = Math.atan2(eye0.y - c.y, eye0.x - c.x), height = eye0.z;
        let angle = 0;
        this.orbitTimer = setInterval(() => {
            angle += Math.PI / 300;
            nav.setView(new THREE.Vector3(c.x + radius * Math.cos(start + angle), c.y + radius * Math.sin(start + angle), height), c, new THREE.Vector3(0, 0, 1));
        }, 33);
        this.panel.querySelector('[data-orbit]')?.classList.add('active');
    }

    stopOrbit() {
        clearInterval(this.orbitTimer);
        this.orbitTimer = null;
        this.panel.querySelector('[data-orbit]')?.classList.remove('active');
    }

    // Walk (first person) and Measure: built-in tools, one at a time.
    async toggleTool(id, key) {
        this.stopOrbit();
        const note = this.panel.querySelector('[data-tool-note]');
        const other = key === 'walk' ? ['Autodesk.Measure', 'measure'] : ['Autodesk.BimWalk', 'walk'];
        if (this.tool === other[1]) { this.viewer.getExtension(other[0])?.deactivate(); this.panel.querySelector(`[data-${other[1]}]`)?.classList.remove('active'); }
        const ext = this.viewer.getExtension(id) || await this.viewer.loadExtension(id);
        const button = this.panel.querySelector(`[data-${key}]`);
        if (this.tool === key) {
            ext.deactivate();
            this.tool = null;
            button.classList.remove('active');
            note.textContent = '';
            return;
        }
        if (key === 'measure') ext.activate('distance'); else ext.activate();
        this.tool = key;
        button.classList.add('active');
        note.textContent = key === 'walk' ? 'W A S D to walk, drag to look around, Esc or click again to stop.' : 'Click two points on the model; Esc to clear.';
    }

    // --- 5. Display ---------------------------------------------------------------------------------------------------------
    applyDisplay() {
        const on = (k) => this.panel.querySelector(`[data-disp="${k}"]`).checked;
        this.viewer.setDisplayEdges(on('edges'));
        this.viewer.setQualityLevel(on('ao'), true);
        this.viewer.setGroundShadow(on('ground'));
    }

    background(kind) {
        const set = { light: [255, 255, 255, 230, 234, 238], sky: [190, 214, 240, 245, 248, 252], dark: [40, 44, 52, 20, 22, 26] }[kind];
        this.viewer.setBackgroundColor(...set);
    }

    // --- The picked object ----------------------------------------------------------------------------------------------
    async showPick() {
        const el = this.panel.querySelector('[data-pick]');
        if (!el || !this.objects) return;
        const id = this.viewer.getSelection()[0];
        const o = id != null && this.byDbId.get(id);
        if (!o) { el.innerHTML = '<span class="muted">Click anything in the model to see what it is.</span>'; return; }
        const g = GROUPS.find(x => x.key === o.group), sameType = this.objects.filter(x => x.type && x.type === o.type).length;
        el.innerHTML = `<div class="ex-pick"><b>${escapeHtml(o.type || o.cat.replace(/^Revit /, ''))}</b>
            <span>${escapeHtml(o.cat.replace(/^Revit /, ''))}${o.level ? ` · ${escapeHtml(o.level)}` : ''}${o.studIn ? ` · ${fmtIn(o.studIn)} studs` : ''}</span>
            <span><i style="background:${g.color}"></i>${g.label}</span>
            <div class="ex-row"><button class="pg-btn" data-iso-group>Isolate: ${escapeHtml(g.label)}</button>
                ${o.type ? `<button class="pg-btn" data-iso-type>Isolate this type (${sameType.toLocaleString()})</button>` : ''}</div></div>`;
        el.querySelector('[data-iso-group]').onclick = () => { this.picked = new Set([o.group]); this.mode = 'isolate'; this.render(); };
        const t = el.querySelector('[data-iso-type]');
        if (t) t.onclick = () => { this.viewer.setGhosting(true); this.views.isolate(this.objects.filter(x => x.type === o.type).map(x => x.dbId)); };
    }
}

// 3.625 -> 3 5/8"
function fmtIn(v) {
    const whole = Math.floor(v + 1e-9), frac = Math.round((v - whole) * 8);
    const f = frac ? ({ 1: '1/8', 2: '1/4', 3: '3/8', 4: '1/2', 5: '5/8', 6: '3/4', 7: '7/8' })[frac] : '';
    return `${whole || ''}${whole && f ? ' ' : ''}${f}"`;
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, ExplorerExtension);
