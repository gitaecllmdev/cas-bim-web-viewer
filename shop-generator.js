// Panel Shop Generator (shop-generator.html): framing shop drawings without a model. A panel is typed in or drawn
// (its shape, doors and windows, members) and framed and drawn with the model's shop drawing code
// (demos/06-shop-drawings/generator.mjs, sheet.mjs). Nothing is uploaded: the set of panels, the sizes and members used
// before and the saved member combos are kept in this browser (localStorage); Export JSON keeps or shares a set, and a
// link (or the QR code on a sheet) opens one panel here.
import { fmtFtIn, topAt } from './demos/common/framing.mjs';
import { renderSheet, renderSheetPdf, renderSheetsPdf } from './demos/06-shop-drawings/sheet.mjs';
import { thumbnailSvg, openingsText } from './demos/06-shop-drawings/panels.mjs';
import * as G from './demos/06-shop-drawings/generator.mjs';

const LOGO_URL = 'demos/06-shop-drawings/cas-logo.png';
// The QR code on the sheet only when its link is short enough to scan off paper: up to 73 modules in its 0.92" box (0.3 mm each).
const QR_MAX = 340;
const KEYS = { set: 'cas-shopgen:set', recent: 'cas-shopgen:recent', combos: 'cas-shopgen:combos' };
const main = document.getElementById('gen');
const $ = (sel) => main.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: this visit only */ } };
const today = () => new Date().toLocaleDateString('en-CA');

let set = load(KEYS.set, null);
set = set?.panels ? { ...set, panels: set.panels.map(G.cleanPanel) } : { project: '', drawnBy: '', panels: [], current: null };
if (!set.panels.length) set.panels.push(G.newPanel());
let recent = load(KEYS.recent, {}); // field -> values used before, newest first
let combos = load(KEYS.combos, []); // [{ name, members }] saved here
const checked = new Set(); // panels checked in the set
let logoHref = null, drag = null, svgEl = null, view = null;
const cur = () => set.panels.find(p => p.id === set.current) || set.panels[0];

// --- Saving, notices --------------------------------------------------------------------------------------------------
let saveTimer = 0;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store(KEYS.set, { ...set, current: cur().id }), 250); };
function notice(text, warn = false) {
    const el = document.getElementById('notice');
    el.textContent = text;
    el.classList.toggle('warn', warn);
    el.hidden = !text;
    clearTimeout(notice.t);
    if (text) notice.t = setTimeout(() => { el.hidden = true; }, 9000);
}

// --- Inputs: data-f="path" (on the panel, or set.* on the set), data-t: len (feet-inches), num, text ----------------
function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys[keys.length - 1]] = value;
}
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const lenText = (v) => (Number.isFinite(v) ? fmtFtIn(v) : '');

main.addEventListener('input', (e) => {
    const el = e.target.closest('[data-f]');
    if (!el) return;
    const p = cur(), path = el.dataset.f, onSet = path.startsWith('set.');
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
    if (path === 'shape.lengthIn' && p.shape.kind === 'custom') { setCustomLength(p, v); syncPointEnds(); }
    else if (path === 'shape.lengthIn' && p.shape.kind === 'gable' && Math.abs((p.shape.peakAtIn ?? 0) - p.shape.lengthIn / 2) < 1 / 8) {
        p.shape.lengthIn = v; p.shape.peakAtIn = v / 2; // a centered peak stays centered
        const peak = main.querySelector('[data-f="shape.peakAtIn"]');
        if (peak) peak.value = lenText(v / 2);
    } else setPath(onSet ? set : p, onSet ? path.slice(4) : path, v);
    const kind = /^openings\.(\d+)\.kind$/.exec(path);
    if (kind) { // a door has no sill; a window gets a sill height
        const o = p.openings[Number(kind[1])];
        o.sillIn = o.kind === 'door' ? 0 : o.sillIn >= 3 ? o.sillIn : 36;
        renderOpenings();
    }
    if (path.startsWith('members.')) renderDatalists();
    changed();
});
// The stud when its field was entered: on leaving it, the members in the old stud's size follow to the new one.
let studBefore = null;
main.addEventListener('focusin', (e) => { if (e.target.matches?.('[data-f="members.stud"]')) studBefore = cur().members.stud; });
// On leaving a field: the length as feet-inches, and the value remembered for the next time.
main.addEventListener('change', (e) => {
    const el = e.target.closest('[data-f]');
    if (!el) return;
    if (el.dataset.f === 'members.stud' && studBefore != null && studBefore !== el.value) {
        const p = cur(), before = JSON.stringify(p.members);
        p.members = G.followStud(p.members, studBefore, el.value);
        p.openings = p.openings.map(o => ({ ...o, ...G.followStud({ track: '', header: o.head, jamb: o.jamb, sill: o.sill }, studBefore, el.value) }))
            .map(({ track, topTrack, header, ...o }) => ({ ...o, head: header }));
        studBefore = el.value;
        if (JSON.stringify(p.members) !== before) { renderMembers(); renderOpenings(); notice(`The track and members in the old stud's size now follow ${el.value}.`); }
        changed();
    }
    if (el.dataset.t === 'len') {
        const n = G.parseLength(el.value);
        if (n != null) { el.value = lenText(n); hint(el, n, true); recent.len = G.remember(recent.len, lenText(n), 12); }
    }
    if (el.dataset.r) recent[el.dataset.r] = G.remember(recent[el.dataset.r], el.value);
    store(KEYS.recent, recent);
    renderDatalists();
    if (el.dataset.f === 'mark' || el.dataset.f === 'group') renderSet();
});
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
// The points table's right end while the length is being typed (the table itself is rebuilt on the next change).
function syncPointEnds() {
    const el = main.querySelector('[data-end="right"]'), pts = cur().shape.points;
    if (el) el.textContent = `${lenText(pts[pts.length - 1][0])} (right end)`;
    if (main.querySelectorAll('.points tbody tr').length !== pts.length) renderShapeTable();
}

const field = (label, path, value, { t = 'text', list = '', r = '', ph = '', cls = '', i = '' } = {}) => `<label class="field ${cls}"><span>${esc(label)}</span>
    <input type="text" data-f="${esc(path)}" data-t="${t}" ${r ? `data-r="${r}"` : ''} ${i !== '' ? `data-i="${i}"` : ''} ${list ? `list="dl-${list}"` : ''}
        value="${esc(t === 'len' ? lenText(value) : value ?? '')}" placeholder="${esc(ph)}" autocomplete="off" ${t === 'len' ? 'inputmode="text"' : ''}>
    <em class="hint"></em></label>`;

// --- Actions (data-act) -----------------------------------------------------------------------------------------------
main.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, i = Number(b.dataset.i), p = cur();
    const acts = {
        new: () => addPanel(G.newPanel(p, set.panels.map(x => x.mark))),
        copy: () => addPanel(G.copyPanel(p, set.panels.map(x => x.mark))),
        shape: () => { p.shape = G.changeShape(p.shape, b.dataset.kind); renderShape(); changed(); },
        'add-point': () => { addPoint(p); renderShapeTable(); changed(); },
        'del-point': () => { if (p.shape.points.length > 2) p.shape.points.splice(i, 1); renderShapeTable(); changed(); },
        'add-door': () => { addOpening(p, 'door'); renderOpenings(); changed(); },
        'add-window': () => { addOpening(p, 'window'); renderOpenings(); changed(); },
        'del-op': () => { p.openings.splice(i, 1); renderOpenings(); changed(); },
        center: () => { const o = p.openings[i]; o.leftIn = Math.round(((G.shapeTop(p.shape).lengthIn - o.widthIn) / 2) * 16) / 16; renderOpenings(); changed(); },
        pdf: () => downloadPdf([p]),
        link: () => copyLink(p),
        'save-combo': () => saveCombo(p),
        'del-combo': () => deleteCombo(),
        open: () => { set.current = b.dataset.id; renderAll(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
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
});
main.addEventListener('change', (e) => {
    if (e.target.id === 'combo') applyCombo(e.target.value);
    if (e.target.matches('[data-check]')) { e.target.checked ? checked.add(e.target.dataset.check) : checked.delete(e.target.dataset.check); renderSetActions(); }
    if (e.target.id === 'check-group') { for (const x of set.panels) if ((x.group || '') === e.target.value) checked.add(x.id); e.target.value = '__'; renderSet(); }
});
document.getElementById('import-file').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importJson(f); });

function addPanel(panel) {
    set.panels.push(panel);
    set.current = panel.id;
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
// A new opening: centered when that spot is free, else right of the last one.
function addOpening(p, kind) {
    const L = G.shapeTop(p.shape).lengthIn, prev = [...p.openings].reverse().find(o => o.kind === kind);
    const o = { kind, widthIn: prev?.widthIn ?? (kind === 'door' ? 36 : 48), heightIn: prev?.heightIn ?? (kind === 'door' ? 84 : 48), sillIn: kind === 'door' ? 0 : prev?.sillIn ?? 36, head: '', jamb: '', sill: '' };
    const free = (left) => p.openings.every(x => left + o.widthIn + 6 <= x.leftIn || left >= x.leftIn + x.widthIn + 6);
    const centered = Math.round((L - o.widthIn) / 2);
    const after = p.openings.length ? Math.max(...p.openings.map(x => x.leftIn + x.widthIn)) + 18 : 12;
    o.leftIn = free(centered) ? centered : Math.min(after, Math.max(0, L - o.widthIn - 6));
    p.openings.push(o);
}

// --- Rendering ---------------------------------------------------------------------------------------------------------
function renderAll() {
    renderPanel(); renderShape(); renderOpenings(); renderMembers(); renderDatalists(); renderSet(); refresh(true);
}
let refreshTimer = 0;
function changed() { save(); refresh(); }
function refresh(now = false) {
    renderSketch();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { renderPreview(); renderSet(); }, now ? 0 : drag ? 160 : 90);
}

function renderPanel() {
    const p = cur();
    $('#panel-card').innerHTML = `<h2><span class="step">1</span> Panel</h2>
        <div class="fields">
            ${field('Panel mark', 'mark', p.mark, { ph: 'P-101' })}
            ${field('Level', 'level', p.level, { list: 'level', r: 'level', ph: 'L2' })}
            ${field('Wall type', 'wallType', p.wallType, { list: 'wallType', r: 'wallType', ph: 'CAS_1HR_362_1L_FULL', cls: 'wide' })}
            ${field('Group', 'group', p.group, { list: 'group', r: 'group', ph: 'e.g. Type A, Unit 3' })}
            ${field('Project', 'set.project', set.project, { r: 'project', list: 'project', ph: 'Project name', cls: 'wide' })}
            ${field('Drawn by', 'set.drawnBy', set.drawnBy, { r: 'drawnBy', list: 'drawnBy', ph: 'Your name' })}
        </div>`;
    const sideB = main.querySelector('[data-f="sideB"]');
    if (sideB) sideB.checked = !!p.sideB;
}

function renderShape() {
    const p = cur(), s = p.shape;
    const icon = (kind) => ({ rect: 'M2 18H22V6H2Z', rake: 'M2 18H22V4L2 10Z', gable: 'M2 18H22V10L12 3L2 10Z', custom: 'M2 18H22V8L16 11L10 4L2 9Z' })[kind];
    const dims = {
        rect: [field('Length', 'shape.lengthIn', s.lengthIn, { t: 'len', list: 'len' }), field('Height', 'shape.heightIn', s.heightIn, { t: 'len', list: 'len' })],
        rake: [field('Length', 'shape.lengthIn', s.lengthIn, { t: 'len', list: 'len' }), field('Height at left', 'shape.leftIn', s.leftIn, { t: 'len', list: 'len' }),
            field('Height at right', 'shape.rightIn', s.rightIn, { t: 'len', list: 'len' })],
        gable: [field('Length', 'shape.lengthIn', s.lengthIn, { t: 'len', list: 'len' }), field('Left eave height', 'shape.leftIn', s.leftIn, { t: 'len', list: 'len' }),
            field('Right eave height', 'shape.rightIn', s.rightIn, { t: 'len', list: 'len' }), field('Peak height', 'shape.peakIn', s.peakIn, { t: 'len', list: 'len' }),
            field('Peak from left', 'shape.peakAtIn', s.peakAtIn, { t: 'len', list: 'len' })],
        custom: [field('Length', 'shape.lengthIn', s.lengthIn, { t: 'len', list: 'len' })],
    }[s.kind];
    $('#shape-card').innerHTML = `<h2><span class="step">2</span> Shape</h2>
        <div class="shape-pick" role="radiogroup" aria-label="Panel shape">${G.SHAPES.map(k => `<button class="${k.kind === s.kind ? 'on' : 'secondary'}" data-act="shape" data-kind="${k.kind}" role="radio" aria-checked="${k.kind === s.kind}">
            <svg viewBox="0 0 24 20" aria-hidden="true"><path d="${icon(k.kind)}"/></svg><b>${esc(k.name)}</b><small>${esc(k.hint)}</small></button>`).join('')}</div>
        <div class="fields">${dims.join('')}</div>
        <div class="sketch" id="sketch"></div>
        <p class="muted small">${s.kind === 'custom' ? 'Drag a point, or click above the top line to add one there; double-click a point to remove it. ' : 'Drag the round handles to change the shape. '}Drag a door or window to move it. Lengths: type 10'-6", 10' 6 or 126 (inches).</p>
        <div id="shape-points"></div>`;
    svgEl = null;
    renderShapeTable();
    renderSketch();
}
// A drawn top: its points, left end to right end (the ends' positions are the panel's ends).
function renderShapeTable() {
    const box = main.querySelector('#shape-points'), s = cur().shape;
    if (!box) return;
    box.innerHTML = s.kind !== 'custom' ? '' : `<table class="points"><thead><tr><th>Point</th><th>From left</th><th>Height</th><th></th></tr></thead><tbody>
        ${s.points.map((pt, i) => `<tr><td>${i + 1}</td>
            <td>${i === 0 || i === s.points.length - 1 ? `<span class="muted" data-end="${i ? 'right' : 'left'}">${lenText(pt[0])} (${i ? 'right' : 'left'} end)</span>` : field('', `shape.points.${i}.0`, pt[0], { t: 'len', cls: 'bare' })}</td>
            <td>${field('', `shape.points.${i}.1`, pt[1], { t: 'len', cls: 'bare' })}</td>
            <td>${s.points.length > 2 && i > 0 && i < s.points.length - 1 ? `<button class="link" data-act="del-point" data-i="${i}" title="Remove this point">✕</button>` : ''}</td></tr>`).join('')}</tbody></table>
        <button class="secondary" data-act="add-point">+ Add a point</button>`;
}

function renderOpenings() {
    const p = cur(), m = p.members;
    $('#openings-card').innerHTML = `<h2><span class="step">3</span> Doors and windows <span class="muted">(${p.openings.length || 'none'})</span></h2>
        <div class="row"><button data-act="add-door">+ Door</button><button data-act="add-window">+ Window</button></div>
        ${p.openings.map((o, i) => `<div class="op" data-op="${i}"><div class="row op-head"><b class="op-name ${o.kind}">${G.openingName(p.openings, i)}</b>
                <select data-f="openings.${i}.kind" data-i="${i}" aria-label="Door or window"><option value="door" ${o.kind === 'door' ? 'selected' : ''}>Door</option><option value="window" ${o.kind === 'window' ? 'selected' : ''}>Window</option></select>
                <span class="spacer"></span><button class="link" data-act="center" data-i="${i}">Center it</button><button class="link danger" data-act="del-op" data-i="${i}">Remove</button></div>
            <div class="fields">${field('Width', `openings.${i}.widthIn`, o.widthIn, { t: 'len', list: 'len' })}${field('Height', `openings.${i}.heightIn`, o.heightIn, { t: 'len', list: 'len' })}
                ${o.kind === 'window' ? field('Sill height', `openings.${i}.sillIn`, o.sillIn, { t: 'len', list: 'len' }) : ''}${field('From left end', `openings.${i}.leftIn`, o.leftIn, { t: 'len', list: 'len' })}</div>
            <details ${o.head || o.jamb || o.sill ? 'open' : ''}><summary>Members for this ${o.kind} only</summary><div class="fields">
                ${field('Header', `openings.${i}.head`, o.head, { list: 'header', r: 'header', ph: `as the panel: ${m.header || 'track'}`, cls: 'wide' })}
                ${field('Jambs', `openings.${i}.jamb`, o.jamb, { list: 'jamb', r: 'jamb', ph: `as the panel: ${m.jamb || 'stud'}`, cls: 'wide' })}
                ${o.kind === 'window' ? field('Sill', `openings.${i}.sill`, o.sill, { list: 'sill', r: 'sill', ph: `as the panel: ${m.sill || 'track'}`, cls: 'wide' }) : ''}</div></details></div>`).join('')
            || '<p class="muted">No openings: a plain panel. Add a door or a window, then type its size and where it is from the left end.</p>'}`;
}

function renderMembers() {
    const p = cur(), m = p.members, stud = G.parseMember(m.stud)?.name || m.stud, track = m.track || G.trackFor(m.stud);
    $('#members-card').innerHTML = `<h2><span class="step">4</span> Members</h2>
        <div class="row combo"><label class="field wide"><span>Member combo</span><select id="combo"><option value="">Pick a combo to fill these in…</option>
            <optgroup label="Saved in this browser">${combos.map((c, i) => `<option value="s${i}">${esc(c.name)}</option>`).join('') || '<option disabled>None yet: Save as a combo</option>'}</optgroup>
            <optgroup label="Typical (check against the framing criteria)">${G.COMBOS.map((c, i) => `<option value="b${i}">${esc(c.name)}</option>`).join('')}</optgroup></select></label>
            <button class="secondary" data-act="save-combo">Save as a combo</button>${combos.length ? '<button class="link" data-act="del-combo">Delete a saved combo</button>' : ''}</div>
        <div class="fields">
            ${field('Stud', 'members.stud', m.stud, { list: 'stud', r: 'stud', ph: '362S162-33' })}
            ${field('Track', 'members.track', m.track, { list: 'track', r: 'track', ph: `${G.trackFor(m.stud) || '362T125-33'} (as the stud)` })}
            ${field('Top track (if different)', 'members.topTrack', m.topTrack, { list: 'topTrack', r: 'topTrack', ph: 'e.g. deflection track' })}
            ${field('Stud spacing (inches o.c.)', 'members.spacingIn', m.spacingIn, { t: 'num', list: 'spacing' })}
            ${field('Headers', 'members.header', m.header, { list: 'header', r: 'header', ph: `${track} (a track header)`, cls: 'wide' })}
            ${field('Jambs', 'members.jamb', m.jamb, { list: 'jamb', r: 'jamb', ph: `${stud} (one stud each side)`, cls: 'wide' })}
            ${field('Window sills', 'members.sill', m.sill, { list: 'sill', r: 'sill', ph: `${track} (a track sill)`, cls: 'wide' })}
        </div>
        <p class="muted small">Pick from the list or type a size: one SSMA member (362S162-33), or a built-up one: (2) 362S162-43 WITH (1) 362T125-43.
            Each part is counted in the cut list. Sizes you type are remembered in this browser.</p>`;
}

function renderDatalists() {
    const ch = G.memberChoices(cur().members);
    const groups = [...new Set(set.panels.map(p => p.group).filter(Boolean))];
    const lists = { ...ch, spacing: G.SPACINGS.map(String), level: [], wallType: [], group: groups, project: [], drawnBy: [], len: [] };
    document.getElementById('datalists').innerHTML = Object.entries(lists).map(([k, v]) => `<datalist id="dl-${k}">${[...new Set([...(recent[k] || []), ...v])].map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>`).join('');
}

// --- The sketch: the panel's outline, its openings and handles to drag ----------------------------------------------
function renderSketch() {
    const box = main.querySelector('#sketch');
    if (!box) return;
    const p = cur(), { lengthIn: L, heightIn: H, top } = G.shapeTop(p.shape);
    if (!(L > 0 && H > 0)) { box.innerHTML = '<p class="muted">Type a length and a height to see the panel.</p>'; svgEl = null; return; }
    if (!svgEl || !box.contains(svgEl)) { box.innerHTML = '<svg role="img" aria-label="The panel\'s shape"></svg>'; svgEl = box.querySelector('svg'); bindSketch(svgEl); }
    if (!drag) {
        const pad = Math.max(L, H) * 0.14;
        view = { L, H, pad };
        svgEl.setAttribute('viewBox', `${-pad * 1.6} ${-(H + pad)} ${L + pad * 3.2} ${H + pad * 2}`);
    }
    const u = Math.max(view.L, view.H) / 100, fs = u * 3.4, at = (x) => topAt(top, x, H);
    const Y = (y) => -y;
    const outline = [[0, 0], [L, 0], ...(top ? [...top].reverse() : [[L, H], [0, H]])];
    const parts = [`<line x1="${-view.pad}" y1="0" x2="${L + view.pad}" y2="0" class="sk-floor" stroke-width="${u * 0.5}"/>`,
        `<polygon points="${outline.map(([x, y]) => `${x},${Y(y)}`).join(' ')}" class="sk-wall" stroke-width="${u * 0.6}"/>`];
    // Dimensions: the length under it, the height at each end, each peak or break.
    const t = (x, y, s, { a = 'middle', cls = 'sk-dim', size = fs } = {}) => `<text x="${x}" y="${y}" text-anchor="${a}" font-size="${size}" class="${cls}">${esc(s)}</text>`;
    parts.push(`<line x1="0" y1="${fs * 1.2}" x2="${L}" y2="${fs * 1.2}" class="sk-dimline" stroke-width="${u * 0.3}"/>`, t(L / 2, fs * 2.6, fmtFtIn(L)));
    parts.push(t(-u * 2, Y(at(0) / 2), fmtFtIn(at(0)), { a: 'end' }), t(L + u * 2, Y(at(L) / 2), fmtFtIn(at(L)), { a: 'start' }));
    for (const [x, h] of top ? top.slice(1, -1) : []) parts.push(t(x, Y(h) - fs * 0.8, fmtFtIn(h)));
    // Openings: drag to move (a window up and down too).
    p.openings.forEach((o, i) => {
        const b = G.openingBox(o), w = b.right - b.left, h = b.top - b.bottom;
        if (!(w > 0 && h > 0)) return;
        // Its name and size, and where it is, each as large as fits across it (on three lines when narrow).
        const fit = (str, max) => Math.min(max, (w * 0.92) / (str.length * 0.56));
        const lines = [G.openingName(p.openings, i), `${fmtFtIn(w)} x ${fmtFtIn(h)}`, `@ ${fmtFtIn(b.left)}${o.kind === 'window' ? `, sill ${fmtFtIn(b.bottom)}` : ''}`];
        const sizes = [fit(lines[0], fs * 1.1), fit(lines[1], fs * 0.9), fit(lines[2], fs * 0.75)], gap = Math.max(...sizes) * 1.25;
        parts.push(`<g class="sk-op ${o.kind}" data-drag="op:${i}"><title>${esc(`${lines[0]}: drag to move it${o.kind === 'window' ? ' (up and down too)' : ''}`)}</title>
            <rect x="${b.left}" y="${Y(b.top)}" width="${w}" height="${h}" stroke-width="${u * 0.45}"/>
            ${lines.map((s, k) => t(b.left + w / 2, Y(b.bottom + h / 2) + (k - 1) * gap + sizes[k] * 0.35, s, { cls: k ? 'sk-op-sub' : 'sk-op-text', size: sizes[k] })).join('')}</g>`);
    });
    // Handles.
    const handle = (x, y, what, title) => `<circle cx="${x}" cy="${Y(y)}" r="${u * 2}" class="sk-handle" data-drag="${what}" stroke-width="${u * 0.5}"><title>${esc(title)}</title></circle>`;
    const s = p.shape;
    if (s.kind === 'rect') parts.push(handle(L, H, 'size', 'Drag to change the length and height'));
    else parts.push(handle(L, 0, 'len', 'Drag to change the length'));
    if (s.kind === 'rake' || s.kind === 'gable') parts.push(handle(0, at(0), 'left', 'Height at the left end'), handle(L, at(L), 'right', 'Height at the right end'));
    if (s.kind === 'gable') parts.push(handle(Math.min(L, Math.max(0, s.peakAtIn ?? L / 2)), Number(s.peakIn) || H, 'peak', 'The peak: drag up, down or sideways'));
    if (s.kind === 'custom') s.points.forEach((pt, i) => parts.push(handle(pt[0], pt[1], `pt:${i}`, `Point ${i + 1}: drag it; double-click to remove`)));
    svgEl.innerHTML = parts.join('');
}

function wallPoint(e) {
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(svgEl.getScreenCTM().inverse());
    return [q.x, -q.y];
}
const snap = (v) => Math.round(v * 2) / 2; // 1/2" while dragging; type a size for anything finer
function bindSketch(svg) {
    svg.addEventListener('pointerdown', (e) => {
        const h = e.target.closest('[data-drag]'), p = cur();
        drag = { what: h?.dataset.drag || 'none', start: wallPoint(e), moved: false, orig: structuredClone({ shape: p.shape, openings: p.openings }), x: e.clientX, y: e.clientY };
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    svg.addEventListener('pointermove', (e) => {
        if (!drag) return;
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true;
        if (!drag.moved || drag.what === 'none') return;
        applyDrag(drag, wallPoint(e));
        refresh();
    });
    const end = (e) => {
        if (!drag) return;
        const d = drag;
        drag = null;
        if (!d.moved && d.what === 'none' && cur().shape.kind === 'custom') addPointAt(cur(), wallPoint(e));
        if (d.moved || d.what === 'none') { renderShapeFields(); renderOpenings(); changed(); }
        refresh(true);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('dblclick', (e) => {
        const h = e.target.closest('[data-drag^="pt:"]'), p = cur();
        if (!h || p.shape.kind !== 'custom') return;
        const i = Number(h.dataset.drag.slice(3));
        if (i > 0 && i < p.shape.points.length - 1) { p.shape.points.splice(i, 1); renderShapeTable(); changed(); }
    });
}
function applyDrag(d, [x, y]) {
    const p = cur(), s = p.shape, L = G.shapeTop(s).lengthIn, minH = 12;
    const [what, n] = d.what.split(':'), i = Number(n);
    if (what === 'size') { s.lengthIn = Math.max(12, snap(x)); s.heightIn = Math.max(minH, snap(y)); }
    if (what === 'len') { const v = Math.max(12, snap(x)); if (s.kind === 'custom') setCustomLength(p, v); else s.lengthIn = v; }
    if (what === 'left') s.leftIn = Math.max(minH, snap(y));
    if (what === 'right') s.rightIn = Math.max(minH, snap(y));
    if (what === 'peak') { s.peakAtIn = Math.min(L - 1, Math.max(1, snap(x))); s.peakIn = Math.max(minH, snap(y)); }
    if (what === 'pt') {
        const pts = s.points, last = pts.length - 1;
        const px = i === 0 ? 0 : i === last ? L : Math.min(pts[i + 1][0] - 1, Math.max(pts[i - 1][0] + 1, snap(x)));
        pts[i] = [px, Math.max(minH, snap(y))];
    }
    if (what === 'op') {
        const o = p.openings[i], o0 = d.orig.openings[i], dx = x - d.start[0], dy = y - d.start[1];
        o.leftIn = Math.min(L - o.widthIn, Math.max(0, snap(o0.leftIn + dx)));
        if (o.kind === 'window') o.sillIn = Math.max(3, snap(o0.sillIn + dy));
    }
}
function addPointAt(p, [x, y]) {
    const pts = p.shape.points, L = G.shapeTop(p.shape).lengthIn;
    if (!(x > 1 && x < L - 1 && y > 12)) return;
    if (pts.some(pt => Math.abs(pt[0] - x) < 3)) return;
    pts.push([snap(x), snap(y)]);
    pts.sort((a, b) => a[0] - b[0]);
}
// After a drag: the shape's typed fields show the new sizes (without rebuilding the sketch being dragged).
function renderShapeFields() {
    for (const el of main.querySelectorAll('#shape-card .fields [data-f][data-t="len"]')) {
        const v = getPath(cur(), el.dataset.f);
        if (document.activeElement !== el) el.value = lenText(v);
    }
    renderShapeTable();
}

// --- The sheet ---------------------------------------------------------------------------------------------------------
function sheetInfo(p) {
    const url = `${location.origin}${location.pathname}#p=${G.encodePanel(p)}`;
    return { mark: p.mark || 'P-?', project: set.project || '', level: p.level || '-', wallType: p.wallType || '-', date: today(), drawnBy: set.drawnBy || 'CAS BIM Web Viewer',
        logoHref, sheet: 'auto', sourceNote: 'Entered by hand in the Panel Shop Generator (no model). Verify the dimensions in the field.',
        keyplanNote: 'NO MODEL: SIZES ENTERED BY HAND', ...(url.length <= QR_MAX ? { qrUrl: url, qrLabel: 'SCAN: OPEN IN THE GENERATOR' } : {}) };
}
function framed(p) {
    const errors = G.panelErrors(p);
    if (errors.length) return { errors };
    try { return { errors, layout: G.panelLayout(p) }; } catch (err) { return { errors: [{ where: 'shape', message: `Could not frame this panel: ${err.message}` }] }; }
}
function renderPreview() {
    const p = cur(), { errors, layout } = framed(p);
    document.getElementById('pv-title').textContent = `${p.mark || 'Panel'}${layout ? ` · ${fmtFtIn(layout.lengthIn)} x ${fmtFtIn(layout.heightIn)}` : ''}`;
    const check = document.getElementById('pv-check'), sheet = document.getElementById('pv-sheet');
    for (const el of main.querySelectorAll('[data-op]')) el.classList.toggle('bad', errors.some(e => e.where === `opening-${el.dataset.op}`));
    if (!layout) {
        check.innerHTML = `<div class="check-failed">Not drawn yet: fix ${errors.length === 1 ? 'this' : `these ${errors.length}`}</div><ul class="errors">${errors.map(e => `<li>${esc(e.message)}</li>`).join('')}</ul>`;
        sheet.classList.add('stale');
        return;
    }
    sheet.classList.remove('stale');
    const total = layout.cutList.reduce((a, r) => a + r.qty, 0);
    check.innerHTML = layout.issues.length
        ? `<div class="check-failed">Framing check failed (${layout.issues.length}): do not release.</div><ul class="errors">${layout.issues.slice(0, 6).map(i => `<li>${esc(i.message)}</li>`).join('')}</ul>`
        : `<div class="check-passed">✓ Framing check passed · ${total} members · ${layout.openings.length ? openingsText({ frame: { openings: layout.openings } }) : 'no openings'}</div>`;
    sheet.innerHTML = renderSheet(layout, sheetInfo(p)).replace(/width="[\d.]+in" height="[\d.]+in"/, 'width="100%"');
}

// --- The set: every panel here, checked ones for PDF / members / delete -------------------------------------------------
function renderSet() {
    const box = $('#set-card'), groups = [...new Set(set.panels.map(p => p.group || ''))].sort();
    box.innerHTML = `<div class="row"><h2 style="margin:0">Panel set <span class="muted">· ${set.panels.length} panel${set.panels.length === 1 ? '' : 's'}${set.project ? ` · ${esc(set.project)}` : ''} · kept in this browser</span></h2>
            <span class="spacer"></span><button class="secondary" data-act="set-import">Import JSON</button><button class="secondary" data-act="set-export">Export JSON</button></div>
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
                    <span class="muted">${esc(p.members.stud)} @ ${esc(p.members.spacingIn)}" · ${p.openings.length ? openingsText({ frame: { openings: p.openings.map(G.openingBox) } }) : 'no openings'}</span>
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
    if (!confirm(`Give the ${ids.length} checked panel${ids.length === 1 ? '' : 's'} the members of ${p.mark}?\n${p.members.stud} @ ${p.members.spacingIn}" o.c., track ${p.members.track || G.trackFor(p.members.stud)}${p.members.header ? `, headers ${p.members.header}` : ''}${p.members.jamb ? `, jambs ${p.members.jamb}` : ''}`)) return;
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
    save(); renderAll();
}
function clearSet() {
    if (!confirm('Start a new set? Every panel in this browser is removed (export the set first to keep a copy). Your remembered sizes and combos stay.')) return;
    set = { project: set.project, drawnBy: set.drawnBy, panels: [G.newPanel()], current: null };
    checked.clear();
    save(); renderAll();
}

// --- Combos -------------------------------------------------------------------------------------------------------------
function applyCombo(value) {
    const c = value?.[0] === 's' ? combos[Number(value.slice(1))] : value?.[0] === 'b' ? G.COMBOS[Number(value.slice(1))] : null;
    if (!c) return;
    cur().members = { ...G.DEFAULT_MEMBERS, ...c.members };
    renderMembers(); renderOpenings(); renderDatalists(); changed();
    notice(`Members set to "${c.name}".`);
}
function saveCombo(p) {
    const m = p.members, name = prompt('Name this member combo:', `${G.parseMember(m.stud)?.name || m.stud} @ ${m.spacingIn}" o.c.${m.header ? ', built-up header' : ''}`);
    if (!name?.trim()) return;
    combos = [{ name: name.trim().slice(0, 80), members: { ...m } }, ...combos.filter(c => c.name !== name.trim())].slice(0, 30);
    store(KEYS.combos, combos);
    renderMembers();
    notice(`Saved "${name.trim()}": pick it from Member combo on any panel.`);
}
function deleteCombo() {
    const name = prompt(`Delete which saved combo? Type its name:\n${combos.map(c => `· ${c.name}`).join('\n')}`);
    if (!name) return;
    const before = combos.length;
    combos = combos.filter(c => c.name !== name.trim());
    store(KEYS.combos, combos);
    renderMembers();
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
        set = { project: set.project || incoming.project, drawnBy: set.drawnBy || incoming.drawnBy, panels: replace ? added : [...set.panels, ...added], current: added[0].id };
        checked.clear();
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
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#p=')) { openLinkedPanel(); renderAll(); } }); // a link pasted into this tab
fetch(LOGO_URL).then(r => (r.ok ? r.blob() : null)).then(b => b && new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }))
    .then(href => { logoHref = href || null; renderPreview(); }).catch(() => {});
renderAll();
