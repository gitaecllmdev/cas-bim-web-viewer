// Display only: nearest eighth inch, with reduced fractions. Never use for fabrication values.
export function formatDimension(value, { feet = false, compactFeet = false, leadingZero = false } = {}) {
    const ticks = Math.round(Math.abs(value) * 8), sign = value < 0 && ticks ? '-' : '';
    const ft = feet || compactFeet ? Math.floor(ticks / 96) : 0;
    const rest = ticks - ft * 96, whole = Math.floor(rest / 8);
    let n = rest % 8, d = 8;
    while (n && n % 2 === 0) { n /= 2; d /= 2; }
    const inch = `${whole || !n || leadingZero || ft ? whole : ''}${n ? `${whole || leadingZero || ft ? ' ' : ''}${n}/${d}` : ''}`;
    return `${sign}${feet || (compactFeet && ft) ? `${ft}'-` : ''}${inch}"`;
}
