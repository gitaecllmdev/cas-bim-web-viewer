import {initViewer,loadModel} from './viewer.js';
import {Views} from './views.js';
import {fetchJson,onModelReady,escapeHtml} from './helpers.js';
import {CONFIG} from './config.js';
import {clampSplit,INTEGRATIONS,dashboardDate,sourceFreshness,costSummary,labourSummary,labourAssignments,dashboardIcon,demoBimSnapshot,dashboardTimestamp,PLAYBACK_COLORS} from './project-dashboard.mjs';
const $=id=>document.getElementById(id);
const sourceLabel=id=>({revit:'Model',schedule:'Schedule',cost:'Cost',labour:'Labour'})[id];
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
const variance=n=>(n>0?'+':'')+money(n);
let bimSnapshot=demoBimSnapshot();
let tracker,views,tools,summary,share=.42,resizeFrame,links={},linkKey='',integration='revit',mode='both';
try{const saved=localStorage.getItem('cas-project-dashboard:split');if(saved!==null)share=clampSplit(Number(saved));}catch{}
const main=$('main'),divider=$('workspace-divider');
function resizeWorkspace(value=share,save=false){
    const width=main.clientWidth-40;share=clampSplit(value,width);main.style.setProperty('--model-width',`${Math.round(width*share)}px`);
    divider.setAttribute('aria-valuenow',Math.round(share*100));divider.setAttribute('aria-valuetext',`${Math.round(share*100)}% model, ${Math.round((1-share)*100)}% schedule`);
    if(save)try{localStorage.setItem('cas-project-dashboard:split',String(share));}catch{}
    cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>views?.resize());
}
function setWorkspaceMode(value,save=true){mode=value;main.dataset.workspaceMode=mode;document.querySelectorAll('[data-workspace-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.workspaceMode===mode));if(save)try{localStorage.setItem('cas-project-dashboard:mode',mode);}catch{}resizeWorkspace();}
divider.onpointerdown=e=>{if(e.button!==0||mode!=='both')return;divider.setPointerCapture(e.pointerId);document.body.classList.add('workspace-resizing');e.preventDefault();};
divider.onpointermove=e=>{if(divider.hasPointerCapture(e.pointerId))resizeWorkspace((e.clientX-main.getBoundingClientRect().left)/(main.clientWidth-40));};
const finishResize=()=>{document.body.classList.remove('workspace-resizing');resizeWorkspace(share,true);};
divider.onpointerup=finishResize;divider.onlostpointercapture=finishResize;divider.onpointercancel=finishResize;
divider.ondblclick=()=>resizeWorkspace(.42,true);
divider.onkeydown=e=>{const values={ArrowLeft:share-(e.shiftKey?.05:.02),ArrowRight:share+(e.shiftKey?.05:.02),Home:0,End:1,Enter:.42};if(Object.hasOwn(values,e.key)){e.preventDefault();setWorkspaceMode('both');resizeWorkspace(values[e.key],true);}};
document.querySelectorAll('[data-workspace-mode]').forEach(b=>b.onclick=()=>setWorkspaceMode(b.dataset.workspaceMode));
new ResizeObserver(()=>resizeWorkspace()).observe(main);setWorkspaceMode(mode,false);
function renderSources(){
    $('source-statuses').innerHTML=INTEGRATIONS.map(s=>{const saved=links[s.id],at=s.id==='schedule'?summary?.dataDate:saved?.at|| (['cost','labour'].includes(s.id)?'2026-10-12':'');const fresh=sourceFreshness(at);let text=s.id==='revit'?(summary?'Demo link current · '+bimSnapshot.revision+' · '+dashboardTimestamp(bimSnapshot.updatedAt):'Loading viewer'):s.id==='schedule'?(summary?(fresh.state==='unknown'?'Data date unknown':'Checked '+dashboardDate(at)):'Waiting for schedule'):s.id==='labour'?'Sample labour plan':'Sample cost plan';let state=s.id==='revit'?(summary?'current':'unknown'):fresh.state;if(saved?.mode==='setup'){text='Setup saved · sync not enabled';state='unknown';}else if(fresh.state==='stale')text=fresh.label+' · '+dashboardDate(at);return `<button data-source-step="${s.id}" title="Open ${escapeHtml(s.name)} data source"><i class="source-dot ${state}"></i><b>${sourceLabel(s.id)}</b><span>${escapeHtml(text)}</span>${s.id==='revit'&&summary?'<span class="demo-badge">Demo data</span>':''}</button>`;}).join('');
    document.querySelectorAll('[data-source-step]').forEach(b=>b.onclick=()=>openConnect(b.dataset.sourceStep));
}
function saveLinks(){if(linkKey)try{localStorage.setItem(linkKey,JSON.stringify(links));}catch{}renderSources();}
function financeHtml(){
    const c=costSummary(),l=labourSummary();
    return `<section class="connected-cost-plan" data-labour-finance><header><h4>Cost & labour forecast</h4><span class="demo-badge">Demo data</span></header><p>Labour is included in the project total below. It is not an additional cost.</p><div class="integration-table"><table><thead><tr><th>Cost component</th><th>Budget</th><th>Forecast</th><th>Variance</th></tr></thead><tbody>${[['Labour',l.budgetCost,l.forecastCost],['Materials & other costs',l.otherBudget,l.otherForecast],['Project total',c.budget,c.forecast]].map(([name,budget,forecast])=>`<tr><th>${name}</th><td>${money(budget)}</td><td>${money(forecast)}</td><td>${variance(forecast-budget)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function labourHtml(){
    const l=labourSummary(),rows=labourAssignments(tracker?.linked||[],summary?.asOf||'2026-10-12');
    return `<section class="labour-detail"><header><h4>Mock labour allocation</h4><span class="demo-badge">Demo data</span></header><p>Week of ${dashboardDate(rows[0].weekStart)} · ${l.crew} people · ${l.weekHours.toLocaleString()} hours of ${l.plannedWeek.toLocaleString()} planned. Includes ${l.overtime} overtime hours.</p><div class="integration-table labour-allocation" tabindex="0" role="region" aria-label="Work-package labour allocations"><table><thead><tr><th>Work package / context</th><th>Crew</th><th>Regular hrs</th><th>OT hrs</th><th>Planned hrs</th><th>Explore</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${r.name}</b><small>${r.id} · ${r.code}</small><small>${escapeHtml(r.level||'No matching schedule activity')} ${escapeHtml(r.activityId)}</small><small>Project forecast: ${r.forecastHours.toLocaleString()} hrs / ${money(r.forecastHours*r.rate)}</small></td><td>${r.crew}</td><td>${r.regular}</td><td>${r.overtime}</td><td>${r.plannedWeek}</td><td><button data-labour-model="${escapeHtml(r.activityId)}" ${r.activityId?'':'disabled'}>Model</button><button data-labour-schedule="${escapeHtml(r.activityId)}" ${r.activityId?'':'disabled'}>Schedule</button></td></tr>`).join('')}</tbody></table></div><p>Project hours: ${l.forecastHours.toLocaleString()} forecast vs ${l.budgetHours.toLocaleString()} budget (+${l.hourVariance.toLocaleString()} hrs). Blended loaded rate: $60/hr, including overtime in this mock forecast.</p><p class="integration-origin">Allocations are illustrative and matched to available schedule activities for context. They do not change wall counts, field stages, quantities or activity dates.</p></section>${financeHtml()}<button data-connect-step="cost">View cost source</button>`;
}
async function focusLabour(id,target){
    const activity=tracker?.activity(id);if(!activity)return;
    closeConnect();tracker.clearFocus();await views.setLevel(activity.level);
    tracker.setTab('gantt');tracker.selectActivity(id);showActivityContext();renderDrill();
}
function bimHtml(){
    const b=bimSnapshot;
    return `<section class="bim-source-status"><header><h4>BIM delivery status</h4><span class="demo-badge">Demo data</span></header><p><b>Model ${b.revision}</b> · Updated ${dashboardTimestamp(b.updatedAt)} (Pacific time)<br>Demo link current · Phase: ${b.phase}</p><div class="integration-table"><table><thead><tr><th>Milestone</th><th>Complete</th><th>Packages</th></tr></thead><tbody><tr><th>Shop drawings issued</th><td>${b.shopPct}%</td><td>${b.shopIssued} / ${b.packages}</td></tr><tr><th>Prefab ready</th><td>${b.prefabPct}%</td><td>${b.prefabReady} / ${b.packages}</td></tr><tr><th>Material delivered</th><td>${b.deliveryPct}%</td><td>${b.materialDelivered} / ${b.packages}</td></tr></tbody></table></div><p class="integration-origin">Illustrative model revision, link status and package milestones. They do not verify an actual Revit revision or change the model quantities.</p></section>`;
}
function sourceRecordsHtml(source,kind){
    return `<h4>Sample records <small>3 examples, not model totals</small></h4><div class="integration-table" data-source-records><table><thead><tr><th>Source ID</th><th>Context</th><th>${kind==='cost'?'Forecast':'Linked value'}</th></tr></thead><tbody>${source.rows.map(row=>`<tr>${row.map(v=>`<td>${escapeHtml(v)}${String(v).startsWith('$')?'<span class="demo-badge">Demo data</span>':''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function decorateControls(){
    const groups=[['[data-ui-icon]',''],['#integrations-open,#sources-connect','connect'],['#help','help'],['#present','present'],['[data-review="fit"]','home'],['.model-review>summary','tools'],['[data-tab="management"]','both'],['[data-tab="stages"]','review'],['[data-tab="gantt"]','schedule'],['[data-tab="lookahead"]','next'],['.pg-menu>summary','more'],['[data-links-toggle]','connect'],['[data-decision-model],[data-labour-model]','model'],['[data-decision-next],[data-labour-schedule]','schedule'],['[data-decision-review]','review'],['[data-labour-open]','crew'],['[data-bim-open]','drawings'],['[data-subview="gantt"]','schedule'],['[data-subview="calendar"]','calendar'],['[data-layout="3d"]','model'],['[data-layout="split"]','both'],['[data-layout="2d"]','drawings'],['#back-overview,#integrations-close','home']];
    for(const [selector,icon] of groups)document.querySelectorAll(selector).forEach(b=>{if(!b.querySelector('[data-dashboard-icon]'))b.insertAdjacentHTML('afterbegin',dashboardIcon(b.dataset.uiIcon||icon));});
    const upload=$('panel').querySelector('[data-upload]')?.closest('label');if(upload&&!upload.querySelector('[data-dashboard-icon]'))upload.insertAdjacentHTML('afterbegin',dashboardIcon('upload'));
}
function renderIntegration(){
    const source=INTEGRATIONS.find(s=>s.id===integration),saved=links[integration];
    $('integration-tabs').innerHTML=INTEGRATIONS.map((s,i)=>`<button data-integration="${s.id}" aria-pressed="${s.id===integration}"><b>${i+1}. ${sourceLabel(s.id)}</b><small>${links[s.id]?.mode==='setup'?'Setup only':links[s.id]?'Sample ready':'Choose source'}</small></button>`).join('');
    $('integration-body').innerHTML=`<div class="integration-source-head"><h3>${escapeHtml(source.name)}</h3><span>${saved?.mode==='setup'?'Setup saved; sync not enabled':saved?'Sample data ready':'Choose how to supply data'}</span></div><p>${escapeHtml(source.description)}</p><div class="integration-actions"><button id="integration-demo">Use demo data</button><button id="integration-connect">Connect</button></div><div id="connection-form" hidden><h4>Connection setup</h4><p>Save the proposed system and project reference. External sync is not enabled here.</p><label class="integration-system">System <select id="connection-system">${(integration==='cost'?['Procore','Autodesk Cost Management','Sage / ERP','Other cost system']:integration==='labour'?['Internal Production Tracking Tool']:integration==='revit'?['Revit export / future bridge']:['Schedule file / P6']).map(s=>`<option>${escapeHtml(s)}</option>`).join('')}</select></label><label class="integration-system">Project reference <input id="connection-project" placeholder="Project name or reference" value="${escapeHtml(saved?.project||'')}"></label>${integration==='schedule'?'<button id="connection-file">Choose schedule file</button>':''}<div class="integration-actions"><button id="connection-save">Save setup</button><button id="connection-cancel">Cancel</button></div></div><h4>Field mapping</h4><div class="integration-mappings">${source.fields.map(([from,to])=>`<div><b>${escapeHtml(from)}</b><span>→</span><span>${escapeHtml(to)}</span></div>`).join('')}</div>${integration==='revit'?bimHtml():''}${integration==='labour'?labourHtml():sourceRecordsHtml(source,integration)}${integration==='cost'?financeHtml()+'<button data-connect-step="labour">View labour source</button>':''}${saved?'<button id="integration-unlink">Remove source setup</button>':''}<p class="integration-origin">${saved?'Last checked '+dashboardDate(saved.at):'No external account connection is active. Use demo data to preview the flow.'}</p>`;
    if(['labour','cost','revit'].includes(integration)){
        const body=$('integration-body'),heading=[...body.querySelectorAll('h4')].find(h=>h.textContent==='Field mapping');
        const mappings=heading.nextElementSibling,details=document.createElement('details'),label=document.createElement('summary');
        details.className='source-mapping';label.textContent=integration==='labour'?'Internal tool field mapping':integration==='revit'?'Model source field mapping':'Cost source field mapping';
        details.append(label,mappings);heading.replaceWith(details);
        if(integration==='labour')body.insertBefore(body.querySelector('.labour-detail'),details);
        if(integration==='revit')body.insertBefore(body.querySelector('.bim-source-status'),details);
        else{body.insertBefore(body.querySelector('[data-labour-finance]'),details);body.insertBefore(body.querySelector('[data-connect-step]'),details);}
    }
    document.querySelectorAll('[data-connect-step]').forEach(b=>b.onclick=()=>openConnect(b.dataset.connectStep));
    document.querySelectorAll('[data-labour-model]').forEach(b=>b.onclick=()=>focusLabour(b.dataset.labourModel,'model'));
    document.querySelectorAll('[data-labour-schedule]').forEach(b=>b.onclick=()=>focusLabour(b.dataset.labourSchedule,'schedule'));
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
$('integrations-open').onclick=()=>openConnect();$('sources-connect').onclick=()=>openConnect();document.addEventListener('dashboard-integrations',e=>openConnect(e.detail?.step||'cost'));
$('integrations-close').onclick=closeConnect;
$('integration-refresh').onclick=()=>{bimSnapshot=demoBimSnapshot();const at=new Date().toISOString();for(const s of INTEGRATIONS)if(links[s.id]?.mode==='demo')links[s.id].at=at;saveLinks();renderIntegration();$('integration-feedback').textContent='Sample records refreshed. No external service contacted.';};
$('demo-reset').onclick=async()=>{if(!tracker||!confirm('Start over with demo data? Current field stages, schedule and reviewed decisions will be replaced.'))return;$('demo-reset').disabled=true;try{await tracker.resetDemo();tracker.reviewed={};tracker.saveReviewed();links=Object.fromEntries(INTEGRATIONS.map(s=>[s.id,{at:new Date().toISOString(),system:s.name,mode:'demo'}]));saveLinks();tracker.render();renderIntegration();$('integration-feedback').textContent='Demo data restored.';}finally{$('demo-reset').disabled=false;}};
async function backOverview(){closeConnect();tracker?.clearFocus();setWorkspaceMode('both');await views?.setLevel(null);tracker?.refresh();renderDrill();}
function renderDrill(context={}){const level=views?.level?.name,act=tracker?.selectedAct,tab=tracker?.tab;const show=!!(level||act||tab&&tab!=='management');$('drill-context').hidden=!show;$('drill-label').textContent=[level,act,tab&&tab!=='management'?({stages:'Progress by floor',gantt:'Schedule',calendar:'Schedule',lookahead:'Next 3 weeks'})[tab]:null].filter(Boolean).join(' · ');}
$('back-overview').onclick=backOverview;document.addEventListener('dashboard-context',e=>{renderDrill(e.detail);decorateControls();});
function showActivityContext(){setWorkspaceMode('both');views?.setLayout('split');$('panel').hidden=false;$('connect-page').hidden=true;const panel=tracker?.panel,details=panel?.querySelector('.pg-details');if(details){const head=panel.querySelector('.pg-head');panel.scrollTop+=details.getBoundingClientRect().top-panel.getBoundingClientRect().top-(head?.offsetHeight||0)-12;}}
function mountViewControls(){
    const bar=document.createElement('div');bar.className='view-context-controls';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','3D view controls');
    bar.innerHTML=`<button data-view-command="iso" title="Isometric view" aria-label="Isometric view">${dashboardIcon('model')}</button><button data-view-command="top" title="Top view" aria-label="Top view">${dashboardIcon('drawings')}</button><button data-view-command="fit" title="Fit the current floor or building" aria-label="Fit shown model">${dashboardIcon('present')}</button><label title="Model status colors"><span class="sr-only">Model status colors</span><select id="view-status" disabled><option value="actual">Installed</option><option value="compare">Vs plan</option><option value="planned">Schedule</option></select></label>`;
    $('preview').append(bar);
    bar.querySelectorAll('[data-view-command]').forEach(b=>b.onclick=()=>{const action=b.dataset.viewCommand;if(action==='fit')views.fitShown();else tools?.look(action==='top'?[0,0,1]:[1,-1,.8]);});
    bar.querySelector('select').onchange=e=>tracker?.setColorMode(e.target.value);
    bar.addEventListener('pointerdown',e=>e.stopPropagation());bar.addEventListener('keydown',e=>e.stopPropagation());
}
document.addEventListener('dashboard-focus',showActivityContext);
window.addEventListener('pagehide',()=>tracker?.endPlayback());
document.querySelectorAll('[data-headline]').forEach(b=>b.onclick=()=>{if(!tracker)return;setWorkspaceMode('both');$('connect-page').hidden=true;$('panel').hidden=false;const key=b.dataset.headline;if(key==='cost')openConnect('cost');else{tracker.setTab(key==='finish'?'gantt':key==='progress'?'stages':'management');if(key==='decisions')$('panel').querySelector('.decisions-week')?.scrollIntoView({block:'start'});}renderDrill();});
document.querySelectorAll('[data-review]').forEach(b=>b.onclick=async()=>{if(!tools)return;const action=b.dataset.review;if(action==='shot')tools.screenshot('3d');else if(action==='top')tools.look([0,0,1]);else if(action==='iso')tools.look([1,-1,.8]);else{tracker?.clearFocus();await views.setLevel(null);views.showAll();tools.look([1,-1,.8]);views.fitShown();tracker?.refresh();tracker?.renderBody();}const detail=b.closest('details');if(detail)detail.open=false;});
$('help').onclick=()=>$('briefing').showModal();
$('present').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('save-notice').textContent='Use the browser full-screen command to present.';}};
document.addEventListener('fullscreenchange',()=>{$('present').textContent=document.fullscreenElement?'Exit presentation':'Present';decorateControls();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('details[open]').forEach(d=>d.open=false);});
document.addEventListener('progress-summary',e=>{
    summary=e.detail;const s=summary,m=s.dashboard;if(!m)return;
    if($('view-status')){$('view-status').disabled=false;$('view-status').value=s.colorMode;}
    $('kpi-walls').textContent=s.walls.toLocaleString();$('kpi-levels').textContent=s.levels+' levels';$('kpi-activities').textContent=s.activities;
    $('snapshot-date').textContent=dashboardDate(s.asOf||s.dataDate);$('model-health').textContent='Viewer ready';$('model-health').classList.add('connected');$('model-loading').hidden=true;$('demo-reset').disabled=false;
    $('project-status').textContent=`${m.pending} decisions waiting for review. ${m.progressStatus}; cost and labour figures use demo data.`;
    const prior='No prior-week snapshot',delta=(v,tag)=>v?`${v} since last week`+(tag?' (demo comparison)':''):prior;
    for(const [id,value] of [['finish-status',m.finishStatus],['finish-value',dashboardDate(m.finish)],['finish-change',delta(m.changes?.finish,true)],['progress-status',m.progressStatus],['progress-value',m.gap==null?'Not linked':(m.gap>=0?'+':'')+m.gap+' pts'],['progress-change',delta(m.changes?.progress,true)],['cost-status','Over budget'],['cost-value','+'+m.costs.variancePct.toFixed(1)+'%'],['cost-change','+$45,000 since last week (demo comparison)'],['decision-status',m.pending?'Review needed':'Reviewed'],['decision-value',m.pending],['decision-change',delta(m.changes?.decisions,true)]])$(id).textContent=value;
    $('finish-demo').hidden=!s.demo;$('progress-demo').hidden=!s.demo;$('decision-demo').hidden=!s.demo;
    for(const [name,state] of [['finish',m.finishStatus==='Unknown'?'neutral':m.finishStatus==='At risk'?'red':'green'],['progress',m.gap<-10?'red':m.gap==null?'neutral':'green'],['cost','red'],['decisions',m.pending?'amber':'green']])document.querySelector(`[data-headline="${name}"]`).dataset.status=state;
    $('model-legend').innerHTML=s.playback?Object.entries(PLAYBACK_COLORS).map(([stage,color])=>`<span><i style="background:${color}"></i>${stage}</span>`).join(''):(s.colorMode==='compare'?[['green','On or ahead of plan'],['red','Behind plan'],['neutral','Not started']]:[['neutral','Not started'],['amber','In progress'],['green','Finished'],['red','Behind selected activity']]).map(([color,label])=>`<span><i class="${color}"></i>${label}</span>`).join('');
    renderSources();renderDrill();
});
renderSources();decorateControls();
async function start(){
    if(!window.Autodesk?.Viewing?.GuiViewer3D)throw Error('The Autodesk Viewer could not load. Check your internet connection to the Autodesk services, then retry.');
    const [{TOOLS_EXTENSION_ID}]=await Promise.all([import('./tools.js'),import('./demos/03-progress/extension.js')]);
    const params=new URLSearchParams(location.search);params.set('layout','split');history.replaceState(null,'',location.pathname+'?'+params+location.hash);
    const models=await fetchJson('samples/urns.json'),model=models.find(m=>/WILTON/i.test(m.file||'')||m.progressDemo==='hotel')||models.find(m=>m.sampleSchedule);if(!model)throw Error('The demonstration model is unavailable.');
    const hotel=/WILTON/i.test(model.file||'')||model.progressDemo==='hotel';$('project-name').textContent=(hotel?'Wilton Hotel':model.name.replace(/ \(Arch\)$/,''))+' (Demo)';
    linkKey='cas-project-dashboard:links:'+model.urn;
    try{const saved=JSON.parse(localStorage.getItem(linkKey)||'{}');for(const source of INTEGRATIONS)if(saved[source.id]&&Number.isFinite(Date.parse(saved[source.id].at)))links[source.id]={at:saved[source.id].at,system:source.id==='labour'&&saved[source.id].system==='Internal labour tool'?source.name:String(saved[source.id].system||source.name),mode:saved[source.id].mode==='setup'?'setup':'demo',project:String(saved[source.id].project||'')};}catch{}
    const access=await fetch(CONFIG.tokenUrl,{cache:'no-store'});if(!access.ok)throw Error(`Model access service returned ${access.status}. Retry when the connection is available.`);
    location.hash=model.urn;const viewer=await initViewer($('preview'));views=new Views(viewer);views.setSelectionFollow(true);views.on('selectioncontext',context=>{const el=$('selection-context');el.hidden=!context.ids.length;el.textContent=context.level?`${context.ids.length} wall${context.ids.length===1?'':'s'} selected · ${context.level} · Whole floor context · ${context.plan}`:'Selection spans levels or has no wall-level mapping';setWorkspaceMode('both');if(context.level&&tracker){tracker.selectedAct=null;tracker.linkedOnly=false;tracker.isolatedBySchedule=false;tracker.isolatedStage=null;tracker.refresh();tracker.renderBody();}renderDrill();});
    tools=await viewer.loadExtension(TOOLS_EXTENSION_ID,{views,is3d:true,toolbar:{builtin:[],tools:['showall','fit']}});views.use2d(TOOLS_EXTENSION_ID,{views,is3d:false,toolbar:{builtin:[],tools:['showall','fit']}});
    mountViewControls();
    onModelReady(viewer,m=>views.setModel(m).catch(()=>{$('save-notice').textContent='Model loaded; floor-plan setup needs a retry.';}));
    tracker=await viewer.loadExtension('Drywall.Progress',{panel:$('panel'),views,standalone:true,hotelDemo:hotel});
    await loadModel(viewer,model.urn);
    views.on('level',()=>renderDrill());renderSources();new ResizeObserver(()=>views.resize()).observe($('main'));
}
start().catch(err=>{$('model-health').textContent='Connection needs attention';$('model-loading').replaceChildren();const title=document.createElement('b');title.textContent='Model connection unavailable';const message=document.createElement('p');message.textContent=err.message||'Check your connection to the Autodesk services.';const retry=document.createElement('button');retry.textContent='Retry';retry.onclick=()=>location.reload();$('model-loading').append(title,message,retry);$('save-notice').textContent='Open Help for connection guidance.';});
