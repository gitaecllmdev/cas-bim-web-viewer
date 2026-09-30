// Takeoff report (takeoff.html): framing (studs, track, headers, sills, cripples by mark and cut length), board and
// finish, by level. Same math as Demo 2 (demos/02-takeoff/calc.mjs) on the walls Demo 2 saved from the model
// ('takeoff-snapshot'), the opening scans ('wall-openings'), the estimator's settings, assemblies and framing overrides
// by wall GUID ('takeoff'), and the engineer's criteria if this browser has loaded them ('takeoff-criteria').
// Changes made here (level, gauge, order lengths) are for viewing only and are not saved.
import { loadState, fetchJson, escapeHtml, downloadCsv, stateFor } from './helpers.js';
import { countVisit } from './hits.js';
import { takeoff, ROLES } from './demos/02-takeoff/calc.mjs';
import { fmtFtIn } from './demos/common/framing.mjs';

countVisit(); // the home page's view counter (hits.js)

const main = document.getElementById('takeoff-main');
const params = new URLSearchParams(location.search);
const ORDER_MODES = [['exact', 'Exact cut (1/8")'], ['half', 'Round up to 1/2"'], ['inch', 'Round up to 1"'], ['stock', 'Stock lengths (8\'-20\')']];
const GAUGES = [[18, '18 mil (25 ga)'], [30, '30 mil (20 ga EQ)'], [33, '33 mil (20 ga)'], [43, '43 mil (18 ga)'], [54, '54 mil (16 ga)']];
const fmt = (n, digits = 0) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const nat = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

let snapshot, rules, saved, criteria, walls, result;
const view = { level: params.get('level') || '', tab: params.get('tab') === 'types' ? 'types' : 'materials', settings: {}, expanded: new Set() };

start().catch(err => { main.innerHTML = `<p class="warn">Could not load the takeoff: ${escapeHtml(err.message || err)}</p>`; });

async function start() {
    // The site's model (helpers stateFor): the sample's plain names, or another model's own.
    [snapshot, rules, saved, criteria] = await Promise.all([loadState(await stateFor('takeoff-snapshot')).catch(() => ({})), fetchJson('samples/takeoff-rules.json'),
        loadState(await stateFor('takeoff')).catch(() => ({})), loadState(await stateFor('takeoff-criteria')).catch(() => ({}))]);
    if (!snapshot.walls?.length) {
        main.innerHTML = `<section class="card"><h2>No takeoff published yet</h2>
            <p>Open the <a href="index.html?demo=02-takeoff">3D takeoff</a> once on the local server, then publish the site.</p></section>`;
        return;
    }
    const scans = await loadState(await stateFor('wall-openings')).catch(() => ({}));
    walls = snapshot.walls.map(w => ({ ...w, scan: scans[w.externalId] }));
    view.settings = { ...(saved.settings || {}) };
    render();
}

function render() {
    const scope = view.level ? walls.filter(w => (w.level ?? 'Not set') === view.level) : walls;
    const ctx = { overrides: saved.elementOverrides || {},
        criteria: criteria?.rows?.length ? { rows: criteria.rows, group: criteria.group || '', building: criteria.building || '' } : null };
    result = takeoff(scope, rules, saved.overrides || {}, view.settings, ctx);
    const s = result.settings;
    const levels = [...new Set(walls.map(w => w.level).filter(Boolean))].sort(nat);
    main.innerHTML = `
        <section class="card">
            <div class="row" style="justify-content:space-between">
                <div><h2 style="margin:0">Framing &amp; finish takeoff</h2>
                    <span class="muted">${escapeHtml(snapshot.project || '')} · ${view.level ? escapeHtml(view.level) : 'all levels'} · ${fmt(scope.length)} walls ·
                    openings scanned for ${fmt(result.scannedWalls)} of ${fmt(result.framedWalls)} framed walls · model read ${escapeHtml(new Date(snapshot.savedAt).toLocaleDateString())}</span></div>
                <button data-csv>Download CSV</button>
            </div>
            <div class="row" style="margin-top:0.6em">
                <select data-level aria-label="Level"><option value="">All levels</option>${levels.map(l => `<option ${l === view.level ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
                <select data-set-num="mils" aria-label="Gauge">${GAUGES.map(([v, l]) => `<option value="${v}" ${v === s.mils ? 'selected' : ''}>${l}</option>`).join('')}</select>
                <select data-set-text="orderLengths" aria-label="Order studs at">${ORDER_MODES.map(([v, l]) => `<option value="${v}" ${v === s.orderLengths ? 'selected' : ''}>Order: ${l}</option>`).join('')}</select>
                <span class="tabs">${[['materials', 'Materials'], ['types', 'By wall type']].map(([k, l]) => `<button data-tab="${k}" class="${k === view.tab ? '' : 'secondary'}">${l}</button>`).join('')}</span>
            </div>
        </section>
        <section class="card">${view.tab === 'materials' ? materialsHtml() : typesHtml()}</section>
        <p class="muted">Estimate from the model and the assemblies set in the 3D takeoff, framed with the same layout as the shop drawings
            (studs cut 1/16" short, lengths rounded down to 1/8"). Jambs, headers, sills and cripples are counted for walls whose openings were scanned.
            Stud gauge per the framing engineer. Check before ordering.</p>`;
    main.querySelector('[data-level]').onchange = (e) => { view.level = e.target.value; remember(); render(); };
    main.querySelectorAll('[data-set-num]').forEach(el => el.onchange = () => { view.settings[el.dataset.setNum] = Number(el.value); render(); });
    main.querySelectorAll('[data-set-text]').forEach(el => el.onchange = () => { view.settings[el.dataset.setText] = el.value; render(); });
    main.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { view.tab = b.dataset.tab; remember(); render(); });
    main.querySelectorAll('[data-toggle]').forEach(tr => tr.onclick = () => {
        const k = tr.dataset.toggle;
        if (view.expanded.has(k)) view.expanded.delete(k); else view.expanded.add(k);
        render();
    });
    main.querySelector('[data-expand-all]')?.addEventListener('click', () => { result.materials.filter(m => m.marks).forEach(m => view.expanded.add(m.item)); render(); });
    main.querySelector('[data-csv]').onclick = exportCsv;
}

// Level and tab in the URL, so a view of the takeoff can be sent as a link.
function remember() {
    const p = new URLSearchParams();
    if (view.level) p.set('level', view.level);
    if (view.tab !== 'materials') p.set('tab', view.tab);
    history.replaceState(null, '', `${location.pathname}${p.toString() ? `?${p}` : ''}`);
}

function materialsHtml() {
    const groups = new Map();
    for (const m of result.materials) { if (!groups.has(m.group)) groups.set(m.group, []); groups.get(m.group).push(m); }
    return `<div class="row" style="justify-content:space-between"><span class="muted">Tap a stud or track line for its member schedule (mark, cut length, quantity).
            Marks: ${Object.entries(ROLES).map(([k, v]) => `<b>${k}</b> ${escapeHtml(v)}`).join(' · ')}.</span><button class="secondary" data-expand-all>Expand all</button></div>
        <table><thead><tr><th>Item</th><th class="num">Qty</th><th>Unit</th><th class="num"></th></tr></thead><tbody>
        ${[...groups].map(([group, items]) => `<tr><td colspan="4" style="background:#eef1f5;font-weight:600">${escapeHtml(group)}</td></tr>` + items.map(materialRow).join('')).join('')
        || '<tr><td colspan="4" class="muted">No framed walls on this level.</td></tr>'}
        </tbody></table>`;
}

function materialRow(m) {
    const cells = `<td class="num">${fmt(m.qty)}</td><td>${escapeHtml(m.unit)}</td><td class="num muted">${escapeHtml(m.extra || '')}</td>`;
    if (!m.marks) return `<tr><td style="padding-left:1em">${escapeHtml(m.item)}</td>${cells}</tr>`;
    const open = view.expanded.has(m.item);
    const head = `<tr data-toggle="${escapeHtml(m.item)}" style="cursor:pointer"><td>${open ? '▾' : '▸'} ${escapeHtml(m.item)}</td>${cells}</tr>`;
    if (!open) return head;
    const s = result.settings, isStud = m.kind === 'stud';
    const order = (e) => !isStud ? `cut from ${s.trackStockFt}' stock` : e.perPiece > 1 ? `${fmtFtIn(e.orderIn)} stock, ${e.perPiece} per piece`
        : e.orderIn === e.cutIn ? 'cut to length' : `order ${fmtFtIn(e.orderIn)}`;
    return head + `<tr><td colspan="4" style="padding:0"><table style="background:#fafafa;margin:0.2em 0 0.5em">
        <thead><tr><th>Mark</th><th>Member</th><th class="num">Cut length</th><th class="num">Qty</th><th>Order</th><th class="num">LF</th></tr></thead><tbody>
        ${m.marks.map(e => `<tr><td><b>${escapeHtml(e.mark)}</b></td><td>${escapeHtml(e.role)}</td><td class="num">${fmtFtIn(e.cutIn)}</td><td class="num">${fmt(e.qty)}</td>
            <td>${escapeHtml(order(e))}</td><td class="num muted">${fmt(e.lf)}</td></tr>`).join('')}</tbody></table></td></tr>`;
}

function typesHtml() {
    const rows = result.rows;
    const framed = rows.filter(r => r.asm.scope === 'framed');
    const total = (k) => framed.reduce((n, r) => n + r[k], 0);
    return `<div style="overflow-x:auto"><table><thead><tr><th>Wall type / assembly</th><th class="num">LF</th><th class="num">Openings</th><th class="num">Studs</th>
        <th class="num">Stud LF</th><th class="num">Track LF</th><th class="num">Board SF</th></tr></thead><tbody>
        ${rows.map(r => {
            const f = r.asm.scope === 'framed';
            return `<tr class="${f ? '' : 'muted'}"><td>${escapeHtml(r.typeName)} <span class="muted">(${r.count})</span><br><span class="muted">${escapeHtml(r.asm.label || '')}</span></td>
                <td class="num">${fmt(r.length)}</td><td class="num">${f ? fmt(r.openings) : '–'}</td><td class="num">${f ? fmt(r.studs) : '–'}</td>
                <td class="num">${f ? fmt(r.studLf) : '–'}</td><td class="num">${f ? fmt(r.trackLf) : '–'}</td><td class="num">${f ? fmt(r.boardSf + r.sheathingSf) : '–'}</td></tr>`;
        }).join('')}
        <tr style="font-weight:700"><td>Framed walls</td><td class="num">${fmt(total('length'))}</td><td class="num">${fmt(total('openings'))}</td><td class="num">${fmt(total('studs'))}</td>
            <td class="num">${fmt(total('studLf'))}</td><td class="num">${fmt(total('trackLf'))}</td><td class="num">${fmt(total('boardSf') + total('sheathingSf'))}</td></tr>
        </tbody></table></div>`;
}

function exportCsv() {
    const r = result, scope = view.level || 'All levels';
    downloadCsv(`takeoff${view.level ? `-${view.level.replace(/[^\w-]+/g, '_')}` : ''}.csv`, [
        [`Takeoff: framing, board & finish (${scope})`, snapshot.project || ''], [], ['Group', 'Item', 'Qty', 'Unit', 'Detail'],
        ...r.materials.map(m => [m.group, m.item, m.qty, m.unit, m.extra || '']), [],
        ['Mark', 'Member', 'Member type', 'Cut length', 'Cut length (in)', 'Qty', 'LF', 'Order length', 'Pieces per order length', 'Pieces to order'],
        ...r.schedule.map(e => [e.mark, e.role, e.type, fmtFtIn(e.cutIn), e.cutIn, e.qty, e.lf.toFixed(1), fmtFtIn(e.orderIn), e.perPiece, e.pieces]), [],
        ['Wall type', 'Assembly', 'Scope', 'Walls', 'Length (LF)', 'Studs', 'Track (LF)', 'Board (SF)'],
        ...r.rows.map(t => [t.typeName, t.asm.label || '', t.asm.scope, t.count, t.length.toFixed(1), t.studs, t.trackLf.toFixed(1), (t.boardSf + t.sheathingSf).toFixed(1)]),
    ]);
}
