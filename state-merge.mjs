// Growing demo state on the static review site: the copy a reviewer's browser saved (localStorage) and the copy
// published with the site are merged entry by entry, so walls scanned and panels saved in either place all show
// (a saved copy used to hide everything published after it). The newer entry wins, by its `at` / `savedAt` time;
// when neither has one, the reviewer's own copy wins.
// Where each state keeps its entries: null = at the top level ({ <externalId>: {...} }), else under that key.
const MERGED = {
    'wall-openings': null,         // { <wall externalId>: { lengthIn, heightIn, openings, at } }
    'shop-panel-index': 'panels',  // { panels: { <panel key>: { mark, level, ..., savedAt } } }
};

// A model's own copy is '<name>-<model key>' (helpers.js stateFor): merged the same way as the plain name.
const baseOf = (name) => (Object.prototype.hasOwnProperty.call(MERGED, name) ? name
    : Object.keys(MERGED).find(k => name.startsWith(`${k}-`) && /^[a-z0-9]+$/.test(name.slice(k.length + 1))) ?? null);
export const isMergedState = (name) => baseOf(name) !== null;

const stamp = (entry) => Date.parse(entry?.at ?? entry?.savedAt ?? '') || 0;

function mergeEntries(published, local) {
    const out = { ...(isObject(published) ? published : {}) };
    for (const [key, entry] of Object.entries(isObject(local) ? local : {})) {
        if (!(key in out) || stamp(entry) >= stamp(out[key])) out[key] = entry;
    }
    return out;
}

export function mergeState(name, published, local) {
    if (!isMergedState(name)) return local ?? published;
    const key = MERGED[baseOf(name)];
    if (key === null) return mergeEntries(published, local);
    return { ...(isObject(published) ? published : {}), ...(isObject(local) ? local : {}), [key]: mergeEntries(published?.[key], local?.[key]) };
}

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
