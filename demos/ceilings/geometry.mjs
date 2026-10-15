// Value-only ceiling geometry. Inches, x/y in the ceiling surface; no DOM or Revit dependencies.
export const EPS = 1e-7;
export const area = p => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
export function bounds(p) {
    return { minX: Math.min(...p.map(q => q[0])), maxX: Math.max(...p.map(q => q[0])), minY: Math.min(...p.map(q => q[1])), maxY: Math.max(...p.map(q => q[1])) };
}
export function inside(p, polygon) {
    let yes = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
    }
    return yes;
}
export const rectPolygon = r => [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.depth], [r.x, r.y + r.depth]];
export const pieceArea = r => r.polygon ? area(r.polygon) : r.width * r.depth;
export const piecePolygon = r => r.polygon || rectPolygon(r);
export const orthogonal = p => p.every((a,i)=>{const b=p[(i+1)%p.length];return Math.abs(a[0]-b[0])<EPS||Math.abs(a[1]-b[1])<EPS;});
const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function intersects(a,b,c,d) {
    const p=cross(a,b,c),q=cross(a,b,d),r=cross(c,d,a),s=cross(c,d,b);
    return (p*q < -EPS && r*s < -EPS) || (Math.abs(p)<EPS&&onSegment(c,a,b)) || (Math.abs(q)<EPS&&onSegment(d,a,b)) || (Math.abs(r)<EPS&&onSegment(a,c,d)) || (Math.abs(s)<EPS&&onSegment(b,c,d));
}
export function onSegment(p, a, b) {
    return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) < EPS &&
        p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}
export function subtractRectangles(a, b, rectangles) {
    if(Math.abs(b[0]-a[0])>EPS&&Math.abs(b[1]-a[1])>EPS){
        const cuts=[0,1],delta=b.map((v,i)=>v-a[i]);
        for(const r of rectangles)for(const [axis,values]of[[0,[r.x,r.x+r.width]],[1,[r.y,r.y+r.depth]]])for(const value of values){const t=(value-a[axis])/delta[axis];if(t>0&&t<1)cuts.push(t);}
        const sorted=unique(cuts),at=t=>a.map((v,i)=>v+delta[i]*t),out=[];
        for(let i=1;i<sorted.length;i++){const mid=at((sorted[i-1]+sorted[i])/2);if(!rectangles.some(r=>mid[0]>=r.x-EPS&&mid[0]<=r.x+r.width+EPS&&mid[1]>=r.y-EPS&&mid[1]<=r.y+r.depth+EPS))out.push([at(sorted[i-1]),at(sorted[i])]);}
        return out;
    }
    const axis = Math.abs(b[0] - a[0]) > EPS ? 0 : 1, other = 1 - axis, lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis]);
    const relevant = rectangles.filter(r => a[other] >= (other === 0 ? r.x : r.y) - EPS && a[other] <= (other === 0 ? r.x + r.width : r.y + r.depth) + EPS);
    const cuts = unique([lo, hi, ...relevant.flatMap(r => axis === 0 ? [r.x, r.x + r.width] : [r.y, r.y + r.depth]).filter(n => n > lo && n < hi)]), result = [];
    for (let i = 1; i < cuts.length; i++) {
        const mid = (cuts[i - 1] + cuts[i]) / 2;
        if (relevant.some(r => mid >= (axis === 0 ? r.x : r.y) - EPS && mid <= (axis === 0 ? r.x + r.width : r.y + r.depth) + EPS)) continue;
        const p = [...a], q = [...a]; p[axis] = cuts[i - 1]; q[axis] = cuts[i]; result.push([p, q]);
    }
    return result;
}
const unique = ns => [...new Set(ns)].sort((a, b) => a - b);
export function validateOutline(p) {
    if (!Array.isArray(p) || p.length < 3 || p.length > 96 || p.some(q => !Array.isArray(q) || q.length !== 2 || q.some(n => !Number.isFinite(n) || Math.abs(n) > 12000))) return 'Use 3–96 finite footprint corners within 1,000 feet of the local origin.';
    const n = p.length;
    for (let i = 0; i < n; i++) {
        const a = p[i], b = p[(i + 1) % n];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS) return 'Remove repeated footprint corners.';
        const before=p[(i+n-1)%n];
        if(Math.abs(cross(before,a,b))<EPS&&(a[0]-before[0])*(b[0]-a[0])+(a[1]-before[1])*(b[1]-a[1])<0)return 'A footprint edge cannot double back on itself.';
        for (let j = i + 1; j < n; j++) {
            if (j === i + 1 || (i === 0 && j === n - 1)) continue;
            const c = p[j], d = p[(j + 1) % n];
            if (intersects(a,b,c,d)) return 'Footprint edges must not cross or touch other edges.';
        }
    }
    return area(p) > EPS ? null : 'The footprint must have a positive area.';
}
// Partition only at actual boundary coordinates. This handles concave outlines and subtracts a UNION of holes.
export function piecesInBox(polygon, holes, box) {
    if(!orthogonal(polygon))return polygonPiecesInBox(polygon,holes,box);
    const all = polygon.concat(...holes.map(rectPolygon));
    const xs = unique([box.minX, box.maxX, ...all.map(p => p[0]).filter(x => x > box.minX && x < box.maxX)]);
    const ys = unique([box.minY, box.maxY, ...all.map(p => p[1]).filter(y => y > box.minY && y < box.maxY)]);
    const result = [];
    for (let i = 1; i < xs.length; i++) for (let j = 1; j < ys.length; j++) {
        const point = [(xs[i - 1] + xs[i]) / 2, (ys[j - 1] + ys[j]) / 2];
        if (inside(point, polygon) && !holes.some(r => point[0] > r.x - EPS && point[0] < r.x + r.width + EPS && point[1] > r.y - EPS && point[1] < r.y + r.depth + EPS)) result.push({ x: xs[i - 1], y: ys[j - 1], width: xs[i] - xs[i - 1], depth: ys[j] - ys[j - 1] });
    }
    return result;
}
// Ear clipping keeps concave polygons exact. Clip each nonoverlapping triangle to a rectangular cell; holes split
// that cell at their boundaries, so a fixture's entire area is subtracted, including along angled perimeter cuts.
const triangleCache=new Map();
function triangles(polygon){
    const key=JSON.stringify(polygon);if(triangleCache.has(key))return triangleCache.get(key);
    const signed=polygon.reduce((s,a,i)=>{const b=polygon[(i+1)%polygon.length];return s+a[0]*b[1]-b[0]*a[1];},0);
    const p=(signed>0?polygon:[...polygon].reverse()).map(v=>[...v]),out=[];
    while(p.length>3){let found=false;for(let i=0;i<p.length;i++){
        const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length];
        if(Math.abs(cross(a,b,c))<EPS){p.splice(i,1);found=true;break;}
        if(cross(a,b,c)<=EPS)continue;
        if(p.some((q,j)=>j!==i&&j!==(i+p.length-1)%p.length&&j!==(i+1)%p.length&&cross(a,b,q)>=-EPS&&cross(b,c,q)>=-EPS&&cross(c,a,q)>=-EPS))continue;
        out.push([a,b,c]);p.splice(i,1);found=true;break;
    }if(!found)throw Error('The footprint could not be triangulated. Check its corners.');}
    if(p.length===3&&area(p)>EPS)out.push(p);if(triangleCache.size>24)triangleCache.delete(triangleCache.keys().next().value);triangleCache.set(key,out);return out;
}
function clipBox(polygon,b){
    let p=polygon;
    for(const [axis,value,sign]of[[0,b.minX,1],[0,b.maxX,-1],[1,b.minY,1],[1,b.maxY,-1]]){
        const next=[];
        for(let i=0;i<p.length;i++){const a=p[i],d=p[(i+1)%p.length],ia=sign*(a[axis]-value)>=-EPS,id=sign*(d[axis]-value)>=-EPS;
            if(ia)next.push(a);if(ia!==id){const t=(value-a[axis])/(d[axis]-a[axis]);next.push(a.map((v,k)=>v+t*(d[k]-v)));}}
        p=next;
    }return p;
}
function polygonPiecesInBox(polygon,holes,box){
    const xs=unique([box.minX,box.maxX,...holes.flatMap(r=>[r.x,r.x+r.width]).filter(x=>x>box.minX&&x<box.maxX)]),ys=unique([box.minY,box.maxY,...holes.flatMap(r=>[r.y,r.y+r.depth]).filter(y=>y>box.minY&&y<box.maxY)]),out=[];
    for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++){
        const mid=[(xs[i-1]+xs[i])/2,(ys[j-1]+ys[j])/2];if(holes.some(r=>inside(mid,rectPolygon(r))))continue;
        const b={minX:xs[i-1],maxX:xs[i],minY:ys[j-1],maxY:ys[j]};
        for(const t of triangles(polygon)){const clipped=clipBox(t,b);if(clipped.length<3||area(clipped)<EPS)continue;const q=bounds(clipped);out.push({x:q.minX,y:q.minY,width:q.maxX-q.minX,depth:q.maxY-q.minY,polygon:clipped});}
    }return out;
}
// Main/cross member centerlines. Stations on the perimeter are supplied by the perimeter members instead.
export function clipStation(polygon, holes, vertical, station) {
    const loops = [polygon, ...holes.map(rectPolygon)], cuts = [];
    for (const loop of loops) for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length], u = vertical ? 0 : 1, v = 1 - u;
        if ((a[u] <= station && b[u] > station) || (b[u] <= station && a[u] > station)) cuts.push(a[v] + (station - a[u]) / (b[u] - a[u]) * (b[v] - a[v]));
    }
    const sorted = unique(cuts), result = [];
    for (let i = 1; i < sorted.length; i++) {
        const mid = (sorted[i - 1] + sorted[i]) / 2, point = vertical ? [station, mid] : [mid, station];
        if (inside(point, polygon) && !holes.some(r => inside(point, rectPolygon(r)))) result.push(vertical ? [[station, sorted[i - 1]], [station, sorted[i]]] : [[sorted[i - 1], station], [sorted[i], station]]);
    }
    return result;
}
