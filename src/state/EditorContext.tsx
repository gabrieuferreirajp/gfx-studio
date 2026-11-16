import { detachPathText } from '../text/textTools';
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { contourParams, placeLinked, separateEffects, separateShadows, sweepParams, type LinkedKind } from '../geometry/effectLinks';
import { createDocument, type DocumentAction, type EffectLink, type PathCommand, type Tool, type VectorDocument, type VectorObject } from '../document/model';
import { canConvertToCurves, convertToCurves } from '../geometry/convertCurves';
import { breakApart } from '../geometry/breakApart';
import { combine } from '../geometry/combine';
import { updateText } from '../text/textLayout';
import { browserMeasure } from '../text/textMeasure';

import { blendObjects, effectSelectionError, type SweepParams } from '../geometry/effects';
import { createHistory, fingerprint, historyReducer, isDirty, type HistoryState } from './history';
import { activePage, deletePage, duplicatePage, insertPage, movePage, pageList, renamePage } from '../document/pages';
import type { Viewport } from '../document/viewport';
import { runBoolean } from '../geometry/booleanClient';
import { booleanOperandIds, booleanSelectionError, booleanLabels, type BooleanOperation } from '../geometry/booleanSelection';
import { alignObjects, applyMatrix, boundsOf, distributeObjects, mirror, clipContents, duplicateObjects, groupObjects, orderObjects, selectionIds, toggleSelection, translate, ungroupObjects, type Alignment, type Bounds, type Distribution, type Matrix, type Order , ungroupAll } from '../geometry/objectTransforms';
import { recordTransform as record, repeatStep, type RepeatState } from '../geometry/repeat';
import { defaultShapeOptions, type ShapeOptions } from '../geometry/shapeFactory';
import { defaultTextStyle, type TextStyle } from '../text/textLayout';
import { outlineSelectionError } from '../geometry/outlineSelection';
import { allContents, canBeFrame, centerIfOutside, extractContents, fitContents, placeInside, setContentsLocked, type ClipFit } from '../geometry/powerClip';
import { isBlocked } from '../document/layers';
import type { CutOperation, CutParams } from '../geometry/cutGeometry';
const cutLabels: Record<CutOperation, string> = { crop: 'Cortar', knife: 'Faca', erase: 'Borracha', virtualDelete: 'Excluir segmento virtual', smartFill: 'Preenchimento inteligente' };
export type LinkParams = Omit<EffectLink, 'id' | 'kind' | 'origin' | 'shape' | 'stale' | 'at'>;
export type EffectRequest = { kind: 'blend'; steps: number } | { kind: 'extrude'; params: SweepParams };
export type ObjectCommand = 'group' | 'ungroup' | 'ungroupAll' | 'duplicate' | 'page' | 'mirrorH' | 'mirrorV' | Order | Alignment | Distribution;
export type PageCommand = 'insert-after' | 'insert-before' | 'duplicate' | 'delete' | 'rename' | 'move';
export interface ProjectFile { path: string; name: string }
/** Aba de documento (como no CorelDRAW): cada uma guarda histórico, vista e arquivo próprios. */
/** `blank`: documento de reserva, intocado, que existe só por baixo da Tela de boas-vindas (não aparece como aba). */
export interface DocumentTab { id: string; name: string; dirty: boolean; file: ProjectFile | null; document: VectorDocument; blank: boolean }
type Session = { id: string; file: ProjectFile | null; history: HistoryState | null; viewport: Viewport; blank?: boolean; initial?: boolean };
/** Começa sem documento (só a Tela de boas-vindas), salvo se o usuário desligou a tela de boas-vindas. */
const startsBlank = () => { try { return localStorage.getItem('vectorstudio:welcome-startup') !== 'false'; } catch { return true; } };
export type ClipCommand = 'place' | 'extract' | 'edit' | 'finish' | 'lock' | 'unlock' | ClipFit;
interface EditorState {
  document: VectorDocument;
  dispatch: React.Dispatch<DocumentAction>;
  /** Altera o documento sem criar passo no Desfazer (pré-visualizações). */
  amend: (action: DocumentAction) => void;
  tool: Tool;
  setTool: (tool: Tool) => void;
  selectedId: string | null;
  selectedIds: string[];
  chooseObject: (id: string, shift?: boolean) => string[];
  objectCommand: (command: ObjectCommand) => void;
  clipCommand: (command: ClipCommand, frameId?: string) => void;
  lockCommand: (lock: boolean, id?: string | 'all') => void;
  clipPick: boolean;
  pickClipFrame: (id: string | null) => void;
  breakApartCommand: () => void;
  nudge: (dx: number, dy: number) => void;
  /** Registra a última transformação para o Repetir (Ctrl+R); `copies` quando ela criou uma cópia. */
  recordTransform: (before: VectorObject[], ids: string[], matrix: Matrix, copies?: string[]) => void;
  /** Janela Transformações: aplica a matriz calculada a partir da caixa da seleção, nos originais ou em `copies` cópias encadeadas. */
  transformCommand: (build: (bounds: Bounds) => Matrix | null, copies: number) => void;
  repeatCommand: () => void;
  clipEdit: string | null;
  addObjects: (objects: VectorObject[]) => void;
  booleanCommand: (operation:BooleanOperation, keep?:{source?:boolean;target?:boolean}) => Promise<void>;
  combineCommand: () => Promise<void>;
  /** Cortar/Faca/Borracha/Excluir segmento virtual; `target` = objeto clicado (segmento virtual). */
  cutCommand: (operation: CutOperation, params: CutParams, target?: string) => Promise<void>;
  booleanBusy: boolean;
  booleanMessage: string;
  setMessage: (message: string) => void;
  selectedNode: number | null;
  selectedNodes: number[];
  setSelectedNodes: (indexes: number[]) => void;
  selectNode: (index: number | null) => void;
  select: (id: string | null) => void;
  setSelection: (ids: string[]) => void;
  fill: string;
  setFill: (fill: string) => void;
  outline: string;
  setOutline: (outline: string) => void;
  outlineWidth: number;
  setOutlineWidth: (width: number) => void;
  shapeOptions: ShapeOptions;
  textStyle: TextStyle;
  setTextStyle: (style: TextStyle) => void;
  outlineCommand: () => Promise<void>;
  convertCurvesCommand: () => Promise<void>;
  effectCommand: (effect: EffectRequest) => Promise<void>;
  /** Cria (ou refaz) Bloquear sombra / Contorno ligados aos objetos. */
  linkedEffect: (kind: LinkedKind, ids: string[], link: LinkParams) => Promise<void>;
  nodeMirror: { h: boolean; v: boolean };
  setNodeMirror: (mirror: { h: boolean; v: boolean }) => void;
  setShapeOptions: (options: ShapeOptions) => void;
  removeSelected: () => void;
  beginEdit: () => void;
  commitEdit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  setDraftPending: (pending: boolean) => void;
  markSaved: (snapshot: string) => void;
  loadDocument: (document: VectorDocument) => void;
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  fitRequest: number;
  fitToScreen: () => void;
  goToPage: (index: number) => void;
  pageCommand: (command: PageCommand, options?: { index?: number; name?: string; to?: number }) => void;
  tabs: DocumentTab[];
  activeTab: string;
  openTab: (document: VectorDocument, file: ProjectFile | null) => void;
  switchTab: (id: string) => void;
  closeTab: (id: string, force?: boolean) => boolean;
  closeAllTabs: (force?: boolean) => boolean;
  file: ProjectFile | null;
  setFile: (file: ProjectFile | null) => void;
  anyDirty: boolean;
}
const Context = createContext<EditorState | null>(null);
export function EditorProvider({ children }: { children: ReactNode }) {
  const [history, send] = useReducer(historyReducer, undefined, () => createHistory(createDocument()));
  const document = history.present;
  const dispatch = (action: DocumentAction) => send({ type: 'edit', action });
  const beginEdit = () => send({ type: 'begin' });
  const commitEdit = () => send({ type: 'commit' });
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [fitRequest, requestFit] = useState(0);
  const fitToScreen = () => requestFit(value => value + 1);
  const [tool, changeTool] = useState<Tool>('select');
  const [rawSelection, changeSelection] = useState<string[]>([]);
  // Desfazer/Refazer podem remover objetos selecionados (ex.: o resultado de Soldar/Aparar/Interseção).
  // A seleção exposta já vem filtrada no mesmo render, para nenhum painel ler um objeto inexistente.
  const selectedIds = useMemo(() => {
    if (!rawSelection.length) return rawSelection;
    const ids = new Set(document.objects.map(o => o.id)), next = rawSelection.filter(id => ids.has(id));
    return next.length === rawSelection.length ? rawSelection : next;
  }, [rawSelection, document]);
  const [clipEdit, setClipEdit] = useState<string | null>(null);
  const [clipPick, setClipPick] = useState(false);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const latest=useRef({document,selectedIds,clipEdit});latest.current={document,selectedIds,clipEdit};
  // Nós selecionados (Shift/Ctrl+clique adiciona ou remove); o último é o "principal".
  const [selectedNodes, setSelectedNodes] = useState<number[]>([]);
  const selectedNode = selectedNodes.at(-1) ?? null;
  const selectNode = (index: number | null) => setSelectedNodes(index === null ? [] : [index]);
  // Durante "Editar PowerClip" cada objeto do conteúdo é selecionável isoladamente.
  const editing = (id: string) => clipEdit !== null && allContents(document.objects, clipEdit).some(o => o.id === id);
  const unitOf = (id: string) => editing(id) ? clipContents(document.objects, [id]) : selectionIds(document.objects, id);
  function select(id: string | null) { changeSelection(id ? tool === 'nodes' ? [id] : unitOf(id).length ? unitOf(id) : [id] : []); selectNode(null); }
  const lastClicked=useRef<string|null>(null);
  function chooseObject(id: string, shift = false) {
    // Objeto bloqueado não entra na seleção (desbloqueie pelo botão direito).
    const target = document.objects.find(o => o.id === id);
    if (target?.locked) { setBooleanMessage('Objeto bloqueado. Botão direito › Desbloquear objeto.'); return selectedIds; }
    if (target && isBlocked(document, target)) { setBooleanMessage('A camada deste objeto está travada ou oculta (painel Objetos › Camadas).'); return selectedIds; }
    lastClicked.current=id;
    const unit=unitOf(id);
    const next=tool==='nodes'?[id]:editing(id)?(!shift?unit:unit.every(i=>selectedIds.includes(i))?selectedIds.filter(i=>!unit.includes(i)):[...new Set([...selectedIds,...unit])]):toggleSelection(document.objects,selectedIds,id,shift);
    changeSelection(next); selectNode(null); return next;
  }
  function setTool(next: Tool) {
    changeTool(next);selectNode(null);
    changeSelection(ids=>next==='nodes'&&ids.length>1?[ids.at(-1)!]:next==='select'&&ids.length===1?unitOf(ids[0]).length?unitOf(ids[0]):ids:ids);
  }
  const [fill, setFill] = useState('none');
  const [outline, setOutline] = useState('#000000');
  const [outlineWidth, setOutlineWidth] = useState(1);
  const [shapeOptions, setShapeOptions] = useState<ShapeOptions>(defaultShapeOptions);
  const [textStyle, setTextStyle] = useState<TextStyle>(defaultTextStyle);
  const [nodeMirror, setNodeMirror] = useState({ h: false, v: false });
  const [draftPending, setDraftPending] = useState(false);
  const [booleanBusy,setBooleanBusy]=useState(false);
  const [booleanMessage,setBooleanMessage]=useState('');
  const booleanRunning=useRef(false);
  async function cutCommand(operation:CutOperation,params:CutParams,target?:string){
    if(booleanRunning.current)return;
    const snapshot=latest.current,doc=snapshot.document,usable=doc.objects.filter(o=>!isBlocked(doc,o));
    // Com seleção, só ela; sem seleção, todos os objetos desbloqueados da página. O segmento virtual usa todos como cortadores.
    // O preenchimento inteligente considera todas as formas visíveis e desbloqueadas da página, como no CorelDRAW.
    const ids=operation==='smartFill'?usable.map(o=>o.id):target?[target,...usable.filter(o=>o.id!==target).map(o=>o.id)]:snapshot.selectedIds.length?clipContents(doc.objects,snapshot.selectedIds):usable.map(o=>o.id);
    if(!ids.length){setBooleanMessage(operation==='smartFill'?'Não há formas nesta página.':'Nada para cortar nesta página.');return;}
    booleanRunning.current=true;setBooleanBusy(true);setBooleanMessage(operation==='smartFill'?'Calculando área…':'Calculando corte…');
    try{
      const result=await runBoolean(doc.objects,ids,'cut',{operation,params});
      if(latest.current.document!==doc){setBooleanMessage('O documento mudou durante o cálculo. Nada foi substituído; tente novamente.');return;}
      commitEdit();dispatch({type:'set-objects',objects:result.objects});commitEdit();changeSelection(operation==='virtualDelete'?[]:result.resultIds??[]);selectNode(null);
      setBooleanMessage(`${cutLabels[operation]} concluído${result.resultIds?.length?`: ${result.resultIds.length} objeto(s)`:''}. Ctrl+Z desfaz.`);
    }catch(error){setBooleanMessage(error instanceof Error?error.message:'Não foi possível cortar.');}
    finally{booleanRunning.current=false;setBooleanBusy(false);}
  }
  /**
   * Moldar (Soldar, Aparar…). `keep` (janela Moldar, como no CorelDRAW): deixa também os originais — "origem" são os
   * objetos de cima e "destino" o de baixo da seleção — logo abaixo do resultado.
   */
  async function booleanCommand(operation:BooleanOperation,keep?:{source?:boolean;target?:boolean}){
    if(booleanRunning.current)return;
    const snapshot=latest.current;
    const error=booleanSelectionError(snapshot.document.objects,snapshot.selectedIds);
    if(error){setBooleanMessage(error);return;}
    booleanRunning.current=true;setBooleanBusy(true);setBooleanMessage('Calculando geometria…');
    try{
      const result=await runBoolean(snapshot.document.objects,snapshot.selectedIds,operation);
      if(latest.current.document!==snapshot.document){setBooleanMessage('O documento mudou durante o cálculo. Nada foi substituído; tente novamente.');return;}
      let finalObjects=result.objects;
      if(keep&&(keep.source||keep.target)&&operation!=='boundary'){
        const chosen=snapshot.document.objects.filter(o=>snapshot.selectedIds.includes(o.id)&&!finalObjects.some(f=>f.id===o.id));
        const target=chosen[0],kept=chosen.filter(o=>o===target?keep.target:keep.source);
        const anchor=result.resultIds?.[0]??result.resultId,at=anchor?finalObjects.findIndex(o=>o.id===anchor):finalObjects.length;
        finalObjects=[...finalObjects.slice(0,Math.max(0,at)),...kept,...finalObjects.slice(Math.max(0,at))];
      }
      commitEdit();dispatch({type:'set-objects',objects:finalObjects});changeSelection(clipContents(finalObjects,result.resultIds??(result.resultId?[result.resultId]:[])));selectNode(null);
      setBooleanMessage(result.resultId?`${booleanLabels[operation]} concluído: ${booleanOperandIds(snapshot.document.objects,snapshot.selectedIds).length} formas → ${operation==='simplify'?`${result.resultIds?.length??1} caminhos`:operation==='boundary'?'novo contorno (originais mantidos)':'1 caminho'}. Ctrl+Z desfaz.`:'Resultado vazio: as formas selecionadas foram removidas. Ctrl+Z desfaz.');
    }catch(error){setBooleanMessage(error instanceof Error?error.message:'Não foi possível concluir a operação.');}
    finally{booleanRunning.current=false;setBooleanBusy(false);}
  }
  /** Objeto › Combinar (Ctrl+L): uma curva só com todos os contornos (textos entram pelo contorno das letras). */
  function combineCommand(){
    return runTask('Combinando…',async snapshot=>{
      const ids=snapshot.selectedIds,targets=snapshot.document.objects.filter(o=>ids.includes(o.id)&&o.type!=='image'&&!o.clipParent);
      if(targets.length<2){setBooleanMessage('Combinar (Ctrl+L): selecione duas ou mais formas, curvas ou textos.');return null;}
      const outlines=new Map<string,PathCommand[]>();
      for(const text of targets.filter(o=>o.type==='text'))outlines.set(text.id,(await (await import('../text/textOutlines')).textOutline(text)).commands);
      const result=combine(snapshot.document.objects,ids,outlines,ids[ids.length-1]);
      if(!result){setBooleanMessage('Combinar: selecione duas ou mais formas, curvas ou textos (bitmaps não entram).');return null;}
      return {objects:result.objects,select:[result.id],message:`${result.count} objetos combinados numa curva só. Ctrl+K quebra de novo; Ctrl+Z desfaz.`};
    });
  }
  /** Objeto › Converter contorno em objeto (Ctrl+Shift+Q), calculado no mesmo motor das booleanas. */
  async function outlineCommand(){
    if(booleanRunning.current)return;
    const snapshot=latest.current;
    const error=outlineSelectionError(snapshot.document.objects,snapshot.selectedIds);
    if(error){setBooleanMessage(error);return;}
    booleanRunning.current=true;setBooleanBusy(true);setBooleanMessage('Convertendo contorno em objeto…');
    try{
      const result=await runBoolean(snapshot.document.objects,snapshot.selectedIds,'outline');
      if(latest.current.document!==snapshot.document){setBooleanMessage('O documento mudou durante o cálculo. Nada foi substituído; tente novamente.');return;}
      const created=result.objects.filter(o=>!snapshot.document.objects.some(p=>p.id===o.id)).map(o=>o.id);
      commitEdit();dispatch({type:'set-objects',objects:result.objects});changeSelection(created);selectNode(null);
      setBooleanMessage(`Contorno convertido em ${created.length} objeto(s). Ctrl+Z desfaz.`);
    }catch(error){setBooleanMessage(error instanceof Error?error.message:'Não foi possível converter o contorno.');}
    finally{booleanRunning.current=false;setBooleanBusy(false);}
  }
  /** Executa uma tarefa longa sobre o documento e só aplica se ele não mudou nesse meio-tempo. */
  async function runTask(busy:string,task:(snapshot:typeof latest.current)=>Promise<{objects:VectorObject[];select?:string[];message:string}|null>){
    if(booleanRunning.current)return;
    const snapshot=latest.current;
    booleanRunning.current=true;setBooleanBusy(true);setBooleanMessage(busy);
    try{
      const result=await task(snapshot);
      if(!result)return;
      if(latest.current.document!==snapshot.document){setBooleanMessage('O documento mudou durante o cálculo. Nada foi substituído; tente novamente.');return;}
      commitEdit();dispatch({type:'set-objects',objects:result.objects});
      const objects=result.objects,selection=result.select??snapshot.selectedIds.filter(id=>objects.some(o=>o.id===id));
      changeSelection([...new Set(selection.flatMap(id=>selectionIds(objects,id)))]);selectNode(null);setBooleanMessage(result.message);
    }catch(error){setBooleanMessage(error instanceof Error?error.message:'Não foi possível concluir a operação.');}
    finally{booleanRunning.current=false;setBooleanBusy(false);}
  }
  /** Objeto › Converter em curvas (Ctrl+Q), inclusive textos (contorno real dos glifos no aplicativo instalado). */
  function convertCurvesCommand(){
    return runTask('Convertendo em curvas…',async snapshot=>{
      const ids=clipContents(snapshot.document.objects,snapshot.selectedIds),targets=snapshot.document.objects.filter(o=>ids.includes(o.id)&&canConvertToCurves(o));
      if(!targets.length){setBooleanMessage(ids.length?'A seleção já está em curvas (bitmaps não são convertidos).':'Selecione objetos para converter em curvas.');return null;}
      const outlines=new Map<string,PathCommand[]>();let approximate=0;
      for(const text of targets.filter(o=>o.type==='text')){const outline=await (await import('../text/textOutlines')).textOutline(text);outlines.set(text.id,outline.commands);if(!outline.exact)approximate++;}
      const result=convertToCurves(snapshot.document.objects,ids,outlines);
      return {objects:result.objects,message:`${result.converted} objeto(s) convertido(s) em curvas. Ferramenta Forma (F10) edita os nós.${approximate?' Texto convertido por rastreamento (fonte indisponível no navegador).':''}`};
    });
  }
  /** Efeitos com janela: misturar e extrusão (sombra, contorno e bloquear sombra são ferramentas). */
  function effectCommand(effect:EffectRequest){
    if(effect.kind==='blend')return runTask('Misturando…',async snapshot=>{const objects=blendObjects(snapshot.document.objects,snapshot.selectedIds,effect.steps,lastClicked.current===snapshot.selectedIds[1]?snapshot.selectedIds[0]:undefined);const added=objects.filter(o=>!snapshot.document.objects.some(p=>p.id===o.id));return {objects,select:added.slice(0,1).map(o=>o.id),message:`Mistura criada com ${added.length} etapas, agrupada. Ctrl+Z desfaz.`};});
    const error=effectSelectionError(latest.current.document.objects,latest.current.selectedIds,'sweep');
    if(error){setBooleanMessage(error);return Promise.resolve();}
    return runTask('Calculando extrusão…',async snapshot=>{
      const result=await runBoolean(snapshot.document.objects,snapshot.selectedIds,'sweep',effect.params);
      return {objects:result.objects,message:'Extrusão aplicada e agrupada com o objeto. Ctrl+Z desfaz.'};
    });
  }
  /** Bloquear sombra e Contorno ligados ao objeto (CorelDRAW): calculados no motor vetorial, um passo no Desfazer. */
  async function linkedEffect(kind:LinkedKind,ids:string[],link:LinkParams){
    if(booleanRunning.current)return;
    const doc=latest.current.document,error=effectSelectionError(doc.objects,ids,kind==='contour'?'contour':'sweep');
    const sources=doc.objects.filter(o=>ids.includes(o.id)&&!o.effectOf&&(o.type==='rectangle'||o.type==='ellipse'||o.type==='path'));
    if(error||!sources.length){setBooleanMessage(error??'Selecione retângulos, elipses ou curvas fechadas. Converta textos em curvas (Ctrl+Q).');return;}
    const label=kind==='blockShadow'?'Bloquear sombra':'Contorno';
    booleanRunning.current=true;setBooleanBusy(true);setBooleanMessage(`Calculando ${label.toLowerCase()}…`);
    try{
      let objects=doc.objects;
      for(const s of sources){
        const r=await runBoolean([s],[s.id],kind==='blockShadow'?'sweep':'contour',kind==='blockShadow'?sweepParams({...link,id:s.id,kind,origin:{x:0,y:0},shape:''}):contourParams({...link,id:s.id,kind,origin:{x:0,y:0},shape:''}));
        objects=placeLinked(objects,s,kind,r.objects.filter(o=>o.id!==s.id),link).objects;
      }
      if(latest.current.document!==doc){setBooleanMessage('O documento mudou durante o cálculo. Nada foi substituído; tente novamente.');return;}
      commitEdit();dispatch({type:'set-objects',objects});commitEdit();
      setBooleanMessage(`${label} aplicado, ligado ao objeto (acompanha quando ele muda). Ctrl+K separa · Ctrl+Z desfaz.`);
    }catch(e){setBooleanMessage(e instanceof Error?e.message:`Não foi possível aplicar ${label.toLowerCase()}.`);}
    finally{booleanRunning.current=false;setBooleanBusy(false);}
  }
  // Efeitos ligados cuja forma original mudou são refeitos em segundo plano (sem etapa extra no Desfazer).
  const regenerating=useRef(false),[regenTick,setRegenTick]=useState(0);
  useEffect(()=>{
    if(regenerating.current||!document.objects.some(o=>o.effectOf?.stale))return;
    const timer=window.setTimeout(async()=>{
      if(regenerating.current)return;
      regenerating.current=true;
      const doc=latest.current.document;
      try{
        const pending=new Map<string,EffectLink>();
        for(const o of doc.objects)if(o.effectOf?.stale)pending.set(`${o.effectOf.id}|${o.effectOf.kind}`,o.effectOf);
        let objects=doc.objects;
        for(const link of pending.values()){
          const s=objects.find(o=>o.id===link.id);if(!s)continue;
          const {id:_i,kind:_k,origin:_o,shape:_s,stale:_t,at:_a,...params}=link;
          try{
            const r=await runBoolean([s],[s.id],link.kind==='blockShadow'?'sweep':'contour',link.kind==='blockShadow'?sweepParams(link):contourParams(link));
            objects=placeLinked(objects,s,link.kind,r.objects.filter(o=>o.id!==s.id),params).objects;
          }catch{
            // Forma que não aceita mais o efeito (ex.: curva aberta): o efeito fica como estava, sem nova tentativa.
            objects=objects.map(o=>o.effectOf?.id===link.id&&o.effectOf.kind===link.kind?{...o,effectOf:(({stale:_,...rest})=>rest)(o.effectOf)}:o);
          }
        }
        if(latest.current.document===doc)send({type:'amend',action:{type:'set-objects',objects}});
      }finally{regenerating.current=false;setRegenTick(t=>t+1);}
    },150);
    return()=>window.clearTimeout(timer);
  },[document,regenTick]);
  /** Objeto › Quebrar curva em partes (Ctrl+K): contornos viram objetos; textos se separam em linhas, palavras ou letras. */
  function breakApartCommand(){
    const {document:doc,selectedIds:ids}=latest.current;
    if(!ids.length){setBooleanMessage('Selecione uma curva ou um texto para quebrar.');return;}
    // Com Bloquear sombra ou Contorno ligado, Ctrl+K separa o efeito (como no CorelDRAW).
    const separated=separateEffects(doc.objects,ids);
    if(separated.pieces.length){commitEdit();dispatch({type:'set-objects',objects:separated.objects});commitEdit();changeSelection(separated.pieces);selectNode(null);setBooleanMessage(`${separated.kind==='blockShadow'?'Bloquear sombra separada':'Grupo de contorno separado'}: agora é um objeto independente. Ctrl+Z desfaz.`);return;}
    const shadows=separateShadows(doc.objects,ids);
    if(shadows.pieces.length){commitEdit();dispatch({type:'set-objects',objects:shadows.objects});commitEdit();changeSelection(shadows.pieces);selectNode(null);setBooleanMessage('Sombra separada: agora é um objeto próprio atrás do original (cor, opacidade e desfoque mantidos). Ctrl+Z desfaz.');return;}
    // Texto em caminho ligado (CorelDRAW): Ctrl+K separa o texto da curva.
    const linked=doc.objects.filter(o=>ids.includes(o.id)&&o.type==='text'&&o.textPath?.source);
    if(linked.length){commitEdit();dispatch({type:'set-objects',objects:doc.objects.map(o=>linked.includes(o)?detachPathText(o):o)});commitEdit();setBooleanMessage('Texto separado do caminho: mantém a forma, mas não acompanha mais a curva. Ctrl+Z desfaz.');return;}
    const prepared=doc.objects.map(o=>ids.includes(o.id)&&o.type==='text'&&o.fontSize===undefined?updateText(o,{},browserMeasure):o);
    const result=breakApart(prepared,ids,browserMeasure);
    if(!result.broken){setBooleanMessage('Nada para quebrar: selecione uma curva com várias partes (Ctrl+Q converte formas) ou um texto com mais de uma linha, palavra ou letra.');return;}
    commitEdit();dispatch({type:'set-objects',objects:result.objects});commitEdit();
    changeSelection(result.pieces);selectNode(null);setBooleanMessage(`Quebrado em ${result.pieces.length} partes. Ctrl+Z desfaz.`);
  }
  const repeat=useRef<RepeatState>({step:null,copy:null});
  function recordTransform(before:VectorObject[],ids:string[],matrix:Matrix,copies?:string[]){repeat.current=record(repeat.current,before,ids,matrix,copies);}
  /** Ctrl+R: repete a última transformação; se ela foi feita numa cópia, cria outra cópia com o mesmo espaçamento. */
  function repeatCommand(){
    const {document:doc,selectedIds:ids}=latest.current;
    if(!ids.length){setBooleanMessage('Selecione um objeto para repetir (Ctrl+R).');return;}
    const result=repeatStep(repeat.current,doc.objects,ids);
    if(!result){setBooleanMessage('Nada para repetir: mova, gire ou duplique um objeto primeiro (Ctrl+D, ou botão direito ao arrastar).');return;}
    commitEdit();dispatch({type:'set-objects',objects:result.objects});commitEdit();
    repeat.current=result.state;changeSelection(result.ids);selectNode(null);
    setBooleanMessage(repeat.current.step?.duplicate?'Cópia repetida com o mesmo espaçamento. Ctrl+R de novo continua.':'Transformação repetida.');
  }
  /** Setas do teclado: deslocam a seleção (cada toque é um passo do Desfazer). */
  function transformCommand(build:(bounds:Bounds)=>Matrix|null,copies:number){
    const {document:doc,selectedIds:sel}=latest.current;
    if(!sel.length){setBooleanMessage('Transformações: selecione um objeto.');return;}
    let objects=doc.objects,ids=[...new Set(sel.flatMap(id=>selectionIds(objects,id)))];
    const box=(list:VectorObject[],chosen:string[])=>boundsOf(list.filter(o=>chosen.includes(o.id)&&(!o.clipParent||!chosen.includes(o.clipParent))));
    const count=Math.max(0,Math.min(500,Math.round(copies)));
    if(!count){const m=build(box(objects,ids));if(!m)return;objects=applyMatrix(objects,clipContents(objects,ids),m);}
    else for(let i=0;i<count;i++){
      // Cada cópia parte da anterior (como Aplicar com cópias no CorelDRAW).
      const m=build(box(objects,ids));if(!m)return;
      const result=duplicateObjects(objects,clipContents(objects,ids),undefined,m);objects=result.objects;
      ids=[...new Set(result.ids.filter(id=>{const o=objects.find(o=>o.id===id)!;return !o.clipParent||!result.ids.includes(o.clipParent);}).flatMap(id=>selectionIds(objects,id)))];
    }
    commitEdit();dispatch({type:'set-objects',objects});commitEdit();changeSelection(ids);
    setBooleanMessage(count?`${count} ${count===1?'cópia criada':'cópias criadas'}. Ctrl+Z desfaz.`:'Transformação aplicada. Ctrl+Z desfaz.');
  }
  function nudge(dx:number,dy:number){
    const {document:doc,selectedIds:ids}=latest.current;
    if(!ids.length)return;
    commitEdit();dispatch({type:'set-objects',objects:applyMatrix(doc.objects,clipContents(doc.objects,ids),translate(dx,dy))});commitEdit();
    recordTransform(doc.objects,ids,translate(dx,dy));
  }
  function removeSelected() { const current=latest.current;if (current.selectedIds.length) { const ids=clipContents(current.document.objects,current.selectedIds);commitEdit(); dispatch({ type: 'set-objects', objects: current.document.objects.filter(o=>!ids.includes(o.id)) }); select(null); } }
  function addObjects(objects: VectorObject[]) {
    const current=latest.current.document.objects;
    if(!objects.length)return;
    if(current.length+objects.length>10000){setBooleanMessage('Limite de 10.000 objetos por projeto.');return;}
    commitEdit();dispatch({type:'set-objects',objects:[...current,...objects]});
    changeTool('select');changeSelection(objects.filter(o=>!o.clipParent).map(o=>o.id).flatMap(id=>selectionIds([...current,...objects],id)).filter((id,i,all)=>all.indexOf(id)===i));selectNode(null);
  }
  function objectCommand(command: ObjectCommand) {
    const current=latest.current;
    if(!current.selectedIds.length)return;
    const ids=[...new Set(current.selectedIds.flatMap(id=>current.clipEdit?[id]:selectionIds(current.document.objects,id)))];
    commitEdit();
    let objects=current.document.objects;
    const page={x:0,y:0,...current.document.artboard};
    if(command==='group')objects=groupObjects(objects,ids,crypto.randomUUID());
    else if(command==='ungroup')objects=ungroupObjects(objects,ids);
    else if(command==='ungroupAll')objects=ungroupAll(objects,ids);
    else if(command==='duplicate'){const before=objects,result=duplicateObjects(objects,clipContents(objects,ids));objects=result.objects;const copies=result.ids.filter(id=>{const o=result.objects.find(o=>o.id===id)!;return !o.clipParent||!result.ids.includes(o.clipParent);}).flatMap(id=>selectionIds(result.objects,id));changeSelection(copies);if(result.objects!==before)recordTransform(before,ids,translate(20,20),copies);}
    else if(command==='page'){const visible=objects.filter(o=>ids.includes(o.id)&&(!o.clipParent||!ids.includes(o.clipParent))),b=boundsOf(visible);objects=applyMatrix(objects,ids,translate(page.x+page.width/2-b.x-b.width/2,page.y+page.height/2-b.y-b.height/2));}
    else if(command==='mirrorH'||command==='mirrorV'){const visible=objects.filter(o=>ids.includes(o.id)&&(!o.clipParent||!ids.includes(o.clipParent))),b=boundsOf(visible);objects=applyMatrix(objects,clipContents(objects,ids),mirror({x:b.x+b.width/2,y:b.y+b.height/2},command==='mirrorH'));}
    else if(['front','back','forward','backward'].includes(command))objects=orderObjects(objects,ids,command as Order);
    else if(command.startsWith('dist')){objects=distributeObjects(objects,ids,command as Distribution);if(objects===current.document.objects)setBooleanMessage('Distribuir: selecione três ou mais objetos.');}
    else{
      // O último objeto selecionado fica fixo (como no CorelDRAW); um objeto sozinho alinha à página.
      const anchor=lastClicked.current&&ids.includes(lastClicked.current)?lastClicked.current:current.selectedIds.at(-1);
      const aligned=alignObjects(objects,ids,command as Alignment,undefined,anchor);objects=aligned!==objects?aligned:alignObjects(objects,ids,command as Alignment,page);
    }
    dispatch({type:'set-objects',objects});
  }
  /** PowerClip dentro: o próximo clique na área de trabalho escolhe o quadro (Esc ou botão direito cancela). */
  function pickClipFrame(id: string | null) {
    setClipPick(false);
    if(!id){setBooleanMessage('PowerClip cancelado.');return;}
    clipCommand('place',id);
  }
  function clipCommand(command: ClipCommand, pickedFrame?: string) {
    const current=latest.current,objects=current.document.objects;
    if(command==='place'&&!pickedFrame){
      if(!current.selectedIds.length){setBooleanMessage('Selecione o que vai dentro do PowerClip.');return;}
      setClipPick(true);setBooleanMessage('PowerClip dentro: clique na forma que será o quadro (Esc cancela).');return;
    }
    try{
      if(command==='finish'){setClipEdit(null);changeSelection(current.clipEdit?selectionIds(objects,current.clipEdit):[]);setBooleanMessage('');return;}
      const frameId=pickedFrame??(command==='place'?undefined:current.selectedIds.find(id=>objects.some(o=>o.clipParent===id))??current.selectedIds.find(id=>canBeFrame(objects.find(o=>o.id===id))));
      if(!frameId)throw new Error(command==='place'?'Selecione o conteúdo e, por último, o quadro (Shift + clique).':'Selecione um quadro PowerClip.');
      const frame=objects.find(o=>o.id===frameId)!;
      if(command!=='place'&&!objects.some(o=>o.clipParent===frameId))throw new Error('O objeto selecionado não contém PowerClip.');
      if(command==='edit'){setClipEdit(frameId);changeTool('select');changeSelection([]);setBooleanMessage('Editando conteúdo do PowerClip. Use "Concluir edição" ao terminar.');return;}
      let next=objects;
      if(command==='place'){
        if(!canBeFrame(frame))throw new Error('PowerClip só funciona com quadro vetorial fechado (retângulo, elipse ou curva fechada); textos, bitmaps e linhas abertas não servem de quadro.');
        if(clipContents(objects,current.selectedIds).includes(frameId))throw new Error('O quadro não pode ser um dos objetos selecionados. Clique em outra forma.');
        // Como no CorelDRAW: conteúdo sobre o quadro fica onde está; fora do quadro, é centralizado para ficar visível.
        next=centerIfOutside(placeInside(objects,current.selectedIds,frameId),frameId);
      }
      else if(command==='extract')next=extractContents(objects,frameId);
      else if(command==='lock'||command==='unlock')next=setContentsLocked(objects,frameId,command==='lock');
      else next=fitContents(objects,frameId,command);
      commitEdit();dispatch({type:'set-objects',objects:next});
      changeSelection(command==='extract'?[...new Set([frameId,...objects.filter(o=>o.clipParent===frameId).map(o=>o.id)])]:selectionIds(next,frameId));selectNode(null);
      setBooleanMessage(command==='place'?'PowerClip criado. Objeto › PowerClip › Editar conteúdo para ajustar.':command==='extract'?'Conteúdo extraído do PowerClip.':command==='unlock'?'Conteúdo destravado: o quadro se move sem o conteúdo.':command==='lock'?'Conteúdo travado ao quadro.':'Conteúdo ajustado ao quadro.');
    }catch(error){setBooleanMessage(error instanceof Error?error.message:'Não foi possível concluir o PowerClip.');}
  }
  function resetView() { setClipEdit(null); setClipPick(false); changeSelection([]); selectNode(null); setBooleanMessage(''); }
  /** Navegador de páginas: trocar de página não entra no Desfazer nem marca alterações. */
  function goToPage(index: number) {
    const doc = latest.current.document, page = doc.pages?.[index];
    if (!page || index === activePage(doc)) return;
    commitEdit(); send({ type: 'page', id: page.id }); resetView();
  }
  function pageCommand(command: PageCommand, options: { index?: number; name?: string; to?: number } = {}) {
    const doc = latest.current.document, at = options.index ?? activePage(doc), name = pageList(doc)[at]?.name;
    try {
      const state = command === 'insert-after' ? insertPage(doc, true, at) : command === 'insert-before' ? insertPage(doc, false, at) : command === 'duplicate' ? duplicatePage(doc, at) : command === 'delete' ? deletePage(doc, at) : command === 'rename' ? renamePage(doc, at, options.name ?? '') : movePage(doc, at, options.to ?? at);
      commitEdit(); dispatch({ type: 'set-pages', document: state }); commitEdit(); resetView();
      setBooleanMessage(command === 'delete' ? `${name} excluída. Ctrl+Z desfaz.` : command === 'rename' ? 'Página renomeada.' : command === 'move' ? 'Página reordenada.' : `${pageList({ ...doc, ...state })[state.page ?? 0].name} criada.`);
    } catch (error) { setBooleanMessage(error instanceof Error ? error.message : 'Não foi possível alterar as páginas.'); }
  }
  // Abas de documentos: só a aba ativa vive no estado do editor; as demais ficam guardadas aqui.
  const [file, setFile] = useState<ProjectFile | null>(null);
  const [sessions, setSessions] = useState<Session[]>(() => [{ id: crypto.randomUUID(), file: null, history: null, viewport: { x: 0, y: 0, zoom: 1 }, blank: startsBlank(), initial: true }]);
  const [activeTab, setActiveTab] = useState(() => sessions[0].id);
  const liveDirty = draftPending || isDirty(history);
  const stored = (list: Session[]) => list.map(s => s.id === activeTab ? { ...s, history, viewport, file } : s);
  function show(target: Session, list: Session[]) {
    setSessions(list.map(s => s.id === target.id ? { ...s, history: null } : s));
    send({ type: 'restore', state: target.history! }); setViewport(target.viewport); setFile(target.file); setActiveTab(target.id);
    setDraftPending(false); resetView(); changeTool('select');
  }
  function openTab(next: VectorDocument, opened: ProjectFile | null) {
    // O documento de reserva da Tela de boas-vindas (ou o inicial, intocado) é substituído em vez de ganhar outra aba.
    const current = sessions.find(s => s.id === activeTab), pristine = !!(current?.blank || current?.initial) && !file && !liveDirty && history.past.length === 0 && pageList(document).every(p => !p.objects.length);
    if (!pristine) { const id = crypto.randomUUID(); setSessions(list => [...stored(list), { id, file: opened, history: null, viewport }]); setActiveTab(id); }
    else setSessions(list => list.map(s => s.id === activeTab ? { ...s, blank: false, initial: false } : s));
    send({ type: 'load', document: next }); setFile(opened); setDraftPending(false); resetView(); changeTool('select'); fitToScreen();
  }
  function switchTab(id: string) {
    const target = sessions.find(s => s.id === id);
    if (!target || id === activeTab || !target.history) return;
    show(target, stored(sessions));
  }
  /** Arquivo › Fechar tudo: pergunta uma vez se houver alterações não salvas e volta a um documento novo. */
  function closeAllTabs(force = false) {
    const dirty = sessions.filter(s => s.id === activeTab ? liveDirty : isDirty(s.history!));
    // Com alterações: a janela Salvar/Não salvar/Cancelar (CloseGuard) pergunta e depois fecha com `force`.
    if (dirty.length && !force) { window.dispatchEvent(new CustomEvent('vectorstudio:confirm-close', { detail: { ids: dirty.map(s => s.id), all: true } })); return false; }
    const keep = sessions.find(s => s.id === activeTab) ?? sessions[0];
    setSessions([{ ...keep, blank: true }]); send({ type: 'load', document: createDocument() }); setFile(null); setDraftPending(false); resetView(); fitToScreen();
    return true;
  }
  function closeTab(id: string, force = false) {
    const target = sessions.find(s => s.id === id);
    if (!target) return false;
    const dirtyTab = id === activeTab ? liveDirty : isDirty(target.history!), name = id === activeTab ? file?.name ?? document.name : target.file?.name ?? target.history!.present.name;
    void name;
    if (dirtyTab && !force) { window.dispatchEvent(new CustomEvent('vectorstudio:confirm-close', { detail: { ids: [id], all: false } })); return false; }
    // Último documento fechado: volta à Tela de boas-vindas (fica só um documento de reserva, sem aba).
    if (sessions.length === 1) { setSessions(list => list.map(s => ({ ...s, blank: true }))); send({ type: 'load', document: createDocument() }); setFile(null); setDraftPending(false); resetView(); fitToScreen(); return true; }
    const rest = sessions.filter(s => s.id !== id);
    if (id !== activeTab) { setSessions(rest); return true; }
    const index = sessions.findIndex(s => s.id === id);
    show(rest[Math.min(index, rest.length - 1)], rest);
    return true;
  }
  const tabs: DocumentTab[] = sessions.map(s => s.id === activeTab || !s.history ? { id: s.id, name: file?.name ?? document.name, dirty: liveDirty, file, document, blank: !!s.blank && !file && !liveDirty && history.past.length === 0 && pageList(document).every(p => !p.objects.length) } : { id: s.id, name: s.file?.name ?? s.history.present.name, dirty: isDirty(s.history), file: s.file, document: s.history.present, blank: false });
  /** Bloquear a seleção; desbloquear um objeto (com o grupo dele) ou todos. */
  function lockCommand(lock: boolean, id?: string | 'all') {
    const objects = latest.current.document.objects;
    const ids = lock ? clipContents(objects, latest.current.selectedIds) : id === 'all' ? objects.filter(o => o.locked).map(o => o.id) : id ? clipContents(objects, selectionIds(objects, id)) : [];
    if (!ids.length) { setBooleanMessage(lock ? 'Selecione o que deseja bloquear.' : 'Nenhum objeto bloqueado.'); return; }
    commitEdit(); dispatch({ type: 'set-objects', objects: objects.map(o => ids.includes(o.id) ? (lock ? { ...o, locked: true } : (({ locked: _, ...rest }) => rest)(o)) : o) }); commitEdit();
    if (lock) { changeSelection([]); selectNode(null); setBooleanMessage(`${ids.length} objeto(s) bloqueado(s). Botão direito no objeto › Desbloquear.`); }
    else { changeSelection(id === 'all' ? [] : ids.filter(i => !objects.find(o => o.id === i)?.clipParent || !ids.includes(objects.find(o => o.id === i)!.clipParent!))); selectNode(null); setBooleanMessage(`${ids.length} objeto(s) desbloqueado(s).`); }
  }
  // Desfazer/Refazer mantêm a seleção (como no CorelDRAW): só saem da seleção os objetos que deixaram de existir.
  function undo() { send({ type: 'undo' }); selectNode(null); }
  function redo() { send({ type: 'redo' }); selectNode(null); }
  useEffect(() => {
    if (selectedIds !== rawSelection) changeSelection(selectedIds);
  }, [selectedIds]); // eslint-disable-line react-hooks/exhaustive-deps
  function loadDocument(document: VectorDocument) { send({ type: 'load', document }); setClipEdit(null); select(null); setTool('select'); fitToScreen(); }
  return <Context.Provider value={{ document, dispatch, amend: action => send({ type: 'amend', action }), tool, setTool, selectedId, selectedIds, chooseObject, objectCommand, clipCommand, lockCommand, clipPick, pickClipFrame, breakApartCommand, combineCommand, nudge, recordTransform, transformCommand, repeatCommand, clipEdit, addObjects, booleanCommand, cutCommand, booleanBusy, booleanMessage, setMessage: setBooleanMessage, select, setSelection: ids => { changeSelection(ids); selectNode(null); }, selectedNode, selectedNodes, setSelectedNodes, selectNode, fill, setFill, outline, setOutline, outlineWidth, setOutlineWidth, shapeOptions, setShapeOptions, textStyle, setTextStyle, outlineCommand, convertCurvesCommand, effectCommand, linkedEffect, nodeMirror, setNodeMirror, removeSelected, beginEdit, commitEdit, undo, redo, canUndo: draftPending || history.past.length > 0 || (history.transaction !== null && fingerprint(history.transaction) !== fingerprint(document)), canRedo: history.future.length > 0 && !(history.transaction && fingerprint(history.transaction) !== fingerprint(document)), dirty: draftPending || isDirty(history), setDraftPending, markSaved: snapshot => send({ type: 'saved', snapshot }), loadDocument, viewport, setViewport, fitRequest, fitToScreen, goToPage, pageCommand, tabs, activeTab, openTab, switchTab, closeTab, closeAllTabs, file, setFile, anyDirty: tabs.some(t => t.dirty) }}>{children}</Context.Provider>;
}
export function useEditor() { const state = useContext(Context); if (!state) throw new Error('EditorProvider ausente'); return state; }
