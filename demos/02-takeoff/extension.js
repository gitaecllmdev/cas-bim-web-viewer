// Demo 02: Quantity Takeoff Viewer: framing (studs, track), board and finish, plus gross wall quantities.
// Spec and acceptance criteria: demos/02-takeoff/README.md. Math: ./calc.mjs; assemblies: samples/takeoff-rules.json.
// Colors and isolation go through core/client/views.js (3D + 2D plan); the header Level picker scopes everything.
// Dashboard tutorial (aggregating properties): https://get-started.aps.autodesk.com/tutorials/dashboard/
// Model getBulkProperties: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Model/
// Viewer3D isolate, fitToView: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
import { loadPropertyMap, getWallData, getBulkProperties, propValue, onModelReady, unitLabel, downloadCsv, escapeHtml, fetchJson, loadState, saveState, paletteColor } from '../../helpers.js';
import { takeoff, assemblyFor, fmtInches, ROLES } from './calc.mjs';
import { fmtFtIn } from '../common/framing.mjs';
import { loadScans, scanWalls } from '../common/wallscan.js';
import { CONFIG } from '../../config.js';

const EXTENSION_ID = 'Drywall.Takeoff';
const STATE_NAME = 'takeoff';
// The walls as read from the model, for the takeoff report page (core/client/takeoff.html), which runs the same
// math without the viewer. Written on the local server only; the review site is built with it.
const SNAPSHOT_STATE = 'takeoff-snapshot';
const NOT_SET = 'Not set';
const DISCLAIMER = 'Estimate from model geometry and the assemblies below, framed with the same layout as the shop drawings (studs cut 1/16" short, lengths rounded down to 1/8"). Jambs, head and sill track and cripples are counted for walls whose openings have been scanned; stud gauge per the framing engineer. Check before ordering.';
const ORDER_MODES = [['exact', 'Exact cut (1/8")'], ['half', 'Round up to 1/2"'], ['inch', 'Round up to 1"'], ['stock', 'Stock lengths (8\'-20\')']];
const GAUGES = [[18, '18 mil (25 ga)'], [30, '30 mil (20 ga EQ)'], [33, '33 mil (20 ga)'], [43, '43 mil (18 ga)'], [54, '54 mil (16 ga)']];
const GROSS_NOTE = 'Gross quantities from model properties. Not net board counts; openings, layers and waste not included.';
const TABS = { materials: 'Materials', types: 'By wall type', assemblies: 'Assemblies', gross: 'Gross' };
const STUDS = [0.875, 1.625, 2.5, 3.625, 4, 6, 8];
const EXCLUDED_COLOR = '#d9d9d9';
const REVIEW_COLOR = '#d7263d';
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

class TakeoffExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.panel = this.options.panel;
        this.panel.classList.add('wide');
        this.tab = 'materials';
        this.showLevels = true;
        this.expanded = new Set(); // material items showing their cut-length schedule
        this.panel.innerHTML = `<div class="demo-panel"><h2>Takeoff</h2><p class="muted" data-status>Waiting for a model…</p></div>`;
        this.stops = [
            onModelReady(this.viewer, (model) => this.init(model)),
            this.views.on('level', () => { if (this.walls) this.render(); }),
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
            this.render();
            this.saveSnapshot(model);
        } catch (err) {
            this.panel.querySelector('[data-status]').textContent = `Could not build the takeoff: ${err.message || err}`;
        }
    }

    get level() {
        return this.views.level?.name || '';
    }

    get scope() {
        return this.level ? this.walls.filter(w => (w.level ?? NOT_SET) === this.level) : this.walls;
    }

    render() {
        this.result = takeoff(this.scope, this.rules, this.overrides, this.settings);
        this.refreshSelection();
        const warn = this.missing.length
            ? `<p class="warn">No wall has ${this.missing.map(k => `"${escapeHtml(this.map[k])}"`).join(', ')}. Fix the name in samples/property-map.json.</p>` : '';
        this.panel.innerHTML = `<div class="demo-panel"><h2>Takeoff: framing, board &amp; finish</h2>
            <p class="muted">${this.level ? `<b>${escapeHtml(this.level)}</b>` : 'All levels'}: ${this.scope.length} walls,
                ${this.result.framedTypes} framed wall types. Change the level in the header.</p>${warn}
            ${this.scanHtml()}
            <div class="row">${Object.entries(TABS).map(([k, label]) => `<button data-tab="${k}" class="${k === this.tab ? 'active' : ''}">${label}</button>`).join('')}
                <button data-csv>Export CSV</button></div>
            <div data-body></div></div>`;
        this.panel.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.tab; this.render(); });
        this.panel.querySelector('[data-csv]').onclick = () => this.exportCsv();
        this.panel.querySelector('[data-scan]')?.addEventListener('click', () => this.scanOpenings());
        this.panel.querySelector('[data-scan-stop]')?.addEventListener('click', () => { this.cancelScan = true; });
        const body = this.panel.querySelector('[data-body]');
        this.assignDepthColors();
        ({ materials: () => this.renderMaterials(body), types: () => this.renderTypes(body), assemblies: () => this.renderAssemblies(body), gross: () => this.renderGross(body) })[this.tab]();
        this.colorWalls();
    }

    // Openings are read from the wall geometry (about 1 s per wall), once per wall; Demo 6 saves its scans here too.
    scanHtml() {
        const { framedWalls, scannedWalls } = this.result;
        if (this.scanning) {
            return `<div class="row"><span>Scanning openings: <b>${this.scanning.done}</b> of ${this.scanning.total} walls…</span>
                <div class="bar" style="flex:1;min-width:6em"><span style="width:${(this.scanning.done / this.scanning.total) * 100}%"></span></div>
                <button data-scan-stop>Stop</button></div>`;
        }
        const left = framedWalls - scannedWalls;
        const where = this.level ? `on ${escapeHtml(this.level)}` : 'on all levels';
        return `<div class="row"><span class="${left ? 'warn' : 'muted'}">Openings scanned for ${scannedWalls} of ${framedWalls} framed walls ${where}.
            ${left ? 'Jambs, headers, sills and cripples are counted only for scanned walls.' : 'All openings counted.'}</span>
            ${left ? `<button data-scan>Scan openings (${left} walls, about ${Math.max(1, Math.round(left / 30))} min; keep this tab in front)</button>` : ''}</div>`;
    }

    async scanOpenings() {
        const todo = this.scope.filter(w => !w.scan && assemblyFor(w.wallType ?? NOT_SET, this.rules, this.overrides).scope === 'framed' && w.length > 0);
        if (!todo.length) return;
        if (!this.level && todo.length > 200 && !confirm(`Scan ${todo.length} walls on all levels? It takes about ${Math.round(todo.length / 30)} minutes with this tab in front; you can stop at any time and continue later.`)) return;
        this.cancelScan = false;
        this.scanning = { done: 0, total: todo.length };
        this.render();
        const tab = this.tab;
        try {
            await scanWalls(this.viewer, this.views, todo, {
                isCancelled: () => this.cancelScan,
                onProgress: (done) => {
                    this.scanning.done = done;
                    const line = this.panel.querySelector('.bar > span');
                    if (line) line.style.width = `${(done / todo.length) * 100}%`;
                    const b = this.panel.querySelector('.row b');
                    if (b) b.textContent = done;
                },
            });
        } finally {
            const scans = await loadScans();
            this.walls.forEach(w => { w.scan = scans[w.externalId] || w.scan; });
            this.scanning = null;
            this.tab = tab;
            this.render();
        }
    }

    // --- Member selection: a material line, a member mark or a board type shows its walls in 3D and on the plan ---------

    // What a selection key points at in the current result: { ids, label } or null.
    findSelection(key) {
        const r = this.result;
        const [kind, value] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
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
        this.views.isolate(this.selection ? this.selection.ids : null);
    }

    // After a new result (level, settings): the same selection, with its walls on this level; gone if it isn't here.
    refreshSelection() {
        if (!this.selection) return;
        const found = this.findSelection(this.selection.key);
        if (!found) { this.selection = null; this.views.isolate(null, { fit: false }); return; }
        const changed = found.ids.length !== this.selection.ids.length || found.ids.some((id, i) => id !== this.selection.ids[i]);
        this.selection = { key: this.selection.key, ...found };
        if (changed) this.views.isolate(found.ids);
    }

    selectionHtml() {
        const sel = this.selection;
        if (!sel) return '<p class="muted">Click a stud, track or board line to show its walls in 3D and on the plan (and open its member schedule); click a mark to show just the walls with that member.</p>';
        return `<div class="row sel-status"><span>Showing <b>${fmt(sel.ids.length)}</b> wall${sel.ids.length === 1 ? '' : 's'} with <b>${escapeHtml(sel.label)}</b> in 3D and on the plan.</span>
            <button data-clear-selection>Show all</button></div>`;
    }

    assignDepthColors() {
        const depths = [...new Set(this.result.rows.filter(r => r.asm.scope === 'framed').map(r => r.asm.studIn))].sort((a, b) => a - b);
        this.depthColors = new Map(depths.map((d, i) => [d, paletteColor(i)]));
    }

    colorOf(row) {
        return row.asm.scope === 'framed' ? this.depthColors.get(row.asm.studIn) : row.asm.scope === 'excluded' ? EXCLUDED_COLOR : REVIEW_COLOR;
    }

    // Framing tabs: walls colored by stud size in 3D and on the plan (excluded grey, unmatched red). Gross: no colors.
    colorWalls() {
        if (this.tab === 'gross') { this.views.clearColors(); return; }
        const colors = new Map();
        for (const row of this.result.rows) row.ids.forEach(id => colors.set(id, this.colorOf(row)));
        this.views.setColors(colors);
        const legend = this.panel.querySelector('[data-legend]');
        if (legend) {
            legend.innerHTML = [...this.depthColors].map(([d, c]) => `<span><span class="swatch" style="background:${c}"></span>${fmtInches(d)}</span>`).join(' ')
                + ` <span><span class="swatch" style="background:${EXCLUDED_COLOR}"></span>not in scope</span>`;
        }
    }

    legendRow() {
        return `<p class="muted">Walls colored by stud size in 3D and on the plan: <span data-legend></span></p>`;
    }

    renderMaterials(body) {
        const s = this.result.settings;
        const sheets = [['4\' x 8\'', 32], ['4\' x 10\'', 40], ['4\' x 12\'', 48]];
        const groups = groupBy(this.result.materials, m => m.group);
        body.innerHTML = `${this.legendRow()}
            <div class="row">
                <label>Gauge <select data-set="mils">${GAUGES.map(([v, l]) => `<option value="${v}" ${v === s.mils ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label>Order studs at <select data-set-text="orderLengths">${ORDER_MODES.map(([v, l]) => `<option value="${v}" ${v === s.orderLengths ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label>Walls over 20' <select data-set-text="splitTallWalls">${[['false', 'One-piece studs'], ['true', 'Split into lifts']].map(([v, l]) => `<option value="${v}" ${String(!!s.splitTallWalls) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            </div>
            <div class="row">
                <label>Studs @ <select data-set="studSpacingIn">${[12, 16, 24].map(v => `<option value="${v}" ${v === s.studSpacingIn ? 'selected' : ''}>${v}" o.c.</option>`).join('')}</select></label>
                <label>Board <select data-set="sheet">${sheets.map(([l, sf]) => `<option value="${sf}" ${sf === s.sheet.sf ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label>Waste framing <input data-set="framingWastePct" type="number" min="0" max="50" value="${s.framingWastePct}" style="width:3.5em">%</label>
                <label>board <input data-set="boardWastePct" type="number" min="0" max="50" value="${s.boardWastePct}" style="width:3.5em">%</label>
            </div>
            ${this.selectionHtml()}
            <div class="row"><span class="muted">Member schedules: every member with its mark and cut length (1/8").
                Marks: ${Object.entries(ROLES).map(([k, v]) => `<b>${k}</b> ${v}`).join(' · ')}; then the stud depth and a number, longest first (ST362-1).</span>
                <button data-expand-all>Expand all</button><button data-collapse-all>Collapse all</button></div>
            <table><thead><tr><th>Item</th><th class="num">Qty</th><th>Unit</th><th class="num"></th></tr></thead><tbody>
            ${[...groups].map(([group, items]) => `<tr class="subtotal"><td colspan="4">${group}</td></tr>`
                + items.map(m => this.materialRow(m)).join('')).join('')
            || '<tr><td colspan="4" class="muted">No framed walls in this scope.</td></tr>'}
            </tbody></table>
            ${this.result.missing ? `<p class="warn">${this.result.missing} wall(s) have no length or area and are left out.</p>` : ''}
            <p class="note">${DISCLAIMER} Finish factors: tape ${s.tapeLfPerSf} LF/SF, compound ${s.compoundLbPerSf} lb/SF, screws ${s.screwsPerSfPerLayer}/SF per layer (samples/takeoff-rules.json; set them to your standards).</p>`;
        body.querySelectorAll('[data-set]').forEach(el => el.onchange = () => {
            const key = el.dataset.set, v = Number(el.value);
            if (key === 'sheet') this.settings.sheet = sheets.map(([label, sf]) => ({ label, sf })).find(x => x.sf === v);
            else this.settings[key] = v;
            this.save();
        });
        body.querySelectorAll('[data-set-text]').forEach(el => el.onchange = () => {
            this.settings[el.dataset.setText] = el.value === 'true' ? true : el.value === 'false' ? false : el.value;
            this.save();
        });
        // A line: show its walls and open its schedule; the selected line again: close it and show everything.
        body.querySelectorAll('[data-toggle-item]').forEach(tr => tr.onclick = () => {
            const key = tr.dataset.toggleItem, sel = `item:${key}`;
            if (this.selection?.key === sel) { this.expanded.delete(key); this.select(null); } else { this.expanded.add(key); this.select(sel); }
            this.render();
        });
        body.querySelectorAll('[data-select-item]').forEach(tr => tr.onclick = () => {
            const sel = `item:${tr.dataset.selectItem}`;
            this.select(this.selection?.key === sel ? null : sel);
            this.render();
        });
        body.querySelectorAll('[data-select-mark]').forEach(tr => tr.onclick = (e) => {
            e.stopPropagation();
            const sel = `mark:${tr.dataset.selectMark}`;
            this.select(this.selection?.key === sel ? null : sel);
            this.render();
        });
        body.querySelector('[data-clear-selection]')?.addEventListener('click', () => { this.select(null); this.render(); });
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

    renderTypes(body) {
        const rows = this.result.rows;
        body.innerHTML = `${this.legendRow()}
            <table><thead><tr><th>Wall type / assembly</th><th class="num">LF</th><th class="num">Openings</th><th class="num">Studs</th><th class="num">Stud LF</th><th class="num">Track LF</th><th class="num">Board SF</th></tr></thead>
            <tbody data-rows></tbody></table><p class="note">Click a row to isolate those walls in 3D and on the plan. ${DISCLAIMER}</p>`;
        const tbody = body.querySelector('[data-rows]');
        for (const r of rows) {
            const framed = r.asm.scope === 'framed';
            const tr = document.createElement('tr');
            tr.className = `clickable ${framed ? '' : 'muted'}`;
            tr.innerHTML = `<td><span class="swatch" style="background:${this.colorOf(r)}"></span>${escapeHtml(r.typeName)} <span class="muted">(${r.count})</span>
                    <br><span class="muted">${escapeHtml(r.asm.label || '')}${framed && r.boardSf ? ` · ${escapeHtml(r.board)}` : ''}</span></td>
                <td class="num">${fmt(r.length)}</td><td class="num">${framed ? fmt(r.openings) : '–'}</td><td class="num">${framed ? fmt(r.studs) : '–'}</td><td class="num">${framed ? fmt(r.studLf) : '–'}</td><td class="num">${framed ? fmt(r.trackLf) : '–'}</td><td class="num">${framed ? fmt(r.boardSf + r.sheathingSf) : '–'}</td>`;
            tr.onclick = () => { tbody.querySelectorAll('tr').forEach(x => x.classList.toggle('selected', x === tr)); this.views.isolate(r.ids); };
            tbody.appendChild(tr);
        }
        const total = (k) => rows.filter(r => r.asm.scope === 'framed').reduce((n, r) => n + r[k], 0);
        tbody.insertAdjacentHTML('beforeend', `<tr class="total"><td>Framed walls</td><td class="num">${fmt(total('length'))}</td><td class="num">${fmt(total('openings'))}</td><td class="num">${fmt(total('studs'))}</td>
            <td class="num">${fmt(total('studLf'))}</td><td class="num">${fmt(total('trackLf'))}</td><td class="num">${fmt(total('boardSf') + total('sheathingSf'))}</td></tr>`);
    }

    // Tune the assembly of any wall type; overrides are saved and win over the rules file.
    renderAssemblies(body) {
        const rows = this.result.rows;
        const sel = (key, value, options) => `<select data-key="${key}">${options.map(([v, l]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
        const n03 = [0, 1, 2, 3].map(v => [v, v]);
        body.innerHTML = `${this.legendRow()}
            <p class="muted">Starting assemblies come from samples/takeoff-rules.json (matched on the type name). Change any type here; the takeoff updates at once. Click a name to see those walls.</p>
            <table><thead><tr><th>Wall type</th><th>Scope</th><th>Stud</th><th>Rows</th><th>Layers A / B</th><th>Sheath.</th></tr></thead><tbody data-rows></tbody></table>
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
            tr.querySelector('[data-show]').onclick = (e) => { e.preventDefault(); this.views.isolate(r.ids); };
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
        rows.push({ kind: 'total', type: this.level ? `Total, ${this.level}` : 'Grand total', level: this.level, ...totals(scope) });
        this.grossRows = rows;
        body.innerHTML = `<div class="row"><label><input type="checkbox" data-levels ${this.showLevels ? 'checked' : ''}> Level sub-totals</label>
                <button data-reset>Reset view</button></div>
            <table><thead><tr><th>Wall type / level</th><th class="num">Count</th><th class="num">Length (ft)</th><th class="num">Area (ft²)</th></tr></thead><tbody data-rows></tbody></table>
            <p class="note">${GROSS_NOTE}</p>`;
        const tbody = body.querySelector('[data-rows]');
        for (const row of rows) {
            if (row.kind === 'level' && !this.showLevels) continue;
            const tr = document.createElement('tr');
            tr.className = `clickable ${row.kind}`;
            const label = row.kind === 'level' ? `<span style="padding-left:1em">${escapeHtml(row.level)}</span>` : escapeHtml(row.type);
            const missing = row.missing ? ` <span class="warn" title="walls missing length or area">(${row.missing} missing)</span>` : '';
            tr.innerHTML = `<td>${label}</td><td class="num">${row.count}${missing}</td><td class="num">${fmt(row.length, 1)}</td><td class="num">${fmt(row.area)}</td>`;
            tr.onclick = () => { tbody.querySelectorAll('tr').forEach(r => r.classList.toggle('selected', r === tr)); this.views.isolate(row.kind === 'total' ? null : row.ids); };
            tbody.appendChild(tr);
        }
        body.querySelector('[data-levels]').onchange = (e) => { this.showLevels = e.target.checked; this.render(); };
        body.querySelector('[data-reset]').onclick = () => { this.views.showAll(); this.views.isolate(null); };
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
        const scope = this.level || 'All levels';
        const lines = [[`Takeoff: framing, board & finish (${scope})`], [], ['Group', 'Item', 'Qty', 'Unit', 'Detail'],
            ...r.materials.map(m => [m.group, m.item, m.qty, m.unit, m.extra || '']), [],
            ['Member schedule', `order: ${(ORDER_MODES.find(([v]) => v === r.settings.orderLengths) || ORDER_MODES[0])[1]}`, `openings scanned: ${r.scannedWalls} of ${r.framedWalls} framed walls`],
            ['Mark', 'Member', 'Member type', 'Cut length', 'Cut length (in)', 'Qty', 'LF', 'Order length', 'Pieces per order length', 'Pieces to order'],
            ...r.schedule.map(e => [e.mark, e.role, e.type, fmtFtIn(e.cutIn), e.cutIn, e.qty, e.lf.toFixed(1), fmtFtIn(e.orderIn), e.perPiece, e.pieces]), [],
            ['Wall type', 'Assembly', 'Scope', 'Walls', 'Length (LF)', 'Area (SF)', 'Studs', 'Track (LF)', 'Board (SF)', 'Sheathing (SF)', 'Finish (SF)', 'Board type'],
            ...r.rows.map(t => [t.typeName, t.asm.label || '', t.asm.scope, t.count, t.length.toFixed(1), t.area.toFixed(1), t.studs, t.trackLf.toFixed(1),
                t.boardSf.toFixed(1), t.sheathingSf.toFixed(1), t.finishSf.toFixed(1), t.asm.scope === 'framed' ? t.board : '']),
            [], [DISCLAIMER]];
        const suffix = this.level ? `-${this.level.replace(/[^\w-]+/g, '_')}` : '';
        downloadCsv(`takeoff${suffix}.csv`, lines);
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, TakeoffExtension);
