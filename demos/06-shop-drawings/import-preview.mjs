// What an import would do, before anything changes (pure; the page draws it, import-merge.mjs does it).
// Each panel of the file against the panels here (by model identity: matchIncoming), with what changed in the model
// since (the wall: size, shape, level, type, place, profile hash; its openings by key: added, removed, moved, resized)
// and the web settings here that Replace would drop. The export's own evidence (walls it skipped, its notes) is grouped
// by kind: a skipped wall is listed once (the export repeats each one as a "SKIPPED Wall" note).
import { isFromModel, openingKeys, openingName, kindWord, kindOf, shapeTop, cleanPanel } from './generator.mjs';
import { matchIncoming } from './import-merge.mjs';
import { fmtFtIn } from '../common/framing.mjs';

const str = (v) => (v == null ? '' : String(v).trim());
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object'
    ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
const ft = (v) => fmtFtIn(v).replace(/^0'-/, '').replace(/^0 (?=\d+\/)/, ''); // under a foot in inches: 6", 1/2"
const signed = (d, plus, minus) => `${ft(Math.abs(d))} ${d > 0 ? plus : minus}`;

// --- The wall ---------------------------------------------------------------------------------------------------------
// What changed in the model between the panel here (a) and the file's (b), in words; [] when nothing did.
export function wallChanges(a, b) {
    const out = [], ta = shapeTop(a.shape), tb = shapeTop(b.shape);
    if (ta.lengthIn !== tb.lengthIn) out.push(`length ${ft(ta.lengthIn)} → ${ft(tb.lengthIn)}`);
    if (ta.heightIn !== tb.heightIn) out.push(`height ${ft(ta.heightIn)} → ${ft(tb.heightIn)}`);
    if (!!ta.top !== !!tb.top) out.push(tb.top ? 'top is sloped now' : 'top is flat now');
    else if (ta.top && canon(ta.top) !== canon(tb.top)) out.push('top slope changed');
    if (str(a.level) !== str(b.level)) out.push(`level ${a.level || '–'} → ${b.level || '–'}`);
    if (str(a.wallType) !== str(b.wallType)) out.push(`wall type ${a.wallType || '–'} → ${b.wallType || '–'}`);
    const ra = a.revit || {}, rb = b.revit || {};
    if (canon(ra.locationLine) !== canon(rb.locationLine)) out.push('moved in the model');
    else if (ra.sideA !== rb.sideA || ra.leftEnd !== rb.leftEnd) out.push('side A / left end changed');
    if (canon(ra.outlineOffsetIn) !== canon(rb.outlineOffsetIn)) out.push('end joins changed');
    if (!out.length && str(ra.geometryHash) !== str(rb.geometryHash))
        out.push('model geometry re-read (new hash; same size and openings): updating refreshes its lock');
    return out;
}

// --- Its openings -----------------------------------------------------------------------------------------------------
// The model's openings (locked) by key: [{ change: 'added' | 'removed' | 'changed', name, text }].
export function openingChanges(a, b) {
    const ka = openingKeys(a), kb = openingKeys(b), out = [];
    const mine = new Map(a.openings.map((o, i) => [ka[i], i]).filter(([, i]) => a.openings[i].locked));
    const theirs = new Map(b.openings.map((o, i) => [kb[i], i]).filter(([, i]) => b.openings[i].locked));
    const size = (o) => (kindOf(o) === 'steel' ? `${ft(o.widthIn)} wide` : `${ft(o.widthIn)} x ${ft(o.heightIn)}`);
    for (const [k, i] of theirs) {
        const o = b.openings[i], name = openingName(b.openings, i);
        if (!mine.has(k)) { out.push({ change: 'added', name, text: `${name} added: ${kindWord(kindOf(o))} ${size(o)}, ${ft(o.leftIn)} from the left` }); continue; }
        const was = a.openings[mine.get(k)], bits = [];
        if (kindOf(was) !== kindOf(o)) bits.push(`${kindWord(kindOf(was))} → ${kindWord(kindOf(o))}`);
        if (was.leftIn !== o.leftIn) bits.push(`moved ${signed(o.leftIn - was.leftIn, 'right', 'left')}`);
        if (kindOf(o) !== 'door' && was.sillIn !== o.sillIn) bits.push(`sill ${signed(o.sillIn - was.sillIn, 'up', 'down')}`);
        if (was.widthIn !== o.widthIn || (kindOf(o) !== 'steel' && was.heightIn !== o.heightIn)) bits.push(`${size(was)} → ${size(o)}`);
        if (bits.length) out.push({ change: 'changed', name, text: `${name} ${bits.join(', ')}` });
    }
    for (const [k, i] of mine) if (!theirs.has(k)) {
        const o = a.openings[i], name = openingName(a.openings, i), framed = FRAMING_FIELDS.some(f => o[f] !== undefined && o[f] !== '');
        out.push({ change: 'removed', name, text: `${name} removed (${kindWord(kindOf(o))} ${size(o)})${framed ? ': the framing chosen for it here goes with it' : ''}` });
    }
    return out;
}

// --- The web settings here --------------------------------------------------------------------------------------------
// What was chosen on the web for a panel here and is not in the file's panel: what Replace drops. In words.
const FRAMING_FIELDS = ['head', 'jamb', 'sill', 'offsetIn', 'offsets', 'jambStyle', 'headStyle', 'sillStyle', 'headBearing', 'crippleEnds', 'toLayout', 'style', 'profile'];
const SETTINGS = [
    [['members'], 'members'], [['layoutStartIn', 'layoutFromRight', 'optimizeOpenings'], 'stud layout'], [['flipStuds', 'studFlips'], 'stud flips'],
    [['deflectionGapIn'], 'deflection gap'], [['cutbackIn', 'seatPieces'], 'cutback / seated pieces'], [['headEnds', 'headCutbackIn', 'sillEnds', 'sillCutbackIn'], 'header and sill ends'],
    [['clips'], 'clips'], [['manual'], 'members placed by hand'], [['style', 'styleQuery'], 'engineering style'], [['context'], 'level and grid lines'], [['sideB'], 'view side'],
];
// file null: against the panel as its model gave it (the model's own members are not a web setting).
const bare = (p) => cleanPanel({ id: p.id, mark: p.mark, level: p.level, wallType: p.wallType, group: p.group, shape: p.shape, revit: p.revit, outline: p.outline,
    ...(isFromModel(p) ? { members: p.members, provenance: p.provenance } : {}),
    openings: p.openings.filter(o => o.locked).map(o => Object.fromEntries(Object.entries(o).filter(([k]) => !FRAMING_FIELDS.includes(k)))) });
export function webSettings(here, file) {
    file ??= bare(here);
    const out = SETTINGS.filter(([keys]) => keys.some(k => canon(here[k]) !== canon(file?.[k]))).map(([, label]) => label);
    const kh = openingKeys(here), kf = openingKeys(file);
    const framed = here.openings.map((o, i) => {
        if (!o.locked) return null;
        const j = kf.indexOf(kh[i]), f = j >= 0 ? file.openings[j] : {};
        return FRAMING_FIELDS.some(k => canon(o[k]) !== canon(f[k])) ? openingName(here.openings, i) : null;
    }).filter(Boolean);
    if (framed.length) out.push(`opening framing (${framed.join(', ')})`);
    const study = here.openings.filter(o => !o.locked).length;
    if (study) out.push(`${study} opening${study === 1 ? '' : 's'} added here`);
    if (here.revisions?.length) out.push('issued revisions');
    return out;
}

// --- The export's evidence ----------------------------------------------------------------------------------------------
// Skip codes that are walls this tool never frames (nothing to fix for this import); any other skip is a wall the model
// can be changed to include.
const NEVER_FRAMED = new Set(['curtain', 'curved']);
export function groupEvidence(data) {
    const skips = Array.isArray(data?.source?.skipped) ? data.source.skipped : [];
    const notes = Array.isArray(data?._casExportNotes) ? data._casExportNotes.map(String) : [];
    const skippedIds = new Set(skips.map(s => str(s.elementId)).filter(Boolean));
    const groups = new Map(), add = (map, key, base, item) => { if (!map.has(key)) map.set(key, { ...base, items: [] }); map.get(key).items.push(item); };
    for (const s of skips) {
        const code = str(s.code) || 'skipped', reason = str(s.reason) || 'Skipped by the export.';
        add(groups, `${code}|${reason}`, { code, reason, fixable: !NEVER_FRAMED.has(code) }, { elementId: str(s.elementId), wall: str(s.wallUniqueId) });
    }
    const noteGroups = new Map();
    let repeated = 0;
    for (const text of notes) {
        const skipped = /^SKIPPED Wall (\d+): (.*)$/.exec(text);
        if (skipped && skippedIds.has(skipped[1])) { repeated++; continue; } // the skip list has it
        if (skipped) { add(groups, `note|${skipped[2]}`, { code: '', reason: skipped[2], fixable: true }, { elementId: skipped[1], wall: '' }); continue; }
        const m = /^Wall (\d+): (.*)$/.exec(text), body = m ? m[2] : text;
        const labelled = /^([a-z][a-z /-]{1,30}): (.+)$/i.exec(body); // "joined ends: the panel face ..."
        const label = labelled ? labelled[1] : body.replace(/\.$/, '');
        add(noteGroups, label, { label }, { elementId: m ? m[1] : '', detail: labelled ? labelled[2] : '' });
    }
    const order = (a, b) => b.items.length - a.items.length;
    const skipped = [...groups.values()].sort((a, b) => (b.fixable - a.fixable) || order(a, b));
    return { skipped, notes: [...noteGroups.values()].sort(order), skippedWalls: skipped.reduce((n, g) => n + g.items.length, 0),
        noteCount: notes.length - repeated, repeated };
}

// --- The whole preview -----------------------------------------------------------------------------------------------
// relation: 'empty' (nothing here), 'same' (this model's panels, or panels typed here and in the file), 'other-model',
// 'here-not-model', 'file-not-model'. merge: whether Update (add, update from the model, keep) is possible, and why not.
// rows: one per panel of the file: { index, panel, mark, level, status, here, wall: [..], openings: [..], settings: [..],
//   choices: [values], choice } with status 'new' | 'changed' | 'same' | 'ambiguous' | 'standalone'.
// hereOnly: the model panels here that the file does not have (with the export's reason when it skipped the wall).
export function previewImport(current, incoming, data = null) {
    const here = current.panels || [], docHere = str(current.source?.documentId) || null, docThere = str(incoming.source?.documentId) || null;
    const relation = !here.length ? 'empty' : docHere === docThere ? 'same' : !docHere ? 'here-not-model' : !docThere ? 'file-not-model' : 'other-model';
    const merge = relation === 'same' ? { ok: true, reason: '' } : relation === 'empty' ? { ok: false, reason: '' } : { ok: false,
        reason: relation === 'here-not-model' ? 'The panels here are not from a model, and this file is: one set holds one model\'s panels. Replace them, or start a new set for the model.'
            : relation === 'file-not-model' ? 'This file\'s panels are not from a model, and the panels here are: Replace them, or open the file in a set of its own.'
                : 'This file is from another model than the panels here: Replace them, or keep each model in its own set.' };
    const evidence = groupEvidence(data);
    const matched = merge.ok ? matchIncoming(current, incoming) : (incoming.panels || []).map((panel, index) => ({ index, panel, status: isFromModel(panel) ? 'new' : 'standalone' }));
    const byId = new Map(here.map(p => [p.id, p]));
    const rows = matched.map(r => {
        const p = cleanPanel(r.panel), row = { index: r.index, panel: r.panel, mark: p.mark, level: p.level, wall: [], openings: [], settings: [], reason: r.reason || '' };
        if (r.status === 'match') {
            const h = cleanPanel(byId.get(r.match));
            row.here = { id: h.id, mark: h.mark };
            row.wall = wallChanges(h, p); row.openings = openingChanges(h, p); row.settings = webSettings(h, p);
            row.status = row.wall.length || row.openings.length ? 'changed' : 'same';
            row.choices = row.status === 'changed' ? ['geometry', 'keep', 'copy'] : ['keep', ...(webSettings(p, h).length ? ['update'] : []), 'copy'];
        } else if (r.status === 'ambiguous') { row.status = 'ambiguous'; row.choices = ['skip', 'copy']; }
        else { row.status = r.status; row.choices = ['add']; }
        row.choice = row.choices[0];
        return row;
    });
    // Here and not in the file: with the export's reason when it skipped that wall.
    const inFile = new Set((incoming.panels || []).filter(isFromModel).map(p => str(p.revit.uniqueId)));
    const skipReason = new Map(evidence.skipped.flatMap(g => g.items.filter(i => i.wall).map(i => [i.wall, g.reason])));
    const hereOnly = here.map(cleanPanel).filter(p => relation !== 'same' || !isFromModel(p) || !inFile.has(str(p.revit.uniqueId)))
        .map(p => ({ id: p.id, mark: p.mark, level: p.level, model: isFromModel(p), settings: isFromModel(p) ? webSettings(p, null) : [],
            reason: !isFromModel(p) ? 'Typed here (not from a model).' : skipReason.get(str(p.revit.uniqueId)) ? `The export skipped this wall: ${skipReason.get(str(p.revit.uniqueId))}` : 'Not in this export (deleted in the model, or not selected for export).' }));
    const count = (s) => rows.filter(r => r.status === s).length;
    return { relation, merge, rows, hereOnly, here: here.length, evidence,
        counts: { file: rows.length, new: count('new') + count('standalone'), changed: count('changed'), same: count('same'), ambiguous: count('ambiguous'),
            wallChanged: rows.filter(r => r.wall.length).length, openingsChanged: rows.filter(r => r.openings.length).length,
            withSettings: rows.filter(r => r.settings.length).length + hereOnly.filter(h => h.settings.length).length } };
}

// What one mode does, in counts (the page's sentence and button): Replace or Update with the rows' choices.
export function outcome(preview, mode) {
    const by = (c) => preview.rows.filter(r => r.choice === c).length;
    if (mode === 'replace') return { add: preview.rows.length, remove: preview.here, settingsLost: preview.counts.withSettings };
    return { add: by('add'), fromModel: by('geometry'), detailing: by('update'), keep: by('keep'), copy: by('copy'), skip: by('skip'), keepHere: preview.hereOnly.length };
}
