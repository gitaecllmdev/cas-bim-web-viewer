// An opening's members drawn the way a framing engineer details them, from the resolved plan (framing-plan.mjs):
//   - Section A-A: the header or sill cut square, its parts across the wall to scale (a box header: two studs with their
//     webs at the wall faces and their toes in, a track under them legs up and one over them legs down);
//   - the header's end at its jamb, in elevation (it runs over the jamb stud; the cripples above);
//   - the jamb studs in plan (boxed, back to back or the same way).
// Drawing only: which parts, their sizes and which way each faces are the plan's. Sizes come from the SSMA designators
// (depth, flange, mils); lips are SSMA nominal, for the drawing. Screws and connections are the engineer's: marked "per the
// engineer's detail", never counted here. A part the plan leaves unplaced (an arrangement not chosen) is not drawn as
// framing: sectionOf says so, and the page offers the arrangements to choose from.
import { parseMember } from './generator.mjs';
import { profileFromDesignator } from './framing-plan.mjs';
import { partLines } from './sheet.mjs';

// SSMA nominal lips by flange width (hundredths of an inch), for drawing the C.
const LIP_IN = { 125: 0.1875, 137: 0.375, 162: 0.5, 200: 0.625, 250: 0.625, 300: 0.625, 350: 1 };
const FINISH_IN = 0.625; // one layer of 5/8" board each side, dashed: the finish is the architect's
const NEST_GAP_IN = 0.07; // a track drawn this far outside the studs it wraps, so both read (as on an engineer's detail)

const isStud = (designator) => /^(S|CS|CT)$/.test(parseMember(designator)?.profile || '');
function dims(designator) {
    const prof = profileFromDesignator(designator), d = parseMember(designator);
    if (!prof) return null;
    const flangeCode = /^\d{3,4}[A-Z]{1,3}(\d{3})-/.exec(d.name)?.[1];
    return { depthIn: prof.depthIn, flangeIn: prof.flangeIn ?? 1.625, tIn: Math.max((prof.mils || 33) / 1000, 0.018), lipIn: isStud(designator) ? LIP_IN[flangeCode] ?? 0.5 : 0 };
}

// A C (stud, with lips) or U (track) cut square, as a polyline in the section's plane (u across, v up).
//   dir 'u': the web is a line at u = webAt, spanning v = mid +- depth/2; the flanges run toward +u * open.
//   dir 'v': the web is a line at v = webAt, spanning u = mid +- depth/2; the flanges run toward +v * open.
export function channel({ dir, webAt, mid, depth, flange, lip = 0, open }) {
    const A = mid + depth / 2, B = mid - depth / 2, F = webAt + open * flange;
    const pts = dir === 'u'
        ? [lip ? [F, A - lip] : null, [F, A], [webAt, A], [webAt, B], [F, B], lip ? [F, B + lip] : null]
        : [lip ? [A - lip, F] : null, [A, F], [A, webAt], [B, webAt], [B, F], lip ? [B + lip, F] : null];
    return pts.filter(Boolean);
}

// The parts of one assembly as cut: key 'opening#1:head' | 'opening#1:sill' (a section across the wall: u = z, v = y) or
// 'opening#1:jamb:L' (a plan: u = x along the wall, v = z across it).
// -> { key, kind: 'head' | 'sill' | 'jamb', state: 'placed' | 'unresolved' | 'none', wallIn, parts: [{ memberKey, part,
//      designator, stud, pts, web, ... }], fit: { ok, message } }
export function sectionOf(plan, key) {
    const kind = /:jamb:[LR]$/.test(key) ? 'jamb' : /:sill$/.test(key) ? 'sill' : 'head';
    const wallIn = plan?.layout?.studIn ?? 3.625;
    const members = (plan?.members || []).filter(m => m.assemblyKey === key || m.memberKey === key || (kind === 'jamb' && m.memberKey.startsWith(`${key}:`)));
    if (!members.length) return { key, kind, state: 'none', wallIn, parts: [], fit: { ok: true, message: '' } };
    if (members.some(m => m.orientation?.kind !== 'open-side')) {
        const reason = members.find(m => m.orientation?.kind !== 'open-side')?.orientation?.reason || 'arrangement';
        return { key, kind, state: 'unresolved', reason, wallIn, parts: members.map(m => ({ memberKey: m.memberKey, designator: m.designator, stud: isStud(m.designator) })), fit: { ok: true, message: '' } };
    }
    const parts = members.map(m => {
        const dm = dims(m.designator), stud = isStud(m.designator), o = m.orientation.openSide;
        const base = { memberKey: m.memberKey, part: m.partKey || m.memberKey.split(':').pop(), designator: m.designator, stud, ...dm };
        if (kind === 'jamb') { // plan: x along the wall, z across; the web spans the wall, the flanges along it
            const open = Math.sign(o[0]) || 1, web = m.start[0] - open * dm.flangeIn / 2;
            return { ...base, open, web, pts: channel({ dir: 'u', webAt: web, mid: m.start[2], depth: dm.depthIn, flange: dm.flangeIn, lip: dm.lipIn, open }) };
        }
        if (stud) { // a header or sill stud: its web stands up (its depth is the header's), its flanges across the wall
            const open = Math.sign(o[2]) || 1, web = m.start[2] - open * dm.flangeIn / 2;
            return { ...base, open, web, pts: channel({ dir: 'u', webAt: web, mid: m.start[1], depth: dm.depthIn, flange: dm.flangeIn, lip: dm.lipIn, open }) };
        }
        // A track: its web across the wall at the plan's axis (drawn just outside the studs it wraps), its legs up or down.
        const open = Math.sign(o[1]) || 1, outset = dm.tIn + NEST_GAP_IN, web = m.start[1] - open * outset;
        return { ...base, open, web, outset, pts: channel({ dir: 'v', webAt: web, mid: m.start[2], depth: dm.depthIn + 2 * outset, flange: dm.flangeIn, open }) };
    });
    // Do the parts fit across the wall? A box's or back to back pair's two flanges must, and a track's web is the wall's.
    const studs = parts.filter(p => p.stud);
    let fit = { ok: true, message: '' };
    if (kind !== 'jamb' && studs.length === 2) {
        const across = studs[0].flangeIn + studs[1].flangeIn;
        if (across > wallIn + 1e-6) fit = { ok: false, message: `The two studs' flanges (${inches(studs[0].flangeIn)} + ${inches(studs[1].flangeIn)}) do not fit across the ${inches(wallIn)} wall.` };
    }
    const tracks = parts.filter(p => !p.stud);
    if (fit.ok && kind !== 'jamb' && tracks.some(t => Math.abs(t.depthIn - wallIn) > 1e-6))
        fit = { ok: false, message: `A track (${tracks.find(t => Math.abs(t.depthIn - wallIn) > 1e-6).designator}) is not as wide as the ${inches(wallIn)} wall.` };
    return { key, kind, state: 'placed', wallIn, parts, fit, arrangement: arrangementOf(kind, parts, wallIn) };
}
// The arrangement the placed parts make, in words.
function arrangementOf(kind, parts, wallIn) {
    const studs = parts.filter(p => p.stud);
    if (kind === 'jamb') {
        if (studs.length < 2) return 'single';
        const opens = studs.map(s => s.open);
        // Boxed: the outer webs face out, so the first web along the wall opens toward the others; back to back: the reverse.
        if (opens.every(o => o === opens[0])) return 'same way';
        const byWeb = [...studs].sort((a, b) => a.web - b.web);
        return byWeb.some((s, i) => i && Math.abs(s.web - byWeb[i - 1].web) < 0.01) || byWeb[0].open < 0 ? 'back to back' : 'boxed (toe to toe)';
    }
    if (!studs.length) return parts.length > 1 ? 'nested tracks' : 'track';
    if (studs.length === 2) {
        const [a, b] = [...studs].sort((p, q) => p.web - q.web);
        return a.open > 0 && b.open < 0 && Math.abs(a.web) < 1e-6 && Math.abs(b.web - wallIn) < 1e-6 ? 'box (webs at the wall faces, toes in)' : 'back to back (webs together, flanges out)';
    }
    return `${studs.length} studs`;
}

// Inches as written on a drawing: 3 5/8", 1 5/8", 6", 3/8".
export function inches(v) {
    const n = Math.round(Math.abs(v) * 16), w = Math.floor(n / 16), f = n % 16;
    if (!f) return `${v < 0 ? '-' : ''}${w}"`;
    let a = f, b = 16;
    while (a % 2 === 0) { a /= 2; b /= 2; }
    return `${v < 0 ? '-' : ''}${w ? `${w} ` : ''}${a}/${b}"`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r3 = (v) => Math.round(v * 1000) / 1000;

// --- SVG ----------------------------------------------------------------------------------------------------------------
// A keyed note: a numbered circle with a leader to a point; the notes themselves are listed beside the drawing.
const key = (n, [x, y], [tx, ty], fs) => `<line x1="${r3(x)}" y1="${r3(y)}" x2="${r3(tx)}" y2="${r3(ty)}" class="dt-leader"/>`
    + `<circle cx="${r3(tx)}" cy="${r3(ty)}" r="${r3(fs * 0.62)}" class="dt-key"/><text x="${r3(tx)}" y="${r3(ty + fs * 0.34)}" font-size="${r3(fs * 0.9)}" text-anchor="middle" class="dt-keyn">${n}</text>`;
const dimH = (x1, x2, y, label, fs) => `<g class="dt-dim"><line x1="${r3(x1)}" y1="${r3(y)}" x2="${r3(x2)}" y2="${r3(y)}"/>`
    + `<line x1="${r3(x1)}" y1="${r3(y - fs * 0.35)}" x2="${r3(x1)}" y2="${r3(y + fs * 0.35)}"/><line x1="${r3(x2)}" y1="${r3(y - fs * 0.35)}" x2="${r3(x2)}" y2="${r3(y + fs * 0.35)}"/>`
    + `<text x="${r3((x1 + x2) / 2)}" y="${r3(y - fs * 0.35)}" font-size="${r3(fs)}" text-anchor="middle">${esc(label)}</text></g>`;
const dimV = (x, y1, y2, label, fs) => `<g class="dt-dim"><line x1="${r3(x)}" y1="${r3(y1)}" x2="${r3(x)}" y2="${r3(y2)}"/>`
    + `<line x1="${r3(x - fs * 0.35)}" y1="${r3(y1)}" x2="${r3(x + fs * 0.35)}" y2="${r3(y1)}"/><line x1="${r3(x - fs * 0.35)}" y1="${r3(y2)}" x2="${r3(x + fs * 0.35)}" y2="${r3(y2)}"/>`
    + `<text x="${r3(x - fs * 0.45)}" y="${r3((y1 + y2) / 2)}" font-size="${r3(fs)}" text-anchor="middle" transform="rotate(-90 ${r3(x - fs * 0.45)} ${r3((y1 + y2) / 2)})">${esc(label)}</text></g>`;
const poly = (pts, cls, sw) => `<polyline points="${pts.map(([u, v]) => `${r3(u)},${r3(-v)}`).join(' ')}" class="${cls}" stroke-width="${r3(sw)}"/>`;
const screw = (x, y, dir, len) => `<g class="dt-screw"><line x1="${r3(x - dir * len * 0.2)}" y1="${r3(y)}" x2="${r3(x + dir * len)}" y2="${r3(y)}"/><line x1="${r3(x - dir * len * 0.2)}" y1="${r3(y - len * 0.25)}" x2="${r3(x - dir * len * 0.2)}" y2="${r3(y + len * 0.25)}"/></g>`;

// Section A-A of a header or sill (u across the wall, v up), or a jamb in plan (u along the wall, v across it): the
// parts to scale, the wall's faces and finish dashed, dimensions, keyed notes. -> { svg, notes: [text] } ('' when the
// plan has not placed the parts).
export function sectionSvg(sec, { title = '', side = 'L', keys = true } = {}) {
    if (sec.state !== 'placed') return { svg: '', notes: [] };
    const D = sec.wallIn, jamb = sec.kind === 'jamb', studs = sec.parts.filter(p => p.stud), tracks = sec.parts.filter(p => !p.stud);
    const all = sec.parts.flatMap(p => p.pts);
    const pu0 = Math.min(...all.map(p => p[0])), pu1 = Math.max(...all.map(p => p[0])), pv0 = Math.min(...all.map(p => p[1])), pv1 = Math.max(...all.map(p => p[1]));
    const out = [], notes = [], targets = [];
    let box; // the drawing's extent, model inches: [u0, u1, v0, v1]
    if (jamb) {
        const u0 = pu0 - 2.5, u1 = pu1 + (keys ? 4 : 3.2), fs = Math.max(0.24, (u1 - u0) * 0.042);
        box = { u0: u0 - fs * 2.4, u1, v0: -FINISH_IN - fs * 1.2, v1: D + FINISH_IN + fs * 0.6, fs };
        out.push(`<line x1="${r3(u0)}" y1="${r3(-(D + FINISH_IN))}" x2="${r3(u1)}" y2="${r3(-(D + FINISH_IN))}" class="dt-finish"/>`,
            `<line x1="${r3(u0)}" y1="${r3(FINISH_IN)}" x2="${r3(u1)}" y2="${r3(FINISH_IN)}" class="dt-finish"/>`);
        // The opening's side: past the web nearest it, dashed.
        const ro = side === 'L' ? Math.max(...studs.map(p => Math.max(p.web, p.web + p.open * p.flangeIn))) : Math.min(...studs.map(p => Math.min(p.web, p.web + p.open * p.flangeIn)));
        out.push(`<line x1="${r3(ro)}" y1="${r3(-(D + FINISH_IN))}" x2="${r3(ro)}" y2="${r3(FINISH_IN)}" class="dt-ro"/>`,
            `<text x="${r3(ro + (side === 'L' ? 1 : -1) * fs * 0.5)}" y="${r3(-D / 2 + fs * 0.35)}" font-size="${r3(fs)}" text-anchor="${side === 'L' ? 'start' : 'end'}" class="dt-label">${side === 'L' ? 'opening →' : '← opening'}</text>`);
        out.push(dimV(u0 - fs * 0.2, -D, 0, inches(D), fs));
        const ordered = [...studs].sort((p, q) => p.web - q.web);
        targets.push({ text: `(${studs.length}) ${studs[0]?.designator} jamb stud${studs.length === 1 ? '' : 's'}${studs.length > 1 ? `, ${sec.arrangement}` : ''}: each web spans the wall (${inches(studs[0]?.depthIn ?? D)}).`, at: [ordered[0].web, D / 2] });
        targets.push({ text: 'Finish (by others), dashed.', at: [u1 - 1.5, D + FINISH_IN] });
    } else {
        const beyond = (pv1 - pv0) * 0.45, fs = Math.max(0.24, Math.max(D + 2 * FINISH_IN, pv1 - pv0 + beyond) * 0.05);
        box = { u0: -FINISH_IN - fs * 2.6, u1: D + FINISH_IN, v0: pv0 - fs * 4.4, v1: pv1 + beyond + fs * 0.4, fs };
        // The finish each side, and the wall beyond (above a header, below a sill), dashed.
        const bv0 = sec.kind === 'head' ? pv0 : pv0 - beyond, bv1 = sec.kind === 'head' ? pv1 + beyond : pv1;
        out.push(`<line x1="${r3(-FINISH_IN)}" y1="${r3(-bv1)}" x2="${r3(-FINISH_IN)}" y2="${r3(-bv0)}" class="dt-finish"/>`,
            `<line x1="${r3(D + FINISH_IN)}" y1="${r3(-bv1)}" x2="${r3(D + FINISH_IN)}" y2="${r3(-bv0)}" class="dt-finish"/>`);
        const [w0, w1] = sec.kind === 'head' ? [pv1, pv1 + beyond] : [pv0 - beyond, pv0];
        out.push(`<line x1="0" y1="${r3(-w1)}" x2="0" y2="${r3(-w0)}" class="dt-beyond"/><line x1="${r3(D)}" y1="${r3(-w1)}" x2="${r3(D)}" y2="${r3(-w0)}" class="dt-beyond"/>`);
        // Dimensions: the wall under it (the tracks' web), the stud's depth (the header's), the gap between the toes.
        out.push(dimH(0, D, -(pv0 - fs * 1.7), inches(D), fs));
        if (studs.length) {
            const s0 = studs[0], top = Math.max(...s0.pts.map(p => p[1])), bot = Math.min(...s0.pts.map(p => p[1]));
            out.push(dimV(-FINISH_IN - fs * 1.1, -top, -bot, inches(s0.depthIn), fs));
            const [a, b] = [...studs].sort((p, q) => p.web - q.web);
            if (b && a.open > 0 && b.open < 0) { const gap = (b.web - b.flangeIn) - (a.web + a.flangeIn);
                if (gap > 0.05) out.push(dimH(a.web + a.flangeIn, b.web - b.flangeIn, -(pv0 - fs * 3.4), inches(gap), fs * 0.85)); }
        } else if (tracks.length) {
            const t = tracks[0], ys = t.pts.map(p => p[1]);
            out.push(dimV(-FINISH_IN - fs * 1.1, -Math.max(...ys), -Math.min(...ys), `${inches(t.flangeIn)} leg`, fs));
        }
        // Screws through each track leg into the stud web inside it (their count and spacing: the engineer's).
        if (studs.length && tracks.length) for (const t of tracks) for (const [u, dir] of [[-t.outset, 1], [D + t.outset, -1]]) out.push(screw(u - dir * 0.3, -(t.web + t.open * t.flangeIn * 0.55), dir, 0.6));
        // The notes: the studs, each track, the screws, the finish.
        if (studs.length) {
            const s = [...studs].sort((p, q) => q.web - p.web)[0], words = sec.arrangement.startsWith('box') ? 'webs at the wall faces, toes in' : 'webs together, flanges out';
            targets.push({ text: `(${studs.length}) ${studs[0].designator} studs, ${words}: the ${sec.kind === 'head' ? 'header' : 'sill'}'s depth is the stud's (${inches(studs[0].depthIn)}).`, at: [s.web + s.open * 0.02, (pv0 + pv1) / 2] });
        }
        for (const t of [...tracks].sort((p, q) => q.web - p.web)) {
            const over = t.web > (pv0 + pv1) / 2;
            targets.push({ text: `${t.designator} track ${studs.length ? (over ? 'over the studs' : 'under the studs') : `(${sec.kind})`}, legs ${t.open > 0 ? 'up' : 'down'}: its web spans the wall.`, at: [D * 0.75, t.web] });
        }
        if (studs.length && tracks.length) targets.push({ text: 'Screws, track legs to stud webs: per the engineer\'s detail (not counted here).', at: [D + tracks[0].tIn + 0.25, tracks.sort((p, q) => q.web - p.web)[0].web + tracks[0].open * tracks[0].flangeIn * 0.55] });
        targets.push({ text: `Finish (by others) and the wall ${sec.kind === 'head' ? 'above' : 'below'}, dashed.`, at: [D + FINISH_IN, sec.kind === 'head' ? pv1 + beyond * 0.6 : pv0 - beyond * 0.6] });
    }
    for (const p of [...tracks, ...studs]) out.push(poly(p.pts, p.stud ? (jamb ? 'dt-jamb-c' : 'dt-stud') : 'dt-track', Math.max(p.tIn * 1.5, box.fs * 0.09)));
    if (!sec.fit.ok) out.push(`<rect x="${r3(pu0 - 0.15)}" y="${r3(-(pv1 + 0.15))}" width="${r3(pu1 - pu0 + 0.3)}" height="${r3(pv1 - pv0 + 0.3)}" class="dt-clash"/>`);
    // Keyed notes: numbered down a column right of the drawing, in the order of their points from the top.
    const fs = box.fs, kx = box.u1 + fs * 2.6, list = keys ? [...targets].sort((p, q) => q.at[1] - p.at[1]) : [];
    const top = box.v1 - fs * 0.6, bottom = box.v0 + fs * 0.8, step = list.length > 1 ? Math.max(fs * 1.7, (top - bottom) / (list.length - 1)) : 0;
    list.forEach((t, i) => { notes.push(t.text); out.push(key(i + 1, [t.at[0], -t.at[1]], [kx, -(top - i * step)], fs)); });
    const vbX = box.u0 - fs * 0.6, vbY = -(box.v1 + fs * 0.6), vbW = (keys ? kx + fs * 1.2 : box.u1 + fs * 0.6) - vbX, vbH = (box.v1 - box.v0) + fs * 1.4 + Math.max(0, (list.length - 1) * step - (top - bottom));
    const svg = `<svg class="dt-svg" viewBox="${r3(vbX)} ${r3(vbY)} ${r3(vbW)} ${r3(vbH)}" role="img" aria-label="${esc(title || 'Section')}">${out.join('')}</svg>`;
    return { svg, notes };
}

// The header's end at a jamb, in elevation: the jamb studs, the header (its tracks' legs as lines) running over the jamb
// stud, the cripples above, the section cut A-A. -> { svg, notes } ('' when the header is not placed).
export function headerEndSvg(plan, openingKey, side = 'L') {
    const lay = plan?.layout, op = lay?.openings?.find(o => o.key === openingKey);
    const head = (plan?.members || []).filter(m => m.assemblyKey === `${openingKey}:head` || m.memberKey === `${openingKey}:head`);
    if (!op || !head.length || head.some(m => m.orientation?.kind !== 'open-side')) return { svg: '', notes: [] };
    const jambs = plan.members.filter(m => m.memberKey.startsWith(`${openingKey}:jamb:${side}`));
    const fl = (m) => dims(m.designator)?.flangeIn ?? 1.625;
    const left = side === 'L', roEdge = left ? op.left : op.right;
    const hx0 = Math.min(...head.map(m => Math.min(m.start[0], m.end[0]))), hx1 = Math.max(...head.map(m => Math.max(m.start[0], m.end[0])));
    const tracks = head.filter(m => !isStud(m.designator)), studs = head.filter(m => isStud(m.designator));
    // Up and down: a stud's depth about its axis; a track from its web to the end of its legs.
    const span = (m) => { const d = dims(m.designator); return isStud(m.designator) ? [m.start[1] - d.depthIn / 2, m.start[1] + d.depthIn / 2] : [m.start[1], m.start[1] + m.orientation.openSide[1] * d.flangeIn].sort((a, b) => a - b); };
    const yLow = Math.min(...head.map(m => span(m)[0])), yHigh = Math.max(...head.map(m => span(m)[1]));
    const jx = jambs.map(m => m.start[0]);
    const outer = left ? Math.min(...jx) - fl(jambs[0] || head[0]) / 2 : Math.max(...jx) + fl(jambs[0] || head[0]) / 2;
    const xa = left ? outer - 6 : roEdge - 18, xb = left ? roEdge + 18 : outer + 6, ya = yLow - 9, yb = yHigh + 12;
    const H = yb - ya, W = xb - xa, fs = Math.max(W, H) * 0.046;
    const Y = (y) => -y, out = [], notes = [];
    out.push(`<defs><clipPath id="dt-crop-${side}"><rect x="${r3(xa)}" y="${r3(Y(yb))}" width="${r3(W)}" height="${r3(H)}"/></clipPath></defs>`, `<g clip-path="url(#dt-crop-${side})">`);
    // Studs on center and cripples in the crop, the jambs (blue), dashed where the header runs over them.
    const verticals = plan.members.filter(m => m.start[0] === m.end[0] && m.start[1] !== m.end[1] && m.start[0] > xa - 3 && m.start[0] < xb + 3);
    for (const m of verticals) {
        const w = fl(m), x = m.start[0] - w / 2, y0 = Math.min(m.start[1], m.end[1]), y1 = Math.max(m.start[1], m.end[1]), isJamb = m.memberKey.startsWith(`${openingKey}:jamb:`);
        out.push(`<rect x="${r3(x)}" y="${r3(Y(y1))}" width="${r3(w)}" height="${r3(y1 - y0)}" class="${isJamb ? 'dt-jamb' : 'dt-v'}"/>`);
    }
    // The header over them: outline at the track webs, the tracks' legs as lines, the jamb stud it runs over dashed.
    out.push(`<rect x="${r3(hx0)}" y="${r3(Y(yHigh))}" width="${r3(hx1 - hx0)}" height="${r3(yHigh - yLow)}" class="dt-head"/>`);
    // Part by part, as the sheet draws it (sheet.mjs partLines): the tracks' legs, the studs' lips hidden, both stopping at
    // the rough opening (past it only the webs lap the jamb); a track header is its outline.
    const laid = lay.members?.find(m => m.of === openingKey && m.role === 'head track');
    for (const l of laid ? partLines(laid, op) : []) out.push(`<line x1="${r3(l.x1)}" y1="${r3(Y(l.y1))}" x2="${r3(l.x2)}" y2="${r3(Y(l.y2))}" class="${l.hidden ? 'dt-hidden' : 'dt-leg'}"/>`);
    const lapJamb = jambs.find(m => Math.abs(m.start[0] - (left ? roEdge - fl(m) / 2 : roEdge + fl(m) / 2)) < 0.05);
    if (lapJamb) { const x = lapJamb.start[0] - fl(lapJamb) / 2;
        out.push(`<line x1="${r3(x)}" y1="${r3(Y(yHigh))}" x2="${r3(x)}" y2="${r3(Y(yLow))}" class="dt-hidden"/><line x1="${r3(x + fl(lapJamb))}" y1="${r3(Y(yHigh))}" x2="${r3(x + fl(lapJamb))}" y2="${r3(Y(yLow))}" class="dt-hidden"/>`); }
    // The rough opening below the header, dashed.
    out.push(`<line x1="${r3(roEdge)}" y1="${r3(Y(ya))}" x2="${r3(roEdge)}" y2="${r3(Y(op.top))}" class="dt-ro"/><line x1="${r3(roEdge)}" y1="${r3(Y(op.top))}" x2="${r3(left ? xb : xa)}" y2="${r3(Y(op.top))}" class="dt-ro"/>`);
    out.push('</g>');
    // Section cut A-A through the header, a little into the opening.
    const cx = left ? roEdge + 9 : roEdge - 9, bar = fs * 1.4;
    out.push(`<line x1="${r3(cx)}" y1="${r3(Y(yHigh + 3.2))}" x2="${r3(cx)}" y2="${r3(Y(yLow - 3.2))}" class="dt-cut"/>`,
        `<rect x="${r3(cx - bar / 2)}" y="${r3(Y(yHigh + 3.2) - fs * 0.3)}" width="${r3(bar)}" height="${r3(fs * 0.3)}" class="dt-cutbar"/><text x="${r3(cx)}" y="${r3(Y(yHigh + 3.2) - fs * 0.55)}" font-size="${r3(fs * 1.2)}" text-anchor="middle" class="dt-cutn">A</text>`,
        `<rect x="${r3(cx - bar / 2)}" y="${r3(Y(yLow - 3.2))}" width="${r3(bar)}" height="${r3(fs * 0.3)}" class="dt-cutbar"/><text x="${r3(cx)}" y="${r3(Y(yLow - 3.2) + fs * 1.45)}" font-size="${r3(fs * 1.2)}" text-anchor="middle" class="dt-cutn">A</text>`);
    // Dimensions: the header's depth, how far it runs past the rough opening (over the jamb stud).
    out.push(dimV(left ? xb - fs * 1.2 : xa + fs * 1.8, Y(yHigh), Y(yLow), inches(yHigh - yLow), fs));
    const lap = left ? roEdge - hx0 : hx1 - roEdge;
    if (lap > 0.05) out.push(dimH(left ? hx0 : roEdge, left ? roEdge : hx1, Y(yHigh + 2.6), inches(lap), fs));
    // Keyed notes: numbered down a column right of the drawing, in the order of their points from the top.
    const targets = [], note = (text, at) => targets.push({ text, at });
    const jambNames = [...new Set(jambs.map(m => m.designator))].join(', ');
    note(`Jamb stud${jambs.length === 1 ? '' : 's'}: ${jambs.length} x ${jambNames}.`, [jambs[0] ? jambs[0].start[0] : outer, Y(ya + 4)]);
    note(`Header runs ${inches(lap)} past the rough opening, over the jamb stud${studs.length ? ' (the studs\' flanges cut back so the webs lap it)' : ''}.`,
        [left ? hx0 + lap / 2 : hx1 - lap / 2, Y((yLow + yHigh) / 2)]);
    const cr = verticals.find(m => !m.memberKey.startsWith(`${openingKey}:jamb:`) && Math.min(m.start[1], m.end[1]) >= yHigh - 0.01);
    if (cr) note('Cripple studs above, on the stud layout.', [cr.start[0] + fl(cr) / 2, Y(yHigh + 7)]);
    note('Header to jamb connection: per the engineer\'s detail.', [left ? roEdge - 0.4 : roEdge + 0.4, Y(yHigh - 1)]);
    const kx = xb + fs * 2.2, list = targets.sort((p, q) => p.at[1] - q.at[1]), top = Y(yb) + fs, step = Math.max(fs * 2.2, (H - 2 * fs) / Math.max(1, list.length - 1));
    list.forEach((t, i) => { notes.push(t.text); out.push(key(i + 1, t.at, [kx, top + i * step], fs)); });
    const svg = `<svg class="dt-svg" viewBox="${r3(xa - fs * 0.5)} ${r3(Y(yb) - fs * 2.2)} ${r3(W + fs * 4.4)} ${r3(H + fs * 4.4)}" role="img" aria-label="The header's end at the jamb">${out.join('')}</svg>`;
    return { svg, notes };
}
