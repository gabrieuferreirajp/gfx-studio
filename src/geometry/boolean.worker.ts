import { performBoolean, type BooleanOperation } from './booleanGeometry';
import { performOutline } from './outlineGeometry';
import { performContour, performSweep } from './effectsGeometry';
import type { ContourParams, SweepParams } from './effects';
import type { VectorObject } from '../document/model';
import { performCut, type CutOperation, type CutParams } from './cutGeometry';
export type WorkerOperation = BooleanOperation | 'outline' | 'contour' | 'sweep' | 'cut';
self.onmessage=(event:MessageEvent<{objects:VectorObject[];ids:string[];operation:WorkerOperation;params?:unknown}>)=>{
  try {
    const {objects,ids,operation,params}=event.data;
    const result=operation==='cut'?performCut(objects,ids,(params as {operation:CutOperation}).operation,(params as {params:CutParams}).params):operation==='outline'?performOutline(objects,ids):operation==='contour'?performContour(objects,ids,params as ContourParams):operation==='sweep'?performSweep(objects,ids,params as SweepParams):performBoolean(objects,ids,operation);
    self.postMessage({ok:true,result});
  }
  catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:'Falha na operação vetorial.'});}
};
self.postMessage({ready:true});
