// Panel Shop Generator (shop-generator.html): framing shop drawings without a model. A panel is drawn or typed in (its
// perimeter or shape, its doors, windows, MEP openings and steel penetrations, its members) and framed and drawn with the
// model's shop drawing code (demos/06-shop-drawings/generator.mjs, sheet.mjs). Nothing is uploaded: the set of panels,
// the sizes and members used before and the saved member combos are kept in this browser (localStorage); Export JSON
// keeps or shares a set, and a link (or the QR code on a sheet) opens one panel here.
// The elevation editor: the core members (top track, on-center studs, bottom track) over it; tools to select and move,
// draw the perimeter (a notch becomes a door or a steel penetration) or draw an opening; dimensions all around what is
// selected, hovered or being moved; the selected opening's members beside it (a catalogue: a preview and a list each).
import { reviewInfo, sourceInfo, labelReview } from './demos/06-shop-drawings/shop-output.mjs';
import { barPosition } from './demos/06-shop-drawings/quick-bar.mjs';
import { topAt, topMin, underMin, underAt, frameWall, webOnRight } from './demos/common/framing.mjs';
import { renderSheet, renderSheetPdf, renderSheetsPdf, renderSheetRegion, renderIsoView, partLines, lapLines, seatOf } from './demos/06-shop-drawings/sheet.mjs';
import { projectFromShop, STOCK as LABEL_STOCK, HANDOFF_KEY as LABEL_HANDOFF_KEY } from './demos/common/label-maker.mjs';
import * as W from './demos/06-shop-drawings/workspace.mjs';
import { sha256Hex } from './demos/common/sha256.mjs';
import { thumbnailSvg } from './demos/06-shop-drawings/panels.mjs';
import * as G from './demos/06-shop-drawings/generator.mjs';
import * as FP from './demos/06-shop-drawings/framing-plan.mjs';
import { resolvePlanBatch } from './demos/06-shop-drawings/batch-framing.mjs';
import { FRAMING_FIELDS as SOURCE_FRAMING_FIELDS, sourceFraming, framingOrigin } from './demos/06-shop-drawings/source-framing.mjs';
import * as P from './demos/06-shop-drawings/profiles.mjs';
import * as DT from './demos/06-shop-drawings/details.mjs';
import * as R from './demos/06-shop-drawings/opening-rules.mjs';
import * as MAN from './demos/06-shop-drawings/manual.mjs';
import * as CUT from './demos/06-shop-drawings/cutlist-types.mjs';
import * as CL from './demos/06-shop-drawings/context-lines.mjs';
import * as OC from './demos/06-shop-drawings/opening-context.mjs';
import * as OP from './demos/06-shop-drawings/opening-profiles.mjs';
import * as ST from './demos/06-shop-drawings/stock.mjs';
import * as TY from './demos/06-shop-drawings/typical.mjs';
import * as RV from './demos/06-shop-drawings/revisions.mjs';
import * as IM from './demos/06-shop-drawings/import-merge.mjs';
import * as SC from './demos/06-shop-drawings/style-catalog.mjs';
import { formatLength } from './demos/06-shop-drawings/criteria-names.mjs';
import { siteHits, mountHits } from './hits.js';
import { WallSketchControls } from './wall-sketch-controls.js';
import * as SK from './demos/06-shop-drawings/sketch-editing.mjs';
import { baseAt } from './demos/common/bottom-profile.mjs';
import { formatEditDimension, parseEditDimension, cleanDimensionFormat } from './demos/common/edit-dimensions.mjs';

const LOGO_URL = 'demos/06-shop-drawings/cas-logo.png';
const KEYS = { set: 'cas-shopgen:set', recent: 'cas-shopgen:recent', combos: 'cas-shopgen:combos', profiles: 'cas-shopgen:profiles', engineering: 'cas-shopgen:engineering', reviewer: 'cas-shopgen:reviewer',
    prefs: 'cas-shopgen:prefs', saved: 'cas-shopgen:saved', stock: 'cas-shopgen:stock', templates: 'cas-shopgen:templates' };
const main = document.getElementById('gen');
const $ = (sel) => main.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: this visit only */ } };
const today = () => new Date().toLocaleDateString('en-CA');
let dimensionFormat=cleanDimensionFormat(load('cas-shopgen:dimension-format','feet-inches'));
const editDimension=v=>formatEditDimension(v,dimensionFormat);
const parseDimension=v=>parseEditDimension(v,dimensionFormat);
const lenText=editDimension, fine=editDimension, inch=editDimension;

// A first visit starts with one panel; a set emptied here stays empty (the empty project's page offers what to do).
const storedSet = load(KEYS.set, null);
let set = storedSet?.panels ? { ...storedSet, panels: storedSet.panels.map(G.cleanPanel) } : { project: '', drawnBy: '', panels: [G.newPanel()], current: null };
let recent = load(KEYS.recent, {}); // field -> values used before, newest first
let combos = load(KEYS.combos, []); // [{ name, members }] saved here
let templates = load(KEYS.templates, []); // panel templates saved here: [{ name, panel (generator.templateOf), savedAt }]
// Framing profiles saved here: { jamb, head, sill: [profile] } (profiles.mjs), picked in an opening's Framing details.
let profiles = (() => { const raw = load(KEYS.profiles, {}); return Object.fromEntries(P.PROFILE_KINDS.map(k => [k, (Array.isArray(raw?.[k]) ? raw[k] : []).map(x => P.cleanProfile(k, x)).filter(Boolean)])); })();
// The engineering style catalog (the native catalog JSON, read and never changed) and this project's selection of it
// (style-catalog.mjs), kept in this browser: { text, read, selection } or null.
let eng = loadEngineering();
let engView = { tab: 'Wall', search: '', approver: null, reference: '' };
let stylePending = null; // a style applied with alternatives still to choose: { scope: 'wall' | opening index, panelId, keyId, open, problems, picked }
// The workspace (workspace.mjs): remembered presentation, and what is selected across the views, the cut list and issues.
let prefs = W.cleanPrefs(load(KEYS.prefs, {}));
let focusView = false; // temporary: restore the remembered layout when leaving focus
let selection = W.NONE;
const checked = new Set(); // panels checked in the set
let logoHref = null;
// The elevation editor's state.
let tool = 'select'; // 'select' (and move), 'perimeter' (draw it), 'opening' (draw a rectangle)
let sel = null; // the selected opening (its members in the catalogue)
let ask = null; // the opening just added: the catalogue asks for its members
let hover = null; // what the pointer is over: 'op:2', 'edge:3', 'pt:1', 'peak', …
let sketchEdge = null; // transient outline selection: { panelId, key }, never part of the project or Undo
let drag = null, rectDraw = null, peri = null, svgEl = null, view = null;
let sketchZoom = 1, sketchZoomPanel = null;
let sketchPan = false, panDrag = null, panOffset = { x: 0, y: 0 };
const sketchZoomSteps = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
main.querySelector('.sketch-zoom').addEventListener('click', e => {
    if (e.target.closest('[data-sketch-pan]')) {
        if (!cur() || drag || panDrag) return;
        sketchPan = !sketchPan; renderSketch(); renderHint(); return;
    }
    const button = e.target.closest('[data-sketch-zoom]');
    if (!button || !cur() || drag || panDrag) return;
    const action = button.dataset.sketchZoom;
    if (action === 'fit') { panOffset = { x: 0, y: 0 }; sketchPan = false; }
    sketchZoom = action === 'fit' ? 1 : action === 'in'
        ? sketchZoomSteps.find(n => n > sketchZoom) ?? 4
        : [...sketchZoomSteps].reverse().find(n => n < sketchZoom) ?? 0.5;
    fit(); renderSketch(); renderHint();
});
main.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !sketchPan) return;
    sketchPan = false; panDrag = null; renderSketch(); renderHint();
    e.preventDefault(); e.stopImmediatePropagation();
}, true);
const typing = new Set(); // member cards showing a box to type a size in
const cur = () => set.panels.find(p => p.id === set.current) || set.panels[0];
const sketchControls=new WallSketchControls({root:main,current:cur,layout:()=>layoutA(),notice,format:editDimension,parse:parseDimension,perimeter:()=>peri,redraw:()=>{renderSketch();renderHint();},dimensionFormat:()=>dimensionFormat,selectedEdge:()=>sketchEdge?.panelId===cur()?.id?sketchEdge.key:null,
    change:(next,label)=>{historyHint={label};replacePanel(next);changed();renderAll();},selectMember:key=>{const record=current.plan?.members.find(m=>m.memberKey===key||m.memberKey.startsWith(key+':'));if(record)selectTarget({kind:'member',key:record.memberKey});}});
const studName = (m) => G.parseMember(m.stud)?.name || m.stud;
const bottomTrack = (m) => G.parseMember(m.track)?.name || G.trackFor(m.stud) || m.track;

function setDimensionFormat(value){
    const next=cleanDimensionFormat(value);if(next===dimensionFormat)return;
    const pending=sketchControls.dialog.open?sketchControls.readDimension():undefined;
    if(pending===null){notice('Finish the dimension entry before switching formats.',true);for(const el of main.querySelectorAll('[data-dimension-format]'))el.value=dimensionFormat;return;}
    const typedLength=peri?.typed?parseDimension(peri.typed):null;
    dimensionFormat=next;store('cas-shopgen:dimension-format',next);
    if(typedLength!=null)peri.typed=editDimension(typedLength);
    renderAll(true);if(cur())renderWorkspace();
    sketchControls.syncDimensionFormat(pending);
}
main.addEventListener('change',event=>{if(event.target.matches('[data-dimension-format]'))setDimensionFormat(event.target.value);});

// --- Saving, notices --------------------------------------------------------------------------------------------------
let saveTimer = 0;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store(KEYS.set, { ...set, current: cur()?.id ?? null }), 250); };
function notice(text, warn = false) {
    const el = document.getElementById('notice');
    el.textContent = text;
    el.classList.toggle('warn', warn);
    el.hidden = !text;
    clearTimeout(notice.t);
    if (text) notice.t = setTimeout(() => { el.hidden = true; }, warn ? 9000 : 5000);
}

// --- Inputs: data-f="path" (on the panel, or set.* on the set), data-t: len (feet-inches), num, text ----------------
function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys[keys.length - 1]] = value;
}
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

// Locked to the Revit model: say so instead of changing it.
const lockedNotice = (what = 'its perimeter and the model\'s openings') => notice(`${cur().mark} is a Revit wall: ${what} stay as the model has them (Duplicate makes a free copy to change).`, true);
main.addEventListener('input', (e) => {
    if (e.target.matches?.('[data-nav-search]')) { navQuery = e.target.value; const at = e.target.selectionStart; renderSet(); const s = main.querySelector('[data-nav-search]'); s?.focus(); s?.setSelectionRange(at, at); return; }
    const el = e.target.closest('[data-f]');
    if (!el) return;
    const p = cur(), path = el.dataset.f, onSet = path.startsWith('set.');
    if (path === 'mark' && p && markBefore?.id !== p.id) markBefore = { id: p.id, mark: p.mark }; // the mark before this rename
    if (!onSet && !p) return;
    if (!onSet && !G.canEdit(p, path)) { lockedNotice(); return; }
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.t === 'len' || el.dataset.t === 'cut') {
        const n = parseDimension(v);
        hint(el, n);
        if (n == null) return;
        v = n;
    } else if (el.dataset.t === 'num') {
        v = Number(v);
        if (!Number.isFinite(v)) return;
    }
    const beforeShape=path.startsWith('shape.')?structuredClone(p):null;
    const right = /^openings\.(\d+)\.__right$/.exec(path), kind = /^openings\.(\d+)\.kind$/.exec(path);
    if (right) { const o = p.openings[Number(right[1])]; o.leftIn = Math.max(0, G.shapeTop(p.shape).lengthIn - v - o.widthIn); syncCatalogueFields(); }
    else if(path==='shape.lengthIn'&&SK.pinned(p,'right')){try{const next=SK.panelDimension(p,'width',v,'right');Object.assign(p,next);}catch(e){notice(e.message,true);renderAll();return;}}
    else if (path === 'shape.lengthIn' && p.shape.kind === 'custom') { setCustomLength(p, v); syncPointEnds(); }
    else if (path === 'shape.lengthIn' && p.shape.kind === 'gable' && Math.abs((p.shape.peakAtIn ?? 0) - p.shape.lengthIn / 2) < 1 / 8) {
        p.shape.lengthIn = v; p.shape.peakAtIn = v / 2; // a centered peak stays centered
        const peak = main.querySelector('[data-f="shape.peakAtIn"]');
        if (peak) peak.value = lenText(v / 2);
    } else setPath(onSet ? set : p, onSet ? path.slice(4) : path, v);
    if(beforeShape){const error=SK.pinError(beforeShape,p);if(error){replacePanel(beforeShape);notice(error,true);renderAll();return;}}
    if (kind) { setKind(p, Number(kind[1]), v); renderCatalogue(); renderChips(); }
    if (path === 'optimizeOpenings') notice(v ? 'Opening optimizer on: the studs on center start where the openings take the fewest stud pieces, every bay within the spacing.' : `Opening optimizer off: studs on center from the ${p.layoutFromRight ? 'right' : 'left'} end.`);
    if (path === 'flipStuds') notice(v ? 'Flip studs on: the studs on center face the other way (end studs and jambs still close their side).' : 'Flip studs off: the studs on center face the left end, as usual.');
    if (path === 'layoutFromRight') notice(v ? 'The stud layout starts from the right end, and the plan ordinates run from it (the studs face as before).' : 'The stud layout starts from the left end.');
    if (/^(optimizeOpenings|flipStuds|layoutFromRight)$/.test(path)) syncToggles();
    const toLayout = /^openings\.(\d+)\.toLayout$/.exec(path);
    if (toLayout) {
        const n = G.openingName(p.openings, Number(toLayout[1]));
        notice(v ? `${n}: its jambs moved out to the nearest studs on center, which are its jambs now (the rough opening stays as typed).` : `${n}: its jambs at the opening again.`);
        renderCatalogue();
    }
    if (el.closest('#sk-menu')) closeMenu();
    if (/^openings\.\d+\.(widthIn|leftIn)$/.test(path)) syncCatalogueFields(path);
    historyHint = { label: el.closest('label')?.querySelector('span')?.textContent?.trim() || path, mergeKey: `f:${path}:${onSet ? 'set' : p.id}` }; // typing in one field: one undo step
    changed();
});
// On leaving a field: the length as feet-inches, the value remembered for the next time, a new stud followed.
let studBefore = null;
let markBefore = null;
main.addEventListener('focusin', (e) => { if (e.target.matches?.('[data-f="members.stud"]')) studBefore = cur().members.stud; });
// The panel's mark: the box at the top of its card (or the mark on the elevation, clicked) selected to type over.
function renameFocus() {
    revealInspector();
    const el = $('#insp-context .ctx-mark');
    if (!el) return;
    el.focus(); el.select();
}
// A mark stays unique and never empty: else the one before comes back.
function markCheck(el) {
    const p = cur(), v = el.value.trim(), was = markBefore?.id === p?.id ? markBefore.mark : null;
    markBefore = null;
    if (!p || was == null) return;
    const taken = set.panels.some(x => x.id !== p.id && String(x.mark).trim().toLowerCase() === v.toLowerCase());
    if (v && !taken) { if (v !== p.mark) { p.mark = v; changed(); } if (v !== was) notice(`Renamed ${was} to ${v}.`); return; }
    p.mark = was; el.value = was; changed();
    notice(taken ? `${v} is another panel's mark: each panel keeps its own (${was} kept).` : 'A panel needs a mark: the one before is kept.', true);
}
main.addEventListener('change', (e) => {
    const cutType = e.target.closest('[data-cutlist-type]');
    if (cutType) { pickCutListType(cutType.dataset.cutlistType, cutType.value); return; }
    if (e.target.closest('[data-style], [data-style-q], [data-style-pick]')) { styleChange(e.target); return; }
    const prof = e.target.closest('[data-op-prof]');
    if (prof) { pickOpeningProfile(prof.dataset.opProf, prof.value); return; }
    const opProf = e.target.closest('[data-op-profile]');
    if (opProf) { pickProfile(cur(), Number(opProf.dataset.opProfile), opProf.value); return; }
    const addProf = e.target.closest('[data-add-profile]');
    if (addProf) { const v = addProf.value; addProf.value = ''; if (v) addFromProfile(cur(), v); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) { pickMember(pick.dataset.pick, pick.value); if (pick.closest('#sk-menu')) closeMenu(); return; }
    if (e.target.id === 'combo') { applyCombo(e.target.value); return; }
    if (e.target.id === 'cmp-rev') { cmpRev = Number(e.target.value) || null; renderWorkspace(); return; }
    if (e.target.matches('[data-qb-step]')) { manStep = Number(e.target.value) || 0.5; renderWorkspace(); return; }
    if (e.target.matches('[data-check]')) { e.target.checked ? checked.add(e.target.dataset.check) : checked.delete(e.target.dataset.check); renderSetActions(); return; }
    if (e.target.id === 'check-group') { for (const x of set.panels) if ((x.group || '') === e.target.value) checked.add(x.id); e.target.value = '__'; renderSet(); return; }
    const el = e.target.closest('[data-f]');
    if (!el) return;
    if (el.dataset.f === 'members.stud' && studBefore != null && studBefore !== el.value) { followStud(studBefore, el.value); studBefore = el.value; }
    markChosen(cur(), el.dataset.f);
    if (el.dataset.t === 'len') {
        const n = parseDimension(el.value);
        if (n != null) { el.value = lenText(n); hint(el, n, true); recent.len = G.remember(recent.len, lenText(n), 12); }
    }
    if (el.dataset.t === 'cut') { const n = parseDimension(el.value); if (n != null) { el.value = fine(n); hint(el, n, true); } }
    if (el.dataset.r) recent[el.dataset.r] = G.remember(recent[el.dataset.r], el.value);
    store(KEYS.recent, recent);
    renderDatalists();
    if (typing.has(el.dataset.f)) { typing.delete(el.dataset.f); renderMemberCards(); }
    if (el.dataset.f === 'mark') markCheck(el);
    if (el.dataset.f === 'mark' || el.dataset.f === 'group') { renderSet(); renderWorkspace(); }
    if (/^openings\.\d+\.offsetIn$/.test(el.dataset.f)) renderCatalogue(); // its rough opening in the strip
});
document.getElementById('import-file').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importJson(f); });
// A panel's member or spacing chosen here: its provenance says so (the resolved plan reports it).
function markChosen(p, path) {
    const k = /^members\.(stud|track|topTrack|spacingIn)$/.exec(path || '')?.[1];
    if (k && p.provenance) p.provenance = { ...p.provenance, [k]: 'user' };
}
function hint(el, n, quiet = false) {
    const h = el.parentElement.querySelector('.hint');
    if (!h) return;
    const typed = String(el.value).trim();
    h.textContent = n == null ? (typed ? 'Can\'t read this: type 10\'-6", 10\' 6 or 126' : '') : quiet || typed === lenText(n) ? '' : `= ${lenText(n)}`;
    h.classList.toggle('bad', n == null && !!typed);
}
// A drawn top's length: its last point stays at the right end; points past it go.
function setCustomLength(p, L) {
    p.shape.lengthIn = L;
    const pts = p.shape.points;
    while (pts.length > 2 && pts[pts.length - 2][0] >= L - 1) pts.splice(pts.length - 2, 1);
    pts[pts.length - 1][0] = L;
}
function syncPointEnds() {
    const el = main.querySelector('[data-end="right"]'), pts = cur().shape.points;
    if (el) el.textContent = `${lenText(pts[pts.length - 1][0])} (right end)`;
    if (main.querySelectorAll('.points tbody tr').length !== pts.length) renderShapeTable();
}
// An opening changed kind: the sizes and members that kind has.
function setKind(p, i, kind) {
    const o = p.openings[i], size = G.OPENING_TYPES[kind].size, H = G.shapeTop(p.shape).heightIn;
    o.kind = kind;
    if (kind === 'door') { o.sillIn = 0; o.sill = ''; if (!(o.heightIn >= 6)) o.heightIn = Math.min(size.heightIn, H - 12); }
    else if (kind === 'steel') { o.head = ''; o.heightIn = 0; if (!(o.sillIn >= 3) || o.sillIn > H - 6) o.sillIn = Math.max(3, H - 24); }
    else { if (!(o.sillIn >= 3)) o.sillIn = Math.min(size.sillIn, Math.max(3, H - size.heightIn - 12)); if (!(o.heightIn >= 6)) o.heightIn = size.heightIn; }
}

const field = (label, path, value, { t = 'text', list = '', r = '', ph = '', cls = '', i = '', locked = false } = {}) => `<label class="field ${cls}${locked ? ' locked' : ''}"><span>${esc(label)}${locked ? ' 🔒' : ''}</span>
    <input type="text" data-f="${esc(path)}" data-t="${t}" ${r ? `data-r="${r}"` : ''} ${i !== '' ? `data-i="${i}"` : ''} ${list ? `list="dl-${list}"` : ''}
        value="${esc(t === 'len' ? lenText(value) : t === 'cut' ? (value === '' || value == null ? '' : fine(value)) : value ?? '')}" placeholder="${esc(ph)}" autocomplete="off"${locked ? ' disabled title="Locked: the Revit model\'s"' : ''}>
    <em class="hint"></em></label>`;

// --- Actions (data-act) -----------------------------------------------------------------------------------------------
document.addEventListener('click', (e) => { // the title bar's buttons too
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const more = b.closest('.header-more'); if (more) more.open = false;
    const act = b.dataset.act, i = Number(b.dataset.i), p = cur();
    if (!p && !NO_PANEL_ACTS.has(act)) return;
    if (!historyHint && !NOT_EDITS.has(act)) historyHint = { label: ACT_LABELS[act] || act.replace(/-/g, ' ') };
    const acts = {
        undo: () => doUndo(),
        redo: () => doRedo(),
        'nav-toggle': toggleNavigator,
        'layout-nav': toggleNavigator,
        'inspector-toggle': () => { if (focusView) { focusView = false; prefs.inspectorCollapsed = false; } else prefs.inspectorCollapsed = !prefs.inspectorCollapsed; storePrefs(); applyPrefs(); if (!prefs.inspectorCollapsed && matchMedia('(max-width: 1180px)').matches) $('#inspector').scrollIntoView({ block: 'start', behavior: 'smooth' }); },
        'focus-view': () => { focusView = !focusView; applyPrefs(); },
        'bottom-toggle': () => { prefs.bottomOpen = prefs.bottomOpen === false; storePrefs(); renderBottom(current); },
        side: () => { p.sideB = b.dataset.side === 'B'; changed(); renderSidePick(p); notice(`Viewing side ${p.sideB ? 'B: the drawing is mirrored' : 'A'} (the members are the same).`); },
        'flips-clear': () => { const n = (p.studFlips || []).length; p.studFlips = []; renderLayoutSec(); changed(); notice(`${n} stud flip${n === 1 ? '' : 's'} cleared: those studs face their usual way.`); },
        new: () => toggleNewMenu(false) || addPanel(G.newPanel(p, set.panels.map(x => x.mark))),
        copy: () => {
            if (G.isFromModel(p) && !confirm(`Duplicate ${p.mark} as an unlinked copy?\n\nThe copy is not linked to the Revit wall: its outline and openings become editable, and it no longer reports to the model. ${p.mark} itself stays linked.`)) return;
            addPanel(G.copyPanel(p, set.panels.map(x => x.mark))); if (G.isFromModel(p)) notice(`${cur().mark} is an unlinked copy of ${p.mark}: not linked to the Revit wall, change anything on it.`);
        },
        shape: () => { if (!G.canEdit(p, 'shape')) return lockedNotice('its shape');const next={...p,shape:G.changeShape(p.shape,b.dataset.kind)},error=SK.pinError(p,next);if(error){notice(error,true);return;} p.shape = next.shape; renderElevHead(); renderShapeTable(); fit(); changed(); },
        tool: () => (b.dataset.tool === 'perimeter' && !G.canEdit(p, 'shape') ? lockedNotice('its perimeter') : setTool(b.dataset.tool)),
        'add-op': () => addOpening(p, b.dataset.kind),
        'select-op': () => { sel = i; ask = null; renderCatalogue(); renderChips(); renderSketch(); },
        done: () => { sel = null; ask = null; renderCatalogue(); renderChips(); renderSketch(); },
        'add-point': () => { if (!G.canEdit(p, 'shape')) return lockedNotice('its top');if(SK.pinned(p,'top')){notice('Unlock the top line before changing its points.',true);return;} addPoint(p); renderShapeTable(); changed(); },
        'del-point': () => { if (!G.canEdit(p, 'shape')) return lockedNotice('its top');if(SK.pinned(p,'top')){notice('Unlock the top line before changing its points.',true);return;} if (p.shape.points.length > 2) p.shape.points.splice(i, 1); renderShapeTable(); changed(); },
        'del-op': () => { if (!G.canEdit(p, `openings.${i}`)) return lockedNotice('the model\'s openings'); p.openings.splice(i, 1); sel = null; ask = null; renderCatalogue(); renderChips(); changed(); },
        center: () => { if (!G.canEdit(p, `openings.${i}.leftIn`)) return lockedNotice('the model\'s openings'); const o = p.openings[i]; o.leftIn = Math.round(((G.shapeTop(p.shape).lengthIn - o.widthIn) / 2) * 16) / 16; syncCatalogueFields(); changed(); },
        preview: () => setView('elevation'),
        'layout-here': () => setLayoutStart(p, Number(b.dataset.x)),
        'layout-reset': () => { delete p.layoutStartIn; syncToggles(); changed(); notice(`${p.mark}: the first stud is ${p.optimizeOpenings ? 'the optimizer\'s' : 'on the standard layout'} again.`); },
        'layout-from': () => { p.layoutFromRight = b.dataset.side === 'right'; syncToggles(); changed(); notice(`The stud layout now starts from the ${b.dataset.side} end.`); },
        'add-ctrl': () => addControlPoint(p, Number(b.dataset.x)),
        'add-op-at': () => addOpeningAt(p, b.dataset.kind, Number(b.dataset.x), Number(b.dataset.y)),
        'copy-op': () => copyOpening(p, i),
        framing: () => openFraming(i),
        'mirror-op': () => { if (!G.canEdit(p, `openings.${i}.leftIn`)) return lockedNotice('the model\'s openings'); const o = p.openings[i]; o.leftIn = round16(G.shapeTop(p.shape).lengthIn - o.leftIn - o.widthIn); syncCatalogueFields(); changed(); notice(`${G.openingName(p.openings, i)} mirrored: ${editDimension(o.leftIn)} from the left end now.`); },
        'stud-flip': () => { const x = Number(b.dataset.x), had = (p.studFlips || []).some(c => Math.abs(c - x) < 0.5); p.studFlips = had ? p.studFlips.filter(c => Math.abs(c - x) >= 0.5) : [...(p.studFlips || []), x]; changed(); notice(had ? 'That stud faces its usual way again.' : 'That stud faces the other way now (right-click it again to flip it back).'); },
        'clip-here': () => addClips(p, [{ type: clipType, x: Number(b.dataset.x), y: Number(b.dataset.y) }]),
        'clip-del': () => removeClip(p, i),
        'clip-top': () => laid.lay && addClips(p, G.clipsAtTop(laid.lay, clipType)),
        'clip-mid': () => laid.lay && addClips(p, G.clipsOnEveryStud(laid.lay, round16(G.shapeTop(p.shape).heightIn / 2), clipType)),
        'clip-all': () => { const y = parseDimension(document.getElementById('clip-at')?.value); if (y == null || !laid.lay) return notice('Type a height for the clips, like 4\'-0".', true); clipAt = y; addClips(p, G.clipsOnEveryStud(laid.lay, y, clipType)); },
        'clip-clear': () => { const n = (p.clips || []).length; p.clips = []; renderHint(); changed(); notice(`${n} clip${n === 1 ? '' : 's'} removed.`); },
        'peri-finish': () => finishPerimeter(),
        'peri-undo': () => { peri?.pts.pop(); renderSketch(); renderHint(); },
        'peri-cancel': () => setTool('select'),
        pdf: () => downloadPdf([p]),
        link: () => copyLink(p),
        'save-combo': () => saveCombo(p),
        'del-combo': () => deleteCombo(),
        open: () => openPanel(b.dataset.id),
        'set-pdf': () => downloadPdf(chosen()),
        'set-pdf-typ': () => downloadPdf(chosen(), { perTypical: true }),
        'set-assign': () => assign(p),
        'set-delete': () => { deletePanels(); if (setDialog().open) renderSetDialog(); },
        'set-export': () => exportJson(),
        'set-export-plan': () => exportPlanJson(),
        'eng-open': () => openCatalog(),
        'rule-use': () => useRule(i, b.dataset.key),
        'sch-pick': () => openPicker(b),
        'sch-apply': () => schApply(b.dataset.k, b.dataset.v),
        'sch-rules': () => schRulesAll(),
        'sch-arrange': () => { p.openings[i] = { ...p.openings[i], [`${b.dataset.k}Style`]: b.dataset.v }; changed(); renderBottom(current); renderMemberCards(); },
        'sch-check-all': () => { const all = p.openings.length && schChecked.size === p.openings.length; schChecked = new Set(all ? [] : p.openings.map((_, j) => j)); renderBottom(current); },
        'cutback-all': () => { const v = G.cutbackOf(p); set.panels.forEach(x => { if (v == null) delete x.cutbackIn; else x.cutbackIn = v; }); changed(); renderSet(); notice(`Every panel's studs cut back ${v == null ? 'by the engine\'s 1/16"' : fine(v)}.`); },
        'ctx-place': () => contextEdit(c => { const l = c.levels[b.dataset.k] || { name: '', place: 'at', offsetIn: 0 }; c.levels[b.dataset.k] = { ...l, place: b.dataset.v, offsetIn: b.dataset.v === 'at' ? 0 : l.offsetIn || 1 }; }),
        'ctx-grid-add': () => contextEdit(c => { const L = G.shapeTop(p.shape).lengthIn, used = c.grids.map(g => g.xIn); c.grids.push({ name: String(c.grids.length + 1), xIn: [0, L, L / 2].find(x => !used.includes(x)) ?? L / 2 }); }),
        'ctx-grid-del': () => contextEdit(c => { c.grids.splice(i, 1); }),
        'ctx-model': () => { const m = CL.modelContext(set, p); if (!m) return; p.context = { show: true, levels: { bottom: m.levels.bottom, top: m.levels.top }, grids: m.grids }; renderContextSec(); fit(); changed(); notice('Levels and grids from the model.'); },
        'ctx-toggle': () => contextEdit(c => { c.show = !c.show; }),
        'man-step': () => { manStep = Number(b.dataset.v); renderWorkspace(); },
        'man-type-preview': () => typePreview(b.dataset.key),
        'man-type-apply': () => typeApply(),
        'man-type-cancel': () => { manPreview = null; renderWorkspace(); },
        'man-fill': () => fillBay(b.dataset.a, b.dataset.b),
        'man-mode': () => { editMode = !editMode; if (editMode && prefs.view !== 'elevation') setView('elevation'); renderSidePick(p); renderWorkspace(); notice(editMode ? 'Edit members: drag a member to move it (it unlocks), or select one and use its card. Arrow keys nudge it (Shift: 1").' : 'Edit members off.'); },
        'man-unlock': () => manualEdit((q, lay) => MAN.unlock(q, lay, b.dataset.key), 'Unlocked: it stays where you put it and no longer follows the framing rules.'),
        'man-lock': () => manualEdit((q) => MAN.lock(q, b.dataset.key), 'Locked: it follows the framing rules again.', { keep: !MAN.isAdded(b.dataset.key) }),
        'man-unlock-all': () => manualEdit((q, lay) => MAN.unlockAll(q, lay), 'Every member unlocked: the framing rules no longer move any of them.'),
        'man-lock-all': () => { if (confirm('Lock every member? Everything placed by hand goes back to the framing rules, and the copies are removed.')) manualEdit((q) => MAN.lockAll(q), 'Every member follows the framing rules again.', { allowUnframed: true }); },
        'man-nudge': () => manualNudge(Number(b.dataset.dx) * manualStep(), Number(b.dataset.dy) * manualStep()),
        'man-copy': () => manualCopy(b.dataset.key),
        'oc-add': () => addOpeningFromInsert(p, b.dataset.uid),
        'rev-issue': () => issueRevision(p),
        'view-compare': () => setView('compare'),
        'type-framing': () => typeFraming(p, i),
        'prof-update': () => updateProfile(p, i),
        'prof-reset': () => pickProfile(p, i, p.openings[i]?.profile),
        'prof-del': () => deleteProfile(b.dataset.v),
        'prof-link': () => linkProfile(b.dataset.v),
        'legend-reset': () => { delete set.legendColors; changed(); renderAll(); renderSetDialog(); notice('Opening colors: the legend\'s again.'); },
        'qb-type': () => { const el = $('#man-type-in'); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus(); el.select(); } },
        'qb-opening': () => selectTarget({ kind: 'opening', key: b.dataset.key }),
        'qb-members': () => { prefs.bottom = 'openings'; prefs.bottomOpen = true; storePrefs(); renderBottom(current); main.querySelector('.sch-table tr.selected')?.scrollIntoView({ block: 'nearest' }); },
        'man-mirror': () => manualMirror(b.dataset.key),
        'man-remove': () => manualEdit((q) => MAN.remove(q, b.dataset.key), 'Removed (Lock brings it back).', { keep: false }),
        'op-alt': () => { if (setFromRule(p, i, b.dataset.k, b.dataset.v)) { renderMemberCards(); renderChips(); changed(); } },
        'op-rule-member': () => { if (!setFromRule(p, i, b.dataset.k, null)) notice('The rule gives alternatives: pick one of them under the member.'); else { renderMemberCards(); renderChips(); changed(); } },
        'op-arrange': () => { p.openings[i] = { ...p.openings[i], [`${b.dataset.k}Style`]: b.dataset.v }; renderMemberCards(); changed(); },
        'set-import': () => document.getElementById('import-file').click(),
        'new-menu': () => toggleNewMenu(),
        'hist-menu': () => toggleHistMenu(),
        'undo-to': () => { toggleHistMenu(false); undoSteps(Number(b.dataset.v)); },
        help: () => openHelp(),
        'help-close': () => helpDialog().close(),
        'new-blank': () => { toggleNewMenu(false); const marks = set.panels.map(x => x.mark); addPanel({ ...G.newPanel(null, marks), mark: G.nextNumberMark(cur()?.mark || 'P-100', marks) }); },
        'new-tpl': () => { toggleNewMenu(false); const t = templates[Number(b.dataset.v)]; if (!t) return; addPanel(G.fromTemplate(t.panel, cur()?.mark, set.panels.map(x => x.mark))); notice(`${cur().mark} added from the template "${t.name}": type a name over its mark.`); },
        'tpl-del': () => { const t = templates[Number(b.dataset.v)]; if (!t || !confirm(`Forget the template "${t.name}"? (Panels made from it stay.)`)) return; templates = templates.filter(x => x !== t); store(KEYS.templates, templates); toggleNewMenu(true); },
        'tpl-save': () => saveTemplate(p),
        'set-open': () => { fsDraft = null; openSetDialog(b.dataset.v); },
        'sd-close': () => setDialog().close(),
        'sd-tab': () => { setTab = b.dataset.v; renderSetDialog(); setDialog().querySelector('[role=tab][aria-selected=true]')?.focus(); },
        'sd-csv': () => setCsv(b.dataset.v),
        'sd-filter': () => { sdFilter = b.dataset.v; renderSetDialog(); },
        'fs-apply': () => applyFramingSettings(),
        'fs-reset': () => { fsDraft = null; renderSetDialog(); },
        'fs-source': () => {
            const p = cur(), source = sourceFraming(p); if (!source) return;
            const q = structuredClone(p); for (const k of Object.keys(source.values)) { delete q[k]; if (q.framingOrigins) delete q.framingOrigins[k]; }
            replacePanel(G.cleanPanel(q)); fsDraft = null; changed(); renderAll(); renderSetDialog(); notice('Revit framing values restored on the open panel.');
        },
        'sd-labels': () => openLabelMaker(),
        'sd-label-maker': () => openLabelMaker(),
        'sd-open': () => { setDialog().close(); openPanel(b.dataset.id); },
        'sd-rules': () => rulesOnChecked(),
        'set-check-all': () => { set.panels.forEach(x => checked.add(x.id)); renderSet(); },
        'set-check-none': () => { checked.clear(); renderSet(); },
        'set-clear': () => clearSet(),
    };
    acts[act]?.();
    if (b.closest('#sk-menu')) closeMenu();
});

// --- Keys on the selection (any view): Delete, Ctrl+D copy, M mirror; the help (?) and the history list --------------------
// -> true when the key was used.
function selectionKey(e, what) {
    const p = cur();
    if (selection.kind === 'member') {
        const key = selectedLayoutKey(), m = layoutA()?.members.find(x => x.key === key);
        if (!m || m.parts?.length) return false;
        e.preventDefault();
        historyHint = { label: what === 'copy' ? `copying ${m.mark}` : what === 'mirror' ? `mirroring ${m.mark}` : `removing ${m.mark}` };
        if (what === 'copy') manualCopy(key);
        else if (what === 'mirror') manualMirror(key);
        else if (MAN.isAdded(key)) manualEdit((q) => MAN.lock(q, key), 'The copy removed (Ctrl+Z brings it back).', { keep: false });
        else manualEdit((q) => MAN.remove(q, key), `${m.mark} ${m.role} removed (Ctrl+Z, or Reset on it, brings it back).`, { keep: false });
        return true;
    }
    const i = selection.kind === 'opening' ? G.openingKeys(p).indexOf(selection.key) : sel ?? -1, o = p.openings[i];
    if (!o) return false;
    e.preventDefault();
    const name = G.openingName(p.openings, i);
    if (what === 'copy') { historyHint = { label: 'copying the opening' }; copyOpening(p, i); return true; }
    if (!G.canEdit(p, `openings.${i}.leftIn`)) { lockedNotice('the model\'s openings'); return true; }
    historyHint = { label: what === 'mirror' ? 'mirroring the opening' : 'removing the opening' };
    if (what === 'mirror') { o.leftIn = round16(G.shapeTop(p.shape).lengthIn - o.leftIn - o.widthIn); syncCatalogueFields(); changed(); notice(`${name} mirrored across the panel's middle.`); return true; }
    p.openings.splice(i, 1); sel = null; ask = null; selection = W.NONE; renderCatalogue(); renderChips(); changed(); renderWorkspace();
    notice(`${name} deleted (Ctrl+Z brings it back).`);
    return true;
}
const helpDialog = () => document.getElementById('help-dialog');
const SHORTCUTS = [
    ['Ctrl+Z / Ctrl+Y', 'Undo / redo (▾ beside Undo: back to any earlier change)'],
    ['Ctrl+Alt+N', 'A new panel like the open one (▾ beside it: blank, or from a template)'],
    ['Click', 'A member or an opening in the Elevation: its actions show beside it'],
    ['Arrow keys', 'Move the selected member one step (the step beside it); Shift: 1"'],
    ['Arrow keys (sketch)', 'Move the selected opening 1/2"; Shift: 6"'],
    ['Delete', 'Remove the selected member or opening (Ctrl+Z brings it back)'],
    ['Ctrl+D', 'Copy the selected member or opening'],
    ['M', 'Mirror the selected member or opening across the panel\'s middle'],
    ['Esc', 'Clear the selection, close a menu'],
    ['?', 'This list'],
];
function openHelp() {
    const d = helpDialog();
    d.innerHTML = `<div class="sd"><header class="sd-head"><h2 id="help-title">Keyboard shortcuts and tips</h2><span class="spacer"></span><button class="link" data-act="help-close">Close</button></header>
        <div class="sd-body"><table class="sd-table"><tbody>${SHORTCUTS.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">Lengths: 10'-6", 10' 6, 10.5' or 126 (a bare number is inches), to 1/16". Everything is kept in this browser as you work; Export writes a file to keep or share. The set's overview, stock and labels: Set.</p></div></div>`;
    if (!d.open) d.showModal();
}
// The changes so far, newest first: undo back to before any of them.
const histMenu = () => document.getElementById('hist-menu');
function toggleHistMenu(open = histMenu().hidden) {
    const m = histMenu(), past = undoHistory.past;
    document.getElementById('hist-btn')?.setAttribute('aria-expanded', String(open && past.length > 0));
    if (!open || !past.length) { m.hidden = true; return; }
    m.innerHTML = `<div class="nm-head">Undo back to before</div>${past.slice().reverse().map((h, k) => `<button role="menuitem" data-act="undo-to" data-v="${k + 1}">${esc(h.label)}<small>${k ? `and the ${k} change${k === 1 ? '' : 's'} after it` : 'the last change'}</small></button>`).join('')}`;
    m.hidden = false;
    m.querySelector('[role=menuitem]')?.focus();
}
document.addEventListener('click', (e) => { if (!histMenu().hidden && !e.target.closest('.hist-split')) toggleHistMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !histMenu().hidden) { toggleHistMenu(false); document.getElementById('hist-btn')?.focus(); } });
function undoSteps(n) {
    const labels = [];
    for (let k = 0; k < n && undoHistory.past.length; k++) { labels.push(undoHistory.past[undoHistory.past.length - 1].label); doUndo(); }
    if (labels.length > 1) notice(`Undone ${labels.length} changes: ${labels.join(', ')}.`);
}

// --- New panel: like the open one, blank, or from a template (saved in this browser) ------------------------------------
const newMenu = () => document.getElementById('new-menu');
function tplSummary(t) {
    const p = G.cleanPanel({ ...t.panel, id: 'x', mark: 'x' }), L = G.shapeTop(p.shape);
    return `${editDimension(L.lengthIn)} x ${editDimension(L.heightIn)} · ${G.openingsSummary(p.openings) || 'no openings'} · ${studName(p.members)} @ ${p.members.spacingIn}"`;
}
function toggleNewMenu(open = newMenu().hidden) {
    const m = newMenu(), p = cur();
    document.querySelector('[data-act=new-menu]')?.setAttribute('aria-expanded', String(open));
    if (!open) { m.hidden = true; return; }
    m.innerHTML = `${p ? `<button role="menuitem" data-act="new">Like the open panel (${esc(p.mark)}): its shape and members</button>` : ''}
        <button role="menuitem" data-act="new-blank">A blank 10'-0" x 10'-0" panel</button>
        <div class="nm-head">From a template</div>
        ${templates.length ? templates.map((t, k) => `<div class="nm-row"><button role="menuitem" data-act="new-tpl" data-v="${k}"><b>${esc(t.name)}</b><small>${esc(tplSummary(t))}</small></button><button class="link small" data-act="tpl-del" data-v="${k}" title="Forget this template" aria-label="Forget ${esc(t.name)}">✕</button></div>`).join('')
            : '<p class="muted small">None yet: open a panel and use Save as template on its card.</p>'}`;
    m.hidden = false;
    m.querySelector('[role=menuitem]')?.focus();
}
document.addEventListener('click', (e) => { if (!newMenu().hidden && !e.target.closest('.new-split')) toggleNewMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !newMenu().hidden) { toggleNewMenu(false); document.querySelector('[data-act=new-menu]')?.focus(); } });
function saveTemplate(p) {
    const L = G.shapeTop(p.shape), name = prompt('Name this template (it is kept in this browser):', `${p.mark} ${editDimension(L.lengthIn)} x ${editDimension(L.heightIn)}`)?.trim();
    if (!name) return;
    templates = [{ name: name.slice(0, 80), panel: G.templateOf(p), savedAt: today() }, ...templates.filter(t => t.name !== name)].slice(0, 40);
    store(KEYS.templates, templates);
    notice(`Template "${name}" saved: + New panel ▾ starts a panel from it (its shape, openings, members and layout; not the model's link).`);
}
function openPanel(id) { set.current = id; sel = null; ask = null; selection = W.NONE; stylePending = null; schChecked = new Set(); schPick = null; main.classList.remove('nav-open'); setTool('select', false); renderAll(); }
function addPanel(panel) {
    set.panels.push(panel);
    set.current = panel.id;
    sel = null; ask = null;
    selection = W.NONE;
    renderAll();
    notice(`${panel.mark} added at the end of the list. Its shape and members follow the panel before it: type a name over its mark, change what differs.`);
    $('#set-card .nav-item.on')?.scrollIntoView({ block: 'nearest' });
    renameFocus();
}
function addPoint(p) {
    const pts = p.shape.points;
    let k = 1, best = -1;
    for (let j = 1; j < pts.length; j++) if (pts[j][0] - pts[j - 1][0] > best) { best = pts[j][0] - pts[j - 1][0]; k = j; }
    const [x0, h0] = pts[k - 1], [x1, h1] = pts[k], x = Math.round((x0 + x1) / 2);
    pts.splice(k, 0, [x, Math.round((h0 + h1) / 2 + 12)]);
}
// A new opening of a kind: its usual size, centered when that spot is free, else right of the last one; then the
// catalogue asks for its members.
// base: the new opening as given (an opening profile's: opening-profiles.mjs), only placed here.
function addOpening(p, kind, base = null) {
    const { lengthIn: L, heightIn: H } = G.shapeTop(p.shape), type = G.OPENING_TYPES[kind];
    const prev = [...p.openings].reverse().find(o => o.kind === kind), size = type.size;
    const o = base ? { ...base } : { kind, widthIn: prev?.widthIn ?? size.widthIn, heightIn: kind === 'steel' ? 0 : prev?.heightIn ?? Math.min(size.heightIn, H - 12), head: '', jamb: '', sill: '' };
    if (!base) o.sillIn = kind === 'door' ? 0 : kind === 'steel' ? prev?.sillIn ?? Math.max(3, H - 24) : prev?.sillIn ?? Math.min(size.sillIn, Math.max(3, H - o.heightIn - 12));
    const free = (left) => p.openings.every(x => left + o.widthIn + 6 <= x.leftIn || left >= x.leftIn + x.widthIn + 6);
    // Centered when free, else the first free spot from the left (6" steps); with no room anywhere, centered (the check
    // then says it overlaps).
    const centered = Math.round((L - o.widthIn) / 2);
    let spot = free(centered) ? centered : null;
    for (let x = 6; spot == null && x <= L - o.widthIn - 6; x += 6) if (free(x)) spot = x;
    o.leftIn = spot ?? Math.max(0, centered);
    p.openings.push(o);
    selectNew(p, p.openings.length - 1);
}
function selectNew(p, i) {
    sel = i; ask = i;
    renderCatalogue(); renderChips(); changed();
    const o = p.openings[i], type = G.OPENING_TYPES[o.kind];
    notice(`${G.openingName(p.openings, i)} (${G.kindWord(o.kind)}) added: pick its ${type.members.map(k => G.MEMBER_LABELS[k].toLowerCase()).join(', ')} beside the elevation. Drag it, or use the arrow keys, to place it.`);
}
// An opening from a profile (Draw: + From a profile): its kind, its framing, the profile's first size; placed free.
function addFromProfile(p, name) {
    const prof = OP.findProfile(opProfiles(), name);
    if (!p || !prof) return;
    historyHint = { label: `the opening from ${prof.name}` };
    addOpening(p, prof.kind, OP.openingFromProfile(prof));
    ask = null;
    const i = p.openings.length - 1, o = p.openings[i];
    notice(`${G.openingName(p.openings, i)} added from ${prof.name}: ${sizeText(o)}, ${framingWords(prof.framing) || 'the panel defaults'}. Drag it into place; type its width or height where this one differs.`);
}

// --- Rendering ---------------------------------------------------------------------------------------------------------
function renderAll(fromHistory = false) {
    if (!fromHistory) commit();
    renderViewBar();
    if (!set.panels.length) { renderEmpty(); return; }
    leaveEmpty();
    renderPanel(); renderElevHead(); renderCore(); renderTools(); renderShapeTable(); renderCatalogue(); renderChips(); renderDatalists(); renderSet(); renderLayoutSec(); renderContextSec();
    fit(); refresh(true);
}
let refreshTimer = 0;
function changed() { commit(); save(); refresh(); renderCommands(); }
function refresh(now = false) {
    if (!cur()) return;
    if (!drag && tool !== 'perimeter') fit(); // the view follows the panel's size, but holds still while dragging
    renderSketch();
    if(!$('#wall-sketch-constraints')?.contains(document.activeElement))sketchControls.render();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { renderPreview(); renderSet(); renderChips(); renderLayoutInfo(); refreshOpeningRule(); }, now ? 0 : drag ? 160 : 90);
}

function renderPanel() {
    const p = cur();
    $('#panel-fields').innerHTML = `${field('Panel mark', 'mark', p.mark, { ph: 'P-101', cls: 'f-mark' })}
        ${field('Level', 'level', p.level, { list: 'level', r: 'level', ph: 'L2', cls: 'f-level' })}
        ${field('Wall type', 'wallType', p.wallType, { list: 'wallType', r: 'wallType', ph: 'CAS_1HR_362_1L_FULL', cls: 'f-type' })}
        ${field('Group', 'group', p.group, { list: 'group', r: 'group', ph: 'Type A', cls: 'f-group' })}
        ${G.isFromModel(p) ? `<span class="model-badge" title="${esc(`Revit wall ${p.revit.uniqueId || ''}${p.revit.wallTypeName ? ` · ${p.revit.wallTypeName}` : ''}${p.revit.levelName ? ` · ${p.revit.levelName}` : ''}`)}">🔒 Revit wall · perimeter and its openings locked</span>` : ''}`;
    syncToggles();
}
// (The switches' sync: syncToggles in the workspace section, the stud layout and facing group.)

// The elevation's title, the shape to start from and its sizes.
function renderElevHead() {
    const p = cur(), s = p.shape;
    const icon = (kind) => ({ rect: 'M2 18H22V6H2Z', rake: 'M2 18H22V4L2 10Z', gable: 'M2 18H22V10L12 3L2 10Z', custom: 'M2 18H22V8L16 11L10 4L2 9Z' })[kind];
    const locked = !G.canEdit(p, 'shape');
    const f = (label, key) => field(label, `shape.${key}`, s[key], { t: 'len', list: 'len', locked });
    const dims = { rect: [f('Length', 'lengthIn'), f('Height', 'heightIn')], rake: [f('Length', 'lengthIn'), f('Height at left', 'leftIn'), f('Height at right', 'rightIn')],
        gable: [f('Length', 'lengthIn'), f('Left eave', 'leftIn'), f('Right eave', 'rightIn'), f('Peak height', 'peakIn'), f('Peak from left', 'peakAtIn')],
        custom: [f('Length', 'lengthIn')] }[s.kind];
    $('#elev-head').innerHTML = `<div class="shape-pick" role="radiogroup" aria-label="Shape">${G.SHAPES.map(k => `<button class="${k.kind === s.kind ? 'on' : 'secondary'}" data-act="shape" data-kind="${k.kind}" role="radio" aria-checked="${k.kind === s.kind}" ${locked && k.kind !== s.kind ? 'disabled' : ''} title="${esc(locked ? 'Locked: the Revit model\'s shape' : `${k.name}: ${k.hint}`)}">
            <svg viewBox="0 0 24 20" aria-hidden="true"><path d="${icon(k.kind)}"/></svg><span>${esc(k.name)}</span></button>`).join('')}</div>
        <div class="shape-fields">${dims.join('')}</div>`;
}
// After a drag: the shape's typed sizes show the new values (without rebuilding the sketch being dragged).
function renderShapeFields() {
    for (const el of main.querySelectorAll('#elev-head [data-f][data-t="len"]')) {
        if (document.activeElement !== el) el.value = lenText(getPath(cur(), el.dataset.f));
    }
    renderShapeTable();
}
function renderShapeTable() {
    const box = $('#shape-points'), s = cur().shape;
    if (s.kind === 'custom' && !G.canEdit(cur(), 'shape')) { // the model's top: its points to read
        box.innerHTML = `<details><summary>The top's points (${s.points.length}) 🔒</summary><table class="points"><thead><tr><th>Point</th><th>From left</th><th>Height</th></tr></thead><tbody>
            ${s.points.map((pt, i) => `<tr><td>${i + 1}</td><td>${lenText(pt[0])}</td><td>${lenText(pt[1])}</td></tr>`).join('')}</tbody></table></details>`;
        return;
    }
    box.innerHTML = s.kind !== 'custom' ? '' : `<details ${s.points.length > 2 ? '' : 'open'}><summary>The top's points (${s.points.length})</summary><table class="points"><thead><tr><th>Point</th><th>From left</th><th>Height</th><th></th></tr></thead><tbody>
        ${s.points.map((pt, i) => `<tr><td>${i + 1}</td>
            <td>${i === 0 || i === s.points.length - 1 ? `<span class="muted" data-end="${i ? 'right' : 'left'}">${lenText(pt[0])} (${i ? 'right' : 'left'} end)</span>` : field('', `shape.points.${i}.0`, pt[0], { t: 'len', cls: 'bare' })}</td>
            <td>${field('', `shape.points.${i}.1`, pt[1], { t: 'len', cls: 'bare' })}</td>
            <td>${s.points.length > 2 && i > 0 && i < s.points.length - 1 ? `<button class="link" data-act="del-point" data-i="${i}" title="Remove this point">✕</button>` : ''}</td></tr>`).join('')}</tbody></table>
        <button class="secondary" data-act="add-point">+ Add a point</button></details>`;
}

// --- Members: the core strip over the elevation, the catalogue beside it ----------------------------------------------
// A member's section as a little picture: a C for each stud, a U for each track, side by side ((2) studs WITH (1)
// track: C C U).
function memberIcon(spec) {
    const parts = (spec && G.specText(spec) ? String(spec).split(/\bWITH\b/i) : [spec]).map(t => G.parseMember(t)).filter(Boolean);
    const shapes = parts.flatMap(d => Array.from({ length: Math.min(4, d.qty) }, () => (/^(S|CS|CT)$/.test(d.profile) ? 'C' : 'U')));
    if (!shapes.length) return '<svg viewBox="0 0 64 40"><text x="32" y="25" text-anchor="middle" font-size="11" fill="#8a9099">?</text></svg>';
    const w = 14, gap = 4, total = shapes.length * w + (shapes.length - 1) * gap, x0 = (64 - total) / 2;
    const d = shapes.map((k, i) => {
        const x = x0 + i * (w + gap);
        return k === 'C' ? `M${x + w} 6 H${x} V34 H${x + w} M${x + w} 6 V10 M${x + w} 34 V30` : `M${x} 8 V34 H${x + w} V8`;
    }).join(' ');
    return `<svg viewBox="0 0 64 40"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
const recentKey = (k) => (k === 'head' ? 'header' : k);
const optsOf = (list, key, skip = []) => [...new Set([...(recent[key] || []), ...list])].filter(v => v && !skip.includes(v)).map(v => ({ value: v, label: v }));
// A member's choices as <option>s: the list, a size typed before, and Type another size….
function optionTags(path, value, options) {
    const known = options.some(o => o.value === value);
    const all = [...options, ...(known || !value ? [] : [{ value, label: `Typed: ${value}` }]), { value: '__type', label: 'Type another size…' }];
    return all.map(o => `<option value="${esc(o.value)}" ${o.value === (typing.has(path) ? '__type' : value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
}
// Where a setting's value comes from (the resolved plan's intent: workspace.mjs settingState), as a small badge.
const stateBadge = (source) => { if (source == null) return ''; const st = W.settingState(source); return `<span class="set-state ${st.state}" title="Where this setting comes from">${esc(st.label)}</span>`; };
const intentNow = () => (cur() ? framed(cur()).plan?.intent : null);
function memberCard({ path, label, value = '', options, resolved, r, note = '', extra = '', ask: asking = false, source = null }) {
    const typed = typing.has(path);
    return `<div class="mcard ${asking ? 'ask' : ''}" data-card="${esc(path)}">
        <div class="micon" aria-hidden="true">${memberIcon(resolved)}</div>
        <div class="mbody"><span class="mlabel">${esc(label)}${stateBadge(source)}</span>
            <select data-pick="${esc(path)}" aria-label="${esc(label)}">${optionTags(path, value, options)}</select>
            ${typed ? `<input type="text" class="mtype" data-f="${esc(path)}" data-r="${r}" list="dl-${r}" value="${esc(value)}" placeholder="362S162-43, or (2) 362S162-43 WITH (1) 362T125-43" autocomplete="off">` : ''}
            <small class="mdesc">${esc(note || G.specText(resolved) || resolved)}</small>${extra}</div></div>`;
}
// A core member's choices: the top track, the studs on center or the bottom track.
function coreChoice(key) {
    // A stud the model left open (VARIES, none): its track is open too, never a blank name.
    const m = cur().members, ch = G.memberChoices(m), bottom = bottomTrack(m), matching = G.trackFor(m.stud), open = (n) => n || 'once the stud is picked';
    const source = intentNow()?.members?.[key]?.source ?? null;
    if (key === 'topTrack') return { source, path: 'members.topTrack', label: 'Top track', value: m.topTrack, r: 'topTrack', resolved: m.topTrack || bottom,
        options: [{ value: '', label: `Same as bottom track: ${open(bottom)}` }, ...optsOf(ch.topTrack, 'topTrack')], note: m.topTrack ? '' : `as the bottom track, ${open(bottom)}` };
    if (key === 'stud') return { source, path: 'members.stud', label: 'On-center studs', value: m.stud, r: 'stud', resolved: m.stud, options: optsOf(ch.stud, 'stud') };
    return { source, path: 'members.track', label: 'Bottom track', value: m.track, r: 'track', resolved: bottom,
        options: [{ value: '', label: `Matches the stud: ${open(matching)}` }, ...optsOf(ch.track, 'track')], note: m.track ? '' : `matches the stud, ${open(matching)}` };
}
function renderCore() {
    const m = cur().members;
    const spacing = typing.has('members.spacingIn')
        ? `<input type="text" class="mtype" data-f="members.spacingIn" data-t="len" value="${esc(editDimension(m.spacingIn))}" aria-label="Stud spacing">`
        : `<select data-pick="members.spacingIn" aria-label="Stud spacing">${Number(m.spacingIn) > 0 ? '' : '<option value="" selected disabled>Pick (the model gave none)</option>'}${[...new Set([...G.SPACINGS, ...(Number(m.spacingIn) > 0 ? [Number(m.spacingIn)] : [])])].map(v => `<option value="${v}" ${v === Number(m.spacingIn) ? 'selected' : ''}>${editDimension(v)} o.c.</option>`).join('')}<option value="__type">Other…</option></select>`;
    $('#core-strip').innerHTML = `<div class="row core-head"><b>Core members</b><span class="muted small">top track · studs on center · bottom track</span><span class="spacer"></span>
            <select id="combo" aria-label="Member combo"><option value="">Member combo…</option>
                <optgroup label="Saved in this browser">${combos.map((c, i) => `<option value="s${i}">${esc(c.name)}</option>`).join('') || '<option disabled>None yet: Save as a combo</option>'}</optgroup>
                <optgroup label="Typical (check against the framing criteria)">${G.COMBOS.map((c, i) => `<option value="b${i}">${esc(c.name)}</option>`).join('')}</optgroup></select>
            <button class="secondary" data-act="save-combo">Save as a combo</button>${combos.length ? '<button class="link" data-act="del-combo">Delete a combo</button>' : ''}</div>
        <div class="core-cards">
            ${memberCard(coreChoice('topTrack'))}
            ${memberCard({ ...coreChoice('stud'), extra: `<div class="spacing"><label>@ ${spacing}</label>${stateBadge(intentNow()?.members?.spacingIn?.source)}</div>` })}
            ${memberCard(coreChoice('track'))}
        </div>${wallStyleStrip(cur())}`;
}
// The opening optimizer's switch on the sketch (off: studs on center from the left end), and what it comes to.
function renderLayoutInfo() {
    const box = main.querySelector('[data-f="optimizeOpenings"]'), el = main.querySelector('#opt-info'), p = cur();
    if (box) { box.checked = !!p.optimizeOpenings; box.closest('.opt-toggle').classList.toggle('on', !!p.optimizeOpenings); }
    if (!el) return;
    let info = null;
    try { if (!G.panelErrors(p).length) info = G.layoutInfo(p); } catch { /* inputs to fix */ }
    const saved = info && info.standardPieces - info.pieces;
    const end = p.layoutFromRight ? 'right' : 'left';
    el.textContent = !info ? '' : info.manual ? `first stud ${inch(info.start)} from the ${end} end, set by hand` : !info.optimized ? (info.standardPieces > 0 ? `off: on center from the ${end} end` : '')
        : `first stud ${inch(info.start)}${saved > 0 ? ` · ${saved} fewer piece${saved === 1 ? '' : 's'}` : saved < 0 ? ' · every bay within the spacing' : ' · nothing to gain here'}`;
}

// One member of an opening (its own, or the panel's default with o null): the list starts with the default.
function openingChoice(i, k) {
    const p = cur(), m = p.members, o = i == null ? null : p.openings[i], ch = G.memberChoices(m);
    const stud = studName(m), bottom = bottomTrack(m), base = k === 'jamb' ? stud : bottom, def = m[recentKey(k)];
    const baseLabel = k === 'jamb' ? `Same as stud: ${stud}` : `Same as bottom track: ${bottom}`;
    const options = o ? [{ value: '', label: def ? `Panel default: ${def}` : baseLabel }, ...(def ? [{ value: k === 'jamb' ? G.SAME_STUD : G.SAME_TRACK, label: baseLabel }] : [])]
        : [{ value: '', label: baseLabel }];
    options.push(...optsOf([base, ...ch[recentKey(k)]], recentKey(k), [def]));
    const r = G.memberFor(p, o, k);
    return { path: o ? `openings.${i}.${k}` : `members.${recentKey(k)}`, label: o ? `${G.openingName(p.openings, i)} ${G.MEMBER_LABELS[k].toLowerCase()}` : `${G.MEMBER_LABELS[k]} (every opening)`, value: o ? o[k] : def,
        options, r: recentKey(k), resolved: r.spec, ask: o && ask === i, note: r.base ? `${r.base === 'stud' ? 'as the on-center stud' : 'as the bottom track'}, ${r.spec}${k === 'jamb' ? ', one each side' : ''}` : '' };
}
const openingCard = (i, k) => memberCard(openingChoice(i, k));
// "Jambs on the stud layout" for one opening: what it comes to (framed width; stud pieces and steel saved or taken).
function toLayoutNote(p, i) {
    const o = p.openings[i], { pieces, lengthIn } = G.toLayoutEffect(p, i), n = Math.abs(pieces);
    let framedText = '';
    if (o.toLayout) { try { const b = G.frameInputs(p).openings[i]; if (b?.requested) framedText = `framed ${editDimension(b.right - b.left)} between jambs · `; } catch { /* inputs to fix */ } }
    const parts = [pieces ? `${n} ${pieces > 0 ? 'fewer' : 'more'} stud piece${n === 1 ? '' : 's'}` : '', Math.abs(lengthIn) >= 1 ? `${editDimension(Math.abs(lengthIn))} ${lengthIn > 0 ? 'less' : 'more'} steel` : ''].filter(Boolean);
    return framedText + (parts.length ? `${o.toLayout ? '' : 'turned on: '}${parts.join(', ')}` : 'no saving here');
}
function renderCatalogue() {
    const box = $('#catalogue'), p = cur();
    if (sel != null && !p.openings[sel]) { sel = null; ask = null; }
    if (sel == null) {
        box.innerHTML = `<h3>Opening members</h3>
            <p class="muted small">Every opening is framed with these unless you pick its own: click an opening in the elevation, or add one.</p>
            ${['jamb', 'head', 'sill'].map(k => openingCard(null, k)).join('')}
            <p class="muted small">Doors take jambs and a header; windows and MEP openings jambs, a header and a sill; steel penetrations (up through the top) jambs and a sill.</p>`;
        syncOpeningSelection();
        return;
    }
    const o = p.openings[sel], type = G.OPENING_TYPES[o.kind], name = G.openingName(p.openings, sel), L = G.shapeTop(p.shape).lengthIn;
    const locked = G.isLockedOpening(p, o);
    const f = (label, key, value) => field(label, `openings.${sel}.${key}`, value, { t: 'len', list: 'len', locked });
    box.innerHTML = `<div class="row cat-head"><b class="op-name ${o.kind}">${name}</b>
            <select data-f="openings.${sel}.kind" aria-label="Kind of opening" ${locked ? 'disabled' : ''}>${Object.entries(G.OPENING_TYPES).map(([k, t]) => `<option value="${k}" ${k === o.kind ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
            <span class="spacer"></span>${locked ? '' : `<button class="link danger" data-act="del-op" data-i="${sel}">Remove</button>`}</div>
        ${locked ? '<p class="lock-note">🔒 The Revit model\'s: where it is, its size and its kind stay as the model has them. Its members can change.</p>' : G.isFromModel(p) ? '<p class="new-note">Added here: not in the Revit model (the import reports it).</p>' : ''}
        ${ask === sel ? `<p class="ask-note">${name} is in: pick its ${type.members.map(k => G.MEMBER_LABELS[k].toLowerCase()).join(' and ').replace(' and ', type.members.length > 2 ? ', ' : ' and ')}, or keep the defaults.</p>` : ''}
        <div class="fields cat-fields">${f('Width', 'widthIn', o.widthIn)}${o.kind === 'steel' ? '' : f('Height', 'heightIn', o.heightIn)}
            ${o.kind === 'door' ? '' : f(o.kind === 'steel' ? 'Sill height (up through the top)' : 'Sill height', 'sillIn', o.sillIn)}
            ${f('From left end', 'leftIn', o.leftIn)}${f('From right end', '__right', Math.max(0, L - o.leftIn - o.widthIn))}</div>
        ${ruleCard(p, sel)}
        <div class="op-profiles">${memberRows(p, sel)}
            <p class="muted small">Rough opening ${esc(roText(p, sel))} · offset ${esc(inch(G.offsetOf(o)))}${o.toLayout ? ' · jambs on the stud layout' : ''}${o.crippleEnds ? ' · cripples at the ends' : ''}</p>
            <button class="secondary" data-act="framing" data-i="${sel}" title="Jambs, header, sill, the rough opening and more: with a preview">⚙ Framing details and preview…</button></div>
        <div class="row"><button data-act="done">Done</button>${locked ? '' : `<button class="link" data-act="center" data-i="${sel}">Center it</button><button class="link" data-act="mirror-op" data-i="${sel}" title="The same opening the same distance from the other end">Mirror</button>
            <button class="link" data-act="copy-op" data-i="${sel}" title="Another opening like this one">Copy</button><span class="muted small">Arrow keys move it (Shift: 6").</span>`}</div>`;
    syncOpeningSelection();
}
// The selected opening's typed sizes, kept up to date while it is dragged or nudged.
function syncCatalogueFields(except = '') {
    if (sel == null) return;
    const o = cur().openings[sel], L = G.shapeTop(cur().shape).lengthIn;
    for (const el of main.querySelectorAll('#catalogue [data-f][data-t="len"]')) {
        if (el.dataset.f === except || document.activeElement === el) continue;
        const key = el.dataset.f.split('.').pop();
        el.value = lenText(key === '__right' ? Math.max(0, L - o.leftIn - o.widthIn) : key === 'offsetIn' ? G.offsetOf(o) : o[key]);
    }
}
const renderMemberCards = () => { renderCore(); renderCatalogue(); };
function pickMember(path, value) {
    if (value === '__type') {
        typing.add(path);
        renderMemberCards();
        main.querySelector(`[data-f="${path}"]`)?.focus();
        return;
    }
    typing.delete(path);
    const p = cur();
    markChosen(p, path);
    if (path === 'members.stud') followStud(p.members.stud, value);
    else setPath(p, path, path === 'members.spacingIn' ? Number(value) : value);
    const key = path.split('.').pop();
    if (value && !value.startsWith('=') && path !== 'members.spacingIn') { recent[recentKey(key)] = G.remember(recent[recentKey(key)], value); store(KEYS.recent, recent); }
    renderMemberCards(); renderDatalists(); changed();
}
// A new on-center stud: the bottom track and the members in the old stud's size follow it.
function followStud(oldStud, newStud) {
    const p = cur(), before = JSON.stringify(p);
    p.members = { ...G.followStud(p.members, oldStud, newStud), stud: newStud };
    p.openings = p.openings.map(o => {
        const f = G.followStud({ track: '', header: o.head, jamb: o.jamb, sill: o.sill }, oldStud, newStud);
        return { ...o, head: f.header, jamb: f.jamb, sill: f.sill };
    });
    if (JSON.stringify(p) !== before && G.parseMember(oldStud)) notice(`The track and members in ${oldStud}'s size now follow ${newStud}.`);
    renderMemberCards();
}
function renderDatalists() {
    const ch = G.memberChoices(cur().members);
    const groups = [...new Set(set.panels.map(p => p.group).filter(Boolean))];
    const lists = { ...ch, level: [], wallType: [], group: groups, project: [], drawnBy: [], len: [], clip: G.CLIP_TYPES };
    document.getElementById('datalists').innerHTML = Object.entries(lists).map(([k, v]) => `<datalist id="dl-${k}">${[...new Set([...(recent[k] || []), ...v])].map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>`).join('');
}

// --- Tools ---------------------------------------------------------------------------------------------------------------
function renderTools() {
    sketchControls.render();
    const t = (key, label, title) => `<button class="${tool === key ? 'on' : 'secondary'}" data-act="tool" data-tool="${key}" title="${esc(title)}">${label}</button>`;
    $('#tools').innerHTML = `<div class="seg" role="group" aria-label="Tool">${t('select', '↖ Select', 'Pick an opening to see its dimensions and members; drag it or the round handles')}
            ${G.canEdit(cur(), 'shape') ? t('perimeter', '✎ Perimeter', 'Click the panel\'s corners; a notch up from the bottom becomes a door, one down from the top a steel penetration')
                : '<button class="secondary" disabled title="Locked: the Revit model\'s perimeter">🔒 Perimeter</button>'}
            ${t('opening', '▭ Opening', 'Drag a rectangle on the panel: at the floor it is a door, through the top a steel penetration, else a window')}
            ${t('clip', '◫ Clips', 'Click near a stud to put a clip on it (on its web); click a clip to remove it; or clip every stud at a height')}</div>
        <span class="add-label">Add</span>${Object.entries(G.OPENING_TYPES).map(([k, ty]) => `<button class="add-op ${k}" data-act="add-op" data-kind="${k}">+ ${esc(ty.name)}</button>`).join('')}
        ${opProfiles().length ? `<select class="add-prof" data-add-profile aria-label="Add an opening from a profile" title="A new opening of a profile: its framing and its first size"><option value="">+ From a profile…</option>
            ${opProfiles().map(x => `<option value="${esc(x.name)}">${esc(x.name)} (${esc(G.OPENING_TYPES[x.kind].name)}, ${esc(sizeText(x))})</option>`).join('')}</select>` : ''}`;
    renderHint();
}
function renderHint() {
    const el = $('#tool-hint');
    const help = $('#sketch-help'), custom = cur()?.shape.kind === 'custom', free = G.canEdit(cur(), 'shape');
    const hints = sketchPan ? [['Drag','pan view'],['Pan / Esc','return to editing'],['Show all','reset view']] : tool === 'perimeter' ? [['Click inside wall','add corner'],['Double-click / Enter','close outline'],['Backspace','undo corner'],['Esc','cancel']]
        : tool === 'opening' ? [['Drag inside wall','draw opening'],['Esc','cancel']]
        : tool === 'clip' ? [['Click stud','add clip'],['Click clip','remove'],['Esc','finish']]
        : [['Click member','select'],['Click dimension','type size'],...(free ? [['Click top / inside wall','add top point'],['Drag corner / point','reshape freely'],...(custom ? [['Double-click point','remove interior point']] : [])] : [])];
    help.innerHTML = hints.map(([gesture,action])=>`<span><b>${gesture}</b> ${action}</span>`).join('');
    el.hidden = tool === 'select' || tool === 'opening';
    if (tool === 'perimeter') {
        el.innerHTML = `<b>Drawing the perimeter:</b> click each corner (it snaps level and plumb, and to the corners already placed). Type a length and press Enter to place the next corner exactly
            that far toward the pointer. Click the first corner, or press Enter, to close it. A rectangle up from the bottom becomes a door; one down from the top a steel penetration.
            <span class="row peri-actions"><button data-act="peri-finish" ${peri?.pts.length >= 4 ? '' : 'disabled'}>Close the perimeter</button><button class="secondary" data-act="peri-undo" ${peri?.pts.length ? '' : 'disabled'}>Undo a corner</button><button class="link" data-act="peri-cancel">Cancel (Esc)</button></span>`;
    } else if (tool === 'clip') {
        const n = (cur().clips || []).length;
        const ay = clipAlignY(cur());
        el.innerHTML = `<b>Clips:</b> click near a stud to put a <input id="clip-type" class="mini wide" list="dl-clip" value="${esc(clipType)}" aria-label="Clip type (type any)"> on it, on its web, at that height; click a clip to remove it.
            <span class="row clip-align"><label class="fd-check"><input type="checkbox" id="clip-align-on" ${clipAlign.on ? 'checked' : ''}> Align new clips at</label>
                <input id="clip-align-at" class="mini" value="${esc(ay == null ? '' : lenText(ay))}" placeholder="the first clip's height" aria-label="Align new clips at this height">
                <span class="muted small">${ay == null ? 'the first clip you place sets it' : clipAlign.y == null ? 'the first clip\'s height' : 'typed'}; near it a clip snaps to the line (Alt: place it freely)</span></span>
            <span class="row clip-actions">Clip every stud: <button class="secondary" data-act="clip-top">2" under the top</button><button class="secondary" data-act="clip-mid">at mid-height</button>
            or at <input id="clip-at" class="mini" value="${esc(lenText(clipAt))}" aria-label="Height for clips on every stud"><button class="secondary" data-act="clip-all">Clip every stud</button>
            ${n ? `<button class="link danger" data-act="clip-clear">Remove all ${n} clip${n === 1 ? '' : 's'}</button>` : ''}<button class="link" data-act="tool" data-tool="select">Done (Esc)</button></span>`;
    } else if (tool === 'opening') {
        el.innerHTML = '<b>Drawing an opening:</b> drag a rectangle on the panel. Touching the floor it is a door; up through the top a steel penetration; else a window (make it an MEP opening on the right). Esc to stop.';
    } else {
        el.textContent = '';
    }
    el.title = el.textContent;
}
function setTool(next, render = true) {
    sketchPan = false; panDrag = null;
    tool = next;
    sketchEdge = null;
    drag = null; rectDraw = null;
    peri = next === 'perimeter' ? { pts: [], cursor: null, typed: '' } : null;
    if (next === 'perimeter') { sel = null; ask = null; }
    if(next!=='select')$('#sketch-member-tools').hidden=true;
    if (!render) return;
    fit(); renderTools(); renderCatalogue(); renderSketch();
}

// --- The elevation sketch ------------------------------------------------------------------------------------------------
// The view (SVG user units, y down: wall y is -y): the panel with room for dimensions; while drawing the perimeter, a
// fixed canvas big enough to draw in.
function fit() {
    if (sketchZoomPanel !== cur().id) { sketchZoomPanel = cur().id; sketchZoom = 1; panOffset = { x: 0, y: 0 }; sketchPan = false; panDrag = null; }
    const { lengthIn: L, heightIn: H } = G.shapeTop(cur().shape);
    if (tool === 'perimeter') {
        const W = Math.max(L || 0, 240) * 1.25 + 60, Hh = Math.max(H || 0, 144) * 1.25 + 40;
        view = { x: -48, y: -(Hh - 30), w: W, h: Hh + 30 };
    } else {
        const pad = Math.max(L, H, 48) * 0.08, ctx = CL.contextLines(cur(), set), ys = ctx.show ? ctx.levels.map(l => l.yIn) : [];
        const hi = Math.max(H, 12, ...ys) + (ctx.show && ctx.grids.length ? pad * 0.6 : 0), lo = Math.min(0, ...ys);
        view = { x: -pad * 1.7 - (ys.length ? pad * 0.6 : 0), y: -(hi + pad * 1.5), w: Math.max(L, 12) + pad * 3.4 + (ys.length ? pad * 0.6 : 0), h: hi - lo + pad * 3.1 };
    }
    const w = view.w / sketchZoom, h = view.h / sketchZoom;
    view = { x: view.x + (view.w - w) / 2 + panOffset.x, y: view.y + (view.h - h) / 2 + panOffset.y, w, h };
}
function renderSketch() {
    const box = main.querySelector('#sketch');
    if (!box) return;
    const p = cur(), { lengthIn: L, heightIn: H, top } = G.shapeTop(p.shape);
    if (!svgEl || !box.contains(svgEl)) { box.innerHTML = '<svg role="img" aria-label="The panel\'s elevation"></svg>'; svgEl = box.querySelector('svg'); bindSketch(svgEl); }
    if (!view || sketchZoomPanel !== p.id) fit();
    main.querySelector('#sketch-zoom-percent').textContent = Math.round(sketchZoom * 100) + '%';
    main.querySelector('[data-sketch-zoom=out]').disabled = sketchZoom <= 0.5;
    main.querySelector('[data-sketch-zoom=in]').disabled = sketchZoom >= 4;
    svgEl.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    svgEl.dataset.pan = String(sketchPan);
    svgEl.dataset.panning = String(!!panDrag);
    main.querySelector('[data-sketch-pan]').setAttribute('aria-pressed', String(sketchPan));
    svgEl.dataset.tool = tool;
    svgEl.dataset.outside = String(tool === 'perimeter' && !!peri?.cursor && !SK.pointInPanel(p, peri.cursor));
    const scale = Math.min(Math.max(1, svgEl.clientWidth - 2) / view.w, Math.max(1, svgEl.clientHeight - 2) / view.h);
    const u = Math.min(Math.max(view.w, view.h) / 100, 7 / scale), fs = u * 2.2, at = (x) => topAt(top, x, H), Y = (y) => -y;
    const t = (x, y, s, { a = 'middle', cls = 'sk-label', size = fs, rot = 0,edit=null,pin=null } = {}) => `<text x="${x}" y="${y}" text-anchor="${a}" font-size="${size}" class="${cls}${edit?' sk-edit-dim':''}${pin?' sk-line-pin':''}"${edit?` data-sketch-dim="${esc(JSON.stringify(edit))}" role="button" tabindex="0" aria-label="Edit ${esc(s)}"`:''}${pin?` data-sketch-pin="${esc(pin)}" role="button" tabindex="0"`:''}${rot ? ` transform="rotate(${rot} ${x} ${y})"` : ''}>${esc(s)}</text>`;
    // Dimension strings: horizontal at height y, vertical at x; ticks at both ends, the value above / left of the line.
    const cs = fs * 0.88; // context dimensions: a little smaller than the panel's own
    const dimH = (x1, x2, y, label, cls = 'sk-ctx', below = false, size = cls === 'sk-dim' ? fs : cs,edit=null) => (Math.abs(x2 - x1) < 1 / 16 ? '' : `<g class="${cls}"><line x1="${x1}" y1="${Y(y)}" x2="${x2}" y2="${Y(y)}"/>
        <line x1="${x1}" y1="${Y(y) - u}" x2="${x1}" y2="${Y(y) + u}"/><line x1="${x2}" y1="${Y(y) - u}" x2="${x2}" y2="${Y(y) + u}"/>${t((x1 + x2) / 2, Y(y) + (below ? size * 1.15 : -size * 0.35), label, { cls: `${cls.split(' ')[0]}-t`, size,edit })}</g>`);
    const dimV = (x, y1, y2, label, cls = 'sk-ctx', right = false, size = cls === 'sk-dim' ? fs : cs,edit=null) => (Math.abs(y2 - y1) < 1 / 16 ? '' : `<g class="${cls}"><line x1="${x}" y1="${Y(y1)}" x2="${x}" y2="${Y(y2)}"/>
        <line x1="${x - u}" y1="${Y(y1)}" x2="${x + u}" y2="${Y(y1)}"/><line x1="${x - u}" y1="${Y(y2)}" x2="${x + u}" y2="${Y(y2)}"/>${t(x + (right ? size * 1.05 : -size * 0.35), Y((y1 + y2) / 2), label, { cls: `${cls.split(' ')[0]}-t`, rot: -90, size,edit })}</g>`);
    const parts = [];
    if (tool !== 'select') { // a 1 ft grid to draw on
        for (let x = Math.ceil(view.x / 12) * 12; x < view.x + view.w; x += 12) parts.push(`<line x1="${x}" y1="${view.y}" x2="${x}" y2="${view.y + view.h}" class="sk-grid${x % 60 ? '' : ' major'}"/>`);
        for (let y = Math.ceil(-(view.y + view.h) / 12) * 12; y < -view.y; y += 12) parts.push(`<line x1="${view.x}" y1="${Y(y)}" x2="${view.x + view.w}" y2="${Y(y)}" class="sk-grid${y % 60 ? '' : ' major'}"/>`);
    }
    parts.push(`<line x1="${view.x}" y1="0" x2="${view.x + view.w}" y2="0" class="sk-floor"/>`);
    const valid = L > 0 && H > 0;
    const bottom=G.shapeBottom(p.shape),base=x=>baseAt(bottom,x),free=tool==='select'&&G.canEdit(p,'shape');
    const outline = valid ? [[0, base(0)], [L, base(L)], ...(top ? [...top].reverse() : [[L, H], [0, H]])] : [];
    if (valid) {
        parts.push(`<polygon points="${outline.map(([x, y]) => `${x},${Y(y)}`).join(' ')}" class="sk-wall${tool === 'perimeter' ? ' ghost' : ''}"/>`);
        // Always: the length under it, the height at each end, each peak or break.
        parts.push(dimH(0, L, -fs * 1.4, editDimension(L), 'sk-dim', true,fs,free?{kind:'width',value:L}:null), dimV(-fs * 1.6, base(0), at(0), editDimension(at(0)-base(0)), 'sk-dim',false,fs,free?{kind:'height-left',value:at(0)-base(0)}:null), dimV(L + fs * 1.6, base(L), at(L), editDimension(at(L)-base(L)), 'sk-dim', true,fs,free?{kind:'height-right',value:at(L)-base(L)}:null));
        for (const [x, h] of top ? top.slice(1, -1) : []) parts.push(t(x, Y(h) - fs * 0.7, editDimension(h), { cls: 'sk-dim-t' }));
    }
    if (tool !== 'perimeter' && valid) parts.push(contextLayer(p, L, H, top, fs, t, Y));
    // Where the studs will be: their centerlines (side A), cripples as short ones.
    if (tool !== 'perimeter' && valid) parts.push(centerlines(p, H, top));
    // Openings.
    const boxes = p.openings.map(o => G.openingBox(o, H)), skCtx = OC.openingContexts(p, legendColors());
    if (tool !== 'perimeter') p.openings.forEach((o, i) => {
        const b = boxes[i], w = b.right - b.left, topY = b.through ? Math.max(at(b.left), at(b.right)) + fs * 0.6 : b.top, h = topY - b.bottom;
        if (!(w > 0 && h > 0)) return;
        const name = G.openingName(p.openings, i), dims = b.through ? `${editDimension(w)} wide` : `${editDimension(w)} x ${editDimension(h)}`;
        const size = Math.min(fs * 1.1, (w * 0.9) / (name.length * 0.62), h * 0.36), small = Math.min(fs * 0.8, (w * 0.92) / (dims.length * 0.56), h * 0.22);
        if (G.offsetOf(o) > 0) { const r = G.roughOpening(o, H), rt = b.through ? topY : r.top; parts.push(`<rect x="${r.left}" y="${Y(rt)}" width="${r.right - r.left}" height="${rt - r.bottom}" class="sk-ro"><title>${esc(`${name}'s rough opening: ${roText(p, i)}`)}</title></rect>`); }
        const fb = o.toLayout && laid.lay?.openings.find(x => x.requested && Math.abs(x.requested.left - G.roughOpening(o, H).left) < 1e-6 && Math.abs(x.bottom - G.roughOpening(o, H).bottom) < 1e-6);
        if (fb) parts.push(`<rect x="${fb.left}" y="${Y(topY)}" width="${fb.right - fb.left}" height="${h}" class="sk-framed"><title>${esc(`${name} framed out to the stud layout: ${editDimension(fb.right - fb.left)} between jambs`)}</title></rect>`);
        const tiny = G.isSmallPenetration(p, o), oc = skCtx[i]; // tiny: a model's penetration under 6": not framed (the resolved plan reports it)
        parts.push(`<g class="sk-op ${o.kind}${i === sel ? ' on' : ''}${G.isLockedOpening(p, o) ? ' locked' : ''}${tiny ? ' small' : ''}" data-drag="op:${i}"${oc ? ` style="--oc:${oc.color}"` : ''}><title>${esc(`${tiny ? `${name}: a ${editDimension(o.widthIn)} x ${editDimension(o.heightIn)} penetration, under 6": not framed here (decide its framing)` : `${name}: ${G.OPENING_TYPES[o.kind].name}${G.isLockedOpening(p, o) ? '' : ', drag to move it'}`}${oc ? `\n${oc.title}` : ''}`)}</title>
            <rect x="${b.left}" y="${Y(topY)}" width="${w}" height="${h}"/>${t(b.left + w / 2, Y(b.bottom + h / 2) - small * 0.25, name, { cls: 'sk-op-text', size })}${t(b.left + w / 2, Y(b.bottom + h / 2) + small * 1.2, dims, { cls: 'sk-op-sub', size: small })}</g>`);
    });
    // Placing clips: the align line (bold while the aim snaps to it) and where the next clip goes.
    if (tool === 'clip' && valid) {
        const ay = clipAlignY(p);
        if (ay != null && clipAlign.on) parts.push(`<g class="sk-align${clipAim?.aligned ? ' on' : ''}"><line x1="${-fs * 2}" y1="${Y(ay)}" x2="${L + fs * 3.4}" y2="${Y(ay)}"/>${t(L + fs * 3.6, Y(ay) + fs * 0.35, `${clipAim?.aligned ? 'aligned ' : ''}${editDimension(ay)}`, { a: 'start', cls: 'sk-align-t', size: fs * 0.8 })}</g>`);
        if (clipAim && clipAim.x >= 0 && clipAim.x <= L) parts.push(`<rect x="${clipAim.x - Math.max(0.6, u * 0.45)}" y="${Y(clipAim.y) - Math.max(1.5, u * 0.9)}" width="${Math.max(1.25, u * 0.9)}" height="${Math.max(3, u * 1.8)}" class="sk-clip ghost"/>`);
    }
    // Clips, on their studs' webs (at least a little block on screen, however small the panel is drawn).
    if (tool !== 'perimeter' && laid.lay) for (const c of G.placeClips(laid.lay, p.clips).clips) {
        const w = Math.max(1.25, u * 0.9), h = Math.max(3, u * 1.8);
        parts.push(`<rect x="${c.side === 'R' ? c.x : c.x - w}" y="${Y(c.y + h / 2)}" width="${w}" height="${h}" class="sk-clip${hover === `clip:${c.i}` ? ' on' : ''}" data-clip="${c.i}" data-hover="clip:${c.i}"><title>${esc(`${c.mark} ${c.type} at ${editDimension(c.y)}, on its stud's web · ${tool === 'clip' ? 'click to remove it' : 'right-click for options'}`)}</title></rect>`);
    }
    // Grips (shape handles, as in Revit): round at the panel's corners, arrows at the middle of its edges (an end moves
    // the end out or in, the openings staying where they are; a run of the top moves up or down); square at the
    // selected opening's corners, diamonds at the middle of its edges (resize it).
    if (tool === 'select') outline.forEach(([x,y],i)=>{
        const [x2,y2]=outline[(i+1)%outline.length],key=i===0?'bottom:0':i===1?'right':i===outline.length-1?'left':`top:${outline.length-2-i}`,selected=sketchEdge?.panelId===p.id&&sketchEdge.key===key;
        parts.push(`<line x1="${x}" y1="${Y(y)}" x2="${x2}" y2="${Y(y2)}" class="sk-hit${selected?' sk-edge-selected':''}" data-hover="edge:${i}" data-sketch-edge="${key}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="Select ${key.replace(':',' edge ')}"><title>${key.startsWith('top:')&&free&&!SK.pinned(p,'top')?'Click to add a top point; Tab then Enter selects the edge without adding a point':'Select edge'+(Math.abs(x2-x)>1e-6&&Math.abs(y2-y)>1e-6?' to edit its slope':'')}</title></line>`);
    });
    const handle = (x, y, what, title) => `<circle cx="${x}" cy="${Y(y)}" r="${u * 1.5}" class="sk-handle" data-drag="${what}"><title>${esc(title)}</title></circle>`;
    const arrow = (x, y, dir, what, title) => { // a double arrow across the edge
        const a = u * 2.1, w = u * 1.1, [dx, dy] = dir === 'h' ? [1, 0] : [0, 1], px = -dy, py = dx;
        const tip = (sg) => `${x + dx * a * sg},${Y(y) - dy * a * sg} ${x + dx * a * 0.25 * sg + px * w},${Y(y) - (dy * a * 0.25 * sg + py * w)} ${x + dx * a * 0.25 * sg - px * w},${Y(y) - (dy * a * 0.25 * sg - py * w)}`;
        return `<g class="sk-arrow" data-drag="${what}"><title>${esc(title)}</title><circle cx="${x}" cy="${Y(y)}" r="${a * 1.05}" class="sk-arrow-hit"/><polygon points="${tip(1)}"/><polygon points="${tip(-1)}"/></g>`;
    };
    const grip = (x, y, what, title, diamond = false, g = u * 1.05) => diamond
        ? `<rect x="${x - g}" y="${Y(y) - g}" width="${g * 2}" height="${g * 2}" transform="rotate(45 ${x} ${Y(y)})" class="sk-grip" data-drag="${what}"><title>${esc(title)}</title></rect>`
        : `<rect x="${x - g}" y="${Y(y) - g}" width="${g * 2}" height="${g * 2}" class="sk-grip" data-drag="${what}"><title>${esc(title)}</title></rect>`;
    const s = p.shape;
    const shapeLocked = !G.canEdit(p, 'shape');
    if (tool === 'select' && valid && !shapeLocked) {
        const pts = G.shapePoints(s);
        pts.slice(1).forEach(([x1, h1], k) => { const [x0, h0] = pts[k]; parts.push(arrow((x0 + x1) / 2, (h0 + h1) / 2, 'v', `pg:run:${k + 1}`, 'Drag the top up or down here')); });
        parts.push(arrow(0, at(0) / 2, 'h', 'pg:l', 'Drag the left end out or in (the openings stay where they are)'), arrow(L, at(L) / 2, 'h', 'pg:r', 'Drag the right end out or in'));
        parts.push(handle(0, base(0), 'pg:bl', 'The left end: drag it out or in'), handle(L, base(L), 'pg:br', 'The right end: drag it out or in'),
            handle(0, at(0), 'pg:tl', s.kind === 'rect' ? 'The left end and the height' : 'The left end and its height'), handle(L, at(L), 'pg:tr', s.kind === 'rect' ? 'The right end and the height' : 'The right end and its height'));
        if (s.kind === 'gable') parts.push(handle(Math.min(L, Math.max(0, s.peakAtIn ?? L / 2)), Number(s.peakIn) || H, 'peak', 'The peak: drag up, down or sideways'));
        if (s.kind === 'custom') s.points.slice(1, -1).forEach((pt, k) => parts.push(handle(pt[0], pt[1], `pt:${k + 1}`, `Point ${k + 2}: drag it; double-click to remove`)));
    }
    if (tool === 'select' && valid) {
        if (sel != null && boxes[sel] && !G.isLockedOpening(p, p.openings[sel])) {
            const o = p.openings[sel], b = boxes[sel], topY = b.through ? Math.max(at(b.left), at(b.right)) : b.top, mx = (b.left + b.right) / 2, my = (b.bottom + topY) / 2;
            const sides = [['l', b.left, my, 'Its left side'], ['r', b.right, my, 'Its right side'], ['t', mx, topY, 'Its head'], ['b', mx, b.bottom, 'Its sill']]
                .filter(([g]) => !(g === 't' && o.kind === 'steel') && !(g === 'b' && o.kind === 'door'));
            const corners = [['tl', b.left, topY], ['tr', b.right, topY], ['bl', b.left, b.bottom], ['br', b.right, b.bottom]]
                .filter(([g]) => !(g[0] === 't' && o.kind === 'steel') && !(g[0] === 'b' && o.kind === 'door'));
            // Grips sized to the opening, so a small one stays visible under them; its side grips only when there is room.
            const gs = Math.max(u * 0.3, Math.min(u * 1.05, Math.min(b.right - b.left, topY - b.bottom) * 0.1)), roomy = Math.min(b.right - b.left, topY - b.bottom) > gs * 9;
            if (roomy) for (const [g, x, y, title] of sides) parts.push(grip(x, y, `og:${sel}:${g}`, `${title}: drag to resize`, true, gs));
            for (const [g, x, y] of corners) parts.push(grip(x, y, `og:${sel}:${g}`, 'Drag this corner to resize', false, gs));
        }
    }
    // Context: dimensions all around what is moved, selected or pointed at.
    const ctx = [];
    const highest0 = (b) => Math.min(b.top, at((b.left + b.right) / 2));
    const openingDims = (i, cls) => {
        const b = boxes[i], o = p.openings[i], others = boxes.filter((_, j) => j !== i), cx = (b.left + b.right) / 2;
        // Side dimensions low, up and down ones off center (clear of its name and size); a small opening's up and down
        // ones beside it, so their text never covers it.
        const small = b.right - b.left < cs * 7 || highest0(b) - b.bottom < cs * 4;
        const highest = Math.min(b.top, at(cx)), mid = small ? (b.bottom + highest) / 2 : b.bottom + (highest - b.bottom) * 0.35, vx = small ? b.right + cs * 1.6 : b.left + (b.right - b.left) * 0.28;
        const across = others.filter(c => c.bottom < mid && c.top > mid);
        const lo = Math.max(0, ...across.filter(c => c.right <= b.left + 1e-6).map(c => c.right)), hi = Math.min(L, ...across.filter(c => c.left >= b.right - 1e-6).map(c => c.left));
        ctx.push(dimH(lo, b.left, mid, editDimension(b.left - lo), cls), dimH(b.right, hi, mid, editDimension(hi - b.right), cls));
        if (lo > 0) ctx.push(dimH(0, b.left, mid - cs * 1.9, `${editDimension(b.left)} from left end`, `${cls} far`));
        if (hi < L) ctx.push(dimH(b.right, L, mid - cs * 1.9, `${editDimension(L - b.right)} to right end`, `${cls} far`));
        const column = others.filter(c => c.left < cx && c.right > cx);
        const floor = Math.max(0, ...column.filter(c => c.top <= b.bottom + 1e-6).map(c => c.top));
        if (b.bottom > floor) ctx.push(dimV(vx, floor, b.bottom, `${editDimension(b.bottom - floor)}${floor ? '' : ' sill'}`, cls, true));
        if (!b.through) {
            const ceiling = Math.min(at(cx), ...column.filter(c => c.bottom >= b.top - 1e-6).map(c => c.bottom));
            if (ceiling > b.top) ctx.push(dimV(vx, b.top, ceiling, `${editDimension(ceiling - b.top)} to ${ceiling < at(cx) ? 'next' : 'top'}`, cls, true));
        }
        return o;
    };
    const dragged = /^o[pg]:(\d+)/.exec(drag?.moved ? drag.what : '');
    if (tool === 'select') {
        if (dragged) openingDims(Number(dragged[1]), 'sk-ctx live');
        else if (sel != null && boxes[sel]) openingDims(sel, 'sk-ctx');
        const hov = /^op:(\d+)$/.exec(hover || '');
        if (!dragged && hov && Number(hov[1]) !== sel) openingDims(Number(hov[1]), 'sk-ctx hov');
        const edge = /^edge:(\d+)$/.exec(hover || '');
        if (edge && valid) {
            const [x1, y1] = outline[Number(edge[1])], [x2, y2] = outline[(Number(edge[1]) + 1) % outline.length], dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
            const label = dx < 1e-6 ? `${editDimension(dy)} high` : dy < 1e-6 ? editDimension(dx) : `${editDimension(Math.hypot(dx, dy))} along`;
            ctx.push(`<line x1="${x1}" y1="${Y(y1)}" x2="${x2}" y2="${Y(y2)}" class="sk-edge-on"/>`, t((x1 + x2) / 2 + (dx < 1e-6 ? (x1 < L / 2 ? -fs : fs) : 0), Y((y1 + y2) / 2) + (dx < 1e-6 ? 0 : y1 + y2 < 1e-6 ? fs * 2.6 : -fs * 0.8), label, { cls: 'sk-ctx-t', size: cs * 1.1, a: dx < 1e-6 ? (x1 < L / 2 ? 'end' : 'start') : 'middle' }));
        }
        const mem = /^mem:(\d+)$/.exec(hover || ''),selectedKey=selectedLayoutKey(),mm=laid.lay?.members.find(m=>m.key===selectedKey)||(mem&&laid.lay?.members[Number(mem[1])]);
        if (mm && valid) {
            const cx = mm.x + mm.w / 2, my = mm.y + mm.h / 2;
            const peers=laid.lay.members.filter(m=>m.orient==='v'&&m.key!==mm.key&&m.y<mm.y+mm.h&&m.y+m.h>mm.y).sort((a,b)=>a.x-b.x),left=peers.filter(m=>m.x+m.w/2<cx-1/16).at(-1),right=peers.find(m=>m.x+m.w/2>cx+1/16),a=left?left.x+left.w/2:0,b=right?right.x+right.w/2:L;
            ctx.push(`<line x1="${cx}" y1="${Y(mm.y)}" x2="${cx}" y2="${Y(mm.y + mm.h)}" class="sk-mem-on"/>`, dimH(a, cx, my, editDimension(cx-a), 'sk-ctx',false,cs,{kind:'gap',value:cx-a,left:left?.key||'left',right:mm.key,prefer:'right'}),dimH(cx,b,my+cs*1.9,editDimension(b-cx),'sk-ctx',false,cs,{kind:'gap',value:b-cx,left:mm.key,right:right?.key||'right',prefer:'left'}));
        }
        const corner = /^(pt:\d+|peak|pg:tl|pg:tr|pg:bl|pg:br|pg:l|pg:r)$/;
        const point = (drag?.moved && corner.test(drag.what) ? drag.what : null) || (corner.test(hover || '') ? hover : null);
        if (point && valid) {
            const [px, ph] = point.startsWith('pt:') ? s.points[Number(point.slice(3))] || [0, 0] : point === 'peak' ? [s.peakAtIn ?? L / 2, s.peakIn]
                : /^pg:(tl|bl|l)$/.test(point) ? [0, at(0)] : [L, at(L)];
            ctx.push(dimH(0, px, ph + fs * 1.2, editDimension(px)), dimH(px, L, ph + fs * 1.2, editDimension(L - px)), dimV(px, 0, ph, `${editDimension(ph)} high`, 'sk-ctx', true));
        }
    }
    // Drawing an opening: its size and where it is.
    if (rectDraw) {
        const r = rectBox(rectDraw);
        ctx.push(`<rect x="${r.left}" y="${Y(r.top)}" width="${r.right - r.left}" height="${r.top - r.bottom}" class="sk-rect ${r.kind}"/>`,
            t((r.left + r.right) / 2, Y((r.bottom + r.top) / 2), G.OPENING_TYPES[r.kind].name, { cls: 'sk-op-text', size: fs }),
            dimH(0, r.left, (r.bottom + r.top) / 2, editDimension(r.left), 'sk-ctx live'), dimH(r.right, L, (r.bottom + r.top) / 2, editDimension(L - r.right), 'sk-ctx live'),
            dimH(r.left, r.right, r.top + fs * 1.3, `${editDimension(r.right - r.left)} wide`, 'sk-ctx size'), dimV(r.right + fs * 1.2, r.bottom, r.top, `${editDimension(r.top - r.bottom)} high`, 'sk-ctx size', true),
            r.bottom > 0 ? dimV((r.left + r.right) / 2, 0, r.bottom, `${editDimension(r.bottom)} sill`, 'sk-ctx live', true) : '');
    }
    // Drawing the perimeter: the corners so far, the next one under the pointer, and the lengths.
    if (peri) {
        const pts = peri.pts, c = peri.cursor;
        if (pts.length) parts.push(`<polyline points="${[...pts, ...(c ? [c] : [])].map(([x, y]) => `${x},${Y(y)}`).join(' ')}" class="sk-peri"/>`);
        pts.forEach(([x, y], i) => {
            parts.push(`<circle cx="${x}" cy="${Y(y)}" r="${u * (i ? 0.9 : 1.4)}" class="sk-vertex${i ? '' : ' first'}${i === 0 && c && peri.closing ? ' closing' : ''}"/>`);
            if (i) { const [x0, y0] = pts[i - 1],length=Math.hypot(x-x0,y-y0),locked=peri.locks?.includes(i-1); ctx.push(t((x + x0) / 2, Y((y + y0) / 2) - fs * 0.4, editDimension(length), { cls: 'sk-ctx-t',edit:{kind:'segment',index:i-1,value:length} }),t((x+x0)/2,Y((y+y0)/2)+fs*.9,locked?'🔒':'○',{cls:'sk-ctx-t',pin:`segment:${i-1}`})); }
        });
        if (c && pts.length) {
            const [x0, y0] = pts[pts.length - 1], len = Math.hypot(c[0] - x0, c[1] - y0);
            ctx.push(t((c[0] + x0) / 2, Y((c[1] + y0) / 2) - fs * 0.5, `${editDimension(len)}${Math.abs(c[0] - x0) > 1e-6 && Math.abs(c[1] - y0) > 1e-6 ? ` (${editDimension(Math.abs(c[0] - x0))} x ${editDimension(Math.abs(c[1] - y0))})` : ''}`, { cls: 'sk-ctx-t', size: cs * 1.1 }));
        }
        if (c) parts.push(`<circle cx="${c[0]}" cy="${Y(c[1])}" r="${u * 0.8}" class="sk-cursor"/>`);
        if (peri.typed) ctx.push(t((c?.[0] ?? 0) + fs, Y(c?.[1] ?? 0) - fs * 1.2, `Length: ${peri.typed}${parseDimension(peri.typed) != null ? ` = ${editDimension(parseDimension(peri.typed))}` : ''} (Enter)`, { cls: 'sk-typed', a: 'start', size: fs * 1.1 }));
    }
    svgEl.innerHTML = parts.join('') + ctx.join('');
}

// The framing laid out for the sketch (side A), at most every 120 ms while dragging; nothing while inputs need fixing.
let laid = { key: '', at: 0, lay: null };
const ROLE_NAMES = { stud: 'Stud on center', 'end stud': 'End stud', 'jamb stud': 'Jamb', cripple: 'Cripple' };
function centerlines(p, H, top) {
    const key = JSON.stringify(p);
    if (key !== laid.key && (!drag || Date.now() - laid.at > 120)) {
        let lay = null;
        try { lay = framed(p).plan?.layout || null; } catch { /* inputs to fix */ }
        laid = { key, at: Date.now(), lay };
    }
    if (!laid.lay) return '';
    const leg = G.parseMember(p.members.track)?.flangeIn ?? 1.25, lay = laid.lay, u = Math.max(view.w, view.h) / 100;
    const lines = [], hits = [], cs = [];
    lay.members.forEach((m, k) => {
        if (m.orient !== 'v') return;
        const cx = m.x + m.w / 2, seated = seatOf(m, lay.members), y1 = seated?.y0 ?? m.y, y2 = seated?.y1 ?? (m.pts ? underAt(top, cx, H, leg) : m.y + m.h);
        lines.push(`<line x1="${cx}" y1="${-y1}" x2="${cx}" y2="${-y2}" class="${m.manual ? 'custom' : m.role === 'jamb stud' || m.role === 'end stud' ? 'j' : m.role === 'cripple' ? 'c' : ''}"/>`);
        hits.push(`<line x1="${cx}" y1="${-y1}" x2="${cx}" y2="${-y2}" class="sk-mem-hit" data-hover="mem:${k}" data-member-key="${esc(m.key)}" role="button" tabindex="0" aria-label="Select ${esc(m.mark)} ${esc(m.role)}"><title>${esc(`${ROLE_NAMES[m.role] || m.role}: ${m.type}, ${editDimension(m.lengthIn)} · click to edit`)}</title></line>`);
        if (m.y <= leg + 0.5) { // on the bottom track: its C in plan under it, the web on the side it is (Flip studs turns the studs on center)
            const ya = u * 0.6, yb = ya + Math.max(u * 1.3, 2.5), lip = (yb - ya) * 0.3, [open, web] = webOnRight(m, lay) ? [m.x, m.x + m.w] : [m.x + m.w, m.x];
            cs.push(`<path d="M${open} ${ya + lip}V${ya}H${web}V${yb}H${open}V${yb - lip}" class="sk-c"/>`);
        }
    });
    // Headers and sills as framed (a box header shows its depth), behind the openings.
    const hds = lay.members.filter(m => m.role === 'head track' || m.role === 'sill track').map(m => `<rect x="${m.x}" y="${-(m.y + m.h)}" width="${m.w}" height="${m.h}" class="sk-hd"/>`);
    return `<g class="sk-cl">${hds.join('')}${lines.join('')}${cs.join('')}</g><g class="sk-mem-hits">${hits.join('')}</g>`;
}

function wallPoint(e) {
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(svgEl.getScreenCTM().inverse());
    return [q.x, -q.y];
}
const snap = (v) => Math.round(v * 2) / 2; // 1/2" while dragging; type a size for anything finer
// A rectangle being drawn as an opening: at the floor a door, up through the top a steel penetration, else a window.
function rectBox({ a, b }) {
    const { lengthIn: L, heightIn: H, top } = G.shapeTop(cur().shape);
    const left = Math.max(0, Math.min(a[0], b[0])), right = Math.min(L, Math.max(a[0], b[0]));
    let bottom = Math.max(0, Math.min(a[1], b[1])), upper = Math.max(a[1], b[1]);
    const lowTop = topMin(top, left, right, H), kind = bottom <= 3 ? 'door' : upper >= lowTop - 3 ? 'steel' : 'window';
    if (kind === 'door') bottom = 0;
    if (kind === 'steel') upper = Math.max(upper, lowTop);
    return { left: snap(left), right: snap(right), bottom: snap(bottom), top: snap(Math.min(upper, Math.max(H, upper))), kind };
}
function bindSketch(svg) {
    const selectEdge = (hit, keyboard = false) => {
        const key=hit.dataset.sketchEdge;
        selectTarget(W.NONE);sketchEdge={panelId:cur().id,key};sketchControls.render();renderSketch();
        if(keyboard)svg.querySelector(`[data-sketch-edge="${key}"]`)?.focus({preventScroll:true});
    };
    const selectMember = (hit, keyboard = false) => {
        const key = hit?.dataset.memberKey, rec = current.plan?.members?.find(m => m.memberKey === key || m.memberKey.startsWith(`${key}:`));
        if (rec) { selectTarget({ kind: 'member', key: rec.memberKey }); if (keyboard) document.querySelector('#sketch-member-tools button')?.focus(); }
    };
    svg.addEventListener('keydown', e => { if (sketchPan) { if (['Enter',' '].includes(e.key))e.preventDefault(); return; } if (!['Enter',' '].includes(e.key))return;if(e.target.matches('[data-sketch-edge]')){e.preventDefault();selectEdge(e.target,true);}else if(e.target.matches('[data-member-key]')){e.preventDefault();selectMember(e.target,true);} });
    svg.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return; // a right-click opens the sketch's menu instead
        if (sketchPan) {
            e.preventDefault(); svg.setPointerCapture(e.pointerId);
            panDrag = { x: e.clientX, y: e.clientY, offset: { ...panOffset }, inverse: svg.getScreenCTM().inverse() };
            renderSketch(); return;
        }
        if(e.target.closest('[data-sketch-dim],[data-sketch-pin]'))return;
        const edgeHit=e.target.closest('[data-sketch-edge]');
        if(tool==='select'&&edgeHit){
            e.preventDefault();
            if(edgeHit.dataset.sketchEdge.startsWith('top:')){
                const p=cur(),q=wallPoint(e),s=G.shapeTop(p.shape),height=topAt(s.top,q[0],s.heightIn),scale=Math.hypot(svg.getScreenCTM().a,svg.getScreenCTM().b);
                // The painted line is clickable, including its outer half; the wider invisible selection band is not an insertion area.
                const dx=Number(edgeHit.getAttribute('x2'))-Number(edgeHit.getAttribute('x1')),dy=Number(edgeHit.getAttribute('y2'))-Number(edgeHit.getAttribute('y1'));
                if((SK.pointInPanel(p,q)||Math.abs(q[1]-height)*scale*Math.abs(dx)/Math.hypot(dx,dy)<=1.5)&&addPointAt(p,[q[0],height],true)){
                    renderElevHead();renderShapeTable();renderHint();changed();
                }
            }
            selectEdge(edgeHit);return;
        }
        if (tool === 'select' && e.target.closest('[data-member-key]')) { e.preventDefault(); selectMember(e.target.closest('[data-member-key]')); return; }
        if(sketchEdge&&!e.target.closest('[data-drag]')){sketchEdge=null;sketchControls.render();}
        const p = cur(), q = wallPoint(e), h = e.target.closest('[data-drag]');
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
        if (tool === 'perimeter') {
            peri.cursor = snapPerimeter(q);
            if(!SK.pointInPanel(p,q)&&!e.target.closest('.sk-vertex.first')){renderSketch();return;}
            drag = { what: 'peri', x: e.clientX, y: e.clientY, moved: false }; return;
        }
        if (tool === 'opening') { rectDraw = { a: [snap(q[0]), snap(q[1])], b: [snap(q[0]), snap(q[1])] }; drag = { what: 'rect', x: e.clientX, y: e.clientY, moved: false }; return; }
        if (tool === 'clip') { const c = e.target.closest('[data-clip]'); if (c) { removeClip(p, Number(c.dataset.clip)); return; } const a = clipAimAt(p, q, e.altKey); addClips(p, [{ type: clipType, x: round16(q[0]), y: a.y }]); if (a.aligned) notice(`Aligned at ${editDimension(a.y)}.`); return; }
        dragSeq++; // one drag: one undo step
        drag = { what: h?.dataset.drag || 'none', start: q, moved: false, orig: structuredClone({ shape: p.shape, openings: p.openings }), x: e.clientX, y: e.clientY, view0: { ...view } };
        const m = /^op:(\d+)$/.exec(drag.what);
        if (m && sel !== Number(m[1])) { sel = Number(m[1]); if (ask !== sel) ask = null; renderCatalogue(); renderChips(); renderSketch(); }
    });
    svg.addEventListener('pointermove', (e) => {
        if (sketchPan) {
            if (panDrag) {
                const dx = e.clientX - panDrag.x, dy = e.clientY - panDrag.y, m = panDrag.inverse;
                panOffset = { x: panDrag.offset.x - m.a * dx - m.c * dy, y: panDrag.offset.y - m.b * dx - m.d * dy };
                fit(); renderSketch();
            }
            return;
        }
        if(sketchControls.dialog.open)return;
        if(e.target.closest('[data-sketch-dim],[data-sketch-pin]'))return;
        const q = wallPoint(e);
        if (tool === 'perimeter') { peri.cursor = snapPerimeter(q); renderSketch(); return; }
        if (tool === 'clip' && !drag) { clipAim = { x: q[0], ...clipAimAt(cur(), q, e.altKey) }; renderSketch(); }
        if (!drag) {
            const h = e.target.closest('[data-hover],[data-drag]'), key = h ? h.dataset.hover || h.dataset.drag : null;
            if (key !== hover) { hover = key; renderSketch(); }
            return;
        }
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true;
        if (!drag.moved) return;
        if (drag.what === 'rect') { rectDraw.b = [snap(q[0]), snap(q[1])]; renderSketch(); return; }
        if (drag.what === 'none') return;
        applyDrag(drag, q);
        syncCatalogueFields();
        refresh();
    });
    const end = (e) => {
        if (panDrag) { panDrag = null; if (svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId); renderSketch(); return; }
        const d = drag;
        drag = null;
        if (!d) return;
        if (d.what === 'peri') { if (!d.moved) addPerimeterCorner(); return; }
        if (d.what === 'rect') { finishRect(); return; }
        const p = cur();
        // Keep the original grip alive through click/double-click dispatch when it has not moved.
        if(!d.moved&&/^(pt:|pg:|peak$)/.test(d.what))return;
        if (!d.moved && d.what === 'none') {
            if (addPointAt(p, wallPoint(e))) { renderElevHead(); renderShapeTable(); renderHint(); changed(); }
            else if (sel != null) { sel = null; ask = null; renderCatalogue(); renderChips(); }
        }
        if (d.moved) { renderShapeFields(); syncCatalogueFields(); changed(); }
        refresh(true);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', () => { panDrag = null; drag = null; rectDraw = null; renderSketch(); });
    svg.addEventListener('pointerleave', () => { if (!drag && hover) { hover = null; renderSketch(); } });
    svg.addEventListener('contextmenu', e => { if (sketchPan) { e.preventDefault(); return; } openMenu(e); });
    svg.addEventListener('dblclick', (e) => {
        if (sketchPan) { e.preventDefault(); return; }
        if (tool === 'perimeter') { finishPerimeter(); return; }
        // The SVG redraws between clicks; the native double-click target can be their common SVG ancestor.
        const h = e.target.closest('[data-drag^="pt:"]') || document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-drag^="pt:"]'), p = cur();
        if (!h || p.shape.kind !== 'custom') return;
        if(!G.canEdit(p,'shape')||SK.pinned(p,'top'))return;
        const i = Number(h.dataset.drag.slice(3));
        if (i > 0 && i < p.shape.points.length - 1) { p.shape.points.splice(i, 1); renderShapeTable(); changed(); }
    });
}
function applyDrag(d, [x, y]) {
    const p = cur(), s = p.shape, L = G.shapeTop(s).lengthIn, minH = 12;
    const [what, n, g] = d.what.split(':'), i = Number(n);
    if(what==='pg'&&((SK.pinned(p,'left')&&/^(l|tl|bl)$/.test(n))||(SK.pinned(p,'right')&&/^(r|tr|br)$/.test(n))||(SK.pinned(p,'top')&&/^(run|tl|tr)$/.test(n)))||SK.pinned(p,'top')&&/^(pt|peak)$/.test(what)){if(!d.warned){notice('Unlock that sketch line before dragging it.',true);d.warned=true;}return;}
    if ((/^(pg|peak|pt)$/.test(what) && !G.canEdit(p, 'shape')) || (/^o[pg]$/.test(what) && !G.canEdit(p, `openings.${i}.leftIn`))) { // the model's: held
        if (!d.warned) { d.warned = true; lockedNotice(); }
        return;
    }
    if (what === 'pg') { // the panel's ends and top, from how it was when the drag started
        const x0 = x + (d.shift || 0), base = { ...p, shape: structuredClone(d.orig.shape), openings: structuredClone(d.orig.openings) };
        let next = base;
        if (n === 'run') next = { ...base, shape: G.moveRun(base.shape, Number(g), snap(y - d.start[1])) };
        if (/^(l|tl|bl)$/.test(n)) next = G.moveEnd(base, 'left', snap(x0));
        if (/^(r|tr|br)$/.test(n)) next = G.moveEnd(base, 'right', snap(x0));
        if (n === 'tl' || n === 'tr') next = { ...next, shape: G.setEndHeight(next.shape, n === 'tl' ? 'left' : 'right', snap(y)) };
        p.shape = next.shape;
        p.openings = next.openings;
        // The left end moved: the panel starts at it now, so the view moves with it and the rest stays put on screen.
        if (/^(l|tl|bl)$/.test(n)) { const moved = G.shapeTop(d.orig.shape).lengthIn - G.shapeTop(p.shape).lengthIn; d.shift = moved; view.x = d.view0.x - moved; }
        return;
    }
    if (what === 'og') { // a grip of the selected opening
        const o0 = d.orig.openings[i], { heightIn: H, top } = G.shapeTop(s), b = G.openingBox(o0, H), leg = G.parseMember(p.members.track)?.flangeIn ?? 1.25;
        p.openings[i] = G.resizeOpening(o0, g, [snap(x), snap(y)], { L, maxTop: underMin(top, b.left, b.right, H, leg) });
        return;
    }
    if (what === 'peak') { s.peakAtIn = Math.min(L - 1, Math.max(1, snap(x))); s.peakIn = Math.max(minH, snap(y)); }
    if (what === 'pt') {
        const pts = s.points, last = pts.length - 1;
        pts[i] = [i === 0 ? 0 : i === last ? L : Math.min(pts[i + 1][0] - 1, Math.max(pts[i - 1][0] + 1, snap(x))), Math.max(minH, snap(y))];
    }
    if (what === 'op') {
        const o = p.openings[i], o0 = d.orig.openings[i];
        o.leftIn = Math.min(L - o.widthIn, Math.max(0, snap(o0.leftIn + x - d.start[0])));
        if (o.kind !== 'door') o.sillIn = Math.max(3, snap(o0.sillIn + y - d.start[1]));
    }
}
function addPointAt(p, [x, y], onTop = false) {
    if(!G.canEdit(p,'shape')||SK.pinned(p,'top')||!SK.pointInPanel(p,[x,y]))return false;
    const shape=p.shape.kind==='custom'?structuredClone(p.shape):G.changeShape(p.shape,'custom'),pts=shape.points,{lengthIn:L,heightIn:H,top}=G.shapeTop(p.shape);
    if (!(x > 1 && x < L - 1 && y > 12) || pts.some(pt => Math.abs(pt[0] - x) < 3)) return false;
    const point=onTop?[round16(x),topAt(top,round16(x),H)]:[snap(x),snap(y)];if(!SK.pointInPanel(p,point)||pts.some(pt=>Math.abs(pt[0]-point[0])<3))return false;
    pts.push(point);
    pts.sort((a, b) => a[0] - b[0]);
    p.shape=shape;
    return true;
}
function finishRect() {
    const r = rectBox(rectDraw), p = cur();
    rectDraw = null;
    if (r.right - r.left < 6 || r.top - r.bottom < 6) { notice('Drag a rectangle at least 6" each way on the panel to make an opening.', true); renderSketch(); return; }
    const o = { kind: r.kind, leftIn: r.left, widthIn: round16(r.right - r.left), heightIn: r.kind === 'steel' ? 0 : round16(r.top - r.bottom), sillIn: r.bottom, head: '', jamb: '', sill: '' };
    p.openings.push(o);
    setTool('select');
    selectNew(p, p.openings.length - 1);
}
const round16 = (v) => Math.round(v * 16) / 16;
// Nudge the selected opening with the arrow keys (1/2", Shift 6"); Esc stops a tool or lets go of the opening.
document.addEventListener('keydown', (e) => {
    if (sketchControls.dialog.open||document.getElementById('fr-dialog')?.open || document.getElementById('eng-dialog')?.open || setDialog()?.open || helpDialog()?.open) return; // a dialog has the keys
    if (e.key === 'Escape' && closeQuickMore(true)) { e.preventDefault(); return; }
    if (e.key === 'Escape' && menuAt) { closeMenu(); return; }
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.ctrlKey || e.metaKey) { // undo / redo (in a text box, the box's own undo); a new panel; copy the selection
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(); return; }
        if (k === 'n' && e.altKey) { e.preventDefault(); document.querySelector('.ws-bar [data-act=new]')?.click(); return; }
        if (k === 'd' && cur() && selectionKey(e, 'copy')) return;
        return;
    }
    if (e.key === '?' && !e.altKey) { e.preventDefault(); openHelp(); return; }
    if (sketchPan && prefs.view === 'sketch') return;
    if (!cur()) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectionKey(e, 'delete')) return;
    if ((e.key === 'm' || e.key === 'M') && !e.altKey && selectionKey(e, 'mirror')) return;
    if (tool === 'perimeter' && peri) { perimeterKey(e); return; }
    if (e.key === 'Escape') { if (tool !== 'select') setTool('select'); else if (sel != null) { sel = null; ask = null; renderCatalogue(); renderChips(); renderSketch(); } else if (selection.kind !== 'none') selectTarget(W.NONE); return; }
    if (selection.kind === 'member' && prefs.view === 'elevation' && /^Arrow/.test(e.key)) {
        e.preventDefault();
        const d = e.shiftKey ? 1 : manualStep();
        manualNudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0);
        return;
    }
    if (sel == null || !/^Arrow/.test(e.key)) return;
    const p = cur(), o = p.openings[sel], L = G.shapeTop(p.shape).lengthIn, step = e.shiftKey ? 6 : 0.5;
    if (!o) return;
    if (!G.canEdit(p, `openings.${sel}.leftIn`)) { e.preventDefault(); lockedNotice('the model\'s openings'); return; }
    e.preventDefault();
    if (e.key === 'ArrowLeft') o.leftIn = Math.max(0, o.leftIn - step);
    if (e.key === 'ArrowRight') o.leftIn = Math.min(L - o.widthIn, o.leftIn + step);
    if (o.kind !== 'door' && e.key === 'ArrowUp') o.sillIn += step;
    if (o.kind !== 'door' && e.key === 'ArrowDown') o.sillIn = Math.max(3, o.sillIn - step);
    syncCatalogueFields();
    changed();
});

// --- Drawing the perimeter -------------------------------------------------------------------------------------------------
// The next corner under the pointer: on a 1/2" grid, level or plumb from the last corner when nearly so, lined up with
// the corners already placed, on the floor line, or on the first corner (which closes it).
function snapPerimeter([x, y]) {
    const pts = peri.pts, tol = 7 * (view.w / (svgEl.clientWidth || 800)); // about 7 pixels on screen
    let sx = snap(x), sy = snap(y);
    peri.closing = false;
    if (pts.length >= 3 && Math.hypot(x - pts[0][0], y - pts[0][1]) < tol * 1.6) { peri.closing = true; return [...pts[0]]; }
    for (const q of pts) { if (Math.abs(q[0] - x) < tol * 0.6) sx = q[0]; if (Math.abs(q[1] - y) < tol * 0.6) sy = q[1]; } // lined up with a corner (about 4 px)
    if (Math.abs(y) < tol) sy = 0;
    const last = pts[pts.length - 1];
    if (last) {
        const dx = sx - last[0], dy = sy - last[1];
        if (Math.abs(dy) < Math.abs(dx) * Math.tan((7 * Math.PI) / 180)) sy = last[1];
        else if (Math.abs(dx) < Math.abs(dy) * Math.tan((7 * Math.PI) / 180)) sx = last[0];
    }
    return [sx, sy];
}
function addPerimeterCorner(at = peri.cursor) {
    if (!at) return;
    if (peri.closing && peri.pts.length >= 3) { finishPerimeter(); return; }
    if(!SK.pointInPanel(cur(),at))return;
    const last = peri.pts[peri.pts.length - 1];
    if (last && Math.abs(last[0] - at[0]) < 1e-6 && Math.abs(last[1] - at[1]) < 1e-6) return;
    peri.pts.push([...at]);
    peri.typed = '';
    renderSketch(); renderHint();
}
function perimeterKey(e) {
    if (e.key === 'Escape') { setTool('select'); return; }
    if (e.key === 'Enter') {
        e.preventDefault();
        const n = parseDimension(peri.typed), last = peri.pts[peri.pts.length - 1];
        if (peri.typed && n != null && n > 0 && last) { // that far from the last corner, toward the pointer (level or plumb when nearly so)
            const c = peri.cursor || [last[0] + 1, last[1]], dx = c[0] - last[0], dy = c[1] - last[1], d = Math.hypot(dx, dy) || 1;
            const along = Math.abs(dy) < 1e-6 ? [Math.sign(dx) || 1, 0] : Math.abs(dx) < 1e-6 ? [0, Math.sign(dy)] : [dx / d, dy / d];
            peri.closing = false;
            addPerimeterCorner([round16(last[0] + along[0] * n), round16(last[1] + along[1] * n)]);
        } else if (!peri.typed && peri.pts.length >= 4) finishPerimeter();
        return;
    }
    if (e.key === 'Backspace') { e.preventDefault(); if (peri.typed) peri.typed = peri.typed.slice(0, -1); else peri.pts.pop(); renderSketch(); renderHint(); return; }
    if (e.key.length === 1 && /[0-9'"\-/ .]/.test(e.key)) { e.preventDefault(); peri.typed += e.key; renderSketch(); }
}
// The perimeter as the panel: its shape, its notches as doors and steel penetrations; windows and MEP openings that still
// fit are kept.
function finishPerimeter() {
    if (!G.canEdit(cur(), 'shape')) { setTool('select'); lockedNotice('its perimeter'); return; }
    const res = G.perimeterToPanel(peri?.pts || []);
    if (res.errors.length) { notice(`${res.errors[0]} (Undo a corner, or Esc to start over.)`, true); return; }
    const p = cur(), L = res.shape.lengthIn,points=peri.pts,minX=Math.min(...points.map(q=>q[0])),minY=Math.min(...points.map(q=>q[1])),pins=[];
    for(const i of peri.locks||[]){const a=points[i]?.map((v,j)=>v-(j?minY:minX)),b=points[i+1]?.map((v,j)=>v-(j?minY:minX));if(!a||!b)continue;const near=(a,b)=>Math.abs(a-b)<1/16;
        if(near(a[0],0)&&near(b[0],0))pins.push('left');else if(near(a[0],L)&&near(b[0],L))pins.push('right');
        else if(near(a[1],baseAt(G.shapeBottom(res.shape),a[0]))&&near(b[1],baseAt(G.shapeBottom(res.shape),b[0])))pins.push('bottom');
        else if(G.shapePoints(res.shape).length===2)pins.push('top');
    }
    const kept = p.openings.filter(o => (o.kind === 'window' || o.kind === 'mep') && o.leftIn + o.widthIn <= L);
    p.shape = res.shape;
    p.sketchPins=[...new Set(pins)];
    p.openings = [...kept, ...res.openings].sort((a, b) => a.leftIn - b.leftIn);
    setTool('select', false);
    sel = null; ask = null;
    renderAll(); save();
    const { lengthIn, heightIn } = G.shapeTop(p.shape);
    notice(`Perimeter in: ${editDimension(lengthIn)} x ${editDimension(heightIn)} ${G.SHAPES.find(k => k.kind === p.shape.kind).name.toLowerCase()}${res.openings.length ? `, with ${G.openingsSummary(res.openings)} from its notches` : ''}. Click an opening to pick its members.`);
}

// --- Right-click on the sketch: what can be done with what is under the pointer --------------------------------------
// An opening: its members, kind, jambs on the layout, center, copy, remove. A stud: its type, start the layout there. The
// top: the top track, a control point to drag. The bottom: the bottom track. An end: start the layout from it. A point:
// remove it. Empty panel: add an opening there. Always (shortcuts, all also in the inspector): the elevation, the optimizer, stud facing, layout end.
let menuAt = null;
function closeMenu() {
    const box = document.getElementById('sk-menu');
    menuAt = null;
    if (box && !box.hidden) { box.hidden = true; box.innerHTML = ''; }
}
document.addEventListener('pointerdown', (e) => { if (menuAt && !e.target.closest('#sk-menu')) closeMenu(); }, true);
window.addEventListener('resize', closeMenu);
window.addEventListener('scroll', closeMenu, { passive: true });
function openMenu(e) {
    e.preventDefault();
    if (tool !== 'select' || drag) return;
    const p = cur(), [x, y] = wallPoint(e), el = e.target.closest('[data-drag],[data-hover]'), key = el ? el.dataset.drag || el.dataset.hover : '';
    const { lengthIn: L, heightIn: H, top } = G.shapeTop(p.shape), at = (v) => topAt(top, v, H), shapeFree = G.canEdit(p, 'shape');
    const head = (title, sub = '') => `<div class="mi-head"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
    const btn = (label, act, data = {}, { off = false, title = '', cls = '' } = {}) => `<button class="mi ${cls}" role="menuitem" data-act="${act}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}${off ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;
    const pick = (c, label = c.label) => `<label class="mi-pick"><span>${esc(label)}</span><select data-pick="${esc(c.path)}" aria-label="${esc(label)}">${optionTags(c.path, c.value, c.options)}</select></label>`;
    const check = (label, path, on, note = '') => `<label class="mi-check"><input type="checkbox" data-f="${esc(path)}" ${on ? 'checked' : ''}><span>${esc(label)}</span>${note ? `<small>${esc(note)}</small>` : ''}</label>`;
    const choose = (i) => { if (sel !== i) { sel = i; ask = null; renderCatalogue(); renderChips(); renderSketch(); } };
    const endMenu = (side) => out.push(head(`The ${side} end`, `${editDimension(at(side === 'left' ? 0 : L))} high · end stud ${studName(p.members)}`),
        btn(`Start the stud layout from the ${side} end`, 'layout-from', { side }, { off: !!p.layoutFromRight === (side === 'right'), title: side === 'right' ? 'The layout and its offsets from this end (stud facing unchanged)' : 'The layout from the left end, as usual' }));
    const out = [];
    const opening = /^op:(\d+)$/.exec(key), mem = /^mem:(\d+)$/.exec(key), edge = /^edge:(\d+)$/.exec(key), pt = /^pt:(\d+)$/.exec(key), end = /^pg:(l|r|tl|tr|bl|br)$/.exec(key), clip = /^clip:(\d+)$/.exec(key);
    if (opening && p.openings[Number(opening[1])]) {
        const i = Number(opening[1]), o = p.openings[i], locked = G.isLockedOpening(p, o), type = G.OPENING_TYPES[o.kind];
        choose(i);
        out.push(head(`${G.openingName(p.openings, i)} · ${type.name}`, `${o.kind === 'steel' ? `${editDimension(o.widthIn)} wide, through the top` : `${editDimension(o.widthIn)} x ${editDimension(o.heightIn)}`} · ${editDimension(o.leftIn)} from the left end${locked ? ' · 🔒 the model\'s' : ''}`));
        out.push(btn('⚙ Framing details… (jambs, header, rough opening)', 'framing', { i }));
        out.push(...type.members.map(k => pick(openingChoice(i, k), G.MEMBER_LABELS[k])));
        out.push(`<label class="mi-pick"><span>Kind</span><select data-f="openings.${i}.kind" aria-label="Kind of opening"${locked ? ' disabled' : ''}>${Object.entries(G.OPENING_TYPES).map(([k, t]) => `<option value="${k}" ${k === o.kind ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>`);
        out.push(check('Jambs on the stud layout', `openings.${i}.toLayout`, o.toLayout, toLayoutNote(p, i)));
        out.push('<hr>', btn('Center it', 'center', { i }, { off: locked }), btn('⇆ Mirror it across the panel', 'mirror-op', { i }, { off: locked, title: 'The same distance from the other end' }),
            btn('Copy it', 'copy-op', { i }), btn('Remove it', 'del-op', { i }, { off: locked, cls: 'danger' }));
    } else if (mem && laid.lay?.members[Number(mem[1])]) {
        const m = laid.lay.members[Number(mem[1])], cx = m.x + m.w / 2, j = jambOf(p, m);
        out.push(head(`${ROLE_NAMES[m.role] || m.role}${j != null ? ` of ${G.openingName(p.openings, j)}` : ''}`, `${m.type} · ${editDimension(m.lengthIn)} long · center ${editDimension(cx)} from the left end, ${editDimension(L - cx)} from the right`));
        if (j != null) choose(j);
        out.push(j != null ? pick(openingChoice(j, 'jamb'), 'Jambs') : pick(coreChoice('stud'), m.role === 'stud' ? 'Studs' : 'Stud type'));
        if (m.role !== 'end stud') out.push(btn('Start the stud layout here', 'layout-here', { x: cx }, { title: 'This stud\'s line becomes a layout line: the first stud is set by hand from it (the optimizer gives way)' }));
        const flipped = (p.studFlips || []).some(c => Math.abs(c - cx) < 0.5);
        out.push(btn(flipped ? '⟲ Flip this stud back' : '⟲ Flip this stud', 'stud-flip', { x: round16(cx) }, { title: 'Just this stud faces the other way' }),
            btn(`◫ Add a clip on it here (${editDimension(y)} up)`, 'clip-here', { x: round16(cx), y: round16(y) }));
    } else if (edge) {
        const outline = [[0, 0], [L, 0], ...(top ? [...top].reverse() : [[L, H], [0, H]])], n = Number(edge[1]), [x1, y1] = outline[n], [x2, y2] = outline[(n + 1) % outline.length];
        if (y1 === 0 && y2 === 0) out.push(head('Bottom track', `${editDimension(L)} long`), pick(coreChoice('track'), 'Type'));
        else if (Math.abs(x1 - x2) < 1e-6) endMenu(x1 < L / 2 ? 'left' : 'right');
        else {
            const cx = round16(snap(Math.min(L - 3, Math.max(3, x))));
            out.push(head('Top track', `${editDimension(Math.hypot(x2 - x1, y2 - y1))} along here`), pick(coreChoice('topTrack'), 'Type'),
                btn(`Add a control point here (${editDimension(cx)})`, 'add-ctrl', { x: cx }, { off: !shapeFree, title: shapeFree ? 'A point on the top here, to drag up or down (the top becomes a drawn one)' : 'Locked: the Revit model\'s perimeter' }));
        }
    } else if (end) endMenu(/^(l|tl|bl)$/.test(end[1]) ? 'left' : 'right');
    else if (pt && p.shape.points?.[Number(pt[1])]) {
        const k = Number(pt[1]), q = p.shape.points[k];
        out.push(head(`Point ${k + 1} on the top`, `${editDimension(q[0])} from the left end · ${editDimension(q[1])} high`), btn('Remove this point', 'del-point', { i: k }, { off: !shapeFree }));
    } else if (clip && p.clips?.[Number(clip[1])]) {
        const i = Number(clip[1]), c = p.clips[i], at2 = laid.lay ? G.placeClips(laid.lay, p.clips).clips.find(k => k.i === i) : null;
        out.push(head(`${at2?.mark || 'Clip'} · ${c.type}`, `${editDimension(c.y)} up${at2?.stud ? `, on ${at2.stud}` : ''} (on the stud's web)`),
            `<label class="mi-pick"><span>Type</span><select data-f="clips.${i}.type" aria-label="Clip type">${[...new Set([c.type, ...G.CLIP_TYPES, ...(recent.clip || [])])].map(v => `<option ${v === c.type ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`,
            btn('Remove this clip', 'clip-del', { i }, { cls: 'danger' }));
    } else if (key === 'peak') {
        out.push(head('The peak', `${editDimension(p.shape.peakIn)} high, ${editDimension(p.shape.peakAtIn ?? L / 2)} from the left end`), btn('Make the top a drawn one (points to drag)', 'shape', { kind: 'custom' }, { off: !shapeFree }));
    } else if (x > 0 && x < L && y >= 0 && y < at(x)) {
        out.push(head('Add an opening here', `${editDimension(x)} from the left end${y > 1 ? ` · ${editDimension(y)} up` : ''}`),
            `<div class="mi-row">${Object.entries(G.OPENING_TYPES).map(([k, t]) => btn(`+ ${t.name}`, 'add-op-at', { kind: k, x: round16(x), y: round16(y) }, { cls: `mi-add ${k}` })).join('')}</div>`,
            btn(`◫ Add a ${clipType.toLowerCase()} on the nearest stud`, 'clip-here', { x: round16(x), y: round16(y) }));
    }
    // Shortcuts only: every one of these is also in the inspector (Stud layout and facing) or over the views (side).
    out.push(out.length ? '<hr>' : '', btn('Show the framing elevation', 'preview', {}, { title: 'The Elevation view: the framing with its tags and dimensions' }),
        check('Opening optimizer', 'optimizeOpenings', p.optimizeOpenings, p.layoutStartIn > 0 ? 'first stud set by hand' : ''),
        check('Flip every stud', 'flipStuds', p.flipStuds, 'stud facing: physical'),
        check('Layout from the right end', 'layoutFromRight', p.layoutFromRight, 'where the studs on center start'),
        p.layoutStartIn > 0 ? btn(`Clear the first stud set by hand (${inch(p.layoutStartIn)})`, 'layout-reset') : '');
    const box = document.getElementById('sk-menu');
    box.innerHTML = out.join('');
    box.hidden = false;
    menuAt = { x, y, key };
    const r = box.getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(e.clientX, innerWidth - r.width - 8))}px`;
    box.style.top = `${Math.max(8, Math.min(e.clientY, innerHeight - r.height - 8))}px`;
}
// The opening a jamb stud frames (its index), from the openings as framed (out to the stud layout, too).
function jambOf(p, m) {
    if (m.role !== 'jamb stud') return null;
    let boxes = [];
    try { boxes = G.frameInputs(p).openings; } catch { return null; }
    const j = boxes.findIndex(b => (Math.abs(m.x + m.w - b.left) < 2 || Math.abs(m.x - b.right) < 2) && m.y < b.top + 2 && m.y + m.h > b.bottom - 2);
    return j < 0 ? null : j;
}
// "Start the stud layout here": this stud's line a layout line; the first stud set by hand from it (the optimizer gives way).
function setLayoutStart(p, x) {
    const L = G.shapeTop(p.shape).lengthIn, sp = Number(p.members.spacingIn) || 16, d = p.layoutFromRight ? L - x : x;
    let st = round16(((d % sp) + sp) % sp);
    if (st < 1 / 16) st = sp;
    p.layoutStartIn = st;
    syncToggles(); changed();
    notice(`First stud set by hand: ${inch(st)} from the ${p.layoutFromRight ? 'right' : 'left'} end, then ${sp}" o.c. through this stud${p.optimizeOpenings ? ' (the optimizer gives way)' : ''}. Right-click the sketch to clear it.`);
}
// "Add a control point here" on the top: the top becomes a drawn one (the same line), with a point here to drag.
function addControlPoint(p, x) {
    if (!G.canEdit(p, 'shape')) { lockedNotice('its top'); return; }
    if(SK.pinned(p,'top')){notice('Unlock the top line before changing its points.',true);return;}
    const { lengthIn: L, heightIn: H, top } = G.shapeTop(p.shape);
    if (!(x >= 3 && x <= L - 3) || !addPointAt(p,[x,topAt(top,x,H)],true)) { notice('A point needs to be at least 3" from the ends and the other points.', true); return; }
    renderElevHead(); renderShapeTable(); renderHint(); changed();
    notice(`Point added on the top at ${editDimension(x)}: drag it up or down (double-click or right-click it to remove it).`);
}
// "+ Door" (and the rest) from the menu: the new opening centered where the menu was opened (a window or MEP opening
// at that height too).
function addOpeningAt(p, kind, x, y) {
    const { lengthIn: L, heightIn: H } = G.shapeTop(p.shape);
    addOpening(p, kind);
    const o = p.openings[p.openings.length - 1];
    o.leftIn = Math.min(Math.max(0, L - o.widthIn), Math.max(0, snap(x - o.widthIn / 2)));
    if (kind === 'window' || kind === 'mep') o.sillIn = Math.min(Math.max(3, H - o.heightIn - 12), Math.max(3, snap(y - o.heightIn / 2)));
    renderCatalogue(); renderChips(); changed();
}
// A copy of an opening beside it (never locked: an opening added here), its members as the original's.
function copyOpening(p, i) {
    const { locked, ...o } = structuredClone(p.openings[i]), L = G.shapeTop(p.shape).lengthIn, from = G.openingName(p.openings, i);
    const free = (left) => p.openings.every(q => left + o.widthIn + 6 <= q.leftIn || left >= q.leftIn + q.widthIn + 6);
    const spots = [];
    for (let s = o.leftIn + o.widthIn + 12; s <= L - o.widthIn - 6; s += 6) spots.push(s);
    for (let s = o.leftIn - o.widthIn - 12; s >= 6; s -= 6) spots.push(s);
    const spot = spots.find(free);
    o.leftIn = round16(spot ?? Math.max(0, Math.min(L - o.widthIn, o.leftIn + 12)));
    p.openings.push(o);
    sel = p.openings.length - 1; ask = null;
    renderCatalogue(); renderChips(); changed();
    notice(spot == null ? `${G.openingName(p.openings, sel)} is a copy of ${from}, but there is no free room beside it on this panel: move it, or remove it.` : `${G.openingName(p.openings, sel)} is a copy of ${from}, with its members: drag it into place.`, spot == null);
}

// --- Clips -------------------------------------------------------------------------------------------------------------
let clipType = load(KEYS.recent, {}).clip?.[0] || G.CLIP_TYPES[0], clipAt = 48;
// Clips align to the first one placed (or a typed height): near that line a new clip snaps to it; Alt places it freely.
const clipAlign = { on: true, y: null };
let clipAim = null; // { x, y, aligned }: where the next clip goes (the clip tool)
const clipAlignY = (p) => (clipAlign.y != null ? clipAlign.y : p?.clips?.length ? p.clips[0].y : null);
function clipAimAt(p, q, free = false) {
    const ay = clipAlignY(p), tol = (view.w / (svgEl?.clientWidth || 800)) * 24; // about 24 pixels on screen
    if (!free && clipAlign.on && ay != null && Math.abs(q[1] - ay) <= tol) return { y: ay, aligned: true };
    return { y: round16(q[1]), aligned: false };
}
main.addEventListener('change', (e) => {
    if (e.target.id === 'clip-align-on') { clipAlign.on = e.target.checked; renderSketch(); }
    if (e.target.id === 'clip-align-at') { const v = parseDimension(e.target.value); clipAlign.y = e.target.value.trim() === '' ? null : v; renderHint(); renderSketch(); }
});
main.addEventListener('change', (e) => { if (e.target.id === 'clip-type') { clipType = e.target.value.trim() || G.CLIP_TYPES[0]; recent.clip = G.remember(recent.clip, clipType); store(KEYS.recent, recent); renderDatalists(); } });
// New clips: only those that land on a stud and not on one already there.
function addClips(p, list) {
    if (!laid.lay) { notice('Fix the panel\'s inputs first: clips go on its studs.', true); return; }
    const before = (p.clips || []).length, all = [...(p.clips || []), ...list], placed = G.placeClips(laid.lay, all).clips.filter(c => c.i >= before);
    if (!placed.length) { notice(list.length === 1 ? 'No stud there to clip (or that stud has a clip at that height already).' : 'Every stud there has a clip at that height already.', true); return; }
    p.clips = [...(p.clips || []), ...placed.map(c => all[c.i])];
    renderHint(); changed();
    notice(`${placed.length} ${placed[0].type.toLowerCase()}${placed.length === 1 ? '' : 's'} added, on ${placed.length === 1 ? 'the stud\'s web' : 'the studs\' webs'}.`);
}
function removeClip(p, i) {
    if (!p.clips?.[i]) return;
    const [c] = p.clips.splice(i, 1);
    hover = null; renderHint(); changed();
    notice(`${c.type} at ${editDimension(c.y)} removed.`);
}

// --- Framing details: an opening's jambs, header, sill and rough opening, with a live preview -------------------------
const roText = (p, i) => { const o = p.openings[i], r = G.roughOpening(o, G.shapeTop(p.shape).heightIn); return o.kind === 'steel' ? `${editDimension(r.right - r.left)} wide` : `${editDimension(r.right - r.left)} x ${editDimension(r.top - r.bottom)}`; };
function framingSummary(p, i) {
    const fr = G.openingFraming(p, p.openings[i]);
    return [fr.plies > 1 ? `${fr.plies} jamb studs each side, ${G.JAMB_STYLES[fr.jambStyle].toLowerCase()}` : '1 jamb stud each side',
        fr.head ? (fr.head.depthIn ? `${inch(fr.head.depthIn)} ${fr.head.style === 'back' ? 'back-to-back' : 'box'} header` : 'track header') + (fr.bearing === 'jacks' ? ' on jack studs' : '') : '',
        fr.crippleEnds ? 'cripples at the ends' : ''].filter(Boolean).join(' · ');
}
// The dialog's state: { i, draft (the opening being edited), custom (members showing the detailed editor), work (the
// profile each custom editor is building), saveAs (a name being typed per member), spread (use for every opening of this
// kind in the panel), more (extra options open) }.
let fd = null;
const frDialog = () => document.getElementById('fr-dialog');
// draft: start from this version of the opening (Back to the defaults) instead of the panel's.
function openFraming(i, draft = null) {
    const p = cur(), o = p.openings[i];
    if (!o) return;
    fd = { i, draft: draft || structuredClone(o), custom: new Set(), work: {}, saveAs: {}, spread: false, more: !!(o.toLayout || o.crippleEnds) };
    if (sel !== i) { sel = i; ask = null; renderCatalogue(); renderChips(); renderSketch(); }
    renderFraming();
    if (!frDialog().open) frDialog().showModal();
}
const draftPanel = () => { const p = cur(); return { ...p, openings: p.openings.map((o, j) => (j === fd.i ? fd.draft : o)) }; };
const FD_LABELS = { jamb: 'Jambs', head: 'Header', sill: 'Sill' };
// A member's choices: the panel's default, the standard profiles, those saved in this browser.
const profileChoices = (kind) => [...P.PRESETS[kind].map((p, n) => ({ id: `b${n}`, p, saved: false })), ...profiles[kind].map((p, n) => ({ id: `s${n}`, p, saved: true }))];
// The profile an opening's member is framed with: 'default' (the panel's), a choice's id, or 'custom'.
function profileChoiceOf(panel, o, kind) {
    if (!o[kind]) return 'default';
    const now = P.profileOfOpening(panel, o, kind);
    return (now && profileChoices(kind).find(c => P.sameFraming(kind, c.p, now, panel.members))?.id) || 'custom';
}
const choiceNow = (kind) => (fd.custom.has(kind) ? 'custom' : profileChoiceOf(draftPanel(), fd.draft, kind));
// A member drawn small, as cut: the jamb studs in plan (the opening to the right), a header or sill across the wall.
function profileGlyph(kind, prof) {
    const C = (x, y, w, h, open) => { const [a, b] = open === 'r' ? [x + w, x] : open === 'l' ? [x, x + w] : [x, x];
        return open === 'u' ? `<path d="M${x} ${y}V${y + h}H${x + w}V${y}"/>` : open === 'd' ? `<path d="M${x} ${y + h}V${y}H${x + w}V${y + h}"/>`
            : `<path d="M${a} ${y}H${b}V${y + h}H${a}"/>`; };
    let body = '';
    if (!prof) body = '<text x="24" y="21" text-anchor="middle">?</text>';
    else if (kind === 'jamb') {
        const n = prof.plies, w = 7, gap = 1.5, x0 = 24 - (n * w + (n - 1) * gap) / 2;
        for (let q = 0; q < n; q++) {
            const open = n === 1 || prof.style === 'same' ? 'l' : prof.style === 'back' ? (q % 2 ? 'r' : 'l') : (q % 2 ? 'l' : 'r');
            body += C(x0 + q * (w + gap), 6, w, 22, open);
        }
        body += '<line x1="44" y1="3" x2="44" y2="31" class="g-op"/>';
    } else if (prof.made === 'track') {
        for (let q = 0; q < prof.tracks; q++) body += C(10 + q * 1.5, 22 - q * 1.5, 28 - q * 3, 8, 'u');
    } else {
        const top = prof.tracks > 1, bottom = prof.tracks > 0;
        if (bottom) body += C(10, 25, 28, 5, 'u');
        if (top) body += C(10, 4, 28, 5, 'd');
        body += prof.made === 'back' ? C(17, 9, 7, 16, 'l') + C(24, 9, 7, 16, 'r') : C(11, 9, 7, 16, 'r') + C(30, 9, 7, 16, 'l');
    }
    return `<svg class="fd-glyph" viewBox="0 0 48 34" aria-hidden="true">${body}</svg>`;
}
// A member's row: its glyph, the profile list, what it comes to; the detailed editor only when Custom is picked.
function profileRow(kind) {
    const p = cur(), d = fd.draft, panel = draftPanel(), now = choiceNow(kind), choices = profileChoices(kind);
    const shown = now === 'default' ? P.profileOfOpening(panel, { ...d, [kind]: '' }, kind) : now === 'custom' ? fd.work[kind] || P.profileOfOpening(panel, d, kind) : choices.find(c => c.id === now).p;
    const dflt = G.memberFor(panel, { ...d, [kind]: '' }, kind).spec;
    const opt = (c) => `<option value="${c.id}" ${c.id === now ? 'selected' : ''}>${esc(c.p.name)}</option>`;
    const saved = choices.filter(c => c.saved);
    const desc = shown ? P.describeProfile(kind, shown, p.members) : G.specText(G.memberFor(panel, d, kind).spec) || G.memberFor(panel, d, kind).spec;
    return `<div class="fd-prof" data-kind="${kind}">${profileGlyph(kind, shown)}
        <div class="fd-prof-main"><label><span>${FD_LABELS[kind]}${kind === 'sill' && d.kind === 'steel' ? ' (under the steel)' : ''}</span>
            <select data-fd="profile" data-k="${kind}" aria-label="${FD_LABELS[kind]} profile">
                <option value="default" ${now === 'default' ? 'selected' : ''}>Panel default (${esc(dflt)})</option>
                <optgroup label="Standard">${choices.filter(c => !c.saved).map(opt).join('')}</optgroup>
                ${saved.length ? `<optgroup label="Saved in this browser">${saved.map(opt).join('')}</optgroup>` : ''}
                <option value="custom" ${now === 'custom' ? 'selected' : ''}>Custom…</option></select></label>
            <small>${esc(desc)}${arrangementOpen(panel, d, kind) ? ' <b class="arr-open">· arrangement not chosen</b>' : ''}</small>
            ${/^s\d+$/.test(now) ? `<button type="button" class="link small" data-fd="delete-profile" data-k="${kind}" data-v="${now.slice(1)}">Delete this saved profile</button>` : ''}
        </div></div>${now === 'custom' ? customEditor(kind) : ''}`;
}
// Built-up parts (2 or more studs) whose arrangement the opening does not give: the plan leaves them unplaced.
function arrangementOpen(panel, o, kind) {
    const n = G.specParts(G.memberFor(panel, o, kind).spec).studQty;
    return (kind === 'jamb' ? n > 1 : n > 0) && !o[`${kind}Style`];
}
// The detailed editor for one member (a profile being built), and Save as a profile.
function customEditor(kind) {
    const p = cur(), wall = G.parseMember(p.members.stud), sameDepth = (n) => Math.abs((G.parseMember(n)?.depthIn ?? -1) - (wall?.depthIn ?? -2)) < 1e-6;
    const w = fd.work[kind] || (fd.work[kind] = P.profileOfOpening(draftPanel(), fd.draft, kind) || { ...P.PRESETS[kind][0], name: '' });
    const seg = (key, value, opts) => `<div class="seg fd-seg">${opts.map(([v, label, off]) => `<button type="button" class="${String(v) === String(value) ? 'on' : 'secondary'}" data-fd="${key}" data-k="${kind}" data-v="${v}"${off ? ' disabled' : ''}>${label}</button>`).join('')}</div>`;
    const sizes = (key, value, list, wallLabel, wallValue) => `<select data-fd="${key}" data-k="${kind}"><option value="${wallValue}" ${value === wallValue ? 'selected' : ''}>${esc(wallLabel)}</option>${[...new Set([value, ...list])].filter(v => v && v !== wallValue).map(v => `<option ${v === value ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    const studLabel = `the wall's stud (${studName(p.members)})`, trackLabel = `the wall's track (${bottomTrack(p.members)})`;
    const tracks = G.memberChoices(p.members).track.filter(sameDepth);
    let rows;
    if (kind === 'jamb') rows = `<div class="fd-line"><span>Studs each side</span>${seg('w-plies', w.plies, [[1, '1'], [2, '2'], [3, '3']])}${sizes('w-stud', w.stud, G.STUDS.filter(sameDepth), studLabel, '=stud')}</div>
        ${w.plies > 1 ? `<div class="fd-line"><span>Arranged</span>${seg('w-style', w.style, Object.entries(G.JAMB_STYLES).map(([v, l]) => [v, l.split(' (')[0]]))}</div>` : ''}`;
    else rows = `<div class="fd-line"><span>Made of</span>${seg('w-made', w.made, [['track', 'Track'], ['box', 'Box'], ['back', 'Back to back']])}</div>
        ${w.made === 'track' ? `<div class="fd-line"><span>Track</span>${seg('w-tracks', w.tracks, [[1, '1'], [2, '2 nested']])}${sizes('w-track', w.track, tracks, trackLabel, '=track')}</div>`
            : `<div class="fd-line"><span>Studs</span>${seg('w-studs', w.studs, [[1, '1'], [2, '2']])}${sizes('w-stud', w.stud, G.STUDS, studLabel, '=stud')}</div>
               <div class="fd-line"><span>Tracks</span>${seg('w-tracks', w.tracks, [[0, 'none'], [1, '1'], [2, '2']])}${w.tracks ? sizes('w-track', w.track, tracks, trackLabel, '=track') : ''}</div>`}
        ${kind === 'head' ? `<div class="fd-line"><span></span><label class="fd-check"><input type="checkbox" data-fd="w-jacks" data-k="head" ${w.bearing === 'jacks' ? 'checked' : ''} ${G.specParts(G.memberFor(draftPanel(), fd.draft, 'jamb').spec).studQty < 2 ? 'disabled title="Needs 2 or more jamb studs each side"' : ''}> On jack studs</label></div>` : ''}`;
    return `<div class="fd-custom" data-kind="${kind}">${rows}
        <div class="fd-line fd-save"><span></span><input type="text" class="mini" data-fd="save-name" data-k="${kind}" placeholder="Name, e.g. ${kind === 'jamb' ? 'Double 362 boxed' : 'Box 600 on jacks'}" value="${esc(fd.saveAs[kind] || '')}" maxlength="60">
            <button type="button" class="secondary" data-fd="save-profile" data-k="${kind}">Save as a profile</button></div></div>`;
}
function renderFraming() {
    const p = cur(), d = fd.draft, kind = d.kind, type = G.OPENING_TYPES[kind], name = G.openingName(p.openings, fd.i), panel = draftPanel();
    const fr = G.openingFraming(panel, d), off = G.offsetOf(d), same = p.openings.filter((o, j) => j !== fd.i && o.kind === kind && !G.isSmallPenetration(p, o)).length;
    const pv = framingPreview(panel), views = detailViews(kind);
    if (!views.includes(fd.view)) fd.view = views.includes('head') ? 'head' : 'opening';
    frDialog().innerHTML = `<form method="dialog" class="fd fd-simple">
        <div class="fd-head"><b class="op-name ${kind}">${name}</b><span>${esc(type.name)} · ${esc(kind === 'steel' ? `${editDimension(d.widthIn)} wide` : `${editDimension(d.widthIn)} x ${editDimension(d.heightIn)}`)}${G.isLockedOpening(p, d) ? ' · 🔒 the model\'s (its framing can change)' : ''}</span>
            <span class="spacer"></span><button type="button" class="link" data-fd="cancel" aria-label="Close">✕</button></div>
        <div class="fd-body"><div class="fd-controls">
            ${profileRow('jamb')}
            ${type.members.includes('head') ? profileRow('head') : ''}
            ${type.members.includes('sill') ? profileRow('sill') : ''}
            <div class="fd-ro-line">Rough opening <b>${esc(kind === 'steel' ? `${editDimension(fr.ro.right - fr.ro.left)} wide` : `${editDimension(fr.ro.right - fr.ro.left)} x ${editDimension(fr.ro.top - fr.ro.bottom)}`)}</b>
                <label>offset <input type="text" class="mini" data-fd="offset" value="${esc(inch(off))}" aria-label="Framing offset"></label>
                ${d.offsetIn != null && d.offsetIn !== '' ? `<button type="button" class="link small" data-fd="offsetReset">${esc(inch(G.FRAMING_OFFSETS[kind]))} default</button>` : ''}
                <label class="fd-check fd-vary" title="Equal on every side unless unlocked"><input type="checkbox" data-fd="offsetsVary" ${d.offsets ? 'checked' : ''}> ${d.offsets ? '🔓' : '🔒'} Vary by side</label>
                ${d.offsets ? `<span class="fd-sides">${offsetSides(d).map(([k, label]) => `<label>${label} <input type="text" class="mini" data-fd="offsetSide" data-k="${k}" value="${esc(fine(G.offsetsOf(d)[k]))}" aria-label="Framing offset, ${label.toLowerCase()}"></label>`).join('')}</span>` : ''}</div>
            <details class="fd-more" ${fd.more ? 'open' : ''}><summary>More options</summary>
                <label class="fd-check"><input type="checkbox" data-fd="toLayout" ${d.toLayout ? 'checked' : ''}> <span>Jambs on the stud layout (the nearest studs on center are the jambs)<br><small class="muted">${esc(toLayoutNote(panel, fd.i))}</small></span></label>
                <label class="fd-check"><input type="checkbox" data-fd="crippleEnds" ${d.crippleEnds ? 'checked' : ''}> A cripple at each end of the header and sill, against the jambs</label>
            </details>
        </div>
        <div class="fd-preview"><div class="fd-tabs" role="tablist" aria-label="Drawings of this opening">${views.map(v => `<button type="button" role="tab" id="fdt-${v}" aria-selected="${v === fd.view}" class="${v === fd.view ? 'on' : ''}" data-fd="view" data-v="${v}">${DT_VIEWS[v]}</button>`).join('')}</div>
            ${fd.view === 'opening' ? `<div class="fd-svg" role="tabpanel" aria-labelledby="fdt-opening">${pv.svg}</div>
            <div class="fd-legend"><span class="lg-jamb">Jambs</span>${type.members.includes('head') ? '<span class="lg-head">Header</span>' : ''}${type.members.includes('sill') ? '<span class="lg-sill">Sill</span>' : ''}<span class="lg-ro">Rough opening</span></div>`
                : `<div class="fd-detail" role="tabpanel" aria-labelledby="fdt-${fd.view}">${pv.errors.length ? '' : detailPane(panel, fd.view)}</div>`}
            ${pv.errors.length ? `<ul class="errors">${pv.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</div></div>
        <div class="fd-foot"><button type="button" class="link" data-fd="reset">Back to the defaults</button><span class="spacer"></span>
            ${same ? `<label class="fd-check"><input type="checkbox" data-fd="spread" ${fd.spread ? 'checked' : ''}> ${same === 1 ? `Also the other ${esc(G.kindWord(kind))} here` : `Also the other ${same} ${esc(G.kindWord(kind))}s here`}</label>` : ''}
            <button type="button" class="secondary" data-fd="cancel">Cancel</button><button type="button" data-fd="apply" ${pv.errors.length ? 'disabled' : ''}>Apply</button></div>
    </form>`;
}
// The opening framed, a bay or two each side, kept plain: studs white, jambs blue, header and sill salmon, tracks
// yellow, the rough opening dashed red.
function framingPreview(panel) {
    const errors = G.panelErrors(panel).filter(e => e.where === `opening-${fd.i}` || e.where === 'members').map(e => e.message);
    if (errors.length) return { errors, svg: '' };
    const inputs = G.frameInputs(panel), lay = frameWall(inputs), ro = inputs.openings[fd.i], L = lay.lengthIn, H = lay.heightIn, sp = inputs.spacingIn;
    if (!ro) return { errors: ['Not framed: check its size and place.'], svg: '' };
    const x0 = Math.max(0, ro.left - sp * 1.3), x1 = Math.min(L, ro.right + sp * 1.3), pad = Math.max(x1 - x0, H) * 0.05;
    const inView = (m) => m.x + m.w > x0 - 0.01 && m.x < x1 + 0.01;
    const fill = (m) => (m.role === 'head track' || m.role === 'sill track' ? '#f4a7a0' : m.orient === 'h' ? '#f2d64b' : m.role === 'jamb stud' ? '#9fc0de' : '#ffffff');
    // Headers and sills over their jambs (the jambs' edges dashed behind them), with their parts' lines (sheet.mjs).
    const headOrSill = (m) => m.role === 'head track' || m.role === 'sill track';
    const seg = (l, cls) => `<line x1="${Math.max(l.x1, x0)}" y1="${-l.y1}" x2="${Math.min(l.x2, x1)}" y2="${-l.y2}" class="${cls}"/>`;
    const rects = [...lay.members.filter(inView)].sort((a, b) => Number(headOrSill(a)) - Number(headOrSill(b))).map(m => { const a = Math.max(m.x, x0), b = Math.min(m.x + m.w, x1);
        return (m.pts && m.orient === 'v' ? `<polygon points="${m.pts.map(([x, y]) => `${x},${-y}`).join(' ')}" fill="${fill(m)}" class="fd-m"/>` : `<rect x="${a}" y="${-(m.y + m.h)}" width="${b - a}" height="${m.h}" fill="${fill(m)}" class="fd-m"><title>${esc(`${m.role}${m.ply ? ` (ply ${m.ply})` : ''}: ${m.type}`)}</title></rect>`)
            + lapLines(m, lay.members).map(l => seg(l, 'fd-hidden')).join('') + partLines(m, lay.openings.find(o => o.key && o.key === m.of)).map(l => seg(l, l.hidden ? 'fd-hidden' : 'fd-part')).join(''); });
    const roTop = ro.through ? H : ro.top;
    const svg = `<svg viewBox="${x0 - pad} ${-H - pad} ${x1 - x0 + 2 * pad} ${H + pad * 2}" role="img" aria-label="The opening's framing">
        <line x1="${x0 - pad}" y1="0" x2="${x1 + pad}" y2="0" class="fd-floor"/>${rects.join('')}
        <rect x="${ro.left}" y="${-roTop}" width="${ro.right - ro.left}" height="${roTop - ro.bottom}" class="fd-ro"/></svg>`;
    return { errors: lay.issues.length ? lay.issues.map(i => i.message).slice(0, 3) : [], svg };
}
// --- The opening's members as a framing engineer details them (details.mjs), from the plan of the draft ---------------
// Section A-A of the header or sill (its parts across the wall to scale), the header's end at its jamb, the jamb studs in
// plan. An arrangement not chosen is not drawn as framing: its options are drawn to pick from.
const DT_VIEWS = { opening: 'Opening', head: 'Header', jamb: 'Jambs', sill: 'Sill' };
const DT_ARRANGE = {
    head: [['box', 'Box', 'webs at the wall faces, toes in'], ['back', 'Back to back', 'webs together, flanges out']],
    sill: [['box', 'Box', 'webs at the wall faces, toes in'], ['back', 'Back to back', 'webs together, flanges out']],
    jamb: [['box', 'Boxed', 'toe to toe'], ['back', 'Back to back', 'webs together'], ['same', 'Same way', 'webs to the opening']],
};
const detailViews = (kind) => { const m = G.OPENING_TYPES[kind].members; return ['opening', ...(m.includes('head') ? ['head'] : []), 'jamb', ...(m.includes('sill') ? ['sill'] : [])]; };
function draftPlan(panel) {
    try { return FP.resolveFramingPlan(FP.snapshotFromPanel(panel, { documentId: set.source?.documentId ?? null }), FP.detailingFromPanel(panel), null, engineeringFor()); } catch { return null; }
}
const partsWords = (sec) => { const s = sec.parts.filter(p => p.stud), t = sec.parts.filter(p => !p.stud);
    return [s.length ? `${s.length} x ${s[0].designator}` : '', t.length ? `${t.length} x ${t[0].designator}` : ''].filter(Boolean).join(' + '); };
const DT_REASONS = { 'nested-track': 'two tracks nested: where the second one sits is not defined here (type the header as one track, or as studs with tracks).',
    'jamb-track-arrangement': 'a jamb with a track around it: how the track sits on the stud is not defined here.' };
function detailPane(panel, view) {
    const key = G.openingKeys(panel)[fd.i], plan = draftPlan(panel);
    if (!plan || !key || !plan.layout) return '<p class="muted">Not framed yet: check the opening\'s size and place.</p>';
    const asm = view === 'jamb' ? `${key}:jamb:L` : `${key}:${view}`, sec = DT.sectionOf(plan, asm), what = FD_LABELS[view].toLowerCase();
    const caveat = '<p class="dt-caveat">Drawn from this framing: sizes from the SSMA names, lips nominal. Screws and connections are the engineer\'s detail: this drawing is not one.</p>';
    if (sec.state === 'none') return `<p class="muted">No ${what} on this opening.</p>`;
    if (sec.state === 'unresolved') {
        if (DT_REASONS[sec.reason] || !DT_ARRANGE[view]) return `<div class="dt-choose"><p><b>Not placed:</b> ${esc(DT_REASONS[sec.reason] || 'the arrangement is not defined here.')}</p></div>${caveat}`;
        const cards = DT_ARRANGE[view].filter(([v]) => view !== 'jamb' || sec.parts.length > 1 || v === 'box').map(([v, label, words]) => {
            const variant = { ...panel, openings: panel.openings.map((o, j) => (j === fd.i ? { ...o, [`${view}Style`]: v } : o)) };
            const s = DT.sectionOf(draftPlan(variant), asm), d = DT.sectionSvg(s, { side: 'L', title: label, keys: false });
            return `<figure class="dt-opt">${d.svg}<figcaption><b>${label}</b> <span class="muted">${esc(words)}</span></figcaption>
                ${s.fit?.ok === false ? `<p class="dt-bad">${esc(s.fit.message)}</p>` : ''}<button type="button" data-fd="arrange" data-k="${view}" data-v="${v}">Use ${esc(label.toLowerCase())}</button></figure>`;
        }).join('');
        return `<div class="dt-choose"><p><b>How do the ${view === 'jamb' ? 'jamb studs' : `${what}'s parts`} go together?</b> ${esc(partsWords(sec))}: not chosen yet, so they are not placed (the views and the PDF say PRELIMINARY).
            The engineer's ${view === 'jamb' ? 'built-up jamb' : `${what} construction`} detail says which.</p><div class="dt-opts">${cards}</div></div>${caveat}`;
    }
    const notes = (list) => (list.length ? `<ol class="dt-notes">${list.map(n => `<li>${esc(n)}</li>`).join('')}</ol>` : '');
    const a = DT.sectionSvg(sec, { side: 'L', title: view === 'jamb' ? 'The jamb studs in plan' : 'Section A-A' });
    const b = view === 'head' ? DT.headerEndSvg(plan, key, 'L') : { svg: '', notes: [] };
    const now = fd.draft[`${view}Style`], others = (DT_ARRANGE[view] || []).filter(([v]) => v !== (now || 'box') && (view !== 'jamb' || sec.parts.length > 1));
    const change = sec.parts.filter(p => p.stud).length > 1 || (view === 'jamb' && sec.parts.length > 1)
        ? `<p class="dt-arr">${now ? 'Arrangement' : 'Arrangement (not chosen: drawn as the default)'}: <b>${esc(sec.arrangement)}</b> ${others.map(([v, label]) => `<button type="button" class="secondary small" data-fd="arrange" data-k="${view}" data-v="${v}">${esc(label)} instead</button>`).join(' ')}</p>` : '';
    return `${sec.fit.ok ? '' : `<p class="dt-bad">${esc(sec.fit.message)}</p>`}${change}
        <div class="dt-pair${b.svg ? '' : ' one'}"><figure class="dt-fig"><figcaption>${view === 'jamb' ? 'Plan at the left jamb' : `Section A-A · ${esc(what)}`}</figcaption>${a.svg}${notes(a.notes)}</figure>
            ${b.svg ? `<figure class="dt-fig"><figcaption>Elevation at the left jamb</figcaption>${b.svg}${notes(b.notes)}</figure>` : ''}</div>${caveat}`;
}
// --- An opening's members by the engineering rule (opening-rules.mjs) ------------------------------------------------
// The rule card: what the lookup reads (the wall, the opening), the schedule it sits in (wall height by width, the cell
// that covers it marked), what that rule gives, and Use. Then one row per member: what is in force and where it came
// from, the rule's alternatives to pick from, the arrangement a built-up member needs, Back to the rule.
const ftIn = (feet) => (feet > 0 ? editDimension(Math.round(feet * 12 * 16) / 16) : '0');
// A member as a schedule writes it: '362S162-54', '(2) 362S162-33 + (2) 362T125-33'.
const memberText = (v) => { const d = G.parseMember(v); return d && d.qty === 1 && G.specParts(v).studQty + G.specParts(v).trackQty <= 1 ? d.name : String(v || '').replace(/\s+WITH\s+/gi, ' + ').replace(/\s+/g, ' ').trim(); };
const giveText = (g) => (!g ? '' : g.text ? memberText(g.text) : g.choices ? g.choices.map(memberText).join(' or ') : g.notApplicable ? 'none' : 'to pick');
function ruleCard(p, i) {
    const o = p.openings[i], r = R.ruleFor(eng, p, i);
    if (!r.applies) {
        const why = r.why === 'kind' ? `The engineering catalog has no rules for ${G.kindWord(o.kind)}s: pick the members below.`
            : 'No engineering catalog open: the members come from the panel\'s defaults, or pick them below.';
        return `<div class="rule-card off"><div class="rule-head"><b>Engineering rule</b></div><p class="muted small">${esc(why)}</p>
            ${r.why === 'no-catalog' ? '<button class="secondary small" data-act="eng-open">Open the engineering catalog…</button>' : ''}</div>`;
    }
    const q = r.query, word = G.kindWord(o.kind), using = r.bound, covers = (s) => !R.missedBy(s, q).length;
    const reads = [`${q.depthCode || '?'} wall${q.finish ? ` · ${q.finish}` : ''}`, `${editDimension(q.wallHeightIn)} high`, `${word} ${editDimension(q.openingWidthIn)} wide`, `${editDimension(q.heightAboveOpeningIn)} of wall above`];
    const sch = r.schedule, outKey = (s) => SC.openingStyleOutputs(s, o.kind);
    const cell = (s) => { const out = outKey(s), h = out.members.head || out.choices.head?.join(' / ') || '', j = out.members.jamb || out.choices.jamb?.join(' / ') || '';
        const miss = R.missedBy(s, q), cls = [covers(s) ? 'covers' : 'misses', using?.KEY_ID === s.KEY_ID ? 'on' : '', r.match?.KEY_ID === s.KEY_ID ? 'match' : ''].join(' ');
        return `<button class="rule-cell ${cls}" data-act="rule-use" data-i="${i}" data-key="${esc(s.KEY_ID)}" ${covers(s) ? '' : 'disabled'}
            title="${esc(`${s.displayCode}: ${miss.length ? `does not cover this ${word} (${miss.join(', ')})` : `covers this ${word}`}. Header ${h || '—'} · jambs ${j || '—'}`)}"><b>${esc(s.displayCode)}</b>
            <small>H ${esc(h ? memberText(h) : '—')}</small><small>J ${esc(j ? j.split(' / ').map(memberText).join(' or ') : '—')}</small></button>`; };
    const table = sch.rows.length ? `<table class="rule-table" aria-label="${esc(`${r.styleType} rules for this wall`)}"><thead><tr><th>Wall up to</th>${sch.columns.map(c => `<th>${esc(`${ftIn(c.min)} – ${ftIn(c.max)}`)} wide</th>`).join('')}</tr></thead>
        <tbody>${sch.rows.map(rw => `<tr><th>${esc(rw.maxWall > 0 ? ftIn(rw.maxWall) : 'any')}${rw.maxAbove > 0 ? `<small>${esc(ftIn(rw.maxAbove))} above</small>` : ''}</th>${rw.cells.map(list => `<td>${list.map(cell).join('') || '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
    let say;
    if (r.status === 'matched' && using?.KEY_ID === r.match.KEY_ID) say = `<p class="rule-say ok">Using <b>${esc(r.match.displayCode)}</b>: it covers this ${word}.</p>`;
    else if (r.status === 'matched') say = `<p class="rule-say"><b>${esc(r.match.displayCode)}</b> covers this ${word}${using ? ` (now using ${esc(using.displayCode)}${covers(using) ? '' : `, which does not: ${esc(R.missedBy(using, q).join(', '))}`})` : ''}.
        <button data-act="rule-use" data-i="${i}" data-key="${esc(r.match.KEY_ID)}">Use ${esc(r.match.displayCode)}</button></p>`;
    else if (r.status === 'ambiguous') say = `<p class="rule-say warn">${r.eligible.length} rules cover this ${word} equally: pick one in the table${using ? ` (now using ${esc(using.displayCode)})` : ''}.</p>`;
    else say = `<p class="rule-say warn">No ${r.projectRows ? 'project ' : ''}rule covers this ${word}: ask the engineer, or pick the members below.${using ? ` Now using ${esc(using.displayCode)}${covers(using) ? '' : ` (it does not cover it: ${esc(R.missedBy(using, q).join(', '))})`}.` : ''}</p>
        ${r.outsideProject ? `<p class="rule-say">The catalog's <b>${esc(r.outsideProject.displayCode)}</b> covers it but is not in the project's styles. <button class="secondary" data-act="rule-use" data-i="${i}" data-key="${esc(r.outsideProject.KEY_ID)}">Add it to the project and use it</button></p>` : ''}
        ${!r.projectRows ? '<button class="secondary small" data-act="eng-open">Pick the project\'s styles…</button>' : ''}`;
    return `<div class="rule-card"><div class="rule-head"><b>Engineering rule</b><span class="muted small">${esc(reads.join(' · '))}</span></div>${say}${table}</div>`;
}
const SOURCE_BADGES = { rule: ['from the rule', 'style'], set: ['set here', 'overridden'], default: ['panel default', 'inherited'] };
const ARRANGE_WORDS = { jamb: [['box', 'Boxed'], ['back', 'Back to back'], ['same', 'Same way']], head: [['box', 'Box'], ['back', 'Back to back']], sill: [['box', 'Box'], ['back', 'Back to back']] };
function memberRows(p, i) {
    const o = p.openings[i], r = R.ruleFor(eng, p, i), states = R.memberStates(p, i, r.applies ? r : null), choices = (k) => profileChoices(k);
    return states.map(st => {
        const k = st.member, now = st.source === 'rule' ? 'rule' : profileChoiceOf(p, o, k), saved = choices(k).filter(c => c.saved);
        const shown = now === 'default' || now === 'custom' || now === 'rule' ? P.profileOfOpening(p, now === 'default' ? { ...o, [k]: '' } : o, k) : choices(k).find(c => c.id === now)?.p;
        const opt = (c) => `<option value="${c.id}" ${c.id === now ? 'selected' : ''}>${esc(c.p.name)}</option>`;
        const g = st.rule?.gives, [badge, cls] = SOURCE_BADGES[st.source];
        const alts = g?.choices ? `<div class="alt-row"><span class="muted small">${esc(st.rule.code)} gives one of:</span>${g.choices.map(c => `<button class="chip ${(G.specText(st.value) || st.value) === (G.specText(c) || c) && o[k] ? 'on' : ''}" data-act="op-alt" data-i="${i}" data-k="${k}" data-v="${esc(c)}">${esc(memberText(c))}</button>`).join('')}</div>` : '';
        const arr = st.arrangement.needed ? `<div class="arr-row"><span class="muted small">Arranged</span><span class="seg">${ARRANGE_WORDS[k].map(([v, label]) => `<button class="${st.arrangement.value === v ? 'on' : 'secondary'}" data-act="op-arrange" data-i="${i}" data-k="${k}" data-v="${v}" aria-pressed="${st.arrangement.value === v}">${label}</button>`).join('')}</span>
            ${st.arrangement.value ? '' : '<b class="arr-open">not chosen</b>'}</div>` : '';
        const back = st.differs && g && (g.text || g.choices) ? `<p class="rule-diff">${esc(st.rule.code)} gives ${esc(giveText(g))}. <button class="link" data-act="op-rule-member" data-i="${i}" data-k="${k}">Back to the rule</button></p>` : '';
        return `<div class="mrow" data-member="${k}">${profileGlyph(k, shown)}<div class="mrow-main">
            <div class="mrow-head"><b>${esc(st.label)}</b><span class="mval">${esc(memberText(st.value))}</span><span class="set-state ${cls}">${badge}</span></div>
            <select data-op-prof="${k}" aria-label="${esc(st.label)}: where the member comes from">
                ${g && (g.text || g.choices) ? `<option value="rule" ${now === 'rule' ? 'selected' : ''}>${esc(`From rule ${st.rule.code}: ${giveText(g)}`)}</option>` : ''}
                <option value="default" ${now === 'default' ? 'selected' : ''}>${esc(`Panel default: ${memberText(G.memberFor(p, { ...o, [k]: '' }, k).spec)}`)}</option>
                <optgroup label="Standard">${choices(k).filter(c => !c.saved).map(opt).join('')}</optgroup>${saved.length ? `<optgroup label="Saved in this browser">${saved.map(opt).join('')}</optgroup>` : ''}
                <option value="custom" ${now === 'custom' ? 'selected' : ''}>${now === 'custom' ? 'Custom (as set)' : 'Custom…'}</option></select>
            ${alts}${arr}${back}</div></div>`;
    }).join('');
}
// The rule's member for one member of the opening, set (a choice of alternatives: the one picked), and the opening bound
// to that rule. -> false when the rule gives alternatives and none was named.
function setFromRule(p, i, k, pick = null) {
    const r = R.ruleFor(eng, p, i), row = r.applies ? r.bound || r.match : null, g = row && R.ruleGives(row, p.openings[i].kind, k);
    if (!g || !(g.text || g.choices)) return false;
    const value = g.text || (pick && g.choices.includes(pick) ? pick : null);
    if (!value) return false;
    p.openings[i] = { ...p.openings[i], [k]: value, ...(p.openings[i].style?.keyId === row.KEY_ID ? {} : { style: SC.bindingOf(eng.read, row) }) };
    return true;
}
// Use a rule for the whole opening (the table's cell, or Use). A rule not in the project's styles is added first (asked:
// it clears the selection's approval).
function useRule(i, keyId) {
    const p = cur(), row = SC.rowById(eng?.read, keyId);
    if (!row || !p.openings[i]) return;
    if (!SC.projectStyles(eng.read, eng.selection, row.styleType).some(s => s.row.KEY_ID === row.KEY_ID)) {
        if (!confirm(`Add ${row.displayCode} to the project's styles and use it? The project selection's approval will need to be given again.`)) return;
        eng = { ...eng, selection: SC.includeStyle(eng.selection, eng.read, row.KEY_ID) }; saveEngineering();
    }
    try {
        const res = SC.applyOpeningStyle(p, i, eng.read, row);
        replacePanel(res.panel);
        ask = null;
        renderMemberCards(); changed();
        notice(`${G.openingName(p.openings, i)}: ${row.displayCode} in use${res.open.length ? `: pick its ${res.open.map(x => G.MEMBER_LABELS[x.key].toLowerCase()).join(' and ')} (the rule gives alternatives)` : ''}${res.problems.length ? `. ${res.problems.map(x => x.message).join(' ')}` : ''}.`);
    } catch (err) { notice(err.message, true); }
}
// The selected opening's rule and member rows, again after a change (its size, the wall): not while one of them has the
// keyboard (a list open, a button just pressed is fine: they re-render on their own).
function refreshOpeningRule() {
    const p = cur(), card = main.querySelector('#catalogue .rule-card'), rows = main.querySelector('#catalogue .op-profiles');
    if (sel == null || !p?.openings[sel] || !card || !rows || card.contains(document.activeElement) || rows.contains(document.activeElement)) return;
    card.outerHTML = ruleCard(p, sel);
    const tail = rows.querySelector(':scope > p, :scope > button') ? [...rows.children].filter(c => !c.classList.contains('mrow')).map(c => c.outerHTML).join('') : '';
    rows.innerHTML = memberRows(p, sel) + tail;
}
// A profile picked beside the elevation for the selected opening (Custom…: the dialog, its editor open).
// The sides of a rough opening that take a framing offset: a door none at its bottom, a steel penetration none on top.
const offsetSides = (o) => [['left', 'Left'], ['right', 'Right'], ...(o.kind === 'steel' ? [] : [['top', 'Top']]), ...(o.kind === 'door' ? [] : [['bottom', 'Bottom']])];
function pickOpeningProfile(kind, value) {
    const p = cur(), i = sel;
    if (i == null || !p.openings[i]) return;
    if (value === 'rule') {
        if (!setFromRule(p, i, kind, p.openings[i][kind] || null)) notice('The rule gives alternatives: pick one of them under the member.');
        renderMemberCards(); renderChips(); changed();
        return;
    }
    if (value === 'custom') {
        openFraming(i);
        fd.custom.add(kind); fd.work[kind] = P.profileOfOpening(draftPanel(), fd.draft, kind) || { ...P.PRESETS[kind][0], name: '' };
        setProfile(kind, fd.work[kind]); renderFraming();
        return;
    }
    const prof = value === 'default' ? null : profileChoices(kind).find(c => c.id === value)?.p;
    let o = prof ? P.applyProfile(p.openings[i], kind, prof, p.members) : P.clearProfile(p.openings[i], kind);
    if (kind === 'jamb' && o.headBearing === 'jacks' && G.specParts(G.memberFor(p, o, 'jamb').spec).studQty < 2) { o = { ...o }; delete o.headBearing; }
    p.openings[i] = o;
    ask = null;
    renderMemberCards(); renderChips(); changed();
}
// A member's profile applied to the draft (Custom: the profile being built).
function setProfile(kind, prof) {
    const p = cur();
    fd.draft = prof ? P.applyProfile(fd.draft, kind, prof, p.members) : P.clearProfile(fd.draft, kind);
    if (kind === 'jamb' && fd.draft.headBearing === 'jacks' && G.specParts(G.memberFor(draftPanel(), fd.draft, 'jamb').spec).studQty < 2) delete fd.draft.headBearing;
}
function framingInput(e) {
    const el = e.target.closest('[data-fd]');
    if (!el || !fd) return;
    const k = el.dataset.fd, kind = el.dataset.k, v = el.dataset.v ?? (el.type === 'checkbox' ? el.checked : el.value), d = fd.draft;
    if (k === 'cancel') { frDialog().close(); return; }
    if (k === 'apply') { applyFraming(); return; }
    if (k === 'save-name') { fd.saveAs[kind] = String(v); return; }
    if (k === 'offsetSide' && e.type === 'input') { // the preview follows as a side is typed
        const n = parseDimension(String(v)), box = frDialog().querySelector('.fd-svg');
        if (n != null && n >= 0) { d.offsets = { ...(d.offsets || {}), [kind]: round16(n) }; if (box) box.innerHTML = framingPreview(draftPanel()).svg; }
        return;
    }
    if (k === 'offset' && e.type === 'input') {
        const n = parseDimension(String(v));
        const box = frDialog().querySelector('.fd-svg');
        if (n != null) { d.offsetIn = round16(n); if (box) box.innerHTML = framingPreview(draftPanel()).svg; }
        return;
    }
    if (k === 'reset') { const r = { ...d, head: '', jamb: '', sill: '' }; for (const f of ['offsets', 'offsetIn', 'jambStyle', 'headStyle', 'sillStyle', 'headBearing', 'crippleEnds', 'toLayout']) delete r[f]; openFraming(fd.i, r); return; }
    if (k === 'offset') { const n = parseDimension(String(v)); if (n == null) return; d.offsetIn = round16(n); }
    else if (k === 'offsetReset') delete d.offsetIn;
    else if (k === 'offsetsVary') { if (v) d.offsets = Object.fromEntries(offsetSides(d).map(([s]) => [s, G.offsetsOf(d)[s]])); else delete d.offsets; }
    else if (k === 'offsetSide') { const n = parseDimension(String(v)); if (n == null || n < 0) return; d.offsets = { ...(d.offsets || {}), [kind]: round16(n) }; }
    else if (k === 'toLayout') { if (v) d.toLayout = true; else delete d.toLayout; }
    else if (k === 'crippleEnds') { if (v) d.crippleEnds = true; else delete d.crippleEnds; }
    else if (k === 'spread') fd.spread = !!v;
    else if (k === 'view') fd.view = DT_VIEWS[v] ? v : 'opening';
    else if (k === 'arrange') { d[`${kind}Style`] = v; fd.custom.delete(kind); delete fd.work[kind]; } // a choice made: the plan places the parts
    else if (k === 'profile') {
        if (v === 'custom') { fd.custom.add(kind); fd.work[kind] = P.profileOfOpening(draftPanel(), d, kind) || { ...P.PRESETS[kind][0], name: '' }; setProfile(kind, fd.work[kind]); }
        else { fd.custom.delete(kind); delete fd.work[kind]; setProfile(kind, v === 'default' ? null : profileChoices(kind).find(c => c.id === v)?.p); }
    } else if (k === 'delete-profile') {
        const n = Number(v), gone = profiles[kind][n];
        if (!gone) return;
        profiles = { ...profiles, [kind]: profiles[kind].filter((_, j) => j !== n) };
        store(KEYS.profiles, profiles);
        fd.custom.add(kind); fd.work[kind] = { ...gone, name: '' };
        notice(`Profile "${gone.name}" deleted (this opening keeps its framing).`);
    } else if (k === 'save-profile') {
        const name = String(fd.saveAs[kind] || '').trim(), prof = P.cleanProfile(kind, { ...(fd.work[kind] || P.profileOfOpening(draftPanel(), d, kind)), name });
        if (!name) { notice('Give the profile a name first.', true); frDialog().querySelector(`[data-fd="save-name"][data-k="${kind}"]`)?.focus(); return; }
        if (!prof) { notice('This framing cannot be kept as a profile (a mix of sizes typed by hand).', true); return; }
        const list = profiles[kind].filter(x => x.name.toLowerCase() !== name.toLowerCase());
        profiles = { ...profiles, [kind]: [...list, prof].sort((a, b) => a.name.localeCompare(b.name)) };
        store(KEYS.profiles, profiles);
        fd.custom.delete(kind); delete fd.work[kind]; fd.saveAs[kind] = '';
        setProfile(kind, prof);
        notice(`Saved "${name}": pick it for any ${FD_LABELS[kind].toLowerCase()} from now on (kept in this browser).`);
    } else if (/^w-/.test(k)) {
        const w = { ...(fd.work[kind] || P.profileOfOpening(draftPanel(), d, kind) || P.PRESETS[kind][0]) };
        if (k === 'w-plies') w.plies = Number(v);
        if (k === 'w-stud') w.stud = v;
        if (k === 'w-style') w.style = v;
        if (k === 'w-made') { w.made = v; if (v === 'track') w.tracks = Math.max(1, Math.min(2, w.tracks || 1)); }
        if (k === 'w-studs') w.studs = Number(v);
        if (k === 'w-tracks') w.tracks = Number(v);
        if (k === 'w-track') w.track = v;
        if (k === 'w-jacks') w.bearing = v ? 'jacks' : 'between';
        fd.work[kind] = P.cleanProfile(kind, { ...w, name: w.name || 'Custom' }) || w;
        setProfile(kind, fd.work[kind]);
    } else return;
    renderFraming();
    frDialog().querySelector(`[data-fd="${k}"]${kind ? `[data-k="${kind}"]` : ''}`)?.focus();
}
const FRAMING_FIELDS = ['jamb', 'jambStyle', 'head', 'headStyle', 'headBearing', 'sill', 'sillStyle', 'crippleEnds'];
function applyFraming() {
    const p = cur(), i = fd.i, o = p.openings[i], d = fd.draft;
    // The dialog never moves or resizes the opening: only its framing changes (allowed on a Revit opening too).
    p.openings[i] = { ...d, kind: o.kind, leftIn: o.leftIn, widthIn: o.widthIn, heightIn: o.heightIn, sillIn: o.sillIn, ...(o.locked ? { locked: true } : {}) };
    let spread = 0;
    if (fd.spread) p.openings = p.openings.map((x, j) => {
        if (j === i || x.kind !== o.kind || G.isSmallPenetration(p, x)) return x;
        spread++;
        const y = { ...x };
        for (const f of FRAMING_FIELDS) { if (d[f] === undefined || d[f] === '') delete y[f]; else y[f] = d[f]; }
        if (!d.jamb) y.jamb = ''; if (!d.head) y.head = ''; if (!d.sill) y.sill = '';
        return y;
    });
    for (const k of ['head', 'jamb', 'sill']) if (d[k] && !d[k].startsWith('=')) { recent[recentKey(k)] = G.remember(recent[recentKey(k)], d[k]); }
    store(KEYS.recent, recent);
    frDialog().close();
    renderMemberCards(); renderChips(); renderDatalists(); changed();
    notice(`${G.openingName(p.openings, i)}${spread ? ` and ${spread} other${spread === 1 ? '' : 's'}` : ''}: framing set (${framingSummary(p, i)}).`);
}
frDialog().addEventListener('click', (e) => { if (e.target === frDialog()) { frDialog().close(); return; } if (e.target.closest('button[data-fd]')) framingInput(e); });
frDialog().addEventListener('change', (e) => { if (!e.target.closest('button')) framingInput(e); });
frDialog().addEventListener('input', (e) => { if (e.target.type === 'text') framingInput(e); });
frDialog().addEventListener('toggle', (e) => { if (fd && e.target.matches?.('details.fd-more')) fd.more = e.target.open; }, true);
frDialog().addEventListener('close', () => { fd = null; });

// --- Openings list under the sketch --------------------------------------------------------------------------------------
function renderChips() {
    const p = cur(), errors = G.panelErrors(p);
    $('#op-chips').innerHTML = p.openings.length ? p.openings.map((o, i) => {
        const b = G.openingBox(o), bad = errors.some(e => e.where === `opening-${i}`);
        return `<button class="op-chip ${o.kind} ${i === sel ? 'on' : ''} ${bad ? 'bad' : ''}" data-act="select-op" data-i="${i}" title="${esc(G.OPENING_TYPES[o.kind].name)}">
            <b>${G.openingName(p.openings, i)}</b>${G.isLockedOpening(p, o) ? ' 🔒' : G.isFromModel(p) ? ' <span class="own study" title="Added here: a study opening, report-only">study</span>' : ''} ${editDimension(b.right - b.left)}${o.kind === 'steel' ? ' through the top' : ` x ${editDimension(b.top - b.bottom)}`} @ ${editDimension(b.left)}</button>`;
    }).join('') : '<span class="muted small">No openings yet: add one, or draw it.</span>';
}

// --- The sheet ---------------------------------------------------------------------------------------------------------
// No QR code on these sheets: a panel typed in here has no page of its own, and a link holding the whole panel makes a
// dense code that won't scan from a distance (Copy link shares it).
// The sheet's revisions and clouds (revisions.mjs sheetChanges): the changes since the last revision, else that revision's.
function sheetRevisions(p) {
    if (!p.revisions?.length) return {};
    const lay = framed(p).plan?.layout, sc = lay ? RV.sheetChanges(p, lay) : null;
    return { revisions: p.revisions.map(r => ({ n: r.n, date: r.date, note: r.note })), clouds: sc?.changes.length ? { rev: sc.rev, pending: sc.pending, boxes: RV.cloudBoxes(sc.changes) } : null };
}
function sheetInfo(p) {
    return { mark: p.mark || 'P-?', project: set.project || '', level: p.level || '-', wallType: p.wallType || '-', date: today(), drawnBy: set.drawnBy || 'CAS BIM Web Viewer',
        logoHref, sheet: 'auto', ...sourceInfo(G.isFromModel(p)), ...reviewInfo(framed(p).plan), ...sheetContext(p), openingLooks: OC.openingLooks(p, legendColors()), openingLegend: openingLegend(p),
        sheetNotes: [TY.typicalNote(typicalOfPanel(p))].filter(Boolean), ...sheetRevisions(p) };
}
// The panel's resolved plan (framing-plan.mjs: the same calculation the plan export carries) and its drawing for the
// sheet's side (side B mirrors the drawing only). errors: what stops it being drawn; notes: what to know (warnings, and
// choices still to make on a drawn panel).
// Remembered by the panel's content (the resolved plan is pure: the same inputs give the same plan).
const framedMemo = new Map();
function framed(p) {
    const key = JSON.stringify([p, set.source?.documentId ?? null, eng ? [eng.read.sha256, eng.selection] : null]);
    if (framedMemo.has(key)) return framedMemo.get(key);
    let out;
    try {
        const plan = FP.resolveFramingPlan(FP.snapshotFromPanel(p, { documentId: set.source?.documentId ?? null }), FP.detailingFromPanel(p), null, engineeringFor());
        const layout = plan.layout ? FP.planDrawing(plan, p.sideB ? 'B' : 'A') : null;
        const errors = layout ? [] : plan.issues.filter(i => i.severity !== 'warning' && i.code !== 'plan.empty');
        const notes = plan.issues.filter(i => (layout ? !/^layout\./.test(i.code) : i.severity === 'warning'));
        out = { plan, layout, errors: errors.length || layout ? errors : [{ message: 'Nothing to frame yet.' }], notes };
    } catch (err) { out = { errors: [{ where: 'shape', message: `Could not frame this panel: ${err.message}` }], notes: [] }; }
    framedMemo.set(key, out);
    if (framedMemo.size > 80) framedMemo.delete(framedMemo.keys().next().value);
    return out;
}
const noteList = (notes) => (notes.length ? `<ul class="plan-notes">${notes.map(i => `<li class="${i.severity}"><b>${i.severity === 'warning' ? 'Note' : 'To decide'}</b> ${esc(i.message)}</li>`).join('')}</ul>` : '');
// --- The workspace: the views of the selected panel, its cut list and issues, its properties' context ---------------
// One resolved plan (framed: framing-plan.mjs) drives every view, the cut list, the issues and the export; viewing never
// changes a member. A plan with errors is not drawn as framing; one with choices still open is drawn marked PRELIMINARY.
let current = { panel: null, plan: null, layout: null, errors: [], notes: [] };
let wsTimer = 0;
const scheduleWorkspace = () => { clearTimeout(wsTimer); wsTimer = setTimeout(renderWorkspace, 0); };
function renderWorkspace() {
    const p = cur();
    if (!p) return;
    const f = framed(p);
    current = { panel: p, ...f };
    if (!selectionHolds(f.plan)) selection = W.NONE;
    renderStatus(p, f);
    renderActiveView(p, f);
    renderBottom(f);
    renderInspectorContext(p, f);
    renderCommands();
    renderSidePick(p);
}
const renderPreview = renderWorkspace; // the name older code calls
// A small length in sixteenths ('1/16"'), and which way a member's section opens, in words (the plan's axes: x along the
// panel from its left end on side A, y up, z through the wall from side A).
const sixteenths=editDimension;
function facingText(v) {
    const [x, y, z] = v.map(c => Math.round(c * 1000) / 1000), words = [];
    if (Math.abs(x) > 0.2) words.push(x < 0 ? 'toward the left end' : 'toward the right end');
    if (Math.abs(y) > 0.2) words.push(y > 0 ? 'up' : 'down');
    if (Math.abs(z) > 0.2) words.push(z > 0 ? 'toward side B' : 'toward side A');
    return `opens ${words.join(' and ') || 'nowhere'}`;
}
// A selection the current plan still has (a member, a label, an opening, an issue).
function selectionHolds(plan) {
    const s = selection;
    if (!plan || s.kind === 'none' || s.kind === 'panel' || s.kind === 'setting') return true;
    if (s.kind === 'member') return (plan.members || []).some(m => m.memberKey === s.key);
    if (s.kind === 'mark') return (plan.cutList || []).some(r => r.mark === s.key);
    if (s.kind === 'opening') return (plan.source?.openings || []).some(o => o.sourceKey === s.key);
    if (s.kind === 'issue') return !!plan.issues?.[s.key];
    return false;
}
const openChoices = (plan) => (plan?.issues || []).filter(i => i.severity === 'needs-resolution');
function renderStatus(p, f) {
    const el = document.getElementById('pv-check'), plan = f.plan, open = openChoices(plan);
    if (!f.layout) {
        const choices = f.errors.every(e => e.severity === 'needs-resolution');
        el.innerHTML = `<span class="check-failed">Not framed: ${choices ? 'choose' : 'fix'} ${f.errors.length === 1 ? 'this' : `these ${f.errors.length}`} (see Issues)</span>`;
        return;
    }
    const total = f.layout.cutList.reduce((a, r) => a + r.qty, 0);
    el.innerHTML = (f.layout.issues.length ? `<span class="check-failed">Framing check failed (${f.layout.issues.length}): do not release</span>`
        : `<span class="check-passed">✓ Framing check passed · ${total} members · ${esc(G.openingsSummary(p.openings))}</span>`)
        + (open.length ? ` <span class="eng-badge warn" title="Choices still open: the drawing is marked PRELIMINARY and is not ready for fabrication or placement">Preliminary: ${open.length} choice${open.length === 1 ? '' : 's'} open</span>` : '')
        + engineeringBadge(p, plan)
        + ' <span class="muted small" title="A valid preview is not engineering approval and not Revit placement readiness">Preview only</span>';
}
// The marks, member keys and opening keys the selection lights up everywhere.
const linksNow = () => W.selectionLinks(current.plan, selection);
function sheetInfoFor(p, f, { hits = false } = {}) {
    const links = linksNow();
    return { ...sheetInfo(p), highlight: editMode && selection.kind === 'member' ? null : links.marks.size ? links.marks : null, memberHits: hits, unresolved: openChoices(f.plan).map(i => i.message) };
}
const svgFit = (svg) => svg.replace(/width="([\d.]+)in" height="([\d.]+)in"/, (m, w, h) => `width="${Math.round(w * 96)}" height="${Math.round(h * 96)}"`);
function notFramed(f) {
    return `<div class="not-framed"><h3>Not framed</h3><p>This panel is not framed until these are settled: nothing is drawn as framing in the meantime.</p>
        <ul class="errors">${f.errors.map(e => `<li>${esc(e.message)}</li>`).join('')}</ul><p class="muted small">Each has its Locate and fix in Issues, below.</p></div>`;
}
function setView(id) {
    if (!W.viewIds.includes(id)) return;
    prefs.view = id; storePrefs();
    renderViewBar();
    for (const v of main.querySelectorAll('.view')) v.hidden = v.dataset.view !== id;
    if (id === 'sketch') { fit(); renderSketch(); }
    renderActiveView(cur(), current);
}
function renderViewBar() {
    $('#wall-dimension-format').value=dimensionFormat;
    const note=main.querySelector('.units-note');if(note)note.textContent=`Lengths: 10′-6″, 126.5″ or 126 1/2″. Bare numbers are ${dimensionFormat==='decimal-feet'?'feet':'inches'}.`;
    $('#view-tabs').innerHTML = W.VIEWS.map(v => `<button role="tab" id="tab-${v.id}" aria-selected="${v.id === prefs.view}" aria-controls="view-${v.id}" tabindex="${v.id === prefs.view ? 0 : -1}"
        data-view-tab="${v.id}" ${v.available === false ? 'disabled' : ''} title="${esc(v.available === false ? `${v.hint}: ${v.reason}` : v.hint)}">${esc(v.label)}</button>`).join('');
}
function renderSidePick(p) {
    $('#side-pick').innerHTML = `<button class="edit-toggle${editMode ? ' on' : ''}" data-act="man-mode" aria-pressed="${editMode}" title="Unlock members and place them by hand: move, copy, mirror, remove (Elevation view)">✎ Edit members</button><span class="muted">Side</span><button role="radio" aria-checked="${!p.sideB}" data-act="side" data-side="A" title="As seen from side A">A</button><button role="radio" aria-checked="${!!p.sideB}" data-act="side" data-side="B" title="As seen from side B: the drawing is mirrored; the members never change">B</button>`;
}
function renderActiveView(p, f) {
    if (!p) return;
    const id = prefs.view, host = main.querySelector(`#view-${id}`);
    if (!host) return;
    if (id === 'sketch') { renderSketch(); renderSketchMemberBar(p, f); return; }
    const layout = f.layout, open = openChoices(f.plan), pre = open.length ? `<div class="preliminary">PRELIMINARY: ${open.length} choice${open.length === 1 ? '' : 's'} open</div>` : '';
    if (id === 'drawing') {
        document.getElementById('pv-title').textContent = `${p.mark || 'Panel'}${layout ? ` · ${editDimension(layout.lengthIn)} x ${editDimension(layout.heightIn)}` : ''}`;
        const sheet = document.getElementById('pv-sheet'), list = document.getElementById('pv-errors');
        if (!layout) { list.innerHTML = notFramed(f); sheet.innerHTML = ''; sheet.classList.add('stale'); return; }
        sheet.classList.remove('stale');
        list.innerHTML = '';
        sheet.innerHTML = renderSheet(layout, sheetInfoFor(p, f)).replace(/width="[\d.]+in" height="[\d.]+in"/, 'width="100%"');
        return;
    }
    if (!layout) { host.innerHTML = notFramed(f); return; }
    const info = sheetInfoFor(p, f, { hits: true });
    const fx = id === 'elevation' ? focusOf(host) : null;
    if (id === 'elevation') host.innerHTML = `${editMode ? editBar(p, f) : bayStrip(p, f)}<div class="view-svg${editMode ? ' editing' : ''}">${pre}${svgFit(renderSheetRegion(layout, info, 'elevation'))}</div>
        <p class="view-caption">Click a member or an opening to edit it (its actions show over it), or pick a row in the cut list. ${open.length ? 'Members whose arrangement is still open are hatched orange.' : ''} ${selCaption(f)}</p>`;
    // The plans are long and thin: drawn at least 8 px to the inch (scroll sideways along a long panel) so the ticks read.
    else if (id === 'plan') { const wide = `style="--plan-min:${Math.round(layout.lengthIn * 8)}px"`;
        host.innerHTML = `<p class="view-caption">Top track plan (looking down): the studs at the top, and which way each faces.</p><div class="view-svg plan" ${wide}>${pre}${svgFit(renderSheetRegion(layout, info, 'planTop'))}</div>
        <p class="view-caption">Bottom track plan: the studs at the floor, and the openings' edges.${layout.lengthIn * 8 > host.clientWidth ? ' Scroll sideways for the whole length.' : ''} ${selCaption(f)}</p><div class="view-svg plan" ${wide}>${svgFit(renderSheetRegion(layout, info, 'planBottom'))}</div>`; }
    else if (id === 'compare') host.innerHTML = compareView(p, f);
    else if (id === '3d') host.innerHTML = `<div class="view-svg">${pre}${svgFit(renderIsoView(layout, { widthIn: 10, heightIn: 6.5, highlight: info.highlight }))}</div>
        <p class="view-caption">3D view, side ${p.sideB ? 'B' : 'A'}, not to scale. Select in the elevation, plan or cut list: the selection is colored here.</p>`;
    decorateHits(host, f);
    if (id === 'elevation') { drawHandles(host, f); quickBar(host, p, f); restoreFocus(host, fx); }
}
// --- Compare: the framing now against an issued revision (revisions.mjs); its MWF source later ---------------------------
let cmpRev = null; // the revision compared with (null: the last)
const openingNameByKey = (p, key) => { const i = G.openingKeys(p).indexOf(key); return i >= 0 ? G.openingName(p.openings, i) : key; };
function compareView(p, f) {
    const lay = f.plan?.layout, revs = p.revisions || [], next = (revs[revs.length - 1]?.n || 0) + 1;
    const mwf = W.VIEWS.find(v => v.id === 'compare')?.mwf;
    const issue = `<span class="cmp-issue"><input type="text" id="rev-note" class="mini wide" maxlength="200" placeholder="What revision ${next} is for" aria-label="What revision ${next} is for"><button class="small" data-act="rev-issue">Issue revision ${next}</button></span>`;
    if (!lay) return notFramed(f);
    if (!revs.length) return `<div class="cmp"><p><b>No revision issued yet.</b> Issue one to keep this framing as it is now: later changes are listed here against it, and the sheet clouds them and lists the revisions.</p>${issue}
        <p class="muted small">Observed MWF framing against this plan: ${esc(mwf?.reason || 'later')}</p></div>`;
    const r = revs.find(x => x.n === cmpRev) || revs[revs.length - 1], changes = RV.diffSnapshots(r.snap, RV.snapshotOf(lay));
    const info = { ...sheetInfoFor(p, f), clouds: { rev: r.n, pending: true, boxes: RV.cloudBoxes(changes) } };
    return `<div class="cmp"><div class="cmp-head"><label class="small">Compare with <select id="cmp-rev" aria-label="Compare with">${revs.slice().reverse().map(x => `<option value="${x.n}" ${x === r ? 'selected' : ''}>Revision ${x.n} · ${esc(x.date)}${x.note ? ` · ${esc(x.note)}` : ''}</option>`).join('')}
            <option disabled>MWF framing in the model (needs its read-only export: later)</option></select></label><span class="spacer"></span>${issue}</div>
        <p class="cmp-sum">${changes.length ? `<b>${changes.length} change${changes.length === 1 ? '' : 's'}</b> since revision ${r.n} (${esc(r.date)}), clouded below:` : `<b>No change</b> since revision ${r.n} (${esc(r.date)}).`}</p>
        ${changes.length ? `<ul class="cmp-list">${changes.map(c => `<li class="${c.kind}">${esc(RV.describe(c, editDimension, (k) => openingNameByKey(p, k)))}</li>`).join('')}</ul>` : ''}
        <div class="view-svg">${svgFit(renderSheetRegion(f.layout, info, 'elevation'))}</div></div>`;
}
function issueRevision(p) {
    const lay = framed(p).plan?.layout;
    if (!lay) { notice('Frame the panel first: a revision keeps its framing.', true); return; }
    const note = (main.querySelector('#rev-note')?.value || '').trim(), q = RV.issueRevision(p, lay, { note, date: today() }), r = q.revisions[q.revisions.length - 1];
    replacePanel(q); cmpRev = null; changed(); renderWorkspace();
    notice(`Revision ${r.n} issued (${r.date}${r.note ? `: ${r.note}` : ''}). Its sheet lists it; changes from now on are clouded against it.`);
}
// What the colors say while a member is selected: it is filled, the others with its cut list label only outlined.
function selCaption(f) {
    if (selection.kind !== 'member') return '';
    const m = (f.plan?.members || []).find(x => x.memberKey === selection.key), same = m ? (f.plan.members.filter(x => x.mark === m.mark).length - 1) : 0;
    return m && same > 0 ? `Filled: the selected ${esc(m.role || 'member')}; outlined: the ${same} other${same === 1 ? '' : 's'} labelled ${esc(m.mark)}.` : '';
}
// The click targets over the members: hatched when their arrangement is unresolved, outlined when selected.
function decorateHits(host, f) {
    const links = linksNow(), graphics = f.plan?.graphics || [], byKey = new Map((f.plan?.members || []).map(m => [m.memberKey, m]));
    for (const r of host.querySelectorAll('.member-hit[data-i]')) {
        const keys = graphics[Number(r.dataset.i)]?.memberKeys || [];
        r.classList.toggle('unresolved', keys.some(k => byKey.get(k)?.orientation?.kind === 'unresolved'));
        r.classList.toggle('selected', keys.some(k => links.memberKeys.has(k)));
        r.classList.toggle('manual', keys.some(k => !!byKey.get(k)?.manual));
    }
    for (const r of host.querySelectorAll('.op-hit')) r.classList.toggle('selected', selection.kind === 'opening' && selection.key === r.dataset.key);
}
// Cut list and issues, under the views.
function renderBottom(f) {
    const plan = f.plan, issues = plan?.issues || [], errors = issues.filter(i => i.severity === 'error').length, open = issues.filter(i => i.severity === 'needs-resolution').length;
    const tab = ['issues', 'openings'].includes(prefs.bottom) ? prefs.bottom : 'cut', shown = prefs.bottomOpen !== false, nOps = cur()?.openings?.length || 0;
    $('#bottom').classList.toggle('bottom-open', shown);
    const rows = f.layout ? plan.cutList : [];
    $('#bottom-tabs').innerHTML = `<button role="tab" id="btab-cut" aria-selected="${tab === 'cut'}" data-bottom-tab="cut" tabindex="${tab === 'cut' ? 0 : -1}">Cut list<span class="count">${rows.length}</span></button>
        <button role="tab" id="btab-issues" aria-selected="${tab === 'issues'}" data-bottom-tab="issues" tabindex="${tab === 'issues' ? 0 : -1}">Issues<span class="count ${errors ? 'bad' : open ? 'open' : ''}">${issues.length}</span></button>
        <button role="tab" id="btab-openings" aria-selected="${tab === 'openings'}" data-bottom-tab="openings" tabindex="${tab === 'openings' ? 0 : -1}" title="Every opening's jambs, header and sill, assigned like a schedule">Openings<span class="count">${nOps}</span></button>
        <button class="link collapse" data-act="bottom-toggle" aria-expanded="${shown}" aria-controls="bottom-body" title="${shown ? 'Collapse the schedule for more view space' : 'Expand the schedule'}">${shown ? '⌄ Hide' : '⌃ Show'}</button>`;
    const body = $('#bottom-body');
    body.hidden = !shown;
    if (!shown) return;
    const links = linksNow();
    if (tab === 'openings') { body.innerHTML = openingSchedule(cur()); return; }
    if (tab === 'cut') {
        const focused = body.contains(document.activeElement) ? document.activeElement.dataset.cutlistType : null;
        body.innerHTML = rows.length ? `<table class="cut-table" aria-label="Cut list"><thead><tr><th>Label</th><th>Qty</th><th>Function</th><th>Member</th><th>Cut length</th></tr></thead><tbody>
            ${rows.map(r => `<tr tabindex="0" data-mark="${esc(r.mark)}" class="${links.marks.has(r.mark) ? 'selected' : ''}" aria-selected="${links.marks.has(r.mark)}"><td><b>${esc(r.mark)}</b></td><td>${r.qty}</td><td>${esc(r.func || '')}</td><td><select class="cut-type" data-cutlist-type="${esc(r.mark)}" aria-label="Member type for ${esc(r.mark)}" title="Change the pieces in this row; panel defaults stay unchanged. Same family, depth and flange; alternate thicknesses. Change section sizes under Members.">${CUT.suggestions(cur(), r.designator, Object.values(recent).flat()).map(name => `<option value="${esc(name)}"${name === r.designator ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></td><td>${esc(editDimension(r.cutLengthIn))}</td></tr>`).join('')}</tbody></table><p class="cut-hint muted small">Change types by row; panel defaults stay unchanged. Undo restores the previous choice.</p>`
            : `<p class="muted">${f.layout ? 'No members.' : 'Not framed yet: no cut list (see Issues).'}</p>`;
        if (focused) [...body.querySelectorAll('[data-cutlist-type]')].find(el => el.dataset.cutlistType === focused)?.focus({ preventScroll: true });
        return;
    }
    const modelLinked = G.isFromModel(cur());
    body.innerHTML = issues.length ? `<ol class="issue-list">${issues.map((i, n) => {
        const { actions, note } = W.issueActions(plan, i, { modelLinked });
        const sev = i.severity === 'error' ? ['!', 'Error'] : i.severity === 'needs-resolution' ? ['?', 'To decide'] : ['i', 'Note'];
        return `<li class="issue ${i.severity} ${links.issues.includes(n) || (selection.kind === 'issue' && selection.key === n) ? 'selected' : ''}" data-issue="${n}">
            <span class="sev" title="${sev[1]}" aria-label="${sev[1]}">${sev[0]}</span><span class="msg">${esc(i.message)}<span class="code">${esc(i.code)}</span></span>
            ${note ? `<span class="note">${esc(note)}</span>` : ''}
            ${actions.length ? `<span class="acts">${actions.map((a, k) => `<button class="secondary" data-issue-act="${n}:${k}">${esc(a.label)}</button>`).join('')}</span>` : ''}</li>`;
    }).join('')}</ol>` : '<p class="muted">No issues.</p>';
}
function pickCutListType(mark, type) {
    const p = cur(), memberKey = current.plan?.cutList.find(r => r.mark === mark)?.memberKeys[0], result = CUT.setRowType(p, layoutA(), mark, type);
    if (result.error) { notice(result.error, true); renderBottom(current); return; }
    if (!result.changed) return;
    historyHint = { label: `${mark} member type` };
    replacePanel(result.panel);
    selection = W.NONE; // Labels can regroup after a type choice; never select a different piece under the old label.
    const kind = /^(S|CS|CT)$/.test(G.parseMember(type)?.profile || '') ? 'stud' : 'track';
    recent[kind] = G.remember(recent[kind], type); store(KEYS.recent, recent);
    changed(); renderWorkspace(); renderDatalists();
    const nextMark = current.plan?.members.find(m => m.memberKey === memberKey)?.mark;
    [...main.querySelectorAll('[data-cutlist-type]')].find(el => el.dataset.cutlistType === nextMark)?.focus({ preventScroll: true });
    notice(`${result.changed} ${mark} piece${result.changed === 1 ? '' : 's'} changed to ${type}. Panel defaults kept; labels regroup by type and length.`);
}
// The selection's own card at the top of the properties.
function renderInspectorContext(p, f) {
    const box = $('#insp-context'), plan = f.plan, s = selection, own = W.ownershipOf(plan, { modelLinked: G.isFromModel(p) });
    const ownBadge = (o) => (o === 'model' ? '<span class="own model">🔒 the model\'s</span>' : o === 'study' ? '<span class="own study">study: report-only</span>' : '<span class="own typed">typed here</span>');
    if (s.kind === 'member' || s.kind === 'mark') {
        const members = (plan?.members || []).filter(m => (s.kind === 'member' ? m.memberKey === s.key : m.mark === s.key));
        const m = members[0];
        if (!m) { box.innerHTML = ''; return; }
        const row = (plan.cutList || []).find(r => r.mark === m.mark), ends = m.cut.ends, slope = ends.topSlope || ends.plumb;
        const flippable = m.tags?.layout != null || (m.role === 'stud' && !m.tags?.of && !m.tags?.end);
        const xc = Math.round(m.start[0] * 16) / 16, flipped = (p.studFlips || []).some(c => Math.abs(c - xc) < 0.5);
        box.innerHTML = `<div class="ctx-card"><h3>${esc(s.kind === 'mark' ? `${m.mark}: ${row?.qty ?? members.length} × ${m.designator}` : `${m.mark} · ${m.role}`)}</h3>
            <dl><dt>Member</dt><dd>${esc(m.designator)}${m.catalogKey ? '' : ' <span class="set-state unresolved">not in the catalog</span>'}</dd>
                <dt>Cut length</dt><dd>${esc(editDimension(m.cut.lengthIn))} <span class="muted">(${esc(m.cut.rule)}${m.cut.allowanceIn ? `, ${sixteenths(m.cut.allowanceIn)} seat` : ''})</span></dd>
                ${slope ? `<dt>Cut end</dt><dd>${ends.topSlope ? 'top' : 'ends'} at ${slope.angleDeg.toFixed(1)}° (long side ${esc(slope.longSide)})</dd>` : ''}
                <dt>Faces</dt><dd>${m.orientation.kind === 'unresolved' ? `<span class="set-state unresolved">unresolved: ${esc(m.orientation.reason)}</span>` : esc(facingText(m.orientation.openSide))}</dd>
                ${s.kind === 'member' ? `<dt>Key</dt><dd><code>${esc(m.memberKey)}</code></dd>` : `<dt>Members</dt><dd>${members.map(x => `<code>${esc(x.memberKey)}</code>`).join(' ')}</dd>`}
                ${m.assemblyKey ? `<dt>Part of</dt><dd><code>${esc(m.assemblyKey)}</code> (${esc(m.partKey)})</dd>` : ''}</dl>
            <div class="acts">${m.tags?.of ? `<button class="secondary" data-ctx="select-opening" data-v="${esc(m.tags.of)}">Its opening</button><button class="secondary" data-ctx="framing" data-v="${esc(m.tags.of)}">Framing details…</button>` : ''}
                ${flippable ? `<button class="secondary" data-act="stud-flip" data-x="${xc}">${flipped ? '⟲ Flip this stud back' : '⟲ Flip this stud'}</button>` : ''}
                <button class="link" data-ctx="clear">Clear selection</button></div>${s.kind === 'member' ? manualBlock(p, m.memberKey) : ''}</div>`;
        return;
    }
    if (s.kind === 'issue') {
        const i = plan?.issues?.[s.key];
        const { actions, note } = W.issueActions(plan, i, { modelLinked: G.isFromModel(p) });
        box.innerHTML = i ? `<div class="ctx-card"><h3>${esc(i.severity === 'error' ? 'Error' : i.severity === 'needs-resolution' ? 'To decide' : 'Note')}</h3><p>${esc(i.message)}</p>${note ? `<p class="muted small">${esc(note)}</p>` : ''}
            <div class="acts">${actions.map((a, k) => `<button class="secondary" data-issue-act="${s.key}:${k}">${esc(a.label)}</button>`).join('')}<button class="link" data-ctx="clear">Clear selection</button></div></div>` : '';
        return;
    }
    // The panel (nothing selected, or an opening: its editor is in Openings below).
    const L = f.layout, fx = focusOf(box), octx = new Map(OC.openingContexts(p, legendColors()).map(c => [c.key, c])), loose = OC.unframedInserts(p, legendColors());
    box.innerHTML = `<div class="ctx-card"><h3 class="ctx-title"><input class="ctx-mark" type="text" data-f="mark" value="${esc(p.mark)}" placeholder="Panel mark" aria-label="Panel mark (rename this panel)" title="Rename this panel" autocomplete="off" spellcheck="false">${L ? ` <span class="muted small">${esc(editDimension(L.lengthIn))} x ${esc(editDimension(L.heightIn))}</span>` : ''}</h3>
        <dl><dt>Geometry</dt><dd>${own.geometry === 'model' ? `<span class="own model" title="${esc(`Revit wall ${p.revit?.uniqueId || ''}`)}">🔒 the Revit wall's: outline and openings locked</span>` : '<span class="own typed">typed or drawn here: editable</span>'}</dd>
            ${own.openings.length ? `<dt>Openings</dt><dd>${own.openings.map((o, i) => `<button class="link${selection.kind === 'opening' && selection.key === o.key ? ' on' : ''}" data-ctx="select-opening" data-v="${esc(o.key)}" aria-pressed="${selection.kind === 'opening' && selection.key === o.key}">${esc(G.openingName(p.openings, i))}</button> ${ownBadge(o.owner)}${ocTag(octx.get(o.key))}${o.status && o.status !== 'framed' ? ` <span class="muted small">${esc(o.status)}</span>` : ''}`).join('<br>')}</dd>` : ''}</dl>
        ${revLine(p)}${typLine(p)}${loose.length ? `<div class="oc-loose small" role="note"><b>In the model, with no opening here</b> (not framed; add an opening if it needs one):<ul>${loose.map(x => `<li title="${esc(`${x.category}${x.uniqueId ? ` (UniqueId ${x.uniqueId})` : ''}`)}"><i class="oc-dot" style="background:${x.color}"></i>${esc(x.tradeLabel)}${x.name ? ` · ${esc(x.name)}` : ''} <span class="muted">at ${esc(editDimension(x.at[0]))} along, ${esc(editDimension(x.at[1]))} up (side A)</span>
                ${x.uniqueId ? `<button class="secondary small" data-act="oc-add" data-uid="${esc(x.uniqueId)}" title="An opening at its place, sized from its type name when it says (check the size)">Add an opening here</button>` : ''}</li>`).join('')}</ul></div>` : ''}
        ${manualSummary(p, f)}<div class="acts"><button class="secondary" data-act="copy" title="${esc(own.duplicate.explain)}">${esc(own.duplicate.label)}</button><button class="secondary" data-act="tpl-save" title="Keep its shape, openings, members and layout to start new panels from (+ New panel ▾)">Save as template</button></div></div>`;
    restoreFocus(box, fx);
}
// --- Manual edit mode: members unlocked and placed by hand (manual.mjs) -----------------------------------------------
// Edits are side A (the plan's layout); the views may be side B (mirrored): what is typed or dragged is turned to side A.
let editMode = false;
const layoutA = () => current.plan?.layout || null;
// The layout member a plan record belongs to (a built-up member's parts: their one member), by the graphics.
function layoutKeyOf(memberKey) {
    const plan = current.plan, i = (plan?.graphics || []).findIndex(g => g.memberKeys.includes(memberKey));
    return i >= 0 ? plan.layout?.members?.[i]?.key ?? null : null;
}
const sideB = () => !!cur()?.sideB;
const viewX = (m, L) => (sideB() ? L - m.x - m.w : m.x);
function manualEdit(fn, say = '', { keep = true, allowUnframed = false } = {}) {
    const p = cur(), lay = layoutA();
    if (!p || (!lay && !allowUnframed)) return;
    replacePanel(fn(p, lay));
    if (!keep && selection.kind === 'member') selection = W.NONE;
    changed(); renderWorkspace();
    if (say) notice(say);
}
let manStep = 0.5, manPreview = null, manLast = ''; // the move step; a type change being previewed; what the last edit did
const STEPS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 6];
function manualStep() { return manStep > 0 ? manStep : 1 / 16; }
// A member in words: its label, role and place (side as drawn).
function memberWords(key) {
    const lay = layoutA(), m = lay?.members.find(x => x.key === key);
    return m ? `${m.mark || '?'} (${m.role}${MAN.isAdded(key) ? ', a copy' : ''}) at ${editDimension(sideB() ? lay.lengthIn - m.x - m.w : m.x)}` : key;
}
function selectedLayoutKey() { return selection.kind === 'member' ? layoutKeyOf(selection.key) : null; }
function manualNudge(dx, dy) {
    const key = selectedLayoutKey();
    if (!key || !(dx || dy)) return;
    if(SK.pinned(cur(),'member:'+key)){notice('Unlock this sketch member before moving it.',true);return;}
    historyHint = { label: 'the move', mergeKey: `man-move:${key}` };
    const was = MAN.isUnlocked(cur(), key);
    manualEdit((q, lay) => MAN.move(MAN.unlock(q, lay, key), lay, key, sideB() ? -dx : dx, dy));
    const what = [dx ? `${editDimension(Math.abs(dx))} ${dx > 0 ? 'right' : 'left'}` : '', dy ? `${editDimension(Math.abs(dy))} ${dy > 0 ? 'up' : 'down'}` : ''].filter(Boolean).join(', ');
    manLast = `Moved ${memberWords(key)}${was ? '' : ' (unlocked: placed by hand now)'}: ${what}.`;
    notice(manLast); renderWorkspace();
}
// Copies keep the selection on the new member: one stud space along (a vertical), or 12" up (a horizontal).
function manualCopy(key) {
    const p = cur(), lay = layoutA(), m = lay?.members.find(x => x.key === key);
    if (!m) return;
    const along = m.orient === 'v' ? (Number(p.members.spacingIn) || 16) : 0, up = m.orient === 'h' ? 12 : 0;
    const r = MAN.copy(p, lay, key, sideB() ? -along : along, up);
    replacePanel(r.panel); changed(); selectAdded(r.key); notice('Copied: the copy is placed by hand (drag or nudge it).');
}
function manualMirror(key) {
    const p = cur(), lay = layoutA(), r = MAN.mirror(p, lay, key);
    if (!r.key) return;
    replacePanel(r.panel); changed(); selectAdded(r.key); notice('Mirrored across the panel\'s middle, facing the other way.');
}
// After a copy: select it (its plan key is the manual one) once the plan has it.
function selectAdded(key) { renderWorkspace(); const rec = current.plan?.members?.find(x => x.memberKey === key || x.memberKey.startsWith(`${key}:`)); if (rec) selectTarget({ kind: 'member', key: rec.memberKey }); }
// The member card's block: locked (follows the rules) or placed by hand (where, how long, nudge, copy, mirror, remove, lock).
function manualBlock(p, memberKey) {
    const key = layoutKeyOf(memberKey), lay = layoutA(), m = lay?.members.find(x => x.key === key);
    if (!m) return '';
    if (!MAN.isUnlocked(p, key)) return `<div class="man-card"><span class="set-state inherited">follows the framing rules</span>
        <button class="secondary" data-act="man-unlock" data-key="${esc(key)}" title="It stays where it is and no longer follows the framing rules; then move, copy, mirror or remove it">✎ Unlock to place by hand</button>${typeRow(p, key, m)}</div>`;
    const L = lay.lengthIn, axis = seatOf(m, lay.members), len = m.lengthIn, f = (label, k, v) => `<label>${label}<input type="text" class="mini" data-man-f="${k}" data-key="${esc(key)}" data-physical="true" value="${esc(lenText(v))}" autocomplete="off"></label>`;
    const nb = (t, dx, dy, title) => `<button class="secondary" data-act="man-nudge" data-dx="${dx}" data-dy="${dy}" title="${title}">${t}</button>`;
    return `<div class="man-card on"><div class="man-head"><span class="set-state overridden">✎ placed by hand${MAN.isAdded(key) ? ' (a copy)' : ''}</span>
            <button class="link" data-act="man-lock" data-key="${esc(key)}" title="${MAN.isAdded(key) ? 'Remove this copy' : 'Back to where the framing rules put it'}">${MAN.isAdded(key) ? 'Remove the copy' : '🔒 Lock (back to the rules)'}</button></div>
        <div class="man-fields">${f('From left end', 'x', viewX(m, L))}${f('From bottom', 'y', axis?.y0 ?? m.y)}${f(m.orient === 'v' ? 'Cut height' : 'Cut length', 'len', len)}</div>
        <div class="man-nudge"><span class="muted small">Nudge by ${esc(fine(manualStep()))}</span>${nb('←', -1, 0, 'Left')}${nb('→', 1, 0, 'Right')}${nb('↓', 0, -1, 'Down')}${nb('↑', 0, 1, 'Up')}<span class="muted small">(the step is set in the bar over the view)</span></div>
        <div class="acts"><button class="secondary" data-act="man-copy" data-key="${esc(key)}">Copy</button><button class="secondary" data-act="man-mirror" data-key="${esc(key)}" title="A copy across the panel's middle, facing the other way">Mirror</button>
            ${MAN.isAdded(key) ? '' : `<button class="secondary danger" data-act="man-remove" data-key="${esc(key)}">Remove</button>`}</div>${typeRow(p, key, m)}</div>`;
}
// The panel card: how much is placed by hand, and the edits that no longer apply.
function manualSummary(p, f) {
    const n = MAN.unlockedCount(p), gone = MAN.removedKeys(p).length, stale = f.layout ? (current.plan?.layout?.manual?.stale || []) : [];
    if (!n && !gone && !editMode) return '';
    return `<div class="man-sum"><b>Placed by hand</b> ${n} member${n === 1 ? '' : 's'}${gone ? `, ${gone} removed` : ''}
        <span class="acts"><button class="secondary small" data-act="man-unlock-all">Unlock all</button>${n || gone ? '<button class="link small" data-act="man-lock-all">Lock all</button>' : ''}</span>
        ${stale.length ? `<ul class="plan-notes">${stale.map(x => `<li class="warning">${esc(x.message)}</li>`).join('')}</ul>` : ''}</div>`;
}
// A member's type: for it, for every member with its label, or (on-center studs) the panel's stud. Previewed first:
// what changes, what moves (nothing), what is placed by hand from then on.
function typeRow(p, key, m) {
    if (m.parts?.length) return '<p class="muted small">A built-up member: its parts are its opening\'s (Openings tab).</p>';
    const lay = layoutA(), same = lay.members.filter(x => x.mark && x.mark === m.mark && !x.parts?.length), onCenter = m.role === 'stud' && !m.manual;
    const list = m.orient === 'v' ? 'dl-stud' : 'dl-track';
    return `<div class="man-type"><label>Member type <input type="text" class="mini wide" id="man-type-in" list="${list}" value="${esc(m.type)}" aria-label="Member type"></label>
        <label>for <select id="man-type-scope" aria-label="Which members">
            <option value="one">this member only</option>
            ${same.length > 1 ? `<option value="mark">every ${esc(m.mark)} (${same.length} members)</option>` : ''}
            ${onCenter ? '<option value="panel">every stud on center (the panel\'s stud)</option>' : ''}</select></label>
        <button class="secondary small" data-act="man-type-preview" data-key="${esc(key)}">Preview</button></div>
        ${manPreview && manPreview.from === key ? `<div class="man-preview" role="status"><p>${esc(manPreview.text)}</p><div class="acts"><button class="small" data-act="man-type-apply">Apply</button><button class="link small" data-act="man-type-cancel">Cancel</button></div></div>` : ''}`;
}
function typePreview(key) {
    const p = cur(), lay = layoutA(), m = lay?.members.find(x => x.key === key), type = (main.querySelector('#man-type-in')?.value || '').trim(), scope = main.querySelector('#man-type-scope')?.value || 'one';
    const d = G.parseMember(type);
    if (!m || !d || d.qty !== 1) { notice('Type one member this tool reads, like 362S162-43.', true); return; }
    if (d.name === m.type) { notice(`It is ${m.type} already.`); return; }
    if (scope === 'panel') {
        manPreview = { from: key, scope, type: d.name, text: `Changes the panel's on-center stud from ${p.members.stud} to ${d.name}. Every stud on center changes (they keep following the framing rules; nothing moves); the bottom track and members in ${p.members.stud}'s size follow it, as when the stud is picked under Members.` };
    } else {
        const keys = scope === 'mark' ? lay.members.filter(x => x.mark === m.mark && !x.parts?.length).map(x => x.key) : [key];
        const locked = keys.filter(k => !MAN.isUnlocked(p, k)).length;
        manPreview = { from: key, scope, type: d.name, keys, text: `Changes ${keys.length} member${keys.length === 1 ? '' : 's'} from ${m.type} to ${d.name}: ${keys.map(memberWords).join('; ')}. Nothing moves${d.flangeIn && m.orient === 'v' && Math.abs(d.flangeIn - m.w) > 1e-6 ? ` (each is drawn ${inch(d.flangeIn)} wide from its left face)` : ''}.${locked ? ` ${locked} of them will be placed by hand from now on (no longer following the framing rules); Lock puts any back.` : ''}` };
    }
    renderWorkspace();
}
function typeApply() {
    const pv = manPreview, p = cur();
    if (!pv) return;
    manPreview = null;
    if (pv.scope === 'panel') { const old = p.members.stud; followStud(old, pv.type); changed(); manLast = `The panel's on-center stud: ${old} to ${pv.type}.`; notice(manLast); renderWorkspace(); return; }
    let res;
    manualEdit((q, lay) => { res = MAN.setType(q, lay, pv.keys, pv.type); return res.panel; });
    manLast = `Member type ${pv.type} on ${res.changed.length} member${res.changed.length === 1 ? '' : 's'}: ${res.changed.map(c => `${memberWords(c.key)} (was ${c.from})`).join('; ')}. Nothing moved.`;
    notice(manLast); renderWorkspace();
}
// A stud in a bay wider than the spacing.
function fillBay(a, b) {
    const p = cur(), lay = layoutA(), sp = Number(p.members.spacingIn) || 16;
    const r = MAN.fillBay(p, lay, a, b, sp);
    if (!r.key) { notice('No stud to copy beside that bay.', true); return; }
    replacePanel(r.panel); changed();
    manLast = `Added a stud (a copy of ${memberWords(a)}) at ${editDimension(sideB() ? lay.lengthIn - r.x - 1.625 : r.x)} from the left end, in the bay that was over ${sp}" o.c.`;
    selectAdded(r.key); notice(manLast);
}
// Arrows beside the selected member in the elevation: each moves it one step that way.
function drawHandles(host, f) {
    if (selection.kind !== 'member') return;
    const svg = host.querySelector('svg'), i = (f.plan?.graphics || []).findIndex(g => g.memberKeys.includes(selection.key));
    const hit = i >= 0 ? host.querySelector(`.member-hit[data-i="${i}"]`) : null;
    if (!svg || !hit) return;
    const x = Number(hit.getAttribute('x')), y = Number(hit.getAttribute('y')), w = Number(hit.getAttribute('width')), h = Number(hit.getAttribute('height'));
    const r = 0.075, cx = x + w / 2, cy = y + h / 2, ns = 'http://www.w3.org/2000/svg', g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'man-handles');
    const arrow = (px, py, dx, dy, label) => {
        const a = document.createElementNS(ns, 'g'), c = document.createElementNS(ns, 'circle'), t = document.createElementNS(ns, 'path'), ti = document.createElementNS(ns, 'title');
        a.setAttribute('class', 'man-handle'); a.dataset.act = 'man-nudge'; a.dataset.dx = String(dx); a.dataset.dy = String(dy);
        c.setAttribute('cx', px); c.setAttribute('cy', py); c.setAttribute('r', r);
        const k = r * 0.55, pts = dx ? [[px + dx * k, py], [px - dx * k * 0.6, py - k], [px - dx * k * 0.6, py + k]] : [[px, py - dy * k], [px - k, py + dy * k * 0.6], [px + k, py + dy * k * 0.6]];
        t.setAttribute('d', `M${pts.map(q => q.join(' ')).join(' L')} Z`);
        ti.textContent = `${label} ${editDimension(manualStep())}`;
        a.append(c, t, ti); g.append(a);
    };
    arrow(x - r * 1.8, cy, -1, 0, 'Move left'); arrow(x + w + r * 1.8, cy, 1, 0, 'Move right');
    arrow(cx, y - r * 1.8, 0, 1, 'Move up'); arrow(cx, y + h + r * 1.8, 0, -1, 'Move down');
    svg.append(g);
}
// A wide bay in words: its two members, and how far apart they are (center to center) against the spacing.
function bayWords(keys, sp) {
    const lay = layoutA(), [a, b] = keys.map(k => lay?.members.find(x => x.key === k));
    const gap = a && b ? Math.abs((b.x + b.w / 2) - (a.x + a.w / 2)) : null;
    const [l, r] = sideB() ? [keys[1], keys[0]] : keys;
    return `Over ${sp}" o.c.: ${memberWords(l)} to ${memberWords(r)}${gap != null ? ` are ${editDimension(gap)} apart, center to center` : ''}.`;
}
// The bar of actions at the selected member or opening (any mode): what it is and the edits it takes, one click each.
// A member: Copy, Mirror, Delete, its type, Reset (back to the rules); the arrows around it move it a step. An opening:
// its size and place typed here (the model's are locked), its framing details, its members in the schedule, Delete.
function quickBar(host, p, f) {
    const gi = selection.kind === 'member' ? (f.plan?.graphics || []).findIndex(g => g.memberKeys.includes(selection.key)) : -1;
    const svgBox = host.querySelector('.view-svg'), hit = selection.kind === 'member' ? host.querySelector(`.member-hit[data-i="${gi}"]`)
        : selection.kind === 'opening' ? host.querySelector(`.op-hit[data-key="${CSS.escape(selection.key)}"]`) : null;
    const html = !hit ? '' : selection.kind === 'member' ? quickMember(p, f) : quickOpening(p);
    if (!svgBox || !html) return;
    const bar = document.createElement('div');
    bar.className = 'quick-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Edit the selection');
    bar.innerHTML = html;
    svgBox.append(bar);
    const more = bar.querySelector('.qb-more');
    const moreKey = `${selection.kind}:${selection.key}`;
    more.open = quickMoreKey === moreKey;
    if (!more.open) quickMoreKey = null;
    const place = () => {
        const hb = hit.getBoundingClientRect(), vb = svgBox.getBoundingClientRect();
        const bounds = { left: vb.left, right: vb.left + svgBox.clientWidth, top: vb.top, bottom: vb.top + svgBox.clientHeight };
        const pos = barPosition(hb, bounds, bar.offsetWidth, bar.offsetHeight, hb.height > hb.width * 3 && selection.kind === 'member');
        bar.style.left = `${Math.round(pos.left - vb.left + svgBox.scrollLeft)}px`;
        bar.style.top = `${Math.round(pos.top - vb.top + svgBox.scrollTop)}px`;
        const menu = more.querySelector('.qb-menu'), summary = more.querySelector('summary');
        summary.setAttribute('aria-expanded', String(more.open));
        if (!more.open) return;
        menu.style.width = `${Math.min(360, svgBox.clientWidth - 8)}px`;
        const roomBelow = bounds.bottom - pos.top - bar.offsetHeight - 8, roomAbove = pos.top - bounds.top - 8;
        const above = roomAbove > roomBelow;
        menu.style.maxHeight = `${Math.max(80, above ? roomAbove : roomBelow)}px`;
        menu.style.top = above ? 'auto' : 'calc(100% + 4px)';
        menu.style.bottom = above ? 'calc(100% + 4px)' : 'auto';
        menu.style.left = `${Math.max(bounds.left + 4 - pos.left, Math.min(0, bounds.right - 4 - pos.left - menu.offsetWidth))}px`;
    };
    more.addEventListener('toggle', () => { if (!bar.isConnected) return; quickMoreKey = more.open ? moreKey : null; place(); });
    quickBarResize = () => { if (bar.isConnected) place(); };
    svgBox.addEventListener('scroll', quickBarResize);
    place();
}
let quickMoreKey = null, quickBarResize = null;
window.addEventListener('resize', () => quickBarResize?.());
function closeQuickMore(focus = false) {
    const more = main.querySelector('.qb-more[open]');
    if (!more) return false;
    more.open = false; quickMoreKey = null;
    if (focus) more.querySelector('summary').focus();
    return true;
}
document.addEventListener('pointerdown', e => { if (!e.target.closest('.quick-bar')) closeQuickMore(); });
const quickMore = (html) => `<details class="qb-more"><summary title="More selection actions" aria-label="More selection actions" aria-haspopup="true" aria-expanded="false">⋯</summary><div class="qb-menu" role="group" aria-label="More selection actions">${html}</div></details>`;
const quickIcon = (act, icon, title, attrs = '', danger = false) => `<button class="secondary qb-icon${danger ? ' danger' : ''}" data-act="${act}" ${attrs} title="${title}" aria-label="${title}">${icon}</button>`;

function stepPick() {
    return `<label class="qb-step small" title="How far each arrow moves it">Step <select data-qb-step aria-label="Move step">${STEPS.map(v => `<option value="${v}" ${Math.abs(manStep - v) < 1e-9 ? 'selected' : ''}>${esc(fine(v))}</option>`).join('')}</select></label>`;
}
function quickMember(p, f) {
    const key = selectedLayoutKey(), lay = layoutA(), m = lay?.members.find(x => x.key === key);
    if (!m) return '';
    const head = `<b class="qb-name" title="${esc(`${m.mark || '?'} ${m.role} ${m.type}`)}">${esc(m.mark || '?')}</b>`;
    const description = `<b>${esc(m.role)}</b><span class="muted small">${esc(m.type)}${MAN.isUnlocked(p, key) ? ' · placed by hand' : ''}</span>`;
    if (m.parts?.length) return `${head}${quickMore(`${description}<span class="small">A built-up member: its parts are its opening's.</span>${m.of ? `<button class="secondary small" data-act="qb-opening" data-key="${esc(m.of)}">Edit its opening</button>` : ''}`)}`;
    const added = MAN.isAdded(key), by = MAN.isUnlocked(p, key), attrs = `data-key="${esc(key)}"`;
    const arrows = [['←', -1, 0, 'Nudge left'], ['→', 1, 0, 'Nudge right'], ['↓', 0, -1, 'Nudge down'], ['↑', 0, 1, 'Nudge up']]
        .map(([icon, dx, dy, title]) => quickIcon('man-nudge', icon, title, `data-dx="${dx}" data-dy="${dy}"`)).join('');
    return `${head}${arrows}${quickIcon('man-copy', '⧉', 'Copy', attrs)}${quickIcon(added ? 'man-lock' : 'man-remove', '×', 'Delete', attrs, true)}
        ${quickMore(`${description}${stepPick()}
        <button class="secondary small" data-act="man-mirror" ${attrs} title="A copy across the panel's middle, facing the other way">Mirror</button>
        <button class="secondary small" data-act="qb-type" title="Another member type for it, or for every member with its label">Type…</button>
        ${by && !added ? `<button class="link small" data-act="man-lock" ${attrs} title="Back to where the framing rules put it">Reset</button>` : ''}`)}`;
}
function quickOpening(p) {
    const i = G.openingKeys(p).indexOf(selection.key), o = p.openings[i];
    if (!o) return '';
    const c = OC.openingContexts(p, legendColors())[i], locked = G.isLockedOpening(p, o), H = G.shapeTop(p.shape).heightIn;
    const fl = (label, k) => `<label class="qb-f small">${label}<input type="text" class="mini" data-f="openings.${i}.${k}" data-t="len" value="${esc(lenText(o[k]))}" autocomplete="off"></label>`;
    const fields = locked ? '<span class="small muted">🔒 the model\'s: its size and place stay</span>'
        : `${fl('Width', 'widthIn')}${o.kind === 'steel' ? '' : fl('Height', 'heightIn')}${o.kind === 'door' ? '' : fl(o.kind === 'steel' ? 'Bottom' : 'Sill', 'sillIn')}${fl(sideB() ? 'From left (side A)' : 'From left', 'leftIn')}`;
    return `<b class="qb-name" title="${esc(G.openingName(p.openings, i))}">${esc(G.openingName(p.openings, i))}</b>
        ${quickIcon('framing', '⚙', 'Framing…', `data-i="${i}"`)}
        ${locked || !(H > 0) ? '' : quickIcon('del-op', '×', 'Delete', `data-i="${i}"`, true)}
        ${quickMore(`${ocTag(c)}${profileControl(p, o, i)}${fields}
        <button class="secondary small" data-act="qb-members" data-i="${i}" title="Its jambs, header and sill in the Openings schedule">Members</button>
        ${typeFramingButton(p, c, i)}`)}`;
}
// The set's opening profiles and its opening colors (opening-profiles.mjs, opening-context.mjs), read forgivingly.
function opProfiles() { return OP.cleanProfiles(set.openingProfiles) || []; }
function legendColors() { return OC.cleanColors(set.legendColors); }
// The sheet's opening legend: the trades of its openings, by the legend's names, in the set's colors.
function openingLegend(p) { const colors = legendColors(); return OC.tradesOf(OC.openingContexts(p, colors), colors).map(t => ({ legend: t.legend, color: t.color })); }
function sizeText(o) { return o.kind === 'steel' ? `${editDimension(o.widthIn)} wide` : `${editDimension(o.widthIn)} x ${editDimension(o.heightIn)}`; }
// The opening's profile: pick one (its framing; the size stays), save this one as one, or, once its framing is not the
// profile's, update the profile (every opening that uses it) or go back to it.
function profileControl(p, o, i) {
    const list = opProfiles().filter(x => x.kind === G.kindOf(o)), prof = OP.findProfile(list, o.profile), n = prof ? OP.uses(set.panels, prof.name).length : 0;
    return `<label class="qb-f small qb-prof">Profile<select data-op-profile="${i}" aria-label="Opening profile (its framing, shared by name)">
            <option value="">${o.profile && !prof ? esc(`${o.profile} (not in the set)`) : 'None'}</option>${list.map(x => `<option value="${esc(x.name)}" ${x.name === o.profile ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
            <option value="__new">+ Save as a profile…</option></select></label>
        ${prof && OP.differs(o, prof) ? `<span class="warning small" title="Its framing is not the profile's now">differs</span>
            <button class="secondary small" data-act="prof-update" data-i="${i}" title="${esc(`${prof.name} takes this framing, and so ${n === 1 ? 'does the opening' : `do the ${n} openings`} that use it`)}">Update the profile</button>
            <button class="link small" data-act="prof-reset" data-i="${i}" title="This opening takes the profile's framing again">Back to it</button>` : ''}`;
}
const openingWhere = (x, panels = set.panels) => `${x.mark} ${G.openingName(panels.find(q => q.id === x.panelId).openings, x.index)}`;
function pickProfile(p, i, value) {
    const o = p?.openings[i];
    if (!o) return;
    const name = G.openingName(p.openings, i);
    if (value === '__new') { saveProfile(p, i); return; }
    if (!value) {
        if (!o.profile) return;
        const was = o.profile;
        delete o.profile;
        historyHint = { label: 'leaving the opening profile' }; changed(); renderAll();
        notice(`${name} no longer uses ${was}: its framing stays as it is.`);
        return;
    }
    const prof = OP.findProfile(opProfiles(), value), q = prof && OP.assign(o, prof);
    if (!q) { renderAll(); return; }
    p.openings[i] = q;
    historyHint = { label: `the profile ${prof.name}` }; changed(); renderAll();
    notice(`${name} uses ${prof.name}: ${framingWords(prof.framing) || 'the panel defaults'}. Its size and place stay (${sizeText(o)}).`);
}
function saveProfile(p, i) {
    const o = p.openings[i], kind = G.kindOf(o), list = opProfiles(), opening = G.openingName(p.openings, i);
    const name = String(prompt(`A name for ${opening}'s profile: its framing, shared by the openings that use it (new ones start at ${sizeText(o)}; each keeps its own size). A Revit family : type name gives it to the model's openings of that type.`, OP.suggestName(p, i)) || '').trim().slice(0, 120);
    if (!name) { renderAll(); return; }
    const same = list.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (same) {
        if (same.kind !== kind) { notice(`${same.name} is a ${G.kindWord(same.kind)} profile: give this one another name.`, true); renderAll(); return; }
        if (!confirm(`${same.name} is a profile already. Should ${opening} use it (its framing replaces this opening's)?`)) { renderAll(); return; }
        pickProfile(p, i, same.name);
        return;
    }
    const prof = OP.profileFrom(o, name);
    set.openingProfiles = [...list, prof];
    p.openings[i] = { ...o, profile: name };
    const r = OP.linkByRevitName(set.panels, prof, { only: 'unset' });
    set.panels = r.panels;
    historyHint = { label: `the profile ${name}` }; changed(); renderAll();
    notice(`Profile ${name} saved: ${framingWords(prof.framing) || 'the panel defaults'}; new ones ${sizeText(prof)}.${r.linked.length ? ` ${r.linked.length} of the model's ${name} opening${r.linked.length === 1 ? '' : 's'} with nothing chosen took it: ${r.linked.map(x => openingWhere(x)).join(', ')}.` : ''}`);
}
function updateProfile(p, i) {
    const o = p.openings[i], list = opProfiles(), prof = OP.findProfile(list, o?.profile);
    if (!prof) return;
    const next = { ...prof, framing: OC.framingOf(o) }, r = OP.propagate(set.panels, next), names = r.changed.map(x => openingWhere(x));
    if (names.length && !confirm(`Update ${prof.name} to ${G.openingName(p.openings, i)}'s framing (${framingWords(next.framing) || 'the panel defaults'})?\n\nChanges ${names.length} opening${names.length === 1 ? ' that uses' : 's that use'} it: ${names.join(', ')}.\nSizes and places stay.`)) return;
    set.openingProfiles = list.map(x => (x.name === prof.name ? next : x));
    set.panels = r.panels;
    changed(); renderAll();
    notice(`${prof.name} updated: ${framingWords(next.framing) || 'the panel defaults'}${names.length ? `; ${names.length} opening${names.length === 1 ? '' : 's'} changed (${names.join(', ')})` : ''}.`);
}
function deleteProfile(name) {
    const n = OP.uses(set.panels, name).length;
    if (!confirm(`Delete the opening profile ${name}?${n ? `\n\nIts ${n} opening${n === 1 ? '' : 's'} keep their framing, without the profile.` : ''}`)) return;
    const rest = opProfiles().filter(x => x.name !== name);
    if (rest.length) set.openingProfiles = rest; else delete set.openingProfiles;
    set.panels = OP.unlink(set.panels, name);
    changed(); renderAll(); renderSetDialog();
    notice(`Profile ${name} deleted${n ? `: its ${n} opening${n === 1 ? '' : 's'} keep their framing` : ''}.`);
}
function renameProfile(n, value) {
    const list = opProfiles(), x = list[n], name = String(value || '').trim().slice(0, 120);
    if (!x || name === x.name) return;
    if (!name || list.some((y, m) => m !== n && y.name.toLowerCase() === name.toLowerCase())) { notice(name ? `${name} is another profile's name.` : 'A profile needs a name.', true); renderSetDialog(); return; }
    const used = OP.uses(set.panels, x.name).length;
    set.openingProfiles = list.map((y, m) => (m === n ? { ...y, name } : y));
    set.panels = OP.relink(set.panels, x.name, name);
    historyHint = { label: 'renaming the opening profile' }; changed(); renderAll(); renderSetDialog();
    notice(`Profile ${x.name} renamed ${name}${used ? `: its ${used} opening${used === 1 ? '' : 's'} follow` : ''}.`);
}
// The model's openings of the Revit family : type the profile is named for, with nothing chosen, take it.
function linkProfile(name) {
    const prof = OP.findProfile(opProfiles(), name);
    if (!prof) return;
    const r = OP.linkByRevitName(set.panels, prof, { only: 'unset' }), names = r.linked.map(x => openingWhere(x, r.panels));
    if (!names.length || !confirm(`Give ${name} (${framingWords(prof.framing) || 'the panel defaults'}) to the model's ${name} openings with nothing chosen?\n\n${names.join(', ')}.\nSizes and places stay.`)) return;
    set.panels = r.panels;
    changed(); renderAll(); renderSetDialog();
    notice(`${name}: ${names.length} opening${names.length === 1 ? '' : 's'} took it (${names.join(', ')}).`);
}
// Its model type's openings across the set take this one's framing (and panels imported later: the set remembers it).
function typeFramingButton(p, c, i) {
    const key = OC.typeKeyOf(c);
    if (!key) return '';
    const all = OC.sameTypeOpenings(set.panels, key), others = all.length - 1, panels = new Set(all.map(x => x.panelId)).size;
    return `<button class="secondary small" data-act="type-framing" data-i="${i}" title="${esc(`Every ${OC.typeNameOf(key)} in the set (${all.length} in ${panels} panel${panels === 1 ? '' : 's'}) takes this opening's framing, and so do those in panels imported later`)}">Same framing for every ${esc(OC.typeNameOf(key))}${others ? ` (+${others})` : ''}</button>`;
}
const framingWords = (f) => [f.jamb ? `jambs ${f.jamb}` : 'jambs: the panel\'s', f.head ? `header ${f.head}` : '', f.sill ? `sill ${f.sill}` : '', f.offsetIn != null ? `framing offset ${editDimension(f.offsetIn)}` : '',
    f.offsets ? `offsets ${Object.entries(f.offsets).map(([k, v]) => `${k[0].toUpperCase()} ${editDimension(v)}`).join(', ')}` : '',
    f.jambStyle ? `jambs ${f.jambStyle}` : '', f.headStyle ? `header ${f.headStyle}` : '', f.headBearing ? 'header on jack studs' : '', f.style ? 'its engineering style' : ''].filter(Boolean).join(', ');
function typeFraming(p, i) {
    const c = OC.openingContexts(p)[i], key = OC.typeKeyOf(c), src = p.openings[i], framing = OC.framingOf(src);
    if (!key) return;
    const targets = OC.sameTypeOpenings(set.panels, key).filter(x => !(x.panelId === p.id && x.index === i));
    const list = targets.map(x => `${x.mark} ${G.openingName(set.panels.find(q => q.id === x.panelId).openings, x.index)}`);
    if (!confirm(`Give ${G.openingName(p.openings, i)}'s framing (${framingWords(framing) || 'the panel defaults'}) to every ${OC.typeNameOf(key)}?\n\n${targets.length ? `Changes ${targets.length}: ${list.join(', ')}.` : 'No other opening of this type yet.'}\nPanels imported later take it too (the set remembers it; Export keeps it). Nothing moves.`)) return;
    const res = OC.applyTypeFraming(set.panels, key, framing);
    set.panels = res.panels;
    set.typeFraming = { ...(set.typeFraming || {}), [key]: framing };
    // Kept as the opening profile of that name too (its first size kept when it is one already); the type's openings use it.
    const name = OC.typeNameOf(key), profs = opProfiles(), had = profs.find(x => x.name.toLowerCase() === name.toLowerCase());
    let prof = null;
    if (!had || had.kind === G.kindOf(src)) {
        prof = had ? { ...had, name, framing } : OP.profileFrom(src, name);
        set.openingProfiles = had ? profs.map(x => (x === had ? prof : x)) : [...profs, prof];
        if (had && had.name !== name) set.panels = OP.relink(set.panels, had.name, name);
        set.panels = OP.linkByRevitName(set.panels, prof).panels;
    }
    changed(); renderAll();
    notice(`${name}: ${res.changed.length ? `${res.changed.length} opening${res.changed.length === 1 ? '' : 's'} changed (${res.changed.map(x => `${x.mark} ${G.openingName(set.panels.find(q => q.id === x.panelId).openings, x.index)}`).join(', ')})` : 'every one had it already'}; remembered for panels imported later${prof ? `, and kept as the opening profile ${name}` : ''}.`);
}
// Members placed by hand and a bay now over the stud spacing: said over the view in any mode.
function bayStrip(p, f) {
    if (!MAN.unlockedCount(p) && !MAN.removedKeys(p).length) return '';
    const sp = Number(p.members.spacingIn) || 16, bays = wideBays(f);
    return bays.length ? `<div class="edit-bar slim">${bayRows(bays, sp)}</div>` : '';
}
const wideBays = (f) => (f?.plan?.issues || []).filter(i => i.code === 'layout.wide_bay').map(i => ({ i, keys: (i.memberKeys || String(i.subjectKey).split('|')).map(layoutKeyOf) })).filter(b => b.keys.every(Boolean));
const bayRows = (bays, sp) => `<div class="man-bays" role="alert">${bays.map(b => `<span>⚠ ${esc(bayWords(b.keys, sp))} <button class="small" data-act="man-fill" data-a="${esc(b.keys[0])}" data-b="${esc(b.keys[1])}">Add a stud in the gap</button></span>`).join('')}</div>`;
// Over the elevation in edit mode.
function editBar(p, f) {
    const n = MAN.unlockedCount(p), sp = Number(p.members.spacingIn) || 16;
    const bays = wideBays(f);
    const stepRow = `<span class="man-steps" role="group" aria-label="Move step"><span class="small">Step</span>${STEPS.map(v => `<button class="${Math.abs(manStep - v) < 1e-9 ? 'on' : ''}" data-act="man-step" data-v="${v}" aria-pressed="${Math.abs(manStep - v) < 1e-9}">${esc(editDimension(v))}</button>`).join('')}</span>`;
    return `<div class="edit-bar" role="toolbar" aria-label="Edit members"><b>✎ Edit members</b><span class="muted small">Drag a member to move it · click one for its actions · the arrows around it (or the arrow keys, Shift: 1") move it a step</span>
        <span class="spacer"></span>${stepRow}<span class="small">${n} by hand</span><button class="secondary small" data-act="man-unlock-all">Unlock all</button>${n ? '<button class="link small" data-act="man-lock-all">Lock all</button>' : ''}<button class="small" data-act="man-mode">Done</button>
        ${manLast ? `<div class="man-last small">${esc(manLast)}</div>` : ''}${bays.length ? bayRows(bays, sp) : ''}</div>`;
}
// Typed place and length (side A once typed).
function manualField(el) {
    const key = el.dataset.key, v = parseDimension(el.value), lay = layoutA(), m = lay?.members.find(x => x.key === key);
    if (!m) return;
    if(SK.pinned(cur(),'member:'+key)){notice('Unlock this sketch member before changing its position or length.',true);renderWorkspace();return;}
    if (v == null || (el.dataset.manF === 'len' && v <= 0)) { notice('Type a valid member dimension; length must be greater than zero.', true); renderWorkspace(); return; }
    if (m.pts && el.dataset.physical === 'true' && el.dataset.manF !== 'x') { notice('Sloped member end edits need a reviewed cut shape. Move sideways or reset this member.', true); renderWorkspace(); return; }
    const L = lay.lengthIn, physical = el.dataset.physical === 'true', axis = seatOf(m, lay.members);
    const box = el.dataset.manF === 'x' ? { x: sideB() ? L - v - m.w : v }
        : el.dataset.manF === 'y' ? { y: physical ? v + m.y - (axis?.y0 ?? m.y) : v }
        : m.orient === 'v' ? { h: physical ? m.h + v - m.lengthIn : v } : { w: v };
    if (box.h != null && box.h <= 0) { notice('This cut is shorter than the inherited seating offset. Start from a shorter source piece.', true); renderWorkspace(); return; }
    historyHint = { label: 'the place', mergeKey: `man-f:${key}:${el.dataset.manF}` };
    replacePanel(MAN.place(cur(), lay, key, box)); changed(); renderWorkspace();
}
function renderSketchMemberBar(p, f) {
    const box = document.getElementById('sketch-member-tools'), key = selectedLayoutKey(), m = f.plan?.layout?.members.find(x => x.key === key);
    if (!box) return;
    box.hidden = !m;
    if (!m) { box.innerHTML = ''; return; }
    const axis = seatOf(m, f.plan.layout.members), field = (label,k,v) => `<label>${label}<input type="text" data-man-f="${k}" data-key="${esc(key)}" data-physical="true" value="${esc(fine(v))}"></label>`;
    box.innerHTML = `<b>${esc(m.mark)} · ${esc(m.role)}</b><button class="secondary" data-sketch-pin="member:${esc(key)}" aria-pressed="${SK.pinned(p,'member:'+key)}">${SK.pinned(p,'member:'+key)?'🔒 Unlock line':'Lock line'}</button><button class="secondary" data-act="man-copy" data-key="${esc(key)}" title="Add another member like this">Copy</button>
        <button class="secondary" data-act="man-mirror" data-key="${esc(key)}">Mirror</button><button class="secondary" data-act="${MAN.isAdded(key) ? 'man-lock' : 'man-remove'}" data-key="${esc(key)}">Delete</button>
        ${field('From left','x',m.x)}${field('From bottom','y',axis?.y0 ?? m.y)}${field(m.orient === 'v' ? 'Cut height' : 'Cut length','len',m.lengthIn)}
        <button class="link" data-ctx="clear">Done</button>`;
}
// Dragging a member in the elevation (edit mode): it unlocks and goes where it is dropped (1/16" steps).
let manDrag = null;
function manualPointerDown(e) {
    const hit = e.target.closest?.('#view-elevation .member-hit[data-i]');
    if (!editMode || !hit || e.button !== 0) return;
    const svg = hit.ownerSVGElement, i = Number(hit.dataset.i), g = current.plan?.graphics?.[i], key = current.plan?.layout?.members?.[i]?.key;
    if (!g || !key) return;
    if(SK.pinned(cur(),'member:'+key)){notice('Unlock this sketch member before dragging it.',true);return;}
    const along = g.w >= g.h ? g.w : g.h, size = g.w >= g.h ? hit.width.baseVal.value : hit.height.baseVal.value;
    manDrag = { hit, svg, key, x0: e.clientX, y0: e.clientY, scale: (size - 0.06) / along, moved: false };
    hit.setPointerCapture?.(e.pointerId);
}
function manualPointerMove(e) {
    if (!manDrag) return;
    const ctm = manDrag.svg.getScreenCTM(), dx = (e.clientX - manDrag.x0) / ctm.a, dy = (e.clientY - manDrag.y0) / ctm.d;
    if (Math.hypot(e.clientX - manDrag.x0, e.clientY - manDrag.y0) > 3) manDrag.moved = true;
    if (manDrag.moved) manDrag.hit.setAttribute('transform', `translate(${dx} ${dy})`);
}
function manualPointerUp(e) {
    if (!manDrag) return;
    const d = manDrag; manDrag = null;
    if (!d.moved) return;
    const ctm = d.svg.getScreenCTM(), dxSheet = (e.clientX - d.x0) / ctm.a, dySheet = (e.clientY - d.y0) / ctm.d;
    const dx = Math.round((dxSheet / d.scale) * 16) / 16, dy = Math.round((-dySheet / d.scale) * 16) / 16;
    d.hit.removeAttribute('transform');
    if (!(dx || dy)) return;
    historyHint = { label: 'the move' };
    manualEdit((q, lay) => MAN.move(MAN.unlock(q, lay, d.key), lay, d.key, sideB() ? -dx : dx, dy), `Moved ${editDimension(Math.abs(dx))} ${dx >= 0 ? 'right' : 'left'}${dy ? `, ${editDimension(Math.abs(dy))} ${dy > 0 ? 'up' : 'down'}` : ''} (placed by hand).`);
    selectAdded(d.key); // the moved member, selected: its card to fine-tune it
}
main.addEventListener('pointerdown', manualPointerDown);
main.addEventListener('pointermove', manualPointerMove);
main.addEventListener('pointerup', manualPointerUp);
main.addEventListener('change', (e) => { if (e.target.matches?.('[data-man-f]')) manualField(e.target); });
// --- Levels and grids: context lines in the sketch (context-lines.mjs); never a member ------------------------------
// The panel's own (p.context), else the model's defaults; an edit starts from what is shown.
function contextEdit(fn) {
    const p = cur(), shown = CL.cleanContext(p.context) || (() => { const m = CL.modelContext(set, p); return { show: true, levels: { bottom: m?.levels.bottom || null, top: m?.levels.top || null }, grids: m?.grids || [] }; })();
    const c = structuredClone(shown);
    c.levels ||= { bottom: null, top: null }; c.grids ||= [];
    fn(c);
    p.context = CL.cleanContext(c) || { show: false, levels: { bottom: null, top: null }, grids: [] };
    renderContextSec(); fit(); changed();
}
function renderContextSec() {
    const p = cur(), box = $('#context-sec');
    if (!p || !box) return;
    const own = CL.cleanContext(p.context), model = CL.modelContext(set, p), c = own || { show: false, levels: model?.levels || { bottom: null, top: null }, grids: model?.grids || [] };
    const lv = (which) => {
        const l = c.levels[which] || { name: '', place: 'at', offsetIn: 0 };
        return `<div class="ctx-level"><b>${which === 'bottom' ? 'Bottom level' : 'Top level'}</b>
            <input type="text" class="mini" data-ctx-f="levels.${which}.name" value="${esc(l.name)}" placeholder="${which === 'bottom' ? 'e.g. L2' : 'e.g. L3'}" aria-label="${which} level's name">
            <span class="seg">${CL.PLACES.map(pl => `<button class="${l.place === pl ? 'on' : 'secondary'}" data-act="ctx-place" data-k="${which}" data-v="${pl}" aria-pressed="${l.place === pl}">${pl === 'at' ? 'At' : pl === 'above' ? 'Above' : 'Below'}</button>`).join('')}</span>
            ${l.place === 'at' ? '' : `<input type="text" class="mini" data-ctx-f="levels.${which}.offsetIn" value="${esc(lenText(l.offsetIn))}" aria-label="how far ${l.place}">`}
            <small class="muted">the panel's ${which}</small></div>`;
    };
    const say = model ? [model.levels.bottom && `${model.levels.bottom.name} ${model.levels.bottom.place === 'at' ? 'at the bottom' : `${CL.fmtIn(model.levels.bottom.offsetIn)} ${model.levels.bottom.place} the bottom`}`,
        model.levels.top && `${model.levels.top.name} ${model.levels.top.place === 'at' ? 'at the top' : `${CL.fmtIn(model.levels.top.offsetIn)} ${model.levels.top.place} the top`}`,
        model.grids.length && `grids ${model.grids.map(g => g.name).join(', ')}`].filter(Boolean).join(' · ') : '';
    box.innerHTML = `<label class="fd-check"><input type="checkbox" data-ctx-show ${c.show ? 'checked' : ''}> Show them in the sketch (the levels on the sheet too)</label>
        ${model ? `<p class="muted small">The model: ${esc(say)}. <button class="link" data-act="ctx-model">Use the model's</button></p>` : '<p class="muted small">Type the levels and grids (no model for this panel). Context only: they never move a member.</p>'}
        ${lv('bottom')}${lv('top')}
        <div class="ctx-grids"><b>Grids</b> <small class="muted">from the left end</small>${c.grids.map((g, i) => `<span class="ctx-grid"><input class="mini" data-ctx-f="grids.${i}.name" value="${esc(g.name)}" aria-label="Grid name"> at <input class="mini" data-ctx-f="grids.${i}.xIn" value="${esc(lenText(g.xIn))}" aria-label="Grid ${esc(g.name)} from the left end"><button class="link" data-act="ctx-grid-del" data-i="${i}" aria-label="Remove grid ${esc(g.name)}">×</button></span>`).join('')}
            <button class="secondary small" data-act="ctx-grid-add">+ Grid</button></div>`;
}
// Typed: a level's name or offset, a grid's name or place.
function contextField(el) {
    const path = el.dataset.ctxF.split('.'), v = el.value;
    contextEdit(c => {
        if (path[0] === 'levels') { const l = c.levels[path[1]] || { name: '', place: 'at', offsetIn: 0 }; if (path[2] === 'name') l.name = v; else { const n = parseDimension(v); if (n != null) l.offsetIn = Math.abs(n); } c.levels[path[1]] = l; }
        else { const g = c.grids[Number(path[1])]; if (!g) return; if (path[2] === 'name') g.name = v; else { const n = parseDimension(v); if (n != null) g.xIn = n; } }
    });
}
main.addEventListener('change', (e) => {
    if (e.target.matches?.('[data-ctx-f]')) contextField(e.target);
    else if (e.target.matches?.('[data-ctx-show]')) contextEdit(c => { c.show = e.target.checked; });
});
// The sketch's layer: each level a dash-dot line across, named at the left with where it is; each grid a dash-dot line up
// through the panel with its bubble over it.
function contextLayer(p, L, H, top, fs, t, Y) {
    const ctx = CL.contextLines(p, set);
    if (!ctx.show) return '';
    const hi = top ? Math.max(...top.map(q => q[1])) : H, out = [], x0 = -fs * 5.5, x1 = L + fs * 3;
    for (const l of ctx.levels) {
        const y = Y(l.yIn);
        out.push(`<g class="sk-level"><line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/><path d="M${x0} ${y} l${fs * 0.5} ${-fs * 0.7} h${-fs} z" class="sk-level-mark"/>
            ${t(x0 + fs * 0.9, y - fs * 0.35, l.name, { a: 'start', cls: 'sk-level-t', size: fs * 0.95 })}${t(x0 + fs * 0.9, y + fs * 1.05, l.text, { a: 'start', cls: 'sk-level-s', size: fs * 0.7 })}<title>${esc(`${l.name}: ${l.text}`)}</title></g>`);
    }
    for (const g of ctx.grids) {
        const r = fs * 0.95, yb = Y(hi) - fs * 1.6 - r;
        out.push(`<g class="sk-gridline"><line x1="${g.xIn}" y1="${Y(0) + fs}" x2="${g.xIn}" y2="${yb + r}"/><circle cx="${g.xIn}" cy="${yb}" r="${r}"/>${t(g.xIn, yb + r * 0.38, g.name, { cls: 'sk-grid-t', size: fs * 0.95 })}<title>${esc(`Grid ${g.name}: ${editDimension(g.xIn)} from the left end`)}</title></g>`);
    }
    return out.join('');
}
// The sheet's level lines (the generator's panels have no model context of their own).
const sheetContext = (p) => { const levels = CL.sheetLevels(CL.contextLines(p, set)); return levels.length ? { elev: { levels, context: [] } } : {}; };
// --- The Openings schedule: every opening's jambs, header and sill in one table, assigned like a schedule ----------
// A row per opening (check it to assign several at once); a member cell opens a picker: the rule's member (and its
// alternatives), the panel default, the standard and saved profiles, or one typed. Use the rules: every door and window
// takes the rule that covers it (its alternatives left to pick). Pure UI over the opening fields.
let schChecked = new Set(), schPick = null; // schPick: { i, k } the cell the picker is for
function openingSchedule(p) {
    if (!p?.openings?.length) return '<p class="muted">No openings yet: add one in the sketch.</p>';
    const anyRule = p.openings.some((o, i) => R.ruleFor(eng, p, i).applies);
    const cell = (i, k, st) => {
        if (!st) return '<td class="sch-na">—</td>';
        const [badge, cls] = SOURCE_BADGES[st.source];
        return `<td><button class="sch-cell ${cls}${schPick?.i === i && schPick?.k === k ? ' on' : ''}" data-act="sch-pick" data-i="${i}" data-k="${k}" title="${esc(`${st.label}: ${badge}${st.differs ? ` (rule ${st.rule.code} gives ${giveText(st.rule.gives)})` : ''}`)}">${esc(memberText(st.value))}<small>${badge}${st.differs ? ' ≠ rule' : ''}</small></button>
            ${st.arrangement.needed ? `<span class="sch-arr">${ARRANGE_WORDS[k].map(([v, label]) => `<button class="${st.arrangement.value === v ? 'on' : ''}" data-act="sch-arrange" data-i="${i}" data-k="${k}" data-v="${v}" title="${label}">${label.split(' ')[0]}</button>`).join('')}${st.arrangement.value ? '' : '<b class="arr-open">?</b>'}</span>` : ''}</td>`;
    };
    const ctx = OC.openingContexts(p, legendColors());
    const rows = p.openings.map((o, i) => {
        const r = R.ruleFor(eng, p, i), states = Object.fromEntries(R.memberStates(p, i, r.applies ? r : null).map(s => [s.member, s]));
        const rule = !r.applies ? '<span class="muted small">—</span>' : r.bound ? `<span class="sch-rule ok">${esc(r.bound.displayCode)}</span>`
            : r.status === 'matched' ? `<button class="secondary small" data-act="rule-use" data-i="${i}" data-key="${esc(r.match.KEY_ID)}" title="Use the rule that covers it">Use ${esc(r.match.displayCode)}</button>` : `<span class="sch-rule warn">${r.status === 'ambiguous' ? 'several' : 'none'}</span>`;
        const b = G.openingBox(o, G.shapeTop(p.shape).heightIn);
        return `<tr class="${sel === i ? 'selected' : ''}"><td><input type="checkbox" data-sch-check="${i}" ${schChecked.has(i) ? 'checked' : ''} aria-label="Check ${esc(G.openingName(p.openings, i))}"></td>
            <td><button class="link" data-ctx="select-opening" data-v="${esc(G.openingKeys(p)[i])}"><b class="op-name ${o.kind}">${esc(G.openingName(p.openings, i))}</b></button></td>
            <td class="small">${esc(G.OPENING_TYPES[o.kind].name)}<br>${esc(`${editDimension(b.right - b.left)}${o.kind === 'steel' ? '' : ` x ${editDimension(b.top - b.bottom)}`}`)}${ocTag(ctx[i], true)}</td><td>${rule}</td>
            ${cell(i, 'jamb', states.jamb)}${cell(i, 'head', states.head)}${cell(i, 'sill', states.sill)}</tr>`;
    }).join('');
    const n = schChecked.size;
    return `<div class="sch-bar"><span class="small">${n ? `<b>${n} checked</b>: a pick applies to all of them` : 'Click a member to change it; check rows to change several at once.'}</span>
            <span class="spacer"></span>${anyRule ? '<button class="secondary small" data-act="sch-rules" title="Every door and window takes the rule that covers it">Use the rules for all</button>' : '<button class="link small" data-act="eng-open">Open the engineering catalog for rules</button>'}</div>
        <table class="sch-table" aria-label="Openings: jambs, header and sill"><thead><tr><th><button class="link small" data-act="sch-check-all" aria-label="Check all">☐</button></th><th>Opening</th><th>Kind, size</th><th>Rule</th><th>Jambs</th><th>Header</th><th>Sill</th></tr></thead>
        <tbody>${rows}</tbody></table>${ocLegend(ctx)}${schPick ? pickerHtml(p) : ''}`;
}
// Where an opening came from, in its trade's color: the model's (its category, family and type; the UniqueId on hover),
// the model's outline, or typed here. long: the family and type on a line of their own.
function ocTag(c, long = false) {
    if (!c) return '';
    const what = c.source === 'model' ? c.tradeLabel : c.source === 'model-element' ? `${c.tradeLabel} (opening added here)` : c.source === 'model-geometry' ? 'the model\'s outline' : 'typed here';
    return `<span class="oc" title="${esc(c.title)}"><i class="oc-dot" style="background:${c.color}"></i>${esc(what)}${c.name ? (long ? `<br><span class="oc-name">${esc(c.name)}</span>` : ` · <span class="oc-name">${esc(c.name)}</span>`) : ''}</span>`;
}
function revLine(p) {
    const revs = p.revisions || [], lay = framed(p).plan?.layout;
    if (!revs.length) return '';
    const r = revs[revs.length - 1], n = lay ? RV.diffSnapshots(r.snap, RV.snapshotOf(lay)).length : 0;
    return `<p class="typ-line small"><b>Revision ${r.n}</b> (${esc(r.date)}${r.note ? `: ${esc(r.note)}` : ''})${n ? ` · <span class="warning">${n} change${n === 1 ? '' : 's'} since</span>` : ''} · <button class="link" data-act="view-compare">Compare</button></p>`;
}
function typLine(p) {
    const t = typicalOfPanel(p);
    if (!t) return '';
    return `<p class="typ-line small"><b>Typical</b>: the same framing as ${t.others.map(o => `<button class="link" data-act="open" data-id="${esc(o.id)}">${esc(o.mark)}</button>${o.hand === 'opposite' ? ' (opposite hand)' : ''}`).join(', ')}. ${t.reference ? 'Its sheet lists them.' : `One sheet can frame them all (${esc(t.group.members[0].mark)}'s).`}</p>`;
}
// An opening for a model element that has none: at its place, sized from its type when it says; selected to check.
function addOpeningFromInsert(p, uid) {
    const ins = OC.unframedInserts(p, legendColors()).find(x => x.uniqueId === uid);
    if (!ins) return;
    const { opening, sizeFrom } = OC.openingFromInsert(ins, Object.fromEntries(Object.entries(G.OPENING_TYPES).map(([k, t]) => [k, t.size])));
    p.openings.push({ id: `e${Date.now().toString(36)}`, ...opening });
    const i = p.openings.length - 1, name = G.openingName(p.openings, i), o = p.openings[i];
    changed(); selectTarget({ kind: 'opening', key: G.openingKeys(p)[i] });
    notice(`${name} added for ${ins.tradeLabel} · ${ins.name || ins.category}: ${editDimension(o.widthIn)}${o.kind === 'steel' ? ' wide' : ` x ${editDimension(o.heightIn)}`} at ${editDimension(o.leftIn)} along${o.kind === 'door' ? '' : `, ${editDimension(o.sillIn)} up`} (side A), ${sizeFrom === 'type' ? 'sized from its type name' : `the usual ${G.OPENING_TYPES[o.kind].name.toLowerCase()} size (its type name gives none)`}: check the size it needs.`);
}
function ocLegend(ctx) {
    const list = OC.tradesOf(ctx, legendColors());
    return list.length ? `<p class="oc-legend small"><span class="muted">Colors by trade (the drawing's too):</span> ${list.map(t => `<span><i class="oc-dot" style="background:${t.color}"></i>${esc(t.label)}</span>`).join(' ')}</p>` : '';
}
// The picker for one cell: what this member can be.
function pickerHtml(p) {
    const { i, k } = schPick, o = p.openings[i];
    if (!o || !G.OPENING_TYPES[o.kind].members.includes(k)) return '';
    const r = R.ruleFor(eng, p, i), row = r.applies ? r.bound || r.match : null, g = row ? R.ruleGives(row, o.kind, k) : null;
    const targets = schTargets(i, k), many = targets.length > 1, tile = (v, label, sub = '') => `<button class="sch-tile" data-act="sch-apply" data-k="${k}" data-v="${esc(v)}"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
    const choices = profileChoices(k), dflt = memberText(G.memberFor(p, { ...o, [k]: '' }, k).spec);
    return `<div class="sch-picker" role="dialog" aria-label="${esc(FD_LABELS[k])}"><div class="sch-picker-head"><b>${esc(FD_LABELS[k])}</b> for ${many ? `${targets.length} openings` : esc(G.openingName(p.openings, i))}<span class="spacer"></span><button class="link" data-act="sch-pick" data-i="-1" aria-label="Close">✕</button></div>
        ${g?.text ? `<div class="sch-group"><span class="muted small">Rule ${esc(row.displayCode)}</span>${tile('rule:', memberText(g.text), 'from the rule')}</div>` : ''}
        ${g?.choices ? `<div class="sch-group"><span class="muted small">Rule ${esc(row.displayCode)} gives one of</span>${g.choices.map(c => tile(`rule:${c}`, memberText(c), 'from the rule')).join('')}</div>` : ''}
        <div class="sch-group"><span class="muted small">Panel default</span>${tile('default:', dflt, 'as the panel gives every opening')}</div>
        <div class="sch-group"><span class="muted small">Standard</span>${choices.filter(c => !c.saved).map(c => tile(`prof:${c.id}`, c.p.name, P.describeProfile(k, c.p, p.members))).join('')}</div>
        ${choices.some(c => c.saved) ? `<div class="sch-group"><span class="muted small">Saved in this browser</span>${choices.filter(c => c.saved).map(c => tile(`prof:${c.id}`, c.p.name, P.describeProfile(k, c.p, p.members))).join('')}</div>` : ''}
        <div class="sch-group sch-type"><span class="muted small">Type a member</span><input type="text" class="mini wide" id="sch-typed" placeholder="362S162-54, or (2) 600S162-54 WITH (2) 362T125-33" list="dl-${k === 'head' ? 'header' : k}"><button class="secondary small" data-act="sch-apply" data-k="${k}" data-v="typed:">Use it</button></div></div>`;
}
// The openings a pick applies to: the checked ones that take this member (the clicked one when none is checked).
function schTargets(i, k) {
    const p = cur(), takes = (j) => !!p.openings[j] && G.OPENING_TYPES[p.openings[j].kind].members.includes(k);
    const list = schChecked.size && schChecked.has(i) ? [...schChecked].filter(takes) : [i];
    return list.filter(takes);
}
function openPicker(b) {
    const i = Number(b.dataset.i);
    schPick = i < 0 || (schPick?.i === i && schPick?.k === b.dataset.k) ? null : { i, k: b.dataset.k };
    renderBottom(current);
    main.querySelector('.sch-picker .sch-tile')?.focus();
}
function schApply(k, v) {
    const p = cur();
    if (!schPick) return;
    const targets = schTargets(schPick.i, k), [kind, arg] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
    let typed = '';
    if (kind === 'typed') { typed = (main.querySelector('#sch-typed')?.value || '').trim(); if (!typed || !G.specText(typed)) { notice('Type a member this tool reads, like 362S162-54 or (2) 600S162-54 WITH (2) 362T125-33.', true); return; } }
    let done = 0, skipped = 0;
    for (const j of targets) {
        const o = p.openings[j];
        if (kind === 'rule') { if (setFromRule(p, j, k, arg || null)) done++; else skipped++; continue; }
        if (kind === 'default') p.openings[j] = P.clearProfile(o, k);
        else if (kind === 'prof') { const prof = profileChoices(k).find(c => c.id === arg)?.p; if (!prof) continue; p.openings[j] = P.applyProfile(o, k, prof, p.members); }
        else if (kind === 'typed') { p.openings[j] = { ...o, [k]: typed }; delete p.openings[j][`${k}Style`]; }
        done++;
    }
    schPick = null;
    changed(); renderBottom(current); renderMemberCards(); renderChips();
    notice(`${FD_LABELS[k]}: ${done} opening${done === 1 ? '' : 's'} set${skipped ? `; ${skipped} not (no rule covers them, or its alternatives need a pick)` : ''}.`);
}
function schRulesAll() {
    const p = cur(), used = [], none = [];
    p.openings.forEach((o, i) => {
        const r = R.ruleFor(eng, p, i);
        if (!r.applies) return;
        if (r.status !== 'matched') { none.push(G.openingName(p.openings, i)); return; }
        try { const res = SC.applyOpeningStyle(cur(), i, eng.read, r.match); replacePanel(res.panel); used.push(`${G.openingName(p.openings, i)} ${r.match.displayCode}`); } catch { none.push(G.openingName(p.openings, i)); }
    });
    changed(); renderBottom(current); renderMemberCards(); renderChips();
    notice(`Rules used: ${used.join(', ') || 'none'}${none.length ? `. No single rule for ${none.join(', ')}: pick them.` : '.'}`);
}
main.addEventListener('change', (e) => {
    if (!e.target.matches?.('[data-sch-check]')) return;
    const i = Number(e.target.dataset.schCheck);
    if (e.target.checked) schChecked.add(i); else schChecked.delete(i);
    renderBottom(current);
});
// Commands in the bar: available or not, and their names.
function renderCommands() {
    const p = cur(), cs = W.commandState({ panels: set.panels.length, current: p, plan: current.plan, selection, history: undoHistory, modelLinked: G.isFromModel(p) });
    const undoBtn = document.getElementById('undo-btn'), redoBtn = document.getElementById('redo-btn');
    undoBtn.disabled = !cs.undo.enabled; undoBtn.title = `${cs.undo.label} (Ctrl+Z)`;
    const histBtn = document.getElementById('hist-btn'); if (histBtn) histBtn.disabled = !cs.undo.enabled;
    redoBtn.disabled = !cs.redo.enabled; redoBtn.title = `${cs.redo.label} (Ctrl+Y)`;
    const dup = document.getElementById('dup-btn');
    dup.disabled = !cs.duplicate.enabled; dup.textContent = G.isFromModel(p) ? 'Duplicate (unlinked)' : 'Duplicate';
    dup.title = G.isFromModel(p) ? 'A copy not linked to the Revit wall: its outline and openings become editable' : 'A copy of this panel';
    const pdf = document.getElementById('pdf-btn');
    if (pdf) { pdf.disabled = !cs.pdf.enabled; pdf.title = cs.pdf.reason || 'The shop drawing as a PDF'; }
    const dirtyEl = document.getElementById('dirty'), dirty = isDirty();
    dirtyEl.classList.toggle('on', dirty);
    dirtyEl.textContent = !set.panels.length ? '' : dirty ? 'Project file needs saving' : 'Project file saved';
    dirtyEl.title = 'Everything is kept in this browser as you work; Export writes a file to keep or share.';
}

// Selecting: from a view, the cut list, an issue, an opening chip or the properties. Locate: show it where it is.
function selectTarget(t, { locate = false } = {}) {
    sketchEdge = null;sketchControls.render();
    selection = t || W.NONE;
    if (t?.kind === 'opening') {
        const i = G.openingKeys(cur()).indexOf(t.key);
        if (i >= 0 && sel !== i) { sel = i; ask = null; renderCatalogue(); renderChips(); renderSketch(); }
        openSection('opening');
    } else if (t && t.kind !== 'setting' && sel != null) { sel = null; ask = null; renderCatalogue(); renderChips(); renderSketch(); }
    if (t?.kind === 'setting') { focusSetting(t.key); return; }
    if (locate && (t?.kind === 'member' || t?.kind === 'mark') && !['elevation', 'plan', '3d'].includes(prefs.view)) setView('elevation');
    if (locate && t?.kind === 'opening' && prefs.view === 'drawing') setView('sketch');
    renderWorkspace();
    // Its card is at the top of the inspector: bring it back into view there (the side panel only, never the page).
    if (t && t.kind !== 'opening' && !matchMedia('(max-width: 1180px)').matches) $('#inspector').scrollTo({ top: 0, behavior: 'smooth' });
    if (locate) requestAnimationFrame(() => main.querySelector('.view:not([hidden]) .member-hit.selected, .view:not([hidden]) .op-chip.on')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }));
}
// The opening chosen in the sketch or the chips is the workspace's selection too.
function syncOpeningSelection() {
    const p = cur();
    if (!p) return;
    const keys = G.openingKeys(p);
    // A newly selected opening opens its editor (Openings); closing that section again is respected until the next one.
    if (sel != null && keys[sel]) { if (selection.kind !== 'opening' || selection.key !== keys[sel]) { selection = { kind: 'opening', key: keys[sel] }; openSection('opening'); scheduleWorkspace(); } }
    else if (selection.kind === 'opening') { selection = W.NONE; scheduleWorkspace(); }
    const sum = document.getElementById('opening-sum');
    if (sum) sum.textContent = sel != null && p.openings[sel] ? `Opening ${G.openingName(p.openings, sel)}` : 'Openings';
}
function openSection(name) { const d = main.querySelector(`.insp-sec[data-sec="${name}"]`); if (d && !d.open) d.open = true; }
// Locate a setting: open its section, show it and put the cursor on it.
function focusSetting(key) {
    revealInspector();
    const targets = { members: ['members', '[data-pick="members.stud"], [data-f="members.stud"]'], 'members.stud': ['members', '[data-pick="members.stud"], [data-f="members.stud"]'],
        'members.track': ['members', '[data-pick="members.track"]'], 'members.topTrack': ['members', '[data-pick="members.topTrack"]'],
        'members.spacingIn': ['members', '[data-pick="members.spacingIn"], [data-f="members.spacingIn"]'], 'style.wall': ['members', '[data-style="wall"]'],
        layoutStartIn: ['layout', '[data-f="layoutStartIn"]'], shape: ['panel', '#elev-head [data-f]'] };
    const op = /^opening-style:(.+)$/.exec(key);
    if (op) { selectTarget({ kind: 'opening', key: op[1] }); requestAnimationFrame(() => { const el = main.querySelector('[data-style="op"]'); el?.scrollIntoView({ block: 'center' }); el?.focus(); }); return; }
    const [sec, q] = targets[key] || ['members', '#core-strip select, #core-strip input'];
    openSection(sec);
    requestAnimationFrame(() => { const el = main.querySelector(q); if (!el) return; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus({ preventScroll: true }); el.closest('.mcard, label, .layout-group')?.classList.add('flash'); setTimeout(() => el.closest('.flash')?.classList.remove('flash'), 1500); });
}
// A command an issue or the properties offer (workspace.mjs issueActions).
function runCommand(cmd, arg) {
    if (cmd === 'select') selectTarget(arg, { locate: true });
    else if (cmd === 'focus-setting') focusSetting(arg);
    else if (cmd === 'open-framing') { const i = G.openingKeys(cur()).indexOf(arg); if (i >= 0) openFraming(i); }
    else if (cmd === 'toggle-optimizer') { cur().optimizeOpenings = true; historyHint = { label: 'the opening optimizer' }; renderLayoutSec(); changed(); notice('Opening optimizer on: the studs on center start where every bay is within the spacing, with the fewest pieces.'); }
    else if (cmd === 'open-catalog') openCatalog();
    else if (cmd === 'set-view') setView(arg);
}

// --- Stud layout, stud facing (physical) and the viewing side (drawing only) kept apart -----------------------------
function renderLayoutSec() {
    const p = cur(), box = $('#layout-sec');
    if (!p || !box) return;
    const flips = (p.studFlips || []).length, intent = current.plan?.intent?.layout;
    box.innerHTML = `<div class="layout-group"><h4>Stud layout <span class="muted">where the studs on center go</span></h4>
            <div class="row seg-inline" role="group" aria-label="Start the layout from"><span class="muted">Start from</span>
                <button data-act="layout-from" data-side="left" aria-pressed="${!p.layoutFromRight}">Left end</button><button data-act="layout-from" data-side="right" aria-pressed="${!!p.layoutFromRight}">Right end</button></div>
            <label class="opt-toggle${p.optimizeOpenings ? ' on' : ''}" title="Start the studs on center where the openings take the fewest stud pieces (every bay within the spacing)">
                <input type="checkbox" data-f="optimizeOpenings" ${p.optimizeOpenings ? 'checked' : ''}><span>Opening optimizer</span><small id="opt-info"></small></label>
            <div class="row">${field('First stud at (from the start end)', 'layoutStartIn', p.layoutStartIn, { t: 'len', list: 'len', ph: intent ? `${inch(intent.startIn)} (${intent.startSource})` : 'automatic' })}
                ${p.layoutStartIn ? '<button class="link" data-act="layout-reset">Automatic</button>' : ''}</div></div>
        <div class="layout-group"><h4>Stud facing <span class="muted">which way the studs' webs face: physical</span></h4>
            <label class="fd-check"><input type="checkbox" data-f="flipStuds" ${p.flipStuds ? 'checked' : ''}> Flip every stud on center (end studs and jambs still close their side)</label>
            <p class="muted">${flips ? `${flips} stud${flips === 1 ? '' : 's'} flipped one by one <button class="link" data-act="flips-clear">Clear them</button>` : 'No stud flipped one by one.'} Select a stud (elevation, plan or cut list) to flip just that one.</p></div>
        <div class="layout-group"><h4>Cutback &amp; top gap <span class="muted">where studs meet tracks, headers and sills</span></h4>
            <div class="row">${field('Cut back', 'cutbackIn', G.cutbackOf(p) ?? '', { t: 'cut', ph: '1/16" (the engine\'s seat)' })}
                ${set.panels.length > 1 ? '<button class="link" data-act="cutback-all" title="The same cutback on every panel in the set">Every panel</button>' : ''}</div>
            <p class="muted small">Cut lengths floor to 1/8". ${Number(p.deflectionGapIn)>0 ? `Top gap ${fine(p.deflectionGapIn)} replaces the top cutback; lower pieces keep cutback.` : 'No top deflection gap: ordinary cutback applies.'} New panels start at 1/32"; absent cutback uses 1/16".</p>
            <p class="small">${(() => { const f = fsOf(p); return `Cripples and jacks: <b>${f.seatPieces ? 'seated in the tracks' : 'clear span'}</b> · headers: <b>${f.headEnds === 'flush' ? `flush (${fine(f.headCutbackIn)} each end)` : 'overlap the jambs'}</b> · sills: <b>${f.sillEnds === 'flush' ? `flush (${fine(f.sillCutbackIn)} each end)` : 'overlap the jambs'}</b>`; })()}
                <button class="link small" data-act="set-open" data-v="framing">Change for every panel</button></p></div>
        <p class="muted small">The viewing side (A or B, over the views) changes the drawing only: never a member.</p>`;
    renderLayoutInfo();
}
// The sheet's switches as the panel has them (kept for older callers).
function syncToggles() { renderLayoutSec(); }

// --- History: undo and redo over the whole set (workspace.mjs), the file state -------------------------------------
let undoHistory = W.newHistory();
let historyHint = null; // { label, mergeKey } for the next commit
let lastSnapshot = null;
// The whole document for undo: the model's grids and levels and the framing by model type too (an undo used to drop them).
const snapshotOf = () => JSON.stringify({ project: set.project, drawnBy: set.drawnBy, ...Object.fromEntries(G.SET_FIELDS.map(k => [k, set[k]])), extra: set.extra, panels: set.panels });
function commit(label = null) {
    const snap = snapshotOf();
    if (lastSnapshot != null && snap !== lastSnapshot) {
        const hint = historyHint || (drag ? { label: 'the move', mergeKey: `drag:${dragSeq}` } : { label: label || 'the last change' });
        undoHistory = W.record(undoHistory, lastSnapshot, hint.label, hint.mergeKey ?? null);
    }
    lastSnapshot = snap;
    historyHint = null;
}
let dragSeq = 0;
function applySnapshot(snap) {
    const s = JSON.parse(snap), keep = set.current;
    set = { ...s, panels: s.panels.map(G.cleanPanel), current: s.panels.some(p => p.id === keep) ? keep : s.panels[0]?.id ?? null };
    lastSnapshot = snap;
    sel = null; ask = null; selection = W.NONE; stylePending = null; checked.clear();
    save(); renderAll(true);
}
function doUndo() { const r = W.undo(undoHistory, lastSnapshot); if (!r.snapshot) return; undoHistory = r.history; applySnapshot(r.snapshot); notice(`Undone: ${r.label}.`); }
function doRedo() { const r = W.redo(undoHistory, lastSnapshot); if (!r.snapshot) return; undoHistory = r.history; applySnapshot(r.snapshot); notice(`Redone: ${r.label}.`); }
const hashOf = (s) => sha256Hex(s || '');
const isDirty = () => !!set.panels.length && load(KEYS.saved, null) !== hashOf(lastSnapshot ?? snapshotOf());
const markExported = () => { store(KEYS.saved, hashOf(lastSnapshot ?? snapshotOf())); renderCommands(); };

// --- Remembered presentation (never data) ------------------------------------------------------------------------------
function storePrefs() { store(KEYS.prefs, prefs); }
function toggleNavigator() {
    if (focusView) { focusView = false; prefs.navCollapsed = false; main.classList.add('nav-open'); }
    else if (matchMedia('(max-width: 820px)').matches) main.classList.toggle('nav-open');
    else prefs.navCollapsed = !prefs.navCollapsed;
    storePrefs(); applyPrefs();
}
function revealInspector() {
    if (!focusView && !prefs.inspectorCollapsed) return;
    focusView = false; prefs.inspectorCollapsed = false; storePrefs(); applyPrefs();
}
function applyPrefs() {
    main.classList.toggle('focus-view', focusView);
    main.classList.toggle('nav-collapsed', !!prefs.navCollapsed);
    main.classList.toggle('inspector-collapsed', prefs.inspectorCollapsed);
    const navShown = !focusView && (matchMedia('(max-width: 820px)').matches ? main.classList.contains('nav-open') : !prefs.navCollapsed);
    for (const button of main.querySelectorAll('[data-act="nav-toggle"], [data-act="layout-nav"]')) button.setAttribute('aria-expanded', String(navShown));
    for (const button of main.querySelectorAll('[data-act="inspector-toggle"]')) button.setAttribute('aria-expanded', String(!focusView && !prefs.inspectorCollapsed));
    const focusButton = main.querySelector('[data-act="focus-view"]');
    focusButton?.setAttribute('aria-pressed', String(focusView));
    if (focusButton) focusButton.textContent = focusView ? '⛶ Restore layout' : '⛶ Focus view';
    for (const d of main.querySelectorAll('.insp-sec')) if (prefs.sections[d.dataset.sec] != null) d.open = prefs.sections[d.dataset.sec];
    for (const v of main.querySelectorAll('.view')) v.hidden = v.dataset.view !== prefs.view;
}
matchMedia('(max-width: 820px)').addEventListener('change', applyPrefs);
document.addEventListener('click', event => { const more = document.querySelector('.header-more[open]'); if (more && !more.contains(event.target)) more.open = false; });
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]') || event.target.matches('input, select, textarea')) return;
    const more = document.querySelector('.header-more[open]'); if (more) more.open = false;
    if (focusView && tool === 'select') { focusView = false; applyPrefs(); }
});

// --- Empty project ---------------------------------------------------------------------------------------------------
function renderEmpty() {
    main.classList.add('ws-is-empty');
    selection = W.NONE; current = { panel: null, plan: null, layout: null, errors: [], notes: [] };
    renderSet();
    for (const v of main.querySelectorAll('.view')) v.hidden = true;
    let empty = main.querySelector('#ws-empty');
    if (!empty) { empty = Object.assign(document.createElement('div'), { id: 'ws-empty', className: 'ws-empty' }); main.querySelector('.views').append(empty); }
    empty.hidden = false;
    empty.innerHTML = `<h2>No panels yet</h2><p>Add a panel and draw or type it, or import a set: a JSON file exported here before, or a model's panels exported from Revit.</p>
        <div class="row"><button data-act="new">+ New panel</button><button class="secondary" data-act="set-import">Import a set (JSON)</button></div>`;
    $('#insp-context').innerHTML = '<div class="ctx-card"><h3>No panel</h3><p class="muted">Properties appear here for the panel you open.</p></div>';
    $('#pv-check').innerHTML = '';
    renderCommands();
}
function leaveEmpty() { main.classList.remove('ws-is-empty'); const e = main.querySelector('#ws-empty'); if (e) e.hidden = true; applyPrefs(); }

// --- Engineering styles: the catalog, the project's selection, a panel's wall style and its doors' and windows' -------
function loadEngineering() {
    const raw = load(KEYS.engineering, null);
    if (!raw?.text) return null;
    try {
        const read = SC.readStyleCatalog(raw.text);
        let selection;
        try { selection = raw.selection ? SC.readSelection(raw.selection) : SC.newSelection(read); } catch { selection = SC.newSelection(read); }
        if (selection.catalog.catalogId !== read.catalog.catalogId) selection = SC.newSelection(read);
        return { text: raw.text, read, selection };
    } catch { return null; }
}
function saveEngineering() {
    try { if (eng) localStorage.setItem(KEYS.engineering, JSON.stringify({ text: eng.text, selection: eng.selection })); else localStorage.removeItem(KEYS.engineering); }
    catch { notice('The catalog is too large to keep in this browser: it stays open until you leave the page.', true); }
}
const engineeringFor = () => (eng ? { read: eng.read, selection: eng.selection } : null);
const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const ENGINEERING_STATES = { 'not-reviewed': ['Engineering: not from approved styles', ''], 'catalog-bound': ['Engineering: catalog styles, not approved', 'bound'], 'selection-approved': ['Engineering: approved project styles', 'ok'] };
function engineeringBadge(p, plan) {
    if (!eng && !p.style) return '';
    const [text, cls] = ENGINEERING_STATES[plan?.states?.engineering] || ENGINEERING_STATES['not-reviewed'];
    return ` <span class="eng-badge ${cls}" title="Whether the members come from the engineering catalog's styles, reviewed and approved for this project (a record of people checking the catalog, not a structural check)">${esc(text)}</span>`;
}
const ftText = (ft) => (Number.isFinite(ft) && ft > 0 ? formatLength(ft) : '—');
function conditionsText(s) {
    const t = (k) => SC.textOf(s.conditions, k), f = (k) => SC.feetOf(s.conditions, k);
    if (s.styleType === 'Wall') return `${t('Finish')} · ${SC.wallDepthCode(s) || '?'} · up to ${ftText(f('MaximumHeightFeet'))}`;
    if (s.styleType === 'Ceiling') return `${t('CeilingType')} ${t('Finish')} · span up to ${ftText(f('MaximumSpanFeet'))}`;
    return `W ${ftText(f('MinimumOpeningWidthFeet')) === '—' ? '0' : ftText(f('MinimumOpeningWidthFeet'))} to ${ftText(f('MaximumOpeningWidthFeet'))} · wall ≤ ${ftText(f('MaximumWallHeightFeet'))} · above ≤ ${ftText(f('MaximumHeightAboveOpeningFeet'))} · ${t('WallStyleKey') ? `wall style ${t('WallStyleKey')}` : `${t('DepthCode') || 'any'} ${t('Finish')}`}`;
}
function outputsText(s) {
    const t = (k) => SC.textOf(s.outputs, k).replace(/\s+/g, ' '), f = (k) => SC.feetOf(s.outputs, k);
    if (s.styleType === 'Wall') return `${t('StudText')} @ ${Number.isFinite(f('SpacingFeet')) ? `${Math.round(f('SpacingFeet') * 12 * 100) / 100}"` : '?'} · track ${t('BottomTrackText')} · top ${t('TopTrackText')}`;
    if (s.styleType === 'Ceiling') return `grid ${t('GridMemberText')} · perimeter ${t('PerimeterMemberText')}`;
    return `HDR ${t('HeaderText')} · JMB ${t('JambText')} · SIL ${t('SillText')}`;
}
function catalogDialog() {
    let d = document.getElementById('eng-dialog');
    if (d) return d;
    d = Object.assign(document.createElement('dialog'), { id: 'eng-dialog', className: 'eng-dialog' });
    document.body.append(d);
    d.addEventListener('click', engClick);
    d.addEventListener('change', engChange);
    d.addEventListener('input', engInput);
    return d;
}
function openCatalog() { renderCatalog(); const d = catalogDialog(); if (!d.open) d.showModal(); }
function renderCatalog() {
    const d = catalogDialog(), reviewer = load(KEYS.reviewer, '');
    if (!eng) {
        d.innerHTML = `<div class="eng"><div class="eng-head"><b>Engineering catalog</b><span class="spacer"></span><button class="link" data-eng="close" aria-label="Close">✕</button></div>
            <p>Open the catalog JSON the native Engineering Catalog keeps (CAS_FRAMING.Core StyleCatalog, schema 1). It is read here and never changed: pick the
                project's styles from it, review and approve them, and pick a panel's wall style and its doors' and windows' styles from that subset.</p>
            <div class="row"><button data-eng="open-catalog">Open a catalog (.json)…</button></div></div>`;
        return;
    }
    const r = eng.read, c = r.catalog, sel = eng.selection, check = SC.checkSelection(r, sel), inSel = new Map(sel.styles.map(e => [e.keyId, e]));
    const q = engView.search.trim().toLowerCase();
    const rows = c.styles.filter(s => s.styleType === engView.tab && (!q || [s.displayCode, SC.textOf(s.conditions, 'Mark'), conditionsText(s), outputsText(s)].join(' ').toLowerCase().includes(q)))
        .sort((a, b) => SC.ordinalIgnoreCase(a.displayCode, b.displayCode) || (a.KEY_ID < b.KEY_ID ? -1 : 1));
    const status = (s) => check.styles.find(x => x.keyId === s.KEY_ID)?.status;
    const approval = sel.approval.state === 'approved'
        ? (check.approved ? `<span class="eng-badge ok">Approved by ${esc(sel.approval.by)} · ${esc(sel.approval.atUtc.slice(0, 10))}${sel.approval.reference ? ` · ${esc(sel.approval.reference)}` : ''}</span>` : '<span class="eng-badge warn">The approval no longer holds: approve again</span>')
        : '<span class="eng-badge">Not approved</span>';
    d.innerHTML = `<div class="eng">
        <div class="eng-head"><b>Engineering catalog</b><span class="muted small">revision ${c.revision} · ${c.styles.length} styles · <span title="${esc(r.sha256)}">SHA-256 ${esc(r.sha256.slice(0, 10))}…</span></span>
            <span class="spacer"></span><button class="link" data-eng="close" aria-label="Close">✕</button></div>
        <div class="muted small">${c.sources.map(s => `${esc(s.tableName)} · ${esc(s.version)} · imported ${esc(s.importedUtc.slice(0, 10))}`).join(' | ')}${r.ignored.length ? ` · ${r.ignored.length} unknown field${r.ignored.length === 1 ? '' : 's'} skipped` : ''}</div>
        <div class="row eng-actions"><button class="secondary" data-eng="open-catalog">Open another catalog…</button><button class="secondary" data-eng="open-selection">Open a selection…</button>
            <button class="secondary" data-eng="export-selection">Export the selection</button><span class="spacer"></span><button class="link danger" data-eng="close-catalog">Close the catalog</button></div>
        <div class="row eng-sel"><label>Project <input type="text" data-eng-f="project" value="${esc(sel.project)}" placeholder="Project name"></label>
            <span>${sel.styles.length} style${sel.styles.length === 1 ? '' : 's'} in the project · ${approval}</span>
            <label>Your name (reviews) <input type="text" data-eng-f="reviewer" value="${esc(reviewer)}" placeholder="Who reviews"></label></div>
        ${check.issues.length ? `<ul class="plan-notes">${check.issues.map(i => `<li class="${i.severity}">${esc(i.message)}</li>`).join('')}</ul>` : ''}
        <div class="row eng-tabs">${SC.STYLE_TYPES.map(t => `<button class="${t === engView.tab ? '' : 'secondary'}" data-eng="tab" data-v="${t}">${t} (${c.styles.filter(s => s.styleType === t).length})</button>`).join('')}
            <input type="text" data-eng-f="search" placeholder="Search a code, a finish, a member…" value="${esc(engView.search)}" aria-label="Search styles"></div>
        <div class="eng-table"><table><thead><tr><th>Project</th><th>Style</th><th>Conditions</th><th>Gives</th><th>Review</th></tr></thead><tbody>
            ${rows.map(s => { const e = inSel.get(s.KEY_ID), st = status(s); return `<tr class="${s.isDeleted ? 'deleted' : ''}">
                <td><input type="checkbox" data-eng="include" data-v="${s.KEY_ID}" ${e ? 'checked' : ''} ${s.isDeleted && !e ? 'disabled' : ''} aria-label="${esc(s.displayCode)} in the project"></td>
                <td><b>${esc(s.displayCode)}</b><br><small class="muted" title="KEY_ID ${esc(s.KEY_ID)}">rev ${s.revision}${s.isDeleted ? ' · deleted' : ''}${st && st !== 'current' ? ` · ${esc(st)}` : ''}</small></td>
                <td class="small">${esc(conditionsText(s))}</td><td class="small">${esc(outputsText(s))}</td>
                <td>${e ? `<select data-eng="review" data-v="${s.KEY_ID}" aria-label="Review of ${esc(s.displayCode)}">${SC.REVIEW_STATES.map(x => `<option ${x === e.review.state ? 'selected' : ''}>${x}</option>`).join('')}</select>${e.review.by ? `<br><small class="muted">${esc(e.review.by)} · ${esc(e.review.atUtc.slice(0, 10))}</small>` : ''}` : ''}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No styles here.</td></tr>'}
        </tbody></table></div>
        <div class="row eng-approve"><label>Approved by <input type="text" data-eng-f="approver" value="${esc(engView.approver ?? reviewer)}"></label>
            <label>Reference <input type="text" data-eng-f="reference" value="${esc(engView.reference)}" placeholder="a transmittal or letter"></label><button data-eng="approve">Approve the selection</button>
            <span class="muted small">Records who approved this project's styles, against this catalog revision. Not a structural check by this tool, not an engineer's stamp.</span></div>
    </div>`;
}
function afterEngineering() { stylePending = null; renderMemberCards(); refresh(true); }
function pickText(accept, then) {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.addEventListener('change', async () => { const f = input.files?.[0]; if (f) then(await f.text(), f.name); });
    input.click();
}
function loadCatalogText(text, name) {
    try {
        const read = SC.readStyleCatalog(text);
        const keep = eng && eng.read.catalog.catalogId === read.catalog.catalogId ? eng.selection : SC.newSelection(read, { project: set.project || '' });
        eng = { text, read, selection: keep };
        saveEngineering(); renderCatalog(); afterEngineering();
        notice(`${name}: catalog revision ${read.catalog.revision}, ${read.catalog.styles.length} styles${keep.styles.length ? ` (the project's ${keep.styles.length} kept, checked again)` : ''}.`);
    } catch (err) { notice(`${name}: ${err.message} Nothing was loaded.`, true); }
}
function loadSelectionText(text, name) {
    try {
        const s = SC.readSelection(text);
        if (s.catalog.catalogId !== eng.read.catalog.catalogId) throw new Error('This selection was made for another catalog.');
        eng = { ...eng, selection: s }; saveEngineering(); renderCatalog(); afterEngineering();
        notice(`${name}: ${s.styles.length} project style${s.styles.length === 1 ? '' : 's'}.`);
    } catch (err) { notice(`${name}: ${err.message}`, true); }
}
function engClick(e) {
    const b = e.target.closest('[data-eng]');
    if (!b) { if (e.target === catalogDialog()) catalogDialog().close(); return; }
    const a = b.dataset.eng;
    if (a === 'close') catalogDialog().close();
    else if (a === 'open-catalog') pickText('.json,application/json', loadCatalogText);
    else if (a === 'open-selection') pickText('.json,application/json', loadSelectionText);
    else if (a === 'export-selection') download(JSON.stringify(eng.selection, null, 2), `style-selection-${fileName(eng.selection.project || set.project || 'project')}-${today()}.json`, 'application/json');
    else if (a === 'close-catalog') { eng = null; saveEngineering(); renderCatalog(); afterEngineering(); notice('Catalog closed: panels keep their style bindings (shown as not checked).'); }
    else if (a === 'tab') { engView.tab = b.dataset.v; renderCatalog(); }
    else if (a === 'approve') {
        try {
            eng.selection = SC.approveSelection(eng.selection, eng.read, { by: engView.approver ?? load(KEYS.reviewer, ''), atUtc: nowUtc(), reference: engView.reference });
            saveEngineering(); renderCatalog(); afterEngineering(); notice('The project selection is approved (recorded with this catalog revision).');
        } catch (err) { notice(err.message, true); }
    }
}
function engChange(e) {
    const el = e.target, a = el.dataset.eng;
    if (a !== 'include' && a !== 'review') return;
    try {
        if (a === 'include') eng.selection = el.checked ? SC.includeStyle(eng.selection, eng.read, el.dataset.v) : SC.excludeStyle(eng.selection, el.dataset.v);
        else eng.selection = SC.reviewStyle(eng.selection, eng.read, el.dataset.v, { state: el.value, by: load(KEYS.reviewer, ''), atUtc: nowUtc() });
    } catch (err) { notice(/who made it/.test(err.message) ? 'Type your name (reviews) first: a review records who made it.' : err.message, true); }
    saveEngineering(); renderCatalog(); afterEngineering();
}
function engInput(e) {
    const f = e.target.dataset.engF;
    if (!f) return;
    if (f === 'search') { const at = e.target.selectionStart; engView.search = e.target.value; renderCatalog(); const s = catalogDialog().querySelector('[data-eng-f="search"]'); s.focus(); s.setSelectionRange(at, at); }
    else if (f === 'project') { eng.selection = { ...eng.selection, project: e.target.value }; saveEngineering(); }
    else if (f === 'reviewer') store(KEYS.reviewer, e.target.value);
    else if (f === 'approver') engView.approver = e.target.value;
    else if (f === 'reference') engView.reference = e.target.value;
}
// A panel's wall style: the tables' pick for its core, finish and height first, the project's other wall styles after.
function wallStyleStrip(p) {
    if (!eng) return p.style ? `<div class="style-strip"><b>Wall style</b> <span>${esc(p.style.displayCode)}</span><span class="muted small">bound; open the Engineering catalog to check it</span></div>` : '';
    const r = eng.read, rows = SC.projectStyles(r, eng.selection, 'Wall').map(s => s.row), q = SC.wallQuery(p), m = SC.matchWallStyle(rows, q);
    const bound = p.style ? SC.rowById(r, p.style.keyId) : null, picks = new Set((m.status === 'matched' ? [m.match] : m.status === 'ambiguous' ? m.candidates : []).map(x => x.KEY_ID));
    const label = (s) => `${s.displayCode} · up to ${ftText(SC.feetOf(s.conditions, 'MaximumHeightFeet'))} · ${outputsText(s).split(' · ')[0]}`;
    const opt = (s) => `<option value="${s.KEY_ID}" ${bound?.KEY_ID === s.KEY_ID ? 'selected' : ''}>${esc(label(s))}</option>`;
    const finishes = [...new Set(rows.map(s => SC.textOf(s.conditions, 'Finish')).filter(Boolean))].sort(SC.ordinalIgnoreCase);
    const depths = [...new Set(rows.map(SC.wallDepthCode).filter(Boolean))].sort();
    const say = !rows.length ? 'No wall styles in the project yet: pick them in Engineering catalog…' : m.status === 'matched' ? `The tables pick ${m.match.displayCode}.` : m.detail;
    return `<div class="style-strip"><b>Wall style</b>
        <label>Finish <select data-style-q="finish"><option value="">Pick…</option>${finishes.map(f => `<option ${f === q.finish ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
        ${q.coreDepthIn ? '' : `<label>Core <select data-style-q="depthCode"><option value="">Pick…</option>${depths.map(x => `<option ${x === q.depthCode ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>`}
        <select data-style="wall" aria-label="Wall style"><option value="">None (members picked here)</option>
            ${picks.size ? `<optgroup label="The tables pick">${rows.filter(s => picks.has(s.KEY_ID)).map(opt).join('')}</optgroup>` : ''}
            ${rows.some(s => !picks.has(s.KEY_ID)) ? `<optgroup label="Other project styles">${rows.filter(s => !picks.has(s.KEY_ID)).map(opt).join('')}</optgroup>` : ''}
            ${bound && !rows.some(s => s.KEY_ID === bound.KEY_ID) ? `<optgroup label="Bound, not in the project">${opt(bound)}</optgroup>` : ''}
            ${p.style && !bound ? `<option value="${esc(p.style.keyId)}" selected>${esc(p.style.displayCode)} (not in this catalog)</option>` : ''}</select>
        <span class="muted small">${esc(say)}</span>${pendingChoices(p, 'wall')}</div>`;
}
const STYLE_LABELS = { stud: 'On-center studs', track: 'Bottom track', topTrack: 'Top track', spacingIn: 'Spacing', head: 'Header', jamb: 'Jambs', sill: 'Sill' };
function pendingChoices(p, scope) {
    const s = stylePending;
    if (!s || s.panelId !== p.id || s.scope !== scope) return '';
    return `${s.open.map(o => `<label class="style-pick">${STYLE_LABELS[o.key]}: one of <select data-style-pick="${o.key}"><option value="">Pick…</option>${o.choices.map(c => `<option ${s.picked?.[o.key] === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`).join('')}
        ${s.problems.length ? `<ul class="plan-notes">${s.problems.map(x => `<li class="warning">${esc(x.message)} The ${STYLE_LABELS[x.key].toLowerCase()} stays as picked here.</li>`).join('')}</ul>` : ''}`;
}
function replacePanel(next) { const i = set.panels.findIndex(x => x.id === next.id); set.panels[i] = next; }
function styleChange(el) {
    const p = cur();
    if (el.dataset.styleQ) { p.styleQuery = { finish: '', depthCode: '', ...(p.styleQuery || {}), [el.dataset.styleQ]: el.value }; renderMemberCards(); changed(); return; }
    const scope = el.dataset.stylePick ? stylePending?.scope : el.dataset.style === 'wall' ? 'wall' : Number(el.dataset.i);
    const keyId = el.dataset.stylePick ? stylePending?.keyId : el.value;
    if (!keyId) { // None: the members stay, now the user's
        if (scope === 'wall') { delete p.style; if (p.provenance) for (const k of Object.keys(p.provenance)) if (p.provenance[k] === 'style') p.provenance[k] = 'user'; }
        else delete p.openings[scope].style;
        stylePending = null; renderMemberCards(); changed(); return;
    }
    const row = SC.rowById(eng.read, keyId);
    if (!row) return;
    const picked = el.dataset.stylePick ? { ...(stylePending.picked || {}), [el.dataset.stylePick]: el.value } : {};
    try {
        const res = scope === 'wall' ? SC.applyWallStyle(p, eng.read, row, picked) : SC.applyOpeningStyle(p, scope, eng.read, row, picked);
        replacePanel(res.panel);
        if (scope !== 'wall') ask = null; // its members are given now
        stylePending = res.open.length || res.problems.length ? { scope, panelId: p.id, keyId, open: res.open, problems: res.problems, picked } : null;
        renderMemberCards(); changed();
        if (!el.dataset.stylePick) notice(`${row.displayCode} applied${res.open.length ? `: pick ${res.open.map(o => STYLE_LABELS[o.key].toLowerCase()).join(' and ')} (the style gives alternatives)` : ''}.`);
    } catch (err) { notice(err.message, true); }
}

// --- The set: every panel here, checked ones for PDF / members / delete -------------------------------------------------
// --- The navigator: the set's panels (find, check, open), the set's fields and actions --------------------------------
let navQuery = '';
function renderSet() {
    const box = $('#set-card'), toggle = main.querySelector('.nav-toggle');
    if (toggle) toggle.textContent = `◧ Panels (${set.panels.length})${cur() ? ` · ${cur().mark}` : ''}`;
    const groups = [...new Set(set.panels.map(p => p.group || ''))].sort();
    const q = navQuery.trim().toLowerCase();
    const shown = set.panels.filter(p => !q || [p.mark, p.group, p.wallType, p.level].join(' ').toLowerCase().includes(q));
    const byGroup = new Map();
    for (const p of shown) { const g = p.group || ''; (byGroup.get(g) || byGroup.set(g, []).get(g)).push(p); }
    const typ = typicals();
    const item = (p) => {
        const { errors, layout, plan } = framed(p), on = p.id === cur()?.id, open = openChoices(plan).length;
        const state = errors.length ? '<span class="check-failed">Not framed</span>' : layout.issues.length ? '<span class="check-failed">Check failed</span>'
            : open ? `<span class="eng-badge warn">Preliminary (${open})</span>` : '<span class="check-passed">✓ Framed</span>';
        return `<li class="nav-item ${on ? 'on' : ''}"><label class="set-check"><input type="checkbox" data-check="${esc(p.id)}" ${checked.has(p.id) ? 'checked' : ''} aria-label="Check ${esc(p.mark)}"></label>
            <button class="nav-open" data-act="open" data-id="${esc(p.id)}" title="${esc(`Open ${p.mark}${p.wallType ? ` · ${p.wallType}` : ''}`)}" ${on ? 'aria-current="true"' : ''}>
                <span class="thumb">${layout ? thumbnailSvg(layout) : ''}</span><b>${esc(p.mark)}${G.isFromModel(p) ? ' 🔒' : ''}</b>
                <span class="muted">${layout ? `${editDimension(layout.lengthIn)} x ${editDimension(layout.heightIn)}` : esc(G.SHAPES.find(k => k.kind === p.shape.kind)?.name || '')} · ${esc(G.openingsSummary(p.openings))}</span>
                <span class="nav-state">${state}${typBadge(p, typ)}</span></button></li>`;
    };
    const fx = focusOf(box);
    const projectOpen = !!box.querySelector('[data-nav-project][open]');
    box.innerHTML = `${set.panels.length ? `<input type="search" class="nav-search" data-nav-search placeholder="Find a panel…" value="${esc(navQuery)}" aria-label="Find a panel">
        <div class="nav-actions"><button class="link" data-act="set-check-all">Check all</button><button class="link" data-act="set-check-none">Check none</button>
            ${groups.some(Boolean) ? `<select id="check-group" aria-label="Check a group"><option value="__">Check a group…</option>${groups.map(g => `<option value="${esc(g)}">${esc(g || '(no group)')}</option>`).join('')}</select>` : ''}</div>
        <div>${[...byGroup].map(([g, list]) => `${groups.length > 1 ? `<div class="nav-group">${esc(g || 'No group')}</div>` : ''}<ul class="nav-list">${list.map(item).join('')}</ul>`).join('') || '<p class="muted small">No panel matches.</p>'}</div>
        <div id="set-actions" class="nav-actions"></div>
        <div class="nav-actions"><button class="secondary" data-act="set-open" title="Every panel at a glance, the set's cut list and stock, labels and the set PDF">Set overview, stock, labels</button></div>` : '<p class="nav-empty muted">No panels yet.</p>'}
        <details class="nav-project" data-nav-project ${projectOpen ? 'open' : ''}><summary>Project details</summary><div class="fields">${field('Project', 'set.project', set.project, { r: 'project', list: 'project', ph: 'Project name' })}
            ${field('Drawn by', 'set.drawnBy', set.drawnBy, { r: 'drawnBy', list: 'drawnBy', ph: 'Your name' })}</div></details>
        ${set.panels.length ? '<section id="nav-export" class="nav-export" aria-labelledby="nav-export-title"></section>' : ''}`;
    renderSetActions();
    restoreFocus(box, fx);
}
// A field being typed in keeps its place (and the caret) when its card is drawn again under it.
function focusOf(box) {
    const a = document.activeElement;
    if (!a || !box?.contains(a) || !a.matches('input, select, textarea')) return null;
    const sel = a.dataset.f ? `[data-f="${a.dataset.f}"]` : a.matches('[data-nav-search]') ? '[data-nav-search]' : a.id ? `#${a.id}` : null;
    return sel ? { sel, start: a.selectionStart, end: a.selectionEnd } : null;
}
function restoreFocus(box, fx) {
    const el = fx && box.querySelector(fx.sel);
    if (!el) return;
    el.focus({ preventScroll: true });
    try { el.setSelectionRange(fx.start, fx.end); } catch { /* not a text field */ }
}
function typBadge(p, groups) {
    const t = TY.typicalOf(groups, p.id);
    if (!t) return '';
    const words = t.others.map(o => `${o.mark}${o.hand === 'opposite' ? ' (opposite hand)' : ''}`).join(', ');
    return ` <span class="typ-badge" title="${esc(`Typical: the same framing as ${words}`)}">${t.reference ? `TYP ×${t.group.members.length}` : `= ${esc(t.group.members[0].mark)}`}</span>`;
}
function renderSetActions() {
    const el = main.querySelector('#set-actions');
    if (!el) return;
    const some = checked.size > 0;
    el.innerHTML = `${some ? `<button class="secondary" data-act="set-assign" title="Give the checked panels the members of the panel open now">Give ${checked.size} checked these members</button>
        <button class="link danger" data-act="set-delete">Delete ${checked.size} checked</button>` : ''}
        <button class="link" data-act="set-clear" title="Start over: remove every panel here">Start a new set</button>`;
    renderExportActions();
}
function renderExportActions() {
    const el = main.querySelector('#nav-export'); if (!el) return;
    const list = chosen(), { items, skipped } = setItems(list), p = cur();
    const scope = checked.size ? `${list.length} checked panel${list.length===1?'':'s'}` : `All ${list.length} panel${list.length===1?'':'s'}`;
    el.innerHTML = `<h3 id="nav-export-title">Export &amp; print</h3><p class="export-help">Download sheets here. Open the PDF to print at <b>100% / actual size</b>.</p>
        <div class="export-block"><strong>Shop drawing sheets</strong><p>${esc(scope)} &middot; ${items.length} sheet${items.length===1?'':'s'} &middot; one sheet per panel</p>
        <button data-act="set-pdf" ${items.length ? '' : 'disabled'}>Download shop sheets PDF</button>
        ${skipped.length ? `<p class="warning">Not included: ${esc(skipped.join(', '))} (fix inputs first).</p>` : ''}
        ${p ? `<button class="secondary" data-act="pdf" ${framed(p).layout ? '' : 'disabled'} title="One sheet for the open panel, without a cover">Current panel PDF: ${esc(p.mark)}</button>` : ''}
        <button class="secondary" data-act="set-open" data-v="floor">Labels, CSV &amp; more print options</button></div>
        <div class="export-block"><strong>Framing config (.json)</strong><p>All ${set.panels.length} panels. Resolved members, cut lists and checks for CAS Revit.</p><button class="secondary" data-act="set-export-plan">Download framing config</button></div>
        <div class="export-block"><strong>Editable project (.json)</strong><p>All ${set.panels.length} panels and settings. Save this file to reopen and edit later.</p><button class="secondary" data-act="set-export">Save project file</button></div>`;
}
const chosen = () => (checked.size ? set.panels.filter(p => checked.has(p.id)) : set.panels);
// Typical panels: the same framing (typical.mjs), side A; remembered while the panels are the same.
let typMemo = { key: null, groups: [] };
function typicals() {
    const key = JSON.stringify([set.panels, set.source?.documentId ?? null, eng ? [eng.read.sha256, eng.selection] : null]);
    if (typMemo.key !== key) typMemo = { key, groups: TY.typicalGroups(set.panels.map(p => ({ id: p.id, mark: p.mark, layout: framed(p).plan?.layout || null }))) };
    return typMemo.groups;
}
const typicalOfPanel = (p) => TY.typicalOf(typicals(), p.id);

// --- The set dialog: every panel at a glance, the set's cut list and stock, the shop-floor output -------------------------
// Over the checked panels, else all of them (like the set PDF).
const setDialog = () => document.getElementById('set-dialog');
let setTab = 'overview', sdFilter = 'all';
let stockPrefs = load(KEYS.stock, { stockIn: ST.DEFAULT_STOCK_IN, kerfIn: ST.DEFAULT_KERF_IN });
const SET_TABS = [['overview', 'Overview'], ['framing', 'Framing settings'], ['stock', 'Cut list and stock'], ['floor', 'Export & print']];
const lf = (inches) => `${(inches / 12).toLocaleString(undefined, { maximumFractionDigits: 1 })} LF`;
function openSetDialog(tab) {
    if (tab) setTab = tab;
    if (!SET_TABS.some(([k]) => k === setTab)) setTab = SET_TABS[0][0];
    renderSetDialog();
    const d = setDialog();
    if (!d.open) d.showModal();
}
function renderSetDialog() {
    const d = setDialog(), list = chosen(), scope = checked.size ? `the ${list.length} checked panel${list.length === 1 ? '' : 's'}` : `all ${list.length} panel${list.length === 1 ? '' : 's'}`;
    const body = setTab === 'stock' ? stockTab(list) : setTab === 'overview' ? overviewTab() : setTab === 'floor' ? floorTab(list) : setTab === 'framing' ? framingTab() : '';
    d.innerHTML = `<div class="sd"><header class="sd-head"><h2 id="sd-title">${esc(set.project || 'The set')}</h2><span class="muted small">${setTab === 'framing' ? 'Framing scope is chosen below; export checkboxes do not change it.' : `Over ${esc(scope)} (check panels in the list to narrow it)`}</span><span class="spacer"></span>
            <button class="link" data-act="sd-close">Close</button></header>
        <div class="sd-tabs" role="tablist">${SET_TABS.map(([k, label]) => `<button role="tab" data-act="sd-tab" data-v="${k}" aria-selected="${setTab === k}" class="${setTab === k ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>
        <div class="sd-body">${body}</div></div>`;
}
// Each chosen panel's cut list (skipped: panels with inputs to fix).
function setItems(list) {
    const items = [], skipped = [];
    for (const p of list) { const { layout, plan } = framed(p); if (layout) items.push({ panel: p.mark, id: p.id, layout, cutList: layout.cutList, review: labelReview(plan, layout) }); else skipped.push(p.mark); }
    return { items, skipped };
}
// Every panel at a glance: its state, what is open, what is placed by hand, its typical; the checked ones take the bulk
// actions (the same check boxes as the panel list).
function panelState(p) {
    const { errors, layout, plan } = framed(p), issues = plan?.issues || [], open = openChoices(plan).length;
    const state = errors.length ? 'not-framed' : layout?.issues?.length ? 'failed' : open ? 'preliminary' : 'framed';
    return { state, layout, errors, open, errorsN: issues.filter(i => i.severity === 'error').length, decide: issues.filter(i => i.severity === 'needs-resolution').length,
        warnings: issues.filter(i => i.severity === 'warning').length, byHand: MAN.unlockedCount(p) + MAN.removedKeys(p).length };
}
const STATE_WORDS = { 'not-framed': ['Not framed', 'check-failed'], failed: ['Check failed', 'check-failed'], preliminary: ['Preliminary', 'eng-badge warn'], framed: ['✓ Framed', 'check-passed'] };
function overviewTab() {
    const typ = typicals(), rows = set.panels.map(p => ({ p, s: panelState(p) }));
    const attention = (r) => r.s.state !== 'framed' || r.s.errorsN || r.s.decide;
    const shown = rows.filter(r => sdFilter === 'all' || (sdFilter === 'attention' ? attention(r) : !attention(r)));
    const count = (st) => rows.filter(r => r.s.state === st).length, n = checked.size;
    const f = (k, label) => `<button class="${sdFilter === k ? 'on' : ''}" data-act="sd-filter" data-v="${k}" aria-pressed="${sdFilter === k}">${label}</button>`;
    return `<div class="sd-stats"><span><b>${rows.length}</b> panels</span><span class="check-passed"><b>${count('framed')}</b> framed</span><span><b>${count('preliminary')}</b> preliminary</span><span class="check-failed"><b>${count('failed') + count('not-framed')}</b> to fix</span>
            <span><b>${typ.length}</b> typical${typ.length === 1 ? '' : 's'} (${typ.reduce((k, g) => k + g.members.length, 0)} panels)</span></div>
        <div class="sd-row"><span class="seg" role="group" aria-label="Show">${f('all', 'All')}${f('attention', 'Needs attention')}${f('framed', 'Ready')}</span><span class="spacer"></span>
            <span class="small">${n ? `<b>${n} checked</b>:` : 'Check panels for:'}</span>
            <button class="secondary small" data-act="sd-rules" ${n && eng ? '' : 'disabled'} title="${eng ? 'Every door and window on the checked panels takes the engineering rule that covers it' : 'Open the engineering catalog first'}">Use the rules on their openings</button>
            <button class="secondary small" data-act="set-pdf" ${n ? '' : 'disabled'}>Download checked sheets PDF</button>
            <button class="link small danger" data-act="set-delete" ${n ? '' : 'disabled'}>Delete them</button></div>
        <table class="sd-table sd-dash"><thead><tr><th><input type="checkbox" data-sd-all aria-label="Check every panel shown" ${shown.length && shown.every(r => checked.has(r.p.id)) ? 'checked' : ''}></th><th>Panel</th><th>Group / level</th><th>Size</th><th>Openings</th><th>State</th><th>To decide / errors</th><th>By hand</th><th>Typical</th><th>Rev</th><th>Studs</th></tr></thead><tbody>
        ${shown.map(({ p, s }) => {
            const [word, cls] = STATE_WORDS[s.state], t = TY.typicalOf(typ, p.id), L = s.layout;
            return `<tr class="${p.id === cur()?.id ? 'on' : ''}"><td><input type="checkbox" data-check="${esc(p.id)}" ${checked.has(p.id) ? 'checked' : ''} aria-label="Check ${esc(p.mark)}"></td>
                <td><button class="link" data-act="sd-open" data-id="${esc(p.id)}"><b>${esc(p.mark)}</b></button>${G.isFromModel(p) ? ' 🔒' : ''}</td>
                <td class="small">${esc([p.group, p.level].filter(Boolean).join(' · ') || '—')}</td>
                <td class="small">${L ? `${esc(editDimension(L.lengthIn))} x ${esc(editDimension(L.heightIn))}` : '—'}</td>
                <td class="small">${esc(G.openingsSummary(p.openings))}</td>
                <td><span class="${cls}">${word}${s.state === 'preliminary' ? ` (${s.open})` : ''}</span>${s.errors.length ? `<br><span class="small muted">${esc(s.errors[0].message || s.errors[0])}</span>` : ''}</td>
                <td class="small">${s.decide || s.errorsN ? `${s.decide} / ${s.errorsN}` : '—'}${s.warnings ? ` <span class="muted">(${s.warnings} note${s.warnings === 1 ? '' : 's'})</span>` : ''}</td>
                <td class="small">${s.byHand || '—'}</td>
                <td class="small">${t ? (t.reference ? `TYP ×${t.group.members.length}` : `= ${esc(t.group.members[0].mark)}${t.hand === 'opposite' ? ' (opp.)' : ''}`) : '—'}</td>
                <td class="small">${revCell(p, s)}</td>
                <td class="small">${esc(studName(p.members))} @ ${esc(String(p.members.spacingIn ?? ''))}"</td></tr>`;
        }).join('') || '<tr><td colspan="11" class="muted">No panel shown.</td></tr>'}</tbody></table>`;
}
function revCell(p, s) {
    const r = p.revisions?.[p.revisions.length - 1];
    if (!r) return '—';
    const n = s.layout && framed(p).plan?.layout ? RV.diffSnapshots(r.snap, RV.snapshotOf(framed(p).plan.layout)).length : 0;
    return `${r.n}${n ? ` <span class="warning" title="${n} change${n === 1 ? '' : 's'} since revision ${r.n}">+${n}</span>` : ''}`;
}
// The engineering rules on every opening of the checked panels (one undo step).
function rulesOnChecked() {
    if (!eng) { notice('Open the engineering catalog first (Engineering).', true); return; }
    const used = [], none = [];
    set.panels = set.panels.map(p => {
        if (!checked.has(p.id)) return p;
        let q = p;
        p.openings.forEach((o, i) => {
            const r = R.ruleFor(eng, q, i);
            if (!r.applies) return;
            if (r.status !== 'matched') { none.push(`${p.mark} ${G.openingName(p.openings, i)}`); return; }
            try { q = SC.applyOpeningStyle(q, i, eng.read, r.match).panel; used.push(`${p.mark} ${G.openingName(p.openings, i)}`); } catch { none.push(`${p.mark} ${G.openingName(p.openings, i)}`); }
        });
        return q;
    });
    changed(); renderAll(); renderSetDialog();
    notice(`Rules used on ${used.length} opening${used.length === 1 ? '' : 's'}${none.length ? `; no single rule for ${none.join(', ')}: pick those in each panel's Openings tab` : ''}.`, none.length > 0);
}
// Shop-floor output: one drawing sheet per panel with bookmarks, and separate member labels.
function floorTab(list) {
    const { items, skipped } = setItems(list), skip = typicalSkips(list);
    const labels = projectFromShop(items, {project:set.project||''}), count=labels.rows.reduce((n,r)=>n+r.qty,0);
    return `<p class="export-print-tip">PDFs download to your browser Downloads folder. Open the PDF and print at 100% / actual size. Sheet and label PDFs use checked panels; with none checked, all panels are included.</p>${skipped.length ? `<p class="warning small">Left out (inputs to fix): ${esc(skipped.join(', '))}.</p>` : ''}
        <div class="sd-cards">
            <section class="sd-card"><h3>Shop drawing sheets (.pdf)</h3><p class="small">One sheet per panel, with a bookmark for each. Stock and purchasing information stays in the separate CSV downloads.</p>
                <div class="acts"><button data-act="set-pdf" ${items.length?'':'disabled'}>Download shop sheets PDF (${items.length} sheet${items.length === 1 ? '' : 's'})</button>
                ${skip.size ? `<button class="secondary" data-act="set-pdf-typ">One per typical (${items.length - skip.size})</button>` : ''}</div></section>
            <section class="sd-card"><h3>Member labels (.pdf)</h3><p class="small">The same Label Maker output: 2 &times; 4 inch labels, ${LABEL_STOCK.cols*LABEL_STOCK.rows} per Letter sheet. Panel, mark, project, notes and logo; QR code when a link is supplied. No cut length.</p><p class="small">${count} labels. Open the labels, enter drawing links if needed, then Download PDF.</p>
                <div class="acts"><button data-act="sd-label-maker" ${count?'':'disabled'}>Open labels &amp; download PDF</button></div></section>
            <section class="sd-card"><h3>Framing config (.json)</h3><p class="small">All ${set.panels.length} panels, regardless of checks: resolved members, cut lists, issues and review states for CAS Revit.</p><button class="secondary" data-act="set-export-plan">Download framing config</button></section>
            <section class="sd-card"><h3>Editable project (.json)</h3><p class="small">All ${set.panels.length} panels and settings. Reopen with Import project to continue editing.</p><button class="secondary" data-act="set-export">Save project file</button></section>
            <section class="sd-card"><h3>Cut lists (.csv)</h3><p class="small">What to buy, how each bar is cut, the set's cut list: CSV for a spreadsheet or the saw.</p>
                <p class="small">Purchase list: stock bars and quantities to buy. Stock cut plan: cuts for each bar. Panel cut list: member quantities and cut lengths by panel.</p><div class="acts"><button class="secondary" data-act="sd-csv" data-v="buy" ${items.length?'':'disabled'}>Purchase list CSV</button><button class="secondary" data-act="sd-csv" data-v="cuts" ${items.length?'':'disabled'}>Stock cut plan CSV</button><button class="secondary" data-act="sd-csv" data-v="list" ${items.length?'':'disabled'}>Panel cut list CSV</button><button class="link" data-act="sd-tab" data-v="stock">Review stock lengths and cutting settings</button></div></section>
        </div>`;
}
function openLabelMaker() {
    const { items, skipped } = setItems(chosen());
    if (!items.length) { notice('No drawable panel to make labels from.', true); return; }
    try {
        const labels = projectFromShop(items, { project: set.project || '' });
        localStorage.setItem(LABEL_HANDOFF_KEY, JSON.stringify(labels));
        let dialog = document.getElementById('shop-label-maker');
        if (!dialog) {
            dialog = document.createElement('dialog'); dialog.id = 'shop-label-maker'; dialog.className = 'label-maker-dialog';
            dialog.innerHTML = '<header><b>Panel Label Maker</b><button type="button" class="secondary small" data-label-close>Back to panel shops</button></header><iframe title="Panel Label Maker" src="about:blank"></iframe>';
            document.body.append(dialog);
            dialog.querySelector('[data-label-close]').addEventListener('click', () => dialog.close());
            dialog.addEventListener('close', () => dialog.querySelector('iframe').src = 'about:blank');
            window.addEventListener('message', e => {
                if (e.origin === location.origin && e.source === dialog.querySelector('iframe').contentWindow && e.data?.type === 'cas-label-maker:close') dialog.close();
            });
        }
        const frame = dialog.querySelector('iframe');
        frame.onload = () => {
            if (!dialog.open || frame.getAttribute('src') === 'about:blank') return;
            const groups = items.map(item => {
                const p = set.panels.find(p => p.id === item.id), f = framed(p);
                return { panel: item.panel, source: 'Panel Shop Generator',
                    text: item.cutList.map(c => `${c.mark} ${c.qty}`).join('\n'),
                    preview: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(renderSheet(item.layout, sheetInfoFor(p, f))) };
            });
            frame.contentWindow.postMessage({ type: 'cas-label-maker:shop-context', groups }, location.origin);
        };
        frame.src = 'label-maker.html?from=shop&embedded=1';
        dialog.showModal();
        notice(`Label Maker opened for ${items.length} panels.${skipped.length ? ` Left out (inputs to fix): ${skipped.join(', ')}.` : ''} Review status is carried with each row.`);
    } catch (err) { notice(`Label Maker could not open: ${err.message}`, true); }
}
// Framing settings for every panel (universal): the studs' cutback and whether cripples and jacks are seated in the
// tracks that receive them; how headers and sills end at the jambs (overlap or flush, with a cutback at each flush end).
// A draft from the open panel, then Apply to every panel (one undo step).
let fsDraft = null, fsScope = 'all';
const FS_KEYS = SOURCE_FRAMING_FIELDS;
const fsOf = (p) => ({ cutbackIn: G.cutbackOf(p) ?? 1 / 16, deflectionGapIn: Number(p.deflectionGapIn) || 0, seatPieces: p.seatPieces !== false, headEnds: p.headEnds === 'flush' ? 'flush' : 'overlap', headCutbackIn: Number(p.headCutbackIn) || 0,
    sillEnds: p.sillEnds === 'flush' ? 'flush' : 'overlap', sillCutbackIn: Number(p.sillCutbackIn) || 0 });
const fsSame = (a, b) => FS_KEYS.every(k => (k === 'headCutbackIn' && a.headEnds !== 'flush') || (k === 'sillCutbackIn' && a.sillEnds !== 'flush') ? true : a[k] === b[k]);
function framingTab() {
    if (!fsDraft) fsDraft = fsOf(cur() || G.newPanel());
    const d = fsDraft, targets = fsScope === 'open' ? [cur()].filter(Boolean) : set.panels, differ = targets.filter(p => !fsSame(d, fsOf(p)));
    const radio = (name, v, label, sub) => `<label class="fs-opt"><input type="radio" name="${name}" data-fs="${name}" value="${v}" ${d[name] === v ? 'checked' : ''}><span><b>${label}</b><small>${sub}</small></span></label>`;
    const cut = (k, label, on = true) => `<label class="field mini-field"><span>${label} <small>${esc(d[k] !== fsOf(cur() || G.newPanel())[k] ? 'Draft override (Apply to use)' : framingOrigin(cur(),k))}</small></span><input type="text" class="mini" data-fs="${k}" value="${esc(fine(d[k]))}" ${on ? '' : 'disabled'} aria-label="${label}"></label>`;
    const source = sourceFraming(cur()), flange = G.parseMember(cur()?.members.stud)?.flangeIn;
    return `<div class="framing-scope"><b>Apply framing rules to</b>${[['all',`All ${set.panels.length} panels`],['open',`Open panel: ${cur()?.mark || 'none'}`]].map(([v,label])=>`<label><input type="radio" name="fsScope" data-fs-scope value="${v}" ${fsScope===v?'checked':''}>${esc(label)}</label>`).join('')}</div>
        <p class="small">One Apply, one Undo. Cutback, top gap, seating and header/sill ends are together here. Applying all panels replaces their individual and imported values.</p>
        ${source ? `<p class="framing-source"><b>Revit template: ${esc(source.templateName || 'unnamed')}</b> ${esc(source.templateId)} · fields below show their source. <button class="link" data-act="fs-source">Use Revit values on this panel</button></p>` : ''}
        <div class="fs-grid">
            <section class="sd-card"><h3>Stud cutback &amp; top gap</h3>${cut('cutbackIn', 'Stud cutback (except deflection top)')}
                ${cut('deflectionGapIn', 'Top deflection gap (0 = use cutback)')}<p class="small">A gap at the top-track web replaces the top cutback; it is never added to it. Lower cripple/jack ends keep their cutback. Flat tops only.</p>
                <label class="fs-opt"><input type="checkbox" data-fs="seatPieces" ${d.seatPieces ? 'checked' : ''}><span><b>Seat cripples and jacks in the tracks</b><small>On (the default): they run into each single track that receives them (the bottom track, a track header under them, a track sill over them) to its web, less the cutback, like full-height studs; drawn through the see-through tracks. Off: cut to the clear span. Either way a cripple's top runs into the top track like the studs (its top matches theirs).</small></span></label></section>
            <section class="sd-card"><h3>Header ends</h3>${radio('headEnds', 'overlap', 'Overlap the jambs', `One stud flange past each jamb (${flange ? fine(flange) : 'member flange'} each side on the open panel).`)}
                ${radio('headEnds', 'flush', 'Flush between the jambs', 'Cut to the rough opening, less the cutback at each end; a header on jack studs still bears on them')}${cut('headCutbackIn', 'Cutback at each flush end', d.headEnds === 'flush')}</section>
            <section class="sd-card"><h3>Sill ends</h3>${radio('sillEnds', 'overlap', 'Overlap the jambs', `One stud flange past each jamb (${flange ? fine(flange) : 'member flange'} each side on the open panel).`)}
                ${radio('sillEnds', 'flush', 'Flush between the jambs', 'Cut to the rough opening, less the cutback at each end')}${cut('sillCutbackIn', 'Cutback at each flush end', d.sillEnds === 'flush')}</section>
        </div>
        <div class="acts"><button data-act="fs-apply" ${differ.length ? '' : 'disabled'}>${fsScope === 'all' ? 'Apply to every panel' : 'Apply to open panel'}</button><button class="link small" data-act="fs-reset">Reset draft</button>
            <span class="small ${differ.length ? 'warning' : 'muted'}">${differ.length ? `${differ.length} panel${differ.length === 1 ? '' : 's'} differ from these: ${esc(differ.slice(0, 8).map(p => p.mark).join(', '))}${differ.length > 8 ? '…' : ''}` : 'Every panel has these.'}</span></div>
        <p class="muted small">Seated pieces and flush ends change cut lengths: the plan asks the Revit side for the features seated-pieces, flush-headers and flush-sills.</p>
        <p class="small">These two apply at once to the whole set (each one Undo step):</p>
        <div class="fs-grid">${profilesCard()}${legendCard()}</div>`;
}
// The set's opening profiles (opening-profiles.mjs): renamed (their openings follow) or deleted (they keep their
// framing); one named like a Revit family : type is given to the model's openings of that type with nothing chosen.
function profilesCard() {
    const list = opProfiles();
    const rows = list.map((x, n) => {
        const used = OP.uses(set.panels, x.name).length, more = OP.linkByRevitName(set.panels, x, { only: 'unset' }).linked.length;
        return `<tr><td><input type="text" class="mini prof-name" data-prof-name="${n}" value="${esc(x.name)}" aria-label="Profile name (rename)"></td><td>${esc(G.OPENING_TYPES[x.kind].name)}</td><td>${esc(sizeText(x))}</td>
            <td class="small">${esc(framingWords(x.framing) || 'the panel defaults')}</td>
            <td>${used}${more ? ` <button class="link small" data-act="prof-link" data-v="${esc(x.name)}" title="${esc(`The model's ${x.name} openings with nothing chosen`)}">+ ${more} by Revit name</button>` : ''}</td>
            <td><button class="link small danger" data-act="prof-del" data-v="${esc(x.name)}">Delete</button></td></tr>`;
    }).join('');
    return `<section class="sd-card fs-wide"><h3>Opening profiles</h3>
        <p class="small">A named opening type: its kind, its framing (offsets, jambs, header, sill, their arrangements) and the size new ones start at (the first one's; each opening keeps its own width and height). Save one from an opening's bar (Profile, then Save as a profile…); add one with + From a profile beside the Add buttons. Named like a Revit family : type, the model's openings of that type take it.</p>
        ${list.length ? `<table class="sd-table prof-table"><thead><tr><th>Name</th><th>Kind</th><th>New ones</th><th>Framing</th><th>Openings</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted small">No profiles yet.</p>'}</section>`;
}
// The opening colors (opening-context.mjs TRADES): the shop drawings' legend, each trade's color set for the set.
function legendCard() {
    const colors = legendColors();
    return `<section class="sd-card fs-wide"><h3>Opening colors</h3>
        <p class="small">Internal standard: mechanical light cyan, electrical olive, plumbing maroon, fire red and steel teal. Unclassified MEP uses light cyan; each sheet lists the trades it uses.</p>
        <div class="legend-grid">${Object.entries(OC.TRADES).map(([t, x]) => `<label><input type="color" data-legend="${t}" value="${OC.colorOf(t, colors)}" aria-label="${esc(x.legend)} color"> ${esc(x.legend)}${colors?.[t] ? ' <span class="muted small">(this set\'s)</span>' : ''}</label>`).join('')}</div>
        ${colors ? '<button class="link small" data-act="legend-reset">Use internal standard colors</button>' : ''}</section>`;
}
function applyFramingSettings() {
    const d = fsDraft;
    if (!d) return;
    const n = set.panels.filter(p => (fsScope === 'all' || p.id === cur()?.id) && !fsSame(d, fsOf(p))).length;
    set.panels = set.panels.map(p => {
        if (fsScope === 'open' && p.id !== cur()?.id) return p;
        const q = { ...p, cutbackIn: d.cutbackIn, seatPieces: d.seatPieces }; // stored only when off (on is the default)
        if (sourceFraming(p)) q.framingOrigins = Object.fromEntries(FS_KEYS.map(k => [k,'web']));
        if (d.deflectionGapIn > 0) q.deflectionGapIn = d.deflectionGapIn; else delete q.deflectionGapIn;
        for (const [k, c] of [['headEnds', 'headCutbackIn'], ['sillEnds', 'sillCutbackIn']]) { if (d[k] === 'flush') { q[k] = 'flush'; q[c] = d[c]; } else { delete q[k]; delete q[c]; } }
        if (q.seatPieces) delete q.seatPieces;
        return q;
    });
    changed(); renderAll(); renderSetDialog();
    notice(`Framing settings applied to ${n} panel${n === 1 ? '' : 's'}: cutback ${fine(d.cutbackIn)}${d.deflectionGapIn ? `; top gap ${fine(d.deflectionGapIn)} replaces top cutback` : ''}; headers ${d.headEnds}; sills ${d.sillEnds}.`);
}
function stockTab(list) {
    const { items, skipped } = setItems(list);
    if (!items.length) return '<p class="muted">No framed panel to take the cut list from.</p>';
    let plan;
    try { plan = ST.nestStock(items, stockPrefs); } catch (err) { return `<p class="check-failed">${esc(err.message)}</p>`; }
    const rows = ST.setCutList(items), t = plan.totals, buyText = (x) => x.buy.map(b => `${b.count} × ${editDimension(b.stockIn)}`).join(', ') || '—';
    return `<div class="sd-row"><label class="field"><span>Stock lengths</span><input type="text" data-stock="stockIn" value="${esc(plan.stockIn.map(editDimension).join(', '))}" aria-label="Stock lengths (comma separated)"></label>
            <label class="field"><span>Saw kerf</span><input type="text" class="mini" data-stock="kerfIn" value="${esc(editDimension(plan.kerfIn))}" aria-label="Saw kerf"></label>
            <p class="muted small">Each type is fitted into bars of the longest stock, longest piece first, then each bar is bought at the shortest stock length that holds it. A purchasing aid: check it against your supplier's lengths and your saw.</p></div>
        <div class="sd-stats"><span><b>${t.pieces}</b> pieces</span><span><b>${lf(t.cutIn)}</b> cut</span><span><b>${t.bars}</b> bars, <b>${lf(t.orderedIn)}</b> to buy</span><span><b>${t.wastePct.toFixed(1)}%</b> offcut</span></div>
        ${skipped.length ? `<p class="warning small">Left out (inputs to fix): ${esc(skipped.join(', '))}.</p>` : ''}
        <table class="sd-table"><thead><tr><th>Member type</th><th>Pieces</th><th>Cut</th><th>Buy</th><th>To buy</th><th>Offcut</th></tr></thead><tbody>
            ${plan.types.map(x => `<tr><td><b>${esc(x.type)}</b></td><td>${x.pieces}</td><td>${lf(x.cutIn)}</td><td>${esc(buyText(x))}${x.long.length ? `<br><span class="warning small">${x.long.length} longer than the stock: cut to length</span>` : ''}</td><td>${lf(x.orderedIn)}</td><td>${x.wastePct.toFixed(1)}%</td></tr>`).join('')}
        </tbody></table>
        <div class="acts"><button class="secondary small" data-act="sd-csv" data-v="buy">Purchase list CSV</button><button class="secondary small" data-act="sd-csv" data-v="cuts">Stock cut plan CSV</button><button class="secondary small" data-act="sd-csv" data-v="list">Panel cut list CSV</button></div>
        ${plan.types.map(x => `<details class="sd-bars"><summary>${esc(x.type)}: how each bar is cut (${x.bars.length} bar${x.bars.length === 1 ? '' : 's'})</summary><ol>
            ${x.bars.map(b => `<li><b>${esc(editDimension(b.stockIn))}</b>: ${b.cuts.map(c => `${esc(editDimension(c.lengthIn))} <span class="muted">(${esc(c.panel)} ${esc(c.mark)})</span>`).join(' + ')} <span class="muted">· offcut ${esc(editDimension(b.wasteIn))}</span></li>`).join('')}
            ${x.long.map(c => `<li class="warning">${esc(editDimension(c.lengthIn))} (${esc(c.panel)} ${esc(c.mark)}): longer than the stock, order cut to length</li>`).join('')}</ol></details>`).join('')}
        <details class="sd-bars"><summary>The set's cut list (${rows.length} lines)</summary><table class="sd-table"><thead><tr><th>Member type</th><th>Length</th><th>Qty</th><th>Where</th></tr></thead><tbody>
            ${rows.map(r => `<tr><td>${esc(r.type)}</td><td>${esc(editDimension(r.lengthIn))}</td><td>${r.qty}</td><td class="small">${esc(r.uses.map(u => `${u.panel} ${u.mark} ×${u.qty}`).join(', '))}</td></tr>`).join('')}</tbody></table></details>`;
}
function setCsv(kind) {
    const { items } = setItems(chosen());
    if (!items.length) return;
    const plan = ST.nestStock(items, stockPrefs), name = fileName(set.project || 'set');
    const text = kind === 'buy' ? ST.purchaseCsv(plan) : kind === 'cuts' ? ST.cutPlanCsv(plan) : ST.setCutListCsv(ST.setCutList(items));
    download(new TextEncoder().encode(text), `${kind === 'buy' ? 'stock-to-buy' : kind === 'cuts' ? 'cut-plan' : 'set-cut-list'}-${name}-${today()}.csv`, 'text/csv');
}
setDialog().addEventListener('change', (e) => {
    const lg = e.target.closest('[data-legend]');
    if (lg) { // an opening color for the set: the legend's own is not stored
        const t = lg.dataset.legend, v = String(lg.value).toLowerCase(), next = { ...(set.legendColors || {}) };
        if (v === OC.TRADES[t]?.color) delete next[t]; else next[t] = v;
        const clean = OC.cleanColors(next);
        if (clean) set.legendColors = clean; else delete set.legendColors;
        historyHint = { label: `the ${String(OC.TRADES[t]?.legend || t).toLowerCase()} color` }; changed(); renderAll(); renderSetDialog();
        return;
    }
    const pn = e.target.closest('[data-prof-name]');
    if (pn) { renameProfile(Number(pn.dataset.profName), pn.value); return; }
    const fsEl = e.target.closest('[data-fs]');
    if (e.target.matches('[data-fs-scope]')) { fsScope = e.target.value; renderSetDialog(); return; }
    if (fsEl) {
        const k = fsEl.dataset.fs;
        if (k === 'seatPieces') fsDraft = { ...fsDraft, seatPieces: fsEl.checked };
        else if (k === 'headEnds' || k === 'sillEnds') fsDraft = { ...fsDraft, [k]: fsEl.value };
        else { const v = parseDimension(fsEl.value), max = k === 'deflectionGapIn' ? 12 : 1; if (v == null || v < 0 || v > max) { notice(k === 'deflectionGapIn' ? 'A top deflection gap between 0" and 12".' : 'A cutback between 0" and 1".', true); renderSetDialog(); return; } fsDraft = { ...fsDraft, [k]: Math.round(v * 64) / 64 }; }
        renderSetDialog(); return;
    }
    if (e.target.matches('[data-check]')) { e.target.checked ? checked.add(e.target.dataset.check) : checked.delete(e.target.dataset.check); renderSet(); renderSetDialog(); return; }
    if (e.target.matches('[data-sd-all]')) {
        const ids = [...setDialog().querySelectorAll('[data-check]')].map(x => x.dataset.check);
        for (const id of ids) e.target.checked ? checked.add(id) : checked.delete(id);
        renderSet(); renderSetDialog(); return;
    }
    const el = e.target.closest('[data-stock]');
    if (!el) return;
    if (el.dataset.stock === 'stockIn') {
        const v = ST.parseStockList(el.value, parseDimension);
        if (!v.length) { notice('Type stock lengths like 10\', 12\', 20\'.', true); return; }
        stockPrefs = { ...stockPrefs, stockIn: v };
    } else {
        const v = parseDimension(el.value);
        if (v == null || v < 0 || v > 1) { notice('A saw kerf between 0" and 1".', true); return; }
        stockPrefs = { ...stockPrefs, kerfIn: v };
    }
    store(KEYS.stock, stockPrefs); renderSetDialog();
});

function assign(p) {
    const ids = [...checked].filter(id => id !== p.id);
    if (!ids.length) { notice('Check the other panels to give them this panel\'s members.'); return; }
    if (!confirm(`Give the ${ids.length} checked panel${ids.length === 1 ? '' : 's'} the members of ${p.mark}?\n${studName(p.members)} @ ${p.members.spacingIn}" o.c., bottom track ${bottomTrack(p.members)}${p.members.topTrack ? `, top track ${p.members.topTrack}` : ''}${p.members.header ? `, headers ${p.members.header}` : ''}${p.members.jamb ? `, jambs ${p.members.jamb}` : ''}`)) return;
    set.panels = G.assignMembers(set.panels, ids, p.members);
    save(); renderSet();
    notice(`${ids.length} panel${ids.length === 1 ? '' : 's'} now use the members of ${p.mark}.`);
}
function deletePanels() {
    const list = set.panels.filter(p => checked.has(p.id));
    if (!list.length || !confirm(`Delete ${list.map(p => p.mark).join(', ')}? (Undo brings ${list.length === 1 ? 'it' : 'them'} back.)`)) return;
    historyHint = { label: `deleting ${list.length} panel${list.length === 1 ? '' : 's'}` };
    set.panels = set.panels.filter(p => !checked.has(p.id));
    checked.clear();
    sel = null; ask = null;
    save(); renderAll();
}
function clearSet() {
    if (!confirm('Start a new set? Every panel here is removed (Undo brings them back; Export keeps a file). Your remembered sizes, combos and profiles stay.')) return;
    historyHint = { label: 'starting a new set' };
    set = { project: set.project, drawnBy: set.drawnBy, panels: [], current: null };
    checked.clear(); sel = null; ask = null;
    save(); renderAll();
}

// --- Combos -------------------------------------------------------------------------------------------------------------
function applyCombo(value) {
    const c = value?.[0] === 's' ? combos[Number(value.slice(1))] : value?.[0] === 'b' ? G.COMBOS[Number(value.slice(1))] : null;
    if (!c) return;
    cur().members = { ...G.DEFAULT_MEMBERS, ...c.members };
    typing.clear();
    renderMemberCards(); renderDatalists(); changed();
    notice(`Members set to "${c.name}".`);
}
function saveCombo(p) {
    const m = p.members, name = prompt('Name this member combo:', `${studName(m)} @ ${m.spacingIn}" o.c.${m.header ? ', built-up header' : ''}`);
    if (!name?.trim()) return;
    combos = [{ name: name.trim().slice(0, 80), members: { ...m } }, ...combos.filter(c => c.name !== name.trim())].slice(0, 30);
    store(KEYS.combos, combos);
    renderCore();
    notice(`Saved "${name.trim()}": pick it from Member combo on any panel.`);
}
function deleteCombo() {
    const name = prompt(`Delete which saved combo? Type its name:\n${combos.map(c => `· ${c.name}`).join('\n')}`);
    if (!name) return;
    const before = combos.length;
    combos = combos.filter(c => c.name !== name.trim());
    store(KEYS.combos, combos);
    renderCore();
    notice(before === combos.length ? `No saved combo named "${name}".` : `Deleted "${name}".`);
}

// --- Files: PDF, JSON, links ----------------------------------------------------------------------------------------------
async function logoJpeg() {
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
        return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
    } catch { return null; }
}
function download(bytes, name, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const fileName = (s) => String(s || 'panel').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'panel';
// The panels a "one per typical" print leaves out: every typical's members after the first one printed.
function typicalSkips(panels) {
    const ids = new Set(panels.map(p => p.id)), skip = new Set();
    for (const g of typicals()) { const inSet = g.members.filter(m => ids.has(m.id)); for (const m of inSet.slice(1)) skip.add(m.id); }
    return skip;
}
async function downloadPdf(panels, { perTypical = false } = {}) {
    const items = [], skipped = [];
    if (perTypical) { const skip = typicalSkips(panels); panels = panels.filter(p => !skip.has(p.id)); }
    for (const p of panels) {
        const { layout } = framed(p);
        if (layout) items.push({ layout, info: sheetInfo(p) }); else skipped.push(p.mark);
    }
    if (!items.length) { notice(`Nothing to print: ${skipped.join(', ')} ${skipped.length === 1 ? 'has' : 'have'} inputs to fix.`, true); return; }
    const logo = await logoJpeg();
    if (items.length === 1) download(renderSheetPdf(items[0].layout, items[0].info, logo), `shop-drawing-${fileName(items[0].info.mark)}.pdf`, 'application/pdf');
    else download(renderSheetsPdf(items, logo, `${set.project || 'Panel'} shop drawings`), `panel-shops-${fileName(set.project || 'set')}-${today()}.pdf`, 'application/pdf');
    const failed = items.filter(x => x.layout.issues.length).map(x => x.info.mark);
    notice([`${items.length} sheet${items.length === 1 ? '' : 's'} downloaded.`, skipped.length ? `Left out (inputs to fix): ${skipped.join(', ')}.` : '',
        failed.length ? `Framing check failed on ${failed.join(', ')}: marked DO NOT RELEASE.` : ''].filter(Boolean).join(' '), !!(skipped.length || failed.length));
}
// The resolved framing plans (cas-framing-plan-set): physical members, cut lists, issues and states, per panel.
let planExportBusy = false;
async function exportPlanJson() {
    if (planExportBusy) return;
    planExportBusy = true;
    try {
        const input = structuredClone(set), engineering = structuredClone(engineeringFor());
        const { output: out } = await resolvePlanBatch(input, engineering, { onProgress: ({done,total}) => notice(`Preparing framing config: ${done} of ${total} panels...`) });
        const ready = out.plans.filter(q => q.states.canPreview).length;
        download(JSON.stringify(out, null, 2), `framing-config-${fileName(input.project || 'shops')}-${today()}.json`, 'application/json');
        notice(`Framing config downloaded for all ${out.plans.length} panel${out.plans.length === 1 ? '' : 's'} (${ready} drawn; the rest list what is still to choose or fix).`);
    } catch (error) { notice(`Framing config could not be prepared: ${error.message}`, true); }
    finally { planExportBusy = false; }
}
function exportJson() {
    download(JSON.stringify(G.exportSet(set), null, 2), `panel-set-${fileName(set.project || 'shops')}-${today()}.json`, 'application/json');
    markExported();
    notice(`Exported ${set.panels.length} panel${set.panels.length === 1 ? '' : 's'} as JSON. Import the file here (any browser) to carry on.`);
}
// Replace, Add or Cancel (Cancel never adds). reason: why Add is not offered.
function chooseImport(name, count, reason) {
    return new Promise(resolve => {
        const d = document.createElement('dialog');
        d.className = 'import-dialog';
        d.innerHTML = `<form method="dialog"><p><b>${esc(name)}</b>: ${count} panel${count === 1 ? '' : 's'}.</p>${reason ? `<p class="muted small">${esc(reason)}</p>` : ''}
            <div class="row"><button value="replace">Replace the panels here</button><button value="add" class="secondary" ${reason ? 'disabled' : ''}>Add to the panels here</button><span class="spacer"></span><button value="" class="link">Cancel</button></div></form>`;
        document.body.append(d);
        d.addEventListener('close', () => { resolve(d.returnValue || null); d.remove(); });
        d.showModal();
    });
}
// Add: the panels of the file that are already here, or cannot be told apart (import-merge.mjs matchIncoming), one row
// each with what to do; Skip unless chosen. -> { index: 'skip' | 'update' | 'copy' } or null (Cancel: nothing imported).
function chooseConflicts(name, rows) {
    const list = rows.filter(r => r.status === 'match' || r.status === 'ambiguous'), others = rows.length - list.length;
    const here = (id) => set.panels.find(p => p.id === id)?.mark || '?';
    return new Promise(resolve => {
        const d = document.createElement('dialog');
        d.className = 'import-dialog conflict-dialog';
        d.innerHTML = `<form method="dialog"><h3>${esc(name)}</h3>
            <p>${list.length} of its panels ${list.length === 1 ? 'is' : 'are'} the model's panels already here, or cannot be told apart from them: choose for each. ${others ? `The other ${others} ${others === 1 ? 'is' : 'are'} added.` : ''}
                Nothing here is overwritten without your choice, and a panel's locked model geometry never is.</p>
            <table class="sd-table"><thead><tr><th>In the file</th><th>Here</th><th>What to do</th></tr></thead><tbody>
            ${list.map(r => `<tr><td><b>${esc(r.panel.mark)}</b></td><td>${r.status === 'match' ? `<b>${esc(here(r.match))}</b> (the same model panel)` : `<span class="warning small">${esc(r.reason)}</span>`}</td>
                <td><select data-conflict="${r.index}" aria-label="What to do with ${esc(r.panel.mark)}"><option value="skip">Skip it</option>
                ${r.status === 'match' ? `<option value="update">Update ${esc(here(r.match))}'s detailing (members, layout, opening framing, clips, edits by hand)</option>` : ''}
                <option value="copy">Add an unlinked study copy</option></select></td></tr>`).join('')}</tbody></table>
            <div class="row"><span class="small muted">All:</span><button type="button" class="link small" data-all="skip">Skip</button>${list.some(r => r.status === 'match') ? '<button type="button" class="link small" data-all="update">Update the matches</button>' : ''}<button type="button" class="link small" data-all="copy">Study copies</button>
                <span class="spacer"></span><button value="ok">Import</button><button value="" class="link">Cancel</button></div></form>`;
        d.addEventListener('click', (e) => {
            const all = e.target.closest('[data-all]');
            if (all) for (const sel of d.querySelectorAll('[data-conflict]')) sel.value = [...sel.options].some(o => o.value === all.dataset.all) ? all.dataset.all : sel.value;
        });
        document.body.append(d);
        d.addEventListener('close', () => { resolve(d.returnValue === 'ok' ? Object.fromEntries([...d.querySelectorAll('[data-conflict]')].map(x => [x.dataset.conflict, x.value])) : null); d.remove(); });
        d.showModal();
    });
}
const newPanelId = () => `p-${Math.random().toString(36).slice(2, 10)}`;
// Import a set file. Replace: the file faithfully (import-merge.mjs replaceSet: nothing of the old set kept, nothing
// re-detailed; "Exported" only when the set is exactly the file). Add: the file's panels beside these, the model's
// matched by identity (never duplicated as a second linked panel). Cancel, or a file that cannot be read, changes nothing;
// every import is one Undo step.
async function importJson(file) {
    try {
        const text = await file.text(), { set: incoming, warnings } = G.importSet(text);
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { parsed = null; }
        if (!incoming.panels.length) { notice(`No panels read from ${file.name}. ${warnings.join(' ')}`, true); return; }
        // One model per set: panels from another model's export are never added under this set's source.
        const here = set.source?.documentId ?? null, there = incoming.source?.documentId ?? null;
        const otherModel = set.panels.length && here !== there && (here || there);
        const choice = await chooseImport(file.name, incoming.panels.length, !otherModel ? '' : !here ? 'These panels are from a model; the panels here are not: replace them, or keep the model\'s panels in a set of their own.'
            : !there ? 'These panels are not from a model; the panels here are: replace them, or keep them in a set of their own.' : 'These panels are from another model than the panels here: replace them, or keep each model in its own set.');
        if (!choice) { notice(`Nothing imported from ${file.name}.`); return; }
        if (choice === 'replace') {
            const r = IM.replaceSet(incoming, parsed, warnings, newPanelId);
            set = { ...r.set, current: r.set.panels[0]?.id ?? null };
            checked.clear(); sel = null; ask = null; selection = W.NONE;
            historyHint = { label: `replacing with ${file.name}` };
            save(); renderAll();
            if (!r.transformed.length) markExported(); // what is here now is that file
            notice(r.transformed.length ? `Replaced with ${set.panels.length} panel${set.panels.length === 1 ? '' : 's'} from ${file.name}. ${r.transformed.join(' ')} Not the file as it was: export to keep it as read.`
                : `Replaced with ${set.panels.length} panel${set.panels.length === 1 ? '' : 's'} from ${file.name}, as the file has them.`, r.transformed.length > 0);
            return;
        }
        const rows = IM.matchIncoming(set, incoming);
        let choices = {};
        if (rows.some(r => r.status === 'match' || r.status === 'ambiguous')) {
            choices = await chooseConflicts(file.name, rows);
            if (!choices) { notice(`Nothing imported from ${file.name}.`); return; }
        }
        const before = new Set(set.panels.map(p => p.id)), merged = IM.mergeAdd(set, rows, choices, newPanelId), rep = merged.report;
        if (!rep.added.length && !rep.updated.length && !rep.copies.length) { notice(`Nothing imported from ${file.name}: ${rep.skipped.length} skipped.`); return; }
        // The set's framing by model type (and the file's): given to the panels added that have none chosen (reported).
        const typeFr = { ...(set.typeFraming || {}), ...(incoming.typeFraming || {}) };
        // The file's opening profiles join the set's (a name the set has already: the set's kept, said when they differ);
        // the panels added take the one named for their Revit family : type when they have nothing chosen (reported).
        const mine = opProfiles(), theirs = OP.cleanProfiles(incoming.openingProfiles) || [], has = (x) => mine.find(y => y.name.toLowerCase() === x.name.toLowerCase());
        const profs = [...mine, ...theirs.filter(x => !has(x))], keptMine = theirs.filter(x => has(x) && JSON.stringify(has(x)) !== JSON.stringify(x)).map(x => has(x).name);
        let panels = merged.panels, typed = 0, linked = 0;
        for (const prof of profs) {
            const fresh = panels.filter(p => !before.has(p.id)), r = OP.linkByRevitName(fresh, prof, { only: 'unset' }), byId = new Map(r.panels.map(p => [p.id, p]));
            panels = panels.map(p => byId.get(p.id) || p); linked += r.linked.length;
        }
        for (const [key, fr] of Object.entries(typeFr)) {
            const fresh = panels.filter(p => !before.has(p.id)), r = OC.applyTypeFraming(fresh, key, fr, { only: 'unset' }), byId = new Map(r.panels.map(p => [p.id, p]));
            panels = panels.map(p => byId.get(p.id) || p); typed += r.changed.length;
        }
        // A model's export: its source, grids and levels kept with the set (written back on Export JSON).
        const context = Object.fromEntries(['source', 'grids', 'levels'].map(k => [k, incoming[k] ?? set[k]]).filter(([, v]) => v != null));
        if (Object.keys(typeFr).length) context.typeFraming = typeFr;
        if (profs.length) context.openingProfiles = profs;
        const colors = set.legendColors ?? incoming.legendColors; // the set's opening colors kept; else the file's
        if (colors != null) context.legendColors = colors;
        // Unknown fields of the file (a newer exporter's) ride along to Export JSON.
        const extra = { ...(incoming.extra || {}), ...(set.extra || {}) };
        const first = panels.find(p => !before.has(p.id)) || panels.find(p => rep.updated.some(u => u.startsWith(p.mark)));
        set = { project: set.project || incoming.project, drawnBy: set.drawnBy || incoming.drawnBy, ...context, ...(Object.keys(extra).length ? { extra } : {}), panels, current: first?.id ?? set.current };
        checked.clear(); sel = null; ask = null; selection = W.NONE;
        historyHint = { label: `importing ${file.name}` };
        save(); renderAll();
        const what = [rep.added.length ? `added ${rep.added.join(', ')}` : '', rep.updated.length ? `updated ${rep.updated.join('; ')}` : '', rep.copies.length ? `study copies ${rep.copies.join(', ')}` : '',
            rep.skipped.length ? `skipped ${rep.skipped.join(', ')}` : ''].filter(Boolean).join('; ');
        notice([`From ${file.name}: ${what}${rep.renamed.length ? ` (marks taken: ${rep.renamed.join(', ')})` : ''}.`,
            linked ? `${linked} opening${linked === 1 ? '' : 's'} took the profile named for their Revit type.` : '',
            typed ? `${typed} opening${typed === 1 ? '' : 's'} took the set's framing for their model type.` : '',
            keptMine.length ? `Opening profiles kept as this set has them (the file's differ): ${keptMine.join(', ')}.` : '', ...rep.notes, ...warnings].filter(Boolean).join(' '), !!(rep.notes.length || warnings.length || typed || linked || keptMine.length));
    } catch (err) { notice(`Could not read ${file.name}: ${err.message} Nothing was changed.`, true); }
}
async function copyLink(p) {
    const url = `${location.origin}${location.pathname}#p=${G.encodePanel(p)}`;
    try { await navigator.clipboard.writeText(url); notice(`Link to ${p.mark} copied: it opens this panel in the generator (in any browser).`); } catch { prompt('Copy this link:', url); }
}
// A link to a panel (Copy link, or the QR code on its sheet): add it to the set, unless the same panel is already here.
function openLinkedPanel() {
    const m = /^#p=([\w-]+)$/.exec(location.hash);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    try {
        const p = G.decodePanel(m[1]), same = (a) => JSON.stringify({ ...G.cleanPanel(a), id: 0 }) === JSON.stringify({ ...p, id: 0 });
        const have = set.panels.find(same);
        if (have) { set.current = have.id; notice(`${p.mark} from the link is already here: opened it.`); return; }
        let mark = p.mark;
        while (set.panels.some(x => x.mark === mark)) mark = G.nextMark(mark);
        const added = { ...p, id: `p-${Math.random().toString(36).slice(2, 10)}`, mark };
        set.panels.push(added);
        set.current = added.id;
        save();
        notice(`Opened ${p.mark} from a link${mark !== p.mark ? ` (as ${mark}: that mark was taken)` : ''}: it is in your set now.`);
    } catch { notice('This link\'s panel could not be read.', true); }
}

// --- Start ----------------------------------------------------------------------------------------------------------------
// The site's views (hits.js): this visit counted (once per 30 minutes a browser), the count in the title bar.
siteHits().then(h => mountHits(document.getElementById('site-hits'), h, { compact: true })).catch(() => {});
openLinkedPanel();
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#p=')) { openLinkedPanel(); sel = null; ask = null; renderAll(); } }); // a link pasted into this tab
fetch(LOGO_URL).then(r => (r.ok ? r.blob() : null)).then(b => b && new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }))
    .then(href => { logoHref = href || null; renderPreview(); }).catch(() => {});
// The workspace's own clicks and keys: views, cut list rows, issues and their actions, members in the views.
const NO_PANEL_ACTS = new Set(['prof-del', 'prof-link', 'legend-reset', 'fs-apply', 'fs-reset', 'sd-labels', 'sd-label-maker', 'hist-menu', 'undo-to', 'help', 'help-close', 'new-menu', 'new-blank', 'new-tpl', 'tpl-del', 'sd-filter', 'sd-open', 'set-open', 'sd-close', 'sd-tab', 'sd-csv', 'new', 'set-import', 'set-export', 'set-export-plan', 'eng-open', 'undo', 'redo', 'nav-toggle', 'set-clear', 'bottom-toggle', 'set-check-all', 'set-check-none']);
const NOT_EDITS = new Set(['fs-reset', 'sd-labels', 'sd-label-maker', 'view-compare', 'hist-menu', 'undo-to', 'help', 'help-close', 'new-menu', 'tpl-save', 'tpl-del', 'sd-filter', 'sd-open', 'set-pdf-typ', 'set-open', 'sd-close', 'sd-tab', 'sd-csv', 'qb-type', 'qb-opening', 'qb-members', 'open', 'undo', 'redo', 'nav-toggle', 'bottom-toggle', 'framing', 'pdf', 'link', 'set-pdf', 'set-export', 'set-export-plan', 'set-import', 'eng-open', 'man-mode', 'man-step', 'man-type-preview', 'man-type-cancel', 'sch-pick', 'sch-check-all',
    'select-op', 'done', 'preview', 'set-check-all', 'set-check-none', 'tool', 'peri-undo', 'peri-cancel']);
for (const action of ['layout-nav', 'inspector-toggle', 'focus-view']) { NO_PANEL_ACTS.add(action); NOT_EDITS.add(action); }
const ACT_LABELS = { 'prof-update': 'updating the opening profile', 'prof-reset': 'back to the opening profile', 'prof-del': 'deleting the opening profile', 'prof-link': 'the opening profile by Revit name', 'legend-reset': 'the legend colors',
    'fs-apply': 'the framing settings on every panel', 'rev-issue': 'issuing the revision', 'new-blank': 'the new panel', 'new-tpl': 'the new panel from a template', 'type-framing': 'the framing for every opening of the type', 'oc-add': 'the opening for the model\'s element', 'sch-apply': 'the openings\' members', 'sch-rules': 'the rules for every opening', 'sch-arrange': 'the arrangement', 'cutback-all': 'the cutback on every panel', 'ctx-place': 'the level', 'ctx-grid-add': 'the new grid', 'ctx-grid-del': 'removing the grid', 'ctx-model': 'the model\'s levels and grids', 'ctx-toggle': 'showing the levels and grids', new: 'the new panel', copy: 'the duplicate', 'add-op': 'the new opening', 'add-op-at': 'the new opening', 'del-op': 'removing the opening', shape: 'the shape',
    'stud-flip': 'the stud flip', 'flips-clear': 'clearing the stud flips', side: 'the viewing side', 'layout-from': 'the layout start', 'layout-reset': 'the layout start', 'layout-here': 'the layout start',
    'clip-here': 'the clip', 'clip-del': 'removing the clip', 'clip-top': 'the clips', 'clip-mid': 'the clips', 'clip-all': 'the clips', 'clip-clear': 'removing the clips',
    'mirror-op': 'mirroring the opening', 'copy-op': 'copying the opening', center: 'centering the opening', 'peri-finish': 'the perimeter', 'set-assign': 'giving the members', 'set-delete': 'deleting panels',
    'rule-use': 'the opening rule', 'op-alt': 'the rule alternative', 'op-rule-member': 'back to the rule', 'op-arrange': 'the arrangement',
    'man-unlock': 'unlocking the member', 'man-lock': 'locking the member', 'man-unlock-all': 'unlocking every member', 'man-lock-all': 'locking every member',
    'man-nudge': 'the move', 'man-type-apply': 'the member type', 'man-fill': 'the stud added in a wide bay', 'man-copy': 'the copy', 'man-mirror': 'the mirrored copy', 'man-remove': 'removing the member' };
main.addEventListener('click', (e) => {
    const vt = e.target.closest('[data-view-tab]');
    if (vt) { setView(vt.dataset.viewTab); return; }
    const bt = e.target.closest('[data-bottom-tab]');
    if (bt) { prefs.bottom = bt.dataset.bottomTab; prefs.bottomOpen = true; storePrefs(); renderBottom(current); main.querySelector(`[data-bottom-tab="${prefs.bottom}"]`)?.focus(); return; }
    const ia = e.target.closest('[data-issue-act]');
    if (ia) { const [n, k] = ia.dataset.issueAct.split(':').map(Number), issue = current.plan?.issues?.[n]; const a = W.issueActions(current.plan, issue, { modelLinked: G.isFromModel(cur()) }).actions[k]; if (a) runCommand(a.command, a.arg); return; }
    const ctx = e.target.closest('[data-ctx]');
    if (ctx) { const c = ctx.dataset.ctx; if (c === 'clear') selectTarget(W.NONE); else if (c === 'select-opening') selectTarget({ kind: 'opening', key: ctx.dataset.v }, { locate: true }); else if (c === 'framing') runCommand('open-framing', ctx.dataset.v); return; }
    const row = e.target.closest('tr[data-mark]');
    if (row && !e.target.closest('select, input, button')) { selectTarget({ kind: 'mark', key: row.dataset.mark }); return; }
    const iss = e.target.closest('[data-issue]');
    if (iss && !e.target.closest('button')) { selectTarget({ kind: 'issue', key: Number(iss.dataset.issue) }); return; }
    if (e.target.closest('.mark-hit')) { selection = W.NONE; renderWorkspace(); renameFocus(); return; }
    const oh = e.target.closest('.op-hit[data-key]');
    if (oh) { selectTarget({ kind: 'opening', key: oh.dataset.key }); return; }
    const hit = e.target.closest('.member-hit[data-i]');
    if (hit) { const keys = current.plan?.graphics?.[Number(hit.dataset.i)]?.memberKeys || []; if (keys.length) selectTarget({ kind: 'member', key: keys[0] }); }
});
main.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('tr[data-mark]')) { e.preventDefault(); selectTarget({ kind: 'mark', key: e.target.dataset.mark }); return; }
    const tab = e.target.closest?.('[role="tab"]');
    if (tab && /^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) { // tabs: arrows move and choose
        const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]:not(:disabled)')], i = tabs.indexOf(tab);
        const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        e.preventDefault(); next.click(); main.querySelector(`[role="tab"][aria-selected="true"]${next.dataset.viewTab ? '[data-view-tab]' : '[data-bottom-tab]'}`)?.focus();
    }
});
main.addEventListener('toggle', (e) => { const d = e.target; if (d.matches?.('.insp-sec')) { prefs.sections[d.dataset.sec] = d.open; storePrefs(); } }, true);
applyPrefs();
renderAll();
new ResizeObserver(() => { if (cur() && prefs.view === 'sketch' && !drag) renderSketch(); }).observe(main.querySelector('.sketch-wrap'));
