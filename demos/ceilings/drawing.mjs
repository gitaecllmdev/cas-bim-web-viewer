import { bounds } from './geometry.mjs';
import { fmtFtIn } from '../common/framing.mjs';
import { toPdf } from '../06-shop-drawings/pdf.mjs';

export const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const palette = { ink: '#203c56', cross: '#8195a8', perimeter: '#526477', cut: '#f9e9b8', panel: '#f5f8fb', fixture: '#dceef7' };
const text = (x, y, s, size = .14, extra = {}) => ({ t: 'text', x, y, s, size, fill: palette.ink, ...extra });
const line = (x1, y1, x2, y2, stroke = palette.ink, width = .018, extra = {}) => ({ t: 'line', x1, y1, x2, y2, stroke, width, ...extra });
const poly = (pts, fill = 'none', stroke = palette.ink, width = .018, extra = {}) => ({ t: 'poly', pts, fill, stroke, width, ...extra });
export function layoutOps(plan, { x = .9, y = .8, width = 14.2, height = 8.4, view = 'layout', selectedOpening = null } = {}) {
    if (plan.issues.some(i => i.severity === 'error')) return { ops: [text(x + width / 2, y + height / 2, 'Resolve the input issue to show this layout.', .22, { anchor: 'middle' })], transform: null };
    const iso = view === 'iso', b = bounds(plan.outline), projected = iso ? plan.outline.map(([px, py]) => [(px - py) * .75, -(px + py) * .36]) : plan.outline.map(([px, py]) => [px, -py]);
    const pb = bounds(projected), scale = Math.min(width / (pb.maxX - pb.minX), height / (pb.maxY - pb.minY)), left = x + (width - (pb.maxX - pb.minX) * scale) / 2, top = y + (height - (pb.maxY - pb.minY) * scale) / 2;
    const map = ([px, py]) => { const p = iso ? [(px - py) * .75, -(px + py) * .36] : [px, -py]; return [left + (p[0] - pb.minX) * scale, top + (p[1] - pb.minY) * scale]; };
    const ops = [poly(plan.outline.map(map), '#ffffff', palette.perimeter, .035)], labels = [], labelled = new Set();
    if (plan.mode === 'grid' && view !== 'framing') for (const p of plan.panels) {
        for (const r of p.pieces) ops.push(poly([[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.depth], [r.x, r.y + r.depth]].map(map), p.cut ? palette.cut : palette.panel, 'none', 0));
        if (view === 'panels' && plan.panels.length < 220) { const r = p.pieces.reduce((a, d) => a.width * a.depth > d.width * d.depth ? a : d), [tx, ty] = map([r.x + r.width / 2, r.y + r.depth / 2]); if (r.width * scale > .3 && r.depth * scale > .22) ops.push(text(tx, ty + .04, p.cut ? 'P1*' : 'P1', .12, { anchor: 'middle' })); }
    }
    for (const m of plan.members) {
        const primary = m.role === 'main-runner' || m.role === 'joist', perimeter = m.role === 'perimeter', a = map(m.start), d = map(m.end);
        ops.push(line(...a, ...d, primary ? palette.ink : perimeter ? palette.perimeter : palette.cross, primary ? .035 : .015));
        if ((view === 'framing' || iso) && (plan.members.length < 110 || !labelled.has(m.mark)) && m.lengthIn * scale > .7) {
            const opening = m.role === 'opening-frame' ? plan.openings.find(o => m.key.includes(`:opening:${o.id}:`)) : null;
            const center = opening ? map([opening.x + opening.width / 2, opening.y + opening.depth / 2]) : null;
            const mx = (a[0] + d[0]) / 2, my = (a[1] + d[1]) / 2;
            if (Math.abs(a[0] - d[0]) < .001) { const side = center ? Math.sign(mx - center[0]) || 1 : 1; labels.push(text(mx + .1 * side, my + .04, m.mark, .12, { anchor: side < 0 ? 'end' : 'start' })); }
            else { const side = center ? Math.sign(my - center[1]) || -1 : -1; labels.push(text(mx, my + (side > 0 ? .17 : -.08), m.mark, .12, { anchor: 'middle' })); }
            labelled.add(m.mark);
        }
    }
    for (const o of plan.openings) {
        const pts = [[o.x, o.y], [o.x + o.width, o.y], [o.x + o.width, o.y + o.depth], [o.x, o.y + o.depth]].map(map);
        ops.push(poly(pts, o.kind === 'void' ? '#ffffff' : palette.fixture, o.id === selectedOpening ? '#b37c20' : '#5e9cb8', o.id === selectedOpening ? .05 : .025, { openingId: o.id, openingLabel: `${o.kind} ${fmtFtIn(o.width)} by ${fmtFtIn(o.depth)}` }));
        const [tx, ty] = map([o.x + o.width / 2, o.y + o.depth / 2]);
        if (o.width * scale > .35) ops.push(text(tx, ty + .04, o.kind === 'void' ? 'OPEN' : o.kind === 'light' ? 'L1' : 'D1', .12, { anchor: 'middle', pointerEvents: 'none' }));
    }
    ops.push(...labels);
    if (!iso) {
        const a = map([b.minX, b.minY]), d = map([b.maxX, b.minY]), e = map([b.minX, b.maxY]);
        ops.push(line(a[0], a[1] + .3, d[0], d[1] + .3, '#6d7c89', .01), text((a[0] + d[0]) / 2, a[1] + .54, fmtFtIn(b.maxX - b.minX), .17, { anchor: 'middle' }),
            line(a[0] - .3, a[1], e[0] - .3, e[1], '#6d7c89', .01), text(a[0] - .4, (a[1] + e[1]) / 2, fmtFtIn(b.maxY - b.minY), .17, { anchor: 'middle', rotate: -90 }));
        for (const p of [a, d]) ops.push(line(p[0], p[1] + .19, p[0], p[1] + .4, '#6d7c89', .01));
        for (const p of [a, e]) ops.push(line(p[0] - .41, p[1], p[0] - .19, p[1], '#6d7c89', .01));
    }
    return { ops, transform: iso ? null : { scale, left, top, minX: pb.minX, minY: pb.minY } };
}
export function opsSvg(ops, { width = 17, height = 11, interactive = false, viewBox = [0, 0, width, height] } = {}) {
    const e = escapeHtml;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}" role="img" aria-label="Ceiling layout drawing">${ops.map(o => {
        if (o.t === 'poly') return `<polygon points="${o.pts.map(p => p.join(',')).join(' ')}" fill="${o.fill}" stroke="${o.stroke}" stroke-width="${o.width}" ${interactive && o.openingId ? `data-opening="${e(o.openingId)}" tabindex="0" role="button" aria-label="Edit ${e(o.openingLabel)}"` : ''}/>`;
        if (o.t === 'line') return `<line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="${o.stroke}" stroke-width="${o.width}" ${o.dash ? `stroke-dasharray="${o.dash}"` : ''}/>`;
        if (o.t === 'text') return `<text x="${o.x}" y="${o.y}" fill="${o.fill}" font-size="${o.size}" font-family="Arial,sans-serif" font-weight="${o.weight || 'normal'}" text-anchor="${o.anchor || 'start'}" ${o.rotate ? `transform="rotate(${o.rotate},${o.x},${o.y})"` : ''} ${o.pointerEvents ? `pointer-events="${o.pointerEvents}"` : ''}>${e(o.s)}</text>`;
        return '';
    }).join('')}</svg>`;
}
export function sheetOps(plan, projectName) {
    const ops = [poly([[.35, .35], [16.65, .35], [16.65, 10.65], [.35, 10.65]], '#ffffff', palette.ink, .015), text(.65, .85, 'CAS BIM', .23, { weight: 'bold' }), text(.65, 1.18, projectName.slice(0, 70), .15), text(16.35, .85, `${plan.mark} · CEILING LAYOUT`, .22, { anchor: 'end', weight: 'bold' }), text(16.35, 1.18, `${plan.mode === 'grid' ? 'ACOUSTICAL GRID' : 'HARDLID FRAMING'} | LAYOUT STUDY`, .13, { anchor: 'end' }), line(.65, 1.4, 16.35, 1.4)];
    ops.push(...layoutOps(plan, { x: 1.3, y: 2, width: 9.5, height: 6.7, view: 'framing' }).ops);
    ops.push(text(11.6, 1.85, 'MATERIAL / MEMBER SCHEDULE', .16, { weight: 'bold' }), text(11.6, 2.18, 'MARK', .11), text(12.3, 2.18, 'DESCRIPTION / LENGTH', .11), text(16.1, 2.18, 'PCS', .11, { anchor: 'end' }));
    plan.quantities.slice(0, 21).forEach((q, i) => {
        const y = 2.46 + i * .27;
        ops.push(text(11.6, y, q.mark, .12), text(12.3, y, (q.typeSelection?.name || q.description).slice(0, 27), .1), text(15.35, y, q.lengthIn ? fmtFtIn(q.lengthIn) : '', .1, { anchor: 'end' }), text(16.1, y, String(q.quantity), .12, { anchor: 'end' }), line(11.6, y + .08, 16.1, y + .08, '#d9dde3', .008));
    });
    if (plan.quantities.length > 21) ops.push(text(11.6, 8.5, `${plan.quantities.length - 21} additional rows: see quantities CSV.`, .12));
    ops.push(text(.8, 9.75, `Net area: ${(plan.netAreaFt2 || 0).toFixed(1)} SF | Members: ${plan.members.length} | Panels: ${plan.panels.length}`, .13), line(.65, 10, 16.35, 10),
        text(.8, 10.32, 'LAYOUT PREVIEW - supports, connections, approved product selection and field dimensions remain to be resolved.', .12), text(16.15, 10.32, 'C-01', .2, { anchor: 'end', weight: 'bold' }));
    return ops;
}
export const ceilingPdf = (plan, project) => toPdf(sheetOps(plan, project), { title: `${plan.mark} ceiling layout`, widthIn: 17, heightIn: 11 });
export function quantitiesCsv(plan) {
    const quote = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
    return [['Ceiling', 'Mark', 'Description', 'Selected type', 'Role', 'Pieces', 'Cut length (in)', 'Total installed length (ft)', 'Full panels', 'Cut panels'], ...plan.quantities.map(q => [plan.mark, q.mark, q.description, q.typeSelection?.name || '', q.role, q.quantity, q.lengthIn, q.totalLengthFt, q.full, q.cut])].map(row => row.map(quote).join(',')).join('\r\n');
}
