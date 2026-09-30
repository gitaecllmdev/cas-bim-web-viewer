// Site views, shown at the bottom of the home page. A browser counts one view per 30 minutes, so reloads and moving
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
