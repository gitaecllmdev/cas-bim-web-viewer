// An engineering criteria workbook read as candidate evidence for review: never as approved engineering, never written
// back. Takes readWorkbook's result (demos/common/xlsx.mjs); pure and synchronous from there.
//
//   readCriteriaWorkbook(xlsx) -> { workbookSha256, sheets: [{ name, kind, header }], rows: [row], issues }
//   row: { id ('<sheet>!<row>': where it was read, for this review only: never an identity), kind, excluded,
//          source:       { sheet, row, mark, cells: [{ ref, header, role, text, formula, cached }] }   (as authored)
//          name:         the fields the mark carries (criteria-names.mjs parseWallMark / parseOpeningMark)
//          values:       what each column says: lengths { text, state, feet }, members { text, state, canonical … }
//          presentation: { sourceCode, displayCode, displayLabel, templateAlias, aliases }
//          identity:     { catalogId, keyId, displayCode, revision, modifiedUtc, sourceTable, sourceVersion, isDeleted } | null
//          discrepancies: [{ field, name, column, message }]   (the mark and its columns disagree: reported, not chosen)
//          notes: [...] }
//   issues: [{ code, severity, sheet, row, subject, message }]   severity: error | needs-review | info
//
// Sheets are found by their header (normalized for matching only: line breaks, spaces and punctuation aside), or, for a
// sheet with no header row, by what its marks say: a column whose cells agree with a field of the marks on most rows
// takes that field; the rest follow a sibling sheet's header when its layout agrees. Either way it is reported.
import * as N from './criteria-names.mjs';
import { columnName } from '../common/xlsx.mjs';

export const REVIEW_FORMAT = 'cas-criteria-review', REVIEW_VERSION = 1;
const norm = (s) => String(s ?? '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
const KINDS = { wall: 'Wall', door: 'Door', window: 'Window' };
// Header names per role (CriteriaExcelParser.HeaderMap), first match per role.
const ROLES = {
    wall: { mark: ['WALLMARK'], type: ['TYPE'], finish: ['FINISH'], maxHeight: ['SPECIFICMAXHEIGHT', 'MAXHEIGHT'], spacing: ['SPACINGOC', 'SPACING'], stud: ['STUDSIZE', 'STUDTYPE'],
        bottomTrack: ['BOTTOMTRACK'], topTrack: ['TOPTRACK'], deflection: ['DEFL', 'DEFLECTION'], additional: ['ADDITIONAL', 'CONDITION', 'SCOPE', 'APPLICATION', 'COMMENT', 'COMMENTS'],
        wallTypeNote: ['WALLTYPE'], buildingNote: ['BLDG', 'BUILDING'], include: ['INCLUDE'], templateAlias: ['TEMPLATEALIAS'], aliases: ['ALIASES'] },
    opening: { mark: ['DOOROPENINGMARK', 'WINDOWOPENINGMARK', 'OPENINGMARK'], wallHeight: ['MAXHEIGHTOFWALL', 'MAXWALLHEIGHT'], aboveOpening: ['MAXHEIGHTABOVEOPENING'],
        minWidth: ['MINOPENINGWIDTH', 'MINIMUMOPENINGWIDTH'], width: ['MAXOPENINGWIDTH', 'OPENINGWIDTH'], header: ['HEADERFRAMING', 'HEADER'], jamb: ['JAMBFRAMING', 'JAMB'], sill: ['SILLFRAMING', 'SILL'],
        wallTypeNote: ['WALLTYPE'], wallStyle: ['WALLSTYLE', 'CASWALLSTYLE'], depth: ['DEPTH', 'STUDDEPTH'], openingType: ['OPENINGTYPE'], finish: ['FINISH', 'OPENINGFINISH'], include: ['INCLUDE'],
        templateAlias: ['TEMPLATEALIAS'], aliases: ['ALIASES'] },
};
// The identity metadata a GUID-enabled workbook copy carries (ExcelStyleIdentityCopy), matched exactly as written.
const META = ['CAS_CATALOG_ID', 'KEY_ID', 'DISPLAY_CODE', 'REVISION', 'MODIFIED_UTC', 'SOURCE_TABLE', 'SOURCE_VERSION', 'IS_DELETED'];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const family = (kind) => (kind === 'wall' ? 'wall' : 'opening');

function headerAt(sheet, row) {
    const map = {}, names = {};
    for (let c = 1; c <= sheet.lastColumn; c++) { const cell = sheet.cell(row, c), k = norm(cell?.text); if (k && !(k in map)) { map[k] = c; names[c] = cell.text; } }
    return { map, names };
}
function rolesFrom(fam, { map, names }, deflectionGap = true) {
    const cols = {};
    for (const [role, keys] of Object.entries(ROLES[fam])) { const c = keys.map(k => map[k]).find(x => x > 0); if (c) cols[role] = c; }
    // An unnamed column between DEFL and WALL TYPE holds the additional condition (as the native parser reads it).
    if (fam === 'wall' && !cols.additional && deflectionGap && cols.deflection && cols.wallTypeNote > cols.deflection + 1) cols.additional = cols.deflection + 1;
    return { cols, names };
}
const score = (fam, cols) => (fam === 'wall' ? ['mark', 'stud', 'bottomTrack', 'topTrack'] : ['mark', 'width', 'header', 'jamb']).filter(r => cols[r]).length;
function classify(sheet) {
    for (let r = 1; r <= Math.min(sheet.lastRow, 50); r++) for (let c = 1; c <= sheet.lastColumn; c++) {
        const k = norm(sheet.cell(r, c)?.text);
        if (k === 'WALLMARK') return { kind: 'wall', by: 'header' };
        if (k === 'DOOROPENINGMARK') return { kind: 'door', by: 'header' };
        if (k === 'WINDOWOPENINGMARK') return { kind: 'window', by: 'header' };
        if (k === 'OPENINGMARK') return { kind: 'window', by: 'header (OPENING MARK: read as windows, as the native parser does)' };
    }
    // No header: what the marks in column A are.
    const marks = sheet.rows().map(([, cells]) => cells.find(c => c.col === 1)?.text || '').filter(Boolean);
    const openings = marks.map(N.parseOpeningMark).filter(m => m.code && m.widthBand), walls = marks.map(N.parseWallMark).filter(m => m.code && m.heightBand && m.stud);
    if (marks.length && openings.length >= marks.length * 0.8) {
        const doors = openings.filter(m => m.categories.some(c => /^DOOR$/i.test(c))).length, windows = openings.filter(m => m.categories.some(c => /^WINDOW$/i.test(c))).length;
        if (doors && !windows) return { kind: 'door', by: 'marks' };
        if (windows && !doors) return { kind: 'window', by: 'marks' };
    }
    if (marks.length && walls.length >= marks.length * 0.8) return { kind: 'wall', by: 'marks' };
    return { kind: null, by: '' };
}
// A headerless opening sheet's columns from the marks: the column whose cells agree with a mark field on most rows.
function inferOpeningColumns(sheet) {
    const rows = sheet.rows().map(([r, cells]) => ({ r, mark: N.parseOpeningMark(cells.find(c => c.col === 1)?.text || ''), cells })).filter(x => x.mark.code && x.mark.widthBand);
    const fields = {
        wallHeight: (m, t) => m.wallHeight && near(N.parseFeet(t), m.wallHeight.feet),
        aboveOpening: (m, t) => m.aboveOpening && near(N.parseFeet(t), m.aboveOpening.feet),
        width: (m, t) => { const b = N.parseRange(t); return !!b && near(b.minimumFeet, m.widthBand.minimumFeet) && near(b.maximumFeet, m.widthBand.maximumFeet); },
        header: (m, t) => m.header && N.sameMember(N.readMember(t), m.header.member),
        jamb: (m, t) => m.jamb && N.sameMember(N.readMember(t), m.jamb.member),
        sill: (m, t) => m.sill && N.sameMember(N.readMember(t), m.sill.member),
    };
    const cols = { mark: 1 }, evidence = {};
    for (const [role, agrees] of Object.entries(fields)) {
        let best = null;
        for (let c = 2; c <= sheet.lastColumn; c++) {
            if (Object.values(cols).includes(c)) continue;
            const n = rows.filter(x => agrees(x.mark, sheet.cell(x.r, c)?.text ?? '')).length;
            if (!best || n > best.n) best = { c, n };
        }
        if (best && best.n >= Math.max(3, rows.length * 0.8)) { cols[role] = best.c; evidence[role] = `${best.n} of ${rows.length} rows agree with the marks`; }
    }
    return { cols, evidence, rows: rows.length };
}
const near = (a, b, tol = 1 / 384) => a != null && b != null && Math.abs(a - b) <= tol; // within 1/32"

// --- The workbook --------------------------------------------------------------------------------------------------------
export function readCriteriaWorkbook(xlsx) {
    // The reader's own notes, except formulas: those are reported on the criteria rows they belong to (one place).
    const issues = (xlsx.issues || []).filter(i => !/^xlsx\.formula_/.test(i.code)).map(i => ({ code: i.code, severity: 'info', sheet: i.sheet, row: null, subject: i.ref, message: i.message }));
    const issue = (code, severity, sheet, row, subject, message) => issues.push({ code, severity, sheet, row, subject, message });
    const found = xlsx.sheets.map(sheet => ({ sheet, ...classify(sheet) }));
    const sheets = [], rows = [];
    // Header rows first (a headerless sheet may follow a sibling's).
    for (const f of found) {
        if (!f.kind) { issue('sheet.not_criteria', 'info', f.sheet.name, null, '', 'Not read: no criteria header and its first column is not criteria marks.'); continue; }
        const fam = family(f.kind);
        let best = null;
        for (let r = 1; r <= Math.min(f.sheet.lastRow, 50); r++) { const h = rolesFrom(fam, headerAt(f.sheet, r)); const s = score(fam, h.cols); if (!best || s > best.score) best = { row: r, score: s, ...h }; }
        f.header = best && best.score >= 4 ? { row: best.row, inferred: false, cols: best.cols, names: best.names, evidence: {} } : null;
    }
    for (const f of found.filter(x => x.kind)) {
        if (!f.header) {
            if (family(f.kind) !== 'opening') { issue('sheet.header_not_found', 'error', f.sheet.name, null, '', 'Required criteria columns were not found, and the columns could not be told from the marks.'); continue; }
            const inf = inferOpeningColumns(f.sheet);
            const sibling = found.find(x => x !== f && x.header && !x.header.inferred && family(x.kind) === 'opening' && Object.entries(inf.cols).every(([role, c]) => x.header.cols[role] === c));
            const cols = sibling ? { ...sibling.header.cols, ...inf.cols } : inf.cols;
            const names = sibling ? Object.fromEntries(Object.entries(sibling.header.names).map(([c, t]) => [c, t])) : {};
            f.header = { row: null, inferred: true, cols, names, evidence: inf.evidence, sibling: sibling?.sheet.name ?? null };
            issue('sheet.header_inferred', 'needs-review', f.sheet.name, null, '', `No header row: columns ${Object.entries(inf.cols).filter(([r]) => r !== 'mark').map(([r, c]) => `${columnName(c)} (${r})`).join(', ')} were matched to the marks`
                + (sibling ? `; the other columns are named as in "${sibling.sheet.name}", whose layout agrees.` : '; the other columns are kept unnamed.') + ' Check them before relying on this sheet.');
            if (Object.keys(inf.cols).length < 4) issue('sheet.header_weak', 'error', f.sheet.name, null, '', 'Too few columns agree with the marks to read this sheet.');
        }
        sheets.push({ name: f.sheet.name, kind: f.kind, classifiedBy: f.by, header: { row: f.header.row, inferred: f.header.inferred, sibling: f.header.sibling ?? null,
            columns: Object.fromEntries(Object.entries(f.header.cols).map(([r, c]) => [r, { column: columnName(c), header: f.header.names[c] ?? null }])), evidence: f.header.evidence } });
        const meta = metaHeader(f.sheet);
        // Rows above the header are read when they are criteria rows (a mark and at least four criteria columns filled:
        // the native parser's rule); anything else above it is an instruction row.
        const criteriaCols = (family(f.kind) === 'wall' ? ['type', 'finish', 'maxHeight', 'spacing', 'stud', 'bottomTrack', 'topTrack']
            : ['wallHeight', 'aboveOpening', 'width', 'header', 'jamb', 'depth', 'openingType', 'finish']).map(k => f.header.cols[k]).filter(Boolean);
        let above = 0;
        for (const [r, cells] of f.sheet.rows()) {
            if (r === f.header.row) continue;
            const markCell = f.sheet.cell(r, f.header.cols.mark);
            if (!markCell?.text.trim()) continue;
            if (f.header.row && r < f.header.row) {
                if (criteriaCols.filter(c => String(f.sheet.cell(r, c)?.text ?? '').trim()).length < 4) continue;
                above++;
            }
            const first = norm(f.sheet.cell(r, 1)?.text);
            if (first === 'WALLMARK' || first.endsWith('OPENINGMARK')) continue; // a repeated header
            rows.push(readRow(f, r, cells, meta, issue));
        }
        if (above) issue('sheet.rows_above_header', 'info', f.sheet.name, f.header.row, '', `${above} criteria row${above === 1 ? '' : 's'} above the header (row ${f.header.row}) were read: the header is not in row 1.`);
    }
    crossChecks(rows, issue);
    nativeNames(rows, issue);
    return { format: REVIEW_FORMAT, version: REVIEW_VERSION, workbookSha256: xlsx.sha256, sheets, rows, issues };
}

// Two reads of a GUID-enabled workbook compared by KEY_ID only (never a code, a label or a row's place): per identity,
// new | unchanged | revised (an engineering cell changed) | renamed (the display code only) | aliases-changed (template
// alias or older names only: presentation outside the catalog, no revision needed) | deleted | restored | missing (in
// the earlier read only: kept, never taken as deleted). A revised, renamed, deleted or restored row needs a higher
// REVISION, or it is a conflict.
const PRESENTATION_ROLES = new Set(['templateAlias', 'aliases']);
export function compareByIdentity(before, after) {
    const content = (r) => JSON.stringify({ kind: r.kind, cells: r.source.cells.filter(c => !String(c.role || '').startsWith('identity:') && !PRESENTATION_ROLES.has(c.role))
        .map(c => [c.role || c.header || c.ref.replace(/\d+$/, ''), c.text]).sort((a, b) => (a[0] < b[0] ? -1 : 1)) });
    const aliasesOf = (r) => JSON.stringify([r.presentation.templateAlias, r.presentation.aliases]);
    const map = (read) => new Map(read.rows.filter(r => r.identity).map(r => [r.identity.keyId, r]));
    const a = map(before), b = map(after), out = [];
    for (const [keyId, r] of b) {
        const old = a.get(keyId);
        if (!old) { out.push({ keyId, change: 'new', displayCode: r.presentation.displayCode, revision: r.identity.revision }); continue; }
        const same = content(old) === content(r), renamed = old.identity.displayCode !== r.identity.displayCode;
        const change = r.identity.isDeleted && !old.identity.isDeleted ? 'deleted' : !r.identity.isDeleted && old.identity.isDeleted ? 'restored'
            : !same ? 'revised' : renamed ? 'renamed' : aliasesOf(old) !== aliasesOf(r) ? 'aliases-changed' : 'unchanged';
        const entry = { keyId, change, displayCode: r.presentation.displayCode, previousCode: old.presentation.displayCode, revision: r.identity.revision, previousRevision: old.identity.revision };
        if (change !== 'unchanged' && change !== 'aliases-changed' && r.identity.revision <= old.identity.revision) entry.conflict = `Changed at the same revision (${r.identity.revision}): raise REVISION when a row changes.`;
        if (r.identity.revision < old.identity.revision) entry.conflict = `Revision went down (${old.identity.revision} to ${r.identity.revision}).`;
        out.push(entry);
    }
    for (const [keyId, r] of a) if (!b.has(keyId)) out.push({ keyId, change: 'missing', displayCode: r.presentation.displayCode, note: 'Not in the newer workbook: kept as it was (only an IS_DELETED row deletes).' });
    return out.sort((x, y) => (x.keyId < y.keyId ? -1 : 1));
}

// What the native parser would call each row (CriteriaKeyName, WallStyleKeyAllocator, OpeningStyleKeyAllocator), shown
// beside the authored code for comparison only: it renumbers walls by stud-depth group in workbook order, so a code
// authored out of that order (or twice) gets another number. Authored codes are kept here; nothing is renumbered.
const clean = (s) => String(s ?? '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
const prefixOf = (mark) => /^\s*([A-Za-z0-9]+)/.exec(mark || '')?.[1]?.toUpperCase() || 'KEY';
function nativeNames(rows, issue) {
    const next = new Map(), differs = new Map();
    for (const r of rows) {
        let code;
        if (r.kind === 'wall') {
            const depth = Number(r.used.depthCode);
            if (depth > 0) { const g = String(Math.max(1, Math.floor(depth / 100))), n = (next.get(g) || 0) + 1; next.set(g, n); code = `${g}${String(n).padStart(2, '0')}`; }
            else code = `${prefixOf(r.source.mark)}-${clean(r.values.finish.text) || clean(r.source.mark.split('_')[1]) || 'WALL'}`;
        } else {
            const style = /^\s*(\d{3,})\b/.exec(r.values.wallStyle.text)?.[1] ?? r.values.wallStyle.text.trim();
            if (style) { const k = `${style}|${r.kind}`, n = (next.get(k) || 0) + 1; next.set(k, n); code = `${style}-${r.kind === 'door' ? 'D' : 'W'}${String(n).padStart(2, '0')}`; }
            else code = `${prefixOf(r.source.mark)}-${r.kind === 'door' ? 'DOOR' : 'WINDOW'}${clean(r.used.finish) ? `-${clean(r.used.finish)}` : ''}`;
        }
        r.presentation.nativeCode = code;
        if (code !== r.presentation.sourceCode) (differs.get(r.source.sheet) || differs.set(r.source.sheet, []).get(r.source.sheet)).push(r);
    }
    for (const [sheet, list] of differs) issue('presentation.native_code_differs', 'info', sheet, null, '',
        `${list.length} row${list.length === 1 ? '' : 's'} would be named differently by the native parser (e.g. ${list.slice(0, 3).map(r => `${r.presentation.sourceCode} → ${r.presentation.nativeCode}`).join(', ')}). The authored codes are kept; the native names are shown for comparison.`);
}

// The identity columns' places (all eight in one row among the first 30), or null (browse only).
function metaHeader(sheet) {
    for (let r = 1; r <= Math.min(sheet.lastRow, 30); r++) {
        const at = {};
        for (let c = 1; c <= sheet.lastColumn; c++) { const t = String(sheet.cell(r, c)?.text ?? '').trim(); if (META.includes(t)) at[t] = c; }
        if (META.every(k => at[k])) return { row: r, at };
    }
    return null;
}

function readRow(f, r, cells, meta, issue) {
    const sheet = f.sheet, cols = f.header.cols, fam = family(f.kind);
    const text = (role) => (cols[role] ? sheet.cell(r, cols[role])?.text ?? '' : '');
    const roleOf = Object.fromEntries(Object.entries(cols).map(([role, c]) => [c, role]));
    const metaCols = meta ? Object.fromEntries(Object.entries(meta.at).map(([k, c]) => [c, k])) : {};
    const mark = text('mark');
    const source = { sheet: sheet.name, row: r, mark,
        cells: cells.map(c => ({ ref: c.ref, header: f.header.names[c.col] ?? (metaCols[c.col] || null), role: roleOf[c.col] ?? (metaCols[c.col] ? `identity:${metaCols[c.col]}` : null), text: c.text,
            ...(c.formula != null ? { formula: c.formula, cached: c.cached } : {}) })) };
    for (const c of cells) if (c.formula != null && !c.cached) issue('cell.formula_not_calculated', 'needs-review', sheet.name, r, c.ref, `${c.ref}: a formula with no saved result: its value is not known (recalculate and save in Excel).`);
    const row = { id: `${sheet.name}!${r}`, kind: f.kind, styleType: KINDS[f.kind], excluded: norm(text('include')) === 'NO', source, name: null, values: {}, presentation: null, identity: null, discrepancies: [], notes: [] };
    const differ = (field, nameText, columnText, message) => row.discrepancies.push({ field, name: nameText, column: columnText, message });
    if (fam === 'wall') {
        const name = row.name = N.parseWallMark(mark), v = row.values;
        v.type = { text: text('type') }; v.finish = { text: text('finish') };
        v.maxHeight = N.readLength(text('maxHeight')); v.spacing = N.readLength(text('spacing'), N.parseSpacingFeet);
        v.stud = N.readMember(text('stud')); v.bottomTrack = N.readMember(text('bottomTrack')); v.topTrack = N.readMember(text('topTrack'));
        v.deflection = N.readLength(text('deflection')); v.additional = { text: text('additional') }; v.wallTypeNote = { text: text('wallTypeNote') }; v.buildingNote = { text: text('buildingNote') };
        if (name.unread.length) row.notes.push(...name.unread.map(u => `Mark field ${u.position} "${u.text}" is not a ${u.expected}.`));
        if (cols.type && name.typeToken && norm(name.typeToken) !== norm(v.type.text)) differ('type', name.typeToken, v.type.text, `The mark's type ${name.typeToken} differs from the TYPE column (${v.type.text || 'blank'}).`);
        if (cols.finish && name.finishCondition) {
            const a = name.finishCondition.toUpperCase(), b = v.finish.text.trim().toUpperCase();
            if (b && a !== b && a.startsWith(b)) row.notes.push(`The mark's finish condition ${name.finishCondition} adds to the FINISH column's ${v.finish.text}.`);
            else if (a !== b) differ('finish', name.finishCondition, v.finish.text, `The mark's finish condition ${name.finishCondition} differs from the FINISH column (${v.finish.text || 'blank'}).`);
        }
        if (cols.maxHeight && name.heightBand && v.maxHeight.feet != null && !near(name.heightBand.maximumFeet, v.maxHeight.feet))
            differ('maxHeight', name.heightBand.text, v.maxHeight.text, `The mark's height band ends at ${N.formatLength(name.heightBand.maximumFeet)}; the SPECIFIC MAX HEIGHT column says ${N.formatLength(v.maxHeight.feet)}.`);
        if (cols.stud && name.stud && v.stud.state === 'value' && !N.sameMember(name.stud.member, v.stud))
            differ('stud', name.stud.member.text, v.stud.text, `The mark's stud ${name.stud.member.canonical} differs from the STUD SIZE column (${v.stud.canonical}).`);
        if (cols.spacing && name.stud && v.spacing.feet != null && !near(name.stud.spacingFeet, v.spacing.feet))
            differ('spacing', name.stud.spacingText, v.spacing.text, `The mark's spacing ${N.formatInches(name.stud.spacingFeet)} differs from the SPACING column (${N.formatInches(v.spacing.feet)}).`);
        if (cols.additional && name.extra.length && norm(name.extra.join(' ')) !== norm(v.additional.text))
            differ('additional', name.extra.join('_'), v.additional.text, `The mark's additional condition ${name.extra.join('_')} differs from its column (${v.additional.text || 'blank'}).`);
        // The values used are the columns' (the mark only where a column is missing or blank).
        // The values used are the columns'. Only a blank column falls back to the mark (as the native parser does), and
        // says so; VARIES, TBD, N/A or an unreadable cell is never replaced by the mark's value or a default.
        const fromColumn = (cell, nameValue, label) => {
            if (cell.state === 'value' || cell.state === 'zero') return cell.feet;
            if (cell.state === 'blank' && nameValue != null) { row.notes.push(`${label} is blank: the mark's value is used.`); return nameValue; }
            if (cell.state !== 'blank') issue('row.value_not_given', 'needs-review', sheet.name, r, label, `${name.code}: ${label} is ${cell.state === 'unreadable' ? `unreadable ("${cell.text}")` : cell.text.trim().toUpperCase()}: no value is taken (not the mark's, not a default).`);
            return null;
        };
        const maxH = fromColumn(v.maxHeight, name.heightBand?.maximumFeet ?? null, 'SPECIFIC MAX HEIGHT'), spacing = fromColumn(v.spacing, name.stud?.spacingFeet ?? null, 'SPACING');
        const stud = v.stud.state === 'value' ? v.stud : v.stud.state === 'blank' && name.stud ? name.stud.member : v.stud;
        for (const [k, label] of [['stud', 'STUD SIZE'], ['bottomTrack', 'BOTTOM TRACK'], ['topTrack', 'TOP TRACK']])
            if (!['value', 'blank', 'not-applicable'].includes(v[k].state)) issue('row.value_not_given', 'needs-review', sheet.name, r, label, `${name.code}: ${label} is ${v[k].state === 'unreadable' ? `unreadable ("${v[k].text}": ${v[k].error})` : v[k].text.trim().toUpperCase()}: no member is taken.`);
        row.used = { minimumHeightFeet: name.heightBand?.minimumFeet ?? null, maximumHeightFeet: maxH, spacingFeet: spacing, stud: stud.canonical || null, depthCode: depthOf(stud) };
        row.presentation = present(row, name.code, (code) => N.wallLabel({ code, maximumHeightFeet: maxH, stud, spacingFeet: spacing }), text);
    } else {
        const name = row.name = N.parseOpeningMark(mark), v = row.values;
        v.wallHeight = N.readLength(text('wallHeight')); v.aboveOpening = N.readLength(text('aboveOpening'));
        const widthText = cols.minWidth ? `${text('minWidth')} TO ${text('width')}` : text('width');
        v.width = { text: widthText, ...(cols.minWidth ? { minimumFeet: N.parseFeet(text('minWidth')), maximumFeet: N.parseFeet(text('width')) } : N.parseRange(widthText) ?? { minimumFeet: null, maximumFeet: N.parseFeet(widthText) }) };
        v.header = N.readMember(text('header')); v.jamb = N.readMember(text('jamb')); v.sill = N.readMember(text('sill'));
        v.wallTypeNote = { text: text('wallTypeNote') }; v.finish = { text: text('finish') }; v.wallStyle = { text: text('wallStyle') }; v.depth = { text: text('depth') }; v.openingType = { text: text('openingType') };
        if (name.unread.length) row.notes.push(...name.unread.map(u => `Mark field ${u.position} "${u.text}" is not a ${u.expected}.`));
        const category = f.kind.toUpperCase();
        if (name.categories.length && !name.categories.some(c => c.toUpperCase() === category)) differ('category', name.categories.join('/'), f.kind, `The mark says ${name.categories.join('/')} on the ${f.kind} sheet.`);
        if (name.widthBand && (v.width.minimumFeet != null || v.width.maximumFeet != null) && !(near(name.widthBand.minimumFeet, v.width.minimumFeet ?? name.widthBand.minimumFeet) && near(name.widthBand.maximumFeet, v.width.maximumFeet)))
            differ('width', name.widthBand.text, widthText, `The mark's width band ${name.widthBand.text.trim()} differs from the width column (${widthText.trim()}).`);
        for (const [k, label] of [['wallHeight', 'MAX HEIGHT OF WALL'], ['aboveOpening', 'MAX HEIGHT ABOVE OPENING']])
            if (cols[k] && name[k] && v[k].feet != null && !near(name[k].feet, v[k].feet)) differ(k, name[k].text, v[k].text, `The mark says ${N.formatLength(name[k].feet)}; the ${label} column says ${N.formatLength(v[k].feet)}.`);
        for (const [k, label] of [['header', 'HEADER'], ['jamb', 'JAMB'], ['sill', 'SILL']])
            if (cols[k] && name[k] && v[k].state !== 'blank' && !N.sameMember(name[k].member, v[k])) differ(k, name[k].member.text, v[k].text, `The mark's ${label.toLowerCase()} ${name[k].member.canonical || name[k].member.text} differs from the ${label} column (${v[k].canonical || v[k].text}).`);
        if (cols.finish && name.finish && v.finish.text && norm(name.finish) !== norm(v.finish.text)) differ('finish', name.finish, v.finish.text, `The mark's finish ${name.finish} differs from the FINISH column (${v.finish.text}).`);
        for (const k of ['header', 'jamb', 'sill']) { const m = v[k].state === 'value' ? v[k] : name[k]?.member; if (m?.alternatives > 1) row.notes.push(`${k}: ${m.alternatives} alternatives (OR): one of them is chosen; never all placed.`); if (m?.combined) row.notes.push(`${k}: combined parts (WITH / +): how they sit together is not given here; choose an arrangement before framing.`); }
        const pick = (k) => (v[k].state !== 'blank' || !name[k] ? v[k] : (row.notes.push(`${k} column is blank: the mark's ${name[k].member.canonical || name[k].member.text} is used.`), name[k].member));
        for (const k of ['header', 'jamb', 'sill']) if (['varies', 'to-be-determined', 'ignore', 'unreadable'].includes(v[k].state))
            issue('row.value_not_given', 'needs-review', sheet.name, r, k, `${name.code}: the ${k} column is ${v[k].state === 'unreadable' ? `unreadable ("${v[k].text}")` : v[k].text.trim().toUpperCase()}: no member is taken.`);
        for (const k of ['wallHeight', 'aboveOpening']) if (['varies', 'to-be-determined', 'ignore', 'unreadable', 'not-applicable'].includes(v[k].state))
            issue('row.value_not_given', 'needs-review', sheet.name, r, k, `${name.code}: ${k === 'wallHeight' ? 'MAX HEIGHT OF WALL' : 'MAX HEIGHT ABOVE OPENING'} is ${v[k].text.trim().toUpperCase()}: no value is taken.`);
        const widthBlank = !String(widthText).replace(/\bTO\b/i, '').trim();
        row.used = { minimumWidthFeet: widthBlank ? name.widthBand?.minimumFeet ?? null : v.width.minimumFeet, maximumWidthFeet: widthBlank ? name.widthBand?.maximumFeet ?? null : v.width.maximumFeet,
            wallHeightFeet: v.wallHeight.state === 'blank' ? name.wallHeight?.feet ?? null : v.wallHeight.feet, aboveOpeningFeet: v.aboveOpening.state === 'blank' ? name.aboveOpening?.feet ?? null : v.aboveOpening.feet,
            header: pick('header').canonical || null, jamb: pick('jamb').canonical || null, sill: pick('sill').canonical || null,
            depthCode: v.depth.text || /^(\d{3,4})/.exec(name.code)?.[1] || '', finish: v.finish.text || name.finish };
        row.presentation = present(row, name.code, (code) => N.openingLabel({ code, minimumWidthFeet: row.used.minimumWidthFeet, maximumWidthFeet: row.used.maximumWidthFeet, aboveOpeningFeet: row.used.aboveOpeningFeet,
            header: pick('header'), jamb: pick('jamb'), sill: pick('sill') }), text);
    }
    row.identity = meta ? identityOf(sheet, r, meta, issue) : null;
    if (row.identity && row.identity.displayCode !== row.presentation.sourceCode) row.notes.push(`DISPLAY_CODE ${row.identity.displayCode} is shown for this row; the mark's own code is ${row.presentation.sourceCode}.`);
    if (row.identity) { row.presentation.displayCode = row.identity.displayCode; row.presentation.displayLabel = row.presentation.label(row.identity.displayCode); }
    delete row.presentation.label;
    for (const d of row.discrepancies) issue('row.name_column_differs', 'needs-review', sheet.name, r, d.field, `${row.presentation.displayCode}: ${d.message}`);
    return row;
}
const depthOf = (m) => m?.spec?.alternatives?.[0]?.[0]?.designator.depthCode ?? '';
// Presentation: the code as authored (never renumbered), the compact label, a template alias and older names as written.
function present(row, sourceCode, label, text) {
    const aliases = String(text('aliases') || '').split(/[;\n]/).map(s => s.trim()).filter(Boolean);
    return { sourceCode, displayCode: sourceCode, displayLabel: label(sourceCode), templateAlias: text('templateAlias') || null, aliases, label };
}
function identityOf(sheet, r, meta, issue) {
    const cell = (k) => sheet.cell(r, meta.at[k]), t = (k) => String(cell(k)?.text ?? '').trim(), problems = [];
    if (META.every(k => !t(k))) { issue('identity.missing', 'needs-review', sheet.name, r, 'KEY_ID', 'This row has no catalog identity (browse only): identities are issued once, in Excel, never here.'); return null; }
    for (const k of META) if (cell(k)?.formula != null) problems.push(`${k} must be a stored value, not a formula`);
    if (!GUID.test(t('CAS_CATALOG_ID')) || /^0{8}-/.test(t('CAS_CATALOG_ID'))) problems.push('CAS_CATALOG_ID must be an authored GUID');
    if (!GUID.test(t('KEY_ID')) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(t('KEY_ID'))) problems.push('KEY_ID must be an authored GUID, not a style code');
    if (!/^\d+$/.test(t('REVISION')) || Number(t('REVISION')) < 1) problems.push('REVISION must be a whole number from 1');
    if (!/(Z|\+00:00)$/.test(t('MODIFIED_UTC')) || Number.isNaN(Date.parse(t('MODIFIED_UTC')))) problems.push('MODIFIED_UTC must be a UTC time (Z or +00:00)');
    if (!/^(TRUE|FALSE)$/i.test(t('IS_DELETED'))) problems.push('IS_DELETED must be TRUE or FALSE');
    if (!t('DISPLAY_CODE')) problems.push('DISPLAY_CODE is blank');
    if (problems.length) { issue('identity.invalid', 'error', sheet.name, r, 'KEY_ID', `${problems.join('; ')}.`); return null; }
    return { catalogId: t('CAS_CATALOG_ID').toLowerCase(), keyId: t('KEY_ID').toLowerCase(), displayCode: t('DISPLAY_CODE'), revision: Number(t('REVISION')), modifiedUtc: t('MODIFIED_UTC'),
        sourceTable: t('SOURCE_TABLE'), sourceVersion: t('SOURCE_VERSION'), isDeleted: /^TRUE$/i.test(t('IS_DELETED')) };
}

// --- Across rows: identity, labels, bands --------------------------------------------------------------------------------
function crossChecks(rows, issue) {
    const live = rows.filter(r => !r.excluded);
    const byKey = new Map();
    for (const r of live.filter(x => x.identity)) {
        const prev = byKey.get(r.identity.keyId);
        if (prev) issue(prev.styleType === r.styleType ? 'identity.duplicate_key' : 'identity.key_reused_across_types', 'error', r.source.sheet, r.source.row, r.identity.keyId,
            `KEY_ID ${r.identity.keyId} is on ${prev.id} and ${r.id}${prev.styleType === r.styleType ? '' : ` (a ${prev.styleType} and a ${r.styleType}: an identity never moves to another type)`}.`);
        else byKey.set(r.identity.keyId, r);
    }
    const catalogs = [...new Set(live.filter(x => x.identity).map(x => x.identity.catalogId))];
    if (catalogs.length > 1) issue('identity.mixed_catalogs', 'error', '', null, '', `Rows name ${catalogs.length} different catalogs (CAS_CATALOG_ID).`);
    for (const [what, get, why] of [['code', r => r.presentation.displayCode, 'a code is not an identity'], ['label', r => r.presentation.displayLabel, 'pick by the row, never by its text']]) {
        const groups = new Map();
        for (const r of live) { const k = `${r.styleType}|${get(r)}`; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
        for (const list of groups.values()) if (list.length > 1) issue(`presentation.duplicate_${what}`, 'info', list[0].source.sheet, list[0].source.row, get(list[0]),
            `${list.length} ${list[0].styleType.toLowerCase()} rows show the same ${what} "${get(list[0])}" (${list.map(r => r.id).join(', ')}): allowed (${why}).`);
    }
    // Walls: the same core, type and finish over heights that overlap.
    const walls = live.filter(r => r.kind === 'wall' && r.used.maximumHeightFeet != null && r.used.minimumHeightFeet != null);
    for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
        const a = walls[i], b = walls[j];
        if (a.used.depthCode !== b.used.depthCode || norm(a.values.type.text) !== norm(b.values.type.text) || norm(a.values.finish.text) !== norm(b.values.finish.text)) continue;
        const ba = { minimumFeet: a.used.minimumHeightFeet, maximumFeet: a.used.maximumHeightFeet }, bb = { minimumFeet: b.used.minimumHeightFeet, maximumFeet: b.used.maximumHeightFeet };
        if (!N.bandsOverlap(ba, bb)) continue;
        const notes = ['additional', 'wallTypeNote', 'buildingNote'].filter(k => norm(a.values[k].text) !== norm(b.values[k].text));
        issue(notes.length ? 'band.overlap_by_notes' : 'band.ambiguous', notes.length ? 'info' : 'needs-review', a.source.sheet, a.source.row, `${a.presentation.displayCode} / ${b.presentation.displayCode}`,
            `${a.presentation.displayCode} and ${b.presentation.displayCode} cover overlapping heights (${N.formatLength(Math.max(ba.minimumFeet, bb.minimumFeet))} to ${N.formatLength(Math.min(ba.maximumFeet, bb.maximumFeet))}) for ${a.used.depthCode} ${a.values.type.text} ${a.values.finish.text}`
            + (notes.length ? `; they differ by ${notes.map(k => ({ additional: 'the additional condition', wallTypeNote: 'WALL TYPE', buildingNote: 'BLDG.' })[k]).join(' and ')}: those notes decide, not this tool.` : ': nothing tells them apart.'));
    }
    // Openings: the same kind, core and finish, overlapping widths, at the same wall-height and above-opening limits.
    const ops = live.filter(r => r.kind !== 'wall' && r.used.maximumWidthFeet != null);
    for (let i = 0; i < ops.length; i++) for (let j = i + 1; j < ops.length; j++) {
        const a = ops[i], b = ops[j];
        if (a.kind !== b.kind || a.used.depthCode !== b.used.depthCode || norm(a.used.finish) !== norm(b.used.finish) || !near(a.used.wallHeightFeet, b.used.wallHeightFeet) || !near(a.used.aboveOpeningFeet, b.used.aboveOpeningFeet)) continue;
        if (!N.bandsOverlap({ minimumFeet: a.used.minimumWidthFeet ?? 0, maximumFeet: a.used.maximumWidthFeet }, { minimumFeet: b.used.minimumWidthFeet ?? 0, maximumFeet: b.used.maximumWidthFeet })) continue;
        const notes = norm(a.values.wallTypeNote.text) !== norm(b.values.wallTypeNote.text);
        issue(notes ? 'band.overlap_by_notes' : 'band.ambiguous', notes ? 'info' : 'needs-review', a.source.sheet, a.source.row, `${a.presentation.displayCode} / ${b.presentation.displayCode}`,
            `${a.presentation.displayCode} and ${b.presentation.displayCode} cover overlapping widths at the same limits${notes ? ': they differ by WALL TYPE (the notes decide).' : ': nothing tells them apart.'}`);
    }
}
