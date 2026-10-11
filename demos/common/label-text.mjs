// PDF baseline coordinates are the rendered viewport coordinates, including page rotation.
export function textInWindow(items,rect){
    const selected=items.filter(i=>((i.x>=rect.x&&i.x<=rect.x+rect.w)||(i.x+i.w/2>=rect.x&&i.x+i.w/2<=rect.x+rect.w))&&i.y-i.h/2>=rect.y&&i.y-i.h/2<=rect.y+rect.h).sort((a,b)=>a.y-b.y||a.x-b.x);
    const lines=[];
    for(const i of selected){let line=lines.find(l=>Math.abs(l.y-i.y)<=Math.max(2,Math.min(l.h,i.h)*.45));if(!line){line={y:i.y,h:i.h,items:[]};lines.push(line);}line.items.push(i);}
    return lines.sort((a,b)=>a.y-b.y).map(l=>l.items.sort((a,b)=>a.x-b.x).map(i=>i.str).join(' ')).join('\n');
}
