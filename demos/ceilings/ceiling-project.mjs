import { resolveCeilingPlan } from './ceiling-plan.mjs';

export function footprint(shape, length, depth, notchWidth = length / 2, notchDepth = depth / 2) {
    return shape === 'l-shape' ? [[0, 0], [length, 0], [length, depth - notchDepth], [length - notchWidth, depth - notchDepth], [length - notchWidth, depth], [0, depth]] : [[0, 0], [length, 0], [length, depth], [0, depth]];
}
export function newCeiling(id, mark, mode = 'grid') {
    return { id, mark, mode, elevationIn: 108, source: { kind: 'manual' }, shape: 'rectangle', lengthIn: 240, depthIn: 192, notchWidthIn: 96, notchDepthIn: 72,
        outline: footprint('rectangle', 240, 192), openings: [], settings: { direction: 0, originX: 12, originY: 12, joistSpacingIn: 16, tileDepthIn: 24 } };
}
export function readProject(text) {
    if (typeof text !== 'string' || text.length > 2_000_000) throw Error('Use a ceiling project JSON file smaller than 2 MB.');
    const p = JSON.parse(text);
    if (p?.format !== 'cas-ceiling-project' || p.version !== 1 || !Array.isArray(p.ceilings) || p.ceilings.length > 50 || typeof p.name !== 'string') throw Error('Use a version 1 CAS ceiling project, with up to 50 ceilings. Layout exports and wall projects are different files.');
    const ids = new Set(), marks = new Set();
    for (const c of p.ceilings) {
        if (c.source?.kind !== 'manual') throw Error('This base version imports manual ceiling projects. Linked Revit geometry will require a validated connector.');
        const errors = resolveCeilingPlan(c).issues.filter(i => i.severity === 'error');
        if (errors.length) throw Error(`${c.mark || 'Ceiling'}: ${errors[0].message}`);
        if (ids.has(c.id) || marks.has(c.mark.trim().toLowerCase())) throw Error('Ceiling IDs and marks must be distinct.');
        ids.add(c.id); marks.add(c.mark.trim().toLowerCase());
        if (typeof c.shape !== 'string' || !['rectangle', 'l-shape', 'custom'].includes(c.shape)) c.shape = 'custom';
        if ([c.lengthIn, c.depthIn, c.notchWidthIn, c.notchDepthIn].some(v => !Number.isFinite(v) || v <= 0 || v > 12000)) throw Error('Ceiling size fields must be positive and no greater than 1,000 feet.');
    }
    return { format: p.format, version: 1, name: p.name.slice(0, 200), ceilings: p.ceilings, currentId: p.ceilings.some(c => c.id === p.currentId) ? p.currentId : p.ceilings[0]?.id || null };
}
export function emptyProject() { return { format: 'cas-ceiling-project', version: 1, name: 'Ceiling study', ceilings: [], currentId: null }; }
