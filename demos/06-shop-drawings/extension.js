// Demo 06: Framing Shop Drawings. Pick a wall, isolate it in elevation, lay out the framing (studs, tracks,
// jambs, headers, sills, cripples) and export an 11x17 shop drawing with a CAS-style cut list and labels.
// Spec: demos/06-shop-drawings/README.md. Layout math: ../common/framing.mjs (shared with the takeoff); sheet: ./sheet.mjs; assemblies: the takeoff rules.
// Wall geometry comes from the model itself with documented Viewer calls: the wall's axis from a top-view scan and its
// openings from an elevation scan (clientToWorld hits on the wall face), because this 3D view has no door/window objects.
// Context mode loads the document's other 3D views (floors, stairs, lighting, roofs; MEP views load the same way) next to
// the walls and cuts everything to a box 1 ft past the wall on every side, depth included.
// Framing context for each picked wall (./context.js reads it, ./conditions.mjs interprets it): the rooms on each side
// (from the level plan), head of wall (full height to the slab above, or partial), base, what the ends meet, and what
// else is within 1 ft. Each picked wall gets a panel page (core/client/panel.html) that the sheet's QR code links to.
// Viewer3D (isolate, fitToView, clientToWorld, worldToClient, setGhosting, getCamera, CAMERA_CHANGE_EVENT, GEOMETRY_LOADED_EVENT, setCutPlanes,
//   loadDocumentNode with keepCurrentModels + globalOffset, hideModel, showModel, unloadModel, setThemingColor, clearThemingColors):
//   https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Navigation (setView, getTarget, getEyeVector, setVerticalFov): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Navigation/
// Document / BubbleNode (search for the 3D viewables): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Document/
import { loadPropertyMap, getWallData, onModelReady, getBulkProperties, propValue, escapeHtml, fetchJson, downloadCsv, loadState, saveState, markContextNode } from '../../helpers.js';
import { assemblyFor, boardFor } from '../02-takeoff/calc.mjs';
import { frameWall, fmtFtIn, flipLayout } from '../common/framing.mjs';
import { renderSheet, renderSheetPdf, sheetSize, SHEETS } from './sheet.mjs';
import { scanWall, lookAtWall, saveScan, ensure3dShown } from '../common/wallscan.js';
import { roomsBeside, probeSlabs, probeNearby, contextBox, wallPoint, wallSize } from './context.js';
import { headOfWall, baseOfWall, summarizeNearby, conditionLines } from './conditions.mjs';
import { CONFIG } from '../../config.js';
import { INDEX_STATE, indexEntry } from './panels.mjs';

const EXTENSION_ID = 'Drywall.ShopDrawings';
const STATE_NAME = 'shop-drawings';
const LOGO_URL = new URL('./cas-logo.png', import.meta.url).href;
const GAUGES = [[18, '18 mil (25 ga)'], [30, '30 mil (20 ga EQ)'], [33, '33 mil (20 ga)'], [43, '43 mil (18 ga)'], [54, '54 mil (16 ga)']];
const NOT_SET = 'Not set';
const CONTEXT_FT = 1; // context box: this far past the wall on every side
const HIGHLIGHT = () => new THREE.Vector4(0.1, 0.45, 0.85, 0.35); // the picked wall in context mode
const HI = { fill: '#ff8a3d', stroke: '#b34700' }; // members of the highlighted mark (same colors as the sheet preview)

class ShopDrawingsExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.panel = this.options.panel;
        this.panel.classList.add('wide');
        this.settings = { spacingIn: 16, mils: 33, overlay: true };
        this.panel.innerHTML = `<div class="demo-panel"><h2>Framing Shop Drawings</h2><p class="muted" data-status>Waiting for a model…</p></div>`;
        this.onSelection = () => {
            const ids = this.viewer.getSelection();
            if (ids.length === 1 && this.byDbId?.has(ids[0]) && ids[0] !== this.current?.dbId && !this.busy) this.pick(ids[0]);
        };
        this.onCamera = () => { if (!this.drawPending) { this.drawPending = true; requestAnimationFrame(() => { this.drawPending = false; this.drawOverlay(); }); } };
        this.viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection);
        this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCamera);
        this.stops = [
            onModelReady(this.viewer, (model) => this.init(model)),
            this.views.on('level', () => { if (this.walls && !this.busy) this.render(); }),
        ];
        return true;
    }

    unload() {
        this.stops.forEach(stop => stop());
        this.viewer.removeEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, this.onSelection);
        this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCamera);
        this.clearContext();
        (this.contextModels || []).forEach(m => this.viewer.unloadModel(m));
        this.contextModels = null;
        this.overlay?.remove();
        this.modal?.remove();
        this.printFrame?.remove();
        this.panel.classList.remove('wide');
        this.panel.innerHTML = '';
        return true;
    }

    async init(model) {
        this.contextModels = null; // a new model: its context views load on the next context request
        this.contextShown = false;
        try {
            const [map, rules, takeoff, saved] = await Promise.all([loadPropertyMap(), fetchJson('samples/takeoff-rules.json'), loadState('takeoff'), loadState(STATE_NAME)]);
            this.map = map;
            this.rules = rules;
            this.overrides = takeoff.overrides || {}; // same assemblies as the takeoff demo
            this.settings = { ...this.settings, spacingIn: rules.settings.studSpacingIn, ...saved.settings };
            this.flips = saved.flips || {}; // wall externalId -> true: the panel is drawn as seen from side B
            this.sheets = saved.sheets || {}; // wall externalId -> SHEETS key; 'auto' (the default) sizes the sheet to the panel
            const { walls } = await getWallData(model, map);
            const extra = await getBulkProperties(model, walls.map(w => w.dbId), ['Type Mark', 'Unconnected Height', 'Base Offset', 'Width', 'Top Constraint', 'Top Offset', 'Top is Attached']);
            const byId = new Map(extra.map(r => [r.dbId, r]));
            this.walls = walls.map(w => {
                const r = byId.get(w.dbId);
                return { ...w, typeMark: propValue(r, 'Type Mark') || 'W', heightFt: propValue(r, 'Unconnected Height'), baseOffsetFt: propValue(r, 'Base Offset') || 0, widthFt: Number(propValue(r, 'Width')) || 0,
                    revit: { topConstraint: propValue(r, 'Top Constraint') || '', topOffsetFt: Number(propValue(r, 'Top Offset')) || 0, topAttached: !!Number(propValue(r, 'Top is Attached')) },
                    asm: assemblyFor(w.wallType ?? NOT_SET, rules, this.overrides) };
            });
            this.byDbId = new Map(this.walls.map(w => [w.dbId, w]));
            this.render();
            const wanted = new URLSearchParams(location.search).get('panel');
            const target = wanted && this.walls.find(w => w.externalId === wanted);
            if (target) setTimeout(() => this.pick(target.dbId), 500);
        } catch (err) {
            this.panel.querySelector('[data-status]').textContent = `Could not start shop drawings: ${err.message || err}`;
        }
    }

    // --- Panel ---------------------------------------------------------------------------------------

    render() {
        const level = this.views.level?.name;
        const framed = this.framedList = this.walls.filter(w => w.asm.scope === 'framed' && (!level || (w.level ?? NOT_SET) === level))
            .sort((a, b) => (a.level || '').localeCompare(b.level || '', undefined, { numeric: true }) || b.length - a.length);
        const c = this.current;
        this.panel.innerHTML = `<div class="demo-panel"><h2>Framing Shop Drawings</h2>
            <p class="muted">Click a wall in 3D or on the plan, or pick one below. The wall is isolated in elevation with its studs laid out,
                and you can export an 11x17 shop drawing with the cut list and CAS labels.</p>
            <div class="row">
                <label>Studs @ <select data-set="spacingIn">${[12, 16, 24].map(v => `<option value="${v}" ${v === this.settings.spacingIn ? 'selected' : ''}>${v}" o.c.</option>`).join('')}</select></label>
                <label>Gauge <select data-set="mils">${GAUGES.map(([v, l]) => `<option value="${v}" ${v === this.settings.mils ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label><input type="checkbox" data-overlay ${this.settings.overlay ? 'checked' : ''}> Members in 3D</label>
                <label title="Show the other model views (floors, stairs, lighting, roofs, other walls) within ${CONTEXT_FT} ft of the wall on every side, depth included">
                    <input type="checkbox" data-context ${this.context ? 'checked' : ''}> Context ±${CONTEXT_FT} ft</label>
            </div>
            <p class="muted" data-context-status>${escapeHtml(this.contextStatus || '')}</p>
            <div data-current>${c ? this.currentHtml() : '<p class="muted">No wall picked yet.</p>'}</div>
            <h3>Framed walls ${level ? `on ${escapeHtml(level)}` : '(all levels; pick a level in the header to narrow)'} <span class="muted">(${framed.length})</span></h3>
            <table><thead><tr><th>Wall</th><th>Type</th><th class="num">Length</th></tr></thead><tbody data-list></tbody></table>
            ${framed.length > 150 ? '<p class="muted">Showing the 150 longest. Pick a level to see all of its walls.</p>' : ''}
            <p class="note">Openings are found from the wall geometry (holes in the wall), so verify rough openings against the door and window schedules.
                Assemblies come from the takeoff rules and the Assemblies tab of Demo 2.</p></div>`;
        const list = this.panel.querySelector('[data-list]');
        for (const w of framed.slice(0, 150)) {
            const tr = document.createElement('tr');
            tr.className = `clickable ${w.dbId === c?.dbId ? 'selected' : ''}`;
            tr.innerHTML = `<td>${escapeHtml(`${w.typeMark}-${w.dbId}`)}<br><span class="muted">${escapeHtml(w.level || '')}</span></td>
                <td>${escapeHtml(w.wallType || '')}</td><td class="num">${fmtFtIn(Number(w.length) * 12)}</td>`;
            tr.onclick = () => this.pick(w.dbId);
            list.appendChild(tr);
        }
        this.panel.querySelectorAll('[data-set]').forEach(el => el.onchange = () => {
            this.settings[el.dataset.set] = Number(el.value);
            this.saveSettings();
            if (this.current) this.relayout();
        });
        this.panel.querySelector('[data-overlay]').onchange = (e) => { this.settings.overlay = e.target.checked; this.saveSettings(); this.drawOverlay(); };
        this.panel.querySelector('[data-context]').onchange = (e) => this.setContext(e.target.checked);
        const $ = (s) => this.panel.querySelector(s);
        if (c?.layout) {
            $('[data-sheet]').onclick = () => this.showSheet();
            this.panel.querySelectorAll('[data-step]').forEach(b => b.onclick = () => this.step(Number(b.dataset.step)));
            $('[data-svg]').onclick = () => this.downloadSvg();
            $('[data-pdf]').onclick = () => this.downloadPdf();
            $('[data-print]').onclick = () => this.printSheet();
            $('[data-csv]').onclick = () => this.exportCutList();
            $('[data-elev]').onclick = () => this.elevationCamera();
            $('[data-flip]').onchange = (e) => this.setFlip(e.target.checked);
            $('[data-sheet-size]').onchange = (e) => this.setSheetPref(e.target.value);
            $('[data-exit]').onclick = () => this.exit();
            this.panel.querySelectorAll('tr[data-mark]').forEach(tr => tr.onclick = () => this.setHighlight(tr.dataset.mark));
            this.bindHighlightClear();
        }
    }

    currentHtml() {
        const c = this.current, lay = c.layout;
        if (c.error) return `<p class="warn">${escapeHtml(c.error)}</p>`;
        return `<h3>${escapeHtml(c.mark)} <span class="muted">${escapeHtml(c.wall.wallType || '')}</span></h3>
            ${this.stepperHtml()}
            <div class="row"><button data-sheet class="active">Open shop drawing</button><button data-pdf>Download PDF</button><button data-print>Print</button>
                <label title="Draw the panel as seen from its other face (side B): mirrored, ordinates from the other end, labels unchanged">
                    <input type="checkbox" data-flip ${this.isFlipped(c) ? 'checked' : ''}> Flip panel</label>
                <label title="Sheet size. Auto: 11 x 17, or a larger sheet when the panel would be drawn smaller than 1/4&quot; = 1'-0&quot;">Sheet
                    <select data-sheet-size>${[['auto', `Auto (${sheetSize(lay).label})`], ...Object.entries(SHEETS).map(([k, v]) => [k, v.label])]
                        .map(([k, l]) => `<option value="${k}" ${k === this.sheetPref(c) ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></label></div>
            <p class="muted">${escapeHtml(c.wall.asm.label || '')} · ${fmtFtIn(lay.lengthIn)} long × ${fmtFtIn(lay.heightIn)} high ·
                ${lay.openings.length} opening(s) · ${lay.cutList.reduce((a, r) => a + r.qty, 0)} members</p>
            ${lay.notes.map(t => `<p class="warn">${escapeHtml(t)}</p>`).join('')}
            ${lay.issues?.length ? `<p class="warn"><b>Framing check failed (${lay.issues.length}): do not release.</b> ${lay.issues.slice(0, 6).map(i => escapeHtml(i.message)).join(' · ')}</p>`
                : '<p class="muted">✓ Framing check passed: no member through an opening, no crossing members, every opening framed.</p>'}
            <div class="row"><button data-svg>Download SVG</button><button data-csv>Cut list CSV</button><button data-elev>Elevation view</button><button data-exit>Back to model</button>
                <a href="${escapeHtml(this.panelUrl(c))}" target="_blank" rel="noopener" title="The page the QR code on the sheet opens: the panel drawing, links and comments">Panel page ↗</a></div>
            ${this.contextHtml()}
            <p class="muted">Click a mark here or a label in the 3D view to highlight all of its members.</p>
            <div data-hi-status>${this.highlightHtml()}</div>
            <table><thead><tr><th>Mark</th><th class="num">Qty</th><th>Member</th><th class="num">Length</th></tr></thead><tbody>
            ${lay.cutList.map(r => `<tr class="clickable ${r.mark === this.highlight ? 'hi' : ''}" data-mark="${escapeHtml(r.mark)}" title="Highlight the ${r.qty} ${escapeHtml(r.mark)} members"><td><b>${r.mark}</b></td><td class="num">${r.qty}</td><td>${escapeHtml(r.type)} <b>${escapeHtml(r.func || '')}</b><br><span class="muted">${escapeHtml(r.roles)}</span></td><td class="num">${fmtFtIn(r.lengthIn)}</td></tr>`).join('')}
            </tbody></table>`;
    }

    contextHtml() {
        const c = this.current;
        if (c.reading) return '<p class="muted">Reading the framing context (rooms, head and base of wall, what is around it)…</p>';
        if (!c.ctx) return '';
        const lines = conditionLines({ ...c.ctx, url: null });
        return `<details open class="context"><summary><b>Framing context</b> <span class="muted">(from the model; verify in the field)</span></summary>
            <table>${lines.map(([k, v]) => `<tr><td class="muted" style="white-space:nowrap">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table></details>`;
    }

    async saveSettings() {
        await saveState(STATE_NAME, { settings: this.settings, flips: this.flips, sheets: this.sheets }).catch(err => console.warn('Settings not saved:', err.message));
    }

    // --- Flip: the panel drawn from side B (sheet, 3D drawing and camera); the members and labels don't change -------

    isFlipped(c = this.current) {
        return !!(c?.wall?.externalId && this.flips?.[c.wall.externalId]);
    }

    sheetPref(c = this.current) {
        return (c?.wall?.externalId && this.sheets?.[c.wall.externalId]) || 'auto';
    }

    setSheetPref(pref) {
        const c = this.current;
        if (!c?.wall?.externalId) return;
        if (pref === 'auto') delete this.sheets[c.wall.externalId]; else this.sheets[c.wall.externalId] = pref;
        this.saveSettings();
        this.savePanel(c).catch(err => console.warn('Panel page not saved:', err.message));
        if (this.modal) this.showSheet();
    }

    // The layout as drawn: flipped when the panel is viewed from side B.
    viewLayout(c = this.current) {
        return this.isFlipped(c) ? flipLayout(c.layout) : c.layout;
    }

    async setFlip(on) {
        const c = this.current;
        if (!c?.wall?.externalId) return;
        if (on) this.flips[c.wall.externalId] = true; else delete this.flips[c.wall.externalId];
        this.saveSettings();
        this.savePanel(c).catch(err => console.warn('Panel page not saved:', err.message));
        if (!this.contextShown) await this.elevationCamera();
        this.drawOverlay();
        if (this.modal) this.refreshSheetPreview();
    }

    // --- Pick a wall: scan its geometry, lay out the framing, show it in elevation ------------------------------

    async pick(dbId) {
        const wall = this.byDbId.get(dbId);
        if (!wall || this.busy) return;
        if (wall.asm.scope !== 'framed') {
            this.current = { dbId, wall, mark: `${wall.typeMark}-${dbId}`, error: `${wall.wallType} is not framed (${wall.asm.label}). Pick a stud wall.` };
            this.render();
            return;
        }
        this.busy = true;
        this.panel.querySelector('[data-current]').innerHTML = '<p class="muted">Scanning the wall geometry…</p>';
        this.clearContext(); // the scan must only see this wall
        try {
            await ensure3dShown(this.viewer, this.views); // picked on the plan with the 2D-only layout: bring the 3D view back
            const geom = await this.scan(dbId);
            this.current = { dbId, wall, geom, mark: `${wall.typeMark}-${dbId}` };
            this.highlight = null;
            this.relayout(false);
            this.views.isolate([dbId], { fit: false });
            // The 2D pane shows the wall on its own level's master plan (without re-applying the level cut in 3D).
            const plan = this.views.planFor(wall.level);
            if (this.views.showing2d && plan && plan !== this.views.model2d?.getDocumentNode()) await this.views.openSheet(plan);
            const c = this.current;
            c.reading = true;
            this.render();
            c.ctx = await this.readContext(c).catch(err => { console.warn('Framing context not read:', err); return { level: wall.level, error: err.message || String(err) }; });
            c.reading = false;
            if (this.context) await this.showContext(); else await this.elevationCamera();
            this.savePanel(c).catch(err => console.warn('Panel page not saved:', err.message));
        } catch (err) {
            console.error(err);
            this.current = { dbId, wall, mark: `${wall.typeMark}-${dbId}`, error: `Could not read this wall's geometry: ${err.message || err}` };
        } finally {
            this.busy = false;
        }
        this.render();
        this.drawOverlay();
    }

    relayout(render = true) {
        const c = this.current;
        if (!c?.geom) return;
        const a = c.wall.asm;
        c.layout = frameWall({ lengthIn: c.geom.lengthIn, heightIn: c.geom.heightIn, openings: c.geom.openings, studIn: a.studIn, rows: a.rows,
            spacingIn: a.spacingIn || this.settings.spacingIn, mils: this.settings.mils, member: a.member });
        c.layout.notes.push(...(c.geom.notes || []));
        if (this.highlight && !c.layout.cutList.some(r => r.mark === this.highlight)) this.highlight = null; // marks renumber with the layout
        if (render) { this.render(); this.drawOverlay(); }
    }

    // Wall frame and openings from the geometry (demos/common/wallscan.js); saved for the takeoff too.
    async scan(dbId) {
        const wall = this.byDbId.get(dbId);
        this.sectionOff = true;
        this.savedFov ??= this.viewer.getCamera().fov;
        const geom = await scanWall(this.viewer, dbId, { level: this.views.levelOf(wall.level), heightFt: wall.heightFt, baseOffsetFt: wall.baseOffsetFt });
        this.elevation = geom.elevation;
        geom.depthIn = Math.max(geom.depthIn || 0, wall.widthFt * 12); // the top view can miss finish layers; Revit Width is the full wall
        saveScan(wall.externalId, geom).catch(err => console.warn('Scan not saved:', err.message));
        return geom;
    }

    // Look straight at side A of the wall with a narrow field of view.
    async elevationCamera() {
        if (!this.elevation) return;
        const e = this.elevation;
        await lookAtWall(this.viewer, this.isFlipped() ? { ...e, n: e.n.clone().negate(), u: e.u.clone().negate() } : e);
    }

    // --- 3D overlay: the framing drawn on the wall face, kept in place as the camera moves ------------------------

    drawOverlay() {
        const c = this.current;
        if (!this.overlay) {
            this.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            this.overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';
            this.viewer.container.appendChild(this.overlay);
            // Only the labels take the mouse; the rest of the overlay lets clicks and orbits through to the viewer.
            const onLabel = (e) => e.target.closest?.('[data-mark]');
            for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart', 'dblclick']) {
                this.overlay.addEventListener(type, (e) => { if (onLabel(e)) e.stopPropagation(); });
            }
            this.overlay.addEventListener('click', (e) => { const el = onLabel(e); if (el) { e.stopPropagation(); this.setHighlight(el.dataset.mark); } });
        }
        if (!c?.layout || !this.settings.overlay) { this.overlay.innerHTML = ''; return; }
        const flipped = this.isFlipped(c), lay = this.viewLayout(c), { up } = c.geom;
        const { L, D } = wallSize(c.geom);
        const origin = flipped ? wallPoint(c.geom, L, D + 0.02, c.geom.origin.z) : c.geom.origin;
        const u = flipped ? c.geom.u.clone().negate() : c.geom.u;
        // Wall-face inches (x along the wall as drawn, y up) -> screen pixels.
        const at = (x, y) => this.viewer.worldToClient(origin.clone().add(u.clone().multiplyScalar(x / 12)).add(up.clone().multiplyScalar(y / 12)));
        const xy = (p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        const parts = [];
        const hiMark = this.highlight, isHi = (m) => m.mark === hiMark;
        const fade = hiMark ? ' opacity="0.4"' : ''; // with a highlight, the other members fade back
        const rows = new Map(lay.cutList.map(r => [r.mark, r]));
        const ordered = [...lay.members].sort((a, b) => isHi(a) - isHi(b)); // highlighted members drawn last (on top)
        for (const m of ordered) {
            const pts = [at(m.x, m.y), at(m.x + m.w, m.y), at(m.x + m.w, m.y + m.h), at(m.x, m.y + m.h)].map(xy).join(' ');
            parts.push(isHi(m) ? `<polygon points="${pts}" fill="${HI.fill}" fill-opacity="0.95" stroke="${HI.stroke}" stroke-width="2"/>`
                : m.orient === 'h' ? `<polygon points="${pts}" fill="#f2d64b" fill-opacity="0.85" stroke="#6b5a00" stroke-width="1"${fade}/>`
                : `<polygon points="${pts}" fill="#ffffff" fill-opacity="0.85" stroke="#1c1c1c" stroke-width="1"${fade}/>`);
        }
        // Labels on every member, like the sheet: studs at mid-height along the stud, tracks near their left end
        // (above the top and head tracks, below the bottom and sill tracks). Sized to the stud spacing on screen.
        const p0 = at(0, 0), p12 = at(12, 0);
        const pxPerFt = Math.hypot(p12.x - p0.x, p12.y - p0.y);
        const size = Math.min(12, Math.max(7, pxPerFt * 0.55));
        // Stud labels need about 8 px between studs; zoomed further out only the tracks and the highlighted mark are labeled.
        const studLabels = (pxPerFt * (c.layout.spacingIn || 16)) / 12 >= 8;
        if (pxPerFt >= 1.5) {
            const label = (p, angle, mark, fill, anchor = 'middle') => {
                if (angle > 90) angle -= 180; else if (angle < -90) angle += 180; // keep text upright
                const hi = mark === hiMark, r = rows.get(mark);
                const tip = r ? `${mark}: ${r.qty} x ${r.type} @ ${fmtFtIn(r.lengthIn)} (${r.roles}). Click to ${hi ? 'clear the highlight' : 'highlight all of them'}.` : mark;
                parts.push(`<text data-mark="${escapeHtml(mark)}" x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" font-size="${(hi ? size * 1.2 : size).toFixed(1)}" font-family="Arial" font-weight="bold"
                    text-anchor="${anchor}" dominant-baseline="middle" fill="${hi ? HI.stroke : fill}" stroke="#ffffff" stroke-width="3" paint-order="stroke"
                    style="pointer-events:auto;cursor:pointer"${hiMark && !hi ? ' opacity="0.45"' : ''}
                    transform="rotate(${angle.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)})"><title>${escapeHtml(tip)}</title>${escapeHtml(mark)}</text>`);
            };
            const angleOf = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
            for (const m of ordered) {
                if (m.orient === 'v') {
                    if (!studLabels && !isHi(m)) continue;
                    const cx = m.x + m.w / 2;
                    label(at(cx, m.y + m.h / 2), angleOf(at(cx, m.y), at(cx, m.y + m.h)), m.mark, '#b00020');
                } else {
                    const above = m.role === 'top track' || m.role === 'head track';
                    const x = m.x + Math.min(8, m.w / 2);
                    const a = at(x, above ? m.y + m.h : m.y), b = at(x, above ? m.y + m.h + 12 : m.y - 12); // 1 ft off the track, outward
                    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, off = size * 0.9;
                    const p = { x: a.x + ((b.x - a.x) / len) * off, y: a.y + ((b.y - a.y) / len) * off };
                    label(p, angleOf(at(m.x, m.y), at(m.x + m.w, m.y)), m.mark, '#6b4f00', 'start');
                }
            }
        }
        if (!studLabels) {
            parts.push(`<text x="10" y="18" font-size="12" font-family="Arial" fill="#1c1c1c" stroke="#ffffff" stroke-width="3" paint-order="stroke">`
                + `Zoom in to label every stud${hiMark ? '' : ', or pick a mark in the panel'}</text>`);
        }
        this.drawLocation(c, at, size, parts);
        this.overlay.innerHTML = parts.join('');
    }

    // Rooms on each side and the head / base condition, in dark text next to the wall. Straight-on (elevation), both
    // sides stack under the wall; at an angle, each room name sits on the floor on its own side.
    drawLocation(c, at, size, parts) {
        const ctx = c.ctx;
        if (!ctx) return;
        const g = c.geom, { L, D, base } = wallSize(g);
        const dark = (p, s, { anchor = 'start', weight = 'normal', px = 12 } = {}) => parts.push(`<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" font-size="${px}"
            font-family="Arial" font-weight="${weight}" text-anchor="${anchor}" fill="#1c1c1c" stroke="#ffffff" stroke-width="3" paint-order="stroke">${escapeHtml(s)}</text>`);
        const room = (r) => (r ? [r.number, r.name].filter(Boolean).join(' ') : 'no room found');
        const eye = this.viewer.navigation.getEyeVector();
        const straightOn = Math.abs(eye.clone().normalize().dot(g.n)) > 0.95;
        const [near, far] = this.isFlipped(c) ? [['B', ctx.rooms?.B], ['A', ctx.rooms?.A]] : [['A', ctx.rooms?.A], ['B', ctx.rooms?.B]];
        const below = at(0, 0), gap = size * 2.4;
        if (ctx.rooms && !ctx.rooms.note) {
            if (straightOn) {
                dark({ x: below.x, y: below.y + gap }, `SIDE ${near[0]} (this side): ${room(near[1])}`, { weight: 'bold' });
                dark({ x: below.x, y: below.y + gap + 15 }, `SIDE ${far[0]} (far side): ${room(far[1])}`);
            } else {
                const a = this.viewer.worldToClient(wallPoint(g, L / 2, -2, base)), b = this.viewer.worldToClient(wallPoint(g, L / 2, D + 2, base));
                dark(a, `A · ${room(ctx.rooms.A)}`, { anchor: 'middle', weight: 'bold' });
                dark(b, `B · ${room(ctx.rooms.B)}`, { anchor: 'middle', weight: 'bold' });
            }
        }
        const topRight = at(c.layout.lengthIn, c.layout.heightIn), bottomRight = at(c.layout.lengthIn, 0);
        if (ctx.head) dark({ x: topRight.x, y: topRight.y - gap }, `HEAD: ${ctx.head.label}`, { anchor: 'end', weight: 'bold' });
        if (ctx.base) dark({ x: bottomRight.x, y: bottomRight.y + gap }, `BASE: ${ctx.base.label}`, { anchor: 'end' });
    }

    // --- Highlight one mark: all of its members in 3D, its cut list row, and the sheet preview ---------------------------

    setHighlight(mark) {
        this.highlight = mark && mark !== this.highlight ? mark : null; // clicking the same mark again clears it
        this.panel.querySelectorAll('tr[data-mark]').forEach(tr => tr.classList.toggle('hi', tr.dataset.mark === this.highlight));
        const status = this.panel.querySelector('[data-hi-status]');
        if (status) { status.innerHTML = this.highlightHtml(); this.bindHighlightClear(); }
        this.drawOverlay();
        if (this.modal) this.refreshSheetPreview();
    }

    highlightHtml() {
        const r = this.highlight && this.current?.layout?.cutList.find(x => x.mark === this.highlight);
        if (!r) return '';
        return `<p class="row"><span><span style="display:inline-block;width:0.9em;height:0.9em;background:${HI.fill};border:1px solid ${HI.stroke};vertical-align:-0.1em"></span>
            <b>${escapeHtml(r.mark)}</b> highlighted: ${r.qty} × ${escapeHtml(r.type)} @ ${fmtFtIn(r.lengthIn)} <span class="muted">(${escapeHtml(r.roles)})</span></span>
            <button data-hi-clear>Clear</button></p>`;
    }

    bindHighlightClear() {
        const b = this.panel.querySelector('[data-hi-clear]');
        if (b) b.onclick = () => this.setHighlight(null);
    }

    // --- Context mode: the other 3D views, cut to a box 1 ft past the wall on every side (depth included) -----------

    async setContext(on) {
        this.context = on;
        if (on && this.current?.geom) await this.showContext();
        else if (on) this.setContextStatus('Pick a wall to see what is around it.');
        else {
            this.clearContext();
            this.setContextStatus('');
            if (this.current?.geom) { this.views.isolate([this.current.dbId], { fit: false }); await this.elevationCamera(); }
        }
        this.render();
        this.drawOverlay();
    }

    // The document's other 3D viewables, loaded once next to the walls with the same global offset so they line up.
    async loadContextModels() {
        if (this.contextModels) return this.contextModels;
        const main = this.viewer.model, node = main.getDocumentNode();
        const nodes = node.getDocument().getRoot().search({ type: 'geometry', role: '3d' }).filter(n => n.guid() !== node.guid());
        this.setContextStatus(`Loading context: ${nodes.map(n => n.name()).join(', ') || 'no other 3D views in this model'}…`);
        const offset = main.getData().globalOffset;
        nodes.forEach(markContextNode); // keep them out of onModelReady (demos, views.setModel)
        // The probes need all of their geometry, not just the model root: wait for GEOMETRY_LOADED_EVENT (up to 30 s).
        const geometryDone = new Set();
        const onGeometry = (ev) => geometryDone.add(ev.model);
        this.viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeometry);
        const models = await Promise.all(nodes.map(n => this.viewer.loadDocumentNode(node.getDocument(), n, { keepCurrentModels: true, globalOffset: offset })
            .catch(err => { console.warn(`Context view ${n.name()} did not load:`, err); return null; })));
        for (let i = 0; i < 300 && models.some(m => m && !geometryDone.has(m)); i++) await new Promise(r => setTimeout(r, 100));
        this.viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeometry);
        this.contextModels = models.filter(Boolean);
        this.contextNames = nodes.filter((n, i) => models[i]).map(n => n.name());
        return this.contextModels;
    }

    async showContext() {
        const c = this.current, v = this.viewer;
        if (!c?.geom) return;
        const models = await this.loadContextModels();
        if (this.current !== c || !this.context) return; // picked another wall or turned off while loading
        models.forEach(m => v.showModel(m, true));
        v.isolate([], v.model); // other walls within the box are context too
        v.setThemingColor(c.dbId, HIGHLIGHT(), v.model);
        v.setCutPlanes(this.contextPlanes(c.geom));
        this.contextShown = true;
        this.setContextStatus(`Context ±${CONTEXT_FT} ft: ${['walls', ...(this.contextNames || [])].map(s => s.replace(/^Coord - (Arch )?/i, '').toLowerCase()).join(', ')}.`
            + (this.contextNames?.some(s => /mech|elec|plumb|mep|duct|pipe|hvac|fire/i.test(s)) ? '' : ' No duct, pipe or conduit views in this model; MEP views load the same way.'));
        this.contextCamera(c.geom);
    }

    clearContext() {
        if (!this.contextShown) return;
        const v = this.viewer;
        v.setCutPlanes([]);
        (this.contextModels || []).forEach(m => v.hideModel(m));
        v.clearThemingColors(v.model);
        this.views.applyColors(v, v.model); // shared colors (none in this demo, but keep the contract)
        this.contextShown = false;
        this.setContextStatus('');
    }

    setContextStatus(text) {
        this.contextStatus = text;
        const el = this.panel.querySelector('[data-context-status]');
        if (el) el.textContent = text;
    }

    contextPlanes(g) {
        return contextBox(g, CONTEXT_FT);
    }

    // Framing context: rooms from the plan, then the slabs and neighbors from the 3D views (loaded once, hidden after).
    async readContext(c) {
        const v = this.viewer, g = c.geom, wall = c.wall;
        const rooms = await roomsBeside(this.views, g, c.dbId).catch(err => ({ note: `Rooms not read: ${err.message || err}` }));
        const models = await this.loadContextModels();
        if (this.current !== c) throw new Error('another wall was picked');
        models.forEach(m => v.showModel(m, true));
        // The first time, their geometry is still streaming in: wait for it (Model.isLoadDone), up to 30 s.
        for (let i = 0; i < 300 && models.some(m => !m.isLoadDone()); i++) await new Promise(r => setTimeout(r, 100));
        v.isolate([c.dbId], v.model);
        await lookAtWall(v, this.elevation); // frame the wall before the probes
        let slabs, near;
        try {
            slabs = await probeSlabs(v, g, c.dbId);
            v.isolate([], v.model); // other walls count for the ends and "within 1 ft"
            near = await probeNearby(v, g, c.dbId, CONTEXT_FT);
        } finally {
            v.setCutPlanes([]);
            models.forEach(m => v.hideModel(m));
            v.isolate([c.dbId], v.model);
        }
        const { L, base, top } = wallSize(g);
        this.setContextStatus('');
        return {
            level: wall.level, rooms,
            head: headOfWall({ topZ: top, baseZ: base, above: slabs.above, revit: wall.revit }),
            base: baseOfWall({ baseZ: base, below: slabs.below }),
            nearby: summarizeNearby(near, L),
        };
    }

    // The panel page for this wall (the sheet's QR code): on the published site, or this server when there is none.
    panelUrl(c) {
        const base = CONFIG.publicUrl || new URL('.', location.href).href;
        return `${base.replace(/\/?$/, '/')}panel.html?p=${encodeURIComponent(c.wall.externalId || c.mark)}`;
    }

    // Previous / Next wall in the list below (the level in the header, longest first), so a level's shops can be walked
    // through without going back to the model.
    stepperHtml() {
        const list = (this.framedList || []).slice(0, 150), i = list.findIndex(w => w.dbId === this.current?.dbId);
        if (i < 0 || list.length < 2) return '';
        return `<div class="row"><button data-step="-1" ${i === 0 ? 'disabled' : ''}>‹ Previous wall</button>
            <span class="muted">${i + 1} of ${list.length}</span><button data-step="1" ${i === list.length - 1 ? 'disabled' : ''}>Next wall ›</button>
            <a href="panels.html" target="_blank" rel="noopener" title="Every saved shop drawing, one click each">All panel shops ↗</a></div>`;
    }

    step(delta) {
        const list = (this.framedList || []).slice(0, 150), i = list.findIndex(w => w.dbId === this.current?.dbId);
        const next = list[i + delta];
        if (next && !this.busy) this.pick(next.dbId);
    }

    // What the panel page shows: the layout inputs (it re-draws the sheet), the sheet info and the framing context.
    // The panel gallery's index is updated with it.
    async savePanel(c) {
        if (!c.layout || !c.wall.externalId) return;
        const a = c.wall.asm;
        const info = await this.sheetInfo(c);
        delete info.logoHref;
        delete info.qrUrl;
        const record = {
            key: c.wall.externalId, mark: c.mark, dbId: c.dbId, urn: location.hash.slice(1), savedAt: new Date().toISOString(),
            frame: { lengthIn: c.geom.lengthIn, heightIn: c.geom.heightIn, openings: c.geom.openings, studIn: a.studIn, rows: a.rows,
                spacingIn: a.spacingIn || this.settings.spacingIn, mils: this.settings.mils, member: a.member, notes: c.geom.notes || [] },
            info, conditions: c.ctx ? conditionLines({ ...c.ctx, url: null }) : [], view: { flip: this.isFlipped(c), sheet: this.sheetPref(c) },
        };
        await saveState(`shop-panel-${c.wall.externalId}`, record);
        // One index write at a time, so walking through walls quickly doesn't drop entries.
        this.indexQueue = (this.indexQueue || Promise.resolve()).then(async () => {
            const index = await loadState(INDEX_STATE).catch(() => ({}));
            await saveState(INDEX_STATE, { panels: { ...(index.panels || {}), [record.key]: indexEntry(record) } });
        }).catch(err => console.warn('Panel index not saved:', err.message));
        await this.indexQueue;
    }

    // Three-quarter view from side A, above and to the left, so the depth of the box reads.
    contextCamera(g) {
        const nav = this.viewer.navigation, L = g.lengthIn / 12, H = g.heightIn / 12, D = (g.depthIn || 12) / 12;
        const center = g.origin.clone().add(g.u.clone().multiplyScalar(L / 2)).add(g.up.clone().multiplyScalar(H / 2)).add(g.n.clone().multiplyScalar(-D / 2));
        const dir = g.n.clone().multiplyScalar(0.8).add(g.u.clone().multiplyScalar(-0.45)).add(g.up.clone().multiplyScalar(0.4)).normalize();
        const fov = Math.max(this.savedFov || 45, 30);
        const size = Math.hypot(L + 2 * CONTEXT_FT, H + 2 * CONTEXT_FT, D + 2 * CONTEXT_FT);
        nav.setVerticalFov(fov, false);
        nav.setView(center.clone().add(dir.multiplyScalar((size / 2 / Math.tan((fov * Math.PI) / 360)) * 0.8)), center, g.up);
    }

    // --- Sheet, exports -----------------------------------------------------------------------------------------

    async sheetInfo(c = this.current) {
        this.logo ??= await fetch(LOGO_URL).then(r => r.blob()).then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); })).catch(() => null);
        const a = c.wall.asm;
        const project = document.getElementById('models')?.selectedOptions[0]?.text || 'Project';
        return {
            mark: c.mark, project, level: c.wall.level || '-', wallType: c.wall.wallType || '-', assembly: a.label || '',
            board: a.layers ? `${a.layers[0]} + ${a.layers[1]} layers, ${boardFor(c.wall, a)}` : '-', fireRating: c.wall.fireRating,
            date: new Date().toISOString().slice(0, 10), drawnBy: 'CAS BIM Web Viewer', logoHref: this.logo,
            sourceNote: 'Revit model via APS Viewer; framing laid out from the wall geometry',
            conditions: c.ctx ? conditionLines({ ...c.ctx, url: null }) : [], qrUrl: this.panelUrl(c), sheet: this.sheetPref(c),
        };
    }

    async sheetSvg(extra = {}) {
        return renderSheet(this.viewLayout(), { ...(await this.sheetInfo()), ...extra });
    }

    // The logo as JPEG bytes for the PDF (PDF embeds JPEG as is): drawn on white, since JPEG has no transparency.
    async logoJpeg() {
        if (this.logoJpegData !== undefined) return this.logoJpegData;
        try {
            const img = new Image();
            img.src = LOGO_URL;
            await img.decode();
            const canvas = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
            const g = canvas.getContext('2d');
            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, canvas.width, canvas.height);
            g.drawImage(img, 0, 0);
            const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
            this.logoJpegData = { jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
        } catch (err) {
            console.warn('Logo not added to the PDF:', err);
            this.logoJpegData = null;
        }
        return this.logoJpegData;
    }

    // Vector PDF, 17 x 11 in (./pdf.mjs): the same drawing as the SVG, no print dialog needed.
    async downloadPdf() {
        const bytes = renderSheetPdf(this.viewLayout(), await this.sheetInfo(), await this.logoJpeg());
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        Object.assign(document.createElement('a'), { href: url, download: `shop-drawing-${this.current.mark}.pdf` }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async showSheet() {
        const svg = await this.sheetSvg({ highlight: this.highlight });
        this.modal?.remove();
        this.modal = document.createElement('div');
        this.modal.style.cssText = 'position:fixed;inset:0;z-index:50;background:rgba(0,0,0,0.55);display:flex;flex-direction:column;padding:1em;box-sizing:border-box';
        this.modal.innerHTML = `<div class="demo-panel" style="background:white;padding:0.5em 1em;display:flex;gap:0.5em;align-items:center;flex-wrap:wrap">
                <b style="flex:1">${escapeHtml(this.current.mark)}: framing shop drawing (${escapeHtml(sheetSize(this.viewLayout(), this.sheetPref()).label)})</b>
                <button data-pdf>Download PDF</button><button data-svg>Download SVG</button><button data-print>Print</button><button data-csv>Cut list CSV</button><button data-close>Close</button>
                <div style="flex-basis:100%;display:flex;gap:0.3em;flex-wrap:wrap;align-items:center"><span class="muted">Highlight a mark (preview only, not in the exports):</span><span data-chips style="display:contents">${this.markChips()}</span></div></div>
            <div style="flex:1;overflow:auto;background:#777;display:flex;justify-content:center;align-items:flex-start;padding:1em">
                <div data-preview style="background:white;width:min(100%, calc((100vh - 9em) * ${sheetSize(this.viewLayout(), this.sheetPref()).W} / ${sheetSize(this.viewLayout(), this.sheetPref()).H}));box-shadow:0 2px 12px rgba(0,0,0,0.4)">${this.previewSvg(svg)}</div></div>`;
        document.body.appendChild(this.modal);
        this.bindChips();
        const $ = (s) => this.modal.querySelector(s);
        $('[data-close]').onclick = () => { this.modal.remove(); this.modal = null; };
        $('[data-pdf]').onclick = () => this.downloadPdf();
        $('[data-svg]').onclick = () => this.downloadSvg();
        $('[data-print]').onclick = () => this.printSheet();
        $('[data-csv]').onclick = () => this.exportCutList();
    }

    previewSvg(svg) {
        return svg.replace(/width="[\d.]+in" height="[\d.]+in"/, 'width="100%" style="display:block"');
    }

    markChips() {
        return this.current.layout.cutList.map(r => `<button data-chip="${escapeHtml(r.mark)}" class="${r.mark === this.highlight ? 'active' : ''}"
            title="${r.qty} x ${escapeHtml(r.type)} @ ${fmtFtIn(r.lengthIn)}">${escapeHtml(r.mark)}</button>`).join('');
    }

    bindChips() {
        this.modal.querySelectorAll('[data-chip]').forEach(b => b.onclick = () => this.setHighlight(b.dataset.chip));
    }

    async refreshSheetPreview() {
        const modal = this.modal;
        const svg = await this.sheetSvg({ highlight: this.highlight });
        if (modal !== this.modal) return; // closed or reopened meanwhile
        modal.querySelector('[data-preview]').innerHTML = this.previewSvg(svg);
        modal.querySelector('[data-chips]').innerHTML = this.markChips();
        this.bindChips();
    }

    async downloadSvg() {
        const url = URL.createObjectURL(new Blob([await this.sheetSvg()], { type: 'image/svg+xml' }));
        Object.assign(document.createElement('a'), { href: url, download: `shop-drawing-${this.current.mark}.svg` }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // Print dialog at the sheet's size (11 x 17, or larger for a large panel), from a hidden frame (no pop-up to block).
    async printSheet() {
        const svg = await this.sheetSvg();
        this.printFrame?.remove();
        const frame = this.printFrame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
        document.body.appendChild(frame);
        const doc = frame.contentDocument;
        doc.open();
        doc.write(`<!DOCTYPE html><html><head><title>${escapeHtml(this.current.mark)} shop drawing</title>
            <style>@page { size: ${sheetSize(this.viewLayout(), this.sheetPref()).W}in ${sheetSize(this.viewLayout(), this.sheetPref()).H}in; margin: 0; } html, body { margin: 0; } svg { display: block; }</style></head><body>${svg}</body></html>`);
        doc.close();
        await Promise.all([...doc.images].map(img => img.decode?.().catch(() => {}))); // the logo (a data URL)
        await new Promise(r => setTimeout(r, 50));
        frame.contentWindow.focus();
        frame.contentWindow.print(); // returns when the dialog closes in Chrome and Edge
    }

    exportCutList() {
        const c = this.current;
        downloadCsv(`cut-list-${c.mark}.csv`, [
            [`${c.mark} - FRAMING CUT LIST`], [`Wall type: ${c.wall.wallType}`, `Level: ${c.wall.level}`, `Length: ${fmtFtIn(c.layout.lengthIn)}`, `Height: ${fmtFtIn(c.layout.heightIn)}`], [],
            ['Mark', 'Qty', 'Member type', 'Length', 'Length (in)', 'Members'],
            ...c.layout.cutList.map(r => [r.mark, r.qty, r.type, fmtFtIn(r.lengthIn), r.lengthIn, r.roles]),
        ]);
    }

    async exit() {
        const v = this.viewer;
        this.clearContext(); // stays switched on for the next wall
        this.current = null;
        this.elevation = null;
        this.drawOverlay();
        if (this.savedFov) v.navigation.setVerticalFov(this.savedFov, false);
        this.savedFov = null;
        this.views.isolate(null);
        if (this.sectionOff && this.views.level) await this.views.setLevel(this.views.level.name); // restore the level cut
        this.sectionOff = false;
        this.render();
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, ShopDrawingsExtension);
