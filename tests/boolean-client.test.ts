import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runBoolean} from '../src/geometry/booleanClient.ts';

async function withWorker(check:(env:any)=>Promise<void>){
  const descriptors=['Worker','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
  const timers=new Map<number,{fn:()=>void,ms:number}>();let serial=0;
  class WorkerStub {
    static current:WorkerStub;
    onmessage:any;onerror:any;onmessageerror:any;sent:any[]=[];terminated=false;
    constructor(){WorkerStub.current=this;}
    postMessage(value:any){this.sent.push(value);}
    terminate(){this.terminated=true;}
    reply(data:any){this.onmessage({data});}
  }
  Object.defineProperty(globalThis,'Worker',{value:WorkerStub,configurable:true});
  Object.defineProperty(globalThis,'window',{value:{setTimeout:(fn:()=>void,ms:number)=>{timers.set(++serial,{fn,ms});return serial;},clearTimeout:(id:number)=>timers.delete(id)},configurable:true});
  try{await check({worker:()=>WorkerStub.current,timers});}
  finally{for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
}
test('worker aguarda carregamento antes de enviar cálculo e iniciar prazo de 10 segundos',async()=>withWorker(async({worker,timers})=>{
  const promise=runBoolean([],['a','b'],'union'),w=worker();
  assert.equal(w.sent.length,0);assert.equal([...timers.values()][0].ms,30000);
  w.reply({ready:true});w.reply({ready:true});
  assert.equal(w.sent.length,1);assert.equal(timers.size,1);assert.equal([...timers.values()][0].ms,10000);
  const result={objects:[],resultId:null};w.reply({ok:true,result});
  assert.deepEqual(await promise,result);assert.equal(w.terminated,true);assert.equal(timers.size,0);
}));
test('falhas de carregamento e cálculo são distintas e encerram o worker',async()=>withWorker(async({worker,timers})=>{
  let promise=runBoolean([],[],'union');let rejection=assert.rejects(promise,/não carregou/);
  [...timers.values()][0].fn();await rejection;assert.equal(worker().terminated,true);timers.clear();
  promise=runBoolean([],[],'union');rejection=assert.rejects(promise,/cálculo excedido/);
  worker().reply({ready:true});[...timers.values()][0].fn();await rejection;
  assert.equal(worker().terminated,true);assert.equal(timers.size,0);
}));
test('erros do motor chegam à interface e liberam recursos',async()=>withWorker(async({worker,timers})=>{
  const promise=runBoolean([],[],'union'),rejection=assert.rejects(promise,/módulo indisponível/);
  worker().onerror({message:'módulo indisponível'});await rejection;
  assert.equal(worker().terminated,true);assert.equal(timers.size,0);
}));
