// 11 x 17 landscape framing shop drawing (pure; tested in tests/shop-drawings.test.js). The sheet is built once as a
// list of drawing primitives (sheetOps), then written as SVG (renderSheet) or as a vector PDF (renderSheetPdf, ./pdf.mjs).
// Layout follows the CAS shop sheets: FRAMING CUT LIST top left, elevation in the middle with the top and bottom
// track layout strips above and below it, ordinate stud dimensions, overall dimensions, and the title block at the bottom.
import { fmtFtIn } from '../common/framing.mjs';
import { toPdf, textWidth } from './pdf.mjs';
import { qrEncode, qrRects } from '../common/qr.mjs';

const W = 17, H = 11; // sheet, inches
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const n = (v) => Number(v.toFixed(4));
const COLORS = { track: '#f2d64b', trackStroke: '#6b5a00', stud: '#ffffff', studStroke: '#1c1c1c', dim: '#1b6aa5', opening: '#9aa0a6', text: '#111',
    hi: '#ff8a3d', hiStroke: '#b34700', hiRow: '#ffe3cc' }; // hi*: the highlighted mark (on-screen preview only)

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

// SVG for a list of primitives.
function toSvg(ops) {
    const body = ops.map(o => {
        if (o.t === 'text') return `<text x="${n(o.x)}" y="${n(o.y)}" font-size="${o.size}" text-anchor="${o.anchor}" font-weight="${o.weight}" fill="${o.fill}"${o.rotate ? ` transform="rotate(${o.rotate} ${n(o.x)} ${n(o.y)})"` : ''}>${esc(o.s)}</text>`;
        if (o.t === 'line') return `<line x1="${n(o.x1)}" y1="${n(o.y1)}" x2="${n(o.x2)}" y2="${n(o.y2)}" stroke="${o.stroke}" stroke-width="${o.width}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
        if (o.t === 'rect') return `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" fill="${o.fill}" stroke="${o.stroke}" stroke-width="${o.width}"/>`;
        if (o.t === 'circle') return `<circle cx="${n(o.cx)}" cy="${n(o.cy)}" r="${o.r}" fill="none" stroke="${o.stroke}" stroke-width="${o.width}"/>`;
        if (o.t === 'image') return o.href ? `<image href="${esc(o.href)}" x="${n(o.x)}" y="${n(o.y)}" width="${o.w}" height="${o.h}" preserveAspectRatio="xMidYMid meet"/>` : '';
        return '';
    }).join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="17in" height="11in" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">
<rect x="0" y="0" width="${W}" height="${H}" fill="white"/>
${body}
</svg>`;
}

// info: { mark, project, level, wallType, assembly, board, fireRating, date, drawnBy, logoHref, sourceNote,
//   conditions ([label, value] lines from conditions.mjs), qrUrl (the panel page: QR code in the title block),
//   highlight (optional member mark, e.g. 'C0': its members and cut list row are colored; leave it out for exports) }
export function renderSheet(layout, info) {
    return toSvg(sheetOps(layout, info));
}

// Vector PDF (bytes). logo: { jpeg: Uint8Array, width, height } in pixels, or null.
export function renderSheetPdf(layout, info, logo = null) {
    return toPdf(sheetOps(layout, info), { widthIn: W, heightIn: H, logo, title: `${info.mark} framing shop drawing` });
}

export function sheetOps(layout, info) {
    const { lengthIn: L, heightIn: HT, members, cutList, ticks, openings } = layout;
    const [s, scaleLabel] = pickScale(L, HT);
    const out = [];

    // Border
    out.push(rect(0.25, 0.25, W - 0.5, H - 0.5, { width: 0.02 }));

    // --- Cut list (top left)
    const cx = 0.45, cw = [0.55, 0.45, 1.6, 1.2], rowH = 0.19;
    let cy = 0.45;
    out.push(rect(cx, cy, cw.reduce((a, b) => a + b), rowH, { fill: '#e9e9e9', width: 0.01 }));
    out.push(text(cx + 0.06, cy + 0.135, `${info.mark} - FRAMING CUT LIST`, { size: 0.1, weight: 'bold' }));
    cy += rowH;
    const cols = ['MARK', 'QTY', 'MEMBER TYPE', 'LENGTH'];
    const row = (vals, bold, fill = 'none') => {
        let x = cx;
        vals.forEach((v, i) => {
            out.push(rect(x, cy, cw[i], rowH, { fill, width: 0.006 }));
            out.push(text(i === 1 || i === 3 ? x + cw[i] - 0.05 : x + 0.05, cy + 0.135, v, { size: 0.085, anchor: i === 1 || i === 3 ? 'end' : 'start', weight: bold ? 'bold' : 'normal' }));
            x += cw[i];
        });
        cy += rowH;
    };
    row(cols, true);
    for (const c of cutList) row([c.mark, String(c.qty), c.type, fmtFtIn(c.lengthIn)], false, c.mark === info.highlight ? COLORS.hiRow : 'none');
    const totalPcs = cutList.reduce((a, c) => a + c.qty, 0);
    out.push(text(cx, cy + 0.16, `TOTAL MEMBERS: ${totalPcs}`, { size: 0.085, weight: 'bold' }));

    // --- Assembly and notes (under the cut list)
    let ny = cy + 0.45;
    const noteLines = [
        ['WALL TYPE', info.wallType], ['ASSEMBLY', info.assembly], ['STUDS', `${layout.studType} @ ${layout.spacingIn}" O.C.`],
        ['TRACK', layout.trackType], ['BOARD', info.board], ['FIRE RATING', info.fireRating || '-'],
        ['WALL', `${fmtFtIn(L)} LONG x ${fmtFtIn(HT)} HIGH`], ['OPENINGS', openings.length ? openings.map(o => `${fmtFtIn(o.right - o.left)} x ${fmtFtIn(o.top - o.bottom)}`).join(', ') : 'NONE'],
    ];
    out.push(text(cx, ny, 'ASSEMBLY', { size: 0.1, weight: 'bold' }));
    ny += 0.2;
    for (const [k, v] of noteLines) {
        out.push(text(cx, ny, `${k}:`, { size: 0.08, weight: 'bold' }));
        out.push(text(cx + 0.95, ny, v, { size: 0.08 }));
        ny += 0.16;
    }
    ny += 0.15;
    out.push(text(cx, ny, 'NOTES', { size: 0.1, weight: 'bold' }));
    const notes = [
        'STUDS CUT 1/16" SHORT OF TRACK-TO-TRACK HEIGHT (SEAT ALLOWANCE).',
        'OPENINGS FROM MODEL GEOMETRY; VERIFY ROUGH OPENINGS WITH DOOR/WINDOW SCHEDULES.',
        'GAUGE, HEADERS AND CONNECTIONS PER FRAMING ENGINEER.',
        'STUD LAYOUT FROM LEFT END OF WALL AS DRAWN.',
        ...layout.notes.map(t => t.toUpperCase()),
    ];
    notes.forEach((t, i) => { ny += 0.16; out.push(text(cx, ny, `${i + 1}. ${t}`, { size: 0.075 })); });

    // --- Conditions: location, head and base of wall, ends, what is within 1 ft (framing context from the model)
    const conditions = [...(info.conditions || []), ...(info.qrUrl ? [['PANEL PAGE', info.qrUrl]] : [])];
    if (conditions.length) {
        ny += 0.32;
        out.push(text(cx, ny, 'CONDITIONS (FROM THE MODEL; VERIFY IN THE FIELD)', { size: 0.1, weight: 'bold' }));
        const valueX = cx + 1.2, maxW = 4.85 - valueX, size = 0.068, bottom = 9.35;
        for (const [k, v] of conditions) {
            const lines = wrap(k === 'PANEL PAGE' ? v : String(v).toUpperCase(), size, maxW);
            if (ny + 0.15 + (lines.length - 1) * 0.115 > bottom) {
                out.push(text(cx, Math.min(ny + 0.15, bottom), 'MORE ON THE PANEL PAGE (SCAN THE QR CODE).', { size, weight: 'bold' }));
                break;
            }
            ny += 0.15;
            out.push(text(cx, ny, `${k}:`, { size, weight: 'bold' }));
            lines.forEach((ln, i) => { if (i) ny += 0.115; out.push(text(valueX, ny, ln, { size })); });
        }
    }

    // --- Elevation
    const areaX = 5.0, areaW = 11.4;
    const ex = areaX + 0.5 + (areaW - 0.5 - L * s) / 2; // left end of the wall on the sheet
    const elevTop = 2.3, elevBottom = elevTop + HT * s;
    const X = (x) => ex + x * s, Y = (y) => elevBottom - y * s; // wall inches -> sheet inches

    // Openings: outline with an X
    for (const o of openings) {
        out.push(rect(X(o.left), Y(o.top), (o.right - o.left) * s, (o.top - o.bottom) * s, { stroke: COLORS.opening, width: 0.008 }));
        out.push(line(X(o.left), Y(o.top), X(o.right), Y(o.bottom), { stroke: COLORS.opening, width: 0.005, dash: '0.04 0.03' }));
        out.push(line(X(o.left), Y(o.bottom), X(o.right), Y(o.top), { stroke: COLORS.opening, width: 0.005, dash: '0.04 0.03' }));
        out.push(...dim(X(o.left), Y(o.top) + 0.18, X(o.right), Y(o.top) + 0.18, fmtFtIn(o.right - o.left), { size: 0.075 }));
        out.push(...dim(X(o.right) - 0.14, Y(o.top), X(o.right) - 0.14, Y(o.bottom), fmtFtIn(o.top - o.bottom), { vertical: true, size: 0.075 }));
    }
    // Members: tracks yellow, studs white
    const hi = (m) => info.highlight != null && m.mark === info.highlight;
    for (const m of members) {
        const isTrack = m.orient === 'h';
        out.push(rect(X(m.x), Y(m.y + m.h), m.w * s, m.h * s, hi(m) ? { fill: COLORS.hi, stroke: COLORS.hiStroke, width: 0.012 } : {
            fill: isTrack ? COLORS.track : COLORS.stud, stroke: isTrack ? COLORS.trackStroke : COLORS.studStroke, width: 0.006,
        }));
    }
    // Member labels: studs at mid-height (rotated), tracks near their left end
    for (const m of members) {
        if (m.orient === 'v') {
            const midY = Y(m.y + m.h / 2);
            out.push(rect(X(m.x + m.w / 2) - 0.055, midY - 0.09, 0.11, 0.18, { fill: 'white', stroke: 'none', width: 0 }));
            out.push(text(X(m.x + m.w / 2) + 0.03, midY, m.mark, { size: 0.075, anchor: 'middle', rotate: -90, weight: 'bold', fill: hi(m) ? COLORS.hiStroke : COLORS.text }));
        } else {
            const above = m.role === 'top track' || m.role === 'head track';
            out.push(text(X(m.x) + 0.06, above ? Y(m.y + m.h) - 0.04 : Y(m.y) + 0.1, m.mark, { size: 0.075, weight: 'bold', fill: hi(m) ? COLORS.hiStroke : COLORS.trackStroke }));
        }
    }
    // Panel mark in the middle of the wall
    const pmX = X(L / 2), pmY = Y(HT / 2);
    out.push(rect(pmX - 0.55, pmY - 0.14, 1.1, 0.22, { fill: 'white', stroke: '#000', width: 0.008 }));
    out.push(text(pmX, pmY + 0.03, info.mark, { size: 0.13, anchor: 'middle', weight: 'bold' }));

    // Top track layout strip with ordinate stud dimensions above it
    const stripH = 0.14, topStrip = elevTop - 0.7, botStrip = elevBottom + 0.45;
    out.push(rect(X(0), topStrip, L * s, stripH, { fill: COLORS.track, stroke: COLORS.trackStroke }));
    out.push(text(X(0) - 0.08, topStrip + 0.11, 'TOP', { size: 0.075, anchor: 'end', weight: 'bold' }));
    let lastLabel = -1;
    // Verticals that reach the top track (studs, jambs, cripples above headers); window cripples below a sill don't.
    const topTicks = [...new Set(members.filter(m => m.orient === 'v' && m.y + m.h >= HT - 1.25 - 0.01).map(m => m.x))].sort((a, b) => a - b);
    for (const t of topTicks.length ? topTicks : ticks) {
        out.push(line(X(t), topStrip, X(t), topStrip + stripH, { stroke: COLORS.trackStroke, width: 0.01 }));
        out.push(line(X(t), topStrip - 0.05, X(t), topStrip, { stroke: COLORS.dim, width: 0.005 }));
        if (X(t) - lastLabel >= 0.1) {
            out.push(text(X(t) + 0.03, topStrip - 0.08, fmtFtIn(t), { size: 0.065, rotate: -90, fill: COLORS.dim }));
            lastLabel = X(t);
        }
    }
    // Bottom track layout strip (broken at doors)
    for (const m of members.filter(m => m.role === 'bottom track')) {
        out.push(rect(X(m.x), botStrip, m.w * s, stripH, { fill: COLORS.track, stroke: COLORS.trackStroke }));
    }
    out.push(text(X(0) - 0.08, botStrip + 0.11, 'BTM', { size: 0.075, anchor: 'end', weight: 'bold' }));
    // Only verticals that sit in the bottom track (not the cripples above a door).
    const trackLeg = members.find(m => m.role === 'top track')?.h ?? 1.25;
    const bottomTicks = [...new Set(members.filter(m => m.orient === 'v' && m.y <= trackLeg + 0.01).map(m => m.x))];
    for (const t of bottomTicks) out.push(line(X(t), botStrip, X(t), botStrip + stripH, { stroke: COLORS.trackStroke, width: 0.01 }));

    // Overall dimensions
    out.push(...dim(X(0), botStrip + 0.45, X(L), botStrip + 0.45, fmtFtIn(L), { size: 0.1 }));
    out.push(...dim(X(0) - 0.35, Y(HT), X(0) - 0.35, Y(0), fmtFtIn(HT), { vertical: true, size: 0.1 }));
    // Extension lines
    for (const x of [0, L]) out.push(line(X(x), botStrip + stripH + 0.04, X(x), botStrip + 0.5, { stroke: COLORS.dim, width: 0.005 }));
    for (const y of [0, HT]) out.push(line(X(0) - 0.05, Y(y), X(0) - 0.4, Y(y), { stroke: COLORS.dim, width: 0.005 }));

    // View title under the drawing
    const titleY = Math.min(botStrip + 1.05, 9.2);
    out.push({ t: 'circle', cx: X(0) + 0.14, cy: titleY - 0.04, r: 0.13, stroke: '#000', width: 0.012 });
    out.push(text(X(0) + 0.14, titleY, '1', { size: 0.11, anchor: 'middle', weight: 'bold' }));
    out.push(text(X(0) + 0.36, titleY, `FRAMING ELEVATION - ${info.mark}`, { size: 0.12, weight: 'bold' }));
    out.push(line(X(0) + 0.36, titleY + 0.04, X(0) + 3.2, titleY + 0.04, { width: 0.012 }));
    out.push(text(X(0) + 0.36, titleY + 0.2, `SCALE: ${scaleLabel}`, { size: 0.085 }));

    // --- Title block
    const tbY = 9.55, tbH = 1.2, cells = [[0.25, 1.35], [1.35, 5.2], [5.2, 9.9], [9.9, 12.6], [12.6, 14.15], [14.15, 15.35], [15.35, 16.75]];
    out.push(rect(0.25, tbY, W - 0.5, tbH, { width: 0.02 }));
    for (const [a] of cells.slice(1)) out.push(line(a, tbY, a, tbY + tbH, { width: 0.01 }));
    out.push({ t: 'image', id: 'logo', href: info.logoHref, x: 0.33, y: tbY + 0.1, w: 0.95, h: 0.95 });
    const field = (x, y, label, value, size = 0.1) => out.push(text(x, y, label, { size: 0.065, fill: '#555' }), text(x, y + 0.15, value, { size, weight: 'bold' }));
    field(1.45, tbY + 0.2, 'PROJECT', info.project);
    field(1.45, tbY + 0.6, 'SOURCE', info.sourceNote || 'Model-based framing layout', 0.08);
    field(5.3, tbY + 0.2, 'DRAWING', `FRAMING ELEVATION - ${info.mark}`, 0.12);
    field(5.3, tbY + 0.6, 'LEVEL / WALL TYPE', `${info.level} / ${info.wallType}`, 0.08);
    field(10.0, tbY + 0.2, 'STUDS', `${layout.studType} @ ${layout.spacingIn}" O.C.`);
    field(10.0, tbY + 0.6, 'TRACK', layout.trackType);
    out.push(text(13.375, tbY + 0.3, 'FOR REVIEW', { size: 0.1, anchor: 'middle', weight: 'bold', fill: '#b00020' }));
    out.push(text(13.375, tbY + 0.45, 'NOT FOR CONSTRUCTION', { size: 0.08, anchor: 'middle', weight: 'bold', fill: '#b00020' }));
    out.push(text(12.7, tbY + 0.8, `DATE: ${info.date}`, { size: 0.075 }));
    out.push(text(12.7, tbY + 0.97, `DRAWN: ${info.drawnBy}`, { size: 0.075 }));
    if (info.qrUrl) {
        // QR code to the panel page (drawing, links, comments): black modules on white, in module-sized rectangles.
        const qr = qrEncode(info.qrUrl), qs = 0.92, qx = 14.15 + (1.2 - qs) / 2, qy = tbY + 0.07, m = qs / qr.size;
        for (const r of qrRects(qr)) out.push(rect(qx + r.x * m, qy + r.y * m, r.w * m, r.h * m, { fill: '#000000', stroke: 'none', width: 0 }));
        out.push(text(14.75, tbY + 1.12, 'SCAN: PANEL PAGE', { size: 0.055, anchor: 'middle', weight: 'bold' }));
    }
    out.push(text(15.45, tbY + 0.2, 'SHEET', { size: 0.065, fill: '#555' }));
    out.push(text(16.05, tbY + 0.7, info.mark, { size: 0.2, anchor: 'middle', weight: 'bold' }));
    out.push(text(16.05, tbY + 1.0, `SCALE ${scaleLabel}`, { size: 0.065, anchor: 'middle' }));

    return out;
}
