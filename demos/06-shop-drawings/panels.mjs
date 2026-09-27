// Panel shops index (pure; tested in tests/shop-drawings.test.js). Demo 6 saves one record per picked wall
// ('shop-panel-<externalId>') and keeps this index of them ('shop-panel-index': { panels: { key: entry } }) so the
// panel gallery (core/client/panels.html) and the panel page's Previous / Next can list every panel without a server.
import { frameWall, flipLayout, isDoor } from '../common/framing.mjs';

export const INDEX_STATE = 'shop-panel-index';

const line = (record, label) => (record.conditions || []).find(([k]) => k === label)?.[1] || '';

// The small part of a panel record the gallery needs (the layout inputs draw its thumbnail).
export function indexEntry(record) {
    return {
        key: record.key, mark: record.mark, level: record.info?.level || '', wallType: record.info?.wallType || '',
        lengthIn: record.frame?.lengthIn || 0, heightIn: record.frame?.heightIn || 0, savedAt: record.savedAt || '',
        sideA: line(record, 'SIDE A (AS DRAWN)'), sideB: line(record, 'SIDE B (FAR SIDE)'), head: line(record, 'HEAD OF WALL').split('.')[0],
        ...layoutFacts(record),
        frame: record.frame, flip: !!record.view?.flip,
    };
}

// Doors and windows as drawn (the layout leaves out slivers under 6"), the framing check, and the panel types, so
// the card and the sheet agree.
function layoutFacts(record) {
    let layout = null;
    try { layout = record.frame ? entryLayout(record) : null; } catch { /* incomplete record */ }
    const openings = layout?.openings || [];
    return { doors: openings.filter(isDoor).length, windows: openings.filter(o => !isDoor(o)).length,
        issues: layout?.issues?.length ?? 0, types: layout ? panelTypes(layout, record.frame?.rows) : [] };
}

// Panel types for the gallery filter: one by its openings, plus any of stacked openings, an opening at a wall end,
// double stud rows and a tall wall (over 20 ft).
export const PANEL_TYPES = ['Plain wall', 'Door', 'Window', 'Door + window', 'Multiple doors', 'Multiple windows',
    'Stacked openings', 'Opening at a wall end', 'Double stud', 'Tall wall (over 20 ft)'];
export function panelTypes(layout, rows = 1) {
    const o = layout.openings, doors = o.filter(isDoor).length, windows = o.length - doors;
    const types = [doors && windows ? 'Door + window' : doors > 1 ? 'Multiple doors' : windows > 1 ? 'Multiple windows' : doors ? 'Door' : windows ? 'Window' : 'Plain wall'];
    if (o.some((a, i) => o.some((b, j) => j > i && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0))) types.push('Stacked openings');
    if (o.some(x => x.left < 6 || x.right > layout.lengthIn - 6)) types.push('Opening at a wall end');
    if (rows > 1) types.push('Double stud');
    if (layout.heightIn > 240) types.push('Tall wall (over 20 ft)');
    return types;
}

// Orders: 'complex' (default: most openings first, then longest; the panels worth showing), or 'level'
// (level in natural order, L2 before L10, then panel mark).
export const openingsOf = (p) => (p.doors != null ? p.doors + (p.windows ?? 0) : (p.frame?.openings?.length ?? 0));
export function sortPanels(entries, order = 'complex') {
    const nat = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
    const byLevel = (a, b) => nat(a.level, b.level) || nat(a.mark, b.mark);
    if (order === 'level') return [...entries].sort(byLevel);
    return [...entries].sort((a, b) => openingsOf(b) - openingsOf(a) || (b.doors ?? 0) - (a.doors ?? 0) || (b.lengthIn || 0) - (a.lengthIn || 0) || byLevel(a, b));
}

// "2 doors · 3 windows" (or "No openings").
export function openingsText(p) {
    const doors = p.doors ?? (p.frame?.openings || []).filter(isDoor).length;
    const windows = p.windows ?? (p.frame?.openings || []).filter(o => !isDoor(o)).length;
    const part = (n, one) => (n ? `${n} ${one}${n === 1 ? '' : 's'}` : '');
    return [part(doors, 'door'), part(windows, 'window')].filter(Boolean).join(' · ') || 'No openings';
}

// The layout as drawn for an index entry or a record (flipped when the panel is viewed from side B).
export function entryLayout(entry) {
    const { notes = [], ...options } = entry.frame || {};
    const layout = frameWall(options);
    layout.notes.push(...notes);
    return entry.flip || entry.view?.flip ? flipLayout(layout) : layout;
}

// Mini elevation (members and openings only), scaled to fit its box by the browser.
export function thumbnailSvg(layout) {
    const { lengthIn: L, heightIn: H } = layout, pad = Math.max(L, H) * 0.03;
    const y = (v) => H - v; // wall inches up -> SVG down
    const parts = layout.openings.map(o => `<rect x="${o.left}" y="${y(o.top)}" width="${o.right - o.left}" height="${o.top - o.bottom}" fill="#f3f4f6" stroke="#9aa0a6" stroke-width="${pad * 0.15}"/>`);
    for (const m of layout.members) {
        const fill = m.orient === 'h' ? (m.role === 'head track' || m.role === 'sill track' ? '#f4a7a0' : '#f2d64b') : '#ffffff';
        parts.push(`<rect x="${m.x}" y="${y(m.y + m.h)}" width="${m.w}" height="${m.h}" fill="${fill}" stroke="#555" stroke-width="${pad * 0.12}"/>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${L + 2 * pad} ${H + 2 * pad}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
}
