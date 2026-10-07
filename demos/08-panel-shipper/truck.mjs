// A truck and its load as an SVG (pure; tested in tests/shipper.test.js): the trailer (deck, gooseneck, wheels), a
// tractor, and every panel as a box on its stack (rows front to back, stacks side by side across the deck), in
// perspective from the driver's side, ahead and above; painted far to near. Each stack shows the load numbers of its
// panels (loadSequence: front row first, bottom to top). Panels carry data-key and a title so the page can pick them;
// a highlighted panel is orange, filtered-out panels fade.
import { loadSequence } from './shipping.mjs';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const n2 = (v) => Number(v.toFixed(2));

function shade(hex, f) {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const out = c.map(v => Math.max(0, Math.min(255, Math.round(f >= 1 ? v + (255 - v) * (f - 1) * 2 : v * f))));
    return `#${out.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// Box faces: corners, outward normal, light factor (x along the deck front to back, y across, z up).
function boxFaces([x0, y0, z0], [x1, y1, z1]) {
    return [
        { n: [0, 0, 1], k: 1.08, c: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
        { n: [0, 0, -1], k: 0.6, c: [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]] },
        { n: [0, -1, 0], k: 0.9, c: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
        { n: [0, 1, 0], k: 0.7, c: [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]] },
        { n: [-1, 0, 0], k: 0.8, c: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
        { n: [1, 0, 0], k: 0.75, c: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
    ];
}

// t: a truck (shipping.mjs); opts: { color, highlight (a panel key), faded (Set of keys), width, height }.
export function truckSvg(t, { color = '#e8a33d', highlight = null, faded = null, width = 1000, height = 560 } = {}) {
    const tr = t.trailer, L = tr.lengthIn, W = tr.widthIn, D = tr.deckIn;
    const center = [L / 2 - 40, W / 2, D + 30];
    const dir = unit([-0.55, -1, 0.62]), eye = center.map((v, i) => v + dir[i] * 1500);
    const fwd = unit(sub(center, eye)), right = unit(cross(fwd, [0, 0, 1])), up = cross(right, fwd);
    const project = (p) => { const v = sub(p, eye), z = dot(v, fwd); return [dot(v, right) / z, -dot(v, up) / z]; };

    const faces = [];
    const addBox = (min, max, fill, extra = {}) => {
        for (const f of boxFaces(min, max)) {
            const centroid = f.c.reduce((s, p) => s.map((v, k) => v + p[k] / 4), [0, 0, 0]);
            if (dot(f.n, sub(eye, centroid)) <= 0) continue; // facing away
            faces.push({ pts: f.c.map(project), fill: shade(fill, f.k), depth: Math.hypot(...sub(centroid, eye)), ...extra });
        }
    };
    addBox([-190, 8, 30], [-75, W - 8, 140], '#d0d4da'); // tractor cab
    addBox([-190, 4, 28], [-30, W - 4, 40], '#5b6168');
    addBox([-75, 0, D], [0, W, D + 34], '#454a51'); // gooseneck
    addBox([0, 0, D - 9], [L, W, D], '#3b3f46'); // deck
    const wheels = [-160, -80, L - 120, L - 70].map(x => Array.from({ length: 20 }, (_, i) => {
        const a = (i / 20) * Math.PI * 2;
        return project([x + Math.cos(a) * 20, -1, 21 + Math.sin(a) * 20]);
    }));
    const seq = new Map(loadSequence(t).map(s => [s.panel.key, s.n]));
    for (const r of t.rows) {
        const y0 = (W - r.widthUsed) / 2; // the row's lanes centered across the deck (a wide one overhangs both sides)
        for (const s of r.stacks) {
            for (const p of s.panels) {
                const y = y0 + s.y + (s.widthIn - p.heightIn) / 2, z0 = D + p.z;
                addBox([s.x, y, z0], [s.x + p.lengthIn, y + p.heightIn, z0 + p.thickIn + 0.5], highlight === p.key ? '#ff8a3d' : color,
                    { key: p.key, title: `#${seq.get(p.key)} ${p.mark} · ${Math.round(p.lengthIn / 12)}' x ${Math.round(p.heightIn / 12)}' · ${Math.round(p.weightLb)} lb`, faded: faded?.has(p.key) });
            }
        }
    }
    faces.sort((a, b) => b.depth - a.depth);

    const all = [...faces.flatMap(f => f.pts), ...wheels.flat()];
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const [x0, x1, yA, yB] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = 24, sc = Math.min((width - 2 * pad) / (x1 - x0), (height - 2 * pad) / (yB - yA));
    const T = ([x, y]) => [n2(pad + (x - x0) * sc + ((width - 2 * pad) - (x1 - x0) * sc) / 2), n2(pad + (y - yA) * sc + ((height - 2 * pad) - (yB - yA) * sc) / 2)];
    const poly = (pts, attrs) => `<polygon points="${pts.map(T).map(p => p.join(',')).join(' ')}" ${attrs}/>`;

    const out = wheels.map(w => poly(w, 'fill="#1f2226"'));
    for (const f of faces) {
        const attrs = `fill="${f.fill}" stroke="#2b2f34" stroke-width="0.6" stroke-linejoin="round"${f.faded ? ' opacity="0.22"' : ''}${f.key ? ` data-key="${esc(f.key)}" class="ps-panel"` : ''}`;
        out.push(f.title ? `<g>${poly(f.pts, attrs)}<title>${esc(f.title)}</title></g>` : poly(f.pts, attrs));
    }
    // Each stack: the load numbers of its panels, on its top.
    for (const r of t.rows) {
        const y0 = (W - r.widthUsed) / 2;
        for (const s of r.stacks) {
            const first = seq.get(s.panels[0].key), last = seq.get(s.panels.at(-1).key);
            const [lx, ly] = T(project([s.x + s.lengthIn / 2, y0 + s.y + s.widthIn / 2, D + s.heightIn]));
            const label = first === last ? `#${first}` : `#${first}–${last}`;
            out.push(`<text x="${lx}" y="${ly}" font-size="12" text-anchor="middle" font-weight="700" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(label)}</text>`);
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" font-family="Segoe UI, Arial, sans-serif">${out.join('')}</svg>`;
}
