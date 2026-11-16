import type { VectorObject } from '../document/model.ts';
import { remapLinks } from './links.ts';
import type { Point } from './pathGeometry.ts';
import type { EditablePath } from './nodeGeometry.ts';

export type Matrix = [number, number, number, number, number, number];
export const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
export const matrixOf = (o: VectorObject): Matrix => o.transform ?? identity();
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
export const transformPoint = (m: Matrix, p: Point): Point => ({ x: m[0]*p.x+m[2]*p.y+m[4], y: m[1]*p.x+m[3]*p.y+m[5] });
export function inverse(m: Matrix): Matrix {
  const d = m[0]*m[3]-m[1]*m[2];
  if (Math.abs(d) < 1e-12) throw new Error('Transformação não invertível.');
  return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];
}
export const translate = (x: number, y: number): Matrix => [1,0,0,1,x,y];
export function around(point: Point, m: Matrix): Matrix { return multiply(translate(point.x,point.y), multiply(m,translate(-point.x,-point.y))); }
export function rotation(degrees: number): Matrix { const r = degrees*Math.PI/180; return [Math.cos(r),Math.sin(r),-Math.sin(r),Math.cos(r),0,0]; }
export const svgTransform = (o: VectorObject) => `matrix(${matrixOf(o).join(' ')})`;
export const objectAngle = (o: VectorObject) => Math.atan2(matrixOf(o)[1], matrixOf(o)[0])*180/Math.PI;
const wrap180 = (deg: number) => ((deg % 360) + 540) % 360 - 180;
/**
 * Ângulo de rotação no padrão do CorelDRAW: graus no sentido anti-horário, de 0 a 360.
 * Espelhamento não conta como rotação: com a matriz invertida, escolhe o eixo espelhado que dá o menor giro.
 */
export function corelAngle(o: VectorObject): number {
  const [a, b, c, d] = matrixOf(o);
  let screen = Math.atan2(b, a) * 180 / Math.PI;
  if (a * d - b * c < 0) { const flippedX = Math.atan2(-b, -a) * 180 / Math.PI; if (Math.abs(wrap180(flippedX)) < Math.abs(wrap180(screen))) screen = flippedX; }
  const angle = ((-screen % 360) + 360) % 360;
  return angle > 359.9995 || angle < 0.0005 ? 0 : angle;
}
/** Espelhar horizontalmente (esquerda ↔ direita) ou verticalmente em torno de um ponto. */
export const mirror = (center: Point, horizontal: boolean): Matrix => around(center, horizontal ? [-1, 0, 0, 1, 0, 0] : [1, 0, 0, -1, 0, 0]);
export function transformEditablePath(path: EditablePath,m:Matrix): EditablePath {
  return {...path,nodes:path.nodes.map(n=>({...n,...transformPoint(m,n),incoming:n.incoming&&transformPoint(m,n.incoming),outgoing:n.outgoing&&transformPoint(m,n.outgoing)}))};
}
export interface Bounds { x: number; y: number; width: number; height: number }
export function objectCorners(o: VectorObject): Point[] {
  const b=localBox(o);
  return [{ x:b.x,y:b.y },{ x:b.x+b.width,y:b.y },{ x:b.x+b.width,y:b.y+b.height },{ x:b.x,y:b.y+b.height }].map(p=>transformPoint(matrixOf(o),p));
}
/** Caixa local do objeto; bitmap recortado: só a parte visível (como no CorelDRAW). */
export function localBox(o: VectorObject){
  if(o.type!=='image'||!o.crop)return {x:o.x,y:o.y,width:o.width,height:o.height};
  const us:number[]=[],vs:number[]=[];
  for(const c of o.crop){if(c.type==='Z')continue;us.push(c.x);vs.push(c.y);if(c.type==='C'){us.push(c.x1,c.x2);vs.push(c.y1,c.y2);}}
  const u0=Math.max(0,Math.min(...us)),u1=Math.min(1,Math.max(...us)),v0=Math.max(0,Math.min(...vs)),v1=Math.min(1,Math.max(...vs));
  if(!(u1>u0&&v1>v0))return {x:o.x,y:o.y,width:o.width,height:o.height};
  return {x:o.x+u0*o.width,y:o.y+v0*o.height,width:(u1-u0)*o.width,height:(v1-v0)*o.height};
}
export function boundsOf(objects: VectorObject[]): Bounds {
  if (!objects.length) return { x:0,y:0,width:1,height:1 };
  const points=objects.flatMap(objectCorners);
  const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
  const x=Math.min(...xs),y=Math.min(...ys);
  return { x,y,width:Math.max(1e-6,Math.max(...xs)-x),height:Math.max(1e-6,Math.max(...ys)-y) };
}
export function applyMatrix(objects: VectorObject[], ids: string[], m: Matrix): VectorObject[] {
  const set=new Set(ids);
  if (m.every((v,i)=>Math.abs(v-identity()[i])<1e-12)) return objects;
  // "Escala com objeto" (caneta de contorno): a largura acompanha a escala média da transformação.
  const scale=Math.sqrt(Math.abs(m[0]*m[3]-m[1]*m[2]));
  const result=objects.map(o=>set.has(o.id)?reflowParagraph({...o,transform:multiply(m,matrixOf(o)),...(o.symbol?{symbol:{...o.symbol,matrix:multiply(m,o.symbol.matrix)}}:{}),...(o.strokeScale&&o.strokeWidth?{strokeWidth:Math.min(1000,o.strokeWidth*scale)}:{})}):o);
  if(result.some(o=>o.transform && (o.transform.some((v,i)=>!Number.isFinite(v)||Math.abs(v)>(i<4?1e6:1e9)) || Math.abs(o.transform[0]*o.transform[3]-o.transform[1]*o.transform[2])<1e-12)))return objects;
  return result;
}
/**
 * Texto de parágrafo sem giro nem espelho: redimensionar muda o quadro (o texto se reorganiza sem distorcer),
 * como no CorelDRAW. Com giro/inclinação, a matriz continua valendo.
 */
function reflowParagraph(o: VectorObject): VectorObject {
  const t=o.transform;
  if(o.type!=='text'||!o.paragraph||o.textPath||!t||Math.abs(t[1])>1e-9||Math.abs(t[2])>1e-9||t[0]<=0||t[3]<=0)return o;
  const {transform:_t,...rest}=o;
  return {...rest,x:t[0]*o.x+t[4],y:t[3]*o.y+t[5],width:Math.max(1,o.width*t[0]),height:Math.max(1,o.height*t[3])};
}
/** Quadro PowerClip mais externo que contém o objeto (ou o próprio objeto). */
export function clipRoot(objects: VectorObject[], o: VectorObject): VectorObject {
  let current=o;
  for(let depth=0;current.clipParent&&depth<32;depth++){const parent=objects.find(p=>p.id===current.clipParent);if(!parent)break;current=parent;}
  return current;
}
/** Conteúdo travado de quadros PowerClip, recursivamente. */
export function clipContents(objects: VectorObject[], ids: string[]): string[] {
  const result=new Set(ids);
  for(let changed=true;changed;){changed=false;for(const o of objects)if(o.clipParent&&!result.has(o.id)&&result.has(o.clipParent)&&!objects.find(p=>p.id===o.clipParent)?.clipUnlocked){result.add(o.id);changed=true;}}
  return [...result];
}
const unitKey=(objects: VectorObject[], o: VectorObject)=>{const root=clipRoot(objects,o);return root.groupPath?.[0]??root.id;};
export function selectionIds(objects: VectorObject[], id: string): string[] {
  const found=objects.find(o=>o.id===id);
  if (!found) return [];
  const o=clipRoot(objects,found), group=o.groupPath?.[0];
  return clipContents(objects,group?objects.filter(o=>o.groupPath?.[0]===group).map(o=>o.id):[o.id]);
}
export function toggleSelection(objects: VectorObject[], current: string[], id: string, shift: boolean): string[] {
  const unit=selectionIds(objects,id);
  if (!shift) return unit;
  return unit.every(id=>current.includes(id))?current.filter(id=>!unit.includes(id)):[...new Set([...current,...unit])];
}
export function groupObjects(objects: VectorObject[], ids: string[], groupId: string): VectorObject[] {
  const set=new Set(ids), chosen=objects.filter(o=>set.has(o.id));
  if (chosen.length<2 || new Set(chosen.map(o=>o.groupPath?.[0]??o.id)).size<2 || chosen.some(o=>(o.groupPath?.length??0)>=32)) return objects;
  const top=Math.max(...objects.map((o,i)=>set.has(o.id)?i:-1));
  const grouped=chosen.map(o=>({...o,groupPath:[groupId,...(o.groupPath??[])]}));
  return objects.flatMap((o,i)=>i===top?grouped:set.has(o.id)?[]:[o]);
}
export function ungroupObjects(objects: VectorObject[], ids: string[]): VectorObject[] {
  const groups=new Set(objects.filter(o=>ids.includes(o.id)).map(o=>o.groupPath?.[0]).filter(Boolean));
  return objects.map(o=>{if(!groups.has(o.groupPath?.[0]))return o;const next={...o};if(o.groupPath!.length>1)next.groupPath=o.groupPath!.slice(1);else delete next.groupPath;return next;});
}
/** Desagrupar tudo (CorelDRAW): desfaz todos os níveis de grupo dos objetos escolhidos, inclusive grupos dentro de grupos. */
export function ungroupAll(objects: VectorObject[], ids: string[]): VectorObject[] {
  const groups=new Set(objects.filter(o=>ids.includes(o.id)).map(o=>o.groupPath?.[0]).filter(Boolean));
  return objects.map(o=>{if(!groups.has(o.groupPath?.[0]))return o;const {groupPath:_g,...rest}=o;return rest;});
}
/** Cópias dos objetos (novos IDs de objeto, grupo e PowerClip) com a matriz `offset` aplicada, acima dos originais. */
export function duplicateObjects(objects: VectorObject[], ids: string[], uuid=()=>crypto.randomUUID(), offset: Matrix=translate(20,20)) {
  if(objects.length+objects.filter(o=>ids.includes(o.id)).length>10000)return {objects,ids};
  const groupIds=new Map<string,string>();
  const newIds=new Map(objects.filter(o=>ids.includes(o.id)).map(o=>[o.id,uuid()]));
  const copies=objects.filter(o=>ids.includes(o.id)).map(o=>({...structuredClone(o),id:newIds.get(o.id)!,...(o.clipParent?{clipParent:newIds.get(o.clipParent)??o.clipParent}:{}),transform:multiply(offset,matrixOf(o)),...(o.groupPath?{groupPath:o.groupPath.map(id=>{ if(!groupIds.has(id))groupIds.set(id,uuid());return groupIds.get(id)!; })}:{})})).map(o=>o.symbol?{...o,symbol:{...o.symbol,matrix:multiply(offset,o.symbol.matrix),instance:groupIds.get(o.symbol.instance)??o.symbol.instance}}:o).map(o=>remapLinks(o,id=>newIds.get(id)));
  return {objects:[...objects,...copies],ids:copies.map(o=>o.id)};
}
export type Order = 'front'|'back'|'forward'|'backward';
export function orderObjects(objects: VectorObject[], ids: string[], order: Order): VectorObject[] {
  // Treat each outer group as one stacking unit.
  const units: VectorObject[][]=[];
  for(const o of objects) { const last=units.at(-1); if(last && unitKey(objects,o)===unitKey(objects,last[0]) && (o.groupPath?.[0] || o.clipParent)) last.push(o); else units.push([o]); }
  const selected=(unit:VectorObject[])=>unit.some(o=>ids.includes(o.id));
  if(order==='front')return [...units.filter(u=>!selected(u)),...units.filter(selected)].flat();
  if(order==='back')return [...units.filter(selected),...units.filter(u=>!selected(u))].flat();
  if(order==='forward') { for(let i=units.length-2;i>=0;i--)if(selected(units[i])&&!selected(units[i+1]))[units[i],units[i+1]]=[units[i+1],units[i]]; }
  else { for(let i=1;i<units.length;i++)if(selected(units[i])&&!selected(units[i-1]))[units[i],units[i-1]]=[units[i-1],units[i]]; }
  return units.flat();
}
export type Alignment = 'left'|'center'|'right'|'top'|'middle'|'bottom';
/**
 * Alinha unidades da seleção entre si; com uma única unidade, alinha à referência (página), como no CorelDRAW.
 * Com `anchorId`, a unidade desse objeto (o último selecionado) fica parada e as demais se alinham a ela.
 */
export function alignObjects(objects: VectorObject[], ids: string[], alignment: Alignment, reference?: Bounds, anchorId?: string): VectorObject[] {
  const selected=objects.filter(o=>ids.includes(o.id));
  const units=new Map<string,VectorObject[]>();
  for(const o of selected){const key=unitKey(objects,o);units.set(key,[...(units.get(key)??[]),o]);}
  if(units.size<2&&!reference)return objects;
  const visible=(unit:VectorObject[])=>unit.filter(o=>!o.clipParent||!unit.some(p=>p.id===o.clipParent))
  const anchor=anchorId&&ids.includes(anchorId)?units.get(unitKey(objects,objects.find(o=>o.id===anchorId)!)):undefined;
  const total=units.size<2?reference!:anchor?boundsOf(visible(anchor)):boundsOf(visible(selected));
  let result=objects;
  for(const unit of units.values()) {
    const b=boundsOf(visible(unit));
    const dx=alignment==='left'?total.x-b.x:alignment==='center'?total.x+total.width/2-b.x-b.width/2:alignment==='right'?total.x+total.width-b.x-b.width:0;
    const dy=alignment==='top'?total.y-b.y:alignment==='middle'?total.y+total.height/2-b.y-b.height/2:alignment==='bottom'?total.y+total.height-b.y-b.height:0;
    result=applyMatrix(result,unit.map(o=>o.id),translate(dx,dy));
  }
  return result;
}
export type Distribution = 'distLeft'|'distCenterX'|'distRight'|'distSpaceX'|'distTop'|'distCenterY'|'distBottom'|'distSpaceY';
export const distributionLabels: Record<Distribution,string> = { distLeft:'Distribuir pelas esquerdas', distCenterX:'Distribuir pelos centros horizontais', distRight:'Distribuir pelas direitas', distSpaceX:'Espaçamento horizontal igual', distTop:'Distribuir pelos topos', distCenterY:'Distribuir pelos centros verticais', distBottom:'Distribuir pelas bases', distSpaceY:'Espaçamento vertical igual' };
/**
 * Distribuir (CorelDRAW, "estender da seleção"): os objetos das pontas ficam parados e os do meio
 * são reposicionados para que bordas/centros fiquem equidistantes, ou para que os vãos fiquem iguais.
 */
export function distributeObjects(objects: VectorObject[], ids: string[], mode: Distribution): VectorObject[] {
  const units=new Map<string,VectorObject[]>();
  for(const o of objects.filter(o=>ids.includes(o.id))){const key=unitKey(objects,o);units.set(key,[...(units.get(key)??[]),o]);}
  if(units.size<3)return objects;
  const horizontal=mode.endsWith('X')||mode==='distLeft'||mode==='distRight';
  const items=[...units.values()].map(unit=>({unit,b:boundsOf(unit.filter(o=>!o.clipParent||!unit.some(p=>p.id===o.clipParent)))}));
  const start=(b:Bounds)=>horizontal?b.x:b.y,size=(b:Bounds)=>horizontal?b.width:b.height;
  const key=(b:Bounds)=>mode==='distLeft'||mode==='distTop'?start(b):mode==='distRight'||mode==='distBottom'?start(b)+size(b):start(b)+size(b)/2;
  let result=objects;
  const move=(unit:VectorObject[],d:number)=>{if(Math.abs(d)>1e-9)result=applyMatrix(result,unit.map(o=>o.id),horizontal?translate(d,0):translate(0,d));};
  if(mode==='distSpaceX'||mode==='distSpaceY'){
    items.sort((a,b)=>start(a.b)-start(b.b));
    const first=start(items[0].b),last=Math.max(...items.map(i=>start(i.b)+size(i.b))),gap=(last-first-items.reduce((s,i)=>s+size(i.b),0))/(items.length-1);
    let cursor=first;for(const i of items){move(i.unit,cursor-start(i.b));cursor+=size(i.b)+gap;}
    return result;
  }
  items.sort((a,b)=>key(a.b)-key(b.b));
  const a=key(items[0].b),z=key(items.at(-1)!.b);
  items.forEach((i,n)=>move(i.unit,a+(z-a)*n/(items.length-1)-key(i.b)));
  return result;
}
export type ResizeHandle = 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w';
export function selectionFrame(objects: VectorObject[]): { bounds: Bounds; matrix: Matrix } {
  return objects.length===1?{bounds:objects[0],matrix:matrixOf(objects[0])}:{bounds:boundsOf(objects),matrix:identity()};
}
export function resizeMatrix(bounds: Bounds, frame: Matrix, handle: ResizeHandle, start: Point, end: Point, proportional: boolean, fromCenter=false): Matrix {
  const inv=inverse(frame), a=transformPoint(inv,start), b=transformPoint(inv,end);
  const horizontal=handle.includes('e')?1:handle.includes('w')?-1:0;
  const vertical=handle.includes('s')?1:handle.includes('n')?-1:0;
  const k=fromCenter?2:1;
  let sx=horizontal?Math.max(.001,1+k*horizontal*(b.x-a.x)/bounds.width):1;
  let sy=vertical?Math.max(.001,1+k*vertical*(b.y-a.y)/bounds.height):1;
  if(proportional){const s=!horizontal?sy:!vertical?sx:Math.abs(sx-1)>Math.abs(sy-1)?sx:sy;sx=s;sy=s;}
  const anchor=fromCenter?{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2}:{x:bounds.x+(horizontal===1?0:horizontal===-1?bounds.width:bounds.width/2),y:bounds.y+(vertical===1?0:vertical===-1?bounds.height:bounds.height/2)};
  return multiply(frame,multiply(around(anchor,[sx,0,0,sy,0,0]),inv));
}
