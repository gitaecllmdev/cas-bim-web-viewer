// Screen capture for the Label Maker's Snapshot: any monitor, window or other tab the user picks (never this tab), at
// the full resolution of what is shared, as a PNG file. The Source viewer then takes it like any image: drag around the
// schedule. The first frames of a shared window can be black or empty, so it waits for a frame with something on it.
export const DISPLAY_OPTIONS = {
    video: { displaySurface: 'monitor', cursor: 'never', width: { ideal: 7680 }, height: { ideal: 4320 }, frameRate: { ideal: 5, max: 15 } },
    audio: false, monitorTypeSurfaces: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude', systemAudio: 'exclude', preferCurrentTab: false,
};

// A frame with nothing on it: every sampled pixel (RGBA) within a few levels of the first one.
export function blankFrame(data, tolerance = 4) {
    if (!data || data.length < 4) return true;
    const [r0, g0, b0] = data;
    for (let i = 4; i < data.length; i += 4) {
        if (Math.abs(data[i] - r0) > tolerance || Math.abs(data[i + 1] - g0) > tolerance || Math.abs(data[i + 2] - b0) > tolerance) return false;
    }
    return true;
}

// What to tell the user when the browser refuses or the share fails.
export function captureError(e) {
    const name = e?.name || '';
    if (name === 'NotAllowedError' || name === 'AbortError') return 'Screen capture was cancelled or not allowed. Pick a screen or window to share, or use Paste screenshot / Upload image.';
    if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') return 'That screen or window could not be read. Pick another one, or use Paste screenshot / Upload image.';
    if (name === 'SecurityError') return 'Screen capture is blocked on this page. Open the Label Maker on its own page, or use Paste screenshot / Upload image.';
    return e?.message || 'The snapshot could not be captured.';
}

const sleep = (ms) => new Promise(r => { const t = setTimeout(r, ms); t?.unref?.(); }); // unref: never keeps Node (tests) alive
// The next frame the video shows (or a short wait where frame callbacks are not offered), never longer than a second.
const nextFrame = (video) => Promise.race([sleep(1000), video.requestVideoFrameCallback
    ? new Promise(r => video.requestVideoFrameCallback(() => r())) : sleep(200)]);

export async function captureScreen({ media = globalThis.navigator?.mediaDevices, doc = globalThis.document, attempts = 8 } = {}) {
    if (!media?.getDisplayMedia) throw new Error('Screen capture is unavailable in this browser. Use Paste screenshot or Upload image.');
    let stream;
    try { stream = await media.getDisplayMedia(DISPLAY_OPTIONS); }
    catch (e) { if (e?.name !== 'TypeError') throw e; stream = await media.getDisplayMedia({ video: true, audio: false }); } // an older browser refusing an option
    const video = doc.createElement('video');
    try {
        video.muted = true; video.playsInline = true; video.srcObject = stream;
        await video.play();
        const probe = doc.createElement('canvas'), pctx = probe.getContext('2d', { willReadFrequently: true });
        probe.width = 64; probe.height = 36;
        for (let i = 0; i < attempts; i++) {
            await nextFrame(video);
            if (i === 0) await sleep(150); // let a window that was behind others paint
            const w = video.videoWidth, h = video.videoHeight;
            if (!w || !h) continue;
            pctx.drawImage(video, 0, 0, probe.width, probe.height);
            if (blankFrame(pctx.getImageData(0, 0, probe.width, probe.height).data)) continue;
            const canvas = doc.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(video, 0, 0, w, h);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('The snapshot could not be saved as an image.');
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            return new File([blob], `snapshot-${stamp}.png`, { type: 'image/png' });
        }
        throw new Error('The shared screen stayed blank. Make sure the window is open (not minimized), then try again.');
    } finally {
        stream.getTracks().forEach(t => t.stop());
        video.srcObject = null;
    }
}

// The system's own region snip: on Windows the Snipping Tool overlay (the ms-screenclip: link; the browser asks once to
// open it), where you drag around any part of any screen and the snip is copied. Elsewhere, the keys that copy a region.
export function snipGuide(platform = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '') {
    if (/win/i.test(platform)) return { launch: 'ms-screenclip:', keys: 'Windows + Shift + S' };
    if (/mac/i.test(platform)) return { launch: null, keys: 'Control + Shift + Command + 4' };
    return { launch: null, keys: 'your screenshot keys for a region (copy to clipboard)' };
}
// The image on the clipboard, if the browser lets the page read it: { blob, key } (key: its SHA-1 and size), else null.
export async function clipboardImage(clip = globalThis.navigator?.clipboard) {
    if (!clip?.read) return null;
    for (const item of await clip.read()) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type), bytes = new Uint8Array(await blob.arrayBuffer());
        const sha = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', bytes));
        return { blob, key: `${[...sha].map(b => b.toString(16).padStart(2, '0')).join('')}:${bytes.length}` };
    }
    return null;
}
