// An opening's members read the way an engineer's schedule is: the rule that covers it (wall depth and finish, wall
// height, height above the opening, the opening's width), the small schedule that rule sits in (wall height rows by
// width columns), and for each member what is in force and where it came from (the rule, set here, the panel default).
// Pure: the catalog read and project selection (style-catalog.mjs), the panel; the page draws it.
// Matching is style-catalog.mjs matchOpeningStyle (the native resolver's rules and order); nothing here re-ranks it.
import * as G from './generator.mjs';
import * as SC from './style-catalog.mjs';

const FT = 1 / 12;
const ft = (row, key) => { const v = SC.feetOf(row.conditions, key); return Number.isFinite(v) ? v : 0; };

// The rows a schedule for this opening is drawn from: the matcher's context (rows linked to the wall's style first, else
// unlinked rows of the wall's depth or of none), every width and height band, covering or not.
export function contextRows(rows, query) {
    const live = rows.filter(r => r.styleType === query.styleType && !r.isDeleted);
    const wanted = SC.wallStyleKeyOf(query.wallStyleKey || '');
    const linked = wanted ? live.filter(r => SC.textOf(r.conditions, 'WallStyleKey') && SC.wallStyleKeyOf(SC.textOf(r.conditions, 'WallStyleKey')).toLowerCase() === wanted.toLowerCase()) : [];
    return linked.length ? linked : live.filter(r => !SC.textOf(r.conditions, 'WallStyleKey')
        && (!SC.textOf(r.conditions, 'DepthCode') || SC.textOf(r.conditions, 'DepthCode').toLowerCase() === String(query.depthCode || '').toLowerCase()));
}
// Why a row does or does not cover the opening: [] when it does, else the conditions it misses, in words.
export function missedBy(row, query) {
    const out = [], wallFt = query.wallHeightIn * FT, aboveFt = query.heightAboveOpeningIn * FT, widthFt = query.openingWidthIn * FT;
    if (ft(row, 'MaximumWallHeightFeet') > 0 && wallFt > ft(row, 'MaximumWallHeightFeet') + 1e-6) out.push('the wall is taller');
    if (ft(row, 'MaximumHeightAboveOpeningFeet') > 0 && aboveFt > ft(row, 'MaximumHeightAboveOpeningFeet') + 1e-6) out.push('more wall above the opening');
    if (!SC.isWithin(widthFt, ft(row, 'MinimumOpeningWidthFeet'), ft(row, 'MaximumOpeningWidthFeet'))) out.push('the opening is wider or narrower');
    return out;
}

// The schedule: rows by wall height (and height above), columns by width band, one rule per cell (several: a list).
// -> { columns: [{ min, max }], rows: [{ maxWall, maxAbove, cells: [[row…]] }] }
export function scheduleOf(rows, query) {
    const ctx = contextRows(rows, query);
    const colKey = (r) => `${ft(r, 'MinimumOpeningWidthFeet')}|${ft(r, 'MaximumOpeningWidthFeet')}`, rowKey = (r) => `${ft(r, 'MaximumWallHeightFeet')}|${ft(r, 'MaximumHeightAboveOpeningFeet')}`;
    const big = (v) => (v > 0 ? v : Number.MAX_VALUE);
    const columns = [...new Map(ctx.map(r => [colKey(r), { min: ft(r, 'MinimumOpeningWidthFeet'), max: ft(r, 'MaximumOpeningWidthFeet') }])).values()]
        .sort((a, b) => a.min - b.min || big(a.max) - big(b.max));
    const bands = [...new Map(ctx.map(r => [rowKey(r), { maxWall: ft(r, 'MaximumWallHeightFeet'), maxAbove: ft(r, 'MaximumHeightAboveOpeningFeet') }])).values()]
        .sort((a, b) => big(a.maxWall) - big(b.maxWall) || big(a.maxAbove) - big(b.maxAbove));
    return { columns, rows: bands.map(b => ({ ...b, cells: columns.map(c => ctx.filter(r => rowKey(r) === `${b.maxWall}|${b.maxAbove}` && colKey(r) === `${c.min}|${c.max}`)
        .sort((x, y) => SC.ordinalIgnoreCase(x.displayCode, y.displayCode))) })) };
}

// The rule for one door or window: the project's rows (the matcher's verdict), the schedule, the catalog's own verdict
// when the project has nothing that covers it (a rule to add to the project), and the bound row.
// -> { applies: false, why } | { applies: true, query, status, match, eligible, schedule, outsideProject, bound }
export function ruleFor(eng, panel, i) {
    const o = panel.openings[i];
    if (!o) return { applies: false, why: 'none' };
    if (!SC.openingTakesStyle(o)) return { applies: false, why: 'kind' };
    if (!eng) return { applies: false, why: 'no-catalog' };
    const styleType = o.kind === 'door' ? 'Door' : 'Window', read = eng.read;
    const rows = SC.projectStyles(read, eng.selection, styleType).map(s => s.row);
    const wallRow = panel.style ? SC.rowById(read, panel.style.keyId) : null, query = SC.openingQuery(panel, o, wallRow);
    const m = SC.matchOpeningStyle(rows, query);
    let outsideProject = null;
    if (m.status === 'missing') {
        const all = SC.matchOpeningStyle(read.catalog.styles, query);
        if (all.status === 'matched') outsideProject = all.match;
    }
    const bound = o.style ? SC.rowById(read, o.style.keyId) : null;
    return { applies: true, styleType, query, status: m.status, match: m.match, eligible: m.eligible, schedule: scheduleOf(rows.length ? rows : read.catalog.styles, query),
        projectRows: rows.length, outsideProject, bound };
}

// What a rule gives one member of this opening: { text } | { choices } | { notApplicable } | { problem } | null.
export function ruleGives(row, kind, member) {
    if (!row) return null;
    const out = SC.openingStyleOutputs(row, kind);
    if (out.members[member]) return { text: out.members[member] };
    if (out.choices[member]) return { choices: out.choices[member] };
    const p = out.problems.find(x => x.key === member);
    return p ? { problem: p.message } : { notApplicable: true };
}
const same = (a, b) => (G.specText(a) || a) === (G.specText(b) || b);

// Each member of the opening: what is in force, where it came from, what the rule (bound, else matched) gives, and
// whether it needs an arrangement chosen (2+ jamb studs; a header or sill of studs).
// -> [{ member, label, value, source: 'rule' | 'set' | 'default', rule: { code, gives } | null, differs, arrangement:
//      { needed, value } }]
export function memberStates(panel, i, rule = null) {
    const o = panel.openings[i], type = G.OPENING_TYPES[G.kindOf(o)];
    const row = rule?.bound || rule?.match || null;
    return type.members.map(member => {
        const value = G.memberFor(panel, o, member).spec, own = !!o[member];
        const gives = ruleGives(row, o.kind, member);
        const fromRule = own && !!o.style && !!rule?.bound && (gives?.text ? same(o[member], gives.text) : !!gives?.choices?.some(c => same(o[member], c)));
        const studs = G.specParts(value).studQty, styleKey = `${member}Style`;
        const needed = member === 'jamb' ? studs > 1 : studs > 0;
        return { member, label: G.MEMBER_LABELS[member], value, source: fromRule ? 'rule' : own ? 'set' : 'default',
            rule: row && gives && !gives.notApplicable ? { code: row.displayCode, gives } : null,
            differs: !!row && !!gives && !gives.notApplicable && !fromRule && (gives.text ? !same(value, gives.text) : !!gives.choices && !gives.choices.some(c => same(value, c))),
            arrangement: { needed, value: needed ? o[styleKey] || null : null } };
    });
}
