// The resolved framing plan: the Panel Shop Generator's calculation as a pure, deterministic contract for a native
// (C#) port and for the preview, cut list and export alike. No DOM, canvas, storage, clock or random numbers; inputs are
// never mutated; the same inputs, rule version and catalog give the same plan (member keys, coordinates, order, issues).
//
//   resolveFramingPlan(snapshot, detailing, catalog?, engineering?) -> plan
//     snapshot  (cas-panel-snapshot v1): the LOCKED source: identity, profile (outline/top), openings as they are.
//     detailing (cas-panel-detailing v1): the EDITABLE intent: members, spacing, layout start/direction, stud facing,
//               opening framing (members, arrangements, offsets, jambs on the layout), clips, the view side.
//     catalog   (cas-member-catalog v1): member profiles by stable key; omitted: derived from the SSMA designators used.
//     engineering { read, selection }: the engineering style catalog as read (style-catalog.mjs readStyleCatalog) and the
//               project selection; checks the panel's style bindings (intent.styles, states.engineering) only.
//   snapshotFromPanel(panel, { documentId }) / detailingFromPanel(panel): split a generator panel into the two inputs.
//   planToNativeFeet(plan): the same plan in decimal feet (inches / 12, once), for the native backend.
//
// Reuses the existing engine (generator.mjs frameInputs, framing.mjs frameWall): no second layout algorithm. The
// contract (axes, units, part records, orientation, cut rules, rounding, issues, states) is documented in
// docs/framing-plan-contract.md; reviewed fixtures in tests/fixtures/framing-plan/.
import { frameWall, flipLayout, webOnRight, topAt, underAt, SEAT_ALLOWANCE_IN } from '../common/framing.mjs';
import * as G from './generator.mjs';
import { sha256Hex } from '../common/sha256.mjs';
import { checkStyleBindings } from './style-catalog.mjs';

export const SNAPSHOT_FORMAT = 'cas-panel-snapshot', DETAILING_FORMAT = 'cas-panel-detailing', PLAN_FORMAT = 'cas-framing-plan', CATALOG_FORMAT = 'cas-member-catalog';
export const CONTRACT_VERSION = 1;
export const RULE_VERSION = 'cas-web-framing/1';
export const UNIT = 'in';
export const AXES = {
    x: 'along the panel from its left end as seen from side A',
    y: 'up from the bottom of the panel (top of the slab)',
    z: 'through the framing layer from the side A face (0) toward side B (+depth)',
};
export const SEVERITIES = ['error', 'needs-resolution', 'warning'];
const ROUND = 'floor-1/8'; // cut lengths: rounded DOWN to 1/8" (framing.mjs floor8); placement stays full precision

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const canonical = (v) => JSON.stringify(v, (k, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));

// --- Splitting a generator panel into the locked snapshot and the editable detailing --------------------------------
export function snapshotFromPanel(panel, { documentId = null } = {}) {
    const p = G.cleanPanel(panel), model = G.isFromModel(p), keys = G.openingKeys(p);
    const { lengthIn, heightIn, top } = G.shapeTop(p.shape);
    const inserts = model && Array.isArray(p.revit.inserts) ? p.revit.inserts : [];
    const openings = p.openings.map((o, i) => {
        const insert = keys[i].startsWith('insert:') ? inserts.find(x => `insert:${x.uniqueId}` === keys[i]) : null;
        const locked = !!(model && o.locked);
        return { sourceKey: keys[i], kind: o.kind, leftIn: o.leftIn, widthIn: o.widthIn, heightIn: o.heightIn, sillIn: o.sillIn, locked,
            origin: locked ? (insert ? 'model-insert' : 'model-geometry') : model ? 'study' : 'typed',
            insert: insert ? { uniqueId: insert.uniqueId, category: insert.category ?? null, family: insert.family ?? null, type: insert.type ?? null } : null,
            // How the kind is known: a model insert's category alone is not proof (a plumbing opening can be a Window).
            classification: { kind: o.kind, evidence: insert ? (insert.category ? `category:${insert.category}` : 'insert') : locked ? 'geometry' : 'typed' } };
    });
    const snapshot = {
        format: SNAPSHOT_FORMAT, version: CONTRACT_VERSION, unit: UNIT, kind: model ? 'model' : 'standalone',
        identity: { documentId: model ? documentId ?? null : null, panelUniqueId: model ? p.revit.uniqueId ?? null : null, elementId: model ? p.revit.elementId ?? null : null,
            mark: p.mark, displayNumber: model ? p.revit.panelNumber ?? null : null, webPanelId: p.id },
        profile: { shape: structuredClone(p.shape), lengthIn, heightIn, top: top ? top.map(q => [q[0], q[1]]) : [[0, heightIn], [lengthIn, heightIn]],
            ...(model && p.outline ? { outline: p.outline } : {}) },
        wall: { thicknessIn: model && finite(p.revit.thicknessIn) ? p.revit.thicknessIn : null },
        openings,
        lock: model ? verifyLockedSource(p) : { status: 'not-applicable', hashVersion: null, exported: null, computed: null },
    };
    snapshot.fingerprint = snapshotFingerprint(snapshot);
    return snapshot;
}
// Exact values (no display rounding), openings in key order (their list order does not matter), outline order does.
export function snapshotFingerprint(s) {
    return `sha256:${sha256Hex(canonical({ v: 'cas-panel-snapshot/1', identity: [s.identity?.documentId ?? null, s.identity?.panelUniqueId ?? null],
        profile: { lengthIn: s.profile?.lengthIn, heightIn: s.profile?.heightIn, top: s.profile?.top, outline: s.profile?.outline ?? null }, thicknessIn: s.wall?.thicknessIn ?? null,
        openings: [...(s.openings || [])].sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0))
            .map(o => [o.sourceKey, o.kind, o.leftIn, o.widthIn, o.heightIn, o.sillIn, !!o.locked]) }))}`;
}
const OPENING_DETAIL = ['offsets', 'head', 'jamb', 'sill', 'offsetIn', 'jambStyle', 'headStyle', 'sillStyle', 'headBearing', 'crippleEnds', 'toLayout'];
export function detailingFromPanel(panel) {
    const p = G.cleanPanel(panel), keys = G.openingKeys(p);
    return {
        format: DETAILING_FORMAT, version: CONTRACT_VERSION, unit: UNIT,
        members: { stud: p.members.stud, track: p.members.track, topTrack: p.members.topTrack, spacingIn: p.members.spacingIn ?? null,
            header: p.members.header, jamb: p.members.jamb, sill: p.members.sill },
        provenance: p.provenance ? { ...p.provenance } : null,
        layout: { startIn: p.layoutStartIn ?? null, fromRight: !!p.layoutFromRight, optimize: !!p.optimizeOpenings },
        studs: { flipAll: !!p.flipStuds, flips: [...(p.studFlips || [])], ...(p.cutbackIn != null ? { cutbackIn: p.cutbackIn } : {}), ...(p.deflectionGapIn != null ? { deflectionGapIn: p.deflectionGapIn } : {}), seatPieces: p.seatPieces !== false, seatTop: p.seatTop !== false },
        ...(p.headEnds === 'flush' ? { heads: { ends: 'flush', cutbackIn: p.headCutbackIn ?? 0 } } : {}), ...(p.sillEnds === 'flush' ? { sills: { ends: 'flush', cutbackIn: p.sillCutbackIn ?? 0 } } : {}),
        openings: Object.fromEntries(p.openings.map((o, i) => [keys[i], Object.fromEntries(OPENING_DETAIL.filter(k => o[k] !== undefined && o[k] !== '').map(k => [k, o[k]]))])),
        clips: (p.clips || []).map(c => ({ ...c })),
        view: { side: p.sideB ? 'B' : 'A' },
        ...(p.manual ? { manual: structuredClone(p.manual) } : {}), // members placed by hand (generator.mjs applyManual)
        ...stylesOf(p, keys),
    };
}
// The engineering styles a panel was given (style-catalog.mjs): the wall's, each door's and window's (by opening key),
// and what the wall matcher was asked (finish, a depth code when the stud is not one member). Only when there are any.
function stylesOf(p, keys) {
    const openings = Object.fromEntries(p.openings.map((o, i) => [keys[i], o.style ? { ...o.style } : null]).filter(([, b]) => b));
    if (!p.style && !p.styleQuery && !Object.keys(openings).length) return {};
    return { styles: { query: p.styleQuery ? { ...p.styleQuery } : null, wall: p.style ? { ...p.style } : null, openings } };
}

// --- The model's locked geometry: cas-profile-v1, the hash the Revit exporter writes ---------------------------------
// Canonical string (same as the exporter's): the top line, the model's openings (sorted), location line, height,
// thickness, side A, left end and wall normal; lengths to 1/16" as String(Math.round(v * 16) / 16) (JavaScript
// rounding: .5 up), the normal to 1e-9. 'sha256:' + the first 16 hex digits. Openings added here are left out.
export function profileHash(panel) {
    const p = panel, r = p.revit, { lengthIn: L, heightIn: H, top } = G.shapeTop(p.shape);
    const fmt = (v) => String(Math.round(v * 16) / 16), point = (q) => q.map(fmt).join(',');
    const line = top || [[0, H], [L, H]];
    const n = Math.hypot(...r.orientation);
    if (!(n > 0)) throw new Error('The wall orientation is not a direction.');
    const openings = (p.openings || []).filter(o => o.locked).map(o => `${o.kind}:${['leftIn', 'widthIn', 'heightIn', 'sillIn'].map(k => fmt(o[k] ?? 0)).join(',')}`).sort();
    const text = `cas-profile-v1|top:${line.map(point).join(';')}|openings:${openings.join(';')}|line:${point(r.locationLine.start)};${point(r.locationLine.end)}`
        + `|height:${fmt(r.heightIn)}|thickness:${fmt(r.thicknessIn)}|side:${r.sideA ?? 'exterior'}|left:${r.leftEnd ?? ''}|normal:${r.orientation.map(v => String(Math.round(v / n * 1e9) / 1e9)).join(',')}`;
    return `sha256:${sha256Hex(text).slice(0, 16)}`;
}
// verified: the locked geometry here is what the model exported; mismatch: it is not (never framed); not-provided: the
// file has no hash (framed, with a warning); unverifiable: the hash cannot be computed from what the file gives.
export function verifyLockedSource(panel) {
    const exported = panel.revit?.geometryHash ?? null;
    let computed = null;
    try { computed = profileHash(panel); } catch { return { status: 'unverifiable', hashVersion: 'cas-profile-v1', exported, computed: null }; }
    return { status: !exported ? 'not-provided' : exported === computed ? 'verified' : 'mismatch', hashVersion: 'cas-profile-v1', exported, computed };
}

// --- Member catalog --------------------------------------------------------------------------------------------------
// A profile by stable key, its dimensions and units; revitBinding stays null here (a family type is the model's, by
// UniqueId, resolved natively; a name or SSMA string is never one).
export function profileFromDesignator(name) {
    const d = G.parseMember(name);
    if (!d) return null;
    const stud = /^(S|CS|CT)$/.test(d.profile || '');
    return { key: `ssma:${d.name}`, designator: d.name, kind: stud ? 'stud' : 'track', depthIn: d.depthIn, flangeIn: d.flangeIn ?? null, mils: d.mils, revitBinding: null };
}
export function designatorCatalog(designators) {
    const profiles = [...new Set(designators)].map(profileFromDesignator).filter(Boolean).sort((a, b) => (a.key < b.key ? -1 : 1));
    return { format: CATALOG_FORMAT, version: CONTRACT_VERSION, catalogVersion: 'ssma-designator/1', source: 'designator', profiles };
}

// --- Input checks ----------------------------------------------------------------------------------------------------
function checkInputs(snapshot, detailing, catalog, issue) {
    if (!isObj(snapshot) || snapshot.format !== SNAPSHOT_FORMAT || snapshot.version !== CONTRACT_VERSION) issue('input.snapshot_format', 'error', 'snapshot', `The snapshot must be ${SNAPSHOT_FORMAT} version ${CONTRACT_VERSION}.`);
    else {
        if (snapshot.unit !== UNIT) issue('input.unit', 'error', 'snapshot', `The snapshot's unit must be "${UNIT}".`);
        if (!['model', 'standalone'].includes(snapshot.kind)) issue('input.snapshot_kind', 'error', 'snapshot', 'The snapshot kind must be model or standalone.');
        const pr = snapshot.profile;
        const okTop = Array.isArray(pr?.top) && pr.top.length >= 2 && pr.top.every((q, i) => Array.isArray(q) && finite(q[0]) && finite(q[1]) && q[1] > 0 && (i === 0 || q[0] > pr.top[i - 1][0]));
        if (!isObj(pr) || !finite(pr.lengthIn) || !(pr.lengthIn > 0) || !finite(pr.heightIn) || !(pr.heightIn > 0) || !okTop || !isObj(pr.shape))
            issue('source.invalid_profile', 'error', 'source.profile', 'The panel profile needs a positive finite length, height and top line (points left to right).');
        const seen = new Set();
        for (const o of Array.isArray(snapshot.openings) ? snapshot.openings : []) {
            if (!isObj(o) || typeof o.sourceKey !== 'string' || !o.sourceKey) { issue('source.opening_identity', 'error', 'source.openings', 'Every opening needs a source key.'); continue; }
            if (seen.has(o.sourceKey)) issue('source.duplicate_opening', 'error', o.sourceKey, `Two openings share the key ${o.sourceKey}.`);
            seen.add(o.sourceKey);
            if (!G.OPENING_TYPES[o.kind]) issue('source.opening_kind', 'error', o.sourceKey, `Unsupported opening kind "${o.kind}".`);
            if (!['leftIn', 'widthIn', 'heightIn', 'sillIn'].every(k => finite(o[k]) && o[k] >= 0)) issue('source.opening_values', 'error', o.sourceKey, 'An opening needs finite, non-negative left, width, height and sill.');
        }
        if (!Array.isArray(snapshot.openings)) issue('source.openings', 'error', 'source.openings', 'The snapshot needs an openings list (empty is fine).');
        if (snapshot.kind === 'model' && !(typeof snapshot.identity?.panelUniqueId === 'string' && snapshot.identity.panelUniqueId))
            issue('source.identity_missing', 'error', 'source.identity', 'A model panel needs its wall UniqueId.');
    }
    if (!isObj(detailing) || detailing.format !== DETAILING_FORMAT || detailing.version !== CONTRACT_VERSION) issue('input.detailing_format', 'error', 'detailing', `The detailing must be ${DETAILING_FORMAT} version ${CONTRACT_VERSION}.`);
    else {
        if (detailing.unit != null && detailing.unit !== UNIT) issue('input.unit', 'error', 'detailing', `The detailing's unit must be "${UNIT}".`);
        const sp = detailing.members?.spacingIn;
        if (sp != null && !(finite(sp) && sp > 0)) issue('detailing.spacing_invalid', 'error', 'detailing.members.spacingIn', 'Stud spacing must be a positive finite number of inches.');
        for (const k of Object.keys(detailing.openings || {})) if (!(snapshot?.openings || []).some(o => o?.sourceKey === k))
            issue('detailing.orphan_opening', 'warning', k, `Opening framing is set for ${k}, which is not in the source (removed or renamed in the model?): ignored.`);
    }
    if (catalog != null && (!isObj(catalog) || catalog.format !== CATALOG_FORMAT || catalog.version !== CONTRACT_VERSION || !Array.isArray(catalog.profiles)))
        issue('input.catalog_format', 'error', 'catalog', `The catalog must be ${CATALOG_FORMAT} version ${CONTRACT_VERSION}.`);
}

// The generator panel for a snapshot and detailing (the engine's own input shape); each opening carries its key.
function panelFrom(snapshot, detailing) {
    const model = snapshot.kind === 'model';
    const members = { ...G.DEFAULT_MEMBERS, ...Object.fromEntries(Object.entries(detailing.members || {}).filter(([k]) => k in G.DEFAULT_MEMBERS)) };
    if (members.spacingIn == null) members.spacingIn = model ? null : G.DEFAULT_MEMBERS.spacingIn;
    return {
        id: snapshot.identity?.webPanelId || 'plan', mark: snapshot.identity?.mark || '', shape: structuredClone(snapshot.profile.shape), members,
        ...(model ? { revit: { uniqueId: snapshot.identity.panelUniqueId } } : {}),
        openings: snapshot.openings.map(o => ({ key: o.sourceKey, kind: o.kind, leftIn: o.leftIn, widthIn: o.widthIn, heightIn: o.heightIn, sillIn: o.sillIn,
            head: '', jamb: '', sill: '', ...(o.locked ? { locked: true } : {}), ...structuredClone(detailing.openings?.[o.sourceKey] || {}) })),
        ...(finite(detailing.layout?.startIn) && detailing.layout.startIn > 0 ? { layoutStartIn: detailing.layout.startIn } : {}),
        layoutFromRight: !!detailing.layout?.fromRight, optimizeOpenings: !!detailing.layout?.optimize,
        flipStuds: !!detailing.studs?.flipAll, studFlips: [...(detailing.studs?.flips || [])], clips: (detailing.clips || []).map(c => ({ ...c })), sideB: false,
        ...(finite(detailing.studs?.cutbackIn) ? { cutbackIn: detailing.studs.cutbackIn } : {}),
        ...(detailing.studs?.deflectionGapIn != null ? { deflectionGapIn: detailing.studs.deflectionGapIn } : {}),
        // Seating as the detailing says; absent (the contract's fixtures): clear span, tops too.
        seatPieces: detailing.studs?.seatPieces === true, seatTop: detailing.studs?.seatTop === true,
        ...(detailing.heads?.ends === 'flush' ? { headEnds: 'flush', headCutbackIn: finite(detailing.heads.cutbackIn) ? detailing.heads.cutbackIn : 0 } : {}),
        ...(detailing.sills?.ends === 'flush' ? { sillEnds: 'flush', sillCutbackIn: finite(detailing.sills.cutbackIn) ? detailing.sills.cutbackIn : 0 } : {}),
        ...(detailing.manual ? { manual: structuredClone(detailing.manual) } : {}),
    };
}

// --- The plan -----------------------------------------------------------------------------------------------------------
export function resolveFramingPlan(snapshot, detailing, catalog = null, engineering = null) {
    const issues = [], members = [], accessories = [], graphics = [];
    const issue = (code, severity, subjectKey, message, extra = {}) => issues.push({ code, severity, subjectKey: subjectKey || '', message, ...extra });
    const plan = { format: PLAN_FORMAT, contractVersion: CONTRACT_VERSION, ruleVersion: RULE_VERSION, unit: UNIT, axes: AXES, requiredFeatures: [],
        source: null, intent: null, members, accessories, cutList: [], graphics, issues, notes: [], states: null };
    checkInputs(snapshot, detailing, catalog, issue);
    const done = (layout = null) => {
        issues.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
        const errors = issues.some(i => i.severity === 'error'), open = issues.some(i => i.severity === 'needs-resolution');
        if (!members.length && !errors && !issues.some(i => i.code === 'plan.empty')) issues.push({ code: 'plan.empty', severity: 'needs-resolution', subjectKey: '', message: 'No physical members were resolved.' });
        const geometryInvalid = issues.some(i => i.severity === 'error' && /^(source\.|input\.shape|input\.snapshot)/.test(i.code));
        plan.states = { geometry: geometryInvalid ? 'invalid' : 'valid', canPreview: !errors && members.length > 0,
            translationReady: !errors && !open && members.length > 0 && !issues.some(i => i.severity === 'needs-resolution'), engineering: plan.intent?.styles?.state ?? 'not-reviewed' };
        Object.defineProperty(plan, 'layout', { value: layout, enumerable: false }); // derived drawing (side A), for the sheet; not part of the JSON
        return plan;
    };
    if (issues.some(i => i.severity === 'error')) return done();

    const model = snapshot.kind === 'model', panel = panelFrom(snapshot, detailing), H = snapshot.profile.heightIn;
    // Source facts, as given (the actual rough openings) and as they will be framed.
    plan.source = { kind: snapshot.kind, identity: { ...snapshot.identity }, fingerprint: snapshotFingerprint(snapshot), lock: snapshot.lock ? { ...snapshot.lock } : null,
        profile: { lengthIn: snapshot.profile.lengthIn, heightIn: H, top: snapshot.profile.top }, openings: [] };
    if (model && snapshot.lock?.status === 'mismatch') issue('source.lock_mismatch', 'error', snapshot.identity.panelUniqueId, 'The locked geometry differs from what the model exported (its profile hash does not match): re-export the wall; nothing is framed.');
    if (model && snapshot.lock?.status === 'not-provided') issue('source.lock_not_provided', 'warning', snapshot.identity.panelUniqueId, 'The export has no profile hash: the locked geometry cannot be checked against the model.');
    if (model && snapshot.lock?.status === 'unverifiable') issue('source.lock_unverifiable', 'warning', snapshot.identity.panelUniqueId, 'The profile hash cannot be computed from this export (location line, height, thickness or orientation missing).');

    // Inputs in plain words first (generator rules; coded): a missing or unresolved choice on a model panel waits for
    // detailing; anything else is an error. Either way nothing is framed (no placeholder framing).
    const keys = snapshot.openings.map(o => o.sourceKey);
    for (const e of G.panelErrors(panel)) {
        const at = /^opening-(\d+)$/.exec(e.where);
        issue(e.code || 'input.invalid', /^detailing\./.test(e.code || '') ? 'needs-resolution' : 'error', at ? keys[Number(at[1])] : e.where === 'members' ? 'detailing.members' : 'source.profile', e.message);
    }
    // Openings: what the model owns, what is framed, and what is not.
    const smallKeys = new Set();
    snapshot.openings.forEach((o, i) => {
        const go = panel.openings[i], small = G.isSmallPenetration(panel, go), box = G.openingBox(go, H);
        if (small) smallKeys.add(o.sourceKey);
        if (small) issue('opening.small_penetration', 'needs-resolution', o.sourceKey, `${o.sourceKey}: a ${o.widthIn}" x ${o.heightIn}" opening is under the ${G.MIN_FRAMED_OPENING_IN}" this tool frames: not framed. Decide its framing (sleeve, blocking, or move clear of the studs).`);
        if (o.origin === 'model-insert' && /^category:/.test(o.classification?.evidence || '')) issue('opening.classification_category_only', 'warning', o.sourceKey, `${o.sourceKey} is a ${o.kind} by its Revit category only (${o.insert?.family ?? ''} : ${o.insert?.type ?? ''}): its kind is not proven by family, type or marker evidence.`);
        if (o.origin === 'model-geometry') issue('opening.insert_identity_unproven', 'warning', o.sourceKey, `${o.sourceKey}: a model opening with no proven insert (known by its geometry only). It stays locked as the model's geometry; no insert is assumed.`);
        if (o.origin === 'study') issue('opening.study_only', 'warning', o.sourceKey, `${o.sourceKey} was added here: a study opening, report-only. It is not an instruction to cut the wall.`);
        plan.source.openings.push({ sourceKey: o.sourceKey, kind: o.kind, origin: o.origin, locked: !!o.locked, insert: o.insert ? { ...o.insert } : null, classification: { ...(o.classification || {}) },
            actual: { left: box.left, right: box.right, bottom: box.bottom, top: box.through ? null : box.top, through: !!box.through },
            framed: null, offsetIn: small ? null : G.offsetOf(go), toLayout: !!go.toLayout, status: small ? 'unsupported:small-penetration' : o.origin === 'study' ? 'study-only' : 'framed' });
    });
    plan.intent = intentOf(panel, snapshot, detailing);
    // Engineering styles: checked against the catalog and the project selection; warnings scoped 'engineering' that set
    // states.engineering and never preview or translation readiness.
    if (detailing.styles) {
        const { result, issues: found } = checkStyleBindings({ ...panel, ...(detailing.styles.query ? { styleQuery: detailing.styles.query } : {}) }, detailing.styles, engineering);
        plan.intent.styles = result;
        issues.push(...found);
    }
    if (issues.some(i => i.severity === 'error' || i.code === 'detailing.member_unresolved' || i.code === 'detailing.spacing_missing')) return done();

    // The layout: the engine's own (side A; the view side never changes it).
    // The same layout the sheet draws (generator.panelLayout: the engine's members, its notes and clips; side A).
    const inputs = G.frameInputs(panel), layout = G.panelLayout({ ...panel, sideB: false });
    plan.notes = [...layout.notes];
    plan.intent.layout = { spacingIn: inputs.spacingIn, startIn: inputs.layoutStartIn || inputs.spacingIn,
        startSource: panel.layoutStartIn > 0 ? 'manual' : panel.optimizeOpenings ? 'optimizer' : 'standard', fromRight: !!panel.layoutFromRight };
    const framedByKey = new Map(inputs.openings.map(o => [o.key, o]));
    for (const so of plan.source.openings) {
        const f = framedByKey.get(so.sourceKey);
        if (f && so.status !== 'unsupported:small-penetration') so.framed = { left: f.left, right: f.right, bottom: f.bottom, top: f.through ? null : f.top };
    }
    const catalogUsed = catalog || designatorCatalog(layout.members.flatMap(m => (m.parts?.length ? m.parts.map(q => q.name) : [m.type])));
    const keyFor = expandMembers(layout, inputs, panel, plan, catalogUsed, issue);
    // A bay wider than the spacing (the engine's own rule, generator.wideBayList): reported per bay, by its two members.
    const n4 = (v) => String(Number(v.toFixed(4)));
    for (const b of G.wideBayList(layout, inputs.spacingIn, inputs.flangeIn)) {
        const keys = b.members.map(i => keyFor.get(i));
        issue('layout.wide_bay', 'warning', keys.join('|'), `${keys[0]} to ${keys[1]}: ${n4(b.widthIn)}" center to center, wider than the ${n4(inputs.spacingIn)}" stud spacing${b.allowanceIn ? ` (with ${n4(b.allowanceIn)}" for a jamb)` : ''}.`, { memberKeys: keys });
    }
    // A small penetration a member runs through: say which.
    for (const so of plan.source.openings.filter(s => smallKeys.has(s.sourceKey))) {
        const a = so.actual, hit = members.filter(m => m.graphicBox && m.graphicBox.x < a.right && m.graphicBox.x + m.graphicBox.w > a.left && m.graphicBox.y < (a.top ?? H) && m.graphicBox.y + m.graphicBox.h > a.bottom);
        if (hit.length) issue('opening.small_penetration_conflict', 'needs-resolution', so.sourceKey, `${so.sourceKey} runs through ${hit.map(m => m.memberKey).join(', ')}.`, { memberKeys: hit.map(m => m.memberKey) });
    }
    for (const m of members) delete m.graphicBox;
    for (const i of layout.issues) issue(`layout.${i.code}`, 'error', i.opening || '', i.message); // the engine's framing check
    plan.cutList = cutListOf(layout, members);
    plan.catalog = { catalogVersion: catalogUsed.catalogVersion, source: catalogUsed.source || 'provided' };
    plan.requiredFeatures = featuresOf(panel, inputs, layout, members, plan);
    // Drawing context for unframed model penetrations: no members, cut-list
    // quantities or source geometry are added/changed by these annotations.
    for (const so of plan.source.openings.filter(s => smallKeys.has(s.sourceKey))) {
        const box = { ...so.actual, top: so.actual.top ?? H };
        layout.openings.push({ ...box, key: so.sourceKey, kind: so.kind, clear: { ...box }, unframed: true });
    }
    return done(layout);
}

// What each member setting resolved to and where it came from.
function intentOf(panel, snapshot, detailing) {
    const m = panel.members, prov = detailing.provenance || {};
    const stud = G.parseMember(m.stud)?.name || null, track = G.parseMember(m.track)?.name || (stud ? G.trackFor(stud) || null : null);
    const topTrack = m.topTrack ? G.parseMember(m.topTrack)?.name || null : track;
    const src = (k, setting, inherited) => (prov[k] || (setting ? (snapshot.kind === 'model' ? 'source' : 'detailing') : inherited));
    const openings = {};
    snapshot.openings.forEach((o, i) => {
        const go = panel.openings[i], types = G.OPENING_TYPES[go.kind].members, fr = G.openingFraming(panel, go);
        const member = (k) => {
            if (!types.includes(k)) return null;
            const setting = go[k] || '', r = G.memberFor(panel, go, k);
            return { setting, value: r.spec, source: setting === G.SAME_STUD ? 'inherit:stud (explicit)' : setting === G.SAME_TRACK ? 'inherit:track (explicit)' : setting ? 'opening'
                : m[k === 'head' ? 'header' : k] ? 'panel-default' : `inherit:${r.base}` };
        };
        openings[o.sourceKey] = { head: member('head'), jamb: member('jamb'), sill: member('sill'), plies: fr.plies,
            arrangement: { jamb: { value: fr.jambStyle, chosen: fr.jambStyleSet }, head: fr.head ? { value: fr.head.style, chosen: fr.head.style === 'track' || fr.head.styleSet } : null,
                sill: fr.sill ? { value: fr.sill.style, chosen: fr.sill.style === 'track' || fr.sill.styleSet } : null },
            bearing: fr.bearing, crippleEnds: fr.crippleEnds, offsetIn: G.offsetOf(go), ...(G.offsetsVary(go) ? { offsets: G.offsetsOf(go) } : {}), offsetSource: go.offsetIn != null && go.offsetIn !== '' ? 'detailing' : go.locked ? 'model-opening-default-0' : `default:${go.kind}`, toLayout: !!go.toLayout };
    });
    return {
        members: { stud: { setting: m.stud, value: stud, source: src('stud', m.stud, 'missing') }, track: { setting: m.track, value: track, source: src('track', m.track, 'inherit:stud') },
            topTrack: { setting: m.topTrack, value: topTrack, source: src('topTrack', m.topTrack, 'inherit:track') },
            spacingIn: { setting: detailing.members?.spacingIn ?? null, value: m.spacingIn ?? null, source: prov.spacingIn || (detailing.members?.spacingIn != null ? 'detailing' : snapshot.kind === 'model' ? 'missing' : 'default') } },
        layout: null, studs: { flipAll: !!panel.flipStuds, flips: [...panel.studFlips], ...(Number(panel.deflectionGapIn) > 0 ? { deflectionGapIn: panel.deflectionGapIn, topCutback: 'replaced-by-deflection-gap' } : {}) }, view: { side: detailing.view?.side === 'B' ? 'B' : 'A', note: 'projection only: side B mirrors the drawing, never the members' },
        openings,
    };
}

// --- Physical parts --------------------------------------------------------------------------------------------------
// One record per physical straight part: axis start/end (x, y, z inches), placement length (full precision), cut length
// (engine rule, rounded down to 1/8"), section orientation (the C's or U's open side, a unit vector perpendicular to the
// axis) or an explicit unresolved state, catalog key, and assembly/part identity for built-up members.
function expandMembers(layout, inputs, panel, plan, catalog, issue) {
    const { members, graphics } = plan, D = inputs.studIn, flange = inputs.flangeIn, H = layout.heightIn, T = layout.top || null, LEG = inputs.trackLegIn;
    const byDesignator = new Map(catalog.profiles.map(p => [p.designator, p]));
    const missingProfiles = new Set();
    const keyOf = (name) => { const p = byDesignator.get(G.parseMember(name)?.name || name); if (!p) missingProfiles.add(name); return p ? p.key : ''; };
    const flangeOf = (name) => byDesignator.get(G.parseMember(name)?.name || name)?.flangeIn ?? G.parseMember(name)?.flangeIn ?? flange;
    const framingOf = new Map(panel.openings.map(o => [o.key, G.openingFraming(panel, o)]));
    const unresolvedAssemblies = new Map();
    const v3 = (x, y, z) => [x, y, z];
    const open = (dx, dy, dz) => ({ kind: 'open-side', openSide: [dx, dy, dz] });
    const unresolved = (reason) => ({ kind: 'unresolved', reason });
    const cutRule = (m) => (m.orient === 'h' ? (m.slope ? 'run-along-slope' : 'run')
        : m.full ? (T ? 'full-height-sloped' : 'full-height') : m.pts ? 'piece-sloped' : m.seat ? 'piece-seated' : 'piece-clear-span');
    // A sloped end's cut: the top line's segment at x (at an interior corner, the segment ending there, as topAt reads it),
    // its angle from square in degrees (full precision) and the side that is longer (+x: the top rises to the right).
    const slopeAt = (x) => {
        let i = 1;
        while (i < T.length - 1 && T[i][0] < x) i++;
        const a = T[i - 1], b = T[i], k = (b[1] - a[1]) / (b[0] - a[0]);
        return { angleDeg: Math.atan(Math.abs(k)) * 180 / Math.PI, longSide: k > 0 ? '+x' : k < 0 ? '-x' : 'none', ...(T.slice(1, -1).some(q => Math.abs(q[0] - x) <= 1e-6) ? { atCorner: true } : {}) };
    };
    const cut = (m, xc = null) => {
        const sloped = m.orient === 'v' && !!T && (m.pts || m.full);
        const ends = m.orient === 'v' ? { bottom: 'square', top: sloped ? 'slope' : 'square', ...(sloped ? { topSlope: slopeAt(xc) } : {}) }
            : m.role === 'top track' && m.slope ? { start: 'plumb', end: 'plumb', plumb: slopeAt(m.x + m.w / 2) } : { start: 'square', end: 'square' };
        return { lengthIn: m.lengthIn, rule: m.topGapIn ? 'top-deflection-gap' : cutRule(m), allowanceIn: m.topGapIn ? 0 : m.orient === 'v' ? layout.cutbackIn ?? SEAT_ALLOWANCE_IN : 0, rounding: ROUND, ends,
            ...(m.topGapIn ? { topGapIn: m.topGapIn } : {}) };
    };
    const push = (rec, m) => { members.push({ ...rec, func: m.func, mark: rec.mark ?? m.mark ?? '', graphicBox: { x: m.x, y: m.y, w: m.w, h: m.h }, ...(m.manual ? { manual: m.manual, ...(m.from ? { copyOf: m.from } : {}) } : {}) }); };

    // Keys: the generator's (memberKeysOf; a member placed by hand keeps its own).
    const allKeys = layout.members.every(m => m.key) ? layout.members.map(m => m.key) : G.memberKeysOf(layout.members);
    const keyFor = new Map(allKeys.map((k, i) => [i, k]));

    layout.members.forEach((m, idx) => {
        const memberKey = keyFor.get(idx), graphic = { memberKey: null, memberKeys: [], x: m.x, y: m.y, w: m.w, h: m.h, ...(m.pts ? { pts: m.pts } : {}) };
        const record = (rec) => { push({ role: m.role, ...rec }, m); graphic.memberKeys.push(rec.memberKey); };
        if (m.orient === 'v') {
            const xc = m.x + m.w / 2, right = webOnRight(m, layout);
            const y0 = m.topAxis ? m.topAxis[0] : m.full ? 0 : m.y, y1 = m.topAxis ? m.topAxis[1] : m.full ? (T ? topAt(T, xc, H) : H) : m.pts ? underAt(T, xc, H, LEG) : m.y + m.h;
            const fr = m.of ? framingOf.get(m.of) : null;
            const jambUnresolved = m.jamb && fr && fr.plies > 1 && !fr.jambStyleSet;
            if (jambUnresolved) unresolvedAssemblies.set(`${m.of}:jamb:${m.jamb}`, `${m.of}: ${fr.plies} jamb studs each side, but how they sit (boxed, back to back or same way) was not chosen: the drawing assumes boxed.`);
            const assembly = m.jamb && fr && fr.plies > 1 ? { assemblyKey: `${m.of}:jamb:${m.jamb}`, partKey: `ply${m.ply || 1}${/:p\d+$/.test(memberKey) ? memberKey.slice(memberKey.lastIndexOf(':')) : ''}` } : { assemblyKey: '', partKey: '' };
            const parts = m.parts?.length ? m.parts : [{ qty: 1, name: m.type }];
            const marks = m.marks?.length ? m.marks : [m.mark];
            parts.forEach((part, j) => {
                const track = !/^(S|CS|CT)$/.test(G.parseMember(part.name)?.profile || 'S');
                for (let q = 0; q < part.qty; q++) {
                    const suffix = parts.length > 1 || part.qty > 1 ? `:${track ? 'track' : 'stud'}${part.qty > 1 ? q + 1 : ''}` : '';
                    if (track) unresolvedAssemblies.set(`${memberKey}`, `${memberKey}: a jamb with a track around it (${part.name}): how the track sits on the stud is not defined here.`);
                    record({ memberKey: `${memberKey}${suffix}`, catalogKey: keyOf(part.name), designator: G.parseMember(part.name)?.name || part.name, mark: marks[j] ?? m.mark,
                        start: v3(xc, y0, D / 2), end: v3(xc, y1, D / 2), placementLengthIn: y1 - y0, cut: cut(m, xc),
                        orientation: jambUnresolved || track ? unresolved(track ? 'jamb-track-arrangement' : 'jamb-arrangement') : open(right ? -1 : 1, 0, 0),
                        ...(assembly.assemblyKey ? { assemblyKey: assembly.assemblyKey, partKey: `${assembly.partKey}${suffix}` } : parts.length > 1 || part.qty > 1 ? { assemblyKey: memberKey, partKey: suffix.slice(1) } : { assemblyKey: '', partKey: '' }),
                        tags: tagsOf(m) });
                }
            });
        } else {
            // Horizontal: the axis at the track's web (bottom track on the slab, top track at the wall's top, a head track's
            // web at the rough opening's top, a sill track's at its bottom); a sloped top track along the slope.
            const x0 = m.x, x1 = m.x + m.w, fr = m.of ? framingOf.get(m.of) : null;
            const along = (y) => [v3(x0, y, D / 2), v3(x1, y, D / 2)];
            if (m.role === 'top track' && m.slope) {
                const ya = topAt(T, x0, H), yb = topAt(T, x1, H), len = Math.hypot(x1 - x0, yb - ya);
                record({ memberKey, catalogKey: keyOf(m.type), designator: m.type, start: v3(x0, ya, D / 2), end: v3(x1, yb, D / 2), placementLengthIn: len, cut: cut(m),
                    orientation: open((yb - ya) / len, -(x1 - x0) / len, 0), assemblyKey: '', partKey: '', tags: tagsOf(m) });
            } else if ((m.role === 'head track' || m.role === 'sill track') && fr && (m.role === 'head track' ? fr.head : fr.sill)) {
                const spec = m.role === 'head track' ? fr.head : fr.sill, head = m.role === 'head track', parts = spec.parts;
                const yWebLow = m.y, yWebHigh = m.y + m.h, assemblyKey = memberKey;
                const studQty = parts.studQty, trackQty = parts.trackQty, marks = m.marks?.length ? m.marks : [m.mark];
                const markOf = (name) => { const j = (m.parts || []).findIndex(q => q.name === name); return marks[j >= 0 ? j : 0] ?? m.mark; };
                const recs = [];
                if (!studQty) { // a track header or sill: one track (two nested: their second is not placed here)
                    const t = parts.tracks[0]?.name || m.type;
                    recs.push({ part: 'track', name: t, start: along(head ? yWebLow : yWebHigh)[0], end: along(head ? yWebLow : yWebHigh)[1], orientation: open(0, head ? 1 : -1, 0) });
                    for (let q = 2; q <= trackQty; q++) recs.push({ part: `track${q}`, name: t, start: along(head ? yWebLow : yWebHigh)[0], end: along(head ? yWebLow : yWebHigh)[1], orientation: unresolved('nested-track') });
                    if (trackQty > 1) unresolvedAssemblies.set(assemblyKey, `${assemblyKey}: ${trackQty} nested tracks: where the extra ones sit is not defined here.`);
                } else {
                    const t = parts.tracks[0]?.name, s = parts.studs[0]?.name, fl = flangeOf(s), chosen = spec.styleSet && studQty === 2 && trackQty <= 2;
                    if (!chosen) unresolvedAssemblies.set(assemblyKey, `${assemblyKey}: ${studQty} stud${studQty === 1 ? '' : 's'} with ${trackQty} track${trackQty === 1 ? '' : 's'}: the arrangement (box or back to back${studQty !== 2 ? ', and where each part sits' : ''}) was not chosen, so the parts are not placed.`);
                    // Tracks: the first at the opening (a head's under it, a sill's over it), the second at the far side.
                    const trackAt = [head ? { y: yWebLow, open: 1, part: 'track-near' } : { y: yWebHigh, open: -1, part: 'track-near' }, head ? { y: yWebHigh, open: -1, part: 'track-far' } : { y: yWebLow, open: 1, part: 'track-far' }];
                    for (let q = 0; q < trackQty; q++) {
                        const tp = trackAt[q];
                        recs.push(tp ? { part: tp.part, name: t, start: along(tp.y)[0], end: along(tp.y)[1], orientation: chosen ? open(0, tp.open, 0) : unresolved('assembly-arrangement') }
                            : { part: `track${q + 1}`, name: t, start: along(H)[0], end: along(H)[1], orientation: unresolved('assembly-arrangement') });
                    }
                    const yc = m.y + m.h / 2, style = spec.style;
                    const studAt = style === 'back' ? [{ z: D / 2 - fl / 2, dz: -1 }, { z: D / 2 + fl / 2, dz: 1 }] : [{ z: fl / 2, dz: 1 }, { z: D - fl / 2, dz: -1 }];
                    for (let q = 0; q < studQty; q++) {
                        const at = chosen ? studAt[q] : { z: D / 2, dz: 0 };
                        recs.push({ part: `stud-${String.fromCharCode(97 + q)}`, name: s, start: v3(x0, yc, at.z), end: v3(x1, yc, at.z), orientation: chosen ? open(0, 0, at.dz) : unresolved('assembly-arrangement') });
                    }
                }
                for (const r of recs) record({ memberKey: recs.length > 1 ? `${memberKey}:${r.part}` : memberKey, catalogKey: keyOf(r.name),
                    ...(recs.length > 1 ? { role: `${head ? 'header' : 'sill'} ${r.part.startsWith('stud') ? 'stud' : 'track'}` } : {}), designator: G.parseMember(r.name)?.name || r.name,
                    mark: markOf(r.name), start: r.start, end: r.end, placementLengthIn: x1 - x0, cut: cut(m), orientation: r.orientation,
                    ...(recs.length > 1 ? { assemblyKey, partKey: r.part } : { assemblyKey: '', partKey: '' }), tags: tagsOf(m) });
            } else {
                const y = m.role === 'bottom track' ? 0 : m.role === 'top track' ? H : m.role === 'head track' ? m.y : m.y + m.h;
                const up = m.role === 'bottom track' || m.role === 'head track';
                record({ memberKey, catalogKey: keyOf(m.type), designator: m.type, start: v3(x0, y, D / 2), end: v3(x1, y, D / 2), placementLengthIn: x1 - x0, cut: cut(m),
                    orientation: open(0, up ? 1 : -1, 0), assemblyKey: '', partKey: '', tags: tagsOf(m) });
            }
        }
        graphic.memberKey = graphic.memberKeys.length === 1 ? graphic.memberKeys[0] : memberKey;
        graphics.push(graphic);
    });
    for (const [key, message] of unresolvedAssemblies) issue('assembly.arrangement_unresolved', 'needs-resolution', key, message);
    for (const st of layout.manual?.stale || []) issue('manual.stale', 'warning', st.key, st.message); // an edit by hand whose member is gone
    for (const name of [...missingProfiles].sort()) issue('catalog.profile_unknown', 'needs-resolution', `catalog:${name}`, `${name} is not in the member catalog: resolve its profile.`);
    const seen = new Set();
    for (const m of members) { if (seen.has(m.memberKey)) issue('member.duplicate_key', 'error', m.memberKey, `Two members share the key ${m.memberKey}.`); seen.add(m.memberKey); }
    // Clips: points on a stud's web face (not straight members).
    for (const c of layout.clips || []) plan.accessories.push({ accessoryKey: `clip:${c.i}`, kind: 'clip', type: c.type, mark: c.mark, memberKey: keyFor.get(c.member) || '',
        at: v3(c.x, c.y, D / 2), face: c.side === 'R' ? [1, 0, 0] : [-1, 0, 0] });
    return keyFor;
}
const tagsOf = (m) => Object.fromEntries(['end', 'of', 'jamb', 'ply', 'crippleEnd', 'layout', 'full'].filter(k => m[k] !== undefined).map(k => [k, m[k]]));

// The cut list from the same members (the sheet's labels): one row per label, the physical parts it counts.
function cutListOf(layout, members) {
    return layout.cutList.map(r => ({ mark: r.mark, qty: r.qty, func: r.func, designator: r.type, cutLengthIn: r.lengthIn,
        memberKeys: members.filter(m => m.mark === r.mark).map(m => m.memberKey) }));
}
function featuresOf(panel, inputs, layout, members, plan) {
    const f = new Set();
    if (layout.top) f.add('sloped-top');
    if (Number(panel.deflectionGapIn) > 0) f.add('deflection-gap');
    if (inputs.openings.some(o => o.through)) f.add('steel-through-top');
    if (members.some(m => m.assemblyKey && /:jamb:/.test(m.assemblyKey))) f.add('jamb-plies');
    if (members.some(m => /:head:stud-/.test(m.memberKey))) f.add('stud-built-header');
    if (members.some(m => /:sill:stud-/.test(m.memberKey))) f.add('stud-built-sill');
    if (inputs.openings.some(o => o.framing?.headBearing === 'jacks')) f.add('header-on-jacks');
    if (inputs.openings.some(o => o.framing?.crippleEnds)) f.add('cripple-ends');
    if (inputs.openings.some(o => o.requested)) f.add('jambs-on-layout');
    if (inputs.layoutFromRight) f.add('layout-from-right');
    if (inputs.layoutStartIn) f.add('layout-start');
    if (members.some(m => m.tags?.full === undefined && m.tags?.layout !== undefined) || panel.flipStuds || panel.studFlips?.length) { if (panel.flipStuds || panel.studFlips?.length) f.add('stud-flips'); }
    if (plan.accessories.length) f.add('clips');
    if (inputs.openings.some(o => o.clear)) f.add('framing-offset');
    if (members.some(m => m.manual) || layout.manual?.deleted) f.add('manual-members');
    if (layout.members.some(m => m.seat)) f.add('seated-pieces');
    if (panel.openings.some(o => G.offsetsVary(o))) f.add('framing-offset-sides');
    if (panel.headEnds === 'flush' && layout.members.some(m => m.role === 'head track')) f.add('flush-headers');
    if (panel.sillEnds === 'flush' && layout.members.some(m => m.role === 'sill track')) f.add('flush-sills');
    if (plan.source.openings.some(o => o.status === 'unsupported:small-penetration')) f.add('small-penetration-unframed');
    return [...f].sort();
}

// --- Native adapter: inches to decimal feet, once ------------------------------------------------------------------
export function planToNativeFeet(plan) {
    const ft = (v) => (typeof v === 'number' ? v / 12 : v), pt = (p) => p.map(ft);
    const out = JSON.parse(JSON.stringify(plan));
    out.unit = 'ft';
    for (const m of out.members) { m.start = pt(m.start); m.end = pt(m.end); m.placementLengthFt = ft(m.placementLengthIn); delete m.placementLengthIn;
        m.cut = { ...m.cut, lengthFt: ft(m.cut.lengthIn), allowanceFt: ft(m.cut.allowanceIn), ...(m.cut.topGapIn != null ? { topGapFt: ft(m.cut.topGapIn) } : {}) }; delete m.cut.lengthIn; delete m.cut.allowanceIn; delete m.cut.topGapIn; }
    for (const a of out.accessories) a.at = pt(a.at);
    return out;
}
// The drawing for a side: side B mirrors the derived drawing only (never the members).
export function planDrawing(plan, side = 'A') {
    return plan.layout ? (side === 'B' ? flipLayout(plan.layout) : plan.layout) : null;
}
// The plans of a set as one file (separate from cas-panel-shops; nothing in it changes that format's meaning).
export function exportPlans(set, engineering = null) {
    const documentId = set.source?.documentId ?? null;
    return { format: `${PLAN_FORMAT}-set`, contractVersion: CONTRACT_VERSION, ruleVersion: RULE_VERSION,
        ...(engineering?.read ? { engineering: { catalogId: engineering.read.catalog.catalogId, catalogRevision: engineering.read.catalog.revision, catalogSha256: engineering.read.sha256,
            selection: engineering.selection ? { project: engineering.selection.project, approval: { ...engineering.selection.approval } } : null } } : {}),
        plans: (set.panels || []).map(p => resolveFramingPlan(snapshotFromPanel(p, { documentId }), detailingFromPanel(p), null, engineering)) };
}
