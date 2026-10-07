// App shell: pick a demo (?demo=NN-name) and a model (#urn), load the demo's extension.
// The 3D model and a 2D plan/sheet show side by side (?layout=3d|split|2d); see views.js.
import { initViewer, loadModel } from './viewer.js';
import { fetchJson, onModelReady } from './helpers.js';
import { CONFIG } from './config.js';
import { Views } from './views.js';
import { TOOLS_EXTENSION_ID } from './tools.js';
import { countVisit } from './hits.js';

countVisit(); // the home page's view counter (hits.js)

// ?dock=bottom: the panel goes under the viewers (the takeoff link uses it for its tables).
if (new URLSearchParams(location.search).get('dock') === 'bottom') document.body.classList.add('dock-bottom');

const demoSelect = document.getElementById('demos');
const modelSelect = document.getElementById('models');
let panel = document.getElementById('panel'); // a fresh one for each demo switched to in place (setupDemoSwitch)

const demos = await fetchJson('demos/demos.json');
const demoId = new URLSearchParams(location.search).get('demo');
const demo = demos.find(d => d.id === demoId) || demos[0];

demoSelect.innerHTML = demos.map(d => `<option value="${d.id}" ${d === demo ? 'selected' : ''}>${d.name}</option>`).join('');
demoSelect.onchange = () => {
    const params = new URLSearchParams(location.search);
    params.set('demo', demoSelect.value);
    location.href = `?${params}${location.hash}`;
};

// A review site published before its token service exists: the viewer can't start (it asks for a token right away),
// so say so. The panel pages (panel.html, the shop drawing QR codes) don't need the viewer and still work.
const offline = CONFIG.mode === 'static' && !CONFIG.tokenUrl;
const viewer = offline ? null : await initViewer(document.getElementById('preview'));
if (offline) {
    showNotification('<b>The 3D viewer is being connected on this review site.</b><br>'
        + 'Its viewer service isn\'t set up yet, so the model can\'t load here. The shop drawings and the takeoff are ready:'
        + '<div class="offline-links"><a href="panels.html">Panel shops</a><a href="takeoff.html">Takeoff</a><a href="home.html" class="secondary">Home</a></div>');
} else {
    const views = new Views(viewer);
    setupDockSplit(views);
    // The demo's own toolbar set (demos.json "toolbar"; tools.js): only the tools it uses.
    viewer.loadExtension(TOOLS_EXTENSION_ID, { views, is3d: true, toolbar: demo?.toolbar });
    views.use2d(TOOLS_EXTENSION_ID, { views, is3d: false, toolbar: demo?.toolbar });
    onModelReady(viewer, (model) => views.setModel(model).catch(err => console.error(err)));
    if (demo) {
        try {
            await import(`./demos/${demo.id}/extension.js`);
            await viewer.loadExtension(demo.extensionId, { panel, views });
        } catch (err) {
            showNotification(`Demo <em>${demo.name}</em> failed to load. See the browser console.`);
            console.error(err);
        }
    }
    setupDemoSwitch(viewer, views, demo);
    await setupModelSelection(location.hash.substring(1));
}

// A demo hands over to another in place (Install Progress ⇄ Panel Tracker): document.dispatchEvent(new CustomEvent(
// 'switch-demo', { detail: { id } })). The one unloads, the other loads on the same model, views and level, and the link
// follows (no page load). A demo with another toolbar set opens the usual way (a page load).
// Viewer3D.unloadExtension / loadExtension: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
function setupDemoSwitch(viewer, views, first) {
    let current = first, switching = false;
    const linkTo = (d) => { const params = new URLSearchParams(location.search); params.set('demo', d.id); return `?${params}${location.hash}`; };
    document.addEventListener('switch-demo', async (e) => {
        const next = demos.find(d => d.id === e.detail?.id);
        if (!next || next === current || switching) return;
        if (!current || JSON.stringify(next.toolbar) !== JSON.stringify(current.toolbar)) { location.href = linkTo(next); return; }
        switching = true;
        try {
            viewer.unloadExtension(current.extensionId);
            // A fresh panel element: nothing the last demo left listening on it reaches the next one.
            const fresh = panel.cloneNode(false);
            panel.replaceWith(fresh);
            panel = fresh;
            history.replaceState(null, '', linkTo(next));
            demoSelect.value = next.id;
            await import(`./demos/${next.id}/extension.js`);
            await viewer.loadExtension(next.extensionId, { panel, views });
            current = next;
        } catch (err) {
            console.error(err);
            location.href = linkTo(next); // start it afresh
        } finally {
            switching = false;
        }
    });
}

async function setupModelSelection(selectedUrn) {
    try {
        // Static review site: models come straight from samples/urns.json (already translated).
        const models = CONFIG.mode === 'static' ? await fetchJson('samples/urns.json') : await fetchJson('api/models');
        if (models.length === 0) {
            showNotification('No models yet. Translate a sample model once with <code>npm run translate</code> (see README), then reload.');
            return;
        }
        modelSelect.innerHTML = models.map(m => `<option value="${m.urn}" ${m.urn === selectedUrn ? 'selected' : ''}>${m.name}</option>`).join('');
        modelSelect.onchange = () => onModelSelected(modelSelect.value);
        onModelSelected(modelSelect.value);
    } catch (err) {
        showNotification(`Could not list models: ${err.message}`);
    }
}

async function onModelSelected(urn) {
    clearTimeout(window.onModelSelectedTimeout);
    location.hash = urn;
    try {
        const status = CONFIG.mode === 'static' ? { status: 'success' } : await fetchJson(`api/models/${urn}/status`);
        switch (status.status) {
            case 'n/a':
                showNotification('Model has not been translated.');
                break;
            case 'inprogress':
            case 'pending':
                showNotification(`Model is being translated (${status.progress})...`);
                window.onModelSelectedTimeout = setTimeout(onModelSelected, 5000, urn);
                break;
            case 'failed':
                showNotification(`Translation failed. <ul>${status.messages.map(m => `<li>${JSON.stringify(m)}</li>`).join('')}</ul>`);
                break;
            default:
                clearNotification();
                await loadModel(viewer, urn);
        }
    } catch (err) {
        showNotification(`Could not load model: ${err.message || JSON.stringify(err)}`);
        console.error(err);
    }
}

// ?dock=bottom: drag the bar between the viewers and the tables (arrow keys too; double-click resets). The split is a
// per-browser convenience, kept in localStorage. A panel can ask for the table to take most of the screen and back
// with document.dispatchEvent(new CustomEvent('dock-split', { detail: 'toggle' })) (the takeoff's ⤢ Table button).
function setupDockSplit(views) {
    const bar = document.getElementById('dock-split'), main = document.getElementById('main'), pane = document.getElementById('views');
    if (!bar || !document.body.classList.contains('dock-bottom')) return;
    const KEY = 'drywall-demos:dock-split', DEFAULT = 50, TABLE = 20;
    let pct = DEFAULT, frame = 0;
    const set = (value, save) => {
        pct = Math.min(85, Math.max(15, value));
        pane.style.flexBasis = `${pct}%`;
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; views.resize(); });
        if (save) { try { localStorage.setItem(KEY, String(pct)); } catch { /* storage blocked: not remembered */ } }
    };
    try { const saved = Number(localStorage.getItem(KEY)); if (saved) set(saved, false); } catch { /* storage blocked */ }
    const fromPointer = (ev) => { const r = main.getBoundingClientRect(); return ((ev.clientY - r.top) / r.height) * 100; };
    bar.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        bar.setPointerCapture(e.pointerId);
        document.body.classList.add('dragging-split');
        const move = (ev) => set(fromPointer(ev), false);
        const up = () => {
            bar.removeEventListener('pointermove', move);
            bar.removeEventListener('pointerup', up);
            bar.removeEventListener('pointercancel', up);
            document.body.classList.remove('dragging-split');
            set(pct, true);
        };
        bar.addEventListener('pointermove', move);
        bar.addEventListener('pointerup', up);
        bar.addEventListener('pointercancel', up);
    });
    bar.addEventListener('dblclick', () => set(DEFAULT, true));
    let before = DEFAULT; // the split to go back to after "table" mode
    document.addEventListener('dock-split', () => {
        if (pct > TABLE + 1) { before = pct; set(TABLE, true); } else set(before > TABLE + 1 ? before : DEFAULT, true);
    });
    bar.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        set(pct + (e.key === 'ArrowUp' ? -5 : 5), true);
    });
}

function showNotification(message) {
    const overlay = document.getElementById('overlay');
    overlay.innerHTML = `<div class="notification">${message}</div>`;
    overlay.style.display = 'flex';
}

function clearNotification() {
    const overlay = document.getElementById('overlay');
    overlay.innerHTML = '';
    overlay.style.display = 'none';
}
