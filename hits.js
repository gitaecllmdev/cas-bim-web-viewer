// Site views, shown at the bottom of the home page and in the Panel Shop Generator's title bar. A browser counts one view per 30 minutes, so reloads and moving
// between pages don't count again. The count is kept by the local server (/api/hits) or, on the review site, by the
// token Worker (/hits, in its KV store; see deploy/cloudflare-worker/). Stored: a count, times, and the approximate
// place (city, region, country) of the last 25 visits; never an IP address. When the service isn't there (or not set
// up yet), nothing is shown.
import { CONFIG } from './config.js';

const KEY = 'drywall-demos:visit'; // this browser's last counted view: { at, previous }
const GAP = 30 * 60 * 1000;
const endpoint = () => (CONFIG.mode === 'static' ? CONFIG.hitsUrl || '' : 'api/hits');
const valid = (h) => (h && Number.isFinite(h.views) ? h : null);
const mine = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

// Every page calls this once: counts a view unless this browser was counted in the last 30 minutes.
export async function countVisit() {
    const url = endpoint(), last = mine();
    if (!url || (last && Date.now() - Date.parse(last.at) < GAP)) return null;
    try {
        const resp = await fetch(url, { method: 'POST' });
        const hits = resp.ok ? valid(await resp.json()) : null;
        if (!hits) return null;
        try { localStorage.setItem(KEY, JSON.stringify({ at: new Date().toISOString(), previous: hits.previous || null })); } catch { /* storage blocked */ }
        return hits;
    } catch {
        return null;
    }
}

// For the footer: { views, since, previous, visits } where previous is the visit before this browser's latest one and
// visits the last ones with their places ({ at, place }, newest first); null when there is no count to show.
export async function siteHits() {
    let hits = await countVisit();
    const last = mine();
    if (!hits) {
        const url = endpoint();
        if (!url || !last) return null; // never counted here: the service is missing or not set up
        try {
            const resp = await fetch(url);
            hits = resp.ok ? valid(await resp.json()) : null;
        } catch {
            hits = null;
        }
    }
    return hits && { views: hits.views, since: hits.since || null, previous: last ? last.previous : hits.previous || null,
        visits: Array.isArray(hits.visits) ? hits.visits : [] };
}

// The count drawn in el (shown once there is one): "N views since …", the visit before this browser's, and on a click
// where the last visits came from (city, region, country; no IP address is kept), in the viewer's own time zone.
// compact: the count alone, the rest in a panel under it (a title bar).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const ago = (iso) => {
    const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
export function mountHits(el, h, { compact = false } = {}) {
    if (!el || !h) return;
    const count = `👁 <b>${h.views.toLocaleString()}</b> ${h.views === 1 ? 'view' : 'views'}${h.since && !compact ? ` since ${esc(new Date(h.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}` : ''}`;
    const visits = (h.visits || []).filter(v => v && v.at);
    const previous = `<span class="hits-prev">Last visit before yours: ${h.previous ? `<b>${esc(when(h.previous))}</b> <span class="muted">(${ago(h.previous)})</span>` : 'none yet, you are the first'}</span>`;
    const list = visits.length ? `<h3>Last ${visits.length} ${visits.length === 1 ? 'visit' : 'visits'}</h3><ol>${visits.map(v => `<li><span>${esc(when(v.at))} <span class="muted">(${ago(v.at)})</span></span><b>${esc(v.place || 'Unknown')}</b></li>`).join('')}</ol>
        <p class="muted">Approximate place from the visitor's connection. A browser counts once per 30 minutes; no IP address is kept.</p>` : '';
    const more = compact ? `${h.since ? `<p>Counting since <b>${esc(new Date(h.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}</b></p>` : ''}<p>${previous}</p>${list}` : list;
    el.innerHTML = `${more ? `<button type="button" class="hits-toggle" aria-expanded="false" title="${compact ? 'Views of this site: who came, when, from where' : 'Show where the last visits came from'}">${count} ▾</button>` : `<span title="A browser counts once per 30 minutes">${count}</span>`}
        ${compact ? '' : previous}${more ? `<div class="hits-visits" hidden>${more}</div>` : ''}`;
    const toggle = el.querySelector('.hits-toggle'), panel = el.querySelector('.hits-visits');
    if (toggle) toggle.onclick = () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); toggle.innerHTML = `${count} ${panel.hidden ? '▾' : '▴'}`; };
    if (compact) document.addEventListener('click', (e) => { if (panel && !panel.hidden && !el.contains(e.target)) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.innerHTML = `${count} ▾`; } });
    el.hidden = false;
}
