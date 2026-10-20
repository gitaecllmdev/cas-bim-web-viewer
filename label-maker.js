import * as L from './demos/common/label-maker.mjs';
import { panelFromText } from './demos/common/label-text.mjs';
import { readWorkbook } from './demos/common/xlsx.mjs';
import { LabelLayoutEditor } from './demos/common/label-layout-editor.mjs';
import { LabelSourceViewer } from './demos/common/label-source-viewer.mjs';
import { captureScreen, captureError, snipGuide, clipboardImage } from './demos/common/screen-capture.mjs';
const $=s=>document.querySelector(s),KEY='cas-label-maker:project',embedded=new URLSearchParams(location.search).get('embedded')==='1'&&parent!==window;
if(embedded)document.body.classList.add('lm-embedded');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const locked=embedded&&new URLSearchParams(location.search).get('from')==='shop';
let importName='Pasted table',project=L.cleanProject(),past=[],future=[],filter='',page=0,focusPanel='',contexts=new Map(),contextHistory=new Map(),pendingImport=null,activeBatch=null,noticeTimer;
function notice(s,error=false){$('#lm-status').textContent=s;$('#lm-status').classList.toggle('error',error);clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#lm-status').textContent='',10000);}
function store(){try{localStorage.setItem(KEY,JSON.stringify(project));localStorage.setItem(L.DESIGN_KEY,JSON.stringify(project.design));$('#lm-saved').textContent='Saved locally. Save downloads a portable project.';}catch{$('#lm-saved').textContent='Browser storage unavailable. Save the project file to keep your work.';}}
const PROJECT_NAMES_KEY='cas-label-maker:project-names';
function rememberProjectName(name){let names;try{names=JSON.parse(localStorage.getItem(PROJECT_NAMES_KEY)||'[]');}catch{}names=L.projectNameHistory(names,name);try{localStorage.setItem(PROJECT_NAMES_KEY,JSON.stringify(names));}catch{}$('#lm-project-names').innerHTML=names.map(n=>`<option value="${esc(n)}"></option>`).join('');}
function pruneContextHistory(){const keep=new Set([...past,...future,JSON.stringify(project)]);for(const key of contextHistory.keys())if(!keep.has(key))contextHistory.delete(key);}
function mutate(fn,{table=true}={}){const before=JSON.stringify(project);contextHistory.set(before,new Map(contexts));try{fn();project=L.cleanProject(project);}catch(e){project=L.cleanProject(JSON.parse(before));notice(e.message,true);render();return false;}if(JSON.stringify(project)!==before){past.push(before);if(past.length>50)past.shift();future=[];store();}pruneContextHistory();render({table});return true;}
function history(redo){const from=redo?future:past,to=redo?past:future;if(!from.length)return;const current=JSON.stringify(project);contextHistory.set(current,new Map(contexts));to.push(current);const saved=from.pop();project=L.cleanProject(JSON.parse(saved));if(contextHistory.has(saved))contexts=new Map(contextHistory.get(saved));pruneContextHistory();store();render({forceFields:true});}
function visibleProject(){return L.printProject(project,{panel:filter});}
function render({table=true,forceFields=false}={}){
 for(const [id,k] of [['project','project'],['panel','defaultPanel'],['url','defaultUrl']])if(forceFields||document.activeElement!==$('#lm-'+id))$('#lm-'+id).value=project[k];
 for(const [id,key] of [['lm-master-project','project'],['lm-master-url','defaultUrl'],['lm-master-notes','defaultNotes']])if(forceFields||document.activeElement!==$('#'+id))$('#'+id).value=project[key];
 document.querySelectorAll('[data-design]').forEach(e=>{if(e.type==='checkbox')e.checked=project.design[e.dataset.design];else e.value=project.design[e.dataset.design];});
 $('#lm-stock').value=project.design.stock;document.querySelector('[data-design=startSlot]').max=L.perSheet(L.stockOf(project.design)); // the first slot within this size's sheet
 $('#lm-bulk-toolbar').hidden=!project.rows.length;document.querySelector('.lm-workspace').classList.toggle('is-empty',!project.rows.length);
 $('#lm-undo').disabled=!past.length;$('#lm-redo').disabled=!future.length;
 const panels=[...new Set(project.rows.map(r=>L.rowValue(r,project).panel))].filter(Boolean);if(filter&&!panels.includes(filter))filter='';if(!panels.includes(focusPanel))focusPanel=panels[0]||'';
 $('#lm-filter').innerHTML='<option value="">All checked panels</option>'+panels.map(p=>`<option ${filter===p?'selected':''}>${esc(p)}</option>`).join('');
 $('#lm-context-panel').innerHTML=panels.map(p=>`<option ${focusPanel===p?'selected':''}>${esc(p)}</option>`).join('');
 if(table)renderTable();renderContext();$('#lm-recognized-edit').readOnly=locked;
 const print=visibleProject(),state=L.validateProject(print),total=project.rows.reduce((n,r)=>n+(Number.isSafeInteger(r.qty)&&r.qty>0?r.qty:0),0);
 $('#lm-count').textContent=`${project.rows.length} rows · ${total} labels in the list`;
 $('#lm-candidate-summary').textContent=`${project.rows.length} member rows · ${total} proposed labels`;
 const count=state.count;$('#lm-label-count').textContent=project.rows.length?`${total} label${total===1?'':'s'} · ${project.rows.length} row${project.rows.length===1?'':'s'}${count!==total?` · ${count} checked`:''}`:'';$('#lm-print-count').textContent=count?`${count} checked labels · ${state.pages} sheet${state.pages===1?'':'s'}`:'Check label rows to print';
 page=Math.max(0,Math.min(page,state.pages-1));$('#lm-page').value=page+1;$('#lm-page').max=Math.max(1,state.pages);$('#lm-pages').textContent='of '+state.pages;
 $('#lm-page-prev').disabled=page<=0;$('#lm-page-next').disabled=page>=state.pages-1;
 $('#lm-page-list').innerHTML=state.pages>1&&state.pages<=40?Array.from({length:state.pages},(_,i)=>`<button type="button" data-page="${i}" class="${i===page?'on':''}" aria-current="${i===page?'page':'false'}" title="Sheet ${i+1}">${i+1}</button>`).join(''):'';
 const blocked=!print.rows.length||state.errors.length>0||(project.design.showLogo&&!project.logo);$('#lm-pdf').disabled=$('#lm-csv').disabled=$('#lm-proof').disabled=blocked;$('#lm-pdf').textContent=count?`Download PDF · ${count}`:'Download PDF';$('#lm-header-count').textContent=count?`${state.pages} sheets`:'';$('#lm-pdf-mobile').disabled=blocked;$('#lm-pdf-mobile').textContent=$('#lm-pdf').textContent;
 $('#lm-errors').innerHTML=!print.rows.length?'<p>Select rows or a whole panel using the Print checkboxes.</p>':[...state.errors.slice(0,6).map(s=>`<p class="error">${esc(s)}</p>`),...state.warnings.slice(0,6).map(s=>`<p class="warning">${esc(s)}</p>`)].join('');
 $('#lm-sheet-summary').textContent='';
 if(!blocked){try{$('#lm-preview-sheet').innerHTML=L.labelPageSvg(print,L.expandRows(print),page);const s=L.sheetSummary(print,page);$('#lm-sheet-summary').textContent=s.to>=s.from?`Sheet ${page+1} of ${state.pages} · labels ${s.from}–${s.to} of ${s.total} · ${s.panels.join(', ')}`:'';}catch(e){$('#lm-preview-sheet').textContent=e.message;$('#lm-pdf').disabled=true;}}
 else $('#lm-preview-sheet').innerHTML='<p style="padding:18px;color:#617284">Your checked labels appear here. Imports are already in the Labels table.</p>';
 $('#lm-large-open').disabled=blocked;renderLarge();renderHistory();
}
function renderTable(){
 const groups=[...new Set(project.rows.map(r=>L.rowValue(r,project).panel))];
 $('#lm-table').innerHTML=groups.length?`<table><thead><tr><th>Print</th><th>Panel</th><th>Mark</th><th>Qty</th><th class="lm-extra">QR link</th><th class="lm-extra">Notes</th><th class="lm-extra">Project</th><th>Actions</th></tr></thead><tbody>${groups.map((panel,g)=>{
 const rows=project.rows.map((r,i)=>({r,i})).filter(({r})=>L.rowValue(r,project).panel===panel),all=rows.every(({r})=>r.ready);
 return `<tr><td colspan="8" class="lm-panel-check"><div class="lm-group-heading"><label><input type="checkbox" data-panel-check="${g}" ${all?'checked':''} aria-label="Print panel ${esc(panel||'unnamed')}"> </label><input data-group-panel="${g}" value="${esc(panel)}" title="${esc(panel)}" aria-label="Panel number for group ${g+1}" ${locked?'readonly':''}><span>· ${rows.reduce((n,{r})=>n+(Number.isSafeInteger(r.qty)?r.qty:0),0)} labels</span><button class="secondary lm-group-add" data-add-panel="${g}" ${locked?'hidden disabled':''} title="Add a row to ${esc(panel||'this panel')}">+ Add row</button><span class="lm-group-origin" title="${esc(rows[0]?.r.panelOrigin||'Saved / entered panel number')}">${esc(rows[0]?.r.panelOrigin||'Saved / entered panel number')}${locked?' · Panel, Mark and Qty locked':''}</span></div></td></tr>`+rows.map(({r,i})=>`<tr data-context-row="${i}"><td><input type="checkbox" data-row="${i}" data-field="ready" ${r.ready?'checked':''} aria-label="Print row ${i+1}"></td>${['panel','mark','qty','url','notes','project'].map(k=>`<td class="${['url','notes','project'].includes(k)?'lm-extra':''}"><div class="lm-cell ${r.overrides?.[k]?'has-override':''}"><input data-row="${i}" data-field="${k}" type="${k==='qty'?'number':'text'}" ${k==='qty'?'min="1" step="1"':''} ${locked&&['panel','mark','qty'].includes(k)?'readonly':''} value="${esc(['url','notes','project'].includes(k)?L.rowValue(r,project)[k]:r[k])}" title="${esc(['url','notes','project'].includes(k)?L.rowValue(r,project)[k]:r[k])}" placeholder="${esc(k==='panel'?project.defaultPanel:k==='url'?project.defaultUrl:k==='project'?project.project:'')}" aria-label="Row ${i+1} ${k}">${['url','notes','project'].includes(k)&&r.overrides?.[k]?`<button class="link lm-use-master" data-master-row="${i}" data-master-field="${k}" title="Use master ${k}" aria-label="Use master ${k} for row ${i+1}">&#8630;</button>`:''}</div>${k==='mark'&&!r.mark?`<label class="small"><input type="checkbox" data-row="${i}" data-field="panelOnly" ${r.panelOnly?'checked':''}>Panel only</label>`:''}</td>`).join('')}<td><div class="lm-row-actions"><button ${locked?'disabled hidden':''} data-copy="${i}" class="lm-row-copy" title="Duplicate row ${i+1}" aria-label="Duplicate row ${i+1}">⧉ Duplicate</button><span class="lm-row-sep" aria-hidden="true"></span><button ${locked?'disabled hidden':''} data-delete="${i}" class="lm-row-delete" title="Delete row ${i+1} (Undo brings it back)" aria-label="Delete row ${i+1}"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 1.5h4l.6 1H14V4H2V2.5h3.4zM3.3 5h9.4l-.8 9.5H4.1zm2.9 1.6.3 6.4h1V6.6zm2.3 0V13h1l.3-6.4z"/></svg></button></div>${r.review?`<span class="lm-row-review">${esc(r.review)}</span>`:''}</td></tr>`).join('');}).join('')}</tbody></table>`:'<p class="muted">Import a drawing/list, or open Labels from a panel shop. The rows appear here immediately.</p>';
 $('#lm-table').querySelectorAll('[data-panel-check]').forEach(e=>{const panel=groups[Number(e.dataset.panelCheck)],rows=project.rows.filter(r=>L.rowValue(r,project).panel===panel);e.indeterminate=rows.some(r=>r.ready)&&!rows.every(r=>r.ready);});
}
function renderContext(){const ctx=contexts.get(focusPanel);$('#lm-context-image').hidden=!ctx?.preview;if(ctx?.preview)$('#lm-context-image').src=ctx.preview;$('#lm-context-caption').textContent=ctx?`${focusPanel} · ${ctx.source||'Panel source'}${ctx.page?' · page '+ctx.page:''}`:'Source context is shown here when imported or supplied by Panel Shop Generator.';if(document.activeElement!==$('#lm-recognized-edit'))$('#lm-recognized-edit').value=ctx?.text||project.rows.filter(r=>L.rowValue(r,project).panel===focusPanel).map(r=>`${r.mark} ${r.qty}`).join('\n');}
function addImport(value,text=''){
 if(locked){notice('This workspace uses the resolved panel cut list. Import into standalone Label Maker instead.',true);return;}
 value={...value,rows:(value.rows||[]).filter(r=>!L.skipDateMark(r.mark))};const groups=value.groups||[],rows=groups.length?groups.flatMap(g=>{const detected=panelFromText(g.text);g.panel=g.panel||detected||project.defaultPanel;if(!g.panelOrigin||g.panelOrigin.startsWith('Not detected'))g.panelOrigin=(detected?'Recognized text':'Default panel')+' · '+(g.source||importName);return L.rowsFromOcr(g.text,{panel:g.panel,url:''}).rows.map(r=>({...r,ready:true,panelOrigin:g.panelOrigin,sourcePanel:g.panel}));}):value.rows.map(r=>({...r,ready:true,panel:r.panel||panelFromText(text)||project.defaultPanel,panelOrigin:r.panelOrigin?r.panelOrigin+' · '+importName:panelFromText(text)?'Recognized text · '+importName:r.panel?'Imported panel column · '+importName:'Default panel · '+importName}));
 if(!rows.length){notice('No Mark + Qty rows found. Correct or paste the recognized text.',true);return;}
 const sourceContexts=groups.length?groups.map(g=>[g.panel,g]):text?[[rows[0].panel,{panel:rows[0].panel,text,source:'Pasted recognized text'}]]:[];
 const batch={rows,sourceContexts,text,issues:value.issues||[]};
 if(activeBatch){activeBatch.rows.push(...rows);activeBatch.sourceContexts.push(...sourceContexts);activeBatch.issues.push(...batch.issues);activeBatch.text+='\n'+text;return;}
 if(project.rows.length){pendingImport=batch;const oldCount=project.rows.reduce((n,r)=>n+(Number.isSafeInteger(r.qty)?r.qty:0),0),newCount=rows.reduce((n,r)=>n+(Number.isSafeInteger(r.qty)?r.qty:0),0);$('#lm-import-choice-summary').textContent=`Current list: ${project.rows.length} rows / ${oldCount} labels. New import: ${rows.length} rows / ${newCount} labels. Choose how to load it.`;if(!$('#lm-import-choice').open)$('#lm-import-choice').showModal();return;}
 commitImport(batch,false);
}
function commitImport(batch,replace){
 if(!mutate(()=>{project=L.applyLabelImport(project,batch.rows,{replace});if(replace)contexts.clear();for(const [panel,ctx] of batch.sourceContexts)contexts.set(panel,ctx);}))return;
 focusPanel=batch.rows[0].panel;page=0;filter='';render({forceFields:true});$('#lm-ocr-text').textContent=batch.text;$('#lm-import-issues').textContent=batch.issues.join('\n');$('#lm-import-issues').hidden=!batch.issues.length;notice(`${batch.rows.length} rows loaded. All checked and ready to print.`);
}

function download(bytes,name,type){if(!bytes?.length)throw new Error('The print file was empty. Select valid label rows first.');const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const printName=(kind)=>L.printFileName(visibleProject(),{kind}); // project, panel numbers, kind, date last
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

            return L.rowsFromTable(table,{panel:project.defaultPanel,project:"",url:''});

        });

        addImport({rows:parsed.flatMap(p=>p.rows),issues:[...w.issues.map(i=>i.message||String(i)),...parsed.flatMap(p=>p.issues)]});return;

    }

    table=L.parseDelimited(await file.text());addImport(L.rowsFromTable(table,{panel:project.defaultPanel,project:"",url:''}));

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

async function defaultLogo(){const r=await fetch('demos/common/label-default-logo.png');if(!r.ok)throw new Error('Default CW logo could not load. Upload a logo instead.');return jpegLogo(await r.blob());}


const layoutEditor=new LabelLayoutEditor({getProject:()=>project,onApply:design=>mutate(()=>{project.design={...design,startSlot:project.design.startSlot,offsetXmm:project.design.offsetXmm,offsetYmm:project.design.offsetYmm};})});$('#lm-layout-edit').onclick=()=>layoutEditor.open();
const sourceViewer=new LabelSourceViewer({onDismiss:()=>{if(activeBatch){activeBatch=null;sourceViewer.batchPosition=null;notice('Import cancelled. Previous labels kept.');}},onExtract:(text,data={})=>{addImport({groups:data.groups,rows:[],issues:[...(data.issues||[]),...(data.groups||[]).flatMap(g=>L.rowsFromOcr(g.text).issues)]},text);if(activeBatch)setTimeout(()=>advanceFiles().catch(e=>{activeBatch=null;notice(e.message,true);}),0);}});
function queueFiles(input){
 const files=Array.from(input||[]);if(!files.length)return;if(locked)throw new Error('Resolved cut-list rows are locked.');
 if(files.length>10)throw new Error('Load at most 10 files and 10 panels at once.');if(files.reduce((n,f)=>n+f.size,0)>200*1024*1024)throw new Error('Keep the total import below 200 MB.');
 if(project.rows.length){pendingImport={files};$('#lm-import-choice-summary').textContent=`Your current list has ${project.rows.length} rows. Load ${files.length} new file${files.length===1?'':'s'}: clear previous labels or keep both? Previous labels stay until the new import completes.`;$('#lm-import-choice').showModal();}
 else return startFileBatch(files,false);
}
async function startFileBatch(files,replace){activeBatch={files,index:0,replace,rows:[],sourceContexts:[],issues:[],text:''};try{await advanceFiles();}catch(e){activeBatch=null;sourceViewer.batchPosition=null;throw e;}}
async function advanceFiles(){
 const batch=activeBatch;if(!batch)return;
 while(batch.index<batch.files.length){const file=batch.files[batch.index++];sourceViewer.batchPosition={index:batch.index,total:batch.files.length};await importFile(file);if(activeBatch!==batch)return;if(!/\.(csv|tsv|xlsx|txt)$/i.test(file.name))return;}
 activeBatch=null;sourceViewer.batchPosition=null;if(batch.rows.length)commitImport(batch,batch.replace);else notice('No label rows found. Previous labels kept.',true);
}

async function importFile(file){if(!file)return;if(locked)throw new Error('Resolved cut-list rows are locked.');importName=file.name;if(/\.(csv|tsv|xlsx)$/i.test(file.name))return importTable(file);if(/\.txt$/i.test(file.name)){const text=await file.text();return /[,\t]/.test(text)?addImport(L.rowsFromTable(L.parseDelimited(text),{panel:project.defaultPanel,url:'',cutList:true})):addImport(L.rowsFromOcr(text,{panel:panelFromText(text)||project.defaultPanel,url:''}),text);}return loadSource(file);}
const safe=fn=>async(...args)=>{try{await fn(...args);}catch(e){notice(e.message,true);if($('#lm-snapshot-dialog')?.open)$('#lm-snapshot-status').textContent=e.message;}};
const loadSource=async f=>{await sourceViewer.open(f);$('#lm-source-reopen').disabled=!sourceViewer.loaded;};
$('#lm-source-reopen').onclick=()=>{sourceViewer.dialog.showModal();sourceViewer.fit(false);};
for(const [id,k] of [['panel','defaultPanel']])$('#lm-'+id).onchange=e=>mutate(()=>project[k]=e.target.value);
for(const id of ['lm-master-url','lm-url'])$('#'+id).onchange=e=>mutate(()=>L.applyMaster(project,'url',e.target.value));
for(const id of ['lm-master-project','lm-project'])$('#'+id).onchange=e=>{if(mutate(()=>L.applyMaster(project,'project',e.target.value)))rememberProjectName(project.project);};
$('#lm-master-notes').onchange=e=>mutate(()=>L.applyMaster(project,'notes',e.target.value));
document.querySelectorAll('[data-design]').forEach(e=>e.onchange=()=>mutate(()=>project.design[e.dataset.design]=e.type==='checkbox'?e.checked:Number(e.value)));
// Label size: another Avery stock starts from that size's own layout and text sizes (one Undo step back).
$('#lm-stock').innerHTML=L.stockList().map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
$('#lm-stock').onchange=e=>{const id=e.target.value;if(id===project.design.stock)return;mutate(()=>{project.design=L.designForStock(project.design,id);});page=0;notice(`Label size: ${L.STOCKS[id].name}. The design starts from that size's layout; Edit design to adjust it.`);};
$('#lm-table').onchange=e=>{const t=e.target;if(t.dataset.groupPanel!=null){if(locked){renderTable();return;}const old=[...new Set(project.rows.map(r=>L.rowValue(r,project).panel))][Number(t.dataset.groupPanel)],next=t.value.trim();if(!next){notice('Enter a panel number.',true);renderTable();return;}mutate(()=>project.rows.forEach(r=>{if(L.rowValue(r,project).panel===old){r.panel=next;r.panelOrigin=`Corrected from ${r.sourcePanel||old} · ${r.panelOrigin||'entered'}`;}}));if(contexts.has(old))contexts.set(next,{...contexts.get(old),panel:next});focusPanel=next;renderContext();return;}if(t.dataset.panelCheck!=null){const panels=[...new Set(project.rows.map(r=>L.rowValue(r,project).panel))],p=panels[Number(t.dataset.panelCheck)];mutate(()=>project.rows.forEach(r=>{if(L.rowValue(r,project).panel===p)r.ready=t.checked;}));}else if(t.dataset.field){if(locked&&['panel','mark','qty','panelOnly'].includes(t.dataset.field)){renderTable();return;}mutate(()=>{const r=project.rows[Number(t.dataset.row)];if(['url','notes','project'].includes(t.dataset.field)){r.overrides={...r.overrides,[t.dataset.field]:true};}r[t.dataset.field]=t.type==='checkbox'?t.checked:t.dataset.field==='qty'?Number(t.value):t.value;if(['panel','mark','qty','panelOnly'].includes(t.dataset.field))r.ready=false;},{table:true});}};
$('#lm-table').onclick=e=>{const master=e.target.closest('[data-master-row]');if(master){mutate(()=>{const r=project.rows[Number(master.dataset.masterRow)],field=master.dataset.masterField;r.overrides[field]=false;r[field]=field==='url'?project.defaultUrl:field==='notes'?project.defaultNotes:project.project;});return;}const add=e.target.closest('[data-add-panel]');if(add){const panel=[...new Set(project.rows.map(r=>L.rowValue(r,project).panel))][Number(add.dataset.addPanel)];addRow(panel);return;}const copy=e.target.closest('[data-copy]'),del=e.target.closest('[data-delete]'),row=e.target.closest('[data-context-row]');if(locked&&(copy||del))return;if(copy){const i=Number(copy.dataset.copy);if(mutate(()=>project.rows.splice(i+1,0,{...project.rows[i],overrides:{...project.rows[i].overrides},ready:false}))){focusRow(i+1);notice('Row duplicated. Edit it, then check Print when ready.');}}else if(del){const i=Number(del.dataset.delete),v=project.rows[i]?L.rowValue(project.rows[i],project):null;if(mutate(()=>project.rows.splice(i,1))&&v)notice(`Row ${i+1} deleted (${v.panel} ${v.mark||'panel only'}). Undo brings it back.`);}else if(row){focusPanel=L.rowValue(project.rows[Number(row.dataset.contextRow)],project).panel;$('#lm-context-panel').value=focusPanel;renderContext();}};
// A cell's full text on hover, as it is typed.
$('#lm-table').addEventListener('input',e=>{if(e.target.matches('input[type=text],input:not([type])'))e.target.title=e.target.value;});
$('#lm-check-all').onclick=()=>mutate(()=>project.rows.forEach(r=>r.ready=true));$('#lm-check-none').onclick=()=>mutate(()=>project.rows.forEach(r=>r.ready=false));
function focusRow(i){const row=$('#lm-table').querySelector(`[data-context-row="${i}"]`),input=row?.querySelector('[data-field=mark]');row?.scrollIntoView({block:'nearest',inline:'nearest'});input?.focus({preventScroll:true});input?.select();}
function addRow(panel=focusPanel||project.defaultPanel){if(locked)return;let i=project.rows.length;for(let j=0;j<project.rows.length;j++)if(L.rowValue(project.rows[j],project).panel===panel)i=j+1;if(mutate(()=>project.rows.splice(i,0,{panel,mark:'',qty:1,ready:false,panelOrigin:'Added manually'}))){focusPanel=panel;focusRow(i);notice('Enter a mark and quantity, then check Print when ready.');}}
$('#lm-add').onclick=()=>addRow();
$('#lm-table').onkeydown=e=>{const t=e.target;if(e.key!=='Enter'||!t.dataset.field||t.type==='checkbox')return;e.preventDefault();const fields=['panel','mark','qty','url','notes','project'],next=fields[fields.indexOf(t.dataset.field)+1]||'ready',i=t.dataset.row;t.blur();const input=$('#lm-table').querySelector(`[data-row="${i}"][data-field="${next}"]`);input?.focus();if(input?.type!=='checkbox')input?.select();};

$('#lm-undo').onclick=()=>history(false);$('#lm-redo').onclick=()=>history(true);
$('#lm-context-panel').onchange=e=>{focusPanel=e.target.value;renderContext();};
$('#lm-context-image').onclick=()=>{let d=document.querySelector('#lm-context-dialog');if(!d){d=document.createElement('dialog');d.id='lm-context-dialog';d.innerHTML='<button class="secondary">Close source</button><img style="display:block;max-width:90vw;max-height:85dvh">';document.body.append(d);d.querySelector('button').onclick=()=>d.close();}d.querySelector('img').src=$('#lm-context-image').src;d.showModal();};
$('#lm-recognized-read').onclick=()=>{if(locked)return;const text=$('#lm-recognized-edit').value,panel=panelFromText(text)||focusPanel||project.defaultPanel;addImport(L.rowsFromOcr(text,{panel,url:''}),text);};
$('#lm-open').onclick=()=>$('#lm-project-file').click();$('#lm-project-file').onchange=safe(async e=>{if(locked)throw new Error('Resolved cut-list fields are locked.');const f=e.target.files[0];if(!f)return;const v=JSON.parse(await f.text());if(v.format!=='cas-label-project'||v.version!==1)throw new Error('Use a version 1 Label Maker project.');mutate(()=>project=L.cleanProject({...v,rows:(v.rows||[]).filter(r=>!L.skipDateMark(r.mark))}));contexts.clear();renderContext();e.target.value='';if(!project.logo&&project.design.showLogo){await ensureLogo();}});
$('#lm-save').onclick=()=>download(JSON.stringify(project,null,2),L.printFileName(project,{kind:'labels'})+'.labels.json','application/json'); // the PDF's name: project, panels, date
$('#lm-import').onclick=()=>$('#lm-data-file').click();$('#lm-data-file').onchange=safe(async e=>{const files=[...e.target.files];e.target.value='';await queueFiles(files);});
$('#lm-read-paste').onclick=safe(()=>addImport(L.rowsFromTable(L.parseDelimited($('#lm-paste').value),{panel:project.defaultPanel,url:'',cutList:$('#lm-cutlist').checked})));
$('#lm-paste-recognized').onclick=()=>{const text=$('#lm-paste').value;addImport(L.rowsFromOcr(text,{panel:panelFromText(text)||project.defaultPanel,url:''}),text);};
$('#lm-snapshot').onclick=()=>{$('#lm-snapshot-status').textContent='';$('#lm-snapshot-dialog').showModal();snapBefore=null;clipboardImage().then(g=>{snapBefore=g?.key||null;}).catch(()=>{});$('#lm-snapshot-snip').focus();};
// Snip a region: the computer's own snip (any screen, any window), then the image comes in from the clipboard when the
// page is back in front (checked every 1.5 s while waiting), with Paste now, or with Ctrl+V. The clipboard is read when
// Snapshot opens, so an image already there is not taken for the snip. Waits 3 minutes at most.
let snip=null,snapBefore=null;
const snipStamp=()=>new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
function endSnip(){if(!snip)return;clearInterval(snip.timer);clearTimeout(snip.expire);snip=null;$('#lm-snip-banner').hidden=true;}
async function checkSnip(){if(!snip||snip.busy||!document.hasFocus())return;snip.busy=true;try{const got=await clipboardImage();if(!got||got.key===snip.before)return;snapBefore=got.key;endSnip();await reviewCapture(new File([got.blob],`snip-${snipStamp()}.png`,{type:got.blob.type||'image/png'}),'snip');}catch(e){if(!snip)notice(e.message,true);}finally{if(snip)snip.busy=false;}}
$('#lm-snapshot-snip').onclick=()=>{const g=snipGuide();
 if(g.launch){const a=document.createElement('a');a.href=g.launch;document.body.append(a);a.click();a.remove();} // first, while the click counts
 $('#lm-snapshot-dialog').close();endSnip();
 snip={before:snapBefore,busy:false,timer:setInterval(checkSnip,1500),expire:setTimeout(()=>{endSnip();notice('Snip timed out. Snapshot to try again, or press Ctrl+V.');},180000)};
 $('#lm-snip-text').textContent=g.launch?`✂ Drag around the schedule on any screen (nothing opened? press ${g.keys}). It comes in here when you finish, or press Ctrl+V.`:`✂ Press ${g.keys}, drag around the schedule, then come back: it comes in here, or press Ctrl+V.`;
 $('#lm-snip-banner').hidden=false;};
// After a snip, a screen share or a pasted screenshot: the image first, what was captured, and Use / Retake / Discard.
let captured=null;
async function reviewCapture(file,how){const img=$('#lm-capture-img'),url=URL.createObjectURL(file);img.src=url;
 let size=[0,0];try{const bmp=await createImageBitmap(file);size=[bmp.width,bmp.height];bmp.close?.();}catch{} // from the file: an image in a closed dialog may never decode
 captured={file,how,url};
 $('#lm-capture-info').textContent=`${how==='snip'?'Snip':how==='share'?'Screen share':'Pasted screenshot'} · ${size[0]} × ${size[1]} px · ${Math.max(1,Math.round(file.size/1024))} KB · ${new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}. Use it, then drag around the schedule; or retake.`;
 $('#lm-capture-retake').hidden=how==='paste';$('#lm-capture').showModal();$('#lm-capture-use').focus();}
const discardCapture=()=>{const c=captured;captured=null;if(c){URL.revokeObjectURL(c.url);notice('Snapshot discarded.');}};
$('#lm-capture').addEventListener('cancel',discardCapture); // Esc
const takeCapture=()=>{const c=captured;captured=null;$('#lm-capture').close();if(c)URL.revokeObjectURL(c.url);return c;};
$('#lm-capture-use').onclick=safe(async()=>{const c=takeCapture();if(c)await queueFiles([c.file]);});
$('#lm-capture-retake').onclick=()=>{const c=takeCapture();if(c?.how==='snip')$('#lm-snapshot-snip').click();else if(c?.how==='share')$('#lm-snapshot-screen').click();};
for(const id of ['lm-capture-cancel','lm-capture-close'])$('#'+id).onclick=()=>{discardCapture();$('#lm-capture').close();};
$('#lm-snip-cancel').onclick=()=>{endSnip();notice('Snip cancelled.');};
// Reset: a clear screen (the labels, the project fields and links, the source drawings and recognized text, the design
// and label size, the filter and sheet), as a fresh page. The printed panels list (this browser's print history) stays.
// One Undo step brings the labels back. Not in the Shop Generator's locked labels (they come from the shop).
$('#lm-reset').disabled=locked;if(locked)$('#lm-reset').title='The labels come from Panel Shop Generator: close Labels there to start over.';
$('#lm-reset').onclick=()=>{if(locked)return;if(!confirm('Reset the Label Maker?\n\nThis clears the labels, the links and notes, and the source drawings. Your label design, the project name and the printed panels list stay.\n\nUndo brings the labels back.'))return;
 endSnip();pendingImport=null;activeBatch=null;sourceViewer.batchPosition=null;
 mutate(()=>{project=L.resetProject(project);contexts=new Map();});
 filter='';page=0;focusPanel='';importName='Pasted table';
 if(sourceViewer.dialog.open)sourceViewer.dialog.close();sourceViewer.controller?.abort();sourceViewer.loaded=false;$('#lm-source-reopen').disabled=true;
 $('#lm-recognized-edit').value='';$('#lm-ocr-text').textContent='';$('#lm-import-issues').textContent='';$('#lm-import-issues').hidden=true;
 for(const d of document.querySelectorAll('dialog[open]'))d.close();
 render({forceFields:true});notice('Reset: the screen is clear. The printed panels list is kept; Undo brings the labels back.');};

$('#lm-snip-paste').onclick=async()=>{if(!snip)return;snip.before=null;await checkSnip();if(snip)notice('No snip on the clipboard yet: finish the snip, or press Ctrl+V.',true);};
window.addEventListener('focus',()=>setTimeout(checkSnip,250));
$('#lm-snapshot-close').onclick=()=>$('#lm-snapshot-dialog').close();
$('#lm-snapshot-upload').onclick=()=>{$('#lm-snapshot-dialog').close();$('#lm-image-file').click();};
$('#lm-snapshot-paste').onclick=safe(async()=>{if(!navigator.clipboard?.read)throw new Error('Paste your screenshot with Ctrl+V or use Upload image.');const items=await navigator.clipboard.read();for(const item of items){const type=item.types.find(t=>t.startsWith('image/'));if(type){const file=new File([await item.getType(type)],'snapshot.png',{type});$('#lm-snapshot-dialog').close();await reviewCapture(file,'paste');return;}}throw new Error('No screenshot found. Copy an image first or use Upload image.');});
$('#lm-snapshot-screen').onclick=safe(async()=>{$('#lm-snapshot-dialog').close();let file;try{file=await captureScreen();}catch(e){$('#lm-snapshot-status').textContent='';$('#lm-snapshot-dialog').showModal();throw new Error(captureError(e));}await reviewCapture(file,'share');});
$('#lm-image-file').onchange=safe(async e=>{const files=[...e.target.files];e.target.value='';await queueFiles(files);});
document.addEventListener('paste',safe(async e=>{const f=[...e.clipboardData.items].find(i=>i.type.startsWith('image/'))?.getAsFile();if(f){e.preventDefault();const wasSnip=!!snip;endSnip();if(wasSnip)await reviewCapture(f,'snip');else await queueFiles([f]);}else if(!/INPUT|TEXTAREA/.test(e.target.tagName)&&e.clipboardData.getData('text/plain')){e.preventDefault();const text=e.clipboardData.getData('text/plain');importName='Clipboard';if(/[,\t]/.test(text))addImport(L.rowsFromTable(L.parseDelimited(text),{panel:project.defaultPanel,url:'',cutList:true}));else addImport(L.rowsFromOcr(text,{panel:panelFromText(text)||project.defaultPanel,url:''}),text);}}));
document.querySelector('.lm-workspace').ondragover=e=>e.preventDefault();document.querySelector('.lm-workspace').ondrop=safe(async e=>{e.preventDefault();await queueFiles(e.dataTransfer.files);});
$('#lm-logo-file').onchange=safe(async e=>{if(!e.target.files[0])return;const logo=await jpegLogo(e.target.files[0]);try{localStorage.setItem('cas-label-maker:preferred-logo',JSON.stringify(logo));}catch{}mutate(()=>{project.logo=logo;project.logoSource='custom';});e.target.value='';});$('#lm-default-logo').onclick=safe(async()=>{const logo=await defaultLogo();try{localStorage.removeItem('cas-label-maker:preferred-logo');}catch{}mutate(()=>{project.logo=logo;project.logoSource='default-cw';project.design.showLogo=true;});});
$('#lm-filter').onchange=e=>{filter=e.target.value;page=0;render({table:false});};$('#lm-page').onchange=e=>{page=Number(e.target.value)-1;render({table:false});};
// Sheets: previous / next, a sheet's number, or the arrow keys (and Page Up / Down) on the preview.
const goPage=i=>{page=i;render({table:false});};
// A larger view of the sheet to review it: the same navigation; × or Esc (or a click outside) closes it.
function renderLarge(){const d=$('#lm-large');if(!d.open)return;const print=visibleProject(),state=L.validateProject(print);if(!state.pages||state.errors.length){d.close();return;}$('#lm-large-title').textContent=$('#lm-sheet-summary').textContent;$('#lm-large-sheet').innerHTML=L.labelPageSvg(print,L.expandRows(print),page);$('#lm-large-prev').disabled=page<=0;$('#lm-large-next').disabled=page>=state.pages-1;}
const openLarge=()=>{if(!$('#lm-preview-sheet svg'))return;$('#lm-large').showModal();renderLarge();$('#lm-large-close').focus();};
$('#lm-large-open').onclick=openLarge;$('#lm-preview-sheet').onclick=openLarge;$('#lm-large-close').onclick=()=>$('#lm-large').close();
$('#lm-large-prev').onclick=()=>goPage(page-1);$('#lm-large-next').onclick=()=>goPage(page+1);
$('#lm-large').addEventListener('click',e=>{if(e.target===$('#lm-large'))$('#lm-large').close();});
$('#lm-large').addEventListener('keydown',e=>{const step={ArrowRight:1,PageDown:1,ArrowLeft:-1,PageUp:-1}[e.key];if(!step)return;e.preventDefault();goPage(page+step);});
// The panels printed in this browser (newest first); the active panel is marked. A click shows that panel's labels.
function loadHistory(){try{const h=JSON.parse(localStorage.getItem(L.HISTORY_KEY)||'[]');return Array.isArray(h)?h:[];}catch{return [];}}
function renderHistory(){const h=loadHistory().filter(r=>r&&r.panel);$('#lm-history').hidden=!h.length;if(!h.length)return;
 const when=iso=>{const d=new Date(iso);return isNaN(d)?'':d.toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};
 $('#lm-history-active').innerHTML=focusPanel?`Active panel: <b>${esc(focusPanel)}</b>${h.some(r=>r.panel===focusPanel)?' · printed before':' · not printed yet'}`:'';
 $('#lm-history-list').innerHTML=h.slice(0,40).map(r=>`<li class="${r.panel===focusPanel?'active':''}" data-history-panel="${esc(r.panel)}" title="${esc(r.file||'')}"><b>${esc(r.panel)}</b><span>${Number(r.labels)||0} label${Number(r.labels)===1?'':'s'} · ${esc(L.STOCKS[r.stock]?.short||'')}</span><time datetime="${esc(r.at)}">${esc(when(r.at))}</time>${r.project?`<small>${esc(r.project)}</small>`:''}</li>`).join('');}
function recordPrint(file){try{localStorage.setItem(L.HISTORY_KEY,JSON.stringify(L.addToHistory(loadHistory(),L.printRecords(visibleProject(),{file}))));}catch{}renderHistory();}
$('#lm-history-clear').onclick=()=>{if(!confirm('Clear the printed panels list in this browser?'))return;try{localStorage.removeItem(L.HISTORY_KEY);}catch{}renderHistory();};
$('#lm-history-list').onclick=e=>{const li=e.target.closest('[data-history-panel]');if(!li)return;const p=li.dataset.historyPanel,panels=new Set(project.rows.map(r=>L.rowValue(r,project).panel));if(!panels.has(p)){notice(`${p} is not in the current label list.`);return;}focusPanel=p;filter=p;page=0;render({table:false});};
$('#lm-page-prev').onclick=()=>goPage(page-1);$('#lm-page-next').onclick=()=>goPage(page+1);
$('#lm-page-list').onclick=e=>{const b=e.target.closest('[data-page]');if(b)goPage(Number(b.dataset.page));};
document.querySelector('.lm-preview').addEventListener('keydown',e=>{if(e.target.closest('input,select,textarea'))return;const step={ArrowRight:1,PageDown:1,ArrowLeft:-1,PageUp:-1}[e.key];if(!step)return;e.preventDefault();goPage(page+step);});
$('#lm-pdf').onclick=safe(()=>{const name=printName('labels')+'.pdf';download(L.labelPdf(visibleProject()),name,'application/pdf');recordPrint(name);});$('#lm-proof').onclick=safe(()=>download(L.labelPdf(visibleProject(),{guides:true}),printName('alignment-proof')+'.pdf','application/pdf'));$('#lm-csv').onclick=safe(()=>download(L.expandedCsv(visibleProject(),{header:$('#lm-csv-header').checked}),printName('labels')+'.csv','text/csv;charset=utf-8'));
$('#lm-demo').onclick=()=>addImport({rows:[{panel:'DEMO-01',mark:'C0',qty:12,url:'https://example.com/drawings/DEMO-01'},{panel:'DEMO-01',mark:'T0',qty:2},{panel:'DEMO-02',mark:'C1',qty:3}],issues:[]});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&embedded&&!sourceViewer.dialog.open&&!document.querySelector('#lm-context-dialog')?.open&&!$('#lm-settings-drawer').open&&!$('#lm-import-choice').open&&!layoutEditor.dialog.open&&!$('#lm-snapshot-dialog').open&&!$('#lm-large').open&&!$('#lm-capture').open){e.preventDefault();parent.postMessage({type:'cas-label-maker:close'},location.origin);}if((e.ctrlKey||e.metaKey)&&!sourceViewer.dialog.open&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)&&e.key.toLowerCase()==='z'){e.preventDefault();history(e.shiftKey);}});
window.addEventListener('message',e=>{if(embedded&&e.origin===location.origin&&e.source===parent&&e.data?.type==='cas-label-maker:shop-context'){for(const g of e.data.groups||[])contexts.set(g.panel,g);renderContext();}});
try{const saved=localStorage.getItem(KEY);if(saved)project=L.cleanProject(JSON.parse(saved));else{const d=JSON.parse(localStorage.getItem(L.DESIGN_KEY)||'null');if(d)project=L.cleanProject({...project,design:d});}}catch{notice('Saved project unreadable. Open your project file.',true);} // no saved project: the remembered design
if(new URLSearchParams(location.search).get('from')==='shop'){try{const data=localStorage.getItem(L.HANDOFF_KEY);if(data){if(!locked)past.push(JSON.stringify(project));const p=L.cleanProject(JSON.parse(data));project=L.cleanProject({...project,rows:p.rows,project:p.project,defaultUrl:p.defaultUrl,defaultNotes:p.defaultNotes});store();}}catch{notice('Shop handoff failed. Reopen Labels from the panel shop.',true);}}
$('#lm-settings').onclick=()=>$('#lm-settings-drawer').showModal();$('#lm-settings-close').onclick=()=>$('#lm-settings-drawer').close();$('#lm-pdf-mobile').onclick=()=>$('#lm-pdf').click();document.querySelectorAll('[data-pane]').forEach(b=>b.onclick=()=>{document.querySelector('.lm-workspace').dataset.activePane=b.dataset.pane;document.querySelectorAll('[data-pane]').forEach(t=>t.setAttribute('aria-selected',String(t===b)));});
for(const [id,replace] of [['lm-import-replace',true],['lm-import-append',false]])$('#'+id).onclick=safe(async()=>{if(!pendingImport)return;const batch=pendingImport;pendingImport=null;$('#lm-import-choice').close();if(batch.files)await startFileBatch(batch.files,replace);else commitImport(batch,replace);});$('#lm-import-cancel').onclick=()=>$('#lm-import-choice').close();$('#lm-import-choice').addEventListener('close',()=>{if(!$('#lm-import-choice').open)pendingImport=null;});
async function ensureLogo(){let preferred;try{preferred=JSON.parse(localStorage.getItem('cas-label-maker:preferred-logo')||'null');}catch{}const custom=L.cleanProject({logo:preferred}).logo;if(custom){project.logo=custom;project.logoSource='custom';}else {if(project.logo&&!project.logoSource){const old=await fetch('demos/06-shop-drawings/cas-logo.png');const legacy=old.ok?await jpegLogo(await old.blob()):null;if(project.logo.href!==legacy?.href){project.logoSource='custom';try{localStorage.setItem('cas-label-maker:preferred-logo',JSON.stringify(project.logo));}catch{}}}if(!project.logo||project.logoSource!=='custom'){const logo=await defaultLogo();if(project.logoSource!=='custom'){project.logo=logo;project.logoSource='default-cw';}}}store();render({table:false});}
rememberProjectName(project.project);render();ensureLogo().catch(()=>notice('Logo could not load. Open Settings to upload a logo or hide it.',true));
// A newer published Label Maker: the site lets a browser keep a page for 10 minutes, so on opening the page asks the
// server for its latest copy and offers a reload when its code differs (none on a local server: no build stamps).
(async()=>{try{const own=document.querySelector('script[type=module][src*="label-maker.js"]')?.getAttribute('src')?.match(/\?v=([0-9a-f]+)/)?.[1];if(!own)return;
 const res=await fetch(`label-maker.html?latest=${Date.now()}`,{cache:'no-store'});if(!res.ok)return;const latest=(await res.text()).match(/src="label-maker\.js\?v=([0-9a-f]+)"/)?.[1];if(!latest||latest===own)return;
 $('#lm-update-banner').hidden=false;$('#lm-update-reload').onclick=()=>{const u=new URL(location.href);u.searchParams.set('rev',latest);location.replace(u);};$('#lm-update-later').onclick=()=>{$('#lm-update-banner').hidden=true;};}catch{}})();

