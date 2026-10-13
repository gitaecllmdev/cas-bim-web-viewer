import {initViewer,loadModel} from './viewer.js';
import {Views} from './views.js';
import {fetchJson,onModelReady,escapeHtml} from './helpers.js';
import {CONFIG} from './config.js';
import {clampSplit,INTEGRATIONS,dashboardDate,sourceFreshness} from './project-dashboard.mjs';
const $=id=>document.getElementById(id);
let tracker,views,tools,summary,share=.42,resizeFrame,links={},linkKey='',integration='revit',mode='both';
try{const saved=localStorage.getItem('cas-project-dashboard:split');if(saved!==null)share=clampSplit(Number(saved));const choice=localStorage.getItem('cas-project-dashboard:mode');if(['model','both','schedule'].includes(choice))mode=choice;}catch{}
const main=$('main'),divider=$('workspace-divider');
function resizeWorkspace(value=share,save=false){
    const width=main.clientWidth-64;share=clampSplit(value,width);main.style.setProperty('--model-width',`${Math.round(width*share)}px`);
    divider.setAttribute('aria-valuenow',Math.round(share*100));divider.setAttribute('aria-valuetext',`${Math.round(share*100)}% model, ${Math.round((1-share)*100)}% schedule`);
    if(save)try{localStorage.setItem('cas-project-dashboard:split',String(share));}catch{}
    cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>views?.resize());
}
function setWorkspaceMode(value,save=true){mode=value;main.dataset.workspaceMode=mode;document.querySelectorAll('[data-workspace-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.workspaceMode===mode));if(save)try{localStorage.setItem('cas-project-dashboard:mode',mode);}catch{}resizeWorkspace();}
divider.onpointerdown=e=>{if(e.button!==0||mode!=='both')return;divider.setPointerCapture(e.pointerId);document.body.classList.add('workspace-resizing');e.preventDefault();};
divider.onpointermove=e=>{if(divider.hasPointerCapture(e.pointerId))resizeWorkspace((e.clientX-main.getBoundingClientRect().left)/(main.clientWidth-64));};
const finishResize=()=>{document.body.classList.remove('workspace-resizing');resizeWorkspace(share,true);};
divider.onpointerup=finishResize;divider.onlostpointercapture=finishResize;divider.onpointercancel=finishResize;
divider.ondblclick=()=>resizeWorkspace(.42,true);
divider.onkeydown=e=>{const values={ArrowLeft:share-(e.shiftKey?.05:.02),ArrowRight:share+(e.shiftKey?.05:.02),Home:0,End:1,Enter:.42};if(Object.hasOwn(values,e.key)){e.preventDefault();setWorkspaceMode('both');resizeWorkspace(values[e.key],true);}};
document.querySelectorAll('[data-workspace-mode]').forEach(b=>b.onclick=()=>setWorkspaceMode(b.dataset.workspaceMode));
new ResizeObserver(()=>resizeWorkspace()).observe(main);setWorkspaceMode(mode,false);
function renderSources(){
    $('source-statuses').innerHTML=INTEGRATIONS.map(s=>{const saved=links[s.id],at=s.id==='schedule'?summary?.dataDate:saved?.at|| (s.id==='cost'?'2026-10-12':'');const fresh=sourceFreshness(at);let text=s.id==='revit'?(summary?'Viewer ready · revision date unknown':'Loading viewer'):s.id==='schedule'?(summary?(fresh.state==='unknown'?'Data date unknown':'Checked '+dashboardDate(at)):'Waiting for schedule'):'Sample cost plan';let state=s.id==='revit'?'unknown':fresh.state;if(saved?.mode==='setup'){text='Setup saved · sync not enabled';state='unknown';}else if(fresh.state==='stale')text=fresh.label+' · '+dashboardDate(at);return `<button data-source-step="${s.id}" title="Open ${escapeHtml(s.name)} data source"><i class="source-dot ${state}"></i><b>${s.id==='revit'?'Model':s.id==='schedule'?'Schedule':'Cost'}</b><span>${escapeHtml(text)}</span></button>`;}).join('');
    document.querySelectorAll('[data-source-step]').forEach(b=>b.onclick=()=>openConnect(b.dataset.sourceStep));
}
function saveLinks(){if(linkKey)try{localStorage.setItem(linkKey,JSON.stringify(links));}catch{}renderSources();}
function renderIntegration(){
    const source=INTEGRATIONS.find(s=>s.id===integration),saved=links[integration];
    $('integration-tabs').innerHTML=INTEGRATIONS.map((s,i)=>`<button data-integration="${s.id}" aria-pressed="${s.id===integration}"><b>${i+1}. ${i===0?'Model':i===1?'Schedule':'Cost'}</b><small>${links[s.id]?.mode==='setup'?'Setup only':links[s.id]?'Sample ready':'Choose source'}</small></button>`).join('');
    $('integration-body').innerHTML=`<div class="integration-source-head"><h3>${escapeHtml(source.name)}</h3><span>${saved?.mode==='setup'?'Setup saved; sync not enabled':saved?'Sample data ready':'Choose how to supply data'}</span></div><p>${escapeHtml(source.description)}</p><div class="integration-actions"><button id="integration-demo">Use demo data</button><button id="integration-connect">Connect</button></div><div id="connection-form" hidden><h4>Connection setup</h4><p>Save the proposed system and project reference. External sync is not enabled here.</p><label class="integration-system">System <select id="connection-system">${(integration==='cost'?['Procore','Autodesk Cost Management','Sage / ERP','Other cost system']:integration==='revit'?['Revit export / future bridge']:['Schedule file / P6']).map(s=>`<option>${escapeHtml(s)}</option>`).join('')}</select></label><label class="integration-system">Project reference <input id="connection-project" placeholder="Project name or reference" value="${escapeHtml(saved?.project||'')}"></label>${integration==='schedule'?'<button id="connection-file">Choose schedule file</button>':''}<div class="integration-actions"><button id="connection-save">Save setup</button><button id="connection-cancel">Cancel</button></div></div><h4>Field mapping</h4><div class="integration-mappings">${source.fields.map(([from,to])=>`<div><b>${escapeHtml(from)}</b><span>→</span><span>${escapeHtml(to)}</span></div>`).join('')}</div><h4>Sample records <small>3 examples, not model totals</small></h4><div class="integration-table"><table><thead><tr><th>Source ID</th><th>Context</th><th>${integration==='cost'?'Forecast':'Linked value'}</th></tr></thead><tbody>${source.rows.map(row=>`<tr>${row.map(v=>`<td>${escapeHtml(v)}${String(v).startsWith('$')?'<span class="demo-badge">Demo data</span>':''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${integration==='cost'?`<div class="connected-cost-plan"><h4>Cost vs budget</h4><p>Forecast $3,720,000 · Budget $3,600,000 · Variance +$120,000 <span class="demo-badge">Demo data</span></p></div>`:''}${saved?'<button id="integration-unlink">Remove source setup</button>':''}<p class="integration-origin">${saved?'Last checked '+dashboardDate(saved.at):'No external account connection is active. Use demo data to preview the flow.'}</p>`;
    document.querySelectorAll('[data-integration]').forEach(b=>b.onclick=()=>{integration=b.dataset.integration;renderIntegration();});
    if(saved?.system)$('connection-system').value=saved.system;
    $('integration-demo').onclick=async()=>{if(integration==='schedule'&&tracker){if(!tracker.schedule?.source.sample&&!confirm('Replace the current schedule with demo data?'))return;await tracker.loadSample({quiet:true});await tracker.saveSchedule();tracker.render();}links[integration]={at:new Date().toISOString(),system:source.name,mode:'demo'};saveLinks();renderIntegration();$('integration-feedback').textContent=`${source.name} sample data ready. No external sync performed.`;};
    $('integration-connect').onclick=()=>{$('connection-form').hidden=false;$('connection-project').focus();};
    $('connection-cancel').onclick=()=>{$('connection-form').hidden=true;};
    $('connection-save').onclick=()=>{links[integration]={at:new Date().toISOString(),system:$('connection-system').value,project:$('connection-project').value,mode:'setup'};saveLinks();renderIntegration();$('integration-feedback').textContent='Connection setup saved in this browser. External sync is not enabled.';};
    if($('connection-file'))$('connection-file').onclick=()=>tracker?.panel.querySelector('[data-upload]').click();
    if($('integration-unlink'))$('integration-unlink').onclick=()=>{delete links[integration];saveLinks();renderIntegration();$('integration-feedback').textContent='Source setup removed.';};
}
function openConnect(step='revit'){setWorkspaceMode('both');integration=INTEGRATIONS.some(s=>s.id===step)?step:'revit';$('panel').hidden=true;$('connect-page').hidden=false;renderIntegration();$('connect-page').scrollTop=0;}
function closeConnect(){ $('connect-page').hidden=true;$('panel').hidden=false;tracker?.setTab('management');renderDrill();}
$('integrations-open').onclick=()=>openConnect();$('sources-connect').onclick=()=>openConnect();document.addEventListener('dashboard-integrations',()=>openConnect('cost'));
$('integrations-close').onclick=closeConnect;
$('integration-refresh').onclick=()=>{const at=new Date().toISOString();for(const s of INTEGRATIONS)if(links[s.id]?.mode==='demo')links[s.id].at=at;saveLinks();renderIntegration();$('integration-feedback').textContent='Sample records refreshed. No external service contacted.';};
$('demo-reset').onclick=async()=>{if(!tracker||!confirm('Start over with demo data? Current field stages, schedule and reviewed decisions will be replaced.'))return;$('demo-reset').disabled=true;try{await tracker.resetDemo();tracker.reviewed={};tracker.saveReviewed();links=Object.fromEntries(INTEGRATIONS.map(s=>[s.id,{at:new Date().toISOString(),system:s.name,mode:'demo'}]));saveLinks();tracker.render();renderIntegration();$('integration-feedback').textContent='Demo data restored.';}finally{$('demo-reset').disabled=false;}};
async function backOverview(){closeConnect();tracker?.clearFocus();await views?.setLevel(null);tracker?.setTab('management');tracker?.refresh();setWorkspaceMode('both');renderDrill();}
function renderDrill(context={}){const level=views?.level?.name,act=tracker?.selectedAct,tab=tracker?.tab;const show=!!(level||act||tab&&tab!=='management');$('drill-context').hidden=!show;$('drill-label').textContent=[level,act,tab&&tab!=='management'?({stages:'Progress by floor',gantt:'Schedule',calendar:'Schedule',lookahead:'Next 3 weeks'})[tab]:null].filter(Boolean).join(' · ');}
$('back-overview').onclick=backOverview;document.addEventListener('dashboard-context',e=>renderDrill(e.detail));
document.addEventListener('dashboard-focus',()=>setWorkspaceMode('model'));
document.querySelectorAll('[data-headline]').forEach(b=>b.onclick=()=>{if(!tracker)return;setWorkspaceMode('both');$('connect-page').hidden=true;$('panel').hidden=false;const key=b.dataset.headline;if(key==='cost')openConnect('cost');else{tracker.setTab(key==='finish'?'gantt':key==='progress'?'stages':'management');if(key==='decisions')$('panel').querySelector('.decisions-week')?.scrollIntoView({block:'start'});}renderDrill();});
document.querySelectorAll('[data-review]').forEach(b=>b.onclick=async()=>{if(!tools)return;const action=b.dataset.review;if(action==='shot')tools.screenshot('3d');else if(action==='top')tools.look([0,0,1]);else if(action==='iso')tools.look([1,-1,.8]);else{tracker?.clearFocus();await views.setLevel(null);views.showAll();tools.look([1,-1,.8]);views.fitShown();tracker?.refresh();tracker?.renderBody();}const detail=b.closest('details');if(detail)detail.open=false;});
$('model-progress-colors').onclick=()=>tracker?.setColorMode('actual');$('model-status-colors').onclick=()=>tracker?.setColorMode('compare');
$('help').onclick=()=>$('briefing').showModal();
$('present').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('save-notice').textContent='Use the browser full-screen command to present.';}};
document.addEventListener('fullscreenchange',()=>$('present').textContent=document.fullscreenElement?'Exit presentation':'Present');
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('details[open]').forEach(d=>d.open=false);});
document.addEventListener('progress-summary',e=>{
    summary=e.detail;const s=summary,m=s.dashboard;if(!m)return;
    $('kpi-walls').textContent=s.walls.toLocaleString();$('kpi-levels').textContent=s.levels+' levels';$('kpi-activities').textContent=s.activities;
    $('snapshot-date').textContent=dashboardDate(s.asOf||s.dataDate);$('model-health').textContent='Viewer ready';$('model-health').classList.add('connected');$('model-loading').hidden=true;$('demo-reset').disabled=false;
    $('project-status').textContent=`${m.pending} decisions waiting for review. ${m.progressStatus}; cost figures use demo data.`;
    const prior='No prior-week snapshot',delta=(v,tag)=>v?`${v} since last week`+(tag?' (demo comparison)':''):prior;
    for(const [id,value] of [['finish-status',m.finishStatus],['finish-value',dashboardDate(m.finish)],['finish-change',delta(m.changes?.finish,true)],['progress-status',m.progressStatus],['progress-value',m.gap==null?'Not linked':(m.gap>=0?'+':'')+m.gap+' pts'],['progress-change',delta(m.changes?.progress,true)],['cost-status','Over budget'],['cost-value','+'+m.costs.variancePct.toFixed(1)+'%'],['cost-change','+$45,000 since last week (demo comparison)'],['decision-status',m.pending?'Review needed':'Reviewed'],['decision-value',m.pending],['decision-change',delta(m.changes?.decisions,true)]])$(id).textContent=value;
    $('finish-demo').hidden=!s.demo;$('progress-demo').hidden=!s.demo;$('decision-demo').hidden=!s.demo;
    for(const [name,state] of [['finish',m.finishStatus==='Unknown'?'neutral':m.finishStatus==='At risk'?'red':'green'],['progress',m.gap<-10?'red':m.gap==null?'neutral':'green'],['cost','red'],['decisions',m.pending?'amber':'green']])document.querySelector(`[data-headline="${name}"]`).dataset.status=state;
    $('model-legend').innerHTML=(s.colorMode==='compare'?[['green','On or ahead of plan'],['red','Behind plan'],['neutral','Not started']]:[['neutral','Not started'],['amber','In progress'],['green','Finished'],['red','Behind selected activity']]).map(([color,label])=>`<span><i class="${color}"></i>${label}</span>`).join('');
    renderSources();renderDrill();
});
renderSources();
async function start(){
    if(!window.Autodesk?.Viewing?.GuiViewer3D)throw Error('The Autodesk Viewer could not load. Check your internet connection to the Autodesk services, then retry.');
    const [{TOOLS_EXTENSION_ID}]=await Promise.all([import('./tools.js'),import('./demos/03-progress/extension.js')]);
    const params=new URLSearchParams(location.search);params.set('layout','split');history.replaceState(null,'',location.pathname+'?'+params+location.hash);
    const models=await fetchJson('samples/urns.json'),model=models.find(m=>/WILTON/i.test(m.file||'')||m.progressDemo==='hotel')||models.find(m=>m.sampleSchedule);if(!model)throw Error('The demonstration model is unavailable.');
    const hotel=/WILTON/i.test(model.file||'')||model.progressDemo==='hotel';$('project-name').textContent=hotel?'Wilton Hotel':model.name.replace(/ \(Arch\)$/,'');
    linkKey='cas-project-dashboard:links:'+model.urn;
    try{const saved=JSON.parse(localStorage.getItem(linkKey)||'{}');for(const source of INTEGRATIONS)if(saved[source.id]&&Number.isFinite(Date.parse(saved[source.id].at)))links[source.id]={at:saved[source.id].at,system:String(saved[source.id].system||source.name),mode:saved[source.id].mode==='setup'?'setup':'demo',project:String(saved[source.id].project||'')};}catch{}
    const access=await fetch(CONFIG.tokenUrl,{cache:'no-store'});if(!access.ok)throw Error(`Model access service returned ${access.status}. Retry when the connection is available.`);
    location.hash=model.urn;const viewer=await initViewer($('preview'));views=new Views(viewer);
    tools=await viewer.loadExtension(TOOLS_EXTENSION_ID,{views,is3d:true,toolbar:{builtin:[],tools:['showall','fit']}});views.use2d(TOOLS_EXTENSION_ID,{views,is3d:false,toolbar:{builtin:[],tools:['showall','fit']}});
    onModelReady(viewer,m=>views.setModel(m).catch(()=>{$('save-notice').textContent='Model loaded; floor-plan setup needs a retry.';}));
    tracker=await viewer.loadExtension('Drywall.Progress',{panel:$('panel'),views,standalone:true,hotelDemo:hotel});
    await loadModel(viewer,model.urn);
    views.on('level',()=>renderDrill());renderSources();new ResizeObserver(()=>views.resize()).observe($('main'));
}
start().catch(err=>{$('model-health').textContent='Connection needs attention';$('model-loading').replaceChildren();const title=document.createElement('b');title.textContent='Model connection unavailable';const message=document.createElement('p');message.textContent=err.message||'Check your connection to the Autodesk services.';const retry=document.createElement('button');retry.textContent='Retry';retry.onclick=()=>location.reload();$('model-loading').append(title,message,retry);$('save-notice').textContent='Open Help for connection guidance.';});
