// Colored walls that stay visible on a plan seen from far. Theming colors tint a wall's own lines, a pixel or two wide
// on a whole sheet, so a layer over the plan draws the colored walls thicker when zoomed out, thinner as the view closes
// in, and not at all once the walls show at their own width. Where they are: the plan's own image (Viewer3D.getScreenShot,
// the canvas as drawn), the pixels between white and one of the colors in use (so anti-aliased edges count), grown by
// a few pixels. Drawn when the view stops moving and when the colors change; hidden while the view moves.
// Viewer3D getScreenShot, worldToClient, CAMERA_CHANGE_EVENT; Model getBoundingBox: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/

// How many pixels to grow the colored walls by, from how many pixels a sheet unit (a paper inch on a Revit sheet)
// takes on screen: about 3 with a whole sheet in a pane, none from about 4x closer.
export const popRadius = (pxPerUnit) => Math.max(0, Math.min(4, Math.round(4 - pxPerUnit / 10)));

// The pixel's color, when it lies between white and one of the colors (rgb arrays), else null: close to that blend,
// and about as colorful as it (so greys, a muted color's near neighbours, are not taken for it). Black and grey lines,
// the grey around the sheet and white paper are not matched.
export function popColor(r, g, b, colors) {
    const r0 = 255 - r, g0 = 255 - g, b0 = 255 - b;
    if (r0 + g0 + b0 < 40) return null; // paper
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    for (const c of colors) {
        const cr = 255 - c[0], cg = 255 - c[1], cb = 255 - c[2], len2 = cr * cr + cg * cg + cb * cb;
        if (!len2) continue;
        const t = (r0 * cr + g0 * cg + b0 * cb) / len2;
        if (t < 0.3 || t > 1.15) continue;
        const er = r0 - t * cr, eg = g0 - t * cg, eb = b0 - t * cb;
        if (er * er + eg * eg + eb * eb > 900) continue;
        if (chroma < 0.6 * t * (Math.max(...c) - Math.min(...c))) continue;
        return c;
    }
    return null;
}

export class PlanPop {
    constructor(viewer) {
        this.viewer = viewer;
        this.colors = [];
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'plan-pop';
        viewer.container.appendChild(this.canvas);
        this.onCamera = () => { this.canvas.classList.add('moving'); this.schedule(250); };
        viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCamera);
    }

    // The colors to show (hex), as the plan is themed now.
    setColors(hexes) {
        this.colors = [...new Set(hexes)].filter(h => /^#[0-9a-f]{6}$/i.test(h || '')).map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
        this.schedule(60);
    }

    schedule(ms) {
        clearTimeout(this.timer);
        if (!this.pending) { let done; this.pending = new Promise(r => { done = r; }); this.pending.done = done; }
        this.timer = setTimeout(() => this.draw().catch(err => console.warn('Plan colors layer:', err)).finally(() => {
            const p = this.pending;
            this.pending = null;
            p?.done();
        }), ms);
    }

    // Resolves once the layer shows the latest colors (a schedule playing waits for it before its next day).
    whenDrawn() {
        return this.pending || Promise.resolve();
    }

    // The sheet's scale on screen: 10 sheet units along its bottom edge, in pixels (Model.getBoundingBox,
    // Viewer3D.worldToClient: anywhere on screen, also between sheets).
    radius() {
        const v = this.viewer, box = v.model?.getBoundingBox?.();
        if (!box) return 0;
        const p = v.worldToClient(new THREE.Vector3(box.min.x, box.min.y, 0)), q = v.worldToClient(new THREE.Vector3(box.min.x + 10, box.min.y, 0));
        return p && q ? popRadius(Math.hypot(q.x - p.x, q.y - p.y) / 10) : 0;
    }

    async draw() {
        const v = this.viewer, cv = this.canvas, run = (this.run = (this.run || 0) + 1);
        const r = this.colors.length && v.model?.isLoadDone() ? this.radius() : 0;
        if (!r) { cv.width = 0; cv.classList.remove('moving'); return; }
        // A large view at half resolution (the layer is blobs of color; a quarter of the pixels to read).
        const cw = v.container.clientWidth, ch = v.container.clientHeight, half = cw * ch > 500000;
        const img = await new Promise((res, rej) => v.getScreenShot(half ? Math.round(cw / 2) : 0, half ? Math.round(ch / 2) : 0, (url) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }));
        if (run !== this.run) return;
        const grow = half ? Math.max(1, Math.round(r / 2)) : r;
        const W = img.width, H = img.height;
        const src = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = src.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, W, H).data, mask = g.createImageData(W, H), o = mask.data;
        for (let i = 0; i < d.length; i += 4) {
            const c = popColor(d[i], d[i + 1], d[i + 2], this.colors);
            if (c) { o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2]; o[i + 3] = 255; }
        }
        g.putImageData(mask, 0, 0);
        cv.width = W;
        cv.height = H;
        const ctx = cv.getContext('2d');
        ctx.globalAlpha = 0.85;
        for (let dy = -grow; dy <= grow; dy++) for (let dx = -grow; dx <= grow; dx++) if (dx * dx + dy * dy <= grow * grow + grow) ctx.drawImage(src, dx, dy);
        cv.classList.remove('moving');
    }

    remove() {
        clearTimeout(this.timer);
        this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCamera);
        this.canvas.remove();
    }
}
