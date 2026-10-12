// Explicit exporter contract only. Never infer framing from a vendor template name.
export const FRAMING_FIELDS = ['cutbackIn','deflectionGapIn','seatPieces','headEnds','headCutbackIn','sillEnds','sillCutbackIn'];
const own = (o,k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const DEFAULTS = { cutbackIn:1/16, deflectionGapIn:0, seatPieces:true, headEnds:'overlap', headCutbackIn:0, sillEnds:'overlap', sillCutbackIn:0 };
export function sourceFraming(panel) {
    const data=panel?.revit?.framingSettings;
    if(data==null) return null;
    if(data.version!==1 || data.unit!=='in') throw Error('Revit framing settings require version 1 and unit "in"; convert native units in the exporter.');
    const values={};
    for(const key of FRAMING_FIELDS) {
        if(!own(data.values,key)) continue;
        const v=data.values[key];
        const valid=key==='seatPieces' ? typeof v==='boolean' : key.endsWith('Ends') ? ['overlap','flush'].includes(v)
            : typeof v==='number' && Number.isFinite(v) && v>=0 && v<=(key==='deflectionGapIn'?12:1);
        if(!valid) throw Error(`Revit framing settings: invalid ${key}.`);
        values[key]=v;
    }
    return { values, templateName:String(data.template?.name || panel.revit.templateName || '').slice(0,120),
        templateId:String(data.template?.id || '').slice(0,120) };
}
export function inheritSourceFraming(panel) {
    const source=sourceFraming(panel);
    if(!source) return panel;
    const out={...panel}, origins={};
    for(const key of FRAMING_FIELDS) {
        if(!own(source.values,key)) continue;
        if((!own(panel,key) || panel[key]==null || panel[key]==='') && panel.framingOrigins?.[key]==='web') { out[key]=DEFAULTS[key]; origins[key]='web'; }
        else if(!own(panel,key) || panel[key]==null || panel[key]==='') { out[key]=source.values[key]; origins[key]='revit'; }
        else origins[key]=panel.framingOrigins?.[key]==='revit' && panel[key]===source.values[key] ? 'revit' : 'web';
    }
    out.framingOrigins=origins;
    return out;
}
export function framingOrigin(panel,key) {
    const source=sourceFraming(panel);
    return source && own(source.values,key) && panel.framingOrigins?.[key]==='revit' && (!own(panel,key) || panel[key]===source.values[key]) ? 'Revit' : panel.framingOrigins?.[key]==='web' || own(panel,key) ? 'Web override' : 'Default';
}
