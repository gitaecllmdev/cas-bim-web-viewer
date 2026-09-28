// Demo 02: Quantity Takeoff Viewer: framing (studs, track), board and finish, plus gross wall quantities.
// Spec and acceptance criteria: demos/02-takeoff/README.md. Math: ./calc.mjs and ./breakdown.mjs; assemblies: samples/takeoff-rules.json.
// Colors and isolation go through core/client/views.js (3D + 2D plan). Slicers (level, framing type, SSMA stud, role,
// finish, layers, wall type, fire rating, framing source) filter every tab and the model; the Level slicer follows the
// header Level picker and back. Walls are colored by framing type, SSMA stud, finish or layers (./colors.mjs).
// Framing per wall and per opening (./criteria.mjs): a manual override kept by the wall's GUID (externalId = Revit
// UniqueId, so it carries to the next model version), else the engineer's criteria loaded from their .xlsx (kept in
// this browser or on the local server, never published with the site), else the SSMA placeholder tables of
// samples/takeoff-rules.json. Every member line says which (its source).
// Dashboard tutorial (aggregating properties): https://get-started.aps.autodesk.com/tutorials/dashboard/
// Model getBulkProperties: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Model/
// Viewer3D isolate, fitToView: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
import { loadPropertyMap, getWallData, getBulkProperties, propValue, onModelReady, unitLabel, downloadCsv, escapeHtml, fetchJson, loadState, saveState } from '../../helpers.js';
import { takeoff, assemblyFor, fmtInches, ROLES } from './calc.mjs';
import { takeoffLines, filterLines, facets, groupLines, totalsOf, findGroup, DIMENSIONS, DEFAULT_GROUPS } from './breakdown.mjs';
import { wallCriteria, openingCriteria, criteriaChoices, parseDesignator, finishClassOf, FINISH_CLASSES, SOURCES } from './criteria.mjs';
import { readXlsx } from './xlsx.mjs';
import { colorMap, NOT_OURS, NEEDS_REVIEW } from './colors.mjs';
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
// The engineer's criteria: its own state, left out of the published site (scripts/build-site.js copies named states only).
const CRITERIA_STATE = 'takeoff-criteria';
// Slicers and their link parameters (level: the header's ?level=, or lv=... for several levels).
const SLICERS = ['level', 'framing', 'stud', 'role', 'finish', 'layers', 'wallType', 'fire', 'source'];
const PARAM = { level: 'lv', framing: 'framing', stud: 'stud', role: 'role', finish: 'finish', layers: 'layers', wallType: 'type', fire: 'fire', source: 'source' };
const WALL_DIMS = ['level', 'framing', 'stud', 'finish', 'layers', 'wallType', 'fire']; // role and source are per member line
// Short names and badge styles of the framing sources (criteria.mjs SOURCES).
const SOURCE_TAG = { [SOURCES.override]: ['Manual', 'manual'], [SOURCES.criteria]: ['Criteria', 'ok'], [SOURCES.placeholder]: ['Placeholder', 'ph'],
    [SOURCES.gap]: ['Placeholder, not in criteria', 'gap'], [SOURCES.outOfRange]: ['Out of range', 'bad'], [SOURCES.assembly]: ['Assembly', 'ph'] };
const COLOR_BY = { framing: 'Framing type', stud: 'SSMA stud', finish: 'Finish', layers: 'Layers' };
const SHARE_BY = { studLf: 'Stud LF', trackLf: 'Track LF', boardSf: 'Board SF', walls: 'Walls' };
// Suggestions for a manual stud override (any SSMA designator can be typed).
const SSMA_SUGGEST = ['162S125-18', '250S125-18', '250S162-33', '362S125-18', '362S162-33', '362S162-43', '362S162-54', '362S200-43', '362S200-54',
    '400S162-33', '400S162-43', '400S200-54', '600S162-33', '600S162-43', '600S162-54', '600S200-54', '600S250-68', '800S162-43', '800S200-54'];
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
        this.colorBy = COLOR_BY[params.get('color')] ? params.get('color') : 'framing';
        this.shareBy = 'studLf';
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
            const [map, rules, saved, criteria] = await Promise.all([loadPropertyMap(), fetchJson('samples/takeoff-rules.json'), loadState(STATE_NAME),
                loadState(CRITERIA_STATE).catch(() => ({}))]);
            this.map = map;
            this.rules = rules;
            this.settings = saved.settings || {};
            this.overrides = saved.overrides || {};
            this.elementOverrides = saved.elementOverrides || {}; // wall GUID -> { stud, spacingIn, finishClass, at }
            this.criteria = criteria?.rows?.length ? criteria : null;
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

    // A wall's value for a slicer. Framing type, SSMA stud, finish, layers and framing source come from the wall's
    // resolved framing (its lines); walls that aren't ours have none.
    wallValue(w, dim) {
        if (dim === 'level') return w.level ?? NOT_SET;
        if (dim === 'wallType') return w.wallType ?? NOT_SET;
        if (dim === 'fire') return w.fireRating || NOT_RATED;
        return this.wallInfo.get(w.dbId)?.[dim] ?? null;
    }

    // A wall passes the wall slicers (all but role), leaving out one slicer when counting that slicer's values.
    wallPasses(w, skip = null) {
        return WALL_DIMS.every(dim => dim === skip || !this.filters[dim].size || this.filters[dim].has(this.wallValue(w, dim)));
    }

    get scope() {
        return this.walls.filter(w => this.wallPasses(w));
    }

    // The criteria and manual overrides the framing is resolved with (criteria.mjs).
    get ctx() {
        const c = this.criteria;
        return { criteria: c ? { rows: c.rows, openings: c.openings || [], group: c.group || '', building: c.building || '' } : null, overrides: this.elementOverrides };
    }

    // Every framed wall's member and board lines, recomputed when the settings, assemblies, scans, criteria or
    // overrides change; with each wall's framing (wallInfo) and the color of every value (fixed for the project).
    get lines() {
        const c = this.criteria;
        const key = JSON.stringify([this.settings, this.overrides, this.scanStamp, this.elementOverrides, c?.importedAt, c?.group, c?.building]);
        if (this.linesKey !== key) {
            this.linesCache = takeoffLines(this.walls, this.rules, this.overrides, this.settings, this.ctx);
            this.wallInfo = new Map();
            for (const l of this.linesCache) if (!this.wallInfo.has(l.wall)) this.wallInfo.set(l.wall, l);
            this.colorMaps = Object.fromEntries(Object.keys(COLOR_BY).map(d => [d, colorMap(d, this.linesCache.map(l => l[d]))]));
            this.linesKey = key;
        }
        return this.linesCache;
    }

    // Slicer values with wall counts, each cross-filtered by the other slicers; role comes from the member lines.
    slicerValues() {
        const out = {};
        for (const dim of WALL_DIMS) {
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
        Object.assign(out, facets(this.lines, this.filters, ['role', 'source']));
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
        const more = SLICERS.filter(d => d !== 'level' && this.filters[d].size).map(d => `${DIMENSIONS[d].label}: ${[...this.filters[d]].join(', ')}`);
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
        if (this.colorBy === 'framing') params.delete('color'); else params.set('color', this.colorBy);
        history.replaceState(null, '', `?${params}${location.hash}`);
    }

    // --- Render ------------------------------------------------------------------------------------------------------

    render() {
        const lines = this.lines; // first: the walls' framing (wallInfo) that the slicers read
        this.result = takeoff(this.scope, this.rules, this.overrides, this.settings, this.ctx);
        this.filteredLines = filterLines(lines, this.filters);
        this.tree = groupLines(this.filteredLines, this.groups, { level: this.levelOrder() });
        this.refreshSelection();
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
                    ${this.sourceHtml()}
                    <span class="tk-spacer"></span>
                    ${docked ? '<button data-dock title="Give the table most of the screen; click again to bring the model back">⤢ Table</button>' : ''}
                    <button data-settings class="${this.showSettings ? 'active' : ''}" title="Engineer's criteria, gauge, stud spacing, order lengths, board and waste">⚙ Settings</button>
                    <button data-csv title="Download what this tab shows">Export CSV</button>
                </div>
                ${this.showSettings ? this.settingsHtml() : ''}
                <div class="tk-filters">${this.filtersHtml()}</div>
                ${this.legendHtml()}
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
        p.querySelector('[data-color-by]')?.addEventListener('change', (e) => { this.colorBy = e.target.value; this.render(); });
        p.querySelectorAll('[data-source-filter]').forEach(b => b.onclick = () => { this.filters.source = new Set([b.dataset.sourceFilter]); this.render(); });
        this.bindCriteria(p);
        this.bindOverride(p);
    }

    // Where the walls' framing comes from (walls in scope, by their stud): click one to show those member lines.
    sourceHtml() {
        const counts = new Map();
        for (const w of this.scope) { const v = this.wallInfo.get(w.dbId)?.wallSource; if (v) counts.set(v, (counts.get(v) || 0) + 1); }
        const tips = {
            [SOURCES.criteria]: "Walls framed from the engineer's criteria",
            [SOURCES.override]: 'Walls with framing set by hand (kept by GUID)',
            [SOURCES.placeholder]: 'No engineer criteria loaded: typical SSMA placeholder framing by stud depth and height (samples/takeoff-rules.json). Not engineered.',
            [SOURCES.gap]: "The engineer's criteria have no row for these walls (depth, finish, layers or height): SSMA placeholder framing. Ask the engineer.",
            [SOURCES.outOfRange]: 'Neither the criteria nor the placeholder cover these walls (too tall): the fallback gauge. Check them.',
            [SOURCES.assembly]: 'Furring and other non-stud assemblies',
        };
        return Object.keys(SOURCE_TAG).filter(src => counts.get(src)).map(src => `<button class="tk-badge ${SOURCE_TAG[src][1]}" data-source-filter="${attr(src)}"
            title="${attr(`${tips[src]}: click to show them`)}">${escapeHtml(SOURCE_TAG[src][0])} ${fmt(counts.get(src))}</button>`).join('');
    }

    // Colors of the model and the grid: by framing type, SSMA stud, finish or layers, with the key.
    legendHtml() {
        const map = this.colorMaps[this.colorBy];
        const counts = new Map();
        for (const w of this.scope) { const v = this.wallInfo.get(w.dbId)?.[this.colorBy]; if (v != null) counts.set(v, (counts.get(v) || 0) + 1); }
        const items = [...counts].sort((a, b) => DIMENSIONS[this.colorBy].sort(a[0], b[0]));
        return `<div class="tk-legend-row"><span class="tk-sl-label">Colors</span>
            <select data-color-by aria-label="Color the walls by">${Object.entries(COLOR_BY).map(([k, l]) => `<option value="${k}" ${k === this.colorBy ? 'selected' : ''}>${l}</option>`).join('')}</select>
            ${items.map(([v, n]) => `<span class="tk-key" title="${attr(v)}: ${n} walls"><span class="swatch" style="background:${map.get(v)}"></span>${escapeHtml(v)} <span class="muted">${fmt(n)}</span></span>`).join('')}
            <span class="tk-key muted"><span class="swatch" style="background:${NOT_OURS}"></span>not ours</span></div>`;
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
            ${this.criteriaHtml()}
            <label title="For walls that neither the criteria nor the SSMA placeholder cover">Fallback gauge <select data-set="mils">${opt(GAUGES, s.mils)}</select></label>
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
        const dropdown = (dim) => {
            const set = this.filters[dim];
            const summary = set.size ? (set.size === 1 ? [...set][0] : `${set.size} selected`) : 'All';
            const mark = COLOR_BY[dim] ? (v) => `<span class="swatch" style="background:${this.colorMaps[dim].get(v) || NOT_OURS}"></span>` : () => '';
            const total = values[dim].reduce((n, x) => n + x.walls, 0) || 1;
            return `<details class="tk-dd ${set.size ? 'on' : ''}" data-dd="${dim}" ${this.openDropdown === dim ? 'open' : ''}>
                <summary title="${attr(set.size ? [...set].join(', ') : `All ${DIMENSIONS[dim].label.toLowerCase()}s`)}">${DIMENSIONS[dim].label}: <b>${escapeHtml(summary)}</b></summary>
                <div class="tk-dd-list">${set.size ? `<a href="#" data-dd-clear="${dim}">Show all</a>` : ''}
                ${values[dim].map(({ value, walls }) => `<label><input type="checkbox" data-check="${dim}" value="${attr(value)}" ${set.has(value) ? 'checked' : ''}>
                    ${mark(value)}${escapeHtml(value)} <span class="muted">${fmt(walls)} · ${fmt((walls / total) * 100, 1)}%</span></label>`).join('')}</div></details>`;
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
        const sliced = SLICERS.some(d => d !== 'level' && this.filters[d].size) || this.filters.level.size > 1;
        const byLine = this.filters.role.size || this.filters.source.size; // member-line slicers: the walls those lines are in
        const ids = this.selection?.ids || (sliced ? (byLine ? totalsOf(this.filteredLines).ids : this.scope.map(w => w.dbId)) : null);
        if (sameIds(ids, this.isolatedNow)) return;
        this.isolatedNow = ids;
        this.views.isolate(ids?.length ? ids : null, { fit: !!ids?.length });
        // The plan follows: the level where most of these walls are, or back to the header's level.
        this.views.showPlanFor(ids).catch(err => console.warn('Plan not switched:', err.message));
    }

    isolateWalls(ids) {
        this.isolatedNow = ids;
        this.views.isolate(ids);
        this.views.showPlanFor(ids).catch(err => console.warn('Plan not switched:', err.message));
    }

    selectionHtml() {
        const sel = this.selection;
        if (!sel) return '';
        const framed = this.selectedWalls();
        return `<div class="tk-selbar"><span>Showing <b>${fmt(sel.ids.length)}</b> wall${sel.ids.length === 1 ? '' : 's'}: <b>${escapeHtml(sel.label)}</b></span>
            <button data-clear-selection>Show all</button>
            ${framed.length ? `<button data-override-open class="${this.showOverride ? 'active' : ''}" title="Set the stud, spacing or finish class of these walls by hand">✎ Override framing</button>` : ''}
            ${this.showOverride && framed.length ? this.overrideHtml(framed) : ''}</div>`;
    }

    // --- Manual framing overrides, kept by the wall's GUID (externalId), so they carry to the next model version --------

    selectedWalls() {
        const ids = new Set(this.selection?.ids || []);
        return this.walls.filter(w => ids.has(w.dbId) && w.externalId && this.wallInfo.has(w.dbId));
    }

    overrideHtml(walls) {
        const current = walls.map(w => this.elementOverrides[w.externalId]).filter(Boolean);
        const same = (k) => (current.length === walls.length && current.every(o => o[k] === current[0][k]) ? current[0][k] ?? '' : '');
        const studs = [...new Set(walls.map(w => this.wallInfo.get(w.dbId).stud))];
        const opt = (list, cur, none) => `<option value="">${none}</option>${list.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`).join('')}`;
        const suggest = [...new Set([...SSMA_SUGGEST, ...(this.criteria?.rows || []).map(r => r.stud.name)])].sort();
        return `<div class="tk-override">
            <span>Now: <b>${escapeHtml(studs.slice(0, 3).join(', '))}${studs.length > 3 ? ' …' : ''}</b>${current.length ? ` · <span class="warn">${current.length} set by hand</span>` : ''}</span>
            <label>SSMA stud <input data-ov-stud list="tk-ssma" size="12" placeholder="e.g. 600S162-54" value="${attr(same('stud'))}"></label>
            <label>@ <select data-ov-spacing>${opt([12, 16, 24].map(v => [v, `${v}" o.c.`]), same('spacingIn'), 'as set')}</select></label>
            <label>Finish class <select data-ov-finish>${opt(FINISH_CLASSES.map(c => [c, c]), same('finishClass'), 'as the type')}</select></label>
            <button data-ov-apply>Apply to ${fmt(walls.length)} wall${walls.length === 1 ? '' : 's'}</button>
            ${current.length ? `<button data-ov-clear>Remove ${fmt(current.length)} override${current.length === 1 ? '' : 's'}</button>` : ''}
            <span class="warn" data-ov-msg></span>
            <datalist id="tk-ssma">${suggest.map(n => `<option value="${n}">`).join('')}</datalist>
            <span class="muted">Kept with each wall's GUID, so it carries to the next model version. A stud set by hand wins over the criteria.</span></div>`;
    }

    bindOverride(p) {
        p.querySelector('[data-override-open]')?.addEventListener('click', () => { this.showOverride = !this.showOverride; this.render(); });
        p.querySelector('[data-ov-apply]')?.addEventListener('click', () => {
            const stud = p.querySelector('[data-ov-stud]').value.trim().toUpperCase();
            const spacingIn = Number(p.querySelector('[data-ov-spacing]').value) || undefined;
            const finishClass = p.querySelector('[data-ov-finish]').value || undefined;
            const msg = p.querySelector('[data-ov-msg]');
            if (stud && !parseDesignator(stud)) { msg.textContent = `"${stud}" is not an SSMA designator (e.g. 600S162-54).`; return; }
            if (!stud && !spacingIn && !finishClass) { msg.textContent = 'Set a stud, a spacing or a finish class.'; return; }
            for (const w of this.selectedWalls()) this.elementOverrides[w.externalId] = { stud: stud || undefined, spacingIn, finishClass, at: new Date().toISOString() };
            this.save();
        });
        p.querySelector('[data-ov-clear]')?.addEventListener('click', () => {
            for (const w of this.selectedWalls()) delete this.elementOverrides[w.externalId];
            this.save();
        });
    }

    // --- The engineer's criteria (.xlsx), read in the browser; kept in this browser or on the local server --------------

    criteriaHtml() {
        const c = this.criteria;
        const file = `<label class="tk-file" title="The engineer's framing criteria workbook (the KEY_WALL sheet)">${c ? 'Replace' : 'Load'} criteria .xlsx<input type="file" accept=".xlsx" data-criteria-file hidden></label>`;
        if (!c) {
            return `<div class="tk-criteria"><b>Engineer's criteria:</b> none loaded: studs, tracks and opening framing from the SSMA placeholder tables (typical values, not engineered). ${file}
                <span class="muted">With criteria, each wall's stud, spacing and tracks follow its stud depth, finish class, layers and height, and each door and window its header, jambs and sill.</span></div>`;
        }
        const pick = (key, list, cur, label) => (list.length > 1 ? `<label>${label} <select data-criteria-${key}>${list.map(v => `<option ${v === cur ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select></label>` : '');
        const skipped = c.warnings?.length ? ` · <span class="warn" title="${attr(c.warnings.join('\n'))}">${c.warnings.length} rows skipped</span>` : '';
        return `<div class="tk-criteria"><b>Engineer's criteria:</b> ${escapeHtml(c.file)} · ${fmt(c.rows.length)} wall rows · ${fmt(c.openings?.length || 0)} door and window rows${skipped}
            ${pick('group', c.choices.groups, c.group, 'Wall types')} ${pick('building', c.choices.buildings, c.building, 'Building')}
            ${file} <button data-criteria-clear>Remove</button>
            <span class="muted">Kept ${CONFIG.mode === 'static' ? 'in this browser' : 'on the local server'}; never published with the site.</span></div>`;
    }

    bindCriteria(p) {
        p.querySelector('[data-criteria-file]')?.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const sheets = await readXlsx(await file.arrayBuffer());
                const found = wallCriteria(sheets);
                if (!found.rows.length) throw new Error(found.warnings[0] || 'No wall criteria rows found');
                const choices = criteriaChoices(found.rows);
                const openings = openingCriteria(sheets);
                this.criteria = { file: file.name, importedAt: new Date().toISOString(), sheet: found.sheet, rows: found.rows, openings: openings.rows,
                    warnings: [...found.warnings, ...openings.warnings], choices, group: choices.groups[0] || '', building: choices.buildings[0] || '' };
                await this.saveCriteria();
            } catch (err) {
                alert(`Could not read the criteria: ${err.message || err}`);
            }
        });
        p.querySelector('[data-criteria-group]')?.addEventListener('change', (e) => { this.criteria.group = e.target.value; this.saveCriteria(); });
        p.querySelector('[data-criteria-building]')?.addEventListener('change', (e) => { this.criteria.building = e.target.value; this.saveCriteria(); });
        p.querySelector('[data-criteria-clear]')?.addEventListener('click', () => { this.criteria = null; this.saveCriteria(); });
    }

    async saveCriteria() {
        this.render();
        try { await saveState(CRITERIA_STATE, this.criteria || {}); } catch (err) { console.warn('Criteria not saved:', err.message); }
    }

    toggleSelection(key) {
        this.select(this.selection?.key === key ? null : key);
        this.render();
    }

    // A wall type's swatch (Assemblies tab): its framing type's color, grey when not ours, pink when no rule matches.
    colorOf(row) {
        if (row.asm.scope !== 'framed') return row.asm.scope === 'excluded' ? NOT_OURS : NEEDS_REVIEW;
        const wall = row.ids.map(id => this.wallInfo.get(id)).find(Boolean);
        return this.colorMaps.framing.get(wall?.framing) || NOT_OURS;
    }

    // Walls colored in 3D and on the plan by the Colors choice (framing type, SSMA stud, finish or layers); not ours
    // grey, unmatched pink. Gross: no colors.
    colorWalls() {
        if (this.tab === 'gross') { this.views.clearColors(); return; }
        const colors = new Map(), map = this.colorMaps[this.colorBy];
        for (const row of this.result.rows) {
            for (const id of row.ids) {
                if (row.asm.scope !== 'framed') colors.set(id, row.asm.scope === 'excluded' ? NOT_OURS : NEEDS_REVIEW);
                else colors.set(id, map.get(this.wallInfo.get(id)?.[this.colorBy]) || NOT_OURS);
            }
        }
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
        this.shareTotal = total[this.shareBy] || 0;
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
        const cols = 12 + (this.sheathing ? 1 : 0);
        const shareBy = `<select data-share-by aria-label="Share of">${Object.entries(SHARE_BY).map(([k, l]) => `<option value="${k}" ${k === this.shareBy ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
        body.innerHTML = `<div class="tk-grid-wrap"><table class="tk-grid">
            <thead><tr><th>${this.groups.map(d => DIMENSIONS[d].label).join(' ▸ ')}</th>
                <th title="The wall types in the row">Wall info</th><th title="The SSMA stud of the walls">SSMA stud</th><th title="Where the framing of the row comes from, with wall counts: engineer criteria, manual override, SSMA placeholder, out of range">Source</th>
                <th title="Finish class and board">Finish</th><th title="Gypsum layers, side A + side B">Layers</th>
                <th class="num">Walls</th><th class="num">Studs</th><th class="num">Stud LF</th><th class="num">Track LF</th><th class="num">Board SF</th>${this.sheathing ? '<th class="num">Sheathing SF</th>' : ''}
                <th class="num tk-share-h">% of ${shareBy}</th></tr></thead>
            <tbody>${rows.join('') || `<tr><td colspan="${cols}" class="muted">No framed walls match these filters.</td></tr>`}</tbody>
            <tfoot><tr class="total"><td>Total${this.filtering ? ` <span class="muted">(${escapeHtml(this.scopeLabel())})</span>` : ''}</td>${this.infoCells(total)}${this.numCells(total)}</tr></tfoot>
            </table></div>
            ${this.result.missing ? `<p class="warn">${this.result.missing} wall(s) have no length or area and are left out.</p>` : ''}
            <p class="note">Click a row to show its walls in 3D and on the plan; ▸ opens it. Net quantities from the framing layout, no waste: the Order list adds ${s.framingWastePct}% framing and ${s.boardWastePct}% board waste and rounds to pieces. ${DISCLAIMER}</p>`;
        body.querySelectorAll('[data-caret]').forEach(b => b.onclick = (e) => {
            e.stopPropagation();
            const key = b.dataset.caret;
            if (this.open.has(key)) this.open.delete(key); else this.open.add(key);
            this.render();
        });
        body.querySelector('[data-share-by]').onchange = (e) => { this.shareBy = e.target.value; this.render(); };
        body.querySelector('[data-share-by]').onclick = (e) => e.stopPropagation();
        body.querySelectorAll('[data-grp]').forEach(tr => tr.onclick = () => this.toggleSelection(`grp:${tr.dataset.grp}`));
        body.querySelectorAll('[data-itm]').forEach(tr => tr.onclick = () => this.toggleSelection(`itm:${tr.dataset.itm}`));
    }

    // Quantities, then the row's share of the total (Walls, Stud LF, Track LF or Board SF) as a number and a bar.
    numCells(t) {
        const n = (v) => (v ? fmt(v) : '<span class="muted">–</span>');
        const pct = this.shareTotal ? (100 * (t[this.shareBy] || 0)) / this.shareTotal : 0;
        return `<td class="num">${fmt(t.walls)}</td><td class="num">${n(t.studs)}</td><td class="num">${n(t.studLf)}</td><td class="num">${n(t.trackLf)}</td><td class="num">${n(t.boardSf)}</td>${this.sheathing ? `<td class="num">${n(t.sheathingSf)}</td>` : ''}
            <td class="num tk-share"><span class="tk-share-bar" style="width:${Math.min(100, pct).toFixed(1)}%"></span><span>${pct ? `${fmt(pct, 1)}%` : '–'}</span></td>`;
    }

    // The wall info of a row: its wall type, SSMA stud, finish and layers when there is one, else how many.
    infoCells(t) {
        const one = (list, many) => (!list?.length ? '<span class="muted">–</span>'
            : list.length === 1 ? escapeHtml(list[0]) : `<span class="muted" title="${attr(list.join('\n'))}">${list.length} ${many}</span>`);
        const src = (t.info.sources || []).map(({ source, walls }) => `<span class="tk-src ${SOURCE_TAG[source]?.[1] || ''}" title="${attr(source)}: ${walls} walls">${escapeHtml(SOURCE_TAG[source]?.[0] || source)} ${fmt(walls)}</span>`).join(' ');
        return `<td class="tk-info tk-wall">${one(t.info.wallTypes, 'wall types')}</td><td class="tk-info">${one(t.info.studs, 'studs')}</td><td class="tk-info tk-srcs">${src || '<span class="muted">–</span>'}</td>
            <td class="tk-info">${one(t.info.finishes, 'finishes')}</td><td class="tk-info">${one(t.info.layers, 'layer mixes')}</td>`;
    }

    groupRow(g) {
        const open = this.open.has(g.key);
        const swatch = this.colorMaps[g.dim] ? `<span class="swatch" style="background:${this.colorMaps[g.dim].get(g.value) || NOT_OURS}"></span>` : '';
        const sel = this.selection?.key === `grp:${g.key}` ? 'selected' : '';
        return `<tr class="tk-g d${Math.min(g.depth, 3)} clickable ${sel}" data-grp="${attr(g.key)}" title="Show these ${fmt(g.totals.walls)} walls">
            <td style="padding-left:${0.3 + g.depth * 1.1}em"><button class="tk-caret" data-caret="${attr(g.key)}" aria-label="${open ? 'Close' : 'Open'}" aria-expanded="${open}">${open ? '▾' : '▸'}</button>${swatch}${escapeHtml(g.value)}</td>
            ${this.infoCells(g.totals)}${this.numCells(g.totals)}</tr>`;
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
            <td style="padding-left:${1.9 + g.depth * 1.1}em">${this.itemLabel(item)}</td>${this.infoCells(item.totals)}${this.numCells(item.totals)}</tr>`;
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
            <table class="tk-grid"><thead><tr><th>Wall type</th><th>Scope</th><th>Stud</th><th>Rows</th><th>Layers A / B</th><th>Sheath.</th><th title="GYP / TILE / SHAFT: picks the engineer's criteria rows">Finish class</th></tr></thead><tbody data-rows></tbody></table>
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
                <td>${sel('sheathingSides', a.sheathingSides || 0, [[0, 0], [1, 1], [2, 2]])}</td>
                <td>${sel('finishClass', a.finishClass || finishClassOf(r.typeName), FINISH_CLASSES.map(c => [c, c]))}</td>`;
            tr.querySelector('[data-show]').onclick = (e) => { e.preventDefault(); this.isolateWalls(r.ids); };
            tr.querySelectorAll('select').forEach(el => el.onchange = () => {
                const current = assemblyFor(r.typeName, this.rules, this.overrides);
                const o = { ...this.overrides[r.typeName] };
                const v = ['scope', 'finishClass'].includes(el.dataset.key) ? el.value : Number(el.value);
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
            await saveState(STATE_NAME, { settings: this.settings, overrides: this.overrides, elementOverrides: this.elementOverrides, updatedAt: new Date().toISOString() });
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
                [...dims, 'Member line', 'Wall info', 'SSMA stud', 'Source (walls)', 'Finish', 'Layers', 'Walls', 'Studs (pcs)', 'Stud LF', 'Track LF', 'Board SF', 'Sheathing SF', `% of ${SHARE_BY[this.shareBy]}`]];
            const all = totalsOf(this.filteredLines);
            const info = (t) => [t.info.wallTypes.join(' / '), t.info.studs.join(' / '), t.info.sources.map(x => `${x.source} ${x.walls}`).join(' / '), t.info.finishes.join(' / '), t.info.layers.join(' / ')];
            const nums = (t) => [...info(t), t.walls, t.studs, t.studLf.toFixed(1), t.trackLf.toFixed(1), t.boardSf.toFixed(1), t.sheathingSf.toFixed(1),
                all[this.shareBy] ? ((100 * t[this.shareBy]) / all[this.shareBy]).toFixed(1) : ''];
            const walk = (groups, path) => {
                for (const g of groups) {
                    const p = [...path, g.value];
                    lines.push([...p, ...Array(dims.length - p.length).fill(''), '', ...nums(g.totals)]);
                    if (g.children.length) walk(g.children, p);
                    else g.items.forEach(i => lines.push([...p, this.itemLabel(i, false), ...nums(i.totals)]));
                }
            };
            walk(this.tree, []);
            lines.push(['Total', ...Array(dims.length).fill(''), ...nums(all)], [], [DISCLAIMER]);
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
