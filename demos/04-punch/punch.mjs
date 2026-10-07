// Field QC punch items (pure; tested in tests/punch.test.js): stamps, statuses, numbering, the daily / weekly report's
// figures and its e-mail text. An item: { id, number, stamp, note, status, assignee, due, photos: [photo id], level,
// wallType, dbId, externalId, point (3D), view, sheetPoints: { sheet guid: point }, createdAt, createdBy, closedAt,
// reviewAt, history: [{ at, by, what }] }. Saved as state 'punch' (per model, helpers stateFor); photos separately
// ('punch-photo-<id>', a JPEG data URL each).

// Stamps (as on a PlanGrid sheet): a short code in a colored circle, one per kind of punch item.
export const STAMPS = [
    { code: 'D', name: 'Damage', color: '#d7263d' },
    { code: 'MB', name: 'Missing board', color: '#f28e2b' },
    { code: 'FC', name: 'Fire caulk', color: '#8e1b8e' },
    { code: 'PT', name: 'Patch & tape', color: '#2a7fba' },
    { code: 'SC', name: 'Screws / pops', color: '#5b6b7c' },
    { code: 'CR', name: 'Crack', color: '#b5651d' },
    { code: '?', name: 'Question', color: '#1f9e89' },
    { code: 'O', name: 'Other', color: '#6c5ce7' },
];
export const stampOf = (code) => STAMPS.find(s => s.code === code) || STAMPS.at(-1);

// Statuses (as PlanGrid's issues): open red, in review orange, closed green.
export const STATUSES = [
    { key: 'open', name: 'Open', color: '#d93025' },
    { key: 'review', name: 'In review', color: '#f29900' },
    { key: 'closed', name: 'Closed', color: '#188038' },
];
export const statusOf = (key) => STATUSES.find(s => s.key === key) || STATUSES[0];

// Who fixes it (the default list; anyone can be typed in).
export const ASSIGNEES = ['Drywall crew', 'Taper / finisher', 'Framer', 'Firestopping', 'Painter', 'General contractor'];

// Items saved by the first version of this demo (type, open/closed, ids P-001) in this one's shape.
const OLD_TYPES = { Damage: 'D', 'Missing board': 'MB', 'Fire caulk': 'FC', Other: 'O' };
export function upgradeItem(item) {
    const out = { photos: [], history: [], sheetPoints: {}, assignee: '', due: '', createdBy: '', ...item };
    if (!out.stamp) out.stamp = OLD_TYPES[item.type] || 'O';
    if (!STATUSES.some(s => s.key === out.status)) out.status = 'open';
    if (!Number.isFinite(out.number)) out.number = Number(String(item.id || '').replace(/\D/g, '')) || 0;
    delete out.type;
    return out;
}

export const nextNumber = (items) => Math.max(0, ...items.map(i => i.number || 0)) + 1;
export const itemLabel = (item) => `#${item.number} ${stampOf(item.stamp).name}`;

// A status change, with who and when, in the item's history.
export function setStatus(item, status, { by = '', at = new Date().toISOString() } = {}) {
    if (item.status === status) return false;
    item.history = [...(item.history || []), { at, by, what: `${statusOf(item.status).name} → ${statusOf(status).name}` }];
    item.status = status;
    if (status === 'closed') item.closedAt = at; else delete item.closedAt;
    if (status === 'review') item.reviewAt = at;
    return true;
}

// --- Reports -----------------------------------------------------------------------------------------------------
const day = (iso) => String(iso || '').slice(0, 10);
const addDays = (s, n) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n)).toISOString().slice(0, 10);

// The report's period: 'day' (today), 'week' (Monday to today), or from / to given. Days as YYYY-MM-DD.
export function periodOf(kind, today, { from = '', to = '' } = {}) {
    if (kind === 'week') {
        const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
        return { kind, from: addDays(today, -dow), to: today };
    }
    if (kind === 'range' && from && to) return { kind, from: from <= to ? from : to, to: from <= to ? to : from };
    return { kind: 'day', from: today, to: today };
}

// The figures: what was added and closed in the period, what is open / in review now, and the open items by stamp,
// by who fixes them and by floor. items: as saved (dates as ISO); filter: { level } keeps one floor.
export function reportData(items, period, { level = '', today = period.to } = {}) {
    const all = items.filter(i => !level || i.level === level);
    const inPeriod = (iso) => { const d = day(iso); return d >= period.from && d <= period.to; };
    const added = all.filter(i => inPeriod(i.createdAt));
    const closed = all.filter(i => i.status === 'closed' && inPeriod(i.closedAt));
    const open = all.filter(i => i.status === 'open'), review = all.filter(i => i.status === 'review');
    const overdue = all.filter(i => i.status !== 'closed' && i.due && i.due < today);
    const group = (list, key) => { const m = new Map(); for (const i of list) { const k = key(i) || 'Not set'; m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
    const active = [...open, ...review];
    // The items the report lists: everything added or closed in the period, and everything still open or in review.
    const listed = [...new Set([...added, ...closed, ...active])].sort((a, b) => a.number - b.number);
    return {
        period, level, added, closed, open, review, overdue, listed,
        byStamp: STAMPS.map(s => ({ ...s, open: active.filter(i => i.stamp === s.code).length, added: added.filter(i => i.stamp === s.code).length, closed: closed.filter(i => i.stamp === s.code).length }))
            .filter(s => s.open || s.added || s.closed),
        byAssignee: group(active, i => i.assignee), byLevel: group(active, i => i.level),
    };
}

const fmt = (d) => { const [y, m, dd] = d.split('-'); return `${+dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]} ${y}`; };
export const periodText = (p) => (p.from === p.to ? fmt(p.from) : `${fmt(p.from)} to ${fmt(p.to)}`);
export const reportTitle = (p) => `${p.kind === 'week' ? 'Weekly' : p.kind === 'day' ? 'Daily' : 'Field QC'} punch report`;

// The e-mail / message text that goes with the PDF: a short summary anyone can read on a phone.
export function summaryText(r, { project = '', by = '' } = {}) {
    const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
    const lines = [
        `${reportTitle(r.period)}, ${project}${r.level ? `, ${r.level}` : ''}`,
        periodText(r.period),
        '',
        `New: ${n(r.added.length, 'item')}`,
        `Closed: ${n(r.closed.length, 'item')}`,
        `Still open: ${n(r.open.length, 'item')}${r.review.length ? `, ${r.review.length} in review` : ''}${r.overdue.length ? ` (${r.overdue.length} past due)` : ''}`,
    ];
    if (r.byStamp.length) lines.push('', 'Open by kind:', ...r.byStamp.filter(s => s.open).map(s => `  ${s.name}: ${s.open}`));
    if (r.byAssignee.length) lines.push('', 'Open by who fixes it:', ...r.byAssignee.map(([k, v]) => `  ${k}: ${v}`));
    lines.push('', 'The full report with photos and plan locations is attached.');
    if (by) lines.push('', `${by}`);
    return lines.join('\n');
}

// --- The stamp drawn on the plan and in 3D -------------------------------------------------------------------------
// An SVG: the stamp's code in a circle of its color, ringed in the status color (closed: grey with a green ring).
export function stampSvg(code, color, status, size = 64) {
    const st = statusOf(status), fill = status === 'closed' ? '#9aa0a6' : color, r = size / 2;
    const font = code.length > 1 ? size * 0.36 : size * 0.46;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
        + `<circle cx="${r}" cy="${r}" r="${r - 2}" fill="#ffffff"/><circle cx="${r}" cy="${r}" r="${r - 5}" fill="${st.color}"/>`
        + `<circle cx="${r}" cy="${r}" r="${r - 11}" fill="${fill}"/>`
        + `<text x="${r}" y="${r}" dy="0.36em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${font.toFixed(1)}" fill="#ffffff">${code.replace(/[<&>]/g, '')}</text></svg>`;
}

// A photo's size scaled to fit max (longest side), never enlarged.
export const fitSize = (w, h, max) => { const k = Math.min(1, max / Math.max(w, h)); return [Math.round(w * k), Math.round(h * k)]; };
