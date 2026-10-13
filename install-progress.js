import {initViewer,loadModel} from './viewer.js';
import {Views} from './views.js';
import {fetchJson,onModelReady,escapeHtml} from './helpers.js';
import {CONFIG} from './config.js';
import {clampSplit,INTEGRATIONS} from './project-dashboard.mjs';
const $=id=>document.getElementById(id);
let tracker,views,tools;
let share=.54,resizeFrame,links={},linkKey='';
try{const stored=localStorage.getItem('cas-project-dashboard:split');if(stored!==null)share=clampSplit(Number(stored));}catch{}
const main=$('main'),divider=$('workspace-divider');
function resizeWorkspace(value=share,save=false){
    const width=main.clientWidth-12;
    share=clampSplit(value,width);main.style.setProperty('--model-width',`${Math.round(width*share)}px`);
    divider.setAttribute('aria-valuenow',Math.round(share*100));divider.setAttribute('aria-valuetext',`${Math.round(share*100)}% model, ${Math.round((1-share)*100)}% schedule`);
    if(save)try{localStorage.setItem('cas-project-dashboard:split',String(share));}catch{}
    cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>views?.resize());
}
divider.onpointerdown=e=>{if(e.button!==0)return;divider.setPointerCapture(e.pointerId);document.body.classList.add('workspace-resizing');e.preventDefault();};
divider.onpointermove=e=>{if(divider.hasPointerCapture(e.pointerId))resizeWorkspace((e.clientX-main.getBoundingClientRect().left)/(main.clientWidth-12));};
const finishResize=()=>{document.body.classList.remove('workspace-resizing');resizeWorkspace(share,true);};
divider.onpointerup=finishResize;divider.onlostpointercapture=finishResize;divider.onpointercancel=finishResize;
divider.ondblclick=()=>resizeWorkspace(.54,true);
divider.onkeydown=e=>{const values={ArrowLeft:share-(e.shiftKey?.05:.02),ArrowRight:share+(e.shiftKey?.05:.02),Home:0,End:1,Enter:.54};if(Object.hasOwn(values,e.key)){e.preventDefault();resizeWorkspace(values[e.key],true);}};
document.querySelectorAll('[data-workspace]').forEach(b=>b.onclick=()=>resizeWorkspace(Number(b.dataset.workspace),true));
new ResizeObserver(()=>resizeWorkspace()).observe(main);resizeWorkspace();
let integration='revit';
function renderIntegration(){
    const source=INTEGRATIONS.find(s=>s.id===integration),saved=links[integration];
    $('integration-tabs').innerHTML=INTEGRATIONS.map(s=>`<button data-integration="${s.id}" aria-pressed="${s.id===integration}">${escapeHtml(s.name)} <small>${links[s.id]?'Demo ready':'Preview'}</small></button>`).join('');
    $('integration-body').innerHTML=`<div class="integration-source-head"><h3>${escapeHtml(source.name)}</h3><span class="demo-badge">${saved?'Demo link ready':'Sample setup'}</span></div><p>${escapeHtml(source.description)}</p>${integration==='cost'?`<label class="integration-system">System <select id="cost-system"><option>Procore</option><option>Autodesk Cost Management</option><option>Sage / ERP</option><option>Other cost system</option></select></label>`:''}<h4>Field mapping</h4><div class="integration-mappings">${source.fields.map(([from,to])=>`<div><b>${escapeHtml(from)}</b><span>→</span><span>${escapeHtml(to)}</span></div>`).join('')}</div><h4>Sample records <small>3 examples, not model totals</small></h4><div class="integration-table"><table><thead><tr><th>Source ID</th><th>Context</th><th>${integration==='cost'?'Demo forecast':'Linked value'}</th></tr></thead><tbody>${source.rows.map(row=>`<tr>${row.map(v=>`<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="integration-actions"><button id="integration-link">${saved?'Update demo mapping':'Use demo mapping'}</button>${saved?'<button id="integration-unlink">Remove demo link</button>':''}</div><p class="integration-origin">${saved?'Last demo refresh: '+escapeHtml(new Date(saved.at).toLocaleString()):'No external credentials or account connection are needed for this preview.'}</p>`;
    document.querySelectorAll('[data-integration]').forEach(b=>b.onclick=()=>{integration=b.dataset.integration;renderIntegration();});
    if(integration==='cost'&&saved?.system)$('cost-system').value=saved.system;
    $('integration-link').onclick=()=>{links[integration]={at:new Date().toISOString(),system:integration==='cost'?$('cost-system').value:source.name};saveLinks();renderIntegration();$('integration-feedback').textContent=`${source.name} demo mapping saved. No external sync performed.`;};
    if($('integration-unlink'))$('integration-unlink').onclick=()=>{delete links[integration];saveLinks();renderIntegration();$('integration-feedback').textContent='Demo link removed.';};
}
function saveLinks(){if(linkKey)try{localStorage.setItem(linkKey,JSON.stringify(links));}catch{}}
function openIntegrations(){renderIntegration();$('integrations').showModal();}
$('integrations-open').onclick=openIntegrations;document.addEventListener('dashboard-integrations',openIntegrations);
$('integrations-close').onclick=()=>$('integrations').close();
$('integration-refresh').onclick=()=>{const at=new Date().toISOString();for(const source of INTEGRATIONS)if(links[source.id])links[source.id].at=at;saveLinks();renderIntegration();$('integration-feedback').textContent=Object.keys(links).length?'Sample records refreshed. No external service contacted.':'Choose a source and use its demo mapping first.';};
document.querySelectorAll('[data-review]').forEach(b=>b.onclick=async()=>{if(!tools)return;const action=b.dataset.review;if(action==='shot')tools.screenshot('3d');else if(action==='top')tools.look([0,0,1]);else if(action==='iso')tools.look([1,-1,.8]);else{await views.setLevel(null);views.showAll();views.fitShown();}b.closest('details').open=false;});
$('help').onclick=()=>$('briefing').showModal();
$('present').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('save-notice').textContent='Use the browser full-screen command to present.';}};
document.addEventListener('fullscreenchange',()=>$('present').textContent=document.fullscreenElement?'Exit presentation':'Present ↗');
$('demo-reset').onclick=async()=>{if(!tracker||!confirm('Restore the demonstration schedule and field snapshot? Your current demo edits will be replaced.'))return;$('demo-reset').disabled=true;try{await tracker.resetDemo();$('save-notice').textContent='Demonstration snapshot restored';}finally{$('demo-reset').disabled=false;}};
document.addEventListener('progress-summary',e=>{const s=e.detail;for(const [id,value] of [['kpi-walls',s.walls.toLocaleString()],['kpi-finished',Math.round(s.finished/Math.max(1,s.walls)*100)+'%'],['kpi-activities',s.activities],['kpi-attention',s.attention],['kpi-levels',`${s.levels} model levels`],['kpi-finished-count',`${s.finished.toLocaleString()} / ${s.walls.toLocaleString()} walls finished`]])$(id).textContent=value;
    const colors={Framed:'#f2c14e',Boarded:'#4e79a7',Taped:'#b07aa1',Finished:'#59a14f'};$('stage-strip').replaceChildren();for(const [name,color] of Object.entries(colors)){const bar=document.createElement('span');bar.style.width=(s.counts[name]/Math.max(1,s.walls)*100)+'%';bar.style.background=color;bar.title=`${name}: ${s.counts[name]}`;$('stage-strip').append(bar);}
    $('model-health').textContent='● Model connected';$('model-health').classList.add('connected');$('model-loading').hidden=true;$('demo-reset').disabled=false;
    if(s.asOf)$('snapshot-date').textContent=new Date(s.asOf+'T12:00:00').toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
});
async function start(){
    if(!window.Autodesk?.Viewing?.GuiViewer3D)throw Error('The Autodesk Viewer could not load. Check your internet connection to the Autodesk services, then retry.');
    const [{TOOLS_EXTENSION_ID}]=await Promise.all([import('./tools.js'),import('./demos/03-progress/extension.js')]);
    const params=new URLSearchParams(location.search);if(!params.has('layout')){params.set('layout','3d');history.replaceState(null,'',location.pathname+'?'+params+location.hash);}
    const models=await fetchJson('samples/urns.json'),model=models.find(m=>/WILTON/i.test(m.file||'')||m.progressDemo==='hotel')||models.find(m=>m.sampleSchedule);if(!model)throw Error('The demonstration model is unavailable.');
    const hotel=/WILTON/i.test(model.file||'')||model.progressDemo==='hotel';$('project-name').textContent=hotel?'Wilton Hotel':model.name.replace(/ \(Arch\)$/,'');
    linkKey='cas-project-dashboard:links:'+model.urn;
    try{const saved=JSON.parse(localStorage.getItem(linkKey)||'{}');for(const source of INTEGRATIONS)if(saved[source.id]&&Number.isFinite(Date.parse(saved[source.id].at)))links[source.id]={at:saved[source.id].at,system:String(saved[source.id].system||source.name)};}catch{}
    const access=await fetch(CONFIG.tokenUrl,{cache:'no-store'});if(!access.ok)throw Error(`Model access service returned ${access.status}. Retry when the connection is available.`);
    location.hash=model.urn;const viewer=await initViewer($('preview'));views=new Views(viewer);
    tools=await viewer.loadExtension(TOOLS_EXTENSION_ID,{views,is3d:true,toolbar:{builtin:[],tools:['showall','fit']}});views.use2d(TOOLS_EXTENSION_ID,{views,is3d:false,toolbar:{builtin:[],tools:['showall','fit']}});
    onModelReady(viewer,m=>views.setModel(m).catch(()=>{$('save-notice').textContent='Model loaded; floor-plan setup needs a retry.';}));
    tracker=await viewer.loadExtension('Drywall.Progress',{panel:$('panel'),views,standalone:true,hotelDemo:hotel});
    await loadModel(viewer,model.urn);
    new ResizeObserver(()=>views.resize()).observe($('main'));
}
start().catch(err=>{$('model-health').textContent='Connection needs attention';$('model-loading').replaceChildren();const title=document.createElement('b');title.textContent='Model connection unavailable';const message=document.createElement('p');message.textContent=err.message||'Check your connection to the Autodesk services.';const retry=document.createElement('button');retry.textContent='Retry';retry.onclick=()=>location.reload();$('model-loading').append(title,message,retry);$('save-notice').textContent='Open Help for connection guidance.';});
