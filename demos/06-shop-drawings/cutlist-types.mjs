// Row-scoped type choices, identified by the layout's stable keys and original part names, never by a changing label.
// The panel defaults stay intact; generator.applyManual resolves these choices before labels, checks and exports.
import * as G from './generator.mjs';

export function suggestions(panel, designator, recent = []) {
    const current = G.parseMember(designator);
    if (!current || current.qty !== 1) return [designator];
    const specs = [...Object.values(G.memberChoices(panel.members)), Object.values(panel.members || {}),
        ...(panel.openings || []).map(o => [o.head, o.jamb, o.sill]), recent].flat();
    const names = specs.flatMap(s => { const p = G.specParts(s); return [...p.studs, ...p.tracks].map(q => q.name); });
    // Other standard thicknesses in the selected section series, followed by the existing wall catalog/choices.
    const series = [18, 30, 33, 43, 54, 68, 97].map(mils => current.name.replace(/-\d+$/, `-${mils}`));
    return [...new Set([designator, ...series, ...names].filter(name => G.compatibleMemberType(designator, name)))];
}

export function setRowType(panel, layout, mark, type) {
    const row = layout?.cutList?.find(r => r.mark === mark), d = G.parseMember(type);
    if (!row || !d || d.qty !== 1 || !G.compatibleMemberType(row.type, d.name)) return { panel, changed: 0, error: 'Choose a single member of the same family, depth and flange size. Change section sizes under Members.' };
    if (row.type === d.name) return { panel, changed: 0 };
    const types = structuredClone(panel.manual?.types || {});
    let changed = 0;
    for (const m of layout.members) {
        const parts = m.parts?.length ? m.parts : [{ name: m.type, qty: 1 }], marks = m.marks?.length ? m.marks : [m.mark];
        parts.forEach((part, i) => {
            if ((marks[i] ?? m.mark) !== mark || part.name !== row.type) return;
            const from = m.typeSources?.[i] || part.name, edits = { ...(types[m.key] || {}) };
            if (from === d.name) delete edits[from]; else edits[from] = d.name;
            if (Object.keys(edits).length) types[m.key] = edits; else delete types[m.key];
            changed += part.qty || 1;
        });
    }
    if (!changed) return { panel, changed: 0, error: 'This cut-list row no longer matches the framing. Refresh and try again.' };
    const manual = G.cleanManual({ ...panel.manual, types }), next = { ...panel };
    if (manual) next.manual = manual; else delete next.manual;
    return { panel: next, changed };
}
