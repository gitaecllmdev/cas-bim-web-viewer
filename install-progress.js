import {initViewer,loadModel} from './viewer.js';
import {Views} from './views.js';
import {fetchJson,onModelReady} from './helpers.js';
import {TOOLS_EXTENSION_ID} from './tools.js';
import {CONFIG} from './config.js';
import './demos/03-progress/extension.js';
const $=id=>document.getElementById(id);
let tracker,views;
$('it-brief').onclick=()=>$('briefing').showModal();
$('present').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('save-notice').textContent='Use the browser full-screen command to present.';}};
document.addEventListener('fullscreenchange',()=>$('present').textContent=document.fullscreenElement?'Exit presentation':'Present ↗');
$('demo-reset').onclick=async()=>{if(!tracker||!confirm('Restore the demonstration schedule and field snapshot? Your current demo edits will be replaced.'))return;$('demo-reset').disabled=true;try{await tracker.resetDemo();$('save-notice').textContent='Demonstration snapshot restored';}finally{$('demo-reset').disabled=false;}};
document.addEventListener('progress-summary',e=>{const s=e.detail;for(const [id,value] of [['kpi-walls',s.walls.toLocaleString()],['kpi-finished',Math.round(s.finished/Math.max(1,s.walls)*100)+'%'],['kpi-activities',s.activities],['kpi-attention',s.attention],['kpi-levels',`${s.levels} model levels`],['kpi-finished-count',`${s.finished.toLocaleString()} / ${s.walls.toLocaleString()} walls finished`]])$(id).textContent=value;
    const colors={Framed:'#f2c14e',Boarded:'#4e79a7',Taped:'#b07aa1',Finished:'#59a14f'};$('stage-strip').replaceChildren();for(const [name,color] of Object.entries(colors)){const bar=document.createElement('span');bar.style.width=(s.counts[name]/Math.max(1,s.walls)*100)+'%';bar.style.background=color;bar.title=`${name}: ${s.counts[name]}`;$('stage-strip').append(bar);}
    $('model-health').textContent='● Model connected';$('model-health').classList.add('connected');$('model-loading').hidden=true;$('demo-reset').disabled=false;
    if(s.asOf)$('snapshot-date').textContent=new Date(s.asOf+'T12:00:00').toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
});
async function start(){
    const params=new URLSearchParams(location.search);if(!params.has('layout')){params.set('layout','3d');history.replaceState(null,'',location.pathname+'?'+params+location.hash);}
    const models=await fetchJson('samples/urns.json'),model=models.find(m=>m.sampleSchedule);if(!model)throw Error('The public demonstration model is unavailable.');
    const access=await fetch(CONFIG.tokenUrl,{cache:'no-store'});if(!access.ok)throw Error(`Model access service returned ${access.status}. Retry when the connection is available.`);
    location.hash=model.urn;const viewer=await initViewer($('preview'));views=new Views(viewer);
    await viewer.loadExtension(TOOLS_EXTENSION_ID,{views,is3d:true,toolbar:{builtin:[],tools:['showall','fit']}});views.use2d(TOOLS_EXTENSION_ID,{views,is3d:false,toolbar:{builtin:[],tools:['showall','fit']}});
    onModelReady(viewer,m=>views.setModel(m).catch(()=>{$('save-notice').textContent='Model loaded; floor-plan setup needs a retry.';}));
    tracker=await viewer.loadExtension('Drywall.Progress',{panel:$('panel'),views,standalone:true});
    await loadModel(viewer,model.urn);
    new ResizeObserver(()=>views.resize()).observe($('main'));
}
start().catch(err=>{$('model-health').textContent='Connection needs attention';$('model-loading').replaceChildren();const title=document.createElement('b');title.textContent='Model connection unavailable';const message=document.createElement('p');message.textContent=err.message||'Check your connection to the Autodesk services.';const retry=document.createElement('button');retry.textContent='Retry';retry.onclick=()=>location.reload();$('model-loading').append(title,message,retry);$('save-notice').textContent='Open IT briefing for network requirements.';});
