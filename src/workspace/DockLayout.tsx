import {useEffect,useRef,useState,type ReactNode,type PointerEvent} from 'react';
import {GripVertical,X,Layers2} from 'lucide-react';
import {useWorkspace} from './WorkspaceContext';
import {clampFloating,floatingWidth,dropDock,dockNames,panelIds,panelNames,MIN_PANEL,MAX_PANEL,type Dock,type PanelId} from './layout';
import {finishEditing} from '../state/useProjectFiles';
type Resize={id:PanelId;clientX:number;clientY:number;width:number;height:number;sign:number;floating:boolean};
export function DockLayout({panels,children}:{panels:Record<PanelId,ReactNode>;children:ReactNode}){
 const {layout,setLayout,setPanel}=useWorkspace(),root=useRef<HTMLDivElement>(null);
 const [size,setSize]=useState({width:1000,height:600});
 const [drag,setDrag]=useState<{id:PanelId;x:number;y:number;dock:Dock}|null>(null);
 const start=useRef<{id:PanelId;clientX:number;clientY:number;offsetX:number;offsetY:number}|null>(null);
 const resize=useRef<Resize|null>(null);
 useEffect(()=>{const el=root.current!;const observer=new ResizeObserver(()=>setSize({width:el.clientWidth,height:el.clientHeight}));observer.observe(el);return()=>observer.disconnect();},[]);
 const widthOf=(id:PanelId)=>floatingWidth(id,layout.inspectorWidth,layout.panels[id].size);
 function point(e:PointerEvent){const rect=root.current!.getBoundingClientRect();return {x:e.clientX-rect.left,y:e.clientY-rect.top};}
 function move(e:PointerEvent){const s=start.current;if(!s)return;const p=point(e);setDrag({id:s.id,x:p.x-s.offsetX,y:p.y-s.offsetY,dock:dropDock(p.x,p.y,size.width,size.height)});}
 function end(e:PointerEvent){const s=start.current;if(!s)return;start.current=null;
  if(e.type==='pointerup'&&Math.hypot(e.clientX-s.clientX,e.clientY-s.clientY)>5){const p=point(e);setPanel(s.id,{dock:dropDock(p.x,p.y,size.width,size.height),...clampFloating(p.x-s.offsetX,p.y-s.offsetY,size.width,size.height,widthOf(s.id))});}
  setDrag(null);
 }
 function resizeMove(e:PointerEvent){
  const r=resize.current;if(!r)return;
  const width=Math.round(Math.max(r.id==='inspector'?230:MIN_PANEL,Math.min(r.id==='inspector'?700:MAX_PANEL,r.width+r.sign*(e.clientX-r.clientX))));
  if(r.id==='inspector')setLayout(s=>({...s,inspectorWidth:width}));else setPanel(r.id,{size:width});
  if(r.floating)setPanel(r.id,{height:Math.round(Math.max(60,Math.min(2000,r.height+e.clientY-r.clientY)))});
 }
 function resizer(id:PanelId,dock:Dock){
  if(layout.locked||dock==='top'||dock==='bottom')return null;
  const sign=dock==='right'?-1:1;
  return <div className={`dock-resizer resizer-${dock}`} role="separator" aria-orientation="vertical" aria-label={`Redimensionar ${panelNames[id]}`} title="Arraste para redimensionar · Duplo clique: tamanho padrão" onDoubleClick={()=>{if(id==='inspector')setLayout(s=>({...s,inspectorWidth:280}));else setPanel(id,{size:undefined,height:undefined});}}
   onPointerDown={e=>{if(e.button!==0)return;finishEditing();const rect=e.currentTarget.closest('section')!.getBoundingClientRect();resize.current={id,clientX:e.clientX,clientY:e.clientY,width:rect.width,height:rect.height,sign,floating:dock==='floating'};e.currentTarget.setPointerCapture(e.pointerId);}}
   onPointerMove={resizeMove} onPointerUp={()=>{resize.current=null;}} onPointerCancel={()=>{resize.current=null;}} onLostPointerCapture={()=>{resize.current=null;}}/>;
 }
 function panel(id:PanelId){const p=layout.panels[id];const floating=p.dock==='floating',pos=clampFloating(p.x,p.y,size.width,size.height,widthOf(id));
  const side=p.dock==='left'||p.dock==='right';
  const width=id==='inspector'&&(side||floating)?layout.inspectorWidth:(side||floating)&&p.size?p.size:undefined;
  if(id==='inspector'&&p.dock==='right')return docker(id,width);
  return <section key={id} className={`dock-panel panel-${id} ${floating?'is-floating':''} ${p.size?'is-sized':''}`} style={{...(floating?{left:pos.x,top:pos.y}:{}),...(width?{width}:{}),...(floating&&p.height?{height:p.height,maxHeight:'none'}:{})}} aria-label={panelNames[id]}>
   <div className="dock-handle"><button className="dock-grip" disabled={layout.locked} aria-label={`Mover ${panelNames[id]}`} title={layout.locked?'Barras travadas (Janela › Travar barras de ferramentas)':'Arraste para mover; aproxime de uma borda para encaixar'} onPointerDown={e=>{if(e.button!==0||layout.locked)return;finishEditing();const rect=e.currentTarget.closest('section')!.getBoundingClientRect();start.current={id,clientX:e.clientX,clientY:e.clientY,offsetX:e.clientX-rect.left,offsetY:e.clientY-rect.top};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={()=>{start.current=null;setDrag(null);}}><GripVertical size={13}/><span>{panelNames[id]}</span></button>
   {!layout.locked&&<><select aria-label={`Encaixar ${panelNames[id]}`} title="Posição da barra" value={p.dock} onChange={e=>{finishEditing();setPanel(id,{dock:e.target.value as Dock});}}>{Object.entries(dockNames).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select>
   <button className="dock-close" aria-label={`Ocultar ${panelNames[id]}`} title="Ocultar; reabra no menu Janela" onClick={()=>{finishEditing();setPanel(id,{visible:false});}}><X size={12}/></button></>}</div>
   <div className="dock-content">{panels[id]}</div>
   {resizer(id,p.dock)}
  </section>;
 }
 /** Janela encaixada à direita no estilo CorelDRAW: aba vertical Objetos (camadas e objetos) que abre e fecha o painel. */
 function docker(id:PanelId,width?:number){
  const open=layout.inspectorOpen;
  const show=()=>{finishEditing();setLayout(s=>({...s,inspectorOpen:!open}));};
  const tabs=<div className="docker-tabs" role="tablist" aria-orientation="vertical" aria-label="Janelas encaixadas">
   <button role="tab" aria-label="Objetos" aria-selected={open} title={open?'Fechar Objetos':'Abrir Objetos e camadas (Alt+Enter)'} onClick={show}><Layers2 size={15}/><span>Objetos</span></button>
  </div>;
  return <div key={id} className={`docker-host ${open?'is-open':''}`}>
   {open&&<section className={`dock-panel panel-${id}`} style={width?{width}:undefined} aria-label={panelNames[id]}>
    <div className="dock-handle"><button className="dock-grip" disabled={layout.locked} aria-label={`Mover ${panelNames[id]}`} title={layout.locked?'Barras travadas (Janela › Travar barras de ferramentas)':'Arraste para mover; aproxime de uma borda para encaixar'} onPointerDown={e=>{if(e.button!==0||layout.locked)return;finishEditing();const rect=e.currentTarget.closest('section')!.getBoundingClientRect();start.current={id,clientX:e.clientX,clientY:e.clientY,offsetX:e.clientX-rect.left,offsetY:e.clientY-rect.top};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={()=>{start.current=null;setDrag(null);}}><GripVertical size={13}/><span>{panelNames[id]}</span></button>
     <button className="dock-close" aria-label={`Recolher ${panelNames[id]}`} title="Recolher (as abas continuam visíveis)" onClick={()=>{finishEditing();setLayout(s=>({...s,inspectorOpen:false}));}}><X size={12}/></button></div>
    <div className="dock-content">{panels[id]}</div>
    {resizer(id,'right')}
   </section>}
   {tabs}
  </div>;
 }
 function slot(dock:Dock){return panelIds.filter(id=>layout.panels[id].visible&&layout.panels[id].dock===dock).map(panel);}
 return <div className="dock-layout" ref={root}>
  <div className="dock-top">{slot('top')}</div><div className="dock-left">{slot('left')}</div>
  <div className="document-workspace">{children}</div><div className="dock-right">{slot('right')}</div><div className="dock-bottom">{slot('bottom')}</div>
  {slot('floating')}
  {drag&&<div className={`dock-drop-preview drop-${drag.dock}`} style={drag.dock==='floating'?{left:drag.x,top:drag.y}:undefined}>{dockNames[drag.dock]} — solte para posicionar</div>}
 </div>;
}
