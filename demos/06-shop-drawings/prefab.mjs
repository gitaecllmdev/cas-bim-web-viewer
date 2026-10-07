// Prefab lengths (pure; tested in tests/shop-drawings.test.js): the prefab team's cut length for a cut-list mark,
// set in 1/8" steps from the drawn LENGTH to suit the real-world cut. Saved with the panel's notes ('panel-notes-<key>',
// field `prefab`) as { [mark]: { base, lengthIn, at } }: base is the LENGTH it was set against, so a value set for an
// older layout (marks renumber when the framing changes) is not applied to a different member.
// On the sheet the PREFAB LENGTH cell stays blank until a value is set; then it shows it, blue when longer than the
// LENGTH and green when shorter.
export const PREFAB_STEP = 0.125; // 1/8"
// Text and cell fill (the cut list), and the member fill in the web view's elevation.
export const PREFAB_COLORS = { more: '#1f5fbf', less: '#1a7f37', moreFill: '#e3edfb', lessFill: '#e2f4e6', moreMember: '#8fb4ea', lessMember: '#93d4a3' };

// Lengths are compared as printed: to the nearest 1/8" (framing.mjs fmtFtIn).
const round8 = (v) => Math.round(v / PREFAB_STEP) * PREFAB_STEP;
const same = (a, b) => Math.abs(round8(a) - round8(b)) < 1e-6;

// The prefab lengths that apply to this cut list: { [mark]: lengthIn }, only where the saved base is the row's length
// and the value differs from it.
export function prefabFor(cutList, saved = {}) {
    const out = {};
    for (const r of cutList || []) {
        const p = saved?.[r.mark];
        if (p && Number.isFinite(p.lengthIn) && Number.isFinite(p.base) && Math.abs(p.base - r.lengthIn) < 1 / 64 && !same(p.lengthIn, r.lengthIn)) out[r.mark] = p.lengthIn;
    }
    return out;
}

// Values set against an earlier drawing of the panel (the mark is gone, or its length changed since: a re-scan in
// Demo 6 redraws it): not applied, listed so the prefab team can set them again. [{ mark, base, lengthIn }]
export function prefabStale(cutList, saved = {}) {
    return Object.entries(saved || {}).filter(([mark, p]) => {
        const r = (cutList || []).find(x => x.mark === mark);
        return p && Number.isFinite(p.lengthIn) && !(r && Number.isFinite(p.base) && Math.abs(p.base - r.lengthIn) < 1 / 64);
    }).map(([mark, p]) => ({ mark, base: p.base, lengthIn: p.lengthIn }));
}

// The change from the LENGTH in inches and eighths: '+1/8"', '-1 1/4"'.
export function fmtDelta(row, lengthIn) {
    const d = round8(lengthIn) - round8(row.lengthIn), eighths = Math.round(Math.abs(d) / PREFAB_STEP);
    const whole = Math.floor(eighths / 8);
    let num = eighths % 8, den = 8;
    while (num && num % 2 === 0) { num /= 2; den /= 2; }
    return `${d < 0 ? '-' : '+'}${[whole || (!num ? '0' : ''), num ? `${num}/${den}` : ''].filter(Boolean).join(' ')}"`;
}

// 'more' / 'less' than the LENGTH, or null (not set, or the same).
export const prefabState = (row, lengthIn) => (lengthIn == null || same(lengthIn, row.lengthIn) ? null : lengthIn > row.lengthIn ? 'more' : 'less');

// The saved map after `steps` eighths (+1 longer, -1 shorter) on a cut-list row; back at the LENGTH, the entry is
// removed, and steps 0 resets the row. A step that would make it zero or less does nothing.
export function stepPrefab(saved, row, steps, at = new Date().toISOString()) {
    const next = { ...(saved || {}) };
    const current = prefabFor([row], saved)[row.mark] ?? row.lengthIn;
    const value = steps ? round8(current + steps * PREFAB_STEP) : row.lengthIn;
    if (value <= 0) return next;
    if (same(value, row.lengthIn)) delete next[row.mark];
    else next[row.mark] = { base: row.lengthIn, lengthIn: value, at };
    return next;
}
