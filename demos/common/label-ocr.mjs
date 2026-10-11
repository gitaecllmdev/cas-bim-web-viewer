// Optional browser OCR, downloaded only after Extract Table. Pixels are processed in a local Web Worker;
// no document/image upload endpoint. Runtime and English model need a connection on first use.
// https://github.com/naptha/tesseract.js/blob/master/docs/api.md
const BASE='https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/';
import { rowsFromOcr } from './label-maker.mjs';
let library;

// Give small lettering room to resolve and remove long table rules before recognition.
export function prepareTableImage(source){
    const canvas=document.createElement('canvas'),s=Math.min(2,3200/Math.max(source.width,source.height)),pad=24;
    canvas.width=Math.round(source.width*s)+pad*2;canvas.height=Math.round(source.height*s)+pad*2;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,pad,pad,canvas.width-pad*2,canvas.height-pad*2);
    const data=ctx.getImageData(0,0,canvas.width,canvas.height),a=data.data,w=canvas.width,h=canvas.height;
    const dark=(x,y)=>a[(y*w+x)*4]*.299+a[(y*w+x)*4+1]*.587+a[(y*w+x)*4+2]*.114<185;
    const rules=[];
    for(let y=pad;y<h-pad;y++){let run=0;for(let x=pad;x<=w-pad;x++){if(x<w-pad&&dark(x,y))run++;else{if(run>=Math.max(100,(w-pad*2)*.55))rules.push({x:x-run,y,w:run,h:1});run=0;}}}
    for(let x=pad;x<w-pad;x++){let run=0;for(let y=pad;y<=h-pad;y++){if(y<h-pad&&dark(x,y))run++;else{if(run>=Math.max(150,(h-pad*2)*.55))rules.push({x,y:y-run,w:1,h:run});run=0;}}}
    ctx.fillStyle='white';for(const r of rules)ctx.fillRect(r.x-1,r.y-1,r.w+2,r.h+2);return canvas;
}
export function loadOcr() {
    if(globalThis.Tesseract)return Promise.resolve(globalThis.Tesseract);
    library ||= new Promise((resolve,reject)=>{
        const s=document.createElement('script');s.src=BASE+'tesseract.min.js';s.crossOrigin='anonymous';
        s.onload=()=>resolve(globalThis.Tesseract);s.onerror=()=>{s.remove();library=null;reject(new Error('OCR could not load. Check your connection to jsDelivr, or paste/import the table instead.'));};
        document.head.append(s);
    });return library;
}
export async function recognizeCutList(canvas,{progress=()=>{},signal}={}) {
    const abort=()=>{if(signal?.aborted)throw new DOMException('Extraction cancelled','AbortError');};
    abort();progress('Loading image reader...');const T=await loadOcr();abort();
    let worker;
    const stop=()=>{worker?.terminate().catch(()=>{});};
    signal?.addEventListener('abort',stop,{once:true});
    try {
        worker=await T.createWorker('eng',1,{workerPath:BASE+'worker.min.js',
            corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
            logger:m=>progress(m.status+(m.progress!=null?` ${Math.round(m.progress*100)}%`:''))},{load_system_dawg:'0',load_freq_dawg:'0'});
        abort();const image=prepareTableImage(canvas),results=[];
        // Sparse text reads ruled/spaced CAD tables better; a block pass is a fallback, never a guessed merge.
        for(const mode of ['11','6']){
            await worker.setParameters({tessedit_pageseg_mode:mode,preserve_interword_spaces:'1',user_defined_dpi:'300'});
            const {data}=await worker.recognize(image,{}, {text:true,blocks:true});abort();
            const words=(data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>(p.lines||[]).flatMap(l=>l.words||[])));
            const lines=[];for(const word of words.sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0)){
                const y=(word.bbox.y0+word.bbox.y1)/2,h=word.bbox.y1-word.bbox.y0;let line=lines.find(l=>Math.abs(l.y-y)<=Math.max(4,Math.min(h,l.h)*.55));
                if(!line){line={y,h,words:[]};lines.push(line);}line.words.push(word);
            }
            const text=lines.length?lines.sort((a,b)=>a.y-b.y).map(l=>l.words.sort((a,b)=>a.bbox.x0-b.bbox.x0).map(w=>w.text).join(' ')).join('\n'):data.text;
            results.push({text,lines,rows:rowsFromOcr(text).rows.length,confidence:data.confidence||0});
        }
        results.sort((a,b)=>b.rows-a.rows||b.confidence-a.confidence);const best=results[0],reviews=[];
        // C/T framing marks commonly end in digits. Re-read ambiguous suffix pixels with a digit model;
        // never replace characters by a lookup table. Expose each proposed change for mandatory review.
        for(const line of best.lines){const first=line.words[0],next=line.words[1];if(!first||!/^[CT][OoIiLl]$/.test(first.text)||!/^\d+$/.test(next?.text||''))continue;
            const b=first.bbox,left=Math.floor((b.x0+b.x1)/2)-2,top=Math.max(0,b.y0-6);
            await worker.setParameters({tessedit_pageseg_mode:'10',tessedit_char_whitelist:'0123456789'});
            const result=await worker.recognize(image,{rectangle:{left,top,width:Math.min(image.width-left,Math.ceil((b.x1-b.x0)/2)+8),height:Math.min(image.height-top,b.y1-b.y0+12)}});abort();
            const digit=result.data.text.trim();if(/^[01]$/.test(digit)&&result.data.confidence>=60){const old=first.text;first.text=old[0]+digit;reviews.push(`Review numeric suffix: ${old} -> ${first.text} (digit OCR re-read; compare with source).`);}
        }
        return best.lines.length?[...best.lines.sort((a,b)=>a.y-b.y).map(l=>l.words.map(w=>w.text).join(' ')),...reviews].join('\n'):best.text;
    } catch(err){abort();throw err;}
    finally{signal?.removeEventListener('abort',stop);await worker?.terminate();}
}
