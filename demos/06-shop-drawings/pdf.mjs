// Minimal vector PDF writer for the shop drawing primitives in ./sheet.mjs (text, line, rect, circle, image).
// No dependencies: standard Helvetica fonts (not embedded), one page, uncompressed content, a JPEG logo.
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

// ops: primitives from sheet.mjs; logo: { jpeg: Uint8Array, width, height } for the op with id 'logo'.
export function toPdf(ops, { widthIn = 17, heightIn = 11, logo = null, title = 'Shop drawing' } = {}) {
    const P = 72, Hpt = heightIn * P;
    const X = (x) => num(x * P), Y = (y) => num(Hpt - y * P);
    const c = ['1 1 1 rg 0 0 ' + num(widthIn * P) + ' ' + num(Hpt) + ' re f', '1 J 1 j'];
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
            // Fit the image in its box, keeping its aspect ratio (like preserveAspectRatio="xMidYMid meet").
            const scale = Math.min(o.w / logo.width, o.h / logo.height);
            const w = logo.width * scale, h = logo.height * scale;
            const x = o.x + (o.w - w) / 2, y = o.y + (o.h - h) / 2;
            c.push(`q ${num(w * P)} 0 0 ${num(h * P)} ${X(x)} ${num(Hpt - (y + h) * P)} cm /Im1 Do Q`);
        }
    }
    const content = latin1(c.join('\n'));

    // Objects: 1 catalog, 2 pages, 3 page, 4 content, 5-6 fonts, 7 info, 8 image (optional).
    const objects = [
        latin1('<< /Type /Catalog /Pages 2 0 R >>'),
        latin1('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
        latin1(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(widthIn * P)} ${num(Hpt)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${logo ? ' /XObject << /Im1 8 0 R >>' : ''} >> /Contents 4 0 R >>`),
        [latin1(`<< /Length ${content.length} >>\nstream\n`), content, latin1('\nendstream')],
        latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
        latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
        latin1(`<< /Title ${pdfString(title)} /Producer (CAS BIM Web Viewer) >>`),
    ];
    if (logo) {
        objects.push([latin1(`<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.jpeg.length} >>\nstream\n`),
            logo.jpeg, latin1('\nendstream')]);
    }
    const chunks = [latin1('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
    let offset = chunks[0].length;
    const offsets = [];
    objects.forEach((obj, i) => {
        offsets.push(offset);
        const parts = [latin1(`${i + 1} 0 obj\n`), ...(Array.isArray(obj) ? obj : [obj]), latin1('\nendobj\n')];
        for (const p of parts) { chunks.push(p); offset += p.length; }
    });
    const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
        + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
    chunks.push(latin1(xref));
    const out = new Uint8Array(chunks.reduce((n, ch) => n + ch.length, 0));
    let at = 0;
    for (const ch of chunks) { out.set(ch, at); at += ch.length; }
    return out;
}
