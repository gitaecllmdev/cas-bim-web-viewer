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

// One page of a PDF drawn on a canvas, for showing the source of an imported schedule (Demo 3): bytes (Uint8Array),
// the page number (1-based), the canvas, and the scale (1 = PDF points). Returns { pages, width, height } in points.
// PDFPageProxy.render: https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html#render
export async function renderPdfPage(bytes, number, canvas, { scale = 1.5 } = {}) {
    library ||= import(`${base}build/pdf.min.mjs`).catch(err => { library = null; throw new Error(`PDF reader could not load. Check your connection to jsDelivr. ${err.message}`); });
    const pdfjs = await library;
    pdfjs.GlobalWorkerOptions.workerSrc = `${base}build/pdf.worker.min.mjs`;
    const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/` });
    try {
        const pdf = await task.promise, page = await pdf.getPage(Math.min(Math.max(1, number), pdf.numPages));
        const at1 = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        return { pages: pdf.numPages, width: at1.width, height: at1.height };
    } finally { await task.destroy(); }
}
