// Revizto from the browser (Field QC's Send to Revizto): sign-in in a small window, the user's own tokens kept in this
// browser, and the Revizto calls through this site's backend (core/server/routes/revizto.js locally, the token Worker's
// /revizto/* on the review site), which holds the app's client secret. Revizto answers HTTP 200 with a result code;
// -21 / -22 (an invalid or expired token) refresh the token once and try again.
// Revizto API: https://developer.revizto.com/ · https://revizto.stoplight.io/docs/v5/kesbp2mz5c0yl-user-authentication
import { CONFIG } from './config.js';

const KEY = 'drywall-demos:revizto'; // { access_token, refresh_token, expiresAt }: this browser's sign-in
export const reviztoBase = () => (CONFIG.mode === 'static' ? `${String(CONFIG.tokenUrl || '').replace(/\/$/, '')}/revizto/` : new URL('api/revizto/', location.href).href);

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const write = (t) => { try { if (t) localStorage.setItem(KEY, JSON.stringify(t)); else localStorage.removeItem(KEY); } catch { /* storage blocked: signed in for this page only */ } memory = t; };
let memory = null;
const tokens = () => memory || read();
const keep = (t) => write({ access_token: t.access_token, refresh_token: t.refresh_token || tokens()?.refresh_token, expiresAt: Date.now() + (Number(t.expires_in) || 3600) * 1000 });

export const signedIn = () => !!tokens()?.access_token;
export const signOut = () => write(null);

// Is Revizto set up on the backend? { configured, region }
export async function reviztoStatus() {
    try { const r = await fetch(`${reviztoBase()}status`); return r.ok ? await r.json() : { configured: false }; } catch { return { configured: false }; }
}

// Sign in: Revizto's sign-in page in a small window (opened on a tap, so the iPad allows it); the backend hands the
// tokens back by window.postMessage, from its own origin only.
export function signIn() {
    return new Promise((resolve, reject) => {
        const base = reviztoBase(), from = new URL(base).origin;
        const win = window.open(`${base}login?origin=${encodeURIComponent(location.origin)}`, 'revizto-signin', 'width=520,height=720');
        if (!win) { reject(new Error('Allow pop-ups for this site to sign in to Revizto.')); return; }
        const done = (fn) => { window.removeEventListener('message', onMessage); clearInterval(watch); fn(); };
        const onMessage = (e) => {
            if (e.origin !== from || e.data?.type !== 'revizto-auth' || !e.data.tokens?.access_token) return;
            keep(e.data.tokens);
            done(resolve);
        };
        window.addEventListener('message', onMessage);
        const watch = setInterval(() => { if (win.closed && !signedIn()) done(() => reject(new Error('The Revizto sign-in window was closed.'))); }, 800);
    });
}

async function refresh() {
    const t = tokens();
    if (!t?.refresh_token) throw new Error('Sign in to Revizto again.');
    const r = await fetch(`${reviztoBase()}token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: t.refresh_token }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) { signOut(); throw new Error('Your Revizto sign-in has expired: sign in again.'); }
    keep(data);
}

// A Revizto v5 call: path ('user', 'project/<uuid>/issue-workflow/settings'...), query, or form (FormData: POST).
// Returns the response's data; throws with Revizto's message on a failing result code.
export async function revizto(path, { query = null, form = null } = {}, retried = false) {
    if (!signedIn()) throw new Error('Sign in to Revizto first.');
    if (tokens().expiresAt - Date.now() < 60000 && !retried) await refresh();
    const url = `${reviztoBase()}v5/${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
    const resp = await fetch(url, { method: form ? 'POST' : 'GET', headers: { Authorization: `Bearer ${tokens().access_token}`, Accept: 'application/json' }, body: form || undefined });
    const body = await resp.json().catch(() => ({}));
    if ((resp.status === 401 || body.result === -21 || body.result === -22) && !retried) { await refresh(); return revizto(path, { query, form }, true); }
    if (!resp.ok) throw new Error(body.error || body.message || `Revizto: HTTP ${resp.status}`);
    if (typeof body.result === 'number' && body.result !== 0 && !(path === 'comment/add' && body.result > 0)) throw new Error(`Revizto: ${body.message || `result ${body.result}`}`);
    return body.data;
}
