// Demo 0, "Review" tab: saved views (and a tour through them), markups on the 3D view or the plan, screenshots.
// Saved per model (helpers stateFor): 'viewer-views' and 'viewer-markups' (on the review site, in this browser).
// Viewer3D (getState, restoreState, getScreenShot): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// MarkupsCore (show, hide, enterEditMode, changeEditMode, undo, generateData, loadMarkups, unloadMarkupsAllLayers,
//   leaveEditMode, EditModeArrow / Rectangle / Circle / Cloud / Text / Freehand / Polyline):
//   https://aps.autodesk.com/en/docs/viewer/v7/reference/Extensions/MarkupsCore/
import { loadState, saveState, stateFor, escapeHtml } from '../../helpers.js';

const TOOLS = { Arrow: 'EditModeArrow', Cloud: 'EditModeCloud', Rectangle: 'EditModeRectangle', Circle: 'EditModeCircle', Text: 'EditModeText', Freehand: 'EditModeFreehand', Polyline: 'EditModePolyline' };
const MARKUPS = 'Autodesk.Viewing.MarkupsCore';
const TOUR_SECONDS = 4;

export class Review {
    constructor(tour) {
        this.tour = tour;
        this.views = tour.views;
        this.on = '3d'; // markups on the 3D view or the plan
        this.tool = 'Cloud';
        this.saved = { views: [], markups: [] };
    }

    async load() {
        this.names = { views: await stateFor('viewer-views'), markups: await stateFor('viewer-markups') };
        const [v, m] = await Promise.all([loadState(this.names.views).catch(() => ({})), loadState(this.names.markups).catch(() => ({}))]);
        this.saved = { views: Array.isArray(v.views) ? v.views : [], markups: Array.isArray(m.markups) ? m.markups : [] };
    }

    html() {
        return `<section class="ex-sec" data-sec="saved"><h3><span>1</span> Saved views</h3>
                <div class="ex-row"><input class="ex-input" data-view-name maxlength="60" placeholder="Name this view, e.g. Level 5 framing">
                    <button class="pg-btn" data-view-save>Save view</button><button class="pg-btn" data-view-play>▶ Play all</button></div>
                <ol class="ex-list" data-view-list></ol>
                <p class="ex-note">A view keeps the camera, cuts, explode, what is isolated, the colors and the floor.${this.tour.isStatic ? ' Saved in this browser.' : ''}</p></section>
            <section class="ex-sec" data-sec="markup"><h3><span>2</span> Markups</h3>
                <div class="ex-row"><span class="ex-lbl">On</span><div class="tk-tabs"><button data-mk-on="3d" class="active">3D view</button><button data-mk-on="plan">Plan</button></div>
                    <button class="pg-btn" data-mk="start">✎ Start a markup</button></div>
                <div class="ex-row" data-mk-edit hidden>${Object.keys(TOOLS).map(t => `<button class="pg-btn" data-mk-tool="${t}">${t}</button>`).join('')}</div>
                <div class="ex-row" data-mk-edit hidden><input class="ex-input" data-mk-name maxlength="60" placeholder="Markup name">
                    <button class="pg-btn" data-mk="undo">Undo</button><button class="pg-btn primary" data-mk="save">Save</button><button class="pg-btn" data-mk="cancel">Cancel</button></div>
                <ol class="ex-list" data-mk-list></ol>
                <p class="ex-note" data-mk-note>Draw over the 3D view or the plan; a markup is saved with its view and opens on it again.</p></section>
            <section class="ex-sec" data-sec="shots"><h3><span>3</span> Screenshots</h3>
                <div class="ex-row"><button class="pg-btn" data-shot="3d">📷 Save the 3D view</button><button class="pg-btn" data-shot="plan">📷 Save the plan</button></div>
                <p class="ex-note">A PNG of what is on screen, for an email or an RFI.</p></section>`;
    }

    bind(root) {
        this.root = root;
        root.querySelector('[data-view-save]').onclick = () => this.saveView();
        root.querySelector('[data-view-name]').onkeydown = (e) => { if (e.key === 'Enter') this.saveView(); };
        root.querySelector('[data-view-play]').onclick = () => (this.playing ? this.stopPlay() : this.play());
        root.querySelectorAll('[data-mk-on]').forEach(b => b.onclick = () => { if (this.editing) return; this.on = b.dataset.mkOn; root.querySelectorAll('[data-mk-on]').forEach(x => x.classList.toggle('active', x === b)); });
        root.querySelectorAll('[data-mk-tool]').forEach(b => b.onclick = () => this.setTool(b.dataset.mkTool));
        root.querySelectorAll('[data-mk]').forEach(b => b.onclick = () => this.markupAction(b.dataset.mk));
        root.querySelectorAll('[data-shot]').forEach(b => b.onclick = () => this.screenshot(b.dataset.shot));
        this.renderLists();
    }

    renderLists() {
        if (!this.root) return;
        const views = this.root.querySelector('[data-view-list]');
        views.innerHTML = this.saved.views.length ? this.saved.views.map((v, i) => `<li><button class="ex-link" data-view-go="${i}">▶ ${escapeHtml(v.name)}</button>
            <span class="muted">${escapeHtml(v.summary || '')}</span><button class="ex-x" data-view-del="${i}" title="Delete this view">✕</button></li>`).join('')
            : '<li class="muted">No saved views yet: set up a view (isolate, color, cut, a floor) and save it.</li>';
        views.querySelectorAll('[data-view-go]').forEach(b => b.onclick = () => { this.stopPlay(); this.restoreView(this.saved.views[Number(b.dataset.viewGo)]); });
        views.querySelectorAll('[data-view-del]').forEach(b => b.onclick = () => { this.saved.views.splice(Number(b.dataset.viewDel), 1); this.store('views'); this.renderLists(); });
        const marks = this.root.querySelector('[data-mk-list]');
        marks.innerHTML = this.saved.markups.map((m, i) => `<li><button class="ex-link" data-mk-go="${i}">${this.shown === m.id ? '◉' : '▶'} ${escapeHtml(m.name)}</button>
            <span class="muted">${m.on === 'plan' ? escapeHtml(m.sheet || 'Plan') : '3D view'}</span><button class="ex-x" data-mk-del="${i}" title="Delete this markup">✕</button></li>`).join('');
        marks.querySelectorAll('[data-mk-go]').forEach(b => b.onclick = () => this.toggleMarkup(this.saved.markups[Number(b.dataset.mkGo)]));
        marks.querySelectorAll('[data-mk-del]').forEach(b => b.onclick = async () => {
            const [m] = this.saved.markups.splice(Number(b.dataset.mkDel), 1);
            if (this.shown === m.id) await this.hideMarkups();
            this.store('markups');
            this.renderLists();
        });
    }

    store(kind) {
        saveState(this.names[kind], { [kind]: this.saved[kind] }).catch(err => this.note(`Not saved: ${err.message}`));
    }

    note(text) {
        const el = this.root?.querySelector('[data-mk-note]');
        if (el) el.textContent = text;
    }

    // --- Saved views ---------------------------------------------------------------------------------------------------
    saveView() {
        const input = this.root.querySelector('[data-view-name]');
        const tour = this.tour.snapshot();
        const name = input.value.trim() || `View ${this.saved.views.length + 1}`;
        this.saved.views.push({ name, at: new Date().toISOString(), summary: tour.summary, tour, state: this.tour.viewer.getState() });
        input.value = '';
        this.store('views');
        this.renderLists();
    }

    async restoreView(v) {
        if (!v) return;
        await this.tour.restore(v.tour); // groups, colors, floor (its section box)
        this.tour.viewer.restoreState(v.state, null, false); // then the camera, cuts and explode exactly as saved
    }

    async play() {
        if (!this.saved.views.length) return;
        this.playing = true;
        this.root.querySelector('[data-view-play]').textContent = '■ Stop';
        for (const v of this.saved.views) {
            if (!this.playing) break;
            await this.restoreView(v);
            await new Promise(r => { this.playTimer = setTimeout(r, TOUR_SECONDS * 1000); });
        }
        this.stopPlay();
    }

    stopPlay() {
        this.playing = false;
        clearTimeout(this.playTimer);
        const b = this.root?.querySelector('[data-view-play]');
        if (b) b.textContent = '▶ Play all';
    }

    // --- Markups -------------------------------------------------------------------------------------------------------
    // The plan viewer's extensions go when its sheet changes, so the markup extension is looked up each time.
    async viewerFor(on) {
        return on === 'plan' ? this.tour.twoD.plan() : this.tour.viewer;
    }

    async markupsOn(viewer) {
        return viewer.getExtension(MARKUPS) || viewer.loadExtension(MARKUPS);
    }

    setTool(tool) {
        this.tool = tool;
        this.root.querySelectorAll('[data-mk-tool]').forEach(b => b.classList.toggle('active', b.dataset.mkTool === tool));
        if (this.editing) this.editing.ext.changeEditMode(new Autodesk.Viewing.Extensions.Markups.Core[TOOLS[tool]](this.editing.ext));
    }

    async markupAction(action) {
        if (action === 'start') return this.startMarkup();
        if (!this.editing) return;
        const { ext, viewer } = this.editing;
        if (action === 'undo') { ext.undo(); return; }
        if (action === 'save') {
            const name = this.root.querySelector('[data-mk-name]').value.trim() || `Markup ${this.saved.markups.length + 1}`;
            this.saved.markups.push({ id: `m${Date.now().toString(36)}`, name, on: this.editing.on, at: new Date().toISOString(),
                sheet: this.editing.on === 'plan' ? this.views.model2d?.getDocumentNode()?.name() || '' : '',
                state: viewer.getState({ viewport: true }), svg: ext.generateData() });
            this.store('markups');
        }
        ext.leaveEditMode();
        ext.hide();
        this.editing = null;
        this.root.querySelectorAll('[data-mk-edit]').forEach(r => { r.hidden = true; });
        this.root.querySelector('[data-mk-name]').value = '';
        this.note(action === 'save' ? 'Saved. Click it in the list to show it again.' : 'Draw over the 3D view or the plan; a markup is saved with its view and opens on it again.');
        this.renderLists();
    }

    async startMarkup() {
        if (this.editing) return;
        this.tour.stopTools();
        await this.hideMarkups();
        const viewer = await this.viewerFor(this.on), ext = await this.markupsOn(viewer);
        ext.show();
        ext.enterEditMode();
        this.editing = { ext, viewer, on: this.on };
        this.root.querySelectorAll('[data-mk-edit]').forEach(r => { r.hidden = false; });
        this.setTool(this.tool);
        this.note(`Drawing on the ${this.on === 'plan' ? 'plan' : '3D view'} (the view is held still while you draw). Save or Cancel when done.`);
    }

    async toggleMarkup(m) {
        if (this.editing) return;
        if (this.shown === m.id) { await this.hideMarkups(); this.renderLists(); return; }
        await this.hideMarkups();
        if (m.on === 'plan') {
            const sheet = this.views.sheets.find(s => s.node.name() === m.sheet);
            await this.tour.twoD.plan();
            if (sheet && sheet.node !== this.views.model2d?.getDocumentNode()) await this.views.openSheet(sheet.node);
        }
        const viewer = await this.viewerFor(m.on), ext = await this.markupsOn(viewer);
        viewer.restoreState(m.state, null, true); // a markup belongs to the view it was drawn on
        ext.show();
        ext.loadMarkups(m.svg, m.id);
        this.shown = m.id;
        this.shownOn = ext;
        this.note(`Showing "${m.name}". Click it again to hide it.`);
        this.renderLists();
    }

    async hideMarkups() {
        if (this.shownOn) { this.shownOn.unloadMarkupsAllLayers(); this.shownOn.hide(); }
        this.shown = null;
        this.shownOn = null;
    }

    // --- Screenshots ---------------------------------------------------------------------------------------------------
    async screenshot(which) {
        const viewer = which === 'plan' ? await this.tour.twoD.plan() : this.tour.viewer;
        const name = `${(this.tour.modelName || 'model').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '')}-${which === 'plan' ? 'plan' : '3d'}.png`;
        viewer.getScreenShot(0, 0, (url) => {
            const a = Object.assign(document.createElement('a'), { href: url, download: name });
            document.body.append(a);
            a.click();
            a.remove();
        });
    }

    stop() {
        this.stopPlay();
        if (this.editing) { this.editing.ext.leaveEditMode(); this.editing.ext.hide(); this.editing = null; }
        this.hideMarkups();
    }
}
