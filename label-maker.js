import * as L from './demos/common/label-maker.mjs';
import { panelFromText } from './demos/common/label-text.mjs';
import { readWorkbook } from './demos/common/xlsx.mjs';
import { LabelSourceViewer } from './demos/common/label-source-viewer.mjs';
const $=s=>document.querySelector(s),KEY='cas-label-maker:project',embedded=new URLSearchParams(location.search).get('embedded')==='1'&&parent!==window;
if(embedded)document.body.classList.add('lm-embedded');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const locked=embedded&&new URLSearchParams(location.search).get('from')==='shop';
let importName='Pasted table',project=L.cleanProject(),past=[],future=[],filter='',page=0,focusPanel='',contexts=new Map(),noticeTimer;
function notice(s,error=false){$('#lm-status').textContent=s;$('#lm-status').classList.toggle('error',error);clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#lm-status').textContent='',10000);}
function store(){try{localStorage.setItem(KEY,JSON.stringify(project));$('#lm-saved').textContent='Saved locally. Save downloads a portable project.';}catch{$('#lm-saved').textContent='Browser storage unavailable. Save the project file to keep your work.';}}
function mutate(fn,{table=true}={}){const before=JSON.stringify(project);try{fn();project=L.cleanProject(project);}catch(e){project=L.cleanProject(JSON.parse(before));notice(e.message,true);render();return false;}if(JSON.stringify(project)!==before){past.push(before);if(past.length>50)past.shift();future=[];store();}render({table});return true;}
function history(redo){const from=redo?future:past,to=redo?past:future;if(!from.length)return;to.push(JSON.stringify(project));project=L.cleanProject(JSON.parse(from.pop()));store();render();}
function visibleProject(){return L.printProject(project,{panel:filter});}
function render({table=true}={}){
 for(const [id,k] of [['project','project'],['panel','defaultPanel'],['url','defaultUrl']])if(document.activeElement!==$('#lm-'+id))$('#lm-'+id).value=project[k];
 for(const [id,key] of [['lm-master-url','defaultUrl'],['lm-master-notes','defaultNotes']])if(document.activeElement!==$('#'+id))$('#'+id).value=project[key];
 document.querySelectorAll('[data-design]').forEach(e=>{if(e.type==='checkbox')e.checked=project.design[e.dataset.design];else e.value=project.design[e.dataset.design];});
 $('#lm-undo').disabled=!past.length;$('#lm-redo').disabled=!future.length;
 const panels=[...new Set(project.rows.map(r=>L.rowValue(r,project).panel))].filter(Boolean);if(filter&&!panels.includes(filter))filter='';if(!panels.includes(focusPanel))focusPanel=panels[0]||'';
 $('#lm-filter').innerHTML='<option value="">All checked panels</option>'+panels.map(p=>`<option ${filter===p?'selected':''}>${esc(p)}</option>`).join('');
 $('#lm-context-panel').innerHTML=panels.map(p=>`<option ${focusPanel===p?'selected':''}>${esc(p)}</option>`).join('');
 if(table)renderTable();renderContext();$('#lm-recognized-edit').readOnly=locked;
 const print=visibleProject(),state=L.validateProject(print),total=project.rows.reduce((n,r)=>n+(Number.isSafeInteger(r.qty)&&r.qty>0?r.qty:0),0);
 $('#lm-count').textContent=`${project.rows.length} rows · ${total} labels in the list`;
 $('#lm-candidate-summary').textContent=`${project.rows.length} member rows · ${total} proposed labels`;
 const count=state.count;$('#lm-print-count').textContent=count?`${count} checked labels · ${state.pages} sheet${state.pages===1?'':'s'}`:'Check label rows to print';
 page=Math.max(0,Math.min(page,state.pages-1));$('#lm-page').value=page+1;$('#lm-page').max=Math.max(1,state.pages);$('#lm-pages').textContent='of '+state.pages;
 const blocked=!print.rows.length||state.errors.length>0;$('#lm-pdf').disabled=$('#lm-csv').disabled=$('#lm-proof').disabled=blocked;$('#lm-pdf').textContent=count?`Download PDF · ${count}`:'Download PDF';$('#lm-header-count').textContent=count?`${state.pages} sheets`:'';$('#lm-pdf-mobile').disabled=blocked;$('#lm-pdf-mobile').textContent=$('#lm-pdf').textContent;
 $('#lm-errors').innerHTML=!print.rows.length?'<p>Select rows or a whole panel using the Print checkboxes.</p>':[...state.errors.slice(0,6).map(s=>`<p class="error">${esc(s)}</p>`),...state.warnings.slice(0,6).map(s=>`<p class="warning">${esc(s)}</p>`)].join('');
 if(!blocked){try{$('#lm-preview-sheet').innerHTML=L.labelPageSvg(print,L.expandRows(print),page);}catch(e){$('#lm-preview-sheet').textContent=e.message;$('#lm-pdf').disabled=true;}}
 else $('#lm-preview-sheet').innerHTML='<p style="padding:18px;color:#617284">Your checked labels appear here. Imports are already in the Labels table.</p>';
}
function renderTable(){
 const groups=[...new Set(project.rows.map(r=>L.rowValue(r,project).panel))];
 $('#lm-table').innerHTML=groups.length?`<table><thead><tr><th>Print</th><th>Panel</th><th>Mark</th><th>Qty</th><th class="lm-extra">QR link</th><th class="lm-extra">Notes</th><th class="lm-extra">Project</th><th></th></tr></thead><tbody>${groups.map((panel,g)=>{
 const rows=project.rows.map((r,i)=>({r,i})).filter(({r})=>L.rowValue(r,project).panel===panel),all=rows.every(({r})=>r.ready);
 return `<tr><td colspan="8" class="lm-panel-check"><div class="lm-group-heading"><label><input type="checkbox" data-panel-check="${g}" ${all?'checked':''} aria-label="Print panel ${esc(panel||'unnamed')}"> </label><input data-group-panel="${g}" value="${esc(panel)}" aria-label="Panel number for group ${g+1}" ${locked?'readonly':''}><span>· ${rows.reduce((n,{r})=>n+(Number.isSafeInteger(r.qty)?r.qty:0),0)} labels</span><span class="lm-group-origin">${esc(rows[0]?.r.panelOrigin||'Saved / entered panel number')}${locked?' · Panel, Mark and Qty locked':''}</span></div></td></tr>`+rows.map(({r,i})=>`<tr data-context-row="${i}"><td><input type="checkbox" data-row="${i}" data-field="ready" ${r.ready?'checked':''} aria-label="Print row ${i+1}"></td>${['panel','mark','qty','url','notes','project'].map(k=>`<td class="${['url','notes','project'].includes(k)?'lm-extra':''}"><input data-row="${i}" data-field="${k}" type="${k==='qty'?'number':'text'}" ${k==='qty'?'min="1" step="1"':''} ${locked&&['panel','mark','qty'].includes(k)?'readonly':''} value="${esc(['url','notes'].includes(k)?L.rowValue(r,project)[k]:r[k])}" placeholder="${esc(k==='panel'?project.defaultPanel:k==='url'?project.defaultUrl:k==='project'?project.project:'')}" aria-label="Row ${i+1} ${k}">${['url','notes'].includes(k)&&r.overrides?.[k]?`<button class="link lm-use-master" data-master-row="${i}" data-master-field="${k}">Use master</button>`:''}${k==='mark'&&!r.mark?`<label class="small"><input type="checkbox" data-row="${i}" data-field="panelOnly" ${r.panelOnly?'checked':''}>Panel only</label>`:''}</td>`).join('')}<td><button ${locked?'disabled hidden':''} data-copy="${i}" class="link" aria-label="Duplicate row ${i+1}">+</button><button ${locked?'disabled hidden':''} data-delete="${i}" class="link" aria-label="Remove row ${i+1}">×</button>${r.review?`<span class="lm-row-review">${esc(r.review)}</span>`:''}</td></tr>`).join('');}).join('')}</tbody></table>`:'<p class="muted">Import a drawing/list, or open Labels from a panel shop. The rows appear here immediately.</p>';
 $('#lm-table').querySelectorAll('[data-panel-check]').forEach(e=>{const panel=groups[Number(e.dataset.panelCheck)],rows=project.rows.filter(r=>L.rowValue(r,project).panel===panel);e.indeterminate=rows.some(r=>r.ready)&&!rows.every(r=>r.ready);});
}
function renderContext(){const ctx=contexts.get(focusPanel);$('#lm-context-image').hidden=!ctx?.preview;if(ctx?.preview)$('#lm-context-image').src=ctx.preview;$('#lm-context-caption').textContent=ctx?`${focusPanel} · ${ctx.source||'Panel source'}${ctx.page?' · page '+ctx.page:''}`:'Source context is shown here when imported or supplied by Panel Shop Generator.';if(document.activeElement!==$('#lm-recognized-edit'))$('#lm-recognized-edit').value=ctx?.text||project.rows.filter(r=>L.rowValue(r,project).panel===focusPanel).map(r=>`${r.mark} ${r.qty}`).join('\n');}
function addImport(value,text=''){
 if(locked){notice('This workspace uses the resolved panel cut list. Import into standalone Label Maker instead.',true);return;}
 const groups=value.groups||[],rows=groups.length?groups.flatMap(g=>{const detected=panelFromText(g.text);g.panel=g.panel||detected||project.defaultPanel;if(!g.panelOrigin||g.panelOrigin.startsWith('Not detected'))g.panelOrigin=(detected?'Recognized text':'Default panel')+' · '+(g.source||importName);contexts.set(g.panel,g);return L.rowsFromOcr(g.text,{panel:g.panel,url:project.defaultUrl}).rows.map(r=>({...r,ready:true,panelOrigin:g.panelOrigin,sourcePanel:g.panel}));}):value.rows.map(r=>({...r,ready:true,panel:r.panel||panelFromText(text)||project.defaultPanel,panelOrigin:r.panelOrigin?r.panelOrigin+' · '+importName:panelFromText(text)?'Recognized text · '+importName:r.panel?'Imported panel column · '+importName:'Default panel · '+importName}));
 if(!rows.length){notice('No Mark + Qty rows found. Correct or paste the recognized text.',true);return;}
 if(text&&!groups.length)contexts.set(rows[0].panel,{panel:rows[0].panel,text,source:'Pasted recognized text'});
 if(!mutate(()=>project.rows.push(...rows)))return;focusPanel=rows[0].panel;page=0;filter='';render();$('#lm-ocr-text').textContent=text;$('#lm-import-issues').textContent=(value.issues||[]).join('\n');$('#lm-import-issues').hidden=!(value.issues||[]).length;notice(`${rows.length} rows imported. All checked and ready to print.`);
}
function download(bytes,name,type){if(!bytes?.length)throw new Error('The print file was empty. Select valid label rows first.');const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const filename=()=>(project.project||'panel-labels').replace(/[^a-z0-9_.-]+/gi,'-').slice(0,80);
async function importTable(file) {

    if(!file)return;importName=file.name;if(file.size>16*1024*1024)throw new Error('Use a list smaller than 16 MB.');

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

        addImport({rows:parsed.flatMap(p=>p.rows),issues:[...w.issues.map(i=>i.message||String(i)),...parsed.flatMap(p=>p.issues)]});return;

    }

    table=L.parseDelimited(await file.text());addImport(L.rowsFromTable(table,{panel:project.defaultPanel,project:"",url:project.defaultUrl}));

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


const sourceViewer=new LabelSourceViewer({onExtract:(text,data={})=>addImport({groups:data.groups,rows:[],issues:[...(data.issues||[]),...(data.groups||[]).flatMap(g=>L.rowsFromOcr(g.text).issues)]},text)});
async function importFile(file){if(!file)return;if(locked)throw new Error('Resolved cut-list rows are locked.');importName=file.name;if(/\.(csv|tsv|xlsx)$/i.test(file.name))return importTable(file);if(/\.txt$/i.test(file.name)){const text=await file.text();return /[,\t]/.test(text)?addImport(L.rowsFromTable(L.parseDelimited(text),{panel:project.defaultPanel,url:project.defaultUrl,cutList:true})):addImport(L.rowsFromOcr(text,{panel:panelFromText(text)||project.defaultPanel,url:project.defaultUrl}),text);}return loadSource(file);}
const safe=fn=>async(...args)=>{try{await fn(...args);}catch(e){notice(e.message,true);}};
const loadSource=async f=>{await sourceViewer.open(f);$('#lm-source-reopen').disabled=!sourceViewer.loaded;};
$('#lm-source-reopen').onclick=()=>{sourceViewer.dialog.showModal();sourceViewer.fit(false);};
for(const [id,k] of [['project','project'],['panel','defaultPanel']])$('#lm-'+id).onchange=e=>mutate(()=>project[k]=e.target.value);
for(const id of ['lm-master-url','lm-url'])$('#'+id).onchange=e=>mutate(()=>L.applyMaster(project,'url',e.target.value));
$('#lm-master-notes').onchange=e=>mutate(()=>L.applyMaster(project,'notes',e.target.value));
document.querySelectorAll('[data-design]').forEach(e=>e.onchange=()=>mutate(()=>project.design[e.dataset.design]=e.type==='checkbox'?e.checked:Number(e.value)));
$('#lm-table').onchange=e=>{const t=e.target;if(t.dataset.groupPanel!=null){if(locked){renderTable();return;}const old=[...new Set(project.rows.map(r=>L.rowValue(r,project).panel))][Number(t.dataset.groupPanel)],next=t.value.trim();if(!next){notice('Enter a panel number.',true);renderTable();return;}mutate(()=>project.rows.forEach(r=>{if(L.rowValue(r,project).panel===old){r.panel=next;r.panelOrigin=`Corrected from ${r.sourcePanel||old} · ${r.panelOrigin||'entered'}`;}}));if(contexts.has(old))contexts.set(next,{...contexts.get(old),panel:next});focusPanel=next;renderContext();return;}if(t.dataset.panelCheck!=null){const panels=[...new Set(project.rows.map(r=>L.rowValue(r,project).panel))],p=panels[Number(t.dataset.panelCheck)];mutate(()=>project.rows.forEach(r=>{if(L.rowValue(r,project).panel===p)r.ready=t.checked;}));}else if(t.dataset.field){if(locked&&['panel','mark','qty','panelOnly'].includes(t.dataset.field)){renderTable();return;}mutate(()=>{const r=project.rows[Number(t.dataset.row)];if(['url','notes'].includes(t.dataset.field)){r.overrides={...r.overrides,[t.dataset.field]:true};}r[t.dataset.field]=t.type==='checkbox'?t.checked:t.dataset.field==='qty'?Number(t.value):t.value;if(['panel','mark','qty','panelOnly'].includes(t.dataset.field))r.ready=false;},{table:true});}};
$('#lm-table').onclick=e=>{const master=e.target.closest('[data-master-row]');if(master){mutate(()=>{const r=project.rows[Number(master.dataset.masterRow)],field=master.dataset.masterField;r.overrides[field]=false;r[field]=field==='url'?project.defaultUrl:project.defaultNotes;});return;}const copy=e.target.closest('[data-copy]'),del=e.target.closest('[data-delete]'),row=e.target.closest('[data-context-row]');if(locked&&(copy||del))return;if(copy)mutate(()=>project.rows.splice(Number(copy.dataset.copy)+1,0,{...project.rows[Number(copy.dataset.copy)],ready:false}));else if(del)mutate(()=>project.rows.splice(Number(del.dataset.delete),1));else if(row){focusPanel=L.rowValue(project.rows[Number(row.dataset.contextRow)],project).panel;$('#lm-context-panel').value=focusPanel;renderContext();}};
$('#lm-check-all').onclick=()=>mutate(()=>project.rows.forEach(r=>r.ready=true));$('#lm-check-none').onclick=()=>mutate(()=>project.rows.forEach(r=>r.ready=false));
$('#lm-add').onclick=()=>!locked&&mutate(()=>project.rows.push({panel:focusPanel||project.defaultPanel,mark:'',qty:1,ready:false}));

$('#lm-undo').onclick=()=>history(false);$('#lm-redo').onclick=()=>history(true);
$('#lm-context-panel').onchange=e=>{focusPanel=e.target.value;renderContext();};
$('#lm-context-image').onclick=()=>{let d=document.querySelector('#lm-context-dialog');if(!d){d=document.createElement('dialog');d.id='lm-context-dialog';d.innerHTML='<button class="secondary">Close source</button><img style="display:block;max-width:90vw;max-height:85dvh">';document.body.append(d);d.querySelector('button').onclick=()=>d.close();}d.querySelector('img').src=$('#lm-context-image').src;d.showModal();};
$('#lm-recognized-read').onclick=()=>{if(locked)return;const text=$('#lm-recognized-edit').value,panel=panelFromText(text)||focusPanel||project.defaultPanel,read=L.rowsFromOcr(text,{panel,url:project.defaultUrl});if(!read.rows.length){notice('No Mark + Qty rows found in the text.',true);return;}mutate(()=>{const first=project.rows.findIndex(r=>L.rowValue(r,project).panel===focusPanel),other=project.rows.filter(r=>L.rowValue(r,project).panel!==focusPanel);other.splice(Math.max(0,first),0,...read.rows.map(r=>({...r,ready:false})));project.rows=other;});const ctx=contexts.get(focusPanel)||{};contexts.set(panel,{...ctx,text});focusPanel=panel;renderContext();};
$('#lm-open').onclick=()=>$('#lm-project-file').click();$('#lm-project-file').onchange=safe(async e=>{if(locked)throw new Error('Resolved cut-list fields are locked.');const f=e.target.files[0];if(!f)return;const v=JSON.parse(await f.text());if(v.format!=='cas-label-project'||v.version!==1)throw new Error('Use a version 1 Label Maker project.');mutate(()=>project=L.cleanProject(v));contexts.clear();renderContext();e.target.value='';if(!project.logo&&project.design.showLogo){const logo=await defaultLogo();if(!project.logo){project.logo=logo;store();render({table:false});}}});
$('#lm-save').onclick=()=>download(JSON.stringify(project,null,2),filename()+'.labels.json','application/json');
$('#lm-import').onclick=()=>$('#lm-data-file').click();$('#lm-data-file').onchange=safe(async e=>{await importFile(e.target.files[0]);e.target.value='';});
$('#lm-read-paste').onclick=safe(()=>addImport(L.rowsFromTable(L.parseDelimited($('#lm-paste').value),{panel:project.defaultPanel,url:project.defaultUrl,cutList:$('#lm-cutlist').checked})));
$('#lm-paste-recognized').onclick=()=>{const text=$('#lm-paste').value;addImport(L.rowsFromOcr(text,{panel:panelFromText(text)||project.defaultPanel,url:project.defaultUrl}),text);};
$('#lm-image-file').onchange=safe(async e=>{await loadSource(e.target.files[0]);e.target.value='';});
document.addEventListener('paste',safe(async e=>{const f=[...e.clipboardData.items].find(i=>i.type.startsWith('image/'))?.getAsFile();if(f){e.preventDefault();await loadSource(f);}else if(!/INPUT|TEXTAREA/.test(e.target.tagName)&&e.clipboardData.getData('text/plain')){e.preventDefault();const text=e.clipboardData.getData('text/plain');importName='Clipboard';if(/[,\t]/.test(text))addImport(L.rowsFromTable(L.parseDelimited(text),{panel:project.defaultPanel,url:project.defaultUrl,cutList:true}));else addImport(L.rowsFromOcr(text,{panel:panelFromText(text)||project.defaultPanel,url:project.defaultUrl}),text);}}));
document.querySelector('.lm-workspace').ondragover=e=>e.preventDefault();document.querySelector('.lm-workspace').ondrop=safe(async e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)await importFile(f);});
$('#lm-logo-file').onchange=safe(async e=>{if(!e.target.files[0])return;const logo=await jpegLogo(e.target.files[0]);mutate(()=>project.logo=logo);e.target.value='';});$('#lm-default-logo').onclick=safe(async()=>{const logo=await defaultLogo();mutate(()=>{project.logo=logo;project.design.showLogo=true;});});
$('#lm-filter').onchange=e=>{filter=e.target.value;page=0;render({table:false});};$('#lm-page').onchange=e=>{page=Number(e.target.value)-1;render({table:false});};
$('#lm-pdf').onclick=safe(()=>download(L.labelPdf(visibleProject()),filename()+'.pdf','application/pdf'));$('#lm-proof').onclick=safe(()=>download(L.labelPdf(visibleProject(),{guides:true}),filename()+'-alignment-proof.pdf','application/pdf'));$('#lm-csv').onclick=safe(()=>download(L.expandedCsv(visibleProject(),{header:$('#lm-csv-header').checked}),filename()+'.csv','text/csv;charset=utf-8'));
$('#lm-demo').onclick=()=>addImport({rows:[{panel:'DEMO-01',mark:'C0',qty:12,url:'https://example.com/drawings/DEMO-01'},{panel:'DEMO-01',mark:'T0',qty:2},{panel:'DEMO-02',mark:'C1',qty:3}],issues:[]});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&embedded&&!sourceViewer.dialog.open&&!document.querySelector('#lm-context-dialog')?.open&&!$('#lm-settings-drawer').open){e.preventDefault();parent.postMessage({type:'cas-label-maker:close'},location.origin);}if((e.ctrlKey||e.metaKey)&&!sourceViewer.dialog.open&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)&&e.key.toLowerCase()==='z'){e.preventDefault();history(e.shiftKey);}});
window.addEventListener('message',e=>{if(embedded&&e.origin===location.origin&&e.source===parent&&e.data?.type==='cas-label-maker:shop-context'){for(const g of e.data.groups||[])contexts.set(g.panel,g);renderContext();}});
try{const saved=localStorage.getItem(KEY);if(saved)project=L.cleanProject(JSON.parse(saved));}catch{notice('Saved project unreadable. Open your project file.',true);}
if(new URLSearchParams(location.search).get('from')==='shop'){try{const data=localStorage.getItem(L.HANDOFF_KEY);if(data){if(!locked)past.push(JSON.stringify(project));const p=L.cleanProject(JSON.parse(data));project=L.cleanProject({...project,rows:p.rows,project:p.project});store();}}catch{notice('Shop handoff failed. Reopen Labels from the panel shop.',true);}}
$('#lm-settings').onclick=()=>$('#lm-settings-drawer').showModal();$('#lm-settings-close').onclick=()=>$('#lm-settings-drawer').close();$('#lm-pdf-mobile').onclick=()=>$('#lm-pdf').click();document.querySelectorAll('[data-pane]').forEach(b=>b.onclick=()=>{document.querySelector('.lm-workspace').dataset.activePane=b.dataset.pane;document.querySelectorAll('[data-pane]').forEach(t=>t.setAttribute('aria-selected',String(t===b)));});
render();if(!project.logo)defaultLogo().then(logo=>{if(!project.logo){project.logo=logo;store();render({table:false});}}).catch(()=>{});
