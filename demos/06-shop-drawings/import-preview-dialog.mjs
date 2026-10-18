// The import preview (core/client shop-generator.js and batch-sheets.js): before anything changes, what the file brings and what
// happens to the panels here. Two ways: Update this set from the model (new walls added, changed walls updated from the
// model with their web settings kept, the rest kept) or Replace this set with the file (everything here removed). The
// table says, panel by panel, what changed in the model and what the chosen way does with it; the export's skipped
// walls and notes are grouped by kind underneath. Read-only until Import. -> { mode: 'replace' } |
// { mode: 'update', choices: { index: choice } } | null (Cancel).
import * as G from './generator.mjs';
import { previewImport, outcome } from './import-preview.mjs';
import { fmtFtIn } from '../common/framing.mjs';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STATUS = {
    changed: ['Changed in the model', 'ip-changed'], new: ['New wall', 'ip-new'], standalone: ['New (not from a model)', 'ip-new'],
    same: ['No change', 'ip-same'], ambiguous: ['Can\'t match', 'ip-bad'], here: ['Only here', 'ip-here'],
};
const CHOICE = {
    geometry: 'Update the wall from the model, keep its web settings', keep: 'Keep it as it is here',
    update: 'Take the file\'s settings (drops the web settings here)', copy: 'Add an unlinked study copy', skip: 'Skip it',
};
const FILTERS = [['all', 'All'], ['changed', 'Changed'], ['new', 'New'], ['ambiguous', 'Can\'t match'], ['here', 'Only here'], ['same', 'No change']];
const rank = { changed: 0, ambiguous: 1, new: 2, standalone: 2, here: 3, same: 4 };

// A small elevation of a panel: its outline and openings, the named ones marked (cls by opening name); s: px per inch,
// one scale for the two drawings compared.
function elevation(panel, marks, title, s) {
    const { lengthIn: L, heightIn: H, top } = G.shapeTop(panel.shape);
    if (!(L > 0 && H > 0)) return '';
    const w = L * s, h = H * s, y = (v) => (h - v * s).toFixed(1);
    const outline = [[0, 0], [L, 0], ...(top ? [...top].reverse() : [[L, H], [0, H]])].map(([x, v]) => `${(x * s).toFixed(1)},${y(v)}`).join(' ');
    const ops = panel.openings.map((o, i) => {
        const b = G.openingBox(o, H), name = G.openingName(panel.openings, i), cls = marks[name] || '';
        return `<rect class="ip-op ${cls}" x="${(b.left * s).toFixed(1)}" y="${y(Math.min(b.top, H))}" width="${Math.max(1, (b.right - b.left) * s).toFixed(1)}" height="${Math.max(1, (Math.min(b.top, H) - b.bottom) * s).toFixed(1)}"><title>${esc(name)}</title></rect>`;
    }).join('');
    return `<figure class="ip-elev"><svg width="${(w + 4).toFixed(0)}" height="${(h + 4).toFixed(0)}" viewBox="-2 -2 ${(w + 4).toFixed(1)} ${(h + 4).toFixed(1)}" role="img" aria-label="${esc(title)}"><polygon class="ip-wall" points="${outline}"/>${ops}</svg><figcaption>${esc(title)} · ${fmtFtIn(L)} x ${fmtFtIn(H)}</figcaption></figure>`;
}

// guard (optional; Batch Sheets: batch-import-guard.mjs importGuard): its match, warnings and preferKeep go to the preview.
export function showImportPreview({ name, current, incoming, data, guard = null }) {
    const pv = previewImport(current, incoming, data, guard || {}), ev = pv.evidence, c = pv.counts;
    const checks = pv.warnings.length ? `<ul class="ip-list ip-checks" role="note" aria-label="Checks on this file">${pv.warnings.map(w => `<li class="small${w.level === 'warn' ? ' warn' : ' muted'}">${esc(w.text)}</li>`).join('')}</ul>` : '';
    const byId = new Map((current.panels || []).map(p => [p.id, p]));
    const fixable = ev.skipped.filter(g => g.fixable).reduce((n, g) => n + g.items.length, 0);
    let mode = pv.relation === 'empty' ? 'replace' : pv.merge.ok ? 'update' : 'replace', filter = 'all';
    const src = incoming.source || {}, when = src.exportedAt ? new Date(src.exportedAt) : null;
    const from = src.documentId ? `From the model ${incoming.project || '(unnamed)'}${when && !isNaN(when) ? ` · exported ${when.toLocaleString()}` : ''}${src.exportedBy ? ` by ${src.exportedBy}` : ''}` : 'Panels not from a model';

    const rowHtml = (r) => {
        const [label, cls] = STATUS[r.status], here = r.here ? byId.get(r.here.id) : null;
        const what = r.status === 'changed' ? `<ul class="ip-list">${[...r.wall, ...r.openings.map(o => o.text)].map(t => `<li>${esc(t)}</li>`).join('')}</ul>`
            : r.status === 'ambiguous' ? `<span class="warn small">${esc(r.reason)}</span>`
                : r.status === 'same' ? '<span class="muted small">Same wall and openings as here.</span>'
                    : `<span class="small">${esc(G.openingsSummary(r.panel.openings))}</span>`;
        const marksHere = Object.fromEntries(r.openings.filter(o => o.change !== 'added').map(o => [o.name, o.change === 'removed' ? 'gone' : 'moved']));
        const marksFile = Object.fromEntries(r.openings.filter(o => o.change !== 'removed').map(o => [o.name, o.change === 'added' ? 'added' : 'moved']));
        const was = here && G.cleanPanel(here), ta = was && G.shapeTop(was.shape), tb = G.shapeTop(r.panel.shape);
        const scale = was && 150 / Math.max(ta.lengthIn, tb.lengthIn, 1.5 * Math.max(ta.heightIn, tb.heightIn), 1);
        const picture = was && (r.openings.length || r.wall.some(t => !/^model geometry re-read/.test(t)))
            ? `<details class="ip-pic"><summary class="small">Compare</summary><div class="ip-elevs">${elevation(was, marksHere, `Here (${here.mark})`, scale)}${elevation(r.panel, marksFile, 'Model now', scale)}</div>
                <p class="small muted ip-key"><i class="k-moved"></i>changed <i class="k-added"></i>added <i class="k-gone"></i>removed</p></details>` : '';
        const settings = r.settings.length ? `<div class="small muted">Web settings here: ${esc(r.settings.join(', '))}</div>` : '';
        const onImport = mode === 'replace'
            ? (r.here ? `Replaced by the file's panel${r.settings.length ? `<div class="warn small">Loses: ${esc(r.settings.join(', '))}</div>` : ''}` : 'Added')
            : r.choices.length === 1 ? (r.choice === 'add' ? 'Added' : esc(CHOICE[r.choice]))
                : `<select data-row="${r.index}" aria-label="On import: ${esc(r.mark)}">${r.choices.map(k => `<option value="${k}" ${k === r.choice ? 'selected' : ''}>${esc(CHOICE[k])}</option>`).join('')}</select>`;
        return `<tr data-status="${r.status === 'standalone' ? 'new' : r.status}"><td><b>${esc(r.mark)}</b>${r.here && r.here.mark !== r.mark ? `<div class="small muted">here: ${esc(r.here.mark)}</div>` : ''}</td><td>${esc(r.level)}</td>
            <td><span class="ip-chip ${cls}">${label}</span></td><td>${what}${picture}${mode === 'replace' ? '' : settings}</td><td>${onImport}</td></tr>`;
    };
    const hereHtml = (h) => `<tr data-status="here"><td><b>${esc(h.mark)}</b></td><td>${esc(h.level)}</td><td><span class="ip-chip ip-here">${STATUS.here[0]}</span></td>
        <td><span class="small">${esc(h.reason)}</span></td><td>${mode === 'replace' ? `Removed${h.settings.length ? `<div class="warn small">Loses: ${esc(h.settings.join(', '))}</div>` : ''}` : 'Kept as it is'}</td></tr>`;
    const says = () => {
        if (pv.relation === 'empty') return { update: '', replace: `Brings in ${plural(c.file, 'panel')} as the file has them.` };
        const u = outcome(pv, 'update'), r = outcome(pv, 'replace');
        return {
            update: [u.add && `adds ${plural(u.add, 'new panel')}`, u.fromModel && `updates ${plural(u.fromModel, 'changed wall')} from the model and keeps ${u.fromModel === 1 ? 'its' : 'their'} web settings`,
                u.keep && `keeps ${u.keep} as ${u.keep === 1 ? 'it is' : 'they are'}`, u.detailing && `gives ${u.detailing} the file's settings`, u.copy && `adds ${plural(u.copy, 'study copy', 'study copies')}`,
                u.skip && `skips ${u.skip}`, u.keepHere && `leaves ${plural(u.keepHere, 'panel')} the file does not have`].filter(Boolean).join(', ').replace(/^./, ch => ch.toUpperCase()) + '.',
            replace: `Removes ${r.remove === 1 ? 'the 1 panel' : `all ${r.remove} panels`} here${r.settingsLost ? ` (${r.settingsLost === r.remove ? `${r.remove === 1 ? 'its' : 'all their'} web settings lost` : `${r.settingsLost} of them lose their web settings`})` : ''} and brings in the file's ${plural(r.add, 'panel')} as exported.`,
        };
    };
    const go = () => {
        if (mode === 'replace') return pv.relation === 'empty' ? `Import ${plural(c.file, 'panel')}` : `Replace with ${plural(c.file, 'panel')}`;
        const u = outcome(pv, 'update');
        return `Update: ${[u.add && `add ${u.add}`, u.fromModel && `update ${u.fromModel}`, u.keep && `keep ${u.keep}`, u.detailing && `re-detail ${u.detailing}`, u.copy && `copy ${u.copy}`].filter(Boolean).join(', ') || 'nothing to change'}`;
    };
    const tile = (n, text, sub, cls, f) => `<button type="button" class="ip-tile ${cls}" data-filter="${f}"><b>${n}</b><span>${text}</span><small>${sub}</small></button>`;
    const evidence = () => {
        const group = (g, body, open) => `<details class="ip-group"${open ? ' open' : ''}><summary><b>${g.items.length}</b> ${esc(body)}</summary>`;
        const walls = (items) => `<p class="small ip-ids">${items.map(i => esc(i.elementId ? `${i.elementId}${i.n > 1 ? ` (${i.n})` : ''}` : i.wall)).join(', ')}</p>`;
        const tally = (items) => [...items.reduce((m, i) => m.set(i.elementId, (m.get(i.elementId) || 0) + 1), new Map())].map(([elementId, n]) => ({ elementId, n }));
        const skipped = ev.skipped.length ? `<details class="ip-evidence"${fixable ? ' open' : ''}><summary>Not panelized: ${plural(ev.skippedWalls, 'wall')} the Revit export skipped${fixable ? ` · <span class="warn">${fixable} can be fixed in the model</span>` : ''}</summary>
            ${ev.skipped.map(g => `${group(g, `${g.reason}${g.fixable ? ' — fix in the model to include it' : ' — never framed here'}`)}<p class="small muted">Revit element IDs:</p>${walls(g.items)}</details>`).join('')}</details>` : '';
        const notes = ev.notes.length ? `<details class="ip-evidence"><summary>Export notes: ${ev.noteCount} for information${ev.repeated ? ` (${ev.repeated} repeating skipped walls left out)` : ''}</summary>
            ${ev.notes.map(g => `${group(g, g.label)}${g.items.some(i => i.detail) ? `<ul class="ip-list small">${g.items.map(i => `<li>${esc(i.elementId ? `Wall ${i.elementId}: ` : '')}${esc(i.detail)}</li>`).join('')}</ul>` : `<p class="small muted">Walls:</p>${walls(tally(g.items))}`}</details>`).join('')}</details>` : '';
        return skipped + notes;
    };

    return new Promise(resolve => {
        const d = document.createElement('dialog');
        d.className = 'import-dialog import-preview';
        const render = () => {
            const s = says(), rows = [...pv.rows].sort((a, b) => rank[a.status] - rank[b.status]);
            const count = (f) => f === 'all' ? rows.length + pv.hereOnly.length : f === 'here' ? pv.hereOnly.length : f === 'new' ? c.new : rows.filter(r => r.status === f).length;
            d.innerHTML = `<form method="dialog">
                <header class="ip-head"><h3>Import preview</h3><p class="small muted"><b>${esc(name)}</b> · ${esc(from)}. Nothing changes until you press the button below.</p></header>
                ${checks}
                <div class="ip-tiles">
                    ${tile(c.file, 'panels to panelize', [c.new && `${c.new} new`, c.changed && `${c.changed} changed in the model`, c.same && `${c.same} unchanged`, c.ambiguous && `${c.ambiguous} can't match`].filter(Boolean).join(' · ') || 'none', '', 'all')}
                    ${tile(ev.skippedWalls, 'walls not panelized', ev.skippedWalls ? (fixable ? `${fixable} can be fixed in the model` : 'never framed here (curtain, curved)') : 'the export skipped none', fixable ? 'ip-warn' : '', 'skipped')}
                    ${pv.relation === 'empty' ? '' : tile(pv.here, 'panels here now', mode === 'replace' ? `all removed${c.withSettings ? ` · ${c.withSettings} lose web settings` : ''}` : `${pv.hereOnly.length ? `${pv.hereOnly.length} not in the file, kept` : 'all in the file'}`, mode === 'replace' && c.withSettings ? 'ip-warn' : '', 'here')}
                </div>
                ${pv.relation === 'empty' ? '' : `<fieldset class="ip-modes"><legend>What should happen to the panels here?</legend>
                    <label class="ip-mode${pv.merge.ok ? '' : ' off'}"><input type="radio" name="ip-mode" value="update" ${mode === 'update' ? 'checked' : ''} ${pv.merge.ok ? '' : 'disabled'}><span><b>Update this set from the model</b> <small class="ip-rec">${pv.merge.ok ? 'keeps your web settings' : 'not possible'}</small><br><span class="small">${esc(pv.merge.ok ? s.update : pv.merge.reason)}</span></span></label>
                    <label class="ip-mode"><input type="radio" name="ip-mode" value="replace" ${mode === 'replace' ? 'checked' : ''}><span><b>Replace this set with the file</b><br><span class="small ${c.withSettings ? 'warn' : ''}">${esc(s.replace)}</span></span></label></fieldset>`}
                <div class="ip-filters" role="group" aria-label="Show">${FILTERS.filter(([f]) => f === 'all' || count(f)).map(([f, t]) => `<button type="button" class="ip-filter${f === filter ? ' on' : ''}" data-filter="${f}" aria-pressed="${f === filter}">${t} <span>${count(f)}</span></button>`).join('')}
                    ${mode === 'update' && pv.rows.some(r => r.status === 'changed') ? '<span class="spacer"></span><button type="button" class="link small" data-all="geometry">All changed: update from the model</button><button type="button" class="link small" data-all="keep">All: keep as here</button>' : ''}</div>
                <div class="ip-table-wrap"><table class="sd-table ip-table"><thead><tr><th>Panel</th><th>Level</th><th>Status</th><th>In the model</th><th>On import</th></tr></thead>
                    <tbody>${rows.map(rowHtml).join('')}${pv.hereOnly.map(hereHtml).join('')}</tbody></table></div>
                ${evidence()}
                <footer class="row ip-foot"><span class="spacer"></span><button value="" class="link">Cancel</button><button value="ok" class="ip-go">${esc(go())}</button></footer></form>`;
            for (const tr of d.querySelectorAll('tbody tr')) tr.hidden = filter !== 'all' && tr.dataset.status !== filter;
        };
        // Drawn again on every choice: the table's scroll and the control in focus are kept.
        const again = (focus) => {
            const wrap = d.querySelector('.ip-table-wrap'), top = wrap?.scrollTop ?? 0;
            render();
            const w = d.querySelector('.ip-table-wrap'); if (w) w.scrollTop = top;
            if (focus) d.querySelector(focus)?.focus();
        };
        d.addEventListener('change', (e) => {
            if (e.target.name === 'ip-mode') { mode = e.target.value; again(`input[name="ip-mode"][value="${mode}"]`); return; }
            const row = e.target.closest('[data-row]');
            if (row) { pv.rows.find(r => String(r.index) === row.dataset.row).choice = row.value; again(`[data-row="${row.dataset.row}"]`); }
        });
        d.addEventListener('click', (e) => {
            const f = e.target.closest('[data-filter]'), all = e.target.closest('[data-all]');
            if (f && f.dataset.filter === 'skipped') { const box = d.querySelector('.ip-evidence'); if (box) { box.open = true; box.scrollIntoView({ block: 'nearest' }); } return; }
            if (f) { filter = f.dataset.filter === 'here' && !pv.hereOnly.length ? 'all' : f.dataset.filter; again(`.ip-filter[data-filter="${filter}"]`); return; }
            if (all) { for (const r of pv.rows) if (r.choices.includes(all.dataset.all) && (r.status === 'changed' || all.dataset.all === 'keep')) r.choice = all.dataset.all; again(`[data-all="${all.dataset.all}"]`); }
        });
        render();
        document.body.append(d);
        d.addEventListener('close', () => {
            const ok = d.returnValue === 'ok';
            resolve(!ok ? null : mode === 'replace' ? { mode } : { mode, rows: pv.rows, choices: Object.fromEntries(pv.rows.map(r => [r.index, r.choice])) });
            d.remove();
        });
        d.showModal();
    });
}
