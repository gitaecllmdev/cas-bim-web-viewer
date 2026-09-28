// The takeoff Breakdown (Demo 2): every framing member and board line of every framed wall as a flat line, so the
// grid can slice (filter) and group it by any mix of level, framing type, member, role, wall type and fire rating,
// with sub-totals on every group. Pure functions (no Viewer); tests/takeoff.test.js checks them against takeoff().
// Quantities are net (no waste): the Order list (takeoff().materials) adds waste and rounds to pieces.
import { assemblyFor, boardFor, wallQuantities, fmtInches } from './calc.mjs';

const NOT_SET = 'Not set';
const ROLE_NAMES = { ST: 'Studs', JB: 'Jamb studs', CR: 'Cripples', TR: 'Track', HD: 'Head track', SL: 'Sill track', FC: 'Furring', BD: 'Board' };
const ROLE_ORDER = Object.keys(ROLE_NAMES);
const byName = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

// What the grid can group and slice by: the label, the value of a line, and the sort order of the values.
export const DIMENSIONS = {
    level: { label: 'Level', value: l => l.level, sort: byName },
    framing: { label: 'Framing type', value: l => l.framing, sort: (a, b) => depthOf(a) - depthOf(b) || byName(a, b) },
    member: { label: 'Member', value: l => l.member, sort: (a, b) => memberRank(a) - memberRank(b) || byName(a, b) },
    role: { label: 'Role', value: l => l.role, sort: (a, b) => ROLE_ORDER.indexOf(codeOf(a)) - ROLE_ORDER.indexOf(codeOf(b)) },
    wallType: { label: 'Wall type', value: l => l.wallType, sort: byName },
    fire: { label: 'Fire rating', value: l => l.fire, sort: byName },
};
export const DEFAULT_GROUPS = ['level', 'framing', 'member'];

const depthOf = (label) => { const m = /^(\d+)(?: (\d+)\/(\d+))?"|^(\d+)\/(\d+)"/.exec(label || ''); if (!m) return Infinity; return m[4] ? m[4] / m[5] : Number(m[1]) + (m[2] ? m[2] / m[3] : 0); };
const memberRank = (name) => (/gypsum|sheathing/i.test(name) ? 2 : /T\d/.test(name) ? 1 : 0); // studs, then track, then board
const codeOf = (roleName) => Object.keys(ROLE_NAMES).find(k => ROLE_NAMES[k] === roleName) || 'ZZ';

// "3 5/8" studs", "7/8" furring": the framing type of a wall's assembly.
export const framingLabel = (asm) => `${fmtInches(asm.studIn)} ${asm.member === 'furring channel' ? 'furring' : 'studs'}`;

// Flat lines for the framed walls: one per member (code, member type, cut length) and one per board material.
// Each line: { wall, level, wallType, fire, framing, member, role, code, kind: 'stud'|'track'|'board', cutIn, pcs, lf, sf }.
export function takeoffLines(walls, rules, overrides = {}, settingsOverride = {}) {
    const settings = { ...rules.settings, ...settingsOverride };
    const lines = [];
    for (const w of walls) {
        const asm = assemblyFor(w.wallType ?? NOT_SET, rules, overrides);
        if (asm.scope !== 'framed') continue;
        const q = wallQuantities(w, asm, settings);
        if (q.missing) continue;
        const base = { wall: w.dbId, level: w.level ?? NOT_SET, wallType: w.wallType ?? NOT_SET, fire: w.fireRating || 'Not rated', framing: framingLabel(asm) };
        for (const m of q.members) {
            const code = m.code;
            const lf = (m.qty * m.lengthIn) / 12;
            lines.push({ ...base, member: m.type, role: ROLE_NAMES[code] || code, code, kind: m.vertical ? 'stud' : 'track', cutIn: m.lengthIn,
                pcs: m.vertical ? m.qty : 0, lf, sf: 0 });
        }
        if (q.boardSf) lines.push({ ...base, member: `${boardFor(w, asm)} gypsum board`, role: ROLE_NAMES.BD, code: 'BD', kind: 'board', cutIn: 0, pcs: 0, lf: 0, sf: q.boardSf });
        if (q.sheathingSf) lines.push({ ...base, member: 'Exterior sheathing', role: ROLE_NAMES.BD, code: 'BD', kind: 'board', cutIn: 0, pcs: 0, lf: 0, sf: q.sheathingSf });
    }
    return lines;
}

// filters: { <dimension>: Set of values } (a missing or empty set = everything).
export function filterLines(lines, filters = {}, skip = null) {
    const active = Object.entries(filters).filter(([dim, set]) => dim !== skip && DIMENSIONS[dim] && set?.size);
    if (!active.length) return lines;
    return lines.filter(l => active.every(([dim, set]) => set.has(DIMENSIONS[dim].value(l))));
}

// Slicer values for each dimension with their wall counts, cross-filtered by the other slicers (as in a dashboard):
// { <dimension>: [{ value, walls }] }, sorted like the grid.
export function facets(lines, filters = {}, dims = Object.keys(DIMENSIONS)) {
    const out = {};
    for (const dim of dims) {
        const walls = new Map();
        for (const l of filterLines(lines, filters, dim)) {
            const v = DIMENSIONS[dim].value(l);
            if (!walls.has(v)) walls.set(v, new Set());
            walls.get(v).add(l.wall);
        }
        // Keep selected values listed even when the other slicers leave them empty.
        for (const v of filters[dim] || []) if (!walls.has(v)) walls.set(v, new Set());
        out[dim] = [...walls].map(([value, set]) => ({ value, walls: set.size })).sort((a, b) => DIMENSIONS[dim].sort(a.value, b.value));
    }
    return out;
}

// Totals of a set of lines: walls (distinct), stud pieces and LF, track LF, board and sheathing SF, and the wall ids.
export function totalsOf(lines) {
    const ids = new Set();
    const t = { walls: 0, studs: 0, studLf: 0, trackLf: 0, boardSf: 0, sheathingSf: 0, ids: [] };
    for (const l of lines) {
        ids.add(l.wall);
        if (l.kind === 'stud') { t.studs += l.pcs; t.studLf += l.lf; } else if (l.kind === 'track') t.trackLf += l.lf;
        else if (l.member === 'Exterior sheathing') t.sheathingSf += l.sf; else t.boardSf += l.sf;
    }
    t.walls = ids.size;
    t.ids = [...ids];
    return t;
}

// Nested groups for the grid: [{ key, dim, value, depth, totals, children }]. Under the last group, `items` are
// the member lines by role and cut length (what the Order list gives a mark), longest first.
// sorts: { <dimension>: compare } to override a dimension's order (e.g. levels bottom to top, as in the model).
export function groupLines(lines, dims = DEFAULT_GROUPS, sorts = {}) {
    const group = (members, [dim, ...rest], prefix, depth) => {
        const d = DIMENSIONS[dim];
        const groups = new Map();
        for (const l of members) {
            const v = d.value(l);
            if (!groups.has(v)) groups.set(v, []);
            groups.get(v).push(l);
        }
        return [...groups.keys()].sort(sorts[dim] || d.sort).map(value => {
            const inGroup = groups.get(value);
            const key = `${prefix}${prefix ? '␟' : ''}${dim}=${value}`;
            return { key, dim, value, depth, totals: totalsOf(inGroup),
                children: rest.length ? group(inGroup, rest, key, depth + 1) : [], items: rest.length ? null : itemsOf(inGroup) };
        });
    };
    return dims.length ? group(lines, dims, '', 0) : [];
}

function itemsOf(lines) {
    const byKey = new Map();
    for (const l of lines) {
        const k = `${l.code}|${l.member}|${l.cutIn}`;
        if (!byKey.has(k)) byKey.set(k, { code: l.code, role: l.role, member: l.member, kind: l.kind, cutIn: l.cutIn, lines: [] });
        byKey.get(k).lines.push(l);
    }
    return [...byKey.values()].map(e => ({ ...e, key: `${e.code}|${e.member}|${e.cutIn}`, totals: totalsOf(e.lines), lines: undefined }))
        .sort((a, b) => ROLE_ORDER.indexOf(a.code) - ROLE_ORDER.indexOf(b.code) || memberRank(a.member) - memberRank(b.member) || b.cutIn - a.cutIn);
}

// Find a group by its key (the Breakdown's row selection survives re-renders this way).
export function findGroup(groups, key) {
    for (const g of groups) {
        if (g.key === key) return g;
        if (key.startsWith(`${g.key}␟`)) return findGroup(g.children, key);
    }
    return null;
}
