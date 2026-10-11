// Criteria Review (criteria-review.html): an engineering criteria workbook read in this browser and shown for review.
// Each row: its dropdown label, its source name as authored with the fields the name carries, the columns' values with
// their states, discrepancies between the name and the columns, notes and identity. Nothing is uploaded or stored.
import { readWorkbook } from './demos/common/xlsx.mjs';
import { readCriteriaWorkbook, compareByIdentity } from './demos/06-shop-drawings/criteria-workbook.mjs';
import { formatLength, formatInches } from './demos/06-shop-drawings/criteria-names.mjs';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const pre = (v) => esc(v).replace(/\n/g, '<span class="cr-nl" title="line break">⏎</span>\n');
const KIND_LABEL = { wall: 'Walls', door: 'Doors', window: 'Windows' };
let review = null, fileName = '', tab = 'wall', open = new Set();

async function load(file) {
    try {
        review = readCriteriaWorkbook(await readWorkbook(await file.arrayBuffer()));
        fileName = file.name; open = new Set();
        tab = ['wall', 'door', 'window'].find(k => review.rows.some(r => r.kind === k)) || 'wall';
        $('cr-compare-card').hidden = true;
        render();
    } catch (err) {
        review = null;
        $('cr-summary').innerHTML = `<p class="warn">${esc(file.name)}: ${esc(err.message)} Nothing was read.</p>`;
        for (const id of ['cr-issues-card', 'cr-rows-card', 'cr-compare-card']) $(id).hidden = true;
    }
}

function render() {
    const r = review, withId = r.rows.filter(x => x.identity).length;
    const counts = Object.entries(KIND_LABEL).map(([k, label]) => `${r.rows.filter(x => x.kind === k).length} ${label.toLowerCase()}`).join(' · ');
    $('cr-summary').innerHTML = `<p><b>${esc(fileName)}</b> · ${counts} · <span class="muted" title="${esc(r.workbookSha256)}">SHA-256 ${esc(r.workbookSha256.slice(0, 12))}…</span></p>
        <p>${withId ? `<span class="cr-badge ok">GUID-enabled</span> ${withId} of ${r.rows.length} rows carry a KEY_ID.` : '<span class="cr-badge">Browse only</span> No KEY_ID columns: no row has an identity (identities are issued once, in Excel, by the native catalog copy).'}</p>
        <table class="cr-sheets"><tr><th>Sheet</th><th>Holds</th><th>Header</th></tr>${r.sheets.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(KIND_LABEL[s.kind])}</td>
            <td>${s.header.inferred ? `<span class="cr-badge warn">none: read from the marks</span>${s.header.sibling ? ` · other columns named as in “${esc(s.header.sibling)}”` : ''}` : `row ${s.header.row}`}
            <details><summary class="muted small">columns</summary>${Object.entries(s.header.columns).map(([role, c]) => `<div class="small"><b>${esc(c.column)}</b> ${esc(role)}${c.header ? ` · “${pre(c.header)}”` : ' · (no header)'}${s.header.evidence[role] ? ` · ${esc(s.header.evidence[role])}` : ''}</div>`).join('')}</details></td></tr>`).join('')}</table>`;
    $('cr-export').hidden = false; $('cr-compare-label').hidden = !withId;
    const groups = [['error', 'Errors'], ['needs-review', 'Check'], ['info', 'For information']];
    $('cr-issues-card').hidden = !r.issues.length;
    $('cr-issues').innerHTML = groups.map(([sev, label]) => {
        const list = r.issues.filter(i => i.severity === sev);
        if (!list.length) return '';
        return `<details class="cr-issues ${sev}" ${sev === 'info' ? '' : 'open'}><summary><b>${label}</b> (${list.length})</summary><ul>${list.map(i => `<li>${i.row ? `<a href="#" data-goto="${esc(`${i.sheet}!${i.row}`)}">${esc(i.sheet)} row ${i.row}</a>: ` : i.sheet ? `${esc(i.sheet)}: ` : ''}${esc(i.message)}</li>`).join('')}</ul></details>`;
    }).join('');
    $('cr-rows-card').hidden = false;
    $('cr-tabs').innerHTML = Object.entries(KIND_LABEL).filter(([k]) => r.rows.some(x => x.kind === k))
        .map(([k, label]) => `<button role="tab" class="${k === tab ? '' : 'secondary'}" data-tab="${k}" aria-selected="${k === tab}">${label} (${r.rows.filter(x => x.kind === k).length})</button>`).join('');
    renderRows();
}

const toCheck = (row) => row.discrepancies.length || review.issues.some(i => i.severity !== 'info' && i.sheet === row.source.sheet && i.row === row.source.row);
function renderRows() {
    const q = $('cr-search').value.trim().toLowerCase(), only = $('cr-review-only').checked;
    const rows = review.rows.filter(r => r.kind === tab && (!only || toCheck(r))
        && (!q || [r.presentation.displayLabel, r.source.mark, r.presentation.nativeCode, ...r.source.cells.map(c => c.text)].join(' ').toLowerCase().includes(q)));
    $('cr-rows').innerHTML = rows.length ? rows.map(rowCard).join('') : '<p class="muted">No rows here.</p>';
}
const state = (v) => (v.state === 'value' ? '' : `<span class="cr-state ${v.state}">${esc(v.state.replace(/-/g, ' '))}</span>`);
const len = (v) => `${v.text ? `<code>${pre(v.text)}</code>` : ''}${v.feet != null && v.state !== 'zero' ? ` <span class="muted">= ${esc(formatLength(v.feet))}</span>` : ''} ${state(v)}`;
const mem = (v) => `${v.text ? `<code>${pre(v.text)}</code>` : ''} ${state(v)}${v.state === 'value' && v.canonical !== v.text.trim() ? ` <span class="muted">→ ${esc(v.canonical)}</span>` : ''}${v.alternatives > 1 ? ' <span class="cr-badge">alternatives (OR)</span>' : ''}${v.state === 'value' && v.combined ? ' <span class="cr-badge">combined parts</span>' : ''}${v.error ? ` <span class="warn small">${esc(v.error)}</span>` : ''}`;
const txt = (v) => (v.text ? `<code>${pre(v.text)}</code>` : '<span class="cr-state blank">blank</span>');
// The fields a source name carries, as chips under it.
function nameChips(r) {
    const n = r.name, chip = (label, text) => (text ? `<span class="cr-chip"><i>${esc(label)}</i> ${esc(text)}</span>` : '');
    if (r.kind === 'wall') return [chip('code', n.code), chip('type token', n.typeToken), chip('finish / layers', n.finishCondition), chip('height band', n.heightBand?.text),
        chip('stud', n.stud?.member.text), chip('spacing', n.stud?.spacingText), ...n.extra.map(t => chip('additional', t)), ...n.unread.map(u => `<span class="cr-chip bad"><i>not a ${esc(u.expected)}</i> ${esc(u.text)}</span>`)].join('');
    return [chip('code', n.code), chip('category', n.categories.join('/')), chip('finish', n.finish), chip('width band', n.widthBand?.text), chip('wall height ≤', n.wallHeight?.text),
        chip('above opening ≤', n.aboveOpening?.text), chip('header', n.header?.member.text), chip('jamb', n.jamb?.member.text), chip('sill', n.sill?.member.text),
        ...n.extra.map(t => chip('extra', t)), ...n.unread.map(u => `<span class="cr-chip bad"><i>not a ${esc(u.expected)}</i> ${esc(u.text)}</span>`)].join('');
}
function rowCard(r) {
    const v = r.values, p = r.presentation, id = r.id, isOpen = open.has(id), check = toCheck(r);
    const fields = r.kind === 'wall'
        ? [['Type', txt(v.type)], ['Finish', txt(v.finish)], ['Max height', len(v.maxHeight)], ['Spacing', `${v.spacing.text ? `<code>${pre(v.spacing.text)}</code>` : ''}${v.spacing.feet ? ` <span class="muted">= ${esc(formatInches(v.spacing.feet))}</span>` : ''} ${state(v.spacing)}`], ['Stud', mem(v.stud)],
            ['Bottom track', mem(v.bottomTrack)], ['Top track', mem(v.topTrack)], ['Deflection', len(v.deflection)], ['Additional', txt(v.additional)], ['Wall type', txt(v.wallTypeNote)], ['Building', txt(v.buildingNote)]]
        : [['Wall height ≤', len(v.wallHeight)], ['Above opening ≤', len(v.aboveOpening)], ['Width', `<code>${pre(v.width.text)}</code>`], ['Header', mem(v.header)], ['Jamb', mem(v.jamb)], ['Sill', mem(v.sill)], ['Wall type', txt(v.wallTypeNote)]];
    return `<article class="cr-row ${check ? 'check' : ''}" id="row-${esc(id)}">
        <header class="cr-row-head" data-toggle="${esc(id)}"><span class="cr-label">${esc(p.displayLabel)}</span>
            <span class="cr-codes">${p.nativeCode !== p.displayCode ? `<span class="cr-badge" title="What the native parser would call it (comparison only)">native ${esc(p.nativeCode)}</span>` : ''}
            ${r.identity ? `<span class="cr-badge ok" title="${esc(r.identity.keyId)}">KEY_ID …${esc(r.identity.keyId.slice(-6))} · rev ${r.identity.revision}${r.identity.isDeleted ? ' · deleted' : ''}</span>` : ''}
            ${p.templateAlias ? `<span class="cr-badge">template ${esc(p.templateAlias)}</span>` : ''}${p.aliases.map(a => `<span class="cr-badge">was ${esc(a)}</span>`).join('')}
            ${r.discrepancies.length ? `<span class="cr-badge warn">${r.discrepancies.length} name ≠ column</span>` : ''}${r.excluded ? '<span class="cr-badge">excluded</span>' : ''}</span>
            <span class="muted small">${esc(r.source.sheet)} · row ${r.source.row}</span></header>
        <div class="cr-mark"><code>${pre(r.source.mark)}</code></div>
        <div class="cr-chips">${nameChips(r)}</div>
        ${r.discrepancies.length ? `<ul class="cr-disc">${r.discrepancies.map(d => `<li>${esc(d.message)}</li>`).join('')}</ul>` : ''}
        ${isOpen ? `<table class="cr-fields">${fields.map(([k, h]) => `<tr><td>${esc(k)}</td><td>${h}</td></tr>`).join('')}</table>
            ${r.notes.length ? `<ul class="cr-notes">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
            <details><summary class="muted small">Cells as authored</summary><table class="cr-cells">${r.source.cells.map(c => `<tr><td>${esc(c.ref)}</td><td class="muted">${c.header ? pre(c.header) : c.role ? esc(c.role) : ''}</td><td><code>${pre(c.text)}</code>${c.formula != null ? ` <span class="cr-badge ${c.cached ? '' : 'warn'}">formula =${esc(c.formula)}${c.cached ? '' : ', no saved result'}</span>` : ''}</td></tr>`).join('')}</table></details>`
        : `<button class="link small" data-toggle="${esc(id)}">Show the values</button>`}
    </article>`;
}

async function compare(file) {
    try {
        const other = readCriteriaWorkbook(await readWorkbook(await file.arrayBuffer()));
        const diff = compareByIdentity(review, other).filter(e => e.change !== 'unchanged');
        $('cr-compare-card').hidden = false;
        $('cr-diff').innerHTML = `<p class="muted small">${esc(fileName)} → ${esc(file.name)}: rows matched by KEY_ID only (not by code, label or place).</p>`
            + (diff.length ? `<table class="cr-sheets"><tr><th>KEY_ID</th><th>Change</th><th>Code</th><th>Revision</th></tr>${diff.map(e => `<tr class="${e.conflict ? 'warn' : ''}"><td title="${esc(e.keyId)}">…${esc(e.keyId.slice(-6))}</td><td>${esc(e.change)}${e.conflict ? `: ${esc(e.conflict)}` : ''}${e.note ? ` <span class="muted small">${esc(e.note)}</span>` : ''}</td>
                <td>${e.previousCode && e.previousCode !== e.displayCode ? `${esc(e.previousCode)} → ` : ''}${esc(e.displayCode)}</td><td>${e.previousRevision != null ? `${e.previousRevision} → ` : ''}${e.revision ?? ''}</td></tr>`).join('')}</table>` : '<p>No row changed.</p>');
    } catch (err) { $('cr-compare-card').hidden = false; $('cr-diff').innerHTML = `<p class="warn">${esc(file.name)}: ${esc(err.message)}</p>`; }
}
function exportReview() {
    const out = { ...review, file: fileName };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `criteria-review-${fileName.replace(/\.xlsx$/i, '').replace(/[^\w.-]+/g, '-')}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('cr-file').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) load(f); });
$('cr-compare').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f && review) compare(f); });
$('cr-export').addEventListener('click', () => review && exportReview());
$('cr-search').addEventListener('input', () => review && renderRows());
$('cr-review-only').addEventListener('change', () => review && renderRows());
document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; render(); return; }
    const g = e.target.closest('[data-toggle]');
    if (g && !e.target.closest('a, details')) { const id = g.dataset.toggle; open.has(id) ? open.delete(id) : open.add(id); renderRows(); return; }
    const go = e.target.closest('[data-goto]');
    if (go) {
        e.preventDefault();
        const row = review.rows.find(r => r.id === go.dataset.goto);
        if (!row) return;
        tab = row.kind; open.add(row.id); $('cr-search').value = ''; $('cr-review-only').checked = false; render();
        document.getElementById(`row-${row.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
});
