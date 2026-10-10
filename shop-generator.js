// Panel Shop Generator (shop-generator.html): framing shop drawings without a model. A panel is drawn or typed in (its
// perimeter or shape, its doors, windows, MEP openings and steel penetrations, its members) and framed and drawn with the
// model's shop drawing code (demos/06-shop-drawings/generator.mjs, sheet.mjs). Nothing is uploaded: the set of panels,
// the sizes and members used before and the saved member combos are kept in this browser (localStorage); Export JSON
// keeps or shares a set, and a link (or the QR code on a sheet) opens one panel here.
// The elevation editor: the core members (top track, on-center studs, bottom track) over it; tools to select and move,
// draw the perimeter (a notch becomes a door or a steel penetration) or draw an opening; dimensions all around what is
// selected, hovered or being moved; the selected opening's members beside it (a catalogue: a preview and a list each).
import { fmtFtIn, topAt, topMin, underMin, underAt, pitchText, frameWall, webOnRight } from './demos/common/framing.mjs';
import { renderSheet, renderSheetPdf, renderSheetsPdf, renderSheetRegion } from './demos/06-shop-drawings/sheet.mjs';
import { thumbnailSvg } from './demos/06-shop-drawings/panels.mjs';
import * as G from './demos/06-shop-drawings/generator.mjs';

const LOGO_URL = 'demos/06-shop-drawings/cas-logo.png';
const KEYS = { set: 'cas-shopgen:set', recent: 'cas-shopgen:recent', combos: 'cas-shopgen:combos' };
const main = document.getElementById('gen');
const $ = (sel) => main.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: this visit only */ } };
const today = () => new Date().toLocaleDateString('en-CA');
const lenText = (v) => (Number.isFinite(v) ? fmtFtIn(v) : '');
const inch = (v) => fmtFtIn(v).replace(/^0'-/, '').replace(/^0 (?=\d+\/)/, ''); // 0'-6" -> 6", 0'-0 1/2" -> 1/2"

let set = load(KEYS.set, null);
set = set?.panels ? { ...set, panels: set.panels.map(G.cleanPanel) } : { project: '', drawnBy: '', panels: [], current: null };
if (!set.panels.length) set.panels.push(G.newPanel());
let recent = load(KEYS.recent, {}); // field -> values used before, newest first
let combos = load(KEYS.combos, []); // [{ name, members }] saved here
const checked = new Set(); // panels checked in the set
let logoHref = null;
// The elevation editor's state.
let tool = 'select'; // 'select' (and move), 'perimeter' (draw it), 'opening' (draw a rectangle)
let sel = null; // the selected opening (its members in the catalogue)
let ask = null; // the opening just added: the catalogue asks for its members
let hover = null; // what the pointer is over: 'op:2', 'edge:3', 'pt:1', 'peak', …
let drag = null, rectDraw = null, peri = null, svgEl = null, view = null;
const typing = new Set(); // member cards showing a box to type a size in
const cur = () => set.panels.find(p => p.id === set.current) || set.panels[0];
const studName = (m) => G.parseMember(m.stud)?.name || m.stud;
const bottomTrack = (m) => G.parseMember(m.track)?.name || G.trackFor(m.stud) || m.track;

// --- Saving, notices --------------------------------------------------------------------------------------------------
let saveTimer = 0;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store(KEYS.set, { ...set, current: cur().id }), 250); };
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
    const el = e.target.closest('[data-f]');
    if (!el) return;
    const p = cur(), path = el.dataset.f, onSet = path.startsWith('set.');
    if (!onSet && !G.canEdit(p, path)) { lockedNotice(); return; }
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.t === 'len') {
        const n = G.parseLength(v);
        hint(el, n);
        if (n == null) return;
        v = n;
    } else if (el.dataset.t === 'num') {
        v = Number(v);
        if (!Number.isFinite(v)) return;
    }
    const right = /^openings\.(\d+)\.__right$/.exec(path), kind = /^openings\.(\d+)\.kind$/.exec(path);
    if (right) { const o = p.openings[Number(right[1])]; o.leftIn = Math.max(0, G.shapeTop(p.shape).lengthIn - v - o.widthIn); syncCatalogueFields(); }
    else if (path === 'shape.lengthIn' && p.shape.kind === 'custom') { setCustomLength(p, v); syncPointEnds(); }
    else if (path === 'shape.lengthIn' && p.shape.kind === 'gable' && Math.abs((p.shape.peakAtIn ?? 0) - p.shape.lengthIn / 2) < 1 / 8) {
        p.shape.lengthIn = v; p.shape.peakAtIn = v / 2; // a centered peak stays centered
        const peak = main.querySelector('[data-f="shape.peakAtIn"]');
        if (peak) peak.value = lenText(v / 2);
    } else setPath(onSet ? set : p, onSet ? path.slice(4) : path, v);
    if (kind) { setKind(p, Number(kind[1]), v); renderCatalogue(); renderChips(); }
    if (path === 'optimizeOpenings') notice(v ? 'Opening optimizer on: the studs on center start where the openings take the fewest stud pieces, every bay within the spacing.' : `Opening optimizer off: studs on center from the ${p.layoutFromRight ? 'right' : 'left'} end.`);
    if (path === 'flipStuds') notice(v ? 'Flip studs on: the studs on center face the other way (end studs and jambs still close their side).' : 'Flip studs off: the studs on center face the left end, as usual.');
    if (path === 'layoutFromRight') notice(v ? 'Flip panel on: the stud layout starts from the right end, and the plan ordinates run from it.' : 'Flip panel off: the stud layout starts from the left end.');
    if (/^(optimizeOpenings|flipStuds|layoutFromRight)$/.test(path)) syncToggles();
    const toLayout = /^openings\.(\d+)\.toLayout$/.exec(path);
    if (toLayout) {
        const n = G.openingName(p.openings, Number(toLayout[1]));
        notice(v ? `${n}: its jambs moved out to the nearest studs on center, which are its jambs now (the rough opening stays as typed).` : `${n}: its jambs at the opening again.`);
        renderCatalogue();
    }
    if (el.closest('#sk-menu')) closeMenu();
    if (/^openings\.\d+\.(widthIn|leftIn)$/.test(path)) syncCatalogueFields(path);
    changed();
});
// On leaving a field: the length as feet-inches, the value remembered for the next time, a new stud followed.
let studBefore = null;
main.addEventListener('focusin', (e) => { if (e.target.matches?.('[data-f="members.stud"]')) studBefore = cur().members.stud; });
main.addEventListener('change', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { pickMember(pick.dataset.pick, pick.value); if (pick.closest('#sk-menu')) closeMenu(); return; }
    if (e.target.id === 'combo') { applyCombo(e.target.value); return; }
    if (e.target.matches('[data-check]')) { e.target.checked ? checked.add(e.target.dataset.check) : checked.delete(e.target.dataset.check); renderSetActions(); return; }
    if (e.target.id === 'check-group') { for (const x of set.panels) if ((x.group || '') === e.target.value) checked.add(x.id); e.target.value = '__'; renderSet(); return; }
    const el = e.target.closest('[data-f]');
    if (!el) return;
    if (el.dataset.f === 'members.stud' && studBefore != null && studBefore !== el.value) { followStud(studBefore, el.value); studBefore = el.value; }
    if (el.dataset.t === 'len') {
        const n = G.parseLength(el.value);
        if (n != null) { el.value = lenText(n); hint(el, n, true); recent.len = G.remember(recent.len, lenText(n), 12); }
    }
    if (el.dataset.r) recent[el.dataset.r] = G.remember(recent[el.dataset.r], el.value);
    store(KEYS.recent, recent);
    renderDatalists();
    if (typing.has(el.dataset.f)) { typing.delete(el.dataset.f); renderMemberCards(); }
    if (el.dataset.f === 'mark' || el.dataset.f === 'group') renderSet();
    if (/^openings\.\d+\.offsetIn$/.test(el.dataset.f)) renderCatalogue(); // its rough opening in the strip
});
document.getElementById('import-file').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importJson(f); });
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
        value="${esc(t === 'len' ? lenText(value) : value ?? '')}" placeholder="${esc(ph)}" autocomplete="off"${locked ? ' disabled title="Locked: the Revit model\'s"' : ''}>
    <em class="hint"></em></label>`;

// --- Actions (data-act) -----------------------------------------------------------------------------------------------
document.addEventListener('click', (e) => { // the title bar's buttons too
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, i = Number(b.dataset.i), p = cur();
    const acts = {
        new: () => addPanel(G.newPanel(p, set.panels.map(x => x.mark))),
        copy: () => { addPanel(G.copyPanel(p, set.panels.map(x => x.mark))); if (G.isFromModel(p)) notice(`${cur().mark} is a free copy of ${p.mark}, not linked to the Revit wall: change anything on it.`); },
        shape: () => { if (!G.canEdit(p, 'shape')) return lockedNotice('its shape'); p.shape = G.changeShape(p.shape, b.dataset.kind); renderElevHead(); renderShapeTable(); fit(); changed(); },
        tool: () => (b.dataset.tool === 'perimeter' && !G.canEdit(p, 'shape') ? lockedNotice('its perimeter') : setTool(b.dataset.tool)),
        'add-op': () => addOpening(p, b.dataset.kind),
        'select-op': () => { sel = i; ask = null; renderCatalogue(); renderChips(); renderSketch(); },
        done: () => { sel = null; ask = null; renderCatalogue(); renderChips(); renderSketch(); },
        'add-point': () => { if (!G.canEdit(p, 'shape')) return lockedNotice('its top'); addPoint(p); renderShapeTable(); changed(); },
        'del-point': () => { if (!G.canEdit(p, 'shape')) return lockedNotice('its top'); if (p.shape.points.length > 2) p.shape.points.splice(i, 1); renderShapeTable(); changed(); },
        'del-op': () => { if (!G.canEdit(p, `openings.${i}`)) return lockedNotice('the model\'s openings'); p.openings.splice(i, 1); sel = null; ask = null; renderCatalogue(); renderChips(); changed(); },
        center: () => { if (!G.canEdit(p, `openings.${i}.leftIn`)) return lockedNotice('the model\'s openings'); const o = p.openings[i]; o.leftIn = Math.round(((G.shapeTop(p.shape).lengthIn - o.widthIn) / 2) * 16) / 16; syncCatalogueFields(); changed(); },
        preview: () => flipPreview(),
        'layout-here': () => setLayoutStart(p, Number(b.dataset.x)),
        'layout-reset': () => { delete p.layoutStartIn; syncToggles(); changed(); notice(`${p.mark}: the first stud is ${p.optimizeOpenings ? 'the optimizer\'s' : 'on the standard layout'} again.`); },
        'layout-from': () => { p.layoutFromRight = b.dataset.side === 'right'; syncToggles(); changed(); notice(`The stud layout now starts from the ${b.dataset.side} end.`); },
        'add-ctrl': () => addControlPoint(p, Number(b.dataset.x)),
        'add-op-at': () => addOpeningAt(p, b.dataset.kind, Number(b.dataset.x), Number(b.dataset.y)),
        'copy-op': () => copyOpening(p, i),
        framing: () => openFraming(i),
        'mirror-op': () => { if (!G.canEdit(p, `openings.${i}.leftIn`)) return lockedNotice('the model\'s openings'); const o = p.openings[i]; o.leftIn = round16(G.shapeTop(p.shape).lengthIn - o.leftIn - o.widthIn); syncCatalogueFields(); changed(); notice(`${G.openingName(p.openings, i)} mirrored: ${fmtFtIn(o.leftIn)} from the left end now.`); },
        'stud-flip': () => { const x = Number(b.dataset.x), had = (p.studFlips || []).some(c => Math.abs(c - x) < 0.5); p.studFlips = had ? p.studFlips.filter(c => Math.abs(c - x) >= 0.5) : [...(p.studFlips || []), x]; changed(); notice(had ? 'That stud faces its usual way again.' : 'That stud faces the other way now (right-click it again to flip it back).'); },
        'clip-here': () => addClips(p, [{ type: clipType, x: Number(b.dataset.x), y: Number(b.dataset.y) }]),
        'clip-del': () => removeClip(p, i),
        'clip-top': () => laid.lay && addClips(p, G.clipsAtTop(laid.lay, clipType)),
        'clip-mid': () => laid.lay && addClips(p, G.clipsOnEveryStud(laid.lay, round16(G.shapeTop(p.shape).heightIn / 2), clipType)),
        'clip-all': () => { const y = G.parseLength(document.getElementById('clip-at')?.value); if (y == null || !laid.lay) return notice('Type a height for the clips, like 4\'-0".', true); clipAt = y; addClips(p, G.clipsOnEveryStud(laid.lay, y, clipType)); },
        'clip-clear': () => { const n = (p.clips || []).length; p.clips = []; renderHint(); changed(); notice(`${n} clip${n === 1 ? '' : 's'} removed.`); },
        'peri-finish': () => finishPerimeter(),
        'peri-undo': () => { peri?.pts.pop(); renderSketch(); renderHint(); },
        'peri-cancel': () => setTool('select'),
        pdf: () => downloadPdf([p]),
        link: () => copyLink(p),
        'save-combo': () => saveCombo(p),
        'del-combo': () => deleteCombo(),
        open: () => { set.current = b.dataset.id; sel = null; ask = null; setTool('select', false); renderAll(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
        'set-pdf': () => downloadPdf(chosen()),
        'set-assign': () => assign(p),
        'set-delete': () => deletePanels(),
        'set-export': () => exportJson(),
        'set-import': () => document.getElementById('import-file').click(),
        'set-check-all': () => { set.panels.forEach(x => checked.add(x.id)); renderSet(); },
        'set-check-none': () => { checked.clear(); renderSet(); },
        'set-clear': () => clearSet(),
    };
    acts[act]?.();
    if (b.closest('#sk-menu')) closeMenu();
});

function addPanel(panel) {
    set.panels.push(panel);
    set.current = panel.id;
    sel = null; ask = null;
    renderAll();
    notice(`${panel.mark} added. Its shape and members follow the panel before it: change what differs.`);
    $('#panel-card input[data-f="mark"]')?.focus();
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
function addOpening(p, kind) {
    const { lengthIn: L, heightIn: H } = G.shapeTop(p.shape), type = G.OPENING_TYPES[kind];
    const prev = [...p.openings].reverse().find(o => o.kind === kind), size = type.size;
    const o = { kind, widthIn: prev?.widthIn ?? size.widthIn, heightIn: kind === 'steel' ? 0 : prev?.heightIn ?? Math.min(size.heightIn, H - 12), head: '', jamb: '', sill: '' };
    o.sillIn = kind === 'door' ? 0 : kind === 'steel' ? prev?.sillIn ?? Math.max(3, H - 24) : prev?.sillIn ?? Math.min(size.sillIn, Math.max(3, H - o.heightIn - 12));
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

// --- Rendering ---------------------------------------------------------------------------------------------------------
function renderAll() {
    unflip();
    renderPanel(); renderElevHead(); renderCore(); renderTools(); renderShapeTable(); renderCatalogue(); renderChips(); renderDatalists(); renderSet(); renderLayoutInfo();
    fit(); refresh(true);
}
let refreshTimer = 0;
function changed() { save(); refresh(); }
function refresh(now = false) {
    if (!drag && tool !== 'perimeter') fit(); // the view follows the panel's size, but holds still while dragging
    renderSketch();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { renderPreview(); renderSet(); renderChips(); renderLayoutInfo(); }, now ? 0 : drag ? 160 : 90);
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
// The sheet's switches (Side B, Flip studs, Flip panel) and the optimizer's, as the panel has them.
function syncToggles() {
    const p = cur();
    for (const k of ['sideB', 'flipStuds', 'layoutFromRight']) for (const el of main.querySelectorAll(`#flip-bar [data-f="${k}"]`)) { el.checked = !!p[k]; el.closest('.pill')?.classList.toggle('on', !!p[k]); }
    renderLayoutInfo();
}

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
function memberCard({ path, label, value = '', options, resolved, r, note = '', extra = '', ask: asking = false }) {
    const typed = typing.has(path);
    return `<div class="mcard ${asking ? 'ask' : ''}" data-card="${esc(path)}">
        <div class="micon" aria-hidden="true">${memberIcon(resolved)}</div>
        <div class="mbody"><span class="mlabel">${esc(label)}</span>
            <select data-pick="${esc(path)}" aria-label="${esc(label)}">${optionTags(path, value, options)}</select>
            ${typed ? `<input type="text" class="mtype" data-f="${esc(path)}" data-r="${r}" list="dl-${r}" value="${esc(value)}" placeholder="362S162-43, or (2) 362S162-43 WITH (1) 362T125-43" autocomplete="off">` : ''}
            <small class="mdesc">${esc(note || G.specText(resolved) || resolved)}</small>${extra}</div></div>`;
}
// A core member's choices: the top track, the studs on center or the bottom track.
function coreChoice(key) {
    const m = cur().members, ch = G.memberChoices(m), bottom = bottomTrack(m), matching = G.trackFor(m.stud);
    if (key === 'topTrack') return { path: 'members.topTrack', label: 'Top track', value: m.topTrack, r: 'topTrack', resolved: m.topTrack || bottom,
        options: [{ value: '', label: `Same as bottom track: ${bottom}` }, ...optsOf(ch.topTrack, 'topTrack')], note: m.topTrack ? '' : `as the bottom track, ${bottom}` };
    if (key === 'stud') return { path: 'members.stud', label: 'On-center studs', value: m.stud, r: 'stud', resolved: m.stud, options: optsOf(ch.stud, 'stud') };
    return { path: 'members.track', label: 'Bottom track', value: m.track, r: 'track', resolved: bottom,
        options: [{ value: '', label: `Matches the stud: ${matching}` }, ...optsOf(ch.track, 'track')], note: m.track ? '' : `matches the stud, ${matching}` };
}
function renderCore() {
    const m = cur().members;
    const spacing = typing.has('members.spacingIn')
        ? `<input type="text" class="mtype" data-f="members.spacingIn" data-t="num" value="${esc(m.spacingIn)}" aria-label="Stud spacing in inches">`
        : `<select data-pick="members.spacingIn" aria-label="Stud spacing">${[...new Set([...G.SPACINGS, Number(m.spacingIn)])].map(v => `<option value="${v}" ${v === Number(m.spacingIn) ? 'selected' : ''}>${v}" o.c.</option>`).join('')}<option value="__type">Other…</option></select>`;
    $('#core-strip').innerHTML = `<div class="row core-head"><b>Core members</b><span class="muted small">top track · studs on center · bottom track</span><span class="spacer"></span>
            <select id="combo" aria-label="Member combo"><option value="">Member combo…</option>
                <optgroup label="Saved in this browser">${combos.map((c, i) => `<option value="s${i}">${esc(c.name)}</option>`).join('') || '<option disabled>None yet: Save as a combo</option>'}</optgroup>
                <optgroup label="Typical (check against the framing criteria)">${G.COMBOS.map((c, i) => `<option value="b${i}">${esc(c.name)}</option>`).join('')}</optgroup></select>
            <button class="secondary" data-act="save-combo">Save as a combo</button>${combos.length ? '<button class="link" data-act="del-combo">Delete a combo</button>' : ''}</div>
        <div class="core-cards">
            ${memberCard(coreChoice('topTrack'))}
            ${memberCard({ ...coreChoice('stud'), extra: `<div class="spacing"><label>@ ${spacing}</label></div>` })}
            ${memberCard(coreChoice('track'))}
        </div>`;
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
    if (o.toLayout) { try { const b = G.frameInputs(p).openings[i]; if (b?.requested) framedText = `framed ${fmtFtIn(b.right - b.left)} between jambs · `; } catch { /* inputs to fix */ } }
    const parts = [pieces ? `${n} ${pieces > 0 ? 'fewer' : 'more'} stud piece${n === 1 ? '' : 's'}` : '', Math.abs(lengthIn) >= 1 ? `${fmtFtIn(Math.abs(lengthIn))} ${lengthIn > 0 ? 'less' : 'more'} steel` : ''].filter(Boolean);
    return framedText + (parts.length ? `${o.toLayout ? '' : 'turned on: '}${parts.join(', ')}` : 'no saving here');
}
function layoutToggle(p, i) {
    const o = p.openings[i];
    return `<label class="opt-toggle lay-toggle${o.toLayout ? ' on' : ''}" title="Move this opening's jambs out to the nearest studs on center: those studs are its jambs, so no extra studs stand beside it. The rough opening stays as typed, drawn inside the framed one.">
        <input type="checkbox" data-f="openings.${i}.toLayout" ${o.toLayout ? 'checked' : ''}><span>Jambs on the stud layout</span><small>${esc(toLayoutNote(p, i))}</small></label>`;
}
// Above an opening's members: which opening they are for (a small picture of its framing, its kind, size and place).
function openingContext(p, i) {
    const o = p.openings[i], name = G.openingName(p.openings, i), type = G.OPENING_TYPES[o.kind];
    const size = o.kind === 'steel' ? `${fmtFtIn(o.widthIn)} wide, up through the top from ${fmtFtIn(o.sillIn)}` : `${fmtFtIn(o.widthIn)} x ${fmtFtIn(o.heightIn)}${o.kind === 'door' ? '' : `, sill ${fmtFtIn(o.sillIn)}`}`;
    return `<div class="op-context ${o.kind}">${openingGlyph(o.kind)}<div><span class="muted small">Members for</span> <b>${name}</b> · ${esc(type.name)}<br>
        <span class="small">${esc(size)} · ${fmtFtIn(o.leftIn)} from the left end</span>${G.offsetOf(o) > 0 ? `<br><span class="small ro-text">rough opening ${esc(roText(p, i))}</span>` : ''}</div></div>`;
}
function openingGlyph(kind) { // the opening, a jamb each side, the header over it and the sill under it, as the kind has them
    const head = kind !== 'steel', sill = kind !== 'door', y0 = head ? 9 : 0, y1 = kind === 'door' ? 38 : 30;
    return `<svg class="op-glyph" viewBox="0 0 56 40" aria-hidden="true"><rect class="g-op ${kind}" x="15" y="${y0}" width="26" height="${y1 - y0}"/>
        <rect class="g-j" x="11" y="${y0}" width="4" height="${y1 - y0}"/><rect class="g-j" x="41" y="${y0}" width="4" height="${y1 - y0}"/>
        ${head ? `<rect class="g-h" x="11" y="${y0 - 5}" width="34" height="4"/>` : ''}${sill ? `<rect class="g-s" x="11" y="${y1 + 1}" width="34" height="3"/>` : ''}
        <line class="g-floor" x1="2" y1="39.5" x2="54" y2="39.5"/></svg>`;
}
function renderCatalogue() {
    const box = $('#catalogue'), p = cur();
    if (sel != null && !p.openings[sel]) { sel = null; ask = null; }
    if (sel == null) {
        box.innerHTML = `<h3>Opening members</h3>
            <p class="muted small">Every opening is framed with these unless you pick its own: click an opening in the elevation, or add one.</p>
            ${['jamb', 'head', 'sill'].map(k => openingCard(null, k)).join('')}
            <p class="muted small">Doors take jambs and a header; windows and MEP openings jambs, a header and a sill; steel penetrations (up through the top) jambs and a sill.</p>`;
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
            ${f('From left end', 'leftIn', o.leftIn)}${f('From right end', '__right', Math.max(0, L - o.leftIn - o.widthIn))}
            ${field('Framing offset', `openings.${sel}.offsetIn`, G.offsetOf(o), { t: 'len', list: 'len', cls: 'f-offset', ph: `${inch(G.FRAMING_OFFSETS[o.kind])} (${o.kind}s)` })}</div>
        <div class="row fr-row"><button class="secondary" data-act="framing" data-i="${sel}" title="Double jambs, box headers, jack studs, the rough opening: with a preview">⚙ Framing details…</button>
            <span class="muted small">${esc(framingSummary(p, sel))}</span></div>
        ${layoutToggle(p, sel)}
        ${openingContext(p, sel)}
        ${type.members.map(k => openingCard(sel, k)).join('')}
        <div class="row"><button data-act="done">Done</button>${locked ? '' : `<button class="link" data-act="center" data-i="${sel}">Center it</button><span class="muted small">Arrow keys move it (Shift: 6").</span>`}</div>`;
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
    const t = (key, label, title) => `<button class="${tool === key ? 'on' : 'secondary'}" data-act="tool" data-tool="${key}" title="${esc(title)}">${label}</button>`;
    $('#tools').innerHTML = `<div class="seg" role="group" aria-label="Tool">${t('select', '↖ Select &amp; move', 'Pick an opening to see its dimensions and members; drag it or the round handles')}
            ${G.canEdit(cur(), 'shape') ? t('perimeter', '✎ Draw perimeter', 'Click the panel\'s corners; a notch up from the bottom becomes a door, one down from the top a steel penetration')
                : '<button class="secondary" disabled title="Locked: the Revit model\'s perimeter">🔒 Perimeter</button>'}
            ${t('opening', '▭ Draw an opening', 'Drag a rectangle on the panel: at the floor it is a door, through the top a steel penetration, else a window')}
            ${t('clip', '◫ Clips', 'Click near a stud to put a clip on it (on its web); click a clip to remove it; or clip every stud at a height')}</div>
        <span class="add-label">Add</span>${Object.entries(G.OPENING_TYPES).map(([k, ty]) => `<button class="add-op ${k}" data-act="add-op" data-kind="${k}">+ ${esc(ty.name)}</button>`).join('')}`;
    renderHint();
}
function renderHint() {
    const el = $('#tool-hint');
    if (tool === 'perimeter') {
        el.innerHTML = `<b>Drawing the perimeter:</b> click each corner (it snaps level and plumb, and to the corners already placed). Type a length and press Enter to place the next corner exactly
            that far toward the pointer. Click the first corner, or press Enter, to close it. A rectangle up from the bottom becomes a door; one down from the top a steel penetration.
            <span class="row peri-actions"><button data-act="peri-finish" ${peri?.pts.length >= 4 ? '' : 'disabled'}>Close the perimeter</button><button class="secondary" data-act="peri-undo" ${peri?.pts.length ? '' : 'disabled'}>Undo a corner</button><button class="link" data-act="peri-cancel">Cancel (Esc)</button></span>`;
    } else if (tool === 'clip') {
        const n = (cur().clips || []).length;
        el.innerHTML = `<b>Clips:</b> click near a stud to put a <input id="clip-type" class="mini wide" list="dl-clip" value="${esc(clipType)}" aria-label="Clip type"> on it, on its web, at that height; click a clip to remove it.
            <span class="row clip-actions">Clip every stud: <button class="secondary" data-act="clip-top">2" under the top</button><button class="secondary" data-act="clip-mid">at mid-height</button>
            or at <input id="clip-at" class="mini" value="${esc(lenText(clipAt))}" aria-label="Height for clips on every stud"><button class="secondary" data-act="clip-all">Clip every stud</button>
            ${n ? `<button class="link danger" data-act="clip-clear">Remove all ${n} clip${n === 1 ? '' : 's'}</button>` : ''}<button class="link" data-act="tool" data-tool="select">Done (Esc)</button></span>`;
    } else if (tool === 'opening') {
        el.innerHTML = '<b>Drawing an opening:</b> drag a rectangle on the panel. Touching the floor it is a door; up through the top a steel penetration; else a window (make it an MEP opening on the right). Esc to stop.';
    } else {
        el.textContent = `${cur().shape.kind === 'custom' ? 'Click above the top line to add a point there; double-click a point to remove it. ' : ''}Point at an opening, a stud, an edge or a corner to see its dimensions; drag an opening or a round handle to change it. Right-click for options.`;
    }
}
function setTool(next, render = true) {
    tool = next;
    drag = null; rectDraw = null;
    peri = next === 'perimeter' ? { pts: [], cursor: null, typed: '' } : null;
    if (next === 'perimeter') { sel = null; ask = null; }
    if (!render) return;
    fit(); renderTools(); renderCatalogue(); renderSketch();
}

// --- The elevation sketch ------------------------------------------------------------------------------------------------
// The view (SVG user units, y down: wall y is -y): the panel with room for dimensions; while drawing the perimeter, a
// fixed canvas big enough to draw in.
function fit() {
    const { lengthIn: L, heightIn: H } = G.shapeTop(cur().shape);
    if (tool === 'perimeter') {
        const W = Math.max(L || 0, 240) * 1.25 + 60, Hh = Math.max(H || 0, 144) * 1.25 + 40;
        view = { x: -48, y: -(Hh - 30), w: W, h: Hh + 30 };
    } else {
        const pad = Math.max(L, H, 48) * 0.17;
        view = { x: -pad * 1.7, y: -(Math.max(H, 12) + pad * 1.5), w: Math.max(L, 12) + pad * 3.4, h: Math.max(H, 12) + pad * 3.1 };
    }
}
function renderSketch() {
    const box = main.querySelector('#sketch');
    if (!box) return;
    const p = cur(), { lengthIn: L, heightIn: H, top } = G.shapeTop(p.shape);
    if (!svgEl || !box.contains(svgEl)) { box.innerHTML = '<svg role="img" aria-label="The panel\'s elevation"></svg>'; svgEl = box.querySelector('svg'); bindSketch(svgEl); }
    if (!view) fit();
    svgEl.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    svgEl.dataset.tool = tool;
    const u = Math.max(view.w, view.h) / 100, fs = u * 2.5, at = (x) => topAt(top, x, H), Y = (y) => -y;
    const t = (x, y, s, { a = 'middle', cls = 'sk-label', size = fs, rot = 0 } = {}) => `<text x="${x}" y="${y}" text-anchor="${a}" font-size="${size}" class="${cls}"${rot ? ` transform="rotate(${rot} ${x} ${y})"` : ''}>${esc(s)}</text>`;
    // Dimension strings: horizontal at height y, vertical at x; ticks at both ends, the value above / left of the line.
    const cs = fs * 0.88; // context dimensions: a little smaller than the panel's own
    const dimH = (x1, x2, y, label, cls = 'sk-ctx', below = false, size = cls === 'sk-dim' ? fs : cs) => (Math.abs(x2 - x1) < 1 / 16 ? '' : `<g class="${cls}"><line x1="${x1}" y1="${Y(y)}" x2="${x2}" y2="${Y(y)}"/>
        <line x1="${x1}" y1="${Y(y) - u}" x2="${x1}" y2="${Y(y) + u}"/><line x1="${x2}" y1="${Y(y) - u}" x2="${x2}" y2="${Y(y) + u}"/>${t((x1 + x2) / 2, Y(y) + (below ? size * 1.15 : -size * 0.35), label, { cls: `${cls.split(' ')[0]}-t`, size })}</g>`);
    const dimV = (x, y1, y2, label, cls = 'sk-ctx', right = false, size = cls === 'sk-dim' ? fs : cs) => (Math.abs(y2 - y1) < 1 / 16 ? '' : `<g class="${cls}"><line x1="${x}" y1="${Y(y1)}" x2="${x}" y2="${Y(y2)}"/>
        <line x1="${x - u}" y1="${Y(y1)}" x2="${x + u}" y2="${Y(y1)}"/><line x1="${x - u}" y1="${Y(y2)}" x2="${x + u}" y2="${Y(y2)}"/>${t(x + (right ? size * 1.05 : -size * 0.35), Y((y1 + y2) / 2), label, { cls: `${cls.split(' ')[0]}-t`, rot: -90, size })}</g>`);
    const parts = [];
    if (tool !== 'select') { // a 1 ft grid to draw on
        for (let x = Math.ceil(view.x / 12) * 12; x < view.x + view.w; x += 12) parts.push(`<line x1="${x}" y1="${view.y}" x2="${x}" y2="${view.y + view.h}" class="sk-grid${x % 60 ? '' : ' major'}"/>`);
        for (let y = Math.ceil(-(view.y + view.h) / 12) * 12; y < -view.y; y += 12) parts.push(`<line x1="${view.x}" y1="${Y(y)}" x2="${view.x + view.w}" y2="${Y(y)}" class="sk-grid${y % 60 ? '' : ' major'}"/>`);
    }
    parts.push(`<line x1="${view.x}" y1="0" x2="${view.x + view.w}" y2="0" class="sk-floor"/>`);
    const valid = L > 0 && H > 0;
    const outline = valid ? [[0, 0], [L, 0], ...(top ? [...top].reverse() : [[L, H], [0, H]])] : [];
    if (valid) {
        parts.push(`<polygon points="${outline.map(([x, y]) => `${x},${Y(y)}`).join(' ')}" class="sk-wall${tool === 'perimeter' ? ' ghost' : ''}"/>`);
        if (tool === 'select') outline.forEach(([x, y], i) => { const [x2, y2] = outline[(i + 1) % outline.length]; parts.push(`<line x1="${x}" y1="${Y(y)}" x2="${x2}" y2="${Y(y2)}" class="sk-hit" data-hover="edge:${i}"/>`); });
        // Always: the length under it, the height at each end, each peak or break.
        parts.push(dimH(0, L, -fs * 1.4, fmtFtIn(L), 'sk-dim', true), dimV(-fs * 1.6, 0, at(0), fmtFtIn(at(0)), 'sk-dim'), dimV(L + fs * 1.6, 0, at(L), fmtFtIn(at(L)), 'sk-dim', true));
        for (const [x, h] of top ? top.slice(1, -1) : []) parts.push(t(x, Y(h) - fs * 0.7, fmtFtIn(h), { cls: 'sk-dim-t' }));
    }
    // Where the studs will be: their centerlines (side A), cripples as short ones.
    if (tool !== 'perimeter' && valid) parts.push(centerlines(p, H, top));
    // Openings.
    const boxes = p.openings.map(o => G.openingBox(o, H));
    if (tool !== 'perimeter') p.openings.forEach((o, i) => {
        const b = boxes[i], w = b.right - b.left, topY = b.through ? Math.max(at(b.left), at(b.right)) + fs * 0.6 : b.top, h = topY - b.bottom;
        if (!(w > 0 && h > 0)) return;
        const name = G.openingName(p.openings, i), dims = b.through ? `${fmtFtIn(w)} wide` : `${fmtFtIn(w)} x ${fmtFtIn(h)}`;
        const size = Math.min(fs * 1.1, (w * 0.9) / (name.length * 0.62), h * 0.36), small = Math.min(fs * 0.8, (w * 0.92) / (dims.length * 0.56), h * 0.22);
        if (G.offsetOf(o) > 0) { const r = G.roughOpening(o, H), rt = b.through ? topY : r.top; parts.push(`<rect x="${r.left}" y="${Y(rt)}" width="${r.right - r.left}" height="${rt - r.bottom}" class="sk-ro"><title>${esc(`${name}'s rough opening: ${roText(p, i)}`)}</title></rect>`); }
        const fb = o.toLayout && laid.lay?.openings.find(x => x.requested && Math.abs(x.requested.left - G.roughOpening(o, H).left) < 1e-6 && Math.abs(x.bottom - G.roughOpening(o, H).bottom) < 1e-6);
        if (fb) parts.push(`<rect x="${fb.left}" y="${Y(topY)}" width="${fb.right - fb.left}" height="${h}" class="sk-framed"><title>${esc(`${name} framed out to the stud layout: ${fmtFtIn(fb.right - fb.left)} between jambs`)}</title></rect>`);
        parts.push(`<g class="sk-op ${o.kind}${i === sel ? ' on' : ''}${G.isLockedOpening(p, o) ? ' locked' : ''}" data-drag="op:${i}"><title>${esc(`${name}: ${G.OPENING_TYPES[o.kind].name}, drag to move it`)}</title>
            <rect x="${b.left}" y="${Y(topY)}" width="${w}" height="${h}"/>${t(b.left + w / 2, Y(b.bottom + h / 2) - small * 0.25, name, { cls: 'sk-op-text', size })}${t(b.left + w / 2, Y(b.bottom + h / 2) + small * 1.2, dims, { cls: 'sk-op-sub', size: small })}</g>`);
    });
    // Clips, on their studs' webs (at least a little block on screen, however small the panel is drawn).
    if (tool !== 'perimeter' && laid.lay) for (const c of G.placeClips(laid.lay, p.clips).clips) {
        const w = Math.max(1.25, u * 0.9), h = Math.max(3, u * 1.8);
        parts.push(`<rect x="${c.side === 'R' ? c.x : c.x - w}" y="${Y(c.y + h / 2)}" width="${w}" height="${h}" class="sk-clip${hover === `clip:${c.i}` ? ' on' : ''}" data-clip="${c.i}" data-hover="clip:${c.i}"><title>${esc(`${c.mark} ${c.type} at ${fmtFtIn(c.y)}, on its stud's web · ${tool === 'clip' ? 'click to remove it' : 'right-click for options'}`)}</title></rect>`);
    }
    // Grips (shape handles, as in Revit): round at the panel's corners, arrows at the middle of its edges (an end moves
    // the end out or in, the openings staying where they are; a run of the top moves up or down); square at the
    // selected opening's corners, diamonds at the middle of its edges (resize it).
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
        parts.push(handle(0, 0, 'pg:bl', 'The left end: drag it out or in'), handle(L, 0, 'pg:br', 'The right end: drag it out or in'),
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
        ctx.push(dimH(lo, b.left, mid, fmtFtIn(b.left - lo), cls), dimH(b.right, hi, mid, fmtFtIn(hi - b.right), cls));
        if (lo > 0) ctx.push(dimH(0, b.left, mid - cs * 1.9, `${fmtFtIn(b.left)} from left end`, `${cls} far`));
        if (hi < L) ctx.push(dimH(b.right, L, mid - cs * 1.9, `${fmtFtIn(L - b.right)} to right end`, `${cls} far`));
        const column = others.filter(c => c.left < cx && c.right > cx);
        const floor = Math.max(0, ...column.filter(c => c.top <= b.bottom + 1e-6).map(c => c.top));
        if (b.bottom > floor) ctx.push(dimV(vx, floor, b.bottom, `${fmtFtIn(b.bottom - floor)}${floor ? '' : ' sill'}`, cls, true));
        if (!b.through) {
            const ceiling = Math.min(at(cx), ...column.filter(c => c.bottom >= b.top - 1e-6).map(c => c.bottom));
            if (ceiling > b.top) ctx.push(dimV(vx, b.top, ceiling, `${fmtFtIn(ceiling - b.top)} to ${ceiling < at(cx) ? 'next' : 'top'}`, cls, true));
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
            const label = dx < 1e-6 ? `${fmtFtIn(dy)} high` : dy < 1e-6 ? fmtFtIn(dx) : `${fmtFtIn(Math.hypot(dx, dy))} along · ${fmtFtIn(dx)} run · ${fmtFtIn(dy)} rise · ${pitchText(dy / dx)}`;
            ctx.push(`<line x1="${x1}" y1="${Y(y1)}" x2="${x2}" y2="${Y(y2)}" class="sk-edge-on"/>`, t((x1 + x2) / 2 + (dx < 1e-6 ? (x1 < L / 2 ? -fs : fs) : 0), Y((y1 + y2) / 2) + (dx < 1e-6 ? 0 : y1 + y2 < 1e-6 ? fs * 2.6 : -fs * 0.8), label, { cls: 'sk-ctx-t', size: cs * 1.1, a: dx < 1e-6 ? (x1 < L / 2 ? 'end' : 'start') : 'middle' }));
        }
        const mem = /^mem:(\d+)$/.exec(hover || ''), mm = mem && laid.lay?.members[Number(mem[1])];
        if (mm && valid) {
            const cx = mm.x + mm.w / 2, my = mm.y + mm.h / 2;
            ctx.push(`<line x1="${cx}" y1="${Y(mm.y)}" x2="${cx}" y2="${Y(mm.y + mm.h)}" class="sk-mem-on"/>`, dimH(0, cx, my, fmtFtIn(cx), 'sk-ctx hov'), dimH(cx, L, my, fmtFtIn(L - cx), 'sk-ctx hov'));
        }
        const corner = /^(pt:\d+|peak|pg:tl|pg:tr|pg:bl|pg:br|pg:l|pg:r)$/;
        const point = (drag?.moved && corner.test(drag.what) ? drag.what : null) || (corner.test(hover || '') ? hover : null);
        if (point && valid) {
            const [px, ph] = point.startsWith('pt:') ? s.points[Number(point.slice(3))] || [0, 0] : point === 'peak' ? [s.peakAtIn ?? L / 2, s.peakIn]
                : /^pg:(tl|bl|l)$/.test(point) ? [0, at(0)] : [L, at(L)];
            ctx.push(dimH(0, px, ph + fs * 1.2, fmtFtIn(px)), dimH(px, L, ph + fs * 1.2, fmtFtIn(L - px)), dimV(px, 0, ph, `${fmtFtIn(ph)} high`, 'sk-ctx', true));
        }
    }
    // Drawing an opening: its size and where it is.
    if (rectDraw) {
        const r = rectBox(rectDraw);
        ctx.push(`<rect x="${r.left}" y="${Y(r.top)}" width="${r.right - r.left}" height="${r.top - r.bottom}" class="sk-rect ${r.kind}"/>`,
            t((r.left + r.right) / 2, Y((r.bottom + r.top) / 2), G.OPENING_TYPES[r.kind].name, { cls: 'sk-op-text', size: fs }),
            dimH(0, r.left, (r.bottom + r.top) / 2, fmtFtIn(r.left), 'sk-ctx live'), dimH(r.right, L, (r.bottom + r.top) / 2, fmtFtIn(L - r.right), 'sk-ctx live'),
            dimH(r.left, r.right, r.top + fs * 1.3, `${fmtFtIn(r.right - r.left)} wide`, 'sk-ctx size'), dimV(r.right + fs * 1.2, r.bottom, r.top, `${fmtFtIn(r.top - r.bottom)} high`, 'sk-ctx size', true),
            r.bottom > 0 ? dimV((r.left + r.right) / 2, 0, r.bottom, `${fmtFtIn(r.bottom)} sill`, 'sk-ctx live', true) : '');
    }
    // Drawing the perimeter: the corners so far, the next one under the pointer, and the lengths.
    if (peri) {
        const pts = peri.pts, c = peri.cursor;
        if (pts.length) parts.push(`<polyline points="${[...pts, ...(c ? [c] : [])].map(([x, y]) => `${x},${Y(y)}`).join(' ')}" class="sk-peri"/>`);
        pts.forEach(([x, y], i) => {
            parts.push(`<circle cx="${x}" cy="${Y(y)}" r="${u * (i ? 0.9 : 1.4)}" class="sk-vertex${i ? '' : ' first'}${i === 0 && c && peri.closing ? ' closing' : ''}"/>`);
            if (i) { const [x0, y0] = pts[i - 1]; ctx.push(t((x + x0) / 2, Y((y + y0) / 2) - fs * 0.4, fmtFtIn(Math.hypot(x - x0, y - y0)), { cls: 'sk-ctx-t' })); }
        });
        if (c && pts.length) {
            const [x0, y0] = pts[pts.length - 1], len = Math.hypot(c[0] - x0, c[1] - y0);
            ctx.push(t((c[0] + x0) / 2, Y((c[1] + y0) / 2) - fs * 0.5, `${fmtFtIn(len)}${Math.abs(c[0] - x0) > 1e-6 && Math.abs(c[1] - y0) > 1e-6 ? ` (${fmtFtIn(Math.abs(c[0] - x0))} x ${fmtFtIn(Math.abs(c[1] - y0))})` : ''}`, { cls: 'sk-ctx-t', size: cs * 1.1 }));
        }
        if (c) parts.push(`<circle cx="${c[0]}" cy="${Y(c[1])}" r="${u * 0.8}" class="sk-cursor"/>`);
        if (peri.typed) ctx.push(t((c?.[0] ?? 0) + fs, Y(c?.[1] ?? 0) - fs * 1.2, `Length: ${peri.typed}${G.parseLength(peri.typed) != null ? ` = ${fmtFtIn(G.parseLength(peri.typed))}` : ''} (Enter)`, { cls: 'sk-typed', a: 'start', size: fs * 1.1 }));
    }
    svgEl.innerHTML = parts.join('') + ctx.join('');
}

// The framing laid out for the sketch (side A), at most every 120 ms while dragging; nothing while inputs need fixing.
let laid = { key: '', at: 0, lay: null };
const ROLE_NAMES = { stud: 'Stud on center', 'end stud': 'End stud', 'jamb stud': 'Jamb', cripple: 'Cripple' };
function centerlines(p, H, top) {
    const key = JSON.stringify([p.shape, p.openings, p.members, p.optimizeOpenings, p.layoutStartIn, p.layoutFromRight, p.flipStuds, p.studFlips]);
    if (key !== laid.key && (!drag || Date.now() - laid.at > 120)) {
        let lay = null;
        try { if (!G.panelErrors(p).length) lay = frameWall(G.frameInputs(p)); } catch { /* inputs to fix */ }
        laid = { key, at: Date.now(), lay };
    }
    if (!laid.lay) return '';
    const leg = G.parseMember(p.members.track)?.flangeIn ?? 1.25, lay = laid.lay, u = Math.max(view.w, view.h) / 100;
    const lines = [], hits = [], cs = [];
    lay.members.forEach((m, k) => {
        if (m.orient !== 'v') return;
        const cx = m.x + m.w / 2, y2 = m.pts ? underAt(top, cx, H, leg) : m.y + m.h;
        lines.push(`<line x1="${cx}" y1="${-m.y}" x2="${cx}" y2="${-y2}" class="${m.role === 'jamb stud' || m.role === 'end stud' ? 'j' : m.role === 'cripple' ? 'c' : ''}"/>`);
        hits.push(`<line x1="${cx}" y1="${-m.y}" x2="${cx}" y2="${-y2}" class="sk-mem-hit" data-hover="mem:${k}"><title>${esc(`${ROLE_NAMES[m.role] || m.role}: ${m.type}, ${fmtFtIn(m.lengthIn)} · right-click for its options`)}</title></line>`);
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
    svg.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return; // a right-click opens the sketch's menu instead
        const p = cur(), q = wallPoint(e), h = e.target.closest('[data-drag]');
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
        if (tool === 'perimeter') { drag = { what: 'peri', x: e.clientX, y: e.clientY, moved: false }; return; }
        if (tool === 'opening') { rectDraw = { a: [snap(q[0]), snap(q[1])], b: [snap(q[0]), snap(q[1])] }; drag = { what: 'rect', x: e.clientX, y: e.clientY, moved: false }; return; }
        if (tool === 'clip') { const c = e.target.closest('[data-clip]'); c ? removeClip(p, Number(c.dataset.clip)) : addClips(p, [{ type: clipType, x: round16(q[0]), y: round16(q[1]) }]); return; }
        drag = { what: h?.dataset.drag || 'none', start: q, moved: false, orig: structuredClone({ shape: p.shape, openings: p.openings }), x: e.clientX, y: e.clientY, view0: { ...view } };
        const m = /^op:(\d+)$/.exec(drag.what);
        if (m && sel !== Number(m[1])) { sel = Number(m[1]); if (ask !== sel) ask = null; renderCatalogue(); renderChips(); renderSketch(); }
    });
    svg.addEventListener('pointermove', (e) => {
        const q = wallPoint(e);
        if (tool === 'perimeter') { peri.cursor = snapPerimeter(q); renderSketch(); return; }
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
        const d = drag;
        drag = null;
        if (!d) return;
        if (d.what === 'peri') { if (!d.moved) addPerimeterCorner(); return; }
        if (d.what === 'rect') { finishRect(); return; }
        const p = cur();
        if (!d.moved && d.what === 'none') {
            if (p.shape.kind === 'custom' && addPointAt(p, wallPoint(e))) { renderShapeTable(); changed(); }
            else if (sel != null) { sel = null; ask = null; renderCatalogue(); renderChips(); }
        }
        if (d.moved) { renderShapeFields(); syncCatalogueFields(); changed(); }
        refresh(true);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', () => { drag = null; rectDraw = null; renderSketch(); });
    svg.addEventListener('pointerleave', () => { if (!drag && hover) { hover = null; renderSketch(); } });
    svg.addEventListener('contextmenu', openMenu);
    svg.addEventListener('dblclick', (e) => {
        if (tool === 'perimeter') { finishPerimeter(); return; }
        const h = e.target.closest('[data-drag^="pt:"]'), p = cur();
        if (!h || p.shape.kind !== 'custom') return;
        const i = Number(h.dataset.drag.slice(3));
        if (i > 0 && i < p.shape.points.length - 1) { p.shape.points.splice(i, 1); renderShapeTable(); changed(); }
    });
}
function applyDrag(d, [x, y]) {
    const p = cur(), s = p.shape, L = G.shapeTop(s).lengthIn, minH = 12;
    const [what, n, g] = d.what.split(':'), i = Number(n);
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
function addPointAt(p, [x, y]) {
    const pts = p.shape.points, L = G.shapeTop(p.shape).lengthIn;
    if (!(x > 1 && x < L - 1 && y > 12) || pts.some(pt => Math.abs(pt[0] - x) < 3)) return false;
    pts.push([snap(x), snap(y)]);
    pts.sort((a, b) => a[0] - b[0]);
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
    if (document.getElementById('fr-dialog')?.open) return; // the framing dialog has the keys
    if (e.key === 'Escape' && menuAt) { closeMenu(); return; }
    if (e.target.closest?.('input, textarea, select')) return;
    if (tool === 'perimeter' && peri) { perimeterKey(e); return; }
    if (e.key === 'Escape') { if (tool !== 'select') setTool('select'); else if (sel != null) { sel = null; ask = null; renderCatalogue(); renderChips(); renderSketch(); } return; }
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
        const n = G.parseLength(peri.typed), last = peri.pts[peri.pts.length - 1];
        if (peri.typed && n != null && last) { // that far from the last corner, toward the pointer (level or plumb when nearly so)
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
    const p = cur(), L = res.shape.lengthIn;
    const kept = p.openings.filter(o => (o.kind === 'window' || o.kind === 'mep') && o.leftIn + o.widthIn <= L);
    p.shape = res.shape;
    p.openings = [...kept, ...res.openings].sort((a, b) => a.leftIn - b.leftIn);
    setTool('select', false);
    sel = null; ask = null;
    renderAll(); save();
    const { lengthIn, heightIn } = G.shapeTop(p.shape);
    notice(`Perimeter in: ${fmtFtIn(lengthIn)} x ${fmtFtIn(heightIn)} ${G.SHAPES.find(k => k.kind === p.shape.kind).name.toLowerCase()}${res.openings.length ? `, with ${G.openingsSummary(res.openings)} from its notches` : ''}. Click an opening to pick its members.`);
}

// --- Right-click on the sketch: what can be done with what is under the pointer --------------------------------------
// An opening: its members, kind, jambs on the layout, center, copy, remove. A stud: its type, start the layout there. The
// top: the top track, a control point to drag. The bottom: the bottom track. An end: start the layout from it. A point:
// remove it. Empty panel: add an opening there. Always: Preview, the optimizer, Flip studs, Flip panel.
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
    const endMenu = (side) => out.push(head(`The ${side} end`, `${fmtFtIn(at(side === 'left' ? 0 : L))} high · end stud ${studName(p.members)}`),
        btn(`Start the stud layout from the ${side} end`, 'layout-from', { side }, { off: !!p.layoutFromRight === (side === 'right'), title: side === 'right' ? 'Flip panel: the layout and its offsets from this end' : 'The layout from the left end, as usual' }));
    const out = [];
    const opening = /^op:(\d+)$/.exec(key), mem = /^mem:(\d+)$/.exec(key), edge = /^edge:(\d+)$/.exec(key), pt = /^pt:(\d+)$/.exec(key), end = /^pg:(l|r|tl|tr|bl|br)$/.exec(key), clip = /^clip:(\d+)$/.exec(key);
    if (opening && p.openings[Number(opening[1])]) {
        const i = Number(opening[1]), o = p.openings[i], locked = G.isLockedOpening(p, o), type = G.OPENING_TYPES[o.kind];
        choose(i);
        out.push(head(`${G.openingName(p.openings, i)} · ${type.name}`, `${o.kind === 'steel' ? `${fmtFtIn(o.widthIn)} wide, through the top` : `${fmtFtIn(o.widthIn)} x ${fmtFtIn(o.heightIn)}`} · ${fmtFtIn(o.leftIn)} from the left end${locked ? ' · 🔒 the model\'s' : ''}`));
        out.push(btn('⚙ Framing details… (jambs, header, rough opening)', 'framing', { i }));
        out.push(...type.members.map(k => pick(openingChoice(i, k), G.MEMBER_LABELS[k])));
        out.push(`<label class="mi-pick"><span>Kind</span><select data-f="openings.${i}.kind" aria-label="Kind of opening"${locked ? ' disabled' : ''}>${Object.entries(G.OPENING_TYPES).map(([k, t]) => `<option value="${k}" ${k === o.kind ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>`);
        out.push(check('Jambs on the stud layout', `openings.${i}.toLayout`, o.toLayout, toLayoutNote(p, i)));
        out.push('<hr>', btn('Center it', 'center', { i }, { off: locked }), btn('⇆ Mirror it across the panel', 'mirror-op', { i }, { off: locked, title: 'The same distance from the other end' }),
            btn('Copy it', 'copy-op', { i }), btn('Remove it', 'del-op', { i }, { off: locked, cls: 'danger' }));
    } else if (mem && laid.lay?.members[Number(mem[1])]) {
        const m = laid.lay.members[Number(mem[1])], cx = m.x + m.w / 2, j = jambOf(p, m);
        out.push(head(`${ROLE_NAMES[m.role] || m.role}${j != null ? ` of ${G.openingName(p.openings, j)}` : ''}`, `${m.type} · ${fmtFtIn(m.lengthIn)} long · center ${fmtFtIn(cx)} from the left end, ${fmtFtIn(L - cx)} from the right`));
        if (j != null) choose(j);
        out.push(j != null ? pick(openingChoice(j, 'jamb'), 'Jambs') : pick(coreChoice('stud'), m.role === 'stud' ? 'Studs' : 'Stud type'));
        if (m.role !== 'end stud') out.push(btn('Start the stud layout here', 'layout-here', { x: cx }, { title: 'This stud\'s line becomes a layout line: the first stud is set by hand from it (the optimizer gives way)' }));
        const flipped = (p.studFlips || []).some(c => Math.abs(c - cx) < 0.5);
        out.push(btn(flipped ? '⟲ Flip this stud back' : '⟲ Flip this stud', 'stud-flip', { x: round16(cx) }, { title: 'Just this stud faces the other way' }),
            btn(`◫ Add a clip on it here (${fmtFtIn(y)} up)`, 'clip-here', { x: round16(cx), y: round16(y) }));
    } else if (edge) {
        const outline = [[0, 0], [L, 0], ...(top ? [...top].reverse() : [[L, H], [0, H]])], n = Number(edge[1]), [x1, y1] = outline[n], [x2, y2] = outline[(n + 1) % outline.length];
        if (y1 === 0 && y2 === 0) out.push(head('Bottom track', `${fmtFtIn(L)} long`), pick(coreChoice('track'), 'Type'));
        else if (Math.abs(x1 - x2) < 1e-6) endMenu(x1 < L / 2 ? 'left' : 'right');
        else {
            const cx = round16(snap(Math.min(L - 3, Math.max(3, x))));
            out.push(head('Top track', `${fmtFtIn(Math.hypot(x2 - x1, y2 - y1))} along here`), pick(coreChoice('topTrack'), 'Type'),
                btn(`Add a control point here (${fmtFtIn(cx)})`, 'add-ctrl', { x: cx }, { off: !shapeFree, title: shapeFree ? 'A point on the top here, to drag up or down (the top becomes a drawn one)' : 'Locked: the Revit model\'s perimeter' }));
        }
    } else if (end) endMenu(/^(l|tl|bl)$/.test(end[1]) ? 'left' : 'right');
    else if (pt && p.shape.points?.[Number(pt[1])]) {
        const k = Number(pt[1]), q = p.shape.points[k];
        out.push(head(`Point ${k + 1} on the top`, `${fmtFtIn(q[0])} from the left end · ${fmtFtIn(q[1])} high`), btn('Remove this point', 'del-point', { i: k }, { off: !shapeFree }));
    } else if (clip && p.clips?.[Number(clip[1])]) {
        const i = Number(clip[1]), c = p.clips[i], at2 = laid.lay ? G.placeClips(laid.lay, p.clips).clips.find(k => k.i === i) : null;
        out.push(head(`${at2?.mark || 'Clip'} · ${c.type}`, `${fmtFtIn(c.y)} up${at2?.stud ? `, on ${at2.stud}` : ''} (on the stud's web)`),
            `<label class="mi-pick"><span>Type</span><select data-f="clips.${i}.type" aria-label="Clip type">${[...new Set([c.type, ...G.CLIP_TYPES, ...(recent.clip || [])])].map(v => `<option ${v === c.type ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`,
            btn('Remove this clip', 'clip-del', { i }, { cls: 'danger' }));
    } else if (key === 'peak') {
        out.push(head('The peak', `${fmtFtIn(p.shape.peakIn)} high, ${fmtFtIn(p.shape.peakAtIn ?? L / 2)} from the left end`), btn('Make the top a drawn one (points to drag)', 'shape', { kind: 'custom' }, { off: !shapeFree }));
    } else if (x > 0 && x < L && y >= 0 && y < at(x)) {
        out.push(head('Add an opening here', `${fmtFtIn(x)} from the left end${y > 1 ? ` · ${fmtFtIn(y)} up` : ''}`),
            `<div class="mi-row">${Object.entries(G.OPENING_TYPES).map(([k, t]) => btn(`+ ${t.name}`, 'add-op-at', { kind: k, x: round16(x), y: round16(y) }, { cls: `mi-add ${k}` })).join('')}</div>`,
            btn(`◫ Add a ${clipType.toLowerCase()} on the nearest stud`, 'clip-here', { x: round16(x), y: round16(y) }));
    }
    out.push(out.length ? '<hr>' : '', btn('⟲ Preview 5 s', 'preview', {}, { title: 'The framing elevation with its tags and dimensions, for 5 seconds' }),
        check('Opening optimizer', 'optimizeOpenings', p.optimizeOpenings, p.layoutStartIn > 0 ? 'first stud set by hand' : ''),
        check('Flip studs', 'flipStuds', p.flipStuds, 'studs face the other way'),
        check('Flip panel', 'layoutFromRight', p.layoutFromRight, 'layout from the right end'),
        check('Side B', 'sideB', p.sideB, 'mirror the sheet'),
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
    const { lengthIn: L, heightIn: H, top } = G.shapeTop(p.shape);
    const pts = p.shape.kind === 'custom' ? p.shape.points : G.changeShape(p.shape, 'custom').points;
    if (!(x >= 3 && x <= L - 3) || pts.some(q => Math.abs(q[0] - x) < 3)) { notice('A point needs to be at least 3" from the ends and the other points.', true); return; }
    if (p.shape.kind !== 'custom') p.shape = { kind: 'custom', lengthIn: L, points: pts };
    pts.push([x, round16(topAt(top, x, H))]);
    pts.sort((a, b) => a[0] - b[0]);
    renderElevHead(); renderShapeTable(); renderHint(); changed();
    notice(`Point added on the top at ${fmtFtIn(x)}: drag it up or down (double-click or right-click it to remove it).`);
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
    notice(`${c.type} at ${fmtFtIn(c.y)} removed.`);
}

// --- Framing details: an opening's jambs, header, sill and rough opening, with a live preview -------------------------
const roText = (p, i) => { const o = p.openings[i], r = G.roughOpening(o, G.shapeTop(p.shape).heightIn); return o.kind === 'steel' ? `${fmtFtIn(r.right - r.left)} wide` : `${fmtFtIn(r.right - r.left)} x ${fmtFtIn(r.top - r.bottom)}`; };
function framingSummary(p, i) {
    const fr = G.openingFraming(p, p.openings[i]);
    return [fr.plies > 1 ? `${fr.plies} jamb studs each side, ${G.JAMB_STYLES[fr.jambStyle].toLowerCase()}` : '1 jamb stud each side',
        fr.head ? (fr.head.depthIn ? `${inch(fr.head.depthIn)} ${fr.head.style === 'back' ? 'back-to-back' : 'box'} header` : 'track header') + (fr.bearing === 'jacks' ? ' on jack studs' : '') : '',
        fr.crippleEnds ? 'cripples at the ends' : ''].filter(Boolean).join(' · ');
}
let fd = null; // the dialog's state: { i, draft (the opening being edited), jamb, head, sill (picker states), touched }
const frDialog = () => document.getElementById('fr-dialog');
// draft: start from this version of the opening (Back to the defaults) instead of the panel's.
function openFraming(i, draft = null) {
    const p = cur(), o = p.openings[i];
    if (!o) return;
    const d = draft || structuredClone(o), panel = { ...p, openings: p.openings.map((x, j) => (j === i ? d : x)) };
    const stud = studName(p.members), track = bottomTrack(p.members);
    const state = (k) => { const sp = G.specParts(G.memberFor(panel, d, k).spec), byStuds = sp.studQty > 0;
        return { style: byStuds ? (d[`${k}Style`] === 'back' ? 'back' : 'box') : 'track', studs: byStuds ? sp.studQty : 2, stud: sp.studs[0]?.name || stud, tracks: byStuds ? sp.trackQty : Math.max(1, sp.trackQty), track: sp.tracks[0]?.name || track }; };
    const jp = G.specParts(G.memberFor(panel, d, 'jamb').spec);
    fd = { i, draft: d, jamb: { plies: Math.max(1, Math.min(3, jp.studQty || 1)), stud: jp.studs[0]?.name || stud, tracks: jp.tracks }, head: state('head'), sill: state('sill'), touched: new Set() };
    if (sel !== i) { sel = i; ask = null; renderCatalogue(); renderChips(); renderSketch(); }
    renderFraming();
    if (!frDialog().open) frDialog().showModal();
}
// The draft's member texts from the pickers (only those touched: an untouched member keeps what it had, '' included).
function framingSpecs() {
    const d = fd.draft, spec = (s) => (s.style === 'track' ? `${s.tracks > 1 ? `(${s.tracks}) ` : ''}${s.track}` : `(${s.studs}) ${s.stud}${s.tracks ? ` WITH (${s.tracks}) ${s.track}` : ''}`);
    if (fd.touched.has('jamb')) { const j = fd.jamb; d.jamb = `${j.plies > 1 ? `(${j.plies}) ` : ''}${j.stud}${j.tracks.length ? ` WITH ${j.tracks.map(t => `(${t.qty}) ${t.name}`).join(' WITH ')}` : ''}`; }
    for (const k of ['head', 'sill']) if (fd.touched.has(k)) { d[k] = spec(fd[k]); if (fd[k].style === 'back') d[`${k}Style`] = 'back'; else delete d[`${k}Style`]; }
}
const draftPanel = () => { const p = cur(); return { ...p, openings: p.openings.map((o, j) => (j === fd.i ? fd.draft : o)) }; };
function renderFraming() {
    const p = cur(), d = fd.draft, kind = d.kind, type = G.OPENING_TYPES[kind], name = G.openingName(p.openings, fd.i), panel = draftPanel();
    const wall = G.parseMember(p.members.stud), deep = (n) => G.parseMember(n)?.depthIn, sameDepth = (n) => Math.abs((deep(n) ?? -1) - (wall?.depthIn ?? -2)) < 1e-6;
    const ch = G.memberChoices(p.members), jambStuds = G.STUDS.filter(sameDepth), tracks = ch.track.filter(sameDepth);
    const fr = G.openingFraming(panel, d), off = G.offsetOf(d), dflt = G.FRAMING_OFFSETS[kind];
    const seg = (key, value, opts) => `<div class="seg fd-seg">${opts.map(([v, label, offOpt, title]) => `<button type="button" class="${String(v) === String(value) ? 'on' : 'secondary'}" data-fd="${key}" data-v="${v}"${offOpt ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${label}</button>`).join('')}</div>`;
    const pickList = (key, value, list) => `<select data-fd="${key}">${[...new Set([value, ...list])].filter(Boolean).map(v => `<option ${v === value ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    const member = (k, label) => {
        const s = fd[k], st = fr[k];
        return `<fieldset class="fd-group"><legend>${label}</legend>
            <div class="fd-line"><span>Made of</span>${seg(`${k}Style`, s.style, [['track', 'Track'], ['box', 'Box (toe to toe)'], ['back', 'Back to back']])}</div>
            ${s.style === 'track' ? `<div class="fd-line"><span>Track</span>${seg(`${k}Tracks`, s.tracks, [[1, '1'], [2, '2 nested']])}${pickList(`${k}Track`, s.track, tracks)}</div>`
                : `<div class="fd-line"><span>Studs</span>${seg(`${k}Studs`, s.studs, [[1, '1'], [2, '2']])}${pickList(`${k}Stud`, s.stud, G.STUDS)}<em>${inch(deep(s.stud) || 0)} deep</em></div>
                   <div class="fd-line"><span>Tracks</span>${seg(`${k}Tracks`, s.tracks, [[0, 'none'], [1, '1 (under)'], [2, '2 (over and under)']])}${s.tracks ? pickList(`${k}Track`, s.track, tracks) : ''}</div>`}
            <div class="fd-line"><span>As text</span><input type="text" data-fd="${k}Spec" value="${esc(d[k] || '')}" placeholder="${esc(st?.spec || '')} (the default)" list="dl-${k === 'head' ? 'header' : k}"></div>
            ${k === 'head' ? `<div class="fd-line"><span>Bears</span>${seg('bearing', fr.bearing, [['between', 'Between the jambs'], ['jacks', 'On jack studs', fd.jamb.plies < 2, fd.jamb.plies < 2 ? 'Needs 2 or more jamb studs each side' : 'The header runs over the first jamb stud (a jack under it); the next is the king']])}</div>` : ''}
        </fieldset>`;
    };
    const pv = framingPreview(panel);
    frDialog().innerHTML = `<form method="dialog" class="fd">
        <div class="fd-head"><b class="op-name ${kind}">${name}</b><span>${esc(type.name)} · ${esc(kind === 'steel' ? `${fmtFtIn(d.widthIn)} wide` : `${fmtFtIn(d.widthIn)} x ${fmtFtIn(d.heightIn)}`)}${G.isLockedOpening(p, d) ? ' · 🔒 the model\'s (its framing can change)' : ''}</span>
            <span class="spacer"></span><button type="button" class="link" data-fd="cancel" aria-label="Close">✕</button></div>
        <div class="fd-body"><div class="fd-controls">
            <fieldset class="fd-group"><legend>Rough opening</legend>
                <div class="fd-line"><span>Framing offset</span><input type="text" class="mini" data-fd="offset" value="${esc(inch(off))}"><em>each side${kind === 'door' ? ' and over it' : kind === 'steel' ? ' and under it' : ', over and under'}; ${kind}s default to ${inch(dflt)}</em>
                    ${d.offsetIn != null && d.offsetIn !== '' ? '<button type="button" class="link" data-fd="offsetReset">default</button>' : ''}</div>
                <div class="fd-line"><span></span><b>${esc(kind === 'steel' ? `${fmtFtIn(fr.ro.right - fr.ro.left)} wide` : `${fmtFtIn(fr.ro.right - fr.ro.left)} x ${fmtFtIn(fr.ro.top - fr.ro.bottom)}`)}</b><em>framed around</em></div>
            </fieldset>
            <fieldset class="fd-group"><legend>Jambs</legend>
                <div class="fd-line"><span>Studs each side</span>${seg('plies', fd.jamb.plies, [[1, '1'], [2, '2 (double)'], [3, '3']])}${pickList('jambStud', fd.jamb.stud, jambStuds)}</div>
                <div class="fd-line"><span>Arranged</span>${seg('jambStyle', fr.jambStyle, Object.entries(G.JAMB_STYLES).map(([v, l]) => [v, l, fd.jamb.plies < 2]))}</div>
                <div class="fd-line"><span></span><label class="fd-check"><input type="checkbox" data-fd="toLayout" ${d.toLayout ? 'checked' : ''}> On the stud layout (the nearest studs on center are the jambs)</label></div>
            </fieldset>
            ${type.members.includes('head') ? member('head', 'Header') : ''}
            ${type.members.includes('sill') ? member('sill', kind === 'steel' ? 'Sill (under the steel)' : 'Sill') : ''}
            <fieldset class="fd-group"><legend>Studs above and below</legend>
                <label class="fd-check"><input type="checkbox" data-fd="crippleEnds" ${d.crippleEnds ? 'checked' : ''}> Also a cripple at each end of the header and sill (against the jambs), besides those on the layout</label>
            </fieldset>
        </div>
        <div class="fd-preview"><div class="fd-svg">${pv.svg}</div>${pv.errors.length ? `<ul class="errors">${pv.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : `<p class="muted small">${esc(pv.caption)}</p>`}</div></div>
        <div class="fd-foot"><button type="button" class="link" data-fd="reset">Back to the defaults</button><span class="spacer"></span>
            <button type="button" class="secondary" data-fd="cancel">Cancel</button><button type="button" data-fd="apply" ${pv.errors.length ? 'disabled' : ''}>Apply</button></div>
    </form>`;
}
// The opening framed, a bay or two each side: the members (studs white, jamb studs blue-grey, tracks yellow, headers
// and sills salmon), each stud's C in plan under it, the rough opening dashed, the opening as typed inside it.
function framingPreview(panel) {
    const errors = G.panelErrors(panel).filter(e => e.where === `opening-${fd.i}` || e.where === 'members').map(e => e.message);
    if (errors.length) return { errors, svg: '' };
    const inputs = G.frameInputs(panel), lay = frameWall(inputs), ro = inputs.openings[fd.i], L = lay.lengthIn, H = lay.heightIn, sp = inputs.spacingIn;
    if (!ro) return { errors: ['Not framed: check its size and place.'], svg: '' };
    const x0 = Math.max(0, ro.left - sp * 1.6), x1 = Math.min(L, ro.right + sp * 1.6), pad = Math.max(x1 - x0, H) * 0.06;
    const inView = (m) => m.x + m.w > x0 - 0.01 && m.x < x1 + 0.01;
    const fill = (m) => (m.role === 'head track' || m.role === 'sill track' ? '#f4a7a0' : m.orient === 'h' ? '#f2d64b' : m.role === 'jamb stud' ? '#cfdcea' : m.role === 'cripple' ? '#f3f3f3' : '#ffffff');
    const rects = lay.members.filter(inView).map(m => { const a = Math.max(m.x, x0), b = Math.min(m.x + m.w, x1);
        return m.pts && m.orient === 'v' ? `<polygon points="${m.pts.map(([x, y]) => `${x},${-y}`).join(' ')}" fill="${fill(m)}" class="fd-m"/>` : `<rect x="${a}" y="${-(m.y + m.h)}" width="${b - a}" height="${m.h}" fill="${fill(m)}" class="fd-m"><title>${esc(`${m.role}${m.ply ? ` (ply ${m.ply})` : ''}: ${m.type}`)}</title></rect>`; });
    const cs = lay.members.filter(m => m.orient === 'v' && inView(m) && m.y < 2).map(m => { const ya = 1.2, yb = 4.2, lip = 1, r = webOnRight(m, lay), [open, web] = r ? [m.x, m.x + m.w] : [m.x + m.w, m.x];
        return `<path d="M${open} ${ya + lip}V${ya}H${web}V${yb}H${open}V${yb - lip}" class="fd-c"/>`; });
    const clear = ro.clear ? `<rect x="${ro.clear.left}" y="${-ro.clear.top}" width="${ro.clear.right - ro.clear.left}" height="${ro.clear.top - ro.clear.bottom}" class="fd-clear"/>` : '';
    const roTop = ro.through ? H : ro.top;
    const svg = `<svg viewBox="${x0 - pad} ${-H - pad} ${x1 - x0 + 2 * pad} ${H + pad * 2.2}" role="img" aria-label="The opening's framing">
        <line x1="${x0 - pad}" y1="0" x2="${x1 + pad}" y2="0" class="fd-floor"/>${rects.join('')}${cs.join('')}
        <rect x="${ro.left}" y="${-roTop}" width="${ro.right - ro.left}" height="${roTop - ro.bottom}" class="fd-ro"/>${clear}</svg>`;
    const fr = G.openingFraming(panel, fd.draft), vs = lay.members.filter(m => m.orient === 'v');
    const caption = `Rough opening ${fmtFtIn(ro.right - ro.left)}${ro.through ? ' wide' : ` x ${fmtFtIn(roTop - ro.bottom)}`} (dashed), the opening as typed inside it. ${fr.plies} jamb stud${fr.plies > 1 ? 's' : ''} each side${fr.head?.depthIn ? `; a ${inch(fr.head.depthIn)} deep header${fr.bearing === 'jacks' ? ' on jack studs' : ''}` : ''}. The panel: ${vs.length} stud pieces${lay.issues.length ? `, framing check: ${lay.issues[0].message}` : ', framing check passed'}.`;
    return { errors: lay.issues.length ? lay.issues.map(i => i.message).slice(0, 3) : [], svg, caption };
}
function framingInput(e) {
    const el = e.target.closest('[data-fd]');
    if (!el || !fd) return;
    const k = el.dataset.fd, v = el.dataset.v ?? (el.type === 'checkbox' ? el.checked : el.value), d = fd.draft;
    const num = (x) => Number(x);
    if (k === 'cancel') { frDialog().close(); return; }
    if (k === 'apply') { applyFraming(); return; }
    if (k === 'reset') { const r = { ...d, head: '', jamb: '', sill: '' }; for (const f of ['offsetIn', 'jambStyle', 'headStyle', 'sillStyle', 'headBearing', 'crippleEnds', 'toLayout']) delete r[f]; openFraming(fd.i, r); return; }
    if (k === 'offset') { const n = G.parseLength(String(v)); if (n == null) return; d.offsetIn = round16(n); }
    else if (k === 'offsetReset') delete d.offsetIn;
    else if (k === 'plies') { fd.jamb.plies = num(v); fd.touched.add('jamb'); if (fd.jamb.plies < 2) delete d.headBearing; }
    else if (k === 'jambStud') { fd.jamb.stud = v; fd.touched.add('jamb'); }
    else if (k === 'jambStyle') { if (v === 'box') delete d.jambStyle; else d.jambStyle = v; }
    else if (k === 'toLayout') { if (v) d.toLayout = true; else delete d.toLayout; }
    else if (k === 'crippleEnds') { if (v) d.crippleEnds = true; else delete d.crippleEnds; }
    else if (k === 'bearing') { if (v === 'jacks') d.headBearing = 'jacks'; else delete d.headBearing; }
    else {
        const m = /^(head|sill)(Style|Studs|Stud|Tracks|Track|Spec)$/.exec(k);
        if (!m) return;
        const [, part, what] = m, s = fd[part];
        if (what === 'Spec') { d[part] = String(v).trim(); fd.touched.delete(part); const sp = G.specParts(d[part] || G.memberFor(draftPanel(), d, part).spec); s.style = sp.studQty ? (s.style === 'back' ? 'back' : 'box') : 'track'; }
        else {
            if (what === 'Style') { s.style = v; if (v !== 'track' && !G.parseMember(s.stud)) s.stud = studName(cur().members); }
            if (what === 'Studs') s.studs = num(v);
            if (what === 'Stud') s.stud = v;
            if (what === 'Tracks') s.tracks = num(v);
            if (what === 'Track') s.track = v;
            if (s.style === 'track' && s.tracks < 1) s.tracks = 1;
            fd.touched.add(part);
        }
    }
    framingSpecs();
    if (e.type === 'input' && el.type === 'text') { const pv = framingPreview(draftPanel()); frDialog().querySelector('.fd-svg').innerHTML = pv.svg; return; } // typing: the preview only
    renderFraming();
    frDialog().querySelector(`[data-fd="${k}"]`)?.focus();
}
function applyFraming() {
    const p = cur(), i = fd.i, o = p.openings[i], d = fd.draft;
    // The dialog never moves or resizes the opening: only its framing changes (allowed on a Revit opening too).
    p.openings[i] = { ...d, kind: o.kind, leftIn: o.leftIn, widthIn: o.widthIn, heightIn: o.heightIn, sillIn: o.sillIn, ...(o.locked ? { locked: true } : {}) };
    for (const k of ['head', 'jamb', 'sill']) if (d[k]) { recent[recentKey(k)] = G.remember(recent[recentKey(k)], d[k]); }
    store(KEYS.recent, recent);
    frDialog().close();
    renderMemberCards(); renderChips(); renderDatalists(); changed();
    notice(`${G.openingName(p.openings, i)}: framing set (${framingSummary(p, i)}).`);
}
frDialog().addEventListener('click', (e) => { if (e.target === frDialog()) { frDialog().close(); return; } if (e.target.closest('button[data-fd]')) framingInput(e); });
frDialog().addEventListener('change', (e) => { if (!e.target.closest('button')) framingInput(e); });
frDialog().addEventListener('input', (e) => { if (e.target.type === 'text') framingInput(e); });
frDialog().addEventListener('close', () => { fd = null; });

// --- Openings list under the sketch --------------------------------------------------------------------------------------
function renderChips() {
    const p = cur(), errors = G.panelErrors(p);
    $('#op-chips').innerHTML = p.openings.length ? p.openings.map((o, i) => {
        const b = G.openingBox(o), bad = errors.some(e => e.where === `opening-${i}`);
        return `<button class="op-chip ${o.kind} ${i === sel ? 'on' : ''} ${bad ? 'bad' : ''}" data-act="select-op" data-i="${i}" title="${esc(G.OPENING_TYPES[o.kind].name)}">
            <b>${G.openingName(p.openings, i)}</b>${G.isLockedOpening(p, o) ? ' 🔒' : ''} ${fmtFtIn(b.right - b.left)}${o.kind === 'steel' ? ' through the top' : ` x ${fmtFtIn(b.top - b.bottom)}`} @ ${fmtFtIn(b.left)}</button>`;
    }).join('') : '<span class="muted small">No openings yet: add one, or draw it.</span>';
}

// --- Preview: the sketch turned over to the framing elevation for 5 seconds -----------------------------------------
let flipTimer = 0;
function flipPreview() {
    const wrap = $('#sketch-flip');
    if (wrap.classList.contains('flipped')) { unflip(); return; }
    const p = cur(), { errors, layout } = framed(p);
    if (!layout) { notice(`Nothing to preview yet: ${errors[0]?.message || 'fix the inputs'}`, true); return; }
    $('#sketch-back').innerHTML = `<div class="back-head"><b>${esc(p.mark)} · framing elevation${p.sideB ? ' (side B)' : ''}</b>
            <span class="muted small">tags and dimensions as on the sheet · back to the sketch in 5 s, or click</span></div>
        <div class="back-svg">${renderSheetRegion(layout, sheetInfo(p), 'elevation') /* its own proportions, scaled like an image: nothing past the crop shows */
            .replace(/width="([\d.]+)in" height="([\d.]+)in"/, (m, w, h) => `width="${Math.round(w * 96)}" height="${Math.round(h * 96)}"`)}</div>
        <div class="back-timer"><i></i></div>`;
    wrap.classList.add('flipped');
    $('#preview-btn').classList.add('on');
    clearTimeout(flipTimer);
    flipTimer = setTimeout(unflip, 5000);
}
function unflip() {
    clearTimeout(flipTimer);
    main.querySelector('#sketch-flip')?.classList.remove('flipped');
    main.querySelector('#preview-btn')?.classList.remove('on');
}
document.getElementById('sketch-back').addEventListener('click', unflip);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && main.querySelector('#sketch-flip.flipped')) unflip(); });

// --- The sheet ---------------------------------------------------------------------------------------------------------
// No QR code on these sheets: a panel typed in here has no page of its own, and a link holding the whole panel makes a
// dense code that won't scan from a distance (Copy link shares it).
function sheetInfo(p) {
    return { mark: p.mark || 'P-?', project: set.project || '', level: p.level || '-', wallType: p.wallType || '-', date: today(), drawnBy: set.drawnBy || 'CAS BIM Web Viewer',
        logoHref, sheet: 'auto', sourceNote: 'Entered by hand in the Panel Shop Generator (no model). Verify the dimensions in the field.',
        keyplanNote: 'NO MODEL: SIZES ENTERED BY HAND', linkNote: 'Entered in the Panel Shop Generator: share this panel with its Copy link.' };
}
function framed(p) {
    const errors = G.panelErrors(p);
    if (errors.length) return { errors };
    try { return { errors, layout: G.panelLayout(p) }; } catch (err) { return { errors: [{ where: 'shape', message: `Could not frame this panel: ${err.message}` }] }; }
}
function renderPreview() {
    const p = cur(), { errors, layout } = framed(p);
    document.getElementById('pv-title').textContent = `${p.mark || 'Panel'}${layout ? ` · ${fmtFtIn(layout.lengthIn)} x ${fmtFtIn(layout.heightIn)}` : ''}`;
    const check = document.getElementById('pv-check'), sheet = document.getElementById('pv-sheet'), list = document.getElementById('pv-errors');
    if (!layout) {
        check.innerHTML = `<span class="check-failed">Not drawn yet: fix ${errors.length === 1 ? 'this' : `these ${errors.length}`}</span>`;
        list.innerHTML = `<ul class="errors">${errors.map(e => `<li>${esc(e.message)}</li>`).join('')}</ul>`;
        sheet.classList.add('stale');
        return;
    }
    sheet.classList.remove('stale');
    const total = layout.cutList.reduce((a, r) => a + r.qty, 0);
    check.innerHTML = layout.issues.length ? `<span class="check-failed">Framing check failed (${layout.issues.length}): do not release</span>`
        : `<span class="check-passed">✓ Framing check passed · ${total} members · ${G.openingsSummary(p.openings)}</span>`;
    list.innerHTML = layout.issues.length ? `<ul class="errors">${layout.issues.slice(0, 6).map(i => `<li>${esc(i.message)}</li>`).join('')}</ul>` : '';
    sheet.innerHTML = renderSheet(layout, sheetInfo(p)).replace(/width="[\d.]+in" height="[\d.]+in"/, 'width="100%"');
}

// --- The set: every panel here, checked ones for PDF / members / delete -------------------------------------------------
function renderSet() {
    const box = $('#set-card'), groups = [...new Set(set.panels.map(p => p.group || ''))].sort();
    box.innerHTML = `<div class="row"><h2 style="margin:0">Panel set <span class="muted">· ${set.panels.length} panel${set.panels.length === 1 ? '' : 's'}${set.project ? ` · ${esc(set.project)}` : ''} · kept in this browser</span></h2>
            <span class="spacer"></span><button class="secondary" data-act="set-import">Import JSON</button><button class="secondary" data-act="set-export">Export JSON</button></div>
        <div class="fields set-fields">${field('Project', 'set.project', set.project, { r: 'project', list: 'project', ph: 'Project name', cls: 'wide' })}
            ${field('Drawn by', 'set.drawnBy', set.drawnBy, { r: 'drawnBy', list: 'drawnBy', ph: 'Your name' })}</div>
        <div class="row set-tools"><button class="link" data-act="set-check-all">Check all</button><button class="link" data-act="set-check-none">Check none</button>
            ${groups.some(Boolean) ? `<select id="check-group" aria-label="Check a group"><option value="__">Check a group…</option>${groups.map(g => `<option value="${esc(g)}">${esc(g || '(no group)')}</option>`).join('')}</select>` : ''}
            <span id="set-actions"></span></div>
        <div class="set-grid">${set.panels.map(p => {
            const { errors, layout } = framed(p), on = p.id === cur().id;
            return `<div class="card set-item ${on ? 'on' : ''}"><label class="set-check"><input type="checkbox" data-check="${esc(p.id)}" ${checked.has(p.id) ? 'checked' : ''} aria-label="Check ${esc(p.mark)}"></label>
                <button class="set-open" data-act="open" data-id="${esc(p.id)}" title="Open ${esc(p.mark)}">
                    <div class="thumb">${layout ? thumbnailSvg(layout) : ''}</div>
                    <b>${esc(p.mark)}</b>${p.group ? ` <span class="chip">${esc(p.group)}</span>` : ''}
                    <span class="muted">${layout ? `${fmtFtIn(layout.lengthIn)} x ${fmtFtIn(layout.heightIn)} · ${esc(G.SHAPES.find(k => k.kind === p.shape.kind)?.name || '')}` : 'Inputs to fix'}</span>
                    <span class="muted">${esc(p.members.stud)} @ ${esc(p.members.spacingIn)}" · ${esc(G.openingsSummary(p.openings))}</span>
                    ${errors.length ? '<span class="check-failed">Inputs to fix</span>' : layout.issues.length ? '<span class="check-failed">Check failed</span>' : '<span class="check-passed">✓ Check passed</span>'}
                </button></div>`;
        }).join('')}</div>`;
    renderSetActions();
}
function renderSetActions() {
    const el = main.querySelector('#set-actions');
    if (!el) return;
    const n = chosen().length, some = checked.size > 0;
    el.innerHTML = `<button data-act="set-pdf">Download PDF (${some ? `${n} checked` : `all ${n}`})</button>
        ${some ? `<button class="secondary" data-act="set-assign" title="Give the checked panels the members of the panel open above">Give ${checked.size} checked this panel's members</button>
        <button class="link danger" data-act="set-delete">Delete ${checked.size} checked</button>` : '<span class="muted">Check panels to give them the same members, print them together or delete them.</span>'}
        <button class="link" data-act="set-clear" title="Start over: remove every panel here">Start a new set</button>`;
}
const chosen = () => (checked.size ? set.panels.filter(p => checked.has(p.id)) : set.panels);

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
    if (!list.length || !confirm(`Delete ${list.map(p => p.mark).join(', ')}? This can't be undone (export the set first to keep a copy).`)) return;
    set.panels = set.panels.filter(p => !checked.has(p.id));
    checked.clear();
    if (!set.panels.length) set.panels.push(G.newPanel());
    sel = null; ask = null;
    save(); renderAll();
}
function clearSet() {
    if (!confirm('Start a new set? Every panel in this browser is removed (export the set first to keep a copy). Your remembered sizes and combos stay.')) return;
    set = { project: set.project, drawnBy: set.drawnBy, panels: [G.newPanel()], current: null };
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
async function downloadPdf(panels) {
    const items = [], skipped = [];
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
function exportJson() {
    download(JSON.stringify(G.exportSet(set), null, 2), `panel-set-${fileName(set.project || 'shops')}-${today()}.json`, 'application/json');
    notice(`Exported ${set.panels.length} panel${set.panels.length === 1 ? '' : 's'} as JSON. Import the file here (any browser) to carry on.`);
}
async function importJson(file) {
    try {
        const { set: incoming, warnings } = G.importSet(await file.text());
        if (!incoming.panels.length) { notice(`No panels read from ${file.name}. ${warnings.join(' ')}`, true); return; }
        const replace = confirm(`${file.name}: ${incoming.panels.length} panel${incoming.panels.length === 1 ? '' : 's'}.\n\nOK: replace the panels here with these.\nCancel: add them to the panels here.`);
        const marks = replace ? [] : set.panels.map(p => p.mark);
        const added = incoming.panels.map(p => {
            let mark = p.mark;
            while (marks.includes(mark)) mark = G.nextMark(mark);
            marks.push(mark);
            return { ...p, id: `p-${Math.random().toString(36).slice(2, 10)}`, mark };
        });
        // A model's export: its source, grids and levels kept with the set (written back on Export JSON).
        const context = Object.fromEntries(['source', 'grids', 'levels'].map(k => [k, incoming[k] ?? (replace ? undefined : set[k])]).filter(([, v]) => v != null));
        set = { project: set.project || incoming.project, drawnBy: set.drawnBy || incoming.drawnBy, ...context, panels: replace ? added : [...set.panels, ...added], current: added[0].id };
        checked.clear(); sel = null; ask = null;
        save(); renderAll();
        notice(`${replace ? 'Replaced with' : 'Added'} ${added.length} panel${added.length === 1 ? '' : 's'} from ${file.name}.${warnings.length ? ` ${warnings.join(' ')}` : ''}`, warnings.length > 0);
    } catch (err) { notice(`Could not read ${file.name}: ${err.message}`, true); }
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
openLinkedPanel();
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#p=')) { openLinkedPanel(); sel = null; ask = null; renderAll(); } }); // a link pasted into this tab
fetch(LOGO_URL).then(r => (r.ok ? r.blob() : null)).then(b => b && new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }))
    .then(href => { logoHref = href || null; renderPreview(); }).catch(() => {});
renderAll();
