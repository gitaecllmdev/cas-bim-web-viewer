export const LANES = [['backlog','Planned'],['active','In progress'],['review','Your review'],['done','Done']];
export const cardReference = number => '#'+String(number).padStart(3,'0');
const FIELDS = ['title','panel','notes','evidence','owner','due','kind','priority','acceptance','results'];
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value;
export const isWeekend = value => validDate(value) && [0,6].includes(new Date(value+'T12:00:00Z').getUTCDay());
export function boardError(board, revision = board?.revision) {
    if (!board || ![1,2].includes(board.version) || !Number.isInteger(board.revision) || board.revision < 0 || !Array.isArray(board.cards) || board.cards.length > 200) return [400,'A board, revision and at most 200 cards are required.'];
    if (board.revision !== revision) return [409,'The board changed. Reload before saving so another edit is not overwritten.'];
    if (board.nextNumber !== undefined && (!Number.isSafeInteger(board.nextNumber) || board.nextNumber < 1001)) return [400,'Invalid next card number.'];
    if (board.plan !== undefined && (!board.plan || !validDate(board.plan.start) || !validDate(board.plan.end) || board.plan.end < board.plan.start || typeof board.plan.summary !== 'string' || board.plan.summary.length > 1000)) return [400,'Invalid plan dates or summary.'];
    const ids = new Set(), numbers = new Set(), lanes = board.version === 1 ? ['agreed','decide','tested','revit'] : LANES.map(([key]) => key);
    for (const c of board.cards) {
        if (!c || typeof c.id !== 'string' || !c.id || c.id.length > 120 || ids.has(c.id) || !lanes.includes(c.lane) || FIELDS.some(k => (board.version === 2 || ['title','panel','notes','evidence'].includes(k)) && (typeof c[k] !== 'string' || c[k].length > 8000))) return [400,'Invalid card fields or duplicate card identity.'];
        if (board.version === 2 && (!['You','Codex'].includes(c.owner) || !['task','test','proposal','rule'].includes(c.kind) || !['high','normal','low'].includes(c.priority) || (c.due && (!/^\d{4}-\d{2}-\d{2}$/.test(c.due) || !Number.isFinite(Date.parse(c.due+'T12:00:00Z')) || new Date(c.due+'T12:00:00Z').toISOString().slice(0,10) !== c.due)))) return [400,'Invalid owner, type, priority or due date.'];
        ids.add(c.id);
        if (c.dependsOn !== undefined && (!Array.isArray(c.dependsOn) || c.dependsOn.length > 50 || c.dependsOn.some(n=>!Number.isSafeInteger(n)||n<1||n===c.number) || new Set(c.dependsOn).size!==c.dependsOn.length)) return [400,'Invalid prerequisite references.'];
        if (c.number !== undefined) {
            if (!Number.isSafeInteger(c.number) || c.number < 1 || numbers.has(c.number)) return [400,'Card numbers must be positive and unique.'];
            numbers.add(c.number);
        }
    }
    return null;
}
// Published cards have committed numbers. Local additions use a separate sequence;
// keeping its high-water mark prevents deleted references being reused.
export function numberBoard(board, seed) {
    const used = new Set(board.cards.map(c=>c.number).filter(n=>n!==undefined));
    const reserved = new Map((seed?.cards||[]).map(c=>[c.number,c.id]).filter(([n])=>n!==undefined));
    let next = Math.max(1001,board.nextNumber||1001,...[...used].filter(n=>n>=1001).map(n=>n+1));
    const cards = board.cards.map(c=>{
        const canonical = seed?.cards.find(s=>s.id===c.id)?.number;
        let number = c.number ?? canonical;
        if (number !== undefined && ((canonical !== undefined && number!==canonical) || (reserved.has(number)&&reserved.get(number)!==c.id))) throw Error('A published card number belongs to a different item.');
        if (number === undefined) { while(used.has(next)||reserved.has(next))next++;number=next++; }
        used.add(number);return {...c,number};
    });
    return {...board,cards,nextNumber:next};
}
export function normalizeBoard(data, seed) {
    const invalid = boardError(data); if (invalid) throw Error(invalid[1]);
    const migration = {agreed:'done',decide:'backlog',tested:'done',revit:'done'};
    const normalized = numberBoard({...data,version:2,cards:data.cards.map(c => {
        const defaults = seed?.cards.find(s => s.id === c.id);
        return Object.fromEntries([['id',c.id],['number',c.number ?? defaults?.number],['dependsOn',c.dependsOn ?? []],['lane',data.version === 1 ? (defaults?.lane || migration[c.lane]) : c.lane],...FIELDS.map(k => [k,c[k] ?? defaults?.[k] ?? ({owner:'Codex',kind:'task',priority:'normal'}[k] || '')])]);
    })},seed);
    const error=boardError(normalized);if(error)throw Error(error[1]);return normalized;
}
// Merge by field: a local result must not hide a new published deadline or dependency.
// Conflicting fields and explicit deletions remain local.
export function mergePublished(seed, draft, previous) {
    if (!draft) return structuredClone(seed);
    const out = {...seed,cards:[]}, prior = new Map((previous?.cards || []).map(c => [c.id,c])), local = new Map(draft.cards.map(c => [c.id,c]));
    for (const c of seed.cards) {
        const old = prior.get(c.id), own = local.get(c.id);
        if (old && !own) continue;
        const merged = own && old ? Object.fromEntries([...new Set([...Object.keys(c),...Object.keys(own)])].map(k=>[k,JSON.stringify(own[k])!==JSON.stringify(old[k])?own[k]:c[k]])) : own || c;
        out.cards.push(merged);
        local.delete(c.id);
    }
    for (const c of local.values()) if (!prior.has(c.id) || JSON.stringify(c) !== JSON.stringify(prior.get(c.id))) out.cards.push(c);
    if (draft.project !== previous?.project) out.project = draft.project;
    return numberBoard({...out,nextNumber:Math.max(seed.nextNumber||1001,draft.nextNumber||1001)},seed);
}
