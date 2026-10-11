// Optional browser OCR, downloaded only after Extract Table. Pixels are processed in a local Web Worker;
// no document/image upload endpoint. Runtime and English model need a connection on first use.
// https://github.com/naptha/tesseract.js/blob/master/docs/api.md
const BASE='https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/';
let library;
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
            logger:m=>progress(m.status+(m.progress!=null?` ${Math.round(m.progress*100)}%`:''))});
        abort();await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'});
        const {data}=await worker.recognize(canvas);abort();return data.text;
    } catch(err){abort();throw err;}
    finally{signal?.removeEventListener('abort',stop);await worker?.terminate();}
}
