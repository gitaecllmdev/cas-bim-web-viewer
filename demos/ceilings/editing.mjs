// Value-only ceiling edits: sloped plane, logical member lines, and inherited schedule text.
import { TYPE_OPTIONS, typeGroup, selectedType } from './member-types.mjs';
import { EPS } from './geometry.mjs';

const groups=new Set(['main','cross','joist','track','trim','panel','light','diffuser']);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function validateAssignments(c){
    const valid=v=>object(v)&&Object.entries(v).every(([k,s])=>['type','description'].includes(k)&&typeof s==='string'&&s.length<=240);
    return (c.memberDefaults==null||(object(c.memberDefaults)&&Object.entries(c.memberDefaults).every(([g,v])=>groups.has(g)&&valid(v))))&&
        (c.itemOverrides==null||(object(c.itemOverrides)&&Object.keys(c.itemOverrides).length<=20000&&Object.entries(c.itemOverrides).every(([k,v])=>k.length>0&&k.length<=240&&valid(v))));
}
export function assignment(c,role,key,description){
    const group=typeGroup(role,c.mode)||role,defaults=c.memberDefaults?.[group]||{},override=c.itemOverrides?.[key]||{},legacy=selectedType(c.typeSelections,role,c.mode);
    const value=Object.hasOwn(override,'type')?override.type:Object.hasOwn(defaults,'type')?defaults.type:null;
    const label=value==null?legacy?.name||'':value.trim(),known=TYPE_OPTIONS[group]?.find(([id,name])=>label===id||label===name);
    return {typeSelection:label?(known?{key:known[0],name:known[1]}:{key:null,name:label,kind:'user-text'}):null,
        description:(Object.hasOwn(override,'description')?override.description:defaults.description)?.trim()||description,
        overridden:Object.keys(override).length>0,group};
}
export function rowAssignment(ceiling,row,field,value){
    if(!row?.itemKeys?.length||!['type','description'].includes(field))throw Error('The selected schedule row is no longer available.');
    const itemOverrides=structuredClone(ceiling.itemOverrides||{});
    for(const key of row.itemKeys)itemOverrides[key]={...itemOverrides[key],[field]:String(value).trim()};
    return {...ceiling,itemOverrides};
}
export function resetRow(ceiling,row){const next={...ceiling,itemOverrides:{...ceiling.itemOverrides}};for(const key of row.itemKeys)delete next.itemOverrides[key];if(!Object.keys(next.itemOverrides).length)delete next.itemOverrides;return next;}
export function planeFrame(c){
    const rx=(c.slope?.riseX||0)/12,ry=(c.slope?.riseY||0)/12,normalize=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
    const normal=normalize([-rx,-ry,1]),xAxis=normalize([1,0,rx]),yAxis=[normal[1]*xAxis[2]-normal[2]*xAxis[1],normal[2]*xAxis[0]-normal[0]*xAxis[2],normal[0]*xAxis[1]-normal[1]*xAxis[0]];
    return {origin:[0,0,c.elevationIn],xAxis,yAxis,normal};
}
export function worldPoint(plan,p){const f=plan.coordinateFrame;return [0,1,2].map(i=>f.origin[i]+p[0]*f.xAxis[i]+p[1]*f.yAxis[i]+(p[2]||0)*f.normal[i]);}
export const layoutBasis=c=>JSON.stringify([c.mode,c.settings.direction,c.settings.originX,c.settings.originY,c.settings.joistSpacingIn,c.settings.tileDepthIn]);
export function validLayoutEdits(v){return v==null||(object(v)&&typeof v.basis==='string'&&v.basis.length<300&&object(v.lines)&&Object.keys(v.lines).length<=4000&&Object.entries(v.lines).every(([k,x])=>/^(main|runner|joist):-?\d+$/.test(k)&&Number.isFinite(x)&&Math.abs(x)<=12000));}
export function stations(c,role,min,max,origin,spacing,axis,issues){
    const out=[],edits=c.layoutEdits?.basis===layoutBasis(c)?c.layoutEdits.lines:{};
    for(let i=Math.floor((min-origin)/spacing)-1;i<=Math.ceil((max-origin)/spacing)+1;i++){
        const key=`${role}:${i}`,base=origin+i*spacing;let position=edits?.[key]??base;
        if(Object.hasOwn(edits||{},key)&&!(base>min+EPS&&base<max-EPS)){issues.push({code:'layout-line-stale',severity:'warning',message:`${key} is outside the current footprint; its move is ignored.`});position=base;}
        else if(position!==base&&(position<=min+EPS||position>=max-EPS))issues.push({code:'layout-line-outside',severity:'error',message:'Keep each moved main or runner inside the ceiling footprint.'});
        out.push({key,role,axis,positionIn:position,defaultPositionIn:base});
    }
    for(let i=1;i<out.length;i++)if(out[i].positionIn-out[i-1].positionIn<1-EPS)issues.push({code:'layout-line-collision',severity:'error',message:'Keep each main or runner at least 1 inch from its neighboring line.'});
    return out;
}
export function lineMove(c,line,position){return {...c,layoutEdits:{basis:layoutBasis(c),lines:{...(c.layoutEdits?.basis===layoutBasis(c)?c.layoutEdits.lines:{}),[line.key]:position}}};}
export function lineMoveError(plan,line,position){
    if(!line||!Number.isFinite(position))return 'Select a main or runner and enter its position.';
    const positions=plan.layoutLines.filter(l=>l.role===line.role&&l.key!==line.key).map(l=>l.positionIn),b=plan.layoutBounds;
    if(position< b[line.axis==='x'?'minX':'minY']+1||position>b[line.axis==='x'?'maxX':'maxY']-1)return 'Keep the member line inside the ceiling footprint.';
    const before=positions.filter(v=>v<line.positionIn),after=positions.filter(v=>v>line.positionIn);
    if((before.length&&position<Math.max(...before)+1)||(after.length&&position>Math.min(...after)-1))return 'Keep this line between its neighbors, with at least 1 inch clear.';
    return null;
}
