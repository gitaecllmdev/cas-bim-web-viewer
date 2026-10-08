// 3D view of a framed panel for the shop drawing (pure; tested in tests/shop-drawings.test.js): every member as a box
// (studs their flange wide and the stud depth deep, tracks and headers the same depth), seen in perspective from
// side A, from the left and above; one label per cut-list mark; the openings outlined. The view is cropped to the
// members and fitted in a box on the sheet, so it fills its space whatever the panel's shape.
// Returns sheet primitives (sheet.mjs): 'poly' (filled faces), 'line' (edges, openings), 'rect' + 'text' (labels).
import { fmtFtIn, isDoor, topAt } from '../common/framing.mjs';

const FUNC_COLOR = { TTOP: '#f2d64b', TBOT: '#f2d64b', HDD: '#f4a7a0', HDW: '#f4a7a0', SBW: '#f4a7a0' };
const STUD = '#e4e4e4';
const SEG = 16; // long members are drawn in pieces this long, so near and far parts sort in front of / behind their neighbours

// Camera: from side A (+z), the left (-x) and above (+y), mild perspective.
const AZIMUTH = 32, ELEVATION = 24, DISTANCE = 2.4; // degrees, degrees, times the panel's diagonal

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };

function shade(hex, f) {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const out = c.map(v => Math.max(0, Math.min(255, Math.round(f >= 1 ? v + (255 - v) * (f - 1) * 2 : v * f))));
    return `#${out.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// The six faces of a box: corners (counter-clockwise seen from outside), outward normal, light factor.
function boxFaces([x0, y0, z0], [x1, y1, z1]) {
    return [
        { n: [0, 0, 1], k: 1.0, c: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] }, // front (side A)
        { n: [0, 0, -1], k: 0.7, c: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]] },
        { n: [0, 1, 0], k: 1.06, c: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]] }, // top
        { n: [0, -1, 0], k: 0.65, c: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
        { n: [-1, 0, 0], k: 0.82, c: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] }, // left
        { n: [1, 0, 0], k: 0.75, c: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]] },
    ];
}

// A member with an outline (m.pts: under a sloped top) as a prism D deep, in pieces SEG long along it like the boxes:
// the outline cut to each piece, its front and back faces and one side face per edge. Cut faces between pieces are
// inside the member: never drawn.
function outlineFaces(m, D, project, eye) {
    const long = m.orient === 'h' ? 0 : 1, lo = long === 0 ? m.x : m.y, len = long === 0 ? m.w : m.h;
    const pieces = Math.max(1, Math.ceil(len / SEG - 1e-9));
    const color = FUNC_COLOR[m.func] || STUD;
    const half = (P, v, keepAbove) => { // the part of polygon P on one side of the line (axis long) = v
        const out = [], f = (p) => (keepAbove ? p[long] - v : v - p[long]);
        P.forEach((p, i) => {
            const q = P[(i + 1) % P.length], fp = f(p), fq = f(q);
            if (fp >= 0) out.push(p);
            if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
        });
        return out;
    };
    const faces = [];
    for (let i = 0; i < pieces; i++) {
        const a = lo + (len * i) / pieces, b = lo + (len * (i + 1)) / pieces;
        const P = half(half(m.pts, a, true), b, false);
        if (P.length < 3) continue;
        const cut = (p) => (i > 0 && Math.abs(p[long] - a) < 1e-6) || (i < pieces - 1 && Math.abs(p[long] - b) < 1e-6);
        const polys = [{ n: [0, 0, 1], k: 1.0, c: P.map(([x, y]) => [x, y, D]) }, { n: [0, 0, -1], k: 0.7, c: [...P].reverse().map(([x, y]) => [x, y, 0]) }];
        P.forEach((p, j) => {
            const q = P[(j + 1) % P.length];
            if (cut(p) && cut(q)) return; // the cut between two pieces
            const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
            if (l < 1e-9) return;
            const n = [dy / l, -dx / l, 0], k = n[1] > 0.5 ? 1.06 : n[1] < -0.5 ? 0.65 : n[0] < 0 ? 0.82 : 0.75;
            polys.push({ n, k, c: [[p[0], p[1], D], [p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], D]] });
        });
        for (const f of polys) {
            const centroid = f.c.reduce((s, p) => s.map((v, k) => v + p[k] / f.c.length), [0, 0, 0]);
            if (dot(f.n, sub(eye, centroid)) <= 0) continue;
            const edges = f.c.map((p, k) => [p, f.c[(k + 1) % f.c.length]]).filter(([p, q]) => !(cut(p) && cut(q)));
            faces.push({ pts: f.c.map(project), edges: edges.map(([p, q]) => [project(p), project(q)]), fill: shade(color, f.k), depth: Math.hypot(...sub(centroid, eye)) });
        }
    }
    return faces;
}

// layout: frameWall() output; box: { x, y, w, h } on the sheet (inches); opts: { flangeIn, highlight }.
export function isoView(layout, box, { flangeIn = 1.625, highlight = null } = {}) {
    const { lengthIn: L, heightIn: H, members, openings = [] } = layout;
    const D = layout.studIn || 3.625;
    if (!members?.length || !(L > 0) || !(H > 0)) return [];
    const az = (AZIMUTH * Math.PI) / 180, el = (ELEVATION * Math.PI) / 180;
    const center = [L / 2, H / 2, D / 2];
    const dir = [-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    const eye = center.map((v, i) => v + dir[i] * Math.hypot(L, H) * DISTANCE);
    const fwd = unit(sub(center, eye)), right = unit(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
    const project = (p) => { const v = sub(p, eye), z = dot(v, fwd); return [dot(v, right) / z, -dot(v, up) / z]; };

    // Faces of every member, long members in pieces; an edge is drawn only where it is a real edge of the member.
    const faces = [];
    for (const m of members) {
        if (m.pts) { faces.push(...outlineFaces(m, D, project, eye)); continue; } // under a sloped top
        const long = m.orient === 'h' ? 0 : 1; // the axis the member runs along
        const lo = long === 0 ? m.x : m.y, len = long === 0 ? m.w : m.h;
        const pieces = Math.max(1, Math.ceil(len / SEG - 1e-9));
        const color = (highlight != null && m.mark === highlight) ? '#ff8a3d' : FUNC_COLOR[m.func] || STUD;
        for (let i = 0; i < pieces; i++) {
            const a = lo + (len * i) / pieces, b = lo + (len * (i + 1)) / pieces;
            const min = long === 0 ? [a, m.y, 0] : [m.x, a, 0], max = long === 0 ? [b, m.y + m.h, D] : [m.x + m.w, b, D];
            for (const f of boxFaces(min, max)) {
                // A cut face between two pieces is inside the member: never drawn.
                if (f.n[long] !== 0 && ((f.n[long] < 0 && i > 0) || (f.n[long] > 0 && i < pieces - 1))) continue;
                const centroid = f.c.reduce((s, p) => s.map((v, k) => v + p[k] / 4), [0, 0, 0]);
                if (dot(f.n, sub(eye, centroid)) <= 0) continue; // facing away
                const edges = f.c.map((p, k) => [p, f.c[(k + 1) % 4]]).filter(([p, q]) => {
                    const along = p[long] !== q[long];
                    return along || Math.abs(p[long] - lo) < 1e-6 || Math.abs(p[long] - (lo + len)) < 1e-6;
                });
                faces.push({ pts: f.c.map(project), edges: edges.map(([p, q]) => [project(p), project(q)]), fill: shade(color, f.k), depth: Math.hypot(...sub(centroid, eye)) });
            }
        }
    }
    faces.sort((a, b) => b.depth - a.depth); // far first

    // One label per cut-list mark, beside its middle member (never over it, so the member reads unbroken): a stud's
    // just left of its front edge, a track's just above it (below it for a bottom track).
    const byMark = new Map();
    for (const m of members) if (m.mark) (byMark.get(m.mark) || byMark.set(m.mark, []).get(m.mark)).push(m);
    const labels = [...byMark].map(([mark, ms]) => {
        const sorted = [...ms].sort((a, b) => (a.x - b.x) || (a.y - b.y)), m = sorted[Math.floor(sorted.length / 2)];
        const low = m.orient === 'h' && m.y < 1;
        const top = m.role === 'top track' && layout.top ? topAt(layout.top, m.x + m.w / 2, H) : m.y + m.h; // a sloped top track: at its middle
        const at = m.orient === 'h' ? [m.x + m.w / 2, low ? m.y : top, D] : [m.x, m.y + m.h * 0.62, D];
        return { mark, at: project(at), kind: m.orient === 'h' ? (low ? 'below' : 'above') : 'left', hi: highlight != null && mark === highlight };
    });
    const opens = openings.map(o => ({ o, pts: [[o.left, o.bottom, D], [o.right, o.bottom, D], [o.right, o.top, D], [o.left, o.top, D]].map(project),
        label: project([(o.left + o.right) / 2, Math.min(o.top - 6, o.bottom + (o.top - o.bottom) * 0.55), D]) }));

    // Crop to what is drawn and fit the box (a little margin for the labels).
    const all = faces.flatMap(f => f.pts);
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = 0.12, s = Math.min((box.w - 2 * pad) / (maxX - minX || 1), (box.h - 2 * pad) / (maxY - minY || 1));
    const ox = box.x + (box.w - (maxX - minX) * s) / 2 - minX * s, oy = box.y + (box.h - (maxY - minY) * s) / 2 - minY * s;
    const T = (p) => [ox + p[0] * s, oy + p[1] * s];

    const out = [];
    for (const o of opens) {
        const p = o.pts.map(T);
        for (let k = 0; k < 4; k++) out.push({ t: 'line', x1: p[k][0], y1: p[k][1], x2: p[(k + 1) % 4][0], y2: p[(k + 1) % 4][1], stroke: '#9aa0a6', width: 0.006, dash: '0.04 0.03' });
    }
    for (const f of faces) {
        out.push({ t: 'poly', pts: f.pts.map(T), fill: f.fill, stroke: 'none', width: 0 });
        for (const [p, q] of f.edges) { const [a, b] = [T(p), T(q)]; out.push({ t: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#3a3a3a', width: 0.004 }); }
    }
    for (const { o, label } of opens) {
        const [x, y] = T(label), txt = `${isDoor(o) ? 'DOOR' : 'OPENING'} ${fmtFtIn(o.right - o.left)} x ${fmtFtIn(o.top - o.bottom)}`;
        out.push({ t: 'text', x, y, s: txt, size: 0.06, anchor: 'middle', weight: 'normal', rotate: 0, fill: '#6b7178' });
    }
    // Labels: plain text (no box), moved up when it would sit on one already placed.
    const placed = [];
    for (const l of labels) {
        let [x, y] = T(l.at);
        const w = 0.06 * Math.max(2, l.mark.length), h = 0.1;
        if (l.kind === 'left') { x -= 0.02 + w / 2; y += 0.03; } else if (l.kind === 'above') y -= 0.035; else y += 0.09;
        for (let k = 0; k < 6 && placed.some(r => Math.abs(r.x - x) < (r.w + w) / 2 && Math.abs(r.y - y) < h); k++) y -= h * 1.05;
        placed.push({ x, y, w });
        out.push({ t: 'text', x, y, s: l.mark, size: 0.075, anchor: 'middle', weight: 'bold', rotate: 0, fill: l.hi ? '#b34700' : '#111' });
    }
    return out;
}
