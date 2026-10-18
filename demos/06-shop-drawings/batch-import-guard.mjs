// Batch Sheets import guards (pure; batch-sheets.js only, tested in tests/batch-import-guard.test.js). Three lessons from
// the MWF study (CAS_RevitGit docs/MWF_FOUNDATION_REVIEW_2026-10-17.md):
// - An MWF panel number is display text: renumbering in the model (by hand, or the 2027 assistant's RenumberPanels)
//   changes it. A wall whose panels here and in the file share no panel number was renumbered or panelized again, so
//   its file panels are not "new panels" to add beside the linked ones (that would link the wall twice).
// - The source document id is the project's ProjectInformation UniqueId, which every copy of the model keeps (a detached
//   model, another local, a saved-as copy). A different model file name under the same id is said, not trusted.
// - An export is a dated snapshot. One older than the export this set last took would put back an older model.
// These only add warnings or turn a guess into a question (Can't match); they never relink or repair anything.
// import-merge.mjs (shared with the Panel Shop Generator) is not changed: guardedMatch runs after its matchIncoming.
import { matchIncoming } from './import-merge.mjs';
import { isFromModel } from './generator.mjs';

const str = (v) => (v == null ? '' : String(v).trim());
const wallOf = (p) => str(p?.revit?.uniqueId);
const numberOf = (p) => str(p?.revit?.panelNumber);
const shortId = (s) => (s && s.length > 14 ? `…${s.slice(-12)}` : s || '?');
const list = (xs) => xs.map(x => x || '(none)').join(', ');
const when = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// matchIncoming, then: a model panel of a wall that has panels here, none of whose numbers the file's panels for that
// wall use, is not added beside them. One panel here and one in the file: the same panel renumbered (a match, with a
// note the preview lists as a model change). Several: Can't match (which is which cannot be told by a display number).
export function guardedMatch(current, incoming) {
    const rows = matchIncoming(current, incoming);
    const here = (current.panels || []).filter(isFromModel);
    const taken = new Set(rows.filter(r => r.status === 'match').map(r => r.match));
    const walls = new Set(rows.filter(r => r.status === 'new' && isFromModel(r.panel)).map(r => wallOf(r.panel)).filter(Boolean));
    for (const wall of walls) {
        const mine = here.filter(p => wallOf(p) === wall);
        if (!mine.length) continue; // a wall this set does not have yet: really new
        const theirs = rows.filter(r => isFromModel(r.panel) && wallOf(r.panel) === wall);
        const numbersHere = mine.map(numberOf), numbersThere = theirs.map(r => numberOf(r.panel));
        if (numbersThere.some(n => n && numbersHere.includes(n))) continue; // a panel kept its number: the rest were added
        const fresh = theirs.filter(r => r.status === 'new');
        if (mine.length === 1 && theirs.length === 1 && fresh.length === 1 && !taken.has(mine[0].id)) {
            const r = fresh[0];
            r.status = 'match'; r.match = mine[0].id; taken.add(mine[0].id);
            r.renumbered = { from: numbersHere[0], to: numbersThere[0] };
            r.notes = [`panel number ${numbersHere[0] || '(none)'} → ${numbersThere[0] || '(none)'}: renumbered in the model (the same wall, one panel)`];
            continue;
        }
        for (const r of fresh) {
            r.status = 'ambiguous';
            r.reason = `Wall ${shortId(wall)} has ${mine.length === 1 ? 'a panel' : `${mine.length} panels`} here (${list(numbersHere)}) and ${theirs.length} in the file (${list(numbersThere)}), none with the same panel number: renumbered or panelized again in the model. Which is which cannot be told from a panel number, so none is added beside the linked ${mine.length === 1 ? 'panel' : 'panels'}.`;
        }
    }
    return rows;
}

// The file's source against the export this set last took: [{ code, level: 'warn' | 'info', text }] and olderExport
// (the preview then offers Keep first for walls changed in the model).
export function sourceChecks(current, incoming) {
    const a = current?.source || {}, b = incoming?.source || {}, out = [];
    let olderExport = false;
    const linked = (current?.panels || []).some(isFromModel);
    if (!linked || !str(a.documentId) || str(a.documentId) !== str(b.documentId)) return { warnings: out, olderExport };
    if (str(a.document) && str(b.document) && str(a.document) !== str(b.document)) out.push({ code: 'other-file', level: 'warn',
        text: `Same project id as this set, but another model file: "${str(a.document)}" here, "${str(b.document)}" in the file. A copy, a detached model or another local keeps the project id, so the match cannot tell them apart. Check that this is the model you meant.` });
    const ta = Date.parse(a.exportedAt), tb = Date.parse(b.exportedAt);
    if (Number.isFinite(ta) && Number.isFinite(tb) && tb < ta) {
        olderExport = true;
        out.push({ code: 'older-export', level: 'warn',
            text: `This export (${when(tb)}) is older than the one this set last took (${when(ta)}). Its walls would put back an older state of the model: walls changed in the model start on Keep; choose an update only where you mean it.` });
    }
    if (str(a.exportId) && str(a.exportId) === str(b.exportId)) out.push({ code: 'same-export', level: 'info', text: 'This is the export this set last took (the same export id).' });
    return { warnings: out, olderExport };
}

// The set's own model links, checked (never repaired): [{ code, text, marks }]. A wall linked twice, panels of one wall
// with no panel number to tell them apart, or a model panel with no wall UniqueId cannot be matched on the next import.
export function linkAudit(set) {
    const model = (set?.panels || []).filter(isFromModel), out = [];
    const noWall = model.filter(p => !wallOf(p));
    if (noWall.length) out.push({ code: 'no-wall-id', marks: noWall.map(p => p.mark), text: `${noWall.map(p => p.mark).join(', ')}: from a model but without a wall UniqueId; the next import cannot match ${noWall.length === 1 ? 'it' : 'them'}.` });
    const byWall = new Map();
    for (const p of model) if (wallOf(p)) byWall.set(wallOf(p), [...(byWall.get(wallOf(p)) || []), p]);
    for (const [wall, ps] of byWall) {
        if (ps.length < 2) continue;
        const numbers = ps.map(numberOf), counts = numbers.reduce((m, n) => m.set(n, (m.get(n) || 0) + 1), new Map());
        const twice = [...counts].filter(([n, k]) => n && k > 1).map(([n]) => n);
        if (twice.length) out.push({ code: 'linked-twice', marks: ps.filter(p => twice.includes(numberOf(p))).map(p => p.mark),
            text: `${ps.filter(p => twice.includes(numberOf(p))).map(p => p.mark).join(', ')}: linked to the same model panel (wall ${shortId(wall)}, panel ${twice.join(', ')}). Keep one; make the others unlinked copies.` });
        if (numbers.some(n => !n)) out.push({ code: 'unnumbered', marks: ps.map(p => p.mark),
            text: `${ps.map(p => p.mark).join(', ')}: ${ps.length} panels linked to wall ${shortId(wall)}, ${numbers.every(n => !n) ? 'none' : 'not all'} with a panel number; the next import cannot tell them apart.` });
    }
    return out;
}

// All of it for one import: the preview's options ({ match, warnings, preferKeep }) and the same match for the merge.
export function importGuard(current, incoming) {
    const src = sourceChecks(current, incoming);
    const links = linkAudit(current).map(x => ({ code: x.code, level: 'warn', text: `In this set: ${x.text}` }));
    return { match: guardedMatch, warnings: [...src.warnings, ...links], preferKeep: src.olderExport };
}
