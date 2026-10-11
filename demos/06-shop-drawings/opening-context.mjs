// Where each opening came from and what it is for: the Revit export's inserts (panel.revit.inserts: the doors, windows,
// openings, steel and MEP the wall hosts or is cut by, each with its category, family, type and UniqueId, matched to an
// opening by where it is: generator.openingKeys) and a trade, with the trade's color for the drawings and the lists.
// Context only: nothing here changes a member, the plan or the export (the inserts ride along as they came).
import { openingKeys, isFromModel, kindOf } from './generator.mjs';

// Trade colors, as coordination models usually color them (doors and windows by their own).
export const TRADES = {
    doors: { label: 'Doors', color: '#a0522d' },
    windows: { label: 'Windows', color: '#2e86c1' },
    structural: { label: 'Structural steel', color: '#616a6b', short: 'STEEL' },
    mechanical: { label: 'Mechanical (HVAC)', color: '#138d75', short: 'HVAC' },
    plumbing: { label: 'Plumbing', color: '#229954', short: 'PLUMBING' },
    electrical: { label: 'Electrical', color: '#d68910', short: 'ELECTRICAL' },
    fire: { label: 'Fire protection', color: '#cb4335', short: 'FIRE PROT.' },
    openings: { label: 'Wall opening', color: '#5d6d7e', short: 'OPENING' },
    mep: { label: 'MEP (trade not given)', color: '#1a5276' },
    other: { label: 'Other', color: '#7f8c8d' },
};
// Revit categories (their English names, as the export writes them) to a trade.
const CATEGORY_TRADE = [
    [/^doors?$/i, 'doors'],
    [/^windows?$/i, 'windows'],
    [/^structural (framing|columns?|foundations?|connections?|stiffeners?|trusses|beam systems?)$/i, 'structural'],
    [/^(ducts?|duct (fittings|accessories|insulations|linings|placeholders)|flex ducts|air terminals|mechanical (equipment|control devices))$/i, 'mechanical'],
    [/^(sprinklers|fire (alarm devices|protection))$/i, 'fire'],
    [/^(pipes?|pipe (fittings|accessories|insulations|placeholders)|flex pipes|plumbing (fixtures|equipment))$/i, 'plumbing'],
    [/^(conduits?|conduit fittings|cable trays?|cable tray fittings|electrical (equipment|fixtures)|lighting (fixtures|devices)|(data|communication|security|nurse call|telephone) devices)$/i, 'electrical'],
    [/opening|shaft|generic models?/i, 'openings'],
];
const KIND_TRADE = { door: 'doors', window: 'windows', steel: 'structural', mep: 'mep' };
export function tradeOfCategory(category) {
    const c = String(category || '').trim();
    return c ? CATEGORY_TRADE.find(([re]) => re.test(c))?.[1] || 'other' : null;
}
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const insertOf = (ins) => ({ category: str(ins.category), family: str(ins.family), type: str(ins.type), uniqueId: str(ins.uniqueId), ...(ins.kind ? { kind: ins.kind } : {}) });
const nameOf = (ins) => [ins.family, ins.type].filter(Boolean).join(' : ');
const inches = (v) => Math.round(Number(v) * 16) / 16;

// Each opening, in the panel's order: { key, source: 'model' (its insert found) | 'model-geometry' (the model's, with
// no insert proven: a notch in the outline) | 'typed' (added here), trade, tradeLabel, color, insert?, name, title }.
export function openingContexts(panel) {
    const keys = openingKeys(panel), model = isFromModel(panel), inserts = model && Array.isArray(panel.revit.inserts) ? panel.revit.inserts : [];
    return (panel.openings || []).map((o, i) => {
        const key = keys[i], raw = key.startsWith('insert:') ? inserts.find(x => `insert:${x?.uniqueId}` === key) : null, ins = raw ? insertOf(raw) : null;
        const trade = (ins && (tradeOfCategory(ins.category) || KIND_TRADE[ins.kind])) || KIND_TRADE[kindOf(o)] || 'other';
        const source = ins ? 'model' : model && o.locked ? 'model-geometry' : 'typed';
        const name = ins ? nameOf(ins) : '';
        const title = ins ? `From the model: ${[ins.category, name].filter(Boolean).join(' · ')}${ins.uniqueId ? ` (UniqueId ${ins.uniqueId})` : ''}`
            : source === 'model-geometry' ? 'From the model\'s outline (no door, window or opening element found there)' : 'Added here (not in the model)';
        return { key, index: i, source, trade, tradeLabel: TRADES[trade].label, color: TRADES[trade].color, ...(ins ? { insert: ins } : {}), name, title };
    });
}
// The model's inserts no opening here frames (a pipe or conduit through the wall with no opening drawn for it, an
// element the export found but the outline does not cut): listed for coordination, never framed.
export function unframedInserts(panel) {
    if (!isFromModel(panel) || !Array.isArray(panel.revit.inserts)) return [];
    const keys = new Set(openingKeys(panel));
    return panel.revit.inserts.filter(x => x && Array.isArray(x.at) && !keys.has(`insert:${x.uniqueId}`)).map(x => {
        const ins = insertOf(x), trade = tradeOfCategory(ins.category) || KIND_TRADE[ins.kind] || 'other';
        return { ...ins, at: [inches(x.at[0]), inches(x.at[1])], trade, tradeLabel: TRADES[trade].label, color: TRADES[trade].color, name: nameOf(ins) };
    });
}
// For the sheet (sheet.mjs info.openingLooks): by opening key, its color, its model name, and what an MEP or steel
// opening's label says when the model tells its trade (short: HVAC, PLUMBING, ...).
export function openingLooks(panel) {
    return Object.fromEntries(openingContexts(panel).map(c => [c.key, { color: c.color, name: c.name, ...(c.insert && TRADES[c.trade].short && ['mep', 'steel'].includes(kindOf(panel.openings[c.index])) ? { kindText: TRADES[c.trade].short } : {}) }]));
}
// The trades in a panel's openings (for a legend), in TRADES order.
export const tradesOf = (contexts) => Object.keys(TRADES).filter(t => contexts.some(c => c.trade === t)).map(t => ({ trade: t, ...TRADES[t] }));
