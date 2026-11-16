import type { VectorObject } from '../document/model.ts';
import type { BooleanOperation, BooleanResult } from './booleanGeometry.ts';
export function runBoolean(objects:VectorObject[],ids:string[],operation:BooleanOperation|'outline'|'contour'|'sweep'|'cut',params?:unknown):Promise<BooleanResult> {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./boolean.worker.ts',import.meta.url),{type:'module'});
    // Loading Vite modules on a cold start is not geometry calculation time.
    let timer=window.setTimeout(()=>{worker.terminate();reject(new Error('O motor vetorial não carregou. Confira o terminal do servidor e tente novamente.'));},30000);
    let started=false;
    const finish=()=>{window.clearTimeout(timer);worker.terminate();};
    worker.onmessage=event=>{
      if(event.data.ready){
        if(started)return;
        started=true;window.clearTimeout(timer);
        timer=window.setTimeout(()=>{finish();reject(new Error('Tempo de cálculo excedido. Simplifique a seleção e tente novamente.'));},10000);
        try {worker.postMessage({objects,ids,operation,params});}catch(error){finish();reject(error);}
        return;
      }
      finish();if(event.data.ok)resolve(event.data.result);else reject(new Error(event.data.error));
    };
    worker.onerror=event=>{finish();reject(new Error(`Falha no motor vetorial: ${event.message||'não foi possível carregar o cálculo'}. O documento foi preservado.`));};
    worker.onmessageerror=()=>{finish();reject(new Error('Resposta inválida do motor vetorial. O documento foi preservado.'));};
  });
}
