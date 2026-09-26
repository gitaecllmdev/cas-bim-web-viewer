// QR code encoder (pure, no dependencies): byte mode, error correction level M, versions 1-20 (up to 666 bytes).
// Used for the panel-page link on the shop drawings (SVG, PDF, print). Tested in tests/qr.test.js.
// Structure follows ISO/IEC 18004:2015: data encoding (§7.4), Reed-Solomon error correction over GF(256) with
// polynomial 0x11D (§7.5), block interleaving (§7.6), module placement (§7.7), masking and penalty scoring (§7.8),
// format information BCH(15,5) with mask 0x5412 (§7.9) and version information BCH(18,6) (§7.10).

// Level M, per version (index 0 unused): error correction codewords per block, and number of blocks.
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
const MAX_VERSION = 20;
const FORMAT_LEVEL_M = 0; // format bits for level M are 00

// Modules available for data and error correction in a version (everything minus the function patterns).
function rawDataModules(ver) {
    let n = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const align = Math.floor(ver / 7) + 2;
        n -= (25 * align - 10) * align - 55;
        if (ver >= 7) n -= 36;
    }
    return n;
}
const dataCodewords = (ver) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

function alignmentPositions(ver) {
    if (ver === 1) return [];
    const size = ver * 4 + 17, count = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
    const out = [6];
    for (let pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
    return out;
}

// GF(256) multiply, x^8 + x^4 + x^3 + x^2 + 1.
function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
}
function rsDivisor(degree) {
    const d = new Array(degree).fill(0);
    d[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < d.length; j++) {
            d[j] = gfMul(d[j], root);
            if (j + 1 < d.length) d[j] ^= d[j + 1];
        }
        root = gfMul(root, 0x02);
    }
    return d;
}
function rsRemainder(data, divisor) {
    const r = divisor.map(() => 0);
    for (const b of data) {
        const factor = b ^ r.shift();
        r.push(0);
        divisor.forEach((c, i) => { r[i] ^= gfMul(c, factor); });
    }
    return r;
}

const utf8 = (text) => [...new TextEncoder().encode(text)];

// Data codewords: mode 0100 (byte), character count, the bytes, terminator, pad bytes 0xEC 0x11.
function encodeData(bytes, ver) {
    const bits = [];
    const put = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    put(0b0100, 4);
    put(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach(b => put(b, 8));
    const capacity = dataCodewords(ver) * 8;
    put(0, Math.min(4, capacity - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    return out;
}

// Split into blocks, add Reed-Solomon codewords, interleave.
function addEcc(data, ver) {
    const numBlocks = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver];
    const raw = Math.floor(rawDataModules(ver) / 8);
    const numShort = numBlocks - (raw % numBlocks), shortLen = Math.floor(raw / numBlocks);
    const div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
        const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
        k += dat.length;
        const ecc = rsRemainder(dat, div);
        if (i < numShort) dat.push(0); // placeholder so all blocks have the same length
        blocks.push(dat.concat(ecc));
    }
    const out = [];
    for (let i = 0; i < blocks[0].length; i++) {
        blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= numShort) out.push(b[i]); });
    }
    return out;
}

const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function buildMatrix(ver, codewords, mask) {
    const size = ver * 4 + 17;
    const dark = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, v) => { dark[y][x] = v; fixed[y][x] = true; };

    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); } // timing
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) { // finders + separators
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
            if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
        }
    }
    const pos = alignmentPositions(ver), last = pos.length - 1;
    pos.forEach((ay, i) => pos.forEach((ax, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; // under a finder
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    drawFormat(set, size, 0); // reserve the format areas (real bits below)
    if (ver >= 7) {
        let rem = ver;
        for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
        const bits = (ver << 12) | rem;
        for (let i = 0; i < 18; i++) {
            const v = ((bits >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
            set(a, b, v);
            set(b, a, v);
        }
    }

    // Data: two-module columns, zigzag up and down from the bottom right, skipping the vertical timing column.
    let bit = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
                if (!fixed[y][x] && bit < codewords.length * 8) {
                    dark[y][x] = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
                    bit++;
                }
            }
        }
    }
    const fn = MASKS[mask];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && fn(x, y)) dark[y][x] = !dark[y][x];
    drawFormat(set, size, mask);
    return dark;
}

function drawFormat(set, size, mask) {
    const data = (FORMAT_LEVEL_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bitAt = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bitAt(i));
    set(8, 7, bitAt(6));
    set(8, 8, bitAt(7));
    set(7, 8, bitAt(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bitAt(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bitAt(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bitAt(i));
    set(8, size - 8, true); // dark module
}

// Penalty rules N1-N4 (§7.8.3): lower is easier to scan.
function penalty(m) {
    const size = m.length;
    let score = 0;
    const lines = [];
    for (let i = 0; i < size; i++) { lines.push(m[i]); lines.push(m.map(row => row[i])); }
    for (const line of lines) {
        let run = 1;
        for (let i = 1; i <= size; i++) {
            if (i < size && line[i] === line[i - 1]) run++;
            else { if (run >= 5) score += 3 + (run - 5); run = 1; }
        }
        const s = line.map(v => (v ? '1' : '0')).join('');
        for (const pat of ['10111010000', '00001011101']) {
            for (let i = s.indexOf(pat); i >= 0; i = s.indexOf(pat, i + 1)) score += 40;
        }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
    const darkCount = m.reduce((a, row) => a + row.filter(Boolean).length, 0), total = size * size;
    score += 10 * Math.max(0, Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1);
    return score;
}

// text -> { size, version, dark: boolean[size][size] } (no quiet zone; leave 4 modules of white around it).
export function qrEncode(text) {
    const bytes = utf8(String(text));
    let ver = 1;
    const fits = (v) => 4 + (v <= 9 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8;
    while (ver <= MAX_VERSION && !fits(ver)) ver++;
    if (ver > MAX_VERSION) throw new Error(`Text too long for a QR code (${bytes.length} bytes)`);
    const codewords = addEcc(encodeData(bytes, ver), ver);
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
        const dark = buildMatrix(ver, codewords, mask);
        const score = penalty(dark);
        if (!best || score < best.score) best = { dark, score, mask };
    }
    return { size: ver * 4 + 17, version: ver, mask: best.mask, dark: best.dark };
}

// Dark modules as rectangles (horizontal runs merged): [{ x, y, w, h }] in module units. Keeps SVG/PDF output small.
export function qrRects(qr) {
    const out = [];
    qr.dark.forEach((row, y) => {
        for (let x = 0; x < qr.size; x++) {
            if (!row[x]) continue;
            let w = 1;
            while (x + w < qr.size && row[x + w]) w++;
            out.push({ x, y, w, h: 1 });
            x += w - 1;
        }
    });
    return out;
}
