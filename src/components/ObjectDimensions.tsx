import type { VectorObject } from '../document/model';
import { useEditor } from '../state/EditorContext';
import { applyMatrix, around, boundsOf, clipContents, identity, inverse, localBox, matrixOf, multiply, transformPoint, translate } from '../geometry/objectTransforms';
import { worldCommands } from '../geometry/worldGeometry';
import { fromUnit, toUnit, unitDefinitions, unitStep } from '../document/units';
import { Link2, Unlink2 } from 'lucide-react';
import { useWorkspace } from '../workspace/WorkspaceContext';

/**
 * Posição, tamanho e escala do objeto na barra de propriedades, empilhados como no CorelDRAW:
 * X/Y, largura/altura e porcentagem de escala (100% = tamanho atual; digitar 50 reduz à metade).
 */
export function ObjectDimensions({object:o,objects}:{object?:VectorObject;objects?:VectorObject[]}) {
  const {document,dispatch,commitEdit}=useEditor(),{layout,setLayout}=useWorkspace(),lock=layout.lockRatio;
  const unit=document.unit??'px',short=unitDefinitions[unit].short;
  // Bitmap recortado: medidas da parte visível, como no CorelDRAW.
  // Vários objetos (como no CorelDRAW): medidas da caixa da seleção inteira; mudar largura/altura escala todos juntos.
  const many=!o&&objects&&objects.length>0?objects:null, sel=o?o.id:'selecao';
  const ids=many?clipContents(document.objects,many.map(x=>x.id)):[o!.id];
  const m=many?identity():matrixOf(o!),b=many?boundsOf(many):localBox(o!),origin=transformPoint(m,{x:b.x,y:b.y});
  const values={x:origin.x,y:origin.y,width:b.width*Math.hypot(m[0],m[1]),height:b.height*Math.hypot(m[2],m[3])};
  // Curva sem giro: medidas da geometria real (uma linha reta tem 0 de altura, como no CorelDRAW; a caixa interna tem no mínimo 1 px).
  if(!many&&o&&o.type==='path'&&Math.abs(m[1])<1e-9&&Math.abs(m[2])<1e-9){const pts=worldCommands(o).flatMap(c=>c.type==='Z'?[]:c.type==='C'?[{x:c.x1,y:c.y1},{x:c.x2,y:c.y2},c]:[c]);if(pts.length){const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);values.x=Math.min(...xs);values.y=Math.min(...ys);values.width=Math.max(...xs)-values.x;values.height=Math.max(...ys)-values.y;}}
  const names={x:'Posição X',y:'Posição Y',width:'Largura',height:'Altura'};
  const scaleMatrix=(sx:number,sy:number)=>multiply(m,multiply(around({x:b.x,y:b.y},[sx,0,0,sy,0,0]),inverse(m)));
  // Cadeado (CorelDRAW: Travar proporção): mudar a largura muda a altura na mesma proporção, e vice-versa.
  const toggle=<button type="button" className={`command-icon ratio-lock ${lock?'active':''}`} aria-pressed={lock} aria-label="Travar proporção (largura e altura)" title={lock?'Proporção travada: largura e altura mudam juntas':'Travar proporção'} onClick={()=>setLayout(st=>({...st,lockRatio:!st.lockRatio}))}>{lock?<Link2 size={15}/>:<Unlink2 size={15}/>}</button>;
  const field=(key:keyof typeof values,label:string)=><label className="number-field" key={`${sel}-${key}`} title={names[key]}><span className="field-label">{label}</span><input aria-label={names[key]} type="number" step={unitStep(unit)} min={key==='width'||key==='height'?0.0001:-1000000} max="1000000" value={Number(toUnit(values[key],unit).toPrecision(6))} onChange={e=>{
    if(e.target.value==='')return;const value=fromUnit(Number(e.target.value),unit);if(!Number.isFinite(value)||Math.abs(value)>1e6)return;
    if((key==='width'||key==='height')&&value<=0)return;
    // Linha sem altura (ou sem largura): não há o que esticar nesse sentido.
    if((key==='width'&&values.width<1e-6)||(key==='height'&&values.height<1e-6))return;
    const transform=key==='x'?translate(value-values.x,0):key==='y'?translate(0,value-values.y):(()=>{const k=key==='width'?value/values.width:value/values.height;return scaleMatrix(key==='width'||lock?k:1,key==='height'||lock?k:1);})();
    dispatch({type:'set-objects',objects:applyMatrix(document.objects,ids,transform)});
  }}/><span>{short}</span></label>;
  // Escala em %: aplica ao confirmar (Enter ou sair do campo) e volta a mostrar 100.
  const scale=(axis:'x'|'y')=><label className="number-field scale-field" key={`${sel}-s${axis}`} title={`Escala ${axis==='x'?'horizontal':'vertical'} (%)`}><input aria-label={`Escala ${axis==='x'?'horizontal':'vertical'} em porcentagem`} type="number" min="0.1" max="100000" step="1" key={`${sel}-${values.width}-${values.height}`} defaultValue={100} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}} onBlur={e=>{
    const k=Number(e.target.value.replace(',','.'))/100;
    if(!Number.isFinite(k)||k<=0||Math.abs(k-1)<1e-9){e.target.value='100';return;}
    commitEdit();dispatch({type:'set-objects',objects:applyMatrix(document.objects,ids,scaleMatrix(axis==='x'||lock?k:1,axis==='y'||lock?k:1))});commitEdit();e.target.value='100';
  }}/><span>%</span></label>;
  return <div className="object-dimensions">
    <span className="stacked-fields">{field('x','X:')}{field('y','Y:')}</span>
    <span className="stacked-fields">{field('width','↔')}{field('height','↕')}</span>
    <span className="stacked-fields">{scale('x')}{scale('y')}</span>
    {toggle}
  </div>;
}
