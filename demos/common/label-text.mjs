// PDF baseline coordinates are the rendered viewport coordinates, including page rotation.
export function textInWindow(items,rect){
    const selected=items.filter(i=>((i.x>=rect.x&&i.x<=rect.x+rect.w)||(i.x+i.w/2>=rect.x&&i.x+i.w/2<=rect.x+rect.w))&&i.y-i.h/2>=rect.y&&i.y-i.h/2<=rect.y+rect.h).sort((a,b)=>a.y-b.y||a.x-b.x);
    const lines=[];
    for(const i of selected){let line=lines.find(l=>Math.abs(l.y-i.y)<=Math.max(2,Math.min(l.h,i.h)*.45));if(!line){line={y:i.y,h:i.h,items:[]};lines.push(line);}line.items.push(i);}
    return lines.sort((a,b)=>a.y-b.y).map(l=>l.items.sort((a,b)=>a.x-b.x).map(i=>i.str).join(' ')).join('\n');
}

export function panelFromText(text){
    text=String(text).replace(/\.(?:pdf|png|jpe?g|webp)$/i,'');
    const explicit=/\bPANEL\s*(?:ID|NUMBER|NO\.?|#)?\s*[:#-]?\s*([A-Z]+[-_]?\d[\w.-]*)\b/i.exec(text);
    const title=/\b([A-Z]+[-_]?\d[\w.-]*)\s+(?:-\s*)?(?:FRAMING\s+)?CUT\s*LIST\b/i.exec(text);
    const ids=[...new Set((String(text).match(/\bP\d{3,}(?:\.\d+|_[A-Z\d]+|-(?!P\d)[A-Z\d]+)*\b/gi)||[]).map(s=>s.toUpperCase()))];
    return (explicit?.[1]||title?.[1]||(ids.length===1?ids[0]:''))?.toUpperCase()||'';
}
export function panelEvidenceNearWindow(items,rect,file=''){
    const titles=items.map(i=>({...i,panel:panelFromText(i.str)})).filter(i=>i.panel&&i.y<=rect.y+30&&i.y>=rect.y-180&&i.x>=rect.x-100&&i.x<=rect.x+Math.max(rect.w,700));
    titles.sort((a,b)=>(Math.abs(a.y-rect.y)+Math.abs(a.x-rect.x)*.15)-(Math.abs(b.y-rect.y)+Math.abs(b.x-rect.x)*.15));
    if(titles[0]?.panel)return {panel:titles[0].panel,origin:'PDF heading'};
    const textPanel=panelFromText(textInWindow(items,rect));if(textPanel)return {panel:textPanel,origin:'Selected PDF text'};
    const namePanel=panelFromText(file);return {panel:namePanel,origin:namePanel?'Filename':'Not detected'};
}
export function panelNearWindow(items,rect,file=''){return panelEvidenceNearWindow(items,rect,file).panel;}
export function scheduleWindows(items,width,height){
    const headers=items.filter(i=>/^(?:LABEL|MARK)$/i.test(i.str.trim())).sort((a,b)=>a.y-b.y||a.x-b.x),out=[];
    for(const h of headers){
        const qty=items.filter(i=>/^(?:QTY|QUANTITY)$/i.test(i.str.trim())&&Math.abs(i.y-h.y)<Math.max(h.h,10)&&i.x>h.x&&i.x-h.x<350).sort((a,b)=>a.x-b.x)[0];if(!qty)continue;
        const marks=items.filter(i=>/^[A-Z]{1,4}\d{0,4}$/.test(i.str.trim())&&Math.abs(i.x-h.x)<Math.max(30,h.h*2)&&i.y>h.y+h.h*.5).sort((a,b)=>a.y-b.y);
        const rows=[];let last=h.y;
        for(const m of marks){const q=items.find(i=>/^\d+$/.test(i.str.trim())&&Math.abs(i.x-qty.x)<Math.max(35,qty.h*2)&&Math.abs(i.y-m.y)<Math.max(m.h*.7,4));
            if(!q)continue;if(rows.length&&m.y-last>Math.max(70,m.h*4))break;rows.push(m);last=m.y;
        }
        if(!rows.length)continue;
        const right=headers.filter(i=>i.x>h.x+50&&Math.abs(i.y-h.y)<40).sort((a,b)=>a.x-b.x)[0]?.x||width;
        const x=Math.max(0,h.x-16),y=Math.max(0,h.y-h.h*3),w=Math.min(right-x-18,Math.max(400,(qty.x-h.x)*6.5)),bottom=Math.min(height,last+rows.at(-1).h*3);
        const rect={x,y,w:Math.max(80,w),h:bottom-y};out.push({rect,panel:panelNearWindow(items,rect)});
    }
    return out;
}
