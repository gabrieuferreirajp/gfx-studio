import {useEffect,useRef,useState} from 'react';
import {useEditor} from '../state/EditorContext';
import {traceBitmap,type TraceOptions,type TracedLayer} from '../bitmap/bitmapTrace';
import {traceCenterline,type CenterlineOptions,type CenterlineResult} from '../bitmap/centerlineTrace';
import {commandsToSvg} from '../geometry/pathGeometry';
import type {PathCommand,VectorObject} from '../document/model';
// Tipos do Rastreio do contorno do CorelDRAW (PowerTRACE), com as configurações equivalentes.
export const tracePresets={
 lineart:{label:'Arte de linha',detail:1400,options:{colors:2,smoothing:45,cornerAngle:60,removeBackground:true,despeckle:1}},
 logo:{label:'Logotipo',detail:1400,options:{colors:6,smoothing:35,cornerAngle:55,removeBackground:true,despeckle:1}},
 detailedLogo:{label:'Logotipo detalhado',detail:1600,options:{colors:12,smoothing:25,cornerAngle:60,removeBackground:true,despeckle:1}},
 clipart:{label:'Clipart',detail:1400,options:{colors:16,smoothing:30,cornerAngle:65,removeBackground:true,despeckle:1}},
 lowQuality:{label:'Imagem de baixa qualidade',detail:900,options:{colors:12,smoothing:60,cornerAngle:75,removeBackground:false,despeckle:2}},
 highQuality:{label:'Imagem de alta qualidade',detail:1600,options:{colors:32,smoothing:10,cornerAngle:80,removeBackground:false,despeckle:0}},
} satisfies Record<string,{label:string;detail:number;options:TraceOptions}>;
export type TracePreset=keyof typeof tracePresets;
export interface TraceSettings {options:TraceOptions;detail:number;keepOriginal:boolean}
let lastTrace:TraceSettings|null=null;
export const hasLastTrace=()=>lastTrace!==null;
function loadPixels(src:string,detail:number){return new Promise<ImageData>((resolve,reject)=>{const image=new Image();image.onload=()=>{const scale=Math.min(4,detail/Math.max(image.naturalWidth,image.naturalHeight));const canvas=window.document.createElement('canvas');canvas.width=Math.max(2,Math.round(image.naturalWidth*scale));canvas.height=Math.max(2,Math.round(image.naturalHeight*scale));const context=canvas.getContext('2d',{willReadFrequently:true})!;context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(image,0,0,canvas.width,canvas.height);resolve(context.getImageData(0,0,canvas.width,canvas.height));};image.onerror=()=>reject(new Error('Não foi possível ler o bitmap.'));image.src=src;});}
/** Rastreia o bitmap e devolve os objetos do documento com o resultado (agrupado), sem aplicar. */
export async function traceImage(objects:VectorObject[],image:VectorObject,settings:TraceSettings){
 const pixels=await loadPixels(image.src!,settings.detail),layers=traceBitmap(pixels,settings.options);
 if(!layers.length)throw new Error('Nenhuma forma encontrada. Desmarque "Remover fundo" ou aumente as cores.');
 const group=crypto.randomUUID(),traced:VectorObject[]=[];
 for(const layer of layers){
  // Cada caminho tem no máximo 10.000 comandos; camadas grandes viram vários caminhos da mesma cor.
  let chunk:PathCommand[]=[];
  const flush=()=>{if(!chunk.length)return;traced.push({id:crypto.randomUUID(),type:'path',name:`Rastreado ${layer.color.toUpperCase()}`,x:image.x,y:image.y,width:image.width,height:image.height,fill:layer.color,fillRule:'evenodd',stroke:'none',strokeWidth:0,commands:chunk,pathSize:{width:pixels.width,height:pixels.height},...(image.transform?{transform:image.transform}:{}),groupPath:[...(image.groupPath??[]),group]});chunk=[];};
  for(const contour of layer.contours){if(contour.length>9990)continue;if(chunk.length+contour.length>9990)flush();chunk=[...chunk,...contour];}
  flush();
 }
 if(traced.length>2000||objects.length+traced.length>10000)throw new Error('Resultado complexo demais. Reduza as cores ou o detalhe.');
 const index=objects.findIndex(o=>o.id===image.id);
 lastTrace=settings;
 return {objects:settings.keepOriginal?[...objects.slice(0,index+1),...traced,...objects.slice(index+1)]:[...objects.slice(0,index),...traced,...objects.slice(index+1)],traced,message:`Rastreamento concluído: ${layers.length} cor(es), ${layers.reduce((s,l)=>s+l.contours.length,0)} contornos, agrupados. Ctrl+Z desfaz.`};
}
/** Rastreio rápido e Repetir último traçado: rastreiam sem abrir a janela. */
export async function quickTrace(objects:VectorObject[],image:VectorObject,repeat=false){
 return traceImage(objects,image,repeat&&lastTrace?lastTrace:{options:tracePresets.logo.options,detail:tracePresets.logo.detail,keepOriginal:false});
}
/** Bitmaps › Rastreio do contorno: tipos do CorelDRAW, ajustes e pré-visualização do resultado. */
export function TraceDialog({image,preset:initial,close}:{image:VectorObject;preset:TracePreset;close:()=>void}){
 const {document,dispatch,commitEdit,setSelection,setMessage}=useEditor(),ref=useRef<HTMLDialogElement>(null);
 const [preset,setPreset]=useState<TracePreset>(initial),[options,setOptions]=useState<TraceOptions>(tracePresets[initial].options);
 const [detail,setDetail]=useState<number>(tracePresets[initial].detail),[keepOriginal,setKeepOriginal]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [preview,setPreview]=useState<{layers:TracedLayer[];width:number;height:number}|null>(null);
 useEffect(()=>{ref.current?.showModal();},[]);
 // Pré-visualização recalculada com atraso enquanto os controles mudam.
 useEffect(()=>{let cancelled=false;const timer=setTimeout(async()=>{try{const pixels=await loadPixels(image.src!,Math.min(detail,700)),layers=traceBitmap(pixels,options);if(!cancelled)setPreview({layers,width:pixels.width,height:pixels.height});}catch{if(!cancelled)setPreview(null);}},350);return()=>{cancelled=true;clearTimeout(timer);};},[image.src,options,detail]);
 async function run(){
  setBusy(true);setError('');
  await new Promise(r=>setTimeout(r,30));
  try{const result=await traceImage(document.objects,image,{options,detail,keepOriginal});commitEdit();dispatch({type:'set-objects',objects:result.objects});setSelection(result.traced.map(o=>o.id));setMessage(result.message);close();}
  catch(e){setError(e instanceof Error?e.message:'Não foi possível rastrear o bitmap.');}
  finally{setBusy(false);}
 }
 const set=(patch:Partial<TraceOptions>)=>setOptions(o=>({...o,...patch}));
 return <dialog ref={ref} className="workspace-settings trace-dialog" onCancel={close} onClose={close}><form method="dialog" onSubmit={e=>{e.preventDefault();void run();}}>
  <h2>Rastreio do contorno — {tracePresets[preset].label}</h2>
  <div className="trace-preview"><figure><img src={image.src} alt="Original"/><figcaption>Antes</figcaption></figure><figure>{preview?<svg viewBox={`0 0 ${preview.width} ${preview.height}`} role="img" aria-label="Resultado do rastreio">{preview.layers.map((l,i)=><path key={i} d={commandsToSvg(l.contours.flat())} fill={l.color} fillRule="evenodd"/>)}</svg>:<span className="muted">Calculando…</span>}<figcaption>Depois{preview?` · ${preview.layers.length} cores, ${preview.layers.reduce((s,l)=>s+l.contours.length,0)} contornos`:''}</figcaption></figure></div>
  <label className="settings-row">Tipo de imagem<select value={preset} onChange={e=>{const p=e.target.value as TracePreset;setPreset(p);setOptions(tracePresets[p].options);setDetail(tracePresets[p].detail);}}>{(Object.keys(tracePresets) as TracePreset[]).map(p=><option key={p} value={p}>{tracePresets[p].label}</option>)}</select></label>
  <label className="settings-row">Número de cores<input type="number" min="2" max="32" value={options.colors} onChange={e=>set({colors:Math.max(2,Math.min(32,Number(e.target.value)||2))})}/></label>
  <label className="settings-row">Detalhe<input type="range" min="200" max="2000" step="50" value={detail} onChange={e=>setDetail(Number(e.target.value))}/><span>{detail}px</span></label>
  <label className="settings-row">Suavização<input type="range" min="0" max="100" value={options.smoothing} onChange={e=>set({smoothing:Number(e.target.value)})}/><span>{options.smoothing}</span></label>
  <label className="settings-row">Suavização de cantos<input type="range" min="20" max="120" value={options.cornerAngle} onChange={e=>set({cornerAngle:Number(e.target.value)})}/><span>{options.cornerAngle}°</span></label>
  <label className="settings-row">Remover manchas<select value={options.despeckle} onChange={e=>set({despeckle:Number(e.target.value)})}><option value={0}>Não</option><option value={1}>Pouco</option><option value={2}>Muito</option></select></label>
  <label className="settings-check"><input type="checkbox" checked={options.removeBackground} onChange={e=>set({removeBackground:e.target.checked})}/>Remover fundo (cor predominante nas bordas)</label>
  <label className="settings-check"><input type="checkbox" checked={keepOriginal} onChange={e=>setKeepOriginal(e.target.checked)}/>Manter a imagem original</label>
  {error&&<p role="alert" className="dialog-error">{error}</p>}
  <footer><button type="button" onClick={close}>Cancelar</button><button type="submit" className="primary" disabled={busy}>{busy?'Rastreando…':'OK'}</button></footer>
 </form></dialog>;
}
export type TraceRequest = TracePreset | CenterlinePreset | 'quick' | 'repeat';
/** Pede um rastreio (tratado no App, que conhece o bitmap selecionado). */
export const requestTrace = (kind: TraceRequest) => window.dispatchEvent(new CustomEvent('vectorstudio:trace', { detail: kind }));
/** Itens do botão "Rastrear bitmap" (mesma organização do CorelDRAW). */
export function traceMenuItems() {
  return [
    { label: 'Rastreio rápido', run: () => requestTrace('quick') },
    { label: 'Repetir o último traçado', disabled: !hasLastTrace(), run: () => requestTrace('repeat') },
    { label: 'Rastreio da linha central', submenu: (Object.keys(centerlinePresets) as CenterlinePreset[]).map(p => ({ label: `${centerlinePresets[p].label}…`, run: () => requestTrace(p) })) },
    { label: 'Rastreio do contorno', submenu: (Object.keys(tracePresets) as TracePreset[]).map(p => ({ label: `${tracePresets[p].label}…`, run: () => requestTrace(p) })) },
  ];
}

// Rastreio da linha central (PowerTRACE › Linha central): linhas abertas de uma passada, para plotter e gravação.
export const centerlinePresets={
 technical:{label:'Ilustração técnica',detail:900,options:{threshold:0,smoothing:25,cornerAngle:50,minArea:6}},
 lineDrawing:{label:'Desenho a traço',detail:700,options:{threshold:0,smoothing:55,cornerAngle:70,minArea:12}},
} satisfies Record<string,{label:string;detail:number;options:CenterlineOptions}>;
export type CenterlinePreset=keyof typeof centerlinePresets;
export const isCenterlinePreset=(kind:string):kind is CenterlinePreset=>kind in centerlinePresets;
/** Objetos do rastreio central: um caminho aberto (ou fechado, em laços) por traço, agrupados, sem preenchimento. */
export async function traceCenterlineImage(objects:VectorObject[],image:VectorObject,options:CenterlineOptions,detail:number,keepOriginal:boolean){
 const pixels=await loadPixels(image.src!,detail),result=traceCenterline(pixels,options);
 if(!result.lines.length)throw new Error('Nenhuma linha encontrada. Ajuste o limiar.');
 if(result.lines.length>2000||objects.length+result.lines.length>10000)throw new Error('Linhas demais. Aumente a suavização, reduza o detalhe ou remova manchas maiores.');
 const group=crypto.randomUUID(),scale=image.width/pixels.width;
 const traced:VectorObject[]=result.lines.map((l,i)=>({id:crypto.randomUUID(),type:'path',name:`Linha central ${i+1}`,x:image.x,y:image.y,width:image.width,height:image.height,fill:'none',stroke:result.color,strokeWidth:result.strokeWidth*scale,strokeCap:'round',strokeJoin:'round',commands:l.commands,pathSize:{width:pixels.width,height:pixels.height},...(image.transform?{transform:image.transform}:{}),groupPath:[...(image.groupPath??[]),group]}));
 const index=objects.findIndex(o=>o.id===image.id);
 return {objects:keepOriginal?[...objects.slice(0,index+1),...traced,...objects.slice(index+1)]:[...objects.slice(0,index),...traced,...objects.slice(index+1)],traced,message:`Linha central: ${traced.length} linha(s) agrupadas, espessura ${(result.strokeWidth*scale*25.4/96).toFixed(2)} mm. Ctrl+Z desfaz.`};
}
export function CenterlineDialog({image,preset:initial,close}:{image:VectorObject;preset:CenterlinePreset;close:()=>void}){
 const {document,dispatch,commitEdit,setSelection,setMessage}=useEditor(),ref=useRef<HTMLDialogElement>(null);
 const [preset,setPreset]=useState<CenterlinePreset>(initial),[options,setOptions]=useState<CenterlineOptions>(centerlinePresets[initial].options);
 const [detail,setDetail]=useState<number>(centerlinePresets[initial].detail),[keepOriginal,setKeepOriginal]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [preview,setPreview]=useState<(CenterlineResult&{width:number;height:number})|null>(null),[previewError,setPreviewError]=useState('');
 useEffect(()=>{ref.current?.showModal();},[]);
 useEffect(()=>{let cancelled=false;const timer=setTimeout(async()=>{try{const pixels=await loadPixels(image.src!,Math.min(detail,500)),r=traceCenterline(pixels,options);if(!cancelled){setPreview({...r,width:pixels.width,height:pixels.height});setPreviewError('');}}catch(e){if(!cancelled){setPreview(null);setPreviewError(e instanceof Error?e.message:'');}}},350);return()=>{cancelled=true;clearTimeout(timer);};},[image.src,options,detail]);
 async function run(){
  setBusy(true);setError('');
  await new Promise(r=>setTimeout(r,30));
  try{const result=await traceCenterlineImage(document.objects,image,options,detail,keepOriginal);commitEdit();dispatch({type:'set-objects',objects:result.objects});setSelection(result.traced.map(o=>o.id));setMessage(result.message);close();}
  catch(e){setError(e instanceof Error?e.message:'Não foi possível rastrear o bitmap.');}
  finally{setBusy(false);}
 }
 const set=(patch:Partial<CenterlineOptions>)=>setOptions(o=>({...o,...patch}));
 return <dialog ref={ref} className="workspace-settings trace-dialog" onCancel={close} onClose={close}><form method="dialog" onSubmit={e=>{e.preventDefault();void run();}}>
  <h2>Rastreio da linha central — {centerlinePresets[preset].label}</h2>
  <div className="trace-preview"><figure><img src={image.src} alt="Original"/><figcaption>Antes</figcaption></figure><figure>{preview?<svg viewBox={`0 0 ${preview.width} ${preview.height}`} role="img" aria-label="Resultado do rastreio">{preview.lines.map((l,i)=><path key={i} d={commandsToSvg(l.commands)} fill="none" stroke={preview.color} strokeWidth={preview.strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>)}</svg>:<span className="muted">{previewError||'Calculando…'}</span>}<figcaption>Depois{preview?` · ${preview.lines.length} linhas`:''}</figcaption></figure></div>
  <label className="settings-row">Tipo de imagem<select value={preset} onChange={e=>{const p=e.target.value as CenterlinePreset;setPreset(p);setOptions(centerlinePresets[p].options);setDetail(centerlinePresets[p].detail);}}>{(Object.keys(centerlinePresets) as CenterlinePreset[]).map(p=><option key={p} value={p}>{centerlinePresets[p].label}</option>)}</select></label>
  <label className="settings-row">Limiar<input type="range" min="0" max="254" value={options.threshold} onChange={e=>set({threshold:Number(e.target.value)})}/><span>{options.threshold?options.threshold:'auto'}</span></label>
  <label className="settings-row">Detalhe<input type="range" min="200" max="1500" step="50" value={detail} onChange={e=>setDetail(Number(e.target.value))}/><span>{detail}px</span></label>
  <label className="settings-row">Suavização<input type="range" min="0" max="100" value={options.smoothing} onChange={e=>set({smoothing:Number(e.target.value)})}/><span>{options.smoothing}</span></label>
  <label className="settings-row">Suavização de cantos<input type="range" min="20" max="120" value={options.cornerAngle} onChange={e=>set({cornerAngle:Number(e.target.value)})}/><span>{options.cornerAngle}°</span></label>
  <label className="settings-row">Remover manchas até<input type="number" min="1" max="500" value={options.minArea} onChange={e=>set({minArea:Math.max(1,Math.min(500,Number(e.target.value)||1))})}/><span>px</span></label>
  <label className="settings-check"><input type="checkbox" checked={keepOriginal} onChange={e=>setKeepOriginal(e.target.checked)}/>Manter a imagem original</label>
  <p className="muted">Cada traço vira uma linha aberta com a espessura média medida no bitmap (limiar "auto" escolhe o tom que separa traço e fundo).</p>
  {error&&<p role="alert" className="dialog-error">{error}</p>}
  <footer><button type="button" onClick={close}>Cancelar</button><button type="submit" className="primary" disabled={busy}>{busy?'Rastreando…':'OK'}</button></footer>
 </form></dialog>;
}
