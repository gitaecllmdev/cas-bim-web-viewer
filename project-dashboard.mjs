// Display preferences and illustrative cost data. Never changes model/schedule quantities.
export const DEMO_COSTS=Object.freeze({budget:3600000,committed:2840000,spent:1420000,forecast:3720000});
export function costSummary(values=DEMO_COSTS){
    const valid=Object.fromEntries(['budget','committed','spent','forecast'].map(k=>[k,Number(values[k])]));
    if(Object.values(valid).some(v=>!Number.isFinite(v)||v<0))throw Error('Cost values must be non-negative numbers.');
    return{...valid,variance:valid.forecast-valid.budget,variancePct:valid.budget?(valid.forecast-valid.budget)/valid.budget*100:null};
}
// Synthetic work-package allocations, separate from model quantities and field stages.
export const DEMO_LABOUR=Object.freeze([
    Object.freeze({id:'LAB-001',code:'09-2216',name:'Metal framing',stage:'Framed',crew:16,plannedWeek:720,regular:576,overtime:72,budgetHours:11000,forecastHours:12000,rate:60}),
    Object.freeze({id:'LAB-002',code:'09-2900',name:'Drywall & finish',stage:'Boarded',crew:12,plannedWeek:540,regular:432,overtime:48,budgetHours:16500,forecastHours:18000,rate:60}),
    Object.freeze({id:'LAB-003',code:'09-9000',name:'Closeout',stage:'Taped',crew:4,plannedWeek:180,regular:144,overtime:24,budgetHours:2500,forecastHours:3000,rate:60}),
]);
export function labourSummary(rows=DEMO_LABOUR,costs=DEMO_COSTS){
    const total={crew:0,plannedWeek:0,regular:0,overtime:0,budgetHours:0,forecastHours:0,budgetCost:0,forecastCost:0};
    for(const row of rows){
        for(const key of ['crew','plannedWeek','regular','overtime','budgetHours','forecastHours','rate']){
            if(!Number.isFinite(row[key])||row[key]<0||key==='crew'&&!Number.isInteger(row[key]))throw Error('Labour values must be non-negative numbers; crew must be a whole number.');
            if(key!=='rate')total[key]+=row[key];
        }
        total.budgetCost+=row.budgetHours*row.rate;total.forecastCost+=row.forecastHours*row.rate;
    }
    const cost=costSummary(costs);
    if(total.budgetCost>cost.budget||total.forecastCost>cost.forecast)throw Error('Labour must be included within the total project cost.');
    return{...total,weekHours:total.regular+total.overtime,hourVariance:total.forecastHours-total.budgetHours,costVariance:total.forecastCost-total.budgetCost,otherBudget:cost.budget-total.budgetCost,otherForecast:cost.forecast-total.forecastCost};
}
export function labourAssignments(activities,asOf='2026-10-12'){
    return DEMO_LABOUR.map(row=>{
        const matches=activities.filter(a=>a.stage===row.stage&&a.level&&a.scope!=='other');
        const active=matches.find(a=>a.start<=asOf&&a.finish>=asOf&&(a.pct??0)<100);
        const next=[...matches].filter(a=>a.start>asOf&&(a.pct??0)<100).sort((a,b)=>a.start.localeCompare(b.start))[0];
        const activity=active||next||matches[0];
        return{...row,activityId:activity?.id||'',level:activity?.level||'',weekStart:asOf};
    });
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
export function dashboardIcon(name){
    const paths={model:'<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8"/>',both:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',schedule:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h3m-3 4h7m-3 4h7"/>',home:'<path d="m3 10 9-7 9 7M5 9v11h14V9M10 20v-7h4v7"/>',connect:'<path d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0) scale(.9)"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 2M12 16h.01"/>',present:'<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',tools:'<path d="M5 4v16M12 4v16M19 4v16M2 8h6m1 8h6m1-7h6"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',review:'<path d="m4 12 5 5L20 6"/>',next:'<path d="M4 12h16m-6-6 6 6-6 6"/>',crew:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m3 9v-2a5 5 0 0 0-3-4"/>'};
    return paths[name]?`<svg class="dashboard-icon" data-dashboard-icon aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`:'';
}
export function activityInsight(activity,model){
    if(activity.scope==='other')return{state:'unlinked',title:'Schedule context only',summary:'This activity is not mapped to wall work. No model walls are highlighted.',action:'Review its trade and location before creating a model link.'};
    if(!model)return{state:'unlinked',title:'Model progress unavailable',summary:'A resolved wall level and installation stage are needed for this comparison.',action:'Review the level and stage in Link settings. Missing progress is not treated as zero.'};
    const evidence=`${model.done} of ${model.total} linked walls are ${activity.stage||'at the activity stage'} or later.`;
    if(!Number.isFinite(activity.pct))return{state:'unlinked',title:'Schedule progress unavailable',summary:evidence+' The schedule does not report a completion percentage.',action:'Confirm schedule progress before comparing it with the field record.'};
    const gap=Math.round(model.pct-activity.pct);
    if(activity.pct===100&&model.pct<100)return{state:'behind',title:'Completion needs review',summary:`The schedule reports complete; the field record is ${model.pct}% complete. ${evidence}`,action:'Check the remaining walls and confirm that field progress and schedule status are current.'};
    if(gap<-10)return{state:'behind',title:'Behind the schedule',summary:`Field progress is ${-gap} percentage points below the schedule (${model.pct}% versus ${activity.pct}%). ${evidence}`,action:'Confirm work remaining, crew availability and the reporting dates before deciding on recovery work.'};
    if(gap>10)return{state:'ahead',title:'Ahead of the schedule',summary:`Field progress is ${gap} percentage points above the schedule (${model.pct}% versus ${activity.pct}%). ${evidence}`,action:'Confirm completed work and update the schedule if the field record is current.'};
    return{state:'even',title:'Progress aligned',summary:`Field progress is within 10 percentage points of the schedule (${model.pct}% versus ${activity.pct}%). ${evidence}`,action:'Continue monitoring the activity and confirm its finish date.'};
}
export const INTEGRATIONS=Object.freeze([
    {id:'revit',name:'Revit / BIM',description:'Model identity, level, wall ID and revision',fields:[['Element Unique ID','Model element'],['Level name','Schedule location'],['Revision','Model revision']],rows:[['RVT-DEMO-1001','6TH FLOOR','WH07F'],['RVT-DEMO-1002','7TH FLOOR','WH08B'],['RVT-DEMO-1003','8TH FLOOR','WH09T']]},
    {id:'schedule',name:'Project schedule',description:'Activity code, dates and installation stage',fields:[['Activity ID','Schedule activity'],['Location','Model level'],['Install stage','Field stage']],rows:[['WH07F','6TH FLOOR','Framed'],['WH08B','7TH FLOOR','Boarded'],['WH09T','8TH FLOOR','Taped']]},
    {id:'cost',name:'Cost management',description:'Cost codes, commitments and forecast',fields:[['Cost code','Work package'],['Budget / committed','Cost summary'],['Forecast at completion','Forecast']],rows:[['09-2216','Metal framing','$1,480,000'],['09-2900','Drywall & finish','$1,870,000'],['09-9000','Closeout & contingency','$370,000']]},
    {id:'labour',name:'Internal labour tool',description:'Crew allocation, weekly hours and labour forecast',fields:[['Project reference / week start','Project / reporting week'],['Activity ID / level / cost code','Schedule / model / work package'],['Crew count / regular / overtime hours','Crew and weekly hours'],['Budget / forecast hours / loaded rate','Labour cost included in project cost']],rows:[]},
]);
