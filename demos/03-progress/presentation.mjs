import {addDays,dayMs,STAGE_NAMES} from './p6.mjs';
export const DEMO_DATE='2026-10-12';
export function demoStages(walls,levels){
    const grouped=new Map();for(const w of walls)if(w.externalId){const level=w.level||'Not set';if(!grouped.has(level))grouped.set(level,[]);grouped.get(level).push(w);}
    const order=[...levels.filter(l=>grouped.has(l)),...[...grouped.keys()].filter(l=>!levels.includes(l)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))];
    const out={};order.forEach((level,i)=>{const group=grouped.get(level).sort((a,b)=>a.externalId.localeCompare(b.externalId)),fraction=i/Math.max(1,order.length);
        group.forEach((w,j)=>{const part=j/group.length;const k=fraction<.25?(part<.8?4:3):fraction<.5?(part<.45?3:part<.9?2:1):fraction<.75?(part<.3?2:part<.85?1:0):(part<.2?1:0);if(k)out[w.externalId]=STAGE_NAMES[k];});});return out;
}
export function demoStagesFromSchedule(walls,activities,knownLevels){
    const ordered=[...new Set(activities.map(a=>a.codes?.Location).filter(Boolean))];
    return demoStages(walls,[...ordered,...knownLevels.filter(l=>!ordered.includes(l)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))]);
}
export function lookaheadWeeks(activities,from){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!Number.isFinite(dayMs(from))||new Date(dayMs(from)).toISOString().slice(0,10)!==from)throw Error('Choose a lookahead start date.');
    const open=activities.filter(a=>(a.pct??0)<100),scheduled=open.filter(a=>a.start&&a.finish&&a.start<=a.finish),weeks=[];
    for(let i=0;i<3;i++){const start=addDays(from,i*7),finish=addDays(start,6);weeks.push({start,finish,activities:scheduled.filter(a=>a.start<=finish&&a.finish>=start).sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id))});}
    return{weeks,unscheduled:open.length-scheduled.length,unique:new Set(weeks.flatMap(w=>w.activities.map(a=>a.id))).size};
}
