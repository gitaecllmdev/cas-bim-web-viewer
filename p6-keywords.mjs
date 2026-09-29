// Keyword search for the P6 Converter: several keywords at once, and a history of every keyword used.
// A keyword is one or more words that must all appear in a row (in any order), or a "quoted phrase". A row is shown
// when it matches any of the keywords (or every keyword, with { all: true }). Case-insensitive. No DOM: tested in Node.

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

// "frame, drywall L3, "level 3"" -> ['frame', 'drywall L3', '"level 3"']: commas separate keywords (not inside quotes).
export function parseKeywords(input) {
    const out = [];
    let cur = '', quoted = false;
    for (const ch of String(input ?? '')) {
        if (ch === '"') quoted = !quoted;
        if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map(k => k.replace(/\s+/g, ' ').trim()).filter(k => k && k !== '""');
}

// The words a keyword needs: 'drywall "level 3"' -> ['drywall', 'level 3'].
export function termsOf(keyword) {
    const terms = [];
    for (const m of String(keyword ?? '').matchAll(/"([^"]*)"|(\S+)/g)) {
        const t = norm(m[1] ?? m[2]);
        if (t) terms.push(t);
    }
    return terms;
}

export const matchesKeyword = (text, keyword) => {
    const terms = termsOf(keyword);
    return terms.length > 0 && terms.every(t => text.includes(t));
};

// texts: one lower-case string per row. Returns, per row, the keywords it matched, or null when the row is not shown.
// With no keywords every row is shown (and matched none).
export function matchRows(texts, keywords, { all = false } = {}) {
    const list = keywords.filter(k => termsOf(k).length);
    if (!list.length) return texts.map(() => []);
    return texts.map((text) => {
        const hits = list.filter(k => matchesKeyword(text, k));
        return (all ? hits.length === list.length : hits.length > 0) ? hits : null;
    });
}

// Rows each keyword matches (for the counts on the keyword chips).
export const keywordCounts = (texts, keywords) => new Map(keywords.map(k => [k, texts.reduce((n, t) => n + (matchesKeyword(t, k) ? 1 : 0), 0)]));

// Keyword history: most recent first, one entry per keyword (case-insensitive), at most `max`.
export function remember(history, keywords, { now = Date.now(), max = 60 } = {}) {
    const next = [...(history || [])];
    for (const text of keywords) {
        const at = next.findIndex(h => norm(h.text) === norm(text));
        const old = at >= 0 ? next.splice(at, 1)[0] : null;
        next.unshift({ text, uses: (old?.uses || 0) + 1, at: new Date(now).toISOString() });
    }
    return next.slice(0, max);
}
