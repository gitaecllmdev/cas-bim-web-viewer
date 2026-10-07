// The punch report's pages (pure; tested in tests/punch.test.js), drawn with the shop drawing primitives and written
// by demos/06-shop-drawings/pdf.mjs toPdfPages: letter portrait, inches, y down. Page 1: the summary (counts, open by
// kind, by who fixes it, by floor). Then each floor's plan with its items' stamps where they are. Then the items, three
// to a page: stamp, number, status, note, where, who, when, a close-up of the plan around it, and its photos.
// images: { plans: [{ level, href, px: [w, h], pins: [{ u, v, item }] }] (u, v: 0-1 across the image),
//   snippets: Map(item id -> { href, px, pu, pv }) (pu, pv: where the item is in it), photos: Map(photo id -> { href, px }) } (JPEG data URLs).
import { textWidth } from '../06-shop-drawings/pdf.mjs';
import { stampOf, statusOf, periodText, reportTitle } from './punch.mjs';

const W = 8.5, H = 11, M = 0.5, INK = '#1d2733', MUTED = '#5f6b78', LINE = '#d5dbe2';

// Wrap text to a width (inches) at a size (inches), at most `lines` lines (the last cut with …).
export function wrap(text, widthIn, sizeIn, { bold = false, lines = 99 } = {}) {
    const pt = sizeIn * 72, max = widthIn * 72, out = [];
    for (const para of String(text || '').split(/\n/)) {
        let line = '';
        for (const word of para.split(/\s+/).filter(Boolean)) {
            const next = line ? `${line} ${word}` : word;
            if (textWidth(next, pt, bold) <= max || !line) line = next; else { out.push(line); line = word; }
        }
        out.push(line);
    }
    if (out.length > lines) { out.length = lines; out[lines - 1] = `${out[lines - 1].replace(/\s*\S*$/, '')}...`; } // the PDF's fonts are Latin-1: no "…"
    return out;
}

const text = (s, x, y, size, o = {}) => ({ t: 'text', s: String(s ?? ''), x, y, size, fill: INK, ...o });
const rect = (x, y, w, h, o = {}) => ({ t: 'rect', x, y, w, h, fill: 'none', stroke: LINE, width: 0.01, ...o });
// A filled circle (the writer's circles are outlines): a 28-sided polygon.
const disc = (cx, cy, r, fill) => ({ t: 'poly', pts: Array.from({ length: 28 }, (_, k) => [cx + r * Math.cos((k / 28) * 2 * Math.PI), cy + r * Math.sin((k / 28) * 2 * Math.PI)]), fill, stroke: 'none', width: 0 });
// A stamp as on the plan: the status color around the stamp's color, its code in white.
export function stampOps(item, cx, cy, r) {
    const s = stampOf(item.stamp), st = statusOf(item.status);
    return [disc(cx, cy, r, '#ffffff'), disc(cx, cy, r * 0.88, st.color), disc(cx, cy, r * 0.68, item.status === 'closed' ? '#9aa0a6' : s.color),
        text(s.code, cx, cy + r * 0.24, r * (s.code.length > 1 ? 0.62 : 0.8), { anchor: 'middle', weight: 'bold', fill: '#ffffff' })];
}
const pill = (label, color, x, y) => { const w = textWidth(label, 9, true) / 72 + 0.2; return [rect(x, y - 0.15, w, 0.21, { fill: color, stroke: 'none', width: 0 }), text(label, x + 0.1, y, 0.125, { weight: 'bold', fill: '#ffffff' })]; };
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

function header(r, { project, by, generatedAt }) {
    return [
        rect(0, 0, W, 1.05, { fill: '#1f3b57', stroke: 'none', width: 0 }),
        text(reportTitle(r.period), M, 0.48, 0.3, { weight: 'bold', fill: '#ffffff' }),
        text(`${project}${r.level ? ` · ${r.level}` : ''} · ${periodText(r.period)}`, M, 0.8, 0.16, { fill: '#dbe5ef' }),
        text(`Prepared by ${by || '—'} · ${when(generatedAt)}`, W - M, 0.8, 0.13, { fill: '#dbe5ef', anchor: 'end' }),
    ];
}

function summaryPage(r, meta) {
    const ops = header(r, meta);
    // The four counts.
    const boxes = [['New', r.added.length, '#1f3b57'], ['Closed', r.closed.length, statusOf('closed').color], ['Open now', r.open.length, statusOf('open').color], ['In review', r.review.length, statusOf('review').color]];
    const bw = (W - 2 * M - 0.3) / 4;
    boxes.forEach(([label, n, color], i) => {
        const x = M + i * (bw + 0.1), y = 1.35;
        ops.push(rect(x, y, bw, 1.0, { fill: '#f6f8fa' }), rect(x, y, 0.08, 1.0, { fill: color, stroke: 'none', width: 0 }),
            text(String(n), x + 0.25, y + 0.6, 0.42, { weight: 'bold', fill: color }), text(label, x + 0.25, y + 0.85, 0.15, { fill: MUTED }));
    });
    if (r.overdue.length) ops.push(text(`${r.overdue.length} item${r.overdue.length === 1 ? ' is' : 's are'} past due.`, M, 2.62, 0.15, { weight: 'bold', fill: statusOf('open').color }));
    // Open by kind.
    let y = 2.95;
    ops.push(text('Open and in review, by kind', M, y, 0.18, { weight: 'bold' }));
    y += 0.3;
    ops.push(text('Kind', M + 0.45, y, 0.12, { fill: MUTED }), text('Open', 5.0, y, 0.12, { fill: MUTED, anchor: 'end' }), text('New', 6.2, y, 0.12, { fill: MUTED, anchor: 'end' }), text('Closed', 7.5, y, 0.12, { fill: MUTED, anchor: 'end' }));
    for (const s of r.byStamp) {
        y += 0.36;
        ops.push(...stampOps({ stamp: s.code, status: 'open' }, M + 0.17, y - 0.06, 0.15), text(s.name, M + 0.45, y, 0.15),
            text(String(s.open), 5.0, y, 0.15, { anchor: 'end', weight: 'bold' }), text(String(s.added), 6.2, y, 0.15, { anchor: 'end' }), text(String(s.closed), 7.5, y, 0.15, { anchor: 'end' }),
            { t: 'line', x1: M, y1: y + 0.12, x2: W - M, y2: y + 0.12, stroke: LINE, width: 0.008 });
    }
    if (!r.byStamp.length) { y += 0.36; ops.push(text('Nothing open.', M, y, 0.15, { fill: MUTED })); }
    // By who fixes it, by floor.
    y += 0.6;
    const col = (title, rows, x) => {
        let yy = y;
        ops.push(text(title, x, yy, 0.18, { weight: 'bold' }));
        for (const [k, v] of rows.slice(0, 12)) { yy += 0.3; ops.push(text(k, x, yy, 0.15), text(String(v), x + 3.4, yy, 0.15, { anchor: 'end', weight: 'bold' })); }
        if (!rows.length) ops.push(text('—', x, yy + 0.3, 0.15, { fill: MUTED }));
    };
    col('Open, by who fixes it', r.byAssignee, M);
    col('Open, by floor', r.byLevel, M + 3.85);
    return ops;
}

function planPage(r, meta, plan) {
    const ops = header(r, meta);
    ops.push(text(`${plan.level}: where the items are`, M, 1.45, 0.2, { weight: 'bold' }));
    const box = { x: M, y: 1.7, w: W - 2 * M, h: H - 1.7 - 0.9 };
    const k = Math.min(box.w / plan.px[0], box.h / plan.px[1]), iw = plan.px[0] * k, ih = plan.px[1] * k, ix = box.x + (box.w - iw) / 2, iy = box.y;
    ops.push({ t: 'image', href: plan.href, px: plan.px, x: ix, y: iy, w: iw, h: ih }, rect(ix, iy, iw, ih));
    for (const pin of plan.pins) {
        const cx = ix + pin.u * iw, cy = iy + pin.v * ih;
        ops.push(...stampOps(pin.item, cx, cy, 0.13), text(`#${pin.item.number}`, cx + 0.15, cy - 0.12, 0.1, { weight: 'bold' }));
    }
    return ops;
}

function itemBlock(item, y, { snippets, photos, includePhotos }) {
    const ops = [], s = stampOf(item.stamp), st = statusOf(item.status), h = 3.05;
    ops.push(rect(M, y, W - 2 * M, h - 0.1, { stroke: LINE, width: 0.012 }));
    ops.push(...stampOps(item, M + 0.42, y + 0.45, 0.3), text(`#${item.number}`, M + 0.42, y + 0.98, 0.16, { anchor: 'middle', weight: 'bold' }));
    const x = M + 0.9, textW = 4.0;
    ops.push(text(s.name, x, y + 0.36, 0.2, { weight: 'bold' }), ...pill(st.name, st.color, x + textWidth(s.name, 14.4, true) / 72 + 0.15, y + 0.35));
    let yy = y + 0.66;
    for (const line of wrap(item.note || 'No note.', textW, 0.15, { lines: 3 })) { ops.push(text(line, x, yy, 0.15, { fill: item.note ? INK : MUTED })); yy += 0.22; }
    const meta = [
        [item.level, item.wallType].filter(Boolean).join(' · '),
        item.assignee ? `Fix: ${item.assignee}${item.due ? ` · due ${item.due}` : ''}` : item.due ? `Due ${item.due}` : '',
        `Added ${when(item.createdAt)}${item.createdBy ? ` by ${item.createdBy}` : ''}`,
        item.status === 'closed' && item.closedAt ? `Closed ${when(item.closedAt)}` : item.status === 'review' && item.reviewAt ? `In review since ${when(item.reviewAt)}` : '',
    ].filter(Boolean);
    for (const m of meta) { for (const line of wrap(m, textW, 0.125, { lines: 1 })) { ops.push(text(line, x, yy, 0.125, { fill: MUTED })); yy += 0.19; } }
    // The plan around it, its stamp in the middle.
    const snip = snippets?.get(item.id), sx = W - M - 2.35, sy = y + 0.15, ss = 1.55;
    if (snip) {
        ops.push({ t: 'image', href: snip.href, px: snip.px, x: sx, y: sy, w: 2.2, h: ss }, rect(sx, sy, 2.2, ss), ...stampOps(item, sx + (snip.pu ?? 0.5) * 2.2, sy + (snip.pv ?? 0.5) * ss, 0.11));
        ops.push(text('Plan', sx, sy + ss + 0.15, 0.1, { fill: MUTED }));
    }
    // Its photos, side by side under it.
    const ph = includePhotos ? (item.photos || []).map(id => photos?.get(id)).filter(Boolean).slice(0, 4) : [];
    ph.forEach((p, i) => {
        const pw = 1.65, px = M + 0.15 + i * (pw + 0.12), py = y + 1.85;
        ops.push({ t: 'image', href: p.href, px: p.px, x: px, y: py, w: pw, h: 1.05 });
    });
    if (includePhotos && (item.photos || []).length > ph.length) ops.push(text(`+${item.photos.length - ph.length} more photos`, W - M - 0.1, y + 1.78, 0.1, { fill: MUTED, anchor: 'end' }));
    return ops;
}

// Every page, the footer on each.
export function reportPages(r, { project = '', by = '', generatedAt = new Date().toISOString(), plans = [], snippets = new Map(), photos = new Map(), includePhotos = true } = {}) {
    const meta = { project, by, generatedAt };
    const pages = [summaryPage(r, meta), ...plans.map(p => planPage(r, meta, p))];
    for (let i = 0; i < r.listed.length; i += 3) {
        const ops = header(r, meta);
        r.listed.slice(i, i + 3).forEach((item, k) => ops.push(...itemBlock(item, 1.2 + k * 3.05, { snippets, photos, includePhotos })));
        pages.push(ops);
    }
    pages.forEach((ops, k) => ops.push({ t: 'line', x1: M, y1: H - 0.5, x2: W - M, y2: H - 0.5, stroke: LINE, width: 0.01 },
        text(`${project} · ${reportTitle(r.period)} · ${periodText(r.period)}`, M, H - 0.3, 0.11, { fill: MUTED }),
        text(`Page ${k + 1} of ${pages.length}`, W - M, H - 0.3, 0.11, { fill: MUTED, anchor: 'end' })));
    return pages;
}
