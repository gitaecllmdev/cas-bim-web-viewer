// Demo 07: APS Viewer Capabilities: a tour of what the APS Viewer does with a BIM model, in 3D and 2D, with the
// detailed capability list (capabilities.mjs). Spec and acceptance criteria: demos/07-explorer/README.md
// Tabs: 3D model (this file), 2D + 3D (two-d.js), Review (review.js), All capabilities (capabilities.mjs).
// Viewer3D (search, isolate, hide, showAll, setGhosting, explode, setDisplayEdges, setQualityLevel, setGroundShadow,
//   setGroundReflection, setLightPreset, setBackgroundColor, setFOV, fitToView, getSelection, SELECTION_CHANGED_EVENT,
//   loadExtension, getExtension): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Navigation (getTarget, getPosition, setView): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Navigation/
// Model (getUnitString): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Model/
// Extensions (https://aps.autodesk.com/en/docs/viewer/v7/reference/Extensions/): SectionExtension (setSectionPlane,
//   activate('box'), deactivate), ExplodeExtension (setStrategy), BimWalkExtension, MeasureExtension (activate
//   'distance' | 'angle'), ZoomWindow (activate('zoomwindow')), FullScreenExtension, ModelStructureExtension,
//   PropertiesManagerExtension, ViewerSettingsExtension (activate, deactivate).
// Colors and isolation go through core/client/views.js, so the 2D plan follows the 3D view.
import { CONFIG } from '../../config.js';
import { loadPropertyMap, onModelReady, getBulkProperties, getLeafDbIds, propValue, escapeHtml, fetchJson } from '../../helpers.js';
import { assemblyFor } from '../02-takeoff/calc.mjs';
import { depthColor } from '../02-takeoff/colors.mjs';
import { CAPABILITIES, HOW, SOURCES, allCapabilities, capabilityTable } from './capabilities.mjs';
import { TwoD } from './two-d.js';
import { Review } from './review.js';

const EXTENSION_ID = 'Drywall.Explorer';

// What each object is, from its Revit category (first match wins). Framing walls come from the takeoff rules.
const GROUPS = [
    { key: 'framing', label: 'Framing walls (CFS)', color: '#1f6fd1', test: (o) => o.cat === 'Revit Walls' && o.framed && !o.shaft },
    { key: 'shaft', label: 'Shaft walls', color: '#ff7f0e', test: (o) => o.cat === 'Revit Walls' && o.shaft },
    { key: 'otherWalls', label: 'Other walls', color: '#7f7f7f', test: (o) => /^Revit (Walls|Wall Sweeps|Reveals)$/.test(o.cat) },
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
const COLORS = { off: 'Off', group: 'By group', studs: 'Walls by stud size', level: 'By level', prop: 'By property' };
// Properties to color by (most Revit models have these); the first value-bearing one per object is used.
const PROPERTIES = ['Workset', 'Phase Created', 'Fire Rating', 'Type Name', 'Structural Usage', 'Top Constraint', 'System Type', 'Material', 'Design Option'];
const PALETTE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#17becf', '#8c564b', '#e377c2', '#bcbd22', '#393b79', '#ad494a', '#637939', '#e7ba52', '#6b6ecf'];
const OTHER_COLOR = '#c7ccd1';
const VIEWS = { top: 'Top', front: 'Front', side: 'Side', iso: '3/4 view' };
const LEVEL_PROPS = ['Base Constraint', 'Level', 'Reference Level', 'Schedule Level'];
// Light presets by index (Viewer3D.setLightPreset, https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/GuiViewer3D/).
const LIGHTS = ['Simple Grey', 'Sharp Highlights', 'Dark Sky', 'Grey Room', 'Photo Booth', 'Tranquility', 'Infinity Pool', 'Simple White', 'Riverbank', 'Contrast', 'Rim Highlights', 'Cool Light', 'Warm Light', 'Soft Light', 'Grid Light', 'Plaza', 'Snow Field'];
const TABS = { model: '3D model', both: '2D + 3D', review: 'Review', all: 'All capabilities' };
// Built-in tools of the 3D view, one at a time: [extension id, how to start it].
const TOOLS = {
    walk: ['Autodesk.BimWalk', (e) => e.activate(), 'W A S D to walk, drag to look around; Esc or click again to stop.'],
    distance: ['Autodesk.Measure', (e) => e.activate('distance'), 'Click two points on the model; Esc to clear.'],
    angle: ['Autodesk.Measure', (e) => e.activate('angle'), 'Click three points: the angle at the middle one.'],
    zoom: ['Autodesk.Viewing.ZoomWindow', (e) => e.activate('zoomwindow'), 'Drag a box on the model to zoom into it.'],
};
const PANELS = { tree: ['Autodesk.ModelStructure', 'Model browser'], props: ['Autodesk.PropertiesManager', 'Properties'], settings: ['Autodesk.ViewerSettings', 'Viewer settings'] };

class ExplorerExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.panel = this.options.panel;
        this.panel.classList.add('wide');
        this.mode = 'isolate';
        this.colorMode = 'off';
        this.prop = PROPERTIES[0];
        this.picked = new Set(); // group keys in use
        this.found = null; // { text, ids } of the last search
        this.tab = 'model';
        this.isStatic = CONFIG.mode === 'static';
        this.twoD = new TwoD(this);
        this.review = new Review(this);
        this.propCache = new Map();
        this.panel.innerHTML = '<div class="demo-panel ex"><h2>APS Viewer Capabilities</h2><p class="muted" data-status>Waiting for a model…</p></div>';
        this.onSelection = () => this.showPick();
        this.viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection);
        this.stops = [onModelReady(this.viewer, (model) => this.init(model)),
            this.views.on('level', () => this.twoD.refresh()), this.views.on('sheet', () => this.twoD.refresh()),
            this.views.on('ready', () => this.renderStats())]; // levels and sheets are known once the views are ready
        return true;
    }

    unload() {
        this.stops.forEach(stop => stop());
        this.stopTools();
        this.twoD.stop();
        this.review.stop();
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
        this.modelName = document.getElementById('models')?.selectedOptions[0]?.text || 'Model';
        const status = this.panel.querySelector('[data-status]');
        try {
            const [map, rules] = await Promise.all([loadPropertyMap(), fetchJson('samples/takeoff-rules.json'), this.review.load()]);
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

    // --- The panel: a header, four tabs, each tab's sections ----------------------------------------------------------
    render() {
        const counts = new Map(GROUPS.map(g => [g.key, 0]));
        for (const o of this.objects) counts.set(o.group, counts.get(o.group) + 1);
        const chip = (g) => `<button class="ex-chip" data-g="${g.key}" title="Click: this group only · Ctrl+click: add or remove it"><i style="background:${g.color}"></i>${g.label} <b>${counts.get(g.key).toLocaleString()}</b></button>`;
        const caps = allCapabilities();
        this.panel.innerHTML = `<div class="demo-panel ex">
            <h2>APS Viewer Capabilities</h2>
            <p class="ex-stats" data-sec="stats"></p>
            <div class="tk-tabs ex-tabs">${Object.entries(TABS).map(([k, l]) => `<button data-tab="${k}">${l}${k === 'all' ? ` (${caps.length})` : ''}</button>`).join('')}</div>

            <div data-pane="model">
            <section class="ex-sec" data-sec="find"><h3><span>1</span> Find anything</h3>
                <div class="ex-row"><input class="ex-input" data-find-text placeholder="Any word in any property: 6&quot; STUD, 2 HR, a door mark…" aria-label="Search the model">
                    <button class="pg-btn" data-find>Find</button><button class="pg-btn" data-find-clear>Clear</button></div>
                <p class="ex-note" data-find-note>Searches every property of every object, then shows the matches with the rest see-through.</p></section>
            <section class="ex-sec" data-sec="groups"><h3><span>2</span> Isolate by what it is</h3>
                <div class="ex-row"><div class="tk-tabs">${Object.entries(MODES).map(([k, l]) => `<button data-mode="${k}" class="${k === this.mode ? 'active' : ''}">${l}</button>`).join('')}</div>
                    <button class="pg-btn" data-all>Show everything</button></div>
                <div class="ex-groups">${GROUPS.filter(g => counts.get(g.key)).map(chip).join('')}</div>
                <p class="ex-note" data-iso-note></p>
                <div class="ex-row" data-sec="panels"><span class="ex-lbl">Panels</span>${Object.entries(PANELS).map(([k, [, l]]) => `<button class="pg-btn" data-panel="${k}">${l}</button>`).join('')}</div></section>
            <section class="ex-sec" data-sec="color"><h3><span>3</span> Color the model</h3>
                <div class="ex-row"><div class="tk-tabs">${Object.entries(COLORS).map(([k, l]) => `<button data-color="${k}" class="${k === this.colorMode ? 'active' : ''}">${l}</button>`).join('')}</div>
                    <select data-prop title="The property to color by" hidden>${PROPERTIES.map(p => `<option${p === this.prop ? ' selected' : ''}>${p}</option>`).join('')}</select></div>
                <div class="ex-legend" data-legend></div></section>
            <section class="ex-sec" data-sec="cut"><h3><span>4</span> Cut and explode</h3>
                <div class="ex-row"><span class="ex-lbl">Section</span><button class="pg-btn" data-cut="z" title="A horizontal cut, like a floor plan">Plan cut</button>
                    <button class="pg-btn" data-cut="x" title="A vertical cut across the building">Cut across</button><button class="pg-btn" data-cut="y" title="A vertical cut along the building">Cut along</button>
                    <button class="pg-btn" data-cut="box" title="A box with handles: drag its faces">Box</button><button class="pg-btn" data-cut="off">No cut</button></div>
                <div class="ex-row"><span class="ex-lbl">Explode</span><input type="range" data-explode min="0" max="1" step="0.01" value="0" aria-label="Explode the model">
                    <span class="muted" data-explode-val>0%</span>
                    <select data-explode-how title="How to pull the model apart"><option value="radial">From the middle</option><option value="hierarchy">By object tree</option></select></div></section>
            <section class="ex-sec" data-sec="move"><h3><span>5</span> Move around and measure</h3>
                <div class="ex-row">${Object.entries(VIEWS).map(([k, l]) => `<button class="pg-btn" data-view="${k}">${l}</button>`).join('')}
                    <button class="pg-btn" data-orbit title="Turn around the building">⟳ Orbit</button><button class="pg-btn" data-full title="The viewer alone on the screen">⛶ Full screen</button></div>
                <div class="ex-row"><button class="pg-btn" data-tool="walk">🚶 Walk inside</button><button class="pg-btn" data-tool="distance">📏 Distance</button>
                    <button class="pg-btn" data-tool="angle">∠ Angle</button><button class="pg-btn" data-tool="zoom">⬚ Zoom window</button></div>
                <div class="ex-row"><span class="ex-lbl">Lens</span><input type="range" data-fov min="15" max="100" step="1" value="45" aria-label="Field of view"><span class="muted" data-fov-val>45°</span></div>
                <p class="ex-note" data-tool-note></p></section>
            <section class="ex-sec" data-sec="display"><h3><span>6</span> Display</h3>
                <div class="ex-row"><label class="pg-check"><input type="checkbox" data-disp="edges" checked> Edges</label>
                    <label class="pg-check"><input type="checkbox" data-disp="ao" checked> Ambient shadows</label>
                    <label class="pg-check"><input type="checkbox" data-disp="ground"> Ground shadow</label>
                    <label class="pg-check"><input type="checkbox" data-disp="reflect"> Ground reflection</label></div>
                <div class="ex-row"><select data-light title="Lighting environment">${LIGHTS.map((name, i) => `<option value="${i}">${name}</option>`).join('')}</select>
                    <select data-bg title="Background"><option value="light">Light background</option><option value="sky">Sky</option><option value="dark">Dark</option></select></div></section>
            <section class="ex-sec" data-sec="pick"><h3>Picked object</h3><div data-pick class="muted">Click anything in the model to see what it is.</div></section>
            <details class="ex-sec ex-howto"><summary>How it works: 3D concepts</summary>
                <p><b>A model of objects, not a picture.</b> Revit's model is translated once into a streamable format. Every wall, door and light keeps an id and its Revit properties (category, type, level…), which is how this page finds "all framing walls" in a moment.</p>
                <p><b>Isolate, ghost, hide.</b> The same objects can be shown alone, shown with the rest faded for context, or taken away, without changing the model.</p>
                <p><b>Theming colors</b> paint objects by any property on the 3D model and on the 2D sheets at once, because both share the same ids.</p>
                <p><b>Sections and floors.</b> A cutting plane or box shows inside the building; a floor cut plus that floor's sheet is how the other demos show a level.</p>
                <p><b>Same data, other tools.</b> The takeoff, shop drawings, punch list and schedule all read these objects and properties; nothing is re-modeled.</p></details>
            </div>

            <div data-pane="both" hidden>${this.twoD.html()}</div>
            <div data-pane="review" hidden>${this.review.html()}</div>
            <div data-pane="all" hidden>${this.capabilitiesHtml()}</div>
        </div>`;
        const p = this.panel;
        p.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => this.showTab(b.dataset.tab));
        p.querySelector('[data-find]').onclick = () => this.find();
        p.querySelector('[data-find-text]').onkeydown = (e) => { if (e.key === 'Enter') this.find(); };
        p.querySelector('[data-find-clear]').onclick = () => { p.querySelector('[data-find-text]').value = ''; this.found = null; this.applyGroups(); };
        p.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { this.mode = b.dataset.mode; this.applyGroups(); });
        p.querySelectorAll('[data-g]').forEach(b => b.onclick = (e) => {
            const k = b.dataset.g;
            if (e.ctrlKey || e.metaKey) { this.picked.has(k) ? this.picked.delete(k) : this.picked.add(k); }
            else this.picked = this.picked.size === 1 && this.picked.has(k) ? new Set() : new Set([k]);
            this.found = null;
            this.applyGroups();
        });
        p.querySelector('[data-all]').onclick = () => { this.picked = new Set(); this.found = null; this.applyGroups(); this.frame(); };
        p.querySelectorAll('[data-panel]').forEach(b => b.onclick = () => this.togglePanel(b.dataset.panel));
        p.querySelectorAll('[data-color]').forEach(b => b.onclick = () => this.setColorMode(b.dataset.color));
        p.querySelector('[data-prop]').onchange = (e) => { this.prop = e.target.value; this.propChosen = true; this.applyColors(); };
        p.querySelectorAll('[data-cut]').forEach(b => b.onclick = () => this.cut(b.dataset.cut));
        p.querySelector('[data-explode]').oninput = (e) => this.explode(Number(e.target.value));
        p.querySelector('[data-explode-how]').onchange = () => this.explode(this.explodeScale || 0);
        p.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { this.stopOrbit(); this.look(b.dataset.view); });
        p.querySelector('[data-orbit]').onclick = () => (this.orbitTimer ? this.stopOrbit() : this.orbit());
        p.querySelector('[data-full]').onclick = () => this.fullScreen();
        p.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => this.toggleTool(b.dataset.tool));
        p.querySelector('[data-fov]').oninput = (e) => { this.viewer.setFOV(Number(e.target.value)); p.querySelector('[data-fov-val]').textContent = `${e.target.value}°`; };
        p.querySelectorAll('[data-disp]').forEach(c => c.onchange = () => this.applyDisplay());
        p.querySelector('[data-light]').onchange = (e) => this.viewer.setLightPreset(Number(e.target.value));
        p.querySelector('[data-bg]').onchange = (e) => this.background(e.target.value);
        this.twoD.bind(p.querySelector('[data-pane="both"]'));
        this.review.bind(p.querySelector('[data-pane="review"]'));
        this.bindCapabilities(p.querySelector('[data-pane="all"]'));
        this.renderStats();
        this.showTab(this.tab);
        this.applyGroups();
        this.applyColors();
        this.showPick();
    }

    renderStats() {
        const el = this.panel.querySelector('[data-sec="stats"]');
        if (!el || !this.objects) return;
        const levels = this.views.levels.length, sheets = this.views.sheets.length;
        el.innerHTML = `<b>${escapeHtml(this.modelName)}</b> · ${this.objects.length.toLocaleString()} objects with their Revit properties${sheets ? ` · ${sheets.toLocaleString()} sheets and views` : ''}${levels ? ` · ${levels} levels` : ''} · units ${escapeHtml(this.model.getUnitString?.() || '')}`;
        this.twoD.refresh();
    }

    showTab(tab) {
        this.tab = tab;
        this.panel.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        this.panel.querySelectorAll('[data-pane]').forEach(el => { el.hidden = el.dataset.pane !== tab; });
        if (tab === 'both') this.twoD.refresh();
    }

    // "Try it" in the capability list: open the section's tab, scroll to it and flash it.
    goTo(at) {
        const sec = this.panel.querySelector(`[data-sec="${at}"]`);
        if (!sec) return;
        const pane = sec.closest('[data-pane]')?.dataset.pane;
        if (pane) this.showTab(pane);
        sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
        sec.classList.remove('ex-flash');
        void sec.offsetWidth; // restart the animation
        sec.classList.add('ex-flash');
    }

    // --- Find, isolate / ghost / hide ----------------------------------------------------------------------------------
    find() {
        const text = this.panel.querySelector('[data-find-text]').value.trim();
        const note = this.panel.querySelector('[data-find-note]');
        if (!text) return;
        note.textContent = `Searching for "${text}"…`;
        this.viewer.search(text, (ids) => {
            const hits = ids.filter(id => this.byDbId.has(id)); // objects of the building (not the ignored ones, not tree nodes)
            this.found = { text, ids: hits };
            this.picked = new Set();
            if (this.mode === 'hide') this.mode = 'ghost';
            this.applyGroups();
        }, (err) => { note.textContent = `Search failed: ${err?.message || err}`; });
    }

    applyGroups() {
        const p = this.panel;
        p.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x.dataset.mode === this.mode));
        p.querySelectorAll('[data-g]').forEach(b => b.classList.toggle('on', this.picked.has(b.dataset.g)));
        const note = p.querySelector('[data-iso-note]'), findNote = p.querySelector('[data-find-note]');
        if (this.found) {
            const ids = this.found.ids;
            this.viewer.setGhosting(true);
            if (ids.length) this.views.isolate(ids); else this.views.showAll();
            findNote.innerHTML = ids.length ? `<b>${ids.length.toLocaleString()}</b> objects match "${escapeHtml(this.found.text)}": shown with the rest see-through.`
                : `Nothing matches "${escapeHtml(this.found.text)}".`;
            note.textContent = '';
            return;
        }
        findNote.textContent = 'Searches every property of every object, then shows the matches with the rest see-through.';
        if (!this.picked.size) {
            this.viewer.setGhosting(true);
            this.views.showAll();
            note.textContent = 'Isolate shows only the group; Ghost keeps the rest see-through for context; Hide takes the group away. Ctrl+click to combine groups.';
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
        note.textContent = `${MODES[this.mode]}: ${names} (${ids.length.toLocaleString()} objects).`;
    }

    // A picked object stays visible: drop a group isolation that would hide it.
    showGroupsFor(o) {
        if ((this.picked.size && !this.picked.has(o.group)) || this.found || (this.mode === 'hide' && this.picked.has(o.group))) {
            this.picked = new Set();
            this.found = null;
            this.applyGroups();
        }
    }

    // The built-in docking panels (model tree, properties, settings): open or close.
    togglePanel(key) {
        const [id] = PANELS[key];
        const open = (ext) => {
            const active = typeof ext.isActive === 'function' ? ext.isActive() : this.panelsOpen?.has(key);
            if (active) ext.deactivate(); else ext.activate();
            this.panelsOpen ??= new Set();
            if (active) this.panelsOpen.delete(key); else this.panelsOpen.add(key);
            this.panel.querySelector(`[data-panel="${key}"]`)?.classList.toggle('active', !active);
        };
        const ext = this.viewer.getExtension(id);
        if (ext) open(ext); else this.viewer.loadExtension(id).then(open);
    }

    // --- Colors ----------------------------------------------------------------------------------------------------------
    setColorMode(mode) {
        this.colorMode = mode;
        this.panel.querySelectorAll('[data-color]').forEach(x => x.classList.toggle('active', x.dataset.color === mode));
        this.panel.querySelector('[data-prop]').hidden = mode !== 'prop';
        return this.applyColors();
    }

    async applyColors() {
        const legend = this.panel.querySelector('[data-legend]');
        const colors = new Map(), keys = []; // keys: [label, color, ids]
        const byValue = (valueOf, order) => {
            const groups = new Map();
            for (const o of this.objects) { const v = valueOf(o); if (v !== undefined && v !== null && v !== '') (groups.get(v) || groups.set(v, []).get(v)).push(o.dbId); }
            return [...groups].sort(order || ((a, b) => b[1].length - a[1].length));
        };
        if (this.colorMode === 'group') {
            for (const g of GROUPS) {
                const ids = this.objects.filter(o => o.group === g.key && g.key !== 'other').map(o => o.dbId);
                if (ids.length) { ids.forEach(id => colors.set(id, g.color)); keys.push([g.label, g.color, ids]); }
            }
        } else if (this.colorMode === 'studs') {
            for (const [size, ids] of byValue(o => o.studIn, (a, b) => a[0] - b[0])) {
                const c = depthColor(size);
                ids.forEach(id => colors.set(id, c));
                keys.push([`${fmtIn(size)} stud`, c, ids]);
            }
        } else if (this.colorMode === 'level') {
            const order = this.views.levels.map(l => l.name), rank = (n) => order.indexOf(n) + 1 || 999;
            byValue(o => o.level, (a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], undefined, { numeric: true }))
                .forEach(([name, ids], i) => { const c = PALETTE[i % PALETTE.length]; ids.forEach(id => colors.set(id, c)); keys.push([name, c, ids]); });
        } else if (this.colorMode === 'prop') {
            legend.innerHTML = `<span class="muted">Reading ${escapeHtml(this.prop)}…</span>`;
            let values = await this.propertyValues(this.prop);
            // Until a property is picked: start on the first one this model has (a model that isn't workshared has no Workset).
            for (const name of this.propChosen ? [] : PROPERTIES) {
                if (values.size) break;
                values = await this.propertyValues(name);
                this.prop = name;
                this.panel.querySelector('[data-prop]').value = name;
            }
            const top = byValue(o => values.get(o.dbId));
            top.slice(0, PALETTE.length - 1).forEach(([v, ids], i) => { const c = PALETTE[i]; ids.forEach(id => colors.set(id, c)); keys.push([String(v), c, ids]); });
            const rest = top.slice(PALETTE.length - 1).flatMap(([, ids]) => ids);
            if (rest.length) { rest.forEach(id => colors.set(id, OTHER_COLOR)); keys.push([`${top.length - PALETTE.length + 1} other values`, OTHER_COLOR, rest]); }
        }
        this.views.setColors(colors);
        this.legend = keys.map(([label, , ids]) => ({ label, ids }));
        legend.innerHTML = keys.length ? keys.map(([l, c, ids], i) => `<button class="tk-key ex-key" data-key="${i}" title="Show only these (${ids.length.toLocaleString()})"><span class="swatch" style="background:${c}"></span>${escapeHtml(l)} <span class="muted">${ids.length.toLocaleString()}</span></button>`).join('')
            : `<span class="muted">${this.colorMode === 'prop' ? `No object has ${escapeHtml(this.prop)}.` : 'The model in its own materials.'}</span>`;
        legend.querySelectorAll('[data-key]').forEach(b => b.onclick = () => {
            this.found = { ...this.legend[Number(b.dataset.key)] };
            this.found.text = this.found.label;
            this.picked = new Set();
            this.applyGroups();
        });
    }

    // One property for every object (cached per property): dbId -> value.
    async propertyValues(name) {
        if (!this.propCache.has(name)) {
            const rows = await getBulkProperties(this.model, this.objects.map(o => o.dbId), [name]);
            const values = new Map();
            for (const r of rows) {
                const p = r.properties.find(x => x.displayName === name && !x.displayCategory?.startsWith('__') && x.displayValue !== '' && x.displayValue != null);
                if (p) values.set(r.dbId, typeof p.displayValue === 'number' ? Math.round(p.displayValue * 100) / 100 : p.displayValue);
            }
            this.propCache.set(name, values);
        }
        return this.propCache.get(name);
    }

    // --- Sections, explode, floors ---------------------------------------------------------------------------------------
    async cut(axis) {
        const section = this.viewer.getExtension('Autodesk.Section') || await this.viewer.loadExtension('Autodesk.Section');
        this.panel.querySelectorAll('[data-cut]').forEach(b => b.classList.toggle('active', b.dataset.cut === axis && axis !== 'off'));
        if (axis === 'off') {
            section.deactivate(false);
            if (this.views.level) await this.views.setLevel(this.views.level.name); // the floor cut comes back
            return;
        }
        if (axis === 'box') { section.activate('box'); return; } // the Section tool's own box, with handles
        const c = this.center();
        const normal = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }[axis];
        section.setSectionPlane(normal, c.point);
    }

    async explode(scale) {
        const how = this.panel.querySelector('[data-explode-how]').value;
        const ext = this.viewer.getExtension('Autodesk.Explode') || await this.viewer.loadExtension('Autodesk.Explode');
        if (ext.getStrategy?.() !== how) ext.setStrategy(how);
        this.viewer.explode(scale);
        this.explodeScale = scale;
        this.panel.querySelector('[data-explode-val]').textContent = `${Math.round(scale * 100)}%`;
        this.panel.querySelector('[data-explode]').value = String(scale);
    }

    async stepFloor(step) {
        const levels = this.views.levels;
        if (!step) { await this.views.setLevel(null); return; }
        const at = levels.findIndex(l => l.name === this.views.level?.name);
        const next = levels[Math.max(0, Math.min(levels.length - 1, at < 0 ? (step > 0 ? 0 : levels.length - 1) : at + step))];
        if (next) await this.views.setLevel(next.name);
    }

    // --- Camera and tools ------------------------------------------------------------------------------------------------
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
        this.stopTools();
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

    async toggleTool(key) {
        const was = this.tool;
        this.stopTools();
        this.twoD.stop();
        if (was === key) return;
        const [id, start, hint] = TOOLS[key];
        const ext = this.viewer.getExtension(id) || await this.viewer.loadExtension(id);
        start(ext);
        this.tool = key;
        this.panel.querySelector(`[data-tool="${key}"]`)?.classList.add('active');
        this.panel.querySelector('[data-tool-note]').textContent = hint;
    }

    // Stop the 3D tool in use (walk, measure, zoom window) and the orbit.
    stopTools() {
        this.stopOrbit();
        if (this.tool) this.viewer.getExtension(TOOLS[this.tool][0])?.deactivate();
        this.tool = null;
        this.panel.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
        const note = this.panel.querySelector('[data-tool-note]');
        if (note) note.textContent = '';
    }

    async fullScreen() {
        const ext = this.viewer.getExtension('Autodesk.FullScreen') || await this.viewer.loadExtension('Autodesk.FullScreen');
        ext.activate(); // Esc (or the toolbar button) leaves full screen
    }

    applyDisplay() {
        const on = (k) => this.panel.querySelector(`[data-disp="${k}"]`).checked;
        this.viewer.setDisplayEdges(on('edges'));
        this.viewer.setQualityLevel(on('ao'), true);
        this.viewer.setGroundShadow(on('ground'));
        this.viewer.setGroundReflection(on('reflect'));
    }

    background(kind) {
        const set = { light: [255, 255, 255, 230, 234, 238], sky: [190, 214, 240, 245, 248, 252], dark: [40, 44, 52, 20, 22, 26] }[kind];
        this.viewer.setBackgroundColor(...set);
    }

    // --- Saved views (review.js): what this panel shows, and putting it back --------------------------------------------
    snapshot() {
        const groups = GROUPS.filter(g => this.picked.has(g.key)).map(g => g.label);
        const summary = [this.found ? `"${this.found.text}"` : groups.length ? `${MODES[this.mode]} ${groups.join(' + ')}` : '',
            this.colorMode !== 'off' ? `colored ${this.colorMode === 'prop' ? `by ${this.prop}` : COLORS[this.colorMode].toLowerCase()}` : '',
            this.views.level?.name || ''].filter(Boolean).join(' · ');
        return { picked: [...this.picked], mode: this.mode, found: this.found, colorMode: this.colorMode, prop: this.prop,
            level: this.views.level?.name || null, explodeHow: this.panel.querySelector('[data-explode-how]').value, summary };
    }

    async restore(t) {
        if (!t) return;
        this.stopTools();
        this.picked = new Set(t.picked || []);
        this.mode = MODES[t.mode] ? t.mode : 'isolate';
        this.found = t.found?.ids ? t.found : null;
        this.prop = PROPERTIES.includes(t.prop) ? t.prop : this.prop;
        this.panel.querySelector('[data-prop]').value = this.prop;
        this.panel.querySelector('[data-explode-how]').value = t.explodeHow === 'hierarchy' ? 'hierarchy' : 'radial';
        if ((t.level || null) !== (this.views.level?.name || null)) await this.views.setLevel(t.level || null);
        this.applyGroups();
        await this.setColorMode(COLORS[t.colorMode] ? t.colorMode : 'off');
    }

    // --- The picked object -----------------------------------------------------------------------------------------------
    showPick() {
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
                ${o.type ? `<button class="pg-btn" data-iso-type>Isolate this type (${sameType.toLocaleString()})</button>` : ''}
                <button class="pg-btn" data-all-props>All its properties</button></div></div>`;
        el.querySelector('[data-iso-group]').onclick = () => { this.picked = new Set([o.group]); this.found = null; this.mode = 'isolate'; this.applyGroups(); };
        const t = el.querySelector('[data-iso-type]');
        if (t) t.onclick = () => { this.found = { text: o.type, ids: this.objects.filter(x => x.type === o.type).map(x => x.dbId) }; this.picked = new Set(); this.applyGroups(); };
        el.querySelector('[data-all-props]').onclick = () => { if (!this.panelsOpen?.has('props')) this.togglePanel('props'); };
    }

    // --- All capabilities ------------------------------------------------------------------------------------------------
    capabilitiesHtml() {
        const demos = this.demoNames || {};
        const counts = Object.fromEntries(Object.keys(HOW).map(k => [k, allCapabilities().filter(i => i.how === k).length]));
        const status = (i) => {
            if (i.how === 'try') return `<button class="pg-btn ex-try" data-try="${i.at}">Try it ›</button>`;
            if (i.how === 'demo') return `<a class="pg-btn ex-try" href="index.html?demo=${encodeURIComponent(i.demo)}&layout=split${location.hash}">${escapeHtml(demos[i.demo] || i.demo)} ›</a>`;
            return `<span class="ex-badge ${i.how}">${HOW[i.how]}</span>`;
        };
        return `<section class="ex-sec ex-caps"><h3>What APS can and can't do</h3>
            <p class="ex-note">What APS can and can't do for these models, from the APS docs, the APS blog and Autodesk's samples (marked). "Try it" opens it in this demo; others are in another demo, always on, possible but not built yet, or not possible (with the other way to do it).</p>
            <div class="ex-row"><div class="tk-tabs">${[['', 'All'], ...Object.entries(HOW)].map(([k, l]) => `<button data-cap-filter="${k}" class="${k ? '' : 'active'}">${k ? `${l} (${counts[k]})` : 'All'}</button>`).join('')}</div>
                <button class="pg-btn" data-cap-copy title="Copy the list as a table, to paste into Teams, Outlook or Excel">⧉ Copy as table</button><span class="muted" data-cap-copied></span></div>
            ${CAPABILITIES.map(g => `<div class="ex-cap-group"><h4>${escapeHtml(g.group)}</h4>${g.items.map(i => `<div class="ex-cap" data-how="${i.how}">
                <div><b>${escapeHtml(i.name)}</b><p>${escapeHtml(i.what)}</p><small><a href="${escapeHtml(i.doc)}" target="_blank" rel="noopener">${escapeHtml(i.api)} ↗</a>${i.src ? ` <span class="ex-src">${SOURCES[i.src]}</span>` : ""}</small></div>
                <div class="ex-cap-do">${status(i)}</div></div>`).join('')}</div>`).join('')}</section>`;
    }

    async bindCapabilities(root) {
        root.querySelectorAll('[data-try]').forEach(b => b.onclick = () => this.goTo(b.dataset.try));
        root.querySelectorAll('[data-cap-filter]').forEach(b => b.onclick = () => {
            root.querySelectorAll('[data-cap-filter]').forEach(x => x.classList.toggle('active', x === b));
            root.querySelectorAll('.ex-cap').forEach(c => { c.hidden = !!b.dataset.capFilter && c.dataset.how !== b.dataset.capFilter; });
            root.querySelectorAll('.ex-cap-group').forEach(g => { g.hidden = ![...g.querySelectorAll('.ex-cap')].some(c => !c.hidden); });
        });
        root.querySelector('[data-cap-copy]').onclick = () => this.copyCapabilities(root);
        // The other demos' names, for their links (demos.json is the app's demo list).
        if (!this.demoNames) {
            const list = await fetchJson('demos/demos.json').catch(() => []);
            this.demoNames = Object.fromEntries(list.map(d => [d.id, `Demo ${d.name.split(' · ')[0]}: ${d.name.split(' · ').slice(1).join(' · ')}`]));
            root.querySelectorAll('a.ex-try').forEach(a => { const id = new URLSearchParams(a.search).get('demo'); if (this.demoNames[id]) a.textContent = `${this.demoNames[id]} ›`; });
        }
    }

    // Clipboard API (write with text/html and text/plain): https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write
    async copyCapabilities(root) {
        const shown = new Set([...root.querySelectorAll('.ex-cap')].filter(c => !c.hidden).map(c => c.querySelector('b').textContent));
        const { html, text } = capabilityTable(allCapabilities().filter(i => shown.has(i.name)), (id) => this.demoNames?.[id] || id);
        const done = root.querySelector('[data-cap-copied]');
        try {
            await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
            done.textContent = `Copied ${shown.size} rows.`;
        } catch {
            try { await navigator.clipboard.writeText(text); done.textContent = `Copied ${shown.size} rows (plain text).`; } catch { done.textContent = 'The browser blocked the clipboard.'; }
        }
    }
}

// 3.625 -> 3 5/8"
function fmtIn(v) {
    const whole = Math.floor(v + 1e-9), frac = Math.round((v - whole) * 8);
    const f = frac ? ({ 1: '1/8', 2: '1/4', 3: '3/8', 4: '1/2', 5: '5/8', 6: '3/4', 7: '7/8' })[frac] : '';
    return `${whole || ''}${whole && f ? ' ' : ''}${f}"`;
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, ExplorerExtension);
