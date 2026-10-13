// Display preferences and illustrative cost data. Never changes model/schedule quantities.
export const DEMO_COSTS=Object.freeze({budget:3600000,committed:2840000,spent:1420000,forecast:3720000});
export function costSummary(values=DEMO_COSTS){
    const valid=Object.fromEntries(['budget','committed','spent','forecast'].map(k=>[k,Number(values[k])]));
    if(Object.values(valid).some(v=>!Number.isFinite(v)||v<0))throw Error('Cost values must be non-negative numbers.');
    return{...valid,variance:valid.forecast-valid.budget,variancePct:valid.budget?(valid.forecast-valid.budget)/valid.budget*100:null};
}
export function clampSplit(value,width){
    const number=Number(value),requested=Number.isFinite(number)?number:.54;
    if(!Number.isFinite(width)||width<600)return Math.min(.72,Math.max(.28,requested));
    return Math.min(Math.min(.72,1-300/width),Math.max(Math.max(.28,280/width),requested));
}
export const INTEGRATIONS=Object.freeze([
    {id:'revit',name:'Revit / BIM',description:'Model identity, level, wall ID and revision',fields:[['Element Unique ID','Model element'],['Level name','Schedule location'],['Revision','Model revision']],rows:[['RVT-DEMO-1001','6TH FLOOR','WH07F'],['RVT-DEMO-1002','7TH FLOOR','WH08B'],['RVT-DEMO-1003','8TH FLOOR','WH09T']]},
    {id:'schedule',name:'Project schedule',description:'Activity code, dates and installation stage',fields:[['Activity ID','Schedule activity'],['Location','Model level'],['Install stage','Field stage']],rows:[['WH07F','6TH FLOOR','Framed'],['WH08B','7TH FLOOR','Boarded'],['WH09T','8TH FLOOR','Taped']]},
    {id:'cost',name:'Cost management',description:'Cost codes, commitments and forecast',fields:[['Cost code','Work package'],['Budget / committed','Cost summary'],['Forecast at completion','Forecast']],rows:[['09-2216','Metal framing','$1,480,000'],['09-2900','Drywall & finish','$1,870,000'],['09-9000','Closeout & contingency','$370,000']]},
]);
