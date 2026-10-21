// Mozilla PDF.js, loaded only for PDF imports. File bytes stay in this browser.
// https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html#getDocument
// https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html#getTextContent
import { tableFromPages } from './p6-pdf.mjs';
export const PDFJS_VERSION = '6.3.289';
const base = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`;
let library;
export async function readSchedulePdf(file, { signal, onProgress = () => {} } = {}) {
    if (file.size > 100 * 1024 * 1024) throw new Error('PDF exceeds the 100 MB browser limit. Export a smaller P6 layout.');
    const abort = () => { if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError'); };
    abort(); onProgress('Loading PDF reader…');
    library ||= import(`${base}build/pdf.min.mjs`).catch(err => { library = null; throw new Error(`PDF reader could not load. Check your connection to jsDelivr. ${err.message}`); });
    const pdfjs = await library; abort();
    pdfjs.GlobalWorkerOptions.workerSrc = `${base}build/pdf.worker.min.mjs`;
    const data = new Uint8Array(await file.arrayBuffer()); abort();
    const task = pdfjs.getDocument({ data, isEvalSupported: false, cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/` });
    const cancel = () => { task.destroy().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
        const pdf = await task.promise, pages = [];
        if (pdf.numPages > 500) throw new Error('PDF exceeds 500 pages. Export a filtered layout from P6.');
        for (let n = 1; n <= pdf.numPages; n++) {
            abort(); onProgress(`Reading page ${n} of ${pdf.numPages}…`, n, pdf.numPages);
            const page = await pdf.getPage(n), viewport = page.getViewport({ scale: 1 });
            const content = await page.getTextContent();
            const items = content.items.filter(i => i.str?.trim()).map(i => {
                const t = pdfjs.Util.transform(viewport.transform, i.transform);
                const h = i.height || Math.hypot(t[2], t[3]);
                return { str: i.str, x: t[4], y: t[5] - h * .4, w: i.width, h, bold: /bold/i.test(content.styles[i.fontName]?.fontFamily || '') };
            });
            pages.push({ number: n, width: viewport.width, height: viewport.height, items });
            page.cleanup();
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        abort(); onProgress('Rebuilding schedule rows…');
        return tableFromPages(pages, { file: file.name });
    } catch (err) {
        abort();
        if (err.name === 'PasswordException') throw new Error('This PDF is password protected. Export an unlocked copy from P6.');
        throw err;
    } finally { signal?.removeEventListener('abort', cancel); await task.destroy(); }
}


// One local read and one PDF.js document per source-viewer session. No upload.
// https://developer.mozilla.org/en-US/docs/Web/API/FileReader/progress_event
export async function openPdfSource(file, { signal, onProgress = () => {} } = {}) {
    const abort = () => { if (signal?.aborted) throw new DOMException('Loading cancelled', 'AbortError'); };
    abort();
    onProgress('Reading file', 0, file.size);
    const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(), cancel = () => reader.abort();
        const finish = (fn, value) => { signal?.removeEventListener('abort', cancel); fn(value); };
        reader.onprogress = e => onProgress('Reading file', e.loaded, file.size);
        reader.onload = () => finish(resolve, new Uint8Array(reader.result));
        reader.onerror = () => finish(reject, reader.error || new Error('Could not read the file.'));
        reader.onabort = () => finish(reject, new DOMException('Loading cancelled', 'AbortError'));
        signal?.addEventListener('abort', cancel, { once: true });
        reader.readAsArrayBuffer(file);
    });
    abort(); onProgress('Loading PDF reader');
    library ||= import(`${base}build/pdf.min.mjs`).catch(err => { library = null; throw new Error(`PDF reader could not load. Check your connection to jsDelivr. ${err.message}`); });
    const pdfjs = await library;
    abort(); onProgress('Opening PDF');
    pdfjs.GlobalWorkerOptions.workerSrc = `${base}build/pdf.worker.min.mjs`;
    // Transfer the read buffer to the worker once, instead of copying 100 MB for each preview.
    const task = pdfjs.getDocument({ data, isEvalSupported: false, cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/` });
    let destroyed;
    const destroy = () => { signal?.removeEventListener('abort', destroy); return destroyed ||= task.destroy().catch(() => {}); };
    signal?.addEventListener('abort', destroy, { once: true });
    try { const document = await task.promise; abort(); return { document, destroy }; }
    catch (error) { await destroy(); abort(); throw error; }
}

// Yield between PDF.js drawing chunks so progress, page choice and Close stay responsive.
// https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-RenderTask.html
async function drawPdf(page, options, signal) {
    if (signal?.aborted) throw new DOMException('Preview cancelled', 'AbortError');
    const render = page.render(options), cancel = () => render.cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    render.onContinue = resume => setTimeout(() => { if (!signal?.aborted) resume(); }, 0);
    try { await render.promise; }
    finally { signal?.removeEventListener('abort', cancel); }
}

// One page of a PDF drawn on a canvas, for showing the source of an imported schedule (Demo 3): bytes (Uint8Array),
// the page number (1-based), the canvas, and the scale (1 = PDF points). Returns { pages, width, height } in points.
// PDFPageProxy.render: https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html#render
export async function renderPdfPage(bytes, number, canvas, { scale = 1.5, maxPixels = Infinity, includeText = false, signal } = {}) {
    library ||= import(`${base}build/pdf.min.mjs`).catch(err => { library = null; throw new Error(`PDF reader could not load. Check your connection to jsDelivr. ${err.message}`); });
    const pdfjs = await library;
    pdfjs.GlobalWorkerOptions.workerSrc = `${base}build/pdf.worker.min.mjs`;
    const task = bytes.document ? null : pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/` });
    try {
        const pdf = bytes.document || await task.promise, page = await pdf.getPage(Math.min(Math.max(1, number), pdf.numPages));
        const at1 = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: Math.min(scale, Math.sqrt(maxPixels / (at1.width * at1.height))) });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await drawPdf(page, { canvasContext: canvas.getContext('2d'), viewport }, signal);
        let items=[];
        if(includeText){const content=await page.getTextContent();items=content.items.filter(i=>i.str?.trim()).map(i=>{
            const t=pdfjs.Util.transform(viewport.transform,i.transform);
            return {str:i.str,x:t[4],y:t[5],w:i.width*viewport.scale,h:Math.hypot(t[2],t[3])};
        });}
        page.cleanup();
        return { pages: pdf.numPages, width: at1.width, height: at1.height, items };
    } finally { if (task) await task.destroy(); }
}

// Bounded thumbnail batches; no text extraction or OCR. Single-page PDFs skip thumbnails.
// PDFDocumentLoadingTask.destroy: https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentLoadingTask.html#destroy
export async function renderPdfThumbnails(bytes, { maxPixels = 24000, start = 1, limit = 12, onDocument = () => {}, onPage = () => {}, signal } = {}) {
    const abort = () => { if (signal?.aborted) throw new DOMException('Preview cancelled', 'AbortError'); };
    abort();
    library ||= import(`${base}build/pdf.min.mjs`).catch(err => { library = null; throw new Error(`PDF reader could not load. Check your connection to jsDelivr. ${err.message}`); });
    const pdfjs = await library;
    abort();
    pdfjs.GlobalWorkerOptions.workerSrc = `${base}build/pdf.worker.min.mjs`;
    const task = bytes.document ? null : pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/` });
    let destroyed;
    const destroy = () => destroyed ||= task?.destroy().catch(() => {});
    signal?.addEventListener('abort', destroy, { once: true });
    try {
        const pdf = bytes.document || await task.promise;
        abort();
        const first = Math.min(pdf.numPages, Math.max(1, Math.trunc(start) || 1));
        const last = Math.min(pdf.numPages, first + Math.min(12, Math.max(1, Math.trunc(limit) || 12)) - 1);
        onDocument(pdf.numPages, first, last);
        if (pdf.numPages === 1) return 1;
        abort();
        for (let n = first; n <= last; n++) {
            const page = await pdf.getPage(n), at1 = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: Math.sqrt(maxPixels / (at1.width * at1.height)) });
            abort();
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(viewport.width)); canvas.height = Math.max(1, Math.round(viewport.height));
            await drawPdf(page, { canvasContext: canvas.getContext('2d'), viewport, background: 'white' }, signal);
            abort();
            onPage(n, canvas, pdf.numPages);
            page.cleanup();
        }
        return pdf.numPages;
    } catch (error) { abort(); throw error; }
    finally { signal?.removeEventListener('abort', destroy); await destroy(); }
}

// Render only a selected window at reading resolution; avoid allocating a full large-format page at 300 DPI.
export async function renderPdfRegion(bytes,number,rect,{scale=4,maxPixels=8000000,signal}={}){
    library ||= import(`${base}build/pdf.min.mjs`);const pdfjs=await library;
    pdfjs.GlobalWorkerOptions.workerSrc=`${base}build/pdf.worker.min.mjs`;
    const task=bytes.document?null:pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false,standardFontDataUrl:`${base}standard_fonts/`});
    try{const pdf=bytes.document||await task.promise,page=await pdf.getPage(number),at1=page.getViewport({scale:1});
        const s=Math.min(scale,Math.sqrt(maxPixels/(rect.w*at1.width*rect.h*at1.height))),v=page.getViewport({scale:s}),canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(rect.w*v.width));canvas.height=Math.max(1,Math.round(rect.h*v.height));
        await drawPdf(page,{canvasContext:canvas.getContext('2d'),viewport:v,transform:[1,0,0,1,-rect.x*v.width,-rect.y*v.height],background:'white'},signal);page.cleanup();return canvas;
    }finally{if(task)await task.destroy();}
}
