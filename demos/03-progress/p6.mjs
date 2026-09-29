// Demo 3: a Primavera P6 schedule for the progress tracker. Reads a P6 export, links its activities to the model
// (level + install stage), and compares the schedule with the walls marked in the tracker. No Viewer calls: runs in
// the browser and in Node (tests, scripts/make-sample-schedule.mjs).
//
// Formats read:
// - .xer: P6's own export (tab-separated tables: ERMHDR, then %T table / %F fields / %R rows, %E end). Tables used:
//   PROJECT, CALENDAR, PROJWBS, TASK, TASKPRED, ACTVTYPE, ACTVCODE, TASKACTV.
// - .xlsx / .csv: a P6 layout exported to Excel (Activity ID, Activity Name, Start, Finish, ...; dates such as
//   "28-Sep-26 A", where A marks an actual date).
//
// The schedule kept in state 'schedule' (one JSON object, dates as YYYY-MM-DD):
//   { source: { file, format, importedAt }, project: { id, name, dataDate, estimatedDataDate },
//     calendar: { name, workDays: [0-6, 0 = Sunday], holidays: [YYYY-MM-DD], hoursPerDay },
//     wbs: [{ id, code, name, parent }],
//     activities: [{ id, name, wbs, type: task|start|finish|loe, status: planned|active|complete, start, finish,
//                    plannedStart, plannedFinish, actualStart, actualFinish, dur, rem, float, pct, codes: {type: value} }],
//     links: [{ from, to, type: FS|SS|FF|SF, lag }],   // days
//     map: { levels: { location label: model level | '' }, stages: { stage label: stage | '' }, activities: { id: { level, stage } } } }

export const STAGE_NAMES = ['Not started', 'Framed', 'Boarded', 'Taped', 'Finished']; // same order as the tracker

const DAY = 86400000;
export const dayMs = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (s, n) => isoDay(dayMs(s) + n * DAY);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// P6's own date style: 28-Sep-26
export const fmtDay = (s) => (s ? `${s.slice(8, 10)}-${MONTHS[+s.slice(5, 7) - 1]}-${s.slice(2, 4)}` : '');
export const monthName = (s) => `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;

// --- Work-day calendar ---------------------------------------------------------------------------------------------

export function makeCalendar({ workDays = [1, 2, 3, 4, 5], holidays = [] } = {}) {
    const off = new Set(holidays);
    const isWork = (s) => workDays.includes(new Date(dayMs(s)).getUTCDay()) && !off.has(s);
    return {
        workDays, holidays, isWork,
        isHoliday: (s) => off.has(s),
        // Working days from a to b, both included (0 when b is before a).
        between(a, b) {
            let n = 0;
            for (let t = dayMs(a), end = dayMs(b); t <= end; t += DAY) if (isWork(isoDay(t))) n++;
            return n;
        },
        // The working day n working days after s (n = 0: s itself if it is a working day, else the next one).
        add(s, n) {
            let t = dayMs(s);
            while (!isWork(isoDay(t))) t += DAY;
            for (let k = 0; k < n;) { t += DAY; if (isWork(isoDay(t))) k++; }
            return isoDay(t);
        },
        // The working day n working days before s (s must be a working day).
        back(s, n) {
            let t = dayMs(s);
            for (let k = 0; k < n;) { t -= DAY; if (isWork(isoDay(t))) k++; }
            return isoDay(t);
        },
    };
}
export const calendarOf = (schedule) => makeCalendar(schedule?.calendar || {});

// P6 calendar data (CALENDAR.clndr_data): (0||CalendarData()((0||DaysOfWeek()((0||1()())(0||2()((0||0(s|07:00|f|15:30)())))...))
// (0||Exceptions()((0||0(d|46272)())...))). Days of week 1 = Sunday .. 7 = Saturday; a day with no work intervals is
// off. Exceptions are day numbers from 1899-12-30; one with no work intervals is a holiday.
export function parseCalendarData(data) {
    const text = String(data || '').replace(/[\x7f\r\n]/g, '');
    const days = text.indexOf('DaysOfWeek()(');
    let workDays = [1, 2, 3, 4, 5];
    if (days >= 0) {
        const found = [];
        for (let d = 1; d <= 7; d++) {
            const at = text.indexOf(`(0||${d}()(`, days);
            if (at >= 0 && text[at + `(0||${d}()(`.length] !== ')') found.push(d - 1);
        }
        if (found.length) workDays = found;
    }
    const holidays = [];
    const ex = text.indexOf('Exceptions()(');
    if (ex >= 0) {
        for (const m of text.slice(ex).matchAll(/\(d\|(\d+)\)\(/g)) {
            if (text.slice(ex)[m.index + m[0].length] === ')') holidays.push(isoDay(Date.UTC(1899, 11, 30) + Number(m[1]) * DAY));
        }
    }
    return { workDays, holidays: holidays.sort() };
}

export function calendarData({ workDays, holidays, hours = [['07:00', '11:00'], ['11:30', '15:30']] }) {
    const day = (d) => `(0||${d}()(${workDays.includes(d - 1) ? hours.map(([s, f], i) => `(0||${i}(s|${s}|f|${f})())`).join('') : ''}))`;
    const ex = holidays.map((h, i) => `(0||${i}(d|${Math.round((dayMs(h) - Date.UTC(1899, 11, 30)) / DAY)})())`).join('');
    return `(0||CalendarData()((0||DaysOfWeek()(${[1, 2, 3, 4, 5, 6, 7].map(day).join('')}))(0||VIEW(ShowTotal|Y)())(0||Exceptions()(${ex}))))`;
}

// --- Reading files ---------------------------------------------------------------------------------------------------

// Text of an uploaded file: UTF-8, or Windows-1252 (what P6 usually writes) when it isn't valid UTF-8.
export function decodeText(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}

export function parseXer(text) {
    const tables = {};
    let table = null, fields = null;
    for (const line of String(text).split(/\r?\n/)) {
        const cells = line.split('\t');
        if (cells[0] === '%T') { table = cells[1]; fields = null; tables[table] = []; }
        else if (cells[0] === '%F') fields = cells.slice(1);
        else if (cells[0] === '%R' && table && fields) tables[table].push(Object.fromEntries(fields.map((f, i) => [f, cells[i + 1] ?? ''])));
    }
    if (!tables.TASK) throw new Error('Not a P6 .xer schedule (no TASK table)');
    return tables;
}

const day = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? s.slice(0, 10) : '');
const round1 = (n) => Math.round(n * 10) / 10;
const TYPES = { TT_Mile: 'start', TT_FinMile: 'finish', TT_LOE: 'loe' };
const STATUS = { TK_Complete: 'complete', TK_Active: 'active' };

export function scheduleFromXer(tables, { file = '', importedAt = new Date().toISOString() } = {}) {
    const tasksOf = (id) => tables.TASK.filter(t => t.proj_id === id).length;
    const project = [...(tables.PROJECT || [])].sort((a, b) => tasksOf(b.proj_id) - tasksOf(a.proj_id))[0] || { proj_id: tables.TASK[0]?.proj_id };
    const pid = project.proj_id;
    const cal = (tables.CALENDAR || []).find(c => c.clndr_id === project.clndr_id) || (tables.CALENDAR || []).find(c => c.default_flag === 'Y') || null;
    const hoursPerDay = Number(cal?.day_hr_cnt) || 8;
    const days = (hours) => round1((Number(hours) || 0) / hoursPerDay);
    const allWbs = (tables.PROJWBS || []).filter(w => w.proj_id === pid);
    const root = allWbs.find(w => w.proj_node_flag === 'Y');
    const wbs = allWbs.filter(w => w !== root).sort((a, b) => (Number(a.seq_num) || 0) - (Number(b.seq_num) || 0))
        .map(w => ({ id: w.wbs_id, code: w.wbs_short_name, name: w.wbs_name, parent: w.parent_wbs_id === root?.wbs_id ? null : w.parent_wbs_id || null }));
    const codeType = new Map((tables.ACTVTYPE || []).map(t => [t.actv_code_type_id, t.actv_code_type]));
    const codeValue = new Map((tables.ACTVCODE || []).map(c => [c.actv_code_id, c.actv_code_name || c.short_name]));
    const codesOf = new Map();
    for (const a of tables.TASKACTV || []) {
        if (!codesOf.has(a.task_id)) codesOf.set(a.task_id, {});
        codesOf.get(a.task_id)[codeType.get(a.actv_code_type_id) || a.actv_code_type_id] = codeValue.get(a.actv_code_id) ?? '';
    }
    const tasks = tables.TASK.filter(t => t.proj_id === pid && t.task_type !== 'TT_WBS');
    const codeOf = new Map(tasks.map(t => [t.task_id, t.task_code]));
    const activities = tasks.map(t => {
        const type = TYPES[t.task_type] || 'task', status = STATUS[t.status_code] || 'planned';
        const dur = days(t.target_drtn_hr_cnt), rem = days(t.remain_drtn_hr_cnt);
        let start = day(t.act_start_date) || day(t.early_start_date) || day(t.restart_date) || day(t.target_start_date);
        let finish = day(t.act_end_date) || day(t.early_end_date) || day(t.reend_date) || day(t.target_end_date);
        start ||= finish; finish ||= start;
        const pct = status === 'complete' ? 100
            : t.complete_pct_type === 'CP_Drtn' && dur > 0 ? Math.max(0, Math.min(100, Math.round((1 - rem / dur) * 100)))
            : Math.max(0, Math.min(100, Number(t.phys_complete_pct) || 0));
        return {
            id: t.task_code, name: t.task_name, wbs: t.wbs_id || null, type, status, start, finish,
            plannedStart: day(t.target_start_date) || start, plannedFinish: day(t.target_end_date) || finish,
            actualStart: day(t.act_start_date), actualFinish: day(t.act_end_date),
            dur, rem, float: t.total_float_hr_cnt === '' || t.total_float_hr_cnt == null ? null : days(t.total_float_hr_cnt), pct,
            codes: codesOf.get(t.task_id) || {},
        };
    });
    const links = (tables.TASKPRED || []).filter(p => codeOf.has(p.task_id) && codeOf.has(p.pred_task_id))
        .map(p => ({ from: codeOf.get(p.pred_task_id), to: codeOf.get(p.task_id), type: (p.pred_type || 'PR_FS').replace('PR_', ''), lag: days(p.lag_hr_cnt) }));
    return {
        source: { file, format: 'xer', importedAt },
        project: { id: project.proj_short_name || pid, name: root?.wbs_name || project.proj_short_name || 'P6 project', dataDate: day(project.last_recalc_date) || day(project.next_data_date) || '' },
        calendar: { name: cal?.clndr_name || 'Standard 5-day', ...parseCalendarData(cal?.clndr_data), hoursPerDay },
        wbs, activities, links, map: { levels: {}, stages: {}, activities: {} },
    };
}

// A P6 layout exported to Excel or CSV: rows of cells, the first row with an activity id and a name column is the
// header. Columns are found by their P6 names (and a few common alternatives).
export const COLUMNS = {
    id: /^(activity id|act id|task code|task_code|activity code|id)$/,
    name: /^(activity name|act name|task name|task_name|name|description)$/,
    start: /^(start|start date|early start|current start)$/,
    finish: /^(finish|finish date|end|end date|early finish|current finish)$/,
    plannedStart: /^(planned start|bl project start|baseline start|bl start|target start|bl1 start)$/,
    plannedFinish: /^(planned finish|bl project finish|baseline finish|bl finish|target finish|bl1 finish)$/,
    actualStart: /^actual start$/, actualFinish: /^actual finish$/,
    pct: /^(physical % complete|activity % complete|duration % complete|% complete|percent complete|progress)$/,
    status: /^(activity status|status)$/,
    dur: /^(original duration|orig dur|od|planned duration|duration|at completion duration)$/,
    rem: /^(remaining duration|rem dur)$/, float: /^total float$/,
    wbs: /^(wbs|wbs name|wbs code)$/, level: /^(level|location|area|floor|zone)$/, stage: /^(stage|install stage|phase)$/,
    type: /^(activity type|type)$/, preds: /^(predecessors|predecessor|preds)$/,
};

// "28-Sep-26 A", "2026-09-28", "9/28/2026", or an Excel day number: { day, actual }
export function parseDateText(value) {
    let s = String(value ?? '').trim();
    const actual = /\sA$/.test(s);
    s = s.replace(/\s*[A*]$/, '').trim();
    if (!s) return { day: '', actual };
    let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return { day: `${m[1]}-${m[2]}-${m[3]}`, actual };
    if ((m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4}|\d{2})/.exec(s))) {
        const mo = MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
        if (mo >= 0) return { day: isoDay(Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], mo, +m[1])), actual };
    }
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})/.exec(s))) return { day: isoDay(Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2])), actual };
    if (/^\d{5}(\.\d+)?$/.test(s)) return { day: isoDay(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * DAY), actual };
    return { day: '', actual };
}

export function parseCsv(text) {
    const rows = []; let row = [], cell = '', quoted = false;
    const s = String(text).replace(/^﻿/, '');
    const sep = (s.split(/\r?\n/)[0].match(/\t/g) || []).length > (s.split(/\r?\n/)[0].match(/,/g) || []).length ? '\t' : ',';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (quoted) {
            if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === sep) { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

// "A1010, A1020 SS+2d, A1030FF 3" -> [{ from, type, lag }]
function parsePreds(text) {
    return String(text || '').split(/[,;]/).map(s => s.trim()).filter(Boolean).map(s => {
        // A lag needs a type before it ("SS 3") or a sign ("+2"), so an id's own digits are never read as one.
        const m = /^(\S+?)\s*(?:(FS|SS|FF|SF)\s*([+-]?\s*\d+(?:\.\d+)?)?|([+-]\s*\d+(?:\.\d+)?))?\s*d?$/i.exec(s);
        const lag = m?.[3] || m?.[4];
        return m ? { from: m[1], type: (m[2] || 'FS').toUpperCase(), lag: lag ? Number(lag.replace(/\s/g, '')) : 0 } : { from: s, type: 'FS', lag: 0 };
    });
}

export function scheduleFromRows(rows, { file = '', format = 'csv', importedAt = new Date().toISOString(), dataDate = '' } = {}) {
    const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s*\(.*\)$/, '').replace(/\s+/g, ' ');
    const headerAt = rows.findIndex(r => r.some(c => COLUMNS.id.test(norm(c))) && r.some(c => COLUMNS.name.test(norm(c))));
    if (headerAt < 0) throw new Error('No header row with "Activity ID" and "Activity Name" columns');
    const header = rows[headerAt].map(norm);
    const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, re]) => [k, header.findIndex(h => re.test(h))]));
    const get = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
    const body = rows.slice(headerAt + 1).filter(r => get(r, 'id') && get(r, 'name'));
    const pctValues = body.map(r => Number(get(r, 'pct').replace('%', ''))).filter(n => !Number.isNaN(n));
    const fraction = pctValues.length && pctValues.every(n => n <= 1) && body.some(r => /\d\.\d/.test(get(r, 'pct')));
    const num = (v) => { const n = parseFloat(String(v).replace(/[^\d.-]/g, '')); return Number.isNaN(n) ? null : n; };
    const wbsNames = [...new Set(body.map(r => get(r, 'wbs')).filter(Boolean))];
    const wbs = wbsNames.map((name, i) => ({ id: `W${i + 1}`, code: name, name, parent: null }));
    const links = [];
    const activities = body.map(r => {
        const s = parseDateText(get(r, 'start')), f = parseDateText(get(r, 'finish'));
        const as = parseDateText(get(r, 'actualStart')).day || (s.actual ? s.day : '');
        const af = parseDateText(get(r, 'actualFinish')).day || (f.actual ? f.day : '');
        const statusText = get(r, 'status').toLowerCase();
        let pct = num(get(r, 'pct'));
        if (fraction && pct != null) pct *= 100;
        const status = /^(complete|completed|tk_complete)$/.test(statusText) || af ? 'complete' : /progress|active/.test(statusText) || as ? 'active' : 'planned';
        if (status === 'complete') pct = 100;
        const typeText = get(r, 'type').toLowerCase();
        const start = s.day || f.day, finish = f.day || s.day, dur = num(get(r, 'dur')) ?? 0;
        // No Activity Type column: a zero-duration activity is a milestone (a start milestone when it has only a start).
        const type = /start milestone/.test(typeText) ? 'start' : /milestone/.test(typeText) ? 'finish' : /level of effort/.test(typeText) ? 'loe'
            : !typeText && dur === 0 && start === finish ? (s.day && !f.day ? 'start' : 'finish') : 'task';
        const id = get(r, 'id');
        for (const p of parsePreds(get(r, 'preds'))) links.push({ ...p, to: id });
        const codes = {};
        if (get(r, 'level')) codes.Location = get(r, 'level');
        if (get(r, 'stage')) codes.Stage = get(r, 'stage');
        return {
            id, name: get(r, 'name'), wbs: wbs.find(w => w.name === get(r, 'wbs'))?.id || null,
            type, status, start, finish,
            plannedStart: parseDateText(get(r, 'plannedStart')).day || start, plannedFinish: parseDateText(get(r, 'plannedFinish')).day || finish,
            actualStart: as, actualFinish: af, dur, rem: num(get(r, 'rem')) ?? 0, float: num(get(r, 'float')),
            pct: pct == null ? null : Math.max(0, Math.min(100, Math.round(pct))), codes,
        };
    }).filter(a => a.start);
    if (!activities.length) throw new Error('No activities with dates found');
    // No data date in a spreadsheet: the working day after the latest actual date.
    const actuals = activities.flatMap(a => [a.actualStart, a.actualFinish]).filter(Boolean).sort();
    const cal = makeCalendar();
    const known = new Set(activities.map(a => a.id));
    return {
        source: { file, format, importedAt },
        project: { id: '', name: file.replace(/\.[^.]+$/, '') || 'P6 schedule', dataDate: dataDate || (actuals.length ? cal.add(addDays(actuals.at(-1), 1), 0) : ''), estimatedDataDate: !dataDate },
        calendar: { name: 'Standard 5-day (not in the file)', workDays: cal.workDays, holidays: [], hoursPerDay: 8 },
        wbs, activities, links: links.filter(l => known.has(l.from) && known.has(l.to)), map: { levels: {}, stages: {}, activities: {} },
    };
}

// --- Linking activities to the model -----------------------------------------------------------------------------------

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const levelNumber = (text) => {
    const m = /\b(?:level|lvl|lev|flr|floor|l)\s*-?\s*0*(\d{1,3})\b/i.exec(text) || /\b(\d{1,2})(?:st|nd|rd|th)\s+floor\b/i.exec(text);
    return m ? Number(m[1]) : null;
};

// The model level a label names: the same name, a level name inside it ("L3 - Tape"), or the same number
// ("Level 03" = "L3") when only one level has that number.
export function matchLevel(text, levelNames) {
    const t = String(text || '').trim();
    if (!t) return null;
    const exact = levelNames.find(l => l.toLowerCase() === t.toLowerCase());
    if (exact) return exact;
    const inside = levelNames.filter(l => new RegExp(`(^|[^a-z0-9])${esc(l.toLowerCase())}($|[^a-z0-9])`).test(t.toLowerCase())).sort((a, b) => b.length - a.length);
    if (inside.length) return inside[0];
    const n = levelNumber(t);
    if (n == null) return null;
    const same = levelNames.filter(l => levelNumber(l) === n);
    return same.length === 1 ? same[0] : null;
}

const NOT_A_STAGE = /layout|inspect|survey|mobili[sz]|submittal|deliver|milestone|dry-?in/i;
const STAGE_WORDS = [['Framed', /\bfram|\bstud/i], ['Taped', /\btap|\bmud|\bembed|\bjoint/i], ['Finished', /\bfinish|\bsand|\bpunch|\bprime/i], ['Boarded', /\bboard|\bhang|\bsheath|\bgyp|\bdrywall|\bclose[ -]?up|\bclose walls/i]];
export function matchStage(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const exact = STAGE_NAMES.slice(1).find(s => s.toLowerCase() === t.toLowerCase());
    if (exact) return exact;
    if (NOT_A_STAGE.test(t)) return null;
    return STAGE_WORDS.find(([, re]) => re.test(t))?.[0] || null;
}

const LOCATION_CODE = /locat|level|floor|area|zone/i, STAGE_CODE = /stage|phase|step/i;

// Where an activity's level and stage come from: { location, stageLabel } (the labels the link table maps).
export function labelsOf(activity, schedule) {
    const codeType = (re) => Object.keys(activity.codes || {}).find(k => re.test(k));
    const byId = new Map((schedule.wbs || []).map(w => [w.id, w]));
    const wbsChain = [];
    for (let w = byId.get(activity.wbs); w && wbsChain.length < 20; w = byId.get(w.parent)) wbsChain.push(w.name);
    const locType = codeType(LOCATION_CODE), stageType = codeType(STAGE_CODE);
    return {
        location: locType ? activity.codes[locType] : null, locationFrom: locType ? `activity code ${locType}` : null,
        wbsChain, stageLabel: stageType ? activity.codes[stageType] : null, stageFrom: stageType ? `activity code ${stageType}` : null,
    };
}

// Every activity with its model level and install stage, and how each was found:
// set on the activity > the link table (by location / stage label) > the label itself > the WBS > the activity name.
export function linkActivities(schedule, levelNames) {
    const map = schedule.map || {};
    return schedule.activities.map(a => {
        const l = labelsOf(a, schedule), own = map.activities?.[a.id] || {};
        let level = null, levelHow = '', locationKey = l.location || l.wbsChain[0] || '';
        if (own.level !== undefined) { level = own.level || null; levelHow = 'set on this activity'; }
        else if (locationKey && map.levels?.[locationKey] !== undefined) { level = map.levels[locationKey] || null; levelHow = schedule.source.demo?.levelAssignments?.[locationKey] === level ? `demo assignment (${locationKey})` : `link table (${locationKey})`; }
        else if (l.location && (level = matchLevel(l.location, levelNames))) levelHow = l.locationFrom;
        else {
            const w = l.wbsChain.find(n => matchLevel(n, levelNames));
            if (w) { level = matchLevel(w, levelNames); levelHow = `WBS ${w}`; if (!l.location) locationKey = w; }
            else if ((level = matchLevel(a.name, levelNames))) levelHow = 'activity name';
        }
        let stage = null, stageHow = '';
        const stageKey = l.stageLabel || '';
        if (a.type === 'start' || a.type === 'finish') { /* milestones mark dates, not wall work */ }
        else if (own.stage !== undefined) { stage = own.stage || null; stageHow = 'set on this activity'; }
        else if (stageKey && map.stages?.[stageKey] !== undefined) { stage = map.stages[stageKey] || null; stageHow = `link table (${stageKey})`; }
        else if (stageKey) { stage = matchStage(stageKey); stageHow = stage ? l.stageFrom : ''; }
        else if ((stage = matchStage(a.name))) stageHow = 'activity name';
        return { ...a, level, levelHow, stage, stageHow, locationKey, stageKey };
    });
}

// --- Progress --------------------------------------------------------------------------------------------------------

// Walls on a level at a stage or later: counts[level] = [walls at stage index >= 0, >= 1, ...].
export function stageCounts(walls, stageOf) {
    const counts = {};
    for (const w of walls) {
        const k = Math.max(0, STAGE_NAMES.indexOf(stageOf(w)));
        const c = (counts[w.level] ??= Array(STAGE_NAMES.length).fill(0));
        for (let i = 0; i <= k; i++) c[i]++;
    }
    return counts;
}

// The model's % complete for an activity: walls on its level at its stage or later.
export function modelProgress(activity, counts) {
    const c = activity.level && counts[activity.level], k = STAGE_NAMES.indexOf(activity.stage);
    if (!c || k < 1) return null;
    return { done: c[k], total: c[0], pct: c[0] ? Math.round((c[k] / c[0]) * 100) : 0 };
}

// How far the schedule expects an activity to be at the end of a day: working days elapsed ÷ its working days
// (current dates, or the planned ones with { planned: true }).
export function expectedPct(activity, dayStr, cal, { planned = false } = {}) {
    const s = planned ? activity.plannedStart : activity.start, f = planned ? activity.plannedFinish : activity.finish;
    if (!s || !f || dayStr < s) return 0;
    if (dayStr >= f) return 100;
    const all = cal.between(s, f);
    return all ? Math.round((cal.between(s, dayStr) / all) * 100) : 0;
}

// Days late: current finish vs planned finish, in working days (negative: early).
export function finishVariance(activity, cal) {
    const a = activity.finish, p = activity.plannedFinish;
    if (!a || !p || a === p) return 0;
    return a > p ? cal.between(addDays(p, 1), a) : -cal.between(addDays(a, 1), p);
}

// Model vs P6 for an activity: 'behind' when the walls marked are more than `tolerance` points below the P6 %.
export function compare(model, p6Pct, tolerance = 10) {
    if (!model) return null;
    if (p6Pct == null) return { delta: null, state: 'unknown' };
    const delta = model.pct - p6Pct;
    return { delta, state: delta < -tolerance ? 'behind' : delta > tolerance ? 'ahead' : 'even' };
}

// 4D: the stage each wall should be at by the end of a day. Per level, each stage's activities say how far along it
// should be; the walls reach it in the order given (`walls`), so "40% framed" = the first 40% of them. Given in order
// of the stage they are at (furthest first), a wall comes out behind only when its level is behind.
export function plannedStages(walls, linked, dayStr, cal) {
    const byLevel = new Map();
    for (const a of linked) {
        const k = STAGE_NAMES.indexOf(a.stage);
        if (!a.level || k < 1) continue;
        const stages = byLevel.get(a.level) || byLevel.set(a.level, {}).get(a.level);
        (stages[k] ??= []).push(a);
    }
    const perLevel = new Map();
    for (const w of walls) (perLevel.get(w.level) || perLevel.set(w.level, []).get(w.level)).push(w);
    const out = new Map();
    for (const [level, list] of perLevel) {
        const stages = byLevel.get(level);
        if (!stages) continue; // not in the schedule
        // Fraction reached per stage (several activities: weighted by their working days); a stage is never ahead of
        // the one before it.
        const reach = [1];
        for (let k = 1; k < STAGE_NAMES.length; k++) {
            const acts = stages[k] || [];
            let f = 0;
            if (acts.length) {
                const weights = acts.map(a => Math.max(1, cal.between(a.start, a.finish)));
                f = acts.reduce((s, a, i) => s + (expectedPct(a, dayStr, cal) / 100) * weights[i], 0) / weights.reduce((s, x) => s + x, 0);
            }
            reach[k] = Math.min(reach[k - 1], f);
        }
        list.forEach((w, i) => {
            const pos = (i + 0.5) / list.length;
            let k = 0;
            while (k + 1 < STAGE_NAMES.length && reach[k + 1] >= pos) k++;
            out.set(w, k);
        });
    }
    return out;
}

// The date range to draw: every current and planned date, a few days either side.
export function scheduleSpan(activities) {
    const days = activities.flatMap(a => [a.start, a.finish, a.plannedStart, a.plannedFinish]).filter(Boolean).sort();
    return days.length ? [addDays(days[0], -3), addDays(days.at(-1), 7)] : null;
}

// Gantt rows: the WBS tree (only branches with activities shown), each branch's activities by start date.
// keep(a) filters activities; collapsed = Set of WBS ids. WBS rows carry the span of what is under them, whether it
// is all complete, and its P6 % (weighted by working days; milestones count as one day).
export function ganttRows(linked, schedule, { keep = () => true, collapsed = new Set() } = {}) {
    const acts = linked.filter(keep);
    const kids = new Map(), under = new Map();
    for (const w of schedule.wbs || []) (kids.get(w.parent) || kids.set(w.parent, []).get(w.parent)).push(w);
    for (const a of acts) (under.get(a.wbs) || under.set(a.wbs, []).get(a.wbs)).push(a);
    const byStart = (x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : x.id.localeCompare(y.id, undefined, { numeric: true }));
    const rows = [];
    const all = (w) => [...(under.get(w.id) || []), ...(kids.get(w.id) || []).flatMap(all)];
    const walk = (parent, depth) => {
        for (const w of kids.get(parent) || []) {
            const items = all(w);
            if (!items.length) continue;
            const starts = items.map(a => a.start).sort(), ends = items.map(a => a.finish).sort();
            const weight = (a) => Math.max(1, a.dur || 0), total = items.reduce((s, a) => s + weight(a), 0);
            rows.push({
                kind: 'wbs', id: w.id, name: w.name, code: w.code, depth, start: starts[0], finish: ends.at(-1), count: items.length, collapsed: collapsed.has(w.id),
                complete: items.every(a => a.status === 'complete'), active: items.some(a => a.status === 'active'),
                pct: items.some(a => a.pct == null) ? null : Math.round(items.reduce((s, a) => s + a.pct * weight(a), 0) / total),
            });
            if (collapsed.has(w.id)) continue;
            for (const a of (under.get(w.id) || []).sort(byStart)) rows.push({ kind: 'act', a, depth: depth + 1 });
            walk(w.id, depth + 1);
        }
    };
    const known = new Set((schedule.wbs || []).map(w => w.id));
    for (const a of acts.filter(x => !x.wbs || !known.has(x.wbs)).sort(byStart)) rows.push({ kind: 'act', a, depth: 0 });
    walk(null, 0);
    return rows;
}

// WBS groups whose activities are all complete (to fold them, so the open work is near the top).
export const completeGroups = (linked, schedule) => ganttRows(linked, schedule).filter(r => r.kind === 'wbs' && r.complete).map(r => r.id);

// Demo-only transformation. Keep the original for exact Undo, including the original links and calendar.
export function demoShift(schedule, { today = new Date(), project = 'Demo project' } = {}) {
    const original = structuredClone(schedule.source?.original || schedule);
    const out = structuredClone(original);
    const anchor = out.project.dataDate || out.activities.map(a => a.start).filter(Boolean).sort()[0];
    if (!anchor) throw new Error('No schedule date is available for the demo move.');
    const years = today.getFullYear() - Number(anchor.slice(0, 4));
    const target = Date.UTC(today.getFullYear(), Number(anchor.slice(5, 7)) - 1, Number(anchor.slice(8, 10)));
    let shiftDays = 7 * Math.round((target - dayMs(anchor)) / (7 * DAY));
    // Whole-week rounding near New Year must still put the anchor in the selected year.
    const movedYear = Number(addDays(anchor, shiftDays).slice(0, 4));
    if (movedYear < today.getFullYear()) shiftDays += 7;
    if (movedYear > today.getFullYear()) shiftDays -= 7;
    const shift = value => value ? addDays(value, shiftDays) : value;
    for (const a of out.activities) for (const key of ['start', 'finish', 'plannedStart', 'plannedFinish', 'actualStart', 'actualFinish']) a[key] = shift(a[key]);
    out.project.dataDate = shift(out.project.dataDate);
    out.calendar.holidays = (out.calendar.holidays || []).map(shift);
    out.source.original = original;
    out.source.demo = { originalProject: original.project.name, originalId: original.project.id, originalDataDate: original.project.dataDate, shiftDays, years, at: today.toISOString(), levelAssignments: {} };
    out.project.name = `${project} – demo schedule`;
    out.project.id = `demo-${original.project.id || original.source.file || 'schedule'}`;
    return out;
}
export function assignDemoLevels(linked, levelNames) {
    const used = new Set(linked.map(a => a.level).filter(Boolean));
    const available = levelNames.filter(l => l !== 'Not set' && !used.has(l));
    const assigned = {};
    for (const a of linked) {
        if (a.level || !a.locationKey || a.locationKey in assigned || /set on|link table/.test(a.levelHow || '')) continue;
        if (!available.length) break;
        assigned[a.locationKey] = available.shift();
    }
    return assigned;
}
