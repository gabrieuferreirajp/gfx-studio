import type { VectorObject } from '../document/model.ts';
import { splitContours } from './compoundPaths.ts';
export type BooleanOperation = 'union' | 'subtract' | 'intersect' | 'xor' | 'simplify' | 'frontMinusBack' | 'backMinusFront' | 'boundary';
/** Ordem da janela Modelagem do CorelDRAW (Objeto › Modelar). */
export const booleanLabels:Record<BooleanOperation,string>={union:'Soldar',subtract:'Aparar',intersect:'Interseção',xor:'Diferença (XOR)',simplify:'Simplificar',frontMinusBack:'Frente menos trás',backMinusFront:'Trás menos frente',boundary:'Criar limite'};
/**
 * Operandos da modelagem: a seleção sem o conteúdo de PowerClips cujo quadro também está selecionado
 * (o quadro entra na operação e o conteúdo passa para o resultado, no mesmo lugar).
 */
export function booleanOperandIds(objects:VectorObject[], ids:string[]):string[] {
  const chosen=new Set(ids),byId=new Map(objects.map(o=>[o.id,o]));
  const insideSelected=(o:VectorObject)=>{let p=o.clipParent;for(let d=0;p&&d<32;d++){if(chosen.has(p))return true;p=byId.get(p)?.clipParent;}return false;};
  return ids.filter(id=>{const o=byId.get(id);return !!o&&!insideSelected(o);});
}
/** Conteúdo dos quadros consumidos passa para o objeto que os substitui (null: o resultado ficou vazio e o conteúdo sai junto). */
export function adoptClipContents(objects:VectorObject[], replaced:Map<string,string|null>):VectorObject[] {
  if(![...replaced.keys()].some(id=>objects.some(o=>o.clipParent===id)))return objects;
  const owner=new Map<string,string|null>();
  for(let changed=true;changed;){changed=false;for(const o of objects){if(owner.has(o.id)||!o.clipParent)continue;const from=replaced.has(o.clipParent)?replaced.get(o.clipParent)!:owner.get(o.clipParent);if(from!==undefined){owner.set(o.id,from);changed=true;}}}
  const unlocked=new Set([...replaced].filter(([id])=>objects.some(o=>o.id===id&&o.clipUnlocked)).map(([,to])=>to));
  const moved=new Map<string,VectorObject[]>();
  for(const o of objects){const to=owner.get(o.id);if(to===undefined||to===null)continue;const list=moved.get(to)??[];list.push(replaced.has(o.clipParent!)?{...o,clipParent:to}:o);moved.set(to,list);}
  return objects.filter(o=>!owner.has(o.id)).flatMap(o=>moved.has(o.id)?[unlocked.has(o.id)?{...o,clipUnlocked:true}:o,...moved.get(o.id)!]:[o]);
}
export function booleanSelectionError(objects:VectorObject[], all:string[]):string | null {
  const ids=booleanOperandIds(objects,all),selected=objects.filter(o=>ids.includes(o.id));
  if(selected.length<2)return 'Selecione duas ou mais formas fechadas com Shift + clique.';
  if(selected.length>64)return 'Limite de 64 formas por operação.';
  if(selected.some(o=>o.type==='text'||o.type==='image'||o.clipParent!==undefined||(o.type==='path'&&(!o.commands?.length||splitContours(o.commands).some(c=>c.at(-1)?.type!=='Z')))))return 'Use retângulos, elipses ou caminhos fechados (quadros PowerClip também); textos, bitmaps, objetos dentro de PowerClip e caminhos abertos não são aceitos.';
  if(selected.reduce((sum,o)=>sum+(o.commands?.length??17),0)>2500)return 'Seleção muito complexa: limite de 2.500 comandos por operação.';
  if(booleanGroupPath(objects,ids)===null)return 'Selecione objetos do mesmo grupo, o grupo inteiro, ou desagrupe (Ctrl+U).';
  return null;
}

/**
 * Grupo em que o resultado da booleana fica: o grupo comum aos objetos, sem os níveis totalmente selecionados.
 * null quando a seleção pega parte de grupos diferentes (o resultado não teria um lugar coerente).
 */
export function booleanGroupPath(objects:VectorObject[], ids:string[]):string[]|null {
  const selected=objects.filter(o=>ids.includes(o.id));
  let prefix=selected[0]?.groupPath??[];
  for(const o of selected){const path=o.groupPath??[];let i=0;while(i<prefix.length&&prefix[i]===path[i])i++;prefix=prefix.slice(0,i);}
  const full=(group:string)=>objects.filter(o=>o.groupPath?.includes(group)).every(o=>ids.includes(o.id));
  while(prefix.length&&full(prefix.at(-1)!))prefix=prefix.slice(0,-1);
  for(const o of selected)for(const group of (o.groupPath??[]).slice(prefix.length))if(!full(group))return null;
  return prefix;
}
