// The engineering style catalog on the web, for picking a panel's members from the engineering tables (a prototype of
// the native CAS_FRAMING popup's selection). Three parts, all pure (no DOM, storage, clock or random numbers: times are
// passed in, nothing here issues an identity):
//
//   1. The catalog: the native JSON (CAS_FRAMING.Core EngineeringMapping StyleCatalog, schema 1; written by the native
//      Excel adapter from a GUID-enabled workbook copy) read with the native codec and validator's rules
//      (StyleCatalogCodec, StyleCatalogValidator): readStyleCatalog(text). Never written back from here: the web keeps
//      the text as read and names it by its SHA-256, so no value is re-serialized (a C# decimal is not a JS number).
//   2. The project selection (cas-style-selection v1), kept beside the catalog, never inside it: which rows this project
//      uses, each row's review of its extraction against the source table (candidate / reviewed / rejected, by whom,
//      when, at which row revision), and a named person's approval of the subset, pinned to the catalog revision and
//      text it was given against. A review or approval here is a record of people checking the catalog; it is not a
//      structural check by this tool and not an engineer of record's stamp.
//   3. Matching and outputs: the native matchers (PreliminaryWallStyleMatcher, OpeningCriteriaResolver,
//      CriteriaBandResolver) for the panel dropdowns, and the rows' member outputs read with the native member parser
//      (MemberSpecParser, CfsDesignatorParser) into the generator's member text.
//
// A row is known by its KEY_ID (a GUID), never by its display code (two rows may share one) or a Revit name or
// ElementId. The contract is in docs/style-catalog-contract.md; reviewed fixtures in tests/fixtures/style-catalog/.
import { sha256Hex } from '../common/sha256.mjs';
import { scanJson } from './exchange.mjs';
import * as G from './generator.mjs';
import { parseDesignator, parseMemberSpec } from './criteria-names.mjs';

export const CATALOG_SCHEMA_VERSION = 1;
export const SELECTION_FORMAT = 'cas-style-selection', SELECTION_VERSION = 1;
export const STYLE_TYPES = ['Wall', 'Door', 'Window', 'Ceiling'];
export const VALUE_KINDS = ['Text', 'Number', 'Boolean'];
export const CHANGE_KINDS = ['Added', 'Updated', 'Deleted', 'Restored'];
export const REVIEW_STATES = ['candidate', 'reviewed', 'rejected'];
const MAX_BYTES = 8 * 1024 * 1024, MAX_DEPTH = 16; // StyleCatalogCodec.MaximumPayloadBytes, MaxDepth
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, EMPTY_GUID = '00000000-0000-0000-0000-000000000000';
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const fail = (message) => { throw new Error(message); };
const require_ = (valid, message) => { if (!valid) fail(message); };

// --- 1. Reading the catalog ------------------------------------------------------------------------------------------
// As System.Text.Json reads it (camelCase names, case-sensitive; enums as names, case-insensitive, never numbers; GUIDs
// in the 36-character form; times ISO 8601 with an offset), then StyleCatalogValidator's rules and messages. Unknown
// properties are skipped as the native reader skips them, and listed in `ignored`.
const SHAPES = {
    catalog: { schemaVersion: 'int', catalogId: 'guid', revision: 'long', sources: ['source'], styles: ['row'], changeLog: ['change'] },
    source: { sourceId: 'guid', importBatchId: 'guid', tableName: 'string', version: 'string', workbookSha256: 'string', importedUtc: 'time' },
    row: { KEY_ID: 'guid', styleType: 'styleType', displayCode: 'string', revision: 'long', modifiedUtc: 'time', sourceId: 'guid', isDeleted: 'bool', conditions: '{value}', outputs: '{value}' },
    value: { kind: 'valueKind', text: 'string?', number: 'number?', boolean: 'bool?', unit: 'string?' },
    change: { changeId: 'guid', keyId: 'guid', rowRevision: 'long', sourceId: 'guid', kind: 'changeKind', publishedUtc: 'time' },
};
const REQUIRED = { catalog: ['schemaVersion', 'revision', 'sources', 'styles', 'changeLog'], source: [], row: ['styleType', 'isDeleted', 'conditions', 'outputs'], value: ['kind'], change: ['kind'] };
const DEFAULTS = { int: 0, long: 0, guid: EMPTY_GUID, string: '', time: null, bool: false, 'string?': null, 'number?': null, 'bool?': null };
const ENUMS = { styleType: STYLE_TYPES, valueKind: VALUE_KINDS, changeKind: CHANGE_KINDS };
const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,16})?)?(Z|[+-]\d{2}:\d{2})$/;

function convert(type, v, path, ignored) {
    const bad = () => fail(`The JSON value could not be converted (${path}).`);
    if (Array.isArray(type)) { if (v === null) return null; if (!Array.isArray(v)) bad(); return v.map((x, i) => (x === null ? null : convert(type[0], x, `${path}[${i}]`, ignored))); }
    if (type === '{value}') {
        if (v === null) return null;
        if (!isObj(v)) bad();
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === null ? null : convert('value', x, `${path}.${k}`, ignored)]));
    }
    if (SHAPES[type]) {
        if (!isObj(v)) bad();
        const missing = REQUIRED[type].filter(k => !(k in v));
        if (missing.length) fail(`The catalog JSON is missing required properties (${path}): ${missing.join(', ')}.`);
        const out = {};
        for (const [k, t] of Object.entries(SHAPES[type])) out[k] = k in v ? convert(t, v[k], `${path}.${k}`, ignored) : (t.startsWith('[') || t === '{value}' ? null : DEFAULTS[t] ?? null);
        for (const k of Object.keys(v)) if (!(k in SHAPES[type])) ignored.push(`${path}.${k}`);
        return out;
    }
    if (type.endsWith('?') && v === null) return null;
    switch (type.replace('?', '')) {
        case 'int': return Number.isInteger(v) && v >= -2147483648 && v <= 2147483647 ? v : bad();
        // A long beyond 2^53 cannot be held exactly here (the native reader would take it): refused, not rounded.
        case 'long': return Number.isSafeInteger(v) ? v : bad();
        case 'guid': return typeof v === 'string' && GUID.test(v) ? v.toLowerCase() : bad();
        case 'string': return typeof v === 'string' ? v : v === null ? null : bad();
        case 'bool': return typeof v === 'boolean' ? v : bad();
        case 'number': return typeof v === 'number' && Number.isFinite(v) ? v : bad();
        case 'time': {
            const m = typeof v === 'string' ? TIME.exec(v) : null;
            if (!m) bad();
            const [y, mo, d, h, mi, sec = 0] = m.slice(1, 7).map(x => Number(x ?? 0));
            const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0), days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
            if (!days || d < 1 || d > days || h > 23 || mi > 59 || sec > 59) bad();
            return v;
        }
        default: {
            const names = ENUMS[type.replace('?', '')];
            if (typeof v !== 'string') bad();
            return names.find(n => n.toLowerCase() === v.trim().toLowerCase()) ?? bad();
        }
    }
}
// UTC: an offset of zero, and not DateTimeOffset's default (0001-01-01T00:00:00).
const isUtc = (t) => typeof t === 'string' && /(Z|[+-]00:00)$/.test(t) && !/^0001-01-01T00:00(?::00(?:\.0+)?)?(Z|[+-]00:00)$/.test(t);
const utcMs = (t) => Date.parse(t.replace(/(\.\d{3})\d+/, '$1'));

// StyleCatalogValidator.Validate, rule for rule, with its messages.
export function validateCatalog(c) {
    require_(c.schemaVersion === CATALOG_SCHEMA_VERSION, 'Unsupported catalog schema version.');
    require_(c.catalogId !== EMPTY_GUID, 'Catalog ID is required.');
    require_(c.revision >= 0, 'Invalid catalog revision.');
    require_(Array.isArray(c.styles) && c.styles.length <= 10000, 'Invalid style collection or too many styles.');
    require_(Array.isArray(c.sources) && c.sources.length <= 10000, 'Invalid source collection or too many sources.');
    require_(Array.isArray(c.changeLog) && c.changeLog.length <= 50000, 'Invalid change log or too many changes.');
    const text = (v, label) => require_(typeof v === 'string' && v.trim() !== '' && v.length <= 4096, `${label} is missing or too long.`);
    const utc = (v, label) => require_(isUtc(v), `${label} must be a non-empty UTC timestamp.`);
    const sources = new Set();
    for (const s of c.sources) {
        require_(s != null, 'Null source.');
        require_(s.sourceId !== EMPTY_GUID && !sources.has(s.sourceId), 'Missing or duplicate source ID.');
        sources.add(s.sourceId);
        require_(s.importBatchId !== EMPTY_GUID, 'Import batch ID is required.');
        text(s.tableName, 'EOR table name');
        text(s.version, 'EOR table version');
        require_(typeof s.workbookSha256 === 'string' && /^[0-9a-f]{64}$/.test(s.workbookSha256), 'Workbook SHA-256 must be 64 lowercase hexadecimal characters.');
        utc(s.importedUtc, 'Source import time');
    }
    const rows = new Map();
    for (const r of c.styles) {
        require_(r != null, 'Null style.');
        require_(r.KEY_ID !== EMPTY_GUID && !rows.has(r.KEY_ID), 'Missing or duplicate KEY_ID. Legacy codes require explicit migration; no GUID is generated here.');
        rows.set(r.KEY_ID, r);
        text(r.displayCode, 'Display code');
        require_(r.revision > 0, 'Row revision must be positive.');
        utc(r.modifiedUtc, 'Row modified time');
        require_(sources.has(r.sourceId), 'Style references an unknown source.');
        values(r.conditions, text);
        values(r.outputs, text);
    }
    const changes = new Set(), rowRevisions = new Set();
    for (const ch of c.changeLog) {
        require_(ch != null, 'Null change log entry.');
        require_(ch.changeId !== EMPTY_GUID && !changes.has(ch.changeId), 'Missing or duplicate change ID.');
        changes.add(ch.changeId);
        const row = rows.get(ch.keyId);
        require_(!!row, 'Change references an unknown KEY_ID.');
        require_(ch.rowRevision > 0 && ch.rowRevision <= row.revision, 'Invalid change revision.');
        require_(!rowRevisions.has(`${ch.keyId}:${ch.rowRevision}`), 'Duplicate row revision in change log.');
        rowRevisions.add(`${ch.keyId}:${ch.rowRevision}`);
        require_(sources.has(ch.sourceId), 'Change references an unknown source.');
        utc(ch.publishedUtc, 'Change publication time');
    }
}
function values(fields, text) {
    require_(isObj(fields) && Object.keys(fields).length <= 128, 'Invalid condition/output collection.');
    for (const [k, v] of Object.entries(fields)) {
        text(k, 'Column name');
        require_(v != null, 'Null column value.');
        if (v.kind === 'Text') require_(typeof v.text === 'string' && v.text.length <= 4096 && v.number == null && v.boolean == null && v.unit == null, 'Text column has missing text or incompatible values.');
        else if (v.kind === 'Number') { require_(v.number != null && v.text == null && v.boolean == null, 'Invalid numeric column.'); text(v.unit, 'Numeric unit (use unitless when appropriate)'); }
        else require_(v.boolean != null && v.text == null && v.number == null && v.unit == null, 'Invalid boolean column.');
    }
}

// The catalog from its JSON text: { catalog (frozen), sha256 (of the text as given), ignored (unknown properties) }.
export function readStyleCatalog(text) {
    if (typeof text !== 'string' || !text.trim()) fail('Catalog is empty.');
    if (new TextEncoder().encode(text).length > MAX_BYTES) fail('Catalog exceeds the concept payload limit; no data was loaded.');
    scanJson(text, { maxDepth: MAX_DEPTH, maxArray: Infinity }); // duplicate properties, non-finite numbers, depth
    const ignored = [], catalog = convert('catalog', JSON.parse(text), '$', ignored);
    validateCatalog(catalog);
    return deepFreeze({ catalog, sha256: sha256Hex(text), ignored });
}
export const rowById = (read, keyId) => read?.catalog.styles.find(r => r.KEY_ID === String(keyId || '').toLowerCase()) || null;
export const sourceOf = (read, row) => read?.catalog.sources.find(s => s.sourceId === row?.sourceId) || null;

// A column's value: text (trimmed; '' when absent), or a length in feet (a Number in "ft"; null when absent or zero is
// meaningful to the caller; NaN when the unit is not feet: never converted by guess).
export const textOf = (fields, key) => { const v = fields?.[key]; return v?.kind === 'Text' ? v.text.trim() : v?.kind === 'Number' ? String(v.number) : ''; };
export function feetOf(fields, key) {
    const v = fields?.[key];
    if (!v) return null;
    if (v.kind !== 'Number') return NaN;
    return v.unit === 'ft' ? v.number : NaN;
}

// --- 2. The project selection ------------------------------------------------------------------------------------------
// { format, version, catalog: { catalogId, revision, sha256 }, project, styles: [{ keyId, styleType, displayCode,
//   rowRevision, review: { state, by, atUtc, note } }] (by KEY_ID), approval: { state: 'not-approved' } or
//   { state: 'approved', by, atUtc, reference, catalogRevision, catalogSha256 } }.
// Every change through these functions clears the approval (it was given for the subset as it was).
const NOT_APPROVED = Object.freeze({ state: 'not-approved' });
const sortStyles = (list) => [...list].sort((a, b) => (a.keyId < b.keyId ? -1 : a.keyId > b.keyId ? 1 : 0));
export function newSelection(read, { project = '' } = {}) {
    return { format: SELECTION_FORMAT, version: SELECTION_VERSION, catalog: { catalogId: read.catalog.catalogId, revision: read.catalog.revision, sha256: read.sha256 },
        project: String(project), styles: [], approval: { ...NOT_APPROVED } };
}
export function readSelection(input) {
    const s = typeof input === 'string' ? JSON.parse(input) : input;
    require_(isObj(s) && s.format === SELECTION_FORMAT && s.version === SELECTION_VERSION, `Expected ${SELECTION_FORMAT} version ${SELECTION_VERSION}.`);
    require_(isObj(s.catalog) && GUID.test(s.catalog.catalogId || '') && Number.isSafeInteger(s.catalog.revision) && /^[0-9a-f]{64}$/.test(s.catalog.sha256 || ''), 'The selection does not name its catalog (ID, revision and SHA-256).');
    require_(Array.isArray(s.styles), 'The selection needs a styles list.');
    const seen = new Set();
    const styles = s.styles.map(e => {
        require_(isObj(e) && GUID.test(e.keyId || '') && STYLE_TYPES.includes(e.styleType) && Number.isSafeInteger(e.rowRevision) && e.rowRevision > 0, 'Every selected style needs its KEY_ID, style type and row revision.');
        const keyId = e.keyId.toLowerCase();
        require_(!seen.has(keyId), `A style is selected twice: ${keyId}.`);
        seen.add(keyId);
        const r = e.review;
        require_(isObj(r) && REVIEW_STATES.includes(r.state), `${keyId}: the review state must be one of ${REVIEW_STATES.join(', ')}.`);
        if (r.state !== 'candidate') require_(typeof r.by === 'string' && r.by.trim() && isUtc(r.atUtc), `${keyId}: a review needs who made it and when (UTC).`);
        return { keyId, styleType: e.styleType, displayCode: String(e.displayCode ?? ''), rowRevision: e.rowRevision,
            review: r.state === 'candidate' ? { state: 'candidate' } : { state: r.state, by: r.by.trim(), atUtc: r.atUtc, note: String(r.note ?? '') } };
    });
    const a = s.approval;
    let approval = { ...NOT_APPROVED };
    if (isObj(a) && a.state === 'approved') {
        require_(typeof a.by === 'string' && a.by.trim() && isUtc(a.atUtc) && Number.isSafeInteger(a.catalogRevision) && /^[0-9a-f]{64}$/.test(a.catalogSha256 || ''), 'An approval needs who gave it, when (UTC) and the catalog it was given against.');
        approval = { state: 'approved', by: a.by.trim(), atUtc: a.atUtc, reference: String(a.reference ?? ''), catalogRevision: a.catalogRevision, catalogSha256: a.catalogSha256 };
    } else require_(a == null || (isObj(a) && a.state === 'not-approved'), 'The approval state must be approved or not-approved.');
    return { format: SELECTION_FORMAT, version: SELECTION_VERSION, catalog: { catalogId: s.catalog.catalogId.toLowerCase(), revision: s.catalog.revision, sha256: s.catalog.sha256 },
        project: String(s.project ?? ''), styles: sortStyles(styles), approval };
}
const changedSelection = (selection, styles) => ({ ...selection, styles: sortStyles(styles), approval: { ...NOT_APPROVED } });
export function includeStyle(selection, read, keyId) {
    const row = rowById(read, keyId);
    require_(!!row, `${keyId} is not in the catalog.`);
    require_(!row.isDeleted, `${row.displayCode} is deleted in the catalog (not applicable).`);
    if (selection.styles.some(e => e.keyId === row.KEY_ID)) return selection;
    return changedSelection(selection, [...selection.styles, { keyId: row.KEY_ID, styleType: row.styleType, displayCode: row.displayCode, rowRevision: row.revision, review: { state: 'candidate' } }]);
}
export function excludeStyle(selection, keyId) {
    const id = String(keyId).toLowerCase();
    return selection.styles.some(e => e.keyId === id) ? changedSelection(selection, selection.styles.filter(e => e.keyId !== id)) : selection;
}
// A review pins the row revision it was made at; a later revision makes it stale (to review again).
export function reviewStyle(selection, read, keyId, { state, by = '', atUtc = '', note = '' }) {
    require_(REVIEW_STATES.includes(state), `The review state must be one of ${REVIEW_STATES.join(', ')}.`);
    const row = rowById(read, keyId), entry = selection.styles.find(e => e.keyId === row?.KEY_ID);
    require_(!!row && !!entry, `${keyId} is not selected for this project.`);
    if (state !== 'candidate') require_(String(by).trim() && isUtc(atUtc), 'A review needs who made it and when (UTC).');
    const review = state === 'candidate' ? { state } : { state, by: String(by).trim(), atUtc, note: String(note) };
    return changedSelection(selection, selection.styles.map(e => (e === entry ? { ...e, displayCode: row.displayCode, rowRevision: row.revision, review } : e)));
}
// Approval of the subset as it stands: every selected row reviewed (or rejected) at its current revision.
export function approveSelection(selection, read, { by = '', atUtc = '', reference = '' }) {
    require_(String(by).trim() && isUtc(atUtc), 'An approval needs who gives it and when (UTC).');
    const check = checkSelection(read, selection);
    const open = check.styles.filter(s => s.status !== 'current' || s.review === 'candidate');
    require_(!check.issues.some(i => i.code === 'selection.catalog_mismatch'), 'This selection belongs to another catalog.');
    require_(check.styles.some(s => s.review === 'reviewed'), 'Nothing reviewed to approve.');
    require_(!open.length, `Review these first: ${open.map(s => s.displayCode).join(', ')}.`);
    return { ...selection, catalog: { catalogId: read.catalog.catalogId, revision: read.catalog.revision, sha256: read.sha256 },
        approval: { state: 'approved', by: String(by).trim(), atUtc, reference: String(reference), catalogRevision: read.catalog.revision, catalogSha256: read.sha256 } };
}
// The selection against the catalog as read now: each selected row's status (current, revised, deleted, missing,
// type-changed), the selection's issues, and whether its approval still stands.
export function checkSelection(read, selection) {
    const issues = [], issue = (code, severity, subjectKey, message) => issues.push({ code, severity, subjectKey, message });
    if (!selection || !read) return { styles: [], issues, approved: false };
    if (selection.catalog.catalogId !== read.catalog.catalogId) {
        issue('selection.catalog_mismatch', 'error', 'selection', 'This selection was made for another catalog: none of its styles apply.');
        return { styles: [], issues, approved: false };
    }
    const sameText = selection.catalog.sha256 === read.sha256;
    if (!sameText) issue('selection.catalog_revised', 'warning', 'selection', `The catalog changed since this selection was made (revision ${selection.catalog.revision} to ${read.catalog.revision}): each style is checked again.`);
    const styles = selection.styles.map(e => {
        const row = rowById(read, e.keyId);
        const status = !row ? 'missing' : row.styleType !== e.styleType ? 'type-changed' : row.isDeleted ? 'deleted' : row.revision !== e.rowRevision ? 'revised' : 'current';
        const name = row?.displayCode || e.displayCode || e.keyId;
        if (status === 'missing') issue('selection.style_missing', 'error', e.keyId, `${name} is not in the catalog any more.`);
        if (status === 'type-changed') issue('selection.style_type_changed', 'error', e.keyId, `${name} is a ${row.styleType} style in the catalog, not a ${e.styleType}.`);
        if (status === 'deleted') issue('selection.style_deleted', 'needs-resolution', e.keyId, `${name} is deleted in the catalog (not applicable): take it out of the project or pick another.`);
        if (status === 'revised' && e.review.state !== 'candidate') issue('selection.style_revised', 'needs-resolution', e.keyId, `${name} changed in the catalog (row revision ${e.rowRevision} to ${row.revision}) after it was reviewed: review it again.`);
        return { keyId: e.keyId, styleType: e.styleType, displayCode: name, status, review: e.review.state, row };
    });
    const a = selection.approval;
    const approved = a.state === 'approved' && a.catalogSha256 === read.sha256 && a.catalogRevision === read.catalog.revision
        && styles.every(s => s.status === 'current' && s.review !== 'candidate') && styles.some(s => s.review === 'reviewed');
    if (a.state === 'approved' && !approved) issue('selection.approval_stale', 'warning', 'selection', `The approval by ${a.by} was given for catalog revision ${a.catalogRevision}: the catalog or the selection changed since. Approve again.`);
    return { styles, issues, approved };
}
// The rows a project offers for a style type: selected, not rejected, current or revised (with their status).
export function projectStyles(read, selection, styleType) {
    return checkSelection(read, selection).styles.filter(s => s.styleType === styleType && s.row && !s.row.isDeleted && s.review !== 'rejected' && s.status !== 'type-changed')
        .sort((a, b) => ordinalIgnoreCase(a.displayCode, b.displayCode) || (a.keyId < b.keyId ? -1 : 1));
}

// --- 3. Member text as the native parsers read it -------------------------------------------------------------------
// CfsDesignatorParser and MemberSpecParser live in criteria-names.mjs (one reading of member text for the workbook
// review and the catalog alike).
export { parseDesignator, parseMemberSpec };
// One alternative as the generator's member text: '600S162-33', or '(2) 600S162-54 WITH (1) 600T125-54'.
export const specTextOf = (items) => (items.length === 1 && items[0].qty === 1 ? items[0].designator.normalized
    : items.map(i => `(${i.qty}) ${i.designator.normalized}`).join(' WITH '));

// --- Matching (the native matchers, inches in, the catalog's feet compared) ----------------------------------------
const FT = 1 / 12, BAND_TOLERANCE = 1e-8;
// StringComparer.OrdinalIgnoreCase (the native matchers' order for ties and lists).
export const ordinalIgnoreCase = (a, b) => { const x = String(a).toUpperCase(), y = String(b).toUpperCase(); return x < y ? -1 : x > y ? 1 : 0; };
// CriteriaBandResolver.IsWithin: a zero minimum includes its bound; any other minimum excludes it; the maximum includes.
export function isWithin(value, minimum, maximum) {
    const lower = Math.abs(minimum) <= BAND_TOLERANCE ? value >= minimum - BAND_TOLERANCE : value > minimum + BAND_TOLERANCE;
    return lower && value <= maximum + BAND_TOLERANCE;
}
// WallStyleKeyReference.Normalize: the leading code of a style key ('601 | H 16'-0" | …' -> '601').
export function wallStyleKeyOf(value) {
    const s = String(value ?? '');
    if (!s.trim()) return '';
    return /^\s*(\d{3,})\b/.exec(s)?.[1] ?? s.trim();
}
// DesignTableRuleMatcher.Depth: the first designator in the mark's tokens (before any @), else the stud's.
export function wallDepthCode(row) {
    for (const token of textOf(row.conditions, 'Mark').split('_')) {
        const d = parseDesignator(token.includes('@') ? token.slice(0, token.indexOf('@')) : token);
        if (!d.error) return d.depthCode;
    }
    const spec = parseMemberSpec(textOf(row.outputs, 'StudText'));
    return spec.alternatives?.[0]?.[0]?.designator.depthCode ?? '';
}
// PreliminaryWallStyleMatcher.ResolveDepthCode: the workbook depth code within 0.03" of the core depth.
export function resolveDepthCode(coreDepthIn, codes) {
    return [...new Set(codes.filter(c => /^\d+$/.test(c)))].map(code => ({ code, delta: Math.abs(Number(code) / 100 - coreDepthIn) }))
        .filter(c => c.delta <= 0.03).sort((a, b) => a.delta - b.delta || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))[0]?.code ?? '';
}
// The rows a matcher can read: numbers in feet. A row with a length in another unit is set aside (named), never converted.
function usable(rows, keys) {
    const ok = [], unreadable = [];
    for (const r of rows) (keys.some(k => Number.isNaN(feetOf(r.conditions, k)) || Number.isNaN(feetOf(r.outputs, k))) ? unreadable : ok).push(r);
    return { ok, unreadable };
}
// PreliminaryWallStyleMatcher.Resolve. query: { coreDepthIn | depthCode, finish, wallHeightIn }. -> { status: matched |
// ambiguous | untabulated | out-of-range | no-solution, match, candidates, depthCode, detail, requiresStudSpacing, unreadable }.
export function matchWallStyle(rows, { coreDepthIn = null, depthCode = '', finish = '', wallHeightIn = null } = {}) {
    const { ok, unreadable } = usable(rows.filter(r => r.styleType === 'Wall' && !r.isDeleted), ['MaximumHeightFeet', 'MinimumHeightFeet', 'SpacingFeet']);
    const out = (status, detail, extra = {}) => ({ status, match: null, candidates: [], depthCode: '', detail, requiresStudSpacing: false, unreadable: unreadable.map(r => r.KEY_ID), ...extra });
    const f = String(finish ?? '').trim();
    if (!(coreDepthIn > 0 || depthCode) || !f || !(wallHeightIn > 0)) return out('no-solution', 'The core depth, finish and height of the wall must all be known.');
    const code = depthCode || resolveDepthCode(coreDepthIn, ok.map(wallDepthCode));
    if (!code || !ok.some(r => wallDepthCode(r) === code)) {
        const available = [...new Set(ok.map(wallDepthCode).filter(Boolean))].sort(ordinalIgnoreCase).join(', ');
        return out('untabulated', `Core depth ${depthCode || `${Math.round(coreDepthIn * 1000) / 1000} in`} does not match a workbook depth${available ? ` (available: ${available}).` : '.'}`);
    }
    const atDepth = ok.filter(r => wallDepthCode(r) === code);
    const exact = atDepth.filter(r => textOf(r.conditions, 'Finish').toLowerCase() === f.toLowerCase());
    if (!exact.length) {
        const finishes = [...new Set(atDepth.map(r => textOf(r.conditions, 'Finish')).filter(Boolean))].sort(ordinalIgnoreCase).join(', ');
        return out('untabulated', `No ${f} rule is defined for workbook depth ${code}${finishes ? ` (available finish: ${finishes}).` : '.'}`); // as the native Missing(): no depth code
    }
    const H = wallHeightIn * FT;
    const heights = [...new Set(exact.map(r => feetOf(r.conditions, 'MaximumHeightFeet') ?? 0).filter(v => v + 1e-8 >= H))].sort((a, b) => a - b);
    if (!heights.length) return out('out-of-range', 'The wall height exceeds the largest declared maximum for this core and finish.');
    const matches = exact.filter(r => Math.abs((feetOf(r.conditions, 'MaximumHeightFeet') ?? 0) - heights[0]) <= 1e-8)
        .sort((a, b) => (feetOf(a.outputs, 'SpacingFeet') ?? 0) - (feetOf(b.outputs, 'SpacingFeet') ?? 0) || ordinalIgnoreCase(textOf(a.conditions, 'Mark'), textOf(b.conditions, 'Mark')) || (a.KEY_ID < b.KEY_ID ? -1 : 1));
    if (matches.length === 1) return { ...out('matched', ''), match: matches[0], candidates: matches, depthCode: code };
    const spacings = [...new Set(matches.map(r => feetOf(r.outputs, 'SpacingFeet') ?? 0))].sort((a, b) => a - b);
    return { ...out('ambiguous', spacings.length > 1
        ? `Core, finish, and height match more than one workbook stud spacing (${spacings.map(v => `${Math.round(v * 12 * 100) / 100}" O.C.`).join(', ')}). Add a spacing input or consolidate the design table.`
        : 'The workbook contains more than one row for this core, finish, and height. Consolidate those rows before mapping.'),
    candidates: matches, depthCode: code, requiresStudSpacing: spacings.length > 1 };
}
// OpeningCriteriaResolver.Resolve. query: { styleType: Door | Window, wallStyleKey, depthCode, finish, wallHeightIn,
// openingWidthIn, heightAboveOpeningIn }. Rows linked to the wall style first; else unlinked rows of the depth (or of
// none). The catalog has no workbook row numbers: equal-rank rows fall back to display code, then KEY_ID, and are
// reported as ambiguous (a person picks). -> { status: matched | ambiguous | missing, match, eligible, unreadable }.
export function matchOpeningStyle(rows, { styleType, wallStyleKey = '', depthCode = '', finish = '', wallHeightIn = 0, openingWidthIn = 0, heightAboveOpeningIn = 0 } = {}) {
    const keys = ['MaximumWallHeightFeet', 'MaximumHeightAboveOpeningFeet', 'MinimumOpeningWidthFeet', 'MaximumOpeningWidthFeet'];
    const { ok, unreadable } = usable(rows.filter(r => r.styleType === styleType && !r.isDeleted), keys);
    const ft = (r, k) => feetOf(r.conditions, k) ?? 0, posOrMax = (v) => (v > 0 ? v : Number.MAX_VALUE);
    const wanted = wallStyleKeyOf(wallStyleKey);
    const linked = wanted ? ok.filter(r => textOf(r.conditions, 'WallStyleKey') && wallStyleKeyOf(textOf(r.conditions, 'WallStyleKey')).toLowerCase() === wanted.toLowerCase()) : [];
    const contextual = linked.length ? linked : ok.filter(r => !textOf(r.conditions, 'WallStyleKey') && (!textOf(r.conditions, 'DepthCode') || textOf(r.conditions, 'DepthCode').toLowerCase() === String(depthCode).toLowerCase()));
    const fin = String(finish ?? '').trim().toLowerCase();
    const finishMatches = (r) => { const c = textOf(r.conditions, 'Finish').toLowerCase(); return !c || !fin || c.includes(fin) || fin.includes(c); };
    const wallH = wallHeightIn * FT, width = openingWidthIn * FT, above = heightAboveOpeningIn * FT;
    const eligible = contextual
        .filter(r => ft(r, 'MaximumWallHeightFeet') <= 0 || wallH <= ft(r, 'MaximumWallHeightFeet') + 1e-6)
        .filter(r => ft(r, 'MaximumHeightAboveOpeningFeet') <= 0 || above <= ft(r, 'MaximumHeightAboveOpeningFeet') + 1e-6)
        .filter(r => isWithin(width, ft(r, 'MinimumOpeningWidthFeet'), ft(r, 'MaximumOpeningWidthFeet')))
        .sort((a, b) => Number(finishMatches(b)) - Number(finishMatches(a)) || posOrMax(ft(a, 'MaximumOpeningWidthFeet')) - posOrMax(ft(b, 'MaximumOpeningWidthFeet'))
            || posOrMax(ft(a, 'MaximumWallHeightFeet')) - posOrMax(ft(b, 'MaximumWallHeightFeet')) || posOrMax(ft(a, 'MaximumHeightAboveOpeningFeet')) - posOrMax(ft(b, 'MaximumHeightAboveOpeningFeet'))
            || ordinalIgnoreCase(a.displayCode, b.displayCode) || (a.KEY_ID < b.KEY_ID ? -1 : 1));
    const match = eligible[0] || null;
    const same = (a, b) => finishMatches(a) === finishMatches(b) && ['MaximumOpeningWidthFeet', 'MaximumWallHeightFeet', 'MaximumHeightAboveOpeningFeet'].every(k => Math.abs(posOrMax(ft(a, k)) - posOrMax(ft(b, k))) < 1e-6);
    const ambiguous = !!match && eligible.slice(1).some(r => same(match, r));
    return { status: !match ? 'missing' : ambiguous ? 'ambiguous' : 'matched', match: ambiguous ? null : match, eligible, linked: linked.length > 0, unreadable: unreadable.map(r => r.KEY_ID) };
}

// --- Outputs: what a style puts on a panel or an opening -----------------------------------------------------------
// One output text -> { text } (the generator's member text), { choices: [text…] } (alternatives: a person picks),
// { notApplicable } (NA), or { problem } (TBD, IGNORE, unreadable, or not a member this tool frames).
function outputMember(row, key, want) {
    const raw = textOf(row.outputs, key);
    if (!raw) return { problem: `${row.displayCode} gives no ${key}.` };
    const spec = parseMemberSpec(raw);
    if (spec.error) return { problem: `${row.displayCode}'s ${key} "${raw}" is not a member specification: ${spec.error}` };
    if (spec.sentinel === 'not-applicable') return { notApplicable: true };
    if (spec.sentinel) return { problem: `${row.displayCode}'s ${key} is ${raw.toUpperCase()}: pick the member.` };
    const texts = spec.alternatives.map(specTextOf).filter(t => (want === 'single-stud' ? isSingle(t, true) : want === 'single-track' ? isSingle(t, false) : !!G.specText(t)));
    if (!texts.length) return { problem: `${row.displayCode}'s ${key} "${raw}" is not a member this tool frames${want === 'single-stud' ? ' (one stud)' : want === 'single-track' ? ' (one track)' : ''}.` };
    return texts.length === 1 && spec.alternatives.length === 1 ? { text: texts[0] } : { choices: texts };
}
const isSingle = (text, stud) => { const d = G.parseMember(text); return !!d && d.qty === 1 && /^(S|CS|CT)$/.test(d.profile || '') === stud && d.name === text; };
// A wall style's core members and spacing.
export function wallStyleOutputs(row) {
    const members = {}, choices = {}, problems = [];
    for (const [k, key, want] of [['stud', 'StudText', 'single-stud'], ['track', 'BottomTrackText', 'single-track'], ['topTrack', 'TopTrackText', 'single-track']]) {
        const r = outputMember(row, key, want);
        if (r.text) members[k] = r.text; else if (r.choices) choices[k] = r.choices; else if (!r.notApplicable) problems.push({ key: k, message: r.problem });
    }
    const sp = feetOf(row.outputs, 'SpacingFeet');
    if (Number.isNaN(sp)) problems.push({ key: 'spacingIn', message: `${row.displayCode}'s SpacingFeet is not a length in feet.` });
    else if (sp > 0) members.spacingIn = Math.round(sp * 12 * 1e6) / 1e6; // 1.6 ft -> 19.2"
    else problems.push({ key: 'spacingIn', message: `${row.displayCode} gives no stud spacing.` });
    return { members, choices, problems };
}
// A door or window style's header, jambs and sill (as the opening kind takes them).
export function openingStyleOutputs(row, kind) {
    const members = {}, choices = {}, problems = [];
    for (const [k, key] of [['head', 'HeaderText'], ['jamb', 'JambText'], ['sill', 'SillText']]) {
        if (!G.OPENING_TYPES[kind]?.members.includes(k)) continue;
        const r = outputMember(row, key, 'spec');
        if (r.text) members[k] = r.text; else if (r.choices) choices[k] = r.choices; else if (!r.notApplicable) problems.push({ key: k, message: r.problem });
    }
    return { members, choices, problems };
}
// The binding a panel or opening keeps: identity by KEY_ID and the row revision applied (the display code is for people).
export const bindingOf = (read, row) => ({ catalogId: read.catalog.catalogId, keyId: row.KEY_ID, rowRevision: row.revision, displayCode: row.displayCode });

// --- What a panel asks the matchers -----------------------------------------------------------------------------------
// The wall: its core depth from the on-center stud (when the stud is one member; else the depth code a person chose in
// panel.styleQuery), the finish chosen (styleQuery.finish), and its height: the tallest point of the panel (a rake or
// gable is matched at its peak).
export function wallQuery(panel) {
    const { heightIn, top } = G.shapeTop(panel.shape), q = panel.styleQuery || {};
    const stud = G.parseMember(panel.members?.stud), one = stud && stud.qty === 1;
    return { coreDepthIn: one ? stud.depthIn : null, depthCode: one ? '' : String(q.depthCode || ''), studDepthCode: one ? parseDesignator(stud.name).depthCode || '' : '',
        finish: String(q.finish || ''), wallHeightIn: top ? Math.max(...top.map(p => p[1])) : heightIn };
}
// A door or window: the wall's style key and depth, the opening's width and the most wall above it (the tallest point of
// the top line over the opening, less the opening's top).
export function openingQuery(panel, o, wallRow = null) {
    const { lengthIn: L, heightIn: H, top } = G.shapeTop(panel.shape);
    const wq = wallQuery(panel);
    const left = o.leftIn, right = Math.min(L, o.leftIn + o.widthIn), openTop = (o.kind === 'door' ? 0 : o.sillIn) + o.heightIn;
    const tops = top ? [left, right, ...top.map(q => q[0]).filter(x => x > left && x < right)].map(x => topAtLine(top, x)) : [H];
    return { styleType: o.kind === 'door' ? 'Door' : 'Window', wallStyleKey: wallRow ? wallStyleKeyOf(wallRow.displayCode) : wallStyleKeyOf(panel.style?.displayCode || ''),
        depthCode: wallRow ? wallDepthCode(wallRow) : wq.studDepthCode || wq.depthCode,
        finish: wq.finish, wallHeightIn: wq.wallHeightIn, openingWidthIn: o.widthIn, heightAboveOpeningIn: Math.max(0, Math.max(...tops) - openTop) };
}
const topAtLine = (top, x) => { let i = 1; while (i < top.length - 1 && top[i][0] < x) i++; const a = top[i - 1], b = top[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); };
export const openingTakesStyle = (o) => o.kind === 'door' || o.kind === 'window';

// --- Applying a style: a new panel (pure). Outputs that are one member are set (provenance 'style'); alternatives take
// the choice a person made ({ stud: '362S162-43' }, never the first by default); TBD, unreadable or missing outputs leave
// the member as it was and are returned as problems. An arrangement is never set from a catalog (WITH does not give one).
export function applyWallStyle(panel, read, row, picked = {}) {
    if (row.styleType !== 'Wall' || row.isDeleted) throw new Error(`${row.displayCode} is not an active wall style.`);
    const out = wallStyleOutputs(row), members = { ...panel.members }, provenance = { ...(panel.provenance || {}) }, open = [];
    for (const k of ['stud', 'track', 'topTrack', 'spacingIn']) {
        const choice = out.choices[k], value = out.members[k] ?? (choice && choice.includes(picked[k]) ? picked[k] : undefined);
        if (choice && value === undefined) open.push({ key: k, choices: choice });
        if (value === undefined) continue;
        members[k] = value; provenance[k] = 'style';
    }
    return { panel: { ...panel, members, provenance, style: bindingOf(read, row) }, open, problems: out.problems };
}
export function applyOpeningStyle(panel, i, read, row, picked = {}) {
    const o = panel.openings[i];
    if (!openingTakesStyle(o) || row.styleType !== (o.kind === 'door' ? 'Door' : 'Window') || row.isDeleted) throw new Error(`${row.displayCode} is not an active ${o.kind} style.`);
    const out = openingStyleOutputs(row, o.kind), next = { ...o }, open = [];
    for (const k of ['head', 'jamb', 'sill']) {
        const choice = out.choices[k], value = out.members[k] ?? (choice && choice.includes(picked[k]) ? picked[k] : undefined);
        if (choice && value === undefined) open.push({ key: k, choices: choice });
        if (value !== undefined) next[k] = value;
    }
    next.style = bindingOf(read, row);
    return { panel: { ...panel, openings: panel.openings.map((x, j) => (j === i ? next : x)) }, open, problems: out.problems };
}

// --- Checking a panel's bindings against the catalog and the project selection (for the resolved plan) ----------------
// Engineering states, kept apart from preview and translation readiness: every issue here is a warning with
// scope 'engineering'; they decide the styles' state only:
//   not-reviewed       no wall style bound, or a binding that does not hold (stale, deleted, not in the project, out of
//                      range, members that differ from the style's outputs)
//   catalog-bound      the wall (and any bound door or window) holds against the catalog as loaded
//   selection-approved catalog-bound, every door and window bound, no framed MEP or steel opening (the catalog has no
//                      style for them), every row reviewed and the project selection approved by a named person.
// Approval is a record of people checking the catalog; it is not a structural check by this tool.
const sameSpec = (a, b) => (G.specText(a) || a) === (G.specText(b) || b);
const inches = (ft) => `${Number((ft * 12).toFixed(3))}"`;
export function checkStyleBindings(panel, styles, engineering = null) {
    const issues = [], note = (code, subjectKey, message) => issues.push({ code, severity: 'warning', scope: 'engineering', subjectKey, message });
    const read = engineering?.read ?? null, selection = engineering?.selection ?? null, check = read && selection ? checkSelection(read, selection) : null;
    const result = { catalog: read ? { catalogId: read.catalog.catalogId, revision: read.catalog.revision, sha256: read.sha256 } : null,
        selection: selection ? { approved: !!check?.approved, by: selection.approval.by ?? null, atUtc: selection.approval.atUtc ?? null, reference: selection.approval.reference ?? null } : null,
        query: styles?.query ? { ...styles.query } : null, wall: null, openings: {}, state: 'not-reviewed' };
    const keys = G.openingKeys(panel);
    const bound = (i) => styles?.openings?.[keys[i]] ?? null;
    if (!styles?.wall && !panel.openings.some((_, i) => bound(i))) return { result, issues };
    if (!read) { note('style.catalog_not_loaded', 'styles', 'Engineering styles are bound, but no catalog is loaded: the bindings are not checked.'); return { result, issues }; }
    if (!selection) note('style.no_project_selection', 'styles', 'No project selection: the styles are not reviewed or approved for this project.');
    let holds = true;
    const verify = (b, subjectKey, type, label) => {
        const r = { keyId: b.keyId, displayCode: b.displayCode, rowRevision: b.rowRevision, status: 'current', review: null, members: {} };
        const row = b.catalogId === read.catalog.catalogId ? rowById(read, b.keyId) : null;
        const name = row?.displayCode || b.displayCode || b.keyId;
        if (b.catalogId !== read.catalog.catalogId) { r.status = 'catalog-mismatch'; note('style.catalog_mismatch', subjectKey, `${label} ${name} is from another catalog than the one loaded.`); }
        else if (!row) { r.status = 'missing'; note('style.row_missing', subjectKey, `${label} ${name} is not in the catalog.`); }
        else if (row.styleType !== type) { r.status = 'type-mismatch'; note('style.type_mismatch', subjectKey, `${label} ${name} is a ${row.styleType} style, not a ${type} style.`); }
        else if (row.isDeleted) { r.status = 'deleted'; note('style.row_deleted', subjectKey, `${label} ${name} is deleted in the catalog (not applicable): pick another.`); }
        else if (row.revision !== b.rowRevision) { r.status = 'revised'; note('style.row_revised', subjectKey, `${label} ${name} changed in the catalog (row revision ${b.rowRevision} to ${row.revision}): apply it again or pick another.`); }
        if (row && check) {
            const e = check.styles.find(s => s.keyId === row.KEY_ID);
            r.review = e?.review ?? null;
            if (!e) { if (r.status === 'current') r.status = 'not-in-project'; note('style.not_in_project', subjectKey, `${label} ${name} is not in the project selection.`); }
            else if (e.review === 'rejected') { r.status = 'rejected'; note('style.rejected', subjectKey, `${label} ${name} was rejected in the project review.`); }
            else if (e.review === 'candidate') note('style.unreviewed', subjectKey, `${label} ${name} is not reviewed yet.`);
        }
        if (r.status !== 'current') holds = false;
        return { r, row: r.status === 'current' || r.status === 'revised' ? row : null };
    };
    const compare = (r, key, styleText, framed, label, code, subject) => {
        r.members[key] = { style: styleText ?? null, framed: framed || null, same: styleText != null && !!framed && sameSpec(styleText, framed) };
        if (styleText != null && !r.members[key].same) { holds = false; note('style.member_differs', subject, `${label}: ${framed || 'nothing'} is framed; ${code} gives ${styleText}.`); }
    };
    const choose = (r, key, choices, framed, label, code, subject) => {
        const ok = !!framed && choices.some(c => sameSpec(c, framed));
        r.members[key] = { style: choices.join(' OR '), framed: framed || null, same: ok };
        if (!ok) { holds = false; note('style.member_differs', subject, `${label}: ${framed || 'nothing'} is framed; ${code} gives one of ${choices.join(', ')}.`); }
    };
    let wallRow = null;
    if (styles?.wall) {
        const { r, row } = verify(styles.wall, 'style:wall', 'Wall', 'The wall style');
        result.wall = r; wallRow = row;
        if (row) {
            const q = wallQuery(panel), H = q.wallHeightIn / 12, max = feetOf(row.conditions, 'MaximumHeightFeet'), depth = wallDepthCode(row);
            const ownDepth = q.studDepthCode || q.depthCode, finish = textOf(row.conditions, 'Finish');
            if (Number.isFinite(max) && H > max + 1e-8) { holds = false; r.status = 'out-of-range'; note('style.out_of_range', 'style:wall', `${row.displayCode} covers walls up to ${inches(max)}; this panel is ${inches(H)} tall.`); }
            if (ownDepth && depth && ownDepth !== depth) { holds = false; note('style.depth_mismatch', 'style:wall', `${row.displayCode} is a ${depth} wall; this panel's studs are ${ownDepth}.`); }
            if (q.finish && finish && q.finish.toUpperCase() !== finish.toUpperCase()) { holds = false; note('style.finish_mismatch', 'style:wall', `${row.displayCode} is for ${finish}; this panel's finish is ${q.finish}.`); }
            const m = matchWallStyle(read.catalog.styles, q);
            if (m.status === 'matched' && m.match.KEY_ID !== row.KEY_ID) note('style.not_tables_pick', 'style:wall', `The tables pick ${m.match.displayCode} for this wall; ${row.displayCode} is bound.`);
            const out = wallStyleOutputs(row), mem = panel.members || {};
            const stud = G.parseMember(mem.stud)?.name || mem.stud || '', track = G.parseMember(mem.track)?.name || G.trackFor(stud) || '', top = mem.topTrack ? G.parseMember(mem.topTrack)?.name || mem.topTrack : track;
            for (const [k, framed, label] of [['stud', stud, 'On-center studs'], ['track', track, 'Bottom track'], ['topTrack', top, 'Top track']]) {
                if (out.choices[k]) choose(r, k, out.choices[k], framed, label, row.displayCode, `style:${k}`);
                else compare(r, k, out.members[k], framed, label, row.displayCode, `style:${k}`);
            }
            if (out.members.spacingIn != null) {
                const sp = Number(mem.spacingIn), ok = Math.abs(sp - out.members.spacingIn) < 1e-6;
                r.members.spacingIn = { style: out.members.spacingIn, framed: Number.isFinite(sp) && sp > 0 ? sp : null, same: ok };
                if (!ok) { holds = false; note('style.member_differs', 'style:spacingIn', `Stud spacing: ${Number.isFinite(sp) && sp > 0 ? `${sp}"` : 'none'} is framed; ${row.displayCode} gives ${out.members.spacingIn}".`); }
            }
            for (const p of out.problems) note('style.output_unresolved', `style:${p.key}`, `${p.message} The member framed here was not set by the style.`);
        }
    } else holds = false;
    panel.openings.forEach((o, i) => {
        const b = bound(i);
        if (!b || !openingTakesStyle(o)) return;
        const type = o.kind === 'door' ? 'Door' : 'Window', label = `${keys[i]}'s ${o.kind} style`;
        const { r, row } = verify(b, keys[i], type, label);
        result.openings[keys[i]] = r;
        if (!row) return;
        const q = openingQuery(panel, o, wallRow), ft = (k) => feetOf(row.conditions, k) ?? 0;
        const widthOk = isWithin(q.openingWidthIn / 12, ft('MinimumOpeningWidthFeet'), ft('MaximumOpeningWidthFeet'));
        const wallOk = ft('MaximumWallHeightFeet') <= 0 || q.wallHeightIn / 12 <= ft('MaximumWallHeightFeet') + 1e-6, aboveOk = ft('MaximumHeightAboveOpeningFeet') <= 0 || q.heightAboveOpeningIn / 12 <= ft('MaximumHeightAboveOpeningFeet') + 1e-6;
        if (!widthOk || !wallOk || !aboveOk) { holds = false; r.status = 'out-of-range'; note('style.out_of_range', keys[i], `${row.displayCode} does not cover ${keys[i]} (${[!widthOk && 'its width', !wallOk && 'the wall height', !aboveOk && 'the wall above it'].filter(Boolean).join(', ')}).`); }
        const link = textOf(row.conditions, 'WallStyleKey');
        if (link && wallRow && wallStyleKeyOf(link) !== wallStyleKeyOf(wallRow.displayCode)) { holds = false; note('style.wall_link_mismatch', keys[i], `${row.displayCode} belongs to wall style ${wallStyleKeyOf(link)}; the wall is ${wallRow.displayCode}.`); }
        const out = openingStyleOutputs(row, o.kind);
        for (const k of G.OPENING_TYPES[o.kind].members) {
            const framed = G.memberFor(panel, o, k).spec, mLabel = `${keys[i]} ${G.MEMBER_LABELS[k].toLowerCase()}`;
            if (out.choices[k]) choose(r, k, out.choices[k], framed, mLabel, row.displayCode, `${keys[i]}:${k}`);
            else compare(r, k, out.members[k], framed, mLabel, row.displayCode, `${keys[i]}:${k}`);
        }
        for (const p of out.problems) note('style.output_unresolved', `${keys[i]}:${p.key}`, `${p.message} The member framed here was not set by the style.`);
    });
    if (!holds) return { result, issues };
    result.state = 'catalog-bound';
    const notFramed = (o) => G.isSmallPenetration(panel, o) || (G.isFromModel(panel) && !o.locked);
    const doorsWindowsBound = panel.openings.every((o, i) => !openingTakesStyle(o) || notFramed(o) || !!result.openings[keys[i]]);
    const noOthers = panel.openings.every(o => openingTakesStyle(o) || notFramed(o));
    const reviewed = [result.wall, ...Object.values(result.openings)].every(r => r.review === 'reviewed');
    if (check?.approved && reviewed && doorsWindowsBound && noOthers) result.state = 'selection-approved';
    else if (check?.approved) {
        if (!doorsWindowsBound) note('style.openings_unbound', 'styles', 'Not every door and window has a style: the approval does not cover this panel.');
        if (!noOthers) note('style.openings_outside_catalog', 'styles', 'This panel frames MEP or steel openings, which the catalog has no style for: the approval does not cover them.');
    }
    return { result, issues };
}
