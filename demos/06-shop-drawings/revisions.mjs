// A panel's revisions: its framing as issued (every member's key, mark, role, type, place, size and cut length; every
// opening's rough opening; the panel's size), numbered and dated with what changed, kept with the panel
// (panel.revisions). What changed since a revision, member by member (by the plan's stable keys), in words and as
// boxes to cloud on the drawing. Side A, wall inches. Pure.
const q = (v) => Math.round(Number(v) * 16) / 16;
const typeOf = (m) => (m.parts?.length ? m.parts.map(p => `${p.qty > 1 ? `(${p.qty}) ` : ''}${p.name}`).join(' WITH ') : m.type);
export const MAX_REVISIONS = 50;

// The framing as it is now (a side-A layout: generator.panelLayout with side B off, or the plan's layout).
export function snapshotOf(layout) {
    return { lengthIn: q(layout.lengthIn), heightIn: q(layout.heightIn),
        members: layout.members.filter(m => m.key).map(m => ({ key: m.key, mark: m.mark || '', role: m.role, type: typeOf(m), x: q(m.x), y: q(m.y), w: q(m.w), h: q(m.h), lengthIn: q(m.lengthIn) })),
        openings: (layout.openings || []).filter(o => o.key).map(o => ({ key: o.key, left: q(o.left), right: q(o.right), bottom: q(o.bottom), top: q(o.top) })) };
}
// The panel with one more revision: n (one past the last), its date and what it is for.
export function issueRevision(panel, layout, { note = '', date = '' } = {}) {
    const list = Array.isArray(panel.revisions) ? panel.revisions : [], n = (list[list.length - 1]?.n || 0) + 1;
    return { ...panel, revisions: [...list, { n, date: String(date).slice(0, 10), note: String(note).trim().slice(0, 200), snap: snapshotOf(layout) }].slice(-MAX_REVISIONS) };
}
// Kept as they came when they look like revisions (cleanPanel): numbered, with a snapshot of members.
export function cleanRevisions(raw) {
    if (!Array.isArray(raw)) return null;
    const ok = raw.filter(r => r && Number.isInteger(r.n) && r.n > 0 && r.snap && Array.isArray(r.snap.members)).slice(-MAX_REVISIONS)
        .map(r => ({ n: r.n, date: String(r.date || '').slice(0, 10), note: String(r.note || '').slice(0, 200), snap: structuredClone(r.snap) }));
    return ok.length ? ok : null;
}

const box = (m) => ({ x: m.x, y: m.y, w: m.w, h: m.h });
const obox = (o) => ({ x: o.left, y: o.bottom, w: o.right - o.left, h: o.top - o.bottom });
// What changed from a to b (two snapshots): [{ what: 'panel' | 'member' | 'opening', kind: 'added' | 'removed' | 'moved'
// | 'resized' | 'retyped' | 'recut', key, mark, role, from, to, box }] (box: where to cloud it, in b's place; a removed
// one's in a's).
export function diffSnapshots(a, b) {
    const out = [];
    if (a.lengthIn !== b.lengthIn || a.heightIn !== b.heightIn) out.push({ what: 'panel', kind: 'resized', from: `${a.lengthIn} x ${a.heightIn}`, to: `${b.lengthIn} x ${b.heightIn}`, box: { x: 0, y: 0, w: b.lengthIn, h: b.heightIn } });
    const am = new Map(a.members.map(m => [m.key, m])), bm = new Map(b.members.map(m => [m.key, m]));
    for (const m of b.members) {
        const was = am.get(m.key);
        if (!was) { out.push({ what: 'member', kind: 'added', key: m.key, mark: m.mark, role: m.role, to: m, box: box(m) }); continue; }
        const base = { what: 'member', key: m.key, mark: m.mark, role: m.role, from: was, to: m, box: box(m) };
        if (was.type !== m.type) out.push({ ...base, kind: 'retyped' });
        if (was.x !== m.x || was.y !== m.y) out.push({ ...base, kind: 'moved' });
        if (was.w !== m.w || was.h !== m.h) out.push({ ...base, kind: 'resized' });
        else if (was.lengthIn !== m.lengthIn) out.push({ ...base, kind: 'recut' });
    }
    for (const m of a.members) if (!bm.has(m.key)) out.push({ what: 'member', kind: 'removed', key: m.key, mark: m.mark, role: m.role, from: m, box: box(m) });
    const ao = new Map((a.openings || []).map(o => [o.key, o])), bo = new Map((b.openings || []).map(o => [o.key, o]));
    for (const o of b.openings || []) {
        const was = ao.get(o.key);
        if (!was) out.push({ what: 'opening', kind: 'added', key: o.key, to: o, box: obox(o) });
        else if (was.left !== o.left || was.bottom !== o.bottom) out.push({ what: 'opening', kind: 'moved', key: o.key, from: was, to: o, box: obox(o) });
        else if (was.right !== o.right || was.top !== o.top) out.push({ what: 'opening', kind: 'resized', key: o.key, from: was, to: o, box: obox(o) });
    }
    for (const o of a.openings || []) if (!bo.has(o.key)) out.push({ what: 'opening', kind: 'removed', key: o.key, from: o, box: obox(o) });
    return out;
}
// A change in words (fmt: the length formatter; name: an opening's name by its key).
export function describe(c, fmt, name = (k) => k) {
    const who = c.what === 'member' ? `${c.mark || '?'} (${c.role})` : c.what === 'opening' ? name(c.key) : 'The panel';
    const d = (a, b) => [b.x - a.x, b.y - a.y];
    switch (c.kind) {
        case 'added': return `${who} added`;
        case 'removed': return `${who} removed`;
        case 'retyped': return `${who}: ${c.from.type} to ${c.to.type}`;
        case 'recut': return `${who}: cut ${fmt(c.from.lengthIn)} to ${fmt(c.to.lengthIn)}`;
        case 'moved': {
            if (c.what === 'opening') return `${who} moved ${fmt(Math.abs(c.to.left - c.from.left))} ${c.to.left >= c.from.left ? 'right' : 'left'}${c.to.bottom !== c.from.bottom ? `, ${fmt(Math.abs(c.to.bottom - c.from.bottom))} ${c.to.bottom > c.from.bottom ? 'up' : 'down'}` : ''}`;
            const [dx, dy] = d(c.from, c.to);
            return `${who} moved ${[dx ? `${fmt(Math.abs(dx))} ${dx > 0 ? 'right' : 'left'}` : '', dy ? `${fmt(Math.abs(dy))} ${dy > 0 ? 'up' : 'down'}` : ''].filter(Boolean).join(', ')}`;
        }
        case 'resized': return c.what === 'panel' ? `The panel resized (${c.from} to ${c.to} in)` : c.what === 'opening' ? `${who} resized to ${fmt(c.to.right - c.to.left)} x ${fmt(c.to.top - c.to.bottom)}` : `${who}: ${fmt(c.from.h > c.from.w ? c.from.h : c.from.w)} to ${fmt(c.to.h > c.to.w ? c.to.h : c.to.w)} long`;
        default: return `${who} changed`;
    }
}
// Boxes to cloud (wall inches, side A): each change's, padded, overlapping ones merged; the panel's own resize not
// clouded member by member.
export function cloudBoxes(changes, pad = 2) {
    let boxes = changes.filter(c => c.what !== 'panel' && c.box).map(c => ({ x: c.box.x - pad, y: c.box.y - pad, w: c.box.w + 2 * pad, h: c.box.h + 2 * pad }));
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (let merged = true; merged;) {
        merged = false;
        for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length && !merged; j++) {
            if (!hit(boxes[i], boxes[j])) continue;
            const a = boxes[i], b = boxes[j], x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
            boxes[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
            boxes.splice(j, 1); merged = true;
        }
    }
    return boxes;
}
// What the sheet clouds: with changes since the last revision, those (marked as not issued yet); else the last
// revision's own changes (against the one before it). -> { rev, pending, changes } or null.
export function sheetChanges(panel, layout) {
    const list = Array.isArray(panel.revisions) ? panel.revisions : [];
    if (!list.length) return null;
    const last = list[list.length - 1], now = snapshotOf(layout), pending = diffSnapshots(last.snap, now);
    if (pending.length) return { rev: last.n, pending: true, changes: pending };
    return list.length > 1 ? { rev: last.n, pending: false, changes: diffSnapshots(list[list.length - 2].snap, last.snap) } : { rev: last.n, pending: false, changes: [] };
}
