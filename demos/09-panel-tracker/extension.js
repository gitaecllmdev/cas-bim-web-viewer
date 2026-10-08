// Demo 7: Panel Tracker. Each prefab panel from BIM review to framing complete (BIM review, prefab review, shipped to
// site, delivered to site, framing complete): the field records a step by scanning the panel's QR code (a phone or
// tablet camera where the browser reads QR codes, a handheld scanner typing into the box, or the shop drawing's QR code
// opening its panel page), by typing its mark, or by clicking its wall in 3D or on the plan. The walls in 3D and on the
// plan in the color of their step; the pipeline, the list (Excel / CSV), QR labels to print, and the Revit exchange
// (export by UniqueId for Revit to pull, a Revit report back in). Saved per model ('panel-tracker' state, tracker.mjs).
// Install Progress (Demo 3) and this tracker switch in place (main.js 'switch-demo'); the tracker reads Install
// Progress (its framed walls count as framing complete) and the schedule (each floor's framing start: a panel not on
// site once its floor's framing has started is late); it never writes to them.
// Shared views (colors, isolate, select, plan labels, levels): core/client/views.js.
// Viewer3D (getSelection, SELECTION_CHANGED_EVENT): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Extension.onToolbarCreated: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Extension/
// Camera QR scanning (web platform, where the browser has it): BarcodeDetector
// https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector and MediaDevices.getUserMedia
// https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
import { loadState, saveState, fetchJson, escapeHtml, stateFor, onModelReady, loadPropertyMap, getWallData, getBulkProperties, propValue, toFeet, toSquareFeet } from '../../helpers.js';
import { fmtFtIn } from '../common/framing.mjs';
import { CONFIG } from '../../config.js';
import { DemoToolbar } from '../../toolbar.js';
import { assemblyFor } from '../02-takeoff/calc.mjs';
import { INDEX_STATE } from '../06-shop-drawings/panels.mjs';
import { linkActivities, fmtDay } from '../03-progress/p6.mjs';
import { csvText, xlsxBytes } from '../common/table-export.mjs';
import { qrEncode, qrRects } from '../common/qr.mjs';
import { shortLink } from '../common/panel-link.mjs';
import { reviztoButton, showReviztoConcept, REVIZTO_API } from '../../revizto-concept.js';
import {
    STAGES, NOT_STARTED, stageIndex, readTracker, statusOf, statusFor, skippedOf, markStage, unmarkStage, findPanel,
    effectiveRecord, counts, isLate, floorDates, numberPanels, scopeOf, prefixOf, prefixName, levelCode, SCOPES, scopeName, filterPanels, facetCounts, METRICS, DEFAULT_METRICS, productionMetrics, valueSummary, completeFloor, demoFloors, demoHistory, revitRows, readRevitRows, importRevit,
} from './tracker.mjs';

const EXTENSION_ID = 'Drywall.PanelTracker';
const NOT_SET = 'Not set';
const LATE = '#d62728';
const TABS = { track: 'Track', list: 'Panels', labels: 'QR labels', revit: 'Revit' };
const INSTALLED = new Set(['Framed', 'Boarded', 'Taped', 'Finished']); // Install Progress stages at or past framing
const VIA = { scan: 'scanned', camera: 'camera', manual: 'typed', '3d': 'clicked in 3D', card: 'panel card', page: 'panel page', revit: 'from Revit', demo: 'demo', install: 'Install Progress' };
const localToday = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the viewer's time zone
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem(`drywall-demos:tracker-${k}`); localStorage.setItem(`drywall-demos:tracker-${k}`, v); } catch { /* storage blocked */ } return null; };
const day = (d) => (d ? fmtDay(d) : '');
const dayMonth = (d) => day(d).slice(0, 6); // 14-Jul (the list; the full date in its tooltip)

class PanelTrackerExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.panel = this.options.panel;
        this.panel.classList.add('wide');
        this.tab = 'track';
        this.stage = stageIndex(pref('stage')) >= 0 ? pref('stage') : 'bim'; // the step being recorded
        this.demo = pref('demo') !== 'false';
        this.recordOnClick = false;
        this.date = localToday();
        this.picked = null;
        this.only = 'panels'; // shown in 3D: 'panels' (the rest ghosted), a step's key, 'late', or null (every wall)
        // The slicers (Sets; empty: all) and the search, kept in the link (pt-l, pt-s, pt-p, pt-q) so a view can be sent;
        // status: the list's own step filter.
        const params = new URLSearchParams(location.search), set = (k) => new Set((params.get(k) || '').split('|').filter(Boolean));
        this.filter = { levels: set('pt-l'), scopes: set('pt-s'), prefixes: set('pt-p'), q: params.get('pt-q') || '', status: '' };
        // 3D: the floor of the plan open in 2D, cut and framed in full ('level', the default), or every floor ('all').
        this.viewScope = (pref('view-scope') || pref('pick-scope')) === 'all' ? 'all' : 'level';
        // The figures on top (METRICS keys) and the model parameters added to them, as this browser last had them.
        const keep = (k, fallback) => { try { const v = JSON.parse(pref(k) || 'null'); return Array.isArray(v) ? v : fallback; } catch { return fallback; } };
        this.metricKeys = keep('metrics', DEFAULT_METRICS).filter(k => METRICS.some(m => m.key === k));
        this.params = keep('params', []).filter(n => typeof n === 'string' && n.trim()).slice(0, 6);
        this.paramValues = new Map(); // parameter name -> Map(dbId -> value)
        this.lastSel = [];
        this.panel.innerHTML = '<div class="demo-panel pt"><h2>Panel Tracker</h2><p class="muted" data-status>Waiting for a model…</p></div>';
        this.onSelection = () => this.selectionChanged();
        this.viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection);
        this.bindPanel();
        this.stops = [
            onModelReady(this.viewer, (model) => this.init(model)),
            this.views.on('ready', () => { if (this.walls) { this.prepare(); this.render(); } }), // the floors, in build order
            this.views.on('level', (level) => this.levelChanged(level)),
            this.views.on('sheet', () => this.syncToPlan()), // the plan opened: 3D follows its floor
            (() => { const header = document.getElementById('levels'), picked = () => this.headerLevelPicked(header.value || null);
                header.addEventListener('change', picked); return () => header.removeEventListener('change', picked); })(),
        ];
        return true;
    }

    unload() {
        this.stops.forEach(stop => stop());
        this.listening.abort();
        clearTimeout(this.qTimer);
        clearTimeout(this.toastTimer);
        this.viewer.removeEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection);
        this.closeCamera();
        this.bar?.remove();
        this.legend?.remove();
        this.views.setPlanLabels(null);
        this.views.clearColors();
        if (this.only) this.views.showAll();
        this.panel.classList.remove('wide');
        this.panel.innerHTML = '';
        return true;
    }

    // Extension.onToolbarCreated: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Extension/
    onToolbarCreated() {
        if (this.bar) return;
        const only = (key, name) => ({ key, icon: `dw-icon-pt-${key}`, tip: `Show only: ${name}`, run: () => this.showOnly(key), on: () => this.only === key });
        this.bar = new DemoToolbar(this.viewer, 'dw-tracker', [
            { key: 'click', icon: 'dw-icon-pt-click', tip: 'Record by clicking walls: the step picked in the panel, on each wall you click (3D or plan)', run: () => this.setRecordOnClick(!this.recordOnClick), on: () => this.recordOnClick },
            { key: 'only', icon: 'dw-icon-pt-only', tip: 'Show only the panels at a step', items: [
                only('panels', 'the panels (the rest of the model ghosted)'), only('none', NOT_STARTED.name), ...STAGES.map(s => only(s.key, s.name)),
                only('late', 'Late (not on site, floor framing)'), { key: 'all', icon: 'dw-icon-showall', tip: 'Show every wall', run: () => this.showOnly(null) },
            ] },
        ]);
    }

    async init(model) {
        try {
            this.names = { tracker: await stateFor('panel-tracker') };
            const [map, rules, takeoff, index, schedule, progress, saved] = await Promise.all([loadPropertyMap(), fetchJson('samples/takeoff-rules.json'),
                loadState(await stateFor('takeoff')).catch(() => ({})), loadState(await stateFor(INDEX_STATE)).catch(() => ({})),
                loadState(await stateFor('schedule')).catch(() => ({})), loadState(await stateFor('progress')).catch(() => ({})),
                loadState(this.names.tracker).catch(() => ({}))]);
            const { walls } = await getWallData(model, map);
            this.walls = walls;
            this.model = model;
            // Each wall's length, height (Revit's Unconnected Height, the property map's "height") and area, in feet.
            const heightName = map.height || 'Unconnected Height';
            const heights = new Map((await getBulkProperties(model, walls.map(w => w.dbId), [heightName]).catch(() => []))
                .map(r => { const p = r.properties.find(x => x.displayName === heightName); return [r.dbId, p ? toFeet(p.displayValue, p.units) : NaN]; }));
            this.wallInfo = new Map(walls.map(w => [w.externalId, { lengthFt: toFeet(w.length, w.lengthUnits), areaSf: toSquareFeet(w.area, w.areaUnits),
                heightFt: heights.get(w.dbId), fire: w.fireRating || '' }]));
            this.byExt = new Map(walls.map(w => [w.externalId, w]));
            this.rules = rules;
            this.overrides = takeoff.overrides || {};
            this.index = index.panels || {};
            this.schedule = schedule?.activities?.length ? schedule : null;
            this.install = new Map(Object.entries(progress?.stages || {}));
            this.tracker = readTracker(saved);
            this.project = document.querySelector('#models option:checked')?.textContent || 'This model';
            if (!this.source || (this.source === 'shops' && !Object.keys(this.index).length)) this.source = 'walls';
            this.prepare();
            this.render();
            if (this.only) this.views.isolate(this.onlyIds(), { plan: this.only !== 'panels' }); // and framed in 3D
            this.syncToPlan();
            if (this.params.length) this.loadParams(this.params);
        } catch (err) {
            console.error(err);
            this.panel.querySelector('[data-status]').textContent = `Could not start the tracker: ${err.message || err}`;
        }
    }

    // --- Panels, numbers, floors, demo data ----------------------------------------------------------------------

    // Every panel { key, dbId, mark, alt, level, wallType, shop, framed }: each framed wall (takeoff rules) and each shop
    // drawing panel (Demo 6), numbered P<floor>-<001> floor by floor (a concept; the shop mark kept as alt). Then the
    // source's panels, each floor's framing (the demo's, or the schedule's), and the demo data. Numbers and demo data
    // are over every panel, so a panel keeps them whichever list shows it.
    prepare() {
        const all = new Map();
        this.prefixNames = new Map(); // 362 -> 3 5/8" studs
        const kind = (type) => {
            const asm = assemblyFor(type ?? NOT_SET, this.rules, this.overrides), prefix = prefixOf(asm);
            if (!this.prefixNames.has(prefix)) this.prefixNames.set(prefix, prefixName(asm));
            return { asm, scope: scopeOf(type, asm), prefix };
        };
        for (const w of this.walls) {
            const k = kind(w.wallType);
            if (k.asm.scope !== 'framed') continue;
            all.set(w.externalId, { key: w.externalId, dbId: w.dbId, level: w.level || NOT_SET, wallType: w.wallType || NOT_SET, framed: true, scope: k.scope, prefix: k.prefix, ...this.wallInfo.get(w.externalId) });
        }
        for (const e of Object.values(this.index)) {
            const w = this.byExt.get(e.key), type = e.wallType || w?.wallType || NOT_SET, k = kind(type);
            const p = all.get(e.key) || { key: e.key, dbId: w?.dbId, level: e.level || w?.level || NOT_SET, wallType: type, framed: false, scope: k.scope, prefix: k.prefix,
                lengthFt: (e.lengthIn || 0) / 12, heightFt: (e.heightIn || 0) / 12, areaSf: ((e.lengthIn || 0) * (e.heightIn || 0)) / 144, ...this.wallInfo.get(e.key) };
            all.set(e.key, { ...p, shop: true, alt: e.mark });
        }
        const nat = (x, y) => String(x).localeCompare(String(y), undefined, { numeric: true });
        const order = this.views.levels.map(l => l.name), have = new Set([...all.values()].map(p => p.level));
        this.levels = [...order.filter(l => have.has(l)), ...[...have].filter(l => !order.includes(l)).sort(nat)];
        const every = [...all.values()].sort((x, y) => this.levels.indexOf(x.level) - this.levels.indexOf(y.level) || x.prefix.localeCompare(y.prefix) || (x.dbId || 1e12) - (y.dbId || 1e12) || nat(x.key, y.key));
        const numbers = numberPanels(every);
        for (const p of every) p.mark = numbers.get(p.key);
        const out = every.filter(p => (this.source === 'shops' ? p.shop : p.framed));
        this.panels = out;
        this.byKey = new Map(every.map(p => [p.key, p])); // any panel (a recent record from the other list too)
        this.byDb = new Map(out.filter(p => p.dbId).map(p => [p.dbId, p]));
        // Slicer choices that this list does not have (another model, the other panel list) go.
        const has = (field) => new Set(out.map(p => p[field]));
        for (const [facet, field] of [['levels', 'level'], ['scopes', 'scope'], ['prefixes', 'prefix']]) {
            const values = has(field);
            for (const v of this.filter[facet]) if (!values.has(v)) this.filter[facet].delete(v);
        }
        this.shownCache = null;
        // Recorded data: each floor's framing from the schedule's framing activities linked to it (Demo 3).
        const starts = {}, finishes = {};
        if (this.schedule) {
            for (const act of linkActivities(this.schedule, order)) {
                if (act.scope === 'other' || act.stage !== 'Framed' || !act.level || !act.start) continue;
                if (!starts[act.level] || act.start < starts[act.level]) starts[act.level] = act.start;
                if (act.finish && (!finishes[act.level] || act.finish > finishes[act.level])) finishes[act.level] = act.finish;
            }
        }
        this.today = localToday();
        this.schedFloors = floorDates(this.levels, { starts, finishes, today: this.today });
        // Demo data: one floor complete, the others part way (tracker.mjs demoHistory).
        this.complete = completeFloor(this.levels);
        this.demoFloors = demoFloors(this.levels, { today: this.today, complete: this.complete });
        this.demoRecs = demoHistory(every, { levels: this.levels, today: this.today, complete: this.complete });
    }

    // Each floor's framing dates: the demo's with the demo data, else the schedule's.
    get floors() {
        return this.demo ? this.demoFloors : this.schedFloors;
    }

    installed(p) {
        return INSTALLED.has(this.install.get(p.key));
    }

    // What a panel shows: its records, over the demo data (when on); without the demo data, framing complete also from
    // Install Progress (its framed walls).
    recordOf(p) {
        return this.demo ? effectiveRecord(this.tracker.panels[p.key], this.demoRecs[p.key])
            : effectiveRecord(this.tracker.panels[p.key], null, { installed: this.installed(p) });
    }

    startOf(p) {
        return this.floors[p.level]?.planned ? this.floors[p.level].start : '';
    }

    late(p) {
        return isLate(this.recordOf(p), this.startOf(p), this.today);
    }

    // The panels the slicers let through (levels, scope, prefix, search), with their keys.
    get shown() {
        if (!this.shownCache) {
            const list = filterPanels(this.panels, this.filter);
            this.shownCache = { list, keys: new Set(list.map(p => p.key)) };
        }
        return this.shownCache.list;
    }

    get hasFilters() {
        return !!(this.filter.levels.size || this.filter.scopes.size || this.filter.prefixes.size || this.filter.q.trim());
    }

    // "3RD FLOOR · Exterior · 362", or "All panels".
    get filterSummary() {
        const f = this.filter, list = (set, many, max, fmt = (v) => v) => (set.size > max ? `${set.size} ${many}` : [...set].map(fmt).join(', '));
        const parts = [
            f.levels.size ? list(f.levels, 'floors', 3) : '',
            f.scopes.size ? list(f.scopes, 'scopes', 2, scopeName) : '',
            f.prefixes.size ? list(f.prefixes, 'prefixes', 3) : '',
            f.q.trim() ? `"${f.q.trim()}"` : '',
        ].filter(Boolean);
        return parts.length ? parts.join(' · ') : 'All panels';
    }

    // --- Slicers ---------------------------------------------------------------------------------------------------------

    // A slicer value on or off (value null: that slicer back to all).
    toggleFacet(facet, value) {
        const set = this.filter[facet];
        if (value === null) set.clear(); else if (set.has(value)) set.delete(value); else set.add(value);
        this.filtersChanged({ levels: facet === 'levels' });
    }

    clearFilters() {
        const hadLevels = this.filter.levels.size;
        for (const k of ['levels', 'scopes', 'prefixes']) this.filter[k].clear();
        this.filter.q = '';
        const q = this.panel.querySelector('[data-fq]');
        if (q) q.value = '';
        this.filtersChanged({ levels: !!hadLevels });
    }

    // After a slicer change: one floor chosen cuts the model to it and opens its plan (the header's Level); none or
    // several, the whole building. Everything showing the panels follows; the 3D view moves only when the panels now
    // shown are off screen, a speck, or much bigger than the view (views.showSet).
    filtersChanged({ levels = false } = {}) {
        this.shownCache = null;
        const params = new URLSearchParams(location.search), f = this.filter;
        for (const [k, v] of [['pt-l', [...f.levels].join('|')], ['pt-s', [...f.scopes].join('|')], ['pt-p', [...f.prefixes].join('|')], ['pt-q', f.q.trim()]]) {
            if (v) params.set(k, v); else params.delete(k);
        }
        history.replaceState(null, '', `?${params}${location.hash}`);
        const cut = levels && this.viewScope === 'level' && f.levels.size === 1;
        if (cut) this.showLevel([...f.levels][0], { plan: true, fit: true });
        this.renderMetrics();
        this.renderSlicers();
        this.renderPipeline();
        if (this.tab !== 'track' && this.tab !== 'revit') this.renderBody();
        this.show();
        this.drawLegend();
        const ids = this.shown.filter(p => p.dbId).map(p => p.dbId);
        if (!cut) this.views.showPlanFor(ids); // the plan of the floor with most of them (This floor: 3D follows it)
        if (this.viewScope === 'all') this.views.showSet(ids);
    }

    // The header's Level changed (here, by a slicer, a picked panel, the plan; or there): the legend says so.
    levelChanged() {
        if (this.walls) this.drawLegend();
    }

    // The header's Level picked by hand (its change event: never fired by code): a floor is This floor, framed in full;
    // All levels is All levels; the Levels slicer follows. The views set the level first (their own handler).
    headerLevelPicked(name) {
        if (!this.walls) return;
        this.viewScope = name ? 'level' : 'all';
        pref('view-scope', this.viewScope);
        if (name) setTimeout(() => this.views.fitShown(), 0);
        const f = this.filter.levels;
        if (name && !(f.size === 1 && f.has(name))) { f.clear(); f.add(name); this.filtersChanged(); }
        else if (!name && f.size === 1) { f.clear(); this.filtersChanged(); }
        this.drawLegend();
    }

    // The slicer chips: each value with how many panels it would show given the other slicers.
    renderSlicers() {
        const el = this.panel.querySelector('[data-facets]');
        if (!el) return;
        const f = this.filter, fc = facetCounts(this.panels, f);
        const chip = (facet, v, label, title) => {
            const n = fc[facet].get(v) || 0, on = f[facet].has(v);
            return `<button class="pt-fchip ${on ? 'on' : ''}" data-facet="${facet}" data-v="${escapeHtml(v)}" ${n || on ? '' : 'disabled'} title="${escapeHtml(title)}">${escapeHtml(label)}<b>${n.toLocaleString()}</b></button>`;
        };
        const all = (facet) => `<button class="pt-fchip all ${f[facet].size ? '' : 'on'}" data-facet="${facet}" data-v="" title="Every one">All</button>`;
        const present = (field) => new Set(this.panels.map(p => p[field]));
        const scopes = present('scope'), prefixes = [...present('prefix')].sort();
        el.innerHTML = `<div class="pt-facet"><span class="pt-flabel">Levels</span><div class="pt-chips">${all('levels')}${this.levels.filter(l => this.panels.some(p => p.level === l)).map(l => chip('levels', l, levelCode(l), l)).join('')}</div></div>
            <div class="pt-facet"><span class="pt-flabel">Scope</span><div class="pt-chips">${all('scopes')}${SCOPES.filter(s => scopes.has(s.key)).map(s => chip('scopes', s.key, s.name, s.name)).join('')}</div></div>
            <div class="pt-facet"><span class="pt-flabel">Prefix</span><div class="pt-chips">${all('prefixes')}${prefixes.map(p => chip('prefixes', p, p, `${p}: ${this.prefixNames.get(p) || ''}`)).join('')}</div></div>`;
        const count = this.panel.querySelector('[data-fcount]');
        if (count) count.textContent = this.hasFilters ? `${this.shown.length.toLocaleString()} of ${this.panels.length.toLocaleString()}` : `${this.panels.length.toLocaleString()} panels`;
        this.panel.querySelector('[data-act=clear-filters]')?.toggleAttribute('hidden', !this.hasFilters);
    }

    // --- Production metrics on top ------------------------------------------------------------------------------------

    // The figures chosen (⚙), for the panels the slicers show: linear feet by step, area, heights, studs, the mixes, and
    // each model parameter added (numbers: total and mean; text: the most common values).
    renderMetrics() {
        const el = this.panel.querySelector('[data-metrics]');
        if (!el || !this.panels) return;
        const shown = this.shown, m = productionMetrics(shown, { statusOf: p => statusOf(this.recordOf(p)), late: p => this.late(p), spacingIn: this.rules.settings?.studSpacingIn || 16 });
        const n = (v) => Math.round(v).toLocaleString(), pct = (v) => (m.lf ? ` · ${Math.round((v / m.lf) * 100)}%` : '');
        const mix = (list, label = (k) => k) => (list.length ? [label(list[0][0]), `${Math.round((list[0][1] / (m.lf || 1)) * 100)}% of LF · ${list.length} in all`,
            list.slice(0, 6).map(([k, v]) => `${label(k)}: ${n(v)} LF`).join('\n')] : ['–', '', '']);
        const tile = (name, value, sub = '', title = '', color = '') => `<div class="pt-metric" title="${escapeHtml(title || `${name}: ${value} ${sub}`)}"${color ? ` style="--m:${color}"` : ''}><span>${escapeHtml(name)}</span><b>${escapeHtml(value)}</b><em>${escapeHtml(sub)}</em></div>`;
        const s = (k) => STAGES[stageIndex(k)].color, ft = (f) => fmtFtIn(f * 12);
        const tiles = {
            panels: () => tile('Panels', n(m.panels), this.hasFilters ? `of ${n(this.panels.length)}` : 'all'),
            lf: () => tile('Linear ft', `${n(m.lf)} LF`, `${n(m.panels ? m.lf / m.panels : 0)} LF a panel`),
            lfFramed: () => tile('LF framed', `${n(m.lfFramed)} LF`, `framing complete${pct(m.lfFramed)}`, '', s('framed')),
            lfSite: () => tile('LF on site', `${n(m.lfSite)} LF`, `delivered or framed${pct(m.lfSite)}`, '', s('delivered')),
            lfLate: () => tile('LF late', `${n(m.lfLate)} LF`, `not on site, floor framing${pct(m.lfLate)}`, '', LATE),
            sf: () => tile('Wall area', `${n(m.sf)} SF`, 'one face'),
            height: () => (m.height ? tile('Height', ft(m.height.mean), `${ft(m.height.min)} to ${ft(m.height.max)}`, 'Unconnected height: mean, lowest to highest') : tile('Height', '–', 'no height in the model')),
            studs: () => tile('Studs (est.)', n(m.studs), `@ ${this.rules.settings?.studSpacingIn || 16}" o.c., + 1 a panel`),
            types: () => { const [top, sub, title] = mix(m.types, (k) => String(k).replace(/^_/, '').split(' - ')[0]); return tile('Wall types', String(m.types.length), `top ${top} · ${sub.split(' · ')[0]}`, title); },
            scope: () => { const [top, sub, title] = mix(m.scope, scopeName); return tile('Scope', top, sub, title); },
            prefix: () => { const [top, sub, title] = mix(m.prefix, (k) => `${k} (${this.prefixNames.get(k) || ''})`); return tile('Stud prefix', top.split(' (')[0], `${this.prefixNames.get(m.prefix[0]?.[0]) || ''} · ${sub}`, title); },
            fire: () => { const [top, sub, title] = mix(m.fire); return tile('Fire rating', top, sub, title); },
        };
        const params = this.params.map(name => {
            const values = this.paramValues.get(name);
            if (!values) return tile(name, '…', 'loading');
            const v = valueSummary(shown.map(p => values.get(p.dbId)));
            if (!v.n) return tile(name, '–', 'no panel has it');
            return v.numeric ? tile(name, n(v.total), `total · mean ${(Math.round(v.mean * 100) / 100).toLocaleString()}`)
                : tile(name, v.top[0][0], `${v.top[0][1].toLocaleString()} panels · ${v.distinct} values`, v.top.map(([k, c]) => `${k}: ${c}`).join('\n'));
        });
        el.innerHTML = `<div class="pt-mtiles">${this.metricKeys.map(k => tiles[k]?.()).join('')}${params.join('')}</div>
            <details class="pt-mchoose"><summary title="Choose the figures shown, or add a model parameter">⚙</summary><div class="pt-mpop">
                <b>Figures</b>${METRICS.map(x => `<label><input type="checkbox" data-metric="${x.key}" ${this.metricKeys.includes(x.key) ? 'checked' : ''}>${escapeHtml(x.name)}</label>`).join('')}
                <b>Model parameters</b>${this.params.map(p => `<span class="pt-mparam">${escapeHtml(p)}<button class="pt-x" data-param-remove="${escapeHtml(p)}" title="Remove">×</button></span>`).join('')}
                <form data-param-add class="pt-madd"><input list="pt-param-names" placeholder="A wall parameter, e.g. Type Mark" aria-label="Parameter name"><button>Add</button></form>
                <datalist id="pt-param-names">${['Type Mark', 'Mark', 'Comments', 'Function', 'Structural Usage', 'Width', 'Base Offset', 'Top Offset', 'Assembly Code', 'Phase Created', 'Workset', 'Room Bounding'].map(x => `<option value="${x}">`).join('')}</datalist>
                <p class="muted">Any property of the walls, by its name in the model's properties. Shown here, on the panel card and in the Excel list.</p></div></details>`;
        el.querySelector('details').open = !!this.chooserOpen;
        el.querySelector('details').addEventListener('toggle', (e) => { this.chooserOpen = e.target.open; });
    }

    setMetric(key, on) {
        this.metricKeys = METRICS.map(m => m.key).filter(k => (k === key ? on : this.metricKeys.includes(k)));
        pref('metrics', JSON.stringify(this.metricKeys));
        this.renderMetrics();
    }

    // A model parameter added to the figures: read for every panel's wall once (Model.getBulkProperties).
    // https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Model/
    addParam(name) {
        name = String(name || '').trim();
        if (!name || this.params.includes(name) || this.params.length >= 6) return;
        this.params.push(name);
        pref('params', JSON.stringify(this.params));
        this.renderMetrics();
        this.loadParams([name]);
    }

    removeParam(name) {
        this.params = this.params.filter(p => p !== name);
        pref('params', JSON.stringify(this.params));
        this.renderMetrics();
        this.renderCard();
    }

    async loadParams(names) {
        const ids = this.walls.map(w => w.dbId);
        const results = await getBulkProperties(this.model, ids, names).catch(() => []);
        for (const name of names) this.paramValues.set(name, new Map(results.map(r => [r.dbId, propValue(r, name)]).filter(([, v]) => v !== undefined)));
        this.renderMetrics();
        this.renderCard();
    }

    paramOf(p, name) {
        return this.paramValues.get(name)?.get(p.dbId);
    }

    // A panel's figures for its card: scope, stud, length, height, area, fire rating, the parameters added.
    factsOf(p) {
        const ft = (f) => (Number(f) > 0 ? fmtFtIn(f * 12) : '–');
        return [['Scope', scopeName(p.scope)], ['Stud', `${p.prefix} · ${this.prefixNames.get(p.prefix) || ''}`], ['Length', ft(p.lengthFt)], ['Height', ft(p.heightFt)],
            ['Area', Number(p.areaSf) > 0 ? `${Math.round(p.areaSf).toLocaleString()} SF` : '–'], ['Fire rating', p.fire || '–'],
            ...this.params.map(n => [n, String(this.paramOf(p, n) ?? '–')])];
    }

    // A panel raised in Revizto (a concept, core/client/revizto-concept.js): an issue for it, its steps as a comment, its
    // review status back. Doable with the right Revizto access; nothing is sent.
    rzPanel(key) {
        const p = this.byKey.get(key);
        if (!p) return;
        const rec = this.recordOf(p), st = statusFor(statusOf(rec)), late = this.late(p);
        const done = STAGES.filter(s => rec[s.key]).map(s => `${s.name} ${day(rec[s.key].date)}`);
        showReviztoConcept({ title: 'Raise in Revizto', intro: `Panel ${p.mark}${late ? ' is late' : ''}: an issue in Revizto for the coordination team, with what the field knows about it.`,
            cards: [{ code: p.prefix.slice(0, 4), color: st.color, statusColor: late ? LATE : '#d93025', status: 'Open', title: `Panel ${p.mark} · ${p.level}${late ? ' · late' : ''}`,
                lines: [`Now: ${st.name}${late ? ' (not on site, floor framing)' : ''}`, `${scopeName(p.scope)} · ${this.prefixNames.get(p.prefix) || p.prefix}`, done.length ? `Steps: ${done.join(', ')}` : 'No step recorded yet',
                    `Tags: Panel Tracker, ${p.level}, ${scopeName(p.scope)}`, 'The plan around it as the picture; the wall\'s Revit UniqueId in the first comment'] }],
            api: [REVIZTO_API.create, REVIZTO_API.comments, REVIZTO_API.issues],
            steps: ['Make the issue in the project\'s Revizto: title, the panel\'s stud prefix as its stamp, tags, the plan around the panel as the picture.',
                'Add the panel\'s steps (who recorded each and when) as a comment.', 'Show "Open in Revizto" on the card, and the issue\'s status back here.'] });
    }

    // --- 3D: the plan's floor, or every floor -----------------------------------------------------------------------

    // This floor ('level', the default): 3D shows the floor of the plan open in 2D, cut to that floor's walls and framed
    // in full; opening another floor's plan (the sheet list, a slicer, a picked panel) takes 3D there. All levels: the
    // whole building, the plan as it is.
    setViewScope(scope) {
        this.viewScope = scope;
        pref('view-scope', scope);
        if (scope === 'all' && this.views.level) {
            this.levelsFromHere = (this.levelsFromHere || 0) + 1;
            this.views.setLevel(null, { plan: false, fit: true }).finally(() => { this.levelsFromHere--; });
        } else this.syncToPlan();
        this.drawLegend();
    }

    // This floor: 3D to the open plan's floor (a sheet without one: the header's, else the floor with most panels shown).
    syncToPlan() {
        if (!this.walls || this.viewScope !== 'level') return;
        const count = new Map();
        for (const p of this.shown) count.set(p.level, (count.get(p.level) || 0) + 1);
        const busiest = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
        this.showLevel(this.views.planLevelName || this.views.level?.name || busiest, { plan: false, fit: true });
    }

    // The header's Level set from here (the slicers stay): cut 3D to it and frame it in full (views.setLevel).
    async showLevel(name, { plan = false, fit = true } = {}) {
        if (!name || this.views.level?.name === name || !this.views.levels.some(l => l.name === name)) return;
        this.levelsFromHere = (this.levelsFromHere || 0) + 1;
        try { await this.views.setLevel(name, { plan, fit }); } finally { this.levelsFromHere--; }
    }

    // A picked panel, This floor: its floor in 3D (framed at once, so the pick's own framing measures from there) and plan.
    async applyPickScope(p) {
        if (this.viewScope === 'level' && p) await this.showLevel(p.level, { plan: true, fit: 'now' });
    }

    statusKey(p) {
        return statusFor(statusOf(this.recordOf(p))).key;
    }

    colorOf(p) {
        return statusFor(statusOf(this.recordOf(p))).color;
    }

    // --- Recording -------------------------------------------------------------------------------------------------------

    get you() {
        try { return localStorage.getItem('cas-panel-name') || ''; } catch { return ''; } // the panel page's name too
    }

    // A scan or a typed text: the panel it names gets the step being recorded.
    scan(text, via = 'scan') {
        const found = findPanel(this.panels, text);
        if (found.panel) return this.record(found.panel.key, this.stage, via);
        const other = this.source === 'shops' ? 'Framed walls' : 'Shop drawing panels';
        if (found.matches.length) {
            this.toast(`${found.matches.length} panels match "${text}": pick one.<div class="pt-picks">${found.matches.map(p => `<button data-act="rec" data-v="${escapeHtml(p.key)}">${escapeHtml(p.mark)}</button>`).join('')}</div>`, 'warn', true);
        } else this.toast(`No panel "${escapeHtml(text)}" in ${this.source === 'shops' ? 'the shop drawing panels' : 'the framed walls'} of this model. Try ${other}.`, 'bad', true);
        return false;
    }

    record(key, stage, via) {
        const p = this.byKey.get(key), st = STAGES[stageIndex(stage)];
        if (!p || !st) return false;
        const before = this.recordOf(p);
        if (before[stage] && before[stage].via !== 'demo') {
            const r = before[stage];
            this.toast(r.via === 'install' ? `<b>${escapeHtml(p.mark)}</b> is framed already in Install Progress.`
                : `<b>${escapeHtml(p.mark)}</b> was already recorded ${escapeHtml(st.name.toLowerCase())} ${day(r.date)}${r.by ? ` by ${escapeHtml(r.by)}` : ''}.`, 'info', true);
            this.pick(key, { select: true });
            return false;
        }
        const res = markStage(this.tracker, key, stage, { date: this.date, by: this.you, via });
        if (!res.ok) return false;
        const skipped = skippedOf(this.recordOf(p)).map(k => STAGES[stageIndex(k)].name.toLowerCase());
        this.toast(`<b>✓ ${escapeHtml(p.mark)}</b> · ${escapeHtml(st.name)} ${day(this.date)}${skipped.length ? `<br><span class="pt-warn">Not recorded before it: ${escapeHtml(skipped.join(', '))}.</span>` : ''}
            <button class="link" data-act="undo" data-v="${escapeHtml(key)}|${stage}">Undo</button>`, 'ok', true);
        this.save();
        this.pick(key, { select: true });
        this.update();
        return true;
    }

    undo(key, stage) {
        if (!unmarkStage(this.tracker, key, stage)) return;
        this.toast(`Undone: ${escapeHtml(this.byKey.get(key)?.mark || key)} · ${escapeHtml(STAGES[stageIndex(stage)].name)}.`, 'info');
        this.save();
        this.update();
    }

    save() {
        saveState(this.names.tracker, this.tracker).catch(err => this.toast(`Not saved: ${escapeHtml(err.message)}`, 'bad', true));
    }

    setStage(stage) {
        this.stage = stage;
        pref('stage', stage);
        this.renderPipeline();
        this.renderScanHead();
        this.panel.querySelector('[data-scan-input]')?.focus();
    }

    setRecordOnClick(on) {
        this.recordOnClick = on;
        this.lastSel = this.viewer.getSelection();
        const box = this.panel.querySelector('[data-click]');
        if (box) box.checked = on;
        this.bar?.refresh();
        if (on) this.toast(`Click walls in 3D or on the plan: each one is recorded <b>${escapeHtml(STAGES[stageIndex(this.stage)].name)}</b> (Ctrl+click for several).`, 'info');
    }

    // A wall picked in 3D or on the plan (views mirror the plan's picks to 3D): recorded when "record by clicking" is
    // on, else its card.
    selectionChanged() {
        if (!this.panels || this.selecting) return;
        const ids = this.viewer.getSelection(), fresh = ids.filter(id => !this.lastSel.includes(id));
        this.lastSel = ids;
        const picked = fresh.map(id => this.byDb.get(id)).filter(Boolean);
        if (this.recordOnClick) { for (const p of picked) this.record(p.key, this.stage, '3d'); return; }
        if (ids.length === 1 && this.byDb.has(ids[0])) this.pick(this.byDb.get(ids[0]).key);
    }

    // --- The side panel ----------------------------------------------------------------------------------------------

    // The panel's listeners, removed on unload (the panel element stays for the next demo).
    bindPanel() {
        const p = this.panel, on = { signal: (this.listening = new AbortController()).signal };
        p.addEventListener('click', (e) => {
            const drop = e.target.closest?.('[data-param-remove]');
            if (drop) { this.removeParam(drop.dataset.paramRemove); return; }
            const chip = e.target.closest?.('[data-facet]');
            if (chip) { this.toggleFacet(chip.dataset.facet, chip.dataset.v || null); return; }
            const t = e.target.closest?.('[data-act]');
            if (t) {
                const v = t.dataset.v;
                ({
                    stage: () => this.setStage(v), tab: () => this.setTab(v), pick: () => this.pick(v, { select: true }), rec: () => this.record(v, this.stage, 'manual'),
                    undo: () => { const [k, s] = v.split('|'); this.undo(k, s); }, step: () => { const [k, s] = v.split('|'); this.record(k, s, 'card'); },
                    close: () => this.pick(null), camera: () => this.openCamera(), switch: () => document.dispatchEvent(new CustomEvent('switch-demo', { detail: { id: '03-progress' } })),
                    xlsx: () => this.exportList('xlsx'), csv: () => this.exportList('csv'), revit: () => this.exportRevit(), print: () => this.printLabels(v === 'large'),
                    only: () => this.showOnly(this.only === v ? 'panels' : v), zoom: () => this.zoomTo(v), 'clear-filters': () => this.clearFilters(), 'rz-panel': () => this.rzPanel(v),
                })[t.dataset.act]?.();
                return;
            }
            const row = e.target.closest?.('tr[data-key]');
            if (row && !e.target.closest('a')) this.pick(row.dataset.key, { select: true });
        }, on);
        p.addEventListener('submit', (e) => {
            if (e.target.matches('[data-param-add]')) { e.preventDefault(); const input = e.target.querySelector('input'); this.addParam(input.value); input.value = ''; return; }
            if (!e.target.matches('[data-scan]')) return;
            e.preventDefault();
            const input = e.target.querySelector('[data-scan-input]'), text = input.value.trim();
            if (text) this.scan(text, 'scan');
            input.value = '';
            input.focus();
        }, on);
        p.addEventListener('change', (e) => {
            const t = e.target;
            if (t.name === 'pt-src') { this.source = t.value; this.pick(null); this.prepare(); this.render(); if (this.only) this.views.isolate(this.onlyIds(), { plan: this.only !== 'panels' }); }
            else if (t.matches('[data-demo]')) { this.demo = t.checked; pref('demo', String(t.checked)); this.update(); }
            else if (t.matches('[data-click]')) this.setRecordOnClick(t.checked);
            else if (t.matches('[data-date]')) { this.date = t.value || localToday(); this.renderScanHead(); }
            else if (t.matches('[data-name]')) { try { localStorage.setItem('cas-panel-name', t.value.trim()); } catch { /* storage blocked */ } }
            else if (t.matches('[data-status-filter]')) { this.filter.status = t.value; this.renderBody(); }
            else if (t.matches('[data-metric]')) this.setMetric(t.dataset.metric, t.checked);
            else if (t.matches('[data-import]')) { const f = t.files[0]; t.value = ''; if (f) this.importRevitFile(f); }
        }, on);
        p.addEventListener('input', (e) => {
            if (!e.target.matches('[data-fq]')) return;
            this.filter.q = e.target.value;
            clearTimeout(this.qTimer);
            this.qTimer = setTimeout(() => this.filtersChanged(), 250);
        }, on);
    }

    render() {
        const every = [...this.byKey.values()], shops = every.filter(p => p.shop).length, framed = every.filter(p => p.framed).length;
        this.panel.innerHTML = `<div class="demo-panel pt">
            <div class="pt-head">
                <span class="pt-logo" aria-hidden="true"></span>
                <div class="pt-titles"><b>Panel Tracker</b><span>${escapeHtml(this.project)} · ${new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
                <button class="pt-switch" data-act="switch" title="Switch to Install Progress (Demo 3) on the same model and view">⇄ Install Progress</button>
            </div>
            <section class="pt-metrics" data-metrics></section>
            <div class="pt-sub">
                <label class="pt-you" title="Saved with each step you record (and on the panel pages)">You <input data-name placeholder="Your name" value="${escapeHtml(this.you)}"></label>
                <span class="pt-seg" role="radiogroup" aria-label="Panels">
                    <label class="${this.source === 'walls' ? 'on' : ''}" title="Every framed wall as a panel, numbered P<floor>-<001> (a concept)"><input type="radio" name="pt-src" value="walls" ${this.source === 'walls' ? 'checked' : ''}>Framed walls <b>${framed.toLocaleString()}</b></label>
                    ${shops ? `<label class="${this.source === 'shops' ? 'on' : ''}" title="Only the walls with a shop drawing (Demo 6)"><input type="radio" name="pt-src" value="shops" ${this.source === 'shops' ? 'checked' : ''}>Shop drawing panels <b>${shops}</b></label>` : ''}
                </span>
                <label class="pt-check" title="${escapeHtml(`Made-up progress for the concept: ${this.complete} complete, the floors under it nearly done, each floor over it further behind with its panels split over the steps. Never saved; what you record wins over it. Untick: only what is recorded, framing complete also from Install Progress.`)}"><input type="checkbox" data-demo ${this.demo ? 'checked' : ''}>Demo data</label>
            </div>
            <section class="pt-slicers">
                <div class="pt-search"><span aria-hidden="true">⌕</span><input type="search" data-fq placeholder="Search panels: number, wall type, floor, scope…" value="${escapeHtml(this.filter.q)}" aria-label="Search panels">
                    <span class="pt-fcount" data-fcount></span><button class="link" data-act="clear-filters" hidden title="Every panel again">Clear filters</button></div>
                <div data-facets></div>
            </section>
            <div class="pt-pipe" data-pipe></div>
            <div class="pt-tabs" role="tablist">${Object.entries(TABS).map(([k, l]) => `<button role="tab" data-act="tab" data-v="${k}" class="${k === this.tab ? 'on' : ''}">${l}</button>`).join('')}</div>
            <div data-body></div>
        </div>`;
        this.renderSlicers();
        this.renderMetrics();
        this.renderPipeline();
        this.renderBody();
        this.update({ panelToo: false });
    }

    setTab(tab) {
        this.tab = tab;
        this.panel.querySelectorAll('.pt-tabs [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === tab));
        this.renderBody();
    }

    // Everything that shows the panels' steps, after a change.
    update({ panelToo = true } = {}) {
        if (panelToo) { this.renderMetrics(); this.renderPipeline(); this.renderCard(); this.renderRecent(); if (this.tab === 'list') this.renderList(); }
        this.show();
        this.drawLegend();
    }

    // The five steps: how many panels reached each, the one being recorded outlined. Click a step to record it.
    renderPipeline() {
        const el = this.panel.querySelector('[data-pipe]');
        if (!el) return;
        const list = this.shown, c = counts(list, p => this.recordOf(p), { today: this.today, startOf: p => this.startOf(p) });
        const pct = (n) => (c.total ? Math.round((n / c.total) * 100) : 0);
        el.innerHTML = STAGES.map((s, i) => `<button class="pt-step ${s.key === this.stage ? 'sel' : ''}" style="--c:${s.color}" data-act="stage" data-v="${s.key}"
                title="${escapeHtml(`${s.name}: ${c.reached[i]} of ${c.total} panels (${c.at[i]} at this step now). Click to record this step.`)}">
                <span class="pt-name">${escapeHtml(s.name)}</span>
                <b>${c.reached[i].toLocaleString()}</b><span class="pt-of">${pct(c.reached[i])}%</span><i class="pt-bar"><b style="width:${pct(c.reached[i])}%"></b></i></button>`).join('')
            + `<div class="pt-pipe-foot"><span>${escapeHtml(this.filterSummary)}: ${c.total.toLocaleString()} panels · ${c.none.toLocaleString()} not started</span>
                ${c.late ? `<button class="pt-late ${this.only === 'late' ? 'on' : ''}" data-act="only" data-v="late" title="Not on site yet, and their floor's framing has started (the schedule): show only them">⚠ ${c.late} late</button>` : ''}
                <span class="muted">${this.demo ? `demo data · ${escapeHtml(this.complete)} complete` : ''}</span></div>`;
    }

    renderBody() {
        const el = this.panel.querySelector('[data-body]');
        if (!el) return;
        if (this.tab === 'track') {
            el.innerHTML = `<div class="pt-track"><div>
                <section class="pt-scan" data-scanbox>
                    <div class="pt-rec" data-scan-head></div>
                    <form class="pt-scanrow" data-scan autocomplete="off">
                        <input data-scan-input type="text" list="pt-marks" placeholder="Scan a QR code or type a mark" aria-label="Scan or type a panel mark">
                        <button class="pt-go">Record</button>
                        <button type="button" class="pt-cam" data-act="camera" title="Scan QR codes with the camera">📷 Scan</button>
                    </form>
                    <datalist id="pt-marks">${this.panels.slice(0, 3000).map(p => `<option value="${escapeHtml(p.mark)}">`).join('')}</datalist>
                    <label class="pt-check"><input type="checkbox" data-click ${this.recordOnClick ? 'checked' : ''}>Record by clicking walls in 3D or on the plan</label>
                    <div class="pt-toast" data-toast hidden></div>
                </section>
                <div data-card></div></div>
                <section class="pt-recent"><h3>Recently recorded</h3><div data-recent></div></section></div>`;
            this.renderScanHead();
            this.renderCard();
            this.renderRecent();
        } else if (this.tab === 'list') {
            el.innerHTML = `<div class="pt-filters">
                    <select data-status-filter aria-label="Step">${[['', 'Every step'], [NOT_STARTED.key, NOT_STARTED.name], ...STAGES.map(s => [s.key, `At: ${s.name}`]), ['late', 'Late']].map(([k, l]) => `<option value="${k}" ${k === this.filter.status ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
                    <span class="muted" data-count></span>
                    <span class="pt-grow"></span><button data-act="xlsx" title="The list as an Excel workbook (and the log of records)">Excel</button><button data-act="csv">CSV</button>
                </div><div data-list></div>`;
            this.renderList();
        } else if (this.tab === 'labels') {
            const list = this.shown;
            el.innerHTML = `<section class="pt-info"><h3>QR labels</h3>
                <p>A label per panel: its QR code, panel number, floor and wall type. The QR code holds the panel number; for a panel with a shop drawing,
                    its panel page link (the same as on the sheet), so any phone camera opens the page to record a step. Scan any label here (camera or
                    handheld scanner) to record a step.</p>
                <p><button data-act="print" data-v="large" title="2 x 4 in labels, 10 per letter page (e.g. Avery 5163): a 1.8 in QR code, read from a few feet away">Print ${list.length.toLocaleString()} large labels</button>
                    <button class="secondary" data-act="print" data-v="small" title="1 x 2 5/8 in labels, 30 per letter page (e.g. Avery 5160)">Small labels</button>
                    <span class="muted">${escapeHtml(this.filterSummary)} (the slicers above) · large: 2 x 5, small: 3 x 10 per letter page</span></p>
                <div class="pt-labels">${list.slice(0, 6).map(p => this.labelHtml(p)).join('')}</div>${list.length > 6 ? `<p class="muted">… and ${list.length - 6} more.</p>` : ''}</section>`;
        } else {
            el.innerHTML = `<section class="pt-info"><h3>Revit: pull the status, report back</h3>
                <p><b>Pull into Revit.</b> One row per panel by its wall's Revit <b>UniqueId</b>: mark, level, status and the date of each step.
                    For a CAS BIM Tools command (planned) to read onto the panels in the model.</p>
                <p><button data-act="revit">Export for Revit (CSV)</button></p>
                <p><b>Report back from Revit.</b> The same columns (CSV, or JSON rows), from Revit or a spreadsheet: each step the tracker does not have
                    yet is recorded (from Revit); steps recorded here are kept. Rows match by UniqueId, else by mark.</p>
                <p><label class="pt-file">Import a report (CSV or JSON)<input type="file" data-import accept=".csv,.json,.txt" hidden></label></p>
                <p class="muted">Columns: ${['UniqueId', 'Mark', 'Level', 'Status', ...STAGES.map(s => s.name), 'Updated'].map(escapeHtml).join(' · ')}. Dates as YYYY-MM-DD.</p>
                ${this.tracker.revit ? `<p class="muted">Last report: ${escapeHtml(this.tracker.revit.file)} · ${new Date(this.tracker.revit.at).toLocaleString()} · ${this.tracker.revit.steps} steps</p>` : ''}</section>`;
        }
    }

    renderScanHead() {
        const el = this.panel.querySelector('[data-scan-head]');
        if (!el) return;
        const s = STAGES[stageIndex(this.stage)];
        this.panel.querySelector('[data-scanbox]').style.setProperty('--c', s.color);
        el.innerHTML = `<span class="pt-dot"></span>Recording <b>${escapeHtml(s.done)}</b>
            <label title="The date recorded (back-date a step that was not scanned on the day)">on <input type="date" data-date value="${this.date}" max="${localToday()}"></label>
            <span class="muted">· pick another step above</span>`;
    }

    toast(html, kind = 'info', stay = false) {
        const el = this.panel.querySelector('[data-toast]');
        if (!el) return;
        el.hidden = false;
        el.className = `pt-toast ${kind}`;
        el.innerHTML = html;
        clearTimeout(this.toastTimer);
        if (!stay) this.toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
    }

    // The picked panel: its steps with who recorded each and when; record or undo a step from here.
    renderCard() {
        const el = this.panel.querySelector('[data-card]');
        if (!el) return;
        const p = this.picked && this.byKey.get(this.picked);
        if (!p) { el.innerHTML = '<p class="muted pt-hint">Pick a panel (a wall in 3D or on the plan, a row, a scan) to see its steps.</p>'; return; }
        const rec = this.recordOf(p), at = statusOf(rec), late = this.late(p), real = this.tracker.panels[p.key] || {};
        const urn = location.hash.slice(1);
        el.innerHTML = `<section class="pt-card" style="--c:${statusFor(at).color}">
            <div class="pt-card-head"><b>${escapeHtml(p.mark)}</b><span class="pt-chip">${escapeHtml(statusFor(at).name)}</span>${late ? '<span class="pt-chip late">Late</span>' : ''}
                <button class="pt-x" data-act="close" title="Close">×</button></div>
            <div class="muted">${escapeHtml(p.level)} · ${escapeHtml(p.wallType)}${this.startOf(p) ? ` · framing from ${day(this.startOf(p))}` : ''}</div>
            <dl class="pt-facts">${this.factsOf(p).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>
            <ol class="pt-steps">${STAGES.map((s, i) => {
                const r = rec[s.key], state = r ? 'done' : i < at ? 'skipped' : i === at + 1 ? 'next' : 'todo';
                const who = r ? (r.via === 'demo' ? `${day(r.date)} · demo history` : [day(r.date), r.by, VIA[r.via] || r.via].filter(Boolean).join(' · ')) : state === 'skipped' ? 'not recorded' : '';
                return `<li class="${state}" style="--s:${s.color}"><i></i><span><b>${escapeHtml(s.name)}</b><em>${escapeHtml(who)}</em></span>
                    ${real[s.key] ? `<button class="link" data-act="undo" data-v="${escapeHtml(p.key)}|${s.key}" title="Take this step back off">Undo</button>`
                        : !r ? `<button class="pt-mini" data-act="step" data-v="${escapeHtml(p.key)}|${s.key}" title="Record ${escapeHtml(s.name.toLowerCase())} ${day(this.date)}">Record</button>` : ''}</li>`;
            }).join('')}</ol>
            ${this.install.has(p.key) ? `<p class="muted">Install Progress: ${escapeHtml(this.install.get(p.key))}</p>` : ''}
            <div class="pt-card-acts">${p.shop ? `<a href="panel.html?p=${encodeURIComponent(p.key)}" target="_blank" rel="noopener">Shop drawing ${escapeHtml(p.alt || '')} ↗</a>`
                : `<a href="index.html?demo=06-shop-drawings&layout=split&panel=${encodeURIComponent(p.key)}${urn ? `#${urn}` : ''}" target="_blank" rel="noopener">Draw its shop drawing ↗</a>`}
                ${p.dbId ? `<button class="link" data-act="zoom" data-v="${escapeHtml(p.key)}">Zoom to it</button>` : '<span class="muted">not in this model</span>'}</div>
            ${reviztoButton('Raise in Revizto', `data-act="rz-panel" data-v="${escapeHtml(p.key)}"`)}
        </section>`;
    }

    renderRecent() {
        const el = this.panel.querySelector('[data-recent]');
        if (!el) return;
        const log = this.tracker.log.slice(0, 25);
        el.innerHTML = log.length ? `<ul class="pt-log">${log.map(e => {
            const s = STAGES[stageIndex(e.stage)], p = this.byKey.get(e.key);
            return `<li style="--s:${s?.color}"><i></i><button class="link" data-act="pick" data-v="${escapeHtml(e.key)}" ${p ? '' : 'disabled title="Not in this panel list"'}>${escapeHtml(p?.mark || e.key.slice(-8))}</button>
                <span>${escapeHtml(s?.name || e.stage)}</span><em>${day(e.date)}${e.by ? ` · ${escapeHtml(e.by)}` : ''} · ${escapeHtml(VIA[e.via] || e.via)}</em>
                <button class="pt-x" data-act="undo" data-v="${escapeHtml(e.key)}|${e.stage}" title="Undo">×</button></li>`;
        }).join('')}</ul>` : '<p class="muted">Nothing recorded yet on this model. Scan a QR code, type a mark, or tick "Record by clicking walls".</p>';
    }

    // The list: grouped by floor (build order), each step's date; a floor's framing start, and its panels by step.
    filtered() {
        const st = this.filter.status;
        return st ? this.shown.filter(p => (st === 'late' ? this.late(p) : this.statusKey(p) === st)) : this.shown;
    }

    renderList() {
        const el = this.panel.querySelector('[data-list]');
        if (!el) return;
        const list = this.filtered(), groups = new Map();
        for (const p of list) { if (!groups.has(p.level)) groups.set(p.level, []); groups.get(p.level).push(p); }
        this.panel.querySelector('[data-count]').textContent = `${list.length.toLocaleString()} of ${this.shown.length.toLocaleString()}`;
        const capped = list.length > 600; // every framed wall: the first 600 rows (export has them all)
        let left = 600;
        el.innerHTML = `<table class="pt-list"><thead><tr><th>Mark</th><th>Step</th>${STAGES.map(s => `<th title="${escapeHtml(s.name)}"><i style="background:${s.color}"></i>${escapeHtml(s.short)}</th>`).join('')}</tr></thead>
            ${[...groups].map(([level, ps]) => {
                if (left <= 0) return '';
                const f = this.floors[level], bar = STAGES.map((s, i) => { const n = ps.filter(p => statusOf(this.recordOf(p)) === i).length; return n ? `<span style="flex:${n};background:${s.color}"></span>` : ''; }).join('');
                const rows = ps.slice(0, left);
                left -= rows.length;
                return `<tbody><tr class="pt-group"><td colspan="${STAGES.length + 2}"><b>${escapeHtml(level)}</b> <span class="muted">${ps.length} panels${f?.planned ? ` · framing from ${day(f.start)}` : ''}</span>
                    <span class="pt-gbar">${bar}</span></td></tr>
                ${rows.map(p => {
                    const rec = this.recordOf(p), i = statusOf(rec), late = this.late(p);
                    return `<tr data-key="${escapeHtml(p.key)}" class="${p.key === this.picked ? 'hi' : ''}"><td>${escapeHtml(p.mark)}</td>
                        <td><span class="pt-chip sm" style="--c:${statusFor(i).color}">${escapeHtml(statusFor(i).short)}</span>${late ? '<span class="pt-chip sm late">Late</span>' : ''}</td>
                        ${STAGES.map(s => `<td class="${rec[s.key]?.via === 'demo' ? 'demo' : ''}" title="${escapeHtml(rec[s.key] ? [day(rec[s.key].date), rec[s.key].via === 'demo' ? 'demo history' : rec[s.key].by, rec[s.key].via === 'demo' ? '' : VIA[rec[s.key].via]].filter(Boolean).join(' · ') : '')}">${dayMonth(rec[s.key]?.date)}</td>`).join('')}</tr>`;
                }).join('')}</tbody>`;
            }).join('')}</table>${capped ? `<p class="muted">The first 600 rows; slice, search or export for all ${list.length.toLocaleString()}.</p>` : ''}
            ${list.length ? '' : '<p class="muted">No panel matches.</p>'}`;
    }

    // --- 3D and plan: the walls in the color of their step ---------------------------------------------------------

    show() {
        const colors = new Map(), shown = this.shown, keys = this.shownCache.keys;
        for (const p of shown) if (p.dbId) colors.set(p.dbId, this.colorOf(p));
        this.views.setColors(colors);
        this.views.setPlanLabels((id) => { const p = this.byDb.get(id); return p && keys.has(p.key) ? { text: p.mark, color: this.colorOf(p) } : null; });
        if (this.only) this.views.isolate(this.onlyIds(), { fit: false, plan: this.only !== 'panels' });
        this.bar?.refresh();
    }

    onlyIds() {
        const keep = this.only === 'panels' ? () => true : this.only === 'late' ? p => this.late(p) : p => this.statusKey(p) === this.only;
        return this.shown.filter(p => p.dbId && keep(p)).map(p => p.dbId);
    }

    showOnly(key) {
        const was = this.only;
        this.only = key;
        if (key) {
            const ids = this.onlyIds();
            if (!ids.length) { this.only = was; this.toast('No panel there right now.', 'info'); }
            else this.views.isolate(ids, { plan: key !== 'panels' });
        }
        if (!this.only) { this.views.showAll(); this.show(); }
        this.renderPipeline();
        this.drawLegend();
        this.bar?.refresh();
    }

    // The legend over the 3D view: each step's panels (in view), click one to show only them.
    drawLegend() {
        if (!this.panels) return;
        if (!this.legend) {
            this.legend = document.createElement('div');
            this.legend.className = 'pt-legend';
            document.getElementById('preview').appendChild(this.legend);
            this.legend.addEventListener('click', (e) => {
                const scope = e.target.closest('[data-view-scope]')?.dataset.viewScope;
                if (scope) { this.setViewScope(scope); return; }
                const k = e.target.closest('[data-only]')?.dataset.only;
                if (k !== undefined) this.showOnly(!k ? null : this.only === k && k !== 'panels' ? 'panels' : k);
            });
        }
        const c = counts(this.shown, p => this.recordOf(p), { today: this.today, startOf: p => this.startOf(p) });
        const chip = (key, name, color, n) => `<button data-only="${key}" class="${this.only === key ? 'on' : ''}" ${n ? '' : 'disabled'}><i style="background:${color}"></i>${escapeHtml(name)} <b>${n}</b></button>`;
        this.legend.innerHTML = `<b class="pt-lt" title="${escapeHtml(this.filterSummary)}">Panels · ${escapeHtml(this.filterSummary)}</b>`
            + chip('none', NOT_STARTED.name, NOT_STARTED.color, c.none) + STAGES.map((s, i) => chip(s.key, s.name, s.color, c.at[i])).join('')
            + (c.late ? chip('late', 'Late', LATE, c.late) : '')
            + `<span class="pt-lv"><button data-only="panels" class="${this.only === 'panels' ? 'on' : ''}" title="The panels, the rest of the model ghosted">Panels only</button><button data-only="" class="${this.only ? '' : 'on'}" title="Every wall, the panels in color">Every wall</button></span>
            <span class="pt-lv pt-pickscope"><em>3D view</em><button data-view-scope="level" class="${this.viewScope === 'level' ? 'on' : ''}" title="The floor of the plan open in 2D, cut to its walls and framed in full (a picked panel: its floor)">This floor</button><button data-view-scope="all" class="${this.viewScope === 'all' ? 'on' : ''}" title="Show all levels: the whole building">All levels</button></span>`;
    }

    // A panel picked (a wall in 3D or on the plan, a row, a scan): its card; per level, its floor cut in 3D; select: its
    // wall selected too (shown, views.zoomToPick moving the view only as much as needed).
    async pick(key, { select = false } = {}) {
        this.picked = key;
        this.renderCard();
        this.panel.querySelectorAll('tr[data-key]').forEach(r => r.classList.toggle('hi', r.dataset.key === key));
        const p = key && this.byKey.get(key);
        if (!p) return;
        await this.applyPickScope(p);
        if (select && p.dbId && this.picked === key) {
            this.selecting = true;
            try { this.views.select([p.dbId]); } finally { this.selecting = false; }
            this.lastSel = [p.dbId];
        }
    }

    zoomTo(key) {
        const p = this.byKey.get(key);
        if (!p?.dbId) return;
        if (this.only && this.only !== 'panels') this.showOnly('panels');
        this.pick(key).then(() => {
            this.selecting = true;
            try { this.views.select([p.dbId]); } finally { this.selecting = false; }
            this.lastSel = [p.dbId];
            this.views.zoomToPick([p.dbId], { force: true }); // asked for: zoomed to it
        });
    }

    // --- Camera scanning ---------------------------------------------------------------------------------------------
    // Where the browser reads QR codes (BarcodeDetector: Chrome and Edge on Android, macOS, ChromeOS), the camera scans
    // panel after panel; elsewhere, the phone's own camera on the shop drawing's QR code opens the panel page.

    async openCamera() {
        const can = 'BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats().catch(() => [])).includes('qr_code');
        if (!can || !navigator.mediaDevices?.getUserMedia) {
            this.toast('This browser cannot read QR codes from the camera (Chrome or Edge on an Android phone or a Mac can). Here: a handheld scanner types into the box. '
                + 'On a phone: point its camera at the QR code on the shop drawing or label; it opens the panel page, where the step can be recorded.', 'warn', true);
            return;
        }
        this.closeCamera();
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        } catch (err) { this.toast(`No camera: ${escapeHtml(err.message)}`, 'bad', true); return; }
        const box = this.cam = document.createElement('div');
        box.className = 'pt-camera';
        const s = STAGES[stageIndex(this.stage)];
        box.innerHTML = `<div class="pt-cam-card" style="--c:${s.color}"><div class="pt-cam-head"><span class="pt-dot"></span>Recording <b>${escapeHtml(s.done)}</b><button data-cam-close>Done</button></div>
            <video playsinline muted></video><p data-cam-msg>Point the camera at a panel's QR code.</p></div>`;
        document.body.appendChild(box);
        box.querySelector('[data-cam-close]').onclick = () => this.closeCamera();
        const video = box.querySelector('video');
        video.srcObject = this.stream;
        await video.play().catch(() => {});
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const seen = new Map(); // a code read again within 4 s is the same scan
        const tick = async () => {
            if (this.cam !== box) return;
            try {
                for (const code of await detector.detect(video)) {
                    const t = seen.get(code.rawValue);
                    if (t && performance.now() - t < 4000) continue;
                    seen.set(code.rawValue, performance.now());
                    const before = this.tracker.log.length, ok = this.scan(code.rawValue, 'camera');
                    const msg = box.querySelector('[data-cam-msg]');
                    msg.innerHTML = ok && this.tracker.log.length > before ? `✓ ${escapeHtml(this.byKey.get(this.tracker.log[0].key)?.mark || '')} recorded` : this.panel.querySelector('[data-toast]')?.innerHTML || 'Not a panel here.';
                }
            } catch { /* frame not ready */ }
            this.camTimer = setTimeout(tick, 250);
        };
        tick();
    }

    closeCamera() {
        clearTimeout(this.camTimer);
        this.stream?.getTracks().forEach(t => t.stop());
        this.stream = null;
        this.cam?.remove();
        this.cam = null;
    }

    // --- Exports, labels, Revit -----------------------------------------------------------------------------------

    download(name, data, type) {
        const url = URL.createObjectURL(new Blob([data], { type }));
        Object.assign(document.createElement('a'), { href: url, download: name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    fileName(what, ext) {
        return `${this.project.replace(/[^\w-]+/g, '-')}-${what}-${localToday()}.${ext}`;
    }

    exportList(kind) {
        const rows = [['Mark', 'Level', 'Wall type', 'Scope', 'Prefix', 'Length (ft)', 'Height (ft)', 'Area (SF)', 'Fire rating', ...this.params, 'Step', 'Late', ...STAGES.map(s => s.name), 'Last recorded by', 'UniqueId'],
            ...this.filtered().map(p => {
                const rec = this.recordOf(p), last = STAGES.map(s => rec[s.key]).filter(Boolean).pop(), num = (v) => (Number(v) > 0 ? Math.round(v * 100) / 100 : '');
                return [p.mark, p.level, p.wallType, scopeName(p.scope), p.prefix, num(p.lengthFt), num(p.heightFt), num(p.areaSf), p.fire || '', ...this.params.map(n => this.paramOf(p, n) ?? ''),
                    statusFor(statusOf(rec)).name, this.late(p) ? 'Late' : '', ...STAGES.map(s => rec[s.key]?.date || ''), last?.by || '', p.key];
            })];
        if (kind === 'csv') { this.download(this.fileName('panels', 'csv'), csvText(rows), 'text/csv'); return; }
        const log = [['Date', 'Mark', 'Step', 'By', 'How', 'Recorded at', 'UniqueId'],
            ...this.tracker.log.map(e => [e.date, this.byKey.get(e.key)?.mark || '', STAGES[stageIndex(e.stage)]?.name || e.stage, e.by || '', VIA[e.via] || e.via, e.at, e.key])];
        this.download(this.fileName('panels', 'xlsx'), xlsxBytes([{ name: 'Panels', rows }, { name: 'Log', rows: log }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }

    exportRevit() {
        this.download(this.fileName('panel-status-for-revit', 'csv'), csvText(revitRows(this.panels, p => this.recordOf(p))), 'text/csv');
    }

    async importRevitFile(file) {
        try {
            const rows = readRevitRows(await file.text());
            if (!rows.length) { this.toast(`${escapeHtml(file.name)}: no rows with a UniqueId or a mark.`, 'bad', true); this.renderBody(); return; }
            const res = importRevit(this.tracker, rows, this.panels, { by: 'Revit' });
            this.tracker.revit = { file: file.name, at: new Date().toISOString(), steps: res.steps };
            this.save();
            this.update();
            this.renderBody();
            alert(`${file.name}: ${res.steps} steps recorded on ${res.panels} panels.${res.unknown.length ? ` ${res.unknown.length} rows match no panel here (${res.unknown.slice(0, 5).join(', ')}${res.unknown.length > 5 ? '…' : ''}).` : ''}`);
        } catch (err) {
            alert(`Could not read ${file.name}: ${err.message}`);
        }
    }

    // What a label's QR code holds: a shop drawing panel's short page link (as on its sheet), else the panel number.
    labelText(p) {
        return p.shop ? shortLink(CONFIG.publicUrl || new URL('.', location.href).href, p.key) : p.mark;
    }

    labelHtml(p) {
        let svg = '';
        try {
            const qr = qrEncode(this.labelText(p)), n = qr.size + 8;
            svg = `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/>${qrRects(qr).map(r => `<rect x="${r.x + 4}" y="${r.y + 4}" width="${r.w}" height="${r.h}"/>`).join('')}</svg>`;
        } catch { /* too long for a QR code */ }
        return `<div class="pt-label">${svg}<div><b>${escapeHtml(p.mark)}</b><span>${escapeHtml(p.level)}${p.alt ? ` · shop ${escapeHtml(p.alt)}` : ''}</span><em>${escapeHtml(String(p.wallType).replace(/^_/, '').slice(0, 60))}</em><small>${escapeHtml(this.project)}</small></div></div>`;
    }

    // large: 2 x 4 in labels, 2 x 5 per letter page, a 1.8 in QR code; else 1 x 2 5/8 in, 3 x 10 per page.
    printLabels(large = false) {
        const list = this.shown;
        const w = window.open('', '_blank');
        if (!w) { alert('Allow pop-ups for this site to print the labels.'); return; }
        w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Panel labels · ${escapeHtml(this.project)}</title><style>
            @page { size: letter; margin: 0.5in ${large ? '0.156in' : '0.19in'}; } body { margin: 0; font: 9pt system-ui, sans-serif; }
            .sheet { display: grid; grid-template-columns: repeat(${large ? '2, 4in' : '3, 2.625in'}); grid-auto-rows: ${large ? '2in' : '1in'}; column-gap: ${large ? '0.188in' : '0.125in'}; }
            .pt-label { display: flex; gap: ${large ? '0.12in' : '0.06in'}; align-items: center; overflow: hidden; padding: 0.04in 0.08in; box-sizing: border-box; break-inside: avoid; }
            .pt-label svg { width: ${large ? '1.8in' : '0.9in'}; height: ${large ? '1.8in' : '0.9in'}; flex: none; } .pt-label div { display: flex; flex-direction: column; min-width: 0; }
            .pt-label b { font-size: ${large ? '22pt' : '12pt'}; } .pt-label span { font-size: ${large ? '11pt' : '9pt'}; } .pt-label em { font-style: normal; font-size: ${large ? '9pt' : '7pt'}; color: #333; } .pt-label small { font-size: ${large ? '8pt' : '6.5pt'}; color: #666; }
            @media screen { body { padding: 1em; } .pt-label { outline: 1px dashed #ccc; } }</style></head>
            <body><div class="sheet">${list.map(p => this.labelHtml(p)).join('')}</div><script>window.onload = () => window.print();<\/script></body></html>`);
        w.document.close();
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, PanelTrackerExtension);
