// Browser-only CSV and SpreadsheetML exports; no formulas are created from imported text.
// https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document
// ZIP: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT (stored entries).
const encoder = new TextEncoder();
const xml = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function csvText(rows) {
    // A CSV has no cell types. Neutralize formula prefixes before Excel opens it.
    const cell = value => { let s = String(value ?? ''); if (/^\s*[=+@]/.test(s) || /^\s*-(?!\d|\.\d)/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    return '\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
const colName = n => { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
function worksheet(rows) {
    if (rows.length > 1048576 || rows.some(r => r.length > 16384)) throw new Error('The table exceeds Excel worksheet limits.');
    const width = Math.max(1, ...rows.map(r => r.length));
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${Array.from({ length: width }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 1 ? 65 : 22}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => `<c r="${colName(j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(c)}</t></is></c>`).join('')}</row>`).join('')}</sheetData>${rows.length ? `<autoFilter ref="A1:${colName(width - 1)}${rows.length}"/>` : ''}</worksheet>`;
}
function crc32(bytes) {
    let crc = -1;
    for (const b of bytes) { crc ^= b; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return (crc ^ -1) >>> 0;
}
function zip(files) {
    const locals = [], central = []; let offset = 0;
    for (const [path, text] of Object.entries(files)) {
        const name = encoder.encode(path), data = encoder.encode(text), crc = crc32(data);
        const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(12, 33, true);
        h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); header.set(name, 30);
        const entry = new Uint8Array(46 + name.length), e = new DataView(entry.buffer);
        e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true); e.setUint16(14, 33, true);
        e.setUint32(16, crc, true); e.setUint32(20, data.length, true); e.setUint32(24, data.length, true); e.setUint16(28, name.length, true); e.setUint32(42, offset, true); entry.set(name, 46);
        locals.push(header, data); central.push(entry); offset += header.length + data.length;
    }
    const size = central.reduce((s, b) => s + b.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
    const result = new Uint8Array(offset + size + end.length); let at = 0;
    for (const b of [...locals, ...central, end]) { result.set(b, at); at += b.length; }
    return result;
}
export function xlsxBytes(sheets) {
    const ns = 'http://schemas.openxmlformats.org';
    const files = {
        '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
        '_rels/.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        'xl/workbook.xml': `<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
        'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${ns}/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
    };
    sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = worksheet(s.rows); });
    return zip(files);
}
