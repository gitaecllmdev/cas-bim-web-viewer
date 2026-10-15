import { newCeiling, footprint, readProject, emptyProject } from './demos/ceilings/ceiling-project.mjs';
import { resolveCeilingPlan, planSet } from './demos/ceilings/ceiling-plan.mjs';
import { layoutOps, opsSvg, sheetOps, ceilingPdf, quantitiesCsv, escapeHtml as esc } from './demos/ceilings/drawing.mjs';
import { bounds } from './demos/ceilings/geometry.mjs';
import { parseLength } from './demos/06-shop-drawings/generator.mjs';
import { fmtFtIn } from './demos/common/framing.mjs';
import { CeilingSketch } from './ceiling-sketch.js';
import { TYPE_OPTIONS, typeGroup } from './demos/ceilings/member-types.mjs';

const KEY = 'cas-ceiling-generator:project:v1', PREFS = 'cas-ceiling-generator:prefs:v1';
const $ = s => document.querySelector(s), uid = () => crypto.randomUUID();
let project = emptyProject(), startupNotice = '', storageAvailable = true;
try {
    const saved = localStorage.getItem(KEY);
    if (saved) project = readProject(saved);
    else { const c = newCeiling(uid(), 'C-001'); project.ceilings.push(c); project.currentId = c.id; }
} catch (e) { startupNotice = `Saved project could not be read: ${e.message}. Import a saved project or add a ceiling.`; }
let prefs = { view: 'layout', result: 'quantities' };
try { const p = JSON.parse(localStorage.getItem(PREFS)); if (['layout', 'panels', 'framing', 'iso', 'drawing'].includes(p?.view)) prefs.view = p.view; if (p?.result === 'checks') prefs.result = 'checks'; } catch { /* Defaults are usable. */ }
let undo = [], redo = [], selectedOpening = null, plan = null, fileDirty = false, noticeTimer, sketch;
const current = () => project.ceilings.find(c => c.id === project.currentId);
function parseDimension(value) { const s = value.trim(), negative = s.startsWith('-'), n = parseLength(negative ? s.slice(1) : s); return n == null ? null : negative ? -n : n; }
function notice(message) { $('#notice').textContent = message; $('#notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 5500); }
function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(project)); storageAvailable = true; } catch { storageAvailable = false; }
    $('#save-status').textContent = storageAvailable ? (fileDirty ? 'Saved in browser · Project file has changes' : 'Saved in this browser') : 'Browser storage unavailable · Save project to keep changes';
}
function commit(change) {
    const before = JSON.stringify(project), candidate = structuredClone(project);
    try { change(candidate); const validated = readProject(JSON.stringify(candidate)); if (JSON.stringify(validated) === before) return true; undo.push(before); if (undo.length > 60) undo.shift(); redo = []; project = validated; fileDirty = true; persist(); render(); return true; }
    catch (e) { notice(e.message); render(); return false; }
}
function edit(change) { return commit(p => { const c = p.ceilings.find(c => c.id === p.currentId); if (c) change(c, p); }); }
function download(name, content, type) { const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
const safeName = s => String(s).replace(/[^a-z0-9_-]/gi, '_').slice(0, 80) || 'ceiling';
const modeName = c => c.mode === 'hardlid' ? 'Hardlid framing' : 'Ceiling grid';
function render() {
    const c = current(); plan = c ? resolveCeilingPlan(c) : null;
    $('#ceiling-count').textContent = project.ceilings.length;
    $('#ceiling-list').innerHTML = project.ceilings.map(c => `<button class="ceiling-card ${c.id === project.currentId ? 'active' : ''}" data-ceiling="${esc(c.id)}" aria-pressed="${c.id === project.currentId}"><div class="card-mode"><b>${esc(c.mark)}</b><i aria-hidden="true">${c.mode === 'grid' ? '▦' : '▤'}</i></div><span>${modeName(c)}</span><span>${fmtFtIn(c.lengthIn)} × ${fmtFtIn(c.depthIn)}</span></button>`).join('') || '<p class="property-hint">No ceilings yet. Add one to start.</p>';
    $('#undo').disabled = !undo.length; $('#redo').disabled = !redo.length;
    $('#current-title').textContent = c ? `${c.mark} · ${modeName(c)}` : 'Start a ceiling';
    $('#current-subtitle').textContent = c ? `${project.name || 'Untitled project'} · Elevation ${fmtFtIn(c.elevationIn)} · ${(plan.netAreaFt2 || 0).toFixed(1)} SF` : 'Create a footprint, then choose its framing system.';
    $('#primary-legend').textContent = c?.mode === 'hardlid' ? 'Ceiling joist' : 'Main runner';
    $('#layout-stats').textContent = c ? `${plan.members.length} members · ${plan.panels.length} panels` : '';
    $('#quantity-count').textContent = plan?.quantities.length || 0; $('#check-count').textContent = plan?.issues.length || 0;
    for (const button of document.querySelectorAll('[data-view]')) { button.setAttribute('aria-selected', String(button.dataset.view === prefs.view)); button.tabIndex = button.dataset.view === prefs.view ? 0 : -1; }
    for (const button of document.querySelectorAll('[data-result]')) { button.setAttribute('aria-selected', String(button.dataset.result === prefs.result)); button.tabIndex = button.dataset.result === prefs.result ? 0 : -1; }
    $('#preview').setAttribute('aria-labelledby', `tab-${prefs.view}`); $('#results').setAttribute('aria-labelledby', `tab-${prefs.result}`);
    const drawingBoundary = sketch?.tool === 'boundary';
    $('#boundary-button').textContent = drawingBoundary ? 'Finish footprint' : 'Draw footprint'; $('#boundary-button').classList.toggle('drawing', drawingBoundary); $('#boundary-button').setAttribute('aria-pressed',String(drawingBoundary));
    $('#boundary-actions').hidden = !drawingBoundary;
    document.querySelectorAll('[data-sketch-tool]').forEach(b => { const active=b.dataset.sketchTool===sketch?.tool; b.setAttribute('aria-pressed',String(active)); b.classList.toggle('drawing',active); b.disabled=!c; });
    $('#sketch-kind').value=sketch?.kind || 'void'; $('#sketch-snap').value=String(sketch?.step || 1);
    $('#preview').classList.toggle('drawing-mode', sketch?.tool !== 'select');
    $('#tool-hint').textContent = sketch?.status() || '';
    const invalid = !c || plan.issues.some(i => i.severity === 'error');
    for (const action of ['duplicate', 'delete', 'boundary', 'reset-boundary', 'pdf', 'csv']) document.querySelectorAll(`[data-action="${action}"]`).forEach(b => { b.disabled = !c || (['pdf', 'csv'].includes(action) && invalid); });
    document.querySelector('[data-action="layout"]').disabled = !project.ceilings.length;
    if (!c) { $('#preview').innerHTML = '<div class="empty"><h2>Your next ceiling starts here</h2><p>Add a ceiling to lay out hardlid framing or acoustical grid.</p><button data-action="new">+ New ceiling</button></div>'; sketch?.setScene(null,null); $('#properties').innerHTML = ''; $('#results').innerHTML = '<p class="result-note">Quantities appear when a ceiling is added.</p>'; return; }
    renderPreview(); renderProperties(); renderResults(); persist();
}
function renderPreview() {
    if (prefs.view === 'drawing') { $('#preview').innerHTML = opsSvg(sheetOps(plan, project.name)); sketch?.setScene(null,null); return; }
    const rendered = layoutOps(plan, { view: prefs.view, selectedOpening });
    const points = rendered.ops.flatMap(o => o.t === 'poly' ? o.pts : o.t === 'line' ? [[o.x1, o.y1], [o.x2, o.y2]] : [[o.x, o.y]]);
    const box = bounds(points), viewBox = [box.minX - .65, box.minY - .35, box.maxX - box.minX + 1.3, box.maxY - box.minY + .7];
    const fontMin = viewBox[2] / Math.max(240, $('#preview').clientWidth) * 10;
    rendered.ops.forEach(o => { if (o.t === 'text') o.size = Math.max(o.size, fontMin); });
    $('#preview').innerHTML = opsSvg(rendered.ops, { interactive: true, viewBox });
    sketch?.setScene(rendered.transform, viewBox);
}
const field = (id, label, value, wide = false, extra = '') => `<label class="property-field ${wide ? 'wide' : ''}"><span>${label}</span><input id="${id}" data-field="${id}" value="${esc(value)}" ${extra}></label>`;
const select = (id, label, value, options, wide = true) => `<label class="property-field ${wide ? 'wide' : ''}"><span>${label}</span><select id="${id}" data-field="${id}">${options.map(([v, text]) => `<option value="${v}" ${String(value) === String(v) ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
const section = (title, content, hint = '') => `<section class="property-section"><h3>${title}</h3><div class="property-fields">${content}</div>${hint ? `<p class="property-hint">${hint}</p>` : ''}</section>`;
function renderProperties() {
    const c = current(), s = c.settings, opening = c.openings.find(o => o.id === selectedOpening);
    let html = section('Ceiling', field('project-name', 'Project', project.name, true, 'maxlength="200"') + field('ceiling-mark', 'Ceiling mark', c.mark, true, 'maxlength="60"') + select('mode', 'System', c.mode, [['grid', 'Ceiling grid / ACT'], ['hardlid', 'Hardlid framing']]) + field('elevation', 'Elevation', fmtFtIn(c.elevationIn), true));
    html += section('Footprint', select('shape', 'Shape', c.shape, [['rectangle', 'Rectangle'], ['l-shape', 'L-shape'], ...(c.shape === 'custom' ? [['custom', 'Drawn footprint']] : [])]) + (c.shape !== 'custom' ? field('length', 'Length', fmtFtIn(c.lengthIn)) + field('depth', 'Depth', fmtFtIn(c.depthIn)) : '') + (c.shape === 'l-shape' ? field('notch-width', 'Notch width', fmtFtIn(c.notchWidthIn)) + field('notch-depth', 'Notch depth', fmtFtIn(c.notchDepthIn)) : ''), 'Enter 10\'-6", 10.5\' or 126 (inches).');
    html += section(c.mode === 'grid' ? 'Grid layout' : 'Framing layout', (c.mode === 'grid' ? select('tile', 'Panel module', s.tileDepthIn, [[24, '2 × 2 ft'], [48, '2 × 4 ft']]) : field('joist-spacing', 'Joist spacing', fmtFtIn(s.joistSpacingIn), true)) + select('direction', c.mode === 'grid' ? 'Main runner direction' : 'Joist direction', s.direction, [[0, 'Along depth ↑'], [90, 'Along length →']]) + field('origin-x', 'Origin X', fmtFtIn(s.originX)) + field('origin-y', 'Origin Y', fmtFtIn(s.originY)), c.mode === 'grid' ? 'Generic grid: 4 ft main spacing. Product-specific connectors and supports are a later step.' : 'Generic joist and track layout. Framing sizes and supports need a project-specific selection.').replace('</section>', '<button class="secondary" data-action="balance">Balance layout</button></section>');
    html += `<section class="property-section"><h3>Openings &amp; fixtures <span class="muted">${c.openings.length}</span></h3><div class="opening-add"><button class="secondary" data-add-opening="void">+ Opening</button><button class="secondary" data-add-opening="light">+ Light</button><button class="secondary" data-add-opening="diffuser">+ Diffuser</button></div>${c.openings.map((o, i) => `<div class="opening-row"><button class="${o.id === selectedOpening ? 'active' : ''}" data-select-opening="${esc(o.id)}">${i + 1}. ${esc(o.kind)} · ${fmtFtIn(o.width)} × ${fmtFtIn(o.depth)}</button><button class="remove-opening" data-remove-opening="${esc(o.id)}" aria-label="Remove ${esc(o.kind)} ${i + 1}">×</button></div>`).join('')}${opening ? `<div class="property-fields">${select('opening-kind', 'Selected item', opening.kind, [['void', 'Opening / void'], ['light', 'Light'], ['diffuser', 'Diffuser']])}${field('opening-x', 'X from origin', fmtFtIn(opening.x))}${field('opening-y', 'Y from origin', fmtFtIn(opening.y))}${field('opening-width', 'Width', fmtFtIn(opening.width))}${field('opening-depth', 'Depth', fmtFtIn(opening.depth))}</div>` : '<p class="property-hint">Click an item in the plan or this list to edit its size and position.</p>'}</section>`;
    $('#properties').innerHTML = html;
}
function renderResults() {
    if (prefs.result === 'checks') { $('#results').innerHTML = `<ul class="check-list">${plan.issues.map(i => `<li><span class="check-label ${i.severity === 'error' ? 'error' : ''}">${i.severity === 'error' ? 'FIX INPUT' : 'TO RESOLVE'}</span><span>${esc(i.message)}</span></li>`).join('')}</ul>`; return; }
    const typePicker=q=>{ const group=typeGroup(q.role,current().mode); return group ? `<select data-type-group="${group}" aria-label="Type for ${esc(q.mark)}"><option value="">Select type…</option>${TYPE_OPTIONS[group].map(([key,name])=>`<option value="${esc(key)}" ${q.typeSelection?.key===key?'selected':''}>${esc(name)}</option>`).join('')}</select>` : '<span class="muted">—</span>'; };
    $('#results').innerHTML = `<table><thead><tr><th>Mark</th><th>Description</th><th>Type</th><th class="num">Pieces</th><th class="num">Length</th><th class="num">Total LF</th></tr></thead><tbody>${plan.quantities.map(q => `<tr><td>${esc(q.mark)}</td><td>${esc(q.description)}${q.role === 'panel' ? `<span class="muted"> · ${q.full} full / ${q.cut} cut</span>` : ''}</td><td>${typePicker(q)}</td><td class="num">${q.quantity}</td><td class="num">${q.lengthIn ? fmtFtIn(q.lengthIn) : '—'}</td><td class="num">${q.totalLengthFt != null ? q.totalLengthFt.toFixed(1) : '—'}</td></tr>`).join('')}</tbody></table><p class="result-note">Choose types here; matching member rows update together. Installed quantities exclude waste, hangers and bracing.</p>`;
}
function nextMark(p) { let n = 1; while (p.ceilings.some(c => c.mark.toLowerCase() === `c-${String(n).padStart(3, '0')}`)) n++; return `C-${String(n).padStart(3, '0')}`; }
function addOpening(kind) {
    const c = current(); if (!c) return;
    const size = kind === 'void' ? 36 : 24, b = bounds(c.outline), candidates = plan.panels.filter(p => !p.cut).map(p => [p.x, p.y]);
    for (let x = b.minX + 12; x + size <= b.maxX; x += 24) for (let y = b.minY + 12; y + size <= b.maxY; y += 24) if (candidates.length < 250) candidates.push([x, y]);
    for (const [x, y] of candidates) {
        const o = { id: uid(), kind, x, y, width: size, depth: size }, candidate = { ...c, openings: [...c.openings, o] };
        if (!resolveCeilingPlan(candidate).issues.some(i => i.severity === 'error')) { selectedOpening = o.id; edit(c => c.openings.push(o)); return; }
    }
    notice('No clear area fits this item. Adjust the footprint or existing openings first.');
}
document.addEventListener('change', event => {
    if (event.target.dataset.typeGroup) { const group=event.target.dataset.typeGroup, value=event.target.value; edit(c=>{c.typeSelections={...c.typeSelections,[group]:value};}); return; }
    if (event.target.id==='sketch-kind') { sketch.kind=event.target.value; sketch.setTool('opening'); return; }
    if (event.target.id==='sketch-snap') { sketch.step=Number(event.target.value); sketch.paint(); return; }
    const id = event.target.dataset.field; if (!id) return;
    sketch.reset();
    const value = event.target.value, stringFields = ['project-name', 'ceiling-mark', 'mode', 'shape', 'opening-kind'];
    const parsed = stringFields.includes(id) ? value.trim() : ['tile', 'direction'].includes(id) ? Number(value) : parseDimension(value);
    if (!stringFields.includes(id) && !Number.isFinite(parsed)) { notice('Enter a valid feet-and-inches length, such as 10\'-6".'); render(); return; }
    edit((c, p) => {
        const map = { length: 'lengthIn', depth: 'depthIn', 'notch-width': 'notchWidthIn', 'notch-depth': 'notchDepthIn', elevation: 'elevationIn' };
        if (id === 'project-name') p.name = parsed;
        else if (id === 'ceiling-mark') c.mark = parsed;
        else if (id === 'mode' || id === 'shape') c[id] = parsed;
        else if (map[id]) c[map[id]] = parsed;
        else if (id.startsWith('opening-')) { const o = c.openings.find(o => o.id === selectedOpening); if (o) o[id.slice(8)] = parsed; }
        else { const settingsMap = { tile: 'tileDepthIn', direction: 'direction', 'origin-x': 'originX', 'origin-y': 'originY', 'joist-spacing': 'joistSpacingIn' }; c.settings[settingsMap[id]] = parsed; }
        if (['shape', 'length', 'depth', 'notch-width', 'notch-depth'].includes(id) && c.shape !== 'custom') {
            if (c.notchWidthIn >= c.lengthIn || c.notchDepthIn >= c.depthIn) { c.notchWidthIn = c.lengthIn / 2; c.notchDepthIn = c.depthIn / 2; }
            c.outline = footprint(c.shape, c.lengthIn, c.depthIn, c.notchWidthIn, c.notchDepthIn);
        }
    });
});
document.addEventListener('click', event => {
    if (event.target.closest('#preview') && !event.target.closest('button')) return;
    const t = event.target.closest('button,a,[data-opening]');
    if(t?.hasAttribute('data-sketch-fit')){sketch.fit();return;}
    if (t?.dataset.sketchTool) { selectedOpening=null; sketch.setTool(t.dataset.sketchTool); return; }
    if (t?.dataset.ceiling) { project.currentId = t.dataset.ceiling; selectedOpening = null; sketch.reset(); persist(); render(); return; }
    if (t?.dataset.view) { prefs.view = t.dataset.view; sketch.reset(); savePrefs(); render(); return; }
    if (t?.dataset.result) { prefs.result = t.dataset.result; savePrefs(); renderResults(); document.querySelectorAll('[data-result]').forEach(b => { b.setAttribute('aria-selected', String(b === t)); b.tabIndex = b === t ? 0 : -1; }); $('#results').setAttribute('aria-labelledby', t.id); return; }
    if (t?.dataset.selectOpening || t?.dataset.opening) { selectedOpening = t.dataset.selectOpening || t.dataset.opening; render(); return; }
    if (t?.dataset.removeOpening) { edit(c => { c.openings = c.openings.filter(o => o.id !== t.dataset.removeOpening); }); return; }
    if (t?.dataset.addOpening) { addOpening(t.dataset.addOpening); return; }
    const action = t?.dataset.action;
    if (action === 'new') { selectedOpening = null; sketch.reset(); commit(p => { if (p.ceilings.length >= 50) throw Error('Use up to 50 ceilings per project.'); const c = newCeiling(uid(), nextMark(p), current()?.mode || 'grid'); p.ceilings.push(c); p.currentId = c.id; }); }
    else if (action === 'duplicate') { selectedOpening = null; commit(p => { const c = structuredClone(current()); c.id = uid(); c.mark = nextMark(p); c.openings.forEach(o => { o.id = uid(); }); p.ceilings.push(c); p.currentId = c.id; }); }
    else if (action === 'delete') { sketch.reset(); commit(p => { p.ceilings = p.ceilings.filter(c => c.id !== p.currentId); p.currentId = p.ceilings[0]?.id || null; }); }
    else if (action === 'undo' || action === 'redo') history(action);
    else if (action === 'save') { download(`${safeName(project.name)}.ceiling-project.json`, JSON.stringify(project, null, 2), 'application/json'); fileDirty = false; persist(); notice('Project downloaded. Import it to continue on another browser.'); }
    else if (action === 'import') $('#import-file').click();
    else if (action === 'layout') download(`${safeName(project.name)}.ceiling-layout.json`, JSON.stringify(planSet(project), null, 2), 'application/json');
    else if (action === 'csv') download(`${safeName(current().mark)}-quantities.csv`, '\ufeff' + quantitiesCsv(plan), 'text/csv;charset=utf-8');
    else if (action === 'pdf') download(`${safeName(current().mark)}-ceiling.pdf`, ceilingPdf(plan, project.name), 'application/pdf');
    else if (action === 'balance') edit(c => { const b = bounds(c.outline), s = c.settings, ux = c.mode === 'hardlid' ? s.joistSpacingIn : s.direction === 0 ? 24 : s.tileDepthIn, vy = c.mode === 'hardlid' ? s.joistSpacingIn : s.direction === 0 ? s.tileDepthIn : 24; const offset = (size, spacing) => { const rem = size % spacing; return (rem < .01 ? spacing : rem + spacing) / 2; }; s.originX = b.minX + offset(b.maxX - b.minX, ux); s.originY = b.minY + offset(b.maxY - b.minY, vy); });
    else if (action === 'reset-boundary') { sketch.reset(); edit(c => { c.shape = 'rectangle'; c.outline = footprint('rectangle', c.lengthIn, c.depthIn); }); }
    else if (action === 'boundary') { if (sketch.tool==='boundary') sketch.finish(); else { selectedOpening=null; sketch.setTool('boundary'); } }
});
function savePrefs() { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* Presentation preferences are optional. */ } }
function history(action) { const from = action === 'undo' ? undo : redo, to = action === 'undo' ? redo : undo; if (!from.length) return; to.push(JSON.stringify(project)); project = readProject(from.pop()); selectedOpening = null; sketch.reset(); fileDirty = true; persist(); render(); }
document.addEventListener('keydown', event => {
    if (sketch.key(event)) return;
    const typing = event.target.closest('input,select,textarea');
    if (event.target.matches('[role=tab]') && ['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const tabs = [...event.target.parentElement.querySelectorAll('[role=tab]')], at = tabs.indexOf(event.target), next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length; tabs[next].click(); tabs[next].focus(); return; }
    if (event.target.dataset.opening && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selectedOpening = event.target.dataset.opening; render(); return; }
    if (typing) return;
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); history(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo'); }
});
$('#import-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try { if (file.size > 2_000_000) throw Error('Use a ceiling project file smaller than 2 MB.'); const imported = readProject(await file.text()); undo.push(JSON.stringify(project)); redo = []; project = imported; selectedOpening = null; sketch.reset(); fileDirty = false; persist(); render(); notice(`Imported ${project.ceilings.length} ceiling(s). Undo restores the previous project.`); }
    catch (e) { notice(e.message); }
});
sketch = new CeilingSketch({ root:$('#preview'), ceiling:current, selected:()=>selectedOpening,
    select:id=>{selectedOpening=id;render();}, patch:patch=>edit(c=>Object.assign(c,patch)),
    opening:o=>{const previous=selectedOpening;selectedOpening=o.id;const ok=edit(c=>{const i=c.openings.findIndex(v=>v.id===o.id);if(i<0)c.openings.push(o);else c.openings[i]=o;});if(!ok)selectedOpening=previous;return ok;},
    notice, refresh:()=>{prefs.view='layout';render();}, format:fmtFtIn, parse:parseDimension });
render(); if (startupNotice) notice(startupNotice);
