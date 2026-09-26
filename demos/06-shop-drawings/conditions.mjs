// Framing conditions for one wall (pure; tested in tests/shop-drawings.test.js): head and base of wall from the
// slabs found above and below it in the model, what the wall meets at its ends, and what is within 1 ft of it.
// The probes that measure these live in ./context.js; this file only decides what they mean and how to say it.
import { fmtFtIn } from '../common/framing.mjs';

export const FULL_HEIGHT_TOL_IN = 1; // a top within 1" of the slab above counts as full height

const place = (hit) => (hit?.name ? `${hit.category ? `${hit.category.replace(/^Revit /, '').replace(/s$/, '').toLowerCase()} ` : ''}"${hit.name}"` : 'the slab')
    + (hit?.where && hit.where !== 'over the wall' ? ` (${hit.where})` : '');

// wall: { topZ, baseZ } (feet); above/below: { z, category, name } (feet) or null; revit: { topConstraint, topOffsetFt, topAttached }.
export function headOfWall({ topZ, baseZ, above, revit = {} }) {
    const revitNote = revit.topConstraint ? `Revit: ${revit.topConstraint}${revit.topOffsetFt ? `, offset ${revit.topOffsetFt > 0 ? '+' : '-'}${fmtFtIn(Math.abs(revit.topOffsetFt) * 12)}` : ''}${revit.topAttached ? ', top attached' : ''}.` : '';
    if (!above) {
        return { kind: 'open', label: 'NO SLAB ABOVE IN MODEL', gapIn: null,
            detail: `Nothing found above the wall in the model (roof, soffit or open to above?). Verify the head condition. ${revitNote}`.trim() };
    }
    const gapIn = (above.z - topZ) * 12, toSlabIn = (above.z - baseZ) * 12;
    if (gapIn <= FULL_HEIGHT_TOL_IN) {
        return { kind: 'full', label: 'FULL HEIGHT TO SLAB ABOVE', gapIn, toSlabIn,
            detail: `Top of wall at the underside of ${place(above)}${gapIn > 1 / 16 ? ` (${fmtFtIn(gapIn)} gap)` : ''}; ${fmtFtIn(toSlabIn)} base to slab. Deflection head (slip track) per framing engineer. ${revitNote}`.trim() };
    }
    return { kind: 'partial', label: 'PARTIAL HEIGHT', gapIn, toSlabIn,
        detail: `Top of wall ${fmtFtIn(gapIn)} below ${place(above)} (${fmtFtIn(toSlabIn)} base to slab); wall height per the modeled wall. Brace the top track to structure per framing engineer. ${revitNote}`.trim() };
}

export function baseOfWall({ baseZ, below }) {
    if (!below) return { kind: 'none', label: 'NO SLAB BELOW IN MODEL', gapIn: null, detail: 'Nothing found under the wall in the model. Verify the base condition.' };
    const gapIn = (baseZ - below.z) * 12;
    if (Math.abs(gapIn) <= FULL_HEIGHT_TOL_IN) return { kind: 'slab', label: 'ON SLAB', gapIn, detail: `Bottom track on ${place(below)}.` };
    if (gapIn > 0) return { kind: 'above', label: `${fmtFtIn(gapIn)} ABOVE SLAB`, gapIn, detail: `Base of wall ${fmtFtIn(gapIn)} above ${place(below)} (curb, soffit or stacked wall?). Verify.` };
    return { kind: 'below', label: `${fmtFtIn(-gapIn)} BELOW TOP OF SLAB`, gapIn, detail: `Base of wall ${fmtFtIn(-gapIn)} below the top of ${place(below)} (depressed slab, or the wall runs past the floor?). Verify.` };
}

// items: [{ dbId, category, name, s }] with s = feet along the wall from its left end (side A view); lengthFt: the wall.
// Walls near an end are what the wall meets there; everything else is listed by category.
export function summarizeNearby(items, lengthFt, endTolFt = 1.25) {
    const ends = { left: new Map(), right: new Map() };
    const groups = new Map();
    for (const it of items) {
        const isWall = /walls?$/i.test(it.category || '');
        if (isWall && it.s != null && it.s <= endTolFt) { ends.left.set(it.dbId, it); continue; }
        if (isWall && it.s != null && it.s >= lengthFt - endTolFt) { ends.right.set(it.dbId, it); continue; }
        const cat = (it.category || 'Other').replace(/^Revit /, '');
        if (!groups.has(cat)) groups.set(cat, new Map());
        groups.get(cat).set(it.dbId, it);
    }
    const names = (m) => [...new Set([...m.values()].map(i => i.name || `#${i.dbId}`))];
    return {
        left: names(ends.left), right: names(ends.right),
        within: [...groups].map(([category, m]) => ({ category, count: m.size, names: names(m) })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    };
}

const roomText = (r) => (r ? [r.number, r.name].filter(Boolean).join(' ') : null);

// Label/value lines for the panel, the sheet and the panel page. ctx: { level, rooms: { A, B, note }, head, base, nearby, url }.
export function conditionLines(ctx) {
    const lines = [['LEVEL', ctx.level || '-']];
    if (ctx.rooms) {
        lines.push(['SIDE A (AS DRAWN)', roomText(ctx.rooms.A) || (ctx.rooms.note ? '-' : 'NO ROOM FOUND')]);
        lines.push(['SIDE B (FAR SIDE)', roomText(ctx.rooms.B) || (ctx.rooms.note ? '-' : 'NO ROOM FOUND')]);
        if (ctx.rooms.note) lines.push(['ROOMS', ctx.rooms.note]);
    }
    if (ctx.head) lines.push(['HEAD OF WALL', `${ctx.head.label}. ${ctx.head.detail}`]);
    if (ctx.base) lines.push(['BASE OF WALL', `${ctx.base.label}. ${ctx.base.detail}`]);
    if (ctx.nearby) {
        const n = ctx.nearby;
        lines.push(['LEFT END', n.left.length ? `Meets ${n.left.join(', ')}` : 'Free end (no wall within 1 ft)']);
        lines.push(['RIGHT END', n.right.length ? `Meets ${n.right.join(', ')}` : 'Free end (no wall within 1 ft)']);
        lines.push(['WITHIN 1 FT', n.within.length ? n.within.map(g => `${g.category} (${g.count}): ${g.names.slice(0, 3).join(', ')}${g.names.length > 3 ? ', ...' : ''}`).join('; ') : 'Nothing else in the model']);
    }
    if (ctx.url) lines.push(['PANEL PAGE', ctx.url]);
    return lines;
}
