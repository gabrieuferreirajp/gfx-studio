import paper from 'paper';
import type { PathCommand, VectorObject } from '../document/model.ts';
import { commandsToSvg, mapCommands } from './pathGeometry.ts';
import { matrixOf } from './objectTransforms.ts';
import { normalizeCommands } from './compoundPaths.ts';
import { parseProject } from '../document/persistence.ts';

import { adoptClipContents, booleanGroupPath, booleanOperandIds, booleanSelectionError, booleanLabels, type BooleanOperation } from './booleanSelection.ts';
export type { BooleanOperation } from './booleanSelection.ts';
export { worldCommands } from './worldGeometry.ts';
import { worldCommands } from './worldGeometry.ts';
export function resultCommands(item:paper.PathItem):PathCommand[] {
  const paths=item instanceof paper.CompoundPath?item.children as paper.Path[]:[item as paper.Path];
  const commands:PathCommand[]=[];
  for(const path of paths){
    const segments=path.segments;
    if(segments.length<2||Math.abs(path.area)<1e-12)continue;
    commands.push({type:'M',x:segments[0].point.x,y:segments[0].point.y});
    for(let i=0;i<segments.length;i++){
      const a=segments[i],b=segments[(i+1)%segments.length],c1=a.point.add(a.handleOut),c2=b.point.add(b.handleIn);
      if(a.handleOut.isZero()&&b.handleIn.isZero())commands.push({type:'L',x:b.point.x,y:b.point.y});
      else commands.push({type:'C',x1:c1.x,y1:c1.y,x2:c2.x,y2:c2.y,x:b.point.x,y:b.point.y});
    }
    commands.push({type:'Z'});
  }
  return commands;
}
export interface BooleanResult { objects:VectorObject[]; resultId:string|null; /** Simplificar devolve vários objetos. */ resultIds?:string[] }
/** Converte o resultado do Paper.js (espaço normalizado) em caminho do documento com o estilo de `base`. */
function toObject(result:paper.PathItem,base:VectorObject,name:string,groupPath:string[],box:{x:number;y:number},scale:number,style?:Partial<VectorObject>):VectorObject|null {
  // Normalize winding for nonzero SVG fill: islands agree, holes run opposite.
  result.reorient(false,true);
  const commands=resultCommands(result);
  if(commands.length>10000)throw new Error('Resultado excede o limite de 10.000 comandos.');
  if(!commands.length)return null;
  const world=mapCommands(commands,p=>({x:p.x/scale+box.x,y:p.y/scale+box.y})),worldBox=normalizeCommands(world);
  const m=matrixOf(base),stroke=style?.strokeWidth!==undefined?style.strokeWidth:(base.strokeWidth??0)*Math.sqrt(Math.abs(m[0]*m[3]-m[1]*m[2]));
  const storageScale=Math.min(1,9000/Math.max(worldBox.width,worldBox.height),stroke?1000/stroke:1);
  const geometry=normalizeCommands(mapCommands(world,p=>({x:(p.x-worldBox.x)*storageScale,y:(p.y-worldBox.y)*storageScale})));
  const strokeColor=style?.stroke??base.stroke,hasWidth=style?.strokeWidth!==undefined||base.strokeWidth!==undefined;
  return {
    id:crypto.randomUUID(),type:'path',name,...geometry,
    fill:style?.fill??base.fill,fillRule:'nonzero',
    ...(strokeColor!==undefined?{stroke:strokeColor}:{}),
    ...(hasWidth?{strokeWidth:stroke*storageScale}:{}),
    transform:[1/storageScale,0,0,1/storageScale,worldBox.x,worldBox.y],
    ...(groupPath.length?{groupPath}:{}),
  };
}
const unite=(items:paper.PathItem[])=>items.slice(1).reduce((a,b)=>a.unite(b,{insert:false}),items[0]);
/**
 * Operações de modelagem do CorelDRAW. A ordem de `selected` é a do empilhamento (o primeiro fica atrás).
 * Soldar/Aparar/Interseção/XOR/Trás menos frente/Frente menos trás substituem os operandos por um caminho;
 * Simplificar recorta cada objeto pelos que estão na frente e mantém todos; Criar limite acrescenta o contorno da união.
 */
export function performBoolean(objects:VectorObject[],all:string[],operation:BooleanOperation):BooleanResult {
  if(!Object.hasOwn(booleanLabels,operation))throw new Error('Operação desconhecida.');
  const error=booleanSelectionError(objects,all);if(error)throw new Error(error);
  const ids=booleanOperandIds(objects,all);
  const selected=objects.filter(o=>ids.includes(o.id)),groupPath=booleanGroupPath(objects,ids)??[];
  const input=selected.map(worldCommands);
  const box=normalizeCommands(input.flat());
  const span=Math.max(box.width,box.height),scale=1000/span;
  const scope=new paper.PaperScope();scope.setup(new scope.Size(1,1));
  try {
    const operands=input.map((commands,i)=>{
      const normalized=mapCommands(commands,p=>({x:(p.x-box.x)*scale,y:(p.y-box.y)*scale}));
      const path=new scope.CompoundPath({pathData:commandsToSvg(normalized),insert:false});
      path.fillRule=selected[i].fillRule??'nonzero';
      return path;
    });
    const validate=(output:VectorObject[])=>parseProject(JSON.stringify({version:1,id:'boolean-validation',name:'Boolean',artboard:{width:1,height:1},objects:output}));
    if(operation==='simplify'){
      // Cada objeto perde as partes cobertas pelos que estão na frente; estilos e ordem são mantidos.
      const results=new Map<string,VectorObject|null>();
      selected.forEach((o,i)=>{const above=operands.slice(i+1),shape=above.length?operands[i].subtract(unite(above),{insert:false}):operands[i];results.set(o.id,toObject(shape,o,o.name,o.groupPath??[],box,scale));});
      const output=adoptClipContents(objects.flatMap(o=>results.has(o.id)?(results.get(o.id)?[results.get(o.id)!]:[]):[o]),new Map([...results].map(([id,r])=>[id,r?.id??null])));
      validate(output);const resultIds=[...results.values()].filter((o):o is VectorObject=>!!o).map(o=>o.id);
      return {objects:output,resultId:resultIds[0]??null,resultIds};
    }
    if(operation==='boundary'){
      // Novo objeto sem preenchimento com contorno preto ao redor de toda a seleção, acima dela; os originais ficam.
      const top=selected.at(-1)!,object=toObject(unite(operands),top,booleanLabels[operation],groupPath,box,scale,{fill:'none',stroke:'#000000',strokeWidth:1});
      const output=objects.flatMap(o=>o.id===top.id&&object?[o,object]:[o]);
      validate(output);return {objects:output,resultId:object?.id??null};
    }
    // Frente menos trás: o objeto da frente é recortado pelos de trás e fica com o estilo e a posição dele.
    const front=operation==='frontMinusBack',order=front?[...operands].reverse():operands,base=front?selected.at(-1)!:selected[0];
    let result:paper.PathItem=order[0];
    for(const operand of order.slice(1)) {
      result=operation==='union'?result.unite(operand,{insert:false}):operation==='intersect'?result.intersect(operand,{insert:false}):operation==='xor'?result.exclude(operand,{insert:false}):result.subtract(operand,{insert:false});
    }
    const object=toObject(result,base,booleanLabels[operation],groupPath,box,scale);
    // Keep the base operand's stacking position and style; replace selected operands atomically.
    // PowerClip: o conteúdo dos quadros usados fica onde está e passa a ser recortado pelo resultado.
    const output=adoptClipContents(objects.flatMap(o=>o.id===base.id?(object?[object]:[]):ids.includes(o.id)?[]:[o]),new Map(selected.map(o=>[o.id,object?.id??null])));
    validate(output);
    return {objects:output,resultId:object?.id??null};
  } finally { scope.project.remove(); }
}
