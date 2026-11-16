import {useEffect,useRef,useState} from 'react';
import {useEditor} from '../state/EditorContext';
import {browserMeasure} from '../text/textMeasure';
import {desktop} from '../io/desktop';
import {activePage,pageList,parsePageRange} from '../document/pages';
import {exportScene,formatInfo,toDwgScript,toDxf,toEps,toPdf,toPdfPages,toPlt,toSvg,transparencyNote,type ExportArea,type ExportFormat,type RasterImage,type Scene} from '../io/exporters';
const raster=(f:ExportFormat)=>f==='png'||f==='jpg'||f==='webp';
function download(data:BlobPart,name:string,mime:string){
 const url=URL.createObjectURL(new Blob([data],{type:mime})),a=window.document.createElement('a');
 a.href=url;a.download=name;window.document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function loadImage(src:string){return new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Não foi possível renderizar a imagem.'));image.src=src;});}
const measure=()=>browserMeasure;
async function jpegImages(scene:Scene){
 const images=new Map<string,RasterImage>();
 for(const o of scene.objects.filter(o=>o.type==='image'&&o.src)){
  const image=await loadImage(o.src!),canvas=window.document.createElement('canvas');
  canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d')!;context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0);
  const base64=canvas.toDataURL('image/jpeg',0.92).split(',')[1];images.set(o.id,{jpeg:Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),width:canvas.width,height:canvas.height});
 }
 return images;
}
export async function rasterize(scene:Scene,format:'png'|'jpg'|'webp',dpi:number,transparent:boolean,quality:number){
 const scale=dpi/96,width=Math.max(1,Math.round(scene.area.width*scale)),height=Math.max(1,Math.round(scene.area.height*scale));
 if(width*height>100_000_000||width>16000||height>16000)throw new Error('Resolução alta demais para esta área. Reduza o DPI.');
 const url=URL.createObjectURL(new Blob([toSvg(scene,browserMeasure,format==='jpg'||!transparent?'#ffffff':undefined)],{type:'image/svg+xml'}));
 try{
  const image=await loadImage(url),canvas=window.document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d')!;if(format==='jpg'||!transparent){context.fillStyle='#fff';context.fillRect(0,0,width,height);}
  context.drawImage(image,0,0,width,height);
  return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('O navegador não gerou o arquivo.')),formatInfo[format].mime,quality));
 }finally{URL.revokeObjectURL(url);}
}
const PREFS='vectorstudio.export';
/** Última exportação: formato, resolução, fundo e qualidade voltam na próxima vez (como no CorelDRAW). */
function lastExport(){try{const raw=JSON.parse(localStorage.getItem(PREFS)??'{}');return{format:raw.format in formatInfo&&(raw.format!=='dwg'||desktop?.exportDwg)&&(raw.format!=='cdr'||desktop?.exportCdr)?raw.format as ExportFormat:'pdf' as ExportFormat,dpi:[72,96,150,300,600].includes(raw.dpi)?raw.dpi as number:300,transparent:raw.transparent!==false,quality:Number.isInteger(raw.quality)&&raw.quality>=10&&raw.quality<=100?raw.quality as number:90,cdrVersion:Number.isInteger(raw.cdrVersion)&&raw.cdrVersion>=7&&raw.cdrVersion<=27?raw.cdrVersion as number:17};}catch{return{format:'pdf' as ExportFormat,dpi:300,transparent:true,quality:90,cdrVersion:17};}}
// Versões do CorelDRAW (número interno do formato .cdr). Uma versão antiga abre em todos os Corel mais novos.
const cdrVersions:[number,string][]=[[27,'CorelDRAW 2026'],[26,'CorelDRAW 2025'],[25,'CorelDRAW 2024'],[24,'CorelDRAW 2022'],[23,'CorelDRAW 2021'],[22,'CorelDRAW 2020'],[21,'CorelDRAW 2019'],[20,'CorelDRAW 2018'],[19,'CorelDRAW 2017'],[18,'CorelDRAW X8'],[17,'CorelDRAW X7'],[16,'CorelDRAW X6'],[15,'CorelDRAW X5'],[14,'CorelDRAW X4'],[13,'CorelDRAW X3'],[12,'CorelDRAW 12'],[11,'CorelDRAW 11'],[10,'CorelDRAW 10'],[9,'CorelDRAW 9'],[8,'CorelDRAW 8'],[7,'CorelDRAW 7']];
export function ExportDialog({close}:{close:()=>void}){
 const [last]=useState(lastExport);
 const {document,selectedIds,setMessage}=useEditor(),ref=useRef<HTMLDialogElement>(null);
 const [format,setFormat]=useState<ExportFormat>(last.format),[area,setArea]=useState<ExportArea>(selectedIds.length?'selection':'page');
 const [dpi,setDpi]=useState(last.dpi),[transparent,setTransparent]=useState(last.transparent),[quality,setQuality]=useState(last.quality),[cdrVersion,setCdrVersion]=useState(last.cdrVersion),[busy,setBusy]=useState(false),[error,setError]=useState('');
 // Documento com várias páginas: exportar a atual, todas ou as escolhidas (PDF sai num arquivo só; os outros formatos, um arquivo por página).
 const allPages=pageList(document),[pagesMode,setPagesMode]=useState<'current'|'all'|'range'>('current'),[pagesText,setPagesText]=useState(`1-${allPages.length}`);
 const multi=allPages.length>1&&area!=='selection';
 const chosenPages=!multi||pagesMode==='current'?[activePage(document)+1]:pagesMode==='all'?allPages.map((_,i)=>i+1):parsePageRange(pagesText,allPages.length);
 useEffect(()=>{ref.current?.showModal();},[]);
 /** Exporta uma cena num arquivo (usado nas páginas extras). */
 async function exportOne(scene:Scene,name:string){
  const mime=formatInfo[format].mime;
  if(format==='svg')download(toSvg(scene,measure()),name,mime);
  else if(format==='pdf')download(toPdf(scene,await jpegImages(scene),measure()) as BlobPart,name,mime);
  else if(format==='eps')download(toEps(scene,measure()),name,mime);
  else if(format==='dxf')download(toDxf(scene),name,mime);
  else if(format==='plt')download(toPlt(scene),name,mime);
  else if(format==='dwg'){if(!desktop?.exportDwg)throw new Error('Exportar DWG só funciona no GFX Studio instalado.');const r=await desktop.exportDwg(toDwgScript(scene).script);if(!r.ok)throw new Error(r.error);download(r.dwg as BlobPart,name,mime);}
  else if(format==='cdr'){if(!desktop?.exportCdr)throw new Error('Salvar como CDR só funciona no GFX Studio instalado.');const r=await desktop.exportCdr(toSvg(scene,measure()),cdrVersion);if(!r.ok)throw new Error(r.error);download(r.cdr as BlobPart,name,mime);}
  else download(await rasterize(scene,format as 'png'|'jpg'|'webp',dpi,transparent,quality/100),name,mime);
 }
 async function run(){
  setBusy(true);setError('');
  try{
   if(!chosenPages.length)throw new Error('Nenhuma página válida (ex.: 1-3, 5).');
   const base=document.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')||'Desenho',mime=formatInfo[format].mime;
   const sceneOf=(page:number)=>multi?exportScene({...document,objects:allPages[page-1].objects},area,[]):exportScene(document,area,selectedIds);
   if(format==='pdf'&&chosenPages.length>1){
    const scenes=chosenPages.map(sceneOf),pages=[];for(const sc of scenes)pages.push({scene:sc,images:await jpegImages(sc)});
    download(toPdfPages(pages,measure()) as BlobPart,`${base}.pdf`,mime);
    try{localStorage.setItem(PREFS,JSON.stringify({format,dpi,transparent,quality,cdrVersion}));}catch{/* preferências indisponíveis */}
    setMessage(`Exportado como PDF com ${chosenPages.length} páginas.`);close();return;
   }
   // Outros formatos: um arquivo por página escolhida (nome-p2.png…).
   for(const page of chosenPages.slice(1))await exportOne(sceneOf(page),`${base}-p${page}.${formatInfo[format].extension}`);
   const scene=sceneOf(chosenPages[0]),name=chosenPages.length>1?`${base}-p${chosenPages[0]}.${formatInfo[format].extension}`:`${base}.${formatInfo[format].extension}`;
   if(format==='svg')download(toSvg(scene,measure()),name,mime);
   else if(format==='pdf')download(toPdf(scene,await jpegImages(scene),measure()) as BlobPart,name,mime);
   else if(format==='eps')download(toEps(scene,measure()),name,mime);
   else if(format==='dxf')download(toDxf(scene),name,mime);
   else if(format==='dwg'){
    if(!desktop?.exportDwg)throw new Error('Exportar DWG só funciona no GFX Studio instalado.');
    const {script,warnings}=toDwgScript(scene),result=await desktop.exportDwg(script);
    if(!result.ok)throw new Error(result.error);
    download(result.dwg as BlobPart,name,mime);
    if(warnings.length){setMessage(`Exportado como DWG. ${warnings.join(' ')}`);close();return;}
   }
   else if(format==='cdr'){
    if(!desktop?.exportCdr)throw new Error('Salvar como CDR só funciona no GFX Studio instalado.');
    const result=await desktop.exportCdr(toSvg(scene,measure()),cdrVersion);
    if(!result.ok)throw new Error(result.error);
    download(result.cdr as BlobPart,name,mime);
    try{localStorage.setItem(PREFS,JSON.stringify({format,dpi,transparent,quality,cdrVersion}));}catch{/* preferências indisponíveis */}
    setMessage(`Salvo como CDR (${cdrVersions.find(v=>v[0]===cdrVersion)?.[1]??cdrVersion}).${result.note?` Aviso do conversor: ${result.note}`:''}`);close();return;
   }
   else if(format==='plt')download(toPlt(scene),name,mime);
   else download(await rasterize(scene,format as 'png'|'jpg'|'webp',dpi,transparent,quality/100),name,mime);
   try{localStorage.setItem(PREFS,JSON.stringify({format,dpi,transparent,quality,cdrVersion}));}catch{/* preferências indisponíveis */}
   setMessage(desktop?`Exportado como ${formatInfo[format].extension.toUpperCase()}.`:`Exportado como ${formatInfo[format].extension.toUpperCase()}. Confira a pasta de downloads.`);close();
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível exportar.');}
  finally{setBusy(false);}
 }
 const notes:Partial<Record<ExportFormat,string>>={cdr:'Arquivo .cdr gerado pelo conversor independente do TraceDraw (código aberto). Escolha a versão do Corel de quem vai abrir: uma versão mais antiga abre em todos os Corel mais novos. Efeitos que o formato não guarda são convertidos em objetos simples.',eps:'Bitmaps não são incluídos no EPS.',dxf:'Curvas convertidas em polilinhas; bitmaps omitidos e PowerClip exportado sem recorte. Abre no AutoCAD.',dwg:'DWG versão 2000 gerado pelo LibreDWG: curvas viram polilinhas, cada cor fica numa camada "COR-n"; bitmaps omitidos e PowerClip sem recorte. Se o AutoCAD recusar o arquivo, use DXF.',plt:'Somente contornos, em milímetros; textos e bitmaps omitidos; PowerClip sem recorte.',pdf:'Vetores e textos editáveis (Helvetica); bitmaps incorporados em JPEG.'};
 return <dialog ref={ref} className="workspace-settings export-dialog" onCancel={close} onClose={close}><form method="dialog" onSubmit={e=>{e.preventDefault();void run();}}>
  <h2>Exportar</h2>
  <label className="settings-row">Formato<select value={format} onChange={e=>setFormat(e.target.value as ExportFormat)}>{(Object.keys(formatInfo) as ExportFormat[]).filter(f=>(f!=='dwg'||desktop?.exportDwg)&&(f!=='cdr'||desktop?.exportCdr)).map(f=><option key={f} value={f}>{formatInfo[f].label}</option>)}{!desktop?.exportCdr&&<option disabled>CDR — só no aplicativo instalado</option>}{!desktop?.exportDwg&&<option disabled>DWG — só no aplicativo instalado (use DXF)</option>}<option disabled>AI — não disponível (use PDF ou EPS)</option></select></label>
  {format==='cdr'&&<label className="settings-row">Versão do CDR<select value={cdrVersion} onChange={e=>setCdrVersion(Number(e.target.value))}>{cdrVersions.map(([v,l])=><option key={v} value={v}>{l} (versão {v})</option>)}</select></label>}
  <label className="settings-row">Área<select value={area} onChange={e=>setArea(e.target.value as ExportArea)}><option value="page">Página</option><option value="objects">Todos os objetos</option><option value="selection" disabled={!selectedIds.length}>Somente selecionados</option></select></label>
  {multi&&<label className="settings-row">Páginas<select value={pagesMode} onChange={e=>setPagesMode(e.target.value as 'current'|'all'|'range')}><option value="current">Página atual ({activePage(document)+1})</option><option value="all">Todas ({allPages.length})</option><option value="range">Escolher…</option></select>{pagesMode==='range'&&<input type="text" value={pagesText} aria-label="Páginas a exportar (ex.: 1-3, 5)" placeholder="ex.: 1-3, 5" onChange={e=>setPagesText(e.target.value)}/>}</label>}
  {multi&&pagesMode!=='current'&&<p className="muted">{chosenPages.length?`${chosenPages.length} página(s): ${chosenPages.join(', ')}. ${format==='pdf'?'Um PDF com todas.':'Um arquivo por página.'}`:'Nenhuma página válida.'}</p>}
  {raster(format)&&<><label className="settings-row">Resolução<select value={dpi} onChange={e=>setDpi(Number(e.target.value))}>{[72,96,150,300,600].map(v=><option key={v} value={v}>{v} dpi</option>)}</select></label>
   {format!=='png'&&<label className="settings-row">Qualidade<input type="range" min="10" max="100" value={quality} onChange={e=>setQuality(Number(e.target.value))}/><span>{quality}%</span></label>}
   {format!=='jpg'&&<label className="settings-check"><input type="checkbox" checked={transparent} onChange={e=>setTransparent(e.target.checked)}/>Fundo transparente</label>}</>}
  {notes[format]&&<p>{notes[format]}</p>}
  {(()=>{try{const note=transparencyNote(exportScene(document,area,selectedIds),format);return note&&<p className="dialog-warning">{note}</p>;}catch{return null;}})()}
  {error&&<p role="alert" className="dialog-error">{error}</p>}
  <footer><button type="button" onClick={close}>Cancelar</button><button type="submit" className="primary" disabled={busy}>{busy?'Exportando…':'Exportar'}</button></footer>
 </form></dialog>;
}
