import {useEffect,useRef,useState} from 'react';
import {useEditor} from '../state/EditorContext';
import {rulerTicks} from './rulerGeometry';
import {unitDefinitions} from '../document/units';
import {useWorkspace} from './WorkspaceContext';
import {addGuide} from '../geometry/guides';
import {screenToDocument} from '../document/viewport';
import {finishEditing} from '../state/useProjectFiles';
/** Réguas; arrastar da régua superior cria uma guia horizontal, da esquerda uma vertical (como no CorelDRAW). */
export function Rulers(){
 const {viewport,document,dispatch,commitEdit,setMessage}=useEditor(),{setLayout}=useWorkspace(),ref=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:0,height:0});
 const [draft,setDraft]=useState<{axis:'x'|'y';screen:number;inside:boolean}|null>(null),drag=useRef<{axis:'x'|'y';pointerId:number}|null>(null);
 useEffect(()=>{const el=ref.current!;const observer=new ResizeObserver(()=>setSize({width:el.clientWidth,height:el.clientHeight}));observer.observe(el);return()=>observer.disconnect();},[]);
 const unit=document.unit??'px';
 const local=(e:React.PointerEvent)=>{const r=ref.current!.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
 const start=(axis:'x'|'y')=>(e:React.PointerEvent<SVGRectElement>)=>{if(e.button!==0)return;finishEditing();drag.current={axis,pointerId:e.pointerId};e.currentTarget.setPointerCapture(e.pointerId);const p=local(e);setDraft({axis,screen:axis==='x'?p.x:p.y,inside:false});};
 const move=(e:React.PointerEvent)=>{const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;const p=local(e);setDraft({axis:d.axis,screen:d.axis==='x'?p.x:p.y,inside:p.x>19&&p.y>19&&p.x<size.width&&p.y<size.height});};
 const end=(e:React.PointerEvent)=>{const d=drag.current;if(!d)return;drag.current=null;const p=local(e),inside=p.x>19&&p.y>19&&p.x<size.width&&p.y<size.height;setDraft(null);
  if(!inside||e.type!=='pointerup')return;const doc=screenToDocument(viewport,p.x,p.y);
  commitEdit();dispatch({type:'set-guides',guides:addGuide(document.guides,d.axis,d.axis==='x'?doc.x:doc.y)});commitEdit();setLayout(s=>s.guides?s:{...s,guides:true});setMessage('Linha-guia criada · arraste-a para mover; solte na régua para excluir.');};
 const hit=(axis:'x'|'y')=>({onPointerDown:start(axis),onPointerMove:move,onPointerUp:end,onPointerCancel:end,className:`ruler-hit ruler-hit-${axis}`});
 return <div ref={ref} className="canvas-rulers"><svg width="100%" height="100%" aria-hidden="true"><rect width="100%" height="19"/><rect width="19" height="100%"/>{rulerTicks(viewport.x,viewport.zoom,size.width,unit).map(t=><g key={`x${t.value}`}><path d={`M${t.position} 12v7 M${t.position+t.step/2} 15v4`}/><text x={t.position+3} y="10">{t.value}</text></g>)}{rulerTicks(viewport.y,viewport.zoom,size.height,unit).map(t=><g key={`y${t.value}`}><path d={`M12 ${t.position}h7 M15 ${t.position+t.step/2}h4`}/><text transform={`translate(10 ${t.position-3}) rotate(-90)`}>{t.value}</text></g>)}<rect width="19" height="19"/><text x="2" y="12">{unitDefinitions[unit].short}</text>
  {/* Faixas sensíveis: régua superior → guia horizontal (eixo y); régua esquerda → guia vertical (eixo x). */}
  <rect x="19" y="0" width="100%" height="19" fill="transparent" {...hit('y')}><title>Arraste para criar uma linha-guia horizontal</title></rect>
  <rect x="0" y="19" width="19" height="100%" fill="transparent" {...hit('x')}><title>Arraste para criar uma linha-guia vertical</title></rect>
  {draft&&<line className={`guide-draft ${draft.inside?'':'outside'}`} x1={draft.axis==='x'?draft.screen:0} x2={draft.axis==='x'?draft.screen:size.width} y1={draft.axis==='y'?draft.screen:0} y2={draft.axis==='y'?draft.screen:size.height}/>}
 </svg></div>;
}
