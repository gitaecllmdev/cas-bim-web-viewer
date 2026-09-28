// Demo 02: Quantity Takeoff Viewer: framing (studs, track), board and finish, plus gross wall quantities.
// Spec and acceptance criteria: demos/02-takeoff/README.md. Math: ./calc.mjs and ./breakdown.mjs; assemblies: samples/takeoff-rules.json.
// Colors and isolation go through core/client/views.js (3D + 2D plan). Slicers (level, framing type, role, wall type,
// fire rating) filter every tab and the model; the Level slicer follows the header Level picker and back.
// Dashboard tutorial (aggregating properties): https://get-started.aps.autodesk.com/tutorials/dashboard/
// Model getBulkProperties: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Model/
// Viewer3D isolate, fitToView: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
import { loadPropertyMap, getWallData, getBulkProperties, propValue, onModelReady, unitLabel, downloadCsv, escapeHtml, fetchJson, loadState, saveState, paletteColor } from '../../helpers.js';
import { takeoff, assemblyFor, fmtInches, ROLES } from './calc.mjs';
import { takeoffLines, filterLines, facets, groupLines, totalsOf, findGroup, framingLabel, DIMENSIONS, DEFAULT_GROUPS } from './breakdown.mjs';
import { fmtFtIn } from '../common/framing.mjs';
import { loadScans, scanWalls } from '../common/wallscan.js';
import { CONFIG } from '../../config.js';

const EXTENSION_ID = 'Drywall.Takeoff';
const STATE_NAME = 'takeoff';
// The walls as read from the model, for the takeoff report page (core/client/takeoff.html), which runs the same
// math without the viewer. Written on the local server only; the review site is built with it.
const SNAPSHOT_STATE = 'takeoff-snapshot';
const NOT_SET = 'Not set';
const NOT_RATED = 'Not rated';
const DISCLAIMER = 'Estimate from model geometry and the assemblies, framed with the same layout as the shop drawings (studs cut 1/16" short, lengths rounded down to 1/8"). Jambs, head and sill track and cripples are counted for walls whose openings have been scanned; stud gauge per the framing engineer. Check before ordering.';
const ORDER_MODES = [['exact', 'Exact cut (1/8")'], ['half', 'Round up to 1/2"'], ['inch', 'Round up to 1"'], ['stock', 'Stock lengths (8\'-20\')']];
const GAUGES = [[18, '18 mil (25 ga)'], [30, '30 mil (20 ga EQ)'], [33, '33 mil (20 ga)'], [43, '43 mil (18 ga)'], [54, '54 mil (16 ga)']];
const SHEETS = [['4\' x 8\'', 32], ['4\' x 10\'', 40], ['4\' x 12\'', 48]];
const GROSS_NOTE = 'Gross quantities from model properties. Not net board counts; openings, layers and waste not included.';
const TABS = { breakdown: 'Breakdown', materials: 'Order list', assemblies: 'Assemblies', gross: 'Gross' };
const STUDS = [0.875, 1.625, 2.5, 3.625, 4, 6, 8];
const EXCLUDED_COLOR = '#d9d9d9';
const REVIEW_COLOR = '#d7263d';
// Slicers and their link parameters (level: the header's ?level=, or lv=... for several levels).
const SLICERS = ['level', 'framing', 'role', 'wallType', 'fire'];
const PARAM = { level: 'lv', framing: 'framing', role: 'role', wallType: 'type', fire: 'fire' };
const SEP = '␟'; // separates group keys (breakdown.mjs)
// Revit property units -> feet / square feet for the takeoff math.
const TO_FT = { ft: 1, m: 3.28084, mm: 0.00328084, cm: 0.0328084, in: 1 / 12 };
const TO_SF = { 'ft²': 1, 'm²': 10.7639, 'in²': 1 / 144 };

function totals(walls) {
    const t = { count: walls.length, length: 0, area: 0, missing: 0, ids: walls.map(w => w.dbId) };
    for (const w of walls) {
        if (!(w.length > 0) || !(w.area > 0)) { t.missing++; continue; }
        t.length += w.length;
        t.area += w.area;
    }
    return t;
}

function groupBy(items, keyOf) {
    const groups = new Map();
    for (const item of items) {
        const key = keyOf(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    return groups;
}

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const fmt = (n, digits = 0) => n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const sameIds = (a, b) => (!a && !b) || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]));
const attr = (s) => escapeHtml(String(s));

class TakeoffExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.panel = this.options.panel;
        this.panel.classList.add('wide');
        const params = new URLSearchParams(location.search);
        this.tab = TABS[params.get('tab')] ? params.get('tab') : 'breakdown';
        this.groups = (params.get('group') || '').split(',').filter(d => DIMENSIONS[d]);
        if (!this.groups.length) this.groups = [...DEFAULT_GROUPS];
        this.filters = Object.fromEntries(SLICERS.map(d => [d, new Set(params.getAll(PARAM[d]))]));
        this.open = null; // expanded Breakdown groups (null: the first grouping level, set on the first render)
        this.showSettings = false;
        this.showLevels = true;
        this.expanded = new Set(); // Order list items showing their cut-length schedule
        this.panel.innerHTML = `<div class="demo-panel"><h2>Takeoff</h2><p class="muted" data-status>Waiting for a model…</p></div>`;
        // A filter list closes when you click anywhere else.
        const closeLists = (e) => {
            if (e.target.closest?.('.tk-dd')) return;
            this.panel.querySelectorAll('details.tk-dd[open]').forEach(d => { d.open = false; });
            this.openDropdown = null;
        };
        document.addEventListener('click', closeLists);
        this.stops = [
            onModelReady(this.viewer, (model) => this.init(model)),
            this.views.on('level', (level) => this.onHeaderLevel(level)),
            () => document.removeEventListener('click', closeLists),
        ];
        return true;
    }

    unload() {
        this.stops.forEach(stop => stop());
        this.views.clearColors();
        this.views.isolate(null, { fit: false });
        this.panel.classList.remove('wide');
        this.panel.innerHTML = '';
        return true;
    }

    async init(model) {
        try {
            const [map, rules, saved] = await Promise.all([loadPropertyMap(), fetchJson('samples/takeoff-rules.json'), loadState(STATE_NAME)]);
            this.map = map;
            this.rules = rules;
            this.settings = saved.settings || {};
            this.overrides = saved.overrides || {};
            const { walls, missing } = await getWallData(model, map);
            this.missing = missing;
            this.units = {
                length: unitLabel(walls.find(w => w.lengthUnits)?.lengthUnits) || 'ft',
                area: unitLabel(walls.find(w => w.areaUnits)?.areaUnits) || 'ft²',
            };
            const lf = TO_FT[this.units.length] ?? 1, sf = TO_SF[this.units.area] ?? 1;
            // Revit's wall height (Unconnected Height) gives the real stud length; area ÷ length reads low when a wall has openings.
            const extra = new Map((await getBulkProperties(model, walls.map(w => w.dbId), ['Unconnected Height', 'Base Offset'])).map(r => [r.dbId, r]));
            const scans = await loadScans();
            this.walls = walls.map(w => ({ ...w, length: Number(w.length) * lf, area: Number(w.area) * sf,
                heightFt: Number(propValue(extra.get(w.dbId), 'Unconnected Height')) * lf || undefined,
                baseOffsetFt: Number(propValue(extra.get(w.dbId), 'Base Offset')) * lf || 0, scan: scans[w.externalId] }));
            this.scanStamp = 0;
            // Several levels from the link (lv=...), else the header's level.
            if (!this.filters.level.size && this.views.level) this.filters.level = new Set([this.views.level.name]);
            this.render();
            this.saveSnapshot(model);
        } catch (err) {
            this.panel.querySelector('[data-status]').textContent = `Could not build the takeoff: ${err.message || err}`;
        }
    }

    // --- Slicers: which walls and lines are in scope ---------------------------------------------------------------

    asmOf(w) {
        return assemblyFor(w.wallType ?? NOT_SET, this.rules, this.overrides);
    }

    wallValue(w, dim) {
        if (dim === 'level') return w.level ?? NOT_SET;
        if (dim === 'wallType') return w.wallType ?? NOT_SET;
        if (dim === 'fire') return w.fireRating || NOT_RATED;
        if (dim === 'framing') { const a = this.asmOf(w); return a.scope === 'framed' ? framingLabel(a) : null; }
        return null;
    }

    // A wall passes the wall slicers (all but role), leaving out one slicer when counting that slicer's values.
    wallPasses(w, skip = null) {
        return ['level', 'framing', 'wallType', 'fire'].every(dim => dim === skip || !this.filters[dim].size || this.filters[dim].has(this.wallValue(w, dim)));
    }

    get scope() {
        return this.walls.filter(w => this.wallPasses(w));
    }

    // Every framed wall's member and board lines, recomputed when the settings, assemblies or scans change.
    get lines() {
        const key = JSON.stringify([this.settings, this.overrides, this.scanStamp]);
        if (this.linesKey !== key) {
            this.linesCache = takeoffLines(this.walls, this.rules, this.overrides, this.settings);
            this.linesKey = key;
        }
        return this.linesCache;
    }

    // Slicer values with wall counts, each cross-filtered by the other slicers; role comes from the member lines.
    slicerValues() {
        const out = {};
        for (const dim of ['level', 'framing', 'wallType', 'fire']) {
            const counts = new Map();
            for (const w of this.walls) {
                const v = this.wallValue(w, dim);
                if (v === null || !this.wallPasses(w, dim)) continue;
                counts.set(v, (counts.get(v) || 0) + 1);
            }
            for (const v of this.filters[dim]) if (!counts.has(v)) counts.set(v, 0);
            const sort = dim === 'level' ? this.levelOrder() : DIMENSIONS[dim].sort;
            out[dim] = [...counts].map(([value, walls]) => ({ value, walls })).sort((a, b) => sort(a.value, b.value));
        }
        out.role = facets(this.lines, this.filters, ['role']).role;
        return out;
    }

    // Levels in building order (the header picker's, bottom to top); names the model doesn't list go last.
    levelOrder() {
        const rank = new Map(this.views.levels.map((l, i) => [l.name, i]));
        return (a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || byName(a, b);
    }

    get filtering() {
        return SLICERS.some(d => this.filters[d].size);
    }

    scopeLabel() {
        const lv = [...this.filters.level];
        const where = !lv.length ? 'All levels' : lv.length <= 3 ? lv.join(', ') : `${lv.length} levels`;
        const more = ['framing', 'role', 'wallType', 'fire'].filter(d => this.filters[d].size).map(d => `${DIMENSIONS[d].label}: ${[...this.filters[d]].join(', ')}`);
        return [where, ...more].join(' · ');
    }

    setFilter(dim, value, on) {
        const set = this.filters[dim];
        if (on) set.add(value); else set.delete(value);
        if (dim === 'level') this.syncHeaderLevel();
        this.render();
    }

    clearFilters() {
        SLICERS.forEach(d => this.filters[d].clear());
        this.syncHeaderLevel();
        this.render();
    }

    // One level picked in the slicer: the header shows it (section box and plan); several or none: the whole building.
    syncHeaderLevel() {
        const set = this.filters.level;
        const want = set.size === 1 ? [...set][0] : null;
        const have = this.views.level?.name || null;
        if (want === have || (want && !this.views.levels.some(l => l.name === want))) return;
        this.pendingLevel = want;
        this.views.setLevel(want);
    }

    onHeaderLevel(level) {
        if (!this.walls) return;
        const name = level?.name || null;
        if (this.pendingLevel !== undefined) {
            const expected = this.pendingLevel;
            this.pendingLevel = undefined;
            if (expected === name) { this.render(); return; } // our own change: keep the slicer as it is
        }
        this.filters.level = name ? new Set([name]) : new Set();
        this.render();
    }

    // Keep the tab, grouping and slicers in the link, so a view can be sent (takeoff.html passes them on).
    syncUrl() {
        const params = new URLSearchParams(location.search);
        for (const dim of SLICERS) {
            params.delete(PARAM[dim]);
            if (dim === 'level' && this.filters.level.size <= 1) continue; // one level: the header's ?level=
            for (const v of this.filters[dim]) params.append(PARAM[dim], v);
        }
        if (this.groups.join() === DEFAULT_GROUPS.join()) params.delete('group'); else params.set('group', this.groups.join());
        if (this.tab === 'breakdown') params.delete('tab'); else params.set('tab', this.tab);
        history.replaceState(null, '', `?${params}${location.hash}`);
    }

    // --- Render ------------------------------------------------------------------------------------------------------

    render() {
        this.result = takeoff(this.scope, this.rules, this.overrides, this.settings);
        this.filteredLines = filterLines(this.lines, this.filters);
        this.tree = groupLines(this.filteredLines, this.groups, { level: this.levelOrder() });
        this.refreshSelection();
        this.assignDepthColors();
        const warn = this.missing.length
            ? `<p class="warn">No wall has ${this.missing.map(k => `"${escapeHtml(this.map[k])}"`).join(', ')}. Fix the name in samples/property-map.json.</p>` : '';
        // The table comes first: one toolbar row and one filter row, kept at the top (with the grid's column titles)
        // while the rows scroll under them.
        const docked = document.body.classList.contains('dock-bottom');
        this.panel.innerHTML = `<div class="demo-panel tk">
            <div class="tk-head">
                <div class="tk-bar">
                    <b class="tk-title">Takeoff</b>
                    <div class="tk-tabs">${Object.entries(TABS).map(([k, label]) => `<button data-tab="${k}" class="${k === this.tab ? 'active' : ''}">${label}</button>`).join('')}</div>
                    ${this.scanHtml()}
                    <span class="tk-spacer"></span>
                    ${docked ? '<button data-dock title="Give the table most of the screen; click again to bring the model back">⤢ Table</button>' : ''}
                    <button data-settings class="${this.showSettings ? 'active' : ''}" title="Gauge, stud spacing, order lengths, board and waste">⚙ Settings</button>
                    <button data-csv title="Download what this tab shows">Export CSV</button>
                </div>
                ${this.showSettings ? this.settingsHtml() : ''}
                <div class="tk-filters">${this.filtersHtml()}</div>
                ${this.selectionHtml()}
            </div>
            ${warn}
            <div data-body></div></div>`;
        this.bindBar();
        const body = this.panel.querySelector('[data-body]');
        ({ breakdown: () => this.renderBreakdown(body), materials: () => this.renderMaterials(body), assemblies: () => this.renderAssemblies(body), gross: () => this.renderGross(body) })[this.tab]();
        this.panel.style.setProperty('--tk-head', `${this.panel.querySelector('.tk-head').offsetHeight}px`); // column titles stick under it
        this.colorWalls();
        this.applyIsolation();
        this.syncUrl();
    }

    bindBar() {
        const p = this.panel;
        p.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.tab; this.render(); });
        p.querySelector('[data-csv]').onclick = () => this.exportCsv();
        p.querySelector('[data-settings]').onclick = () => { this.showSettings = !this.showSettings; this.render(); };
        p.querySelector('[data-scan]')?.addEventListener('click', () => this.scanOpenings());
        p.querySelector('[data-scan-stop]')?.addEventListener('click', () => { this.cancelScan = true; });
        p.querySelector('[data-dock]')?.addEventListener('click', () => document.dispatchEvent(new CustomEvent('dock-split', { detail: 'toggle' })));
        p.querySelectorAll('[data-check]').forEach(el => el.onchange = () => this.setFilter(el.dataset.check, el.value, el.checked));
        p.querySelectorAll('[data-group]').forEach(el => el.onchange = () => {
            const i = Number(el.dataset.group);
            this.groups = [...this.groups.slice(0, i), ...(el.value ? [el.value] : [])];
            if (!this.groups.length) this.groups = [...DEFAULT_GROUPS];
            this.select(null);
            this.render();
        });
        p.querySelector('[data-expand-all]')?.addEventListener('click', () => {
            const all = (groups) => groups.flatMap(g => [g.key, ...all(g.children)]);
            this.open = new Set(all(this.tree));
            this.render();
        });
        p.querySelector('[data-collapse-all]')?.addEventListener('click', () => { this.open = new Set(); this.render(); });
        p.querySelectorAll('details[data-dd]').forEach(d => d.ontoggle = () => {
            if (d.open) p.querySelectorAll('details[data-dd][open]').forEach(o => { if (o !== d) o.open = false; }); // one list at a time
            this.openDropdown = d.open ? d.dataset.dd : (this.openDropdown === d.dataset.dd ? null : this.openDropdown);
        });
        p.querySelectorAll('[data-dd-clear]').forEach(b => b.onclick = (e) => { e.preventDefault(); this.filters[b.dataset.ddClear].clear(); this.render(); });
        p.querySelector('[data-clear-filters]')?.addEventListener('click', () => this.clearFilters());
        p.querySelector('[data-clear-selection]')?.addEventListener('click', () => { this.select(null); this.render(); });
        p.querySelectorAll('[data-set]').forEach(el => el.onchange = () => {
            const key = el.dataset.set, v = Number(el.value);
            if (key === 'sheet') this.settings.sheet = SHEETS.map(([label, sf]) => ({ label, sf })).find(x => x.sf === v);
            else this.settings[key] = v;
            this.save();
        });
        p.querySelectorAll('[data-set-text]').forEach(el => el.onchange = () => {
            this.settings[el.dataset.setText] = el.value === 'true' ? true : el.value === 'false' ? false : el.value;
            this.save();
        });
    }

    // Openings are read from the wall geometry (about 1 s per wall), once per wall; Demo 6 saves its scans here too.
    scanHtml() {
        const { framedWalls, scannedWalls } = this.result;
        if (this.scanning) {
            return `<span class="tk-scan">Scanning openings <b data-scan-done>${this.scanning.done}</b> / ${this.scanning.total}
                <span class="bar tk-scan-bar"><span data-scan-progress style="width:${(this.scanning.done / this.scanning.total) * 100}%"></span></span>
                <button data-scan-stop>Stop</button></span>`;
        }
        const left = framedWalls - scannedWalls;
        if (!left) return `<span class="tk-scan muted" title="Jambs, headers, sills and cripples are counted for every framed wall in scope">Openings: ${fmt(scannedWalls)} of ${fmt(framedWalls)} walls scanned</span>`;
        return `<span class="tk-scan warn" title="Jambs, headers, sills and cripples are counted only for scanned walls">Openings scanned for ${fmt(scannedWalls)} of ${fmt(framedWalls)} walls
            <button data-scan title="Keep this tab in front while it runs">Scan ${fmt(left)} (about ${Math.max(1, Math.round(left / 30))} min)</button></span>`;
    }

    settingsHtml() {
        const s = this.result.settings;
        const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`).join('');
        return `<div class="tk-settings">
            <label>Gauge <select data-set="mils">${opt(GAUGES, s.mils)}</select></label>
            <label>Studs @ <select data-set="studSpacingIn">${opt([12, 16, 24].map(v => [v, `${v}" o.c.`]), s.studSpacingIn)}</select></label>
            <label>Order studs at <select data-set-text="orderLengths">${opt(ORDER_MODES, s.orderLengths)}</select></label>
            <label>Walls over 20' <select data-set-text="splitTallWalls">${opt([['false', 'One-piece studs'], ['true', 'Split into lifts']], String(!!s.splitTallWalls))}</select></label>
            <label>Board <select data-set="sheet">${opt(SHEETS.map(([l, sf]) => [sf, l]), s.sheet.sf)}</select></label>
            <label>Waste: framing <input data-set="framingWastePct" type="number" min="0" max="50" value="${s.framingWastePct}">%</label>
            <label>board <input data-set="boardWastePct" type="number" min="0" max="50" value="${s.boardWastePct}">%</label>
            <span class="muted">Finish: tape ${s.tapeLfPerSf} LF/SF, compound ${s.compoundLbPerSf} lb/SF, screws ${s.screwsPerSfPerLayer}/SF per layer (samples/takeoff-rules.json).</span>
        </div>`;
    }

    // One row: the slicers as dropdown lists (tick values to add or remove them; counts are walls, cross-filtered),
    // then, on the Breakdown, the grouping.
    filtersHtml() {
        const values = this.slicerValues();
        const swatch = (label) => `<span class="swatch" style="background:${this.framingColors.get(label) || EXCLUDED_COLOR}"></span>`;
        const dropdown = (dim) => {
            const set = this.filters[dim];
            const summary = set.size ? (set.size === 1 ? [...set][0] : `${set.size} selected`) : 'All';
            const mark = dim === 'framing' ? swatch : () => '';
            return `<details class="tk-dd ${set.size ? 'on' : ''}" data-dd="${dim}" ${this.openDropdown === dim ? 'open' : ''}>
                <summary title="${attr(set.size ? [...set].join(', ') : `All ${DIMENSIONS[dim].label.toLowerCase()}s`)}">${DIMENSIONS[dim].label}: <b>${escapeHtml(summary)}</b></summary>
                <div class="tk-dd-list">${set.size ? `<a href="#" data-dd-clear="${dim}">Show all</a>` : ''}
                ${values[dim].map(({ value, walls }) => `<label><input type="checkbox" data-check="${dim}" value="${attr(value)}" ${set.has(value) ? 'checked' : ''}>
                    ${mark(value)}${escapeHtml(value)} <span class="muted">${fmt(walls)}</span></label>`).join('')}
                ${dim === 'framing' ? `<p class="muted tk-legend">${swatch('')}grey in the model: not ours</p>` : ''}</div></details>`;
        };
        return `<span class="tk-sl-label">Filter</span>${SLICERS.map(dropdown).join('')}
            ${this.filtering ? '<button class="tk-clear" data-clear-filters>Clear</button>' : ''}
            ${this.tab === 'breakdown' ? `<span class="tk-sep"></span>${this.groupByHtml()}` : ''}`;
    }

    // --- Selection: a row (group, member line, material or mark) shows its walls in 3D and on the plan ------------------

    // What a selection key points at in the current result: { ids, label } or null.
    findSelection(key) {
        const r = this.result;
        const [kind, value] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
        if (kind === 'grp') {
            const g = findGroup(this.tree, value);
            return g ? { ids: g.totals.ids, label: pathLabel(value) } : null;
        }
        if (kind === 'itm') {
            const at = value.lastIndexOf(`${SEP}#`);
            const g = findGroup(this.tree, value.slice(0, at)), itemKey = value.slice(at + 2);
            const item = g?.items?.find(i => i.key === itemKey);
            return item ? { ids: item.totals.ids, label: `${pathLabel(g.key)} ▸ ${this.itemLabel(item, false)}` } : null;
        }
        if (kind === 'item') {
            const m = r.materials.find(x => x.item === value);
            return m?.ids?.length ? { ids: m.ids, label: `${m.item}: ${fmt(m.qty)} ${m.unit}` } : null;
        }
        if (kind === 'mark') {
            const e = r.schedule.find(x => x.mark === value);
            return e ? { ids: e.ids, label: `${e.mark} (${e.role}, ${e.type} @ ${fmtFtIn(e.cutIn)}): ${fmt(e.qty)} pcs` } : null;
        }
        return null;
    }

    select(key) {
        const found = key && this.findSelection(key);
        this.selection = found ? { key, ...found } : null;
    }

    // After a new result (level, slicers, settings): the same selection, with its walls in scope; gone if none are.
    refreshSelection() {
        if (!this.selection) return;
        const found = this.findSelection(this.selection.key);
        this.selection = found ? { key: this.selection.key, ...found } : null;
    }

    // The model shows the selected row's walls, else the sliced walls (one level alone is the header's section box).
    applyIsolation() {
        const sliced = ['framing', 'role', 'wallType', 'fire'].some(d => this.filters[d].size) || this.filters.level.size > 1;
        const ids = this.selection?.ids || (sliced ? (this.filters.role.size ? totalsOf(this.filteredLines).ids : this.scope.map(w => w.dbId)) : null);
        if (sameIds(ids, this.isolatedNow)) return;
        this.isolatedNow = ids;
        this.views.isolate(ids?.length ? ids : null, { fit: !!ids?.length });
    }

    isolateWalls(ids) {
        this.isolatedNow = ids;
        this.views.isolate(ids);
    }

    selectionHtml() {
        const sel = this.selection;
        if (!sel) return '';
        return `<div class="tk-selbar"><span>Showing <b>${fmt(sel.ids.length)}</b> wall${sel.ids.length === 1 ? '' : 's'}: <b>${escapeHtml(sel.label)}</b></span>
            <button data-clear-selection>Show all</button></div>`;
    }

    toggleSelection(key) {
        this.select(this.selection?.key === key ? null : key);
        this.render();
    }

    // Stud sizes keep their color whatever the slicers (the model and the chips use the same colors).
    assignDepthColors() {
        const framed = this.walls.map(w => this.asmOf(w)).filter(a => a.scope === 'framed');
        const depths = [...new Set(framed.map(a => a.studIn))].sort((a, b) => a - b);
        this.depthColors = new Map(depths.map((d, i) => [d, paletteColor(i)]));
        this.framingColors = new Map(framed.map(a => [framingLabel(a), this.depthColors.get(a.studIn)]));
    }

    colorOf(row) {
        return row.asm.scope === 'framed' ? this.depthColors.get(row.asm.studIn) : row.asm.scope === 'excluded' ? EXCLUDED_COLOR : REVIEW_COLOR;
    }

    // Walls colored by stud size in 3D and on the plan (excluded grey, unmatched red). Gross: no colors.
    colorWalls() {
        if (this.tab === 'gross') { this.views.clearColors(); return; }
        const colors = new Map();
        for (const row of this.result.rows) row.ids.forEach(id => colors.set(id, this.colorOf(row)));
        this.views.setColors(colors);
    }

    // --- Breakdown: the grid, grouped (Level ▸ Framing type ▸ Member by default) with sub-totals ------------------------

    groupByHtml() {
        const select = (i) => {
            const taken = this.groups.slice(0, i);
            const options = Object.entries(DIMENSIONS).filter(([d]) => !taken.includes(d));
            return `<select data-group="${i}" aria-label="Group level ${i + 1}">${i ? '<option value="">(none)</option>' : ''}
                ${options.map(([d, def]) => `<option value="${d}" ${this.groups[i] === d ? 'selected' : ''}>${def.label}</option>`).join('')}</select>`;
        };
        const count = Math.min(this.groups.length + 1, 4);
        return `<span class="tk-groupby"><span class="tk-sl-label">Group</span>
            ${Array.from({ length: count }, (_, i) => select(i)).join('<span class="muted">▸</span>')}
            <button data-expand-all title="Open every group">+</button><button data-collapse-all title="Close every group">−</button></span>`;
    }

    renderBreakdown(body) {
        const s = this.result.settings;
        if (!this.open || this.openFor !== this.groups.join()) {
            this.open = new Set(this.tree.map(g => g.key)); // first grouping level open
            this.openFor = this.groups.join();
        }
        this.marks = new Map(this.result.schedule.map(e => [`${e.code}|${e.type}|${e.cutIn}`, e.mark]));
        const total = totalsOf(this.filteredLines);
        this.sheathing = total.sheathingSf > 0;
        const rows = [];
        const walk = (groups) => {
            for (const g of groups) {
                rows.push(this.groupRow(g));
                if (!this.open.has(g.key)) continue;
                if (g.children.length) walk(g.children);
                else rows.push(...g.items.map(i => this.itemRow(g, i)));
            }
        };
        walk(this.tree);
        const cols = 6 + (this.sheathing ? 1 : 0);
        body.innerHTML = `<div class="tk-grid-wrap"><table class="tk-grid">
            <thead><tr><th>${this.groups.map(d => DIMENSIONS[d].label).join(' ▸ ')}</th><th class="num">Walls</th><th class="num">Studs</th><th class="num">Stud LF</th><th class="num">Track LF</th><th class="num">Board SF</th>${this.sheathing ? '<th class="num">Sheathing SF</th>' : ''}</tr></thead>
            <tbody>${rows.join('') || `<tr><td colspan="${cols}" class="muted">No framed walls match these filters.</td></tr>`}</tbody>
            <tfoot><tr class="total"><td>Total${this.filtering ? ` <span class="muted">(${escapeHtml(this.scopeLabel())})</span>` : ''}</td>${this.numCells(total)}</tr></tfoot>
            </table></div>
            ${this.result.missing ? `<p class="warn">${this.result.missing} wall(s) have no length or area and are left out.</p>` : ''}
            <p class="note">Click a row to show its walls in 3D and on the plan; ▸ opens it. Net quantities from the framing layout, no waste: the Order list adds ${s.framingWastePct}% framing and ${s.boardWastePct}% board waste and rounds to pieces. ${DISCLAIMER}</p>`;
        body.querySelectorAll('[data-caret]').forEach(b => b.onclick = (e) => {
            e.stopPropagation();
            const key = b.dataset.caret;
            if (this.open.has(key)) this.open.delete(key); else this.open.add(key);
            this.render();
        });
        body.querySelectorAll('[data-grp]').forEach(tr => tr.onclick = () => this.toggleSelection(`grp:${tr.dataset.grp}`));
        body.querySelectorAll('[data-itm]').forEach(tr => tr.onclick = () => this.toggleSelection(`itm:${tr.dataset.itm}`));
    }

    numCells(t) {
        const n = (v) => (v ? fmt(v) : '<span class="muted">–</span>');
        return `<td class="num">${fmt(t.walls)}</td><td class="num">${n(t.studs)}</td><td class="num">${n(t.studLf)}</td><td class="num">${n(t.trackLf)}</td><td class="num">${n(t.boardSf)}</td>${this.sheathing ? `<td class="num">${n(t.sheathingSf)}</td>` : ''}`;
    }

    groupRow(g) {
        const open = this.open.has(g.key);
        const swatch = g.dim === 'framing' ? `<span class="swatch" style="background:${this.framingColors.get(g.value) || EXCLUDED_COLOR}"></span>` : '';
        const sel = this.selection?.key === `grp:${g.key}` ? 'selected' : '';
        return `<tr class="tk-g d${Math.min(g.depth, 3)} clickable ${sel}" data-grp="${attr(g.key)}" title="Show these ${fmt(g.totals.walls)} walls">
            <td style="padding-left:${0.3 + g.depth * 1.1}em"><button class="tk-caret" data-caret="${attr(g.key)}" aria-label="${open ? 'Close' : 'Open'}" aria-expanded="${open}">${open ? '▾' : '▸'}</button>${swatch}${escapeHtml(g.value)}</td>
            ${this.numCells(g.totals)}</tr>`;
    }

    itemLabel(item, html = true) {
        if (item.kind === 'board') return html ? escapeHtml(item.member) : item.member;
        const mark = this.marks?.get(`${item.code}|${item.member}|${item.cutIn}`);
        const text = `${item.role} · ${fmtFtIn(item.cutIn)}`;
        const member = this.groups.includes('member') ? '' : ` <span class="muted">${escapeHtml(item.member)}</span>`; // else the group row names it
        return html ? `${mark ? `<b>${mark}</b> ` : ''}${escapeHtml(text)}${member}` : `${mark ? `${mark} ` : ''}${text} ${item.member}`;
    }

    itemRow(g, item) {
        const key = `${g.key}${SEP}#${item.key}`;
        const sel = this.selection?.key === `itm:${key}` ? 'selected' : '';
        return `<tr class="tk-i clickable ${sel}" data-itm="${attr(key)}" title="Show the walls with this member">
            <td style="padding-left:${1.9 + g.depth * 1.1}em">${this.itemLabel(item)}</td>${this.numCells(item.totals)}</tr>`;
    }

    // --- Order list: the material list with waste, each stud and track line with its marked cut-length schedule ---------

    renderMaterials(body) {
        const s = this.result.settings;
        const groups = groupBy(this.result.materials, m => m.group);
        body.innerHTML = `<div class="row"><span class="muted">Order list for ${escapeHtml(this.scopeLabel())}, with ${s.framingWastePct}% framing and ${s.boardWastePct}% board waste.
                Click a stud or track line for its member schedule. Marks: ${Object.entries(ROLES).map(([k, v]) => `<b>${k}</b> ${v}`).join(' · ')}; then the stud depth and a number, longest first (ST362-1).</span>
                <button data-expand-all>Expand all</button><button data-collapse-all>Collapse all</button></div>
            <table class="tk-grid"><thead><tr><th>Item</th><th class="num">Qty</th><th>Unit</th><th class="num"></th></tr></thead><tbody>
            ${[...groups].map(([group, items]) => `<tr class="subtotal"><td colspan="4">${group}</td></tr>`
                + items.map(m => this.materialRow(m)).join('')).join('')
            || '<tr><td colspan="4" class="muted">No framed walls in this scope.</td></tr>'}
            </tbody></table>
            ${this.result.missing ? `<p class="warn">${this.result.missing} wall(s) have no length or area and are left out.</p>` : ''}
            <p class="note">${DISCLAIMER}</p>`;
        // A line: show its walls and open its schedule; the selected line again: close it and show everything.
        body.querySelectorAll('[data-toggle-item]').forEach(tr => tr.onclick = () => {
            const key = tr.dataset.toggleItem, sel = `item:${key}`;
            if (this.selection?.key === sel) { this.expanded.delete(key); this.select(null); } else { this.expanded.add(key); this.select(sel); }
            this.render();
        });
        body.querySelectorAll('[data-select-item]').forEach(tr => tr.onclick = () => this.toggleSelection(`item:${tr.dataset.selectItem}`));
        body.querySelectorAll('[data-select-mark]').forEach(tr => tr.onclick = (e) => { e.stopPropagation(); this.toggleSelection(`mark:${tr.dataset.selectMark}`); });
        body.querySelector('[data-expand-all]').onclick = () => { this.result.materials.filter(m => m.marks).forEach(m => this.expanded.add(m.item)); this.render(); };
        body.querySelector('[data-collapse-all]').onclick = () => { this.expanded.clear(); this.render(); };
    }

    // A material line; stud and track lines expand to their cut-length schedule (the lengths to order).
    materialRow(m) {
        const isSel = (key) => (this.selection?.key === key ? 'selected' : '');
        if (!m.marks) {
            const pick = m.ids?.length ? ` class="clickable ${isSel(`item:${m.item}`)}" data-select-item="${escapeHtml(m.item)}" title="Show these walls"` : '';
            return `<tr${pick}><td style="padding-left:1em">${escapeHtml(m.item)}</td><td class="num">${fmt(m.qty)}</td><td>${m.unit}</td><td class="num muted">${m.extra || ''}</td></tr>`;
        }
        const open = this.expanded.has(m.item);
        const s = this.result.settings;
        const long = m.longCount ? ` <span class="warn" title="longer than the longest stock stud">${fmt(m.longCount)} over ${Math.max(...s.studStockFt)}'</span>` : '';
        const head = `<tr class="clickable ${isSel(`item:${m.item}`)}" data-toggle-item="${escapeHtml(m.item)}" title="Show these walls and the member schedule"><td style="padding-left:0.3em">${open ? '▾' : '▸'} ${escapeHtml(m.item)}${long}</td>
            <td class="num">${fmt(m.qty)}</td><td>${m.unit}</td><td class="num muted">${m.extra || ''}</td></tr>`;
        if (!open) return head;
        const isStud = m.kind === 'stud';
        const order = (e) => !isStud ? `cut from ${s.trackStockFt}' stock` : e.perPiece > 1 ? `${fmtFtIn(e.orderIn)} stock, ${e.perPiece} per piece → ${fmt(e.pieces)}`
            : e.orderIn === e.cutIn ? 'cut to length' : `order ${fmtFtIn(e.orderIn)}`;
        const rows = m.marks.map(e => `<tr class="clickable ${isSel(`mark:${e.mark}`)}" data-select-mark="${escapeHtml(e.mark)}" title="Show the walls with ${escapeHtml(e.mark)}"><td style="padding-left:1.6em"><b>${e.mark}</b></td><td>${escapeHtml(e.role)}</td>
            <td class="num">${fmtFtIn(e.cutIn)}${e.long ? ' <span class="warn">long</span>' : ''}</td><td class="num">${fmt(e.qty)}</td>
            <td>${order(e)}</td><td class="num muted">${fmt(e.lf)}</td></tr>`).join('');
        const summary = isStud && s.orderLengths !== 'exact' && m.order?.length
            ? `<p class="muted" style="margin:0.3em 1.6em">Order: ${m.order.map(o => `${fmtFtIn(o.orderIn)} × ${fmt(o.pieces)}`).join(' · ')}</p>` : '';
        return head + `<tr><td colspan="4" style="padding:0"><table style="margin:0.2em 0 0.4em;background:#fafafa">
            <thead><tr><th style="padding-left:1.6em">Mark</th><th>Member</th><th class="num">Cut length</th><th class="num">Qty</th><th>Order</th><th class="num">LF</th></tr></thead>
            <tbody>${rows}</tbody></table>${summary}</td></tr>`;
    }

    // Tune the assembly of any wall type; overrides are saved and win over the rules file.
    renderAssemblies(body) {
        const rows = this.result.rows;
        const sel = (key, value, options) => `<select data-key="${key}">${options.map(([v, l]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
        const n03 = [0, 1, 2, 3].map(v => [v, v]);
        body.innerHTML = `<p class="muted">Starting assemblies come from samples/takeoff-rules.json (matched on the type name). Change any type here; the takeoff updates at once. Click a name to see those walls.</p>
            <table class="tk-grid"><thead><tr><th>Wall type</th><th>Scope</th><th>Stud</th><th>Rows</th><th>Layers A / B</th><th>Sheath.</th></tr></thead><tbody data-rows></tbody></table>
            <div class="row"><button data-reset-asm ${Object.keys(this.overrides).length ? '' : 'disabled'}>Reset all to the rules file</button>
                <span class="muted">${Object.keys(this.overrides).length} type(s) changed</span></div>`;
        const tbody = body.querySelector('[data-rows]');
        for (const r of rows) {
            const a = r.asm, changed = !!this.overrides[r.typeName];
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><span class="swatch" style="background:${this.colorOf(r)}"></span><a href="#" data-show>${escapeHtml(r.typeName)}</a>${changed ? ' <b title="changed here">*</b>' : ''}</td>
                <td>${sel('scope', a.scope === 'review' ? 'excluded' : a.scope, [['framed', 'Framed'], ['excluded', 'Not ours']])}</td>
                <td>${sel('studIn', a.studIn ?? 3.625, STUDS.map(d => [d, fmtInches(d)]))}</td>
                <td>${sel('rows', a.rows, [[1, 1], [2, 2]])}</td>
                <td>${sel('layerA', a.layers[0], n03)} ${sel('layerB', a.layers[1], n03)}</td>
                <td>${sel('sheathingSides', a.sheathingSides || 0, [[0, 0], [1, 1], [2, 2]])}</td>`;
            tr.querySelector('[data-show]').onclick = (e) => { e.preventDefault(); this.isolateWalls(r.ids); };
            tr.querySelectorAll('select').forEach(el => el.onchange = () => {
                const current = assemblyFor(r.typeName, this.rules, this.overrides);
                const o = { ...this.overrides[r.typeName] };
                const v = el.dataset.key === 'scope' ? el.value : Number(el.value);
                if (el.dataset.key === 'layerA') o.layers = [v, current.layers[1]];
                else if (el.dataset.key === 'layerB') o.layers = [current.layers[0], v];
                else o[el.dataset.key] = v;
                if (o.scope === 'framed' && current.scope !== 'framed') o.studIn ??= 3.625;
                o.label = 'Set in Assemblies tab';
                this.overrides[r.typeName] = o;
                this.save();
            });
            if (a.scope !== 'framed') tr.querySelectorAll('select:not([data-key="scope"])').forEach(el => { el.disabled = true; });
            tbody.appendChild(tr);
        }
        body.querySelector('[data-reset-asm]').onclick = () => { this.overrides = {}; this.save(); };
    }

    // The original gross view: count, length, area by wall type with level sub-totals.
    renderGross(body) {
        const scope = this.scope;
        const rows = [];
        const types = groupBy(scope, w => w.wallType ?? NOT_SET);
        for (const type of [...types.keys()].sort(byName)) {
            rows.push({ kind: 'subtotal', type, level: 'All levels', ...totals(types.get(type)) });
            const levels = groupBy(types.get(type), w => w.level ?? NOT_SET);
            for (const level of [...levels.keys()].sort(byName)) rows.push({ kind: 'level', type, level, ...totals(levels.get(level)) });
        }
        rows.push({ kind: 'total', type: this.filtering ? `Total, ${this.scopeLabel()}` : 'Grand total', level: '', ...totals(scope) });
        this.grossRows = rows;
        body.innerHTML = `<div class="row"><label><input type="checkbox" data-levels ${this.showLevels ? 'checked' : ''}> Level sub-totals</label>
                <button data-reset>Reset view</button></div>
            <table class="tk-grid"><thead><tr><th>Wall type / level</th><th class="num">Count</th><th class="num">Length (ft)</th><th class="num">Area (ft²)</th></tr></thead><tbody data-rows></tbody></table>
            <p class="note">${GROSS_NOTE}</p>`;
        const tbody = body.querySelector('[data-rows]');
        for (const row of rows) {
            if (row.kind === 'level' && !this.showLevels) continue;
            const tr = document.createElement('tr');
            tr.className = `clickable ${row.kind}`;
            const label = row.kind === 'level' ? `<span style="padding-left:1em">${escapeHtml(row.level)}</span>` : escapeHtml(row.type);
            const missing = row.missing ? ` <span class="warn" title="walls missing length or area">(${row.missing} missing)</span>` : '';
            tr.innerHTML = `<td>${label}</td><td class="num">${row.count}${missing}</td><td class="num">${fmt(row.length, 1)}</td><td class="num">${fmt(row.area)}</td>`;
            tr.onclick = () => { tbody.querySelectorAll('tr').forEach(r => r.classList.toggle('selected', r === tr)); this.isolateWalls(row.kind === 'total' ? null : row.ids); };
            tbody.appendChild(tr);
        }
        body.querySelector('[data-levels]').onchange = (e) => { this.showLevels = e.target.checked; this.render(); };
        body.querySelector('[data-reset]').onclick = () => { this.views.showAll(); this.isolateWalls(null); };
    }

    // --- Scans, snapshot, settings, CSV ------------------------------------------------------------------------------

    async scanOpenings() {
        const todo = this.scope.filter(w => !w.scan && this.asmOf(w).scope === 'framed' && w.length > 0);
        if (!todo.length) return;
        if (todo.length > 200 && !confirm(`Scan ${todo.length} walls? It takes about ${Math.round(todo.length / 30)} minutes with this tab in front; you can stop at any time and continue later.`)) return;
        this.cancelScan = false;
        this.scanning = { done: 0, total: todo.length };
        this.render();
        try {
            await scanWalls(this.viewer, this.views, todo, {
                isCancelled: () => this.cancelScan,
                onProgress: (done) => {
                    this.scanning.done = done;
                    const line = this.panel.querySelector('[data-scan-progress]');
                    if (line) line.style.width = `${(done / todo.length) * 100}%`;
                    const b = this.panel.querySelector('[data-scan-done]');
                    if (b) b.textContent = done;
                },
            });
        } finally {
            const scans = await loadScans();
            this.walls.forEach(w => { w.scan = scans[w.externalId] || w.scan; });
            this.scanStamp++;
            this.scanning = null;
            this.render();
        }
    }

    // Walls only (the report page adds the saved opening scans and the takeoff settings itself).
    saveSnapshot(model) {
        if (CONFIG.mode === 'static') return;
        const walls = this.walls.map(({ dbId, externalId, wallType, fireRating, level, length, area, heightFt, baseOffsetFt }) =>
            ({ dbId, externalId, wallType, fireRating, level, length, area, heightFt, baseOffsetFt }));
        const project = document.getElementById('models')?.selectedOptions[0]?.text || model.getDocumentNode()?.getDocument()?.getRoot()?.name?.() || 'Project';
        saveState(SNAPSHOT_STATE, { project, urn: location.hash.slice(1), savedAt: new Date().toISOString(), walls })
            .catch(err => console.warn('Takeoff snapshot not saved:', err.message));
    }

    async save() {
        this.render();
        try {
            await saveState(STATE_NAME, { settings: this.settings, overrides: this.overrides, updatedAt: new Date().toISOString() });
        } catch (err) {
            console.warn('Takeoff settings not saved:', err.message);
        }
    }

    exportCsv() {
        const r = this.result;
        const scope = this.scopeLabel();
        const file = `takeoff-${this.tab}${this.filtering ? `-${scope.replace(/[^\w-]+/g, '_').slice(0, 60)}` : ''}.csv`;
        if (this.tab === 'breakdown') {
            // Every group and member line (open or not), one column per grouping, net quantities.
            const dims = this.groups.map(d => DIMENSIONS[d].label);
            const lines = [[`Takeoff breakdown (${scope})`, 'net quantities, no waste'], [],
                [...dims, 'Member line', 'Walls', 'Studs (pcs)', 'Stud LF', 'Track LF', 'Board SF', 'Sheathing SF']];
            const nums = (t) => [t.walls, t.studs, t.studLf.toFixed(1), t.trackLf.toFixed(1), t.boardSf.toFixed(1), t.sheathingSf.toFixed(1)];
            const walk = (groups, path) => {
                for (const g of groups) {
                    const p = [...path, g.value];
                    lines.push([...p, ...Array(dims.length - p.length).fill(''), '', ...nums(g.totals)]);
                    if (g.children.length) walk(g.children, p);
                    else g.items.forEach(i => lines.push([...p, this.itemLabel(i, false), ...nums(i.totals)]));
                }
            };
            walk(this.tree, []);
            lines.push(['Total', ...Array(dims.length).fill(''), ...nums(totalsOf(this.filteredLines))], [], [DISCLAIMER]);
            downloadCsv(file, lines);
            return;
        }
        const lines = [[`Takeoff: framing, board & finish (${scope})`], [], ['Group', 'Item', 'Qty', 'Unit', 'Detail'],
            ...r.materials.map(m => [m.group, m.item, m.qty, m.unit, m.extra || '']), [],
            ['Member schedule', `order: ${(ORDER_MODES.find(([v]) => v === r.settings.orderLengths) || ORDER_MODES[0])[1]}`, `openings scanned: ${r.scannedWalls} of ${r.framedWalls} framed walls`],
            ['Mark', 'Member', 'Member type', 'Cut length', 'Cut length (in)', 'Qty', 'LF', 'Order length', 'Pieces per order length', 'Pieces to order'],
            ...r.schedule.map(e => [e.mark, e.role, e.type, fmtFtIn(e.cutIn), e.cutIn, e.qty, e.lf.toFixed(1), fmtFtIn(e.orderIn), e.perPiece, e.pieces]), [],
            ['Wall type', 'Assembly', 'Scope', 'Walls', 'Length (LF)', 'Area (SF)', 'Studs', 'Track (LF)', 'Board (SF)', 'Sheathing (SF)', 'Finish (SF)', 'Board type'],
            ...r.rows.map(t => [t.typeName, t.asm.label || '', t.asm.scope, t.count, t.length.toFixed(1), t.area.toFixed(1), t.studs, t.trackLf.toFixed(1),
                t.boardSf.toFixed(1), t.sheathingSf.toFixed(1), t.finishSf.toFixed(1), t.asm.scope === 'framed' ? t.board : '']),
            [], [DISCLAIMER]];
        downloadCsv(file, lines);
    }
}

// "level=L2␟framing=3 5/8" studs" -> "L2 ▸ 3 5/8" studs"
function pathLabel(key) {
    return key.split(SEP).map(part => part.slice(part.indexOf('=') + 1)).join(' ▸ ');
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, TakeoffExtension);
