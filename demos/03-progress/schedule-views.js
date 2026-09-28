// Demo 3: the P6 schedule drawn as a Gantt chart and as a month calendar (HTML strings; the extension wires the
// clicks through data-* attributes). No chart library: bars, lines and links are plain elements and one SVG.
import { escapeHtml } from '../../helpers.js';
import { dayMs, isoDay, addDays, fmtDay, monthName } from './p6.mjs';

const DAY = 86400000;
const ROW = 22;
export const SCALES = { day: { label: 'Days', ppd: 26 }, week: { label: 'Weeks', ppd: 7 }, month: { label: 'Months', ppd: 2.2 } };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pctText = (n) => (n == null ? '–' : `${n}%`);
// Dark text on light bars (the Framed yellow), white on dark ones.
export const textOn = (hex) => {
    const n = parseInt(String(hex || '#888888').slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1d2b38' : '#fff';
};

// --- Gantt -------------------------------------------------------------------------------------------------------------
// g: { rows (p6.ganttRows), span: [from, to], scale, cal, dataDate, today, cursor, selectedId, linkMode: 'selected'|'all'|'none',
//      links, colorOf(a), modelOf(a) -> { done, total, pct } | null, cmpOf(a) -> { delta, state } | null }
export function ganttHtml(g) {
    const ppd = SCALES[g.scale].ppd, from = g.span[0], days = Math.round((dayMs(g.span[1]) - dayMs(from)) / DAY) + 1;
    const W = Math.ceil(days * ppd), H = g.rows.length * ROW;
    const x = (d) => ((dayMs(d) - dayMs(from)) / DAY) * ppd;
    // Header: months (years at the month scale) over days, week starts or months.
    const top = [], bot = [];
    const monthStarts = [];
    for (let t = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, 1); t <= dayMs(g.span[1]); t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)) monthStarts.push(isoDay(t));
    if (g.scale === 'month') {
        const years = [...new Set(monthStarts.map(m => m.slice(0, 4)))];
        for (const y of years) {
            const a = Math.max(0, x(`${y}-01-01`)), b = Math.min(W, x(`${+y + 1}-01-01`));
            top.push(`<span style="left:${a}px;width:${b - a}px">${y}</span>`);
        }
        for (const m of monthStarts) {
            const a = Math.max(0, x(m)), next = isoDay(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1)), b = Math.min(W, x(next));
            bot.push(`<span style="left:${a}px;width:${b - a}px">${MON[+m.slice(5, 7) - 1]}</span>`);
        }
    } else {
        for (const m of monthStarts) {
            const a = Math.max(0, x(m)), next = isoDay(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1)), b = Math.min(W, x(next));
            if (b - a > 24) top.push(`<span style="left:${a}px;width:${b - a}px">${g.scale === 'day' ? monthName(m) : `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`}</span>`);
        }
        for (let i = 0; i < days; i++) {
            const d = addDays(from, i), wd = new Date(dayMs(d)).getUTCDay();
            if (g.scale === 'day') bot.push(`<span class="${g.cal.isWork(d) ? '' : 'off'}" style="left:${i * ppd}px;width:${ppd}px" title="${DOW[wd]} ${fmtDay(d)}">${+d.slice(8)}</span>`);
            else if (wd === 1) bot.push(`<span style="left:${i * ppd}px;width:${7 * ppd}px" title="Week of ${fmtDay(d)}">${+d.slice(8)}</span>`);
        }
    }
    // Background: days off (days and weeks scales), month lines, today / data date / 4D date lines.
    const bg = [];
    if (g.scale !== 'month') for (let i = 0; i < days; i++) { const d = addDays(from, i); if (!g.cal.isWork(d)) bg.push(`<i class="off${g.cal.isHoliday(d) ? ' hol' : ''}" style="left:${i * ppd}px;width:${ppd}px"></i>`); }
    for (const m of monthStarts) if (m > from) bg.push(`<i class="month" style="left:${x(m)}px"></i>`);
    const line = (d, cls, title) => (d && d >= from && d <= g.span[1] ? `<i class="line ${cls}" style="left:${x(d) + (cls === 'dd' ? 0 : ppd / 2)}px" title="${title}"></i>` : '');
    bg.push(line(g.today, 'today', `Today ${fmtDay(g.today)}`), line(g.dataDate, 'dd', `Data date ${fmtDay(g.dataDate)}`), line(g.cursor, 'cursor', `Model shown as planned on ${fmtDay(g.cursor)}`));
    // Rows.
    const rowOf = new Map();
    g.rows.forEach((r, i) => { if (r.kind === 'act') rowOf.set(r.a.id, i); });
    const rows = g.rows.map((r) => {
        if (r.kind === 'wbs') {
            const a = x(r.start), b = x(r.finish) + ppd;
            const state = r.complete ? '<span class="pg-done" title="Every activity in this group is complete">✓ complete</span>' : r.active ? '<span class="pg-wip" title="Work in progress">in progress</span>' : '';
            return `<div class="pg-g-row wbs${r.complete ? ' done' : ''}" data-wbs="${escapeHtml(r.id)}" title="${r.collapsed ? 'Click to open' : 'Click to fold'}">
                <div class="pg-g-cells"><span class="pg-g-name" style="padding-left:${r.depth * 12}px"><b class="pg-tw">${r.collapsed ? '▸' : '▾'}</b>${escapeHtml(r.name)} <span class="muted">(${r.count})</span> ${state}</span>
                    <span class="c-date">${fmtDay(r.start)}</span><span class="c-date">${fmtDay(r.finish)}</span><span class="c-dur"></span><span class="num">${pctText(r.pct)}</span><span></span></div>
                <div class="pg-g-track"><b class="pg-sum" style="left:${a}px;width:${Math.max(2, b - a)}px"></b></div></div>`;
        }
        const a = r.a, color = g.colorOf(a), m = g.modelOf(a), c = g.cmpOf(a);
        const s = x(a.start), e = x(a.finish) + ppd, ps = x(a.plannedStart), pe = x(a.plannedFinish) + ppd;
        const crit = a.status !== 'complete' && a.float != null && a.float <= 0;
        const tip = `${a.id} ${a.name}\n${fmtDay(a.start)} → ${fmtDay(a.finish)}${a.plannedStart ? ` (planned ${fmtDay(a.plannedStart)} → ${fmtDay(a.plannedFinish)})` : ''}\nP6 ${a.pct}%${m ? ` · model ${m.pct}% (${m.done} of ${m.total} walls)` : ''}${a.float != null && a.status !== 'complete' ? ` · float ${a.float} d` : ''}`;
        const ms = a.type === 'start' || a.type === 'finish';
        const bar = ms
            ? `<em class="pg-ms ${a.status === 'complete' ? 'done' : ''} ${crit ? 'crit' : ''}" style="left:${(a.type === 'start' ? s : e) - 7}px">◆</em>`
            : `<b class="pg-bar ${crit ? 'crit' : ''} ${a.status}" style="left:${s}px;width:${Math.max(3, e - s)}px;background:${color}">
                ${a.pct ? `<s style="width:${a.pct}%"></s>` : ''}${m ? `<u style="left:${m.pct}%" class="${c?.state || ''}"></u>` : ''}</b>`;
        const planned = !ms && a.plannedStart && (a.plannedStart !== a.start || a.plannedFinish !== a.finish) ? `<i class="pg-bl" style="left:${ps}px;width:${Math.max(3, pe - ps)}px"></i>` : '';
        const label = g.scale === 'day' || e - s > 70 ? '' : `<span class="pg-lbl" style="left:${(ms ? e + 4 : e + 4)}px">${escapeHtml(a.stage || '')}</span>`;
        return `<div class="pg-g-row act st-${a.status} ${a.id === g.selectedId ? 'sel' : ''} ${crit ? 'crit' : ''}" data-act="${escapeHtml(a.id)}" title="${escapeHtml(tip)}">
            <div class="pg-g-cells"><span>${escapeHtml(a.id)}</span>
                <span class="pg-g-name" style="padding-left:${r.depth * 12}px"><i class="swatch" style="background:${color}"></i>${escapeHtml(a.name)}</span>
                <span class="c-date ${a.actualStart ? 'act' : ''}">${fmtDay(a.start)}${a.actualStart ? ' A' : ''}</span><span class="c-date ${a.actualFinish ? 'act' : ''}">${fmtDay(a.finish)}${a.actualFinish ? ' A' : ''}</span>
                <span class="num c-dur">${ms ? '' : Math.round(a.dur)}</span><span class="num">${ms ? '' : pctText(a.pct)}</span>
                <span class="num">${m ? `<span class="pg-cmp ${c?.state || ''}">${m.pct}%</span>` : '<span class="muted" title="Not linked to walls">–</span>'}</span></div>
            <div class="pg-g-track">${planned}${bar}${label}</div></div>`;
    });
    // Relationship lines: those of the selected activity, or all of them.
    const paths = [];
    const show = g.linkMode === 'all' ? g.links : g.linkMode === 'selected' && g.selectedId ? g.links.filter(l => l.from === g.selectedId || l.to === g.selectedId) : [];
    const acts = new Map(g.rows.filter(r => r.kind === 'act').map(r => [r.a.id, r.a]));
    for (const l of show) {
        const i = rowOf.get(l.from), j = rowOf.get(l.to);
        if (i == null || j == null) continue;
        const p = acts.get(l.from), q = acts.get(l.to);
        const y1 = i * ROW + ROW / 2, y2 = j * ROW + ROW / 2;
        const pStart = x(p.start), pEnd = x(p.finish) + (p.type === 'start' ? 0 : ppd), qStart = x(q.start) + (q.type === 'finish' ? ppd : 0), qEnd = x(q.finish) + ppd;
        const hot = g.selectedId && (l.from === g.selectedId || l.to === g.selectedId);
        let d;
        if (l.type === 'SS') d = `M${pStart},${y1} h-6 V${y2} H${qStart - 1}`;
        else if (l.type === 'FF') d = `M${pEnd},${y1} h6 V${y2} H${qEnd + 1}`;
        else d = qStart >= pEnd + 8 ? `M${pEnd},${y1} H${pEnd + 4} V${y2} H${qStart - 1}` : `M${pEnd},${y1} h4 V${y2 - (y2 > y1 ? ROW / 2 : -ROW / 2)} H${qStart - 6} V${y2} H${qStart - 1}`;
        paths.push(`<path d="${d}" class="${hot ? 'hot' : ''}" marker-end="url(#pg-arrow${hot ? '-hot' : ''})"><title>${escapeHtml(`${l.from} → ${l.to} ${l.type}${l.lag ? ` ${l.lag > 0 ? '+' : ''}${l.lag} d` : ''}`)}</title></path>`);
    }
    return `<div class="pg-gantt" style="--track:${W}px">
        <div class="pg-g-head">
            <div class="pg-g-cells"><span>Activity ID</span><span>Activity name</span><span class="c-date">Start</span><span class="c-date">Finish</span><span class="num c-dur" title="Original duration, working days">Dur</span>
                <span class="num" title="P6 % complete">P6 %</span><span class="num" title="Walls on the activity's level at its stage or later (tracked in this viewer)">Model %</span></div>
            <div class="pg-g-scale"><div class="pg-g-top">${top.join('')}</div><div class="pg-g-bot">${bot.join('')}</div></div>
        </div>
        <div class="pg-g-body" style="height:${H}px">
            <div class="pg-g-bg" style="height:${H}px">${bg.join('')}</div>
            <svg class="pg-g-links" width="${W}" height="${H}" aria-hidden="true"><defs>
                <marker id="pg-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#8a96a3"/></marker>
                <marker id="pg-arrow-hot" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#1f3b57"/></marker></defs>${paths.join('')}</svg>
            ${rows.join('')}
        </div></div>`;
}

// Where a day is on the Gantt (for scrolling to it): px from the left of the timeline.
export const ganttX = (span, scale, d) => ((dayMs(d) - dayMs(span[0])) / DAY) * SCALES[scale].ppd;

// --- Calendar ----------------------------------------------------------------------------------------------------------
// c: { month: 'YYYY-MM', activities (linked, filtered), cal, dataDate, today, cursor, selectedId, colorOf(a) }
const LANES = 7, LANE = 18, HEAD = 22;
export function calendarHtml(c) {
    const first = `${c.month}-01`;
    const startOffset = (new Date(dayMs(first)).getUTCDay() + 6) % 7; // weeks start on Monday
    let weekStart = addDays(first, -startOffset);
    const next = isoDay(Date.UTC(+c.month.slice(0, 4), +c.month.slice(5, 7), 1));
    const weeks = [];
    while (weekStart < next) {
        const weekEnd = addDays(weekStart, 6);
        const evs = c.activities.filter(a => a.start <= weekEnd && a.finish >= weekStart)
            .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : b.finish.localeCompare(a.finish)));
        const lanes = [], hidden = Array(7).fill(0), bars = [];
        for (const a of evs) {
            const s = Math.max(0, Math.round((dayMs(a.start) - dayMs(weekStart)) / DAY)), e = Math.min(6, Math.round((dayMs(a.finish) - dayMs(weekStart)) / DAY));
            let lane = lanes.findIndex(end => end < s);
            if (lane < 0) { lane = lanes.length; lanes.push(-1); }
            lanes[lane] = e;
            if (lane >= LANES) { for (let k = s; k <= e; k++) hidden[k]++; continue; }
            const color = c.colorOf(a), ms = a.type === 'start' || a.type === 'finish';
            const cont = `${a.start < weekStart ? ' from-l' : ''}${a.finish > weekEnd ? ' to-r' : ''}`;
            bars.push(`<div class="pg-cal-ev${ms ? ' ms' : ''}${a.id === c.selectedId ? ' sel' : ''}${cont}" data-act="${escapeHtml(a.id)}"
                style="left:calc(${(s / 7) * 100}% + 2px);width:calc(${((e - s + 1) / 7) * 100}% - 4px);top:${HEAD + lane * LANE}px;${ms ? '' : `background:${color};color:${textOn(color)}`}"
                title="${escapeHtml(`${a.id} ${a.name}\n${fmtDay(a.start)} → ${fmtDay(a.finish)} · P6 ${a.pct}%`)}">${ms ? '◆ ' : ''}${escapeHtml(a.name)}</div>`);
        }
        const shown = Math.min(lanes.length, LANES) + (hidden.some(Boolean) ? 1 : 0);
        const days = Array.from({ length: 7 }, (_, k) => {
            const d = addDays(weekStart, k), cls = [
                d.slice(0, 7) !== c.month ? 'other' : '', c.cal.isWork(d) ? '' : 'off', c.cal.isHoliday(d) ? 'hol' : '',
                d === c.today ? 'today' : '', d === c.cursor ? 'sel' : '', d === c.dataDate ? 'dd' : ''].filter(Boolean).join(' ');
            return `<div class="pg-cal-day ${cls}" data-day="${d}" title="${DOW[new Date(dayMs(d)).getUTCDay()]} ${fmtDay(d)}${c.cal.isHoliday(d) ? ' · holiday' : ''}${d === c.dataDate ? ' · data date' : ''}">
                <span class="n">${+d.slice(8)}</span>${c.cal.isHoliday(d) ? '<span class="tag">Holiday</span>' : d === c.dataDate ? '<span class="tag dd">Data date</span>' : ''}
                ${hidden[k] ? `<span class="more" style="top:${HEAD + LANES * LANE}px">+${hidden[k]} more</span>` : ''}</div>`;
        }).join('');
        weeks.push(`<div class="pg-cal-week" style="height:${HEAD + shown * LANE + 6}px"><div class="pg-cal-days">${days}</div><div class="pg-cal-events">${bars.join('')}</div></div>`);
        weekStart = addDays(weekStart, 7);
    }
    return `<div class="pg-cal">
        <div class="pg-cal-dow">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span>${d}</span>`).join('')}</div>
        ${weeks.join('')}</div>`;
}
