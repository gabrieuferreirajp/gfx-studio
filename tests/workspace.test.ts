import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultLayout,parseLayout,clampFloating,floatingWidth,dropDock,panelIds} from '../src/workspace/layout.ts';
import {rulerTicks} from '../src/workspace/rulerGeometry.ts';
test('disposição padrão reproduz barras superiores, ferramentas à esquerda e painéis à direita',()=>{
 const s=defaultLayout();assert.equal(s.panels.standard.dock,'top');assert.equal(s.panels.property.dock,'top');assert.equal(s.panels.tools.dock,'left');assert.equal(s.panels.inspector.dock,'right');assert.equal(s.panels.palette.dock,'right');
});
test('personalização é serializável sem alterar documento ou histórico',()=>{
 const s=defaultLayout();s.theme='dark';s.rulers=false;s.inspectorWidth=360;s.panels.tools={dock:'floating',visible:true,x:140,y:250};s.panels.palette.visible=false;
 assert.deepEqual(parseLayout(JSON.stringify(s)),s);
 assert.notEqual(defaultLayout().panels.tools,s.panels.tools);
});
test('preferências corrompidas, antigas e valores fora dos limites têm recuperação segura',()=>{
 for(const source of [null,'broken','{}','{"version":2}'])assert.deepEqual(parseLayout(source),defaultLayout());
 const s=parseLayout(JSON.stringify({version:1,theme:'invalid',inspectorWidth:5000,panels:{tools:{dock:'__proto__',visible:'false',x:-10,y:1e9}}}));
 assert.equal(s.theme,'light');assert.equal(s.inspectorWidth,700);assert.deepEqual(s.panels.tools,{dock:'left',visible:true,x:0,y:10000});assert.equal(Object.keys(s.panels).length,panelIds.length);
});
test('encaixe escolhe bordas e mantém painéis flutuantes alcançáveis após redimensionar janela',()=>{
 assert.equal(dropDock(300,10,1000,600),'top');assert.equal(dropDock(300,590,1000,600),'bottom');assert.equal(dropDock(10,200,1000,600),'left');assert.equal(dropDock(990,200,1000,600),'right');assert.equal(dropDock(300,200,1000,600),'floating');
 assert.deepEqual(clampFloating(900,900,500,300,280),{x:220,y:230});assert.deepEqual(clampFloating(-50,-30,100,50,280),{x:0,y:0});
 for(const id of panelIds){const w=floatingWidth(id,360);assert.ok(clampFloating(5000,0,1280,800,w).x+w<=1280);}
 assert.equal(floatingWidth('inspector',360),360);assert.equal(floatingWidth('tools',360),280);
});
test('réguas mantêm origem, escala e unidades corretas em zoom e pan',()=>{
 for(const zoom of [.1,1,32])for(const unit of ['px','mm'] as const){
  const ticks=rulerTicks(137,zoom,1200,unit);assert.ok(ticks.length<100);
  const zero=ticks.find(t=>t.value===0);assert.equal(zero?.position,137);
  for(const t of ticks)assert.ok(Math.abs(t.position-(137+t.value*zoom*(unit==='mm'?96/25.4:1)))<1e-6);
 }
});
