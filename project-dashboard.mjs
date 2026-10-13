// Display preferences and illustrative cost data. Never changes model/schedule quantities.
export const DEMO_COSTS=Object.freeze({budget:3600000,committed:2840000,spent:1420000,forecast:3720000});
export function costSummary(values=DEMO_COSTS){
    const valid=Object.fromEntries(['budget','committed','spent','forecast'].map(k=>[k,Number(values[k])]));
    if(Object.values(valid).some(v=>!Number.isFinite(v)||v<0))throw Error('Cost values must be non-negative numbers.');
    return{...valid,variance:valid.forecast-valid.budget,variancePct:valid.budget?(valid.forecast-valid.budget)/valid.budget*100:null};
}
export function clampSplit(value,width){
    const number=Number(value),requested=Number.isFinite(number)?number:.42;
    if(!Number.isFinite(width)||width<600)return Math.min(.72,Math.max(.28,requested));
    return Math.min(Math.min(.72,1-300/width),Math.max(Math.max(.28,280/width),requested));
}
export function dashboardDate(value){
    if(!value)return 'Not available';
    const date=new Date(String(value).slice(0,10)+'T12:00:00Z');
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==String(value).slice(0,10))return 'Not available';
    return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(date);
}
const after=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export function projectDecisions(activities,asOf,reviewed={}){
    const weekEnd=after(asOf,6),horizon=after(asOf,20);
    return activities.flatMap(a=>{
        const gap=a.modelPct==null||a.pct==null?null:a.pct-a.modelPct;
        const behind=gap!=null&&gap>10;
        const upcoming=!behind&&(a.pct??0)<100&&a.float!=null&&a.float<=0&&a.finish>weekEnd&&a.start<=horizon&&a.finish<=horizon;
        if(!behind&&!upcoming)return[];
        const overdue=!!a.finish&&a.finish<asOf,critical=a.float!=null&&a.float<=0;
        const group=overdue||a.finish<=weekEnd?'This week':'Coming up';
        return[{...a,gap,group,reviewed:!!reviewed[a.id],overdue,critical,severity:overdue||behind&&critical?'red':'amber',impact:(overdue?2000:0)+(critical?1000:0)+(gap||0),reason:behind?`${gap} points behind plan`:'No schedule buffer; confirm the crew and materials'}];
    }).sort((a,b)=>b.impact-a.impact||(a.finish||'').localeCompare(b.finish||'')||a.id.localeCompare(b.id));
}
export function dashboardMetrics(activities,{asOf='2026-10-12',demo=false,reviewed={}}={}){
    const dates=activities.map(a=>a.finish).filter(d=>dashboardDate(d)!=='Not available').sort();
    const plans=activities.map(a=>a.plannedFinish).filter(d=>dashboardDate(d)!=='Not available').sort();
    const pairs=activities.filter(a=>Number.isFinite(a.modelPct)&&Number.isFinite(a.pct));
    const gap=pairs.length?Math.round(pairs.reduce((n,a)=>n+a.modelPct-a.pct,0)/pairs.length):null;
    const finish=dates.at(-1)||'',planned=plans.at(-1)||finish;
    const decisions=projectDecisions(activities,asOf,reviewed),pending=decisions.filter(d=>!d.reviewed).length;
    const costs=costSummary();
    return{finish,finishStatus:!finish?'Unknown':finish>planned?'At risk':'On plan',gap,progressStatus:gap==null?'Unknown':gap<-10?'Behind plan':gap>10?'Ahead of plan':'On plan',costs,decisions,pending,
        // Explicitly illustrative previous-week reference, only for demo project numbers.
        changes:demo?{finish:'+2 days',progress:'+3 points',cost:'+$45,000',decisions:(pending-3>=0?'+':'')+(pending-3)}:null};
}
export function sourceFreshness(at,now=new Date().toISOString()){
    const time=Date.parse(at),current=Date.parse(now);
    if(!Number.isFinite(time)||!Number.isFinite(current)||time>current+86400000)return{state:'unknown',label:'Date unknown'};
    const days=Math.max(0,Math.floor((current-time)/86400000));
    return days>7?{state:'stale',label:`Stale · ${days} days old`}:{state:'current',label:'Current'};
}
export const INTEGRATIONS=Object.freeze([
    {id:'revit',name:'Revit / BIM',description:'Model identity, level, wall ID and revision',fields:[['Element Unique ID','Model element'],['Level name','Schedule location'],['Revision','Model revision']],rows:[['RVT-DEMO-1001','6TH FLOOR','WH07F'],['RVT-DEMO-1002','7TH FLOOR','WH08B'],['RVT-DEMO-1003','8TH FLOOR','WH09T']]},
    {id:'schedule',name:'Project schedule',description:'Activity code, dates and installation stage',fields:[['Activity ID','Schedule activity'],['Location','Model level'],['Install stage','Field stage']],rows:[['WH07F','6TH FLOOR','Framed'],['WH08B','7TH FLOOR','Boarded'],['WH09T','8TH FLOOR','Taped']]},
    {id:'cost',name:'Cost management',description:'Cost codes, commitments and forecast',fields:[['Cost code','Work package'],['Budget / committed','Cost summary'],['Forecast at completion','Forecast']],rows:[['09-2216','Metal framing','$1,480,000'],['09-2900','Drywall & finish','$1,870,000'],['09-9000','Closeout & contingency','$370,000']]},
]);
