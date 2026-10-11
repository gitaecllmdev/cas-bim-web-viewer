// Pick a bounded toolbar position with the least overlap with the selected item's screen box.
export function barPosition(hit, bounds, width, height, tall = false) {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
    const centerX = (hit.left + hit.right - width) / 2, centerY = (hit.top + hit.bottom - height) / 2;
    const sides = [[hit.right + 30, centerY], [hit.left - width - 30, centerY]];
    const ends = [[centerX, hit.top - height - 22], [centerX, hit.bottom + 22]];
    const candidates = (tall ? [...sides, ...ends] : [...ends, ...sides]).map(([x, y]) => ({
        left: clamp(x, bounds.left + 4, bounds.right - width - 4),
        top: clamp(y, bounds.top + 4, bounds.bottom - height - 4),
    }));
    const overlap = p => Math.max(0, Math.min(p.left + width, hit.right) - Math.max(p.left, hit.left))
        * Math.max(0, Math.min(p.top + height, hit.bottom) - Math.max(p.top, hit.top));
    return candidates.reduce((best, p) => overlap(p) < overlap(best) ? p : best);
}
