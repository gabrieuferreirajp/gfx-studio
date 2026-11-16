import {unitScale,type DocumentUnit} from '../document/units.ts';
export function rulerTicks(origin:number,zoom:number,length:number,unit:DocumentUnit){
 const scale=zoom*unitScale(unit),ideal=70/scale,power=10**Math.floor(Math.log10(ideal));
 const step=([1,2,5,10].find(n=>n*power>=ideal)??10)*power;
 const first=Math.floor(-origin/scale/step),last=Math.ceil((length-origin)/scale/step);
 return Array.from({length:Math.min(500,Math.max(0,last-first+1))},(_,i)=>{const value=(first+i)*step;return {value:Number(value.toPrecision(8)),position:origin+value*scale,step:step*scale};});
}
