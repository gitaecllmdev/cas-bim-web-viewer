// Panel tracking (pure; tested in tests/tracker.test.js): each prefab panel's way from BIM review to framing complete,
// as the field records it (a scan, a typed mark, a click on its wall), who recorded each step and when. The tracker is
// one JSON per model ('panel-tracker' state): { version, panels: { key: { stage: { date, at, by, via } } }, log }, with
// the panel key being its wall's Revit UniqueId (the viewer's externalId), so a Revit add-in can pull it and report
// back with the same rows (revitRows / readRevitRows).
import { addDays, dayMs, parseDateText, parseCsv } from '../03-progress/p6.mjs';

export const STAGES = [
    { key: 'bim', name: 'BIM review', short: 'BIM', done: 'BIM review completed', color: '#3d6fd6' },
    { key: 'prefab', name: 'Prefab review', short: 'Prefab', done: 'Prefab review completed', color: '#d64545' },
    { key: 'shipped', name: 'Shipped to site', short: 'Shipped', done: 'Shipped to site', color: '#e89a1a' },
    { key: 'delivered', name: 'Delivered to site', short: 'Delivered', done: 'Delivered to site', color: '#2fa36b' },
    { key: 'framed', name: 'Framing complete', short: 'Framed', done: 'Framing complete', color: '#8e44ad' },
];
export const NOT_STARTED = { key: 'none', name: 'Not started', short: 'Not started', color: '#b8bec6' };
export const stageIndex = (key) => STAGES.findIndex(s => s.key === key);
const LOG_MAX = 300;

export const emptyTracker = () => ({ version: 1, panels: {}, log: [] });

// A saved tracker, or a fresh one when there is none (or it is not a tracker).
export function readTracker(saved) {
    if (!saved || typeof saved !== 'object' || !saved.panels || typeof saved.panels !== 'object') return emptyTracker();
    return { ...emptyTracker(), ...saved, log: Array.isArray(saved.log) ? saved.log : [] };
}

// The furthest step a panel has reached (-1: not started). Steps can be recorded out of order (a delivery scanned
// before anyone scanned it shipped): the furthest one counts, the gaps show as skipped.
export function statusOf(rec) {
    let at = -1;
    STAGES.forEach((s, i) => { if (rec?.[s.key]) at = i; });
    return at;
}
export const statusFor = (i) => (i >= 0 ? STAGES[i] : NOT_STARTED);
export const skippedOf = (rec) => { const at = statusOf(rec); return STAGES.slice(0, Math.max(0, at)).filter(s => !rec[s.key]).map(s => s.key); };

// Record a step. Scanning a panel again for a step it already has keeps the first record (already: true).
// Returns { ok, already, entry }.
export function markStage(tracker, key, stage, { date, at = new Date().toISOString(), by = '', via = 'manual' } = {}) {
    if (!key || stageIndex(stage) < 0) return { ok: false };
    const rec = (tracker.panels[key] ??= {});
    if (rec[stage]) return { ok: true, already: true, entry: rec[stage] };
    const entry = { date: date || at.slice(0, 10), at, by, via };
    rec[stage] = entry;
    tracker.log.unshift({ key, stage, ...entry });
    if (tracker.log.length > LOG_MAX) tracker.log.length = LOG_MAX;
    return { ok: true, already: false, entry };
}

// Take a step back off (undo). Its log entries go too.
export function unmarkStage(tracker, key, stage) {
    const rec = tracker.panels[key];
    if (!rec?.[stage]) return false;
    delete rec[stage];
    if (!Object.keys(rec).length) delete tracker.panels[key];
    tracker.log = tracker.log.filter(e => !(e.key === key && e.stage === stage));
    return true;
}

// What a scan or a typed text names: the QR code of a shop drawing (its panel page link, ...panel.html?p=<key>), a
// panel key (a Revit UniqueId), or a mark. Returns { key } or { mark } or null.
const UNIQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{8}$/i;
export function parseScan(text) {
    const s = String(text ?? '').trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s) || /[?&]p=/.test(s)) {
        try {
            const p = new URL(s, 'https://x.invalid/').searchParams.get('p');
            if (p) return { key: p.trim().toLowerCase() };
        } catch { /* not a link after all */ }
    }
    if (UNIQUE_ID.test(s)) return { key: s.toLowerCase() };
    return { mark: s };
}

// The panel a scan or a typed text names, among panels [{ key, mark }]: by key, by exact mark (any case), else the only
// mark that contains the text. Returns { panel } or { matches } (several, or none).
export function findPanel(panels, text) {
    const q = parseScan(text);
    if (!q) return { matches: [] };
    if (q.key) { const p = panels.find(x => x.key === q.key); return p ? { panel: p } : { matches: [] }; }
    const t = q.mark.toLowerCase();
    const exact = panels.filter(x => String(x.mark).toLowerCase() === t);
    if (exact.length === 1) return { panel: exact[0] };
    const part = exact.length ? exact : panels.filter(x => String(x.mark).toLowerCase().includes(t));
    return part.length === 1 ? { panel: part[0] } : { matches: part.slice(0, 12) };
}

// The record a panel shows: what was recorded, over the demo history (demo: generated, never saved), with framing
// complete also taken from Install Progress (Demo 3) when its wall is framed there (installed: true).
export function effectiveRecord(rec, demo, { installed = false, installDate = '' } = {}) {
    const out = { ...(demo || {}), ...(rec || {}) };
    if (installed && !out.framed) out.framed = { date: installDate, via: 'install' };
    return out;
}

// Counts for the pipeline: reached[i] = panels at step i or further; at[i] = panels whose furthest step is i
// (at[-1] under 'none'); late = panels not delivered on a floor whose framing has started.
export function counts(panels, recordOf, { today = '', startOf = () => '' } = {}) {
    const reached = STAGES.map(() => 0), at = STAGES.map(() => 0);
    let none = 0, late = 0;
    for (const p of panels) {
        const rec = recordOf(p), i = statusOf(rec);
        if (i < 0) none++; else at[i]++;
        STAGES.forEach((s, j) => { if (rec?.[s.key] || j <= i) reached[j]++; });
        if (isLate(rec, startOf(p), today)) late++;
    }
    return { total: panels.length, reached, at, none, late };
}

// Late: its floor's framing has started (on or before today) and the panel is not on site yet.
export const isLate = (rec, start, today) => !!(start && today && start <= today && statusOf(rec) < stageIndex('delivered'));

// --- Demo history -------------------------------------------------------------------------------------------------
// A plausible history for a demo (never saved): each floor's panels reviewed, shipped and delivered ahead of the
// floor's framing start (Demo 3's schedule), framed during it, every step up to today; a few panels held up. Without a
// schedule, floors start ten days apart in build order, about 40% of them by today. Install-framed walls (Demo 3) are
// framed already: their earlier steps are filled and none is held up. Same panels, same day: same history.
// 0..1 per key, well spread even for keys that differ in their last character (UniqueIds of walls drawn together):
// FNV-1a, then MurmurHash3's final mix.
const hash = (s) => {
    let h = 0x811c9dc5;
    for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
};

export function floorDates(levels, { starts = {}, finishes = {}, today }) {
    const out = {};
    const k = Math.floor(levels.length * 0.4);
    levels.forEach((l, i) => {
        const start = starts[l] || addDays(today, (i - k) * 10);
        const finish = finishes[l] && finishes[l] >= start ? finishes[l] : addDays(start, 7);
        out[l] = { start, finish, planned: !!starts[l] };
    });
    return out;
}

// installKnown: the model has install progress (Demo 3), so framing complete comes from it alone, never from the demo.
export function demoHistory(panels, { floors, today, installed = () => false, installKnown = false }) {
    const out = {};
    for (const p of panels) {
        const f = floors[p.level];
        if (!f) continue;
        const h = hash(p.key), span = Math.max(1, Math.round((dayMs(f.finish) - dayMs(f.start)) / 86400000));
        const shipped = addDays(f.start, -5 + Math.round(h * 2));
        const days = { bim: addDays(f.start, -40 + Math.round(h * 7)), prefab: addDays(f.start, -26 + Math.round(h * 5)), shipped,
            delivered: addDays(shipped, 1 + (h > 0.5 ? 1 : 0)), framed: addDays(f.start, Math.round(h * span)) };
        const framedThere = installed(p);
        // Held up: ~6% still at the shop after review, ~5% on a truck not yet signed for.
        const stopAfter = framedThere ? 'framed' : h < 0.06 ? 'prefab' : h < 0.11 ? 'shipped' : 'framed';
        const rec = {};
        for (const s of STAGES) {
            if (s.key === 'framed' && (framedThere || installKnown)) break; // framing complete comes from Install Progress
            if (days[s.key] > today && !framedThere) break;
            rec[s.key] = { date: days[s.key] <= today ? days[s.key] : today, by: 'demo', via: 'demo' };
            if (s.key === stopAfter) break;
        }
        if (Object.keys(rec).length) out[p.key] = rec;
    }
    return out;
}

// --- Revit exchange ---------------------------------------------------------------------------------------------------
// One row per panel, keyed by its wall's Revit UniqueId: what a Revit add-in reads to pull the status onto the panels,
// and the same columns it writes back (report). Dates as YYYY-MM-DD.
export const REVIT_HEADER = ['UniqueId', 'Mark', 'Level', 'Status', ...STAGES.map(s => s.name), 'Updated'];

export function revitRows(panels, recordOf) {
    const rows = [REVIT_HEADER];
    for (const p of panels) {
        const rec = recordOf(p) || {}, i = statusOf(rec);
        const updated = STAGES.map(s => rec[s.key]?.at || '').sort().pop() || '';
        rows.push([p.key, p.mark, p.level || '', statusFor(i).name, ...STAGES.map(s => rec[s.key]?.date || ''), updated]);
    }
    return rows;
}

// A Revit report (CSV text, or JSON: an array of rows as objects, or { panels: [...] }) to [{ key, mark, dates }].
// Columns by name, any case: UniqueId (or Key), Mark, and one per step (its name, or its key: bim, prefab...).
export function readRevitRows(text) {
    const s = String(text ?? '').trim();
    let records;
    if (s.startsWith('[') || s.startsWith('{')) {
        const data = JSON.parse(s);
        records = Array.isArray(data) ? data : Array.isArray(data.panels) ? data.panels : [];
    } else {
        const rows = parseCsv(s).filter(r => r.some(c => String(c).trim()));
        const head = (rows.shift() || []).map(h => String(h).trim());
        records = rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
    }
    const norm = (h) => String(h).trim().toLowerCase().replace(/[^a-z]/g, '');
    const pick = (o, names) => { for (const [k, v] of Object.entries(o)) if (names.includes(norm(k))) return v; return undefined; };
    return records.map(o => {
        const dates = {};
        for (const st of STAGES) {
            const v = pick(o, [norm(st.name), st.key]);
            const day = v == null ? '' : parseDateText(v).day;
            if (day) dates[st.key] = day;
        }
        const key = String(pick(o, ['uniqueid', 'key', 'externalid']) ?? '').trim().toLowerCase();
        return { key, mark: String(pick(o, ['mark']) ?? '').trim(), dates };
    }).filter(r => r.key || r.mark);
}

// Merge a Revit report into the tracker: each step it has that the tracker does not gets recorded (via 'revit'); a
// step the tracker already has keeps the tracker's record. Rows match by UniqueId, else by mark.
// Returns { panels, steps, unknown: [key or mark] }.
export function importRevit(tracker, rows, panels, { by = 'Revit', at = new Date().toISOString() } = {}) {
    const byKey = new Map(panels.map(p => [p.key, p])), byMark = new Map(panels.map(p => [String(p.mark).toLowerCase(), p]));
    const touched = new Set(), unknown = [];
    let steps = 0;
    for (const r of rows) {
        const p = byKey.get(r.key) || byMark.get(r.mark.toLowerCase());
        if (!p) { unknown.push(r.key || r.mark); continue; }
        for (const [stage, date] of Object.entries(r.dates)) {
            const res = markStage(tracker, p.key, stage, { date, at, by, via: 'revit' });
            if (res.ok && !res.already) { steps++; touched.add(p.key); }
        }
    }
    return { panels: touched.size, steps, unknown };
}
