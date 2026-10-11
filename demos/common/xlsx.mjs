// The .xlsx reader (Demo 2: the engineer's framing criteria; Demo 3: a P6 schedule exported to Excel; the engineering
// criteria review: demos/06-shop-drawings/criteria-workbook.mjs). No library: an .xlsx is a ZIP of XML parts; entries
// are stored or deflated (the platform's DecompressionStream 'deflate-raw'); the SpreadsheetML parts are regular enough
// to read with regular expressions. Runs in the browser and in Node. Read-only: nothing is written back.
//
//   readXlsx(buffer) -> [{ name, rows: string[][] }]   every sheet's cell text, one array per row element (Demo 2, 3)
//   readWorkbook(bytes, { limits }) -> { sha256, sheets, issues }   the detail a criteria review needs:
//     sheets: [{ name, hidden, part, lastRow, lastColumn, cell(row, col) -> cell | null, rows() -> [[row, [cell…]]] }]
//     cell: { ref, row, col, type, text, formula, cached }
//       type: 's' (shared string), 'inlineStr', 'str' (a formula's text result), 'n', 'b', 'e' (error), 'd' (ISO date)
//       text: the value as Excel stores it (rich-text runs joined, phonetic guides left out, line breaks kept; a number
//             as written in the file; TRUE / FALSE; the error code). Never formatted: number formats, colors, fonts
//             and merged cells are presentation and are not read.
//       formula: the formula's text when the cell has one ('' for a shared formula's dependent cells), else null.
//       cached: false when a formula has no saved result or an error result (an issue says so; never taken as a value).
//     sha256: of the file's bytes, exactly as read.
//   Limits (CRITERIA_LIMITS by default for readWorkbook, as the native reader ExcelStyleStore: 16 MB file, 2,048 parts,
//   64 MB unpacked, 20,000 rows, 256 columns, 200,000 cells a sheet). A DTD is refused (no entity expansion).
// ZIP format: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
// DecompressionStream: https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream
// SpreadsheetML parts (workbook, sharedStrings, worksheets): https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document
import { sha256HexBytes } from './sha256.mjs';

export const CRITERIA_LIMITS = { file: 16 * 1024 * 1024, parts: 2048, unpacked: 64 * 1024 * 1024, rows: 20000, columns: 256, cells: 200000 };
const OPEN_LIMITS = { file: 512 * 1024 * 1024, parts: 65535, unpacked: 2 * 1024 * 1024 * 1024, rows: 1048576, columns: 16384, cells: Infinity }; // what Excel itself allows
const fail = (message) => { throw new Error(message); };

// --- ZIP: the central directory lists every entry; each entry's data follows its local header -------------------------
function zipDirectory(b, limits) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) fail('Not an .xlsx file (no ZIP directory).');
    const count = v.getUint16(end + 10, true), size = v.getUint32(end + 12, true), offset = v.getUint32(end + 16, true);
    if (count === 0xffff || offset === 0xffffffff) fail('ZIP64 workbooks are not supported.');
    if (count > limits.parts) fail('Workbook package exceeds the supported size.');
    if (offset + size > b.length) fail('Damaged .xlsx file (ZIP directory).');
    const entries = new Map(), dec = new TextDecoder();
    let p = offset, total = 0;
    for (let n = 0; n < count; n++) {
        if (v.getUint32(p, true) !== 0x02014b50) fail('Damaged .xlsx file (ZIP directory).');
        const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), packed = v.getUint32(p + 20, true), unpacked = v.getUint32(p + 24, true);
        const nameLength = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
        const name = dec.decode(b.subarray(p + 46, p + 46 + nameLength));
        if (flags & 1) fail('Encrypted workbooks are not supported.');
        total += unpacked;
        if (total > limits.unpacked) fail('Workbook package exceeds the supported size.');
        entries.set(name, { method, packed, unpacked, local });
        p += 46 + nameLength + extra + comment;
    }
    return { entries, v };
}
async function unzip(b, dir, name) {
    const e = dir.entries.get(name);
    if (!e) return null;
    const v = dir.v;
    if (v.getUint32(e.local, true) !== 0x04034b50) fail(`Damaged .xlsx file (${name}).`);
    const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true), data = b.subarray(start, start + e.packed);
    let out;
    if (e.method === 0) out = data;
    else if (e.method === 8) out = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else fail(`The workbook part ${name} uses an unsupported compression (${e.method}).`);
    if (out.length !== e.unpacked) fail(`Damaged .xlsx file (${name}: its size differs from the directory's).`);
    return new TextDecoder().decode(out);
}

// --- XML: the few shapes SpreadsheetML uses; no DTDs ------------------------------------------------------------------
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const attrs = (s) => { const o = {}; for (const m of String(s || '').matchAll(ATTR)) o[m[1]] = decode(m[2] ?? m[3]); return o; };
// Entities, then Excel's escapes for characters XML cannot hold (_x000D_ for a carriage return).
function decode(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
        : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]))
        .replace(/_x([0-9a-f]{4})_/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
}
// A string item's text: its <t> elements (plain or rich-text runs) in order; phonetic guides (<rPh>) are not text.
const textOf = (inner) => [...String(inner).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)].map(m => decode(m[1] ?? '')).join('');

// "AB12" -> { col: 28, row: 12 }; 28 -> "AB".
export function splitRef(ref) {
    const m = /^([A-Z]{1,3})(\d+)$/.exec(String(ref || '').toUpperCase());
    if (!m) return null;
    let col = 0;
    for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
    return { col, row: Number(m[2]) };
}
export function columnName(col) { let s = ''; for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }

function readSheet(xml, name, shared, issues, limits) {
    const cells = new Map(), elements = []; // row -> Map(col -> cell); every <row> element in order (empty cells too)
    let lastRow = 0, lastColumn = 0, count = 0, rowNumber = 0;
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const ra = attrs(rm[1]);
        rowNumber = ra.r ? Number(ra.r) : rowNumber + 1;
        if (!(rowNumber >= 1 && rowNumber <= limits.rows)) fail(`Worksheet ${name} exceeds the supported row/cell limit.`);
        const element = [];
        elements.push(element);
        let col = 0;
        for (const cm of String(rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const ca = attrs(cm[1]), inner = cm[2] || '', at = ca.r ? splitRef(ca.r) : null;
            col = at ? at.col : col + 1;
            if (col > limits.columns) fail(`Worksheet ${name} exceeds ${limits.columns} supported columns.`);
            if (++count > limits.cells) fail(`Worksheet ${name} exceeds the supported row/cell limit.`);
            const type = ca.t || 'n', f = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner), v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner), ref = columnName(col) + rowNumber;
            let text = '';
            if (type === 's') {
                const i = Number(v?.[1]), ok = Number.isInteger(i) && i >= 0 && i < shared.length;
                text = ok ? shared[i] : '';
                if (v && !ok) issues.push({ sheet: name, ref, code: 'xlsx.shared_string_missing', message: 'A shared string the cell points to is missing.' });
            } else if (type === 'inlineStr') text = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '');
            else if (type === 'b') text = v ? (v[1].trim() === '1' ? 'TRUE' : 'FALSE') : '';
            else text = v ? decode(v[1]) : '';
            const formula = f ? decode(f[2] ?? '') : null, cached = !f || (!!v && type !== 'e');
            if (f && !cached) issues.push({ sheet: name, ref, code: v ? 'xlsx.formula_error' : 'xlsx.formula_not_calculated', message: v ? `A formula's saved result is an error (${text}).` : 'A formula has no saved result: recalculate and save in Excel.' });
            const cell = { ref, row: rowNumber, col, type, text, formula, cached };
            element.push(cell);
            if (!text && !f) continue;
            if (!cells.has(rowNumber)) cells.set(rowNumber, new Map());
            cells.get(rowNumber).set(col, cell);
            lastRow = Math.max(lastRow, rowNumber); lastColumn = Math.max(lastColumn, col);
        }
    }
    return { cells, elements, lastRow, lastColumn };
}

export async function readWorkbook(input, { limits = CRITERIA_LIMITS } = {}) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (b.length > limits.file) fail(`Workbook exceeds ${Math.round(limits.file / 1024 / 1024)} MB.`);
    const sha256 = sha256HexBytes(b), dir = zipDirectory(b, limits), issues = [];
    // A part as XML: a DTD refused; line ends as XML reads them (CR LF or CR is LF; Excel's _x000D_ stays a CR); element
    // prefixes dropped (Excel/ClosedXML may write x:row: the same namespace).
    const part = async (name) => {
        const x = await unzip(b, dir, name);
        if (x == null) return null;
        if (/<!DOCTYPE|<!ENTITY/i.test(x)) fail(`The workbook part ${name} declares a DTD: refused.`);
        return x.replace(/\r\n?/g, '\n').replace(/(<\/?)[A-Za-z_][\w.-]*:/g, '$1');
    };
    const workbook = await part('xl/workbook.xml');
    if (!workbook) fail('Not an .xlsx file (no xl/workbook.xml).');
    const rels = Object.fromEntries([...String(await part('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b([^>]*?)\/?>/g)].map(m => attrs(m[1])).map(a => [a.Id, a.Target]));
    const sharedXml = await part('xl/sharedStrings.xml');
    const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map(m => textOf(m[1] ?? '')) : [];
    const sheets = [];
    for (const sm of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
        const a = attrs(sm[1]), target = rels[a['r:id']];
        const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`) : '';
        const xml = path ? await part(path) : null;
        if (xml == null) { issues.push({ sheet: a.name, ref: '', code: 'xlsx.sheet_missing', message: 'The sheet\'s part is not in the workbook.' }); continue; }
        if (/<tableParts\b[^>]*count="[1-9]/.test(xml)) issues.push({ sheet: a.name, ref: '', code: 'xlsx.excel_table', message: 'The sheet uses an Excel table: its rows are read as cells (structured references are not followed).' });
        const { cells, elements, lastRow, lastColumn } = readSheet(xml, a.name, shared, issues, limits);
        sheets.push({ name: a.name, hidden: !!a.state && a.state !== 'visible', part: path, lastRow, lastColumn, elements,
            cell: (row, col) => cells.get(row)?.get(col) ?? null,
            rows: () => [...cells.entries()].sort((x, y) => x[0] - y[0]).map(([r, m]) => [r, [...m.values()].sort((x, y) => x.col - y.col)]) });
    }
    return { sha256, sheets, issues };
}

// Every sheet's cell text as rows of strings, one array per row element, a cell at its column ('' between): [{ name,
// rows }] in workbook order. Excel's own limits (not the criteria review's).
export async function readXlsx(buffer) {
    const wb = await readWorkbook(buffer, { limits: OPEN_LIMITS });
    return wb.sheets.map(s => ({ name: s.name, rows: s.elements.map(cells => { const row = []; for (const c of cells) row[c.col - 1] = c.type === 'b' ? (c.text === 'TRUE' ? '1' : '0') : c.text; return Array.from(row, x => x ?? ''); }) }));
}
