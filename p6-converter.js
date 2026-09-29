// P6 Converter: a standalone tool (no model, no viewer code). Reads a P6 layout PDF in the browser, rebuilds the
// table (demos/common/p6-pdf.mjs), lets the user find rows by keywords (p6-keywords.mjs), check the ones to keep,
// edit cells, pick columns and download Excel or CSV (demos/common/table-export.mjs). Nothing leaves the browser;
// the only thing kept is this browser's keyword history (localStorage).
import { readSchedulePdf } from './demos/common/pdf-reader.mjs';
import { cellValue, exportRows } from './demos/common/p6-pdf.mjs';
import { csvText, xlsxBytes } from './demos/common/table-export.mjs';
import { parseKeywords, matchRows, keywordCounts, remember } from './p6-keywords.mjs';

const $ = id => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const HISTORY_KEY = 'p6-converter:keyword-history';
let data = null, keys = [], page = 0, controller = null, dirty = false;
let active = [];           // keywords in use (chips)
let history = [];          // every keyword used in this browser: [{ text, uses, at }]
const pageSize = 60;
try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { history = []; }
const saveHistory = () => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* storage blocked */ } };
const status = (message, error = false) => { $('status').textContent = message; $('status').className = error ? 'warn' : ''; };
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// One lower-case text per row (every column, WBS path included) for the keyword search; dropped when a cell is edited.
const texts = new WeakMap();
const rowText = (r) => {
    if (!texts.has(r)) texts.set(r, data.columns.map(c => String(cellValue(r, c.key))).join(' | ').toLowerCase().replace(/\s+/g, ' '));
    return texts.get(r);
};
const baseRows = () => data.rows.map((r, index) => ({ r, index })).filter(({ r }) => $('summaries').checked || r.kind === 'Activity');
// Keywords being typed count too, so matches show while typing.
const typed = () => parseKeywords($('kw').value).filter(k => !active.some(a => same(a, k)));
function shown() {
    const base = baseRows(), kws = [...active, ...typed()];
    const hits = matchRows(base.map(({ r }) => rowText(r)), kws, { all: $('kw-all').checked });
    return { rows: base.map((x, i) => ({ ...x, hits: hits[i] })).filter(x => x.hits), base, kws };
}
const selectedRows = () => data.rows.filter(r => r.include !== false && ($('summaries').checked || r.kind === 'Activity'));
// Download scope: every checked row, or only the checked rows the keywords show ("Filtered only").
const scope = () => document.querySelector('input[name=scope]:checked').value;
function exportSet(view = shown()) {
    return scope() === 'filtered' && view.kws.length ? new Set(view.rows.map(x => x.r)) : null;
}
const exportedRows = (view) => { const only = exportSet(view); return selectedRows().filter(r => !only || only.has(r)); };

function updateCounts(view) {
    const checked = selectedRows().length, total = baseRows().length, filtering = view.kws.length > 0;
    const inView = new Set(view.rows.map(x => x.r)), filtered = selectedRows().filter(r => inView.has(r)).length;
    // Filtered only needs keywords; without them the download is every checked row.
    document.querySelector('input[name=scope][value=filtered]').disabled = !filtering;
    if (!filtering && scope() === 'filtered') document.querySelector('input[name=scope][value=all]').checked = true;
    const only = exportSet(view), out = only ? filtered : checked;
    $('scope-all').textContent = `All checked (${checked.toLocaleString()})`;
    $('scope-filtered').textContent = filtering ? `Filtered only (${filtered.toLocaleString()})` : 'Filtered only';
    $('export-summary').textContent = `${out.toLocaleString()} rows × ${keys.length} of ${data.columns.length} columns will be downloaded${only ? ' (filtered by your keywords)' : ''}. Uncheck a column header to leave it out. Excel includes Metadata and Warnings sheets; dates and IDs are kept as text.`;
    $('checked-count').textContent = `${checked.toLocaleString()} of ${total.toLocaleString()} rows checked for export`;
    $('excel').disabled = $('csv').disabled = !keys.length || !out;
    const n = view.rows.length;
    for (const [id, label] of [['check-shown', '✓ Check shown'], ['uncheck-shown', '✗ Uncheck shown'], ['only-shown', 'Only shown']]) {
        $(id).textContent = filtering ? `${label} (${n.toLocaleString()})` : label;
        $(id).disabled = !filtering || !n;
    }
}

function renderKeywords(view) {
    const counts = keywordCounts(view.base.map(({ r }) => rowText(r)), view.kws);
    const chip = (k, cls, title) => `<span class="chip ${cls}" title="${esc(title)}"><b>${esc(k)}</b> <span class="n">${(counts.get(k) || 0).toLocaleString()}</span>${cls === 'on' ? `<button data-remove="${esc(k)}" aria-label="Remove keyword ${esc(k)}">×</button>` : ''}</span>`;
    $('kw-active').innerHTML = active.map(k => chip(k, 'on', 'Keyword in use: rows it matches')).join('')
        + typed().map(k => chip(k, 'typing', 'Being typed: press Enter to keep it')).join('');
    $('kw-active').querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { active = active.filter(k => !same(k, b.dataset.remove)); refresh(); });
    $('kw-clear').hidden = !active.length;
    // History: every keyword used before; click one to use it again.
    const past = history.filter(h => !active.some(a => same(a, h.text)));
    $('kw-history-row').hidden = !history.length;
    $('kw-history').innerHTML = past.map(h => `<span class="chip past"><button data-use="${esc(h.text)}" title="Use again (used ${h.uses}×, last ${esc(new Date(h.at).toLocaleString())})">${esc(h.text)}</button><button data-forget="${esc(h.text)}" aria-label="Forget ${esc(h.text)}">×</button></span>`).join('')
        || '<span class="muted">every keyword in history is in use</span>';
    $('kw-history').querySelectorAll('[data-use]').forEach(b => b.onclick = () => addKeywords([b.dataset.use]));
    $('kw-history').querySelectorAll('[data-forget]').forEach(b => b.onclick = () => { history = history.filter(h => !same(h.text, b.dataset.forget)); saveHistory(); refresh(); });
}

function addKeywords(list) {
    const fresh = list.filter(k => !active.some(a => same(a, k)));
    active = [...active, ...fresh];
    history = remember(history, list);
    saveHistory();
    page = 0;
    refresh();
}

// Export columns: the column header checkboxes and the "Choose export columns" list are the same setting.
function setColumn(key, on) {
    const want = new Set(keys);
    if (on) want.add(key); else want.delete(key);
    keys = data.columns.map(c => c.key).filter(k => want.has(k));
    renderColumns();
    refresh();
}
function renderColumns() {
    $('columns').innerHTML = data.columns.map(c => `<label><input type="checkbox" data-key="${esc(c.key)}" ${keys.includes(c.key) ? 'checked' : ''}> ${esc(c.label)}</label>`).join('');
    $('columns').querySelectorAll('input').forEach(input => input.onchange = () => setColumn(input.dataset.key, input.checked));
}

function refresh() {
    const view = shown();
    renderKeywords(view);
    const pages = Math.max(1, Math.ceil(view.rows.length / pageSize)); page = Math.min(page, pages - 1);
    const matched = view.kws.length > 0;
    const label = (k) => esc(data.columns.find(c => c.key === k).label);
    const cols = data.columns.map(c => c.key), off = (k) => (keys.includes(k) ? '' : ' off');
    $('preview').innerHTML = `<thead><tr><th>Include</th>${matched ? '<th>Matched</th>' : ''}${cols.map(k => `<th class="${off(k)}"><label title="Uncheck to leave this column out of the download"><input type="checkbox" data-col="${esc(k)}" ${keys.includes(k) ? 'checked' : ''}> ${label(k)}</label></th>`).join('')}</tr></thead><tbody>${
        view.rows.slice(page * pageSize, (page + 1) * pageSize).map(({ r, index, hits }) => `<tr class="${r.kind === 'Summary' ? 'summary' : ''} ${r.include === false ? 'excluded' : ''}">
            <td><input type="checkbox" data-row="${index}" aria-label="Include row ${index + 1}" ${r.include !== false ? 'checked' : ''}></td>
            ${matched ? `<td class="hits">${hits.map(h => `<span class="chip mini">${esc(h)}</span>`).join('')}</td>` : ''}
            ${cols.map(k => ['page', 'kind'].includes(k) ? `<td class="readonly${off(k)}">${esc(cellValue(r, k))}</td>`
                : `<td class="${k}${off(k)}"><input type="text" data-edit="${index}" data-key="${k}" aria-label="Row ${index + 1} ${label(k)}" value="${esc(cellValue(r, k))}" title="${esc(cellValue(r, k))}"></td>`).join('')}</tr>`).join('')
    }</tbody>`;
    $('preview').querySelectorAll('[data-edit]').forEach(input => input.oninput = () => {
        const row = data.rows[+input.dataset.edit], k = input.dataset.key;
        if (k === 'wbs') row.wbs = input.value; else row.cells[k] = input.value;
        texts.delete(row); dirty = true;
    });
    $('preview').querySelectorAll('[data-row]').forEach(input => input.onchange = () => { data.rows[+input.dataset.row].include = input.checked; dirty = true; refresh(); });
    $('preview').querySelectorAll('[data-col]').forEach(input => input.onchange = () => { setColumn(input.dataset.col, input.checked); });
    $('page-label').textContent = `Page ${page + 1} of ${pages} · ${view.rows.length.toLocaleString()} ${view.rows.length === 1 ? 'row' : 'rows'}${matched ? ` match${view.rows.length === 1 ? 'es' : ''} ${$('kw-all').checked ? 'every one of ' : ''}${view.kws.length} keyword${view.kws.length === 1 ? '' : 's'}` : ''}`;
    $('prev').disabled = page === 0; $('next').disabled = page + 1 >= pages;
    updateCounts(view);
}

$('pdf-file').onchange = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    if (dirty && !confirm('Replace the current preview? Download any edits you want to keep first.')) return;
    controller = new AbortController(); $('pdf-file').disabled = true; $('cancel').hidden = false; $('progress').hidden = false;
    try {
        const next = await readSchedulePdf(file, { signal: controller.signal, onProgress: (message, n, count) => { status(message); if (count) { $('progress').max = count; $('progress').value = n; } else $('progress').removeAttribute('value'); } });
        data = next; keys = data.columns.map(c => c.key); page = 0; dirty = true; $('kw').value = ''; $('summaries').checked = true;
        $('summary').textContent = `${file.name} · ${data.pages} pages · ${data.rows.filter(r => r.kind === 'Activity').length.toLocaleString()} activities`;
        $('warnings').innerHTML = data.warnings.map(w => `<li>${w.page ? `Page ${w.page}: ` : ''}${esc(w.message)}</li>`).join('');
        $('warning-count').textContent = `${data.warnings.length} import notes · review before using`;
        $('results').hidden = false; renderColumns(); refresh(); status('Ready. Find rows with keywords, check the ones you want, and download.');
    } catch (err) { status(err.name === 'AbortError' ? 'Import cancelled. The previous preview is unchanged.' : err.message, err.name !== 'AbortError'); }
    finally { controller = null; $('pdf-file').disabled = false; $('cancel').hidden = true; $('progress').hidden = true; }
};
$('cancel').onclick = () => controller?.abort();

// Keywords: typing shows matches right away; Enter (or Add keyword) keeps them as chips and in the history.
$('kw').oninput = () => { page = 0; refresh(); };
$('kw').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const list = parseKeywords($('kw').value); $('kw').value = ''; if (list.length) addKeywords(list); } };
$('kw-add').onclick = () => { const list = parseKeywords($('kw').value); $('kw').value = ''; if (list.length) addKeywords(list); $('kw').focus(); };
$('kw-all').onchange = () => { page = 0; refresh(); };
$('kw-clear').onclick = () => { active = []; page = 0; refresh(); };
$('kw-forget').onclick = () => { if (confirm('Forget every keyword used in this browser?')) { history = []; saveHistory(); refresh(); } };

// Check / uncheck: every row, or the rows the keywords show (on every page).
const setInclude = (rows, value) => { for (const r of rows) r.include = value; dirty = true; refresh(); };
$('check-all').onclick = () => setInclude(data.rows, true);
$('uncheck-all').onclick = () => setInclude(data.rows, false);
$('check-shown').onclick = () => setInclude(shown().rows.map(x => x.r), true);
$('uncheck-shown').onclick = () => setInclude(shown().rows.map(x => x.r), false);
$('only-shown').onclick = () => { const keep = new Set(shown().rows.map(x => x.r)); for (const r of data.rows) r.include = keep.has(r); dirty = true; refresh(); };

$('summaries').onchange = () => { page = 0; refresh(); };
document.querySelectorAll('input[name=scope]').forEach(r => r.onchange = () => refresh());
$('prev').onclick = () => { page--; refresh(); };
$('next').onclick = () => { page++; refresh(); };
$('all-columns').onclick = () => { keys = data.columns.map(c => c.key); renderColumns(); refresh(); };
$('no-columns').onclick = () => { keys = []; renderColumns(); refresh(); };

function download(bytes, extension, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type })), a = document.createElement('a');
    a.href = url; a.download = data.file.replace(/\.pdf$/i, '') + '-converted.' + extension; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    status(`Downloaded ${extension.toUpperCase()} with ${exportedRows(shown()).length.toLocaleString()} rows and ${keys.length} of ${data.columns.length} columns${exportSet() ? ' (filtered by keywords)' : ''}.`);
}
const rowsToDownload = () => exportRows(data, keys, { includeSummary: $('summaries').checked, only: exportSet() });
$('csv').onclick = () => { try { download(csvText(rowsToDownload()), 'csv', 'text/csv;charset=utf-8'); } catch (e) { status(e.message, true); } };
$('excel').onclick = () => { try {
    download(xlsxBytes([
        { name: 'Schedule', rows: rowsToDownload() },
        { name: 'Metadata', rows: [['Field', 'Value'], ['Source file', data.file], ['Pages', data.pages], ['Data date', data.dataDate], ['Exported rows', exportedRows(shown()).length],
            ['Rows', exportSet() ? 'Filtered only (checked rows the keywords show)' : 'All checked rows'], ['Columns', keys.map(k => data.columns.find(c => c.key === k).label).join(', ')],
            ['Keywords in use', active.join(', ')], ['Keyword match', $('kw-all').checked ? 'every keyword' : 'any keyword'],
            ['Exported at', new Date().toISOString()], ['Notes', 'Preview edits applied. Only checked rows are exported. Dates and identifiers are text. Only printed information is recovered.']] },
        { name: 'Warnings', rows: [['Source page', 'Import note'], ...data.warnings.map(w => [w.page || '', w.message])] },
    ]), 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
} catch (e) { status(e.message, true); } };
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
