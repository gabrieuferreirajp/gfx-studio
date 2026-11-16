// Run after npm run build. Exercises the shipped worker without DOM/canvas APIs.
import {readFileSync,readdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const assets=new URL('../dist/assets/',import.meta.url);
const filename=readdirSync(assets).find(name=>/^boolean\.worker-.*\.js$/.test(name));
assert.ok(filename,'Execute npm.cmd run build primeiro.');
let response;
const context={console,crypto,setTimeout,clearTimeout,setInterval:(fn,ms)=>setInterval(fn,ms).unref(),clearInterval,TextEncoder,navigator:{userAgent:'Worker smoke test'},postMessage:value=>{response=value;}};
context.self=context;
runInNewContext(readFileSync(new URL(filename,assets),'utf8'),context,{timeout:10000});
assert.equal(response.ready,true,'Worker deve anunciar que terminou de carregar.');
const objects=[0,50].map((x,i)=>({id:`r${i}`,name:'Rectangle',type:'rectangle',x,y:0,width:100,height:100,fill:'#7774e7'}));
for(const operation of ['union','subtract','intersect','xor']){
 context.onmessage({data:{objects,ids:['r0','r1'],operation}});
 assert.equal(response.ok,true,response.error);
 assert.equal(response.result.objects.length,1);
 assert.equal(response.result.objects[0].type,'path');
}
for(const [operation,count] of [['frontMinusBack',1],['backMinusFront',1],['simplify',2],['boundary',3]]){
 context.onmessage({data:{objects,ids:['r0','r1'],operation}});
 assert.equal(response.ok,true,response.error);
 assert.equal(response.result.objects.length,count,operation);
}
// Ferramentas de corte (Faca) no mesmo worker.
context.onmessage({data:{objects:[objects[0]],ids:['r0'],operation:'cut',params:{operation:'knife',params:{knife:{a:{x:50,y:-10},b:{x:50,y:110}}}}}});
assert.equal(response.ok,true,response.error);
assert.equal(response.result.objects.length,2);
context.onmessage({data:{objects,ids:['r0'],operation:'union'}});
assert.equal(response.ok,false);
console.log('Worker compilado: oito operações de modelagem, faca e rejeição de seleção inválida aprovadas, sem DOM/canvas.');
