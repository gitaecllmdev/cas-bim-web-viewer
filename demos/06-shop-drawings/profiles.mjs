// Framing profiles: a named way to frame an opening's jambs, header or sill, picked from a list and reused on any
// opening (the Panel Shop Generator keeps a person's own in this browser). Pure: a profile resolves against a panel's
// members to the opening fields the generator already reads (its jamb/head/sill text and arrangement), so nothing new
// is framed differently: a profile is a shortcut to those fields, not a second set of rules.
//
//   jamb: { name, plies: 1 | 2 | 3, stud: '=stud' (the wall's on-center stud) | designator, style: box | back | same }
//   head/sill: { name, made: track | box | back, studs: 1 | 2, stud: '=stud' | designator, tracks: 0 | 1 | 2,
//                track: '=track' (the wall's bottom track) | designator, bearing: between | jacks (header only) }
//
// '=stud' and '=track' follow the wall, so one profile serves walls of any depth; a size picked by hand stays that size.
import * as G from './generator.mjs';

export const PROFILE_KINDS = ['jamb', 'head', 'sill'];
export const PRESETS = {
    jamb: [
        { name: 'Single stud', plies: 1, stud: '=stud', style: 'box' },
        { name: 'Double, boxed', plies: 2, stud: '=stud', style: 'box' },
        { name: 'Double, back to back', plies: 2, stud: '=stud', style: 'back' },
        { name: 'Triple, boxed', plies: 3, stud: '=stud', style: 'box' },
    ],
    head: [
        { name: 'Track', made: 'track', studs: 2, stud: '=stud', tracks: 1, track: '=track', bearing: 'between' },
        { name: 'Box: 2 studs, 2 tracks', made: 'box', studs: 2, stud: '=stud', tracks: 2, track: '=track', bearing: 'between' },
        { name: 'Back to back: 2 studs, 2 tracks', made: 'back', studs: 2, stud: '=stud', tracks: 2, track: '=track', bearing: 'between' },
        { name: 'Box on jack studs', made: 'box', studs: 2, stud: '=stud', tracks: 2, track: '=track', bearing: 'jacks' },
    ],
    sill: [
        { name: 'Track', made: 'track', studs: 2, stud: '=stud', tracks: 1, track: '=track' },
        { name: 'Box: 2 studs, 2 tracks', made: 'box', studs: 2, stud: '=stud', tracks: 2, track: '=track' },
    ],
};
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
const memberName = (v) => { const s = String(v ?? '').trim(); if (s === '=stud' || s === '=track') return s; const d = G.parseMember(s); return d && d.qty === 1 ? d.name : ''; };

// A profile as kept: only known fields, sizes as SSMA designators (or =stud / =track); null if it cannot be one.
export function cleanProfile(kind, p) {
    if (!p || typeof p !== 'object' || !PROFILE_KINDS.includes(kind)) return null;
    const name = String(p.name ?? '').trim().slice(0, 60);
    if (!name) return null;
    if (kind === 'jamb') {
        const stud = memberName(p.stud);
        if (!stud || stud === '=track') return null;
        return { name, plies: pick(Number(p.plies), [1, 2, 3], 1), stud, style: pick(p.style, Object.keys(G.JAMB_STYLES), 'box') };
    }
    const made = pick(p.made, ['track', 'box', 'back'], 'track'), stud = memberName(p.stud) || '=stud', track = memberName(p.track) || '=track';
    if (stud === '=track' || track === '=stud') return null;
    return { name, made, studs: pick(Number(p.studs), [1, 2], 2), stud, tracks: pick(Number(p.tracks), made === 'track' ? [1, 2] : [0, 1, 2], made === 'track' ? 1 : 2), track,
        ...(kind === 'head' ? { bearing: pick(p.bearing, ['between', 'jacks'], 'between') } : {}) };
}

// The wall's stud and bottom track by name (what =stud and =track stand for on this panel).
const wallStud = (members) => G.parseMember(members?.stud)?.name || String(members?.stud ?? '');
const wallTrack = (members) => G.parseMember(members?.track)?.name || G.trackFor(members?.stud) || String(members?.track ?? '');
const sizeOf = (v, members) => (v === '=stud' ? wallStud(members) : v === '=track' ? wallTrack(members) : v);

// What a profile sets on an opening, for a panel's members: { spec, style, bearing }.
export function profileFields(kind, prof, members) {
    if (kind === 'jamb') {
        const stud = sizeOf(prof.stud, members);
        return { spec: prof.plies === 1 ? (prof.stud === '=stud' ? G.SAME_STUD : stud) : `(${prof.plies}) ${stud}`, style: prof.plies > 1 ? prof.style : null, bearing: null };
    }
    const track = sizeOf(prof.track, members), stud = sizeOf(prof.stud, members);
    const spec = prof.made === 'track' ? (prof.tracks > 1 ? `(${prof.tracks}) ${track}` : prof.track === '=track' ? G.SAME_TRACK : track)
        : `(${prof.studs}) ${stud}${prof.tracks ? ` WITH (${prof.tracks}) ${track}` : ''}`;
    return { spec, style: prof.made === 'track' ? null : prof.made, bearing: kind === 'head' ? prof.bearing : null };
}

// The opening with a profile applied (a new object; the opening's place and size never change). An arrangement a
// profile gives is a choice made (kept explicit, box included), so the resolved plan does not report it as assumed.
export function applyProfile(o, kind, prof, members) {
    const f = profileFields(kind, prof, members), out = { ...o };
    if (kind === 'jamb') {
        out.jamb = f.spec;
        if (f.style) out.jambStyle = f.style; else delete out.jambStyle;
        if (prof.plies < 2) delete out.headBearing; // jack studs need a second jamb stud
        return out;
    }
    if (!G.OPENING_TYPES[G.kindOf(o)].members.includes(kind)) return out;
    out[kind] = f.spec;
    if (f.style) out[`${kind}Style`] = f.style; else delete out[`${kind}Style`];
    if (kind === 'head') { if (f.bearing === 'jacks') out.headBearing = 'jacks'; else delete out.headBearing; }
    return out;
}
// Back to what the panel gives every opening (its default members; no arrangement of its own).
export function clearProfile(o, kind) {
    const out = { ...o, [kind]: '' };
    delete out[`${kind}Style`];
    if (kind === 'head') delete out.headBearing;
    return out;
}

// The profile an opening's framing amounts to (for Save), or null when it is not one a profile can hold (a jamb with a
// track around it, a typed mix of sizes).
export function profileOfOpening(panel, o, kind, name = '') {
    const m = panel.members || {}, spec = G.memberFor(panel, o, kind).spec, sp = G.specParts(spec);
    const asStud = (n) => (n === wallStud(m) ? '=stud' : n), asTrack = (n) => (n === wallTrack(m) ? '=track' : n);
    if (kind === 'jamb') {
        if (sp.tracks.length || sp.studs.length !== 1) return null;
        return cleanProfile('jamb', { name: name || 'Jambs', plies: sp.studQty, stud: asStud(sp.studs[0].name), style: G.JAMB_STYLES[o.jambStyle] ? o.jambStyle : 'box' });
    }
    if (sp.studs.length > 1 || sp.tracks.length > 1) return null;
    const made = sp.studQty ? (o[`${kind}Style`] === 'back' ? 'back' : 'box') : 'track';
    if (made === 'track' && !sp.trackQty) return null;
    return cleanProfile(kind, { name: name || (kind === 'head' ? 'Header' : 'Sill'), made, studs: sp.studQty || 2, stud: sp.studs[0] ? asStud(sp.studs[0].name) : '=stud',
        tracks: sp.trackQty, track: sp.tracks[0] ? asTrack(sp.tracks[0].name) : '=track', bearing: o.headBearing === 'jacks' ? 'jacks' : 'between' });
}
// The same framing on this panel: the same resolved member text, arrangement and bearing.
export function sameFraming(kind, a, b, members) {
    const fa = profileFields(kind, a, members), fb = profileFields(kind, b, members);
    const norm = (s) => G.specText(s === G.SAME_STUD ? wallStud(members) : s === G.SAME_TRACK ? wallTrack(members) : s) || s;
    return norm(fa.spec) === norm(fb.spec) && (fa.style || '') === (fb.style || '') && (fa.bearing || 'between') === (fb.bearing || 'between');
}
// A profile in a few words, for this panel: '2 x 362S162-33, boxed'; 'Box: (2) 600S162-54 + (2) 362T125-33, on jack studs'.
export function describeProfile(kind, prof, members) {
    if (kind === 'jamb') return `${prof.plies > 1 ? `${prof.plies} x ` : ''}${sizeOf(prof.stud, members)}${prof.plies > 1 ? `, ${G.JAMB_STYLES[prof.style].split(' (')[0].toLowerCase()}` : ''} each side`;
    const track = sizeOf(prof.track, members), stud = sizeOf(prof.stud, members);
    const what = prof.made === 'track' ? `${prof.tracks > 1 ? `${prof.tracks} nested ` : ''}${track} track`
        : `${prof.studs} x ${stud}${prof.tracks ? ` + ${prof.tracks} x ${track}` : ''}, ${prof.made === 'back' ? 'back to back' : 'boxed'}`;
    return `${what}${kind === 'head' && prof.bearing === 'jacks' ? ', on jack studs' : ''}`;
}
