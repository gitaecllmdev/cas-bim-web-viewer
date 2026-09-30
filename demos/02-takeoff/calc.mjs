// Framing and finish takeoff math for Demo 2. Pure functions (no Viewer), so tests/takeoff.test.js can check them.
// Inputs are wall records from core/client/helpers.js getWallData(), with length in ft and area in sq ft
// (plus heightFt = Revit Unconnected Height when known, and scan = { lengthIn, heightIn, openings } once the
// wall's openings have been scanned). Rules and default settings: samples/takeoff-rules.json.
// All framing members come from the same layout engine as the shop drawings (../common/framing.mjs), so the
// takeoff's counts and cut lengths (1/8", rounded down) match what the shop drawings frame.
import { frameWall, floor8 } from '../common/framing.mjs';
import { resolveFraming, resolveOpening, isStudProfile } from './criteria.mjs';

export const fmtInches = (inches) => {
    const whole = Math.floor(inches + 1e-9);
    const frac = Math.round((inches - whole) * 8); // eighths
    if (!frac) return `${whole}"`;
    const [n, d] = frac % 4 === 0 ? [frac / 4, 2] : frac % 2 === 0 ? [frac / 2, 4] : [frac, 8];
    return whole ? `${whole} ${n}/${d}"` : `${n}/${d}"`;
};

// Takeoff member marks: role code + stud depth + number, e.g. ST362-1. Numbered per code and depth, longest first.
export const ROLES = {
    ST: 'stud (end and layout)', JB: 'jamb stud', CR: 'cripple', TR: 'track (top and bottom)', HD: 'head track', SL: 'sill track', FC: 'furring channel',
};
const CODE_ORDER = Object.keys(ROLES);
const ROLE_CODE = { 'stud': 'ST', 'end stud': 'ST', 'jamb stud': 'JB', 'cripple': 'CR', 'top track': 'TR', 'bottom track': 'TR', 'head track': 'HD', 'sill track': 'SL' };
export function roleCode(role, member = 'stud') {
    const code = ROLE_CODE[role] || 'ST';
    return member === 'furring channel' && ['ST', 'JB', 'CR'].includes(code) ? 'FC' : code;
}
const depthCode = (studIn) => String(Math.floor(studIn * 100 + 1e-6)).padStart(3, '0');

// The assembly for a wall type: first matching rule, then per-type overrides (from the Assemblies tab).
// insulation: the cavity insulation (none, batt, mineral wool, spray foam, insulated panel), from the rule or the
// Assemblies tab, else from the type name ("insul..." -> batt; "insulated panel"); linerLayers: 1" shaftliner layers
// of a shaft wall (default 1).
export const INSULATIONS = ['none', 'batt', 'mineral wool', 'spray foam', 'insulated panel'];
export function assemblyFor(typeName, rules, overrides = {}) {
    const rule = rules.assemblies.find(a => new RegExp(a.match, 'i').test(typeName || ''));
    const base = rule
        ? { scope: 'framed', rows: 1, layers: [0, 0], track: true, sheathingSides: 0, member: 'stud', ...rule }
        : { scope: 'review', label: 'No rule matches: set the assembly in the Assemblies tab', rows: 1, layers: [0, 0], track: true, sheathingSides: 0, member: 'stud' };
    const asm = { ...base, ...overrides[typeName] };
    // "NO INSUL." in a type name means none (CAS-coded names say NO INSUL. / THERMAL INSUL. / ACOUSTICAL INSUL.).
    const t = (typeName || '').replace(/\bno\s+insul\w*\.?/gi, '');
    asm.insulation ??= /insulated panel/i.test(t) ? 'insulated panel' : /insul|batt|mineral wool|acoustic|sound/i.test(t) ? 'batt' : 'none';
    return asm;
}

// "6\" batt", "3 5/8\" mineral wool", "insulated panel": the insulation of a wall, or '' for none.
export function insulationLabel(asm, studIn) {
    if (!asm.insulation || asm.insulation === 'none' || asm.scope !== 'framed') return '';
    return asm.insulation === 'insulated panel' ? 'Insulated panel' : `${fmtInches(studIn)} ${asm.insulation}`;
}

// 5/8" Type X for fire-rated walls, else 5/8" regular (a rule's "board" wins).
export function boardFor(wall, asm) {
    if (asm.board) return asm.board;
    return /\bHR\b/i.test(wall.fireRating || '') ? '5/8" Type X' : '5/8" Regular';
}

// Smallest stock length that fits; short studs (under half the shortest stock) are cut several per 10' piece.
export function studStock(heightFt, stockFt) {
    const fit = stockFt.find(s => s >= heightFt - 1e-6);
    if (!fit) return { stockFt: Math.ceil(heightFt), perPiece: 1, special: true };
    if (heightFt <= 5) {
        const cutFrom = stockFt.includes(10) ? 10 : fit;
        return { stockFt: cutFrom, perPiece: Math.max(1, Math.floor(cutFrom / heightFt)), special: false };
    }
    return { stockFt: fit, perPiece: 1, special: false };
}

// Order length for a cut length (inches): the cut length itself (1/8"), rounded up to 1/2" or 1", or the next stock
// length (short pieces cut several per 10' piece; longer than the longest stock = a special length rounded up to 1").
export function orderLength(cutIn, mode, stockFt) {
    if (mode === 'half') return { orderIn: Math.ceil(cutIn * 2 - 1e-9) / 2, perPiece: 1 };
    if (mode === 'inch') return { orderIn: Math.ceil(cutIn - 1e-9), perPiece: 1 };
    if (mode === 'stock') {
        const st = studStock(cutIn / 12, stockFt);
        return { orderIn: st.special ? Math.ceil(cutIn - 1e-9) : st.stockFt * 12, perPiece: st.perPiece, special: st.special };
    }
    return { orderIn: floor8(cutIn), perPiece: 1 };
}

// Quantities for one wall (no waste; waste is applied to the totals). Every framing member comes from frameWall():
// members = [{ code, role, type, lengthIn, qty, stud, src }] with cut lengths in inches (qty covers all stud rows and
// every part of a built-up member; stud: counted as stud material, else track; src: where its framing came from).
// Openings (jambs, headers, sills, cripples) are only known once the wall has been scanned (wall.scan).
// ctx: { criteria, overrides, placeholder } - the engineer's criteria, the manual overrides by wall GUID and the SSMA
// placeholder tables (criteria.mjs); the wall's framing (q.spec) and each opening's are resolved from them.
// A wall that runs up through more levels (taller than wall.levelSpanFt, its base level's floor-to-floor height from
// its base, by more than a foot) is counted on its base level only, studs floor to floor, board in proportion
// (settings.multiLevel 'base', the default), or full height in one piece ('full'). q.capped says it was.
export function wallQuantities(wall, asm, settings, ctx = {}) {
    const length = Number(wall.length), fullArea = Number(wall.area);
    if (!(length > 0) || !(fullArea > 0)) return { missing: true };
    const fullHeight = wall.heightFt > 0 ? Number(wall.heightFt) : fullArea / length; // Revit height; area ÷ length reads low with openings
    const capped = settings.multiLevel !== 'full' && wall.levelSpanFt > 0 && fullHeight > wall.levelSpanFt + 1;
    const height = capped ? wall.levelSpanFt : fullHeight;
    const area = capped ? fullArea * (height / fullHeight) : fullArea;
    const q = { length, area, height, fullHeight, capped, lifts: 1, members: [], studs: 0, studLf: 0, trackLf: 0, openings: 0, scanned: !!wall.scan,
        boardSf: 0, finishSf: 0, sheathingSf: 0, layers: 0, linerSf: 0, linerPanels: 0, insulationSf: 0, insulation: '', spec: null };
    if (asm.scope !== 'framed') return q;
    const scan = wall.scan;
    const heightIn = capped ? height * 12 : scan?.heightIn || height * 12;
    const spec = resolveFraming(wall, asm, settings, { criteria: ctx.criteria, override: ctx.overrides?.[wall.externalId], placeholder: ctx.placeholder, heightIn });
    q.spec = spec;
    // Openings on the counted height only (a wall counted on its base level leaves out the ones on the levels above).
    const openings = (scan?.openings || []).filter(o => o.bottom < heightIn - 6).map(o => ({ ...o, framing: resolveOpening(o, spec, ctx) }));
    q.openingSources = openings.map(o => o.framing?.source).filter(Boolean);
    const lay = frameWall({
        lengthIn: scan?.lengthIn || length * 12, heightIn, openings,
        studIn: spec.studIn, rows: spec.rows, spacingIn: spec.spacingIn, mils: spec.mils, member: asm.member, flangeIn: spec.flangeIn,
        studName: spec.studName, trackName: spec.trackName, topTrackName: spec.topTrackName,
        liftIn: settings.splitTallWalls ? Math.max(...settings.studStockFt) * 12 : Infinity,
    });
    q.lifts = lay.lifts;
    q.openings = lay.openings.length;
    const byKey = new Map();
    for (const m of lay.members) {
        if (m.orient === 'h' && !asm.track) continue; // a furring assembly has no track
        const code = roleCode(m.role, asm.member);
        const src = m.src || spec.source;
        for (const part of m.parts || [{ name: m.type, qty: 1 }]) {
            const key = `${code}|${part.name}|${m.lengthIn}|${src}`;
            // Studs (S, CS, CT) are stud material even as a header part; tracks are track. Unnamed members: by direction.
            const stud = /^\d{3}[A-Z]/.test(part.name) ? isStudProfile(part.name) : m.orient === 'v';
            const e = byKey.get(key) || { code, role: m.role, type: part.name, lengthIn: m.lengthIn, qty: 0, vertical: stud, src };
            e.qty += spec.rows * part.qty;
            byKey.set(key, e);
        }
    }
    q.members = [...byKey.values()];
    for (const m of q.members) {
        if (m.vertical) { q.studs += m.qty; q.studLf += (m.qty * m.lengthIn) / 12; } else q.trackLf += (m.qty * m.lengthIn) / 12;
    }
    q.layers = asm.layers[0] + asm.layers[1];
    q.boardSf = area * q.layers;
    q.finishSf = area * asm.layers.filter(n => n > 0).length; // face layer of each boarded side is taped and finished
    q.sheathingSf = area * (asm.sheathingSides || 0);
    // A shaft wall's 1" shaftliner (24" wide panels, full height, set in the J track); cavity insulation (one side).
    if (spec.finishClass === 'SHAFT') {
        const layers = asm.linerLayers ?? 1;
        q.linerSf = area * layers;
        q.linerPanels = Math.ceil((scan?.lengthIn || length * 12) / 24 - 1e-6) * layers;
    }
    q.insulation = insulationLabel(asm, spec.studIn);
    if (q.insulation) q.insulationSf = area;
    return q;
}

// Everything for a set of walls: per wall type rows, the material list (with the marked member schedule),
// and walls left out. ctx: { criteria, overrides by wall GUID } (see wallQuantities).
export function takeoff(walls, rules, overrides = {}, settingsOverride = {}, ctxIn = {}) {
    const settings = { ...rules.settings, ...settingsOverride };
    const ctx = { placeholder: rules.placeholder, ...ctxIn };
    const types = new Map();
    const framing = new Map(); // member type (e.g. 362S162-33) -> { kind, depth, member, entries: Map(code|length -> { qty, ids }) }
    const board = new Map(); // board type -> { sf, ids }
    const liner = { sf: 0, panels: 0, ids: new Set() }; // 1" shaftliner of shaft walls
    const insulation = new Map(); // "6\" batt" -> { sf, ids }
    let finishSf = 0, sheathingSf = 0, screwSf = 0, missing = 0, framedWalls = 0, scannedWalls = 0;

    for (const wall of walls) {
        const typeName = wall.wallType ?? 'Not set';
        const asm = assemblyFor(typeName, rules, overrides);
        const q = wallQuantities(wall, asm, settings, ctx);
        if (!types.has(typeName)) {
            types.set(typeName, { typeName, asm, ids: [], count: 0, length: 0, area: 0, studs: 0, studLf: 0, trackLf: 0, openings: 0, linerSf: 0, insulationSf: 0,
                boardSf: 0, finishSf: 0, sheathingSf: 0, missing: 0, board: boardFor(wall, asm) });
        }
        const t = types.get(typeName);
        t.ids.push(wall.dbId);
        t.count++;
        if (q.missing) { t.missing++; missing++; continue; }
        for (const k of ['length', 'area', 'studs', 'studLf', 'trackLf', 'openings', 'boardSf', 'finishSf', 'sheathingSf', 'linerSf', 'insulationSf']) t[k] += q[k] || 0;
        if (asm.scope !== 'framed') continue;
        framedWalls++;
        if (q.scanned) scannedWalls++;
        for (const m of q.members) {
            const kind = m.vertical ? 'stud' : 'track';
            if (!framing.has(m.type)) framing.set(m.type, { kind, depth: q.spec.studIn, member: asm.member, entries: new Map() });
            const entries = framing.get(m.type).entries, key = `${m.code}|${m.lengthIn}`;
            if (!entries.has(key)) entries.set(key, { qty: 0, ids: new Set() });
            entries.get(key).qty += m.qty;
            entries.get(key).ids.add(wall.dbId);
        }
        const boardType = boardFor(wall, asm);
        if (q.boardSf) {
            if (!board.has(boardType)) board.set(boardType, { sf: 0, ids: new Set() });
            board.get(boardType).sf += q.boardSf;
            board.get(boardType).ids.add(wall.dbId);
        }
        if (q.linerSf) { liner.sf += q.linerSf; liner.panels += q.linerPanels; liner.ids.add(wall.dbId); }
        if (q.insulationSf) {
            if (!insulation.has(q.insulation)) insulation.set(q.insulation, { sf: 0, ids: new Set() });
            insulation.get(q.insulation).sf += q.insulationSf;
            insulation.get(q.insulation).ids.add(wall.dbId);
        }
        finishSf += q.finishSf;
        sheathingSf += q.sheathingSf;
        screwSf += q.boardSf + q.sheathingSf;
    }

    const fw = 1 + settings.framingWastePct / 100, bw = 1 + settings.boardWastePct / 100;
    const longestIn = Math.max(...settings.studStockFt) * 12;
    const mode = settings.orderLengths || 'exact';

    // Marks: per role code and stud depth, numbered longest first (gauges of the same depth share one sequence).
    const seq = new Map();
    const sorted = [...framing].sort((a, b) => a[1].depth - b[1].depth || a[1].kind.localeCompare(b[1].kind) || a[0].localeCompare(b[0]));
    const materials = [];
    const schedule = [];
    for (const [type, g] of sorted) {
        const entries = [...g.entries].map(([key, v]) => { const [code, len] = key.split('|'); return { code, cutIn: Number(len), qty: v.qty, ids: [...v.ids] }; })
            .sort((a, b) => CODE_ORDER.indexOf(a.code) - CODE_ORDER.indexOf(b.code) || b.cutIn - a.cutIn);
        const marks = entries.map(e => {
            const k = `${e.code}${depthCode(g.depth)}`;
            seq.set(k, (seq.get(k) || 0) + 1);
            const qty = g.kind === 'stud' ? Math.ceil(e.qty * fw) : e.qty; // stud waste in pieces; track waste on the LF below
            const o = g.kind === 'stud' ? orderLength(e.cutIn, mode, settings.studStockFt) : { orderIn: e.cutIn, perPiece: 1 };
            return { mark: `${k}-${seq.get(k)}`, code: e.code, role: ROLES[e.code], type, cutIn: e.cutIn, qty, lf: (e.cutIn * qty) / 12,
                orderIn: o.orderIn, perPiece: o.perPiece, pieces: Math.ceil(qty / o.perPiece), long: g.kind === 'stud' && e.cutIn > longestIn, ids: e.ids };
        });
        schedule.push(...marks);
        const lf = marks.reduce((n, m) => n + m.lf, 0);
        const roles = [...new Set(marks.map(m => m.code))];
        const ids = [...new Set(marks.flatMap(m => m.ids))]; // every wall with this member type
        if (g.kind === 'stud') {
            // Order summary: pieces per order length (for stock or rounded ordering).
            const order = new Map();
            for (const m of marks) {
                const key = `${m.orderIn}|${m.perPiece}`;
                const e = order.get(key) || { orderIn: m.orderIn, perPiece: m.perPiece, pieces: 0 };
                e.pieces += m.pieces;
                order.set(key, e);
            }
            materials.push({ group: 'Framing', kind: 'stud', type, item: `${fmtInches(g.depth)} ${g.member === 'furring channel' ? 'furring channels' : 'studs'} · ${type}`,
                qty: marks.reduce((n, m) => n + m.qty, 0), unit: 'pcs', extra: `${Math.round(lf).toLocaleString()} LF`, roles, marks,
                order: [...order.values()].sort((a, b) => b.orderIn - a.orderIn), longCount: marks.filter(m => m.long).reduce((n, m) => n + m.qty, 0), ids });
        } else {
            materials.push({ group: 'Framing', kind: 'track', type, item: `${fmtInches(g.depth)} track · ${type}, ${settings.trackStockFt}' stock`,
                qty: Math.ceil((lf * fw) / settings.trackStockFt), unit: 'pcs', extra: `${Math.round(lf * fw).toLocaleString()} LF`, roles, marks, ids });
        }
    }
    for (const type of [...board.keys()].sort()) {
        const sf = board.get(type).sf * bw;
        materials.push({ group: 'Board', item: `${type} gypsum board, ${settings.sheet.label}`, qty: Math.ceil(sf / settings.sheet.sf), unit: 'sheets', extra: `${Math.round(sf).toLocaleString()} SF`, ids: [...board.get(type).ids] });
    }
    if (liner.sf) {
        materials.push({ group: 'Board', item: '1" shaftliner panels, 24" wide, full height (shaft walls)', qty: Math.ceil(liner.panels * bw), unit: 'panels',
            extra: `${Math.round(liner.sf * bw).toLocaleString()} SF`, ids: [...liner.ids] });
    }
    for (const label of [...insulation.keys()].sort()) {
        const e = insulation.get(label);
        materials.push({ group: 'Insulation', item: `${label} insulation`, qty: Math.ceil(e.sf * bw), unit: 'SF', ids: [...e.ids] });
    }
    if (sheathingSf) {
        const sf = sheathingSf * bw;
        materials.push({ group: 'Board', item: `Exterior sheathing, ${settings.sheathingSheet.label}`, qty: Math.ceil(sf / settings.sheathingSheet.sf), unit: 'sheets', extra: `${Math.round(sf).toLocaleString()} SF` });
    }
    if (finishSf) {
        const tape = finishSf * settings.tapeLfPerSf, mud = finishSf * settings.compoundLbPerSf;
        materials.push({ group: 'Finish', item: 'Area to tape and finish', qty: Math.round(finishSf), unit: 'SF' });
        materials.push({ group: 'Finish', item: `Joint tape, ${settings.tapeFtPerRoll}' rolls`, qty: Math.ceil(tape / settings.tapeFtPerRoll), unit: 'rolls', extra: `${Math.round(tape).toLocaleString()} LF` });
        materials.push({ group: 'Finish', item: `Joint compound, ${settings.compoundLbPerBox} lb boxes`, qty: Math.ceil(mud / settings.compoundLbPerBox), unit: 'boxes', extra: `${Math.round(mud).toLocaleString()} lb` });
    }
    if (screwSf) materials.push({ group: 'Finish', item: 'Drywall screws', qty: Math.ceil(screwSf * bw * settings.screwsPerSfPerLayer), unit: 'pcs' });

    const rows = [...types.values()].sort((a, b) => (a.asm.scope !== 'framed') - (b.asm.scope !== 'framed') || b.area - a.area);
    return { settings, rows, materials, schedule, missing, framedWalls, scannedWalls, framedTypes: rows.filter(r => r.asm.scope === 'framed').length };
}
