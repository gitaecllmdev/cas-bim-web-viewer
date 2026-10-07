// "Review in Revizto": a concept of the web viewer and Revizto working as one. A button (an icon and its label) where
// a Revizto feature is doable with the right access (a Revizto+ license, an app registered once in Revizto's developer
// portal, each user signed in with their own Revizto account), and a window that shows what it would do: the Revizto
// issue it would make, field by field, and the Revizto API call that makes it possible. Nothing is sent: the live
// integration is shelved (core/client/revizto.js, core/server/routes/revizto.js, the Worker's /revizto/*).
// Revizto API: https://developer.revizto.com/ (Create issue, Add issue comments, Get issues, Get stamp templates).

const ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor"/>'
    + '<path d="M7 9.5h8.2l-2.2-2.2M17 14.5H8.8l2.2 2.2" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export const REVIZTO_NEEDS = ['A Revizto+ license (the Revizto API comes with it)', 'An app added once in Revizto\'s Developer portal by an account admin',
    'Each person signs in with their own Revizto account (Revizto\'s access rights apply)'];
export const REVIZTO_API = {
    create: { name: 'Create issue', url: 'https://revizto.stoplight.io/docs/v5/65353eda82f8a-create-issue' },
    comments: { name: 'Add issue comments (notes, photos, files, status)', url: 'https://revizto.stoplight.io/docs/v5/754c8883fad7a-add-issue-comments' },
    issues: { name: 'Get issues (status, links to open them)', url: 'https://developer.revizto.com/' },
    stamps: { name: 'Get stamp templates', url: 'https://revizto.stoplight.io/docs/v5/57527f16c5fb2-get-stamp-templates' },
};

// The button: the icon, its label, a small "concept" tag. attrs: the data attributes the page listens for.
export function reviztoButton(label = 'Review in Revizto', attrs = '', cls = '') {
    injectStyle();
    return `<button type="button" class="rzc-btn ${cls}" ${attrs} title="${esc(label)} (a concept: nothing is sent)">${ICON}<span>${esc(label)}</span><em>concept</em></button>`;
}

// The window. steps: what it would do, in order; cards: the Revizto issues it would make
// ({ code, color, statusColor, status, title, lines: [], image }); api: REVIZTO_API entries; needs: REVIZTO_NEEDS.
export function showReviztoConcept({ title = 'Review in Revizto', intro = '', steps = [], cards = [], more = 0, api = [], needs = REVIZTO_NEEDS } = {}) {
    injectStyle();
    document.querySelector('.rzc-modal')?.remove();
    const box = document.createElement('div');
    box.className = 'rzc-modal';
    box.innerHTML = `<div class="rzc-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header>${ICON}<b>${esc(title)}</b><span class="rzc-tag">concept: nothing is sent</span><button class="rzc-close" data-rzc-close aria-label="Close">✕</button></header>
        ${intro ? `<p class="rzc-intro">${esc(intro)}</p>` : ''}
        ${cards.length ? `<h4>In Revizto it would be</h4><div class="rzc-issues">${cards.map(c => `<div class="rzc-issue">
            ${c.image ? `<div class="rzc-pic" style="background-image:url('${esc(c.image)}')"></div>` : ''}
            <div class="rzc-body"><div class="rzc-head"><span class="rzc-stamp" style="--s:${esc(c.color)};--st:${esc(c.statusColor || '#d93025')}">${esc(c.code)}</span><b>${esc(c.title)}</b>
                <span class="rzc-status" style="--c:${esc(c.statusColor || '#d93025')}">${esc(c.status || 'Open')}</span></div>
                ${(c.lines || []).filter(Boolean).map(l => `<p>${esc(l)}</p>`).join('')}</div></div>`).join('')}
            ${more > 0 ? `<p class="rzc-more">… and ${more} more.</p>` : ''}</div>` : ''}
        ${steps.length ? `<h4>What it would do</h4><ol class="rzc-steps">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
        <h4>Doable with the right access</h4><ul class="rzc-needs">${needs.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
        ${api.length ? `<p class="rzc-api">Revizto API: ${api.map(a => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>`).join(' · ')}</p>` : ''}
        <button class="rzc-ok" data-rzc-close>Close</button></div>`;
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-rzc-close]')) box.remove(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { box.remove(); document.removeEventListener('keydown', esc); } });
    document.body.appendChild(box);
    box.querySelector('.rzc-ok').focus();
}

// The styles, once per page (the viewer and the panel pages alike); large and plain for the field.
function injectStyle() {
    if (document.getElementById('rzc-style')) return;
    const st = document.createElement('style');
    st.id = 'rzc-style';
    st.textContent = `
.rzc-btn { display: inline-flex; align-items: center; gap: 0.45em; min-height: 2.6em; padding: 0.3em 0.9em; border: 2px solid #0f766e; border-radius: 10px; background: #fff; color: #0f766e; font: inherit; font-weight: 700; cursor: pointer; }
.rzc-btn:hover { background: #ecfdf8; }
.rzc-btn em { font-style: normal; font-weight: 600; font-size: 0.72em; color: #0f766e; background: #ccfbef; border-radius: 999px; padding: 0.1em 0.55em; }
.rzc-btn.wide { width: 100%; justify-content: center; margin: 0.35em 0; }
.rzc-modal { position: fixed; inset: 0; z-index: 40; background: rgba(10, 16, 24, 0.55); display: grid; place-items: center; padding: 16px; }
.rzc-card { width: min(640px, 100%); max-height: calc(100vh - 32px); overflow: auto; background: #fff; border-radius: 14px; padding: 18px 20px 16px; font: 17px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111820; box-sizing: border-box; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3); }
.rzc-card header { display: flex; align-items: center; gap: 0.5em; color: #0f766e; }
.rzc-card header b { font-size: 1.25em; color: #111820; }
.rzc-tag { font-size: 0.75em; font-weight: 600; color: #0f766e; background: #ccfbef; border-radius: 999px; padding: 0.15em 0.6em; }
.rzc-close { margin-left: auto; border: 0; background: none; font-size: 1.3em; cursor: pointer; color: #4a5663; }
.rzc-intro { margin: 0.6em 0; }
.rzc-card h4 { margin: 1em 0 0.4em; font-size: 0.95em; text-transform: uppercase; letter-spacing: 0.4px; color: #4a5663; }
.rzc-issues { display: flex; flex-direction: column; gap: 0.5em; }
.rzc-issue { display: flex; gap: 0.7em; border: 1px solid #d5dbe2; border-left: 4px solid #0f766e; border-radius: 10px; padding: 0.6em; }
.rzc-pic { flex: none; width: 112px; height: 84px; border-radius: 6px; background: #e9edf2 center / cover no-repeat; }
.rzc-body { min-width: 0; flex: 1; }
.rzc-body p { margin: 0.15em 0 0; font-size: 0.85em; color: #33414f; overflow-wrap: anywhere; }
.rzc-head { display: flex; align-items: center; gap: 0.45em; flex-wrap: wrap; }
.rzc-stamp { display: inline-grid; place-items: center; width: 2em; height: 2em; border-radius: 50%; background: var(--s); border: 3px solid var(--st); box-shadow: 0 0 0 1.5px #fff; color: #fff; font: 800 0.75em Arial, sans-serif; }
.rzc-status { margin-left: auto; background: var(--c); color: #fff; border-radius: 999px; padding: 0.1em 0.6em; font-size: 0.8em; font-weight: 700; }
.rzc-more { margin: 0.2em 0 0; color: #4a5663; }
.rzc-steps, .rzc-needs { margin: 0; padding-left: 1.3em; }
.rzc-steps li, .rzc-needs li { margin: 0.25em 0; }
.rzc-api { font-size: 0.85em; color: #4a5663; margin: 0.8em 0 0; }
.rzc-api a { color: #0f5f8a; }
.rzc-ok { display: block; width: 100%; min-height: 2.8em; margin-top: 1em; border: 0; border-radius: 10px; background: #0f766e; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }`;
    document.head.appendChild(st);
}
