// Demo 04: Field QC punch list, for the field on an iPad: big buttons and plain words (text size A / A+ / A++), stamps
// as on a PlanGrid sheet (a code in a colored circle, ringed in its status color: open, in review, closed), photos
// taken with the iPad's camera, and a daily or weekly report (PDF: counts, each floor's plan with its stamps, each item
// with a close-up of the plan and its photos) to send from the iPad's share sheet. Optionally the walls colored by
// install progress (Install Progress, Demo 3: installed; planned for the day; installed vs plan), read only. Review in
// Revizto: a concept of Field QC and Revizto as one (core/client/revizto-concept.js): the Revizto issue each item would
// be, where that is doable with the right access; nothing is sent (the live integration is shelved).
// Spec and acceptance criteria: demos/04-punch/README.md. Items and reports: punch.mjs, report.mjs (tested).
// Data Visualization sprites (the stamps in 3D and on the plan): https://aps.autodesk.com/en/docs/dataviz/v1/developers_guide/examples/sprites/
// Sprite events: https://aps.autodesk.com/en/docs/dataviz/v1/developers_guide/sprite-events/
// DataVisualization reference: https://aps.autodesk.com/en/docs/dataviz/v1/reference/DataVisualization/DataVisualization/
// MarkupsCore: https://aps.autodesk.com/en/docs/viewer/v7/reference/Extensions/MarkupsCore/
// Viewer3D (clientToWorld, hitTest, getState, restoreState, fitToView, worldToClient, getScreenShot):
//   https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Navigation (setView, getTarget, getEyeVector, setPivotPoint): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Navigation/
// Web: the camera / photo library through <input type="file" accept="image/*" capture="environment">
//   (https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/capture), createImageBitmap, the share sheet
//   (navigator.share with files: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share).
import { loadPropertyMap, getWallData, onModelReady, loadState, saveState, downloadCsv, escapeHtml, buildingCenter, stateFor } from '../../helpers.js';
import { DemoToolbar } from '../../toolbar.js';
import { STAMPS, STATUSES, ASSIGNEES, stampOf, statusOf, upgradeItem, nextNumber, setStatus, periodOf, reportData, summaryText, periodText, reportTitle, stampSvg, fitSize, itemLabel } from './punch.mjs';
import { reportPages } from './report.mjs';
import { issueFields } from './revizto-map.mjs';
import { reviztoButton, showReviztoConcept, REVIZTO_API } from '../../revizto-concept.js';
import { toPdfPages } from '../06-shop-drawings/pdf.mjs';
import { linkActivities, calendarOf, plannedStages, STAGE_NAMES } from '../03-progress/p6.mjs';

const EXTENSION_ID = 'Drywall.Punch';
const STATE_NAME = 'punch';
const MARKUP_TOOLS = { Arrow: 'EditModeArrow', Cloud: 'EditModeCloud', Text: 'EditModeText' };
const MARKUP_LAYER = 'punch';
const DATAVIZ = 'Autodesk.DataVisualization';
// Install stages as Install Progress (Demo 3) colors them; installed vs plan the same.
const STAGE_COLORS = [null, '#f2c14e', '#4e79a7', '#b07aa1', '#59a14f'];
const COMPARE = { behind: { color: '#d62728', name: 'Behind the plan' }, even: { color: '#59a14f', name: 'On plan' }, ahead: { color: '#1f77b4', name: 'Ahead of the plan' } };
const PROGRESS = { off: 'Off', installed: 'Installed', planned: 'Planned', compare: 'vs plan' };
const SIZES = { normal: 'A', large: 'A+', xlarge: 'A++' };
const localToday = () => new Date().toLocaleDateString('en-CA');
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem(`drywall-demos:punch-${k}`); localStorage.setItem(`drywall-demos:punch-${k}`, v); } catch { /* storage blocked */ } return null; };
const guidOf = (model) => model?.getDocumentNode()?.data?.guid;
const ago = (iso) => {
    const d = Math.round((Date.now() - new Date(iso)) / 86400000);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};
const photoId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const nextFrame = (ms = 0) => new Promise(r => setTimeout(r, ms));

class PunchExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.panel = this.options.panel;
        this.panel.classList.add('wide');
        this.items = [];
        this.screen = 'list'; // list | stamp | place | form | item | report
        this.filter = { status: 'open', floor: false };
        this.size = SIZES[pref('size')] ? pref('size') : 'large';
        this.progress = PROGRESS[pref('progress')] ? pref('progress') : 'off';
        this.photoCache = new Map(); // photo id -> { thumb, full, w, h }
        this.sprites = { '3d': new Map(), '2d': new Map() }; // sprite dbId -> item id, per view
        this.spriteStyles = new Map(); // stamp|status -> DataViz style (an SVG blob URL each)
        this.taps = new Map();
        this.panel.innerHTML = '<div class="demo-panel pq"><h2>Field QC</h2><p class="muted" data-status>Waiting for a model…</p></div>';
        this.onSprite = (kind) => (ev) => {
            const item = this.items.find(i => i.id === this.sprites[kind].get(ev.dbId));
            if (!item || this.taps.size) return;
            this.openItem(item.id);
            if (kind === '2d') this.jumpTo3d(item); // from the plan: show where it is in 3D
        };
        this.onSprite3d = this.onSprite('3d');
        this.onSprite2d = this.onSprite('2d');
        this.views.use2d(DATAVIZ, {});
        this.views.setPlanPop(false); // the stamps on the plan stay as drawn (the walls under them share their colors)
        this.bindPanel();
        this.stops = [
            onModelReady(this.viewer, (model) => this.init(model)),
            this.views.on('viewer2d', (viewer2d) => { viewer2d.addEventListener('DATAVIZ_OBJECT_CLICK', this.onSprite2d); this.viewer2dClickBound = viewer2d; }),
            this.views.on('sheet', () => { if (!this.capturing) this.refresh2dSprites(); }),
            this.views.on('level', () => { if (this.dataViz && this.screen === 'list') this.renderScreen(); }),
            this.views.on('ready', () => { this.linked = null; if (this.walls && this.progress !== 'off') this.refreshAll(); }), // the floors: the schedule links to them
        ];
        return true;
    }

    unload() {
        this.stops.forEach(stop => stop());
        this.listening?.abort();
        this.setPlacing(false);
        this.bar?.remove();
        this.viewerBox?.remove();
        if (this.dataViz) this.viewer.removeEventListener(Autodesk.DataVisualization.Core.MOUSE_CLICK, this.onSprite3d);
        this.viewer2dClickBound?.removeEventListener('DATAVIZ_OBJECT_CLICK', this.onSprite2d);
        this.dataViz?.removeAllViewables();
        this.views.viewer2d?.getExtension(DATAVIZ)?.removeAllViewables();
        for (const s of this.spriteStyles.values()) URL.revokeObjectURL(s.url);
        this.views.clearColors();
        this.views.setPlanPop(true);
        this.markups?.hide();
        this.panel.classList.remove('wide', 'pq-size-large', 'pq-size-xlarge');
        this.panel.innerHTML = '';
        return true;
    }

    // Extension.onToolbarCreated: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Extension/
    onToolbarCreated() {
        if (this.bar) return;
        this.bar = new DemoToolbar(this.viewer, 'dw-punch', [
            { key: 'add', icon: 'dw-icon-pin-add', tip: 'New item: pick a stamp, then tap the wall', run: () => this.startNew(), on: () => this.screen === 'stamp' || this.screen === 'place' },
            { key: 'next', icon: 'dw-icon-pin-next', tip: 'Go to the next open item', run: () => this.nextOpen() },
        ]);
    }

    async init(model) {
        this.model = model;
        try {
            this.stateName = await stateFor(STATE_NAME); // per model (the sample model keeps 'punch')
            const [map, saved, progress, schedule] = await Promise.all([loadPropertyMap(), loadState(this.stateName),
                loadState(await stateFor('progress')).catch(() => ({})), loadState(await stateFor('schedule')).catch(() => ({}))]);
            this.items = (saved.items || []).map(upgradeItem);
            const walls = (await getWallData(model, map)).walls;
            this.walls = walls;
            this.byDbId = new Map(walls.map(w => [w.dbId, w]));
            const byExternalId = new Map(walls.map(w => [w.externalId, w.dbId]));
            this.items.forEach(i => { i.dbId ??= byExternalId.get(i.externalId); });
            this.install = progress?.stages || {};
            this.asOf = progress?.asOf || '';
            this.schedule = schedule?.activities?.length ? schedule : null;
            this.project = document.querySelector('#models option:checked')?.textContent || 'This project';
            this.dataViz = await this.viewer.loadExtension(DATAVIZ);
            this.viewer.addEventListener(Autodesk.DataVisualization.Core.MOUSE_CLICK, this.onSprite3d);
            this.render();
            await this.refreshAll();
        } catch (err) {
            console.error(err);
            this.panel.querySelector('[data-status]').textContent = `Could not start Field QC: ${err.message || err}`;
        }
    }

    get you() {
        try { return localStorage.getItem('cas-panel-name') || ''; } catch { return ''; } // the panel pages' name too
    }

    set you(name) {
        try { localStorage.setItem('cas-panel-name', String(name || '').trim().slice(0, 80)); } catch { /* storage blocked */ }
    }

    // --- The panel: one screen at a time, big buttons --------------------------------------------------------------

    bindPanel() {
        const p = this.panel, on = { signal: (this.listening = new AbortController()).signal };
        p.addEventListener('click', (e) => {
            const t = e.target.closest?.('[data-act]');
            if (!t) return;
            const v = t.dataset.v;
            ({
                new: () => this.startNew(), stamp: () => this.pickStamp(v), cancel: () => this.cancelNew(), list: () => this.show('list'), open: () => this.openItem(v),
                status: () => this.changeStatus(v), filter: () => { this.filter.status = v; this.renderScreen(); }, floor: () => { this.filter.floor = !this.filter.floor; this.renderScreen(); },
                save: () => this.saveDraft(), size: () => this.setSize(v), progress: () => this.setProgress(v), report: () => this.show('report'),
                period: () => { this.reportKind = v; this.renderScreen(); }, make: () => this.makeReport(), share: () => this.shareReport(), download: () => this.downloadReport(),
                email: () => this.emailSummary(), copy: () => this.copySummary(), csv: () => this.exportCsv(), plan: () => this.showOnPlan(this.current), jump: () => this.jumpTo3d(this.current),
                photo: () => this.openPhoto(v), unphoto: () => this.removePhoto(v), del: () => this.deleteItem(), draw: () => this.startMarkup(this.current),
                'show-markup': () => this.toggleMarkup(this.current), tool: () => this.setMarkupTool(v), 'markup-save': () => this.finishMarkup(true), 'markup-cancel': () => this.finishMarkup(false),
                'use-picked': () => this.placeOnPicked(),
                revizto: () => this.show('revizto'), 'rz-item': () => this.rzItem(this.current), 'rz-all': () => this.rzAll(), 'rz-status': () => this.rzStatus(),
                'rz-stamps': () => this.rzStamps(),
            })[t.dataset.act]?.();
        }, on);
        p.addEventListener('change', (e) => {
            const t = e.target;
            if (t.matches('[data-photos]')) { const files = [...t.files]; t.value = ''; this.addPhotos(files); }
            else if (t.matches('[data-you]')) this.you = t.value;
            else if (t.matches('[data-field]')) {
                const target = this.screen === 'form' ? this.draft : this.current;
                if (!target) return;
                target[t.dataset.field] = t.value;
                if (this.screen === 'item') this.save();
            } else if (t.matches('[data-range]')) { this.range = { ...this.range, [t.dataset.range]: t.value }; this.reportKind = 'range'; }
            else if (t.matches('[data-opt]')) this.reportOpts = { ...this.reportOpts, [t.dataset.opt]: t.checked };
        }, on);
    }

    render() {
        this.panel.classList.remove('pq-size-large', 'pq-size-xlarge');
        if (this.size !== 'normal') this.panel.classList.add(`pq-size-${this.size}`);
        this.panel.innerHTML = `<div class="demo-panel pq">
            <header class="pq-head">
                <div class="pq-titles"><b>Field QC</b><span>${escapeHtml(this.project)} · ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span></div>
                <div class="pq-size" role="group" aria-label="Text size">${Object.entries(SIZES).map(([k, l]) => `<button data-act="size" data-v="${k}" class="${k === this.size ? 'on' : ''}" aria-label="Text size ${l}">${l}</button>`).join('')}</div>
            </header>
            <nav class="pq-actions">
                <button class="pq-big pq-primary" data-act="new"><i>＋</i>New item</button>
                <button class="pq-big" data-act="list"><i>☰</i>Items</button>
                <button class="pq-big" data-act="report"><i>📄</i>Report</button>
                <button class="pq-big" data-act="revizto"><i>🔁</i>Revizto</button>
            </nav>
            <div class="pq-progress" role="group" aria-label="Show progress"><span>Show progress</span>${Object.entries(PROGRESS).map(([k, l]) => {
                const needs = (k === 'planned' || k === 'compare') && !this.schedule;
                return `<button data-act="progress" data-progress="${k}" data-v="${k}" class="${k === this.progress ? 'on' : ''}" ${needs ? 'disabled title="Needs a schedule (Install Progress)"' : ''}>${l}</button>`;
            }).join('')}</div>
            <div data-legend></div>
            <section data-screen></section>
        </div>`;
        this.renderLegend();
        this.renderScreen();
    }

    show(screen) {
        if (this.screen === 'place') this.setPlacing(false);
        this.screen = screen;
        this.renderScreen();
        this.bar?.refresh();
    }

    renderScreen() {
        const el = this.panel.querySelector('[data-screen]');
        if (!el) return;
        this.panel.querySelectorAll('.pq-actions [data-act]').forEach(b => b.classList.toggle('on', (b.dataset.act === 'list' && ['list', 'item'].includes(this.screen)) || (b.dataset.act === 'report' && this.screen === 'report') || (b.dataset.act === 'revizto' && this.screen === 'revizto') || (b.dataset.act === 'new' && ['stamp', 'place', 'form'].includes(this.screen))));
        el.innerHTML = ({ list: () => this.listHtml(), stamp: () => this.stampHtml(), place: () => this.placeHtml(), form: () => this.formHtml(), item: () => this.itemHtml(), report: () => this.reportHtml(), revizto: () => this.reviztoHtml() })[this.screen]?.() || '';
        if (this.screen === 'form' || this.screen === 'item') this.fillThumbs();
    }

    badge(item, size = 48) {
        const s = stampOf(item.stamp), st = statusOf(item.status);
        return `<span class="pq-badge" style="--s:${item.status === 'closed' ? '#9aa0a6' : s.color};--st:${st.color};--z:${size}px" aria-hidden="true">${escapeHtml(s.code)}</span>`;
    }

    // The items: by status (open first), only this floor if asked; one big row each.
    listHtml() {
        const level = this.views.level?.name, floor = this.filter.floor && level;
        const pool = this.items.filter(i => !floor || i.level === level);
        const count = (k) => pool.filter(i => k === 'all' || i.status === k).length;
        const shown = pool.filter(i => this.filter.status === 'all' || i.status === this.filter.status).sort((a, b) => b.number - a.number);
        const tabs = [...STATUSES.map(s => [s.key, s.name, s.color]), ['all', 'All', '#1f3b57']];
        return `<div class="pq-tabs" role="tablist">${tabs.map(([k, l, c]) => `<button role="tab" data-act="filter" data-v="${k}" class="${this.filter.status === k ? 'on' : ''}" style="--c:${c}">${l}<b>${count(k)}</b></button>`).join('')}</div>
            ${level ? `<button class="pq-toggle ${this.filter.floor ? 'on' : ''}" data-act="floor"><i>${this.filter.floor ? '☑' : '☐'}</i>Only ${escapeHtml(level)}</button>` : ''}
            <ul class="pq-list">${shown.map(i => `<li><button data-act="open" data-v="${escapeHtml(i.id)}" class="${i.id === this.selectedId ? 'sel' : ''}">${this.badge(i)}
                <span class="pq-li"><b>#${i.number} ${escapeHtml(stampOf(i.stamp).name)}</b><em>${escapeHtml(i.note || 'No note')}</em>
                <small>${escapeHtml(i.level || 'No floor')}${i.assignee ? ` · ${escapeHtml(i.assignee)}` : ''} · ${ago(i.createdAt)}${i.photos.length ? ` · 📷 ${i.photos.length}` : ''}</small></span>
                <span class="pq-pill" style="--c:${statusOf(i.status).color}">${statusOf(i.status).name}</span></button></li>`).join('')
                || `<li class="pq-empty">${this.items.length ? 'Nothing here.' : 'No items yet.'} Tap <b>New item</b> to add one.</li>`}</ul>`;
    }

    // New item, step 1: the stamp.
    stampHtml() {
        return `<h3 class="pq-step"><span>1</span>What kind of item?</h3>
            <div class="pq-stamps">${STAMPS.map(s => `<button data-act="stamp" data-v="${escapeHtml(s.code)}">${this.badge({ stamp: s.code, status: 'open' }, 56)}<span>${escapeHtml(s.name)}</span></button>`).join('')}</div>
            <button class="pq-big pq-quiet" data-act="cancel">Cancel</button>`;
    }

    // Step 2: tap where it is.
    placeHtml() {
        const picked = this.viewer.getSelection().length === 1 && this.byDbId.get(this.viewer.getSelection()[0]);
        return `<h3 class="pq-step"><span>2</span>Tap where it is</h3>
            <div class="pq-banner">${this.badge({ stamp: this.draft.stamp, status: 'open' }, 56)}<p>Tap the wall <b>on the plan</b> or <b>in the 3D view</b>.<br><span class="muted">${escapeHtml(this.placeNote || 'You can move and zoom first: a tap places it, a drag does not.')}</span></p></div>
            ${picked ? `<button class="pq-big" data-act="use-picked">Use the wall that is picked (${escapeHtml(picked.level || '')})</button>` : ''}
            <button class="pq-big pq-quiet" data-act="cancel">Cancel</button>`;
    }

    // Step 3: what, who, photos.
    formHtml() {
        const d = this.draft, w = d.wall;
        return `<h3 class="pq-step"><span>3</span>Describe it</h3>
            <div class="pq-where">${this.badge({ stamp: d.stamp, status: 'open' }, 48)}<div><b>${escapeHtml(stampOf(d.stamp).name)}</b><span>${escapeHtml([w?.level, w?.wallType, d.where].filter(Boolean).join(' · '))}</span></div></div>
            <label class="pq-label">What needs fixing?
                <textarea data-field="note" rows="3" placeholder="For example: 2 ft crack at the door head. (Tap the microphone on the keyboard to talk.)">${escapeHtml(d.note || '')}</textarea></label>
            ${this.photoButtons()}
            <div class="pq-thumbs" data-thumbs></div>
            <label class="pq-label">Who fixes it?
                <input data-field="assignee" list="pq-assignees" value="${escapeHtml(d.assignee || '')}" placeholder="Pick or type a name"></label>
            <datalist id="pq-assignees">${ASSIGNEES.map(a => `<option value="${escapeHtml(a)}">`).join('')}</datalist>
            <div class="pq-row2">
                <label class="pq-label">Fix by (date, if any)<input type="date" data-field="due" value="${escapeHtml(d.due || '')}"></label>
                <label class="pq-label">Your name<input data-you value="${escapeHtml(this.you)}" placeholder="Your name"></label>
            </div>
            <button class="pq-big pq-go" data-act="save"><i>✓</i>Save item</button>
            <button class="pq-big pq-quiet" data-act="cancel">Cancel</button>`;
    }

    photoButtons() {
        return `<div class="pq-photo-btns">
            <label class="pq-big"><i>📷</i>Take photo<input type="file" data-photos accept="image/*" capture="environment" hidden></label>
            <label class="pq-big"><i>🖼</i>Add from photos<input type="file" data-photos accept="image/*" multiple hidden></label></div>`;
    }

    // One item: status in three big buttons, what, where, who, photos, history.
    itemHtml() {
        const i = this.current;
        if (!i) return this.listHtml();
        const sheets = Object.keys(i.sheetPoints).map(g => this.views.sheets.find(s => s.node.data.guid === g)?.node.name()).filter(Boolean);
        const editing = this.markupItemId === i.id;
        return `<button class="pq-back" data-act="list">‹ All items</button>
            <div class="pq-item-head">${this.badge(i, 64)}<div><b>#${i.number} ${escapeHtml(stampOf(i.stamp).name)}</b><span>${escapeHtml(i.level || 'No floor')} · added ${ago(i.createdAt)}${i.createdBy ? ` by ${escapeHtml(i.createdBy)}` : ''}</span></div></div>
            <div class="pq-status" role="group" aria-label="Status">${STATUSES.map(s => `<button data-act="status" data-v="${s.key}" class="${i.status === s.key ? 'on' : ''}" style="--c:${s.color}">${i.status === s.key ? '● ' : ''}${s.name}</button>`).join('')}</div>
            <label class="pq-label">What needs fixing?<textarea data-field="note" rows="3">${escapeHtml(i.note || '')}</textarea></label>
            <div class="pq-row2">
                <label class="pq-label">Who fixes it?<input data-field="assignee" list="pq-assignees" value="${escapeHtml(i.assignee || '')}" placeholder="Pick or type a name"></label>
                <label class="pq-label">Fix by<input type="date" data-field="due" value="${escapeHtml(i.due || '')}"></label>
            </div>
            <datalist id="pq-assignees">${ASSIGNEES.map(a => `<option value="${escapeHtml(a)}">`).join('')}</datalist>
            <p class="pq-meta">${escapeHtml(i.wallType || 'Wall')}${sheets.length ? ` · on ${sheets.map(escapeHtml).join(', ')}` : ''}</p>
            <h4 class="pq-h">Photos <span>${i.photos.length}</span></h4>
            <div class="pq-thumbs" data-thumbs></div>
            ${this.photoButtons()}
            <div class="pq-row2"><button class="pq-big" data-act="plan"><i>🗺</i>Show on plan</button><button class="pq-big" data-act="jump"><i>🧊</i>Show in 3D</button></div>
            ${i.history.length ? `<h4 class="pq-h">History</h4><ul class="pq-history">${i.history.slice().reverse().map(h => `<li><b>${escapeHtml(h.what)}</b> <span>${new Date(h.at).toLocaleString()}${h.by ? ` · ${escapeHtml(h.by)}` : ''}</span></li>`).join('')}</ul>` : ''}
            ${reviztoButton('Review in Revizto', 'data-act="rz-item"', 'wide')}
            <details class="pq-more"><summary>More</summary>
                ${editing ? `<div class="pq-row2">${Object.keys(MARKUP_TOOLS).map(t => `<button class="pq-mid" data-act="tool" data-v="${t}">${t}</button>`).join('')}</div>
                    <div class="pq-row2"><button class="pq-mid" data-act="markup-save">Save drawing</button><button class="pq-mid" data-act="markup-cancel">Cancel</button></div>`
                    : `<div class="pq-row2"><button class="pq-mid" data-act="draw">${i.markup ? 'Draw again on 3D' : 'Draw on the 3D view'}</button>${i.markup ? `<button class="pq-mid" data-act="show-markup">${this.markupShownFor === i.id ? 'Hide drawing' : 'Show drawing'}</button>` : ''}</div>`}
                <button class="pq-mid pq-danger" data-act="del">Delete this item</button></details>`;
    }

    // The report: today, this week or dates; what goes in; make it; send it.
    reportHtml() {
        const kind = this.reportKind || 'day', o = { photos: true, plans: true, floor: false, ...this.reportOpts }, level = this.views.level?.name;
        const period = periodOf(kind, localToday(), this.range || {});
        const r = reportData(this.items, period, { level: o.floor ? level : '' });
        const ready = this.report && this.report.key === this.reportKey();
        return `<h3 class="pq-step"><span>📄</span>Punch report</h3>
            <div class="pq-tabs">${[['day', 'Today'], ['week', 'This week'], ['range', 'Pick dates']].map(([k, l]) => `<button data-act="period" data-v="${k}" class="${kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
            ${kind === 'range' ? `<div class="pq-row2"><label class="pq-label">From<input type="date" data-range="from" value="${escapeHtml(this.range?.from || localToday())}"></label>
                <label class="pq-label">To<input type="date" data-range="to" value="${escapeHtml(this.range?.to || localToday())}"></label></div>` : ''}
            <div class="pq-preview"><b>${escapeHtml(reportTitle(period))}</b><span>${escapeHtml(periodText(period))}</span>
                <div class="pq-kpis"><span><b>${r.added.length}</b>new</span><span><b>${r.closed.length}</b>closed</span><span style="--c:${statusOf('open').color}"><b>${r.open.length}</b>open</span><span style="--c:${statusOf('review').color}"><b>${r.review.length}</b>in review</span></div></div>
            <div class="pq-opts">
                <label><input type="checkbox" data-opt="photos" ${o.photos ? 'checked' : ''}>Photos</label>
                <label><input type="checkbox" data-opt="plans" ${o.plans ? 'checked' : ''}>Plans with the stamps</label>
                ${level ? `<label><input type="checkbox" data-opt="floor" ${o.floor ? 'checked' : ''}>Only ${escapeHtml(level)}</label>` : ''}
            </div>
            <label class="pq-label">Prepared by<input data-you value="${escapeHtml(this.you)}" placeholder="Your name"></label>
            <button class="pq-big pq-go" data-act="make" ${this.making ? 'disabled' : ''}><i>⚙</i>${this.making ? escapeHtml(this.making) : ready ? 'Make it again' : 'Make the report'}</button>
            ${ready ? `<div class="pq-ready"><p>✓ ${escapeHtml(this.report.file.name)} · ${this.report.pages} pages · ${Math.round(this.report.file.size / 1024).toLocaleString()} KB</p>
                <button class="pq-big pq-go" data-act="share"><i>📤</i>Send it (share)</button>
                <div class="pq-row2"><button class="pq-mid" data-act="download">Save the PDF</button><button class="pq-mid" data-act="email">E-mail the summary</button></div>
                <button class="pq-mid" data-act="copy">Copy the summary</button>
                <pre class="pq-summary">${escapeHtml(this.report.text)}</pre></div>` : ''}
            <button class="pq-mid" data-act="csv">Download the item list (CSV)</button>`;
    }

    renderLegend() {
        const el = this.panel.querySelector('[data-legend]');
        if (!el) return;
        if (this.progress === 'off') { el.innerHTML = ''; return; }
        const rows = this.progress === 'compare' ? Object.values(COMPARE).map(c => [c.color, c.name, this.progressCounts?.[c.name] || 0])
            : STAGE_NAMES.slice(1).map((n, k) => [STAGE_COLORS[k + 1], n, this.progressCounts?.[n] || 0]);
        el.innerHTML = `<div class="pq-legend">${rows.map(([c, n, k]) => `<span><i style="background:${c}"></i>${escapeHtml(n)} <b>${k.toLocaleString()}</b></span>`).join('')}
            <em>${this.progress === 'installed' ? `As installed${this.asOf ? ` (${this.asOf})` : ''}, from Install Progress` : `${this.progress === 'planned' ? 'Planned' : 'Installed vs planned'} for ${this.asOf || localToday()}, from the schedule`}</em></div>`;
    }

    setSize(size) {
        this.size = size;
        pref('size', size);
        this.render();
    }

    // --- New item: stamp, place, describe -------------------------------------------------------------------------

    startNew() {
        this.draft = { photos: [], note: '', assignee: '', due: '' };
        this.placeNote = '';
        this.show('stamp');
    }

    pickStamp(code) {
        this.draft.stamp = code;
        this.show('place');
        this.setPlacing(true);
    }

    cancelNew() {
        for (const id of this.draft?.photos || []) saveState(`punch-photo-${id}`, {}).catch(() => {}); // photos taken for it
        this.draft = null;
        this.show('list');
    }

    setPlacing(on) {
        for (const [viewer, { down, up }] of this.taps) {
            viewer.canvas.removeEventListener('pointerdown', down);
            viewer.canvas.removeEventListener('pointerup', up);
        }
        this.taps.clear();
        if (!on) return;
        for (const [viewer] of this.views.active) {
            const handlers = { down: (ev) => { this.down = { x: ev.clientX, y: ev.clientY }; }, up: (ev) => this.onTap(viewer, ev) };
            viewer.canvas.addEventListener('pointerdown', handlers.down);
            viewer.canvas.addEventListener('pointerup', handlers.up);
            this.taps.set(viewer, handlers);
        }
    }

    // A tap (not a drag) while placing: the wall and the point under it. 3D: clientToWorld (point + dbId); a sheet:
    // hitTest (dbId + intersectPoint).
    onTap(viewer, ev) {
        if (!this.down || Math.hypot(ev.clientX - this.down.x, ev.clientY - this.down.y) > 8) return;
        const rect = viewer.container.getBoundingClientRect(), x = ev.clientX - rect.left, y = ev.clientY - rect.top;
        const is2d = viewer.model.is2d(), hit = is2d ? viewer.hitTest(x, y, true) : viewer.clientToWorld(x, y, true);
        const point = hit && (hit.intersectPoint || hit.point), wall = hit && this.byDbId.get(hit.dbId);
        if (!wall || !point) { this.placeNote = 'That was not a wall. Tap on a wall.'; this.renderScreen(); return; }
        const p = { x: point.x, y: point.y, z: point.z || 0 };
        this.place(wall, is2d ? { sheet: { guid: guidOf(viewer.model), point: p }, where: viewer.model.getDocumentNode().name() } : { point: p, where: '3D view' });
    }

    placeOnPicked() {
        const wall = this.byDbId.get(this.viewer.getSelection()[0]);
        if (wall) this.place(wall, { where: 'picked wall' });
    }

    place(wall, { point = null, sheet = null, where = '' }) {
        this.setPlacing(false);
        Object.assign(this.draft, { wall, point, sheet, where });
        this.show('form');
        this.panel.querySelector('[data-field=note]')?.focus();
    }

    async saveDraft() {
        const d = this.draft;
        if (!d?.wall) return;
        const at = new Date().toISOString();
        const item = upgradeItem({
            id: `i${Date.now().toString(36)}`, number: nextNumber(this.items), stamp: d.stamp, note: (d.note || '').trim(), status: 'open',
            assignee: (d.assignee || '').trim(), due: d.due || '', photos: d.photos, dbId: d.wall.dbId, externalId: d.wall.externalId,
            wallType: d.wall.wallType, level: d.wall.level, point: d.point, view: d.point ? this.viewer.getState({ viewport: true }) : undefined,
            sheetPoints: d.sheet ? { [d.sheet.guid]: d.sheet.point } : {}, createdAt: at, createdBy: this.you,
            history: [{ at, by: this.you, what: 'Added' }],
        });
        this.items.push(item);
        this.draft = null;
        this.selectedId = item.id;
        this.filter.status = 'open';
        await this.save();
        this.toast(`Item #${item.number} saved.`);
        this.show('item');
    }

    toast(text) {
        let el = this.panel.querySelector('.pq-toast');
        if (!el) { el = document.createElement('div'); el.className = 'pq-toast'; this.panel.querySelector('.pq')?.appendChild(el); }
        el.textContent = text;
        el.hidden = false;
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
    }

    // --- Items ----------------------------------------------------------------------------------------------------

    get current() {
        return this.items.find(i => i.id === this.selectedId) || null;
    }

    openItem(id) {
        this.selectedId = id;
        this.show('item');
        const item = this.current;
        if (item?.dbId) this.views.select([item.dbId]);
    }

    nextOpen() {
        const open = this.items.filter(i => i.status === 'open').sort((a, b) => a.number - b.number);
        if (!open.length) return;
        const at = open.findIndex(i => i.id === this.selectedId);
        const item = open[(at + 1) % open.length];
        this.openItem(item.id);
        this.flyTo(item);
    }

    async changeStatus(status) {
        const item = this.current;
        if (!item || !setStatus(item, status, { by: this.you })) return;
        await this.save();
        this.toast(`#${item.number} is ${statusOf(status).name.toLowerCase()}.`);
        this.renderScreen();
    }

    async deleteItem() {
        const item = this.current;
        if (!item || !confirm(`Delete ${itemLabel(item)}? Its photos go too.`)) return;
        for (const id of item.photos) saveState(`punch-photo-${id}`, {}).catch(() => {});
        this.items = this.items.filter(i => i !== item);
        this.selectedId = null;
        await this.save();
        this.show('list');
    }

    async save() {
        await this.refreshAll();
        try {
            await saveState(this.stateName, { items: this.items, updatedAt: new Date().toISOString() });
        } catch (err) {
            alert(`The punch list was not saved: ${err.message}`);
        }
    }

    // --- Photos: the iPad's camera or its photo library; resized, saved one by one -------------------------------

    async addPhotos(files) {
        const target = this.screen === 'form' ? this.draft : this.current;
        if (!target || !files.length) return;
        this.toast(files.length > 1 ? `Adding ${files.length} photos…` : 'Adding the photo…');
        for (const file of files) {
            try {
                const photo = await readPhoto(file);
                const id = photoId();
                await saveState(`punch-photo-${id}`, { id, ...photo, at: new Date().toISOString(), by: this.you, name: file.name });
                this.photoCache.set(id, photo);
                target.photos.push(id);
                if (this.screen === 'item') target.history.push({ at: new Date().toISOString(), by: this.you, what: 'Photo added' });
            } catch (err) {
                alert(`That photo could not be added: ${err.message}`);
            }
        }
        if (this.screen === 'item') await this.save();
        this.renderScreen();
        this.toast(`${files.length > 1 ? `${files.length} photos` : 'Photo'} added.`);
    }

    async photo(id) {
        if (!this.photoCache.has(id)) {
            const saved = await loadState(`punch-photo-${id}`).catch(() => ({}));
            if (saved?.full) this.photoCache.set(id, saved);
        }
        return this.photoCache.get(id) || null;
    }

    async fillThumbs() {
        const target = this.screen === 'form' ? this.draft : this.current, el = this.panel.querySelector('[data-thumbs]');
        if (!target || !el) return;
        el.innerHTML = target.photos.length ? target.photos.map(id => `<span class="pq-thumb" data-thumb="${id}"><button data-act="photo" data-v="${id}" aria-label="Open the photo"></button>
            <button class="pq-x" data-act="unphoto" data-v="${id}" aria-label="Remove the photo">×</button></span>`).join('') : '<p class="muted">No photos yet.</p>';
        for (const id of target.photos) {
            const p = await this.photo(id), box = el.querySelector(`[data-thumb="${id}"] button`);
            if (box && p) box.style.backgroundImage = `url(${p.thumb})`;
        }
    }

    async removePhoto(id) {
        const target = this.screen === 'form' ? this.draft : this.current;
        if (!target || !confirm('Remove this photo?')) return;
        target.photos = target.photos.filter(p => p !== id);
        saveState(`punch-photo-${id}`, {}).catch(() => {});
        if (this.screen === 'item') { target.history.push({ at: new Date().toISOString(), by: this.you, what: 'Photo removed' }); await this.save(); }
        this.renderScreen();
    }

    // A photo across the screen: previous / next, close.
    async openPhoto(id) {
        const target = this.screen === 'form' ? this.draft : this.current;
        const list = target?.photos || [];
        let at = list.indexOf(id);
        const box = this.viewerBox || (this.viewerBox = document.createElement('div'));
        box.className = 'pq-photo-view';
        document.body.appendChild(box);
        const draw = async () => {
            const p = await this.photo(list[at]);
            box.innerHTML = `<img alt="Photo ${at + 1} of ${list.length}" src="${p?.full || ''}"><div class="pq-pv-bar">
                <button data-pv="prev" ${list.length > 1 ? '' : 'disabled'}>‹ Back</button><span>${at + 1} of ${list.length}</span>
                <button data-pv="next" ${list.length > 1 ? '' : 'disabled'}>Next ›</button><button data-pv="close" class="pq-pv-close">Close ✕</button></div>`;
        };
        box.onclick = (e) => {
            const a = e.target.closest('[data-pv]')?.dataset.pv;
            if (a === 'close' || e.target === box) { box.remove(); return; }
            if (a === 'prev') { at = (at - 1 + list.length) % list.length; draw(); }
            if (a === 'next') { at = (at + 1) % list.length; draw(); }
        };
        await draw();
    }

    // --- 3D and plan: stamps, wall colors, going to an item ------------------------------------------------------

    // The walls: with progress shown, colored by it; else the walls with open or in-review items in their stamp's color.
    async refreshAll() {
        if (this.progress === 'off') {
            const colors = new Map();
            for (const item of this.items) if (item.status !== 'closed' && item.dbId) colors.set(item.dbId, stampOf(item.stamp).color);
            this.views.setColors(colors);
        } else this.showProgress();
        this.fill3dPoints();
        await this.refreshSprites(this.dataViz, this.sprites['3d'], this.items.filter(i => i.point).map(i => [i, i.point]));
        await this.refresh2dSprites();
    }

    // Items placed on a sheet only: in 3D at their wall's middle (fitToView measures it; the camera goes back at once).
    fill3dPoints() {
        const nav = this.viewer.navigation, missing = this.items.filter(i => !i.point && i.dbId);
        if (!missing.length || !this.viewer.model?.isLoadDone()) return;
        const from = nav.getPosition().clone(), to = nav.getTarget().clone();
        for (const i of missing) {
            this.viewer.fitToView([i.dbId], this.viewer.model, true);
            const c = nav.getTarget();
            i.point = { x: c.x, y: c.y, z: c.z };
            i.pointFrom = 'wall';
        }
        nav.setView(from, to);
    }

    // Items of this sheet's floor placed in 3D or on another sheet: on this sheet at their wall's middle on it.
    fillSheetPoints(viewer, model) {
        const guid = guidOf(model), level = this.views.planLevelName, nav = viewer.navigation;
        const missing = this.items.filter(i => !i.sheetPoints[guid] && i.dbId && (!level || i.level === level));
        if (!missing.length || !model.isLoadDone()) return;
        const from = nav.getPosition().clone(), to = nav.getTarget().clone();
        for (const i of missing) {
            viewer.fitToView([i.dbId], model, true);
            const c = nav.getTarget();
            if (c.distanceTo(to) > 1e-6 || nav.getPosition().distanceTo(from) > 1e-6) i.sheetPoints[guid] = { x: c.x, y: c.y, z: 0, from: 'wall' }; // moved: the wall is on this sheet
            nav.setView(from, to);
        }
    }

    async refresh2dSprites() {
        const viewer2d = this.views.viewer2d, model = this.views.model2d, guid = guidOf(model);
        if (!this.dataViz || !guid) return;
        this.fillSheetPoints(viewer2d, model);
        const dataViz = viewer2d.getExtension(DATAVIZ) || await viewer2d.loadExtension(DATAVIZ);
        await this.refreshSprites(dataViz, this.sprites['2d'], this.items.filter(i => i.sheetPoints[guid]).map(i => [i, i.sheetPoints[guid]]));
    }

    // A stamp's sprite style (its SVG as a blob URL), made once per stamp and status.
    styleFor(item) {
        const key = `${item.stamp}|${item.status}`;
        if (!this.spriteStyles.has(key)) {
            const Core = Autodesk.DataVisualization.Core, s = stampOf(item.stamp);
            const url = URL.createObjectURL(new Blob([stampSvg(s.code, s.color, item.status, 64)], { type: 'image/svg+xml' }));
            this.spriteStyles.set(key, { url, style: new Core.ViewableStyle(Core.ViewableType.SPRITE, new THREE.Color(0xffffff), url) });
        }
        return this.spriteStyles.get(key).style;
    }

    async refreshSprites(dataViz, ids, pins) {
        const Core = Autodesk.DataVisualization.Core;
        dataViz.removeAllViewables();
        ids.clear();
        if (!pins.length) return;
        const data = new Core.ViewableData();
        data.spriteSize = 40; // big enough to tap
        pins.forEach(([item, { x, y, z }], i) => {
            ids.set(i + 1, item.id);
            data.addViewable(new Core.SpriteViewable(new THREE.Vector3(x, y, z || 0), this.styleFor(item), i + 1));
        });
        await data.finish();
        dataViz.addViewables(data);
    }

    async flyTo(item) {
        if (item.view) this.viewer.restoreState(item.view, null, false);
        else if (item.dbId) this.viewer.fitToView([item.dbId], this.viewer.model);
        await this.showOnPlan(item);
    }

    // The plan of its floor (the sheet it was stamped on, else its floor's plan), zoomed to it, the wall picked.
    async showOnPlan(item) {
        if (!item) return;
        if (this.views.layout === '3d') this.views.setLayout('split');
        const guid = Object.keys(item.sheetPoints).find(g => !item.sheetPoints[g].from) || Object.keys(item.sheetPoints)[0];
        const node = (guid && this.views.sheets.find(s => s.node.data.guid === guid)?.node) || this.views.planFor(item.level);
        if (node && guidOf(this.views.model2d) !== node.data.guid) await this.views.openSheet(node);
        if (item.dbId) this.views.select([item.dbId]);
    }

    // Show in 3D with context: cut at its floor, look at it from about 35° above, from the inside of the building.
    async jumpTo3d(item) {
        const viewer = this.viewer, model = viewer.model;
        if (!model || !item?.dbId) return;
        if (this.views.layout === '2d') this.views.setLayout('split');
        if (item.level && this.views.level?.name !== item.level) await this.views.setLevel(item.level);
        viewer.fitToView([item.dbId], model, true);
        const nav = viewer.navigation, wallCenter = nav.getTarget().clone(), fitDistance = nav.getEyeVector().length();
        const poi = item.point && item.pointFrom !== 'wall' ? new THREE.Vector3(item.point.x, item.point.y, item.point.z) : wallCenter;
        const center = buildingCenter(model), toCenter = new THREE.Vector3(center.x - poi.x, center.y - poi.y, 0);
        if (toCenter.length() < 1) toCenter.set(1, -1, 0);
        toCenter.normalize();
        const distance = Math.max(30, fitDistance * 1.2), pitch = (35 * Math.PI) / 180;
        const eye = poi.clone().add(toCenter.multiplyScalar(distance * Math.cos(pitch))).add(new THREE.Vector3(0, 0, distance * Math.sin(pitch)));
        nav.setView(eye, poi, new THREE.Vector3(0, 0, 1));
        nav.setPivotPoint(poi);
        this.views.select([item.dbId]);
    }

    // --- Progress: as installed, as planned, installed vs plan (Install Progress and its schedule, read only) -------

    setProgress(mode) {
        this.progress = mode;
        pref('progress', mode);
        this.panel.querySelectorAll('[data-progress]').forEach(b => b.classList.toggle('on', b.dataset.progress === mode));
        this.refreshAll();
        this.renderLegend();
    }

    showProgress() {
        const stageIndex = (w) => Math.max(0, STAGE_NAMES.indexOf(this.install[w.externalId] || 'Not started'));
        const colors = new Map(), counts = {};
        const add = (name, id, color) => { colors.set(id, color); counts[name] = (counts[name] || 0) + 1; };
        if (this.progress === 'installed' || !this.schedule) {
            for (const w of this.walls) { const k = stageIndex(w); if (k) add(STAGE_NAMES[k], w.dbId, STAGE_COLORS[k]); }
        } else {
            // Linked once the floors are known (views 'ready'); before that, nothing planned yet.
            if (!this.linked && this.views.levels.length) this.linked = linkActivities(this.schedule, this.views.levels.map(l => l.name)).filter(a => a.scope !== 'other');
            this.cal ??= calendarOf(this.schedule);
            // Planned for the field progress's date (else today), the walls furthest along first (as Install Progress).
            const ranked = [...this.walls].sort((a, b) => stageIndex(b) - stageIndex(a));
            for (const [w, k] of plannedStages(ranked, this.linked || [], this.asOf || localToday(), this.cal)) {
                if (this.progress === 'planned') { if (k) add(STAGE_NAMES[k], w.dbId, STAGE_COLORS[k]); continue; }
                const a = stageIndex(w);
                if (!a && !k) continue;
                const c = COMPARE[a < k ? 'behind' : a > k ? 'ahead' : 'even'];
                add(c.name, w.dbId, c.color);
            }
        }
        this.progressCounts = counts;
        this.views.setColors(colors);
        this.renderLegend();
    }

    // --- Review in Revizto (a concept) ---------------------------------------------------------------------------
    // Where Field QC and Revizto would work as one, each doable with the right access (core/client/revizto-concept.js):
    // every punch item a Revizto issue with its photos, the review status back on its stamp, a link to open it in
    // Revizto, Revizto's own stamps here. Nothing is sent; the issue shown has the fields the shelved integration sends
    // (revizto-map.mjs issueFields).

    // An item as the Revizto issue it would be (a photo of it, if it has one, as the picture).
    async rzCard(item) {
        const s = stampOf(item.stamp), st = statusOf(item.status), f = issueFields(item, {});
        const photo = item.photos.length ? await this.photo(item.photos[0]) : null, n = item.photos.length;
        return { code: s.code, color: item.status === 'closed' ? '#9aa0a6' : s.color, statusColor: st.color, status: st.name, title: f.title.value, image: photo?.thumb || '',
            lines: [item.note || 'No note', [item.assignee ? `Who fixes it: ${item.assignee}` : '', item.due ? `fix by ${item.due}` : ''].filter(Boolean).join(' · '),
                `Tags: ${f.tags.value.join(', ')}`, `The plan around it as the picture${n ? `; ${n} photo${n === 1 ? '' : 's'} as comments` : ''}`] };
    }

    async rzItem(item) {
        if (!item) return;
        showReviztoConcept({ title: 'Review in Revizto', intro: `#${item.number} ${stampOf(item.stamp).name} becomes a Revizto issue, so the coordination team reviews it in Revizto and the field sees their answer here.`,
            cards: [await this.rzCard(item)], api: [REVIZTO_API.create, REVIZTO_API.comments, REVIZTO_API.issues],
            steps: ['Make the issue in your Revizto project: its stamp code and color, title, status, who fixes it, fix-by date, tags, the plan around it as the picture.',
                'Add the note and every photo to it as comments.', 'Show "Open in Revizto" here (the issue\'s own link, on the web or the Revizto app).',
                'A status changed here changes it there; one changed in Revizto comes back to this stamp.'] });
    }

    async rzAll() {
        const open = this.items.filter(i => i.status !== 'closed').sort((x, y) => x.number - y.number);
        showReviztoConcept({ title: `Send ${open.length} open item${open.length === 1 ? '' : 's'} to Revizto`, intro: 'The punch list in Revizto, one issue per item, each with its stamp, picture, note and photos.',
            cards: await Promise.all(open.slice(0, 3).map(i => this.rzCard(i))), more: open.length - 3, api: [REVIZTO_API.create, REVIZTO_API.comments],
            steps: ['Pick the Revizto project once (from the projects your account can see).', 'Match Open, In review and Closed to that project\'s statuses once.', 'Send: an issue per item, then its note and photos.'] });
    }

    rzStatus() {
        showReviztoConcept({ title: 'The review status back from Revizto', intro: 'When the coordination team closes, solves or reopens an issue in Revizto, the stamp here follows.',
            api: [REVIZTO_API.issues, REVIZTO_API.comments],
            steps: ['Read the project\'s issues (100 a page) and find the ones sent from here.', 'Change each item whose Revizto status maps to another: its history says "by Revizto".', 'Send status changes made here to Revizto as well.'] });
    }

    rzStamps() {
        showReviztoConcept({ title: 'Revizto\'s stamps in Field QC', intro: `Use the project's own Revizto stamp templates (their codes and colors) instead of these ${STAMPS.length}, so a stamp means the same in the field and in Revizto.`,
            api: [REVIZTO_API.stamps], steps: ['Read the project\'s stamp templates.', 'Offer them in step 1 of New item, each with its code and color.'] });
    }

    // The Revizto screen: what Field QC and Revizto would do together.
    reviztoHtml() {
        const open = this.items.filter(i => i.status !== 'closed').length;
        return `<h3 class="pq-step"><span>🔁</span>Review in Revizto</h3>
            <p>Field QC and Revizto as one: the punch list goes to Revizto for the coordination team to review, and their answer comes back
                to the stamps here. Each of these is doable with the right Revizto access; tap one to see what it would do.</p>
            ${reviztoButton(`Send ${open} open item${open === 1 ? '' : 's'} to Revizto`, 'data-act="rz-all"', 'wide')}
            ${reviztoButton('Get the review status back', 'data-act="rz-status"', 'wide')}
            ${reviztoButton('Use Revizto\'s stamps here', 'data-act="rz-stamps"', 'wide')}
            <p class="muted">On each item: <b>Review in Revizto</b>. A concept: nothing is sent to Revizto.</p>`;
    }

    // --- The report ------------------------------------------------------------------------------------------------

    reportKey() {
        const o = { photos: true, plans: true, floor: false, ...this.reportOpts };
        return JSON.stringify([this.reportKind || 'day', this.range, o, this.views.level?.name, this.items.length, this.items.map(i => i.status + i.photos.length).join()]);
    }

    async makeReport() {
        const kind = this.reportKind || 'day', o = { photos: true, plans: true, floor: false, ...this.reportOpts };
        const level = o.floor ? this.views.level?.name || '' : '';
        const period = periodOf(kind, localToday(), this.range || {});
        const r = reportData(this.items, period, { level });
        const step = (text) => { this.making = text; this.renderScreen(); };
        try {
            step('Getting the plans…');
            const { plans, snippets } = o.plans ? await this.capturePlans(r.listed, step) : { plans: [], snippets: new Map() };
            const photos = new Map();
            if (o.photos) {
                step('Getting the photos…');
                for (const i of r.listed) for (const id of i.photos.slice(0, 4)) { const p = await this.photo(id); if (p) photos.set(id, await shrink(p.full, 900)); }
            }
            step('Writing the PDF…');
            await nextFrame(30);
            const pages = reportPages(r, { project: this.project, by: this.you, plans, snippets, photos, includePhotos: o.photos });
            const bytes = toPdfPages(pages, { title: `${reportTitle(period)} · ${this.project}` });
            const name = `${this.project.replace(/[^\w-]+/g, '-')}-punch-${kind === 'week' ? 'weekly' : kind === 'day' ? 'daily' : 'report'}-${period.to}.pdf`;
            this.report = { key: this.reportKey(), file: new File([bytes], name, { type: 'application/pdf' }), pages: pages.length, text: summaryText(r, { project: this.project, by: this.you }), title: reportTitle(period) };
        } catch (err) {
            console.error(err);
            alert(`The report could not be made: ${err.message}`);
        } finally {
            this.making = null;
            this.renderScreen();
        }
    }

    // Each floor's plan with its items' stamps (and a close-up around each): the floor's plan opened in the plan pane,
    // framed on the floor's walls, the stamps off while the picture is taken (Viewer3D.getScreenShot), the stamps' places
    // from worldToClient; then the sheet that was open comes back.
    async capturePlans(items, step) {
        const plans = [], snippets = new Map(), views = this.views;
        const levels = views.levels.map(l => l.name).filter(l => items.some(i => i.level === l));
        if (!levels.length) return { plans, snippets };
        const layout = views.layout, back = views.model2d?.getDocumentNode();
        if (layout === '3d') views.setLayout('split');
        this.capturing = true;
        try {
            for (const [k, level] of levels.entries()) {
                step(`Getting the plans (${k + 1} of ${levels.length})…`);
                const node = views.planFor(level);
                if (!node) continue;
                if (views.model2d?.getDocumentNode() !== node) await views.openSheet(node);
                const viewer = views.viewer2d, model = views.model2d;
                for (let t = 0; t < 100 && !model.isLoadDone(); t++) await nextFrame(100);
                viewer.getExtension(DATAVIZ)?.removeAllViewables();
                this.fillSheetPoints(viewer, model);
                const walls = views.wallsByLevel.get(level);
                if (walls?.length) viewer.fitToView(walls, model, true);
                await nextFrame(700); // drawn at that view
                const guid = guidOf(model), W = viewer.container.clientWidth, H = viewer.container.clientHeight;
                const pins = items.filter(i => i.level === level && i.sheetPoints[guid]).map(i => {
                    const p = viewer.worldToClient(new THREE.Vector3(i.sheetPoints[guid].x, i.sheetPoints[guid].y, 0));
                    return { u: p.x / W, v: p.y / H, item: i };
                }).filter(p => p.u >= 0 && p.u <= 1 && p.v >= 0 && p.v <= 1);
                const shot = await new Promise(res => viewer.getScreenShot(Math.round(W * 2), Math.round(H * 2), res));
                const img = await loadImage(shot), box = contentBox(img), IW = img.naturalWidth, IH = img.naturalHeight;
                // The sheet only (the pane's grey around it trimmed), the stamps' places in it.
                plans.push({ level, ...toJpeg(img, 1700, box), pins: pins.map(p => ({ ...p, u: (p.u * IW - box.x) / box.w, v: (p.v * IH - box.y) / box.h })) });
                for (const pin of pins) snippets.set(pin.item.id, crop(img, pin.u, pin.v, 0.2, 0.7));
            }
        } finally {
            this.capturing = false;
            if (back && views.model2d?.getDocumentNode() !== back) await views.openSheet(back);
            if (layout === '3d') views.setLayout('3d');
            await this.refresh2dSprites();
        }
        return { plans, snippets };
    }

    // The iPad's share sheet (Mail, Messages, AirDrop, Files…) with the PDF and the summary; else the PDF is saved.
    async shareReport() {
        const r = this.report;
        if (!r) return;
        if (navigator.canShare?.({ files: [r.file] })) {
            try { await navigator.share({ files: [r.file], title: `${r.title} · ${this.project}`, text: r.text }); return; } catch (err) { if (err.name === 'AbortError') return; }
        }
        this.downloadReport();
        alert('This browser cannot send files from here, so the PDF was saved. Attach it to an e-mail (E-mail the summary opens one with the text).');
    }

    downloadReport() {
        const r = this.report;
        if (!r) return;
        const url = URL.createObjectURL(r.file);
        Object.assign(document.createElement('a'), { href: url, download: r.file.name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    emailSummary() {
        const r = this.report;
        if (r) location.href = `mailto:?subject=${encodeURIComponent(`${r.title} · ${this.project}`)}&body=${encodeURIComponent(r.text.slice(0, 1800))}`;
    }

    async copySummary() {
        try { await navigator.clipboard.writeText(this.report?.text || ''); this.toast('Summary copied.'); } catch { alert(this.report?.text || ''); }
    }

    exportCsv() {
        const sheetName = (g) => this.views.sheets.find(s => s.node.data.guid === g)?.node.name() || g;
        const header = ['Number', 'Stamp', 'Kind', 'Status', 'Note', 'Who fixes it', 'Fix by', 'Floor', 'Wall type', 'Added', 'Added by', 'Closed', 'Photos', 'Sheets', 'Wall externalId'];
        const rows = this.items.slice().sort((a, b) => a.number - b.number).map(i => [i.number, i.stamp, stampOf(i.stamp).name, statusOf(i.status).name, i.note, i.assignee, i.due, i.level, i.wallType,
            i.createdAt, i.createdBy, i.closedAt || '', i.photos.length, Object.keys(i.sheetPoints).filter(g => !i.sheetPoints[g].from).map(sheetName).join('; '), i.externalId]);
        downloadCsv(`${this.project.replace(/[^\w-]+/g, '-')}-punch-list.csv`, [header, ...rows]);
    }

    // --- Drawing on the 3D view (MarkupsCore), kept with the item ---------------------------------------------------

    async getMarkups() {
        this.markups ??= await this.viewer.loadExtension('Autodesk.Viewing.MarkupsCore');
        return this.markups;
    }

    async startMarkup(item) {
        if (!item) return;
        const markups = await this.getMarkups();
        if (item.view) this.viewer.restoreState(item.view, null, true);
        markups.hide();
        markups.show();
        markups.enterEditMode();
        this.markupItemId = item.id;
        this.markupShownFor = null;
        this.setMarkupTool('Arrow');
        this.renderScreen();
        this.panel.querySelector('.pq-more')?.setAttribute('open', '');
    }

    setMarkupTool(tool) {
        const Core = Autodesk.Viewing.Extensions.Markups.Core;
        this.markups.changeEditMode(new Core[MARKUP_TOOLS[tool]](this.markups));
    }

    async finishMarkup(keep) {
        const item = this.items.find(i => i.id === this.markupItemId);
        if (keep && item) { item.markup = this.markups.generateData(); item.view = this.viewer.getState({ viewport: true }); }
        this.markups.leaveEditMode();
        this.markups.hide();
        this.markupItemId = null;
        this.renderScreen();
        if (keep) await this.save();
    }

    async toggleMarkup(item) {
        if (!item) return;
        const markups = await this.getMarkups();
        if (this.markupShownFor === item.id) { markups.hide(); this.markupShownFor = null; } else {
            this.viewer.restoreState(item.view, null, true);
            markups.hide();
            markups.show();
            markups.loadMarkups(item.markup, MARKUP_LAYER);
            this.markupShownFor = item.id;
        }
        this.renderScreen();
    }
}

// --- Images: photos read and resized, plan pictures to JPEG, close-ups -----------------------------------------------

// A photo from the camera or the library: upright (its orientation applied), at most 1600 px (and a 320 px thumbnail),
// as JPEG data URLs. createImageBitmap: https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap
async function readPhoto(file) {
    let img;
    try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
        img = await loadImage(URL.createObjectURL(file));
    }
    const w = img.width, h = img.height;
    const draw = (max, q) => { const [cw, ch] = fitSize(w, h, max), c = Object.assign(document.createElement('canvas'), { width: cw, height: ch }); c.getContext('2d').drawImage(img, 0, 0, cw, ch); return c.toDataURL('image/jpeg', q); };
    const [fw, fh] = fitSize(w, h, 1600);
    return { full: draw(1600, 0.8), thumb: draw(320, 0.7), w: fw, h: fh };
}

function loadImage(src) {
    return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('The image could not be read.')); img.src = src; });
}

// An image (or a part of it: box, in its pixels) as a JPEG on white, at most max px: { href, px }.
function toJpeg(img, max, box = null) {
    const b = box || { x: 0, y: 0, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
    const [w, h] = fitSize(b.w, b.h, max);
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.drawImage(img, b.x, b.y, b.w, b.h, 0, 0, w, h);
    return { href: c.toDataURL('image/jpeg', 0.82), px: [w, h] };
}

// Where a picture of the plan pane shows the sheet: the rows and columns with white paper in them (the pane's background
// is a grey gradient, never near white). In the image's pixels, measured on a 400 px copy.
function contentBox(img) {
    const W = img.naturalWidth, H = img.naturalHeight, w = 400, h = Math.max(1, Math.round((H * w) / W)), k = w / W;
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i] > 238 && d[i + 1] > 238 && d[i + 2] > 238) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return { x: 0, y: 0, w: W, h: H };
    const bx = Math.max(0, (x0 - 2) / k), by = Math.max(0, (y0 - 2) / k);
    return { x: bx, y: by, w: Math.min(W, (x1 + 3) / k) - bx, h: Math.min(H, (y1 + 3) / k) - by };
}

async function shrink(dataUrl, max) {
    return toJpeg(await loadImage(dataUrl), max);
}

// A close-up of an image around (u, v): share of its width across, aspect (height / width).
function crop(img, u, v, share, aspect) {
    const W = img.naturalWidth, H = img.naturalHeight, sw = W * share, sh = sw * aspect;
    const sx = Math.max(0, Math.min(W - sw, u * W - sw / 2)), sy = Math.max(0, Math.min(H - sh, v * H - sh / 2));
    const c = Object.assign(document.createElement('canvas'), { width: 440, height: Math.round(440 * aspect) }), g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return { href: c.toDataURL('image/jpeg', 0.82), px: [c.width, c.height], pu: (u * W - sx) / sw, pv: (v * H - sy) / sh }; // where the stamp is in it
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, PunchExtension);
