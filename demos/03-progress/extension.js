// Demo 03: Install Progress Tracker
// Spec and acceptance criteria: demos/03-progress/README.md
// Viewer3D (setThemingColor, getSelection, SELECTION_CHANGED_EVENT): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Model (getBulkProperties with externalId): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Model/
// Stage colors go through core/client/views.js (3D + 2D plan); selecting walls on the plan selects them in 3D too.
import { loadPropertyMap, getWallData, onModelReady, loadState, saveState, escapeHtml } from '../../helpers.js';

const EXTENSION_ID = 'Drywall.Progress';
const STATE_NAME = 'progress';
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

class ProgressExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.panel = this.options.panel;
        this.panel.classList.add('wide'); // room for the per-level stage pickers
        this.stages = {}; // externalId -> stage name (walls without an entry are "Not started")
        this.selected = [];
        this.panel.innerHTML = `<div class="demo-panel"><h2>Install Progress Tracker</h2><p class="muted" data-status>Waiting for a model…</p></div>`;
        this.onSelection = () => this.updateSelection();
        this.viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection);
        this.stops = [
            onModelReady(this.viewer, (model) => this.init(model)),
            this.views.on('level', () => { if (this.walls) this.render(); }),
        ];
        return true;
    }

    unload() {
        this.stops.forEach(stop => stop());
        this.viewer.removeEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection);
        this.views.clearColors();
        this.panel.classList.remove('wide');
        this.panel.innerHTML = '';
        return true;
    }

    async init(model) {
        this.model = model;
        try {
            const [map, saved] = await Promise.all([loadPropertyMap(), loadState(STATE_NAME)]);
            this.map = map;
            this.stages = saved.stages || {};
            this.walls = (await getWallData(model, map)).walls;
            this.byDbId = new Map(this.walls.map(w => [w.dbId, w]));
            this.render();
        } catch (err) {
            this.panel.querySelector('[data-status]').textContent = `Could not load progress: ${err.message || err}`;
        }
    }

    stageOf(wall) {
        return this.stages[wall.externalId] || STAGES[0].name;
    }

    // Level names in elevation order when known (views.levels), else by name.
    get levels() {
        const names = new Set(this.walls.map(w => w.level ?? NOT_SET));
        const ordered = this.views.levels.map(l => l.name).filter(n => names.has(n));
        return [...ordered, ...[...names].filter(n => !ordered.includes(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))];
    }

    render() {
        const level = this.views.level?.name;
        this.panel.innerHTML = `<div class="demo-panel"><h2>Install Progress Tracker</h2>
            <p class="muted">Set a whole level from the table below, or select walls in 3D or on the plan (Ctrl+click for several) and press a stage.</p>
            <div class="row"><button data-select-level ${level ? '' : 'disabled'}>Select all walls on ${level ? escapeHtml(level) : 'the level'}</button>
                ${level ? '' : '<span class="muted">Pick a level in the header first.</span>'}</div>
            <p data-selection class="muted"></p>
            <div class="row">${STAGES.map(s => `<button data-stage="${s.name}" disabled>${s.color ? `<span class="swatch" style="background:${s.color}"></span>` : ''}${s.name}</button>`).join('')}</div>
            <h3>Stage legend</h3><table><tbody data-legend></tbody></table>
            <h3>Progress by level <span class="muted">(click a level to view it; % = Finished ÷ all walls)</span></h3>
            <table><thead><tr><th>Level</th><th style="width:28%">Stages</th><th class="num">Finished</th><th>Set level</th></tr></thead><tbody data-levels></tbody></table>
            <div class="row"><button data-reset>Reset all stages…</button> <span class="muted" data-saved></span> <button data-undo hidden>Undo</button></div>
            <p class="note">Single user. Saved to a local JSON file (data/progress.json), not synced to any cloud system.</p></div>`;
        this.panel.querySelectorAll('[data-stage]').forEach(b => b.onclick = () => this.setStage(b.dataset.stage));
        this.panel.querySelector('[data-select-level]').onclick = () => {
            this.views.select(this.walls.filter(w => (w.level ?? NOT_SET) === level).map(w => w.dbId));
        };
        this.panel.querySelector('[data-reset]').onclick = () => {
            if (confirm('Clear the install stage of every wall?')) this.setStages({}, { undo: true });
        };
        this.panel.querySelector('[data-undo]').onclick = () => { if (this.undoStages) this.setStages(this.undoStages); };
        this.updateSelection();
        this.refresh();
    }

    updateSelection() {
        if (!this.walls) return;
        this.selected = this.viewer.getSelection().map(id => this.byDbId.get(id)).filter(Boolean);
        const out = this.panel.querySelector('[data-selection]');
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
        this.panel.querySelector('[data-undo]').hidden = !this.undoStages;
        try {
            await saveState(STATE_NAME, { stages, updatedAt: new Date().toISOString() });
            saved.textContent = `Saved ${new Date().toLocaleTimeString()}`;
        } catch (err) {
            saved.innerHTML = `<span class="warn">Not saved: ${escapeHtml(err.message)}</span>`;
        }
    }

    // Re-theme walls and rebuild the legend and per-level percentages.
    refresh() {
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
        this.views.setColors(colors);
        this.panel.querySelector('[data-legend]').innerHTML = STAGES.map(s =>
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
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, ProgressExtension);
