// Panel shop gallery (panels.html): every panel saved by Demo 6, as cards with a thumbnail. One click opens the shop
// drawing (panel.html). Reads the 'shop-panel-index' state through loadState (local server, shared store, or the
// panels published with the review site).
import { loadState, escapeHtml } from './helpers.js';
import { fmtFtIn } from './demos/common/framing.mjs';
import { INDEX_STATE, sortPanels, entryLayout, thumbnailSvg, openingsOf, openingsText, PANEL_TYPES } from './demos/06-shop-drawings/panels.mjs';

const gallery = document.getElementById('gallery');
const search = document.getElementById('search');
const levelSelect = document.getElementById('level');
const count = document.getElementById('count');
const orderSelect = document.getElementById('order');
const openingsOnly = document.getElementById('openings-only');
const typeSelect = document.getElementById('type');
const params = new URLSearchParams(location.search);

let panels = [];

start().catch(err => { gallery.innerHTML = `<p class="warn">Could not load the panels: ${escapeHtml(err.message || err)}</p>`; });

async function start() {
    const index = await loadState(INDEX_STATE).catch(() => ({}));
    panels = Object.values(index.panels || {});
    if (!panels.length) {
        gallery.innerHTML = `<section class="card"><h2>No panel shops yet</h2>
            <p>Open the <a href="index.html?demo=06-shop-drawings">3D viewer</a>, pick a wall in <b>Framing Shop Drawings</b>, and its shop drawing is added here.</p></section>`;
        return;
    }
    const levels = [...new Set(panels.map(p => p.level).filter(Boolean))];
    levelSelect.innerHTML = '<option value="">All levels</option>' + levels.map(l => `<option ${l === params.get('level') ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('');
    const counts = new Map();
    for (const p of panels) for (const t of p.types || []) counts.set(t, (counts.get(t) || 0) + 1);
    typeSelect.innerHTML = `<option value="">All panel types (${counts.size})</option>`
        + PANEL_TYPES.filter(t => counts.has(t)).map(t => `<option ${t === params.get('type') ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
    typeSelect.onchange = () => { if (typeSelect.value === 'Plain wall') openingsOnly.checked = false; remember(); render(); };
    search.value = params.get('q') || '';
    orderSelect.value = params.get('order') === 'level' ? 'level' : 'complex';
    openingsOnly.checked = params.get('all') !== '1'; // the panels with openings are the ones worth showing
    search.oninput = levelSelect.onchange = orderSelect.onchange = openingsOnly.onchange = () => { remember(); render(); };
    render();
}

// Keep the filter in the URL, so a filtered list can be sent as a link too.
function remember() {
    const p = new URLSearchParams();
    if (search.value.trim()) p.set('q', search.value.trim());
    if (levelSelect.value) p.set('level', levelSelect.value);
    if (orderSelect.value === 'level') p.set('order', 'level');
    if (!openingsOnly.checked) p.set('all', '1');
    if (typeSelect.value) p.set('type', typeSelect.value);
    history.replaceState(null, '', `${location.pathname}${p.toString() ? `?${p}` : ''}`);
}

function render() {
    const q = search.value.trim().toLowerCase(), level = levelSelect.value;
    const shown = sortPanels(panels, orderSelect.value).filter(p => (!level || p.level === level) && (!openingsOnly.checked || openingsOf(p) > 0)
        && (!typeSelect.value || (p.types || []).includes(typeSelect.value))
        && (!q || [p.mark, p.wallType, p.level, p.sideA, p.sideB].join(' ').toLowerCase().includes(q)));
    count.textContent = `${shown.length} of ${panels.length} panel${panels.length === 1 ? '' : 's'}`;
    gallery.innerHTML = shown.map(p => {
        let thumb = '';
        try { thumb = thumbnailSvg(entryLayout(p)); } catch { /* no thumbnail for an incomplete record */ }
        const rooms = [p.sideA, p.sideB].filter(r => r && r !== 'NO ROOM FOUND' && r !== '-').join(' / ');
        return `<a class="card panel-card" href="panel.html?p=${encodeURIComponent(p.key)}${orderSelect.value === 'level' ? '&order=level' : ''}">
            <div class="thumb">${thumb}</div>
            <div class="panel-mark">${escapeHtml(p.mark)}${p.flip ? ' <span class="muted">(side B)</span>' : ''}</div>
            <div class="muted">${escapeHtml(p.level)} · ${fmtFtIn(p.lengthIn)} × ${fmtFtIn(p.heightIn)}</div>
            <div class="openings ${openingsOf(p) ? '' : 'none'}">${escapeHtml(openingsText(p))}</div>
            ${p.issues ? `<div class="check-failed">Framing check failed (${p.issues}): do not release</div>` : ''}
            ${(p.types || []).length ? `<div class="chips">${p.types.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
            <div>${escapeHtml(p.wallType)}</div>
            ${rooms ? `<div class="muted">${escapeHtml(rooms)}</div>` : ''}
            <span class="open">Open shop drawing ›</span></a>`;
    }).join('') || `<p class="muted">No panel matches. Clear the search${openingsOnly.checked ? ', untick "With openings only"' : ''} or pick another level.</p>`;
}
