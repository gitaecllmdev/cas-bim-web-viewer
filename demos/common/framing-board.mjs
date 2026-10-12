export const LANES = [['backlog','Planned'],['active','In progress'],['review','Your review'],['done','Done']];
const FIELDS = ['title','panel','notes','evidence','owner','due','kind','priority','acceptance','results'];
export function boardError(board, revision = board?.revision) {
    if (!board || ![1,2].includes(board.version) || !Number.isInteger(board.revision) || board.revision < 0 || !Array.isArray(board.cards) || board.cards.length > 200) return [400,'A board, revision and at most 200 cards are required.'];
    if (board.revision !== revision) return [409,'The board changed. Reload before saving so another edit is not overwritten.'];
    const ids = new Set(), lanes = board.version === 1 ? ['agreed','decide','tested','revit'] : LANES.map(([key]) => key);
    for (const c of board.cards) {
        if (!c || typeof c.id !== 'string' || !c.id || c.id.length > 120 || ids.has(c.id) || !lanes.includes(c.lane) || FIELDS.some(k => (board.version === 2 || ['title','panel','notes','evidence'].includes(k)) && (typeof c[k] !== 'string' || c[k].length > 8000))) return [400,'Invalid card fields or duplicate card identity.'];
        if (board.version === 2 && (!['You','Codex'].includes(c.owner) || !['task','test','proposal','rule'].includes(c.kind) || !['high','normal','low'].includes(c.priority) || (c.due && (!/^\d{4}-\d{2}-\d{2}$/.test(c.due) || !Number.isFinite(Date.parse(c.due+'T12:00:00Z')) || new Date(c.due+'T12:00:00Z').toISOString().slice(0,10) !== c.due)))) return [400,'Invalid owner, type, priority or due date.'];
        ids.add(c.id);
    }
    return null;
}
export function normalizeBoard(data, seed) {
    const invalid = boardError(data); if (invalid) throw Error(invalid[1]);
    const migration = {agreed:'done',decide:'backlog',tested:'done',revit:'done'};
    return {...data,version:2,cards:data.cards.map(c => {
        const defaults = seed?.cards.find(s => s.id === c.id);
        return Object.fromEntries([['id',c.id],['lane',data.version === 1 ? (defaults?.lane || migration[c.lane]) : c.lane],...FIELDS.map(k => [k,c[k] ?? defaults?.[k] ?? ({owner:'Codex',kind:'task',priority:'normal'}[k] || '')])]);
    })};
}
// Published updates replace untouched cards; browser edits and deletions remain local.
export function mergePublished(seed, draft, previous) {
    if (!draft) return structuredClone(seed);
    const out = {...seed,cards:[]}, prior = new Map((previous?.cards || []).map(c => [c.id,c])), local = new Map(draft.cards.map(c => [c.id,c]));
    for (const c of seed.cards) {
        const old = prior.get(c.id), own = local.get(c.id);
        if (old && !own) continue;
        out.cards.push(own && JSON.stringify(own) !== JSON.stringify(old) ? own : c);
        local.delete(c.id);
    }
    for (const c of local.values()) if (!prior.has(c.id) || JSON.stringify(c) !== JSON.stringify(prior.get(c.id))) out.cards.push(c);
    if (draft.project !== previous?.project) out.project = draft.project;
    return out;
}
