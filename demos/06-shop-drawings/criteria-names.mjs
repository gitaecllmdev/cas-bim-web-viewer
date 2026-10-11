// Engineering criteria text: lengths, member specifications, the fields an authored mark carries, and the compact
// dropdown labels, as the native code reads and writes them (CAS_BIM_Tools.Core EnggMap/Takeoff: ImperialLengthParser,
// MemberSpecParser, CfsDesignatorParser, CriteriaStyleKeyName). Pure and synchronous.
//
// Four things stay apart (docs/criteria-naming-guide.md):
//   1. the source: the mark and every cell exactly as authored (line breaks, spacing and spelling kept);
//   2. what was read from it: conditions and values with their units, each with its original text and a state
//      (value, zero, blank, not-applicable, varies, to-be-determined, ignore, unreadable: never one for another);
//   3. presentation: the display code, the compact dropdown label and any template alias: shown, never identity;
//   4. identity: a GUID and row revision from the workbook's metadata columns, or none (never derived from a name,
//      a label or a row's position).

import { formatDimension } from '../common/dimensions.mjs';

// --- Lengths (ImperialLengthParser) ------------------------------------------------------------------------------------
const FEET_INCHES = /^\s*(-)?\s*(?:(\d+(?:\.\d+)?)\s*')?\s*(?:-?\s*(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*")?\s*$/;
const unifyQuotes = (s) => String(s).trim().replace(/[’′]/g, "'").replace(/[“”″]/g, '"');
const mixed = (s) => {
    const parts = s.trim().split(/\s+/), frac = (t) => { const [n, d] = t.split('/').map(Number); return t.split('/').length === 2 && Number.isFinite(n) && Number.isFinite(d) && Math.abs(d) > Number.EPSILON && n / d >= 0 ? n / d : null; };
    if (parts.length === 2) { const w = Number(parts[0]), f = frac(parts[1]); return Number.isFinite(w) && f != null ? w + f : null; }
    if (parts.length === 1 && parts[0].includes('/')) return frac(parts[0]);
    return parts.length === 1 && /^\d+(?:\.\d+)?$/.test(parts[0]) ? Number(parts[0]) : null;
};
// "14' - 0"", "14'-0"", "3/4"", "6 1/2"", "18'", "14" (a bare number is feet, as the workbook instructions say) -> feet.
export function parseFeet(value) {
    if (value == null || !String(value).trim()) return null;
    const text = unifyQuotes(value);
    if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(text)) return Number(text);
    const m = FEET_INCHES.exec(text);
    if (!m || (m[2] == null && m[3] == null)) return null;
    const ft = m[2] != null ? Number(m[2]) : 0, inches = m[3] != null ? mixed(m[3]) : 0;
    if (!Number.isFinite(ft) || inches == null) return null;
    return (m[1] ? -1 : 1) * (ft + inches / 12);
}
// "0 TO 14'-0"" -> { minimumFeet, maximumFeet } (exactly two lengths around TO).
export function parseRange(value) {
    if (value == null || !String(value).trim()) return null;
    const parts = String(value).trim().split(/\s+TO\s+/i);
    if (parts.length !== 2) return null;
    const a = parseFeet(parts[0]), b = parseFeet(parts[1]);
    return a == null || b == null ? null : { minimumFeet: a, maximumFeet: b };
}
// A stud spacing: a length ("16"", "1.333"), or one followed by a note ("16" O.C.", "16" - see note"): its inches.
const ANNOTATED_SPACING = /^\s*((?:\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*["”″])(?=\s|[-–—,;/])/;
export function parseSpacingFeet(value) {
    const plain = parseFeet(value);
    if (plain != null) return plain;
    const m = ANNOTATED_SPACING.exec(String(value ?? ''));
    return m ? parseFeet(m[1]) : null;
}

// --- Display: nearest 1/8", display only, never a stored value -------------------------------------------------
export const formatLength = (feet) => formatDimension(Math.max(0, feet) * 12, { feet: true, leadingZero: true });
export const formatInches = (feet) => formatDimension(Math.max(0, feet) * 12, { leadingZero: true });

// --- States: blank, zero, not applicable, varies, TBD and IGNORE are different answers ------------------------------
const NOT_APPLICABLE = new Set(['-', 'NA', 'N/A', 'NONE', 'NOT APPLICABLE']);
export function textState(value) {
    const t = String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
    if (!t) return 'blank';
    if (NOT_APPLICABLE.has(t)) return 'not-applicable';
    if (t === 'VARIES') return 'varies';
    if (t === 'TBD') return 'to-be-determined';
    if (t === 'IGNORE') return 'ignore';
    return 'value';
}
// A length cell: { text, state, feet } (zero is its own state: a declared 0 is not a blank).
export function readLength(text, parse = parseFeet) {
    const state = textState(text);
    if (state !== 'value') return { text: String(text ?? ''), state, feet: null };
    const feet = parse(text);
    return feet == null ? { text: String(text), state: 'unreadable', feet: null } : { text: String(text), state: feet === 0 ? 'zero' : 'value', feet };
}

// --- Members (CfsDesignatorParser, MemberSpecParser) --------------------------------------------------------------------
const KNOWN_PROFILES = new Set(['S', 'T', 'U', 'F', 'CT', 'JR', 'X', 'XT', 'XTC', 'HD']);
export function parseDesignator(value) {
    if (value == null || !String(value).trim()) return { error: 'A CFS designator is required.' };
    const input = String(value).trim();
    let n = input.toUpperCase().replace(/["“”]/g, '').replace(/\s+/g, '');
    n = n.replace(/(SLT|CT|JR|S|T)-(\d{2,4})-/i, '$1$2-');
    const m = /^(\d{3,4})([A-Z]+)(\d{2,4})?-?(\d{2,3})([A-Z]+)?$/i.exec(n);
    if (!m) return { error: `'${input}' is not a supported CFS designator.` };
    const profile = m[2].toUpperCase(), flange = m[3] || '';
    if (['S', 'T', 'SLT'].includes(profile) && !flange) return { error: `'${input}' is missing its flange or leg code.` };
    const mils = Number(m[4]);
    if (!(mils > 0)) return { error: `'${input}' has an invalid material thickness.` };
    const suffix = (m[5] || '').toUpperCase();
    return { normalized: `${m[1]}${profile}${flange}-${mils}${suffix}`, depthCode: m[1], profile, flangeCode: flange, mils, suffix, known: KNOWN_PROFILES.has(profile) };
}
// Alternatives (OR: one of them, never all at once) of combined items (WITH, +, comma: placed together, their
// arrangement not given here). -> { sentinel } | { alternatives: [[{ qty, designator }]] } | { error }.
export function parseMemberSpec(value) {
    if (value == null || !String(value).trim()) return { error: 'A member specification is required.' };
    let s = String(value).replace(/[\r\n]/g, ' ').trim().replace(/\s+/g, ' ');
    const sentinel = { IGNORE: 'ignore', NA: 'not-applicable', TBD: 'to-be-determined' }[s.toUpperCase()];
    if (sentinel) return { sentinel };
    s = s.replace(/\s*\(\s*(?:33|50)\s*KSI\s*\)\s*$/i, '').trim();
    const alternatives = [];
    for (const alt of s.split(/\s+OR\s+/i)) {
        const items = [];
        for (const raw of alt.split(/\s+(?:WITH)\s+|\s*[+,]\s*/i).filter(p => p.trim())) {
            let text = raw.trim(), qty = 1;
            const q = /^\s*\(\s*(\d+)\s*\)\s*(.+)$/.exec(text);
            if (q) { qty = Number(q[1]); if (!(qty > 0)) return { error: `'${raw}' has an invalid quantity.` }; text = q[2]; }
            const d = parseDesignator(text);
            if (d.error) return { error: d.error };
            items.push({ qty, designator: d });
        }
        if (!items.length) return { error: `'${alt}' contains no member designator.` };
        alternatives.push(items);
    }
    return { alternatives };
}
// The native canonical text: "(2) 362S162-33 + (2) 362T125-33", alternatives joined by " OR ".
export const canonicalSpec = (spec) => (spec?.alternatives ? spec.alternatives.map(items => items.map(i => (i.qty === 1 ? i.designator.normalized : `(${i.qty}) ${i.designator.normalized}`)).join(' + ')).join(' OR ') : '');
// A member cell: { text (as authored, line breaks kept), state, spec, canonical, combined, alternatives, error }.
export function readMember(text) {
    const state = textState(text);
    if (state !== 'value') return { text: String(text ?? ''), state, spec: null, canonical: '', combined: false, alternatives: 0 };
    const spec = parseMemberSpec(text);
    if (spec.error) return { text: String(text), state: 'unreadable', spec: null, canonical: '', combined: false, alternatives: 0, error: spec.error };
    if (spec.sentinel) return { text: String(text), state: spec.sentinel, spec: null, canonical: '', combined: false, alternatives: 0 };
    return { text: String(text), state: 'value', spec, canonical: canonicalSpec(spec), combined: spec.alternatives.some(a => a.length > 1 || a[0].qty > 1), alternatives: spec.alternatives.length };
}
// Same member text, as read (WITH and + alike, line breaks and spacing aside, designators normalized).
export const sameMember = (a, b) => a.state === b.state && (a.state !== 'value' ? true : a.canonical === b.canonical);

// --- Marks: the fields an authored source name carries, position by position ------------------------------------------
// Wall: CODE-TYPE_FINISH_BAND_STUD@SPACING_EXTRA…   e.g. 301-FH_GYP(1-2 LAYERS)_0 TO 14'-0"_362S162-33@16"_ALL
// Each field keeps its text; a token that is not what its position holds is listed (unread), not guessed into another.
export function parseWallMark(mark) {
    const text = String(mark ?? ''), tokens = text.split('_'), head = /^\s*([A-Za-z0-9]+)(?:\s*-\s*(.*))?$/.exec(tokens[0] || '');
    const out = { text, code: head?.[1] ?? '', typeToken: (head?.[2] ?? '').trim(), finishCondition: (tokens[1] ?? '').trim(), heightBand: null, stud: null, extra: [], unread: [] };
    if (!head) out.unread.push({ position: 1, text: tokens[0] ?? '', expected: 'code-type' });
    const band = tokens[2] != null ? parseRange(tokens[2]) : null;
    if (band) out.heightBand = { text: tokens[2], ...band }; else if (tokens[2] != null) out.unread.push({ position: 3, text: tokens[2], expected: 'height band (A TO B)' });
    const sa = tokens[3] != null ? /^\s*([^@]+?)\s*@\s*(.+?)\s*$/.exec(tokens[3]) : null, member = sa ? readMember(sa[1]) : null, spacing = sa ? parseSpacingFeet(sa[2]) : null;
    if (sa && member.state === 'value' && spacing != null) out.stud = { text: tokens[3], member, spacingText: sa[2], spacingFeet: spacing };
    else if (tokens[3] != null) out.unread.push({ position: 4, text: tokens[3], expected: 'stud@spacing' });
    out.extra = tokens.slice(4).map(t => t.trim()).filter(Boolean);
    return out;
}
// Opening: CODE-CATEGORY[/CATEGORY…]/FINISH_WIDTH BAND_WALL HEIGHT_ABOVE OPENING_H-…_J-…_S-…
//   e.g. 362A-DOOR/GWB_0 TO 3'-6"_14'-0"_6'-0"_H-362T250-54_J-362S162-54_S-362T150-54
export function parseOpeningMark(mark) {
    const text = String(mark ?? ''), tokens = text.split('_'), head = /^\s*([A-Za-z0-9]+)\s*-\s*(.+)$/.exec(tokens[0] || '');
    const slash = head ? head[2].split('/').map(t => t.trim()) : [];
    const out = { text, code: head?.[1] ?? '', categories: slash.slice(0, -1), finish: slash.length > 1 ? slash[slash.length - 1] : '', widthBand: null, wallHeight: null, aboveOpening: null, header: null, jamb: null, sill: null, extra: [], unread: [] };
    if (!head) out.unread.push({ position: 1, text: tokens[0] ?? '', expected: 'code-category/finish' });
    else if (slash.length === 1) { out.categories = slash; out.finish = ''; }
    const band = tokens[1] != null ? parseRange(tokens[1]) : null;
    if (band) out.widthBand = { text: tokens[1], ...band }; else if (tokens[1] != null) out.unread.push({ position: 2, text: tokens[1], expected: 'width band (A TO B)' });
    for (const [i, key, label] of [[2, 'wallHeight', 'wall height limit'], [3, 'aboveOpening', 'height above opening limit']]) {
        if (tokens[i] == null) continue;
        const v = readLength(tokens[i]);
        if (v.feet != null) out[key] = v; else out.unread.push({ position: i + 1, text: tokens[i], expected: label });
    }
    let i = 4;
    for (const [prefix, key] of [['H', 'header'], ['J', 'jamb'], ['S', 'sill']]) {
        const t = tokens[i], m = t != null ? new RegExp(`^\\s*${prefix}\\s*-\\s*([\\s\\S]+)$`, 'i').exec(t) : null;
        if (m) { out[key] = { text: t, member: readMember(m[1]) }; i++; }
        else if (t != null && !/^\s*[HJS]\s*-/i.test(t)) { out.unread.push({ position: i + 1, text: t, expected: `${prefix}-member` }); i++; }
    }
    out.extra = tokens.slice(i).map(t => t.trim()).filter(Boolean);
    return out;
}

// --- Compact labels (presentation only: never identity, never matched on) ---------------------------------------------
// Wall: 601 | H 16'-0" | 600S162-33@24"       Opening: 601-D01 | W 0'-0" TO 3'-6" | A 6'-0" | HDR … | JMB … | SIL …
const memberLabel = (m) => (m && m.state === 'value' ? m.canonical : m && m.state !== 'blank' ? String(m.text).replace(/\s+/g, ' ').trim().toUpperCase() : 'N/A');
const join = (...parts) => parts.filter(p => p && String(p).trim()).join(' | ');
export function wallLabel({ code, maximumHeightFeet, stud, spacingFeet }) {
    return join(code, maximumHeightFeet != null ? `H ${formatLength(maximumHeightFeet)}` : '', `${memberLabel(stud)}@${spacingFeet != null ? formatInches(spacingFeet) : '?'}`);
}
export function openingLabel({ code, minimumWidthFeet, maximumWidthFeet, aboveOpeningFeet, header, jamb, sill }) {
    return join(code, minimumWidthFeet != null && maximumWidthFeet != null ? `W ${formatLength(minimumWidthFeet)} TO ${formatLength(maximumWidthFeet)}` : '',
        aboveOpeningFeet != null ? `A ${formatLength(aboveOpeningFeet)}` : '', `HDR ${memberLabel(header)}`, `JMB ${memberLabel(jamb)}`, `SIL ${memberLabel(sill)}`);
}

// --- Bands (CriteriaBandResolver.IsWithin): a band holds (minimum, maximum], or [0, maximum] when its minimum is zero.
// Two bands share a value when the larger minimum is below the smaller maximum: 0 TO 14'-0" and 14'-0" TO 18'-6" touch
// at 14'-0" (it belongs to the first only) and do not overlap.
export const bandsOverlap = (a, b, tolerance = 1e-8) => Math.max(a.minimumFeet, b.minimumFeet) + tolerance < Math.min(a.maximumFeet, b.maximumFeet);
