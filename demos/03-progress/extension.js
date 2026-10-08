// Demo 03: Install Progress Tracker, with the P6 schedule (Gantt chart and calendar) linked to the walls
// Spec and acceptance criteria: demos/03-progress/README.md
// Viewer3D (setThemingColor, getSelection, isolate, fitToView, SELECTION_CHANGED_EVENT): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Model (getBulkProperties with externalId): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Model/
// Stage colors go through core/client/views.js (3D + 2D plan); selecting walls on the plan selects them in 3D too.
// The schedule: p6.mjs reads the P6 export and links activities to levels and stages; schedule-views.js draws them.
import { loadPropertyMap, getWallData, onModelReady, loadState, saveState, escapeHtml, downloadCsv, fetchJson, modelKey, onDockChange } from '../../helpers.js';
import { readXlsx } from '../common/xlsx.mjs';
import { readSchedulePdf, renderPdfPage } from '../common/pdf-reader.mjs';
import { scheduleRows } from '../common/p6-pdf.mjs';
import {
    STAGE_NAMES, demoShift, assignDemoLevels, linkedLevelNames, levelPercents, topStage, parseDateText, decodeText, parseXer, scheduleFromXer, scheduleFromRows, parseCsv, calendarOf, linkActivities, matchLevel, matchStage,
    stageCounts, modelProgress, compare, expectedPct, finishVariance, plannedStages, scheduleSpan, ganttRows, completeGroups, fmtDay, addDays, dayMs, monthName,
    randomWallLinks, wallProgress, demoTarget,
} from './p6.mjs';
import { ganttHtml, calendarHtml, SCALES, ganttX } from './schedule-views.js';
import { AllPlans } from './all-plans.js';
import { parseKeywords, matchRows, keywordCounts, remember } from '../../p6-keywords.mjs'; // the P6 Converter's keyword search
import { DemoToolbar } from '../../toolbar.js';

// Base64 for the source PDF kept with a schedule (state is JSON).
const toBase64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = (text) => Uint8Array.from(atob(text), ch => ch.charCodeAt(0));

const EXTENSION_ID = 'Drywall.Progress';
// Saved per model: 'progress' / 'schedule' for the sample model (Snowdon, the one with a sample schedule in
// samples/urns.json), 'progress-<model>' / 'schedule-<model>' for every other model, so their walls and schedules
// never mix. <model> is a short hash of its URN.

const SAMPLE = { url: 'samples/schedule/snowdon-drywall-p6.xer', file: 'snowdon-drywall-p6.xer' };
const NOT_SET = 'Not set';
// "Not started" walls keep their normal look (no color).
const STAGES = [
    { name: 'Not started', color: null },
    { name: 'Framed', color: '#f2c14e' },
    { name: 'Boarded', color: '#4e79a7' },
    { name: 'Taped', color: '#b07aa1' },
    { name: 'Finished', color: '#59a14f' },
];
const FINISHED = 'Finished';
const TABS = { stages: 'Stages', gantt: 'Gantt', calendar: 'Calendar' };
const COLOR_MODES = { actual: 'Colors: installed', planned: 'Colors: planned on date (4D)', compare: 'Colors: installed vs plan' };
const COMPARE = { behind: { color: '#d62728', label: 'Behind the plan' }, even: { color: '#59a14f', label: 'On plan' }, ahead: { color: '#1f77b4', label: 'Ahead of the plan' } };
const OTHER = '#8c96a0'; // wall work not linked to an install stage (layout, inspections), milestones
const NOT_WALL = '#cfd5dc'; // MEP and other trades: greyed, never linked to walls
const NOT_YET = '#f4a582'; // a picked activity's walls not at its stage yet (soft coral: stands out against the faded model)
const SHOW = { all: 'All activities', walls: 'Wall work only', active: 'In progress', open: 'Not complete', linked: 'Linked to walls', behind: 'Model behind P6', critical: 'Critical (float ≤ 0)' };
// WBS groups: finished ones folded (the default, so the work in progress is near the top), all open, or all folded.
const FOLD = { done: 'Fold finished groups', none: 'Open all groups', all: 'Fold all groups' };
const localToday = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the viewer's time zone
const KW_HISTORY = 'drywall-demos:schedule-keywords'; // this browser's schedule search history
const KW_SUGGEST = ['framing', 'layout', 'drywall', 'board', 'tape', 'finish', 'insulation', 'shaftwall', 'soffit'];
const same = (x, y) => x.toLowerCase() === y.toLowerCase();

class ProgressExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.panel = this.options.panel;
        this.panel.classList.add('wide'); // room for the per-level stage pickers
        this.stages = {}; // externalId -> stage name (walls without an entry are "Not started")
        this.selected = [];
        const params = new URLSearchParams(location.search);
        this.tab = TABS[params.get('tab')] ? params.get('tab') : 'stages';
        this.colorMode = 'actual';
        // Schedule views: only the walls linked to the schedule, the floors apart (views.setLevelsApart), all floor plans.
        this.linkedOnly = false;
        this.apartOn = false;
        this.allPlans = new AllPlans(this.views);
        this.gantt = { scale: 'week', show: 'all', links: 'selected', fold: 'done', collapsed: new Set() };
        this.selectedAct = null;
        this.demoMove = true;
        try { this.demoMove = localStorage.getItem('drywall-demos:schedule-demo-shift') !== 'false'; } catch {}
        // Schedule search: keywords in use, the text being typed, any / all, and the history of keywords used.
        this.kw = { active: [], typed: '', all: false, history: [] };
        try { this.kw.history = JSON.parse(localStorage.getItem(KW_HISTORY) || '[]'); } catch { /* storage blocked */ }
        this.panel.innerHTML = `<div class="demo-panel"><h2>Install Progress Tracker</h2><p class="muted" data-status>Waiting for a model…</p></div>`;
        this.onSelection = () => this.updateSelection();
        this.viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection);
        this.resizer = new ResizeObserver(() => this.fitGantt());
        this.resizer.observe(this.panel);
        this.stops = [
            onModelReady(this.viewer, (model) => this.init(model)),
            this.views.on('level', () => { if (this.walls) this.renderBody(); }),
            onDockChange(() => { if (this.walls) this.render(); }), // the Gantt's width and its ⤢ button follow the dock
            // Levels and their elevations arrive after the walls: redraw so floors list bottom to top.
            this.views.on('ready', () => { if (this.walls) { this.linkedCache = null; this.renderBody(); } }),
        ];
        return true;
    }

    unload() {
        this.importController?.abort();
        this.stops.forEach(stop => stop());
        this.stopPlay();
        this.resizer.disconnect();
        this.viewer.removeEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection);
        this.bar?.remove();
        this.allPlans.close();
        this.views.setApartLabels(null);
        this.views.setLevelsApart(null);
        this.views.clearColors();
        if (this.isolatedBySchedule || this.isolatedStage !== undefined || this.linkedOnly) this.views.showAll();
        this.panel.classList.remove('wide', 'xwide');
        this.panel.innerHTML = '';
        return true;
    }

    // --- The 3D toolbar: how the walls are colored, show only a stage, set the stage of the picked walls ------------
    // Extension.onToolbarCreated: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Extension/
    onToolbarCreated() {
        if (this.bar) return;
        const stage = (s, i) => ({ key: `s${i}`, icon: `dw-icon-stage-${i}`, name: s.name });
        this.bar = new DemoToolbar(this.viewer, 'dw-progress', [
            { key: 'colors', icon: 'dw-icon-colors', tip: 'Color the walls: as installed, as planned on a date (4D), or installed vs plan', items:
                Object.entries(COLOR_MODES).map(([k, label]) => ({ key: k, icon: `dw-icon-cm-${k}`, tip: label.replace(/^Colors: /, 'Color: ') + (k === 'actual' ? '' : ' (with a schedule)'),
                    run: () => this.setColorMode(k), on: () => this.colorMode === k })) },
            { key: 'show', icon: 'dw-icon-show-stage', tip: 'Show only the walls at a stage', items: [
                ...STAGES.map(stage).map(({ key, icon, name }) => ({ key, icon, tip: `Show only: ${name}`, run: () => this.isolateStage(name), on: () => this.isolatedStage === name })),
                { key: 'wip', icon: 'dw-icon-stage-wip', tip: 'Show only: in progress (framed, boarded or taped)', run: () => this.isolateStage('wip'), on: () => this.isolatedStage === 'wip' },
                { key: 'all', icon: 'dw-icon-showall', tip: 'Show all walls', run: () => this.isolateStage(null) },
            ] },
            { key: 'views', icon: 'dw-icon-sched-views', tip: 'Schedule views: only the linked walls, the floors apart, all floor plans', items: [
                { key: 'linked', icon: 'dw-icon-linked', tip: 'Only the walls linked to the schedule', run: () => this.setLinkedOnly(!this.linkedOnly), on: () => this.linkedOnly },
                { key: 'apart', icon: 'dw-icon-apart', tip: 'Floors apart: every floor at once, each lifted over the one below', run: () => this.setApart(!this.apartOn), on: () => this.apartOn },
                { key: 'plans', icon: 'dw-icon-all-plans', tip: 'All floor plans at once, beside the schedule', run: () => this.setAllPlans(!this.allPlans.isOpen), on: () => this.allPlans.isOpen },
            ] },
            { key: 'set', icon: 'dw-icon-set-stage', tip: 'Set the stage of the picked walls (pick them in 3D or on the plan, Ctrl+click for several)', items:
                STAGES.map(stage).map(({ key, icon, name }) => ({ key, icon, tip: `Picked walls: ${name}`, run: () => this.setStageFromToolbar(name) })) },
        ]);
    }

    setColorMode(mode) {
        if (mode !== 'actual' && !this.schedule) {
            this.message('Planned and installed-vs-plan colors come from a schedule: load the sample or upload one in the Gantt tab.', 'warn');
            return;
        }
        this.colorMode = mode;
        this.clearFocus();
        this.refresh();
        this.renderBody();
        const select = this.panel.querySelector('[data-color-mode]');
        if (select) select.value = mode;
        this.bar?.refresh();
    }

    // Show only the walls at a stage ('wip': framed, boarded or taped; null: all walls again).
    isolateStage(name) {
        if (!this.walls) return;
        this.isolatedStage = name;
        if (!name) { this.showDefault(); this.bar?.refresh(); return; }
        const ids = this.walls.filter(w => (name === 'wip' ? [1, 2, 3].includes(this.stageIndex(w)) : this.stageOf(w) === name)).map(w => w.dbId);
        if (!ids.length) {
            this.message(`No walls are ${name === 'wip' ? 'in progress' : name.toLowerCase()} yet.`);
            this.isolatedStage = null;
            this.showDefault();
        } else {
            this.views.isolate(ids);
            this.message(`Showing ${ids.length.toLocaleString()} wall${ids.length === 1 ? '' : 's'}: ${name === 'wip' ? 'in progress' : name}.`);
        }
        this.bar?.refresh();
        if (this.views.apart) this.updateFloorLabels(); // the floors show that stage
    }

    setStageFromToolbar(name) {
        if (!this.selected.length) {
            this.message('Pick the walls first, in 3D or on the plan (Ctrl+click for several), then set their stage.', 'warn');
            return;
        }
        this.setStage(name);
        this.message(`${this.selected.length.toLocaleString()} wall${this.selected.length === 1 ? '' : 's'} set to ${name}.`);
    }

    async init(model) {
        this.model = model;
        try {
            // Which model this is (the URN is the page's #hash), and whether it has the sample schedule.
            const urn = decodeURIComponent(location.hash.slice(1));
            const models = await fetchJson('samples/urns.json').catch(() => []);
            const entry = models.find(m => m.urn === urn) || (!urn ? models[0] : null);
            this.sampleSchedule = entry?.sampleSchedule || null;
            this.stateName = this.sampleSchedule ? 'progress' : `progress-${modelKey(urn)}`;
            this.scheduleState = this.sampleSchedule ? 'schedule' : `schedule-${modelKey(urn)}`;
            const [map, saved, schedule] = await Promise.all([loadPropertyMap(), loadState(this.stateName), loadState(this.scheduleState).catch(() => ({}))]);
            this.map = map;
            this.stages = saved.stages || {};
            // The day the field progress was recorded, when the saved progress says (a demo data set does): the plan
            // timeline opens there, so "installed vs plan" compares the walls with the plan on that day.
            this.asOf = /^\d{4}-\d{2}-\d{2}$/.test(saved.asOf || '') ? saved.asOf : null;
            this.walls =(await getWallData(model, map)).walls;
            this.byDbId = new Map(this.walls.map(w => [w.dbId, w]));
            this.wallOrder = [...this.walls].sort((a, b) => a.dbId - b.dbId);
            if (schedule?.activities?.length) { this.useSchedule(schedule); this.loadPdf(); }
            else if (!schedule?.removed && this.sampleSchedule) await this.loadSample({ quiet: true }).catch(err => console.warn('Sample schedule:', err.message));
            this.render();
        } catch (err) {
            this.panel.querySelector('[data-status]').textContent = `Could not load progress: ${err.message || err}`;
        }
    }

    stageOf(wall) {
        return this.stages[wall.externalId] || STAGES[0].name;
    }
    stageIndex(wall) {
        return Math.max(0, STAGE_NAMES.indexOf(this.stageOf(wall)));
    }

    // Level names in elevation order when known (views.levels), else by name.
    get levels() {
        const names = new Set(this.walls.map(w => w.level ?? NOT_SET));
        const ordered = this.views.levels.map(l => l.name).filter(n => names.has(n));
        return [...ordered, ...[...names].filter(n => !ordered.includes(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))];
    }

    // --- The schedule ----------------------------------------------------------------------------------------------

    useSchedule(schedule) {
        schedule.map ??= { levels: {}, stages: {}, activities: {} };
        this.schedule = schedule;
        this.cal = calendarOf(schedule);
        this.span = scheduleSpan(schedule.activities);
        this.linkedCache = null;
        this.selectedAct = null;
        const asOf = this.asOf && this.span && this.asOf >= this.span[0] && this.asOf <= this.span[1] ? this.asOf : null;
        const start = asOf || schedule.project.dataDate || localToday();
        this.cursor =this.span ? (start < this.span[0] ? this.span[0] : start > this.span[1] ? this.span[1] : start) : start;
        this.calMonth = this.cursor.slice(0, 7);
        this.scrolled = false;
        this.gantt.collapsed = this.foldSet(this.gantt.fold);
    }

    foldSet(mode) {
        if (mode === 'done') return new Set(completeGroups(this.linked, this.schedule));
        if (mode === 'all') return new Set(this.schedule.wbs.filter(w => w.parent || !this.schedule.wbs.some(c => c.parent === w.id)).map(w => w.id));
        return new Set();
    }

    get linked() {
        if (!this.linkedCache) {
            this.linkedCache = this.schedule ? linkActivities(this.schedule, this.levels) : [];
            // Demo schedules (moved to this year and this project): every activity not linked to a level and a stage
            // gets a repeatable set of walls on this model (p6.mjs randomWallLinks), so each one shows something.
            // A model's own schedule moved in time (keepLinks) keeps its level links.
            if (this.schedule?.source.demo && !this.schedule.source.demo.keepLinks && this.walls) {
                const byLevel = new Map();
                for (const w of this.wallOrder) if (w.level) (byLevel.get(w.level) || byLevel.set(w.level, []).get(w.level)).push(w.dbId);
                // Every wall activity gets its own walls, picked so the share already at its stage matches how far along
                // it should be (done / some of each / not yet): picking one shows a real split.
                const dataDate = this.schedule.project.dataDate, cal = this.cal;
                const links = randomWallLinks(this.linkedCache, byLevel, {
                    seed: this.schedule.project.id, all: true,
                    stageIndexOf: (id) => this.stageIndex(this.byDbId.get(id)),
                    target: (a, r) => demoTarget(a, r, { dataDate, cal }),
                });
                for (const a of this.linkedCache) {
                    const l = links.get(a.id);
                    if (!l) continue;
                    a.levelHow = `demo: ${l.dbIds.length} walls picked to match its progress${a.level && a.level !== l.level ? ` (was ${a.level})` : ''}`;
                    if (!a.stage) a.stageHow = 'demo: picked at random';
                    Object.assign(a, { level: l.level, stage: l.stage, walls: l.dbIds.map(id => this.byDbId.get(id)), demoWalls: true });
                }
            }
        }
        return this.linkedCache;
    }
    activity(id) {
        return this.linked.find(a => a.id === id) || null;
    }

    async loadSample({ quiet = false } = {}) {
        const resp = await fetch(SAMPLE.url);
        if (!resp.ok) throw new Error(`Sample schedule not found (${resp.status})`);
        const s = scheduleFromXer(parseXer(decodeText(await resp.arrayBuffer())), { file: SAMPLE.file });
        s.source.sample = true;
        this.useSchedule(s);
        if (!quiet) { this.render(); this.message(`Loaded the sample schedule (made up): ${s.activities.length} activities.`); }
    }

    // A P6 export: .xer, or a layout exported to Excel (.xlsx) or CSV.
    async importFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['pdf', 'xer', 'xlsx', 'csv', 'txt'].includes(ext)) throw new Error('Choose a PDF, XER, XLSX or CSV file.');
        const buffer = ext === 'pdf' ? null : await file.arrayBuffer();
        let s, pdfNotes = '', pdfBytes = null;
        if (ext === 'pdf') {
            const doc = await readSchedulePdf(file, { signal: this.importController?.signal, onProgress: message => this.message(message, 'warn') });
            s = scheduleFromRows(scheduleRows(doc), { file: file.name, format: 'pdf', dataDate: parseDateText(doc.dataDate).day });
            pdfNotes = ` PDF: ${doc.warnings.length} import notes; no relationships or calendar in a PDF (Monday–Friday used).`;
            s.source.warnings = doc.warnings;
            // Where each activity is printed (page, y in points): "Show in the PDF" in its details.
            s.source.pdfRows = Object.fromEntries(doc.rows.filter(r => r.kind === 'Activity').map(r => [r.cells.id, [r.page, Math.round(r.y)]]));
            pdfBytes = new Uint8Array(await file.arrayBuffer());
        } else if (ext === 'xlsx') {
            let firstError;
            for (const sheet of await readXlsx(buffer)) {
                try { s = scheduleFromRows(sheet.rows, { file: file.name, format: 'xlsx' }); break; } catch (err) { firstError ??= err; }
            }
            if (!s) throw firstError || new Error('The workbook has no sheets');
        } else {
            const text = decodeText(buffer);
            s = /^ERMHDR|\n%T\t/.test(text) ? scheduleFromXer(parseXer(text), { file: file.name }) : scheduleFromRows(parseCsv(text), { file: file.name, format: 'csv' });
        }
        // The same project again (a schedule update): keep its links to the model (a demo-moved one by its original id).
        const current = this.schedule?.source.demo?.originalId || this.schedule?.project.id;
        if (current && current === s.project.id && !this.schedule.source.sample) s.map = structuredClone(this.schedule.source.original?.map || this.schedule.map);
        if (this.demoMove) s = await this.applyDemoMove(s);
        if (this.importController?.signal.aborted) return;
        this.stopPlay();
        this.useSchedule(s);
        this.render();
        if (!await this.saveSchedule()) return;
        this.pdfBytes = pdfBytes;
        this.pdfFile = file.name;
        if (pdfBytes) await saveState(this.pdfState, { file: file.name, at: new Date().toISOString(), data: toBase64(pdfBytes) }).catch(err => console.warn('Source PDF not kept:', err.message));
        const linked = this.linked.filter(a => a.level && a.stage).length;
        this.message(`Loaded ${s.activities.length} activities from ${file.name} (${s.source.format}); ${linked} linked to walls.${linked ? '' : ' Link them with 🔗 Links.'}${pdfNotes}`, pdfNotes ? 'warn' : '');
    }

    // The schedule as it was imported (its own dates and project), in place of the demo-moved one, until switched back.
    // View only: nothing is saved meanwhile.
    toggleOriginal() {
        this.stopPlay();
        if (this.viewingOriginal) {
            this.viewingOriginal = false;
            this.useSchedule(this.adjustedSchedule);
            this.adjustedSchedule = null;
        } else {
            const original = this.schedule?.source.original;
            if (!original) return;
            this.adjustedSchedule = this.schedule;
            this.viewingOriginal = true;
            this.useSchedule({ ...structuredClone(original), source: { ...structuredClone(original.source), pdfRows: this.schedule.source.pdfRows } });
        }
        this.render();
        this.message(this.viewingOriginal ? `The original schedule: ${this.schedule.project.name}, data date ${fmtDay(this.schedule.project.dataDate)}, its own dates. View only.` : 'Back to the demo schedule (dates adjusted).');
    }

    // The source PDF of a schedule imported from one (state 'schedule-pdf-<model>'), and an activity's row in it.
    get pdfState() {
        return this.scheduleState.replace(/^schedule/, 'schedule-pdf');
    }

    // The kept PDF, when the schedule came from one: "Show in the PDF" appears in the details once it is here.
    async loadPdf() {
        if (!this.schedule?.source.pdfRows || this.pdfBytes) return;
        const saved = await loadState(this.pdfState).catch(() => ({}));
        if (!saved?.data) return;
        this.pdfBytes = fromBase64(saved.data);
        this.pdfFile = saved.file;
        if (this.selectedAct) this.renderDetails(this.panel.querySelector('[data-details]'));
    }

    async showInPdf(a) {
        const at = this.schedule.source.pdfRows?.[a.id];
        if (!at || !this.pdfBytes) return;
        const [page, y] = at, scale = 1.6;
        this.pdfModal?.remove();
        const modal = this.pdfModal = document.createElement('div');
        modal.className = 'pg-pdf-modal';
        modal.innerHTML = `<div class="pg-pdf-box"><div class="pg-pdf-bar"><b>${escapeHtml(this.pdfFile || this.schedule.source.file || 'Source PDF')}</b>
                <span class="muted">page ${page} · ${escapeHtml(a.id)} ${escapeHtml(a.name)}, as printed</span><button class="pg-btn" data-pdf-close>✕ Close</button></div>
            <div class="pg-pdf-page"><canvas></canvas><div class="pg-pdf-hi"></div></div></div>`;
        document.body.appendChild(modal);
        const close = () => { modal.remove(); if (this.pdfModal === modal) this.pdfModal = null; };
        modal.querySelector('[data-pdf-close]').onclick = close;
        modal.onclick = (e) => { if (e.target === modal) close(); };
        try {
            await renderPdfPage(this.pdfBytes, page, modal.querySelector('canvas'), { scale });
            const hi = modal.querySelector('.pg-pdf-hi');
            Object.assign(hi.style, { top: `${(y - 7) * scale}px`, height: `${13 * scale}px` });
            hi.scrollIntoView({ block: 'center' });
        } catch (err) {
            modal.querySelector('.pg-pdf-page').innerHTML = `<p class="warn">The PDF could not be shown: ${escapeHtml(err.message)}</p>`;
        }
    }

    // Demo: dates moved by whole weeks into this year, shown as this model's project, and P6 locations that match no
    // level assigned to the model's levels in order (p6.mjs demoShift, assignDemoLevels).
    async applyDemoMove(s) {
        const snapshot = await loadState('takeoff-snapshot').catch(() => ({}));
        const moved = demoShift(s, { project: snapshot.project || 'Snowdon Towers (Arch)' });
        const assignments = assignDemoLevels(linkActivities(moved, this.levels).filter(a => a.scope === 'wall'), this.levels);
        Object.assign(moved.map.levels, assignments);
        moved.source.demo.levelAssignments = assignments;
        return moved;
    }

    async saveSchedule() {
        if (this.viewingOriginal) { this.message('Viewing the original dates: changes are not saved. Switch back to the adjusted dates to change links.', 'warn'); return false; }
        try {
            await saveState(this.scheduleState, this.schedule);
            return true;
        } catch (err) {
            this.message(`Schedule not saved: ${err.message}`, 'warn');
            return false;
        }
    }

    // A note under the toolbar; it goes away by itself (warnings stay until the next one).
    message(text, kind = '') {
        const el = this.panel.querySelector('[data-msg]');
        if (!el) return;
        el.hidden = !text;
        el.className = `pg-msg ${kind}`;
        el.textContent = text;
        clearTimeout(this.messageTimer);
        el.title = 'Click to close';
        el.onclick = () => { el.hidden = true; clearTimeout(this.messageTimer); };
        if (text) this.messageTimer = setTimeout(() => { el.hidden = true; this.fitGantt(); }, kind === 'warn' ? 15000 : 8000);
        this.fitGantt();
    }

    // --- Rendering ---------------------------------------------------------------------------------------------------

    render() {
        const s = this.schedule;
        const d = s?.source.demo;
        this.panel.innerHTML = `<div class="demo-panel pg">
            <div class="tk-head pg-head">
                <div class="pg-row">
                    <b class="pg-title">Install Progress</b>
                    <div class="tk-tabs">${Object.entries(TABS).map(([k, label]) => `<button data-tab="${k}" class="${k === this.tab ? 'active' : ''}">${label}</button>`).join('')}</div>
                    <span class="pg-info" data-sched-info></span>
                    ${s?.source.original || this.viewingOriginal ? `<button class="pg-btn ${this.viewingOriginal ? 'active' : ''}" data-original title="${this.viewingOriginal ? 'Back to the demo schedule (dates adjusted)' : 'The schedule as imported: its own project, data date and dates (view only)'}">${this.viewingOriginal ? 'Original dates' : 'Show original'}</button>` : ''}
                    ${d?.day ? `<span class="pg-chip demo" title="Demo: dates moved ${d.shiftDays.toLocaleString()} days (whole weeks) so ${fmtDay(d.day)} falls today. Original: ${escapeHtml(d.originalProject)} (data date ${d.originalDataDate ? fmtDay(d.originalDataDate) : '–'}). Schedule ⋯ › Undo restores them.">dates adjusted</span>`
                        : d ? `<span class="pg-chip demo" title="Demo: dates moved ${d.years >= 0 ? '+' : ''}${d.years} years (${d.shiftDays.toLocaleString()} days) from ${escapeHtml(d.originalProject)} (${d.originalDataDate ? fmtDay(d.originalDataDate) : 'earliest start'}). Schedule ⋯ › Undo restores them.">${d.years ? `demo ${d.years > 0 ? '+' : ''}${d.years} y` : 'demo'}</span>` : ''}
                    <label class="pg-btn" title="Upload a P6 schedule: PDF, XER, Excel (.xlsx) or CSV">⬆ Upload<input type="file" data-upload accept=".pdf,.xer,.xlsx,.csv,.txt" ${this.importController ? 'disabled' : ''} hidden></label>
                    <label class="pg-check" title="Demo: an uploaded schedule is moved to this year and shown as this project (dates by whole weeks; locations and walls assigned to the model). Shifted holidays are not the new year's real holidays."><input type="checkbox" data-demo-move ${this.demoMove ? 'checked' : ''}>Demo</label>
                    ${s ? '<button class="pg-btn" data-links-toggle title="Links: which model level and install stage each activity stands for">🔗</button>' : ''}
                    ${document.body.classList.contains('dock-bottom') ? '<button class="pg-btn" data-dock title="Give the schedule most of the screen; click again to bring the model back">⤢</button>' : ''}
                    <details class="tk-dd pg-menu"><summary class="pg-btn" title="Schedule: sample, export, remove">⋯</summary><div class="tk-dd-list">
                        ${s?.source.original ? '<a href="#" data-undo-demo>Undo the demo move</a>' : ''}
                        ${this.sampleSchedule ? `<a href="#" data-sample>Load the sample schedule (made up)</a>
                        <a href="${SAMPLE.url}" download="${SAMPLE.file}">Download the sample .xer</a>` : ''}
                        ${s ? '<a href="#" data-export>Export CSV (P6 % vs model %)</a><a href="#" data-remove>Remove the schedule…</a>' : ''}
                    </div></details>
                    <button class="pg-btn" data-switch-demo title="Switch to the Panel Tracker (Demo 7): the prefab panels from BIM review to framing complete, on this model">⇄ Panels</button>
                </div>
                ${s ? '<div class="pg-row pg-colorbar" data-colorbar></div>' : ''}
                ${s ? `<div class="pg-row pg-search" data-search ${this.tab === 'stages' ? 'hidden' : ''}>
                    <input type="search" data-kw autocomplete="off" aria-label="Search the schedule" value="${escapeHtml(this.kw.typed)}"
                        placeholder="Search activities: framing, finish, drywall L3, &quot;tape and finish&quot;… (Enter keeps a keyword)">
                    <span class="pg-s-chips" data-kw-chips></span>
                    <span class="pg-s-count muted" data-kw-count></span>
                    <button class="pg-btn" data-kw-walls hidden title="Show the walls of every matching wall activity">Walls of all</button>
                    <details class="pg-keybox pg-s-hist"><summary class="pg-btn" title="Keywords used before, and suggestions">History</summary><div class="pg-keypop pg-histpop" data-kw-history></div></details>
                </div>` : ''}
                <div data-links hidden></div>
                <p class="pg-msg" data-msg hidden></p>
            </div>
            <div data-body></div></div>`;
        const p = this.panel;
        p.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => this.setTab(b.dataset.tab));
        p.querySelector('[data-upload]').onchange = async (e) => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file || this.importController) return;
            this.importController = new AbortController(); e.target.disabled = true;
            try { await this.importFile(file); }
            catch (err) { if (err.name !== 'AbortError') this.message(`Could not read ${file.name}: ${err.message}`, 'warn'); }
            finally { this.importController = null; const input = this.panel.querySelector('[data-upload]'); if (input) input.disabled = false; }
        };
        p.querySelector('[data-demo-move]').onchange = e => { this.demoMove = e.target.checked; try { localStorage.setItem('drywall-demos:schedule-demo-shift', String(this.demoMove)); } catch {} };
        p.querySelector('[data-original]')?.addEventListener('click', () => this.toggleOriginal());
        p.querySelector('[data-undo-demo]')?.addEventListener('click', async e => { e.preventDefault(); this.stopPlay(); this.useSchedule(structuredClone(this.schedule.source.original)); this.render(); if (await this.saveSchedule()) this.message('Original dates, project and links restored.'); });
        const sampleLink = p.querySelector('[data-sample]');
        if (sampleLink) sampleLink.onclick = (e) => { e.preventDefault(); this.loadSample().then(() => this.saveSchedule()).catch(err => this.message(err.message, 'warn')); };
        const exp = p.querySelector('[data-export]');
        if (exp) exp.onclick = (e) => { e.preventDefault(); this.exportCsv(); };
        const rem = p.querySelector('[data-remove]');
        if (rem) rem.onclick = async (e) => {
            e.preventDefault();
            if (!confirm('Remove the schedule from this viewer? Wall stages stay.')) return;
            this.clearFocus();
            // The schedule views go with it: only the linked walls, the floors apart, all floor plans.
            this.stopPlay();
            if (this.apartOn) await this.setApart(false);
            if (this.allPlans.isOpen) await this.setAllPlans(false);
            if (this.linkedOnly) this.setLinkedOnly(false);
            this.schedule = null;
            this.colorMode = 'actual';
            await saveState(this.scheduleState, { removed: true, at: new Date().toISOString() }).catch(() => {});
            this.render();
        };
        p.querySelector('[data-dock]')?.addEventListener('click', () => document.dispatchEvent(new CustomEvent('dock-split', { detail: 'toggle' })));
        p.querySelector('[data-switch-demo]').onclick = () => document.dispatchEvent(new CustomEvent('switch-demo', { detail: { id: '09-panel-tracker' } })); // main.js
        const lt = p.querySelector('[data-links-toggle]');
        if (lt) lt.onclick = () => { const d = p.querySelector('[data-links]'); d.hidden = !d.hidden; lt.classList.toggle('active', !d.hidden); if (!d.hidden) this.renderLinks(); this.fitGantt(); };
        this.renderInfo();
        this.renderColorBar();
        this.wireSearch();
        this.renderBody();
        this.refresh();
    }

    setTab(tab) {
        this.tab = tab;
        const params = new URLSearchParams(location.search);
        if (tab === 'stages') params.delete('tab'); else params.set('tab', tab);
        history.replaceState(null, '', `${location.pathname}?${params}`);
        this.panel.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        const search = this.panel.querySelector('[data-search]');
        if (search) search.hidden = tab === 'stages';
        this.renderBody();
    }

    renderInfo() {
        const el = this.panel.querySelector('[data-sched-info]');
        if (!el) return;
        const s = this.schedule;
        if (!s) { el.innerHTML = '<span class="muted">No schedule</span>'; return; }
        const linked = this.linked.filter(a => a.level && a.stage).length, random = this.linked.filter(a => a.demoWalls).length, other = this.linked.filter(a => a.scope === 'other').length;
        el.innerHTML = `<b title="${escapeHtml(s.source.file)}">${escapeHtml(s.project.name)}</b>${s.source.sample ? ' <span class="tk-src gap" title="A made-up P6 schedule for the sample model">sample</span>' : ''}
            <span class="muted">· data date ${s.project.dataDate ? `${fmtDay(s.project.dataDate)}${s.project.estimatedDataDate ? ' (estimated)' : ''}` : '–'}${this.asOf ? ` · field progress as of ${fmtDay(this.asOf)}` : ''} · ${s.activities.length} activities · ${linked} linked to walls${random ? ` (${random} to walls picked at random for the demo)` : ''}${other ? ` · ${other} not wall work (greyed)` : ''}</span>`;
    }

    // Model colors: installed stages, the plan on a date (4D), or installed vs plan; a date slider for the last two.
    renderColorBar() {
        const el = this.panel.querySelector('[data-colorbar]');
        if (!el || !this.span) return;
        const days = Math.round((dayMs(this.span[1]) - dayMs(this.span[0])) / 86400000);
        el.innerHTML = `<select data-color-mode title="How the model is colored">${Object.entries(COLOR_MODES).map(([k, l]) => `<option value="${k}" ${k === this.colorMode ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <input type="range" data-cursor min="0" max="${days}" step="1" value="${Math.round((dayMs(this.cursor) - dayMs(this.span[0])) / 86400000)}" aria-label="Date the model shows the plan for" title="Slide to see the model as planned on a day">
            <b data-cursor-label class="pg-cursor-label"></b>
            <button class="pg-btn" data-play title="Play the plan day by day">▶</button>
            <button class="pg-btn" data-cursor-dd title="Back to the schedule's data date">Data date</button>
            ${this.asOf ? `<button class="pg-btn" data-cursor-asof title="The day the field progress was recorded (${fmtDay(this.asOf)}): compare the walls with the plan then">Status</button>` : ''}
            <span class="pg-views" title="Schedule views">
                <button class="pg-btn ${this.linkedOnly ? 'active' : ''}" data-view="linked" title="Only the walls linked to the schedule (the floors its wall work is on)">Linked walls</button>
                <button class="pg-btn ${this.apartOn ? 'active' : ''}" data-view="apart" title="Floors apart: every floor at once in 3D, each lifted over the one below, colored as the schedule plays">Floors apart</button>
                <button class="pg-btn ${this.allPlans.isOpen ? 'active' : ''}" data-view="plans" title="All floor plans at once, beside the schedule, colored as it plays">All plans</button></span>
            <span class="pg-legend" data-color-legend></span>`;
        el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => ({ linked: () => this.setLinkedOnly(!this.linkedOnly), apart: () => this.setApart(!this.apartOn), plans: () => this.setAllPlans(!this.allPlans.isOpen) })[b.dataset.view]());
        el.querySelector('[data-cursor-asof]')?.addEventListener('click', () => this.setCursor(this.asOf, { move: true }));
        el.querySelector('[data-color-mode]').onchange = (e) => this.setColorMode(e.target.value);
        el.querySelector('[data-cursor]').oninput = (e) => this.setCursor(addDays(this.span[0], Number(e.target.value)));
        el.querySelector('[data-play]').onclick = () => (this.playTimer ? this.stopPlay() : this.play());
        el.querySelector('[data-cursor-dd]').onclick = () => this.setCursor(this.schedule.project.dataDate || localToday(), { move: true });
        this.updateCursorUi();
    }

    // --- Schedule views -------------------------------------------------------------------------------------------------

    // The floors the schedule's wall work is linked to (a level and an install stage), bottom to top.
    linkedLevels() {
        const names = linkedLevelNames(this.linked);
        return this.views.levels.filter(l => names.has(l.name));
    }

    // Their walls (and a demo schedule's picked walls).
    linkedWallIds() {
        const levels = new Set(this.linkedLevels().map(l => l.name));
        const ids = new Set(this.walls.filter(w => levels.has(w.level)).map(w => w.dbId));
        for (const a of this.linked) if (a.demoWalls) for (const w of a.walls || []) ids.add(w.dbId);
        return [...ids];
    }

    // Every wall again, or the linked ones while that view is on.
    showDefault() {
        if (this.linkedOnly && this.schedule) this.views.isolate(this.linkedWallIds(), { fit: false });
        else this.views.showAll();
    }

    // Floors apart: each floor's name, how far it is (its walls at their stages) and, with a schedule, the plan on the
    // timeline's date (p6.mjs levelPercents, up to the last wall stage the schedule reaches). An activity picked (or one
    // stage shown): that stage instead, framed / boarded / taped / finished on every floor, the picked one's floor marked.
    updateFloorLabels(planned = null) {
        const focus = this.focusActivity();
        const stageName = focus?.stage || (STAGE_NAMES.includes(this.isolatedStage) && this.isolatedStage !== STAGE_NAMES[0] ? this.isolatedStage : null);
        const stage = stageName ? STAGE_NAMES.indexOf(stageName) : null;
        if (this.schedule && !planned) {
            const ranked = [...this.wallOrder].sort((a, b) => this.stageIndex(b) - this.stageIndex(a));
            planned = plannedStages(ranked, this.linked.filter(a => !a.demoWalls), this.cursor, this.cal);
        }
        const top = this.schedule ? topStage(this.linked) : STAGE_NAMES.length - 1;
        const per = levelPercents(this.walls, { stageIndexOf: (w) => this.stageIndex(w), plannedIndexOf: planned ? (w) => planned.get(w) : null, top, stage });
        const what = stageName ? stageName.toLowerCase() : 'done';
        this.views.setApartLabels((level) => {
            const r = per.get(level);
            if (!r) return { title: level };
            return { title: level, text: `${r.done}% ${what}${r.plan != null ? ` · plan ${r.plan}%` : ''}`, done: r.done, plan: r.plan, focus: focus?.level === level };
        });
    }

    setLinkedOnly(on) {
        if (on && !this.schedule) { this.message('Load a schedule first (Gantt tab): the linked walls come from it.', 'warn'); return; }
        this.linkedOnly = on;
        this.isolatedStage = null;
        this.clearFocus();
        this.showDefault();
        if (on) this.message(`Showing the ${this.linkedWallIds().length.toLocaleString()} walls on the ${this.linkedLevels().length} floors the schedule's wall work is linked to.`);
        this.updateViewButtons();
    }

    async setApart(on) {
        if (!this.walls) return;
        this.apartOn = on;
        this.updateViewButtons();
        if (!on) { await this.views.setLevelsApart(null); this.showDefault(); this.message(''); return; }
        // Every floor, nothing filtered, so what shows is clear: no level cut (the header's Level: All levels), no picked
        // activity, no stage shown alone, no search's walls, not only the linked walls.
        this.selectedAct = null;
        this.isolatedBySchedule = false;
        this.isolatedStage = null;
        this.linkedOnly = false;
        this.updateViewButtons();
        this.views.showAll();
        if (this.views.level) await this.views.setLevel(null);
        this.refresh();
        this.renderBody();
        const levels = this.views.levels.filter(l => this.views.wallsByLevel.get(l.name)?.length).map(l => l.name);
        this.updateFloorLabels();
        await this.views.setLevelsApart(levels, { onProgress: (i, n, name) => {
            if (!this.apartOn) return;
            if (i < n) this.message(`Floors apart: loading ${name} (${i + 1} of ${n})…`, 'warn');
            else this.message(`Floors apart: ${n} floors, each lifted over the one below. Colors and the timeline apply to every floor.`);
        } });
    }

    async setAllPlans(on) {
        if (!on) { this.allPlans.close(); this.updateViewButtons(); return; }
        const levels = this.schedule ? this.linkedLevels() : this.views.levels.filter(l => this.views.wallsByLevel.get(l.name)?.length);
        if (!levels.length) { this.message('No floors to show: load a schedule linked to the model first.', 'warn'); return; }
        this.allPlans.colors = new Map(this.views.colors); // what the model shows now
        const opening = this.allPlans.open(levels, { onClose: () => this.updateViewButtons() });
        this.updateViewButtons();
        await opening;
    }

    updateViewButtons() {
        this.bar?.refresh();
        const on = { linked: this.linkedOnly, apart: this.apartOn, plans: this.allPlans.isOpen };
        this.panel.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', !!on[b.dataset.view]));
    }

    // The 4D date. Moving it shows the plan on that day (from "Installed", it switches to "Planned on the date").
    setCursor(day, { move = false } = {}) {
        const wasActual = this.colorMode === 'actual', hadFocus = !!this.selectedAct;
        this.cursor = day;
        if (wasActual) this.colorMode = 'planned';
        this.clearFocus();
        this.refresh();
        const monthChanged = this.tab === 'calendar' && day.slice(0, 7) !== this.calMonth;
        if (monthChanged) this.calMonth = day.slice(0, 7);
        if (wasActual || hadFocus || monthChanged) this.renderBody();
        else if (this.tab === 'calendar') this.renderDayList();
        this.updateCursorUi({ move });
    }

    updateCursorUi({ move = false } = {}) {
        const bar = this.panel.querySelector('[data-colorbar]');
        if (bar) {
            bar.querySelector('[data-color-mode]').value = this.colorMode;
            bar.querySelector('[data-cursor]').value = String(Math.round((dayMs(this.cursor) - dayMs(this.span[0])) / 86400000));
            bar.querySelector('[data-cursor]').disabled = false;
            const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(dayMs(this.cursor)).getUTCDay()];
            bar.querySelector('[data-cursor-label]').textContent = `${wd} ${fmtDay(this.cursor)}`;
            bar.querySelector('[data-cursor-label]').classList.toggle('muted', this.colorMode === 'actual');
            bar.querySelector('[data-play]').textContent = this.playTimer ? '❚❚' : '▶';
            this.renderColorLegend();
        }
        const line = this.panel.querySelector('.pg-g-bg .line.cursor');
        if (line) line.style.left = `${ganttX(this.span, this.gantt.scale, this.cursor) + SCALES[this.gantt.scale].ppd / 2}px`;
        this.panel.querySelectorAll('.pg-cal-day.sel').forEach(d => d.classList.remove('sel'));
        this.panel.querySelector(`.pg-cal-day[data-day="${this.cursor}"]`)?.classList.add('sel');
        if (move) this.scrollGanttTo(this.cursor);
    }

    renderColorLegend() {
        const el = this.panel.querySelector('[data-color-legend]');
        if (!el) return;
        const focus = this.focusActivity();
        if (focus) {
            const st = STAGES.find(x => x.name === focus.stage);
            el.innerHTML = `<span class="tk-key"><span class="swatch" style="background:${st?.color || OTHER}"></span>${focus.walls ? `Its ${focus.walls.length} walls (${escapeHtml(focus.level)})` : `${escapeHtml(focus.level)} walls`} ${escapeHtml(focus.stage || '')} or later</span>
                ${st ? `<span class="tk-key"><span class="swatch" style="background:${NOT_YET}"></span>not yet</span>` : ''}`;
        } else if (this.colorMode === 'compare') {
            const c = this.compareCounts || {};
            el.innerHTML = Object.entries(COMPARE).map(([k, v]) => `<span class="tk-key"><span class="swatch" style="background:${v.color}"></span>${v.label} ${c[k] ?? 0}</span>`).join('');
        } else {
            el.innerHTML = STAGES.filter(s => s.color).map(s => `<span class="tk-key"><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join('')
                + (this.colorMode === 'planned' ? '<span class="muted">planned by the end of the day</span>' : '');
        }
    }

    // Day by day, one working day a step: the next step only once this one is drawn (the floor plans included, when they
    // are open), so the timeline never runs ahead of what the views show. At most one step every 280 ms.
    play() {
        this.setCursor(this.cursor >= this.span[1] ? this.span[0] : this.cursor);
        const run = (this.playRun = (this.playRun || 0) + 1);
        const tick = async () => {
            if (run !== this.playRun || !this.playTimer) return;
            const t0 = performance.now();
            let next = addDays(this.cursor, 1);
            while (next < this.span[1] && !this.cal.isWork(next)) next = addDays(next, 1);
            if (next >= this.span[1]) { this.setCursor(this.span[1]); this.stopPlay(); return; }
            this.setCursor(next, { move: true });
            if (this.allPlans.isOpen) await this.allPlans.settled();
            if (run !== this.playRun || !this.playTimer) return;
            this.playTimer = setTimeout(tick, Math.max(0, 280 - (performance.now() - t0)));
        };
        this.playTimer = setTimeout(async () => {
            if (this.allPlans.isOpen && this.allPlans.loading) {
                this.message('Waiting for the floor plans to load before playing…', 'warn');
                await this.allPlans.settled();
                this.message('');
            }
            tick();
        }, 0);
        this.updateCursorUi();
    }

    stopPlay() {
        clearTimeout(this.playTimer);
        this.playTimer = null;
        this.playRun = (this.playRun || 0) + 1;
        if (this.panel.querySelector('[data-play]')) this.updateCursorUi();
    }

    // Room for the selected activity beside the chart (a wide panel), or above it.
    get sideDetails() {
        return this.panel.clientWidth >= 1200;
    }

    renderBody() {
        const body = this.panel.querySelector('[data-body]');
        if (!body) return;
        const wide = this.tab !== 'stages' && !document.body.classList.contains('dock-bottom');
        if (this.panel.classList.contains('xwide') !== wide) { this.panel.classList.toggle('xwide', wide); requestAnimationFrame(() => this.views.resize()); }
        if (this.tab !== 'stages' && !this.schedule) {
            body.innerHTML = `<div class="pg-empty"><p>No schedule for this model yet.</p>
                ${this.sampleSchedule ? '<p><button data-sample2>Load the sample P6 schedule</button> <span class="muted">(made up, for the sample model)</span></p>' : ''}
                <p class="muted">Or upload your own P6 export above: an .xer file, or a layout exported to Excel (.xlsx) or CSV with Activity ID, Activity Name, Start and Finish columns.</p></div>`;
            const sample2 = body.querySelector('[data-sample2]');
            if (sample2) sample2.onclick = () => this.loadSample().then(() => this.saveSchedule()).catch(err => this.message(err.message, 'warn'));
            return;
        }
        if (this.tab === 'gantt') this.renderGantt(body);
        else if (this.tab === 'calendar') this.renderCalendar(body);
        else this.renderStages(body);
        this.renderInfo();
        if (this.tab !== 'stages') this.renderSearch(); // the match count follows the level and Show filters
    }

    // --- Stages tab (the tracker) ----------------------------------------------------------------------------------

    renderStages(body) {
        const level = this.views.level?.name;
        body.innerHTML = `<p class="muted">Set a whole level from the table below, or select walls in 3D or on the plan (Ctrl+click for several) and press a stage.</p>
            <div class="row"><button data-select-level ${level ? '' : 'disabled'}>Select all walls on ${level ? escapeHtml(level) : 'the level'}</button>
                ${level ? '' : '<span class="muted">Pick a level in the header first.</span>'}</div>
            <p data-selection class="muted"></p>
            <div class="row">${STAGES.map(s => `<button data-stage="${s.name}" disabled>${s.color ? `<span class="swatch" style="background:${s.color}"></span>` : ''}${s.name}</button>`).join('')}</div>
            <h3>Stage legend</h3><table><tbody data-legend></tbody></table>
            <h3>Progress by level <span class="muted">(click a level to view it; % = Finished ÷ all walls)</span></h3>
            <table><thead><tr><th>Level</th><th style="width:28%">Stages</th><th class="num">Finished</th><th>Set level</th></tr></thead><tbody data-levels></tbody></table>
            <div class="row"><button data-reset>Reset all stages…</button> <span class="muted" data-saved></span> <button data-undo hidden>Undo</button></div>
            <p class="note">Single user. Saved to a local JSON file (data/progress.json), not synced to any cloud system.</p>`;
        body.querySelectorAll('[data-stage]').forEach(b => b.onclick = () => this.setStage(b.dataset.stage));
        body.querySelector('[data-select-level]').onclick = () => {
            this.views.select(this.walls.filter(w => (w.level ?? NOT_SET) === level).map(w => w.dbId));
        };
        body.querySelector('[data-reset]').onclick = () => {
            if (confirm('Clear the install stage of every wall?')) this.setStages({}, { undo: true });
        };
        body.querySelector('[data-undo]').onclick = () => { if (this.undoStages) this.setStages(this.undoStages); };
        body.querySelector('[data-undo]').hidden = !this.undoStages;
        this.updateSelection();
        this.refresh();
    }

    updateSelection() {
        if (!this.walls) return;
        this.selected = this.viewer.getSelection().map(id => this.byDbId.get(id)).filter(Boolean);
        const out = this.panel.querySelector('[data-selection]');
        if (!out) return;
        const ignored = this.viewer.getSelection().length - this.selected.length;
        out.textContent = this.selected.length
            ? `${this.selected.length} wall(s) selected${ignored ? ` (${ignored} non-wall object(s) ignored)` : ''}.`
            : 'No walls selected.';
        this.panel.querySelectorAll('[data-stage]').forEach(b => { b.disabled = !this.selected.length; });
    }

    setStage(stage) {
        const next = { ...this.stages };
        for (const wall of this.selected) {
            if (!wall.externalId) continue; // can't be tracked across reloads
            if (stage === STAGES[0].name) delete next[wall.externalId];
            else next[wall.externalId] = stage;
        }
        this.setStages(next);
    }

    // Set every wall on a level (or the whole building when level is null) to one stage, with Undo.
    setLevelStage(level, stage) {
        const next = { ...this.stages };
        for (const wall of this.walls) {
            if (!wall.externalId || (level && (wall.level ?? NOT_SET) !== level)) continue;
            if (stage === STAGES[0].name) delete next[wall.externalId];
            else next[wall.externalId] = stage;
        }
        this.setStages(next, { undo: true });
    }

    async setStages(stages, { undo = false } = {}) {
        this.undoStages = undo ? this.stages : null;
        this.stages = stages;
        this.refresh();
        const saved = this.panel.querySelector('[data-saved]');
        const undoButton = this.panel.querySelector('[data-undo]');
        if (undoButton) undoButton.hidden = !this.undoStages;
        try {
            await saveState(this.stateName, { stages, ...(this.asOf ? { asOf: this.asOf } : {}), updatedAt: new Date().toISOString() });
            if (saved) saved.textContent = `Saved ${new Date().toLocaleTimeString()}`;
        } catch (err) {
            if (saved) saved.innerHTML = `<span class="warn">Not saved: ${escapeHtml(err.message)}</span>`;
        }
    }

    // The selected activity when its walls are shown (it has a level).
    focusActivity() {
        const a = this.selectedAct && this.activity(this.selectedAct);
        return a?.level && a.scope !== 'other' ? a : null; // MEP and other trades don't touch the walls
    }

    // Re-theme walls and rebuild the legend and per-level percentages (Stages tab).
    refresh() {
        if (!this.walls) return;
        this.counts = stageCounts(this.walls, w => this.stageOf(w));
        const colors = new Map();
        const counts = Object.fromEntries(STAGES.map(s => [s.name, 0]));
        const perLevel = new Map(this.levels.map(l => [l, { total: 0, done: 0, stages: Object.fromEntries(STAGES.map(st => [st.name, 0])) }]));
        for (const wall of this.walls) {
            const stage = STAGES.find(s => s.name === this.stageOf(wall)) || STAGES[0];
            counts[stage.name]++;
            if (stage.color) colors.set(wall.dbId, stage.color);
            const lvl = perLevel.get(wall.level ?? NOT_SET);
            lvl.total++;
            lvl.stages[stage.name]++;
            if (stage.name === FINISHED) lvl.done++;
        }
        const focus = this.focusActivity();
        let planned = null; // wall -> the stage planned by the timeline's date (with a schedule)
        if (focus) {
            // A selected activity: its level's walls at its stage (or later) in the stage's color, the rest grey.
            colors.clear();
            const k = STAGE_NAMES.indexOf(focus.stage), st = STAGES[k];
            // With the floors apart, every floor the schedule links to shows that stage, like the floor labels.
            const shown = this.views.apart && st?.color && !focus.demoWalls ? this.walls.filter(w => linkedLevelNames(this.linked).has(w.level)) : this.wallsOf(focus);
            if (st?.color) for (const w of shown) colors.set(w.dbId, this.stageIndex(w) >= k ? st.color : NOT_YET);
        } else if (this.schedule && this.colorMode !== 'actual') {
            colors.clear();
            // The plan says how many walls of a level should be at a stage, not which: the walls furthest along are
            // taken first, so a wall shows "behind" only when its level has fewer walls at that stage than planned.
            const ranked = [...this.wallOrder].sort((a, b) => this.stageIndex(b) - this.stageIndex(a));
            planned = plannedStages(ranked, this.linked.filter(a => !a.demoWalls), this.cursor, this.cal);
            const c = { behind: 0, even: 0, ahead: 0 };
            for (const [w, k] of planned) {
                if (this.colorMode === 'planned') { if (STAGES[k].color) colors.set(w.dbId, STAGES[k].color); continue; }
                const a = this.stageIndex(w);
                if (!a && !k) continue; // not started, and not planned to be yet: normal look
                const state = a < k ? 'behind' : a > k ? 'ahead' : 'even';
                c[state]++;
                colors.set(w.dbId, COMPARE[state].color);
            }
            this.compareCounts = c;
        }
        this.views.setColors(colors);
        if (this.allPlans.isOpen) this.allPlans.setColors(colors);
        if (this.views.apart) this.updateFloorLabels(planned);
        this.renderColorLegend();
        const legend = this.panel.querySelector('[data-legend]');
        if (!legend) return; // the Stages tab isn't showing
        legend.innerHTML = STAGES.map(s =>
            `<tr><td><span class="swatch" style="background:${s.color || 'transparent'}"></span>${s.name}</td><td class="num">${counts[s.name]}</td></tr>`).join('');
        const pct = (done, total) => total ? Math.round((done / total) * 100) : 0;
        const rows = [...perLevel.entries()].map(([level, r]) => ({ level, ...r }));
        rows.push({ level: 'All levels', total: this.walls.length, done: counts[FINISHED], stages: counts, overall: true });
        const current = this.views.level?.name;
        // A bar split by stage (Not started = the empty part of the bar).
        const stack = (r) => `<div class="stack" title="${STAGES.map(st => `${st.name}: ${r.stages[st.name]}`).join(', ')}">${STAGES.filter(st => st.color && r.stages[st.name])
            .map(st => `<span style="width:${(r.stages[st.name] / r.total) * 100}%;background:${st.color}"></span>`).join('')}</div>`;
        const picker = `<option value="">Set all to…</option>${STAGES.map(st => `<option>${st.name}</option>`).join('')}`;
        const table = this.panel.querySelector('[data-levels]');
        table.innerHTML = rows.map(r => `<tr class="${r.overall ? 'total' : 'clickable'} ${r.level === current ? 'selected' : ''}" data-row-level="${r.overall ? '' : escapeHtml(r.level)}">
            <td>${escapeHtml(r.level)}</td><td>${stack(r)}</td><td class="num">${r.done}/${r.total} · ${pct(r.done, r.total)}%</td>
            <td><select data-set-level="${r.overall ? '' : escapeHtml(r.level)}" aria-label="Set every wall on ${escapeHtml(r.level)} to a stage">${picker}</select></td></tr>`).join('');
        // Click a level row to view that floor (3D section + its plan); the picker sets every wall on that level.
        table.querySelectorAll('tr.clickable').forEach(tr => tr.onclick = (e) => { if (e.target.tagName !== 'SELECT') this.views.setLevel(tr.dataset.rowLevel); });
        table.querySelectorAll('[data-set-level]').forEach(sel => {
            sel.onclick = (e) => e.stopPropagation();
            sel.onchange = () => {
                const level = sel.dataset.setLevel || null;
                if (!level && !confirm(`Set all ${this.walls.length} walls in the building to ${sel.value}?`)) { sel.value = ''; return; }
                this.setLevelStage(level, sel.value);
            };
        });
    }

    // --- Activities: color, model progress, selection ---------------------------------------------------------------

    colorOf(a) {
        if (a.scope === 'other') return NOT_WALL;
        return STAGES.find(s => s.name === a.stage)?.color || OTHER;
    }
    wallsOf(a) {
        return a.walls || this.walls.filter(w => w.level === a.level);
    }

    modelOf(a) {
        if (a.walls) return wallProgress(a, (w) => this.stageIndex(w));
        return this.counts ? modelProgress(a, this.counts) : null;
    }

    // Activities on the header level (and the milestones), by the Gantt's Show filter.
    visibleActivities(show = 'all') {
        const level = this.views.level?.name, hits = this.keywordHits();
        return this.linked.filter(a => {
            if (hits && !hits.ids.has(a.id)) return false;
            if (level && a.level !== level && !(a.type === 'start' || a.type === 'finish')) return false;
            if (show === 'walls') return a.scope !== 'other';
            if (show === 'active') return a.status === 'active';
            if (show === 'linked') return !!(a.level && a.stage);
            if (show === 'open') return a.status !== 'complete';
            if (show === 'critical') return a.status !== 'complete' && a.float != null && a.float <= 0;
            if (show === 'behind') return compare(this.modelOf(a), a.pct)?.state === 'behind';
            return true;
        });
    }

    // --- Schedule search (keywords, like the P6 Converter) ---------------------------------------------------------------

    // Keywords in use plus the ones being typed; null when not searching.
    keywordList() {
        return [...this.kw.active, ...parseKeywords(this.kw.typed).filter(k => !this.kw.active.some(a => same(a, k)))];
    }
    searchText(a) {
        this.searchTexts ??= new WeakMap();
        if (!this.searchTexts.has(a)) {
            // The whole WBS path (so "drywall" finds the activities under an "Interior framing & drywall" group).
            const wbs = new Map((this.schedule.wbs || []).map(w => [w.id, w])), path = [];
            for (let w = wbs.get(a.wbs); w && path.length < 20; w = wbs.get(w.parent)) path.push(w.name);
            this.searchTexts.set(a, [a.id, a.name, ...path, a.level, a.stage, a.scope === 'other' ? 'not wall work' : a.scope === 'wall' ? 'wall work' : '',
                ...Object.values(a.codes || {})].filter(Boolean).join(' | ').toLowerCase());
        }
        return this.searchTexts.get(a);
    }
    keywordHits() {
        const kws = this.keywordList();
        if (!kws.length || !this.schedule) return null;
        const key = `${kws.join('\u0001')}|${this.kw.all}`;
        if (this.hitCache?.key === key && this.hitCache.linked === this.linked) return this.hitCache.value;
        const texts = this.linked.map(a => this.searchText(a)), res = matchRows(texts, kws, { all: this.kw.all });
        const value = { kws, ids: new Set(this.linked.filter((a, i) => res[i]).map(a => a.id)), counts: keywordCounts(texts, kws) };
        this.hitCache = { key, linked: this.linked, value };
        return value;
    }

    wireSearch() {
        const row = this.panel.querySelector('[data-search]');
        if (!row) return;
        const input = row.querySelector('[data-kw]');
        const keep = () => {
            const list = parseKeywords(input.value);
            input.value = ''; this.kw.typed = '';
            if (!list.length) return;
            this.kw.active = [...this.kw.active, ...list.filter(k => !this.kw.active.some(a => same(a, k)))];
            this.kw.history = remember(this.kw.history, list);
            try { localStorage.setItem(KW_HISTORY, JSON.stringify(this.kw.history)); } catch { /* storage blocked */ }
            this.searchChanged();
        };
        input.oninput = () => { this.kw.typed = input.value; this.searchChanged(); };
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); keep(); } else if (e.key === 'Escape') { input.value = ''; this.kw.typed = ''; this.searchChanged(); } };
        row.querySelector('[data-kw-walls]').onclick = () => {
            const hits = this.keywordHits();
            const acts = hits ? this.visibleActivities(this.gantt.show).filter(a => a.type !== 'start' && a.type !== 'finish' && a.scope !== 'other' && a.level) : [];
            const ids = [...new Set(acts.flatMap(a => this.wallsOf(a).map(w => w.dbId)))];
            if (!ids.length) return;
            this.clearFocus();
            this.views.isolate(ids);
            this.views.showPlanFor(ids);
            this.isolatedBySchedule = true;
            this.refresh();
            this.renderBody();
            this.message(`Showing the walls of ${acts.length} matching activities (${ids.length} walls). Clear the search to show every wall.`);
        };
        this.renderSearch();
    }

    // Chips (keywords in use with their matches, the one being typed), the count, the history popover.
    renderSearch() {
        const row = this.panel.querySelector('[data-search]');
        if (!row) return;
        const hits = this.keywordHits(), counts = hits?.counts || new Map();
        const typed = parseKeywords(this.kw.typed).filter(k => !this.kw.active.some(a => same(a, k)));
        const chip = (k, on) => `<span class="pg-kchip ${on ? 'on' : 'typing'}" title="${on ? 'Keyword in use' : 'Being typed: Enter keeps it'}">${escapeHtml(k)} <span class="n">${(counts.get(k) || 0).toLocaleString()}</span>${on ? `<button data-kw-remove="${escapeHtml(k)}" aria-label="Remove ${escapeHtml(k)}">×</button>` : ''}</span>`;
        row.querySelector('[data-kw-chips]').innerHTML = this.kw.active.map(k => chip(k, true)).join('') + typed.map(k => chip(k, false)).join('')
            + (this.kw.active.length ? '<button class="pg-x" data-kw-clear title="Clear the search">Clear</button>' : '');
        row.querySelectorAll('[data-kw-remove]').forEach(b => b.onclick = () => { this.kw.active = this.kw.active.filter(k => !same(k, b.dataset.kwRemove)); this.searchChanged(); });
        const clear = row.querySelector('[data-kw-clear]');
        if (clear) clear.onclick = () => { this.kw.active = []; this.searchChanged(); };
        const shown = hits ? this.visibleActivities(this.gantt.show).filter(a => a.type !== 'start' && a.type !== 'finish') : null;
        row.querySelector('[data-kw-count]').textContent = hits ? `${shown.length.toLocaleString()} ${shown.length === 1 ? 'match' : 'matches'}${this.kw.all && hits.kws.length > 1 ? ' (all keywords)' : ''}` : '';
        const wallActs = hits ? shown.filter(a => a.scope !== 'other' && a.level).length : 0;
        const walls = row.querySelector('[data-kw-walls]');
        walls.hidden = !wallActs;
        walls.textContent = `Walls of all ${wallActs.toLocaleString()}`;
        // History: keywords used before (click to use), suggestions, any / all.
        const past = this.kw.history.filter(h => !this.kw.active.some(a => same(a, h.text)));
        const suggest = KW_SUGGEST.filter(k => !this.kw.active.some(a => same(a, k)) && !this.kw.history.some(h => same(h.text, k)));
        row.querySelector('[data-kw-history]').innerHTML = `
            <label class="pg-check"><input type="checkbox" data-kw-all ${this.kw.all ? 'checked' : ''}> Match all keywords</label>
            ${past.length ? `<b>Used before</b><div class="pg-hlist">${past.map(h => `<span class="pg-kchip past"><button data-kw-use="${escapeHtml(h.text)}" title="Used ${h.uses}×">${escapeHtml(h.text)}</button><button data-kw-forget="${escapeHtml(h.text)}" aria-label="Forget ${escapeHtml(h.text)}">×</button></span>`).join('')}</div>` : ''}
            ${suggest.length ? `<b>Suggestions</b><div class="pg-hlist">${suggest.map(k => `<span class="pg-kchip past"><button data-kw-use="${k}">${k}</button></span>`).join('')}</div>` : ''}
            ${this.kw.history.length ? '<button class="pg-x" data-kw-forget-all>Clear history</button>' : ''}`;
        const pop = row.querySelector('[data-kw-history]');
        pop.querySelector('[data-kw-all]').onchange = (e) => { this.kw.all = e.target.checked; this.searchChanged(); };
        pop.querySelectorAll('[data-kw-use]').forEach(b => b.onclick = () => {
            const k = b.dataset.kwUse;
            if (!this.kw.active.some(a => same(a, k))) this.kw.active = [...this.kw.active, k];
            this.kw.history = remember(this.kw.history, [k]);
            try { localStorage.setItem(KW_HISTORY, JSON.stringify(this.kw.history)); } catch { /* storage blocked */ }
            this.searchChanged();
        });
        const saveHist = () => { try { localStorage.setItem(KW_HISTORY, JSON.stringify(this.kw.history)); } catch { /* storage blocked */ } };
        pop.querySelectorAll('[data-kw-forget]').forEach(b => b.onclick = () => { this.kw.history = this.kw.history.filter(h => !same(h.text, b.dataset.kwForget)); saveHist(); this.renderSearch(); });
        const all = pop.querySelector('[data-kw-forget-all]');
        if (all) all.onclick = () => { this.kw.history = []; saveHist(); this.renderSearch(); };
    }

    searchChanged() {
        // The search's wall view ends when the search changes (unless an activity is picked).
        if (this.isolatedBySchedule && !this.selectedAct) { this.showDefault(); this.isolatedBySchedule = false; this.refresh(); }
        this.renderSearch();
        this.renderBody();
    }

    selectActivity(id) {
        this.selectedAct = this.selectedAct === id ? null : id;
        this.reveal = !!this.selectedAct;
        const a = this.focusActivity();
        if (a) {
            const ids = this.wallsOf(a).map(w => w.dbId);
            // With the floors apart every floor stays in view, colored by the activity's stage (refresh).
            if (!this.views.apart) { this.views.isolate(ids); this.isolatedBySchedule = true; }
            this.views.showPlanFor(ids);
        } else if (this.isolatedBySchedule) {
            this.showDefault();
            this.isolatedBySchedule = false;
        }
        this.refresh();
        this.renderBody();
    }

    clearFocus() {
        if (!this.selectedAct) return;
        this.selectedAct = null;
        if (this.isolatedBySchedule) { this.showDefault(); this.isolatedBySchedule = false; }
    }

    // --- Gantt tab -----------------------------------------------------------------------------------------------------

    renderGantt(body) {
        const old = body.querySelector('[data-gantt]'), keep = old ? [old.scrollLeft, old.scrollTop] : null;
        this.counts ??= stageCounts(this.walls, w => this.stageOf(w));
        const level = this.views.level?.name;
        const rows = ganttRows(this.visibleActivities(this.gantt.show), this.schedule, { collapsed: this.keywordHits() ? new Set() : this.gantt.collapsed });
        const html = ganttHtml({
            rows, span: this.span, scale: this.gantt.scale, cal: this.cal, dataDate: this.schedule.project.dataDate, today: localToday(),
            cursor: this.colorMode === 'actual' ? null : this.cursor, selectedId: this.selectedAct, linkMode: this.gantt.links, links: this.schedule.links,
            colorOf: (a) => this.colorOf(a), modelOf: (a) => this.modelOf(a), cmpOf: (a) => compare(this.modelOf(a), a.pct),
        });
        body.innerHTML = `<div class="pg-tools">
                <div class="tk-tabs">${Object.entries(SCALES).map(([k, s]) => `<button data-scale="${k}" class="${k === this.gantt.scale ? 'active' : ''}">${s.label}</button>`).join('')}</div>
                <select data-show title="Which activities">${Object.entries(SHOW).map(([k, l]) => `<option value="${k}" ${k === this.gantt.show ? 'selected' : ''}>${l}</option>`).join('')}</select>
                <select data-linkmode title="Relationship lines">${[['selected', 'Links: selected'], ['all', 'Links: all'], ['none', 'Links: none']].map(([k, l]) => `<option value="${k}" ${k === this.gantt.links ? 'selected' : ''}>${l}</option>`).join('')}</select>
                <select data-fold title="Fold WBS groups (click a group's row to fold or open just that one)">${Object.entries(FOLD).map(([k, l]) => `<option value="${k}" ${k === this.gantt.fold ? 'selected' : ''}>${l}</option>`).join('')}</select>
                <button class="pg-btn" data-today title="Scroll to today">Today</button>
                <span class="pg-level muted">${level ? `Level ${escapeHtml(level)} · <a href="#" data-all-levels>all levels</a>` : 'All levels'}</span>
                <details class="pg-keybox"><summary class="pg-btn" title="What the bars and marks mean">Key</summary><div class="pg-keypop">
                    <span><i class="k-bl"></i>planned</span><span><i class="k-bar"></i>current</span><span><i class="k-done"></i>P6 % done</span>
                    <span><i class="k-model"></i>model %</span><span><i class="k-crit"></i>critical</span><span><b>◆</b> milestone</span></div></details>
            </div>
            <div class="pg-main ${this.sideDetails ? 'side' : 'float'}">
                <div class="pg-g-scroll" data-gantt>${rows.length ? html : '<p class="muted pg-empty">No activities to show with this filter.</p>'}</div>
                <div class="pg-side" data-details></div></div>`;
        body.querySelectorAll('[data-scale]').forEach(b => b.onclick = () => { this.gantt.scale = b.dataset.scale; this.scrolled = false; this.renderBody(); });
        body.querySelector('[data-show]').onchange = (e) => { this.gantt.show = e.target.value; this.renderBody(); };
        body.querySelector('[data-linkmode]').onchange = (e) => { this.gantt.links = e.target.value; this.renderBody(); };
        body.querySelector('[data-today]').onclick = () => this.scrollGanttTo(localToday(), { always: true });
        body.querySelector('[data-fold]').onchange = (e) => {
            this.gantt.fold = e.target.value;
            this.gantt.collapsed = this.foldSet(this.gantt.fold);
            this.renderBody();
        };
        const all = body.querySelector('[data-all-levels]');
        if (all) all.onclick = (e) => { e.preventDefault(); this.views.setLevel(null); };
        const g = body.querySelector('[data-gantt]');
        g.onclick = (e) => {
            const w = e.target.closest('[data-wbs]');
            if (w) { const id = w.dataset.wbs; this.gantt.collapsed.has(id) ? this.gantt.collapsed.delete(id) : this.gantt.collapsed.add(id); this.renderBody(); return; }
            const r = e.target.closest('[data-act]');
            if (r) this.selectActivity(r.dataset.act);
        };
        this.renderDetails(body.querySelector('[data-details]'));
        this.fitGantt();
        if (keep) { g.scrollLeft = keep[0]; g.scrollTop = keep[1]; }
        else if (!this.scrolled) {
            // First view: the timeline's date (the data date, or the day the field progress was recorded) a third of the
            // way across, and the first work in progress (with its group) at the top: in progress in P6, else wall work
            // under way on that date.
            this.scrollGanttTo(this.cursor, { always: true });
            let row = g.querySelector('.pg-g-row.st-active') || [...g.querySelectorAll('.pg-g-row.act:not(.other)')].find(r => {
                const a = this.activity(r.dataset.act);
                return a && a.start <= this.cursor && a.finish >= this.cursor;
            });
            while (row && !row.classList.contains('wbs')) row = row.previousElementSibling;
            if (row) g.scrollTop = row.offsetTop;
            this.scrolled = true;
        }
        if (this.reveal) { this.reveal = false; this.revealSelected(g); }
    }

    // Keep the selected activity's row (and the start of its bar) in view after it was picked.
    revealSelected(g) {
        const row = g.querySelector('.pg-g-row.sel');
        if (!row) return;
        const head = g.querySelector('.pg-g-head')?.offsetHeight || 0;
        const r = row.getBoundingClientRect(), box = g.getBoundingClientRect();
        if (r.top < box.top + head || r.bottom > box.bottom - 14) g.scrollTop += r.top - (box.top + head + (box.height - head) / 3);
        const a = this.activity(this.selectedAct);
        if (a) this.scrollGanttTo(a.start);
    }

    scrollGanttTo(day, { always = false } = {}) {
        const g = this.panel.querySelector('[data-gantt]');
        if (!g || !this.span) return;
        const cells = g.querySelector('.pg-g-head .pg-g-cells')?.offsetWidth || 0;
        const x = ganttX(this.span, this.gantt.scale, day);
        const view = g.clientWidth - cells;
        if (always || x < g.scrollLeft + 20 || x > g.scrollLeft + view - 20) g.scrollLeft = Math.max(0, x - view * 0.4);
    }

    // The chart fills the panel's height (in dock-bottom mode the panel is what's left under the viewers).
    fitGantt() {
        const main = this.panel.querySelector('.pg-main');
        if (main && main.classList.contains('side') !== this.sideDetails) {
            main.classList.toggle('side', this.sideDetails);
            main.classList.toggle('float', !this.sideDetails);
            this.renderDetails(main.querySelector('[data-details]'));
        }
        const g = this.panel.querySelector('[data-gantt]');
        if (!g) return;
        // A narrow chart drops the Start, Finish and Dur columns (the bars show the dates) to leave room for the bars.
        g.querySelector('.pg-gantt')?.classList.toggle('compact', g.clientWidth < 1150);
        const room = `${Math.max(180, this.panel.getBoundingClientRect().bottom - g.getBoundingClientRect().top - 22)}px`;
        g.style.maxHeight = room;
        const side = this.panel.querySelector('.pg-main.side .pg-side');
        if (side) side.style.maxHeight = room;
    }

    // --- Calendar tab -------------------------------------------------------------------------------------------------

    renderCalendar(body) {
        this.counts ??= stageCounts(this.walls, w => this.stageOf(w));
        const acts = this.visibleActivities(this.gantt.show === 'behind' || this.gantt.show === 'critical' ? this.gantt.show : 'all');
        const level = this.views.level?.name;
        body.innerHTML = `<div class="pg-tools">
                <button class="pg-btn" data-month="-1" aria-label="Previous month">‹</button><b class="pg-month">${monthName(`${this.calMonth}-01`)}</b><button class="pg-btn" data-month="1" aria-label="Next month">›</button>
                <button class="pg-btn" data-cal-today>Today</button><button class="pg-btn" data-cal-dd>Data date</button>
                <span class="pg-level muted" title="Click a day to see the model as planned that day; click an activity for its walls">${level ? `Level ${escapeHtml(level)} · <a href="#" data-all-levels>all levels</a>` : 'All levels'}</span>
                <details class="pg-keybox"><summary class="pg-btn" title="Colors">Key</summary><div class="pg-keypop">
                    ${STAGES.filter(s => s.color).map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}<span><i style="background:${OTHER}"></i>other</span><span><b>◆</b> milestone</span></div></details>
            </div>
            <div class="pg-main ${this.sideDetails ? 'side' : 'float'}"><div class="pg-cal-wrap">
            ${calendarHtml({ month: this.calMonth, activities: acts, cal: this.cal, dataDate: this.schedule.project.dataDate, today: localToday(), cursor: this.cursor, selectedId: this.selectedAct, colorOf: (a) => this.colorOf(a) })}
            <div data-daylist class="pg-daylist"></div></div><div class="pg-side" data-details></div></div>`;
        const move = (n) => {
            const [y, m] = this.calMonth.split('-').map(Number);
            const d = new Date(Date.UTC(y, m - 1 + n, 1));
            this.calMonth = d.toISOString().slice(0, 7);
            this.renderBody();
        };
        body.querySelectorAll('[data-month]').forEach(b => b.onclick = () => move(Number(b.dataset.month)));
        body.querySelector('[data-cal-today]').onclick = () => { this.calMonth = localToday().slice(0, 7); this.renderBody(); };
        body.querySelector('[data-cal-dd]').onclick = () => this.setCursor(this.schedule.project.dataDate || localToday(), { move: true });
        const all = body.querySelector('[data-all-levels]');
        if (all) all.onclick = (e) => { e.preventDefault(); this.views.setLevel(null); };
        body.querySelector('.pg-cal').onclick = (e) => {
            const ev = e.target.closest('[data-act]');
            if (ev) { this.selectActivity(ev.dataset.act); return; }
            const day = e.target.closest('[data-day]');
            if (day) this.setCursor(day.dataset.day);
        };
        this.renderDetails(body.querySelector('[data-details]'));
        this.renderDayList();
    }

    // What the schedule has on the selected day.
    renderDayList() {
        const el = this.panel.querySelector('[data-daylist]');
        if (!el) return;
        const d = this.cursor;
        const acts = this.visibleActivities().filter(a => a.start <= d && a.finish >= d);
        const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(dayMs(d)).getUTCDay()];
        el.innerHTML = `<h3>${wd} ${fmtDay(d)} <span class="muted">${this.cal.isWork(d) ? `${acts.length} activities in progress` : `not a working day${this.cal.isHoliday(d) ? ' (holiday)' : ''}`}</span></h3>
            ${acts.length ? `<table><thead><tr><th>Activity</th><th>Level</th><th>Stage</th><th>Start</th><th>Finish</th><th class="num">Planned by this day</th><th class="num">P6 %</th><th class="num">Model %</th></tr></thead><tbody>
            ${acts.map(a => {
                const m = this.modelOf(a), c = compare(m, a.pct);
                return `<tr class="clickable ${a.id === this.selectedAct ? 'selected' : ''}" data-act="${escapeHtml(a.id)}"><td><span class="swatch" style="background:${this.colorOf(a)}"></span>${escapeHtml(a.id)} ${escapeHtml(a.name)}</td>
                    <td>${escapeHtml(a.level || '–')}</td><td>${escapeHtml(a.stage || '–')}</td><td>${fmtDay(a.start)}</td><td>${fmtDay(a.finish)}</td>
                    <td class="num">${expectedPct(a, d, this.cal)}%</td><td class="num">${a.pct == null ? 'not printed' : a.pct + '%'}</td><td class="num">${m ? `<span class="pg-cmp ${c.state}">${m.pct}%</span>` : '–'}</td></tr>`;
            }).join('')}</tbody></table>` : ''}`;
        el.querySelectorAll('[data-act]').forEach(tr => tr.onclick = () => this.selectActivity(tr.dataset.act));
    }

    // --- The selected activity ------------------------------------------------------------------------------------------

    renderDetails(el) {
        const a = this.selectedAct && this.activity(this.selectedAct);
        if (!el) return;
        if (!a) {
            el.innerHTML = el.closest('.pg-main.side') ? '<div class="pg-details empty"><b>No activity picked</b><span class="muted">Click a bar or a row to see its walls in the model, its dates, progress and links.</span></div>' : '';
            return;
        }
        const m = this.modelOf(a), c = compare(m, a.pct), v = finishVariance(a, this.cal);
        const dd = this.schedule.project.dataDate;
        const plannedByDd = dd ? expectedPct(a, addDays(dd, -1), this.cal, { planned: true }) : null;
        const name = (id) => escapeHtml(this.activity(id)?.name || '');
        const rel = (l, id) => `<a href="#" data-goto="${escapeHtml(id)}" title="${name(id)}">${escapeHtml(id)}</a> <span class="muted">${l.type}${l.lag ? `${l.lag > 0 ? '+' : ''}${l.lag}d` : ''}</span>`;
        const preds = this.schedule.links.filter(l => l.to === a.id), succs = this.schedule.links.filter(l => l.from === a.id);
        const ms = a.type === 'start' || a.type === 'finish';
        const status = a.status === 'complete' ? '<span class="tk-src ok">Complete</span>' : a.status === 'active' ? '<span class="tk-src manual">In progress</span>' : '<span class="tk-src">Not started</span>';
        const own = this.schedule.map.activities?.[a.id] || {};
        const levelOptions = `<option value="__auto">Auto${own.level === undefined ? `: ${escapeHtml(a.level || 'none')}` : ''}</option>${this.levels.map(l => `<option ${own.level === l ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}<option value="" ${own.level === '' ? 'selected' : ''}>Not in the model</option>`;
        const stageOptions = `<option value="__auto">Auto${own.stage === undefined ? `: ${escapeHtml(a.stage || 'none')}` : ''}</option>${STAGE_NAMES.slice(1).map(s => `<option ${own.stage === s ? 'selected' : ''}>${s}</option>`).join('')}<option value="" ${own.stage === '' ? 'selected' : ''}>No stage</option>`;
        el.innerHTML = `<div class="pg-details">
            <div class="pg-d-head"><span class="swatch" style="background:${this.colorOf(a)}"></span><b class="pg-d-name" title="${escapeHtml(`${a.id} ${a.name}`)}">${escapeHtml(a.id)} · ${escapeHtml(a.name)}</b>
                <button class="pg-x" data-clear-act title="Close and show every wall again">✕</button></div>
            <div class="pg-d-tags">${status}${a.scope === 'other' ? `<span class="tk-src" title="${escapeHtml(a.scopeHow || '')}">not wall work</span>` : ''}${a.float != null && a.status !== 'complete' ? `<span class="tk-src ${a.float <= 0 ? 'bad' : ''}">float ${a.float} d${a.float <= 0 ? ' · critical' : ''}</span>` : ''}
                ${m ? `<span class="pg-cmp ${c.state}" title="Model: ${m.done} of ${m.total} walls ${escapeHtml(a.stage)} or later">model ${m.pct}%</span>` : ''}
                ${a.level && a.scope !== 'other' ? '<span class="pg-d-acts"><button class="pg-btn" data-show-level title="Cut the model at this level and open its plan">Level</button><button class="pg-btn" data-select-walls title="Select these walls, then set their stage on the Stages tab">Select walls</button></span>' : ''}</div>
            <dl class="pg-d-facts">
                <dt>Dates</dt><dd>${fmtDay(a.start)}${a.actualStart ? ' A' : ''} → ${fmtDay(a.finish)}${a.actualFinish ? ' A' : ''}${ms ? '' : ` · ${Math.round(a.dur)} d${a.status === 'active' ? `, ${Math.round(a.rem)} left` : ''}`}</dd>
                <dt>Planned</dt><dd>${fmtDay(a.plannedStart)} → ${fmtDay(a.plannedFinish)} · ${v > 0 ? `<span class="warn">${v} d late</span>` : v < 0 ? `${-v} d early` : 'on time'}</dd>
                ${ms ? '' : `<dt>Progress</dt><dd>P6 ${a.pct == null ? 'not printed' : a.pct + '%'}${plannedByDd != null ? ` <span class="muted">(plan ${plannedByDd}%)</span>` : ''} · model ${m ? `${m.pct}% <span class="muted">(${m.done}/${m.total} walls)</span>${c.state === 'behind' ? ` <span class="warn">${-c.delta} pts behind</span>` : c.state === 'ahead' ? ` <span class="muted">${c.delta} pts ahead</span>` : ''}` : '<span class="muted">not linked</span>'}</dd>`}
                ${ms ? '' : `<dt>Scope</dt><dd><select data-own="scope"><option value="__auto">Auto: ${a.scope === 'other' ? 'not wall work' : 'wall work'}</option><option value="wall" ${own.scope === 'wall' ? 'selected' : ''}>Wall work</option><option value="other" ${own.scope === 'other' ? 'selected' : ''}>Not wall work</option></select><span class="muted pg-how">${escapeHtml(a.scopeHow || '')}</span></dd>`}
                <dt>Level</dt><dd><select data-own="level">${levelOptions}</select><span class="muted pg-how">${escapeHtml(a.levelHow || '')}</span></dd>
                ${ms ? '' : `<dt>Stage</dt><dd><select data-own="stage">${stageOptions}</select><span class="muted pg-how">${escapeHtml(a.stageHow || '')}</span></dd>`}
                ${Object.keys(a.codes || {}).length ? `<dt>Codes</dt><dd>${Object.entries(a.codes).map(([k, val]) => `${escapeHtml(k)}: ${escapeHtml(val)}`).join(' · ')}</dd>` : ''}
                ${this.pdfBytes && this.schedule.source.pdfRows?.[a.id] ? `<dt>Source</dt><dd>PDF page ${this.schedule.source.pdfRows[a.id][0]} <button class="pg-btn" data-in-pdf title="The page of the imported PDF, this activity's row highlighted">Show in the PDF</button></dd>` : ''}
                <dt>Before</dt><dd>${preds.map(l => rel(l, l.from)).join(', ') || '<span class="muted">none</span>'}</dd>
                <dt>After</dt><dd>${succs.map(l => rel(l, l.to)).join(', ') || '<span class="muted">none</span>'}</dd>
            </dl></div>`;
        el.querySelectorAll('[data-goto]').forEach(x => x.onclick = (e) => { e.preventDefault(); this.selectActivity(x.dataset.goto); });
        el.querySelector('[data-clear-act]').onclick = () => this.selectActivity(a.id);
        el.querySelector('[data-in-pdf]')?.addEventListener('click', () => this.showInPdf(a));
        const show = el.querySelector('[data-show-level]');
        if (show) show.onclick = () => this.views.setLevel(a.level);
        const sel = el.querySelector('[data-select-walls]');
        if (sel) sel.onclick = () => { this.views.select(this.wallsOf(a).map(w => w.dbId)); this.setTab('stages'); };
        el.querySelectorAll('[data-own]').forEach(s => s.onchange = () => {
            const own = (this.schedule.map.activities ??= {});
            const entry = { ...own[a.id] };
            if (s.value === '__auto') delete entry[s.dataset.own]; else entry[s.dataset.own] = s.value;
            if (Object.keys(entry).length) own[a.id] = entry; else delete own[a.id];
            this.linksChanged();
        });
    }

    // --- Links: P6 locations -> model levels, stage codes -> install stages ----------------------------------------------

    renderLinks() {
        const el = this.panel.querySelector('[data-links]');
        if (!el || el.hidden || !this.schedule) return;
        const map = this.schedule.map;
        const group = (key) => {
            const out = new Map();
            for (const a of this.linked) if (a[key]) out.set(a[key], (out.get(a[key]) || 0) + 1);
            return [...out.entries()];
        };
        const locs = group('locationKey'), stageKeys = group('stageKey');
        const levelSelect = (key) => {
            const set = map.levels[key], auto = matchLevel(key, this.levels);
            return `<select data-map-level="${escapeHtml(key)}"><option value="__auto">Auto: ${escapeHtml(auto || 'no match')}</option>
                ${this.levels.map(l => `<option ${set === l ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}<option value="" ${set === '' ? 'selected' : ''}>Not in the model</option></select>`;
        };
        const stageSelect = (key) => {
            const set = map.stages[key], auto = matchStage(key);
            return `<select data-map-stage="${escapeHtml(key)}"><option value="__auto">Auto: ${escapeHtml(auto || 'no stage')}</option>
                ${STAGE_NAMES.slice(1).map(s => `<option ${set === s ? 'selected' : ''}>${s}</option>`).join('')}<option value="" ${set === '' ? 'selected' : ''}>No stage</option></select>`;
        };
        const linked = this.linked.filter(a => a.level && a.stage).length, own = Object.keys(map.activities || {}).length;
        el.innerHTML = `<div class="tk-settings pg-links">
            <div><b>Link the schedule to the model.</b> <span class="muted">A wall activity needs a level (from a Location/Level activity code, the WBS or the name) and an install stage
                (an Install Stage code, or words in the name: frame, board/hang, tape/mud, finish/sand/punch). ${linked} of ${this.linked.length} activities are linked to walls.</span></div>
            <table><thead><tr><th>P6 location</th><th class="num">Activities</th><th>Model level</th></tr></thead><tbody>
                ${locs.map(([k, n]) => `<tr><td>${escapeHtml(k)}</td><td class="num">${n}</td><td>${levelSelect(k)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No locations: levels come from the activity names.</td></tr>'}</tbody></table>
            <table><thead><tr><th>P6 stage</th><th class="num">Activities</th><th>Install stage</th></tr></thead><tbody>
                ${stageKeys.map(([k, n]) => `<tr><td>${escapeHtml(k)}</td><td class="num">${n}</td><td>${stageSelect(k)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No stage codes: stages come from the activity names.</td></tr>'}</tbody></table>
            ${own ? `<div>${own} activities set one by one. <button data-clear-own>Clear those</button></div>` : ''}
        </div>`;
        const update = (kind, key, value) => {
            if (value === '__auto') delete map[kind][key]; else map[kind][key] = value;
            this.linksChanged();
        };
        el.querySelectorAll('[data-map-level]').forEach(s => s.onchange = () => update('levels', s.dataset.mapLevel, s.value));
        el.querySelectorAll('[data-map-stage]').forEach(s => s.onchange = () => update('stages', s.dataset.mapStage, s.value));
        const clear = el.querySelector('[data-clear-own]');
        if (clear) clear.onclick = () => { map.activities = {}; this.linksChanged(); };
    }

    linksChanged() {
        this.linkedCache = null;
        this.saveSchedule();
        const focus = this.focusActivity();
        if (!focus && this.isolatedBySchedule) { this.showDefault(); this.isolatedBySchedule = false; }
        this.refresh();
        this.renderInfo();
        this.renderLinks();
        this.renderBody();
    }

    exportCsv() {
        this.counts ??= stageCounts(this.walls, w => this.stageOf(w));
        const rows = [['Activity ID', 'Activity Name', 'Level', 'Install stage', 'Status', 'Start', 'Finish', 'Planned Start', 'Planned Finish', 'Finish variance (d)', 'Total float (d)',
            'P6 % complete', 'Model % complete', 'Walls at stage', 'Walls on level', 'Model - P6 (pts)', 'Scope']];
        for (const a of this.linked) {
            const m = this.modelOf(a), c = compare(m, a.pct);
            rows.push([a.id, a.name, a.level || '', a.stage || '', a.status, a.start, a.finish, a.plannedStart, a.plannedFinish, finishVariance(a, this.cal), a.float ?? '',
                a.pct, m ? m.pct : '', m ? m.done : '', m ? m.total : '', c ? c.delta : '', a.scope === 'other' ? 'Not wall work' : a.scope === 'wall' ? 'Wall work' : 'Milestone']);
        }
        const name = (this.schedule.project.id || 'schedule').replace(/[^\w-]+/g, '_');
        downloadCsv(`${name}-progress-${localToday()}.csv`, rows);
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, ProgressExtension);
