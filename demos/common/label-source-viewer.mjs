import { renderPdfPage, renderPdfRegion } from './pdf-reader.mjs';
import { recognizeCutList } from './label-ocr.mjs';
import { textInWindow, panelNearWindow, panelEvidenceNearWindow, scheduleWindows, extendScheduleWindow } from './label-text.mjs';
import { rowsFromOcr } from './label-maker.mjs';

// Source coordinates stay in rendered pixels; zoom and scrolling never change the selected table.
export function selectionRect(a,b,width,height){
    const clamp=(n,max)=>Math.max(0,Math.min(max,n)),x1=clamp(a.x,width),y1=clamp(a.y,height),x2=clamp(b.x,width),y2=clamp(b.y,height);
    return {x:Math.min(x1,x2),y:Math.min(y1,y2),w:Math.abs(x2-x1),h:Math.abs(y2-y1)};
}
export class LabelSourceViewer {
    constructor({onExtract,onDismiss=()=>{}}){
        this.onExtract=onExtract;this.regions=[];this.page=1;this.pages=1;this.job=0;this.zoom=1;this.pan=false;this.loaded=false;
        document.body.insertAdjacentHTML('beforeend',`<dialog id="lm-source-viewer" class="lm-source-viewer" aria-labelledby="ls-title">
            <header><div><h2 id="ls-title">Select tables from your drawing</h2><span id="ls-file"></span></div><button id="ls-full" class="secondary">Full screen</button><button id="ls-close" class="secondary" aria-label="Close source viewer">Close</button></header>
            <div class="ls-toolbar"><div id="ls-pages"><button id="ls-prev" class="secondary" aria-label="Previous PDF page">◀</button><label>Page <input id="ls-page" type="number" min="1" value="1"></label><span id="ls-pages-count"></span><button id="ls-next" class="secondary" aria-label="Next PDF page">▶</button><button id="ls-show" class="secondary">Go</button></div>
                <button id="ls-minus" class="secondary" aria-label="Zoom out">−</button><span id="ls-zoom"></span><button id="ls-plus" class="secondary" aria-label="Zoom in">+</button><button id="ls-fit" class="secondary">Fit width</button><button id="ls-fit-page" class="secondary">Fit page</button><button id="ls-detect" class="secondary">Find panel schedules</button><button id="ls-pan" class="secondary" aria-pressed="false">Pan</button></div>
            <div class="ls-main"><div id="ls-scroll" tabindex="0" aria-label="Drawing viewer; scroll to inspect the drawing"><div id="ls-stage"><canvas id="ls-canvas" aria-label="Drag a window around the Mark and Qty columns"></canvas><div id="ls-boxes"></div></div></div>
                <aside><h3>Selected windows</h3><p>Drag around the <b>Mark and Qty columns</b>. Include custom items below the table. Draw another window for each separate table. Zoom in to read small text.</p><p>Selections stay when you change pages. They are read in the order shown.</p><div id="ls-regions"></div><button id="ls-whole" class="secondary">Select whole page</button><button id="ls-clear" class="link">Clear windows</button></aside></div>
            <footer><div><p id="ls-progress" role="status" aria-live="polite"></p><small>Extracted marks and quantities must be reviewed before adding labels.</small></div><button id="ls-cancel" class="secondary" hidden>Cancel extraction</button><button id="ls-done" disabled>Done — pull selected items</button></footer>
        </dialog>`);
        this.dialog=document.querySelector('#lm-source-viewer');this.$=s=>this.dialog.querySelector(s);this.canvas=this.$('#ls-canvas');
        const safe=fn=>async()=>{try{await fn();}catch(e){this.status(e.message);}};
        this.$('#ls-close').onclick=()=>{onDismiss();this.dialog.close();};this.dialog.addEventListener('cancel',()=>onDismiss());this.dialog.addEventListener('close',()=>{if(this.dialog.open)return;this.controller?.abort();++this.job;});
        this.$('#ls-full').onclick=()=>{const full=this.dialog.classList.toggle('ls-fullscreen');this.$('#ls-full').textContent=full?'Window size':'Full screen';requestAnimationFrame(()=>this.fit(false));};
        this.$('#ls-prev').onclick=safe(()=>this.showPage(this.page-1));this.$('#ls-next').onclick=safe(()=>this.showPage(this.page+1));this.$('#ls-show').onclick=safe(()=>this.showPage(Number(this.$('#ls-page').value)));
        this.$('#ls-page').onkeydown=e=>{if(e.key==='Enter')this.$('#ls-show').click();};
        this.$('#ls-minus').onclick=()=>this.setZoom(this.zoom/1.25);this.$('#ls-plus').onclick=()=>this.setZoom(this.zoom*1.25);
        this.$('#ls-detect').onclick=()=>this.detect();
        this.$('#ls-fit').onclick=()=>this.fit(false);this.$('#ls-fit-page').onclick=()=>this.fit(true);
        this.$('#ls-pan').onclick=()=>{this.pan=!this.pan;this.$('#ls-pan').setAttribute('aria-pressed',String(this.pan));this.canvas.style.cursor=this.pan?'grab':'crosshair';};
        this.$('#ls-clear').onclick=()=>{this.regions=[];this.paint();};this.$('#ls-whole').onclick=()=>this.add({x:0,y:0,w:this.canvas.width,h:this.canvas.height});
        this.$('#ls-regions').onclick=e=>{const b=e.target.closest('[data-remove]');if(b){this.regions.splice(Number(b.dataset.remove),1);this.paint();}};
        this.$('#ls-done').onclick=()=>this.extract();this.$('#ls-cancel').onclick=()=>this.controller?.abort();
        this.canvas.onpointerdown=e=>{if(this.busy||this.loading)return;this.start=this.point(e);this.drag={x:e.clientX,y:e.clientY,left:this.$('#ls-scroll').scrollLeft,top:this.$('#ls-scroll').scrollTop};this.canvas.setPointerCapture(e.pointerId);};
        this.canvas.onpointermove=e=>{if(!this.start)return;if(this.pan){this.$('#ls-scroll').scrollLeft=this.drag.left+this.drag.x-e.clientX;this.$('#ls-scroll').scrollTop=this.drag.top+this.drag.y-e.clientY;}else{this.draft=selectionRect(this.start,this.point(e),this.canvas.width,this.canvas.height);this.boxes();}};
        this.canvas.onpointerup=()=>{if(this.draft&&!this.pan)this.add(this.draft);this.start=this.draft=null;this.boxes();};
        this.canvas.onpointercancel=()=>{this.start=this.draft=null;this.boxes();};
        this.$('#ls-scroll').addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();this.setZoom(this.zoom*(e.deltaY<0?1.1:1/1.1));}},{passive:false});
    }
    status(text){this.$('#ls-progress').textContent=text;}
    async open(file){
        if(!file)return;if(file.size>30*1024*1024)throw new Error('Use an image or PDF smaller than 30 MB.');
        this.controller?.abort();const job=++this.job;this.regions=[];this.bytes=null;this.page=this.pages=1;this.draft=this.start=null;this.loading=true;this.busy=false;this.loaded=false;this.canvas.width=this.canvas.height=0;this.paint();
        this.fileName=file.name||'Pasted screenshot';this.$('#ls-file').textContent=(this.batchPosition?`File ${this.batchPosition.index} of ${this.batchPosition.total} - `:'')+this.fileName;this.dialog.showModal();this.status('Loading drawing…');
        try{
            if(/\.pdf$/i.test(file.name)||file.type==='application/pdf'){
                this.bytes=new Uint8Array(await file.arrayBuffer());if(job!==this.job)return;await this.showPage(1,job);
            }else{const image=await createImageBitmap(file);try{if(job!==this.job)return;const s=Math.min(1,4000/Math.max(image.width,image.height));this.canvas.width=Math.round(image.width*s);this.canvas.height=Math.round(image.height*s);this.canvas.getContext('2d').drawImage(image,0,0,this.canvas.width,this.canvas.height);}finally{image.close();}}
            if(job!==this.job)return;this.$('#ls-pages').hidden=!this.bytes;this.loading=false;this.loaded=true;this.fit(false);this.paint();this.status('Zoom in, then drag a window around each table you need.');if(this.bytes)this.detect();
        }catch(e){if(job===this.job){this.loading=false;this.status('Could not open drawing: '+e.message);this.paint();}}
    }
    async showPage(number,job=++this.job){
        if(!this.bytes||this.busy)return;this.loading=true;this.paint();this.status('Drawing PDF page…');
        try{const canvas=document.createElement('canvas'),info=await renderPdfPage(this.bytes,Math.min(this.pages===1&&number===1?1:this.pages,Math.max(1,number||1)),canvas,{scale:2,maxPixels:12000000,includeText:true});
            if(job!==this.job)return;this.canvas.width=canvas.width;this.canvas.height=canvas.height;this.canvas.getContext('2d').drawImage(canvas,0,0);
            this.items=info.items;this.pages=info.pages;this.page=Math.min(info.pages,Math.max(1,number||1));this.$('#ls-page').value=this.page;this.$('#ls-page').max=info.pages;this.$('#ls-pages-count').textContent='of '+info.pages;
            this.loading=false;this.fit(false);this.paint();this.status('Drag windows around the Mark and Qty columns.');
        }catch(e){if(job===this.job){this.loading=false;this.paint();throw e;}}
    }
    point(e){const b=this.canvas.getBoundingClientRect();return {x:(e.clientX-b.left)*this.canvas.width/b.width,y:(e.clientY-b.top)*this.canvas.height/b.height};}
    fit(page){const s=this.$('#ls-scroll');this.setZoom(Math.min((s.clientWidth-40)/this.canvas.width,page?(s.clientHeight-40)/this.canvas.height:4));s.scrollTo(0,0);}
    setZoom(value){const old=this.zoom,s=this.$('#ls-scroll'),cx=s.scrollLeft+s.clientWidth/2-20,cy=s.scrollTop+s.clientHeight/2-20;this.zoom=Math.max(.05,Math.min(4,value||1));this.$('#ls-stage').style.width=this.canvas.width*this.zoom+'px';this.canvas.style.width=this.canvas.width*this.zoom+'px';this.canvas.style.height=this.canvas.height*this.zoom+'px';this.$('#ls-zoom').textContent=Math.round(this.zoom*100)+'%';this.boxes();s.scrollLeft=cx*this.zoom/old-s.clientWidth/2+20;s.scrollTop=cy*this.zoom/old-s.clientHeight/2+20;}
    detect(){if(this.loading||this.busy)return;const found=scheduleWindows(this.items||[],this.canvas.width,this.canvas.height);if(!found.length){this.status('No text-based schedules detected. Draw a window around your schedule.');return;}this.regions=this.regions.filter(r=>r.page!==this.page);for(const s of found)this.add(s.rect,s.panel);this.status(`${found.length} panel schedules found. Select Done to review them.`);}
    add(rect,panel=''){if(this.bytes)rect=extendScheduleWindow(this.items||[],rect,this.canvas.height);if(this.busy||this.loading||rect.w<12||rect.h<12)return;if(this.regions.length>=20){this.status('Use at most 20 windows per extraction.');return;}
        const canvas=document.createElement('canvas'),scale=Math.min(2,3000/Math.max(rect.w,rect.h));canvas.width=Math.round(rect.w*scale);canvas.height=Math.round(rect.h*scale);canvas.getContext('2d').drawImage(this.canvas,rect.x,rect.y,rect.w,rect.h,0,0,canvas.width,canvas.height);
        const evidence=panelEvidenceNearWindow(this.items||[],rect,this.fileName);
        this.regions.push({panel:panel||evidence.panel,panelOrigin:`${evidence.origin} · ${this.fileName} · page ${this.page}`,rect,page:this.page,canvas,text:this.bytes?textInWindow(this.items||[],rect):'',normalized:{x:rect.x/this.canvas.width,y:rect.y/this.canvas.height,w:rect.w/this.canvas.width,h:rect.h/this.canvas.height}});this.paint();this.status(`${this.regions.length} window(s) ready. Add another or select Done.`);
    }
    boxes(){const all=this.regions.map((r,i)=>({...r,n:i+1})).filter(r=>r.page===this.page);if(this.draft)all.push({rect:this.draft,n:'New'});
        this.$('#ls-boxes').innerHTML=all.map(({rect:r,n})=>`<div class="ls-box" style="left:${r.x*this.zoom}px;top:${r.y*this.zoom}px;width:${r.w*this.zoom}px;height:${r.h*this.zoom}px"><span>${n}</span></div>`).join('');
    }
    paint(){this.boxes();this.$('#ls-regions').innerHTML=this.regions.length?this.regions.map((r,i)=>`<div class="ls-region"><canvas data-thumb="${i}"></canvas><span>Window ${i+1}<small>Page ${r.page}</small></span><button class="secondary" data-remove="${i}" aria-label="Remove window ${i+1}" ${this.busy?'disabled':''}>×</button></div>`).join(''):'<p class="muted">No windows selected yet.</p>';
        this.$('#ls-regions').querySelectorAll('canvas').forEach(c=>{const source=this.regions[Number(c.dataset.thumb)].canvas;c.width=100;c.height=Math.max(20,Math.min(80,100*source.height/source.width));c.getContext('2d').drawImage(source,0,0,c.width,c.height);});
        this.$('#ls-done').disabled=this.loading||this.busy||!this.regions.length;this.$('#ls-done').textContent=this.busy?'Pulling items...':`${this.batchPosition&&this.batchPosition.index<this.batchPosition.total?'Done - next file':'Done - load labels'}${this.regions.length?' ('+this.regions.length+' windows)':''}`;
        for(const id of ['ls-clear','ls-whole','ls-prev','ls-next','ls-show'])this.$('#'+id).disabled=this.loading||this.busy;
        this.$('#ls-cancel').hidden=!this.busy;
    }
    async extract(){
        if(this.busy||!this.regions.length)return;const control=new AbortController();this.controller=control;const job=this.job;this.busy=true;this.paint();const texts=[],issues=[],methods=[],groups=[];
        try{for(let i=0;i<this.regions.length;i++){const r=this.regions[i];if(rowsFromOcr(r.text).rows.length){this.status(`Window ${i+1}: reading original PDF text (no OCR)…`);texts.push(r.text);methods.push('PDF text');}else{
                this.status(`Window ${i+1}: preparing high-resolution image…`);const canvas=this.bytes?await renderPdfRegion(this.bytes,r.page,r.normalized):r.canvas;
                if(control.signal.aborted)throw new DOMException('Extraction cancelled','AbortError');
                texts.push(await recognizeCutList(canvas,{signal:control.signal,progress:s=>{if(!control.signal.aborted)this.status(`Window ${i+1}/${this.regions.length}: ${s}`);}}));methods.push('OCR');}
                const readText=texts[texts.length-1];groups.push({text:readText,panel:r.panel,panelOrigin:r.panelOrigin,preview:r.canvas.toDataURL('image/png'),page:r.page,method:methods.at(-1),source:this.fileName});const count=rowsFromOcr(readText).rows.length;if(!count)issues.push(`Window ${i+1}, page ${r.page}: no Mark + Qty rows were found. Check this window against the source.`);
                await new Promise(resolve=>setTimeout(resolve,0));}
            if(control.signal.aborted||job!==this.job)return;if(!texts.some(t=>rowsFromOcr(t).rows.length))throw new Error('No member rows found. Select both Mark and Qty columns, including their headings, and try again. You can also paste the table.');
            this.onExtract(texts.join('\n'),{issues,methods,groups});this.dialog.close();
        }catch(e){if(this.dialog.open)this.status(e.name==='AbortError'?'Extraction cancelled. Your windows are still selected.':e.message);}
        finally{if(this.controller===control){this.controller=null;this.busy=false;this.paint();}}
    }
}
