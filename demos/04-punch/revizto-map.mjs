// Field QC punch items as Revizto issues (pure; tested in tests/revizto.test.js). Revizto issue fields are
// { timestamp: 'YYYY-MM-DD HH:MM:SS', value } each (Create issue, POST /v5/issue/add, multipart: fields as JSON, uuid,
// projectId, preview image); comments carry the note, the photos (file comments) and later status changes (diff
// comments, POST /v5/comment/add). Statuses and types are the project's (Get workflows: issue-workflow/settings).
// https://revizto.stoplight.io/docs/v5/65353eda82f8a-create-issue · .../754c8883fad7a-add-issue-comments
import { stampOf, statusOf } from './punch.mjs';

export const reviztoTime = (date = new Date()) => new Date(date).toISOString().slice(0, 19).replace('T', ' ');
export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
const field = (value, timestamp) => ({ timestamp, value });

// A list out of a Revizto response's data (data.data, data.entities, data.items, or data itself).
export function listOf(data) {
    if (Array.isArray(data)) return data;
    for (const k of ['data', 'entities', 'items', 'list', 'licenses', 'projects']) if (Array.isArray(data?.[k])) return data[k];
    return [];
}

// The title Revizto shows: "Damage #12 · 4TH FLOOR".
export const issueTitle = (item) => `${stampOf(item.stamp).name} #${item.number}${item.level ? ` · ${item.level}` : ''}`.slice(0, 250);

// Stamp templates (Get stamp templates: issue-preset/list): { uuid, title, abbr, color } (their fields are a JSON string).
export function parseTemplates(data) {
    return listOf(data).map(t => {
        let f = {};
        try { f = typeof t.fields === 'string' ? JSON.parse(t.fields) : t.fields || {}; } catch { /* not JSON */ }
        return { uuid: t.uuid, title: t.title || '', abbr: String(f.stampAbbr || '').trim(), color: Number.isInteger(f.stampColor) ? f.stampColor : null, type: f.customType || '' };
    }).filter(t => t.abbr);
}
export const templateFor = (code, templates) => templates.find(t => t.abbr.toLowerCase() === String(code).toLowerCase()) || null;

// The project's statuses ({ uuid, name, category }) for Field QC's three: by name first, else by category.
const NAMES = { open: [/^open$/i, /^new$/i, /to ?do/i], review: [/review/i, /solved/i, /progress/i, /pending/i], closed: [/^closed$/i, /^done$/i, /complete/i, /resolved/i] };
const CATEGORY = { open: /to ?do|open/i, review: /progress|review/i, closed: /done|closed|complete/i };
export function defaultStatusMap(statuses) {
    const live = statuses.filter(s => !s.deletedAt);
    const pick = (key) => {
        for (const re of NAMES[key]) { const s = live.find(x => re.test(x.name || '')); if (s) return s.uuid; }
        return live.find(x => CATEGORY[key].test(x.category || ''))?.uuid || '';
    };
    return { open: pick('open'), review: pick('review'), closed: pick('closed') };
}

// A Revizto status back to Field QC's: the one it is matched to, else by its category (null: no match).
export function localStatus(uuid, statuses, map) {
    for (const k of ['closed', 'review', 'open']) if (map?.[k] && map[k] === uuid) return k;
    const s = statuses.find(x => x.uuid === uuid);
    if (!s) return null;
    for (const k of ['closed', 'review', 'open']) if (CATEGORY[k].test(s.category || '') || NAMES[k].some(re => re.test(s.name || ''))) return k;
    return null;
}

// The issue's fields. reporter: the signed-in user's e-mail; the assignee only when "Who fixes it" is an e-mail (a
// trade name goes in the tags); the stamp's code (up to 4 characters) and, with a matching stamp template, its color.
export function issueFields(item, { now = new Date(), reporter = '', statusUuid = '', typeUuid = '', template = null } = {}) {
    const ts = reviztoTime(now), s = stampOf(item.stamp);
    const f = {
        title: field(issueTitle(item), ts),
        stampAbbr: field(s.code.slice(0, 4), ts),
        tags: field(['Field QC', s.name, item.level, !isEmail(item.assignee) && item.assignee ? `Fix: ${item.assignee}` : ''].filter(Boolean), ts),
    };
    if (template?.color != null) f.stampColor = field(template.color, ts);
    if (statusUuid) f.customStatus = field(statusUuid, ts);
    if (typeUuid) f.customType = field(typeUuid, ts);
    if (isEmail(reporter)) f.reporter = field(reporter.trim(), ts);
    if (isEmail(item.assignee)) f.assignee = field(item.assignee.trim(), ts);
    if (/^\d{4}-\d{2}-\d{2}$/.test(item.due || '')) f.deadline = field(`${item.due} 23:59:59`, ts);
    return f;
}

// The first comment: what, who, where, and where it came from (the wall's Revit UniqueId, to find it in the model).
export function commentText(item, { project = '', when = new Date() } = {}) {
    const lines = [item.note || '(No note)', ''];
    if (item.assignee || item.due) lines.push(`Fix: ${[item.assignee, item.due ? `by ${item.due}` : ''].filter(Boolean).join(' ')}`);
    lines.push(`Where: ${[item.level, item.wallType].filter(Boolean).join(' · ') || 'not set'}`);
    if (item.externalId) lines.push(`Revit wall UniqueId: ${item.externalId}`);
    lines.push(`From Field QC (${project}), #${item.number}, ${statusOf(item.status).name.toLowerCase()}, added ${new Date(item.createdAt).toLocaleDateString('en-US')}${item.createdBy ? ` by ${item.createdBy}` : ''}; sent ${new Date(when).toLocaleDateString('en-US')}.`);
    return lines.join('\n');
}

// Comments for Add issue comments: { type, uuid, reporter, ... }. A file comment's file goes in the form as file_<uuid>.
export const textComment = (text, { uuid, reporter }) => ({ type: 'text', text, uuid, reporter });
export const fileComment = ({ uuid, reporter }) => ({ type: 'file', uuid, reporter });
export const statusComment = (from, to, { uuid, reporter }) => ({ type: 'diff', uuid, reporter, diff: { customStatus: { old: from, new: to } } });

// An issue from Get issues / Create issue, the parts Field QC keeps: { uuid, statusUuid, web, desktop, title }.
export const issueSummary = (issue) => ({ uuid: issue?.uuid, statusUuid: issue?.customStatus?.value || '', web: issue?.openLinks?.web || '', desktop: issue?.openLinks?.desktop || '', title: issue?.title?.value || '' });
