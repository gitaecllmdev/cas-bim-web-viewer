import { area, bounds, onSegment, subtractRectangles, rectPolygon, piecesInBox, clipStation, validateOutline, EPS } from './geometry.mjs';
import { sha256Hex } from '../common/sha256.mjs';
import { selectedType, validateTypes } from './member-types.mjs';

export const FORMAT = 'cas-ceiling-plan', VERSION = 1, RULE_VERSION = 'cas-ceiling-layout/2';
export const CATALOG = Object.freeze({
    stud: { key: 'generic:ceiling-joist', description: 'Ceiling joist', role: 'joist', unit: 'LFT' },
    track: { key: 'generic:perimeter-track', description: 'Perimeter track', role: 'perimeter', unit: 'LFT' },
    header: { key: 'generic:opening-frame', description: 'Opening frame', role: 'opening-frame', unit: 'LFT' },
    main: { key: 'generic:main-12ft', description: "12' main runner", role: 'main-runner', unit: 'LFT' },
    cross4: { key: 'generic:tee-4ft', description: "4' cross tee", role: 'cross-tee-4', unit: 'PCS' },
    cross2: { key: 'generic:tee-2ft', description: "2' cross tee", role: 'cross-tee-2', unit: 'PCS' },
    trim: { key: 'generic:wall-angle', description: 'Perimeter wall angle', role: 'perimeter', unit: 'LFT' },
    panel: { key: 'generic:lay-in-panel', description: 'Acoustical panel', role: 'panel', unit: 'PCS' }
});
const issue = (code, message, severity = 'warning') => ({ code, severity, message });
const finite = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
const rounded = n => Math.round(n * 1e8) / 1e8;
const countCells = (b, ox, oy, sx, sy) => (Math.ceil((b.maxX - ox) / sx) - Math.floor((b.minX - ox) / sx)) * (Math.ceil((b.maxY - oy) / sy) - Math.floor((b.minY - oy) / sy));

export function resolveCeilingPlan(ceiling) {
    const c = structuredClone(ceiling), issues = [], members = [], panels = [];
    const result = { format: FORMAT, version: VERSION, ruleVersion: RULE_VERSION, units: 'in', ceilingId: c.id, mark: c.mark, mode: c.mode,
        source: c.source || { kind: 'manual' }, coordinateFrame: { origin: [0, 0, c.elevationIn], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
        outline: c.outline, openings: c.openings || [], members, panels, quantities: [], issues, status: 'preview', integration: { placementReady: false, missing: ['Revit document binding', 'Family/type mapping', 'Support and connection rules'] } };
    const fail = message => { issues.push(issue('invalid-input', message, 'error')); return result; };
    if (typeof c.id !== 'string' || !c.id || typeof c.mark !== 'string' || !c.mark.trim()) return fail('A ceiling needs a stable ID and a nonempty mark.');
    if (!['hardlid', 'grid'].includes(c.mode)) return fail('Select Hardlid or Ceiling grid.');
    if (!validateTypes(c.typeSelections)) return fail('A selected member type is not in the supported type list.');
    const outlineError = validateOutline(c.outline); if (outlineError) return fail(outlineError);
    if (!finite(c.elevationIn, -12000, 12000)) return fail('Enter a finite ceiling elevation within ±1,000 feet.');
    const s = c.settings;
    if (!s || !finite(s.originX, -12000, 12000) || !finite(s.originY, -12000, 12000) || ![0, 90].includes(s.direction)) return fail('Enter a finite grid origin and a 0° or 90° direction.');
    if (!finite(s.joistSpacingIn, 4, 96) || ![24, 48].includes(s.tileDepthIn)) return fail('Use joist spacing from 4–96 inches and a 2×2 or 2×4 tile module.');
    if (!Array.isArray(c.openings) || c.openings.length > 32) return fail('Use at most 32 openings and fixtures per ceiling.');
    const b = bounds(c.outline), holeIds = new Set();
    for (const o of c.openings) {
        if (typeof o.id !== 'string' || !o.id || holeIds.has(o.id) || !['void', 'light', 'diffuser'].includes(o.kind) || !finite(o.x, -12000, 12000) || !finite(o.y, -12000, 12000) || !finite(o.width, 1, 12000) || !finite(o.depth, 1, 12000)) return fail('Openings need distinct IDs, a valid kind, and finite positive dimensions.');
        holeIds.add(o.id);
        const covered = piecesInBox(c.outline, [], { minX: o.x, maxX: o.x + o.width, minY: o.y, maxY: o.y + o.depth }).reduce((a, r) => a + r.width * r.depth, 0);
        if (Math.abs(covered - o.width * o.depth) > EPS) return fail('An opening or fixture extends outside the ceiling footprint.');
    }
    for (let i = 0; i < c.openings.length; i++) for (let j = i + 1; j < c.openings.length; j++) {
        const a = c.openings[i], d = c.openings[j];
        if (Math.min(a.x + a.width, d.x + d.width) - Math.max(a.x, d.x) > EPS && Math.min(a.y + a.depth, d.y + d.depth) - Math.max(a.y, d.y) > EPS) return fail('Openings and fixtures must not overlap.');
    }
    result.sourceFingerprint = 'sha256:' + sha256Hex(JSON.stringify({ outline: c.outline, openings: c.openings, elevationIn: c.elevationIn }));
    result.grossAreaFt2 = area(c.outline) / 144;
    result.netAreaFt2 = piecesInBox(c.outline, c.openings, b).reduce((a, r) => a + r.width * r.depth, 0) / 144;
    const vertical = s.direction === 0, ox = s.originX, oy = s.originY;
    const axisOutline = vertical ? c.outline : c.outline.map(([x, y]) => [y, x]);
    const axisHoles = c.openings.filter(o => c.mode === 'hardlid' || o.kind === 'void').map(o => vertical ? o : { ...o, x: o.y, y: o.x, width: o.depth, depth: o.width });
    const ab = bounds(axisOutline), u0 = vertical ? ox : oy, v0 = vertical ? oy : ox;
    const world = ([u, v]) => vertical ? [u, v, 0] : [v, u, 0];
    const add = (key, catalog, a, d) => {
        const lengthIn = Math.hypot(d[0] - a[0], d[1] - a[1]); if (lengthIn < 0.01) return;
        members.push({ key: `${c.id}:${key}`, role: catalog.role, catalogKey: catalog.key, typeSelection: selectedType(c.typeSelections, catalog.role, c.mode), description: catalog.description, unit: catalog.unit,
            start: a.map(rounded), end: d.map(rounded), lengthIn: rounded(lengthIn), mark: '', sectionOrientation: null });
    };
    const perimeterCatalog = c.mode === 'hardlid' ? CATALOG.track : CATALOG.trim;
    const frameHoles = c.openings.filter(o => c.mode === 'hardlid' || o.kind === 'void');
    for (let i = 0; i < c.outline.length; i++) subtractRectangles(c.outline[i], c.outline[(i + 1) % c.outline.length], frameHoles).forEach((edge, n) => add(`perimeter:${i}:${n}`, perimeterCatalog, ...edge.map(p => [...p, 0])));
    const stations = (min, max, origin, spacing) => {
        const out = []; for (let i = Math.floor((min - origin) / spacing) + 1; origin + i * spacing < max - EPS; i++) out.push([i, origin + i * spacing]); return out;
    };
    const splits = (min, max, origin, spacing) => [min, ...stations(min, max, origin, spacing).map(x => x[1]), max];
    if (c.mode === 'hardlid') {
        if ((ab.maxX - ab.minX) / s.joistSpacingIn > 2000) return fail('The footprint would exceed 2,000 joist stations.');
        for (const [i, u] of stations(ab.minX, ab.maxX, u0, s.joistSpacingIn)) clipStation(axisOutline, axisHoles, true, u).forEach((line, n) => add(`joist:${i}:${n}`, CATALOG.stud, ...line.map(world)));
        for (const o of c.openings) {
            const p = rectPolygon(o);
            for (let i = 0; i < 4; i++) subtractRectangles(p[i], p[(i + 1) % 4], c.openings.filter(other => other.id !== o.id)).forEach((edge, n) => {
                const mid = edge[0].map((v, k) => (v + edge[1][k]) / 2);
                if (!c.outline.some((a, j) => onSegment(mid, a, c.outline[(j + 1) % c.outline.length]))) add(`opening:${o.id}:${i}:${n}`, CATALOG.header, ...edge.map(p => [...p, 0]));
            });
        }
        issues.push(issue('hardlid-supports', 'Joists, perimeter tracks and opening frames are layout geometry. Carrying channels, hangers, load/span selection and connection details are not resolved.', 'needs-resolution'));
    } else {
        if (countCells(ab, u0, v0, 24, s.tileDepthIn) > 6000) return fail('This base workspace supports up to 6,000 tile cells per ceiling.');
        for (const [i, u] of stations(ab.minX, ab.maxX, u0, 48)) clipStation(axisOutline, axisHoles, true, u).forEach((line, n) => {
            const ss = splits(line[0][1], line[1][1], v0, 144);
            for (let k = 1; k < ss.length; k++) add(`main:${i}:${n}:${Math.floor((ss[k - 1] - v0 + EPS) / 144)}`, CATALOG.main, world([u, ss[k - 1]]), world([u, ss[k]]));
        });
        for (const [i, v] of stations(ab.minY, ab.maxY, v0, s.tileDepthIn)) clipStation(axisOutline, axisHoles, false, v).forEach((line, n) => {
            const ss = splits(line[0][0], line[1][0], u0, 48);
            for (let k = 1; k < ss.length; k++) add(`cross4:${i}:${n}:${k}`, CATALOG.cross4, world([ss[k - 1], v]), world([ss[k], v]));
        });
        for (const [i, u] of stations(ab.minX, ab.maxX, u0 + 24, 48)) clipStation(axisOutline, axisHoles, true, u).forEach((line, n) => {
            const ss = splits(line[0][1], line[1][1], v0, s.tileDepthIn);
            for (let k = 1; k < ss.length; k++) add(`cross2:${i}:${n}:${k}`, s.tileDepthIn === 24 ? CATALOG.cross2 : { ...CATALOG.cross4, role: 'cross-tee-4-infill' }, world([u, ss[k - 1]]), world([u, ss[k]]));
        });
        const ux = vertical ? 24 : s.tileDepthIn, vy = vertical ? s.tileDepthIn : 24;
        const sx = Math.floor((b.minX - ox) / ux), ex = Math.ceil((b.maxX - ox) / ux), sy = Math.floor((b.minY - oy) / vy), ey = Math.ceil((b.maxY - oy) / vy);
        for (let i = sx; i < ex; i++) for (let j = sy; j < ey; j++) {
            const x = ox + i * ux, y = oy + j * vy, pieces = piecesInBox(c.outline, c.openings, { minX: x, maxX: x + ux, minY: y, maxY: y + vy });
            const used = pieces.reduce((a, p) => a + p.width * p.depth, 0); if (used < EPS) continue;
            panels.push({ key: `${c.id}:tile:${i}:${j}`, catalogKey: CATALOG.panel.key, mark: 'P1', x, y, width: ux, depth: vy, pieces, areaIn2: rounded(used), cut: used < ux * vy - EPS });
        }
        for (const o of c.openings.filter(o => o.kind !== 'void')) if ([o.x - ox, o.x + o.width - ox].some(n => Math.abs(n / ux - Math.round(n / ux)) > EPS) || [o.y - oy, o.y + o.depth - oy].some(n => Math.abs(n / vy - Math.round(n / vy)) > EPS)) issues.push(issue('fixture-off-grid', 'A light or diffuser is off the tile grid. Its support and affected tees need coordination.', 'needs-resolution'));
        if (c.openings.some(o => o.kind === 'void')) issues.push(issue('void-edge-support', 'Grid members are clipped at voids. Opening trims and additional supports need coordination.', 'needs-resolution'));
        issues.push(issue('grid-supports', 'Hangers, seismic bracing, connector/rout positions, panel edge allowances and stock purchasing optimization are not included.', 'needs-resolution'));
    }
    const groups = new Map(), prefixes = { joist: 'J', perimeter: c.mode === 'grid' ? 'TRM' : 'PT', 'opening-frame': 'OF', 'main-runner': 'MB', 'cross-tee-4': 'XT', 'cross-tee-2': 'XT', 'cross-tee-4-infill': 'XT' }, counters = {};
    for (const m of members) {
        const key = `${m.catalogKey}|${m.lengthIn}`;
        if (!groups.has(key)) { const prefix = prefixes[m.role]; counters[prefix] = (counters[prefix] || 0) + 1; groups.set(key, { mark: prefix + counters[prefix], catalogKey: m.catalogKey, typeSelection: m.typeSelection, description: m.description, role: m.role, lengthIn: m.lengthIn, quantity: 0, totalLengthFt: 0, unit: m.unit }); }
        const g = groups.get(key); m.mark = g.mark; g.quantity++; g.totalLengthFt += m.lengthIn / 12;
    }
    const order = { 'main-runner':0,joist:0,'cross-tee-4':1,'cross-tee-4-infill':1,'cross-tee-2':2,'opening-frame':3,perimeter:4 };
    result.quantities = [...groups.values()].map(g => ({ ...g, totalLengthFt: rounded(g.totalLengthFt) })).sort((a,b)=>(order[a.role]??5)-(order[b.role]??5));
    if (panels.length) result.quantities.push({ mark: 'P1', catalogKey: CATALOG.panel.key, description: `${s.tileDepthIn === 24 ? '2 × 2' : '2 × 4'} acoustical panel`, role: 'panel', quantity: panels.length, full: panels.filter(p => !p.cut).length, cut: panels.filter(p => p.cut).length, unit: 'PCS' });
    for (const kind of ['light', 'diffuser']) { const qty = c.openings.filter(o => o.kind === kind).length; if (qty) result.quantities.push({ mark: kind === 'light' ? 'L1' : 'D1', role: kind, description: kind === 'light' ? 'Light (by others)' : 'Diffuser (by others)', quantity: qty, unit: 'PCS' }); }
    result.memberCount = members.length; result.panelCount = panels.length;
    return result;
}

export function planSet(project) {
    return { format: 'cas-ceiling-plan-set', version: VERSION, ruleVersion: RULE_VERSION, units: 'in', project: project.name,
        ceilings: project.ceilings.map(resolveCeilingPlan) };
}
