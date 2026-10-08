// Short panel links for QR codes (pure; tested in tests/qr.test.js). A panel's page as <site>/p/?<code>, the code six
// letters and digits from the panel's key (its wall's Revit UniqueId; FNV-1a), so the QR code on its sheet and label
// stays small and coarse: version 4 (33 modules) for the review sites, against version 7 (45) for the full link, and
// prints large enough to scan from a distance. core/client/p/index.html sends the link on to panel.html?s=<code>, which
// finds the panel in the site's panel lists.
export function shortCode(key) {
    let h = 0x811c9dc5;
    for (const ch of String(key || '').toLowerCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return (h % 36 ** 6).toString(36).padStart(6, '0');
}

// base: the site's address (CONFIG.publicUrl or the page's folder).
export const shortLink = (base, key) => `${String(base).replace(/\/?$/, '/')}p/?${shortCode(key)}`;

// The code in a short link (a scanned label or sheet), or null.
export function linkCode(text) {
    const m = /\/p\/\?([0-9a-z]{6})\s*$/i.exec(String(text || '').trim());
    return m ? m[1].toLowerCase() : null;
}
