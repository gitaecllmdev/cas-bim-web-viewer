// A straight sloping base, applied to the existing wall layout before labeling/manual overrides.
// Openings and their level heads/sills retain their elevations. Studs remain plumb.
export const baseAt=(bottom,x)=>bottom?bottom[0][1]+(bottom[1][1]-bottom[0][1])*(x-bottom[0][0])/(bottom[1][0]-bottom[0][0]):0;
const at=(points,x,fallback)=>{if(!points)return fallback;let i=1;while(i<points.length-1&&points[i][0]<x)i++;const a=points[i-1],b=points[i];return a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);};
const floor8=n=>Math.floor((n+1e-9)*8)/8;
export function applyBottom(members,bottom,{top=null,heightIn,leg=1.25,cutbackIn=.125}={}){
    if(!bottom)return;
    const k=(bottom[1][1]-bottom[0][1])/(bottom[1][0]-bottom[0][0]),thickness=leg*Math.hypot(1,k),base=x=>baseAt(bottom,x);
    for(const m of members){
        if(m.role==='bottom track'){
            const a=m.x,b=m.x+m.w,ya=base(a),yb=base(b);
            Object.assign(m,{y:Math.min(ya,yb),h:Math.abs(yb-ya)+thickness,pts:[[a,ya],[b,yb],[b,yb+thickness],[a,ya+thickness]],lengthIn:floor8(Math.hypot(b-a,yb-ya)),slope:k,baseTrack:true});
        }else if(m.orient==='v'&&m.y<=leg+1e-6){
            const x=m.x,r=x+m.w,c=(x+r)/2,seated=m.full||m.seat?.[0]>0;
            const upper=px=>{
                if(m.topAxis)return m.topAxis[1];if(m.full)return at(top,px,heightIn);
                if(!m.pts)return m.y+m.h+(m.seat?.[1]||0);
                const values=[];for(let i=0;i<m.pts.length;i++){const a=m.pts[i],b=m.pts[(i+1)%m.pts.length];if(px>=Math.min(a[0],b[0])-1e-6&&px<=Math.max(a[0],b[0])+1e-6){if(Math.abs(a[0]-b[0])<1e-6)values.push(a[1],b[1]);else values.push(a[1]+(b[1]-a[1])*(px-a[0])/(b[0]-a[0]));}}return Math.max(...values);
            };
            const old=m.pts||[[x,m.y],[r,m.y],[r,m.y+m.h],[x,m.y+m.h]],poly=[];
            for(let i=0;i<old.length;i++){
                const a=old[i],b=old[(i+1)%old.length],da=a[1]-base(a[0])-thickness,db=b[1]-base(b[0])-thickness;
                if(da>=-1e-9)poly.push([...a]);
                if((da>0&&db<0)||(da<0&&db>0)){const t=da/(da-db);poly.push(a.map((v,j)=>v+t*(b[j]-v)));}
            }
            const candidates=[x,r,...(top||[]).map(p=>p[0]).filter(v=>v>x&&v<r)],offset=seated?0:thickness;
            const length=Math.max(...candidates.map(px=>upper(px)-base(px)-offset))-(m.topGapIn?0:cutbackIn);
            const axis=[base(c)+offset,upper(c)];
            const ys=poly.map(p=>p[1]);
            Object.assign(m,{y:Math.min(...ys),h:Math.max(...ys)-Math.min(...ys),pts:poly,lengthIn:floor8(length),baseAxis:axis,atBottom:true,bottomSlope:k});
            if(m.topAxis)m.topAxis=axis;
        }
    }
}
