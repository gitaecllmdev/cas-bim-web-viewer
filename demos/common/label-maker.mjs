// Panel identification labels: shared by the standalone tool and the Shop Generator handoff.
// Avery 5137: https://www.avery.com/templates/5137 (2 x 4 inches, ten per Letter sheet).
// No framing arithmetic; quantities and review status come from the supplied cut list.
import { qrEncode, qrRects } from './qr.mjs';
import { textWidth, toPdfSheets } from '../06-shop-drawings/pdf.mjs';
import { csvText } from './table-export.mjs';

export const HANDOFF_KEY = 'cas-label-maker:handoff';
export const MAX_LABELS = 5000;
export const STOCK = { pageW:8.5,pageH:11,cols:2,rows:5,w:4,h:2,left:0.15625,top:0.5,pitchX:4.1875,pitchY:2 };
export const DEFAULT_DESIGN = { panelPt:34,markPt:40,projectPt:7,showQr:true,showLogo:true,showNotes:true,numbered:false,startSlot:1,offsetXmm:0,offsetYmm:0 };
const str = v => String(v ?? '').trim();
const bounded = (v,lo,hi,fallback) => Number.isFinite(Number(v)) ? Math.max(lo,Math.min(hi,Number(v))) : fallback;
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function cleanProject(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Open a label project object.');
    const d=value.design || {}, design={...DEFAULT_DESIGN};
    for(const k of ['panelPt','markPt']) design[k]=bounded(d[k],12,48,design[k]);
    design.projectPt=bounded(d.projectPt,5,12,7);
    for(const k of ['showQr','showLogo','showNotes','numbered']) if(typeof d[k]==='boolean')design[k]=d[k];
    design.startSlot=Math.round(bounded(d.startSlot,1,10,1));
    for(const k of ['offsetXmm','offsetYmm'])design[k]=bounded(d[k],-3,3,0);
    if(value.rows && (!Array.isArray(value.rows)||value.rows.length>5000))throw new Error('Use at most 5,000 table rows.');
    const rows=(value.rows || []).map(r=>({panel:str(r.panel).slice(0,100),mark:str(r.mark).slice(0,100),qty:Number(r.qty ?? 1),
        url:str(r.url),notes:str(r.notes).slice(0,500),project:str(r.project).slice(0,200),review:str(r.review).slice(0,200),panelOnly:r.panelOnly===true,ready:r.ready!==false,
        panelOrigin:str(r.panelOrigin).slice(0,240),sourcePanel:str(r.sourcePanel||r.panel).slice(0,100)}));
    const logo=value.logo;
    const validLogo=logo && /^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(logo.href || '') && logo.href.length<1500000 &&
        Array.isArray(logo.px) && logo.px.length===2 && logo.px.every(v=>Number.isInteger(v)&&v>0&&v<=2000);
    return {format:'cas-label-project',version:1,project:str(value.project).slice(0,200),defaultPanel:str(value.defaultPanel).slice(0,100),
        defaultUrl:str(value.defaultUrl),design,logo:validLogo?{href:logo.href,px:logo.px}:null,rows};
}
export function rowValue(row,project) {
    return {...row,panel:row.panel || project.defaultPanel,url:row.url || project.defaultUrl,project:row.project || project.project};
}
export function printProject(project,{panel=''}={}){return {...project,rows:project.rows.filter(r=>r.ready!==false&&(!panel||rowValue(r,project).panel===panel))};}
export function validateProject(project) {
    const errors=[],warnings=[]; let count=0;
    if(!project.rows.length)errors.push('Add or import at least one member row.');
    const seenQr=new Set();
    project.rows.forEach((r,i)=>{
        const v=rowValue(r,project), n=i+1;
        if(!v.panel)errors.push(`Row ${n}: enter a panel ID.`);
        if(!v.mark && !r.panelOnly)errors.push(`Row ${n}: enter a member mark or choose Panel only.`);
        if(!Number.isSafeInteger(r.qty)||r.qty<1)errors.push(`Row ${n}: quantity must be a positive whole number.`);
        else count+=r.qty;
        if(v.review)warnings.push(`${v.panel} ${v.mark}: ${v.review}`);
        if(v.url && !/^https?:\/\/[^\s]+$/i.test(v.url))errors.push(`Row ${n}: QR links must start with http:// or https:// and contain no spaces.`);
        if(project.design.showQr && v.url && !seenQr.has(v.url)) {
            seenQr.add(v.url);
            try {const q=qrEncode(v.url); if(q.size>57)warnings.push('A QR link is long: use a shorter link and test its printed code.');}
            catch {errors.push(`Row ${n}: QR link is too long. Use a shorter link.`);}
        }
    });
    if(count>MAX_LABELS)errors.push(`This batch has ${count.toLocaleString()} labels; split it into batches of at most ${MAX_LABELS.toLocaleString()}.`);
    if(project.design.showQr && project.rows.some(r=>!rowValue(r,project).url))warnings.push('Some labels have no QR link; their QR area will be blank.');
    return {errors:[...new Set(errors)],warnings:[...new Set(warnings)],count,pages:count?Math.ceil((count+project.design.startSlot-1)/10):0};
}
export function expandRows(project) {
    const state=validateProject(project);
    if(state.errors.length)throw new Error(state.errors[0]);
    return project.rows.flatMap((r,index)=>Array.from({length:r.qty},(_,i)=>({...rowValue(r,project),row:index,piece:i+1,pieces:r.qty})));
}

// CSV/tab paste: quoted cells, quoted line breaks and a UTF-8 BOM. Headerless local-exporter columns are
// Panel, Mark, QR link, Notes, Project; the sample workbook has the first three, already expanded by quantity.
export function parseDelimited(text) {
    text=String(text).replace(/^\uFEFF/,'');
    const sep=text.split(/\r?\n/,1)[0].includes('\t')?'\t':',';
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){
        const c=text[i];
        if(c==='"' && (quoted || !cell)) {if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
        else if(!quoted && (c===sep || c==='\n' || c==='\r')) {
            row.push(cell);cell='';if(c!==sep){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(x=>x.trim()))rows.push(row);row=[];}
        } else cell+=c;
    }
    if(quoted)throw new Error('A quoted CSV cell is not closed.');
    row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
export function rowsFromTable(table,{panel='',project='',url='',cutList=false}={}) {
    if(!Array.isArray(table)||table.length>20000)throw new Error('Use at most 20,000 input rows.');
    const nonempty=table.filter(r=>Array.isArray(r)&&r.some(c=>str(c)));
    const names=(nonempty[0]||[]).map(c=>str(c).toLowerCase().replace(/[^a-z0-9]/g,''));
    const aliases={panel:['panel','panelid','panelmark'],mark:['mark','label','membermark'],qty:['qty','quantity','count'],url:['url','qrlink','qrcode','link'],notes:['notes','note'],project:['project','projectname'],review:['review','status']};
    const indexes=Object.fromEntries(Object.entries(aliases).map(([k,v])=>[k,names.findIndex(n=>v.includes(n))]));
    const header=indexes.mark>=0 && (indexes.qty>=0||indexes.panel>=0);
    const out=[],issues=[];let previousKey=null;
    for(const [i,r] of nonempty.slice(header?1:0).entries()) {
        const get=(k,fallback='')=>indexes[k]>=0?str(r[indexes[k]]):fallback;
        const value=header?{panel:get('panel',panel),mark:get('mark'),qty:indexes.qty>=0?Number(get('qty')):1,url:get('url',url),notes:get('notes'),project:get('project',project),review:get('review')}:
            cutList?{panel,mark:str(r[0]),qty:Number(r[1]),url,notes:'',project,review:''}:
            {panel:str(r[0])||panel,mark:str(r[1]),qty:1,url:str(r[2])||url,notes:str(r[3]),project:str(r[4])||project,review:''};
        value.panelOrigin=header&&indexes.panel>=0&&str(r[indexes.panel])?'Imported panel column':!header&&!cutList&&str(r[0])?'Imported panel column':'Default panel';
        if(!value.mark){
            if(value.panel && !cutList){value.panelOnly=true;issues.push(`Input row ${i+(header?2:1)} is panel-only (no member mark). Kept as supplied; check that it is intentional.`);}
            else {issues.push(`Input row ${i+(header?2:1)} has no mark; it was left out.`);continue;}
        }
        // Compact only consecutive identical records. A later repeat must keep its position in the original list.
        const key=JSON.stringify([value.panel,value.mark,value.url,value.notes,value.project,value.review]);
        const previous=out[out.length-1];
        if(Number.isSafeInteger(value.qty)&&value.qty>0 && previousKey===key && Number.isSafeInteger(previous?.qty)&&previous.qty>0)previous.qty+=value.qty;
        else out.push(value);
        previousKey=key;
    }
    return {rows:out,issues};
}
// OCR is candidate evidence: extract only a mark followed by the quantity in the first two table columns.
// Never substitute O/0 or guess quantities. Original text remains visible for comparison in the tool.
export function rowsFromOcr(text,{panel='',project='',url=''}={}) {
    const rows=[],issues=[];
    for(const ln of String(text).split(/\r?\n/)) {
        if(!ln.trim()||/^(LABEL|MARK|QTY|QUANTITY|GRAND TOTAL|TOTAL|PANEL)\b/i.test(ln.trim())||/\b(?:FRAMING\s+)?CUT\s*LIST\b/i.test(ln))continue;
        const m=/^\s*([A-Z]{1,4}\d{0,4})\s*[|:]?\s+(\d+)\b(.*)$/i.exec(ln);
        if(m){const mark=m[1].toUpperCase();rows.push({panel,mark,qty:Number(m[2]),url,notes:'',project,review:''});
            if(/^[A-Z]+$/.test(mark)&&!['AC','HC','CT'].includes(mark))issues.push(`${mark}: letters-only mark may be an OCR misread (for example CO / C0). Compare with the source; no substitution was made.`);}
        else if(/[A-Z]{1,4}\d|\b\d+\b/i.test(ln))issues.push(`Not read as a mark + quantity: ${ln.trim().slice(0,100)}`);
    }
    return {rows,issues};
}
export function projectFromShop(items,{project='',urls={}}={}) {
    return cleanProject({project,rows:items.flatMap(it=>(it.cutList||[]).map(c=>({panel:it.panel,mark:c.mark,qty:c.qty,
        url:urls[it.panel]||'',notes:'',review:it.review||'',panelOrigin:'Resolved cut list · Panel Shop Generator',sourcePanel:it.panel}))) });
}
export function expandedCsv(project,{header=true}={}) {
    const rows=expandRows(project).map(p=>[p.panel,p.mark,p.url,[p.notes,p.review].filter(Boolean).join(' | '),p.project]);
    return csvText(header?[['Panel','Mark','QR Link','Notes','Project'],...rows]:rows);
}

const text=(x,y,s,size,extra={})=>({t:'text',x,y,s:String(s),size:size/72,fill:'#000000',anchor:'middle',...extra});
const rect=(x,y,w,h,extra={})=>({t:'rect',x,y,w,h,fill:'#000000',stroke:'none',...extra});
function fitted(s,pt,w) {return Math.min(pt,w*72/Math.max(textWidth(String(s),1,false),0.01));}
function footerLines(s,pt,w) {
    if(textWidth(s,pt/72,false)<=w)return [s];
    const words=s.split(/\s+/),lines=[''];
    for(const word of words){const i=lines.length-1;if(lines[i]&&textWidth(lines[i]+' '+word,pt/72,false)>w)lines.push(word);else lines[i]+=(lines[i]?' ':'')+word;}
    return lines;
}
export function labelPageOps(project,pieces,pageIndex=0,{guides=false,qrCache=new Map()}={}) {
    const {design:d}=project,ops=[],skip=d.startSlot-1;
    for(let slot=0;slot<10;slot++) {
        const x=STOCK.left+(slot%2)*STOCK.pitchX+d.offsetXmm/25.4,y=STOCK.top+Math.floor(slot/2)*2+d.offsetYmm/25.4;
        if(guides)ops.push(rect(x,y,4,2,{fill:'none',stroke:'#bbbbbb',width:.004}));
        const p=pieces[pageIndex*10+slot-skip];if(!p)continue;
        ops.push(text(x+1.98,y+.55,p.panel,fitted(p.panel,d.panelPt,1.65)));
        ops.push(text(x+1.98,y+1.19,p.mark,fitted(p.mark,d.markPt,1.65)));
        if(d.showNotes && p.notes)ops.push(text(x+1.98,y+1.47,p.notes,fitted(p.notes,9,1.65)));
        if(d.numbered)ops.push(text(x+3.7,y+.2,`${p.piece}/${p.pieces}`,7,{anchor:'end',fill:'#555555'}));
        if(d.showQr && p.url) {
            if(!qrCache.has(p.url)){const q=qrEncode(p.url);qrCache.set(p.url,{q,rects:qrRects(q)});}
            const {q,rects}=qrCache.get(p.url),size=.94,m=size/(q.size+8),qx=x+.14,qy=y+.49;
            ops.push(rect(qx,qy,size,size,{fill:'#ffffff'}));
            for(const r of rects)ops.push(rect(qx+(r.x+4)*m,qy+(r.y+4)*m,r.w*m,r.h*m));
        }
        if(d.showLogo && project.logo){const scale=1.03/Math.max(...project.logo.px),w=project.logo.px[0]*scale,h=project.logo.px[1]*scale;
            ops.push({t:'image',id:'logo',href:project.logo.href,px:project.logo.px,x:x+2.85+(1.03-w)/2,y:y+.88+(1.03-h)/2,w,h});}
        if(p.review)ops.push(text(x+1.655,y+1.67,p.review,fitted(p.review,7,2.35),{fill:'#b00020',weight:'bold'}));
        const lines=footerLines(p.project,d.projectPt,2.35),pt=Math.min(d.projectPt,2* d.projectPt/Math.max(lines.length,2));
        const shown=lines.length<=2?lines:footerLines(p.project,pt,2.35);
        shown.forEach((ln,k)=>ops.push(text(x+1.655,y+1.82+k*pt/72*1.1,ln,fitted(ln,pt,2.35),{fill:'#888888'})));
    }
    return ops;
}
export function labelPageSvg(project,pieces,pageIndex=0,{guides=true}={}) {
    const ops=labelPageOps(project,pieces,pageIndex,{guides});
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8.5 11" font-family="Arial, Helvetica, sans-serif"><rect width="8.5" height="11" fill="white"/>${ops.map(o=>{
        if(o.t==='rect')return `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${o.fill}" stroke="${o.stroke}" stroke-width="${o.width||0}"/>`;
        if(o.t==='text')return `<text x="${o.x}" y="${o.y}" fill="${o.fill}" font-size="${o.size}" text-anchor="${o.anchor}" font-weight="${o.weight||'normal'}">${esc(o.s)}</text>`;
        if(o.t==='image')return `<image href="${esc(o.href)}" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" preserveAspectRatio="xMidYMid meet"/>`;
        return '';
    }).join('')}</svg>`;
}
export function labelPdf(project,{guides=false}={}) {
    const pieces=expandRows(project),n=validateProject(project).pages,qrCache=new Map();
    const pages=Array.from({length:n},(_,i)=>({ops:labelPageOps(project,pieces,i,{guides,qrCache}),widthIn:8.5,heightIn:11}));
    const logo=project.logo?{jpeg:Uint8Array.from(atob(project.logo.href.split(',')[1]),c=>c.charCodeAt(0)),width:project.logo.px[0],height:project.logo.px[1]}:null;
    return toPdfSheets(pages,{logo,title:`${project.project||'Panel'} identification labels`});
}
