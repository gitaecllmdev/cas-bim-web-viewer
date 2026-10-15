// Value-only sketch intent. A pin holds a reference; it is independent of reset-to-automatic member actions.
import * as G from './generator.mjs';
import * as M from './manual.mjs';
import { topAt } from '../common/framing.mjs';
import { baseAt } from '../common/bottom-profile.mjs';
export const pinned=(p,key)=>(p.sketchPins||[]).includes(key);
export function togglePin(p,key){const next=structuredClone(p),pins=new Set(next.sketchPins||[]);pins.has(key)?pins.delete(key):pins.add(key);next.sketchPins=[...pins];return next;}
const finite=(n)=>Number.isFinite(n)&&Math.abs(n)<=12000;
const equal=(a,b)=>Math.abs(a-b)<1e-6;
export function topPoints(shape){const s=G.shapeTop(shape);return s.top?.map(q=>[...q])||[[0,s.heightIn],[s.lengthIn,s.heightIn]];}
// Click insertion follows the actual outline, including concave tops and sloped bases. Grip drags use their own rules.
export function pointInPanel(panel,point){
    if(!Array.isArray(point)||!point.every(Number.isFinite)||point.length!==2)return false;
    const [x,y]=point,{lengthIn:L,heightIn:H,top}=G.shapeTop(panel.shape);
    const tol=1e-4; // SVG screen transforms can round an exact boundary click by a few millionths of an inch.
    if(!(L>0&&H>0)||x<-tol||x>L+tol)return false;
    return y>=baseAt(G.shapeBottom(panel.shape),x)-tol&&y<=topAt(top,x,H)+tol;
}
export function pinError(before,after){
    if(pinned(before,'top')&&JSON.stringify(topPoints(before.shape))!==JSON.stringify(topPoints(after.shape)))return 'Unlock the top line before changing it.';
    if(pinned(before,'bottom')&&JSON.stringify(G.shapeBottom(before.shape))!==JSON.stringify(G.shapeBottom(after.shape)))return 'Unlock the bottom line before changing it.';
    if(pinned(before,'left')&&pinned(before,'right')&&!equal(before.shape.lengthIn,after.shape.lengthIn))return 'Both ends are locked. Unlock one end to change the width.';
    return null;
}
export function panelDimension(panel,kind,value,hold){
    if(!G.canEdit(panel,'shape'))throw Error('The model owns this wall perimeter. Duplicate it to edit a free copy.');
    if(!finite(value)||value<=0)throw Error('Enter a positive dimension, up to 1,000 feet.');
    let p=structuredClone(panel);const s=p.shape,L=G.shapeTop(s).lengthIn;
    if(kind==='width'){
        hold=pinned(panel,'right')?'right':pinned(panel,'left')?'left':hold||'left';
        p=G.moveEnd(p,hold==='right'?'left':'right',hold==='right'?L-value:value);
        if(!equal(p.shape.lengthIn,value))throw Error('That size would pass an opening or a control point. Move it first.');
    }else{
        const side=kind==='height-left'?'left':'right',x=side==='left'?0:L,baseKey=side==='left'?'bottomLeftIn':'bottomRightIn',b=s[baseKey]||0,t=topAt(G.shapeTop(s).top,x,G.shapeTop(s).heightIn);
        hold=pinned(panel,'top')?'top':pinned(panel,'bottom')?'bottom':hold||'bottom';
        if(hold==='top'){if(t-value<0)throw Error('The bottom would fall below the sketch datum. Unlock the top or reduce the height.');s[baseKey]=t-value;}
        else p.shape=G.setEndHeight(s,side,b+value);
    }
    const error=pinError(panel,p);if(error)throw Error(error);
    const shapeError=G.panelErrors(p).find(e=>e.where==='shape');if(shapeError)throw Error(shapeError.message);
    return p;
}
export function slopeValue(shape,edge,index=0,unit='rise'){
    const pts=edge==='bottom'?G.shapeBottom(shape)||[[0,0],[shape.lengthIn,0]]:topPoints(shape),a=pts[index],b=pts[index+1],k=(b[1]-a[1])/(b[0]-a[0]);
    return unit==='degrees'?Math.atan(k)*180/Math.PI:k*12;
}
export function setSlope(panel,edge,index,value,unit='rise',hold='left'){
    if(!G.canEdit(panel,'shape'))throw Error('The model owns this wall perimeter. Duplicate it to edit a free copy.');
    if(!Number.isFinite(value)||(unit==='degrees'?Math.abs(value)>=80:Math.abs(value)>48))throw Error(unit==='degrees'?'Use an angle between -80 and 80 degrees.':'Use a rise from -48 to 48 inches per 12-inch run.');
    const p=structuredClone(panel),pts=edge==='bottom'?G.shapeBottom(p.shape)||[[0,0],[p.shape.lengthIn,0]]:topPoints(p.shape),a=pts[index],b=pts[index+1];
    if(!a||!b)throw Error('This slope segment is no longer present.');
    const k=unit==='degrees'?Math.tan(value*Math.PI/180):value/12,rise=(b[0]-a[0])*k;
    hold=pinned(panel,'right')?'right':pinned(panel,'left')?'left':hold;
    if(hold==='right')a[1]=b[1]-rise;else b[1]=a[1]+rise;
    if(edge==='bottom'){
        // Local datum is the low end. Falling slopes can be entered from a flat zero base.
        if(Math.min(a[1],b[1])<0){const d=-Math.min(a[1],b[1]);a[1]+=d;b[1]+=d;}
        p.shape.bottomLeftIn=a[1];p.shape.bottomRightIn=b[1];
    }else{
        const base=G.shapeBottom(p.shape)?{bottomLeftIn:p.shape.bottomLeftIn||0,bottomRightIn:p.shape.bottomRightIn||0}:{};
        p.shape=pts.length===2?{kind:'rake',lengthIn:p.shape.lengthIn,leftIn:a[1],rightIn:b[1],...base}:{kind:'custom',lengthIn:p.shape.lengthIn,points:pts,...base};
    }
    const error=pinError(panel,p);if(error)throw Error(error);
    const invalid=G.panelErrors(p).find(e=>e.where==='shape');if(invalid)throw Error(invalid.message);
    return p;
}
// An unfinished chain: preserve each completed segment after the edited one by translating that part of the chain.
export function segmentLength(points,index,length,locks=[],hold='start'){
    if(!finite(length)||length<=0)throw Error('Enter a positive line length, up to 1,000 feet.');
    const a=points[index],b=points[index+1];if(!a||!b)throw Error('Select a completed sketch line.');
    const old=Math.hypot(b[0]-a[0],b[1]-a[1]);if(old<1e-6)throw Error('This line has no direction.');
    const delta=a.map((v,i)=>(b[i]-v)*(length/old-1));
    const candidates=(hold==='end'?['end','start']:['start','end']).map(fixed=>points.map((q,i)=>q.map((v,j)=>v+(fixed==='start'?(i>index?delta[j]:0):(i<=index?-delta[j]:0)))));
    const valid=p=>locks.every(i=>[i,i+1].every(n=>p[n]&&p[n].every((v,j)=>equal(v,points[n][j]))));
    const result=candidates.find(valid);if(!result)throw Error('Locked sketch lines hold both sides. Unlock a line before changing this dimension.');return result;
}
export function memberGap(panel,layout,leftKey,rightKey,gap,prefer='right'){
    if(!finite(gap)||gap<=0)throw Error('Enter a positive center-to-center spacing.');
    const member=k=>layout.members.find(m=>m.key===k),a=member(leftKey),b=member(rightKey),coord=(k,m)=>m?m.x+m.w/2:k==='left'?0:layout.lengthIn;
    if((!a&&leftKey!=='left')||(!b&&rightKey!=='right'))throw Error('A dimension reference is no longer present.');
    const locked=(k,m)=>!m||pinned(panel,'member:'+k),left=coord(leftKey,a),right=coord(rightKey,b);
    const choices=prefer==='left'?[[a,leftKey,right-gap],[b,rightKey,left+gap]]:[[b,rightKey,left+gap],[a,leftKey,right-gap]];
    const choice=choices.find(([m,k])=>m&&!locked(k,m));if(!choice)throw Error('Both reference lines are locked. Unlock the line you want to move.');
    const [m,key,c]=choice;if(c-m.w/2<0||c+m.w/2>layout.lengthIn)throw Error('Keep the member inside the wall.');
    const next=M.move(panel,layout,key,c-(m.x+m.w/2),0);
    if(m.full&&!M.isAdded(key))next.manual.members[key].followProfile=true;
    return {panel:next,key};
}
