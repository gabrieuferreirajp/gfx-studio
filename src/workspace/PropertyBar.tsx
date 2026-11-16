import {Group,Ungroup,PenLine,Spline as Curves} from 'lucide-react';
/** Desagrupar tudo: dois quadros separados com as setas para fora. */
const UngroupAllIcon=()=><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M14 3h7v7M10 21H3v-7" strokeDasharray="2 2"/></svg>;
import {SmartFillControls} from '../components/SmartFill';
import {EffectToolControls} from '../components/useEffectTools';
import {MaskBrushControls} from '../components/useMaskBrush';
import {CloneStampControls} from '../components/useCloneStamp';
import {ZoomControls} from '../components/ZoomControls';
import {LassoControls} from '../components/useCutTools';
import {useWorkspace} from './WorkspaceContext';
import {CornerControls,NodeToolbar} from '../components/ShapeControls';
import {canConvertToCurves} from '../geometry/convertCurves';
import {useEditor} from '../state/EditorContext';
import {ObjectDimensions} from '../components/ObjectDimensions';
import {BooleanIcon} from '../components/BooleanIcon';
import {booleanLabels,booleanSelectionError,type BooleanOperation} from '../geometry/booleanSelection';
import {finishEditing} from '../state/useProjectFiles';
import {toolItems} from '../components/Toolbar';
import {PathTextControls,TextControls} from '../components/TextControls';
import {OutlineWidth,StrokeCorners} from '../components/OutlineWidth';
import {documentUnits,unitDefinitions,type DocumentUnit} from '../document/units';
import {normalizeShapeOptions,type ShapeOptions} from '../geometry/shapeFactory';
import {outlineSelectionError} from '../geometry/outlineSelection';
import {selectionIds} from '../geometry/objectTransforms';
import {traceMenuItems} from './TraceDialog';
import {openRemoveBackground} from './RemoveBackgroundDialog';
import {PageControls} from './PageControls';
import {RotationControls,TransparencyControls} from '../components/TransformControls';
import {DeformControls,DimensionControls,MeshControls} from '../components/Block3Controls';
import {dimensionTools} from '../components/useDimensionTool';
export function PropertyBar(){
 const {layout,setLayout}=useWorkspace();
 const {document,selectedId,selectedIds,tool,dispatch,beginEdit,commitEdit,booleanCommand,booleanBusy,shapeOptions,setShapeOptions,objectCommand,outlineCommand,convertCurvesCommand,clipEdit}=useEditor();
 const object=document.objects.find(o=>o.id===selectedId),error=booleanSelectionError(document.objects,selectedIds);
 const options:[keyof ShapeOptions,string,number,number][]=tool==='polygon'?[['sides','Lados',3,500]]:tool==='star'?[['points','Pontas',3,500],['sharpness','Nitidez',1,99]]:tool==='spiral'?[['revolutions','Revoluções',1,100]]:tool==='graph'?[['columns','Colunas',1,99],['rows','Linhas',1,99]]:[];
 const selected=document.objects.filter(o=>selectedIds.includes(o.id));
 const units=new Set(selected.map(o=>clipEdit?o.id:selectionIds(document.objects,o.id)[0]));
 const showText=tool==='text'||selected.some(o=>o.type==='text');
 const outlineError=outlineSelectionError(document.objects,selectedIds);
 const run=(action:()=>void)=>()=>{finishEditing();action();};
 return <div className="context-properties corel-bar" onFocus={e=>{if(e.target instanceof HTMLInputElement&&!e.target.closest('.text-controls, .outline-width'))beginEdit();}} onBlur={e=>{if(e.target instanceof HTMLInputElement&&!e.target.closest('.text-controls, .outline-width'))commitEdit();}}>
  <span className="context-tool visually-hidden">{toolItems.find(item=>item.id===tool)?.label}</span>
  {options.length>0?<span className="tool-options">{options.map(([key,label,min,max])=><label key={key}>{label}<input type="number" aria-label={label} min={min} max={max} value={shapeOptions[key]} onChange={e=>{if(e.target.value!=='')setShapeOptions(normalizeShapeOptions({...shapeOptions,[key]:Number(e.target.value)}));}}/></label>)}</span>
  :tool==='transparency'?<TransparencyControls compact/>
  :tool==='envelope'||tool==='perspective'?<DeformControls mode={tool}/>
  :tool==='mesh'?<MeshControls/>
  :tool==='smartFill'?<SmartFillControls/>
  :tool==='dropShadow'||tool==='contour'||tool==='blockShadow'?<EffectToolControls tool={tool}/>
  :tool==='lasso'?<LassoControls/>
  :tool==='maskBrush'?<MaskBrushControls/>
  :tool==='cloneStamp'?<CloneStampControls/>
  :tool==='zoom'?<ZoomControls/>
  :(dimensionTools as readonly string[]).includes(tool)?<DimensionControls/>
  :tool==='eraser'?<label className="number-field eraser-size" title="Espessura da borracha"><span>Espessura</span><input type="number" aria-label="Espessura da borracha" min={0.1} max={500} step={0.5} value={Number((layout.eraserSize*25.4/96).toFixed(2))} onChange={e=>{const mm=Number(e.target.value);if(Number.isFinite(mm)&&mm>=0.1&&mm<=500)setLayout(s=>({...s,eraserSize:mm*96/25.4}));}}/><span>mm</span></label>
  :selectedIds.length===1&&object?<ObjectDimensions object={object}/>:selectedIds.length?<ObjectDimensions objects={selected.filter(o=>!o.clipParent||!selectedIds.includes(o.clipParent))}/>:<PageControls/>}
  {tool==='select'&&selectedIds.length>0&&<><span className="command-divider"/><RotationControls compact/></>}
  {tool==='select'&&selected.some(o=>o.type==='rectangle'||o.type==='path')&&<><span className="command-divider"/><CornerControls/></>}
  {tool==='nodes'&&<><span className="command-divider"/><NodeToolbar/></>}
  {(selectedIds.length>0||(tool!=='select'&&tool!=='text'&&!options.length))&&<><span className="command-divider"/><OutlineWidth/><StrokeCorners/></>}
  {tool==='select'&&selected.length===1&&selected[0].type==='image'&&<><span className="command-divider"/><button type="button" className="trace-button" title="Remover o fundo da imagem (máscara de camada)" onClick={openRemoveBackground}>Remover fundo</button><button type="button" className="trace-button" aria-haspopup="menu" title="Rastrear bitmap (converter em vetores)" onClick={e=>{const r=e.currentTarget.getBoundingClientRect();window.dispatchEvent(new CustomEvent('vectorstudio:context-menu',{detail:{x:r.left,y:r.bottom+2,items:traceMenuItems()}}));}}>Rastrear bitmap ▾</button></>}
  {showText&&<><span className="command-divider"/><TextControls compact/></>}
  {selected.some(o=>o.type==='text'&&o.textPath)&&<><span className="command-divider"/><PathTextControls/></>}
  {selectedIds.length>0&&<><span className="command-divider"/>
   <button className="command-icon" aria-label="Agrupar (Ctrl+G)" title="Agrupar (Ctrl+G)" disabled={units.size<2} onClick={run(()=>objectCommand('group'))}><Group size={18}/></button>
   <button className="command-icon" aria-label="Desagrupar (Ctrl+U)" title="Desagrupar (Ctrl+U)" disabled={!selected.some(o=>o.groupPath?.length)} onClick={run(()=>objectCommand('ungroup'))}><Ungroup size={18}/></button>
   <button className="command-icon" aria-label="Desagrupar tudo" title="Desagrupar tudo (desfaz também os grupos dentro de grupos)" disabled={!selected.some(o=>o.groupPath?.length)} onClick={run(()=>objectCommand('ungroupAll'))}><UngroupAllIcon/></button>
   <button className="command-icon" aria-label="Converter em curvas (Ctrl+Q)" title="Converter em curvas (Ctrl+Q) — inclusive textos" disabled={booleanBusy||!selected.some(canConvertToCurves)} onClick={run(()=>void convertCurvesCommand())}><Curves size={18}/></button>
   <button className="command-icon" aria-label="Converter contorno em objeto (Ctrl+Shift+Q)" title={`Converter contorno em objeto (Ctrl+Shift+Q)${outlineError?` — ${outlineError}`:''}`} disabled={booleanBusy||!!outlineError} onClick={run(()=>void outlineCommand())}><PenLine size={18}/></button></>}
  {!selectedIds.length&&<label>Unidades <select aria-label="Unidades na barra de propriedades" value={document.unit??'px'} onChange={e=>{finishEditing();dispatch({type:'set-unit',unit:e.target.value as DocumentUnit});}}>{documentUnits.map(u=><option key={u} value={u} title={unitDefinitions[u].label}>{unitDefinitions[u].short}</option>)}</select></label>}
  {units.size>=2&&<><span className="command-divider"/>
  {(Object.keys(booleanLabels) as BooleanOperation[]).map(op=><button className="command-icon" key={op} aria-label={`${booleanLabels[op]} na barra`} title={`${booleanLabels[op]}${error?` — ${error}`:''}`} disabled={booleanBusy||!!error} onClick={()=>{finishEditing();void booleanCommand(op);}}><BooleanIcon operation={op}/></button>)}</>}
 </div>;
}
