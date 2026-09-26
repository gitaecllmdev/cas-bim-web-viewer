// Panel shops index (pure; tested in tests/shop-drawings.test.js). Demo 6 saves one record per picked wall
// ('shop-panel-<externalId>') and keeps this index of them ('shop-panel-index': { panels: { key: entry } }) so the
// panel gallery (core/client/panels.html) and the panel page's Previous / Next can list every panel without a server.
import { frameWall, flipLayout } from '../common/framing.mjs';

export const INDEX_STATE = 'shop-panel-index';

const line = (record, label) => (record.conditions || []).find(([k]) => k === label)?.[1] || '';

// The small part of a panel record the gallery needs (the layout inputs draw its thumbnail).
export function indexEntry(record) {
    return {
        key: record.key, mark: record.mark, level: record.info?.level || '', wallType: record.info?.wallType || '',
        lengthIn: record.frame?.lengthIn || 0, heightIn: record.frame?.heightIn || 0, savedAt: record.savedAt || '',
        sideA: line(record, 'SIDE A (AS DRAWN)'), sideB: line(record, 'SIDE B (FAR SIDE)'), head: line(record, 'HEAD OF WALL').split('.')[0],
        frame: record.frame, flip: !!record.view?.flip,
    };
}

// Level (natural order: L2 before L10), then panel mark.
export function sortPanels(entries) {
    const nat = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
    return [...entries].sort((a, b) => nat(a.level, b.level) || nat(a.mark, b.mark));
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
