import {test} from 'node:test';
import assert from 'node:assert/strict';
import paper from 'paper';
import {performBoolean,worldCommands} from '../src/geometry/booleanGeometry.ts';
import {booleanSelectionError,type BooleanOperation} from '../src/geometry/booleanSelection.ts';
import {createDocument,createObject,type VectorObject} from '../src/document/model.ts';
import {commandsToSvg,createPathObject,dragHandle} from '../src/geometry/pathGeometry.ts';
import {splitContours,normalizeCommands} from '../src/geometry/compoundPaths.ts';
import {decodePath,encodePath,insertNode,moveNode,removeNode,segmentPoints} from '../src/geometry/nodeGeometry.ts';
import {applyMatrix,rotation,translate,multiply,groupObjects} from '../src/geometry/objectTransforms.ts';
import {createHistory,historyReducer} from '../src/state/history.ts';
import {parseProject,serializeProject} from '../src/document/persistence.ts';
import {fromUnit,toUnit} from '../src/document/units.ts';
const rect=(x:number,y:number,w:number,h:number)=>({...createObject('rectangle',x,y,'#7774e7'),width:w,height:h});
const run=(objects:VectorObject[],op:BooleanOperation)=>performBoolean(objects,objects.map(o=>o.id),op);
function inspect(o:VectorObject){
  const s=new paper.PaperScope();s.setup(new s.Size(1,1));
  const p=new s.CompoundPath({pathData:commandsToSvg(worldCommands(o)),insert:false});p.fillRule=o.fillRule??'nonzero';
  return {area:Math.abs(p.area),contains:(x:number,y:number)=>p.contains(new s.Point(x,y)),done:()=>s.project.remove()};
}
const near=(a:number,b:number,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} ≠ ${b}`);
test('union, subtract, intersect e XOR produzem áreas e regiões esperadas',()=>{
  const shapes=[rect(0,0,100,100),rect(50,0,100,100)];
  const expected={union:15000,subtract:5000,intersect:5000,xor:10000};
  for(const op of Object.keys(expected) as BooleanOperation[]){
    const result=run(shapes,op);assert.equal(result.objects.length,1);
    const saved={...createDocument(),objects:result.objects};
    assert.deepEqual(parseProject(serializeProject(saved)),saved);
    const geometry=inspect(result.objects[0]);near(geometry.area,expected[op]);
    assert.equal(geometry.contains(75,50),op==='union'||op==='intersect');
    geometry.done();assert.deepEqual(shapes.map(o=>o.type),['rectangle','rectangle']);
  }
});
test('aparar respeita empilhamento, preserva estilo inferior e objetos não selecionados',()=>{
  const a={...rect(0,0,100,100),fill:'#ff0000',stroke:'#000000',strokeWidth:3},b=rect(50,0,100,100),other=rect(300,0,10,10);
  const result=performBoolean([other,a,b],[b.id,a.id],'subtract');
  assert.equal(result.objects[0],other);assert.equal(result.objects[1].fill,a.fill);assert.equal(result.objects[1].strokeWidth,3);
  const p=inspect(result.objects[1]);assert.equal(p.contains(25,50),true);assert.equal(p.contains(125,50),false);p.done();
  const reverse=inspect(run([b,a],'subtract').objects[0]);assert.equal(reverse.contains(125,50),true);reverse.done();
});
test('formas disjuntas mantêm múltiplos contornos; interseção vazia é resultado válido',()=>{
  const shapes=[rect(0,0,10,10),rect(20,0,10,10)];
  for(const op of ['union','xor'] as const){const result=run(shapes,op);assert.equal(splitContours(result.objects[0].commands!).length,2);const p=inspect(result.objects[0]);near(p.area,200);p.done();}
  const empty=run(shapes,'intersect');assert.deepEqual(empty.objects,[]);assert.equal(empty.resultId,null);
  const sub=inspect(run(shapes,'subtract').objects[0]);near(sub.area,100);sub.done();
});
test('subtração cria furo real que sobrevive a novas operações e persistência',()=>{
  const ring=run([rect(0,0,100,100),rect(20,20,60,60)],'subtract').objects[0];
  assert.equal(splitContours(ring.commands!).length,2);
  const p=inspect(ring);near(p.area,6400);assert.equal(p.contains(50,50),false);assert.equal(p.contains(10,10),true);p.done();
  const recovered=parseProject(serializeProject({...createDocument(),objects:[ring]})).objects[0];assert.deepEqual(recovered,ring);
  const island=run([recovered,rect(40,40,20,20)],'union').objects[0];
  const q=inspect(island);near(q.area,6800);assert.equal(q.contains(50,50),true);assert.equal(q.contains(30,30),false);q.done();
});
test('even-odd trata furos com mesma orientação e múltiplos operandos',()=>{
  const a=worldCommands(rect(0,0,100,100)),b=worldCommands(rect(20,20,60,60));
  const ring:VectorObject={id:crypto.randomUUID(),type:'path',name:'Anel',...normalizeCommands([...a,...b]),fill:'#7774e7',fillRule:'evenodd'};
  const result=run([ring,rect(40,40,20,20),rect(200,0,10,10)],'union');
  const p=inspect(result.objects[0]);near(p.area,6900);assert.equal(p.contains(30,30),false);p.done();
});
test('elipses e Béziers continuam cúbicas após interseção e transformação',()=>{
  const ellipse={...createObject('ellipse',0,0,'#123456'),width:100,height:100};
  const half=run([ellipse,rect(50,-10,100,120)],'intersect').objects[0];
  assert.ok(half.commands!.some(c=>c.type==='C'));
  const p=inspect(half);near(p.area,Math.PI*2500/2,.001);p.done();
  const curve=createPathObject([dragHandle({x:10,y:10},{x:50,y:0}),{x:80,y:60},{x:10,y:70}],true,'#000000');
  const transformed=applyMatrix([curve,rect(0,0,100,100)],[curve.id],multiply(translate(20,10),rotation(10)));
  const result=run(transformed,'intersect');assert.ok(result.objects[0].commands!.some(c=>c.type==='C'));
});
test('coincidência, contato de bordas e recorte total não deixam objetos inválidos',()=>{
  const a=rect(0,0,100,100),b=rect(0,0,100,100);
  assert.equal(run([a,b],'xor').objects.length,0);assert.equal(run([a,b],'subtract').objects.length,0);
  const result=run([a,rect(100,0,100,100)],'union');const p=inspect(result.objects[0]);near(p.area,20000);p.done();
  assert.equal(run([a,rect(100,0,100,100)],'intersect').objects.length,0);
});
test('nós de contornos separados permanecem independentes após inserir, mover e remover',()=>{
  const ring=run([rect(0,0,100,100),rect(20,20,60,60)],'subtract').objects[0];
  const path=decodePath(ring);assert.equal(path.contours?.length,2);
  const second=path.contours![1],original=path.nodes.slice(second.start);
  const inserted=insertNode(path,path.contours![0].end-1,.5);
  assert.deepEqual(inserted.nodes.slice(inserted.contours![1].start),original);
  assert.equal(segmentPoints(path,path.contours![0].end-1)!.b,path.nodes[0]);
  const moved=moveNode(inserted,0,{x:2,y:2});const removed=removeNode(moved,1);
  const edited={...ring,...encodePath(removed)!};const decoded=decodePath(edited);
  assert.equal(decoded.contours!.length,2);
  assert.doesNotThrow(()=>serializeProject({...createDocument(),objects:[edited]}));
});
test('booleanas são uma entrada no histórico, incluindo resultados vazios',()=>{
  for(const op of ['union','subtract','intersect','xor'] as const){
   for(const offset of [0,10,40]){
    const objects=[rect(0,0,20,20),rect(offset,0,20,20)],document={...createDocument(),objects};
    let state=createHistory(document);const result=run(objects,op);
    state=historyReducer(state,{type:'edit',action:{type:'set-objects',objects:result.objects}});assert.equal(state.past.length,1);
    state=historyReducer(state,{type:'undo'});assert.deepEqual(state.present,document);
    state=historyReducer(state,{type:'redo'});assert.deepEqual(state.present.objects,result.objects);
   }
  }
});
test('milímetros preservam frações e unidade ao salvar, sem quantização da geometria',()=>{
  const width=fromUnit(12.34567,'mm');near(toUnit(width,'mm'),12.34567,1e-12);
  const shapes=[rect(0,0,width,fromUnit(.25,'mm')),rect(width/2,0,width,fromUnit(.25,'mm'))];
  const result=run(shapes,'intersect');const p=inspect(result.objects[0]);near(p.area,width/2*fromUnit(.25,'mm'),1e-8);p.done();
  const document={...createDocument(),unit:'mm' as const,objects:result.objects};assert.deepEqual(parseProject(serializeProject(document)),document);
});
test('seleções inválidas, grupos parciais e excesso de complexidade são rejeitados',()=>{
  const a=rect(0,0,10,10),text=createObject('text',0,0,'#000000'),open=createPathObject([{x:0,y:0},{x:10,y:10}],false,'#000000');
  assert.throws(()=>run([a],'union'));assert.throws(()=>run([a,text],'union'));assert.throws(()=>run([a,open],'union'));
  const b=rect(1,1,10,10),group=groupObjects([a,b],[a.id,b.id],'g');assert.ok(booleanSelectionError([...group,rect(30,0,5,5)],[a.id]));
  assert.throws(()=>run(Array.from({length:65},()=>rect(0,0,1,1)),'union'));
  assert.throws(()=>parseProject(JSON.stringify({...createDocument(),objects:[{...a,fillRule:'invalid'}]})));
});
