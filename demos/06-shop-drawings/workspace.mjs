// The panel workspace's interaction state, platform-neutral: what is selected and what it links to in every view (the
// preview, the properties, the cut list, the issues), what each issue offers to do, which commands are available,
// undo/redo history, who owns the geometry, the state of each setting, the views and the remembered preferences.
// Pure and DOM-free (no storage, clock or random numbers), so a native WPF workspace can reproduce the same behavior from
// the same resolved plan (framing-plan.mjs). Nothing here changes a member: viewing never touches the framing.
//
// Selection: { kind: 'none' | 'panel' | 'opening' | 'member' | 'mark' | 'issue' | 'setting', key }
//   opening: a source key ('insert:…', 'opening:…'); member: a member key; mark: a cut list label ('C1');
//   issue: an index into plan.issues; setting: a setting path ('members.spacingIn', 'layoutStartIn', 'style.wall').

export const VIEWS = [
    { id: 'sketch', label: 'Sketch', hint: 'Draw and edit the panel: its outline and openings' },
    { id: 'elevation', label: 'Elevation', hint: 'The framing as resolved: every member, its tag and dimensions' },
    { id: 'plan', label: 'Plan', hint: 'The top and bottom track plans: stud positions and which way each faces' },
    { id: '3d', label: '3D', hint: 'The framed panel in 3D (not to scale)' },
    { id: 'drawing', label: 'Drawing', hint: 'The quick shop drawing: the sheet as it prints' },
    // Extension point: observed MWF framing against the proposed CAS plan. It needs a read-only MWF export of the placed
    // members; nothing is written to MWF and no regeneration is invented here.
    { id: 'compare', label: 'Compare', hint: 'Observed MWF framing against this plan', available: false, reason: 'Needs a read-only export of the MWF framing placed in the model (not available yet).' },
];
export const viewIds = VIEWS.filter(v => v.available !== false).map(v => v.id);

// --- Selection and what it links to ------------------------------------------------------------------------------------
export const NONE = Object.freeze({ kind: 'none', key: null });
const openingKeyOf = (plan, key) => (plan?.source?.openings || []).map(o => o.sourceKey).sort((a, b) => b.length - a.length).find(k => key === k || String(key).startsWith(`${k}:`)) || null;
// What a selection highlights everywhere: { memberKeys, marks, openingKeys, issues (indexes), setting }.
export function selectionLinks(plan, sel) {
    const out = { memberKeys: new Set(), marks: new Set(), openingKeys: new Set(), assemblyKeys: new Set(), issues: [], setting: null };
    if (!plan || !sel || sel.kind === 'none' || sel.kind === 'panel') return out;
    const members = plan.members || [], byKey = new Map(members.map(m => [m.memberKey, m]));
    const addMember = (m) => { out.memberKeys.add(m.memberKey); if (m.mark) out.marks.add(m.mark); if (m.assemblyKey) out.assemblyKeys.add(m.assemblyKey); const o = m.tags?.of || openingKeyOf(plan, m.memberKey); if (o) out.openingKeys.add(o); };
    if (sel.kind === 'member') { const m = byKey.get(sel.key); if (m) addMember(m); }
    else if (sel.kind === 'mark') { for (const m of members.filter(x => x.mark === sel.key)) addMember(m); out.marks.add(sel.key); }
    else if (sel.kind === 'opening') { out.openingKeys.add(sel.key); for (const m of members.filter(x => x.tags?.of === sel.key || String(x.memberKey).startsWith(`${sel.key}:`))) { out.memberKeys.add(m.memberKey); if (m.mark) out.marks.add(m.mark); } }
    else if (sel.kind === 'setting') out.setting = sel.key;
    else if (sel.kind === 'issue') {
        const t = issueTarget(plan, plan.issues?.[sel.key]);
        if (t) { const sub = selectionLinks(plan, t); for (const k of ['memberKeys', 'marks', 'openingKeys']) for (const v of sub[k]) out[k].add(v); out.setting = sub.setting; }
        out.issues.push(sel.key);
        return out;
    }
    const whole = sel.kind === 'opening'; // an opening: every issue about it; a member or a label: its own and its assembly's
    (plan.issues || []).forEach((i, n) => { if (issueTouches(i, out, whole)) out.issues.push(n); });
    return out;
}
function issueTouches(issue, links, whole) {
    const keys = [issue.subjectKey, ...(issue.memberKeys || [])];
    return keys.some(k => links.memberKeys.has(k) || links.assemblyKeys.has(k) || (whole && (links.openingKeys.has(k) || [...links.openingKeys].some(o => String(k).startsWith(`${o}:`))))
        || (links.setting && settingOfSubject(k) === links.setting));
}
// The setting an issue subject points at, if any.
function settingOfSubject(subject) {
    const s = String(subject || '');
    if (s === 'detailing.members') return 'members';
    if (s === 'detailing.members.spacingIn') return 'members.spacingIn';
    if (s === 'style:wall') return 'style.wall';
    const m = /^style:(stud|track|topTrack|spacingIn)$/.exec(s);
    return m ? `members.${m[1]}` : null;
}
// Where an issue is: a selection to Locate it (a member, the members of a cut list label, an opening, a setting), or null.
export function issueTarget(plan, issue) {
    if (!issue) return null;
    const keys = new Set((plan?.members || []).map(m => m.memberKey));
    if (issue.memberKeys?.length) return { kind: 'member', key: issue.memberKeys[0] };
    const s = String(issue.subjectKey || '');
    if (keys.has(s)) return { kind: 'member', key: s };
    const assembly = (plan?.members || []).find(m => m.assemblyKey && m.assemblyKey === s);
    if (assembly) return { kind: 'member', key: assembly.memberKey };
    const opening = openingKeyOf(plan, s);
    if (opening) return { kind: 'opening', key: opening };
    const designator = /^catalog:(.+)$/.exec(s)?.[1];
    if (designator) { const m = (plan?.members || []).find(x => x.designator === designator); return m ? { kind: 'mark', key: m.mark } : { kind: 'setting', key: 'members' }; }
    const setting = settingOfSubject(s);
    if (setting) return { kind: 'setting', key: setting };
    if (s === 'source.profile') return { kind: 'setting', key: 'shape' };
    return null;
}

// --- What each issue offers to do (commands the host carries out; none changes the model's geometry) ----------------
// -> { locate: selection | null, actions: [{ command, arg, label }], note }. Commands: select, focus-setting,
// open-framing, toggle-optimizer, open-catalog, set-view.
export function issueActions(plan, issue, { modelLinked = false } = {}) {
    const locate = issueTarget(plan, issue), code = issue?.code || '', a = [];
    const opening = locate?.kind === 'opening' ? locate.key : openingKeyOf(plan, issue?.subjectKey);
    let note = '';
    if (code === 'detailing.spacing_missing' || code === 'member.spacing' || code === 'detailing.spacing_invalid') a.push({ command: 'focus-setting', arg: 'members.spacingIn', label: 'Pick the stud spacing' });
    else if (code === 'detailing.member_unresolved' || code === 'member.unreadable' || code === 'member.depth_mismatch' || code === 'catalog.profile_unknown') a.push({ command: 'focus-setting', arg: 'members', label: 'Pick the members' });
    else if (code === 'assembly.arrangement_unresolved' || code === 'opening.jacks_need_plies' || /^layout\.(no-jamb|no-head|no-sill|through-opening)$/.test(code)) { if (opening) a.push({ command: 'open-framing', arg: opening, label: 'Open framing details' }); }
    else if (code === 'layout.wide_bay') { a.push({ command: 'toggle-optimizer', arg: true, label: 'Try the opening optimizer' }, { command: 'focus-setting', arg: 'layoutStartIn', label: 'Set the first stud' }); }
    else if (code === 'opening.small_penetration' || code === 'opening.small_penetration_conflict') note = 'Not framed by this tool: decide its framing (a sleeve, blocking, or moving it clear of the studs).';
    else if (/^opening\.(size|bounds|rough_opening_bounds|overlap|layout_overlap|above_top_track|header_room|sill_low|steel_sill)$/.test(code)) {
        if (modelLinked && /^(insert|geometry):/.test(String(opening || ''))) note = 'The model\'s opening: its size and place stay as the model has them (change it in Revit, or duplicate the panel as an unlinked copy).';
        else if (opening) a.push({ command: 'select', arg: { kind: 'opening', key: opening }, label: 'Edit the opening' });
    } else if (/^source\.lock_/.test(code)) note = 'Re-export the wall from Revit: the locked geometry cannot be checked here.';
    else if (code === 'opening.study_only') note = 'Added here: a study opening, reported, never an instruction to cut the wall.';
    else if (/^style\./.test(code)) {
        if (/member_differs|out_of_range|depth_mismatch|finish_mismatch|row_revised|row_deleted|not_tables_pick/.test(code)) a.push({ command: 'focus-setting', arg: opening ? `opening-style:${opening}` : 'style.wall', label: 'Pick the style again' });
        a.push({ command: 'open-catalog', arg: null, label: 'Engineering catalog' });
    }
    if (locate && locate.kind !== 'setting') a.unshift({ command: 'select', arg: locate, label: 'Locate' });
    else if (locate?.kind === 'setting' && !a.some(x => x.command === 'focus-setting')) a.unshift({ command: 'focus-setting', arg: locate.key, label: 'Locate' });
    return { locate, actions: a, note };
}

// --- Ownership: who owns each part of the geometry --------------------------------------------------------------------
// geometry: 'model' (the Revit wall's outline and its openings: locked) or 'editable'; per opening: 'model' (locked),
// 'study' (added here on a model panel: report-only), 'typed' (a standalone panel's).
export function ownershipOf(plan, { modelLinked = false } = {}) {
    return { geometry: modelLinked ? 'model' : 'editable',
        openings: (plan?.source?.openings || []).map(o => ({ key: o.sourceKey, owner: o.locked ? 'model' : o.origin === 'study' ? 'study' : 'typed', locked: !!o.locked, status: o.status })),
        duplicate: modelLinked ? { label: 'Duplicate as an unlinked copy', explain: 'The copy is not linked to the Revit wall: its outline and openings become editable, and it no longer reports to the model.' }
            : { label: 'Duplicate', explain: 'A copy of this panel.' } };
}

// --- Settings: inherited, overridden, from the model, from a style, unresolved -----------------------------------------
// A source string of the resolved plan's intent (framing-plan.mjs intentOf) as a state and a short label.
export function settingState(source) {
    const s = String(source || '');
    if (s === 'unresolved') return { state: 'unresolved', label: 'unresolved' };
    if (s === 'missing') return { state: 'unresolved', label: 'not given' };
    if (s === 'source') return { state: 'model', label: 'from the model' };
    if (s === 'style') return { state: 'style', label: 'from the style' };
    if (s === 'user' || s === 'detailing' || s === 'opening') return { state: 'overridden', label: 'set here' };
    if (s === 'inherit') return { state: 'inherited', label: 'inherited' };
    if (s.startsWith('inherit') || s === 'panel-default') return { state: 'inherited', label: s === 'panel-default' ? 'panel default' : `as the ${s.replace(/^inherit:/, '').replace(/ \(explicit\)$/, '')}` };
    if (s.startsWith('default') || s === 'standard') return { state: 'default', label: 'default' };
    if (s === 'model-opening-default-0') return { state: 'inherited', label: 'the model\'s cut' };
    return { state: 'default', label: s || 'default' };
}

// --- Commands: what is available now, and why not -------------------------------------------------------------------
export function commandState({ panels = 0, current = null, plan = null, selection = NONE, history = null, modelLinked = false, openingLocked = false } = {}) {
    const has = panels > 0 && !!current, drawn = !!plan?.states?.canPreview;
    const unresolved = !!plan && drawn && !plan.states.translationReady;
    return {
        undo: { enabled: !!history?.past?.length, label: history?.past?.length ? `Undo ${history.past[history.past.length - 1].label}` : 'Undo' },
        redo: { enabled: !!history?.future?.length, label: history?.future?.length ? `Redo ${history.future[history.future.length - 1].label}` : 'Redo' },
        duplicate: { enabled: has, ...(modelLinked ? { label: 'Duplicate as an unlinked copy' } : { label: 'Duplicate' }) },
        deleteOpening: { enabled: has && selection.kind === 'opening' && !openingLocked, reason: openingLocked ? 'The model\'s opening: it stays as the model has it.' : '' },
        pdf: { enabled: has && drawn, reason: !drawn ? 'Nothing framed to draw yet.' : unresolved ? 'Prints marked PRELIMINARY: choices are still open.' : '' },
        exportPlan: { enabled: panels > 0 },
    };
}

// --- Undo/redo: whole-document snapshots with a label (pure: returns new states) ---------------------------------------
export const newHistory = (limit = 80) => ({ past: [], future: [], limit });
// Before a change: the state as it was, under the change's label. Repeats of one label within `mergeKey` (typing in
// one field) keep the first snapshot only.
export function record(h, snapshot, label, mergeKey = null) {
    const last = h.past[h.past.length - 1];
    if (mergeKey && last && last.mergeKey === mergeKey) return { ...h, future: [] };
    const past = [...h.past, { snapshot, label, mergeKey }].slice(-h.limit);
    return { ...h, past, future: [] };
}
export function undo(h, current) {
    if (!h.past.length) return { history: h, snapshot: null };
    const last = h.past[h.past.length - 1];
    return { history: { ...h, past: h.past.slice(0, -1), future: [...h.future, { snapshot: current, label: last.label }] }, snapshot: last.snapshot, label: last.label };
}
export function redo(h, current) {
    if (!h.future.length) return { history: h, snapshot: null };
    const next = h.future[h.future.length - 1];
    return { history: { ...h, future: h.future.slice(0, -1), past: [...h.past, { snapshot: current, label: next.label }] }, snapshot: next.snapshot, label: next.label };
}

// --- Remembered presentation preferences (never data: no panel, no member) --------------------------------------------
export const DEFAULT_PREFS = Object.freeze({ navCollapsed: false, view: 'sketch', bottom: 'cut', bottomOpen: true, sections: {} });
export function cleanPrefs(raw) {
    const p = raw && typeof raw === 'object' ? raw : {};
    return { navCollapsed: !!p.navCollapsed, view: viewIds.includes(p.view) ? p.view : DEFAULT_PREFS.view, bottom: ['issues', 'openings'].includes(p.bottom) ? p.bottom : 'cut', bottomOpen: p.bottomOpen !== false,
        sections: Object.fromEntries(Object.entries(p.sections && typeof p.sections === 'object' ? p.sections : {}).filter(([k, v]) => /^[a-z-]{1,24}$/.test(k) && typeof v === 'boolean')) };
}
