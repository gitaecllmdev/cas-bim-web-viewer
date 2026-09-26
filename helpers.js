// Shared helpers for demo extensions. Import these; don't copy them into demos.
// Viewer API reference: https://aps.autodesk.com/en/docs/viewer/v7/reference/
// URLs are relative so the same code runs on the local server and on the static review site.
import { CONFIG } from './config.js';

export async function fetchJson(url, options) {
    const resp = await fetch(url, options);
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || resp.statusText);
    return body;
}

// Demo state: server-side in data/<name>.json (core/server/routes/state.js), or on the static review
// site in the reviewer's own browser (localStorage), so each reviewer has their own copy.
// Panel pages and their links/comments (shop-panel-*, panel-notes-*) are shared through the Worker when the
// site is built with a state service (CONFIG.stateUrl, deploy/cloudflare-worker/ with a KV namespace).
const stateKey = (name) => `drywall-demos:${name}`;
export const isSharedState = (name) => /^(shop-panel|panel-notes)-[a-z0-9-]{1,80}$/.test(name);
export const sharedStateOn = () => CONFIG.mode !== 'static' || !!CONFIG.stateUrl;
const stateServiceUrl = (name) => `${CONFIG.stateUrl.replace(/\/$/, '')}/state/${name}`;
export async function loadState(name) {
    if (CONFIG.mode !== 'static') return fetchJson(`api/state/${name}`);
    if (CONFIG.stateUrl && isSharedState(name)) {
        const shared = await fetchJson(stateServiceUrl(name)).catch(err => { console.warn(`Shared state ${name}:`, err.message); return null; });
        if (shared && Object.keys(shared).length) return shared;
    }
    try {
        const saved = localStorage.getItem(stateKey(name));
        if (saved) return JSON.parse(saved);
    } catch { /* storage blocked: fall back to the starter data */ }
    return fetchJson(`samples/state/${name}.json`).catch(() => ({})); // starter data shipped with the site
}
export async function saveState(name, data) {
    if (CONFIG.mode !== 'static') {
        return fetchJson(`api/state/${name}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    }
    if (CONFIG.stateUrl && isSharedState(name)) {
        return fetchJson(stateServiceUrl(name), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    }
    try { localStorage.setItem(stateKey(name), JSON.stringify(data)); } catch (err) { throw new Error(`Browser storage is not available (${err.message})`); }
    return { ok: true };
}

// Property names for walls, levels, etc. Edit samples/property-map.json, not code.
export const loadPropertyMap = () => fetchJson('samples/property-map.json');

export function getObjectTree(model) {
    return new Promise((resolve, reject) => model.getObjectTree(resolve, reject));
}

export async function getLeafDbIds(model) {
    const tree = await getObjectTree(model);
    const leaves = [];
    tree.enumNodeChildren(tree.getRootId(), (dbId) => {
        if (tree.getChildCount(dbId) === 0) leaves.push(dbId);
    }, true);
    return leaves;
}

export function getBulkProperties(model, dbIds, propFilter) {
    return new Promise((resolve, reject) => model.getBulkProperties(dbIds, { propFilter }, resolve, reject));
}

// Value of a property by display name, or undefined if the object doesn't have it.
export function propValue(result, name) {
    return result.properties.find(p => p.displayName === name)?.displayValue;
}

// dbIds of walls, using the category rule in samples/property-map.json.
export async function findWalls(model, map) {
    const { property, value } = map.wallCategory;
    const results = await getBulkProperties(model, await getLeafDbIds(model), [property]);
    return results.filter(r => propValue(r, property) === value).map(r => r.dbId);
}

// Walls with the properties the demos use, one record per wall:
// { dbId, externalId, wallType, fireRating, level, length, area, lengthUnits, areaUnits }.
// A value is undefined when the wall doesn't have that property. `missing` lists the
// property-map keys that no wall has at all, so panels can say which name to fix.
export async function getWallData(model, map) {
    const keys = ['wallType', 'fireRating', 'level', 'length', 'area'];
    const names = keys.map(k => map[k]);
    // 'externalId' must be in propFilter, or results come back without it.
    const results = await getBulkProperties(model, await findWalls(model, map), [...names, 'externalId']);
    const walls = results.map(r => {
        const wall = { dbId: r.dbId, externalId: r.externalId };
        keys.forEach((key, i) => {
            const prop = r.properties.find(p => p.displayName === names[i]);
            const value = prop?.displayValue;
            wall[key] = value === '' || value === null ? undefined : value;
            if (key === 'length' || key === 'area') wall[`${key}Units`] = prop?.units;
        });
        return wall;
    });
    const missing = keys.filter(k => walls.length && walls.every(w => w[k] === undefined));
    return { walls, missing };
}

// Levels the walls are on, lowest first: { name, elevation, bottom, top }, where bottom/top are the
// viewer (world) z range of that storey, for a section box. Revit level "Elevation" is in model
// coordinates; getBoundingBox(true) vs getBoundingBox() gives the offset the viewer applied when it
// centered the model. Levels closer than minStory (e.g. split-level L1 blocks) share the storey above.
export async function getLevels(model, map, minStory = 8) {
    const walls = await getBulkProperties(model, await findWalls(model, map), ['Level']);
    const levelIds = [...new Set(walls.map(r => r.properties.find(p => p.displayName === 'Level')?.displayValue).filter(Number.isInteger))];
    if (!levelIds.length) return [];
    const levels = (await getBulkProperties(model, levelIds, ['Name', 'Elevation']))
        .map(r => ({ name: propValue(r, 'Name'), elevation: propValue(r, 'Elevation') }))
        .filter(l => l.name && Number.isFinite(l.elevation))
        .sort((a, b) => a.elevation - b.elevation);
    const world = model.getBoundingBox();
    const offsetZ = model.getBoundingBox(true).min.z - world.min.z;
    return levels.map(l => {
        const above = levels.find(o => o.elevation >= l.elevation + minStory);
        return { ...l, z: l.elevation - offsetZ, bottom: l.elevation - offsetZ - 0.5, top: above ? above.elevation - offsetZ - 0.1 : world.max.z };
    });
}

// Short label for a model property's units id (e.g. 'autodesk.unit.unit:squareFeet-1.0.1' -> 'ft²').
export function unitLabel(units) {
    if (!units) return '';
    const rules = [[/squareFeet/, 'ft²'], [/squareMeters/, 'm²'], [/squareInches/, 'in²'], [/feet/i, 'ft'],
        [/millimeters/, 'mm'], [/centimeters/, 'cm'], [/meters/, 'm'], [/inches/, 'in']];
    return rules.find(([re]) => re.test(units))?.[1] || '';
}

// Distinct colors for legends. More values than colors? Extra ones get generated hues.
const PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948',
    '#b07aa1', '#ff9da7', '#9c755f', '#17becf', '#bcbd22', '#1f77b4'];
export const NOT_SET_COLOR = '#bdbdbd';
export function paletteColor(i) {
    if (i < PALETTE.length) return PALETTE[i];
    const hue = Math.round((i * 137.508) % 360);
    return `hsl(${hue}, 60%, 50%)`;
}

// Hex color ('#e4572e') to the THREE.Vector4 that viewer.setThemingColor expects.
export function toThemingColor(hex) {
    const c = new THREE.Color(hex);
    return new THREE.Vector4(c.r, c.g, c.b, 1);
}

// Text for innerHTML. Model values (wall type names like 4 7/8" Partition) contain quotes.
export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// Download rows (arrays of values; the first row is the header) as a CSV file.
export function downloadCsv(filename, rows) {
    const cell = (v) => /[",\r\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
    const csv = rows.map(r => r.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Extra 3D viewables loaded only to show context around the main model (Demo 6 context mode), by BubbleNode guid.
// onModelReady and so the demos and views.setModel ignore them. BubbleNode.guid, Model.getDocumentNode:
//   https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/BubbleNode/ and .../reference/Viewing/Model/
const contextNodes = new Set();
export const markContextNode = (node) => contextNodes.add(node.guid());
export const isContextModel = (model) => contextNodes.has(model?.getDocumentNode?.()?.guid?.());

// Runs callback once the model's object tree (and so its properties) is available. Context models are skipped.
// Returns a function that removes the listener (call it from the extension's unload()).
export function onModelReady(viewer, callback) {
    const seen = new WeakSet();
    const run = (model) => { if (model && !seen.has(model) && !isContextModel(model)) { seen.add(model); callback(model); } };
    const handler = (ev) => run(ev.model);
    viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, handler);
    // A model may already be loaded (e.g. the extension was reloaded after a 2D/3D switch).
    viewer.model?.getObjectTree(() => run(viewer.model), () => {});
    return () => viewer.removeEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, handler);
}

// Placeholder shown by demos that haven't been built yet. Also a quick core check:
// it proves token, model loading and property queries all work end to end.
export function renderPlaceholder(viewer, panel, { title, readme }) {
    if (!panel) return;
    panel.innerHTML = `<div class="demo-panel"><h2>${title}</h2>
        <p class="muted">Not built yet. Spec: <a href="demos/${readme}" target="_blank">${readme}</a></p>
        <p id="core-check" class="muted">Waiting for a model…</p></div>`;
    onModelReady(viewer, async (model) => {
        const out = panel.querySelector('#core-check');
        try {
            const [map, leaves] = [await loadPropertyMap(), await getLeafDbIds(model)];
            const walls = await findWalls(model, map);
            out.innerHTML = `Core check: ${leaves.length} objects, ${walls.length} walls` +
                (walls.length ? '' : `<br><span class="warn">No walls matched "${map.wallCategory.property} = ${map.wallCategory.value}". Update samples/property-map.json.</span>`);
        } catch (err) {
            out.textContent = `Core check failed: ${err.message || err}`;
        }
    });
}
