// Editing presentation only. Geometry, exchange units and fabrication rounding remain authoritative in the resolver.
import { parseFeetInches } from '../02-takeoff/criteria.mjs';
export const DIMENSION_FORMATS=Object.freeze([
    ['feet-inches','Feet + inches'],['decimal-feet','Feet (decimal)'],
    ['decimal-inches','Inches (decimal)'],['fractional-inches','Inches (fraction)']
]);
export const cleanDimensionFormat=value=>DIMENSION_FORMATS.some(([key])=>key===value)?value:'feet-inches';
const decimal=n=>String(Number(n.toFixed(8)));
export function formatEditDimension(value,mode='feet-inches'){
    if(!Number.isFinite(value))return '';
    mode=cleanDimensionFormat(mode);
    if(mode==='decimal-feet')return decimal(value/12)+"'";
    if(mode==='decimal-inches')return decimal(value)+'"';
    const ticks=Math.round(Math.abs(value)*64),sign=value<0&&ticks?'-':'',feet=mode==='feet-inches'?Math.floor(ticks/768):0,rest=ticks-feet*768,whole=Math.floor(rest/64);
    let n=rest%64,d=64;while(n&&n%2===0){n/=2;d/=2;}
    return `${sign}${mode==='feet-inches'?`${feet}'-`:''}${whole}${n?` ${n}/${d}`:''}"`;
}
// Explicit units always win. Bare numbers retain the existing inch convention, except in Decimal feet mode.
export function parseEditDimension(text,mode,parseInches=parseFeetInches){
    let s=String(text??'').replace(/\b(?:feet|foot|ft)\b/gi,"'").replace(/\b(?:inches|inch|in)\b/gi,'"').trim();
    if(!s)return null;
    const sign=s.startsWith('-')?-1:1;s=s.replace(/^[+-]\s*/,'');
    const n=parseInches(s);if(n==null||!Number.isFinite(n))return null;
    return sign*n*(mode==='decimal-feet'&&!/['"′’“”″]/.test(s)?12:1);
}
