// The strict model-exchange boundary for cas-panel-shops files (version 1), kept apart from the forgiving reading of
// hand-written panels. Pure; the same rules and messages as the native (C#) reader's mock expectations
// (CAS_RevitGit MockWebSuite): a file breaking one is refused whole, before anything is half-read.
//   readExchange(textOrObject) -> the parsed object, or throws Error(message)
// Budgets: 32 MiB of text, nesting 40 deep, 100,000 items in any array, 2,000 panels. JSON that JSON.parse would accept
// but that loses information is refused too: a repeated property name (the last would silently win), a number that is
// not finite (1e999). Lengths in inches, finite, 0..12,000,000. Every panel needs a mark and a supported shape (or an
// outline); a model's panel (with a revit block) needs its openings inside the wall.
import { sourceFraming } from './source-framing.mjs';
const MAX_BYTES = 32 * 1024 * 1024, MAX_DEPTH = 40, MAX_ARRAY = 100000, MAX_PANELS = 2000, MAX_LENGTH = 12000000;
const KINDS = ['door', 'window', 'mep', 'steel'], SHAPES = ['rect', 'rake', 'gable', 'custom'];

// The token stream as written (JSON.parse forgets duplicates and turns 1e999 into Infinity). Depth as System.Text.Json
// counts it (JsonReaderOptions.MaxDepth): an object or array may start at depths 0 to maxDepth - 1 (the root is 0).
// Shared with the style catalog reader (style-catalog.mjs: depth 16, as StyleCatalogCodec).
export function scanJson(text, { maxDepth = MAX_DEPTH, maxArray = MAX_ARRAY } = {}) {
    let at = 0;
    const space = () => { while (at < text.length && /\s/.test(text[at])) at++; };
    const string = () => {
        const start = at++;
        while (at < text.length) { if (text[at] === '\\') at += 2; else if (text[at++] === '"') return JSON.parse(text.slice(start, at)); }
        throw new Error('The JSON ends inside a string.');
    };
    const value = (depth) => {
        space();
        const ch = text[at];
        if ((ch === '{' || ch === '[') && depth >= maxDepth) throw new Error(`The maximum configured depth of ${maxDepth} has been exceeded.`);
        if (ch === '{') {
            at++; space();
            const names = new Set();
            if (text[at] === '}') { at++; return; }
            for (;;) {
                space();
                if (text[at] !== '"') throw new Error('Expected a property name.');
                const name = string();
                if (names.has(name)) throw new Error(`Duplicate JSON property: ${name}`);
                names.add(name);
                space();
                if (text[at++] !== ':') throw new Error('Expected ":".');
                value(depth + 1); space();
                if (text[at] === ',') { at++; continue; }
                if (text[at] === '}') { at++; return; }
                throw new Error('There is an open JSON object or array that should be closed.');
            }
        }
        if (ch === '[') {
            at++; space();
            if (text[at] === ']') { at++; return; }
            for (let n = 1; ; n++) {
                if (n > maxArray) throw new Error('An exchange array is too large.');
                value(depth + 1); space();
                if (text[at] === ',') { at++; continue; }
                if (text[at] === ']') { at++; return; }
                throw new Error('There is an open JSON object or array that should be closed.');
            }
        }
        if (ch === '"') { string(); return; }
        const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at, at + 400))?.[0];
        if (!token) throw new Error(at >= text.length ? 'There is an open JSON object or array that should be closed.' : 'Invalid JSON token.');
        if (/^-?\d/.test(token) && !Number.isFinite(Number(token))) throw new Error('Non-finite JSON number.');
        at += token.length;
    };
    value(0); space();
    if (at < text.length) throw new Error('Unexpected text after the JSON payload.');
}

const length = (v, what) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_LENGTH) throw new Error(`Length is negative, non-finite or out of range (${what}).`);
    return v;
};
// The panel's top line as [x, height] points from its shape (the generator's own reading follows).
function topOf(shape) {
    const L = length(shape.lengthIn, 'lengthIn');
    if (shape.kind === 'rect') { const H = length(shape.heightIn, 'heightIn'); return { L, top: [[0, H], [L, H]] }; }
    if (shape.kind === 'rake') return { L, top: [[0, length(shape.leftIn, 'leftIn')], [L, length(shape.rightIn, 'rightIn')]] };
    if (shape.kind === 'gable') return { L, top: [[0, length(shape.leftIn, 'leftIn')], [length(shape.peakAtIn, 'peakAtIn'), length(shape.peakIn, 'peakIn')], [L, length(shape.rightIn, 'rightIn')]] };
    if (!Array.isArray(shape.points) || shape.points.length < 2 || shape.points.length > 4096) throw new Error('Invalid top profile.');
    return { L, top: shape.points.map(p => { if (!Array.isArray(p) || p.length !== 2) throw new Error('Invalid top profile.'); return [length(p[0], 'point'), length(p[1], 'point')]; }) };
}

export function readExchange(input) {
    let data = input;
    if (typeof input === 'string') {
        if (new TextEncoder().encode(input).length > MAX_BYTES) throw new Error('Panel JSON exceeds the 32 MB limit. Export a smaller selection.');
        scanJson(input);
        data = JSON.parse(input);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a JSON object.');
    if (data.format !== 'cas-panel-shops' || data.version !== 1) throw new Error('Expected cas-panel-shops version 1.');
    if (data.source?.units != null && data.source.units !== 'in') throw new Error('Only inch-based panel files are supported.');
    const basis = data.source?.coordinates?.basis;
    if (basis != null && basis !== 'internal' && basis !== 'shared') throw new Error('Unknown coordinate basis.');
    if (!Array.isArray(data.panels) || data.panels.length > MAX_PANELS) throw new Error('Panels must be an array of at most 2,000 entries.');
    for (const p of data.panels) {
        sourceFraming(p);
        if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Expected a JSON object.');
        if (typeof p.mark !== 'string' || !p.mark.trim()) throw new Error('Every panel needs a nonempty mark.');
        let L, top;
        if (p.shape) {
            if (!SHAPES.includes(p.shape.kind)) throw new Error('Unsupported or missing shape.');
            ({ L, top } = topOf(p.shape));
            const progress = top[0][0] === 0 && Math.abs(top[top.length - 1][0] - L) < 1e-9 && top.every((q, i) => q[1] > 0 && (i === 0 || q[0] > top[i - 1][0]));
            if (!(L > 0) || !progress) throw new Error('Invalid top profile.');
        } else if (Array.isArray(p.outline)) {
            if (p.outline.length < 3 || p.outline.length > 4096) throw new Error('Invalid top profile.');
            for (const q of p.outline) { if (!Array.isArray(q) || q.length !== 2) throw new Error('Invalid top profile.'); length(q[0], 'outline'); length(q[1], 'outline'); }
        } else throw new Error('Unsupported or missing shape.');
        for (const o of p.openings || []) {
            if (!o || typeof o !== 'object') throw new Error('Expected a JSON object.');
            if (!KINDS.includes(o.kind)) throw new Error('Unknown opening kind.');
            for (const k of ['leftIn', 'widthIn', 'heightIn', 'sillIn']) if (o[k] != null) length(o[k], k);
            // Doors are floor-based in the current engine. A model door above the wall base cannot be
            // normalized to sill 0 without moving locked source geometry: reject before cleanPanel.
            if (p.revit && typeof p.revit === 'object' && o.kind === 'door' && (o.sillIn ?? 0) > 0)
                throw new Error('A model door cut is above the panel bottom. Elevated door cuts are not supported; review the source geometry before importing.');
            // A model's opening must sit inside its wall (the model's own geometry; never trimmed here).
            if (top && p.revit && typeof p.revit === 'object') {
                const left = o.leftIn ?? 0, width = o.widthIn ?? 0, height = o.heightIn ?? 0, sill = o.kind === 'door' ? 0 : o.sillIn ?? 0;
                const at = (x) => { let i = 1; while (i < top.length - 1 && top[i][0] < x) i++; const a = top[i - 1], b = top[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); };
                const roof = Math.min(at(left), at(Math.min(L, left + width)), ...top.filter(q => q[0] >= left && q[0] <= left + width).map(q => q[1]));
                if (!(width > 0) || left + width > L + 1 / 16 || (o.kind !== 'steel' && !(height > 0)) || sill >= roof || (o.kind !== 'steel' && sill + height > roof + 1 / 16))
                    throw new Error('Opening size or position is invalid.');
            }
        }
    }
    return data;
}
