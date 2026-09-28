// Framing rules for the takeoff (Demo 2): which SSMA members a wall and each of its openings get.
//   Walls: stud, spacing, bottom and top track from the wall's stud depth, finish class (GYP / TILE / SHAFT), gypsum
//     layers and height (the engineer's KEY_WALL sheet).
//   Openings (scanned doors and windows): header, jamb and sill framing from the wall's depth and finish class, the
//     wall height, the height above the opening and the opening width (the KEY_DOOR / KEY_WINDOW sheets).
// Where the framing comes from, first that applies (the takeoff shows it as the "source" of every member):
//   a manual override kept by the wall's GUID (Revit UniqueId: it carries to the next model version);
//   the engineer's criteria loaded from their .xlsx;
//   the SSMA placeholder tables in samples/takeoff-rules.json ("placeholder": typical values, not engineered);
//   else the assembly default (flagged "out of range").
// Pure functions (no Viewer); tests/criteria.test.js checks them.
import { memberType } from '../common/framing.mjs';

export const FINISH_CLASSES = ['GYP', 'TILE', 'SHAFT'];
export const SOURCES = {
    override: 'Manual override',
    criteria: 'Engineer criteria',
    placeholder: 'SSMA placeholder',
    gap: 'SSMA placeholder, not in criteria', // criteria loaded, but no row covers it
    outOfRange: 'Out of range',                // no criteria row and no placeholder row: assembly default, check it
    assembly: 'Assembly default',               // furring and other non-stud assemblies
};

// SSMA designator, e.g. 600S162-33, 362SLT250-43, 250CT-22, (2)600S250-68 (two per location).
// Returns { qty, depthIn, profile, flangeIn, mils, name } or null.
export function parseDesignator(text) {
    const m = /^\s*(?:\((\d+)\)\s*)?(\d{3})\s*([A-Z]{1,3})\s*-?\s*(\d{2,3})?\s*-\s*(\d{2,3})\s*$/i.exec(String(text || '').replace(/\s+WITH[\s\S]*$|\s+OR[\s\S]*$/i, ''));
    if (!m) return null;
    const [, qty, depth, profile, flange, mils] = m;
    const name = `${depth}${profile.toUpperCase()}${flange || ''}-${mils}`;
    return { qty: Number(qty || 1), depthIn: Number(depth) / 100, profile: profile.toUpperCase(), flangeIn: flange ? Number(flange) / 100 : null, mils: Number(mils), name };
}

// A member spec: parts joined by WITH, each the first of its OR alternatives: "(2) 600S162-33 WITH (2) 600T125-33".
// Returns { parts: [{ qty, name }], alt: true when an OR alternative was left out } or null.
export function parseMemberSpec(text) {
    const parts = String(text || '').split(/\bWITH\b/i).map(p => parseDesignator(p.split(/\bOR\b/i)[0])).filter(Boolean);
    return parts.length ? { parts: parts.map(d => ({ qty: d.qty, name: d.name })), alt: /\bOR\b/i.test(String(text)) } : null;
}

// Studs (S, CS, CT) count as studs; tracks (T, SLT, JR, U, ...) as track.
export const isStudProfile = (name) => /^\d{3}(S|CS|CT)\d*-/.test(name || '');

// 14' - 0", 18'-6", 12'-11", 16", 3/4" -> inches (null if unreadable).
export function parseFeetInches(text) {
    const s = String(text || '').replace(/[″”]/g, '"').replace(/[′’]/g, "'").trim();
    const m = /^(?:(\d+(?:\.\d+)?)\s*'\s*-?\s*)?(?:(\d+(?:\.\d+)?)?(?:\s*(\d+)\/(\d+))?\s*"?)?$/.exec(s);
    if (!m || (!m[1] && !m[2] && !m[3])) return null;
    return Number(m[1] || 0) * 12 + Number(m[2] || 0) + (m[3] ? Number(m[3]) / Number(m[4]) : 0);
}

// "0 TO 3'-6"" -> [0, 42]; " 3'-6" TO 6'-6"" -> [42, 78].
function parseBand(text) {
    const m = /^\s*(.*?)\s+TO\s+(.*?)\s*$/i.exec(String(text || ''));
    if (!m) return null;
    const a = parseFeetInches(m[1]), b = parseFeetInches(m[2]);
    return a == null || b == null ? null : [a, b];
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
const groupKey = (s) => norm(s).replace(/[^A-Z0-9]/g, ''); // "1A, 1B, 2, 4A, 4B, & 5" matches "1A, 1B, 2, 4A, 4B & 5"

// The wall criteria rows from a workbook (readXlsx output): the sheet whose header has STUD SIZE and FINISH.
// Returns { rows: [...], sheet, warnings: [...] }.
export function wallCriteria(sheets) {
    for (const sheet of sheets) {
        const h = sheet.rows.findIndex(r => r.some(c => norm(c) === 'STUD SIZE') && r.some(c => norm(c) === 'FINISH'));
        if (h < 0) continue;
        const header = sheet.rows[h].map(norm);
        const col = (...names) => header.findIndex(c => names.some(n => c.startsWith(n)));
        const at = { mark: col('WALL MARK'), finish: col('FINISH'), max: col('SPECIFIC MAX HEIGHT', 'MAX HEIGHT'), spacing: col('SPACING'), stud: col('STUD SIZE'),
            bottom: col('BOTTOM TRACK'), top: col('TOP TRACK'), defl: col('DEFL'), group: col('WALL TYPE'), building: col('BLDG', 'BUILDING') };
        const rows = [], warnings = [];
        for (const r of sheet.rows.slice(h + 1)) {
            const mark = String(r[at.mark] || '').trim();
            if (!mark) continue;
            const stud = parseDesignator(r[at.stud]);
            const maxIn = parseFeetInches(r[at.max]);
            if (!stud || !maxIn) { warnings.push(`${mark}: can't read ${!stud ? `the stud size "${r[at.stud]}"` : `the max height "${r[at.max]}"`}; row skipped`); continue; }
            const band = /_([^_]*?)\s+TO\s+([^_]*?)_/i.exec(mark);
            const layers = /\((\d+)(?:\s*-\s*(\d+))?\s*LAYERS?\)/i.exec(mark);
            rows.push({
                mark, key: `${mark.split(/[-_]/)[0]}-${norm(r[at.finish])}`,
                finish: norm(r[at.finish]), minIn: band ? parseFeetInches(band[1]) ?? 0 : 0, maxIn,
                spacingIn: parseFeetInches(r[at.spacing]) || null, stud, studText: String(r[at.stud]).trim(),
                bottomTrack: parseDesignator(r[at.bottom])?.name || null, topTrack: parseDesignator(r[at.top])?.name || null,
                defl: String(r[at.defl] || '').trim(), group: String(r[at.group] || '').trim(), building: String(r[at.building] || '').trim(),
                layers: layers ? [Number(layers[1]), Number(layers[2] || layers[1])] : null,
            });
        }
        return { sheet: sheet.name, rows, warnings };
    }
    return { sheet: null, rows: [], warnings: ['No sheet with STUD SIZE and FINISH columns (the engineer\'s KEY_WALL sheet).'] };
}

// The door and window opening rows (KEY_DOOR / KEY_WINDOW sheets): mark, max wall height, max height above the
// opening, opening width band, header, jamb and sill framing, wall types. The header row can sit anywhere in the
// sheet (the engineer's door sheet has it half way down); rows above it use the same columns.
// Returns { rows: [...], warnings: [...] }.
export function openingCriteria(sheets) {
    const rows = [], warnings = [];
    for (const sheet of sheets) {
        const h = sheet.rows.findIndex(r => r.some(c => norm(c) === 'HEADER FRAMING') && r.some(c => norm(c) === 'JAMB FRAMING'));
        if (h < 0 && !/DOOR|WINDOW/i.test(sheet.name)) continue;
        const header = h >= 0 ? sheet.rows[h].map(norm) : [];
        const col = (name, fallback) => { const i = header.findIndex(c => c.startsWith(name)); return i >= 0 ? i : fallback; };
        const markCol = header.findIndex(c => /OPENING MARK$/.test(c));
        const at = { mark: markCol >= 0 ? markCol : 0, wall: col('MAX HEIGHT OF WALL', 1), above: col('MAX HEIGHT ABOVE', 2), width: col('MAX OPENING WIDTH', 3),
            head: col('HEADER FRAMING', 4), jamb: col('JAMB FRAMING', 5), sill: col('SILL FRAMING', 6), group: col('WALL TYPE', 7) };
        sheet.rows.forEach((r, i) => {
            if (i === h) return;
            const mark = String(r[at.mark] || '').trim();
            const m = /^(\d{3})[A-Z]*-(DOOR|WINDOW)(?:\/MEP)?\/(GWB|GYP|TILE)(?![A-Z])/i.exec(mark); // "_" follows: no \b
            if (!m) return;
            const width = parseBand(r[at.width]), wallIn = parseFeetInches(r[at.wall]), aboveIn = parseFeetInches(r[at.above]);
            const head = parseMemberSpec(r[at.head]), jamb = parseMemberSpec(r[at.jamb]), sill = parseMemberSpec(r[at.sill]);
            if (!width || !wallIn || !head || !jamb) { warnings.push(`${mark.slice(0, 40)}: can't read the ${!width ? 'width band' : !wallIn ? 'wall height' : !head ? 'header' : 'jamb'}; row skipped`); return; }
            rows.push({ mark, key: mark.split('_')[0], kind: m[2].toLowerCase(), finish: /TILE/i.test(m[3]) ? 'TILE' : 'GYP', depthIn: Number(m[1]) / 100,
                maxWallIn: wallIn, maxAboveIn: aboveIn ?? Infinity, minWidthIn: width[0], maxWidthIn: width[1],
                head: head.parts, jamb: jamb.parts, sill: sill?.parts || null, alt: head.alt || jamb.alt || !!sill?.alt, group: String(r[at.group] || '').trim() });
        });
    }
    return { rows, warnings };
}

// Choices a project makes once: which wall-type group and building of the criteria apply (when it has several).
export function criteriaChoices(rows) {
    const groups = [...new Set(rows.map(r => r.group).filter(Boolean))];
    const buildings = [...new Set(rows.flatMap(r => r.building.toUpperCase().replace(/\bONLY\b/g, '').split(/,|&/).map(s => s.trim()).filter(Boolean)))];
    return { groups, buildings };
}

// The criteria row for one wall, or null (no band fits).
export function pickCriteria(rows, { depthIn, finishClass, layers, heightIn, group = '', building = '' }) {
    const fits = rows.filter(r => Math.abs(r.stud.depthIn - depthIn) < 0.02 && r.finish === finishClass
        && (!group || !r.group || groupKey(r.group) === groupKey(group))
        && (!building || !r.building || /^ALL$/i.test(r.building) || r.building.toUpperCase().includes(building.toUpperCase()))
        && (!r.layers || layers == null || (layers >= r.layers[0] && layers <= r.layers[1])));
    return fits.sort((a, b) => a.maxIn - b.maxIn).find(r => heightIn <= r.maxIn + 0.5) || null;
}

// The criteria row for one opening, or null: its kind, the wall's depth and finish, the wall height, the height
// above the opening and its width. The engineer's wall-type group names are matched loosely (punctuation aside).
export function pickOpening(rows, { kind, depthIn, finishClass, wallHeightIn, aboveIn, widthIn, group = '' }) {
    const g = groupKey(group).replace(/^FOR/, '');
    return rows.filter(r => r.kind === kind && Math.abs(r.depthIn - depthIn) < 0.02 && r.finish === finishClass
        && (!g || !r.group || groupKey(r.group).replace(/^FOR/, '') === g)
        && widthIn > r.minWidthIn - 0.5 && widthIn <= r.maxWidthIn + 0.5
        && wallHeightIn <= r.maxWallIn + 0.5 && aboveIn <= r.maxAboveIn + 0.5)
        .sort((a, b) => a.maxWallIn - b.maxWallIn || a.maxAboveIn - b.maxAboveIn)[0] || null;
}

// Wall system: a shaft wall (C-H studs in J track, with a 1" shaftliner panel) or a standard framed wall (or
// furring), and why. First that applies: a finish class set by hand (manual override, or the Assemblies tab / a
// rule: SHAFT = shaft wall); a 1" liner (shaftliner) in the wall's materials (wall.materials: the Revit structural
// material, or every layer's material when the model or a Revit export carries them); the type name (shaft, liner);
// else a standard framed wall (TILE when the type name says tile). Returns { system, why, finishClass }.
export const SYSTEMS = { shaft: 'Shaft wall', framed: 'Framed wall', furring: 'Furring' };
const LINER = /shaft\s*liner|\b1(?:"|\s*in(?:ch)?)?\s*(?:gyp(?:sum)?\s*)?liner|liner\s*panel|core\s*board/i;
export function wallSystem(wall, asm = {}, override = null) {
    const set = override?.finishClass ? ['set by hand', override.finishClass] : asm.finishClass ? ['set in Assemblies', asm.finishClass] : null;
    if (asm.member === 'furring channel') return { system: SYSTEMS.furring, why: 'furring assembly', finishClass: set?.[1] || 'GYP' };
    if (set) return { system: set[1] === 'SHAFT' ? SYSTEMS.shaft : SYSTEMS.framed, why: set[0], finishClass: set[1] };
    const liner = (wall.materials || []).find(m => LINER.test(m || ''));
    if (liner) return { system: SYSTEMS.shaft, why: `1" liner in the materials (${liner})`, finishClass: 'SHAFT' };
    if (/shaft|liner/i.test(wall.wallType || '')) return { system: SYSTEMS.shaft, why: 'type name says shaft', finishClass: 'SHAFT' };
    const tile = /tile/i.test(wall.wallType || '');
    return { system: SYSTEMS.framed, why: tile ? 'type name says tile' : 'standard (no shaft name or liner)', finishClass: tile ? 'TILE' : 'GYP' };
}

// "SHAFT", "TILE" or "GYP" for a wall type name alone (the Assemblies tab default).
export function finishClassOf(typeName, materials = []) {
    return wallSystem({ wallType: typeName, materials }).finishClass;
}

const depthCode = (depthIn) => String(Math.floor(depthIn * 100 + 1e-6)).padStart(3, '0');

// The framing of one wall: { studIn, flangeIn, mils, spacingIn, rows, studName, trackName, topTrackName, source,
// key, finishClass, heightIn }.
//   asm: its assembly (calc.mjs assemblyFor); settings: the takeoff settings (gauge, spacing);
//   opts: { criteria: { rows, group, building } | null, override: { stud, spacingIn, finishClass } kept by the wall's
//   GUID, placeholder: rules.placeholder }.
//   heightIn: the height being framed (calc.mjs: floor to floor for a wall counted on its base level only).
// Also { system, systemWhy }: shaft wall, framed wall or furring, and why (wallSystem).
export function resolveFraming(wall, asm, settings, { criteria = null, override = null, placeholder = null, heightIn: framedIn = null } = {}) {
    const heightIn = framedIn || wall.scan?.heightIn || (wall.heightFt > 0 ? wall.heightFt * 12 : (wall.area / wall.length) * 12);
    const sys = wallSystem(wall, asm, override);
    const finishClass = sys.finishClass;
    const base = { studIn: asm.studIn, flangeIn: 1.625, mils: asm.mils || settings.mils, spacingIn: asm.spacingIn || settings.studSpacingIn,
        rows: asm.rows || 1, finishClass, heightIn, key: '', system: sys.system, systemWhy: sys.why };
    const named = (spec) => ({ ...spec, studName: spec.studName || memberType(spec.studIn, 'stud', spec.mils, asm.member),
        trackName: spec.trackName || memberType(spec.studIn, 'track', spec.mils, asm.member) });
    const fromStud = (d, extra) => named({ ...base, studIn: d.depthIn, flangeIn: d.flangeIn || base.flangeIn, mils: d.mils, rows: base.rows * d.qty, studName: d.name, ...extra });
    const manual = parseDesignator(override?.stud);
    if (manual || override?.spacingIn) {
        const d = manual || { depthIn: base.studIn, flangeIn: base.flangeIn, mils: base.mils, qty: 1, name: null };
        return fromStud(d, { spacingIn: override.spacingIn || base.spacingIn, source: SOURCES.override });
    }
    if (asm.member === 'furring channel') return named({ ...base, source: SOURCES.assembly });
    const layers = Math.max(...(asm.layers || [0]));
    if (criteria?.rows?.length) {
        const row = pickCriteria(criteria.rows, { depthIn: asm.studIn, finishClass, layers, heightIn, group: criteria.group, building: criteria.building });
        if (row) return fromStud(row.stud, { spacingIn: row.spacingIn || base.spacingIn, trackName: row.bottomTrack, topTrackName: row.topTrack, source: SOURCES.criteria, key: row.key });
    }
    const ph = placeholderStud(placeholder, asm.studIn, finishClass, heightIn);
    if (ph) return fromStud(ph.stud, { trackName: ph.track || null, topTrackName: ph.track || null, source: criteria?.rows?.length ? SOURCES.gap : SOURCES.placeholder, key: 'placeholder' });
    return named({ ...base, source: SOURCES.outOfRange });
}

// The placeholder stud for a depth and height: { stud: designator, track } or null. Shaft walls take the shaft rows
// (C-H studs, J track) when there is one for their depth, else the standard rows.
function placeholderStud(placeholder, depthIn, finishClass, heightIn) {
    const pick = (rows, need) => (rows || []).filter(r => Math.abs(r.depthIn - depthIn) < 0.02).sort((a, b) => a.maxHeightFt - b.maxHeightFt)
        .find(r => need <= r.maxHeightFt * 12 + 0.5);
    const shaft = finishClass === 'SHAFT' ? pick(placeholder?.shaftWalls, heightIn) : null;
    if (shaft) return { stud: parseDesignator(shaft.stud), track: parseDesignator(shaft.track)?.name };
    const row = pick(placeholder?.walls, heightIn * (finishClass === 'TILE' ? placeholder.tileHeightFactor || 1 : 1));
    return row ? { stud: parseDesignator(row.stud) } : null;
}

// The framing of one opening: { head, jamb, sill: [{ qty, name }] | null, source, key, alt }.
//   o: { left, right, bottom, top } in inches (a door reaches the floor); spec: the wall's resolveFraming result.
export function resolveOpening(o, spec, { criteria = null, placeholder = null } = {}) {
    const kind = o.bottom <= 1 ? 'door' : 'window';
    const widthIn = o.right - o.left, aboveIn = Math.max(0, spec.heightIn - o.top);
    if (spec.source === SOURCES.override || spec.source === SOURCES.assembly || !(spec.studName && isStudProfile(spec.studName))) {
        return null; // hand-set or furring walls: the opening takes the wall's own stud and track
    }
    if (criteria?.openings?.length) {
        const row = pickOpening(criteria.openings, { kind, depthIn: spec.studIn, finishClass: spec.finishClass, wallHeightIn: spec.heightIn, aboveIn, widthIn, group: criteria.group });
        if (row) return { head: row.head, jamb: row.jamb, sill: kind === 'window' ? row.sill : null, source: SOURCES.criteria, key: row.key, alt: row.alt };
    }
    const rules = placeholder?.openings || [];
    const ph = [...rules].sort((a, b) => a.maxWidthFt - b.maxWidthFt).find(r => widthIn <= r.maxWidthFt * 12 + 0.5) || rules[rules.length - 1];
    if (!ph) return null;
    const d = depthCode(spec.studIn);
    const spec2 = (t) => (t ? parseMemberSpec(t.replace(/\{D\}/g, d))?.parts || null : null);
    const wide = widthIn > ph.maxWidthFt * 12 + 0.5;
    return { head: spec2(ph.header), jamb: spec2(ph.jamb), sill: kind === 'window' ? spec2(ph.sill) : null,
        source: wide ? SOURCES.outOfRange : criteria?.openings?.length ? SOURCES.gap : SOURCES.placeholder, key: 'placeholder', alt: false };
}
