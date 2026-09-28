// Engineer's framing criteria for the takeoff (Demo 2): which SSMA stud, track and spacing a wall gets from its stud
// depth, finish class (GYP / TILE / SHAFT), gypsum layers and height, as in the engineer's criteria workbook
// (KEY_WALL sheet: WALL MARK, FINISH, SPECIFIC MAX HEIGHT, SPACING (O.C.), STUD SIZE, BOTTOM TRACK, TOP TRACK, ...).
// Per wall, the framing comes from (first that applies): a manual override kept by the element's GUID (Revit
// UniqueId, so it carries to the next model version), the criteria row for its band, or the assembly default.
// Pure functions (no Viewer); tests/takeoff.test.js checks them.
import { memberType } from '../common/framing.mjs';

export const FINISH_CLASSES = ['GYP', 'TILE', 'SHAFT'];
export const SOURCES = { override: 'Manual override', criteria: 'Criteria', assembly: 'Assembly default', outOfBand: 'Out of criteria band' };

// SSMA designator, e.g. 600S162-33, 362SLT250-43, 250CT-22, (2)600S250-68 (two per location).
// Returns { qty, depthIn, profile, flangeIn, mils, name } or null.
export function parseDesignator(text) {
    const m = /^\s*(?:\((\d+)\)\s*)?(\d{3})\s*([A-Z]{1,3})\s*-?\s*(\d{2,3})?\s*-\s*(\d{2,3})\s*$/i.exec(String(text || '').replace(/\s+WITH[\s\S]*$|\s+OR[\s\S]*$/i, ''));
    if (!m) return null;
    const [, qty, depth, profile, flange, mils] = m;
    const name = `${depth}${profile.toUpperCase()}${flange || ''}-${mils}`;
    return { qty: Number(qty || 1), depthIn: Number(depth) / 100, profile: profile.toUpperCase(), flangeIn: flange ? Number(flange) / 100 : null, mils: Number(mils), name };
}

// 14' - 0", 18'-6", 12'-11", 16", 3/4" -> inches (null if unreadable).
export function parseFeetInches(text) {
    const s = String(text || '').replace(/[″”]/g, '"').replace(/[′’]/g, "'").trim();
    const m = /^(?:(\d+(?:\.\d+)?)\s*'\s*-?\s*)?(?:(\d+(?:\.\d+)?)?(?:\s*(\d+)\/(\d+))?\s*"?)?$/.exec(s);
    if (!m || (!m[1] && !m[2] && !m[3])) return null;
    return Number(m[1] || 0) * 12 + Number(m[2] || 0) + (m[3] ? Number(m[3]) / Number(m[4]) : 0);
}

// The wall criteria rows from a workbook (readXlsx output): the sheet whose header has STUD SIZE and FINISH.
// Returns { rows: [...], sheet, warnings: [...] }.
export function wallCriteria(sheets) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
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
                mark, key: `${mark.split(/[-_]/)[0]}-${String(r[at.finish] || '').trim().toUpperCase()}`,
                finish: String(r[at.finish] || '').trim().toUpperCase(), minIn: band ? parseFeetInches(band[1]) ?? 0 : 0, maxIn,
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

// Choices a project makes once: which wall-type group and building of the criteria apply (when it has several).
export function criteriaChoices(rows) {
    const groups = [...new Set(rows.map(r => r.group).filter(Boolean))];
    const buildings = [...new Set(rows.flatMap(r => r.building.toUpperCase().replace(/\bONLY\b/g, '').split(/,|&/).map(s => s.trim()).filter(Boolean)))];
    return { groups, buildings };
}

// The criteria row for one wall, or null (no band fits: out of the criteria).
export function pickCriteria(rows, { depthIn, finishClass, layers, heightIn, group = '', building = '' }) {
    const fits = rows.filter(r => Math.abs(r.stud.depthIn - depthIn) < 0.02 && r.finish === finishClass
        && (!group || !r.group || r.group === group)
        && (!building || !r.building || /^ALL$/i.test(r.building) || r.building.toUpperCase().includes(building.toUpperCase()))
        && (!r.layers || layers == null || (layers >= r.layers[0] && layers <= r.layers[1])));
    return fits.sort((a, b) => a.maxIn - b.maxIn).find(r => heightIn <= r.maxIn + 0.5) || null;
}

// "SHAFT" for shaft walls, "TILE" when the type says tile, else "GYP" (the Assemblies tab or an override can change it).
export function finishClassOf(typeName) {
    return /shaft/i.test(typeName || '') ? 'SHAFT' : /tile/i.test(typeName || '') ? 'TILE' : 'GYP';
}

// The framing of one wall: { studIn, flangeIn, mils, spacingIn, rows, studName, trackName, topTrackName, source,
// key, finishClass, heightIn }.
//   asm: its assembly (calc.mjs assemblyFor); settings: the takeoff settings (gauge, spacing);
//   criteria: { rows, group, building } or null; override: { stud, spacingIn, finishClass } kept by the wall's GUID.
export function resolveFraming(wall, asm, settings, criteria = null, override = null) {
    const heightIn = wall.scan?.heightIn || (wall.heightFt > 0 ? wall.heightFt * 12 : (wall.area / wall.length) * 12);
    const finishClass = override?.finishClass || asm.finishClass || finishClassOf(wall.wallType);
    const base = { studIn: asm.studIn, flangeIn: 1.625, mils: asm.mils || settings.mils, spacingIn: asm.spacingIn || settings.studSpacingIn,
        rows: asm.rows || 1, finishClass, heightIn, key: '' };
    const named = (spec) => ({ ...spec, studName: spec.studName || memberType(spec.studIn, 'stud', spec.mils, asm.member),
        trackName: spec.trackName || memberType(spec.studIn, 'track', spec.mils, asm.member) });
    const manual = parseDesignator(override?.stud);
    if (manual || override?.spacingIn) {
        const d = manual || { depthIn: base.studIn, flangeIn: base.flangeIn, mils: base.mils, qty: 1, name: null };
        return named({ ...base, studIn: d.depthIn, flangeIn: d.flangeIn || base.flangeIn, mils: d.mils, rows: base.rows * d.qty,
            spacingIn: override.spacingIn || base.spacingIn, studName: d.name, source: SOURCES.override });
    }
    if (criteria?.rows?.length && asm.member !== 'furring channel') {
        const row = pickCriteria(criteria.rows, { depthIn: asm.studIn, finishClass, layers: Math.max(...(asm.layers || [0])), heightIn, group: criteria.group, building: criteria.building });
        if (row) {
            return named({ ...base, studIn: row.stud.depthIn, flangeIn: row.stud.flangeIn || base.flangeIn, mils: row.stud.mils, rows: base.rows * row.stud.qty,
                spacingIn: row.spacingIn || base.spacingIn, studName: row.stud.name, trackName: row.bottomTrack, topTrackName: row.topTrack,
                source: SOURCES.criteria, key: row.key });
        }
        return named({ ...base, source: SOURCES.outOfBand });
    }
    return named({ ...base, source: SOURCES.assembly });
}
