import * as L from './demos/common/label-maker.mjs';
import { readWorkbook } from './demos/common/xlsx.mjs';
import { renderPdfPage } from './demos/common/pdf-reader.mjs';
import { recognizeCutList } from './demos/common/label-ocr.mjs';

const $=s=>document.querySelector(s), KEY='cas-label-maker:project';
const embedded=new URLSearchParams(location.search).get('embedded')==='1' && parent!==window;
if(embedded){document.body.classList.add('lm-embedded');document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();parent.postMessage({type:'cas-label-maker:close'},location.origin);}});}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let project=L.cleanProject(),past=[],future=[],candidate=null,pendingShop=null,page=0,filter='',crop=null,cropStart=null,pdfBytes=null,sourceJob=0,ocrAbort=null;
let noticeTimer,storageFailed=false;
function notice(s,error=false){$('#lm-status').textContent=s;$('#lm-status').classList.toggle('error',error);clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#lm-status').textContent='',error?10000:5000);}
function store(){try{localStorage.setItem(KEY,JSON.stringify(project));storageFailed=false;$('#lm-saved').textContent='Saved in this browser. Save project downloads a reusable file.';}catch{storageFailed=true;$('#lm-saved').textContent='Browser storage is full or unavailable. Save project to keep your work.';}}
function mutate(fn,{table=true}={}) {const before=JSON.stringify(project);try{fn();project=L.cleanProject(project);}catch(err){project=L.cleanProject(JSON.parse(before));notice(err.message,true);render();return false;}if(JSON.stringify(project)!==before){past.push(before);if(past.length>50)past.shift();future=[];store();}render({table});return true;}
function history(redo){const from=redo?future:past,to=redo?past:future;if(!from.length)return;to.push(JSON.stringify(project));project=L.cleanProject(JSON.parse(from.pop()));store();render();}
function visibleProject(){return {...project,rows:filter?project.rows.filter(r=>L.rowValue(r,project).panel===filter):project.rows};}
function render({table=true}={}) {
    for(const [id,key] of [['project','project'],['panel','defaultPanel'],['url','defaultUrl']])if(document.activeElement!==$('#lm-'+id))$('#lm-'+id).value=project[key];
    document.querySelectorAll('[data-design]').forEach(e=>{const v=project.design[e.dataset.design];if(e.type==='checkbox')e.checked=v;else e.value=v;});
    if(table)renderTable();
    $('#lm-undo').disabled=!past.length;$('#lm-redo').disabled=!future.length;
    const panels=[...new Set(project.rows.map(r=>L.rowValue(r,project).panel))].filter(Boolean);
    if(filter&&!panels.includes(filter))filter='';
    $('#lm-filter').innerHTML='<option value="">All panels</option>'+panels.map(p=>`<option ${filter===p?'selected':''}>${esc(p)}</option>`).join('');
    const all=L.validateProject(project),view=visibleProject(),state=L.validateProject(view);
    $('#lm-count').textContent=`${project.rows.length} rows · ${all.count.toLocaleString()} labels · ${all.pages} sheets`;
    page=Math.max(0,Math.min(page,state.pages-1));$('#lm-page').value=page+1;$('#lm-page').max=Math.max(1,state.pages);$('#lm-pages').textContent=`of ${state.pages}`;
    $('#lm-pdf').disabled=$('#lm-csv').disabled=$('#lm-proof').disabled=!!state.errors.length;
    $('#lm-pdf').textContent=`Download print PDF${filter?' ('+filter+')':''}`;
    $('#lm-errors').innerHTML=[...state.errors.slice(0,8).map(s=>`<p class="error">${esc(s)}</p>`),...state.warnings.slice(0,8).map(s=>`<p class="warning">${esc(s)}</p>`)].join('')+
        (state.errors.length+state.warnings.length>16?'<p>More rows need review. Check the table.</p>':'');
    if(!state.errors.length) {try{$('#lm-preview-sheet').innerHTML=L.labelPageSvg(view,L.expandRows(view),page);}catch(err){$('#lm-preview-sheet').textContent=err.message;}}
    else $('#lm-preview-sheet').innerHTML='<div style="padding:24px;color:#657080">Add a panel ID, member marks and valid quantities to preview your labels.</div>';
}
function renderTable(){
    $('#lm-table').innerHTML=project.rows.length?`<table><thead><tr><th>Panel</th><th>Mark</th><th>Qty</th><th>QR link</th><th>Notes / review</th><th>Project override</th><th>Actions</th></tr></thead><tbody>${project.rows.map((r,i)=>`<tr>${['panel','mark','qty','url','notes','project'].map(k=>`<td><input type="${k==='qty'?'number':'text'}" ${k==='qty'?'min="1" step="1"':''} data-row="${i}" data-field="${k}" value="${esc(r[k])}" aria-label="Row ${i+1} ${k}" placeholder="${k==='panel'?esc(project.defaultPanel):k==='url'?esc(project.defaultUrl):k==='project'?esc(project.project):''}">${k==='mark'?`<label class="lm-check" ${r.mark&&!r.panelOnly?'hidden':''}><input type="checkbox" data-row="${i}" data-field="panelOnly" ${r.panelOnly?'checked':''} aria-label="Row ${i+1} Panel only">Panel only</label>`:''}${k==='notes'&&r.review?`<span class="lm-row-review">${esc(r.review)}</span>`:''}</td>`).join('')}<td><button class="secondary" data-copy="${i}" title="Duplicate row" aria-label="Duplicate row ${i+1}">+</button><button class="link" data-delete="${i}" title="Remove row" aria-label="Remove row ${i+1}">×</button></td></tr>`).join('')}</tbody></table>`:'<p class="muted">No labels yet. Import a list, paste a table or add a row.</p>';
}
function download(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const filename=()=> (project.project||'panel-labels').replace(/[^a-z0-9_.-]+/gi,'-').slice(0,80);
function showCandidate(value,text='') {
    candidate={...value,ocr:!!text};$('#lm-candidates').hidden=false;
    const count=value.rows.reduce((n,r)=>n+(Number.isSafeInteger(r.qty)&&r.qty>0?r.qty:0),0);
    $('#lm-candidate-summary').textContent=`${value.rows.length} member rows · ${count.toLocaleString()} proposed labels. Review the source, then add or replace. You can edit every row in step 2.`;
    $('#lm-candidate-table').innerHTML=`<table><thead><tr><th>Panel</th><th>Mark</th><th>Qty</th></tr></thead><tbody>${value.rows.slice(0,100).map((r,i)=>`<tr><td>${esc(r.panel||project.defaultPanel)}</td><td>${text?`<input data-candidate="${i}" data-key="mark" value="${esc(r.mark)}" aria-label="Extracted row ${i+1} mark">`:esc(r.mark)||'(panel only)'}</td><td>${text?`<input type="number" min="1" step="1" data-candidate="${i}" data-key="qty" value="${esc(r.qty)}" aria-label="Extracted row ${i+1} qty">`:esc(r.qty)}</td></tr>`).join('')}</tbody></table>`;
    $('#lm-import-issues').textContent=(value.issues||[]).slice(0,20).join('\n');
    $('#lm-ocr-details').hidden=!text;$('#lm-ocr-text').textContent=text;
    $('#lm-ocr-confirm-label').hidden=!text;$('#lm-ocr-confirm').checked=false;
    $('#lm-append').disabled=$('#lm-replace').disabled=!value.rows.length||!!text;
}
function useCandidate(replace){if(!candidate || (candidate.ocr&&!$('#lm-ocr-confirm').checked))return;if(!mutate(()=>project.rows=replace?candidate.rows:[...project.rows,...candidate.rows]))return;candidate=null;$('#lm-candidates').hidden=true;notice('Rows added. Check quantities and QR links before printing.');}
async function importTable(file) {
    if(!file)return;if(file.size>16*1024*1024)throw new Error('Use a list smaller than 16 MB.');
    notice('Reading the list...');
    let table,issues=[];
    if(/\.xlsx$/i.test(file.name)) {
        const w=await readWorkbook(new Uint8Array(await file.arrayBuffer()));
        const sheets=w.sheets.filter(s=>!s.hidden&&s.lastRow>0);
        if(!sheets.length)throw new Error('The workbook has no visible data sheet.');
        // Visible worksheets are combined; each has its own header. Missing formula caches remain explicit issues.
        const parsed=sheets.map(s=>{
            const table=s.rows().map(([,cells])=>{const r=[];for(const c of cells)if(c)r[c.col-1]=c.cached===false?'':c.text;return r;});
            return L.rowsFromTable(table,{panel:project.defaultPanel,project:"",url:project.defaultUrl});
        });
        showCandidate({rows:parsed.flatMap(p=>p.rows),issues:[...w.issues.map(i=>i.message||String(i)),...parsed.flatMap(p=>p.issues)]});return;
    }
    table=L.parseDelimited(await file.text());showCandidate(L.rowsFromTable(table,{panel:project.defaultPanel,project:"",url:project.defaultUrl}));
}
async function jpegLogo(blob) {
    if(blob.size>10*1024*1024)throw new Error('Use a logo image smaller than 10 MB.');
    const bitmap=await createImageBitmap(blob);
    try {const scale=Math.min(1,600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
        return {href:canvas.toDataURL('image/jpeg',.92),px:[canvas.width,canvas.height]};
    } finally{bitmap.close();}
}
async function defaultLogo(){const r=await fetch('demos/06-shop-drawings/cas-logo.png');if(!r.ok)throw new Error('CAS logo could not load. Upload a logo instead.');return jpegLogo(await r.blob());}
function clearCrop(){crop=null;cropStart=null;$('#lm-crop-box').hidden=true;}
async function loadSource(file) {
    if(!file)return;if(file.size>30*1024*1024)throw new Error('Use an image or PDF smaller than 30 MB.');
    const job=++sourceJob;ocrAbort?.abort();pdfBytes=null;clearCrop();$('#lm-pdf-pages').hidden=true;
    const canvas=$('#lm-source-canvas');
    if(/\.pdf$/i.test(file.name) || file.type==='application/pdf'){
        pdfBytes=new Uint8Array(await file.arrayBuffer());if(job!==sourceJob)return;
        $('#lm-pdf-page').value=1;await showPdfPage(job);
    }else{
        const image=await createImageBitmap(file);
        try {if(job!==sourceJob)return;const scale=Math.min(1,4000/Math.max(image.width,image.height));canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);}
        finally{image.close();}
    }
    if(job!==sourceJob)return;$('#lm-source').hidden=false;notice('Source loaded. Crop to Mark and Qty, then Extract Table.');
}
async function showPdfPage(job=++sourceJob){
    if(!pdfBytes)return;clearCrop();notice('Drawing the PDF page...');
    const canvas=document.createElement('canvas'),info=await renderPdfPage(pdfBytes,Number($('#lm-pdf-page').value)||1,canvas,{scale:1.5});
    if(job!==sourceJob)return;const target=$('#lm-source-canvas');target.width=canvas.width;target.height=canvas.height;target.getContext('2d').drawImage(canvas,0,0);
    $('#lm-pdf-pages').hidden=false;$('#lm-pdf-page').max=info.pages;$('#lm-pdf-page').value=Math.min(info.pages,Math.max(1,Number($('#lm-pdf-page').value)||1));$('#lm-pdf-count').textContent=`of ${info.pages}`;
}
function sourcePoint(e){const c=$('#lm-source-canvas'),b=c.getBoundingClientRect();return {x:Math.max(0,Math.min(c.width,(e.clientX-b.left)*c.width/b.width)),y:Math.max(0,Math.min(c.height,(e.clientY-b.top)*c.height/b.height))};}
function paintCrop(){if(!crop)return;const c=$('#lm-source-canvas'),box=$('#lm-crop-box'),scale=c.getBoundingClientRect().width/c.width;box.hidden=false;Object.assign(box.style,{left:crop.x*scale+'px',top:crop.y*scale+'px',width:crop.w*scale+'px',height:crop.h*scale+'px'});}
const src=$('#lm-source-canvas');
src.addEventListener('pointerdown',e=>{cropStart=sourcePoint(e);src.setPointerCapture(e.pointerId);});
src.addEventListener('pointermove',e=>{if(!cropStart)return;const p=sourcePoint(e);crop={x:Math.min(p.x,cropStart.x),y:Math.min(p.y,cropStart.y),w:Math.abs(p.x-cropStart.x),h:Math.abs(p.y-cropStart.y)};paintCrop();});
src.addEventListener('pointerup',()=>{cropStart=null;if(crop && (crop.w<10||crop.h<10))clearCrop();});
src.addEventListener('pointercancel',()=>{cropStart=null;});window.addEventListener('resize',paintCrop);
async function extract() {
    const source=$('#lm-source-canvas');if(!source.width||!source.height)return;
    const c=crop||{x:0,y:0,w:source.width,h:source.height},canvas=document.createElement('canvas');
    const scale=Math.min(2,3000/Math.max(c.w,c.h));canvas.width=Math.round(c.w*scale);canvas.height=Math.round(c.h*scale);canvas.getContext('2d').drawImage(source,c.x,c.y,c.w,c.h,0,0,canvas.width,canvas.height);
    ocrAbort?.abort();const control=new AbortController();ocrAbort=control;const job=sourceJob;
    $('#lm-extract').disabled=true;$('#lm-cancel').hidden=false;
    try {
        const text=await recognizeCutList(canvas,{signal:control.signal,progress:s=>{if(!control.signal.aborted)notice(s);}});
        if(job!==sourceJob||control.signal.aborted)return;
        showCandidate(L.rowsFromOcr(text,{panel:project.defaultPanel,project:"",url:project.defaultUrl}),text);
        notice('Extraction ready for review. Compare marks and quantities with the image.');
    }catch(err){if(err.name!=='AbortError')notice(err.message,true);else notice('Extraction cancelled.');}
    finally{if(ocrAbort===control){ocrAbort=null;$('#lm-extract').disabled=false;$('#lm-cancel').hidden=true;}}
}
const safe=fn=>async(...args)=>{try{await fn(...args);}catch(err){notice(err.message,true);}};
for(const [id,key] of [['project','project'],['panel','defaultPanel'],['url','defaultUrl']])$('#lm-'+id).addEventListener('change',e=>mutate(()=>project[key]=e.target.value));
document.querySelectorAll('[data-design]').forEach(e=>e.addEventListener('change',()=>mutate(()=>project.design[e.dataset.design]=e.type==='checkbox'?e.checked:Number(e.value))));
$('#lm-table').addEventListener('change',e=>{const t=e.target;if(t.dataset.field)mutate(()=>project.rows[Number(t.dataset.row)][t.dataset.field]=t.type==='checkbox'?t.checked:t.dataset.field==='qty'?Number(t.value):t.value,{table:false});if(t.dataset.field==='mark'){const r=project.rows[Number(t.dataset.row)];t.closest('td').querySelector('label').hidden=!!r.mark&&!r.panelOnly;}});
$('#lm-candidate-table').addEventListener('change',e=>{const t=e.target;if(t.dataset.candidate!=null&&candidate){candidate.rows[Number(t.dataset.candidate)][t.dataset.key]=t.dataset.key==='qty'?Number(t.value):t.value;$('#lm-ocr-confirm').checked=false;$('#lm-append').disabled=$('#lm-replace').disabled=true;}});
$('#lm-ocr-confirm').onchange=e=>{$('#lm-append').disabled=$('#lm-replace').disabled=!e.target.checked||!candidate?.rows.length;};
$('#lm-table').addEventListener('click',e=>{const copy=e.target.closest('[data-copy]'),del=e.target.closest('[data-delete]');if(copy)mutate(()=>project.rows.splice(Number(copy.dataset.copy)+1,0,{...project.rows[Number(copy.dataset.copy)]}));if(del)mutate(()=>project.rows.splice(Number(del.dataset.delete),1));});
$('#lm-add').onclick=()=>mutate(()=>project.rows.push({panel:'',mark:'',qty:1,url:'',notes:'',project:'',review:''}));
$('#lm-undo').onclick=()=>history(false);$('#lm-redo').onclick=()=>history(true);
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.altKey&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)){if(e.key.toLowerCase()==='z'){e.preventDefault();history(e.shiftKey);}else if(e.key.toLowerCase()==='y'){e.preventDefault();history(true);}}});
$('#lm-open').onclick=()=>$('#lm-project-file').click();$('#lm-project-file').onchange=safe(async e=>{const f=e.target.files[0];if(!f)return;if(f.size>16*1024*1024)throw new Error('Label project is larger than 16 MB.');const v=JSON.parse(await f.text());if(v.format!=='cas-label-project'||v.version!==1)throw new Error('Use a supported Label Maker project (version 1).');const next=L.cleanProject(v);mutate(()=>project=next);notice('Label project opened.');e.target.value='';});
$('#lm-save').onclick=()=>{download(JSON.stringify(project,null,2),filename()+'.labels.json','application/json');notice('Project file downloaded, including your rows, design and logo.');};
$('#lm-import').onclick=()=>$('#lm-data-file').click();$('#lm-data-file').onchange=safe(async e=>{await importTable(e.target.files[0]);e.target.value='';});
$('#lm-read-paste').onclick=safe(()=>showCandidate(L.rowsFromTable(L.parseDelimited($('#lm-paste').value),{panel:project.defaultPanel,project:"",url:project.defaultUrl,cutList:$('#lm-cutlist').checked})));
$('#lm-append').onclick=()=>useCandidate(false);$('#lm-replace').onclick=()=>useCandidate(true);$('#lm-discard').onclick=()=>{candidate=null;$('#lm-candidates').hidden=true;};
$('#lm-image').onclick=()=>$('#lm-image-file').click();$('#lm-image-file').onchange=safe(async e=>{await loadSource(e.target.files[0]);e.target.value='';});
$('#lm-paste-image').onclick=safe(async()=>{if(!navigator.clipboard?.read)throw new Error('Use Ctrl+V after copying a screenshot, or Open image / PDF.');const items=await navigator.clipboard.read();const item=items.find(i=>i.types.some(t=>t.startsWith('image/')));if(!item)throw new Error('Copy a screenshot first (Windows: Win+Shift+S), then paste it here.');await loadSource(await item.getType(item.types.find(t=>t.startsWith('image/'))));});
document.addEventListener('paste',safe(async e=>{const file=[...e.clipboardData.items].find(i=>i.type.startsWith('image/'))?.getAsFile();if(file){e.preventDefault();await loadSource(file);}}));
$('#lm-source').addEventListener('dragover',e=>e.preventDefault());
document.querySelector('.lm-edit').addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
document.querySelector('.lm-edit').addEventListener('drop',safe(async e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();const f=e.dataTransfer.files[0];if(/\.(xlsx|csv|tsv|txt)$/i.test(f.name))await importTable(f);else await loadSource(f);}));
$('#lm-extract').onclick=extract;$('#lm-cancel').onclick=()=>ocrAbort?.abort();$('#lm-crop-reset').onclick=clearCrop;
$('#lm-source-close').onclick=()=>{++sourceJob;ocrAbort?.abort();$('#lm-source').hidden=true;pdfBytes=null;};$('#lm-pdf-show').onclick=safe(()=>showPdfPage());
$('#lm-logo-file').onchange=safe(async e=>{if(!e.target.files[0])return;const logo=await jpegLogo(e.target.files[0]);mutate(()=>project.logo=logo);e.target.value='';});
$('#lm-default-logo').onclick=safe(async()=>{const logo=await defaultLogo();mutate(()=>{project.logo=logo;project.design.showLogo=true;});});
$('#lm-filter').onchange=e=>{filter=e.target.value;page=0;render({table:false});};$('#lm-page').onchange=e=>{page=Number(e.target.value)-1;render({table:false});};
$('#lm-pdf').onclick=safe(()=>{download(L.labelPdf(visibleProject()),filename()+'.pdf','application/pdf');notice('Print PDF downloaded. Use Actual size / 100% on Letter.');});
$('#lm-proof').onclick=safe(()=>download(L.labelPdf(visibleProject(),{guides:true}),filename()+'-alignment-proof.pdf','application/pdf'));
$('#lm-csv').onclick=safe(()=>download(L.expandedCsv(visibleProject(),{header:$('#lm-csv-header').checked}),filename()+'.csv','text/csv;charset=utf-8'));
$('#lm-demo').onclick=()=>showCandidate({rows:[{panel:'DEMO-01',mark:'C0',qty:12,url:'https://example.com/drawings/DEMO-01',notes:'',project:'SYNTHETIC LABEL PROJECT',review:''},{panel:'DEMO-01',mark:'T0',qty:2,url:'https://example.com/drawings/DEMO-01',notes:'',project:'SYNTHETIC LABEL PROJECT',review:''},{panel:'DEMO-02',mark:'C1',qty:3,url:'https://example.com/drawings/DEMO-02',notes:'CHECK TOP CUT',project:'SYNTHETIC LABEL PROJECT',review:''}],issues:[]});
$('#lm-handoff-use').onclick=()=>{if(!pendingShop)return;const p=pendingShop;mutate(()=>{project.rows=p.rows;project.project=p.project;});$('#lm-handoff').hidden=true;pendingShop=null;notice('Shop labels loaded. Add shared drawing links before printing QR labels.');};
$('#lm-handoff-dismiss').onclick=()=>{$('#lm-handoff').hidden=true;pendingShop=null;};
try{const saved=localStorage.getItem(KEY);if(saved)project=L.cleanProject(JSON.parse(saved));}catch{notice('Saved label project could not be read. Open a downloaded project file to restore it.',true);}
try{if(new URLSearchParams(location.search).get('from')==='shop'){const data=localStorage.getItem(L.HANDOFF_KEY);if(data){pendingShop=L.cleanProject(JSON.parse(data));$('#lm-handoff').hidden=false;const s=L.validateProject(pendingShop);$('#lm-handoff-summary').textContent=`${pendingShop.rows.length} rows / ${s.count} labels. Use these rows replaces the current list; Undo restores it. Review warnings are carried from the shop generator.`;}}}catch{notice('The shop handoff could not be read. Export the shop project and reopen the generator to retry.',true);}
render();
if(!project.logo)defaultLogo().then(logo=>{if(!project.logo){project.logo=logo;if(!storageFailed)store();render({table:false});}}).catch(()=>{});
