import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/EditorContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { applyMatrix, around, boundsOf, clipContents, duplicateObjects, identity, inverse, multiply, selectionIds, resizeMatrix, rotation, selectionFrame, transformPoint, translate, type Bounds, type Matrix, type ResizeHandle } from '../geometry/objectTransforms';
import { snapMove, spacingPairs, type Guide, type Spacing, type SpacingPair } from '../geometry/smartGuides';
import type { Point } from '../geometry/pathGeometry';
import type { VectorObject } from '../document/model';
import { isBlocked } from '../document/layers';
import { snapBounds, snapLines } from '../geometry/guides';
import { outlineSnap, snapOutline, snapTargets, type SnapOutline } from '../geometry/objectSnap';

interface Drag { reclick:boolean; pointerId:number; start:Point; objects:VectorObject[]; ids:string[]; handle:string; frame:ReturnType<typeof selectionFrame>; changed:boolean; started:boolean; matrix:Matrix; duplicate:boolean; moving:Bounds; targets:Bounds[]; pairs:{x:SpacingPair[];y:SpacingPair[]}; units:VectorObject[][]; outlines?:{moving:SnapOutline|null;targets:SnapOutline[]} }
export interface ManipulationKeys { shift:boolean; ctrl:boolean; alt:boolean }
const visible=(objects:VectorObject[],ids:string[])=>objects.filter(o=>ids.includes(o.id)&&(!o.clipParent||!ids.includes(o.clipParent)));
export function useObjectManipulation() {
  const { document, selectedIds, tool, chooseObject, select, setSelection, dispatch, beginEdit, commitEdit, clipEdit, viewport, setMessage, recordTransform }=useEditor();
  const { layout }=useWorkspace();
  const manipulationSnapped=useRef({x:false,y:false});
  // O conteúdo de um PowerClip acompanha o quadro, mas a moldura de seleção mostra só o quadro.
  const selected=visible(document.objects,selectedIds);
  const frame=selectionFrame(selected);
  const drag=useRef<Drag|null>(null);
  const [guides,setGuides]=useState<Guide[]>([]);
  const [spacings,setSpacings]=useState<Spacing[]>([]);
  // Ponto onde a seleção encostou no contorno de outro objeto (marcador do encaixe).
  const [contact,setContact]=useState<Point|null>(null);
  // Marca fantasma da posição de origem enquanto arrasta (como no CorelDRAW).
  const [ghost,setGhost]=useState<{objects:VectorObject[];ids:string[]}|null>(null);
  // Como no CorelDRAW: durante o arraste o original fica parado e um contorno azul mostra onde vai ficar; a mudança acontece ao soltar.
  const [preview,setPreview]=useState<VectorObject[]|null>(null);
  const pending=useRef<VectorObject[]|null>(null);
  // Ângulo mostrado junto ao cursor enquanto gira (graus anti-horários, como no CorelDRAW).
  const [rotating,setRotating]=useState<{angle:number;point:Point}|null>(null);
  const [duplicating,setDuplicating]=useState(false);
  // Como no CorelDRAW: clicar de novo no objeto já selecionado alterna entre tamanho e girar/inclinar.
  const [mode,setMode]=useState<'scale'|'rotate'>('scale');
  const selectionKey=selectedIds.join('|');
  // Centro de rotação (CorelDRAW): no modo girar, a bolinha central pode ser arrastada; o giro passa a ser em volta dela.
  // Guardado relativo à moldura (u, v), acompanha o objeto ao mover/girar; volta ao centro ao trocar a seleção.
  const [pivotUV,setPivotUV]=useState<{u:number;v:number}|null>(null);
  useEffect(()=>{setMode('scale');setPivotUV(null);},[selectionKey]);
  const pivotOf=(f:ReturnType<typeof selectionFrame>,uv=pivotUV)=>transformPoint(f.matrix,{x:f.bounds.x+(uv?.u??0.5)*f.bounds.width,y:f.bounds.y+(uv?.v??0.5)*f.bounds.height});
  const pivot=pivotOf(frame);
  // Seleção por arraste: envolve objetos inteiros; com Alt, basta tocar (como no CorelDRAW). Shift adiciona.
  const marqueeRef=useRef<{pointerId:number;start:Point;end:Point;shift:boolean;alt:boolean}|null>(null);
  const [marquee,setMarquee]=useState<{start:Point;end:Point}|null>(null);
  function finishMarquee(){
    const m=marqueeRef.current;if(!m)return;marqueeRef.current=null;setMarquee(null);
    const x1=Math.min(m.start.x,m.end.x),x2=Math.max(m.start.x,m.end.x),y1=Math.min(m.start.y,m.end.y),y2=Math.max(m.start.y,m.end.y);
    if((x2-x1)*viewport.zoom<3&&(y2-y1)*viewport.zoom<3){if(!m.shift)select(null);return;}
    const candidates=document.objects.filter(o=>!isBlocked(document,o)&&(clipEdit?o.clipParent===clipEdit:!o.clipParent));
    const chosen=new Set(m.shift?selectedIds:[]);
    for(const o of candidates){
      const unit=clipEdit?clipContents(document.objects,[o.id]):selectionIds(document.objects,o.id);
      if(unit.some(id=>{const x=document.objects.find(x=>x.id===id);return !!x&&isBlocked(document,x);}))continue;
      const b=boundsOf(visible(document.objects,unit));
      const hit=m.alt?b.x<=x2&&b.x+b.width>=x1&&b.y<=y2&&b.y+b.height>=y1:b.x>=x1&&b.x+b.width<=x2&&b.y>=y1&&b.y+b.height<=y2;
      if(hit)unit.forEach(id=>chosen.add(id));
    }
    setSelection([...chosen]);
  }
  function stop(){
    setRotating(null);
    finishMarquee();setGuides([]);setSpacings([]);setContact(null);setGhost(null);setDuplicating(false);setPreview(null);
    const result=pending.current;pending.current=null;
    const g=drag.current;if(!g)return;drag.current=null;
    if(g.reclick&&!g.started){setMode(m=>m==='scale'?'rotate':'scale');commitEdit();return;}
    if(g.handle==='pivot'){commitEdit();return;}
    // Botão direito durante o arraste (CorelDRAW): o original fica no lugar e a transformação vai para uma cópia.
    if(g.duplicate&&g.changed){
      const result=duplicateObjects(g.objects,g.ids,undefined,g.matrix);
      dispatch({type:'set-objects',objects:result.objects});setSelection(result.ids);
      recordTransform(g.objects,g.ids,g.matrix,result.ids);
      setMessage(`${result.ids.length===1?'Cópia criada':`${result.ids.length} objetos copiados`}. Ctrl+R repete com o mesmo espaçamento. Ctrl+Z desfaz.`);
    }else if(g.changed&&g.started){if(result)dispatch({type:'set-objects',objects:result});recordTransform(g.objects,g.ids,g.matrix);}
    commitEdit();
  }
  useEffect(()=>{stop();},[tool]);
  useEffect(()=>{
    window.addEventListener('blur',stop);window.addEventListener('vectorstudio:finish-gesture',stop);
    return()=>{window.removeEventListener('blur',stop);window.removeEventListener('vectorstudio:finish-gesture',stop);};
  });
  function down(target:Element,point:Point,pointerId:number,shift:boolean){
    const handle=target.closest('[data-transform-handle]')?.getAttribute('data-transform-handle');
    const id=target.closest('[data-object-id]')?.getAttribute('data-object-id');
    let ids=selectedIds;
    const reclick=!shift&&(handle==='move'||(!handle&&!!id&&selectedIds.includes(id)));
    if(!handle){
      if(!id){marqueeRef.current={pointerId,start:point,end:point,shift,alt:false};setMarquee({start:point,end:point});return;}
      if(shift){chooseObject(id,true);return;}
      if(!selectedIds.includes(id))ids=chooseObject(id);
    }
    if(!ids.length)return;
    // Alvos das guias: página e demais objetos visíveis (unidades fora da seleção).
    const moving=boundsOf(visible(document.objects,ids)),others=new Map<string,VectorObject[]>();
    for(const o of document.objects)if(!ids.includes(o.id)&&(clipEdit?o.clipParent===clipEdit:!o.clipParent)){const key=o.groupPath?.[0]??o.id;others.set(key,[...(others.get(key)??[]),o]);}
    const targets=[{x:0,y:0,...document.artboard},...[...others.values()].slice(0,2000).map(unit=>boundsOf(unit))];
    const others2=targets.slice(1);
    beginEdit();drag.current={reclick,pointerId,start:point,objects:document.objects,ids,handle:handle??'move',frame:selectionFrame(visible(document.objects,ids)),changed:false,started:false,matrix:identity(),duplicate:false,moving,targets,pairs:{x:spacingPairs(others2,'x'),y:spacingPairs(others2,'y')},units:[...others.values()]};
  }
  /** Botão direito pressionado durante o arraste: ao soltar, deixa uma cópia (como no CorelDRAW). */
  function markDuplicate(){const g=drag.current;if(!g)return false;g.duplicate=true;setDuplicating(true);return true;}
  /** Como no CorelDRAW: alças de canto mantêm proporções (Alt libera), Shift escala a partir do centro, Ctrl gira em passos de 15°. */
  function move(point:Point,pointerId:number,keys:ManipulationKeys){
    const m=marqueeRef.current;
    if(m&&m.pointerId===pointerId){m.end=point;m.alt=keys.alt;setMarquee({start:m.start,end:point});return;}
    const g=drag.current;if(!g||g.pointerId!==pointerId)return;
    let dx=point.x-g.start.x,dy=point.y-g.start.y;
    // Clique sem arrastar não move nada: só depois de 3 px na tela o gesto vira arraste.
    if(!g.started){if(Math.hypot(dx,dy)*viewport.zoom<3)return;g.started=true;}
    if(Math.hypot(dx,dy)<1e-9){pending.current=null;setPreview(null);g.changed=false;g.matrix=identity();setGuides([]);return;}
    let matrix=translate(dx,dy);
    if(g.handle==='pivot'){
      // Arrastar o centro de rotação: encaixa no centro, nos cantos e nos meios dos lados da moldura (8 px na tela).
      const F=g.frame.matrix,b=g.frame.bounds,inv=inverse(F),q=transformPoint(inv,point);
      let u=(q.x-b.x)/(b.width||1),v=(q.y-b.y)/(b.height||1);
      for(const su of [0,0.5,1])for(const sv of [0,0.5,1]){const w=transformPoint(F,{x:b.x+su*b.width,y:b.y+sv*b.height});if(Math.hypot(w.x-point.x,w.y-point.y)*viewport.zoom<8){u=su;v=sv;}}
      setPivotUV(Math.abs(u-0.5)<1e-9&&Math.abs(v-0.5)<1e-9?null:{u,v});
      return;
    }
    if(g.handle==='move'){
      // Ctrl restringe ao eixo horizontal ou vertical; guias inteligentes encaixam (Alt desliga).
      if(keys.ctrl){if(Math.abs(dx)>Math.abs(dy))dy=0;else dx=0;}
      // Encaixe no contorno real dos outros objetos (retas e curvas): encosta a borda exatamente.
      let touch:{dx:number;dy:number;point:Point}|null=null;
      if(layout.smartGuides&&!keys.alt){
        if(!g.outlines)g.outlines={moving:snapOutline(visible(g.objects,g.ids)),targets:snapTargets(g.units)};
        if(g.outlines.moving){
          // O fantasma (posição de origem) também é alvo, mas só por fora dele: arrastar para o lado encosta na borda do original.
          const m=g.outlines.moving,t=8/viewport.zoom,b=m.box,outside=b.x1+dx>=b.x2-t||b.x2+dx<=b.x1+t||b.y1+dy>=b.y2-t||b.y2+dy<=b.y1+t;
          const moved=Math.hypot(dx,dy)>t;
          touch=outlineSnap(m,outside&&moved?[...g.outlines.targets,m]:g.outlines.targets,dx,dy,t);
        }
        if(touch&&keys.ctrl&&(dx===0?Math.abs(touch.dx)>1e-9:Math.abs(touch.dy)>1e-9))touch=null;
        if(touch){dx+=touch.dx;dy+=touch.dy;}
      }
      setContact(touch?.point??null);
      // Encostado num lado reto, as guias ainda alinham no sentido do lado (deslizar sem perder o contato).
      const freeX=!touch||Math.abs(touch.dx)<1e-9,freeY=!touch||Math.abs(touch.dy)<1e-9;
      if(layout.smartGuides&&!keys.alt){const snap=snapMove({...g.moving,x:g.moving.x+dx,y:g.moving.y+dy},Math.hypot(dx,dy)>8/viewport.zoom?[...g.targets,g.moving]:g.targets,8/viewport.zoom,g.pairs);manipulationSnapped.current={x:snap.dx!==0||snap.guides.some(x=>x.axis==='x')||snap.spacings.some(x=>x.axis==='x'),y:snap.dy!==0||snap.guides.some(x=>x.axis==='y')||snap.spacings.some(x=>x.axis==='y')};if(!freeX){snap.dx=0;snap.guides=snap.guides.filter(x=>x.axis!=='x');snap.spacings=snap.spacings.filter(x=>x.axis!=='x');}if(!freeY){snap.dy=0;snap.guides=snap.guides.filter(x=>x.axis!=='y');snap.spacings=snap.spacings.filter(x=>x.axis!=='y');}manipulationSnapped.current={x:manipulationSnapped.current.x||!freeX,y:manipulationSnapped.current.y||!freeY};if(!keys.ctrl||dy===0)dx+=snap.dx;if(!keys.ctrl||dx===0)dy+=snap.dy;setGuides(snap.guides);setSpacings(snap.spacings.filter(sp=>!keys.ctrl||(sp.axis==='x'?dy===0:dx===0)));}else{setGuides([]);setSpacings([]);}
      // Linhas-guia e grade (Alinhar a): valem no eixo em que as guias dinâmicas não encaixaram.
      if(!keys.alt){const before={dx,dy},smartX=layout.smartGuides&&manipulationSnapped.current.x,smartY=layout.smartGuides&&manipulationSnapped.current.y;const extra=snapBounds({...g.moving,x:g.moving.x+dx,y:g.moving.y+dy},snapLines(document,layout),8/viewport.zoom);if(extra.dx!==null&&!smartX&&(!keys.ctrl||before.dy===0))dx+=extra.dx;if(extra.dy!==null&&!smartY&&(!keys.ctrl||before.dx===0))dy+=extra.dy;}
      matrix=translate(dx,dy);
    }else if(g.handle.startsWith('skew')){
      // Inclinar em torno do centro, no sistema da moldura (acompanha objetos já girados).
      const F=g.frame.matrix,inv=inverse(F),b=g.frame.bounds,a=transformPoint(inv,g.start),c=transformPoint(inv,point),cx=b.x+b.width/2,cy=b.y+b.height/2,side=g.handle.slice(5);
      const snap=(k:number)=>keys.ctrl?Math.tan(Math.round(Math.atan(k)/(Math.PI/12))*(Math.PI/12)):k;
      const horizontal=side==='n'||side==='s',half=horizontal?(side==='n'?b.y-cy:b.y+b.height-cy):(side==='w'?b.x-cx:b.x+b.width-cx);
      const k=snap(Math.max(-20,Math.min(20,(horizontal?c.x-a.x:c.y-a.y)/(half||1))));
      matrix=multiply(F,multiply(around({x:cx,y:cy},horizontal?[1,0,k,1,0,0]:[1,k,0,1,0,0]),inv));
    }else if(g.handle.startsWith('rotate')){
      const c=pivotOf(g.frame);
      let angle=(Math.atan2(point.y-c.y,point.x-c.x)-Math.atan2(g.start.y-c.y,g.start.x-c.x))*180/Math.PI;
      if(keys.ctrl||keys.shift)angle=Math.round(angle/15)*15;
      matrix=around(c,rotation(angle));
      setRotating({angle:((-angle%360)+360)%360,point});
    }else matrix=resizeMatrix(g.frame.bounds,g.frame.matrix,g.handle as ResizeHandle,g.start,point,g.handle.length===2&&!keys.alt,keys.shift);
    const objects=applyMatrix(g.objects,g.ids,matrix);
    if(objects.some(o=>o.transform && (o.transform.some((v,i)=>!Number.isFinite(v)||Math.abs(v)>(i<4?1e6:1e9)) || Math.abs(o.transform[0]*o.transform[3]-o.transform[1]*o.transform[2])<1e-12)))return;
    pending.current=objects;setPreview(objects.filter(o=>clipContents(g.objects,g.ids).includes(o.id)));g.changed=true;g.matrix=multiply(identity(),matrix);
  }
  return {selected,frame,pivot,marquee,guides,spacings,contact,ghost,preview,duplicating,rotating,mode,down,move,stop,markDuplicate,isDragging:()=>drag.current!==null||marqueeRef.current!==null,isTransforming:()=>drag.current!==null};
}
