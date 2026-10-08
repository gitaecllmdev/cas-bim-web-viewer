// Minimal vector PDF writer for the shop drawing primitives in ./sheet.mjs (text, line, rect, poly, circle, image).
// No dependencies: standard Helvetica fonts (not embedded), one page, uncompressed content, a JPEG logo, and other
// JPEG images given as data URLs with their pixel size (the key plan), embedded as they are (DCTDecode).
// Sheet coordinates are inches with y down; PDF uses points (72 per inch) with y up.
// PDF reference: ISO 32000-1 (PDF 1.7), §7 file structure, §8 graphics, §9 text.

// Helvetica and Helvetica-Bold advance widths (1/1000 em) for ASCII 32-126, used to anchor centered/right text.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELV_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

export function textWidth(s, sizePt, bold) {
    const table = bold ? HELV_BOLD : HELV;
    let w = 0;
    for (const ch of s) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? table[c - 32] : 556; }
    return (w / 1000) * sizePt;
}

const num = (v) => (Math.abs(v) < 1e-6 ? 0 : Number(v.toFixed(3)));
const NAMED = { white: '#ffffff', black: '#000000' };
function rgb(color) {
    const hex = NAMED[color] || color;
    if (!hex || hex === 'none' || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
    return [1, 3, 5].map(i => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');
}
// PDF string literal in WinAnsi (Latin-1 range); other characters become '?'.
const pdfString = (s) => `(${[...s].map(ch => (ch.charCodeAt(0) > 255 ? '?' : ch)).join('').replace(/([\\()])/g, '\\$1')})`;
const latin1 = (str) => { const b = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff; return b; };
const JPEG_URL = /^data:image\/jpeg;base64,/;
// An image fitted in its box, keeping its aspect ratio (like preserveAspectRatio="xMidYMid meet"): [x, y, w, h] in inches.
const fitBox = (o, pw, ph) => { const k = Math.min(o.w / pw, o.h / ph), w = pw * k, h = ph * k; return [o.x + (o.w - w) / 2, o.y + (o.h - h) / 2, w, h]; };

// A page's content stream from the primitives: c, the page's operators so far; images, the JPEG data URL images of the
// whole file so far ({ name, bytes, width, height }; Im1 is the logo).
function drawOps(ops, { P, Hpt, c, images, logo }) {
    const X = (x) => num(x * P), Y = (y) => num(Hpt - y * P);
    for (const o of ops) {
        if (o.t === 'line') {
            const col = rgb(o.stroke) || '0 0 0';
            const dash = o.dash ? `[${o.dash.split(/[\s,]+/).map(v => num(Number(v) * P)).join(' ')}] 0 d` : '[] 0 d';
            c.push(`${col} RG ${num(o.width * P)} w ${dash} ${X(o.x1)} ${Y(o.y1)} m ${X(o.x2)} ${Y(o.y2)} l S`);
        } else if (o.t === 'rect') {
            const fill = rgb(o.fill), stroke = o.width > 0 ? rgb(o.stroke) : null;
            if (!fill && !stroke) continue;
            const path = `${X(o.x)} ${num(Hpt - (o.y + o.h) * P)} ${num(o.w * P)} ${num(o.h * P)} re`;
            c.push(`${fill ? `${fill} rg ` : ''}${stroke ? `${stroke} RG ${num(o.width * P)} w [] 0 d ` : ''}${path} ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
        } else if (o.t === 'poly') {
            const fill = rgb(o.fill), stroke = o.width > 0 ? rgb(o.stroke) : null;
            if ((!fill && !stroke) || o.pts.length < 3) continue;
            const path = o.pts.map((p, k) => `${X(p[0])} ${Y(p[1])} ${k ? 'l' : 'm'}`).join(' ') + ' h';
            c.push(`${fill ? `${fill} rg ` : ''}${stroke ? `${stroke} RG ${num(o.width * P)} w [] 0 d ` : ''}${path} ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
        } else if (o.t === 'circle') {
            const k = 0.5523 * o.r * P, cx = X(o.cx), cy = Y(o.cy), r = o.r * P;
            c.push(`${rgb(o.stroke) || '0 0 0'} RG ${num(o.width * P)} w [] 0 d ${num(cx + r)} ${cy} m `
                + `${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${cx} ${num(cy + r)} c `
                + `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${cy} c `
                + `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${cx} ${num(cy - r)} c `
                + `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${cy} c S`);
        } else if (o.t === 'text') {
            if (!o.s) continue;
            const size = o.size * P, bold = o.weight === 'bold';
            const a = (-(o.rotate || 0) * Math.PI) / 180; // SVG rotates clockwise (y down); PDF counter-clockwise (y up)
            const w = textWidth(o.s, size, bold);
            const shift = o.anchor === 'middle' ? -w / 2 : o.anchor === 'end' ? -w : 0;
            const tx = o.x * P + shift * Math.cos(a), ty = Hpt - o.y * P + shift * Math.sin(a);
            c.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${rgb(o.fill) || '0 0 0'} rg ${num(Math.cos(a))} ${num(Math.sin(a))} ${num(-Math.sin(a))} ${num(Math.cos(a))} ${num(tx)} ${num(ty)} Tm ${pdfString(o.s)} Tj ET`);
        } else if (o.t === 'image' && o.id === 'logo' && logo) {
            const [x, y, w, h] = fitBox(o, logo.width, logo.height);
            c.push(`q ${num(w * P)} 0 0 ${num(h * P)} ${X(x)} ${num(Hpt - (y + h) * P)} cm /Im1 Do Q`);
        } else if (o.t === 'image' && o.id !== 'logo' && JPEG_URL.test(o.href || '') && o.px?.[0] > 0 && o.px?.[1] > 0) {
            const name = `Im${images.length + 2}`;
            images.push({ name, bytes: latin1(atob(o.href.replace(JPEG_URL, ''))), width: o.px[0], height: o.px[1] });
            const [x, y, w, h] = fitBox(o, o.px[0], o.px[1]);
            c.push(`q ${num(w * P)} 0 0 ${num(h * P)} ${X(x)} ${num(Hpt - (y + h) * P)} cm /${name} Do Q`);
        }
    }
    return c;
}

const imageObject = (im) => [latin1(`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`),
    im.bytes, latin1('\nendstream')];

// The file from its objects (1-based, in order): header, objects, cross-reference table, trailer (info: object 7 or given).
function pdfFile(objects, info) {
    const chunks = [latin1('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
    let offset = chunks[0].length;
    const offsets = [];
    objects.forEach((obj, i) => {
        offsets.push(offset);
        const parts = [latin1(`${i + 1} 0 obj\n`), ...(Array.isArray(obj) ? obj : [obj]), latin1('\nendobj\n')];
        for (const p of parts) { chunks.push(p); offset += p.length; }
    });
    const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
        + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
    chunks.push(latin1(xref));
    const out = new Uint8Array(chunks.reduce((n, ch) => n + ch.length, 0));
    let at = 0;
    for (const ch of chunks) { out.set(ch, at); at += ch.length; }
    return out;
}

// ops: primitives from sheet.mjs; logo: { jpeg: Uint8Array, width, height } for the op with id 'logo'.
export function toPdf(ops, { widthIn = 17, heightIn = 11, logo = null, title = 'Shop drawing' } = {}) {
    const P = 72, Hpt = heightIn * P;
    const images = []; // JPEG data URL images: { name, bytes, width, height }
    const imageBase = logo ? 9 : 8; // their object numbers follow the fonts, the info and the logo
    const c = drawOps(ops, { P, Hpt, c: ['1 1 1 rg 0 0 ' + num(widthIn * P) + ' ' + num(Hpt) + ' re f', '1 J 1 j'], images, logo });
    const content = latin1(c.join('\n'));

    // Objects: 1 catalog, 2 pages, 3 page, 4 content, 5-6 fonts, 7 info, 8 logo (optional), then the other images.
    const xobjects = [...(logo ? ['/Im1 8 0 R'] : []), ...images.map((im, i) => `/${im.name} ${imageBase + i} 0 R`)];
    const objects = [
        latin1('<< /Type /Catalog /Pages 2 0 R >>'),
        latin1('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
        latin1(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(widthIn * P)} ${num(Hpt)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${xobjects.length ? ` /XObject << ${xobjects.join(' ')} >>` : ''} >> /Contents 4 0 R >>`),
        [latin1(`<< /Length ${content.length} >>\nstream\n`), content, latin1('\nendstream')],
        latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
        latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
        latin1(`<< /Title ${pdfString(title)} /Producer (CAS BIM Web Viewer) >>`),
    ];
    if (logo) objects.push(imageObject({ width: logo.width, height: logo.height, bytes: logo.jpeg }));
    for (const im of images) objects.push(imageObject(im));
    return pdfFile(objects, 7);
}

// Several shop drawing sheets in one file (the Panel Shop Generator's set): pages [{ ops, widthIn, heightIn }], each page
// its own size; the logo shared by every page. Objects: 1 catalog, 2 pages, 3-4 fonts, 5 info, 6 logo (optional), then
// each page and its content, then the JPEG data URL images.
export function toPdfSheets(pages, { logo = null, title = 'Shop drawings' } = {}) {
    const P = 72, images = [], n = pages.length, first = logo ? 7 : 6;
    const streams = pages.map(({ ops, widthIn, heightIn }) => latin1(drawOps(ops, { P, Hpt: heightIn * P, c: ['1 1 1 rg 0 0 ' + num(widthIn * P) + ' ' + num(heightIn * P) + ' re f', '1 J 1 j'], images, logo }).join('\n')));
    const xobjects = [...(logo ? ['/Im1 6 0 R'] : []), ...images.map((im, i) => `/${im.name} ${first + 2 * n + i} 0 R`)].join(' ');
    const objects = [
        latin1('<< /Type /Catalog /Pages 2 0 R >>'),
        latin1(`<< /Type /Pages /Kids [${pages.map((_, k) => `${first + 2 * k} 0 R`).join(' ')}] /Count ${n} >>`),
        latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
        latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
        latin1(`<< /Title ${pdfString(title)} /Producer (CAS BIM Web Viewer) >>`),
    ];
    if (logo) objects.push(imageObject({ width: logo.width, height: logo.height, bytes: logo.jpeg }));
    streams.forEach((content, k) => {
        const { widthIn, heightIn } = pages[k];
        objects.push(latin1(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(widthIn * P)} ${num(heightIn * P)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >> /Contents ${first + 2 * k + 1} 0 R >>`));
        objects.push([latin1(`<< /Length ${content.length} >>\nstream\n`), content, latin1('\nendstream')]);
    });
    for (const im of images) objects.push(imageObject(im));
    return pdfFile(objects, 5);
}

// Several pages of the same primitives (a report): pages, one ops list each; JPEG data URL images (photos, plans).
// Objects: 1 catalog, 2 pages, 3-4 fonts, 5 info, then each page and its content, then the images.
export function toPdfPages(pages, { widthIn = 8.5, heightIn = 11, title = 'Report' } = {}) {
    const P = 72, Hpt = heightIn * P, images = [], n = pages.length;
    const streams = pages.map(ops => latin1(drawOps(ops, { P, Hpt, c: ['1 1 1 rg 0 0 ' + num(widthIn * P) + ' ' + num(Hpt) + ' re f', '1 J 1 j'], images, logo: null }).join('\n')));
    const xobjects = images.map((im, i) => `/${im.name} ${6 + 2 * n + i} 0 R`).join(' ');
    const objects = [
        latin1('<< /Type /Catalog /Pages 2 0 R >>'),
        latin1(`<< /Type /Pages /Kids [${pages.map((_, k) => `${6 + 2 * k} 0 R`).join(' ')}] /Count ${n} >>`),
        latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
        latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
        latin1(`<< /Title ${pdfString(title)} /Producer (CAS BIM Web Viewer) >>`),
    ];
    streams.forEach((content, k) => {
        objects.push(latin1(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(widthIn * P)} ${num(Hpt)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >> /Contents ${7 + 2 * k} 0 R >>`));
        objects.push([latin1(`<< /Length ${content.length} >>\nstream\n`), content, latin1('\nendstream')]);
    });
    for (const im of images) objects.push(imageObject(im));
    return pdfFile(objects, 5);
}
