import * as E from './demos/06-shop-drawings/sketch-editing.mjs';
import * as G from './demos/06-shop-drawings/generator.mjs';
import { DIMENSION_FORMATS } from './demos/common/edit-dimensions.mjs';
export class WallSketchControls{
    constructor({root,current,layout,change,notice,format,parse,perimeter,redraw,selectMember,dimensionFormat=()=> 'feet-inches'}){
        Object.assign(this,{root,current,layout,change,notice,format,parse,perimeter,redraw,selectMember,dimensionFormat});
        try{this.unit=localStorage.getItem('cas-shopgen:slope-unit')==='degrees'?'degrees':'rise';}catch{this.unit='rise';}
        this.hold='left';
        this.dialog=document.createElement('dialog');this.dialog.id='wall-sketch-dimension';this.dialog.className='sketch-dimension-dialog';root.append(this.dialog);
        root.addEventListener('click',e=>{
            const dim=e.target.closest('[data-sketch-dim]'),pin=e.target.closest('[data-sketch-pin]');
            if(dim){e.preventDefault();this.open(JSON.parse(dim.dataset.sketchDim));}
            if(pin){e.preventDefault();this.toggle(pin.dataset.sketchPin);}
        });
        root.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.matches('[data-sketch-dim],[data-sketch-pin]')){e.preventDefault();e.stopPropagation();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
        root.addEventListener('change',e=>{
            const t=e.target;
            if(t.id==='wall-slope-unit'){this.unit=t.value;try{localStorage.setItem('cas-shopgen:slope-unit',this.unit);}catch{}this.render();}
            if(t.id==='wall-slope-hold')this.hold=t.value;
            if(t.dataset.wallSlope){const [edge,index]=t.dataset.wallSlope.split(':');this.run(()=>this.change(E.setSlope(this.current(),edge,Number(index),t.value.trim()===''?NaN:Number(t.value),this.unit,this.hold),'the '+edge+' slope'));this.render();}
        });
        this.dialog.addEventListener('submit',e=>{e.preventDefault();if(e.submitter?.value==='cancel'){this.close();return;}this.apply();});
        this.dialog.addEventListener('close',()=>{this.active=null;});
        this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(root.querySelector('.views'));this.observer.observe(root.querySelector('#wall-sketch-constraints'));
    }
    esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
    run(fn){try{fn();return true;}catch(e){this.notice(e.message,true);return false;}}
    resize(){const svg=this.root.querySelector('#sketch svg'),views=this.root.querySelector('.views'),wrap=this.root.querySelector('.sketch-wrap');if(!svg||!views||!wrap)return;
        if(getComputedStyle(views).overflowY==='visible'){svg.style.height='';return;}
        const top=wrap.getBoundingClientRect().top-views.getBoundingClientRect().top+views.scrollTop;
        svg.style.height=Math.max(240,Math.min(500,views.clientHeight-top-42))+'px';
    }
    render(){
        const host=this.root.querySelector('#wall-sketch-constraints'),p=this.current();if(!host)return;if(!p){host.innerHTML='';return;}
        const locked=!G.canEdit(p,'shape')||!!this.perimeter(),disabled=locked?'disabled':'',pts=E.topPoints(p.shape),bottom=G.shapeBottom(p.shape)||[[0,0],[p.shape.lengthIn,0]];
        const row=(edge,i,a,b)=>`<label class="wall-slope-row"><b>${edge==='top'?'Top'+(pts.length>2?' '+(i+1):''):'Bottom'}</b><input data-wall-slope="${edge}:${i}" type="number" step="any" value="${Number(E.slopeValue(p.shape,edge,i,this.unit).toFixed(5))}" aria-label="${edge} slope ${i+1}" ${disabled}><span>${this.unit==='degrees'?'°':'in / 12 in'}</span><small>${this.format(a[1])} → ${this.format(b[1])}</small></label>`;
        host.innerHTML=`<div class="wall-sketch-pinbar"><b>Lock line</b>${['left','right','top','bottom'].map(k=>`<button type="button" class="secondary small ${E.pinned(p,k)?'on':''}" data-sketch-pin="${k}" aria-pressed="${E.pinned(p,k)}" ${disabled}>${E.pinned(p,k)?'🔒':'○'} ${k[0].toUpperCase()+k.slice(1)}</button>`).join('')}<span class="muted small">Click a dimension to move the unlocked side.</span></div><div class="wall-slope-options"><label>Slope units <select id="wall-slope-unit"><option value="rise" ${this.unit==='rise'?'selected':''}>Rise / 12-inch run</option><option value="degrees" ${this.unit==='degrees'?'selected':''}>Degrees</option></select></label><label>Hold end <select id="wall-slope-hold"><option value="left" ${this.hold==='left'?'selected':''}>Left</option><option value="right" ${this.hold==='right'?'selected':''}>Right</option></select></label><span class="muted small">+ rises to the right · end elevations: left → right</span></div><div class="wall-slope-fields">${pts.slice(1).map((b,i)=>row('top',i,pts[i],b)).join('')}${row('bottom',0,...bottom)}</div>`;
    }
    toggle(key){
        if(key.startsWith('segment:')){const s=this.perimeter(),i=Number(key.slice(8));if(!s)return;const pins=new Set(s.locks||[]);pins.has(i)?pins.delete(i):pins.add(i);s.locks=[...pins];this.redraw();return;}
        if(!key.startsWith('member:')&&!G.canEdit(this.current(),'shape')){this.notice('The model owns the wall perimeter.',true);return;}
        this.change(E.togglePin(this.current(),key),'the sketch line lock');this.render();
    }
    open(meta){
        this.active={...meta,panelId:this.current()?.id};
        const esc=v=>this.esc(v),s=meta.kind==='segment',member=meta.kind==='gap',holds=s?[['start','Start'],['end','End']]:meta.kind==='width'?[['left','Left'],['right','Right']]:[['bottom','Bottom'],['top','Top']];
        const p=this.current();let hold=meta.hold||holds[0][0];if(!s&&!member){if(meta.kind==='width')hold=E.pinned(p,'right')?'right':E.pinned(p,'left')?'left':hold;else hold=E.pinned(p,'top')?'top':E.pinned(p,'bottom')?'bottom':hold;}
        this.dialog.innerHTML=`<form><h2>${s?'Sketch line length':member?'Member spacing':meta.kind==='width'?'Panel width':'Panel end height'}</h2><label class="dimension-format">Format<select data-dimension-format aria-label="Dimension format">${DIMENSION_FORMATS.map(([key,label])=>`<option value="${key}" ${this.dimensionFormat()===key?'selected':''}>${label}</option>`).join('')}</select></label><label>Dimension<input id="wall-dimension-value" value="${esc(this.format(meta.value))}" autocomplete="off"></label>${member?'<p class="muted small">Center to center. A locked reference stays fixed; the other member moves.</p>':`<label>Hold <select id="wall-dimension-hold">${holds.map(([k,label])=>`<option value="${k}" ${hold===k?'selected':''}>${label}</option>`).join('')}</select></label><p class="muted small">Locked lines take priority. Unlock one side if both are held.</p>`}<p class="muted small" data-dimension-help></p><p id="wall-dimension-error" role="alert"></p><footer><button value="cancel" type="submit" class="secondary">Cancel</button><button value="apply" type="submit">Apply</button></footer></form>`;
        this.dimensionValue=meta.value;this.dimensionText=this.format(meta.value);this.syncDimensionHelp();
        this.dialog.showModal();const input=this.dialog.querySelector('input');input.focus();input.select();
    }
    apply(){
        const m=this.active,p=this.current(),value=this.readDimension(),hold=this.dialog.querySelector('#wall-dimension-hold')?.value;
        try{
            if(p?.id!==m.panelId)throw Error('The open panel changed. Select the dimension again.');
            if(m.kind==='segment'){const s=this.perimeter();if(!s)throw Error('This sketch is no longer active.');s.pts=E.segmentLength(s.pts,m.index,value,s.locks||[],hold);s.cursor=null;this.redraw();}
            else if(m.kind==='gap'){const r=E.memberGap(p,this.layout(),m.left,m.right,value,m.prefer);this.change(r.panel,'the member spacing');this.selectMember(r.key);}
            else this.change(E.panelDimension(p,m.kind,value,hold),'the sketch dimension');
            this.close();
        }catch(e){this.dialog.querySelector('#wall-dimension-error').textContent=e.message;}
    }
    readDimension(){const text=this.dialog.querySelector('#wall-dimension-value')?.value;return text===this.dimensionText?this.dimensionValue:this.parse(text);}
    syncDimensionHelp(){const help=this.dialog.querySelector('[data-dimension-help]');if(help)help.textContent=this.dimensionFormat()==='decimal-feet'?'Bare numbers are feet. Add ″ to enter inches.':'Bare numbers are inches. Add ′ to enter feet.';}
    syncDimensionFormat(value){
        for(const el of this.root.querySelectorAll('[data-dimension-format]'))el.value=this.dimensionFormat();
        if(this.dialog.open&&Number.isFinite(value)){this.dimensionValue=value;this.dimensionText=this.format(value);this.dialog.querySelector('#wall-dimension-value').value=this.dimensionText;this.syncDimensionHelp();}
    }
    close(){this.dialog.close();this.active=null;}
}
