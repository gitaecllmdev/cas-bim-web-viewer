// Typical panels: panels whose framing is the same, member for member (role, type or parts, place and size to 1/16", cut
// length, which way each stud's web faces), with the same openings and clips: one sheet can frame all of them. A
// panel that is the mirror image of another (left for right, every stud facing the other way) is the same typical
// built opposite hand. Side A layouts (generator.panelLayout with side B off: the viewing side changes no member).
// Pure; names, levels and wall types do not count, only the framing.
import { webOnRight } from '../common/framing.mjs';

const q = (v) => Math.round(Number(v) * 16) / 16;
const typeOf = (m) => (m.parts?.length ? m.parts.map(p => `${p.qty || 1}x${p.name}`).join('+') : m.type);
// The framing as text: sorted so the order members were made in does not count. mirror: as seen left for right.
export function signature(layout, { mirror = false } = {}) {
    const L = layout.lengthIn, X = (x, w = 0) => q(mirror ? L - x - w : x);
    const members = layout.members.map(m => [m.role, typeOf(m), X(m.x, m.w), q(m.y), q(m.w), q(m.h), q(m.lengthIn),
        m.orient === 'v' ? (webOnRight(m, layout) !== mirror ? 'R' : 'L') : '', (m.pts || []).map(([x, y]) => `${X(x)},${q(y)}`).sort().join(' ')].join('|')).sort();
    const openings = (layout.openings || []).map(o => [X(o.left, o.right - o.left), q(o.bottom), q(o.right - o.left), q(o.top - o.bottom)].join('|')).sort();
    const clips = (layout.clips || []).map(c => [c.type || '', X(c.x), q(c.y), mirror ? (c.side === 'L' ? 'R' : 'L') : c.side].join('|')).sort();
    return JSON.stringify([q(L), q(layout.heightIn), members, openings, clips]);
}
// items: [{ id, mark, layout }] -> groups of two or more: [{ members: [{ id, mark, hand: 'same' | 'opposite' }] }], each
// in the items' order; the first is the group's reference (hand: as it is drawn).
export function typicalGroups(items) {
    const byKey = new Map();
    for (const it of items) {
        if (!it?.layout) continue;
        const s = signature(it.layout), m = signature(it.layout, { mirror: true }), key = s <= m ? s : m;
        (byKey.get(key) || byKey.set(key, []).get(key)).push({ id: it.id, mark: it.mark, s, sym: s === m });
    }
    return [...byKey.values()].filter(list => list.length > 1).map(list => ({
        members: list.map(x => ({ id: x.id, mark: x.mark, hand: x.s === list[0].s || x.sym ? 'same' : 'opposite' })) }));
}
// One panel's typical: its group, whether it is the reference, the others (with their hand relative to this panel).
export function typicalOf(groups, id) {
    const group = groups.find(g => g.members.some(m => m.id === id));
    if (!group) return null;
    const me = group.members.find(m => m.id === id);
    return { group, reference: group.members[0].id === id, hand: me.hand,
        others: group.members.filter(m => m.id !== id).map(m => ({ ...m, hand: m.hand === me.hand ? 'same' : 'opposite' })) };
}
// The note on the sheet that frames a typical: the other panels it frames, those built opposite hand said so.
export function typicalNote(t) {
    if (!t?.others?.length) return '';
    const same = t.others.filter(o => o.hand === 'same').map(o => o.mark), opp = t.others.filter(o => o.hand === 'opposite').map(o => o.mark);
    return `Typical: this framing is also ${[same.length ? same.join(', ') : '', opp.length ? `${opp.join(', ')} (opposite hand: built mirrored, studs facing the other way)` : ''].filter(Boolean).join('; ')}.`;
}
