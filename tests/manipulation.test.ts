import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDocument,createObject,type VectorObject} from '../src/document/model.ts';
import {createPathObject,dragHandle} from '../src/geometry/pathGeometry.ts';
import {decodePath,encodePath,moveNode} from '../src/geometry/nodeGeometry.ts';
import {alignObjects,applyMatrix,around,boundsOf,duplicateObjects,groupObjects,identity,inverse,matrixOf,multiply,objectAngle,objectCorners,orderObjects,resizeMatrix,rotation,selectionFrame,selectionIds,toggleSelection,transformPoint,translate,ungroupObjects,type Alignment,type ResizeHandle} from '../src/geometry/objectTransforms.ts';
import {parseProject,serializeProject} from '../src/document/persistence.ts';
import {createHistory,historyReducer,isDirty} from '../src/state/history.ts';
import {screenToDocument} from '../src/document/viewport.ts';
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-6,`${a} ≠ ${b}`);
const pointNear=(a:{x:number;y:number},b:{x:number;y:number})=>{near(a.x,b.x);near(a.y,b.y);};
function shapes():VectorObject[]{
  return [createObject('rectangle',20,30,'#7774e7'),createObject('ellipse',200,80,'#222222'),createObject('text',400,200,'#000000'),createPathObject([{x:100,y:300},{x:250,y:320}],false,'#000000','Linha'),createPathObject([dragHandle({x:400,y:100},{x:450,y:150}),{x:550,y:200}],false,'#7774e7')].map(o=>({...o,width:100,height:60}));
}
test('matrizes compostas e inversas preservam coordenadas de todos os tipos',()=>{
  const m=multiply(translate(100,-200),multiply(rotation(37),[2,0,.3,.5,0,0]));
  for(const o of shapes())for(const p of objectCorners(o))pointNear(transformPoint(inverse(m),transformPoint(m,p)),p);
});
test('oito alças redimensionam em referencial rotacionado, mantendo a âncora oposta',()=>{
  const o=shapes()[0];
  o.transform=around({x:70,y:60},rotation(35));
  const frame=selectionFrame([o]),b=frame.bounds;
  for(const h of ['nw','n','ne','e','se','s','sw','w'] as ResizeHandle[]){
    const x=h.includes('e')?1:h.includes('w')?0:.5,y=h.includes('s')?1:h.includes('n')?0:.5;
    const start=transformPoint(frame.matrix,{x:b.x+b.width*x,y:b.y+b.height*y});
    const end=transformPoint(frame.matrix,{x:b.x+b.width*x+(x===0?-30:x===1?30:0),y:b.y+b.height*y+(y===0?-20:y===1?20:0)});
    const anchor=transformPoint(frame.matrix,{x:b.x+b.width*(1-x),y:b.y+b.height*(1-y)});
    const m=resizeMatrix(b,frame.matrix,h,start,end,false);
    pointNear(transformPoint(m,anchor),anchor);
    assert.ok(Number.isFinite(m[0]));
    const proportional=resizeMatrix(b,frame.matrix,h,start,end,true);
    const next=applyMatrix([o],[o.id],proportional)[0],a=objectCorners(next);
    near(Math.hypot(a[1].x-a[0].x,a[1].y-a[0].y)/Math.hypot(a[3].x-a[0].x,a[3].y-a[0].y),o.width/o.height);
  }
});
test('redimensionar múltiplos objetos rotacionados preserva geometria vetorial com escala afim',()=>{
  const objects=shapes();objects[0].transform=rotation(45);
  const frame=selectionFrame(objects),b=frame.bounds;
  const m=resizeMatrix(b,frame.matrix,'se',{x:b.x+b.width,y:b.y+b.height},{x:b.x+b.width*2,y:b.y+b.height*1.5},false);
  const result=applyMatrix(objects,objects.map(o=>o.id),m);
  result.forEach((o,i)=>{
    assert.equal(o.type,objects[i].type);assert.equal(o.id,objects[i].id);assert.deepEqual(o.commands,objects[i].commands);assert.equal(o.text,objects[i].text);
    objectCorners(o).forEach((p,j)=>pointNear(p,transformPoint(m,objectCorners(objects[i])[j])));
  });
});
test('rotação usa centro fixo e campo de ângulo pode definir orientação absoluta',()=>{
  const o=shapes()[0],center={x:o.x+o.width/2,y:o.y+o.height/2};
  const first=applyMatrix([o],[o.id],around(center,rotation(25)))[0];
  const second=applyMatrix([first],[o.id],around(center,rotation(90-objectAngle(first))))[0];
  near(objectAngle(second),90);pointNear(transformPoint(matrixOf(second),center),center);
});
test('Shift alterna seleção de objetos e grupos sem IDs repetidos',()=>{
  const objects=shapes(),ids=objects.map(o=>o.id);
  let selected=toggleSelection(objects,[],ids[0],false);
  selected=toggleSelection(objects,selected,ids[1],true);assert.deepEqual(selected,ids.slice(0,2));
  selected=toggleSelection(objects,selected,ids[0],true);assert.deepEqual(selected,[ids[1]]);
  const grouped=groupObjects(objects,ids.slice(0,2),'group-a');
  assert.deepEqual(selectionIds(grouped,ids[0]),ids.slice(0,2));
  assert.deepEqual(toggleSelection(grouped,ids.slice(0,2),ids[1],true),[]);
});
test('agrupar mantém ordem relativa, grupos contíguos e hierarquia ao desagrupar',()=>{
  const objects=shapes(),ids=objects.map(o=>o.id);
  const first=groupObjects(objects,[ids[0],ids[2]],'inner');
  assert.deepEqual(first.map(o=>o.id),[ids[1],ids[0],ids[2],ids[3],ids[4]]);
  const second=groupObjects(first,[ids[0],ids[2],ids[3]],'outer');
  assert.deepEqual(second.find(o=>o.id===ids[0])!.groupPath,['outer','inner']);
  const ungrouped=ungroupObjects(second,[ids[0],ids[2],ids[3]]);
  assert.deepEqual(ungrouped.find(o=>o.id===ids[0])!.groupPath,['inner']);
  assert.equal(ungrouped.find(o=>o.id===ids[3])!.groupPath,undefined);
  assert.doesNotThrow(()=>serializeProject({...createDocument(),objects:ungrouped}));
});
test('duplicação cria IDs novos para objetos e grupos, com geometria e estilo independentes',()=>{
  const objects=shapes(),ids=objects.map(o=>o.id),grouped=groupObjects(objects,ids,'group');
  const result=duplicateObjects(grouped,ids);
  assert.equal(result.objects.length,10);assert.equal(new Set(result.objects.map(o=>o.id)).size,10);
  const copies=result.objects.slice(5);
  assert.notEqual(copies[0].groupPath![0],'group');assert.equal(new Set(copies.map(o=>o.groupPath![0])).size,1);
  copies.forEach((o,i)=>{pointNear(objectCorners(o)[0],{x:objectCorners(grouped[i])[0].x+20,y:objectCorners(grouped[i])[0].y+20});assert.deepEqual(o.commands,grouped[i].commands);});
  assert.notEqual(copies[4].commands,grouped[4].commands);
  assert.deepEqual(parseProject(serializeProject({...createDocument(),objects:result.objects})).objects,result.objects);
});
test('ordem visual avança e recua unidades mantendo grupos e seleções estáveis',()=>{
  const objects=shapes(),ids=objects.map(o=>o.id);
  assert.deepEqual(orderObjects(objects,[ids[1],ids[2]],'forward').map(o=>o.id),[ids[0],ids[3],ids[1],ids[2],ids[4]]);
  assert.deepEqual(orderObjects(objects,[ids[1],ids[2]],'backward').map(o=>o.id),[ids[1],ids[2],ids[0],ids[3],ids[4]]);
  assert.deepEqual(orderObjects(objects,[ids[1]],'front').map(o=>o.id),[ids[0],ids[2],ids[3],ids[4],ids[1]]);
  assert.deepEqual(orderObjects(objects,[ids[3]],'back').map(o=>o.id),[ids[3],ids[0],ids[1],ids[2],ids[4]]);
  const grouped=groupObjects(objects,[ids[1],ids[2]],'group');
  assert.deepEqual(orderObjects(grouped,[ids[1],ids[2]],'forward').map(o=>o.id),[ids[0],ids[3],ids[1],ids[2],ids[4]]);
});
test('seis alinhamentos consideram caixas transformadas e grupos como uma unidade',()=>{
  const objects=shapes(),ids=objects.map(o=>o.id);objects[1].transform=rotation(30);
  for(const alignment of ['left','center','right','top','middle','bottom'] as Alignment[]){
    const aligned=alignObjects(objects,ids,alignment),total=boundsOf(objects);
    aligned.forEach(o=>{const b=boundsOf([o]);
      if(alignment==='left')near(b.x,total.x);if(alignment==='center')near(b.x+b.width/2,total.x+total.width/2);if(alignment==='right')near(b.x+b.width,total.x+total.width);
      if(alignment==='top')near(b.y,total.y);if(alignment==='middle')near(b.y+b.height/2,total.y+total.height/2);if(alignment==='bottom')near(b.y+b.height,total.y+total.height);
    });
  }
  const grouped=groupObjects(objects,ids.slice(0,2),'group'),aligned=alignObjects(grouped,ids,'left');
  const before=objectCorners(grouped.find(o=>o.id===ids[1])!)[0].x-objectCorners(grouped.find(o=>o.id===ids[0])!)[0].x;
  const after=objectCorners(aligned.find(o=>o.id===ids[1])!)[0].x-objectCorners(aligned.find(o=>o.id===ids[0])!)[0].x;
  near(before,after);
});
test('editar nós após rotação, escala e deslocamento mantém o ponteiro no lugar certo',()=>{
  const o=shapes()[4];o.transform=multiply(translate(200,-100),multiply(rotation(40),[2,0,.5,.8,0,0]));
  const path=decodePath(o),desired={x:700,y:450};
  for(const zoom of [.1,1,32]){
    const view={x:-50,y:70,zoom};
    const world=screenToDocument(view,desired.x*zoom+view.x,desired.y*zoom+view.y);
    const local=transformPoint(inverse(matrixOf(o)),world);
    const next={...o,...encodePath(moveNode(path,0,local))!};
    pointNear(transformPoint(matrixOf(next),decodePath(next).nodes[0]),desired);
  }
});
test('histórico agrupa arrastes e desfaz agrupamento, duplicação, ordem e alinhamento',()=>{
  const document={...createDocument(),objects:shapes()},ids=document.objects.map(o=>o.id);
  let state=historyReducer(createHistory(document),{type:'begin'});
  for(let i=1;i<=100;i++)state=historyReducer(state,{type:'edit',action:{type:'set-objects',objects:applyMatrix(document.objects,ids,translate(i,20))}});
  state=historyReducer(state,{type:'commit'});assert.equal(state.past.length,1);
  state=historyReducer(state,{type:'undo'});assert.deepEqual(state.present,document);assert.equal(isDirty(state),false);
  state=historyReducer(state,{type:'redo'});assert.equal(isDirty(state),true);
  for(const objects of [groupObjects(document.objects,ids,'group'),duplicateObjects(document.objects,ids).objects,orderObjects(document.objects,[ids[0]],'front'),alignObjects(document.objects,ids,'left')]){
    const before=state.present;state=historyReducer(state,{type:'edit',action:{type:'set-objects',objects}});
    state=historyReducer(state,{type:'undo'});assert.deepEqual(state.present,before);state=historyReducer(state,{type:'redo'});assert.deepEqual(state.present.objects,objects);
  }
});
test('persistência recupera transformações e grupos e rejeita matrizes/hierarquias inválidas',()=>{
  const objects=shapes(),ids=objects.map(o=>o.id),transformed=applyMatrix(groupObjects(objects,ids,'group'),ids,multiply(translate(50,80),rotation(25)));
  const document={...createDocument(),objects:transformed};assert.deepEqual(parseProject(serializeProject(document)),document);
  for(const transform of [[0,0,0,0,0,0],[1,0,0,1],[1,0,0,1,'1',0],[1e20,0,0,1,0,0]])assert.throws(()=>parseProject(JSON.stringify({...document,objects:[{...objects[0],transform}]})));
  for(const groupPath of [[],['x','x'],[ids[0]],Array(33).fill('x')])assert.throws(()=>parseProject(JSON.stringify({...document,objects:[{...objects[0],groupPath}]})));
  assert.throws(()=>parseProject(JSON.stringify({...document,objects:[{...objects[0],groupPath:['g']},objects[1],{...objects[2],groupPath:['g']}]})));
  assert.equal(applyMatrix(objects,ids,[0,0,0,0,0,0]),objects);
  assert.doesNotThrow(()=>serializeProject({...createDocument(),objects}));
});
