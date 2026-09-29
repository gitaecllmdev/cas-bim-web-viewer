import { readSchedulePdf } from './demos/common/pdf-reader.mjs';
import { cellValue, exportRows, scheduleRows } from './demos/common/p6-pdf.mjs';
import { csvText, xlsxBytes } from './demos/common/table-export.mjs';
import { scheduleFromRows, parseDateText } from './demos/03-progress/p6.mjs';
import { escapeHtml as esc, saveState } from './helpers.js';
const $ = id => document.getElementById(id);
let data = null, keys = [], page = 0, controller = null, dirty = false;
const pageSize = 60;
const status = (message, error = false) => { $('status').textContent = message; $('status').className = error ? 'warn' : ''; };
const selectedRows = () => data.rows.filter(r => r.include !== false && ($('summaries').checked || r.kind === 'Activity'));
function updateCounts() {
    $('export-summary').textContent = `${selectedRows().length.toLocaleString()} rows × ${keys.length} columns will be exported. Excel includes Metadata and Warnings sheets. Dates and IDs are preserved as text.`;
    $('excel').disabled = $('csv').disabled = !keys.length || !selectedRows().length;
}
function renderColumns() {
    $('columns').innerHTML = data.columns.map(c => `<label><input type="checkbox" data-key="${esc(c.key)}" ${keys.includes(c.key) ? 'checked' : ''}> ${esc(c.label)}</label>`).join('');
    $('columns').querySelectorAll('input').forEach(input => input.onchange = () => { keys = data.columns.map(c => c.key).filter(k => $('columns').querySelector(`[data-key="${k}"]`).checked); renderTable(); });
}
function renderTable() {
    const search = $('search').value.toLowerCase();
    const rows = data.rows.map((r, index) => ({ r, index })).filter(({ r }) => ($('summaries').checked || r.kind === 'Activity') && (!search || data.columns.some(c => String(cellValue(r, c.key)).toLowerCase().includes(search))));
    const pages = Math.max(1, Math.ceil(rows.length / pageSize)); page = Math.min(page, pages - 1);
    $('preview').innerHTML = `<thead><tr><th>Include</th>${keys.map(k => `<th>${esc(data.columns.find(c => c.key === k).label)}</th>`).join('')}</tr></thead><tbody>${rows.slice(page * pageSize, (page + 1) * pageSize).map(({ r, index }) => `<tr class="${r.kind === 'Summary' ? 'summary' : ''} ${r.include === false ? 'excluded' : ''}"><td><input type="checkbox" data-row="${index}" aria-label="Include row ${index + 1}" ${r.include !== false ? 'checked' : ''}></td>${keys.map(k => ['page', 'kind'].includes(k) ? `<td class="readonly">${esc(String(cellValue(r, k)))}</td>` : `<td class="${k}"><input type="text" data-edit="${index}" data-key="${k}" aria-label="Row ${index + 1} ${esc(data.columns.find(c => c.key === k).label)}" value="${esc(String(cellValue(r, k)))}" title="${esc(String(cellValue(r, k)))}"></td>`).join('')}</tr>`).join('')}</tbody>`;
    $('preview').querySelectorAll('[data-edit]').forEach(input => input.oninput = () => { const row = data.rows[+input.dataset.edit], k = input.dataset.key; if (k === 'wbs') row.wbs = input.value; else row.cells[k] = input.value; dirty = true; });
    $('preview').querySelectorAll('[data-row]').forEach(input => input.onchange = () => { data.rows[+input.dataset.row].include = input.checked; dirty = true; renderTable(); });
    $('page-label').textContent = `Page ${page + 1} of ${pages} · ${rows.length.toLocaleString()} preview rows`;
    $('prev').disabled = page === 0; $('next').disabled = page + 1 >= pages;
    updateCounts();
}
$('pdf-file').onchange = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    if (dirty && !confirm('Replace the current preview? Download any edits you want to keep first.')) return;
    controller = new AbortController(); $('pdf-file').disabled = true; $('cancel').hidden = false; $('progress').hidden = false;
    try {
        const next = await readSchedulePdf(file, { signal: controller.signal, onProgress: (message, n, count) => { status(message); if (count) { $('progress').max = count; $('progress').value = n; } else $('progress').removeAttribute('value'); } });
        data = next; keys = data.columns.map(c => c.key); page = 0; dirty = true; $('search').value = ''; $('summaries').checked = true;
        $('summary').textContent = `${file.name} · ${data.pages} pages · ${data.rows.filter(r => r.kind === 'Activity').length.toLocaleString()} activities`;
        $('warnings').innerHTML = data.warnings.map(w => `<li>${w.page ? `Page ${w.page}: ` : ''}${esc(w.message)}</li>`).join('');
        $('warning-count').textContent = `${data.warnings.length} import notes · review before using`;
        $('results').hidden = false; renderColumns(); renderTable(); status('Ready to review. Edit cells, choose columns and download your table.');
    } catch (err) { status(err.name === 'AbortError' ? 'Import cancelled. The previous preview is unchanged.' : err.message, err.name !== 'AbortError'); }
    finally { controller = null; $('pdf-file').disabled = false; $('cancel').hidden = true; $('progress').hidden = true; }
};
$('cancel').onclick = () => controller?.abort();
$('summaries').onchange = () => { page = 0; renderTable(); };
$('search').oninput = () => { page = 0; renderTable(); };
$('prev').onclick = () => { page--; renderTable(); };
$('next').onclick = () => { page++; renderTable(); };
$('all-columns').onclick = () => { keys = data.columns.map(c => c.key); renderColumns(); renderTable(); };
$('no-columns').onclick = () => { keys = []; renderColumns(); renderTable(); };
function download(bytes, extension, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type })), a = document.createElement('a');
    a.href = url; a.download = data.file.replace(/\.pdf$/i, '') + '-converted.' + extension; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    status(`Downloaded ${extension.toUpperCase()} with ${selectedRows().length.toLocaleString()} rows and ${keys.length} selected columns.`);
}
$('csv').onclick = () => { try { download(csvText(exportRows(data, keys, { includeSummary: $('summaries').checked })), 'csv', 'text/csv;charset=utf-8'); } catch (e) { status(e.message, true); } };
$('excel').onclick = () => { try {
    download(xlsxBytes([
        { name: 'Schedule', rows: exportRows(data, keys, { includeSummary: $('summaries').checked }) },
        { name: 'Metadata', rows: [['Field', 'Value'], ['Source file', data.file], ['Pages', data.pages], ['Data date', data.dataDate], ['Exported rows', selectedRows().length], ['Exported at', new Date().toISOString()], ['Notes', 'Preview edits applied. Dates and identifiers are text. Only printed information is recovered.']] },
        { name: 'Warnings', rows: [['Source page', 'Import note'], ...data.warnings.map(w => [w.page || '', w.message])] },
    ]), 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
} catch (e) { status(e.message, true); } };
$('send').onclick = async () => {
    if (!confirm('Use these included activities as the model schedule? This replaces the saved schedule. Dates remain as printed; export columns do not change model fields.')) return;
    try {
        const schedule = scheduleFromRows(scheduleRows(data), { file: data.file, format: 'pdf', dataDate: parseDateText(data.dataDate).day });
        // The tracker's "Demo: this year and this project" box (on unless turned off): the tracker moves it on load.
        let demo = true; try { demo = localStorage.getItem('drywall-demos:schedule-demo-shift') !== 'false'; } catch {}
        if (demo) schedule.source.pendingDemo = true;
        await saveState('schedule', schedule); dirty = false; location.href = 'schedule.html';
    }
    catch (err) { status(`Schedule was not saved: ${err.message}`, true); }
};
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
