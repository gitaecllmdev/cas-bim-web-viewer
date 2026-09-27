// App shell: pick a demo (?demo=NN-name) and a model (#urn), load the demo's extension.
// The 3D model and a 2D plan/sheet show side by side (?layout=3d|split|2d); see views.js.
import { initViewer, loadModel } from './viewer.js';
import { fetchJson, onModelReady } from './helpers.js';
import { CONFIG } from './config.js';
import { Views } from './views.js';
import { TOOLS_EXTENSION_ID } from './tools.js';

// ?dock=bottom: the panel goes under the viewers (the takeoff link uses it for its tables).
if (new URLSearchParams(location.search).get('dock') === 'bottom') document.body.classList.add('dock-bottom');

const demoSelect = document.getElementById('demos');
const modelSelect = document.getElementById('models');
const panel = document.getElementById('panel');

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
    viewer.loadExtension(TOOLS_EXTENSION_ID, { views, is3d: true });
    views.use2d(TOOLS_EXTENSION_ID, { views, is3d: false });
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
    await setupModelSelection(location.hash.substring(1));
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
