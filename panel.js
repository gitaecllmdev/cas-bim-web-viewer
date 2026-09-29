// Panel page: what the QR code on a framing shop drawing opens (panel.html?p=<wall externalId>).
// Shows the panel drawing (re-drawn from the saved layout inputs with the same code as Demo 6), the framing
// conditions, a links list at the top (paste Egnyte or other document links) and comments.
// Data: state 'shop-panel-<id>' (written by Demo 6 when the wall is picked) and 'panel-notes-<id>' (links, comments),
// through loadState/saveState: the local server, the Worker's shared store (CONFIG.stateUrl), or this browser.
import { loadState, saveState, escapeHtml, sharedStateOn } from './helpers.js';
import { countVisit } from './hits.js';
import { fmtFtIn } from './demos/common/framing.mjs';
import { renderSheet, renderSheetPdf } from './demos/06-shop-drawings/sheet.mjs';
import { INDEX_STATE, sortPanels, entryLayout } from './demos/06-shop-drawings/panels.mjs';

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

let record = null, notes = { links: [], comments: [] }, layout = null, info = null;

start().catch(err => { main.innerHTML = `<p class="warn">Could not open this panel: ${escapeHtml(err.message || err)}</p>`; });

async function start() {
    if (!/^[a-z0-9-]{1,64}$/.test(key)) return notFound('This link has no panel in it.');
    record = await loadState(`shop-panel-${key}`).catch(() => ({}));
    if (!record?.frame) return notFound('This panel has not been published yet. Pick the wall in the viewer (Demo 6) so its panel page is saved.');
    notes = { links: [], comments: [], ...(await loadState(notesName).catch(() => ({}))) };
    layout = entryLayout(record); // drawn from side B when it was flipped in the viewer
    info = { ...record.info, sheet: record.view?.sheet || 'auto', conditions: record.conditions || [], qrUrl: panelUrl(), logoHref: await dataUrl(LOGO_URL).catch(() => null) };
    document.title = `${record.mark} · CAS BIM Web Viewer`;
    document.getElementById('panel-title').textContent = `${record.mark} · ${record.info?.wallType || ''} · ${record.info?.level || ''}`;
    render();
    pager().catch(err => console.warn('Panel list not loaded:', err.message));
}

// Previous / All panels / Next in the header (gallery order: level, then mark); the arrow keys do the same.
async function pager() {
    const index = await loadState(INDEX_STATE).catch(() => ({}));
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
            <div class="row" style="justify-content:space-between">
                <div><h2 style="margin:0">${escapeHtml(record.mark)}: framing elevation</h2>
                    <span class="muted">${escapeHtml(record.info?.wallType || '')} · ${fmtFtIn(layout.lengthIn)} × ${fmtFtIn(layout.heightIn)} ·
                    ${layout.cutList.reduce((a, r) => a + r.qty, 0)} members · saved ${escapeHtml(when(record.savedAt))}</span></div>
                <div class="row"><a class="button secondary" href="${escapeHtml(open3d)}">Open in 3D</a><button data-pdf>Download PDF</button></div>
            </div>
            ${layout.issues?.length ? `<div class="check-failed" style="margin-top:0.6em">Framing check failed (${layout.issues.length}): do not release.
                ${layout.issues.slice(0, 6).map(i => escapeHtml(i.message)).join(' · ')}</div>`
                : '<div class="check-passed" style="margin-top:0.4em">✓ Framing check passed: no member through an opening, no crossing members, every opening framed.</div>'}
            <div class="sheet" style="margin-top:0.6em">${renderSheet(layout, info).replace(/width="[\d.]+in" height="[\d.]+in"/, 'width="100%"')}</div>
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

// Re-read before each change so two people adding notes at about the same time don't drop each other's.
async function update(change) {
    const latest = { links: [], comments: [], ...(await loadState(notesName).catch(() => ({}))) };
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
    const url = URL.createObjectURL(new Blob([renderSheetPdf(layout, info, logo)], { type: 'application/pdf' }));
    Object.assign(document.createElement('a'), { href: url, download: `shop-drawing-${record.mark}.pdf` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
