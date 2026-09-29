// Demo 03: Install Progress Tracker, with the P6 schedule (Gantt chart and calendar) linked to the walls
// Spec and acceptance criteria: demos/03-progress/README.md
// Viewer3D (setThemingColor, getSelection, isolate, fitToView, SELECTION_CHANGED_EVENT): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Model (getBulkProperties with externalId): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Model/
// Stage colors go through core/client/views.js (3D + 2D plan); selecting walls on the plan selects them in 3D too.
// The schedule: p6.mjs reads the P6 export and links activities to levels and stages; schedule-views.js draws them.
import { loadPropertyMap, getWallData, onModelReady, loadState, saveState, escapeHtml, downloadCsv } from '../../helpers.js';
import { readXlsx } from '../common/xlsx.mjs';
import { readSchedulePdf } from '../common/pdf-reader.mjs';
import { scheduleRows } from '../common/p6-pdf.mjs';
import {
    STAGE_NAMES, demoShift, assignDemoLevels, parseDateText, decodeText, parseXer, scheduleFromXer, scheduleFromRows, parseCsv, calendarOf, linkActivities, matchLevel, matchStage,
    stageCounts, modelProgress, compare, expectedPct, finishVariance, plannedStages, scheduleSpan, ganttRows, completeGroups, fmtDay, addDays, dayMs, monthName,
    randomWallLinks, wallProgress,
} from './p6.mjs';
import { ganttHtml, calendarHtml, SCALES, ganttX } from './schedule-views.js';

const EXTENSION_ID = 'Drywall.Progress';
const STATE_NAME = 'progress';
const SCHEDULE_STATE = 'schedule';
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
const COLOR_MODES = { actual: 'Installed (tracked)', planned: 'Planned on the date (4D)', compare: 'Installed vs plan on the date' };
const COMPARE = { behind: { color: '#d62728', label: 'Behind the plan' }, even: { color: '#59a14f', label: 'On plan' }, ahead: { color: '#1f77b4', label: 'Ahead of the plan' } };
const OTHER = '#8c96a0'; // activities not linked to an install stage (layout, inspections, milestones)
const NOT_YET = '#c9ced6'; // a selected activity's walls not at its stage yet
const SHOW = { all: 'All activities', active: 'In progress', open: 'Not complete', linked: 'Linked to walls', behind: 'Model behind P6', critical: 'Critical (float ≤ 0)' };
// WBS groups: finished ones folded (the default, so the work in progress is near the top), all open, or all folded.
const FOLD = { done: 'Fold finished groups', none: 'Open all groups', all: 'Fold all groups' };
const localToday = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the viewer's time zone

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
        this.gantt = { scale: 'week', show: 'all', links: 'selected', fold: 'done', collapsed: new Set() };
        this.selectedAct = null;
        this.demoMove = true;
        try { this.demoMove = localStorage.getItem('drywall-demos:schedule-demo-shift') !== 'false'; } catch {}
        this.panel.innerHTML = `<div class="demo-panel"><h2>Install Progress Tracker</h2><p class="muted" data-status>Waiting for a model…</p></div>`;
        this.onSelection = () => this.updateSelection();
        this.viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection);
        this.resizer = new ResizeObserver(() => this.fitGantt());
        this.resizer.observe(this.panel);
        this.stops = [
            onModelReady(this.viewer, (model) => this.init(model)),
            this.views.on('level', () => { if (this.walls) this.renderBody(); }),
        ];
        return true;
    }

    unload() {
        this.importController?.abort();
        this.stops.forEach(stop => stop());
        this.stopPlay();
        this.resizer.disconnect();
        this.viewer.removeEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection);
        this.views.clearColors();
        if (this.isolatedBySchedule) this.views.showAll();
        this.panel.classList.remove('wide', 'xwide');
        this.panel.innerHTML = '';
        return true;
    }

    async init(model) {
        this.model = model;
        try {
            const [map, saved, schedule] = await Promise.all([loadPropertyMap(), loadState(STATE_NAME), loadState(SCHEDULE_STATE).catch(() => ({}))]);
            this.map = map;
            this.stages = saved.stages || {};
            this.walls = (await getWallData(model, map)).walls;
            this.byDbId = new Map(this.walls.map(w => [w.dbId, w]));
            this.wallOrder = [...this.walls].sort((a, b) => a.dbId - b.dbId);
            if (schedule?.activities?.length) this.useSchedule(schedule);
            else if (!schedule?.removed) await this.loadSample({ quiet: true }).catch(err => console.warn('Sample schedule:', err.message));
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
        const start = schedule.project.dataDate || localToday();
        this.cursor = this.span ? (start < this.span[0] ? this.span[0] : start > this.span[1] ? this.span[1] : start) : start;
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
            if (this.schedule?.source.demo && this.walls) {
                const byLevel = new Map();
                for (const w of this.wallOrder) if (w.level) (byLevel.get(w.level) || byLevel.set(w.level, []).get(w.level)).push(w.dbId);
                const links = randomWallLinks(this.linkedCache, byLevel, { seed: this.schedule.project.id });
                for (const a of this.linkedCache) {
                    const l = links.get(a.id);
                    if (!l) continue;
                    a.levelHow = a.level ? `${a.levelHow}; demo: ${l.dbIds.length} walls picked on it` : `demo: ${l.dbIds.length} walls picked at random`;
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
        let s, pdfNotes = '';
        if (ext === 'pdf') {
            const doc = await readSchedulePdf(file, { signal: this.importController?.signal, onProgress: message => this.message(message, 'warn') });
            s = scheduleFromRows(scheduleRows(doc), { file: file.name, format: 'pdf', dataDate: parseDateText(doc.dataDate).day });
            pdfNotes = ` PDF: ${doc.warnings.length} import notes; no relationships or calendar in a PDF (Monday–Friday used).`;
            s.source.warnings = doc.warnings;
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
        const linked = this.linked.filter(a => a.level && a.stage).length;
        this.message(`Loaded ${s.activities.length} activities from ${file.name} (${s.source.format}); ${linked} linked to walls.${linked ? '' : ' Link them with 🔗 Links.'}${pdfNotes}`, pdfNotes ? 'warn' : '');
    }

    // Demo: dates moved by whole weeks into this year, shown as this model's project, and P6 locations that match no
    // level assigned to the model's levels in order (p6.mjs demoShift, assignDemoLevels).
    async applyDemoMove(s) {
        const snapshot = await loadState('takeoff-snapshot').catch(() => ({}));
        const moved = demoShift(s, { project: snapshot.project || 'Snowdon Towers (Arch)' });
        const assignments = assignDemoLevels(linkActivities(moved, this.levels), this.levels);
        Object.assign(moved.map.levels, assignments);
        moved.source.demo.levelAssignments = assignments;
        return moved;
    }

    async saveSchedule() {
        try {
            await saveState(SCHEDULE_STATE, this.schedule);
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
        if (text && kind !== 'warn') this.messageTimer = setTimeout(() => { el.hidden = true; this.fitGantt(); }, 8000);
        this.fitGantt();
    }

    // --- Rendering ---------------------------------------------------------------------------------------------------

    render() {
        const s = this.schedule;
        this.panel.innerHTML = `<div class="demo-panel pg">
            <div class="tk-head">
                <div class="tk-bar"><b class="tk-title">Install Progress</b>
                    <div class="tk-tabs">${Object.entries(TABS).map(([k, label]) => `<button data-tab="${k}" class="${k === this.tab ? 'active' : ''}">${label}</button>`).join('')}</div>
                    <span class="pg-info" data-sched-info></span>
                    <span class="tk-spacer"></span>
                    <label class="tk-file" title="A Primavera P6 export: PDF, XER, Excel (.xlsx) or CSV">Upload P6 schedule…<input type="file" data-upload accept=".pdf,.xer,.xlsx,.csv,.txt" ${this.importController ? 'disabled' : ''} hidden></label>
                    <label title="Demo only: move dates by whole weeks and assign unmatched locations to model levels. Shifted holidays are not the new year’s real holidays."><input type="checkbox" data-demo-move ${this.demoMove ? 'checked' : ''}> Demo: this year and this project</label>
                    ${s?.source.demo ? `<span class="tk-src manual" title="Dates moved by whole weeks for the demo; Schedule ▾ Undo restores them">Demo: moved ${s.source.demo.years >= 0 ? '+' : ''}${s.source.demo.years} years (${s.source.demo.shiftDays.toLocaleString()} days) from ${escapeHtml(s.source.demo.originalProject)} (${s.source.demo.originalDataDate ? fmtDay(s.source.demo.originalDataDate) : 'earliest start'})</span>` : ''}
                    ${s ? '<button data-links-toggle title="Which model level and install stage each activity stands for">🔗 Links</button>' : ''}
                    ${document.body.classList.contains('dock-bottom') ? '<button data-dock title="Give the schedule most of the screen; click again to bring the model back">⤢ Expand</button>' : ''}
                    <details class="tk-dd pg-menu"><summary>Schedule</summary><div class="tk-dd-list">
                        ${s?.source.original ? '<a href="#" data-undo-demo>Undo the demo move</a>' : ''}
                        <a href="#" data-sample>Load the sample schedule (made up)</a>
                        <a href="${SAMPLE.url}" download="${SAMPLE.file}">Download the sample .xer</a>
                        ${s ? '<a href="#" data-export>Export CSV (P6 % vs model %)</a><a href="#" data-remove>Remove the schedule…</a>' : ''}
                    </div></details>
                </div>
                ${s ? '<div class="pg-colorbar" data-colorbar></div>' : ''}
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
        p.querySelector('[data-undo-demo]')?.addEventListener('click', async e => { e.preventDefault(); this.stopPlay(); this.useSchedule(structuredClone(this.schedule.source.original)); this.render(); if (await this.saveSchedule()) this.message('Original dates, project and links restored.'); });
        p.querySelector('[data-sample]').onclick = (e) => { e.preventDefault(); this.loadSample().then(() => this.saveSchedule()).catch(err => this.message(err.message, 'warn')); };
        const exp = p.querySelector('[data-export]');
        if (exp) exp.onclick = (e) => { e.preventDefault(); this.exportCsv(); };
        const rem = p.querySelector('[data-remove]');
        if (rem) rem.onclick = async (e) => {
            e.preventDefault();
            if (!confirm('Remove the schedule from this viewer? Wall stages stay.')) return;
            this.clearFocus();
            this.schedule = null;
            this.colorMode = 'actual';
            await saveState(SCHEDULE_STATE, { removed: true, at: new Date().toISOString() }).catch(() => {});
            this.render();
        };
        p.querySelector('[data-dock]')?.addEventListener('click', () => document.dispatchEvent(new CustomEvent('dock-split', { detail: 'toggle' })));
        const lt = p.querySelector('[data-links-toggle]');
        if (lt) lt.onclick = () => { const d = p.querySelector('[data-links]'); d.hidden = !d.hidden; lt.classList.toggle('active', !d.hidden); if (!d.hidden) this.renderLinks(); this.fitGantt(); };
        this.renderInfo();
        this.renderColorBar();
        this.renderBody();
        this.refresh();
    }

    setTab(tab) {
        this.tab = tab;
        const params = new URLSearchParams(location.search);
        if (tab === 'stages') params.delete('tab'); else params.set('tab', tab);
        history.replaceState(null, '', `${location.pathname}?${params}`);
        this.panel.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        this.renderBody();
    }

    renderInfo() {
        const el = this.panel.querySelector('[data-sched-info]');
        if (!el) return;
        const s = this.schedule;
        if (!s) { el.innerHTML = '<span class="muted">No schedule</span>'; return; }
        const linked = this.linked.filter(a => a.level && a.stage).length, random = this.linked.filter(a => a.demoWalls).length;
        el.innerHTML = `<b title="${escapeHtml(s.source.file)}">${escapeHtml(s.project.name)}</b>${s.source.sample ? ' <span class="tk-src gap" title="A made-up P6 schedule for the sample model">sample</span>' : ''}
            <span class="muted">· data date ${s.project.dataDate ? `${fmtDay(s.project.dataDate)}${s.project.estimatedDataDate ? ' (estimated)' : ''}` : '–'} · ${s.activities.length} activities · ${linked} linked to walls${random ? ` (${random} to walls picked at random for the demo)` : ''}</span>`;
    }

    // Model colors: installed stages, the plan on a date (4D), or installed vs plan; a date slider for the last two.
    renderColorBar() {
        const el = this.panel.querySelector('[data-colorbar]');
        if (!el || !this.span) return;
        const days = Math.round((dayMs(this.span[1]) - dayMs(this.span[0])) / 86400000);
        el.innerHTML = `<span class="tk-sl-label">Model colors</span>
            <select data-color-mode>${Object.entries(COLOR_MODES).map(([k, l]) => `<option value="${k}" ${k === this.colorMode ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <input type="range" data-cursor min="0" max="${days}" step="1" value="${Math.round((dayMs(this.cursor) - dayMs(this.span[0])) / 86400000)}" aria-label="Date the model shows the plan for">
            <b data-cursor-label class="pg-cursor-label"></b>
            <button data-play title="Play the plan day by day">▶</button>
            <button data-cursor-dd title="Back to the schedule's data date">Data date</button>
            <span class="pg-legend" data-color-legend></span>`;
        el.querySelector('[data-color-mode]').onchange = (e) => { this.colorMode = e.target.value; this.clearFocus(); this.refresh(); this.renderBody(); };
        el.querySelector('[data-cursor]').oninput = (e) => this.setCursor(addDays(this.span[0], Number(e.target.value)));
        el.querySelector('[data-play]').onclick = () => (this.playTimer ? this.stopPlay() : this.play());
        el.querySelector('[data-cursor-dd]').onclick = () => this.setCursor(this.schedule.project.dataDate || localToday(), { move: true });
        this.updateCursorUi();
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

    play() {
        this.setCursor(this.cursor >= this.span[1] ? this.span[0] : this.cursor);
        this.playTimer = setInterval(() => {
            let next = addDays(this.cursor, 1);
            while (next < this.span[1] && !this.cal.isWork(next)) next = addDays(next, 1);
            if (next >= this.span[1]) { this.setCursor(this.span[1]); this.stopPlay(); return; }
            this.setCursor(next, { move: true });
        }, 280);
        this.updateCursorUi();
    }

    stopPlay() {
        clearInterval(this.playTimer);
        this.playTimer = null;
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
            body.innerHTML = `<div class="pg-empty"><p>No schedule loaded.</p>
                <p><button data-sample2>Load the sample P6 schedule</button> <span class="muted">(made up, for the sample model)</span></p>
                <p class="muted">Or upload your own P6 export above: an .xer file, or a layout exported to Excel (.xlsx) or CSV with Activity ID, Activity Name, Start and Finish columns.</p></div>`;
            body.querySelector('[data-sample2]').onclick = () => this.loadSample().then(() => this.saveSchedule()).catch(err => this.message(err.message, 'warn'));
            return;
        }
        if (this.tab === 'gantt') this.renderGantt(body);
        else if (this.tab === 'calendar') this.renderCalendar(body);
        else this.renderStages(body);
        this.renderInfo();
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
            await saveState(STATE_NAME, { stages, updatedAt: new Date().toISOString() });
            if (saved) saved.textContent = `Saved ${new Date().toLocaleTimeString()}`;
        } catch (err) {
            if (saved) saved.innerHTML = `<span class="warn">Not saved: ${escapeHtml(err.message)}</span>`;
        }
    }

    // The selected activity when its walls are shown (it has a level).
    focusActivity() {
        const a = this.selectedAct && this.activity(this.selectedAct);
        return a?.level ? a : null;
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
        if (focus) {
            // A selected activity: its level's walls at its stage (or later) in the stage's color, the rest grey.
            colors.clear();
            const k = STAGE_NAMES.indexOf(focus.stage), st = STAGES[k];
            if (st?.color) for (const w of this.wallsOf(focus)) colors.set(w.dbId, this.stageIndex(w) >= k ? st.color : NOT_YET);
        } else if (this.schedule && this.colorMode !== 'actual') {
            colors.clear();
            // The plan says how many walls of a level should be at a stage, not which: the walls furthest along are
            // taken first, so a wall shows "behind" only when its level has fewer walls at that stage than planned.
            const ranked = [...this.wallOrder].sort((a, b) => this.stageIndex(b) - this.stageIndex(a));
            const planned = plannedStages(ranked, this.linked.filter(a => !a.demoWalls), this.cursor, this.cal);
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
        const level = this.views.level?.name;
        return this.linked.filter(a => {
            if (level && a.level !== level && !(a.type === 'start' || a.type === 'finish')) return false;
            if (show === 'active') return a.status === 'active';
            if (show === 'linked') return !!(a.level && a.stage);
            if (show === 'open') return a.status !== 'complete';
            if (show === 'critical') return a.status !== 'complete' && a.float != null && a.float <= 0;
            if (show === 'behind') return compare(this.modelOf(a), a.pct)?.state === 'behind';
            return true;
        });
    }

    selectActivity(id) {
        this.selectedAct = this.selectedAct === id ? null : id;
        this.reveal = !!this.selectedAct;
        const a = this.focusActivity();
        if (a) {
            const ids = this.wallsOf(a).map(w => w.dbId);
            this.views.isolate(ids);
            this.views.showPlanFor(ids);
            this.isolatedBySchedule = true;
        } else if (this.isolatedBySchedule) {
            this.views.showAll();
            this.isolatedBySchedule = false;
        }
        this.refresh();
        this.renderBody();
    }

    clearFocus() {
        if (!this.selectedAct) return;
        this.selectedAct = null;
        if (this.isolatedBySchedule) { this.views.showAll(); this.isolatedBySchedule = false; }
    }

    // --- Gantt tab -----------------------------------------------------------------------------------------------------

    renderGantt(body) {
        const old = body.querySelector('[data-gantt]'), keep = old ? [old.scrollLeft, old.scrollTop] : null;
        this.counts ??= stageCounts(this.walls, w => this.stageOf(w));
        const level = this.views.level?.name;
        const rows = ganttRows(this.visibleActivities(this.gantt.show), this.schedule, { collapsed: this.gantt.collapsed });
        const html = ganttHtml({
            rows, span: this.span, scale: this.gantt.scale, cal: this.cal, dataDate: this.schedule.project.dataDate, today: localToday(),
            cursor: this.colorMode === 'actual' ? null : this.cursor, selectedId: this.selectedAct, linkMode: this.gantt.links, links: this.schedule.links,
            colorOf: (a) => this.colorOf(a), modelOf: (a) => this.modelOf(a), cmpOf: (a) => compare(this.modelOf(a), a.pct),
        });
        body.innerHTML = `<div class="pg-tools">
                <div class="tk-tabs">${Object.entries(SCALES).map(([k, s]) => `<button data-scale="${k}" class="${k === this.gantt.scale ? 'active' : ''}">${s.label}</button>`).join('')}</div>
                <label class="tk-sl-label">Show</label><select data-show>${Object.entries(SHOW).map(([k, l]) => `<option value="${k}" ${k === this.gantt.show ? 'selected' : ''}>${l}</option>`).join('')}</select>
                <label class="tk-sl-label">Links</label><select data-linkmode>${[['selected', 'Of the selected activity'], ['all', 'All'], ['none', 'None']].map(([k, l]) => `<option value="${k}" ${k === this.gantt.links ? 'selected' : ''}>${l}</option>`).join('')}</select>
                <button data-today>Today</button>
                <select data-fold title="Fold WBS groups (click a group's row to fold or open just that one)">${Object.entries(FOLD).map(([k, l]) => `<option value="${k}" ${k === this.gantt.fold ? 'selected' : ''}>${l}</option>`).join('')}</select>
                <span class="muted">${level ? `Level ${escapeHtml(level)} · <a href="#" data-all-levels>all levels</a>` : 'All levels'} · click an activity for its walls</span>
                <span class="tk-spacer"></span>
                <span class="pg-key"><i class="k-bl"></i>planned <i class="k-bar"></i>current <i class="k-done"></i>P6 % done <i class="k-model"></i>model % <i class="k-crit"></i>critical <b>◆</b> milestone</span>
            </div>
            <div class="pg-main ${this.sideDetails ? 'side' : ''}">
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
            // First view: the data date a third of the way across, and the first work in progress (with its group) at the top.
            this.scrollGanttTo(this.schedule.project.dataDate || localToday(), { always: true });
            let row = g.querySelector('.pg-g-row.st-active');
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
        if (main && main.classList.contains('side') !== this.sideDetails) main.classList.toggle('side', this.sideDetails);
        const g = this.panel.querySelector('[data-gantt]');
        if (!g) return;
        // A narrow chart drops the Start, Finish and Dur columns (the bars show the dates) to leave room for the bars.
        g.querySelector('.pg-gantt')?.classList.toggle('compact', g.clientWidth < 1150);
        const room = `${Math.max(180, this.panel.getBoundingClientRect().bottom - g.getBoundingClientRect().top - 12)}px`;
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
                <button data-month="-1" aria-label="Previous month">‹</button><b class="pg-month">${monthName(`${this.calMonth}-01`)}</b><button data-month="1" aria-label="Next month">›</button>
                <button data-cal-today>Today</button><button data-cal-dd>Data date</button>
                <span class="muted">${level ? `Level ${escapeHtml(level)} · <a href="#" data-all-levels>all levels</a>` : 'All levels'} · click a day to see the model as planned that day; click an activity for its walls</span>
                <span class="tk-spacer"></span>
                <span class="pg-key">${STAGES.filter(s => s.color).map(s => `<i style="background:${s.color}"></i>${s.name}`).join(' ')} <i style="background:${OTHER}"></i>other <b>◆</b> milestone</span>
            </div>
            <div class="pg-main ${this.sideDetails ? 'side' : ''}"><div class="pg-cal-wrap">
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
        if (!a) { el.innerHTML = ''; return; }
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
            <div class="pg-d-head"><span class="swatch" style="background:${this.colorOf(a)}"></span><b>${escapeHtml(a.id)}</b> ${escapeHtml(a.name)} ${status}
                ${a.float != null && a.status !== 'complete' ? `<span class="tk-src ${a.float <= 0 ? 'bad' : ''}">float ${a.float} d${a.float <= 0 ? ' · critical' : ''}</span>` : ''}
                <span class="tk-spacer"></span>
                ${a.level ? '<button data-show-level title="Cut the model at this level and open its plan">Show the level</button><button data-select-walls title="Select this level\'s walls, then set their stage on the Stages tab">Select its walls</button>' : ''}
                <button data-clear-act title="Show every wall again">✕</button></div>
            <div class="pg-d-facts">
                <span><b>Dates</b> ${fmtDay(a.start)}${a.actualStart ? ' A' : ''} → ${fmtDay(a.finish)}${a.actualFinish ? ' A' : ''}${ms ? '' : ` · ${Math.round(a.dur)} d${a.status === 'active' ? `, ${Math.round(a.rem)} d left` : ''}`}</span>
                <span><b>Planned</b> ${fmtDay(a.plannedStart)} → ${fmtDay(a.plannedFinish)} · ${v > 0 ? `<span class="warn">finish ${v} d late</span>` : v < 0 ? `${-v} d early` : 'on time'}</span>
                ${ms ? '' : `<span><b>Progress</b> P6 ${a.pct == null ? 'not printed' : a.pct + '%'}${plannedByDd != null ? ` <span class="muted">(plan: ${plannedByDd}% by the data date)</span>` : ''} · model ${m ? `<span class="pg-cmp ${c.state}">${m.pct}%</span> <span class="muted">${m.done} of ${m.total} walls ${escapeHtml(a.stage)} or later</span>${c.state === 'behind' ? ` <span class="warn">model ${-c.delta} pts behind P6</span>` : c.state === 'ahead' ? ` <span class="muted">model ${c.delta} pts ahead of P6</span>` : ''}` : '<span class="muted">not linked to walls</span>'}</span>`}
                <span><b>Level</b> <select data-own="level">${levelOptions}</select> <span class="muted">${escapeHtml(a.levelHow || '')}</span></span>
                ${ms ? '' : `<span><b>Stage</b> <select data-own="stage">${stageOptions}</select> <span class="muted">${escapeHtml(a.stageHow || '')}</span></span>`}
                ${Object.keys(a.codes || {}).length ? `<span><b>Codes</b> ${Object.entries(a.codes).map(([k, val]) => `${escapeHtml(k)}: ${escapeHtml(val)}`).join(' · ')}</span>` : ''}
                <span><b>Predecessors</b> ${preds.map(l => rel(l, l.from)).join(', ') || '<span class="muted">none</span>'}</span>
                <span><b>Successors</b> ${succs.map(l => rel(l, l.to)).join(', ') || '<span class="muted">none</span>'}</span>
            </div></div>`;
        el.querySelectorAll('[data-goto]').forEach(x => x.onclick = (e) => { e.preventDefault(); this.selectActivity(x.dataset.goto); });
        el.querySelector('[data-clear-act]').onclick = () => this.selectActivity(a.id);
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
        if (!focus && this.isolatedBySchedule) { this.views.showAll(); this.isolatedBySchedule = false; }
        this.refresh();
        this.renderInfo();
        this.renderLinks();
        this.renderBody();
    }

    exportCsv() {
        this.counts ??= stageCounts(this.walls, w => this.stageOf(w));
        const rows = [['Activity ID', 'Activity Name', 'Level', 'Install stage', 'Status', 'Start', 'Finish', 'Planned Start', 'Planned Finish', 'Finish variance (d)', 'Total float (d)',
            'P6 % complete', 'Model % complete', 'Walls at stage', 'Walls on level', 'Model - P6 (pts)']];
        for (const a of this.linked) {
            const m = this.modelOf(a), c = compare(m, a.pct);
            rows.push([a.id, a.name, a.level || '', a.stage || '', a.status, a.start, a.finish, a.plannedStart, a.plannedFinish, finishVariance(a, this.cal), a.float ?? '',
                a.pct, m ? m.pct : '', m ? m.done : '', m ? m.total : '', c ? c.delta : '']);
        }
        const name = (this.schedule.project.id || 'schedule').replace(/[^\w-]+/g, '_');
        downloadCsv(`${name}-progress-${localToday()}.csv`, rows);
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, ProgressExtension);
