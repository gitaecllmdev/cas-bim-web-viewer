// Opening profiles: named opening types kept with the set (set.openingProfiles), e.g. "Single-Flush : 36" x 84"" or
// "MECH 24x16". A profile is the opening's kind, its first size (a new opening's default: each opening may vary its
// width and height) and its framing (the framing offset, or offsets by side, jambs, header, sill, their arrangements,
// jack studs, end cripples, the engineering style). An opening that uses one carries its name (opening.profile) and
// takes its framing; a profile named like a Revit family : type links the model's openings of that type. Pure.
import { FRAMING_FIELDS, framingOf, withFraming, openingContexts, typeKeyOf, typeNameOf, hasFraming } from './opening-context.mjs';
import { kindOf, OPENING_TYPES } from './generator.mjs';
import { fmtFtIn } from '../common/framing.mjs';

const str = (v, n = 120) => String(v ?? '').trim().slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object'
    ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));

// Kept as they came when they look like profiles: a name (unique), a kind, a size; the framing fields only.
export function cleanProfiles(raw) {
    if (!Array.isArray(raw)) return null;
    const seen = new Set(), out = [];
    for (const p of raw) {
        const name = str(p?.name), kind = OPENING_TYPES[p?.kind] ? p.kind : null;
        if (!name || !kind || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        const framing = Object.fromEntries(FRAMING_FIELDS.filter(k => p.framing?.[k] != null && p.framing[k] !== '').map(k => [k, structuredClone(p.framing[k])]));
        out.push({ name, kind, ...(num(p.widthIn) ? { widthIn: num(p.widthIn) } : {}), ...(kind !== 'steel' && num(p.heightIn) ? { heightIn: num(p.heightIn) } : {}),
            ...(kind !== 'door' && num(p.sillIn) != null ? { sillIn: num(p.sillIn) } : {}), framing });
    }
    return out.length ? out : null;
}
// A profile from an opening: its kind, its size (the default for new ones), its framing.
export function profileFrom(o, name) {
    const kind = kindOf(o);
    return { name: str(name), kind, widthIn: Number(o.widthIn), ...(kind !== 'steel' ? { heightIn: Number(o.heightIn) } : {}), ...(kind !== 'door' ? { sillIn: Number(o.sillIn) } : {}), framing: framingOf(o) };
}
// A name to offer: the model element's family : type when it has one, else the kind and size.
export function suggestName(panel, i) {
    const o = panel.openings[i], c = openingContexts(panel)[i], typeName = typeNameOf(typeKeyOf(c));
    if (typeName) return typeName;
    const t = OPENING_TYPES[kindOf(o)].name;
    return kindOf(o) === 'steel' ? `${t} ${fmtFtIn(o.widthIn)} wide` : `${t} ${fmtFtIn(o.widthIn)} x ${fmtFtIn(o.heightIn)}`;
}
// A new opening from a profile: its kind, its size (the profile's first one), its framing; placed by the caller.
export function openingFromProfile(prof, place = {}) {
    const size = OPENING_TYPES[prof.kind].size;
    return { kind: prof.kind, widthIn: prof.widthIn ?? size.widthIn, heightIn: prof.kind === 'steel' ? 0 : prof.heightIn ?? size.heightIn,
        sillIn: prof.kind === 'door' ? 0 : prof.sillIn ?? size.sillIn ?? 0, head: '', jamb: '', sill: '', ...structuredClone(prof.framing || {}), profile: prof.name, ...place };
}
export const findProfile = (profiles, name) => (profiles || []).find(p => p.name === name) || null;
// Whether an opening's framing is its profile's (the size never counts: it may vary).
export const differs = (o, prof) => canon(framingOf(o)) !== canon(prof.framing || {});
// An opening given a profile: its framing, its name; its place and size kept. null when the kinds differ.
export function assign(o, prof) {
    if (kindOf(o) !== prof.kind) return null;
    return { ...withFraming(o, prof.framing || {}), profile: prof.name };
}
// The profile's framing given to every opening that uses it: -> { panels, changed: [{ panelId, mark, index }] }.
export function propagate(panels, prof) {
    const changed = [];
    const out = panels.map(p => {
        let touched = false;
        const openings = p.openings.map((o, i) => {
            if (o.profile !== prof.name || kindOf(o) !== prof.kind || !differs(o, prof)) return o;
            touched = true; changed.push({ panelId: p.id, mark: p.mark, index: i });
            return assign(o, prof);
        });
        return touched ? { ...p, openings } : p;
    });
    return { panels: out, changed };
}
// The model's openings whose Revit family : type is the profile's name (and its kind) take it; only: 'unset' leaves
// those with framing chosen and those with another profile. -> { panels, linked: [{ panelId, mark, index }] }
export function linkByRevitName(panels, prof, { only = null } = {}) {
    const linked = [];
    const out = panels.map(p => {
        const ctx = openingContexts(p);
        let touched = false;
        const openings = p.openings.map((o, i) => {
            if (typeNameOf(typeKeyOf(ctx[i])) !== prof.name || kindOf(o) !== prof.kind || o.profile === prof.name) return o;
            if (only === 'unset' && (o.profile || hasFraming(o))) return o;
            touched = true; linked.push({ panelId: p.id, mark: p.mark, index: i });
            return assign(o, prof);
        });
        return touched ? { ...p, openings } : p;
    });
    return { panels: out, linked };
}
// How many openings use a profile, and where.
export const uses = (panels, name) => panels.flatMap(p => p.openings.map((o, i) => (o.profile === name ? { panelId: p.id, mark: p.mark, index: i } : null)).filter(Boolean));
// A profile removed: its openings keep their framing, without the link. Renamed: the links follow.
export const unlink = (panels, name) => panels.map(p => (p.openings.some(o => o.profile === name) ? { ...p, openings: p.openings.map(o => { if (o.profile !== name) return o; const { profile, ...rest } = o; return rest; }) } : p));
export const relink = (panels, from, to) => panels.map(p => (p.openings.some(o => o.profile === from) ? { ...p, openings: p.openings.map(o => (o.profile === from ? { ...o, profile: to } : o)) } : p));
