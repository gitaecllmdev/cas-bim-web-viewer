// Manual edit mode: members unlocked and placed by hand (generator.mjs applyManual applies them; the plan, the cut list,
// the sheet and the check follow). Pure: each takes the panel and its side-A layout (panelLayout with sideB off: members
// with keys) and returns a new panel. Wall inches, side A; 1/16" steps.
//   unlock / lock: a member becomes the user's (frozen where it is) / follows the framing rules again
//   unlockAll / lockAll: every member / none
//   move, place: by an offset / to a place and size; copy, mirror: a new member like it (mirror: across the panel's
//   middle, facing the other way); remove: gone from the panel (kept as an edit: Lock brings it back).
import { round16 } from '../common/framing.mjs';

const r16 = (v) => round16(Number(v));
const manualOf = (panel) => ({ members: { ...(panel.manual?.members || {}) }, added: [...(panel.manual?.added || [])] });
const withManual = (panel, m) => {
    const out = { ...panel }, has = Object.keys(m.members).length || m.added.length;
    if (has) out.manual = { members: m.members, ...(m.added.length ? { added: m.added } : {}) }; else delete out.manual;
    return out;
};
const boxOf = (m) => ({ x: r16(m.x), y: r16(m.y), w: r16(m.w), h: r16(m.h) });
const find = (layout, key) => layout.members.find(m => m.key === key) || null;
export const isAdded = (key) => String(key).startsWith('manual:');
// Whether a member is the user's (unlocked).
export const isUnlocked = (panel, key) => (isAdded(key) ? (panel.manual?.added || []).some(a => `manual:${a.id}` === key) : !!panel.manual?.members?.[key]);
export const unlockedCount = (panel) => Object.values(panel.manual?.members || {}).filter(e => !e.deleted).length + (panel.manual?.added || []).length;

export function unlock(panel, layout, key) {
    const m = find(layout, key);
    if (!m || isUnlocked(panel, key)) return panel;
    const man = manualOf(panel);
    man.members[key] = boxOf(m);
    return withManual(panel, man);
}
export function lock(panel, key) {
    const man = manualOf(panel);
    if (isAdded(key)) man.added = man.added.filter(a => `manual:${a.id}` !== key);
    else delete man.members[key];
    return withManual(panel, man);
}
export function unlockAll(panel, layout) {
    const man = manualOf(panel);
    for (const m of layout.members) if (!isAdded(m.key) && !man.members[m.key]) man.members[m.key] = boxOf(m);
    return withManual(panel, man);
}
export function lockAll(panel) { const out = { ...panel }; delete out.manual; return out; }
// A new place and size for an unlocked member (unlocked first if it is not).
export function place(panel, layout, key, box) {
    const m = find(layout, key);
    if (!m) return panel;
    const b = { ...boxOf(m), ...Object.fromEntries(Object.entries(box).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, r16(v)])) };
    if (!(b.w > 0 && b.h > 0)) return panel;
    const man = manualOf(panel);
    if (isAdded(key)) man.added = man.added.map(a => (`manual:${a.id}` === key ? { ...a, ...b } : a));
    else man.members[key] = b;
    return withManual(panel, man);
}
export function move(panel, layout, key, dx = 0, dy = 0) {
    const m = find(layout, key);
    return m ? place(panel, layout, key, { x: m.x + dx, y: m.y + dy }) : panel;
}
const nextId = (man) => { let n = man.added.length + 1; while (man.added.some(a => a.id === `m${n}`)) n++; return `m${n}`; };
// The member a copy is made like: an added member's own original, else the member itself.
const sourceOf = (panel, key) => (isAdded(key) ? (panel.manual?.added || []).find(a => `manual:${a.id}` === key)?.from : key);
export function copy(panel, layout, key, dx = 0, dy = 0) {
    const m = find(layout, key), from = sourceOf(panel, key);
    if (!m || !from) return { panel, key: null };
    const man = manualOf(panel), id = nextId(man), src = isAdded(key) ? man.added.find(a => `manual:${a.id}` === key) : null;
    man.added.push({ id, from, ...boxOf({ ...m, x: m.x + dx, y: m.y + dy }), ...(src?.mirrored ? { mirrored: true } : {}) });
    return { panel: withManual(panel, man), key: `manual:${id}` };
}
// Across the panel's middle (left to right), facing the other way.
export function mirror(panel, layout, key) {
    const m = find(layout, key), from = sourceOf(panel, key);
    if (!m || !from) return { panel, key: null };
    const man = manualOf(panel), id = nextId(man), src = isAdded(key) ? man.added.find(a => `manual:${a.id}` === key) : null;
    man.added.push({ id, from, ...boxOf({ ...m, x: layout.lengthIn - m.x - m.w }), ...(src?.mirrored ? {} : { mirrored: true }) });
    return { panel: withManual(panel, man), key: `manual:${id}` };
}
export function remove(panel, key) {
    const man = manualOf(panel);
    if (isAdded(key)) man.added = man.added.filter(a => `manual:${a.id}` !== key);
    else man.members[key] = { deleted: true };
    return withManual(panel, man);
}
// Another member type for these members (unlocked where they are: nothing moves). -> { panel, changed: [{ key, from, to }] }
export function setType(panel, layout, keys, type) {
    const man = manualOf(panel), changed = [];
    for (const key of keys) {
        const m = find(layout, key);
        if (!m || m.parts?.length || m.type === type) continue;
        if (isAdded(key)) man.added = man.added.map(a => (`manual:${a.id}` === key ? { ...a, type } : a));
        else man.members[key] = { ...(man.members[key] && !man.members[key].deleted ? man.members[key] : boxOf(m)), type };
        changed.push({ key, from: m.type, to: type });
    }
    return { panel: withManual(panel, man), changed };
}
// A stud in a bay wider than the spacing (layout.wide_bay): like the stud at its left (else its right), one spacing from
// it (or in the middle when the bay is under two spacings). -> { panel, key, x }
export function fillBay(panel, layout, leftKey, rightKey, spacingIn) {
    const a = find(layout, leftKey), b = find(layout, rightKey), src = [a, b].find(m => m && (m.role === 'stud' || m.role === 'end stud' || m.role === 'jamb stud'));
    if (!a || !b || !src) return { panel, key: null, x: null };
    const ac = a.x + a.w / 2, bc = b.x + b.w / 2, c = bc - ac < 2 * spacingIn ? (ac + bc) / 2 : ac + spacingIn;
    const r = copy(panel, layout, src.key, r16(c - src.w / 2) - src.x, 0);
    return { ...r, x: r16(c - src.w / 2) };
}
// Members removed by hand (to bring back: lock).
export const removedKeys = (panel) => Object.entries(panel.manual?.members || {}).filter(([, e]) => e.deleted).map(([k]) => k);
