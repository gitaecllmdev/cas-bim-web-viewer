// Wall-style sketch gestures. Model edits happen once on release; pointer previews are disposable UI state.
import { boundaryCursor, closeBoundary, rectFromPoints, moveOpening, resizeOpening, openingError, moveCorner, moveEdge, outlineEdit, snap } from './demos/ceilings/sketch.mjs';
import { escapeHtml as esc } from './demos/ceilings/drawing.mjs';
import { clipStation } from './demos/ceilings/geometry.mjs';
import { lineMoveError } from './demos/ceilings/editing.mjs';

export class CeilingSketch {
    constructor({ root, ceiling, selected, select, patch, opening, notice, refresh, format, parse, selectedLine, selectLine, plan, moveLine }) {
        Object.assign(this, { root, ceiling, selected, select, patch, opening, notice, refresh, format, parse, selectedLine, selectLine, plan, moveLine });
        this.tool = 'select'; this.kind = 'void'; this.step = 1; this.points = []; this.cursor = null; this.typed = ''; this.drag = null; this.scene = null;
        this.constraint='free';
        root.addEventListener('pointerdown', e => this.down(e));
        root.addEventListener('pointermove', e => this.move(e));
        root.addEventListener('pointerup', e => this.up(e));
        root.addEventListener('pointercancel', () => { this.drag = null; this.paint(); });
        root.addEventListener('pointerleave', () => { if (!this.drag && this.tool === 'boundary') { this.cursor = null; this.paint(); } });
        root.addEventListener('dblclick', e => {
            if(this.tool==='boundary'){e.preventDefault();this.finish();return;}
        });
        root.addEventListener('wheel',e=>this.zoom(e),{passive:false});
        document.querySelector('#sketch-length').addEventListener('input', e => { this.typed = e.target.value; this.paint(); });
    }
    setScene(transform, viewBox) {
        const same=transform&&this.scene&&['scale','left','top','minX','minY'].every(k=>transform[k]===this.scene[k]);
        if(!same)this.viewport=null;
        this.scene = transform ? { ...transform, viewBox:this.viewport || viewBox } : null;
        if(this.scene)this.svg.setAttribute('viewBox',this.scene.viewBox.join(' ')); this.paint();
    }
    setTool(tool) { this.tool = tool; this.points = []; this.cursor = null; this.typed = ''; this.drag = null; this.refresh(); }
    reset() { this.tool = 'select'; this.points = []; this.cursor = null; this.typed = ''; this.drag = null; }
    get svg() { return this.root.querySelector('svg'); }
    get unit() { return 1 / (Math.abs(this.svg?.getScreenCTM()?.a || 1)); }
    map(p) { return [this.scene.left + (p[0] - this.scene.minX) * this.scene.scale, this.scene.top + (-p[1] - this.scene.minY) * this.scene.scale]; }
    local(e) {
        if (!this.svg || !this.scene) return null;
        const p = this.svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
        const q = p.matrixTransform(this.svg.getScreenCTM().inverse());
        return [(q.x - this.scene.left) / this.scene.scale + this.scene.minX, -((q.y - this.scene.top) / this.scene.scale + this.scene.minY)];
    }
    aim(point,event={}) { return boundaryCursor(point, this.points, { step: this.step, tolerance: this.unit * 9 / this.scene.scale, constraint:event.shiftKey?'ortho':this.constraint }); }
    lengthPoint(last,aim,length){const dx=aim[0]-last[0],dy=aim[1]-last[1],d=Math.hypot(dx,dy)||1;return[last[0]+(dx||(!dy?1:0))*length/d,last[1]+dy*length/d];}
    insertCorner(i,q){
        const c=this.ceiling(),a=c.outline[i],b=c.outline[(i+1)%c.outline.length],dx=b[0]-a[0],dy=b[1]-a[1],t=((q[0]-a[0])*dx+(q[1]-a[1])*dy)/(dx*dx+dy*dy);
        if(t<.01||t>.99||c.outline.length>=96)return;
        const outline=structuredClone(c.outline);outline.splice(i+1,0,[a[0]+dx*t,a[1]+dy*t]);const result=outlineEdit(c,outline);if(result.error)this.notice(result.error);else this.patch(result);
    }
    setViewport(box) { this.viewport=box;this.scene.viewBox=box;this.svg.setAttribute('viewBox',box.join(' '));this.paint(); }
    zoom(e) {
        if(!this.scene||!this.svg||e.ctrlKey||e.metaKey)return;
        e.preventDefault();const p=this.svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(this.svg.getScreenCTM().inverse()),v=this.scene.viewBox,f=Math.exp(Math.max(-.3,Math.min(.3,e.deltaY*.001)));
        if(v[2]*f<.2||v[2]*f>300)return;
        this.setViewport([q.x+(v[0]-q.x)*f,q.y+(v[1]-q.y)*f,v[2]*f,v[3]*f]);
    }
    fit() {
        if(!this.scene||!this.svg||!this.ceiling())return;const points=[...this.ceiling().outline,...this.points,...(this.cursor?[this.cursor.point]:[])].map(p=>this.map(p)),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y,pad=Math.max(w,h)*.08+.3;
        this.setViewport([x-pad,y-pad,w+2*pad,h+2*pad]);
    }
    status() {
        if (this.tool === 'boundary') return this.cursor?.closing ? 'Click the starting point to close the footprint.' : this.points.length ? 'Click the next corner, or type a length and press Enter. Click the start to close; Backspace undoes a corner.' : 'Click the first corner. The existing ceiling stays until you finish. Escape cancels.';
        if (this.tool === 'opening') return `Drag corner to corner to draw a ${this.kind === 'void' ? 'ceiling opening' : this.kind}. Escape cancels.`;
        if(this.selectedLine?.())return 'Drag this main or runner across its run, or use arrow keys. Set an exact position in Properties.';
        return this.selected() ? 'Drag the opening to move it; drag a corner to resize. Arrow keys move; Delete removes.' : 'Draw at any angle; Shift locks axes. Drag members or ceiling corners/edges. Double-click an edge to add a corner; Delete removes a focused corner.';
    }
    paint() {
        const svg = this.svg, c = this.ceiling(); if (!svg || !this.scene || !c) return;
        svg.querySelector('.sketch-overlay')?.remove();
        const dim=this.tool==='boundary';
        if(this.baseSvg!==svg||this.dimmed!==dim){for(const node of svg.children)node.style.opacity=dim?'.18':'1';this.baseSvg=svg;this.dimmed=dim;}
        const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g'); overlay.classList.add('sketch-overlay');
        const u = this.unit, font = 12 * u, stroke = 1.8 * u, r = 5 * u, parts = [], map = p => this.map(p);
        const line = (a, b, color = '#bd861d', dash = '') => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-width="${stroke}" ${dash ? `stroke-dasharray="${dash}"` : ''} pointer-events="none"/>`;
        const text = (p, value, color = '#725018', anchor = 'middle') => `<text x="${p[0]}" y="${p[1]}" font-size="${font}" text-anchor="${anchor}" fill="${color}" stroke="white" stroke-width="${3*u}" paint-order="stroke" pointer-events="none">${esc(value)}</text>`;
        const grip = (p, attr, title, round = false) => `<${round ? 'circle' : 'rect'} ${round ? `cx="${p[0]}" cy="${p[1]}" r="${r}"` : `x="${p[0]-r}" y="${p[1]-r}" width="${2*r}" height="${2*r}"`} fill="white" stroke="#1f3b57" stroke-width="${1.5*u}" ${attr} tabindex="0" role="button" aria-label="${title}"><title>${title}</title></${round ? 'circle' : 'rect'}>`;
        if (this.tool !== 'select') {
            const zero = map([0, 0]), gap = this.scene.scale * 12, vb = this.scene.viewBox;
            parts.push(`<defs><pattern id="ceiling-sketch-dots" x="${zero[0]}" y="${zero[1]}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="${.8*u}" fill="#aab7c3"/></pattern></defs><rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="url(#ceiling-sketch-dots)" pointer-events="none"/>`);
        }
        if (this.tool === 'boundary') {
            const points = this.points;
            points.forEach((p, i) => {
                const here = map(p);
                if (i) { const before = map(points[i-1]); parts.push(line(before, here), text([(before[0]+here[0])/2, (before[1]+here[1])/2-9*u], this.format(Math.hypot(p[0]-points[i-1][0], p[1]-points[i-1][1])))); }
                parts.push(`<circle cx="${here[0]}" cy="${here[1]}" r="${i ? r : 1.5*r}" fill="${!i && this.cursor?.closing ? '#23733c' : 'white'}" stroke="${!i && this.cursor?.closing ? '#23733c' : '#bd861d'}" stroke-width="${stroke}" pointer-events="none"/>`);
            });
            if (this.cursor) {
                let end = this.cursor.point;
                const last = points.at(-1), length = this.parse(this.typed);
                if (last && this.typed && length > 0) end=this.lengthPoint(last,end,length);
                const q = map(end);
                if (last) {
                    const closed=this.cursor.closing?closeBoundary(points,{constraint:this.constraint}):null,tail=closed?.outline?closed.outline.slice(points.length):[];
                    const route=[last,...tail,end];
                    for(let i=1;i<route.length;i++){const a=map(route[i-1]),b=map(route[i]);parts.push(line(a,b,this.cursor.closing?'#23733c':'#bd861d',`${5*u} ${4*u}`),text([(a[0]+b[0])/2,(a[1]+b[1])/2-12*u],`${this.format(Math.hypot(route[i][0]-route[i-1][0],route[i][1]-route[i-1][1]))}${this.typed?' · Enter':''}`));}
                }
                parts.push(`<circle cx="${q[0]}" cy="${q[1]}" r="${3*u}" fill="#bd861d" pointer-events="none"/>`);
            }
        } else if (this.drag?.previewOpening || this.selected()) {
            const o = this.drag?.previewOpening || c.openings.find(o => o.id === this.selected());
            if (o) {
                const error = openingError(c.outline, o, c.openings), color = error ? '#b12d24' : '#1f6b8c';
                const a = map([o.x,o.y]), b = map([o.x+o.width,o.y+o.depth]);
                if (this.drag) parts.push(`<rect x="${a[0]}" y="${b[1]}" width="${b[0]-a[0]}" height="${a[1]-b[1]}" fill="${error ? '#fbe6e2' : '#d8edf7'}" fill-opacity=".85" stroke="${color}" stroke-width="${stroke}" pointer-events="none"/>`);
                const deep=`${this.format(o.depth)} deep`,right=b[0]+9*u,inside=right+deep.length*font*.55>this.scene.viewBox[0]+this.scene.viewBox[2]-2*u;
                parts.push(text([(a[0]+b[0])/2,b[1]-10*u], `${this.format(o.width)} wide`, color), text([inside?b[0]-9*u:right,(a[1]+b[1])/2],deep,color,inside?'end':'start'));
                const corners = { sw: [o.x,o.y], se: [o.x+o.width,o.y], ne: [o.x+o.width,o.y+o.depth], nw: [o.x,o.y+o.depth] };
                if (!this.drag && this.tool === 'select') for (const [key,p] of Object.entries(corners)) parts.push(grip(map(p), `data-sketch-resize="${key}"`, `Resize ${key} opening corner`));
                if (this.drag && error) parts.push(text([a[0],a[1]+18*u], error, color, 'start'));
            }
        }
        if(this.tool==='select'&&this.selectedLine?.()){
            const logical=this.plan().layoutLines.find(l=>l.key===this.selectedLine());
            if(logical){const position=this.drag?.previewPosition??logical.positionIn,error=lineMoveError(this.plan(),logical,position),holes=c.openings.filter(o=>c.mode==='hardlid'||o.kind==='void'),color=error?'#b12d24':'#b37c20';
                const segments=clipStation(c.outline,holes,logical.axis==='x',position);
                for(const segment of segments)parts.push(line(map(segment[0]),map(segment[1]),color,this.drag?`${5*u} ${3*u}`:''));
                const segment=segments[0];if(segment){const a=map(segment[0]),b=map(segment[1]);parts.push(text([(a[0]+b[0])/2+9*u,(a[1]+b[1])/2-12*u],`${logical.role==='main'?'Main':logical.role==='joist'?'Joist':'Runner'} · ${this.format(position)}`,color));}
                if(error&&this.drag)parts.push(text([this.scene.viewBox[0]+12*u,this.scene.viewBox[1]+22*u],error,color,'start'));
            }
        }
        if (this.tool === 'select' && !this.selected()) {
            const points = this.drag?.previewOutline || c.outline;
            if (this.drag?.previewOutline) parts.push(`<polygon points="${points.map(map).map(p=>p.join(',')).join(' ')}" fill="#eef3f7" fill-opacity=".6" stroke="${outlineEdit(c,points).error ? '#b12d24' : '#1f6b8c'}" stroke-width="${stroke}" pointer-events="none"/>`);
            if (!this.drag) {
                points.forEach((p,i) => { const q = points[(i+1)%points.length], a = map(p), b = map(q); parts.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="transparent" stroke-width="${12*u}" data-sketch-edge="${i}" class="ceiling-edge-grip"/>`); });
                points.forEach((p,i) => parts.push(grip(map(p), `data-sketch-corner="${i}"`, `Move ceiling corner ${i+1}`, true)));
            }
        }
        overlay.innerHTML = parts.join(''); svg.append(overlay);
        this.root.classList.toggle('drawing-mode', this.tool !== 'select');
        this.root.classList.toggle('dragging', Boolean(this.drag));
        document.querySelector('#tool-hint').textContent = this.status();
        const input = document.querySelector('#sketch-length'); if (input.value !== this.typed) input.value = this.typed;
    }
    down(e) {
        if (!this.scene) return;
        if(e.button===1){e.preventDefault();this.root.setPointerCapture(e.pointerId);this.drag={kind:'pan',screen:[e.clientX,e.clientY],view:[...this.scene.viewBox],unit:this.unit};return;}
        if (e.button !== 0) return;
        const q = this.local(e), c = this.ceiling(); if (!q || !c) return;
        e.preventDefault(); this.root.focus({preventScroll:true}); this.root.setPointerCapture(e.pointerId);
        if (this.tool === 'boundary') { this.cursor = this.aim(q,e); this.drag = { kind: 'boundary', screen: [e.clientX,e.clientY] }; }
        else if (this.tool === 'opening') { const a = q.map(v=>snap(v,this.step)); this.drag = { kind: 'new-opening', start: a, previewOpening: { id: crypto.randomUUID(),kind:this.kind,...rectFromPoints(a,a) }, screen: [e.clientX,e.clientY] }; }
        else {
            const resize = e.target.closest('[data-sketch-resize]'), hit = e.target.closest('[data-opening]'), corner = e.target.closest('[data-sketch-corner]'), edge = e.target.closest('[data-sketch-edge]'),lineHit=e.target.closest('[data-layout-line]');
            const o = c.openings.find(o=>o.id===(hit?.dataset.opening || this.selected()));
            if ((resize || hit) && o) { this.drag = { kind: resize ? 'resize' : 'move-opening', original: structuredClone(o), corner: resize?.dataset.sketchResize, start:q, screen:[e.clientX,e.clientY] }; this.select(o.id); }
            else if(lineHit){const line=this.plan().layoutLines.find(l=>l.key===lineHit.dataset.layoutLine);this.drag={kind:'member-line',line,start:q,screen:[e.clientX,e.clientY]};this.selectLine(line.key);}
            else if (corner || edge) this.drag = { kind: corner ? 'corner' : 'edge', index:Number(corner?.dataset.sketchCorner ?? edge.dataset.sketchEdge), original:structuredClone(c.outline), start:q, screen:[e.clientX,e.clientY] };
            else { this.select(null); this.drag = null; }
        }
        this.paint();
    }
    move(e) {
        if(this.drag?.kind==='pan'){const d=this.drag;this.setViewport([d.view[0]-(e.clientX-d.screen[0])*d.unit,d.view[1]-(e.clientY-d.screen[1])*d.unit,d.view[2],d.view[3]]);return;}
        const q = this.local(e); if (!q) return;
        if (this.tool === 'boundary') { this.cursor = this.aim(q,e); this.paint(); return; }
        const d = this.drag; if (!d) return;
        d.moved ||= Math.hypot(e.clientX-d.screen[0],e.clientY-d.screen[1]) > 3;
        if (!d.moved) return;
        if (d.kind === 'new-opening') d.previewOpening = { ...d.previewOpening,...rectFromPoints(d.start,q.map(v=>snap(v,this.step))) };
        else if (d.kind === 'move-opening') d.previewOpening = moveOpening(d.original,[q[0]-d.start[0],q[1]-d.start[1]],this.step);
        else if (d.kind === 'resize') d.previewOpening = resizeOpening(d.original,d.corner,q,this.step);
        else if (d.kind === 'member-line') {const axis=d.line.axis==='x'?0:1;d.previewPosition=snap(d.line.positionIn+q[axis]-d.start[axis],this.step);}
        else if (d.kind === 'corner') d.previewOutline = moveCorner(d.original,d.index,q,this.step,this.constraint);
        else if (d.kind === 'edge') d.previewOutline = moveEdge(d.original,d.index,[q[0]-d.start[0],q[1]-d.start[1]],this.step);
        this.paint();
    }
    up(e) {
        if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
        const d = this.drag; this.drag = null; if (!d) return;
        if(d.kind==='pan'){this.paint();return;}
        if (d.kind === 'boundary') { this.cursor = this.aim(this.local(e),e); this.addCorner(); return; }
        if (!d.moved) {
            if(d.kind==='edge'){const now=performance.now();if(this.edgeClick?.index===d.index&&now-this.edgeClick.time<500){this.edgeClick=null;this.insertCorner(d.index,this.local(e));}else this.edgeClick={index:d.index,time:now};}
            if (d.kind === 'new-opening') this.notice('Drag from one corner to the opposite corner to size the opening.'); this.paint(); return;
        }
        const c = this.ceiling();
        if(d.kind==='member-line'){if(d.previewPosition!=null)this.moveLine(d.line.key,d.previewPosition);this.paint();return;}
        if (d.previewOpening) {
            const error = openingError(c.outline,d.previewOpening,c.openings);
            if (error) this.notice(error);
            else { this.tool = 'select'; this.opening(d.previewOpening); }
        } else if (d.previewOutline) { const result = outlineEdit(c,d.previewOutline); if (result.error) this.notice(result.error); else this.patch(result); }
        this.paint();
    }
    addCorner(point = this.cursor?.point) {
        if (!point) return;
        if (this.cursor?.closing && this.points.length >= 3) { this.finish(); return; }
        const last = this.points.at(-1); if (last && Math.hypot(point[0]-last[0],point[1]-last[1]) < .01) return;
        if (this.points.length >= 96) { this.notice('Use up to 96 footprint corners.'); return; }
        this.points.push([...point]); this.typed = ''; this.paint();
    }
    finish() {
        const closed = closeBoundary(this.points,{constraint:this.constraint}), result = closed.error ? closed : outlineEdit(this.ceiling(),closed.outline);
        if (result.error) { this.notice(result.error); return; }
        this.reset(); this.patch(result);
    }
    key(e) {
        const input = e.target.closest('input,select,textarea');
        if(!input&&e.key.toLowerCase()==='f'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();this.fit();return true;}
        if (e.key === 'Escape' && (this.tool !== 'select' || this.drag)) { e.preventDefault(); this.reset(); this.refresh(); return true; }
        if (this.tool === 'boundary' && (!input || input.id === 'sketch-length')) {
            if (e.key === 'Enter') {
                e.preventDefault(); const length = this.parse(this.typed), last = this.points.at(-1);
                if (this.typed) {
                    if (!last || !(length > 0)) { this.notice('Place the first corner, then enter a positive segment length.'); return true; }
                    const aim = this.cursor?.point || [last[0]+1,last[1]],p=this.lengthPoint(last,aim,length);
                    this.cursor = { point:p,closing:false }; this.addCorner(p);
                } else this.finish();
                return true;
            }
            if (!input && e.key === 'Backspace') { e.preventDefault(); if (this.typed) this.typed = this.typed.slice(0,-1); else this.points.pop(); this.paint(); return true; }
            if (!input && e.key.length === 1 && /[0-9'"\-/ .]/.test(e.key) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); this.typed += e.key; this.paint(); return true; }
        }
        const arrow = { ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1] }[e.key];
        const grip = e.target.closest('[data-sketch-corner],[data-sketch-edge],[data-sketch-resize]');
        if(!input&&e.target.hasAttribute('data-sketch-corner')&&['Delete','Backspace'].includes(e.key)){
            e.preventDefault();const c=this.ceiling();if(c.outline.length<=3){this.notice('A footprint needs at least three corners.');return true;}const outline=c.outline.filter((_,i)=>i!==Number(e.target.dataset.sketchCorner)),result=outlineEdit(c,outline);if(result.error)this.notice(result.error);else this.patch(result);return true;
        }
        if(!input&&this.tool==='select'&&this.selectedLine?.()&&arrow&&!grip&&!e.target.matches('[role=tab]')){
            const line=this.plan().layoutLines.find(l=>l.key===this.selectedLine());if(!line)return false;const direction=arrow[line.axis==='x'?0:1];if(!direction)return false;e.preventDefault();this.moveLine(line.key,line.positionIn+direction*(e.shiftKey?6:this.step));this.root.querySelector(`[data-layout-line="${line.key}"]`)?.focus();return true;
        }
        if (!input && this.tool === 'select' && arrow && grip) {
            e.preventDefault(); const step=e.shiftKey?6:this.step, delta=arrow.map(n=>n*step), c=this.ceiling();
            const corner=grip.dataset.sketchCorner, edge=grip.dataset.sketchEdge, resize=grip.dataset.sketchResize;
            if (resize) { const o=c.openings.find(o=>o.id===this.selected()); if(o){const at=[resize.includes('w')?o.x:o.x+o.width,resize.includes('s')?o.y:o.y+o.depth],next=resizeOpening(o,resize,at.map((v,i)=>v+delta[i]),this.step),error=openingError(c.outline,next,c.openings);if(error)this.notice(error);else this.opening(next);} }
            else { const p=corner!=null?moveCorner(c.outline,Number(corner),c.outline[Number(corner)].map((v,i)=>v+delta[i]),this.step,this.constraint):moveEdge(c.outline,Number(edge),delta,this.step),result=outlineEdit(c,p); if(result.error)this.notice(result.error);else this.patch(result); }
            const selector=resize?`[data-sketch-resize="${resize}"]`:corner!=null?`[data-sketch-corner="${corner}"]`:`[data-sketch-edge="${edge}"]`;
            this.root.querySelector(selector)?.focus(); return true;
        }
        if (!input && this.tool === 'select' && this.selected()) {
            const o = this.ceiling().openings.find(o=>o.id===this.selected()); if (!o) return false;
            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.patch({openings:this.ceiling().openings.filter(v=>v.id!==o.id)}); this.select(null); return true; }
            const delta = arrow;
            if (delta && !e.target.matches('[role=tab]')) { e.preventDefault(); const step=e.shiftKey ? 6 : this.step, next=moveOpening(o,delta.map(n=>n*step),this.step), error=openingError(this.ceiling().outline,next,this.ceiling().openings); if (error) this.notice(error); else this.opening(next); return true; }
        }
        return false;
    }
}
