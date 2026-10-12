import {LANES, boardError, normalizeBoard, mergePublished, numberBoard, cardReference} from './demos/common/framing-board.mjs';
const $=id=>document.getElementById(id), API='/api/state/framing-decision-board', CACHE='cas-framing-board:draft:v2';
const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const fields=['title','lane','panel','notes','evidence','owner','due','kind','priority','acceptance','results'];
const typeNames={task:'Development',test:'Manual test',proposal:'Proposal',rule:'Agreed rule'};
let board,seed,busy=false,pending=false,editing=null,currentLane='review',opener;
const text=(element,value)=>{element.textContent=value;return element;};
const node=(tag,value,className)=>{const n=text(document.createElement(tag),value);if(className)n.className=className;return n;};
const date=value=>value?new Date(value+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}):'No due date';
function render(){
    text($('project-title'),board.project);$('board').replaceChildren();$('lane-tabs').replaceChildren();
    const completed=board.cards.filter(c=>c.lane==='done').length;
    $('progress').replaceChildren(node('strong',`${completed} / ${board.cards.length}`),node('span',' cards completed'));
    const progress=document.createElement('progress');progress.max=board.cards.length||1;progress.value=completed;$('progress').append(progress);
    const search=$('search').value.trim().toLowerCase(), today=new Date().toLocaleDateString('en-CA');
    for(const [key,title] of LANES){
        const cards=board.cards.filter(c=>c.lane===key&&(!$('owner').value||c.owner===$('owner').value)&&(!$('kind').value||c.kind===$('kind').value)&&(!search||(/^#?\d+$/.test(search)?c.number===Number(search.replace('#','')):[cardReference(c.number),c.title,c.panel,c.notes,c.acceptance,c.results].join(' ').toLowerCase().includes(search)))).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
        const tab=node('button',`${title} (${cards.length})`);tab.type='button';tab.setAttribute('aria-pressed',key===currentLane);tab.addEventListener('click',()=>{currentLane=key;render();$('lane-tabs').querySelector(`[data-key="${key}"]`).focus();});tab.dataset.key=key;$('lane-tabs').append(tab);
        const lane=document.createElement('section');lane.className='lane'+(key===currentLane?' current':'');lane.dataset.lane=key;
        const heading=node('h2',title);heading.append(node('small',cards.length));lane.append(heading);
        lane.addEventListener('dragover',e=>{e.preventDefault();lane.classList.add('drag-over');});lane.addEventListener('dragleave',()=>lane.classList.remove('drag-over'));
        lane.addEventListener('drop',async e=>{e.preventDefault();lane.classList.remove('drag-over');const c=board.cards.find(c=>c.id===e.dataTransfer.getData('text/plain'));if(c){c.lane=key;currentLane=key;render();await save();}});
        for(const c of cards){
            const button=document.createElement('button');button.className='card';button.dataset.card=c.id;button.dataset.number=c.number;
            const handle=node('span','⠿','drag-handle');handle.draggable=true;handle.title='Drag to another column; use Status in card details with a keyboard';let dragging=false;
            const tags=document.createElement('div');tags.className='card-tags';tags.append(node('span',cardReference(c.number),'card-number'),node('span',typeNames[c.kind],'tag '+c.kind));if(c.priority==='high')tags.append(node('span','High priority','tag high'));
            const meta=document.createElement('div');meta.className='card-meta';meta.append(node('span',c.owner==='You'?'◉ You':'◉ Codex'));
            const due=node('time',date(c.due));if(c.due){due.dateTime=c.due;if(c.due<today&&c.lane!=='done')due.className='overdue';}meta.append(due);
            button.append(handle,tags,node('b',c.title),node('p',c.panel||c.notes),meta);
            button.addEventListener('click',()=>{if(!dragging)edit(c,button);});handle.addEventListener('dragstart',e=>{dragging=true;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',c.id);});handle.addEventListener('dragend',()=>setTimeout(()=>dragging=false,100));lane.append(button);
        }
        if(!cards.length)lane.append(node('p','No cards in this column.','empty'));$('board').append(lane);
    }
}
function renderMilestones(){
    $('milestones').replaceChildren();for(const m of seed.milestones||[]){const n=node('div',date(m.due),'milestone');n.append(node('b',m.title));$('milestones').append(n);}
    text($('storage-note'),local?'Saved on this computer. Reload picks up local edits. Download board to share results. Planning cards do not change framing.':'Unlisted URL · published plan, not an access-controlled page. Edits stay in this browser; Download board to share your results with Codex. Reload plan restores the published version. Planning cards do not change framing.');
}
async function load(reset=false){
    const response=await fetch('samples/framing-board.json',{cache:'no-store'});if(!response.ok)throw Error('Could not load the published plan.');seed=normalizeBoard(await response.json());
    if(local){
        const res=await fetch(API,{cache:'no-store'});if(!res.ok)throw Error('Could not load the local board.');const data=await res.json();
        board=data?.version?normalizeBoard(data,seed):structuredClone(seed);
        if(data?.version===1)for(const c of seed.cards)if(!board.cards.some(x=>x.id===c.id))board.cards.push(c);
        if(data?.version===2&&data.publishedSeed)board={...mergePublished(seed,board,normalizeBoard(data.publishedSeed,seed)),revision:data.revision};
        board=numberBoard(board,seed);
        board.publishedSeed=seed;
        text($('save-status'),`Local board · revision ${board.revision}`);
    }else{
        let cached=null;try{cached=JSON.parse(localStorage.getItem(CACHE)||'null');if(cached){cached.board=normalizeBoard(cached.board,seed);if(cached.seed)cached.seed=normalizeBoard(cached.seed,seed);}}catch{cached=null;}
        board=reset?structuredClone(seed):mergePublished(seed,cached?.board,cached?.seed);
        text($('save-status'),cached&&!reset?'Published plan · browser draft':'Published plan · edits save in this browser');
    }
    renderMilestones();render();
}
async function save(){
    const invalid=boardError(board);if(invalid)return text($('save-status'),invalid[1]);
    if(!local){try{localStorage.setItem(CACHE,JSON.stringify({seed,board}));text($('save-status'),'Saved in this browser · download to share');}catch{text($('save-status'),'Browser storage unavailable · download to keep your edits');}return;}
    pending=true;if(busy)return;busy=true;
    try{while(pending){pending=false;const snapshot=structuredClone(board);text($('save-status'),'Saving…');const response=await fetch(API,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});if(!response.ok){const err=await response.json();throw Error(err.error);}board.revision=snapshot.revision+1;text($('save-status'),`Local board · saved revision ${board.revision}`);}}
    catch(e){pending=false;text($('save-status'),e.message);}finally{busy=false;}
}
function edit(card,button){if(!board)return;opener=button||$('add');editing=card?.id||null;text($('card-reference'),card?`${cardReference(card.number)} · Card details`:'New card · number assigned on save');for(const key of fields)$('card-'+key).value=card?.[key]??({lane:'backlog',owner:'Codex',kind:'task',priority:'normal'}[key]||'');$('delete').hidden=!editing;$('editor').showModal();}
$('editor').querySelector('form').addEventListener('submit',e=>{
    if(e.submitter?.value!=='save')return;
    const c={id:editing||crypto.randomUUID()};if(editing)c.number=board.cards.find(x=>x.id===editing).number;for(const key of fields)c[key]=$('card-'+key).value;
    const next=numberBoard({...board,cards:editing?board.cards.map(x=>x.id===editing?c:x):[...board.cards,c]},seed),invalid=boardError(next);
    if(invalid){e.preventDefault();text($('save-status'),invalid[1]);return;}board=next;currentLane=c.lane;if(!editing)for(const id of ['search','owner','kind'])$(id).value='';render();save();
});
$('editor').addEventListener('close',()=>{const target=editing&&[...document.querySelectorAll('.card')].find(c=>c.dataset.card===editing);(target||opener)?.focus();});
$('delete').addEventListener('click',async()=>{board.cards=board.cards.filter(c=>c.id!==editing);$('editor').close('cancel');render();$('add').focus();await save();});
$('add').addEventListener('click',()=>edit());for(const id of ['search','owner','kind'])$(id).addEventListener(id==='search'?'input':'change',()=>{
    if(id==='search'&&board){const query=$('search').value.trim(),found=/^#?\d+$/.test(query)&&board.cards.find(c=>c.number===Number(query.replace('#','')));if(found){currentLane=found.lane;$('owner').value='';$('kind').value='';}}render();
});
$('reload').addEventListener('click',async()=>{if(busy)return text($('save-status'),'Wait for the current save to finish.');if(!local&&!confirm('Restore the published plan? Browser edits will be replaced. Download your board first to keep them.'))return;try{await load(true);if(!local){localStorage.removeItem(CACHE);}}catch(e){text($('save-status'),e.message);}});
$('download').addEventListener('click',()=>{if(!board)return;const url=URL.createObjectURL(new Blob([JSON.stringify(board,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='cas-framing-board.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);});
$('attach').addEventListener('click',async()=>{try{
    const set=JSON.parse(localStorage.getItem('cas-shopgen:set')||'null');if(!set?.panels?.length)return text($('save-status'),'No panel project in this browser.');
    board.cards.push({id:crypto.randomUUID(),lane:'backlog',title:'Current panel context',panel:set.project||'',owner:'Codex',kind:'task',priority:'normal',due:'',acceptance:'Review this browser draft before making framing changes.',results:'',evidence:'Panel Shop Generator browser draft',notes:set.panels.slice(0,100).map(p=>`${p.mark}: ${p.revit?.framingSettings?.template?.name||'no imported template'}; cutback ${p.cutbackIn??'default'} in; top gap ${p.deflectionGapIn??0} in; ${p.manual?'custom members':'automatic members'}`).join('\n').slice(0,8000)});board=numberBoard(board,seed);currentLane='backlog';render();await save();
}catch(e){text($('save-status'),e.message);}});
$('import').addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;const data=normalizeBoard(JSON.parse(await file.text()),seed);if(!confirm('Replace this board with the selected file? Download your current board first to keep a copy.'))return;board={...data,revision:board.revision};render();await save();}catch(err){text($('save-status'),err.message);}finally{e.target.value='';}});
load().catch(e=>text($('save-status'),e.message));
