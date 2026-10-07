// A truck and its load as an SVG (pure; tested in tests/shipper.test.js): the flatbed (deck, gooseneck, wheels), a
// tractor, and every panel of the load as a box on its stack, in perspective from the driver's side, in front and
// above; painted far to near. Panels are colored by delivery batch (p.color); a highlighted panel is orange, panels
// filtered out are faded. Each panel's faces carry data-key and a title, so the page can pick them.
import { TRAILER } from './shipping.mjs';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const n = (v) => Number(v.toFixed(2));

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

// truck: one from shipping.mjs planTrucks; opts: { highlight (a panel key), faded (Set of keys), trailer, width, height }.
export function truckSvg(truck, { highlight = null, faded = null, trailer = TRAILER, width = 1000, height = 560 } = {}) {
    const L = trailer.lengthIn, W = trailer.widthIn, D = trailer.deckIn;
    const center = [L / 2 - 40, W / 2, D + 30];
    // From the driver's side (-y), ahead of the truck (-x) and above.
    const dir = unit([-0.55, -1, 0.62]), eye = center.map((v, i) => v + dir[i] * 1500);
    const fwd = unit(sub(center, eye)), right = unit(cross(fwd, [0, 0, 1])), up = cross(right, fwd);
    const project = (p) => { const v = sub(p, eye), z = dot(v, fwd); return [dot(v, right) / z, -dot(v, up) / z]; };

    const faces = [];
    const addBox = (min, max, color, extra = {}) => {
        for (const f of boxFaces(min, max)) {
            const centroid = f.c.reduce((s, p) => s.map((v, k) => v + p[k] / 4), [0, 0, 0]);
            if (dot(f.n, sub(eye, centroid)) <= 0) continue; // facing away
            faces.push({ pts: f.c.map(project), fill: shade(color, f.k), depth: Math.hypot(...sub(centroid, eye)), ...extra });
        }
    };
    // Tractor, gooseneck, deck.
    addBox([-190, 8, 30], [-75, W - 8, 140], '#d0d4da');
    addBox([-190, 4, 28], [-30, W - 4, 40], '#5b6168');
    addBox([-75, 0, D], [0, W, D + 34], '#454a51');
    addBox([0, 0, D - 9], [L, W, D], '#3b3f46');
    // Wheels: a dark disc on the near side, behind the deck's edge (tractor and two rear axles).
    const wheels = [];
    for (const x of [-160, -80, L - 120, L - 70]) {
        const pts = Array.from({ length: 20 }, (_, i) => { const a = (i / 20) * Math.PI * 2; return project([x + Math.cos(a) * 20, -1, 21 + Math.sin(a) * 20]); });
        wheels.push(pts);
    }
    // The load.
    for (const s of truck.stacks) {
        for (const p of s.panels) {
            const y0 = (W - p.heightIn) / 2, z0 = D + p.z;
            const color = highlight === p.key ? '#ff8a3d' : (p.color || '#e8a33d');
            addBox([s.x, y0, z0], [s.x + p.lengthIn, y0 + p.heightIn, z0 + p.thickIn + 0.5], color,
                { key: p.key, title: `${p.mark} · ${p.level || ''} · ${Math.round(p.lengthIn / 12)}' x ${Math.round(p.heightIn / 12)}' · ${Math.round(p.weightLb)} lb`, faded: faded?.has(p.key) });
        }
    }
    faces.sort((a, b) => b.depth - a.depth);

    // Fit the drawing in the view box.
    const all = [...faces.flatMap(f => f.pts), ...wheels.flat()];
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = 24, sc = Math.min((width - 2 * pad) / (x1 - x0), (height - 2 * pad) / (y1 - y0));
    const T = ([x, y]) => [n(pad + (x - x0) * sc + ((width - 2 * pad) - (x1 - x0) * sc) / 2), n(pad + (y - y0) * sc + ((height - 2 * pad) - (y1 - y0) * sc) / 2)];
    const poly = (pts, attrs) => `<polygon points="${pts.map(T).map(p => p.join(',')).join(' ')}" ${attrs}/>`;

    const out = [];
    for (const w of wheels) out.push(poly(w, 'fill="#1f2226"'));
    for (const f of faces) {
        const attrs = `fill="${f.fill}" stroke="#2b2f34" stroke-width="0.6" stroke-linejoin="round"${f.faded ? ' opacity="0.22"' : ''}${f.key ? ` data-key="${esc(f.key)}" class="ps-panel"` : ''}`;
        out.push(f.title ? `<g>${poly(f.pts, attrs)}<title>${esc(f.title)}</title></g>` : poly(f.pts, attrs));
    }
    // A label on top of each stack: its top panel's mark, and how many panels it holds.
    for (const s of truck.stacks) {
        const top = s.panels.at(-1), zt = D + s.heightIn;
        const [lx, ly] = T(project([s.x + s.lengthIn / 2, W / 2, zt]));
        const label = s.panels.length > 1 ? `${top.mark}  (${s.panels.length})` : top.mark;
        const size = Math.max(9, Math.min(13, (s.lengthIn / L) * 60));
        out.push(`<text x="${lx}" y="${ly}" font-size="${size}" text-anchor="middle" font-weight="700" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(label)}</text>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" font-family="Segoe UI, Arial, sans-serif">${out.join('')}</svg>`;
}
