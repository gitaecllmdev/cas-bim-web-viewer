// Panel page: what the QR code on a framing shop drawing opens (panel.html?p=<wall externalId>).
// Shows the panel drawing (re-drawn from the saved layout inputs with the same code as Demo 6), the framing
// conditions, a links list at the top (paste Egnyte or other document links) and comments.
// Data: state 'shop-panel-<id>' (written by Demo 6 when the wall is picked) and 'panel-notes-<id>' (links, comments,
// prefab lengths), through loadState/saveState: the local server, the Worker's shared store (CONFIG.stateUrl), or this browser.
// Prefab lengths: each cut-list mark's cut length, set in 1/8" steps (the table, or -/+ in the sheet's PREFAB LENGTH
// column); the sheet and its PDF show them, blue when longer than the drawn length, green when shorter (prefab.mjs).
// The prefab card puts the schedule beside the elevation: hover a row for its members, click to keep them highlighted;
// the members of a mark with a prefab length are blue / green there.
import { loadState, saveState, escapeHtml, sharedStateOn, stateFor } from './helpers.js';
import { countVisit } from './hits.js';
import { fmtFtIn } from './demos/common/framing.mjs';
import { renderSheet, renderSheetPdf, renderSheetRegion } from './demos/06-shop-drawings/sheet.mjs';
import { INDEX_STATE, sortPanels, entryLayout } from './demos/06-shop-drawings/panels.mjs';
import { prefabFor, prefabState, stepPrefab, fmtDelta, prefabStale } from './demos/06-shop-drawings/prefab.mjs';

countVisit(); // the home page's view counter (hits.js)

const LOGO_URL = 'demos/06-shop-drawings/cas-logo.png';
const key = (new URLSearchParams(location.search).get('p') || '').toLowerCase();
const main = document.getElementById('panel-main');
const notesName = `panel-notes-${key}`;

// Only http(s) links are kept and shown (no javascript:, data: and the like).
const safeUrl = (u) => {
    try { const x = new URL(String(u).trim()); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; }
};
const when = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString(); };
const panelUrl = () => `${location.origin}${location.pathname}?p=${encodeURIComponent(key)}`;

let record = null, notes = { links: [], comments: [], prefab: {} }, layout = null, info = null;
const emptyNotes = () => ({ links: [], comments: [], prefab: {} });
let pinned = null, hovered = null; // the prefab card's highlighted mark
// The sheet's inputs with this panel's prefab lengths; edit: the -/+ click areas (on screen, not in the PDF).
const sheetInfo = (edit = false) => ({ ...info, prefab: prefabFor(layout.cutList, notes.prefab), prefabEdit: edit });

// Prefab -/+ anywhere on the page (the table's buttons, the sheet's click areas), bound once.
main.addEventListener('click', (e) => {
    const step = e.target.closest?.('[data-prefab-step]'), reset = e.target.closest?.('[data-prefab-reset]'), row = e.target.closest?.('tr[data-mark]');
    if (step) { const [mark, n] = step.dataset.prefabStep.split('|'); stepMark(mark, Number(n)); }
    else if (reset) stepMark(reset.dataset.prefabReset, 0);
    else if (row) { pinned = pinned === row.dataset.mark ? null : row.dataset.mark; renderPrefab(); }
});
main.addEventListener('mouseover', (e) => {
    const row = e.target.closest?.('tr[data-mark]'), mark = row?.dataset.mark || null;
    if (mark !== hovered && (row || !e.target.closest?.('[data-prefab]'))) { hovered = mark; renderElevation(); }
});
main.addEventListener('mouseleave', () => { if (hovered) { hovered = null; renderElevation(); } });

start().catch(err => { main.innerHTML = `<p class="warn">Could not open this panel: ${escapeHtml(err.message || err)}</p>`; });

async function start() {
    if (!/^[a-z0-9-]{1,64}$/.test(key)) return notFound('This link has no panel in it.');
    record = await loadState(`shop-panel-${key}`).catch(() => ({}));
    if (!record?.frame) return notFound('This panel has not been published yet. Pick the wall in the viewer (Demo 6) so its panel page is saved.');
    notes = { ...emptyNotes(), ...(await loadState(notesName).catch(() => ({}))) };
    layout = entryLayout(record); // drawn from side B when it was flipped in the viewer
    info = { ...record.info, sheet: record.view?.sheet || 'auto', conditions: record.conditions || [], qrUrl: panelUrl(), logoHref: await dataUrl(LOGO_URL).catch(() => null), keyplan: record.keyplan || null };
    document.title = `${record.mark} · CAS BIM Web Viewer`;
    document.getElementById('panel-title').textContent = `${record.mark} · ${record.info?.wallType || ''} · ${record.info?.level || ''}`;
    render();
    pager().catch(err => console.warn('Panel list not loaded:', err.message));
}

// Previous / All panels / Next in the header (gallery order: level, then mark); the arrow keys do the same.
async function pager() {
    const index = await loadState(await stateFor(INDEX_STATE)).catch(() => ({}));
    const order = new URLSearchParams(location.search).get('order') === 'level' ? 'level' : 'complex';
    const list = sortPanels(Object.values(index.panels || {}), order);
    const i = list.findIndex(p => p.key === key);
    const href = (p) => (p ? `panel.html?p=${encodeURIComponent(p.key)}${order === 'level' ? '&order=level' : ''}` : '#');
    const prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
    const nav = document.createElement('nav');
    nav.className = 'pager';
    nav.setAttribute('aria-label', 'Panels');
    nav.innerHTML = `<a href="${href(prev)}" class="${prev ? '' : 'disabled'}" title="${escapeHtml(prev?.mark || '')}">‹ Previous</a>
        <a href="panels.html">All panels${i >= 0 ? ` (${i + 1} of ${list.length})` : ''}</a>
        <a href="${href(next)}" class="${next ? '' : 'disabled'}" title="${escapeHtml(next?.mark || '')}">Next ›</a>`;
    document.querySelector('.bar').appendChild(nav);
    document.addEventListener('keydown', (e) => {
        if (e.target.closest('input, textarea, select') || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === 'ArrowLeft' && prev) location.href = href(prev);
        if (e.key === 'ArrowRight' && next) location.href = href(next);
    });
}

function notFound(message) {
    main.innerHTML = `<section class="card"><h2>Panel not found</h2><p>${escapeHtml(message)}</p>
        <p><a class="button" href="panels.html">All panel shops</a> <a class="button secondary" href="index.html?demo=06-shop-drawings">Open the viewer</a></p></section>`;
}

function render() {
    const shared = sharedStateOn();
    const open3d = `index.html?demo=06-shop-drawings&layout=split&panel=${encodeURIComponent(key)}${record.urn ? `#${encodeURIComponent(record.urn)}` : ''}`;
    main.innerHTML = `
        <section class="card">
            <h2>Links</h2>
            <ul class="links" data-links>${notes.links.map((l, i) => `<li><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label || l.url)}</a>
                <span class="muted">${escapeHtml(when(l.at))}</span><button class="link" data-remove="${i}" title="Remove this link">✕</button></li>`).join('') || '<li class="muted">No links yet. Paste an Egnyte folder, a drawing set or an RFI below.</li>'}</ul>
            <form class="row" data-add-link>
                <input type="url" name="url" required placeholder="Paste a link (Egnyte, drawings, RFI…)" aria-label="Link URL">
                <input type="text" name="label" placeholder="Label (optional)" aria-label="Link label">
                <button>Add link</button>
            </form>
        </section>
        <section class="card">
            <h2>Prefab lengths <span class="muted">· ${escapeHtml(record.mark)}</span></h2>
            <p class="muted" style="margin:0 0 0.5em">Set a cut length in 1/8" steps to suit the real-world cut: <span class="prefab-delta more">blue longer</span>,
                <span class="prefab-delta less">green shorter</span> than the drawn length, on the sheet and the PDF too. Hover a row to see its members in the
                elevation; click it to keep them highlighted.</p>
            <div class="pe-grid"><div data-prefab>${prefabHtml()}</div><div class="pe-elev" data-elev>${elevationHtml()}</div></div>
        </section>
        <section class="card">
            <div class="row" style="justify-content:space-between">
                <div><h2 style="margin:0">${escapeHtml(record.mark)}: framing elevation</h2>
                    <span class="muted">${escapeHtml(record.info?.wallType || '')} · ${fmtFtIn(layout.lengthIn)} × ${fmtFtIn(layout.heightIn)} ·
                    ${layout.cutList.reduce((a, r) => a + r.qty, 0)} members · saved ${escapeHtml(when(record.savedAt))}</span></div>
                <div class="row"><a class="button secondary" href="${escapeHtml(open3d)}">Open in 3D</a><button data-pdf>Download PDF</button></div>
            </div>
            ${layout.issues?.length ? `<div class="check-failed" style="margin-top:0.6em">Framing check failed (${layout.issues.length}): do not release.
                ${layout.issues.slice(0, 6).map(i => escapeHtml(i.message)).join(' · ')}</div>`
                : '<div class="check-passed" style="margin-top:0.4em">✓ Framing check passed: no member through an opening, no crossing members, every opening framed.</div>'}
            <div class="sheet" data-sheet style="margin-top:0.6em">${sheetHtml()}</div>
        </section>
        ${info.conditions.length ? `<section class="card"><h2>Conditions <span class="muted">(from the model; verify in the field)</span></h2>
            <table class="conditions">${info.conditions.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table></section>` : ''}
        <section class="card">
            <h2>Comments</h2>
            <div data-comments>${notes.comments.map(c => `<div class="comment"><div class="who">${escapeHtml(c.by || 'Anonymous')} · ${escapeHtml(when(c.at))}</div>${escapeHtml(c.text)}</div>`).join('') || '<p class="muted">No comments yet.</p>'}</div>
            <form data-add-comment style="display:grid;gap:0.5em;margin-top:0.6em">
                <input type="text" name="by" placeholder="Your name" aria-label="Your name" value="${escapeHtml(rememberedName())}">
                <textarea name="text" required placeholder="Field note, question or issue for this panel" aria-label="Comment"></textarea>
                <div><button>Post comment</button></div>
            </form>
        </section>
        <p class="muted">${shared ? 'Links and comments are shared with everyone who opens this panel.'
            : 'Links and comments are saved in this browser only on this review site. Connect the shared store (deploy/cloudflare-worker/README.md) so the whole crew sees them.'}</p>`;
    main.querySelector('[data-add-link]').onsubmit = (e) => { e.preventDefault(); addLink(new FormData(e.target)); };
    main.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => removeLink(Number(b.dataset.remove)));
    main.querySelector('[data-add-comment]').onsubmit = (e) => { e.preventDefault(); addComment(new FormData(e.target)); };
    main.querySelector('[data-pdf]').onclick = () => downloadPdf();
}

const sheetHtml = () => renderSheet(layout, sheetInfo(true)).replace(/width="[\d.]+in" height="[\d.]+in"/, 'width="100%"');
// The elevation alone (sheet.mjs renderSheetRegion), the highlighted mark in orange, adjusted marks blue / green.
const elevationHtml = () => renderSheetRegion(layout, { ...sheetInfo(), highlight: hovered || pinned, prefabMembers: true }, 'elevation')
    .replace(/width="[\d.]+in" height="[\d.]+in"/, 'width="100%"');
const renderElevation = () => { const el = main.querySelector('[data-elev]'); if (el) el.innerHTML = elevationHtml(); };
function renderPrefab() {
    const box = main.querySelector('[data-prefab]');
    if (box) box.innerHTML = prefabHtml();
    renderElevation();
}

// The cut list with each mark's prefab length: -/+ 1/8", the change, and Reset (back to the drawn length).
function prefabHtml() {
    const set = prefabFor(layout.cutList, notes.prefab), stale = prefabStale(layout.cutList, notes.prefab);
    return `${stale.length ? `<p class="warn">Set against an earlier drawing of this panel, not applied: ${stale.map(p => `${escapeHtml(p.mark)} ${fmtFtIn(p.lengthIn)}${Number.isFinite(p.base) ? ` (drawn ${fmtFtIn(p.base)} then)` : ''}`).join(', ')}. Set them again if they still apply.</p>` : ''}
        <table class="prefab-table"><thead><tr><th>Label</th><th class="num">Qty</th><th>Member type</th><th class="num">Length</th><th>Prefab length</th><th></th></tr></thead><tbody>
        ${layout.cutList.map(r => {
            const v = set[r.mark], st = prefabState(r, v), m = escapeHtml(r.mark);
            return `<tr data-mark="${m}" class="${r.mark === pinned ? 'hi' : ''}" title="Hover to see the ${r.qty} ${m} members in the elevation; click to keep them highlighted"><td><b>${m}</b></td><td class="num">${r.qty}</td><td>${escapeHtml(r.type)} <b>${escapeHtml(r.func || '')}</b></td><td class="num">${fmtFtIn(r.lengthIn)}</td>
                <td class="prefab-cell"><button class="secondary" data-prefab-step="${m}|-1" title="${m}: 1/8&quot; shorter" aria-label="${m} one eighth inch shorter">−</button>
                    <span class="prefab-val ${st || ''}">${st ? fmtFtIn(v) : '<span class="muted">as drawn</span>'}</span>
                    <button class="secondary" data-prefab-step="${m}|1" title="${m}: 1/8&quot; longer" aria-label="${m} one eighth inch longer">+</button></td>
                <td>${st ? `<span class="prefab-delta ${st}">${fmtDelta(r, v)}</span> <button class="link" data-prefab-reset="${m}" title="Back to the drawn length">Reset</button>` : ''}</td></tr>`;
        }).join('')}</tbody></table>`;
}

// One prefab change at a time (fast clicks queue up), each on the latest saved notes so nobody's change is dropped.
let prefabQueue = Promise.resolve();
function stepMark(mark, steps) {
    const row = layout?.cutList.find(r => r.mark === mark);
    if (!row) return;
    prefabQueue = prefabQueue.then(async () => {
        const latest = { ...emptyNotes(), ...(await loadState(notesName).catch(() => ({}))) };
        latest.prefab = stepPrefab(latest.prefab, row, steps);
        await saveState(notesName, latest);
        notes = latest;
        renderPrefab();
        const sheet = main.querySelector('[data-sheet]');
        if (sheet) sheet.innerHTML = sheetHtml();
    }).catch(err => alert(`Prefab length not saved: ${err.message}`));
}

// Re-read before each change so two people adding notes at about the same time don't drop each other's.
async function update(change) {
    const latest = { ...emptyNotes(), ...(await loadState(notesName).catch(() => ({}))) };
    change(latest);
    await saveState(notesName, latest);
    notes = latest;
    render();
}

function addLink(form) {
    const url = safeUrl(form.get('url'));
    if (!url) { alert('Enter a full http:// or https:// link.'); return; }
    const label = String(form.get('label') || '').trim().slice(0, 120);
    update(n => n.links.push({ url, label, at: new Date().toISOString() })).catch(err => alert(`Link not saved: ${err.message}`));
}

function removeLink(i) {
    const target = notes.links[i];
    if (!target || !confirm(`Remove this link?\n${target.label || target.url}`)) return;
    update(n => { n.links = n.links.filter(l => !(l.url === target.url && l.at === target.at)); }).catch(err => alert(`Not saved: ${err.message}`));
}

function addComment(form) {
    const text = String(form.get('text') || '').trim().slice(0, 4000);
    if (!text) return;
    const by = String(form.get('by') || '').trim().slice(0, 80);
    try { localStorage.setItem('cas-panel-name', by); } catch { /* storage blocked */ }
    update(n => n.comments.push({ text, by, at: new Date().toISOString() })).catch(err => alert(`Comment not saved: ${err.message}`));
}

function rememberedName() {
    try { return localStorage.getItem('cas-panel-name') || ''; } catch { return ''; }
}

async function dataUrl(url) {
    const blob = await fetch(url).then(r => { if (!r.ok) throw new Error(r.statusText); return r.blob(); });
    return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
}

// Same PDF as Demo 6 (demos/06-shop-drawings/pdf.mjs); the logo goes in as JPEG, drawn on white.
async function downloadPdf() {
    let logo = null;
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
        logo = { jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
    } catch { /* PDF without the logo */ }
    const url = URL.createObjectURL(new Blob([renderSheetPdf(layout, sheetInfo(), logo)], { type: 'application/pdf' }));
    Object.assign(document.createElement('a'), { href: url, download: `shop-drawing-${record.mark}.pdf` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
