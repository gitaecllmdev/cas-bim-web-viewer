import { area, bounds, onSegment, subtractRectangles, rectPolygon, piecesInBox, pieceArea, clipStation, validateOutline, EPS } from './geometry.mjs';
import { sha256Hex } from '../common/sha256.mjs';
import { validateTypes } from './member-types.mjs';
import { assignment, validateAssignments, planeFrame, layoutBasis, stations as editedStations, validLayoutEdits } from './editing.mjs';

export const FORMAT = 'cas-ceiling-plan', VERSION = 1, RULE_VERSION = 'cas-ceiling-layout/3';
export const CATALOG = Object.freeze({
    stud: { key: 'generic:ceiling-joist', description: 'Ceiling joist', role: 'joist', unit: 'LFT' },
    track: { key: 'generic:perimeter-track', description: 'Perimeter track', role: 'perimeter', unit: 'LFT' },
    header: { key: 'generic:opening-frame', description: 'Opening frame', role: 'opening-frame', unit: 'LFT' },
    main: { key: 'generic:main-12ft', description: "12' main runner", role: 'main-runner', unit: 'LFT' },
    cross4: { key: 'generic:tee-4ft', description: "4' cross tee", role: 'cross-tee-4', unit: 'PCS' },
    cross2: { key: 'generic:tee-2ft', description: "2' cross tee", role: 'cross-tee-2', unit: 'PCS' },
    trim: { key: 'generic:wall-angle', description: 'Perimeter wall angle', role: 'perimeter', unit: 'LFT' },
    panel: { key: 'generic:lay-in-panel', description: 'Acoustical panel', role: 'panel', unit: 'PCS' }
});
const issue = (code, message, severity = 'warning') => ({ code, severity, message });
const finite = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
const rounded = n => Math.round(n * 1e8) / 1e8;
const countCells = (b, ox, oy, sx, sy) => (Math.ceil((b.maxX - ox) / sx) - Math.floor((b.minX - ox) / sx)) * (Math.ceil((b.maxY - oy) / sy) - Math.floor((b.minY - oy) / sy));

export function resolveCeilingPlan(ceiling) {
    const c = structuredClone(ceiling), issues = [], members = [], panels = [], layoutLines = [];
    const result = { format: FORMAT, version: VERSION, ruleVersion: RULE_VERSION, units: 'in', ceilingId: c.id, mark: c.mark, mode: c.mode,
        source: c.source || { kind: 'manual' }, coordinateFrame: planeFrame(c),
        outline: c.outline, openings: c.openings || [], members, panels, layoutLines, quantities: [], issues, status: 'preview', integration: { placementReady: false, missing: ['Revit document binding', 'Family/type mapping', 'Support and connection rules'] } };
    const fail = message => { issues.push(issue('invalid-input', message, 'error')); return result; };
    if (typeof c.id !== 'string' || !c.id || typeof c.mark !== 'string' || !c.mark.trim()) return fail('A ceiling needs a stable ID and a nonempty mark.');
    if (!['hardlid', 'grid'].includes(c.mode)) return fail('Select Hardlid or Ceiling grid.');
    if (!validateTypes(c.typeSelections)) return fail('A selected member type is not in the supported type list.');
    if (!validateAssignments(c)) return fail('Use member types and descriptions of up to 240 characters.');
    if (!validLayoutEdits(c.layoutEdits)) return fail('The saved member layout edits are invalid.');
    if (c.slope && (!finite(c.slope.riseX,-48,48) || !finite(c.slope.riseY,-48,48))) return fail('Use a finite slope rise from -48 to 48 inches per 12-inch run.');
    const outlineError = validateOutline(c.outline); if (outlineError) return fail(outlineError);
    if (!finite(c.elevationIn, -12000, 12000)) return fail('Enter a finite ceiling elevation within ±1,000 feet.');
    const s = c.settings;
    if (!s || !finite(s.originX, -12000, 12000) || !finite(s.originY, -12000, 12000) || ![0, 90].includes(s.direction)) return fail('Enter a finite grid origin and a 0° or 90° direction.');
    if (!finite(s.joistSpacingIn, 4, 96) || ![24, 48].includes(s.tileDepthIn)) return fail('Use joist spacing from 4–96 inches and a 2×2 or 2×4 tile module.');
    if (!Array.isArray(c.openings) || c.openings.length > 32) return fail('Use at most 32 openings and fixtures per ceiling.');
    const b = bounds(c.outline), holeIds = new Set(); result.layoutBounds = b;
    for (const o of c.openings) {
        if (typeof o.id !== 'string' || !o.id || holeIds.has(o.id) || !['void', 'light', 'diffuser'].includes(o.kind) || !finite(o.x, -12000, 12000) || !finite(o.y, -12000, 12000) || !finite(o.width, 1, 12000) || !finite(o.depth, 1, 12000)) return fail('Openings need distinct IDs, a valid kind, and finite positive dimensions.');
        holeIds.add(o.id);
        const covered = piecesInBox(c.outline, [], { minX: o.x, maxX: o.x + o.width, minY: o.y, maxY: o.y + o.depth }).reduce((a, r) => a + pieceArea(r), 0);
        if (Math.abs(covered - o.width * o.depth) > 1e-5) return fail('An opening or fixture extends outside the ceiling footprint.');
    }
    for (let i = 0; i < c.openings.length; i++) for (let j = i + 1; j < c.openings.length; j++) {
        const a = c.openings[i], d = c.openings[j];
        if (Math.min(a.x + a.width, d.x + d.width) - Math.max(a.x, d.x) > EPS && Math.min(a.y + a.depth, d.y + d.depth) - Math.max(a.y, d.y) > EPS) return fail('Openings and fixtures must not overlap.');
    }
    result.sourceFingerprint = 'sha256:' + sha256Hex(JSON.stringify({ outline: c.outline, openings: c.openings, elevationIn: c.elevationIn, slope: c.slope || null }));
    result.grossAreaFt2 = area(c.outline) / 144;
    result.netAreaFt2 = (area(c.outline) - c.openings.reduce((a,o)=>a+o.width*o.depth,0)) / 144;
    if (c.layoutEdits && c.layoutEdits.basis !== layoutBasis(c)) issues.push(issue('layout-edits-stale', 'Origins, direction or system changed. Previous member moves are retained but inactive; reset layout or move the new lines.'));
    const vertical = s.direction === 0, ox = s.originX, oy = s.originY;
    const axisOutline = vertical ? c.outline : c.outline.map(([x, y]) => [y, x]);
    const axisHoles = c.openings.filter(o => c.mode === 'hardlid' || o.kind === 'void').map(o => vertical ? o : { ...o, x: o.y, y: o.x, width: o.depth, depth: o.width });
    const ab = bounds(axisOutline), u0 = vertical ? ox : oy, v0 = vertical ? oy : ox;
    const world = ([u, v]) => vertical ? [u, v, 0] : [v, u, 0];
    const add = (key, catalog, a, d, logical = null) => {
        const lengthIn = Math.hypot(d[0] - a[0], d[1] - a[1]); if (lengthIn < 0.01) return;
        const memberKey = `${c.id}:${key}`;
        members.push({ key: memberKey, role: catalog.role, catalogKey: catalog.key, ...assignment(c,catalog.role,memberKey,catalog.description), unit: catalog.unit,
            start: a.map(rounded), end: d.map(rounded), lengthIn: rounded(lengthIn), mark: '', sectionOrientation: null, ...(logical ? {layoutLineKey:logical.key} : {}) });
        if(logical) logical.memberKeys.push(memberKey);
    };
    const perimeterCatalog = c.mode === 'hardlid' ? CATALOG.track : CATALOG.trim;
    const frameHoles = c.openings.filter(o => c.mode === 'hardlid' || o.kind === 'void');
    for (let i = 0; i < c.outline.length; i++) subtractRectangles(c.outline[i], c.outline[(i + 1) % c.outline.length], frameHoles).forEach((edge, n) => add(`perimeter:${i}:${n}`, perimeterCatalog, ...edge.map(p => [...p, 0])));
    const stations = (min, max, origin, spacing) => {
        const out = []; for (let i = Math.floor((min - origin) / spacing) + 1; origin + i * spacing < max - EPS; i++) out.push([i, origin + i * spacing]); return out;
    };
    const splits = (min, max, origin, spacing) => [min, ...stations(min, max, origin, spacing).map(x => x[1]), max];
    if (c.mode === 'hardlid') {
        if ((ab.maxX - ab.minX) / s.joistSpacingIn > 2000) return fail('The footprint would exceed 2,000 joist stations.');
        for (const l of editedStations(c,'joist',ab.minX,ab.maxX,u0,s.joistSpacingIn,vertical?'x':'y',issues).filter(l=>l.positionIn>ab.minX+EPS&&l.positionIn<ab.maxX-EPS)) {
            const line = {...l,memberKeys:[]}; layoutLines.push(line);
            clipStation(axisOutline,axisHoles,true,l.positionIn).forEach((segment,n)=>add(`joist:${l.key.split(':')[1]}:${n}`,CATALOG.stud,...segment.map(world),line));
        }
        for (const o of c.openings) {
            const p = rectPolygon(o);
            for (let i = 0; i < 4; i++) subtractRectangles(p[i], p[(i + 1) % 4], c.openings.filter(other => other.id !== o.id)).forEach((edge, n) => {
                const mid = edge[0].map((v, k) => (v + edge[1][k]) / 2);
                if (!c.outline.some((a, j) => onSegment(mid, a, c.outline[(j + 1) % c.outline.length]))) add(`opening:${o.id}:${i}:${n}`, CATALOG.header, ...edge.map(p => [...p, 0]));
            });
        }
        issues.push(issue('hardlid-supports', 'Joists, perimeter tracks and opening frames are layout geometry. Carrying channels, hangers, load/span selection and connection details are not resolved.', 'needs-resolution'));
    } else {
        if (countCells(ab, u0, v0, 24, s.tileDepthIn) > 6000) return fail('This base workspace supports up to 6,000 tile cells per ceiling.');
        const mains=editedStations(c,'main',ab.minX,ab.maxX,u0,48,vertical?'x':'y',issues), runners=editedStations(c,'runner',ab.minY,ab.maxY,v0,s.tileDepthIn,vertical?'y':'x',issues);
        const splitAt=(min,max,values)=>[min,...values.filter(v=>v>min+EPS&&v<max-EPS).sort((a,b)=>a-b),max];
        const insideLines=(lines,min,max)=>lines.filter(l=>l.positionIn>min+EPS&&l.positionIn<max-EPS);
        if(issues.some(i=>i.severity==='error'))return result;
        for (const l of insideLines(mains,ab.minX,ab.maxX)) { const i=l.key.split(':')[1],u=l.positionIn,logical={...l,memberKeys:[]};layoutLines.push(logical); clipStation(axisOutline, axisHoles, true, u).forEach((line, n) => {
            const ss = splits(line[0][1], line[1][1], v0, 144);
            for (let k = 1; k < ss.length; k++) add(`main:${i}:${n}:${Math.floor((ss[k - 1] - v0 + EPS) / 144)}`, CATALOG.main, world([u, ss[k - 1]]), world([u, ss[k]]),logical);
        }); }
        for (const l of insideLines(runners,ab.minY,ab.maxY)) { const i=l.key.split(':')[1],v=l.positionIn,logical={...l,memberKeys:[]};layoutLines.push(logical); clipStation(axisOutline, axisHoles, false, v).forEach((line, n) => {
            const ss = splitAt(line[0][0], line[1][0], mains.map(l=>l.positionIn));
            for (let k = 1; k < ss.length; k++) add(`cross4:${i}:${n}:${k}`, CATALOG.cross4, world([ss[k - 1], v]), world([ss[k], v]),logical);
        }); }
        const uCuts=mains.map(l=>({key:l.key,value:l.positionIn}));
        for(let i=1;i<mains.length;i++){ const u=(mains[i-1].positionIn+mains[i].positionIn)/2;uCuts.push({key:`half:${mains[i-1].key}`,value:u});if(u<=ab.minX+EPS||u>=ab.maxX-EPS)continue;clipStation(axisOutline, axisHoles, true, u).forEach((line, n) => {
            const ss = splitAt(line[0][1], line[1][1], runners.map(l=>l.positionIn));
            for (let k = 1; k < ss.length; k++) add(`cross2:${i}:${n}:${k}`, s.tileDepthIn === 24 ? CATALOG.cross2 : { ...CATALOG.cross4, role: 'cross-tee-4-infill' }, world([u, ss[k - 1]]), world([u, ss[k]]));
        }); }
        const ux = vertical ? 24 : s.tileDepthIn, vy = vertical ? s.tileDepthIn : 24;
        uCuts.sort((a,b)=>a.value-b.value);
        for (let i=1;i<uCuts.length;i++) for(let j=1;j<runners.length;j++) {
            const ua=uCuts[i-1],ub=uCuts[i],va=runners[j-1],vb=runners[j],lo=world([ua.value,va.positionIn]),hi=world([ub.value,vb.positionIn]);
            const x=lo[0],y=lo[1],width=hi[0]-x,depth=hi[1]-y;if(x>=b.maxX||x+width<=b.minX||y>=b.maxY||y+depth<=b.minY)continue;
            const pieces=piecesInBox(c.outline,c.openings,{minX:x,maxX:x+width,minY:y,maxY:y+depth}),used=pieces.reduce((a,p)=>a+pieceArea(p),0);if(used<EPS)continue;
            const key=`${c.id}:tile:${ua.key}:${va.key}`;
            panels.push({ key, catalogKey: CATALOG.panel.key, mark: 'P1', x, y, width, depth, pieces, areaIn2: rounded(used), cut:Math.abs(used-ux*vy)>EPS||Math.abs(width-ux)>EPS||Math.abs(depth-vy)>EPS,
                oversize:width>ux+EPS||depth>vy+EPS,...assignment(c,'panel',key,`${s.tileDepthIn===24?'2 × 2':'2 × 4'} acoustical panel`) });
        }
        if(c.layoutEdits?.basis===layoutBasis(c)&&Object.keys(c.layoutEdits.lines).length)issues.push(issue('custom-grid-spacing','Member lines were moved. Tees and panel bays follow those positions; verify nonstandard panel sizes and supports.','needs-resolution'));
        if(panels.some(p=>p.oversize))issues.push(issue('oversize-panel-bay','Some adjusted bays exceed the nominal panel module. Coordinate panel sizes and additional support.','needs-resolution'));
        for (const o of c.openings.filter(o => o.kind !== 'void')) {
            const u=vertical?[o.x,o.x+o.width]:[o.y,o.y+o.depth],v=vertical?[o.y,o.y+o.depth]:[o.x,o.x+o.width];
            if(u.some(n=>!uCuts.some(l=>Math.abs(n-l.value)<EPS))||v.some(n=>!runners.some(l=>Math.abs(n-l.positionIn)<EPS)))issues.push(issue('fixture-off-grid', 'A light or diffuser is off the current tile grid. Its support and affected tees need coordination.', 'needs-resolution'));
        }
        if (c.openings.some(o => o.kind === 'void')) issues.push(issue('void-edge-support', 'Grid members are clipped at voids. Opening trims and additional supports need coordination.', 'needs-resolution'));
        issues.push(issue('grid-supports', 'Hangers, seismic bracing, connector/rout positions, panel edge allowances and stock purchasing optimization are not included.', 'needs-resolution'));
    }
    const groups = new Map(), prefixes = { joist: 'J', perimeter: c.mode === 'grid' ? 'TRM' : 'PT', 'opening-frame': 'OF', 'main-runner': 'MB', 'cross-tee-4': 'XT', 'cross-tee-2': 'XT', 'cross-tee-4-infill': 'XT',panel:'P',light:'L',diffuser:'D' }, counters = {};
    const groupItem=(item,role,unit,lengthIn=null)=>{
        const key=JSON.stringify([item.catalogKey,role,lengthIn,item.typeSelection,item.description]),prefix=prefixes[role];
        if(!groups.has(key)){counters[prefix]=(counters[prefix]||0)+1;groups.set(key,{mark:prefix+counters[prefix],catalogKey:item.catalogKey,typeSelection:item.typeSelection,description:item.description,role,lengthIn,quantity:0,unit,itemKeys:[],overridden:false,...(lengthIn!=null?{totalLengthFt:0}:role==='panel'?{full:0,cut:0}:{})});}
        const g=groups.get(key);item.mark=g.mark;g.quantity++;g.itemKeys.push(item.key);g.overridden||=item.overridden;
        if(lengthIn!=null)g.totalLengthFt+=lengthIn/12;else if(role==='panel')g[item.cut?'cut':'full']++;
    };
    members.forEach(m=>groupItem(m,m.role,m.unit,m.lengthIn));panels.forEach(p=>groupItem(p,'panel','PCS'));
    for(const o of c.openings.filter(o=>o.kind!=='void')){const key=`${c.id}:fixture:${o.id}`;groupItem({key,catalogKey:`generic:${o.kind}`,...assignment(c,o.kind,key,o.kind==='light'?'Light (by others)':'Diffuser (by others)')},o.kind,'PCS');}
    const order = { 'main-runner':0,joist:0,'cross-tee-4':1,'cross-tee-4-infill':1,'cross-tee-2':2,'opening-frame':3,perimeter:4 };
    result.quantities = [...groups.values()].map(g => ({ ...g,...(g.totalLengthFt!=null?{totalLengthFt:rounded(g.totalLengthFt)}:{}),rowKey:'row-'+sha256Hex(JSON.stringify([...g.itemKeys].sort())).slice(0,16) })).sort((a,b)=>(order[a.role]??5)-(order[b.role]??5));
    const active=new Set([...members.map(m=>m.key),...panels.map(p=>p.key),...c.openings.map(o=>`${c.id}:fixture:${o.id}`)]);
    if(Object.keys(c.itemOverrides||{}).some(k=>!active.has(k)))issues.push(issue('schedule-override-stale','Some row overrides belong to items no longer in this layout. They are retained without being applied to other items.'));
    result.memberCount = members.length; result.panelCount = panels.length;
    return result;
}

export function planSet(project) {
    return { format: 'cas-ceiling-plan-set', version: VERSION, ruleVersion: RULE_VERSION, units: 'in', project: project.name,
        ceilings: project.ceilings.map(resolveCeilingPlan) };
}
