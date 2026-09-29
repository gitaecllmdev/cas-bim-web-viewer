// Geometry-based P6 layout reader, shared by the converter and model schedule.
// Ports the column/profile, continuation and hierarchy approach from CW-PROJECTPDF.
// Pure functions accept page text boxes; neither this module nor the converter sends PDFs to a server.
const definitions = [
    ['rowNumber', '#', /^#$/], ['id', 'Activity ID', /^(activity id|act id|task code)$/],
    ['firm', 'Responsible Firm', /^(resp firm|responsible firm)$/], ['name', 'Activity Name', /^(activity name|act name)$/],
    ['dur', 'Original Duration', /^(original( duration)?|orig( dur)?|od)$/],
    ['rem', 'Remaining Duration', /^(remaining( duration)?|rem( dur)?)$/], ['eac', 'EAC Duration', /^eac( dur)?$/],
    ['plannedStart', 'Planned Start', /^(planned start|bl project start|baseline start)$/],
    ['plannedFinish', 'Planned Finish', /^(planned finish|bl project finish|baseline finish)$/],
    ['start', 'Start', /^(start|start date)$/], ['finish', 'Finish', /^(finish|finish date)$/],
    ['startFlag', 'Start Actual', /^(str( act)?|start actual)$/], ['finishFlag', 'Finish Actual', /^(fin(a| act)?|finish actual)$/],
    ['pct', 'Activity % Complete', /^(activity % complete|physical % complete|% complete|activity %|physical %)$/],
    ['float', 'Total Float', /^total( float)?$/], ['preds', 'Predecessors', /^predecessors$/], ['succs', 'Successors', /^successors$/],
];
const norm = s => s.trim().toLowerCase().replace(/\s+/g, ' ');
const join = items => items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
const isId = s => /^(?=.*\d)[\w.\/-]+(?:[ -][\w.\/-]*)*$/.test(s) && s.length <= 64;
function linesOf(items) {
    const lines = [];
    for (const item of items.filter(i => i.str?.trim()).sort((a, b) => a.y - b.y || a.x - b.x)) {
        let line = lines.at(-1);
        if (!line || Math.abs(line.y - item.y) > Math.max(2.5, Math.max(item.h || 8, line.h) * .4)) lines.push(line = { y: item.y, h: item.h || 8, items: [] });
        const duplicate = line.items.find(i => i.str === item.str && Math.abs(i.x - item.x) < 1 && Math.abs(i.w - item.w) < 1);
        if (duplicate) duplicate.repeated = true;
        else line.items.push({ ...item });
    }
    for (const line of lines) line.items.sort((a, b) => a.x - b.x);
    return lines;
}
function headerOf(lines, page) {
    for (let at = 0; at < lines.length && lines[at].y < page.height * .5; at++) {
        const line = lines[at], text = norm(join(line.items));
        if (!/(activity|act) id/.test(text) || !/(activity|act) name/.test(text)) continue;
        const anchors = [];
        for (let i = 0; i < line.items.length; i++) {
            for (let n = Math.min(3, line.items.length - i); n > 0; n--) {
                const parts = line.items.slice(i, i + n);
                if (parts.some((p, k) => k && p.x - (parts[k - 1].x + parts[k - 1].w) > 12)) continue;
                const def = definitions.find(d => d[2].test(norm(join(parts))));
                if (!def) continue;
                anchors.push({ key: def[0], label: def[1], x: parts[0].x, right: parts.at(-1).x + parts.at(-1).w }); i += n - 1; break;
            }
        }
        if (!anchors.some(a => a.key === 'id') || !anchors.some(a => a.key === 'name')) continue;
        let bottom = line.y;
        for (const other of lines.slice(at + 1)) {
            if (other.y - line.y > line.h * 2.5) break;
            const pieces = other.items.filter(i => anchors.some(a => i.x < a.right + 3 && i.x + i.w > a.x - 3) && /^(duration|dur|act|complete|float)$/i.test(i.str.trim()));
            if (pieces.length) bottom = other.y;
        }
        for (const a of anchors) a.center = (a.x + a.right) / 2;
        const last = anchors.at(-1), prev = anchors.at(-2);
        let right = last.center + Math.max(12, (last.center - prev.center) / 2);
        const timescale = lines.slice(at, at + 4).flatMap(l => l.items).filter(i => i.x > last.right + 5 && /^(20\d{2}|[JFMASOND]|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(i.str.trim()));
        if (timescale.length) right = Math.min(right, Math.min(...timescale.map(i => i.x)) - 2);
        for (let i = 0; i < anchors.length; i++) {
            const a = anchors[i], next = anchors[i + 1];
            a.end = !next ? right : ['name', 'id', 'firm', 'preds', 'succs'].includes(next.key) ? next.x - 2
                : ['name', 'firm', 'id'].includes(a.key) ? next.center - Math.max(6, ((anchors[i + 2]?.center || next.center + 40) - next.center) / 2)
                    : (a.center + next.center) / 2;
            a.begin = i ? anchors[i - 1].end : 0;
        }
        return { anchors, bottom, right };
    }
    return null;
}
export function tableFromPages(pages, { file = '' } = {}) {
    const columns = [], rows = [], warnings = [], hierarchy = []; let dataDate = '', readable = 0, splitIds = 0;
    const warn = (page, message) => { if (warnings.length < 500) warnings.push({ page, message }); };
    for (const page of pages) {
        const lines = linesOf(page.items); readable += page.items.filter(i => i.str?.trim()).length;
        const text = lines.map(l => join(l.items)).join('\n');
        dataDate ||= /data\s*date\s*:?\s*(\d{1,2}[-/][A-Za-z0-9]{1,3}[-/]\d{2,4})/i.exec(text)?.[1] || '';
        const header = headerOf(lines, page);
        if (!header) { warn(page.number, 'No Activity ID / Activity Name header; page was not imported.'); continue; }
        for (const a of header.anchors) if (!columns.some(c => c.key === a.key)) columns.push({ key: a.key, label: a.label });
        const nameColumn = header.anchors.find(a => a.key === 'name');
        const footer = lines.find(l => l.y > page.height * .85 && /page\s*:?\s*\d|run date|date revision|remaining level of effort/i.test(join(l.items)))?.y || page.height * .96;
        let previous = null;
        for (const line of lines) {
            if (line.y <= header.bottom + 2 || line.y >= footer) continue;
            const items = line.items.filter(i => i.x < header.right && i.x + i.w / 2 < header.right + 2);
            if (!items.length || /^(data date|date printed|print date|run date|page\s*:?\s*\d|remaining level of effort|actual work|critical remaining|task filter)/i.test(join(items))) continue;
            const cells = {};
            for (const item of items) {
                // Some narrow P6 ID columns concatenate ID and name into a single PDF text run.
                // Recover the conventional digit-ending ID only at that column boundary; report the inference.
                const glued = item.x < nameColumn.x - 2 && item.x + item.w > nameColumn.x + 5 && !item.repeated
                    && (/^([A-Za-z][A-Za-z0-9_.-]*\d)([1-9](?:st|nd|rd|th) .*)$/.exec(item.str)
                        || /^([A-Za-z][A-Za-z0-9_.-]*\d)(\*?[A-Za-z]{2,}(?:[^A-Za-z0-9].*|$))$/.exec(item.str)
                        || /^([A-Za-z0-9_.\/-]*\d[A-Za-z0-9_.\/-]*)\s+(.+)$/.exec(item.str));
                if (glued) { cells.id = glued[1]; cells.name = [cells.name, glued[2]].filter(Boolean).join(' '); cells.note = 'ID/name split inferred; check source PDF'; cells.raw = item.str; splitIds++; continue; }
                // Long names and summary bands cross columns: their left edge, not their center, identifies them.
                const pos = item.w > 65 ? item.x + 1 : item.x + item.w / 2;
                const col = header.anchors.find(a => pos >= a.begin && pos < a.end);
                if (col) cells[col.key] = [cells[col.key], item.str].filter(Boolean).join(' ');
            }
            // A Gantt label can be extracted even where it is clipped by the PDF print table.
            // Date/number columns must contain only their printed scalar, never a bar label.
            for (const key of ['start', 'finish', 'plannedStart', 'plannedFinish']) if (cells[key]) {
                const m = cells[key].match(/\b\d{1,2}[-/][A-Za-z0-9]{1,3}[-/]\d{2,4}(?:\s*[A*])?/);
                if (m) cells[key] = m[0].replace(/(\d)A$/, '$1 A');
            }
            const id = (cells.id || '').trim(), name = (cells.name || '').trim();
            const datePresent = [cells.start, cells.finish].some(v => /\d{1,2}[-/]\w{1,3}[-/]\d{2,4}/.test(v || ''));
            const validId = isId(id);
            if (previous?.kind === 'Activity' && !cells.rowNumber && !datePresent && /^\d+$/.test(id) && /-\s*$/.test(previous.cells.id) && line.y - previous.y < line.h * 1.5) {
                previous.cells.id = previous.cells.id.trimEnd() + id;
                if (name) previous.cells.name += ' ' + name;
                previous.y = line.y; continue;
            }
            if (!validId && previous?.kind === 'Activity' && !datePresent && !id) {
                const keys = Object.keys(cells).filter(k => cells[k]);
                const relationsOnly = keys.length && keys.every(k => ['preds', 'succs'].includes(k));
                const wrappedName = keys.length === 1 && name && items[0].x >= nameColumn.x - 2 && line.y - previous.y < line.h * 1.4 && !items.some(i => i.repeated || i.bold);
                if (relationsOnly || wrappedName) { for (const key of keys) previous.cells[key] = `${previous.cells[key] || ''} ${cells[key]}`.trim(); previous.y = line.y; continue; }
            }
            if (validId && name) {
                const row = { kind: 'Activity', page: page.number, y: line.y, cells: { ...cells, id, name }, wbs: hierarchy.map(h => h.name).join(' / '), include: true };
                if (!datePresent) warn(page.number, `Activity ${id}: no readable start or finish. Review before importing into the model.`);
                if (rows.some(r => r.kind === 'Activity' && r.cells.id === id)) warn(page.number, `Repeated Activity ID ${id}; check whether these are repeated print panels.`);
                rows.push(row); previous = row;
            } else {
                const labelItems = items.filter(i => i.x < nameColumn.end && !/^\d+$/.test(i.str.trim()));
                const label = join(labelItems);
                if (!label || (!id && !name)) continue;
                const indent = labelItems[0]?.x || 0;
                while (hierarchy.length && hierarchy.at(-1).x >= indent - 3) hierarchy.pop();
                hierarchy.push({ name: label, x: indent });
                rows.push({ kind: 'Summary', page: page.number, y: line.y, cells: { ...cells, id: '', name: label }, wbs: hierarchy.map(h => h.name).join(' / '), include: true });
                previous = null;
            }
        }
    }
    if (!readable) throw new Error('This PDF has no readable text. Scanned PDFs need OCR; export a text PDF, XER, Excel or CSV from P6.');
    if (!columns.length) throw new Error('No supported P6 table header found. Expected Activity ID / ACT ID and Activity Name / ACT NAME.');
    if (!rows.some(r => r.kind === 'Activity')) throw new Error('No activity rows could be identified. Review the PDF layout or export Excel from P6.');
    if (splitIds) warn(null, `${splitIds} joined ID/name text runs were separated at a digit-ending ID. Review these identifiers against the PDF.`);
    if (!columns.some(c => c.key === 'pct')) warn(null, 'Percent complete is not printed; it remains blank, not zero.');
    if (!columns.some(c => c.key === 'preds')) warn(null, 'Predecessors are not printed; relationships cannot be recovered.');
    warn(null, 'Working calendars are not recoverable from this layout. Model scheduling uses Monday–Friday.');
    if (!dataDate) warn(null, 'No Data Date found. Model scheduling will estimate it from actual dates.');
    return { file, pages: pages.length, dataDate, columns: [...columns, { key: 'wbs', label: 'WBS' }, { key: 'kind', label: 'Row Type' }, { key: 'page', label: 'Source Page' }, ...(splitIds ? [{ key: 'note', label: 'Review Note' }, { key: 'raw', label: 'Original ID / Name Text' }] : [])], rows, warnings };
}
export function cellValue(row, key) { return ['wbs', 'kind', 'page'].includes(key) ? row[key] : row.cells[key] || ''; }
export function exportRows(document, keys, { includeSummary = true } = {}) {
    if (!keys.length) throw new Error('Select at least one export column.');
    return [keys.map(k => document.columns.find(c => c.key === k)?.label || k), ...document.rows.filter(r => r.include !== false && (includeSummary || r.kind === 'Activity')).map(r => keys.map(k => cellValue(r, k)))];
}
export function scheduleRows(document) {
    const selected = document.rows.filter(r => r.include !== false && r.kind === 'Activity');
    const keys = document.columns.map(c => c.key).filter(k => !['rowNumber', 'kind', 'page', 'startFlag', 'finishFlag'].includes(k));
    const seen = new Set();
    for (const r of selected) { if (seen.has(r.cells.id)) throw new Error(`The PDF repeats activity ${r.cells.id} (repeated print panels?). Export the layout from P6 as .xer or Excel instead.`); seen.add(r.cells.id); }
    return [keys.map(k => document.columns.find(c => c.key === k).label), ...selected.map(r => keys.map(k => {
        const value = cellValue(r, k); const flag = k === 'start' ? r.cells.startFlag : k === 'finish' ? r.cells.finishFlag : '';
        return flag && /^A$/i.test(flag.trim()) && !/\sA$/.test(value) ? `${value} A` : value;
    }))];
}
