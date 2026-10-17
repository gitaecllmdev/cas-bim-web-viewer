// Reading a cas-panel-shops file into a workspace that has panels (pure; the page asks, this decides).
// - Replace: the file as it is (its project, drawnBy, set fields: source, grids, levels, typeFraming, openingProfiles,
//   legendColors; unknown fields, panels with
//   their revisions); nothing of the old set kept; nothing re-detailed. What reading changed is reported (a fresh Revit
//   export's outlines become shapes; a hand-written file is normalized), so the set is not called "as exported".
// - Add: the file's panels beside these. A model panel is matched to the panels here by the contract's identity
//   (framing-plan-contract.md, Snapshot identity): the source document (set source.documentId), the model wall
//   (revit.uniqueId: identity.panelUniqueId) and, when the export sends one, its panel number (revit.panelNumber:
//   identity.displayNumber), which tells several panels of one wall apart. Never by mark or the local id. A match is
//   kept, updated from the model (its wall and openings again, the detailing here kept: updateGeometry), given the
//   file's detailing, or added as an unlinked study copy; a panel that cannot be told apart is never guessed into one
//   (skip or a study copy). A typed-in panel has no identity: added as before. The page shows all of it first
//   (import-preview.mjs).
import { cleanPanel, isFromModel, copyPanel, nextMark, openingKeys, openingName, exportSet, SET_FIELDS } from './generator.mjs';

const str = (v) => (v == null ? '' : String(v).trim());
// A model panel's identity, or null for a panel typed here.
export function panelIdentity(panel, documentId) {
    if (!isFromModel(panel)) return null;
    return { documentId: str(documentId) || null, wall: str(panel.revit.uniqueId) || null, number: str(panel.revit.panelNumber) || null };
}
const shortId = (s) => (s && s.length > 14 ? `…${s.slice(-12)}` : s || '?');
const describeId = (id) => `wall ${shortId(id.wall)}${id.number ? `, panel ${id.number}` : ''}`;

// Each panel of the file against the panels here (Add): [{ index, panel, status, match?, reason }]. status: 'standalone'
// (no identity: added), 'new' (a model panel not here: added), 'match' (the same model panel is here: match = its
// local id), 'ambiguous' (cannot be told apart, or no identity to tell: reason says why).
export function matchIncoming(current, incoming) {
    const docHere = str(current.source?.documentId) || null, docThere = str(incoming.source?.documentId) || null;
    const here = (current.panels || []).filter(isFromModel), taken = new Map();
    const rows = (incoming.panels || []).map((panel, index) => {
        const id = panelIdentity(panel, docThere);
        if (!id) return { index, panel, status: 'standalone' };
        if (!id.documentId) return { index, panel, status: 'ambiguous', reason: 'The file names no source document (source.documentId): its model panels cannot be matched to the panels here.' };
        if (!id.wall) return { index, panel, status: 'ambiguous', reason: 'This model panel has no wall UniqueId (revit.uniqueId): it cannot be matched to the panels here.' };
        if (docHere && docHere !== id.documentId) return { index, panel, status: 'ambiguous', reason: 'From another model than the panels here (another source document).' };
        const sameWall = here.filter(p => str(p.revit.uniqueId) === id.wall);
        const siblings = (incoming.panels || []).filter((q, k) => k !== index && isFromModel(q) && str(q.revit.uniqueId) === id.wall);
        if (!sameWall.length) return { index, panel, status: 'new' };
        if (id.number) {
            const hits = sameWall.filter(p => str(p.revit.panelNumber) === id.number);
            if (hits.length === 1) return { index, panel, status: 'match', match: hits[0].id };
            if (hits.length > 1) return { index, panel, status: 'ambiguous', reason: `${hits.length} panels here have ${describeId(id)}: which one this is cannot be told.` };
            if (sameWall.some(p => !str(p.revit.panelNumber))) return { index, panel, status: 'ambiguous', reason: `Panels here on ${describeId({ wall: id.wall })} have no panel number: whether one of them is panel ${id.number} cannot be told.` };
            return { index, panel, status: 'new' }; // another panel of the same wall
        }
        if (sameWall.length === 1 && !siblings.length && !str(sameWall[0].revit.panelNumber)) return { index, panel, status: 'match', match: sameWall[0].id };
        return { index, panel, status: 'ambiguous', reason: `${describeId(id)} has ${sameWall.length} panel${sameWall.length === 1 ? '' : 's'} here and ${siblings.length + 1} in the file, and the export gives no panel number to tell them apart.` };
    });
    // New identities must also be unambiguous within the incoming batch. Looking only at
    // the workspace would otherwise add two linked copies of a previously unseen panel.
    for (const r of rows) {
        if (r.status !== 'new') continue;
        const id = panelIdentity(r.panel, docThere);
        const siblings = rows.filter(q => isFromModel(q.panel) && str(q.panel.revit.uniqueId) === id.wall);
        if (siblings.length > 1 && siblings.some(q => !str(q.panel.revit.panelNumber))) {
            r.status = 'ambiguous';
            r.reason = `${describeId({ wall: id.wall })} has ${siblings.length} panels in the file, and at least one has no panel number to tell them apart.`;
        } else if (siblings.filter(q => str(q.panel.revit.panelNumber) === id.number).length > 1) {
            r.status = 'ambiguous';
            r.reason = `${describeId(id)} is claimed by more than one panel in the file: which one to add cannot be told.`;
        }
    }
    // One panel here is matched once: a second claim on it cannot be told apart.
    for (const r of rows) {
        if (r.status !== 'match') continue;
        if (taken.has(r.match)) { r.status = 'ambiguous'; r.reason = `Another panel in the file (${rows[taken.get(r.match)].panel.mark}) matches the same panel here.`; delete r.match; continue; }
        taken.set(r.match, r.index);
    }
    return rows;
}

// The editable detailing (what Update takes from the file): the members, the stud layout, the studs' facing and cutback,
// the clips, the members placed by hand, the engineering styles, the viewing side, the level and grid lines; each
// opening's framing by its key; the openings added here. Never the locked geometry (shape, outline, revit, the model's
// openings' place and size), the mark, level, wall type, group or revisions.
const DETAIL_KEYS = ['members', 'provenance', 'framingOrigins', 'layoutStartIn', 'layoutFromRight', 'optimizeOpenings', 'flipStuds', 'studFlips', 'clips', 'sideB', 'cutbackIn', 'deflectionGapIn', 'seatPieces', 'headEnds', 'headCutbackIn', 'sillEnds', 'sillCutbackIn', 'manual', 'style', 'styleQuery', 'context'];
const OPENING_FRAMING = ['head', 'jamb', 'sill', 'offsetIn', 'jambStyle', 'headStyle', 'sillStyle', 'headBearing', 'crippleEnds', 'toLayout', 'style'];
const geometryRevit = (revit) => { if (!revit) return null; const { framingSettings, templateName, ...geometry } = revit; return geometry; };
const lockedGeometry = (p) => JSON.stringify({ shape: p.shape, outline: p.outline ?? null, revit: geometryRevit(p.revit),
    openings: (p.openings || []).filter(o => o.locked).map(o => [o.kind, o.leftIn, o.widthIn, o.heightIn, o.sillIn]) });
// -> { panel, changed: [field names], geometryDiffers, markDiffers }
export function updateDetailing(existing, incoming) {
    const a = cleanPanel(existing), b = cleanPanel(incoming), out = structuredClone(a), changed = [];
    if (b.revit?.framingSettings && canon(a.revit?.framingSettings) !== canon(b.revit.framingSettings)) {
        out.revit = { ...out.revit, framingSettings: structuredClone(b.revit.framingSettings) };
        changed.push('Revit framing settings');
    }
    for (const k of DETAIL_KEYS) {
        if (canon(a[k]) === canon(b[k])) continue; // by content, whatever order its fields were written in
        if (b[k] === undefined) delete out[k]; else out[k] = structuredClone(b[k]);
        changed.push(k);
    }
    const keysA = openingKeys(a), keysB = openingKeys(b);
    out.openings = a.openings.filter(o => o.locked).map(o => {
        const j = keysB.indexOf(keysA[a.openings.indexOf(o)]), from = j >= 0 ? b.openings[j] : null;
        if (!from) return o;
        const next = { ...Object.fromEntries(Object.entries(o).filter(([k]) => !OPENING_FRAMING.includes(k))), ...Object.fromEntries(OPENING_FRAMING.filter(k => from[k] !== undefined).map(k => [k, structuredClone(from[k])])) };
        if (canon(next) !== canon(o)) changed.push(`openings.${keysA[a.openings.indexOf(o)]}`);
        return next;
    });
    const studyA = canon(a.openings.filter(o => !o.locked)), studyB = b.openings.filter(o => !o.locked);
    out.openings.push(...structuredClone(studyB));
    if (studyA !== canon(studyB)) changed.push('openings added here');
    return { panel: cleanPanel(out), changed, geometryDiffers: lockedGeometry(a) !== lockedGeometry(b), markDiffers: a.mark !== b.mark };
}

// The model's wall again (a fresh export of a wall that changed), the detailing here kept: the file's locked geometry
// (shape, outline, revit block with its framing settings, level, wall type, group) and its model openings, each taking
// the framing chosen here for the opening with the same key; the openings added here stay. Never the mark, id,
// revisions or panel detailing. -> { panel, dropped: [opening names here whose model opening is gone], moved: bool }
const OPENING_KEEP = [...OPENING_FRAMING, 'profile', 'insertId', 'offsets'];
export function updateGeometry(existing, incoming) {
    const a = cleanPanel(existing), b = cleanPanel(incoming), keysA = openingKeys(a), keysB = openingKeys(b);
    const framingByKey = new Map(a.openings.map((o, i) => [keysA[i], o]).filter(([, o]) => o.locked));
    const openings = b.openings.filter(o => o.locked).map((o, i) => {
        const from = framingByKey.get(keysB[b.openings.indexOf(o)]);
        return from ? { ...o, ...Object.fromEntries(OPENING_KEEP.filter(k => from[k] !== undefined).map(k => [k, structuredClone(from[k])])) } : o;
    });
    const kept = new Set(b.openings.filter(o => o.locked).map(o => keysB[b.openings.indexOf(o)]));
    const dropped = a.openings.map((o, i) => (o.locked && !kept.has(keysA[i]) ? openingName(a.openings, i) : null)).filter(Boolean);
    const out = { ...a, shape: structuredClone(b.shape), level: b.level, wallType: b.wallType, group: b.group,
        openings: [...openings, ...a.openings.filter(o => !o.locked).map(o => structuredClone(o))] };
    if (b.revit) out.revit = structuredClone(b.revit); else delete out.revit;
    if (b.outline) out.outline = structuredClone(b.outline); else delete out.outline;
    return { panel: cleanPanel(out), dropped, moved: canon(a.shape) !== canon(b.shape) };
}

// The panels Add brings, by the choices for the rows that need one (choices: index -> 'skip' | 'keep' | 'update' |
// 'geometry' | 'copy'; a match or an ambiguous row with no choice is skipped). 'keep' is a skip of a panel that stays
// as it is here; 'geometry' takes the model's wall and openings again and keeps the detailing here (updateGeometry).
// -> { panels, report: { added, renamed, updated, fromModel, kept, copies, skipped, notes } }. Never a second linked
// panel for one model panel.
export function mergeAdd(current, rows, choices, newId) {
    const panels = (current.panels || []).map(p => p), marks = panels.map(p => p.mark);
    const report = { added: [], renamed: [], updated: [], fromModel: [], kept: [], copies: [], skipped: [], notes: [] };
    const free = (mark) => { let m = mark; while (marks.includes(m)) m = nextMark(m); marks.push(m); return m; };
    for (const r of rows) {
        const choice = r.status === 'standalone' || r.status === 'new' ? 'add' : choices[r.index] || 'skip';
        if (choice === 'skip') { report.skipped.push(r.panel.mark); continue; }
        if (choice === 'keep' && r.status === 'match') { report.kept.push(panels.find(p => p.id === r.match)?.mark ?? r.panel.mark); continue; }
        if (choice === 'geometry' && r.status === 'match') {
            const i = panels.findIndex(p => p.id === r.match), u = updateGeometry(panels[i], r.panel);
            panels[i] = { ...u.panel, id: panels[i].id };
            report.fromModel.push(panels[i].mark);
            if (u.dropped.length) report.notes.push(`${panels[i].mark}: the model no longer has ${u.dropped.join(', ')}; the framing chosen for ${u.dropped.length === 1 ? 'it' : 'them'} was dropped.`);
            if (u.moved && ['studFlips', 'clips', 'manual'].some(k => panels[i][k])) report.notes.push(`${panels[i].mark}: the wall's size or shape changed; check its stud flips, clips and members placed by hand (kept where they were).`);
            continue;
        }
        if (choice === 'add') {
            const mark = free(r.panel.mark);
            if (mark !== r.panel.mark) report.renamed.push(`${r.panel.mark} as ${mark}`);
            panels.push({ ...r.panel, id: newId(), mark }); report.added.push(mark); continue;
        }
        if (choice === 'copy') {
            const c = copyPanel(r.panel, marks); marks.push(c.mark);
            panels.push({ ...c, id: newId() }); report.copies.push(`${r.panel.mark} as ${c.mark}`); continue;
        }
        if (choice === 'update' && r.status === 'match') {
            const i = panels.findIndex(p => p.id === r.match), u = updateDetailing(panels[i], r.panel);
            panels[i] = { ...u.panel, id: panels[i].id };
            report.updated.push(`${panels[i].mark}${u.changed.length ? ` (${u.changed.join(', ')})` : ' (no change)'}`);
            if (u.geometryDiffers) report.notes.push(`${panels[i].mark}: the file's model geometry differs from the panel here; the panel's locked geometry was kept (Replace, or a re-export, to take the model's).`);
            if (u.markDiffers) report.notes.push(`${panels[i].mark}: the file calls it ${r.panel.mark}; its mark here was kept.`);
            continue;
        }
        report.skipped.push(r.panel.mark); // update asked for a row with nothing to update
    }
    return { panels, report };
}

// Replace: the file's set as it is; local ids kept when given and unique, else new. -> { set, transformed: [words] }
// transformed: what reading changed against the file (empty: the set is the file, and may be called exported).
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object'
    ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
const portable = (file) => { // what a re-export must give back: not the save time, the computed framing or local ids
    const { savedAt, ...root } = file || {};
    for (const k of ['project', 'drawnBy']) if (root[k] == null) root[k] = '';
    return { ...root, panels: (root.panels || []).map(({ framing, id, ...p }) => p) };
};
export function replaceSet(incoming, file, warnings = [], newId) {
    const seen = new Set();
    const panels = (incoming.panels || []).map(p => { const id = str(p.id); const keep = id && !seen.has(id); seen.add(id); return keep ? p : { ...p, id: newId() }; });
    const set = { project: incoming.project || '', drawnBy: incoming.drawnBy || '', ...Object.fromEntries([...SET_FIELDS, 'extra'].filter(k => incoming[k] != null).map(k => [k, structuredClone(incoming[k])])), panels };
    const transformed = [...warnings];
    if (file && typeof file === 'object' && !Array.isArray(file)) {
        const back = portable(exportSet(set, { framing: false })), was = portable(file);
        const changedPanels = back.panels.map((p, i) => (canon(p) !== canon(was.panels[i]) ? p.mark : null)).filter(Boolean);
        if (back.panels.length !== was.panels.length) transformed.push(`${was.panels.length - back.panels.length} of the file's panels were not read.`);
        if (changedPanels.length) transformed.push(`Read with changes (a model's outlines turned into shapes, or fields normalized): ${changedPanels.join(', ')}.`);
        const { panels: bp, ...bRoot } = back, { panels: wp, ...wRoot } = was;
        if (canon(bRoot) !== canon(wRoot)) transformed.push('The file\'s set fields were normalized.');
    } else transformed.push('Not a cas-panel-shops set file: its panels were read into one.');
    return { set, transformed };
}
