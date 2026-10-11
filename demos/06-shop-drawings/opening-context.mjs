// Where each opening came from and what it is for: the Revit export's inserts (panel.revit.inserts: the doors, windows,
// openings, steel and MEP the wall hosts or is cut by, each with its category, family, type and UniqueId, matched to an
// opening by where it is: generator.openingKeys) and a trade, with the trade's color for the drawings and the lists.
// Context only: nothing here changes a member, the plan or the export (the inserts ride along as they came).
import { openingKeys, isFromModel, kindOf } from './generator.mjs';

// Trade colors, as the shop drawings' legend names them (legend: its sub-name on the sheet; an MEP or mech opening
// cyan). Each can be set for the set (set.legendColors, by trade): pass it as colors.
export const TRADES = {
    doors: { label: 'Doors', color: '#a0522d', legend: 'DOOR' },
    windows: { label: 'Windows', color: '#2e86c1', legend: 'WINDOW' },
    structural: { label: 'Structural steel', color: '#616a6b', short: 'STEEL', legend: 'STEEL OPENING' },
    mechanical: { label: 'Mechanical (HVAC)', color: '#00acc1', short: 'MECH', legend: 'MECH OPENING' },
    plumbing: { label: 'Plumbing', color: '#229954', short: 'PLUMBING', legend: 'PLUMBING OPENING' },
    electrical: { label: 'Electrical', color: '#d68910', short: 'ELECTRICAL', legend: 'ELECTRICAL OPENING' },
    fire: { label: 'Fire protection', color: '#cb4335', short: 'FIRE PROT.', legend: 'FIRE PROTECTION OPENING' },
    openings: { label: 'Wall opening', color: '#5d6d7e', short: 'OPENING', legend: 'WALL OPENING' },
    mep: { label: 'MEP opening', color: '#00bcd4', legend: 'MEP OPENING' },
    other: { label: 'Other', color: '#7f8c8d', legend: 'OTHER OPENING' },
};
// A trade's color: the set's own (colors: { trade: '#rrggbb' }), else the legend's.
const HEX = /^#[0-9a-f]{6}$/i;
export const colorOf = (trade, colors = null) => (colors && HEX.test(colors[trade] || '') ? colors[trade] : TRADES[trade]?.color || TRADES.other.color);
export const cleanColors = (v) => { if (!v || typeof v !== 'object') return null; const out = Object.fromEntries(Object.entries(v).filter(([k, c]) => TRADES[k] && HEX.test(String(c))).map(([k, c]) => [k, String(c).toLowerCase()])); return Object.keys(out).length ? out : null; };
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
// no insert proven: a notch in the outline) | 'model-element' (added here for a model element with no opening:
// opening.insertId) | 'typed' (added here), trade, tradeLabel, color, insert?, name, title }.
export function openingContexts(panel, colors = null) {
    const keys = openingKeys(panel), model = isFromModel(panel), inserts = model && Array.isArray(panel.revit.inserts) ? panel.revit.inserts : [];
    return (panel.openings || []).map((o, i) => {
        const key = keys[i], byKey = key.startsWith('insert:') ? inserts.find(x => `insert:${x?.uniqueId}` === key) : null;
        const raw = byKey || (o.insertId ? inserts.find(x => x?.uniqueId === o.insertId) : null), ins = raw ? insertOf(raw) : null;
        const trade = (ins && (tradeOfCategory(ins.category) || KIND_TRADE[ins.kind])) || KIND_TRADE[kindOf(o)] || 'other';
        const source = byKey ? 'model' : ins ? 'model-element' : model && o.locked ? 'model-geometry' : 'typed';
        const name = ins ? nameOf(ins) : '';
        const title = ins ? `${byKey ? 'From the model' : 'Added here for the model\'s element'}: ${[ins.category, name].filter(Boolean).join(' · ')}${ins.uniqueId ? ` (UniqueId ${ins.uniqueId})` : ''}`
            : source === 'model-geometry' ? 'From the model\'s outline (no door, window or opening element found there)' : 'Added here (not in the model)';
        return { key, index: i, source, trade, tradeLabel: TRADES[trade].label, color: colorOf(trade, colors), ...(ins ? { insert: ins } : {}), name, title };
    });
}
// The model's inserts no opening here frames (a pipe or conduit through the wall with no opening drawn for it, an
// element the export found but the outline does not cut): listed for coordination, never framed.
export function unframedInserts(panel, colors = null) {
    if (!isFromModel(panel) || !Array.isArray(panel.revit.inserts)) return [];
    const keys = new Set(openingKeys(panel)), added = new Set((panel.openings || []).map(o => o.insertId).filter(Boolean));
    return panel.revit.inserts.filter(x => x && Array.isArray(x.at) && !keys.has(`insert:${x.uniqueId}`) && !added.has(x.uniqueId)).map(x => {
        const ins = insertOf(x), trade = tradeOfCategory(ins.category) || KIND_TRADE[ins.kind] || 'other';
        return { ...ins, at: [inches(x.at[0]), inches(x.at[1])], trade, tradeLabel: TRADES[trade].label, color: colorOf(trade, colors), name: nameOf(ins) };
    });
}
// For the sheet (sheet.mjs info.openingLooks): by opening key, its color, its model name, and what an MEP or steel
// opening's label says when the model tells its trade (short: HVAC, PLUMBING, ...).
export function openingLooks(panel, colors = null) {
    return Object.fromEntries(openingContexts(panel, colors).map(c => [c.key, { color: c.color, name: c.name, ...(c.insert && TRADES[c.trade].short && ['mep', 'steel'].includes(kindOf(panel.openings[c.index])) ? { kindText: TRADES[c.trade].short } : {}) }]));
}
// An opening for a model element that has none (unframedInserts): its kind from its trade (doors, windows, steel; the
// rest MEP), its size from its type's name when it says (36" x 84", or 4" for a round one), else the kind's usual size;
// at the element's place (its at: the left and bottom), with no framing offset (the model's place is the rough
// opening, as for the model's own openings). -> { opening, sizeFrom: 'type' | 'default' }
const KIND_OF_TRADE = { doors: 'door', windows: 'window', structural: 'steel' };
const inchNum = (s) => { const m = /^(\d+)(?:\s+(\d+)\/(\d+)|\.(\d+))?$/.exec(s.trim()); return m ? Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : m[4] ? Number(`0.${m[4]}`) : 0) : null; };
export function openingFromInsert(ins, sizes) {
    const trade = tradeOfCategory(ins.category) || KIND_TRADE[ins.kind] || 'other', kind = ins.kind && sizes[ins.kind] ? ins.kind : KIND_OF_TRADE[trade] || 'mep';
    const text = `${ins.type || ''} ${ins.family || ''}`, two = /(\d+(?:\.\d+|\s+\d+\/\d+)?)\s*"\s*[xX×]\s*(\d+(?:\.\d+|\s+\d+\/\d+)?)\s*"/.exec(text);
    const one = !two && kind === 'mep' ? /(\d+(?:\.\d+|\s+\d+\/\d+)?)\s*"/.exec(text) : null;
    const w = two ? inchNum(two[1]) : one ? inchNum(one[1]) : null, h = two ? inchNum(two[2]) : one ? inchNum(one[1]) : null;
    const size = sizes[kind], fromType = w > 0 && (kind === 'steel' || h > 0);
    const opening = { kind, leftIn: inches(ins.at[0]), widthIn: fromType ? w : size.widthIn, heightIn: kind === 'steel' ? 0 : fromType ? h : size.heightIn,
        sillIn: kind === 'door' ? 0 : inches(ins.at[1]), head: '', jamb: '', sill: '', offsetIn: 0, insertId: ins.uniqueId };
    return { opening, sizeFrom: fromType ? 'type' : 'default' };
}
// --- Framing by the model's family type: one door's framing given to every door of that category, family and type ------
// The framing fields of an opening (what a family type's openings share; not its place or size).
export const FRAMING_FIELDS = ['offsetIn', 'offsets', 'jamb', 'head', 'sill', 'jambStyle', 'headStyle', 'sillStyle', 'headBearing', 'crippleEnds', 'toLayout', 'style'];
const NOT_FOR = { door: ['sill', 'sillStyle'], steel: ['head', 'headStyle', 'headBearing'] };
// A model type's key (category, family, type) from an opening's context; null without the model's element.
export const typeKeyOf = (c) => (c?.insert && (c.insert.family || c.insert.type) ? [c.insert.category, c.insert.family, c.insert.type].join('|') : null);
export const typeNameOf = (key) => String(key || '').split('|').slice(1).filter(Boolean).join(' : ');
export function framingOf(o) { return Object.fromEntries(FRAMING_FIELDS.filter(k => o[k] != null && o[k] !== '' && o[k] !== false).map(k => [k, structuredClone(o[k])])); }
export const hasFraming = (o) => Object.keys(framingOf(o)).some(k => k !== 'offsetIn'); // a model opening's 0 offset is not a choice
// An opening with this framing (its own replaced; what its kind has no use for left out).
export function withFraming(o, framing) {
    const out = Object.fromEntries(Object.entries(o).filter(([k]) => !FRAMING_FIELDS.includes(k)));
    for (const [k, v] of Object.entries(framing)) if (!(NOT_FOR[o.kind] || []).includes(k)) out[k] = structuredClone(v);
    for (const k of ['jamb', 'head', 'sill']) if (out[k] == null) out[k] = '';
    if (o.kind === 'door') out.sill = ''; if (o.kind === 'steel') out.head = '';
    return out;
}
// Every opening of a model type across these panels: [{ panelId, mark, index }].
export function sameTypeOpenings(panels, key) {
    const out = [];
    for (const p of panels) openingContexts(p).forEach((c, i) => { if (key && typeKeyOf(c) === key) out.push({ panelId: p.id, mark: p.mark, index: i }); });
    return out;
}
// The framing given to every opening of the type: -> { panels, changed: [{ panelId, mark, index }] }. only: when given,
// just the openings with no framing chosen yet (hasFraming false): a newly imported panel taking the set's typeFraming.
export function applyTypeFraming(panels, key, framing, { only = null } = {}) {
    const changed = [];
    const out = panels.map(p => {
        let touched = false;
        const ctx = openingContexts(p);
        const openings = p.openings.map((o, i) => {
            if (typeKeyOf(ctx[i]) !== key || (only === 'unset' && hasFraming(o))) return o;
            const next = withFraming(o, framing);
            if (JSON.stringify(framingOf(next)) === JSON.stringify(framingOf(o))) return o; // its framing already
            touched = true; changed.push({ panelId: p.id, mark: p.mark, index: i });
            return next;
        });
        return touched ? { ...p, openings } : p;
    });
    return { panels: out, changed };
}
// The trades in a panel's openings (for a legend), in TRADES order.
export const tradesOf = (contexts, colors = null) => Object.keys(TRADES).filter(t => contexts.some(c => c.trade === t)).map(t => ({ trade: t, ...TRADES[t], color: colorOf(t, colors) }));
