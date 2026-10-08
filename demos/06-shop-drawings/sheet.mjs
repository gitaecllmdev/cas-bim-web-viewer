// Landscape framing shop drawing (pure; tested in tests/shop-drawings.test.js): 11 x 17 for most panels, a larger sheet
// for large panels (sheetSize: 24 x 36, 36 x 48, or a custom-width 36" roll). The sheet is built once as a
// list of drawing primitives (sheetOps), then written as SVG (renderSheet) or as a vector PDF (renderSheetPdf, ./pdf.mjs).
// Layout follows the CAS panel shops (e.g. P2001): kept to the minimum. FRAMING CUT LIST (label, qty, function, member
// type, length) and a legend top left; the elevation with every member tagged and Revit-style ordinate dimensions to
// every horizontal member; top and bottom track plans with ordinates to every stud and opening; the title block.
// Below the cut list: a 3D view of the panel (iso.mjs), every mark labelled, when the column has room for it.
import { fmtFtIn, FUNCTIONS, isDoor, topAt, pitchText, openingKind, OPENING_KINDS, webOnRight } from '../common/framing.mjs';
import { toPdf, toPdfSheets, textWidth } from './pdf.mjs';
import { qrEncode, qrRects } from '../common/qr.mjs';
import { isoView } from './iso.mjs';
import { prefabState, PREFAB_COLORS } from './prefab.mjs';

// Sheet sizes (landscape, inches). 'auto' takes the smallest one that draws the panel at 1/4" = 1'-0" or larger, so
// long exterior walls stay readable; past 36 x 48 the sheet is 36" tall and as wide as the panel needs (a roll plot).
export const SHEETS = {
    tabloid: { W: 17, H: 11, label: '11 x 17' },
    'arch-d': { W: 36, H: 24, label: '24 x 36 (ARCH D)' },
    'arch-e': { W: 48, H: 36, label: '36 x 48 (ARCH E)' },
};
const MIN_AUTO_SCALE = 1 / 48; // 1/4" = 1'-0"
// Drawing area right of the cut list, and the room the elevation gets (the rest: plans, ordinates, view title, title block).
const areaOf = (W, H) => ({ areaX: 4.6, areaW: W - 5.05, maxH: H - 5.8 });
export function sheetSize(layout, pref = 'auto') {
    if (SHEETS[pref]) return { key: pref, ...SHEETS[pref] };
    for (const [key, sheet] of Object.entries(SHEETS)) {
        const a = areaOf(sheet.W, sheet.H);
        if (pickScale(layout.lengthIn, layout.heightIn, a.areaW - 1.65, a.maxH)[0] >= MIN_AUTO_SCALE) return { key, ...sheet };
    }
    const H = 36, W = Math.ceil((layout.lengthIn * MIN_AUTO_SCALE + 5.05 + 1.65 + 0.2) / 6) * 6;
    return { key: 'custom', W, H, label: `${H} x ${W} (custom)` };
}
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const n = (v) => Number(v.toFixed(4));
const COLORS = { track: '#f2d64b', trackStroke: '#6b5a00', stud: '#ffffff', studStroke: '#1c1c1c', dim: '#1b6aa5', opening: '#9aa0a6', text: '#111',
    hi: '#ff8a3d', hiStroke: '#b34700', hiRow: '#ffe3cc', // hi*: the highlighted mark (on-screen preview only)
    openingDim: '#a01818', context: '#e4e4e4', contextText: '#8d8d8d', level: '#5b5b5b' };
// Member fill by function, as in the CAS legend: tracks yellow, headers and sills salmon, studs light grey.
const FUNC_COLOR = { TTOP: '#f2d64b', TBOT: '#f2d64b', HDD: '#f4a7a0', HDW: '#f4a7a0', SBW: '#f4a7a0', HDM: '#f4a7a0', SBM: '#f4a7a0', SBS: '#f4a7a0', EV: '#ededed', SV: '#ededed', SD: '#ededed', CR: '#ededed' };

// Standard architectural scales, largest first: [paper inches per real inch, label].
const SCALES = [[1 / 8, '1 1/2" = 1\'-0"'], [1 / 12, '1" = 1\'-0"'], [1 / 16, '3/4" = 1\'-0"'], [1 / 24, '1/2" = 1\'-0"'], [1 / 32, '3/8" = 1\'-0"'],
    [1 / 48, '1/4" = 1\'-0"'], [1 / 64, '3/16" = 1\'-0"'], [1 / 96, '1/8" = 1\'-0"'], [1 / 128, '3/32" = 1\'-0"'], [1 / 192, '1/16" = 1\'-0"']];

export function pickScale(lengthIn, heightIn, maxW = 10.4, maxH = 5.2) {
    const fit = Math.min(maxW / lengthIn, maxH / heightIn);
    return SCALES.find(([s]) => s <= fit) || SCALES[SCALES.length - 1];
}

// Drawing primitives (sheet inches, y down): text, line, rect, circle, image.
const text = (x, y, s, { size = 0.09, anchor = 'start', weight = 'normal', rotate = 0, fill = COLORS.text } = {}) =>
    ({ t: 'text', x, y, s: String(s ?? ''), size, anchor, weight, rotate, fill });
const line = (x1, y1, x2, y2, { stroke = '#000', width = 0.008, dash } = {}) => ({ t: 'line', x1, y1, x2, y2, stroke, width, dash });
const rect = (x, y, w, h, { fill = 'none', stroke = '#000', width = 0.008 } = {}) => ({ t: 'rect', x, y, w, h, fill, stroke, width });

// Dimension line with architectural tick marks and the value above (horizontal) or left of it (vertical).
function dim(x1, y1, x2, y2, label, { vertical = false, size = 0.09 } = {}) {
    const t = 0.05, parts = [line(x1, y1, x2, y2, { stroke: COLORS.dim })];
    for (const [x, y] of [[x1, y1], [x2, y2]]) parts.push(line(x - t, y + t, x + t, y - t, { stroke: COLORS.dim, width: 0.012 }));
    parts.push(vertical ? text(x1 - 0.06, (y1 + y2) / 2, label, { size, anchor: 'middle', rotate: -90, fill: COLORS.dim })
        : text((x1 + x2) / 2, y1 - 0.05, label, { size, anchor: 'middle', fill: COLORS.dim }));
    return parts;
}

// Split text into lines no wider than maxW (sheet inches) at this font size; long words (URLs) break anywhere.
function wrap(str, size, maxW) {
    const lines = [];
    let cur = '';
    const fits = (t) => textWidth(t, size, false) <= maxW;
    for (const word of String(str).split(/\s+/).filter(Boolean)) {
        const next = cur ? `${cur} ${word}` : word;
        if (fits(next)) { cur = next; continue; }
        if (cur) lines.push(cur);
        cur = '';
        let w = word;
        while (!fits(w)) {
            let n = w.length - 1;
            while (n > 1 && !fits(w.slice(0, n))) n--;
            lines.push(w.slice(0, n));
            w = w.slice(n);
        }
        cur = w;
    }
    if (cur) lines.push(cur);
    return lines;
}

// SVG for a list of primitives (ops.size: the sheet), or only the part of it in box [x, y, w, h].
function toSvg(ops, box = null) {
    const [bx, by, W, H] = box || [0, 0, ops.size.W, ops.size.H];
    const body = ops.map(o => {
        if (o.t === 'text') return `<text x="${n(o.x)}" y="${n(o.y)}" font-size="${o.size}" text-anchor="${o.anchor}" font-weight="${o.weight}" fill="${o.fill}"${o.rotate ? ` transform="rotate(${o.rotate} ${n(o.x)} ${n(o.y)})"` : ''}>${esc(o.s)}</text>`;
        if (o.t === 'line') return `<line x1="${n(o.x1)}" y1="${n(o.y1)}" x2="${n(o.x2)}" y2="${n(o.y2)}" stroke="${o.stroke}" stroke-width="${o.width}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
        if (o.t === 'rect') return `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" fill="${o.fill}" stroke="${o.stroke}" stroke-width="${o.width}"/>`;
        if (o.t === 'poly') return `<polygon points="${o.pts.map(p => `${n(p[0])},${n(p[1])}`).join(' ')}" fill="${o.fill}" stroke="${o.stroke}" stroke-width="${o.width}" stroke-linejoin="round"/>`;
        if (o.t === 'circle') return `<circle cx="${n(o.cx)}" cy="${n(o.cy)}" r="${o.r}" fill="none" stroke="${o.stroke}" stroke-width="${o.width}"/>`;
        if (o.t === 'hit') return `<rect class="prefab-hit" x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" fill="#1f5fbf" fill-opacity="0" style="cursor:pointer" data-prefab-step="${esc(o.step)}"><title>${esc(o.title)}</title></rect>`;
        if (o.t === 'image') return o.href ? `<image href="${esc(o.href)}" x="${n(o.x)}" y="${n(o.y)}" width="${o.w}" height="${o.h}" preserveAspectRatio="xMidYMid meet"/>` : '';
        return '';
    }).join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(W)}in" height="${n(H)}in" viewBox="${n(bx)} ${n(by)} ${n(W)} ${n(H)}" font-family="Arial, Helvetica, sans-serif">
<rect x="${n(bx)}" y="${n(by)}" width="${n(W)}" height="${n(H)}" fill="white"/>
${body}
</svg>`;
}

// info: { mark, project, level, wallType, date, drawnBy, logoHref, sourceNote, qrUrl (the panel page: QR code in the
//   title block), highlight (optional member mark, e.g. 'C0': its members and cut list row are colored; leave it out
//   for exports), sheet ('auto' default, or a SHEETS key), prefab ({ [mark]: inches }: the PREFAB LENGTH column,
//   prefab.mjs prefabFor), prefabEdit (on screen only: -/+ click areas in that column), prefabMembers (on screen only:
//   members of a mark with a prefab length filled blue / green in the elevation), keyplan ({ href: JPEG data URL, w, h
//   in pixels, level }: the key plan in the title block, captured by Demo 6), keyplanNote (the key plan cell's text when
//   there is none), qrLabel (the text under the QR code), linkNote (the QR code's title block cell without one) }.
//   The QR code (qrUrl: best a short link, demos/common/panel-link.mjs) is printed large beside the legend, so a phone
//   reads it from a few feet away; on a long cut list it shrinks to fit, and under 1" it goes in the title block.
//   The framing conditions go on the panel page, not the sheet.
//   A flipped layout (flipLayout) is drawn as seen from side B.
export function renderSheet(layout, info) {
    return toSvg(sheetOps(layout, info));
}

// One part of the sheet as its own SVG: 'elevation' (the elevation with its ordinates, levels and context, and the two
// track plans), for the web view beside the prefab lengths table (core/client/panel.js).
export function renderSheetRegion(layout, info, region = 'elevation') {
    const ops = sheetOps(layout, info), [x0, y0, x1, y1] = ops.regions[region];
    return toSvg(ops, [x0, y0, x1 - x0, y1 - y0]);
}

// Vector PDF (bytes). logo: { jpeg: Uint8Array, width, height } in pixels, or null.
export function renderSheetPdf(layout, info, logo = null) {
    const ops = sheetOps(layout, info);
    return toPdf(ops, { widthIn: ops.size.W, heightIn: ops.size.H, logo, title: `${info.mark} framing shop drawing` });
}

// Several sheets in one vector PDF, one page each (each its own size): items [{ layout, info }].
export function renderSheetsPdf(items, logo = null, title = 'Framing shop drawings') {
    return toPdfSheets(items.map(({ layout, info }) => { const ops = sheetOps(layout, info); return { ops, widthIn: ops.size.W, heightIn: ops.size.H }; }), { logo, title });
}

export function sheetOps(layout, info) {
    const { lengthIn: L, heightIn: HT, members, cutList, openings } = layout;
    const size = sheetSize(layout, info.sheet), { W, H } = size;
    const { areaX, areaW, maxH } = areaOf(W, H);
    const [s, scaleLabel] = pickScale(L, HT, areaW - 1.65, maxH); // leaves 0.8" each side for the elevation ordinates
    const tbY = H - 1.45, tbH = 1.2; // title block
    const out = [];
    const hi = (m) => info.highlight != null && (m.mark === info.highlight || !!m.marks?.includes(info.highlight));
    const tagOf = (m) => (m.marks?.length > 1 ? m.marks.join('+') : m.mark); // a built-up member: every part's label
    const T = layout.top || null, topY = (x) => topAt(T, x, HT); // a sloped top (framing.mjs wallTop)

    // Border
    out.push(rect(0.25, 0.25, W - 0.5, H - 0.5, { width: 0.02 }));

    // --- Cut list (top left), the CAS panel shop columns. PREFAB LENGTH stays blank (the prefab team writes in a cut
    // length when they override one) unless one was set on the panel page or in Demo 6 (info.prefab, prefab.mjs):
    // blue when longer than the LENGTH, green when shorter.
    const cx = 0.45, cw = [0.42, 0.32, 0.7, 1.05, 0.75, 0.8], rowH = 0.19, tableW = cw.reduce((a, b) => a + b);
    let cy = 0.45;
    out.push(rect(cx, cy, tableW, rowH, { fill: '#e9e9e9', width: 0.01 }));
    out.push(text(cx + tableW / 2, cy + 0.135, `${info.mark} - FRAMING CUT LIST`, { size: 0.1, weight: 'bold', anchor: 'middle' }));
    cy += rowH;
    const row = (vals, bold, fill = 'none', cells = {}) => {
        let x = cx;
        vals.forEach((v, i) => {
            const c = cells[i] || {};
            out.push(rect(x, cy, cw[i], rowH, { fill: c.fill || fill, width: 0.01 }));
            out.push(text(x + cw[i] / 2, cy + 0.135, v, { size: bold ? 0.07 : 0.08, anchor: 'middle', weight: bold || c.color ? 'bold' : 'normal', fill: c.color || COLORS.text }));
            x += cw[i];
        });
        cy += rowH;
    };
    row(['LABEL', 'QTY', 'FUNCTION', 'MEMBER TYPE', 'LENGTH', 'PREFAB LENGTH'], true);
    let prefabSet = false;
    for (const c of cutList) {
        const p = info.prefab?.[c.mark], st = prefabState(c, p), y0 = cy;
        if (st) prefabSet = true;
        row([c.mark, String(c.qty), c.func || '', c.type, fmtFtIn(c.lengthIn), st ? fmtFtIn(p) : ''], false, c.mark === info.highlight ? COLORS.hiRow : 'none',
            st ? { 5: { fill: PREFAB_COLORS[`${st}Fill`], color: PREFAB_COLORS[st] } } : {});
        // On screen only (info.prefabEdit, never in an export): click the left of the cell for 1/8" shorter, the right
        // for 1/8" longer ('hit' areas the page binds; the PDF skips them).
        if (info.prefabEdit) {
            const px = cx + cw.slice(0, 5).reduce((a, b) => a + b, 0), zw = 0.2;
            out.push(text(px + 0.06, y0 + 0.14, '-', { size: 0.11, anchor: 'middle', weight: 'bold', fill: '#8a9099' }));
            out.push(text(px + cw[5] - 0.06, y0 + 0.14, '+', { size: 0.1, anchor: 'middle', weight: 'bold', fill: '#8a9099' }));
            out.push({ t: 'hit', x: px, y: y0, w: zw, h: rowH, step: `${c.mark}|-1`, title: `${c.mark}: 1/8" shorter` });
            out.push({ t: 'hit', x: px + cw[5] - zw, y: y0, w: zw, h: rowH, step: `${c.mark}|1`, title: `${c.mark}: 1/8" longer` });
        }
    }
    out.push(rect(cx, 0.45, tableW, cy - 0.45, { width: 0.02 })); // the table's outline
    out.push(text(cx, cy + 0.16, `GRAND TOTAL: ${cutList.reduce((a, c) => a + c.qty, 0)}`, { size: 0.08, weight: 'bold' }));
    if (prefabSet) { // the key, right of the total: PREFAB LENGTH [blue] LONGER [green] SHORTER
        const parts = [['PREFAB LENGTH:', COLORS.text, null], ['LONGER', PREFAB_COLORS.more, PREFAB_COLORS.moreFill], ['SHORTER', PREFAB_COLORS.less, PREFAB_COLORS.lessFill]];
        const sz = 0.07, gap = 0.06, widths = parts.map(([t]) => textWidth(t, sz, true));
        let x = cx + tableW - widths.reduce((a, b) => a + b, 0) - gap * (parts.length - 1) - 0.02;
        parts.forEach(([t, color, bg], i) => {
            if (bg) out.push(rect(x - 0.02, cy + 0.06, widths[i] + 0.04, 0.13, { fill: bg, stroke: 'none', width: 0 }));
            out.push(text(x, cy + 0.16, t, { size: sz, weight: 'bold', fill: color }));
            x += widths[i] + gap;
        });
    }

    // Legend: only the function codes on this panel.
    let ly = cy + 0.45;
    const used = [...new Set(members.map(m => m.func).filter(Boolean))];
    for (const code of Object.keys(FUNCTIONS).filter(k => used.includes(k))) {
        out.push(rect(cx, ly - 0.075, 0.14, 0.09, { fill: FUNC_COLOR[code] || COLORS.stud, stroke: '#555', width: 0.005 }));
        out.push(text(cx + 0.2, ly, `${code}: ${FUNCTIONS[code]}`, { size: 0.07 }));
        ly += 0.14;
    }
    // Beside the legend: the QR code to the panel page, up to 1.8" (black modules on white, the sheet its quiet zone).
    const drawQr = (url, x, y, size) => {
        const qr = qrEncode(url), m = size / qr.size;
        for (const r of qrRects(qr)) out.push(rect(x + r.x * m, y + r.y * m, r.w * m, r.h * m, { fill: '#000000', stroke: 'none', width: 0 }));
    };
    const qrTop = cy + 0.42, qrSize = info.qrUrl ? Math.min(1.8, tbY - 0.2 - qrTop - 0.3) : 0, qrBig = qrSize >= 1;
    if (qrBig) {
        const qx = cx + tableW - qrSize;
        drawQr(info.qrUrl, qx, qrTop, qrSize);
        out.push(text(qx + qrSize / 2, qrTop + qrSize + 0.17, info.qrLabel || 'SCAN: PANEL PAGE', { size: 0.09, anchor: 'middle', weight: 'bold' }));
        ly = Math.max(ly, qrTop + qrSize + 0.32);
    }
    // Only the exceptions from the scan (a gap across the wall, lifts, double rows): the rest is on the panel page.
    for (const note of layout.notes) {
        for (const ln of wrap(note.toUpperCase(), 0.068, tableW)) { ly += 0.12; out.push(text(cx, ly, ln, { size: 0.068, fill: '#b00020' })); }
    }
    // Fail-safe framing check (framing.mjs checkLayout): a sheet that fails it says so before anything else.
    const issues = layout.issues || [];
    if (issues.length) {
        ly += 0.34;
        out.push(rect(cx - 0.04, ly - 0.16, tableW + 0.08, 0.23, { fill: '#b00020', stroke: 'none', width: 0 }));
        out.push(text(cx + 0.05, ly, `FRAMING CHECK FAILED (${issues.length}) - DO NOT RELEASE`, { size: 0.1, weight: 'bold', fill: '#ffffff' }));
        for (const issue of issues.slice(0, 8)) {
            for (const ln of wrap(issue.message.toUpperCase(), 0.068, tableW)) { ly += 0.12; out.push(text(cx, ly, ln, { size: 0.068, fill: '#b00020' })); }
        }
        if (issues.length > 8) { ly += 0.12; out.push(text(cx, ly, `+ ${issues.length - 8} MORE (SEE THE PANEL PAGE)`, { size: 0.068, weight: 'bold', fill: '#b00020' })); }
    }

    // --- 3D view of the panel in the rest of the column, down to the title block (when there is room for it)
    const isoTop = ly + 0.42, isoBottom = tbY - 0.2;
    if (isoBottom - isoTop >= 1.6) {
        out.push(text(cx, isoTop, `3D VIEW - ${info.mark}${layout.flipped ? ' (SIDE B)' : ' (SIDE A)'} - NOT TO SCALE`, { size: 0.085, weight: 'bold' }));
        out.push(...isoView(layout, { x: cx, y: isoTop + 0.08, w: tableW, h: isoBottom - isoTop - 0.08 }, { highlight: info.highlight }));
    }

    // --- Elevation, centered in the drawing area
    const ex = areaX + (areaW - L * s) / 2; // left end of the wall on the sheet
    const elevTop = 2.35, elevBottom = elevTop + HT * s;
    const X = (x) => ex + x * s, Y = (y) => elevBottom - y * s; // wall inches -> sheet inches

    // Context (info.elev, read from the model by Demo 6): what is within 1 ft above and below the panel, halftone, and
    // the levels there, as dash-dot lines named with their height from the bottom of the panel. Drawn first, under the
    // framing; mirrored for a panel seen from side B. The bands stop short of the track plans. Their names go where
    // they miss the track tags (left end, right end or middle of the band).
    const stripHt = Math.max(0.1, Math.min(0.25, (layout.studIn || 6) * s));
    const bandUp = Math.min(12, (0.75 - stripHt - 0.1) / s), bandDown = Math.min(12, 0.3 / s);
    const ctxX = (x) => (layout.flipped ? L - x : x);
    const hTagY = (m) => (T && m.role === 'top track' ? Y(topY(m.x + m.w / 2)) - 0.035
        : m.role === 'top track' || m.role === 'sill track' ? Y(m.y + m.h) - 0.035 : Y(m.y) + 0.095);
    const textBox = (x, y, str, size, anchor) => {
        const w = textWidth(str, size, false), x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
        return { x0: x0 - 0.02, x1: x0 + w + 0.02, y0: y - size * 0.85, y1: y + size * 0.25 };
    };
    const taken = members.filter(m => m.orient === 'h').map(m => textBox(X(m.x + m.w / 2), hTagY(m), tagOf(m), 0.075, 'middle'));
    const isFree = (bx) => !taken.some(t => bx.x0 < t.x1 && t.x0 < bx.x1 && bx.y0 < t.y1 && t.y0 < bx.y1);
    // The first of the candidate spots [x, anchor] where the text misses everything placed so far; null if none.
    const place = (str, size, y, spots) => {
        for (const [x, anchor] of spots) {
            const bx = textBox(x, y, str, size, anchor);
            if (isFree(bx)) { taken.push(bx); return { x, anchor }; }
        }
        return null;
    };
    // Halftone first (under the level lines and every name).
    for (const obj of info.elev?.context || []) {
        for (const [x0, y0, x1, y1] of obj.rects || []) {
            const ya = Math.max(y0, -bandDown), yb = Math.min(y1, HT + bandUp);
            const xa = Math.max(0, Math.min(ctxX(x0), ctxX(x1))), xb = Math.min(L, Math.max(ctxX(x0), ctxX(x1)));
            if (yb > ya && xb > xa) out.push(rect(X(xa), Y(yb), (xb - xa) * s, (yb - ya) * s, { fill: COLORS.context, stroke: 'none', width: 0 }));
        }
    }
    for (const lv of info.elev?.levels || []) {
        if (lv.y < -bandDown || lv.y > HT + bandUp) continue;
        const y = Y(lv.y), below = lv.y < HT / 2; // the name in the band the line is in
        out.push(line(X(0) - 0.15, y, X(L) + 0.15, y, { stroke: COLORS.level, width: 0.006, dash: '0.14 0.04 0.02 0.04' }));
        const str = `${lv.name.toUpperCase()} @ ${lv.y < 0 ? '-' : ''}${fmtFtIn(Math.abs(lv.y))}`, ty = below ? y + 0.085 : y - 0.03;
        const at = place(str, 0.065, ty, [[X(0) + 0.17, 'start'], [X(L) - 0.05, 'end'], [X(L / 2), 'middle'], [X(L * 0.25), 'middle'], [X(L * 0.75), 'middle']]);
        if (!at) continue;
        const tx = at.anchor === 'start' ? at.x - 0.12 : at.anchor === 'end' ? at.x - textWidth(str, 0.065, false) - 0.12 : at.x - textWidth(str, 0.065, false) / 2 - 0.12;
        out.push({ t: 'poly', pts: [[tx, y - 0.07], [tx + 0.08, y - 0.07], [tx + 0.04, y]], fill: COLORS.level, stroke: 'none', width: 0 });
        out.push(text(at.x, ty, str, { size: 0.065, anchor: at.anchor, weight: 'bold', fill: COLORS.level }));
    }
    // Context names stay off the level lines.
    for (const lv of info.elev?.levels || []) if (lv.y >= -bandDown && lv.y <= HT + bandUp) taken.push({ x0: X(0) - 0.15, x1: X(L) + 0.15, y0: Y(lv.y) - 0.02, y1: Y(lv.y) + 0.02 });
    const labelled = new Set();
    for (const obj of info.elev?.context || []) {
        let best = null;
        for (const [x0, y0, x1, y1] of obj.rects || []) {
            const ya = Math.max(y0, -bandDown), yb = Math.min(y1, HT + bandUp);
            const xa = Math.max(0, Math.min(ctxX(x0), ctxX(x1))), xb = Math.min(L, Math.max(ctxX(x0), ctxX(x1)));
            if (yb <= ya || xb <= xa) continue;
            if (!best || xb - xa > best.xb - best.xa) best = { xa, xb, ya, yb };
        }
        const name = [obj.category, obj.name].filter(Boolean).join(': ').toUpperCase().slice(0, 48);
        if (!best || !name || labelled.has(name)) continue; // one label per kind of thing (three door frames: one)
        const w = textWidth(name, 0.06, false);
        if (w > (best.xb - best.xa) * s) continue;
        const y = Y((best.ya + best.yb) / 2) + 0.02, xa = X(best.xa) + w / 2 + 0.03, xb = X(best.xb) - w / 2 - 0.03;
        const at = place(name, 0.06, y, [[(xa + xb) / 2, 'middle'], [xa, 'middle'], [xb, 'middle'], [xa + (xb - xa) / 4, 'middle'], [xb - (xb - xa) / 4, 'middle']]);
        if (!at) continue;
        labelled.add(name);
        out.push(text(at.x, y, name, { size: 0.06, anchor: 'middle', fill: COLORS.contextText }));
    }

    // Openings: outline with an X (sizes come from the ordinates)
    for (const o of openings) {
        out.push(rect(X(o.left), Y(o.top), (o.right - o.left) * s, (o.top - o.bottom) * s, { stroke: COLORS.opening, width: 0.008 }));
        out.push(line(X(o.left), Y(o.top), X(o.right), Y(o.bottom), { stroke: COLORS.opening, width: 0.005, dash: '0.04 0.03' }));
        out.push(line(X(o.left), Y(o.bottom), X(o.right), Y(o.top), { stroke: COLORS.opening, width: 0.005, dash: '0.04 0.03' }));
        if (o.requested) { // framed out to the stud layout: the rough opening as asked for, inside
            out.push(rect(X(o.requested.left), Y(o.top), (o.requested.right - o.requested.left) * s, (o.top - o.bottom) * s, { stroke: COLORS.openingDim, width: 0.007 }));
            out.push(text(X(o.requested.left) + 0.04, Y(o.top) + 0.1, `RO ${fmtFtIn(o.requested.right - o.requested.left)}`, { size: 0.06, weight: 'bold', fill: COLORS.openingDim })); // in its corner: clear of the tags on the header and sill
        }
        // An MEP opening or a steel penetration says what it is (doors and windows read from their framing).
        const kind = openingKind(o);
        if ((kind === 'mep' || kind === 'steel') && (o.right - o.left) * s > textWidth(OPENING_KINDS[kind], 0.06, true) + 0.08) { // when the name fits across it
            out.push(rect(X((o.left + o.right) / 2) - 0.03 - textWidth(OPENING_KINDS[kind], 0.06, true) / 2, Y((o.bottom + o.top) / 2) - 0.07, textWidth(OPENING_KINDS[kind], 0.06, true) + 0.06, 0.1, { fill: '#ffffff', stroke: 'none', width: 0 }));
            out.push(text(X((o.left + o.right) / 2), Y((o.bottom + o.top) / 2), OPENING_KINDS[kind], { size: 0.06, anchor: 'middle', weight: 'bold', fill: COLORS.openingDim }));
        }
    }
    // Members, colored by function like the CAS legend (on screen, info.prefabMembers: a mark with a prefab length in
    // blue when longer, green when shorter)
    const rowOf = new Map(cutList.map(c => [c.mark, c]));
    const prefabOf = (m) => (info.prefabMembers && rowOf.has(m.mark) ? prefabState(rowOf.get(m.mark), info.prefab?.[m.mark]) : null);
    for (const m of members) {
        const st = prefabOf(m);
        const look = hi(m) ? { fill: COLORS.hi, stroke: COLORS.hiStroke, width: 0.012 }
            : st ? { fill: PREFAB_COLORS[`${st}Member`], stroke: PREFAB_COLORS[st], width: 0.012 }
                : { fill: FUNC_COLOR[m.func] || COLORS.stud, stroke: m.orient === 'h' ? COLORS.trackStroke : COLORS.studStroke, width: 0.006 };
        // Under a sloped top: the member's outline (its top cut to the slope).
        out.push(m.pts ? { t: 'poly', pts: m.pts.map(([x, y]) => [X(x), Y(y)]), ...look } : rect(X(m.x), Y(m.y + m.h), m.w * s, m.h * s, look));
    }
    // Tags on every member. Verticals: at mid-height, beside the stud (no box over it, so the member reads unbroken):
    // left of it, or right of it when a stud stands right against its left side (a jamb pair); level text when the
    // studs are far enough apart, else along the stud.
    const verticals = members.filter(m => m.orient === 'v').sort((a, b) => a.x - b.x);
    const minGap = verticals.slice(1).reduce((g, m, i) => Math.min(g, (m.x - verticals[i].x) * s), Infinity);
    const level = minGap >= 0.22;
    const overlapsY = (a, b) => a.y < b.y + b.h && b.y < a.y + a.h;
    for (const m of verticals) {
        const my = Y(m.y + m.h / 2), fill = hi(m) ? COLORS.hiStroke : COLORS.text;
        const gap = (side) => {
            const others = verticals.filter(o => o !== m && overlapsY(o, m) && (side < 0 ? o.x + o.w <= m.x + 0.01 : o.x >= m.x + m.w - 0.01));
            const near = side < 0 ? Math.max(-Infinity, ...others.map(o => o.x + o.w)) : Math.min(Infinity, ...others.map(o => o.x));
            return Number.isFinite(near) ? Math.abs(side < 0 ? m.x - near : near - (m.x + m.w)) * s : Infinity;
        };
        const right = gap(-1) < 0.08 && gap(1) > gap(-1);
        if (level) {
            out.push(text(right ? X(m.x + m.w) + 0.025 : X(m.x) - 0.025, my + 0.025, tagOf(m), { size: 0.075, anchor: right ? 'start' : 'end', weight: 'bold', fill }));
        } else {
            // Rotated a quarter turn, the letters stand to the left of the baseline.
            out.push(text(right ? X(m.x + m.w) + 0.07 : X(m.x) - 0.015, my, tagOf(m), { size: 0.075, anchor: 'middle', rotate: -90, weight: 'bold', fill }));
        }
    }
    // Horizontals: centered on the member (hTagY: outside the panel for its tracks, inside the opening for heads and sills).
    for (const m of members.filter(m => m.orient === 'h')) {
        out.push(text(X(m.x + m.w / 2), hTagY(m), tagOf(m), { size: 0.075, anchor: 'middle', weight: 'bold', fill: hi(m) ? COLORS.hiStroke : COLORS.trackStroke }));
    }
    // A sloped top: the height at each peak or break, and each sloped run's pitch along it (a third of the way along,
    // clear of the track's tag in the middle).
    for (const [x, h] of T ? T.slice(1, -1) : []) {
        out.push(line(X(x), Y(h) - 0.05, X(x), Y(h) - 0.13, { stroke: COLORS.dim, width: 0.006 }));
        out.push(text(X(x), Y(h) - 0.16, fmtFtIn(h), { size: 0.08, anchor: 'middle', weight: 'bold', fill: COLORS.dim }));
    }
    for (let i = 1; T && i < T.length; i++) {
        const [x0, h0] = T[i - 1], [x1, h1] = T[i], k = (h1 - h0) / (x1 - x0);
        if (!k) continue;
        const at = x0 + (x1 - x0) / 3;
        out.push(text(X(at), Y(topY(at)) - 0.06, `SLOPE ${pitchText(k)}`, { size: 0.065, anchor: 'middle', rotate: (-Math.atan(k) * 180) / Math.PI, fill: COLORS.dim }));
    }
    // Panel mark, above mid-height so it does not cover the stud tags there
    const pmX = X(L / 2), pmY = Y((T ? topY(L / 2) : HT) * 0.72);
    out.push(rect(pmX - 0.55, pmY - 0.14, 1.1, 0.22, { fill: 'white', stroke: '#000', width: 0.008 }));
    out.push(text(pmX, pmY + 0.03, info.mark, { size: 0.13, anchor: 'middle', weight: 'bold' }));

    // --- Elevation ordinates (Revit style): the elevation of every horizontal member from the base of the wall, on an
    // extension line out past the panel end: tracks at both ends; heads and sills at the end nearer to them.
    const elevations = []; // { y, side: 'both' | 'left' | 'right', from: x at the member end }
    const addElev = (y, side, fromX) => {
        const same = elevations.find(e => Math.abs(e.y - y) < 1 / 16 && (e.side === side || e.side === 'both'));
        if (!same) elevations.push({ y, side, fromX });
    };
    for (const m of members.filter(m => m.orient === 'h')) {
        if (m.role === 'top track') { if (!T) addElev(m.y + m.h, 'both'); } // a sloped top: its height at each end, below
        else if (m.role === 'bottom track') { addElev(m.y, 'both'); addElev(m.y + m.h, 'both'); }
        else {
            const y = m.role === 'head track' ? m.y : m.y + m.h; // head: underside (rough opening top); sill: top (rough opening bottom)
            const left = m.x + m.w / 2 < L / 2;
            addElev(y, left ? 'left' : 'right', left ? m.x : m.x + m.w);
        }
    }
    if (T) { addElev(topY(0), 'left'); addElev(topY(L), 'right'); }
    const ordColumn = (side) => {
        const list = elevations.filter(e => e.side === 'both' || e.side === side).sort((a, b) => a.y - b.y);
        const edge = side === 'left' ? X(0) : X(L), dir = side === 'left' ? -1 : 1, reach = 0.8;
        let lastY = -Infinity, below = false;
        for (const e of list) {
            const y = Y(e.y);
            below = Math.abs(lastY - y) < 0.13 ? !below : false; // two close values: one above its line, one below
            lastY = y;
            if (e.fromX != null) out.push(line(X(e.fromX), y, edge, y, { stroke: COLORS.dim, width: 0.004, dash: '0.03 0.02' })); // across the panel
            out.push(line(edge + dir * 0.04, y, edge + dir * reach, y, { stroke: COLORS.dim, width: 0.005 }));
            out.push(text(edge + dir * reach, below ? y + 0.1 : y - 0.03, fmtFtIn(e.y), { size: 0.08, anchor: side === 'left' ? 'start' : 'end', fill: COLORS.dim }));
        }
    };
    ordColumn('left');
    ordColumn('right');

    // --- Track plans above and below the elevation, with ordinates from the left end to every stud (and, on the
    // bottom plan, to the edges of every opening).
    const stripH = Math.max(0.1, Math.min(0.25, (layout.studIn || 6) * s));
    const topStrip = elevTop - 0.75, botStrip = elevBottom + 0.4;
    const trackLeg = members.find(m => m.role === 'top track')?.h ?? 1.25;
    const studsAt = (atTop) => members.filter(m => m.orient === 'v' && (atTop ? (T ? m.atTop : m.y + m.h >= HT - trackLeg - 0.01) : m.y <= trackLeg + 0.01));
    // A C stud in plan: web across the track, flanges along its two faces, lips turned in. The web goes on the side of
    // the opening or panel end the stud closes (jamb and end studs), else on its left face.
    const studSymbol = (m, y0) => {
        const fw = Math.max(m.w * s, 0.035), inset = stripH * 0.12, top = y0 + inset, bot = y0 + stripH - inset;
        const lip = Math.min(0.03, (bot - top) * 0.22);
        const webRight = webOnRight(m, layout);
        const xw = webRight ? X(m.x + m.w) : X(m.x), xf = webRight ? xw - fw : xw + fw;
        const st = { stroke: COLORS.studStroke, width: 0.006 };
        return [line(xw, top, xw, bot, st), line(xw, top, xf, top, st), line(xw, bot, xf, bot, st), line(xf, top, xf, top + lip, st), line(xf, bot, xf, bot - lip, st)];
    };
    // Plan ordinates from the end the stud layout starts at (Flip panel: the right end; on side B the drawing is mirrored).
    const ordinate = (x) => fmtFtIn(layout.layoutFromRight && !layout.flipped ? L - x : x);
    const plan = (y0, atTop) => {
        const segs = atTop ? members.filter(m => m.role === 'top track' && (T || m.y + m.h >= HT - 0.01)) : members.filter(m => m.role === 'bottom track' && m.y <= 0.01);
        for (const m of segs) out.push(rect(X(m.x), y0, m.w * s, stripH, { fill: COLORS.track, stroke: COLORS.trackStroke }));
        for (const m of studsAt(atTop)) out.push(...studSymbol(m, y0));
        out.push(text(X(0) - 0.08, y0 + stripH / 2 + 0.03, atTop ? 'TOP' : 'BTM', { size: 0.075, anchor: 'end', weight: 'bold' }));
        // Ordinates: both wall ends, the studs (left face), and on the bottom plan the opening edges. Where two would
        // overlap, the wall end wins, then the opening edge, then the stud.
        const marks = [{ x: 0, rank: 3 }, { x: L, rank: 3 }, ...studsAt(atTop).map(m => ({ x: m.x, rank: 1 }))];
        if (atTop && T) for (const [x] of T.slice(1, -1)) marks.push({ x, rank: 2, bold: true }); // where each peak or break is
        if (atTop) { // a steel penetration cuts the top track: its edges, and what it is
            for (const o of openings.filter(o => o.through)) {
                marks.push({ x: o.left, rank: 2, opening: true }, { x: o.right, rank: 2, opening: true });
                out.push(rect(X(o.left), y0 - 0.02, (o.right - o.left) * s, stripH + 0.04, { stroke: COLORS.opening, width: 0.006 }));
                out.push(text(X((o.left + o.right) / 2), y0 + stripH / 2 + 0.03, 'STEEL', { size: 0.06, anchor: 'middle', fill: COLORS.opening }));
            }
        }
        if (!atTop) {
            for (const o of openings) {
                marks.push({ x: o.left, rank: 2, opening: true }, { x: o.right, rank: 2, opening: true });
                out.push(rect(X(o.left), y0 - 0.02, (o.right - o.left) * s, stripH + 0.04, { stroke: COLORS.opening, width: 0.006 }));
                out.push(text(X((o.left + o.right) / 2), y0 + stripH / 2 + 0.03, { door: 'DOOR', window: 'WINDOW', mep: 'MEP', steel: 'STEEL' }[openingKind(o)], { size: 0.06, anchor: 'middle', fill: COLORS.opening }));
            }
        }
        marks.sort((a, b) => a.x - b.x || b.rank - a.rank);
        const kept = [];
        for (const mk of marks) {
            const prev = kept[kept.length - 1];
            if (prev && (X(mk.x) - X(prev.x)) < 0.1) { if (mk.rank > prev.rank) kept[kept.length - 1] = mk; continue; }
            kept.push(mk);
        }
        for (const mk of kept) {
            const x = X(mk.x), fill = mk.opening ? COLORS.openingDim : COLORS.dim;
            if (atTop) {
                out.push(line(x, y0 - 0.06, x, y0, { stroke: fill, width: 0.005 }));
                out.push(text(x + 0.03, y0 - 0.08, ordinate(mk.x), { size: 0.065, rotate: -90, fill, weight: mk.bold || mk.opening ? 'bold' : 'normal' }));
            } else {
                out.push(line(x, y0 + stripH, x, y0 + stripH + 0.06, { stroke: fill, width: 0.005 }));
                out.push(text(x + 0.03, y0 + stripH + 0.08, ordinate(mk.x), { size: 0.065, rotate: -90, anchor: 'end', fill, weight: mk.opening ? 'bold' : 'normal' }));
            }
        }
    };
    plan(topStrip, true);
    plan(botStrip, false);

    // The elevation's region (renderSheetRegion): with its ordinates either side and the track plans' ordinates.
    out.regions = { elevation: [Math.max(0.25, X(0) - 0.95), Math.max(0.25, topStrip - 0.75), Math.min(W - 0.25, X(L) + 0.95), Math.min(tbY - 0.05, botStrip + stripH + 0.7)] };

    // View title under the drawing
    const titleY = Math.min(botStrip + stripH + 0.85, tbY - 0.3);
    out.push({ t: 'circle', cx: X(0) + 0.14, cy: titleY - 0.04, r: 0.13, stroke: '#000', width: 0.012 });
    out.push(text(X(0) + 0.14, titleY, '1', { size: 0.11, anchor: 'middle', weight: 'bold' }));
    out.push(text(X(0) + 0.36, titleY, `FRAMING ELEVATION - ${info.mark}${layout.flipped ? ' (FLIPPED: VIEWED FROM SIDE B)' : ''}`, { size: 0.12, weight: 'bold' }));
    out.push(line(X(0) + 0.36, titleY + 0.04, X(0) + 3.2, titleY + 0.04, { width: 0.012 }));
    out.push(text(X(0) + 0.36, titleY + 0.2, `SCALE: ${scaleLabel}`, { size: 0.085 }));

    // --- Title block
    // Cells from the left: logo, project, drawing (takes the extra width on a larger sheet), key plan, studs, review,
    // QR, sheet. Long values wrap in their cell.
    const kx = W - 9.95; // the key plan cell: kx to W - 7.1
    const cells = [[0.25, 1.35], [1.35, 4.15], [4.15, kx], [kx, W - 7.1], [W - 7.1, W - 4.4], [W - 4.4, W - 2.85], [W - 2.85, W - 1.65], [W - 1.65, W - 0.25]];
    out.push(rect(0.25, tbY, W - 0.5, tbH, { width: 0.02 }));
    for (const [a] of cells.slice(1)) out.push(line(a, tbY, a, tbY + tbH, { width: 0.01 }));
    out.push({ t: 'image', id: 'logo', href: info.logoHref, x: 0.33, y: tbY + 0.1, w: 0.95, h: 0.95 });
    const field = (x, y, label, value, size = 0.1, maxW = Infinity, lines = 1) => {
        out.push(text(x, y, label, { size: 0.065, fill: '#555' }));
        wrap(String(value ?? ''), size, maxW).slice(0, lines).forEach((ln, i) => out.push(text(x, y + 0.15 + i * size * 1.2, ln, { size, weight: 'bold' })));
    };
    field(1.45, tbY + 0.2, 'PROJECT', info.project, 0.1, 2.6, 2);
    field(1.45, tbY + 0.6, 'SOURCE', info.sourceNote || 'Model-based framing layout', 0.07, 2.6, 3);
    field(4.25, tbY + 0.2, 'DRAWING', `FRAMING ELEVATION - ${info.mark}`, 0.1, kx - 4.35, 2);
    field(4.25, tbY + 0.6, 'LEVEL / WALL TYPE', `${info.level} / ${info.wallType}`, 0.07, kx - 4.35, 3);
    // Key plan: the wall's floor plan around it (the wall in red, the room names), the whole floor inset (Demo 6).
    const kp = info.keyplan;
    out.push(text(kx + 0.08, tbY + 0.13, `KEY PLAN${kp?.level ? ` - ${String(kp.level).toUpperCase()}` : ''}`, { size: 0.065, fill: '#555' }));
    if (kp?.href) {
        out.push({ t: 'image', id: 'keyplan', href: kp.href, px: [kp.w, kp.h], x: kx + 0.06, y: tbY + 0.18, w: W - 7.1 - kx - 0.12, h: tbH - 0.24 });
        out.push(rect(kx + 0.06, tbY + 0.18, W - 7.1 - kx - 0.12, tbH - 0.24, { width: 0.006, stroke: '#9aa0a6' }));
    } else {
        out.push(text((kx + W - 7.1) / 2, tbY + 0.68, info.keyplanNote || 'PICK THE WALL IN THE VIEWER TO ADD IT', { size: 0.06, anchor: 'middle', fill: '#8d8d8d' }));
    }
    field(W - 7.0, tbY + 0.2, 'STUDS', `${layout.studType} @ ${layout.spacingIn}" O.C.`);
    field(W - 7.0, tbY + 0.6, 'TRACK', layout.trackType);
    out.push(text(W - 3.625, tbY + 0.3, 'FOR REVIEW', { size: 0.1, anchor: 'middle', weight: 'bold', fill: '#b00020' }));
    out.push(text(W - 3.625, tbY + 0.45, 'NOT FOR CONSTRUCTION', { size: 0.08, anchor: 'middle', weight: 'bold', fill: '#b00020' }));
    out.push(text(W - 4.3, tbY + 0.8, `DATE: ${info.date}`, { size: 0.075 }));
    out.push(text(W - 4.3, tbY + 0.97, `DRAWN: ${info.drawnBy}`, { size: 0.075 }));
    if (layout.issues) {
        out.push(text(W - 4.3, tbY + 1.12, layout.issues.length ? `CHECK: FAILED (${layout.issues.length})` : 'CHECK: PASSED',
            { size: 0.075, weight: 'bold', fill: layout.issues.length ? '#b00020' : '#1e7b34' }));
    }
    if (info.qrUrl && !qrBig) {
        // No room beside the legend: the QR code to the panel page here (drawing, conditions, links, comments).
        drawQr(info.qrUrl, W - 2.85 + 0.14, tbY + 0.07, 0.92);
        out.push(text(W - 2.25, tbY + 1.12, info.qrLabel || 'SCAN: PANEL PAGE', { size: 0.055, anchor: 'middle', weight: 'bold' }));
    } else if (info.qrUrl || info.linkNote) {
        // The panel page's link as text (the QR code is beside the legend), or why there is none.
        out.push(text(W - 2.77, tbY + 0.2, info.qrUrl ? 'PANEL PAGE' : 'LINK', { size: 0.065, fill: '#555' }));
        const lines = wrap(info.qrUrl ? info.qrUrl.replace(/^https?:\/\//, '') : info.linkNote, 0.06, 0.98).slice(0, 6);
        lines.forEach((ln, i) => out.push(text(W - 2.77, tbY + 0.4 + i * 0.1, ln, { size: 0.06, weight: info.qrUrl ? 'bold' : 'normal' })));
        if (info.qrUrl) out.push(text(W - 2.77, tbY + 1.1, 'QR CODE: BESIDE THE LEGEND', { size: 0.05, fill: '#555' }));
    }
    out.push(text(W - 1.55, tbY + 0.2, 'SHEET', { size: 0.065, fill: '#555' }));
    out.push(text(W - 0.95, tbY + 0.7, info.mark, { size: 0.2, anchor: 'middle', weight: 'bold' }));
    out.push(text(W - 0.95, tbY + 0.95, `SCALE ${scaleLabel}`, { size: 0.065, anchor: 'middle' }));
    out.push(text(W - 0.95, tbY + 1.1, size.label, { size: 0.065, anchor: 'middle' }));

    out.size = size; // the sheet these ops are drawn on
    return out;
}
