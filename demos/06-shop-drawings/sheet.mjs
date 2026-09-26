// 11 x 17 landscape framing shop drawing (pure; tested in tests/shop-drawings.test.js). The sheet is built once as a
// list of drawing primitives (sheetOps), then written as SVG (renderSheet) or as a vector PDF (renderSheetPdf, ./pdf.mjs).
// Layout follows the CAS panel shops (e.g. P2001): kept to the minimum. FRAMING CUT LIST (label, qty, function, member
// type, length) and a legend top left; the elevation with every member tagged and Revit-style ordinate dimensions to
// every horizontal member; top and bottom track plans with ordinates to every stud and opening; the title block.
import { fmtFtIn, FUNCTIONS, isDoor } from '../common/framing.mjs';
import { toPdf, textWidth } from './pdf.mjs';
import { qrEncode, qrRects } from '../common/qr.mjs';

const W = 17, H = 11; // sheet, inches
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const n = (v) => Number(v.toFixed(4));
const COLORS = { track: '#f2d64b', trackStroke: '#6b5a00', stud: '#ffffff', studStroke: '#1c1c1c', dim: '#1b6aa5', opening: '#9aa0a6', text: '#111',
    hi: '#ff8a3d', hiStroke: '#b34700', hiRow: '#ffe3cc', // hi*: the highlighted mark (on-screen preview only)
    openingDim: '#a01818' };
// Member fill by function, as in the CAS legend: tracks yellow, headers and sills salmon, studs light grey.
const FUNC_COLOR = { TTOP: '#f2d64b', TBOT: '#f2d64b', HDD: '#f4a7a0', HDW: '#f4a7a0', SBW: '#f4a7a0', EV: '#ededed', SV: '#ededed', SD: '#ededed', CR: '#ededed' };

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

// info: { mark, project, level, wallType, date, drawnBy, logoHref, sourceNote, qrUrl (the panel page: QR code in the
//   title block), highlight (optional member mark, e.g. 'C0': its members and cut list row are colored; leave it out
//   for exports) }. The framing conditions go on the panel page, not the sheet. A flipped layout (flipLayout) is drawn
//   as seen from side B.
export function renderSheet(layout, info) {
    return toSvg(sheetOps(layout, info));
}

// Vector PDF (bytes). logo: { jpeg: Uint8Array, width, height } in pixels, or null.
export function renderSheetPdf(layout, info, logo = null) {
    return toPdf(sheetOps(layout, info), { widthIn: W, heightIn: H, logo, title: `${info.mark} framing shop drawing` });
}

export function sheetOps(layout, info) {
    const { lengthIn: L, heightIn: HT, members, cutList, openings } = layout;
    const areaX = 4.6, areaW = 11.95; // drawing area right of the cut list
    const [s, scaleLabel] = pickScale(L, HT, areaW - 1.65, 5.2); // leaves 0.8" each side for the elevation ordinates
    const out = [];
    const hi = (m) => info.highlight != null && m.mark === info.highlight;

    // Border
    out.push(rect(0.25, 0.25, W - 0.5, H - 0.5, { width: 0.02 }));

    // --- Cut list (top left), the CAS panel shop columns. PREFAB LENGTH is left blank on purpose: the prefab team
    // writes in a cut length when they override one.
    const cx = 0.45, cw = [0.42, 0.32, 0.7, 1.05, 0.75, 0.8], rowH = 0.19, tableW = cw.reduce((a, b) => a + b);
    let cy = 0.45;
    out.push(rect(cx, cy, tableW, rowH, { fill: '#e9e9e9', width: 0.01 }));
    out.push(text(cx + tableW / 2, cy + 0.135, `${info.mark} - FRAMING CUT LIST`, { size: 0.1, weight: 'bold', anchor: 'middle' }));
    cy += rowH;
    const row = (vals, bold, fill = 'none') => {
        let x = cx;
        vals.forEach((v, i) => {
            out.push(rect(x, cy, cw[i], rowH, { fill, width: 0.006 }));
            out.push(text(x + cw[i] / 2, cy + 0.135, v, { size: bold ? 0.07 : 0.08, anchor: 'middle', weight: bold ? 'bold' : 'normal' }));
            x += cw[i];
        });
        cy += rowH;
    };
    row(['LABEL', 'QTY', 'FUNCTION', 'MEMBER TYPE', 'LENGTH', 'PREFAB LENGTH'], true);
    for (const c of cutList) row([c.mark, String(c.qty), c.func || '', c.type, fmtFtIn(c.lengthIn), ''], false, c.mark === info.highlight ? COLORS.hiRow : 'none');
    out.push(text(cx, cy + 0.16, `GRAND TOTAL: ${cutList.reduce((a, c) => a + c.qty, 0)}`, { size: 0.08, weight: 'bold' }));

    // Legend: only the function codes on this panel.
    let ly = cy + 0.45;
    const used = [...new Set(members.map(m => m.func).filter(Boolean))];
    for (const code of Object.keys(FUNCTIONS).filter(k => used.includes(k))) {
        out.push(rect(cx, ly - 0.075, 0.14, 0.09, { fill: FUNC_COLOR[code] || COLORS.stud, stroke: '#555', width: 0.005 }));
        out.push(text(cx + 0.2, ly, `${code}: ${FUNCTIONS[code]}`, { size: 0.07 }));
        ly += 0.14;
    }
    // Only the exceptions from the scan (a gap across the wall, lifts, double rows): the rest is on the panel page.
    for (const note of layout.notes) {
        for (const ln of wrap(note.toUpperCase(), 0.068, tableW)) { ly += 0.12; out.push(text(cx, ly, ln, { size: 0.068, fill: '#b00020' })); }
    }

    // --- Elevation, centered in the drawing area
    const ex = areaX + (areaW - L * s) / 2; // left end of the wall on the sheet
    const elevTop = 2.35, elevBottom = elevTop + HT * s;
    const X = (x) => ex + x * s, Y = (y) => elevBottom - y * s; // wall inches -> sheet inches

    // Openings: outline with an X (sizes come from the ordinates)
    for (const o of openings) {
        out.push(rect(X(o.left), Y(o.top), (o.right - o.left) * s, (o.top - o.bottom) * s, { stroke: COLORS.opening, width: 0.008 }));
        out.push(line(X(o.left), Y(o.top), X(o.right), Y(o.bottom), { stroke: COLORS.opening, width: 0.005, dash: '0.04 0.03' }));
        out.push(line(X(o.left), Y(o.bottom), X(o.right), Y(o.top), { stroke: COLORS.opening, width: 0.005, dash: '0.04 0.03' }));
    }
    // Members, colored by function like the CAS legend
    for (const m of members) {
        out.push(rect(X(m.x), Y(m.y + m.h), m.w * s, m.h * s, hi(m) ? { fill: COLORS.hi, stroke: COLORS.hiStroke, width: 0.012 }
            : { fill: FUNC_COLOR[m.func] || COLORS.stud, stroke: m.orient === 'h' ? COLORS.trackStroke : COLORS.studStroke, width: 0.006 }));
    }
    // Tags on every member. Verticals: at mid-height, level text when the studs are far enough apart, else along the stud.
    const verticals = members.filter(m => m.orient === 'v').sort((a, b) => a.x - b.x);
    const minGap = verticals.slice(1).reduce((g, m, i) => Math.min(g, (m.x - verticals[i].x) * s), Infinity);
    const level = minGap >= 0.22;
    for (const m of verticals) {
        const mx = X(m.x + m.w / 2), my = Y(m.y + m.h / 2), fill = hi(m) ? COLORS.hiStroke : COLORS.text;
        if (level) {
            out.push(rect(mx - 0.1, my - 0.07, 0.2, 0.1, { fill: 'white', stroke: 'none', width: 0 }));
            out.push(text(mx, my, m.mark, { size: 0.075, anchor: 'middle', weight: 'bold', fill }));
        } else {
            out.push(rect(mx - 0.055, my - 0.1, 0.11, 0.2, { fill: 'white', stroke: 'none', width: 0 }));
            out.push(text(mx + 0.03, my, m.mark, { size: 0.075, anchor: 'middle', rotate: -90, weight: 'bold', fill }));
        }
    }
    // Horizontals: centered on the member, above top and head tracks, below bottom and sill tracks.
    for (const m of members.filter(m => m.orient === 'h')) {
        const above = m.role === 'top track' || m.role === 'head track';
        out.push(text(X(m.x + m.w / 2), above ? Y(m.y + m.h) - 0.035 : Y(m.y) + 0.095, m.mark,
            { size: 0.075, anchor: 'middle', weight: 'bold', fill: hi(m) ? COLORS.hiStroke : COLORS.trackStroke }));
    }
    // Panel mark, above mid-height so it does not cover the stud tags there
    const pmX = X(L / 2), pmY = Y(HT * 0.72);
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
        if (m.role === 'top track') addElev(m.y + m.h, 'both');
        else if (m.role === 'bottom track') { addElev(m.y, 'both'); addElev(m.y + m.h, 'both'); }
        else {
            const y = m.role === 'head track' ? m.y : m.y + m.h; // head: underside (rough opening top); sill: top (rough opening bottom)
            const left = m.x + m.w / 2 < L / 2;
            addElev(y, left ? 'left' : 'right', left ? m.x : m.x + m.w);
        }
    }
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
    const studsAt = (atTop) => members.filter(m => m.orient === 'v' && (atTop ? m.y + m.h >= HT - trackLeg - 0.01 : m.y <= trackLeg + 0.01));
    const plan = (y0, atTop) => {
        const segs = atTop ? members.filter(m => m.role === 'top track' && m.y + m.h >= HT - 0.01) : members.filter(m => m.role === 'bottom track' && m.y <= 0.01);
        for (const m of segs) out.push(rect(X(m.x), y0, m.w * s, stripH, { fill: COLORS.track, stroke: COLORS.trackStroke }));
        for (const m of studsAt(atTop)) out.push(rect(X(m.x), y0 + stripH * 0.1, Math.max(m.w * s, 0.01), stripH * 0.8, { fill: 'white', stroke: COLORS.studStroke, width: 0.005 }));
        out.push(text(X(0) - 0.08, y0 + stripH / 2 + 0.03, atTop ? 'TOP' : 'BTM', { size: 0.075, anchor: 'end', weight: 'bold' }));
        // Ordinates: both wall ends, the studs (left face), and on the bottom plan the opening edges. Where two would
        // overlap, the wall end wins, then the opening edge, then the stud.
        const marks = [{ x: 0, rank: 3 }, { x: L, rank: 3 }, ...studsAt(atTop).map(m => ({ x: m.x, rank: 1 }))];
        if (!atTop) {
            for (const o of openings) {
                marks.push({ x: o.left, rank: 2, opening: true }, { x: o.right, rank: 2, opening: true });
                out.push(rect(X(o.left), y0 - 0.02, (o.right - o.left) * s, stripH + 0.04, { stroke: COLORS.opening, width: 0.006 }));
                out.push(text(X((o.left + o.right) / 2), y0 + stripH / 2 + 0.03, isDoor(o) ? 'DOOR' : 'WINDOW', { size: 0.06, anchor: 'middle', fill: COLORS.opening }));
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
                out.push(text(x + 0.03, y0 - 0.08, fmtFtIn(mk.x), { size: 0.065, rotate: -90, fill }));
            } else {
                out.push(line(x, y0 + stripH, x, y0 + stripH + 0.06, { stroke: fill, width: 0.005 }));
                out.push(text(x + 0.03, y0 + stripH + 0.08, fmtFtIn(mk.x), { size: 0.065, rotate: -90, anchor: 'end', fill, weight: mk.opening ? 'bold' : 'normal' }));
            }
        }
    };
    plan(topStrip, true);
    plan(botStrip, false);

    // View title under the drawing
    const titleY = Math.min(botStrip + stripH + 0.85, 9.25);
    out.push({ t: 'circle', cx: X(0) + 0.14, cy: titleY - 0.04, r: 0.13, stroke: '#000', width: 0.012 });
    out.push(text(X(0) + 0.14, titleY, '1', { size: 0.11, anchor: 'middle', weight: 'bold' }));
    out.push(text(X(0) + 0.36, titleY, `FRAMING ELEVATION - ${info.mark}${layout.flipped ? ' (FLIPPED: VIEWED FROM SIDE B)' : ''}`, { size: 0.12, weight: 'bold' }));
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
        // QR code to the panel page (drawing, conditions, links, comments): black modules on white.
        const qr = qrEncode(info.qrUrl), qs = 0.92, qx = 14.15 + (1.2 - qs) / 2, qy = tbY + 0.07, m = qs / qr.size;
        for (const r of qrRects(qr)) out.push(rect(qx + r.x * m, qy + r.y * m, r.w * m, r.h * m, { fill: '#000000', stroke: 'none', width: 0 }));
        out.push(text(14.75, tbY + 1.12, 'SCAN: PANEL PAGE', { size: 0.055, anchor: 'middle', weight: 'bold' }));
    }
    out.push(text(15.45, tbY + 0.2, 'SHEET', { size: 0.065, fill: '#555' }));
    out.push(text(16.05, tbY + 0.7, info.mark, { size: 0.2, anchor: 'middle', weight: 'bold' }));
    out.push(text(16.05, tbY + 1.0, `SCALE ${scaleLabel}`, { size: 0.065, anchor: 'middle' }));

    return out;
}
