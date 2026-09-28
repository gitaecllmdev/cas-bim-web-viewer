// Minimal .xlsx reader for the engineer's framing criteria (Demo 2): every sheet's cell text as rows of strings.
// No library: an .xlsx is a ZIP of XML parts. Entries are stored or deflated (DecompressionStream 'deflate-raw');
// the XML parts are regular enough to read with regular expressions. Runs in the browser and in Node (tests).
// ZIP format: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
// DecompressionStream: https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream
// SpreadsheetML parts (workbook, sharedStrings, worksheets): https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document

// Returns [{ name, rows: string[][] }] in workbook order.
export async function readXlsx(buffer) {
    const files = await unzip(buffer);
    const text = (name) => (files.has(name) ? new TextDecoder().decode(files.get(name)) : '');
    const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => runs(m[1]));
    const rels = new Map([...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)]
        .map(m => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
    const sheets = [...text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map(m => ({ name: decode(attr(m[0], 'name')), rid: attr(m[0], 'r:id') }));
    return sheets.map(({ name, rid }) => {
        const target = (rels.get(rid) || '').replace(/^\/?(xl\/)?/, '');
        return { name, rows: sheetRows(text(`xl/${target}`), shared) };
    });
}

function sheetRows(xml, shared) {
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const row = [];
        for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const ref = attr(c[1], 'r'), type = attr(c[1], 't'), body = c[2] || '';
            const col = ref ? colIndex(ref) : row.length;
            const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
            row[col] = type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? runs(body) : decode(v ?? '');
        }
        rows.push(Array.from(row, x => x ?? ''));
    }
    return rows;
}

const runs = (xml) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => decode(m[1])).join('');
const attr = (tag, name) => new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`).exec(tag)?.[1] ?? '';
const colIndex = (ref) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const decode = (s) => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[\da-f]+);/gi, (m, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e.toLowerCase()]
    ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

// ZIP: the central directory lists every entry; each entry's data follows its local header.
async function unzip(buffer) {
    const bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not an .xlsx file (no ZIP directory)');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const files = new Map();
    for (let i = 0; i < count; i++) {
        if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged .xlsx file (ZIP directory)');
        const method = view.getUint16(p + 10, true), size = view.getUint32(p + 20, true);
        const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
        const local = view.getUint32(p + 42, true);
        const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + commentLen;
        if (!/\.(xml|rels)$/i.test(name)) continue;
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const data = bytes.subarray(start, start + size);
        if (method === 0) files.set(name, data);
        else if (method === 8) files.set(name, new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
    }
    return files;
}
