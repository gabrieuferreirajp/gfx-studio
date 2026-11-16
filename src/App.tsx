import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Printer, Moon, Sun, Save, FolderOpen, Undo2, Redo2, Scan, X, FilePlus2, Settings2, FileOutput, ImageDown, Scissors, Copy, ClipboardPaste, Maximize, Ruler, Magnet, SaveAll, Grid3x3, SeparatorVertical } from 'lucide-react';
import { EditorProvider, useEditor } from './state/EditorContext';
import { Toolbar, toolItems } from './components/Toolbar';
import { Canvas } from './components/Canvas';
import { ObjectsPanel } from './components/ObjectsPanel';
import { FullScreenPreview } from './workspace/FullScreenPreview';
import { ZoomControls, zoomToAllObjects } from './components/ZoomControls';
import { finishEditing, useProjectFiles } from './state/useProjectFiles';
import {WorkspaceProvider,useWorkspace} from './workspace/WorkspaceContext';
import {DockLayout} from './workspace/DockLayout';
import {WorkspaceSettings} from './workspace/WorkspaceSettings';
import {MenuBar} from './workspace/MenuBar';
import {PropertyBar} from './workspace/PropertyBar';
import {ColorPalette,DocumentPalette} from './workspace/ColorPalette';
import {ExportDialog} from './workspace/ExportDialog';
import {FillDialog} from './workspace/FillDialog';
import {OutlineDialog} from './workspace/OutlineDialog';
import {PaintStatus} from './workspace/PaintStatus';
import {CloseGuard} from './workspace/CloseDialog';
import {RecoveryDialog} from './workspace/RecoveryDialog';
import {useAutoBackup} from './state/autoBackup';
import {TraceDialog,CenterlineDialog,isCenterlinePreset,quickTrace,traceMenuItems,type TracePreset,type TraceRequest,type CenterlinePreset} from './workspace/TraceDialog';
import {ContextMenu,menuSeparator,type MenuItem} from './workspace/ContextMenu';
import {EffectsDialog} from './workspace/EffectsDialog';
import {DistortDialog} from './workspace/DistortDialog';
import {BitmapDialog} from './workspace/BitmapDialog';
import {ShapingDialogs,openShapingWindow} from './workspace/ShapingDialogs';
import {PdfPagesDialog} from './workspace/PdfPagesDialog';
import {PrintPreview} from './workspace/PrintPreview';
import {WelcomeScreen,welcome} from './workspace/WelcomeScreen';
import {PropertiesWindows} from './workspace/CopyProperties';
import {RemoveBackgroundDialog,openRemoveBackground} from './workspace/RemoveBackgroundDialog';
import {LibraryDialogs,openLibrary} from './workspace/LibraryDialogs';
import {DocumentDialog} from './workspace/DocumentDialog';
import {TransformDialog,openTransform} from './workspace/TransformDialog';
import {distributionLabels,type Distribution} from './geometry/objectTransforms';
import {DocumentTabs,PageNavigator} from './workspace/DocumentTabs';
import {activePage} from './document/pages';
import {effectItems,runEffectItem} from './components/Toolbar';
import {separateLabel} from './geometry/effectLinks';
import {canConvertToCurves} from './geometry/convertCurves';
import {externalKind,openExternal} from './io/importDocument';
import {printDocument} from './io/print';
import {createDocument, type VectorObject} from './document/model';
import {screenToDocument} from './document/viewport';
import {clipContents} from './geometry/objectTransforms';
import {CLIP_MARKER, imageObjectFromBlob, parseClip, serializeClip} from './io/clipboard';
import {isBlocked} from './document/layers';
import {TextToolsDialogs} from './workspace/TextToolsDialogs';
import {checkSpelling,runTextCommand,textCommandError} from './workspace/textCommands';
const alignKeys: Record<string, 'left'|'right'|'top'|'bottom'|'center'|'middle'|'page'> = { l: 'left', r: 'right', t: 'top', b: 'bottom', c: 'center', e: 'middle', p: 'page' };
const editable = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');
/** Aviso pequeno de "Salvo" (1 segundo) logo abaixo das barras de ferramentas, sobre a área de desenho. */
function SavedToast() {
  const [top] = useState(() => (window.document.querySelector('.document-workspace')?.getBoundingClientRect().top ?? 120) + 10);
  const [shown, setShown] = useState(true);
  useEffect(() => { const t = window.setTimeout(() => setShown(false), 1000); return () => window.clearTimeout(t); }, []);
  return shown ? <div className="saved-toast" role="status" style={{ top }}><span aria-hidden="true">✅</span> Salvo</div> : null;
}
function Editor() {
  const {layout,setLayout,customize}=useWorkspace();
  const layoutRef=useRef(layout);layoutRef.current=layout;
  // F9: visualização em tela cheia só com o desenho (sem menus e barras).
  const [preview,setPreview]=useState(false),closePreview=useCallback(()=>setPreview(false),[]);
  const [menu,setMenu]=useState<{x:number;y:number;items?:MenuItem[]}|null>(null),[documentDialog,setDocumentDialog]=useState(false);
  const dark=layout.theme==='dark';
  // Propriedades (Alt+Enter): encaixada à direita abre/recolhe sobre as abas verticais; em outra posição mostra/oculta.
  const inspectorShown=layout.panels.inspector.visible&&(layout.panels.inspector.dock!=='right'||layout.inspectorOpen);
  function toggleInspector(){const s=layoutRef.current,p=s.panels.inspector;
    if(p.dock==='right'&&p.visible)setLayout(o=>({...o,inspectorOpen:!o.inspectorOpen}));
    else setLayout(o=>({...o,inspectorOpen:true,panels:{...o.panels,inspector:{...o.panels.inspector,visible:!p.visible}}}));}
  const editor = useEditor();
  const { document, tool, setTool, select, selectedId, selectedIds, removeSelected, undo, redo, canUndo, canRedo, dirty, viewport, fitToScreen, objectCommand,booleanMessage,setMessage,addObjects,clipEdit,clipCommand,setSelection } = editor;
  const files = useProjectFiles();
  useAutoBackup(layout.autoBackup, layout.autoBackupMinutes, setMessage);
  const [paintDialog,setPaintDialog]=useState<'fill'|'outline'|null>(null);
  const [exporting,setExporting]=useState(false),[tracing,setTracing]=useState<TracePreset|null>(null),[centerline,setCenterline]=useState<CenterlinePreset|null>(null);
  const importInput=useRef<HTMLInputElement>(null);
  const latest=useRef(editor);latest.current=editor;
  // Novos documentos numerados como no CorelDRAW (Sem título-2, -3…).
  const untitled=useRef(1);
  // Layout › Configurar página… abre Propriedades do documento (tamanho, unidade e nome).
  useEffect(()=>{const show=()=>setDocumentDialog(true);window.addEventListener('vectorstudio:document-dialog',show);return()=>window.removeEventListener('vectorstudio:document-dialog',show);},[]);
  function print(){finishEditing();setMessage('Preparando impressão…');void printDocument(latest.current.document).then(setMessage,error=>setMessage(error instanceof Error?error.message:'Não foi possível imprimir.'));}
  function newDocument(){finishEditing();welcome.set(false);editor.openTab({...createDocument(),name:`Sem título-${++untitled.current}`},null);}
  function viewCenter(){const svg=window.document.querySelector('.canvas-viewport')?.getBoundingClientRect();const v=latest.current.viewport;return svg?screenToDocument(v,svg.width/2,svg.height/2):{x:document.artboard.width/2,y:document.artboard.height/2};}
  async function insertImage(blob:Blob){
    try{const object=await imageObjectFromBlob(blob,viewCenter(),document.artboard.width,document.artboard.height);addObjects([object]);setMessage('Bitmap inserido. Bitmaps › Rastreamento de contorno converte em vetores.');}
    catch(error){setMessage(error instanceof Error?error.message:'Não foi possível inserir a imagem.');}
  }
  const copied=()=>{const {document,selectedIds}=latest.current;const ids=clipContents(document.objects,selectedIds);return document.objects.filter(o=>ids.includes(o.id));};
  async function pasteFromMenu(){
    try{
      const items=await navigator.clipboard.read();
      for(const item of items){const type=item.types.find(t=>t.startsWith('image/'));if(type){await insertImage(await item.getType(type));return;}}
      for(const item of items)if(item.types.includes('text/plain')){const objects=parseClip(await (await item.getType('text/plain')).text());if(objects){addObjects(objects);return;}}
      setMessage('A área de transferência não contém imagem nem objetos do GFX Studio.');
    }catch{setMessage('O navegador bloqueou a leitura pelo menu. Use Ctrl+V para colar.');}
  }
  async function copyFromMenu(cut=false){const objects=copied();if(!objects.length)return;try{await navigator.clipboard.writeText(serializeClip(objects));if(cut)removeSelected();}catch{setMessage('O navegador bloqueou a área de transferência pelo menu. Use Ctrl+C / Ctrl+X.');}}
  useEffect(()=>{
    // Ctrl+C/X/V ficam com o campo só quando ele recebe texto de verdade: lista, botão ou campo sem texto marcado
    // (foco que sobrou na barra de propriedades) não podem impedir copiar/colar objetos.
    const field=()=>{const a=window.document.activeElement;return a instanceof HTMLTextAreaElement||(a instanceof HTMLInputElement&&/^(text|search|number|email|url|tel|password)$/.test(a.type))?a:a instanceof HTMLElement&&a.isContentEditable?a:null;};
    const fieldHasSelection=()=>{const f=field();if(!f)return false;if(f instanceof HTMLInputElement||f instanceof HTMLTextAreaElement){try{return f.selectionStart!==f.selectionEnd;}catch{return true;}}return !(window.getSelection()?.isCollapsed??true);};
    function copy(event:ClipboardEvent,cut=false){if(fieldHasSelection())return;const objects=copied();if(!objects.length||!event.clipboardData)return;event.preventDefault();event.clipboardData.setData('text/plain',serializeClip(objects));if(cut)latest.current.removeSelected();}
    function paste(event:ClipboardEvent){
      if(!event.clipboardData)return;
      const image=[...event.clipboardData.files].find(f=>f.type.startsWith('image/'));
      // Num campo de texto, texto comum é colado no campo; objetos do GFX Studio e imagens vão para a página.
      if(field()&&!image&&!event.clipboardData.getData('text/plain').startsWith(CLIP_MARKER))return;
      field()?.blur();
      event.preventDefault();finishEditing();
      if(image){void insertImage(image);return;}
      try{const objects=parseClip(event.clipboardData.getData('text/plain'));if(objects){latest.current.addObjects(objects);return;}}
      catch(error){latest.current.setMessage(error instanceof Error?error.message:'Conteúdo colado inválido.');return;}
      latest.current.setMessage('A área de transferência não contém imagem nem objetos do GFX Studio.');
    }
    const onCopy=(e:ClipboardEvent)=>copy(e),onCut=(e:ClipboardEvent)=>copy(e,true);
    window.addEventListener('copy',onCopy);window.addEventListener('cut',onCut);window.addEventListener('paste',paste);
    return()=>{window.removeEventListener('copy',onCopy);window.removeEventListener('cut',onCut);window.removeEventListener('paste',paste);};
  },[]);
  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      if (window.document.querySelector('.context-menu, dialog[open]:modal, .brush-picker')) return;
      if (e.key === 'F9') { e.preventDefault(); setPreview(true); return; }
      // F4: zoom em todos os objetos (visão geral de tudo, como no CorelDRAW).
      if (e.key === 'F4' && !e.ctrlKey && !e.altKey && !e.shiftKey) { e.preventDefault(); if (!zoomToAllObjects(latest.current.document, latest.current.setViewport)) setMessage('O documento não tem objetos visíveis.'); return; }
      // F11: Editar preenchimento; F12: Caneta de contorno (CorelDRAW).
      if ((e.key === 'F11' || e.key === 'F12') && !e.ctrlKey && !e.altKey) { e.preventDefault(); finishEditing(); setPaintDialog(e.key === 'F11' ? 'fill' : 'outline'); return; }
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); setLayout(s => ({ ...s, smartGuides: !s.smartGuides })); setMessage(layoutRef.current.smartGuides ? 'Guias dinâmicas desligadas.' : 'Guias dinâmicas ligadas.'); return; }
      // Setas deslocam a seleção pela distância configurada (CorelDRAW: Deslocamento; Shift = Superdeslocamento; Ctrl = Microdeslocamento).
      const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (arrow && !editable(e.target) && !e.altKey && latest.current.selectedIds.length && latest.current.tool === 'select') { e.preventDefault(); const {nudge,superNudge,microNudge}=layoutRef.current, step = e.shiftKey ? superNudge : e.ctrlKey ? microNudge : nudge; latest.current.nudge(arrow[0] * step, arrow[1] * step); return; }
      if (e.altKey && e.key === 'Enter') { e.preventDefault(); toggleInspector(); return; }
      // Texto (CorelDRAW): Ctrl+F8 converte artístico ↔ parágrafo; Ctrl+F12 verifica a ortografia.
      if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'F8' || e.key === 'F12') && !editable(e.target)) { e.preventDefault(); if (e.key === 'F8') runTextCommand(latest.current, 'paragraph'); else checkSpelling(latest.current); return; }
      // Estilos de objeto (Ctrl+F5) e Gerenciador de símbolos (Ctrl+F3), como no CorelDRAW.
      // Ctrl+J: Opções (como no CorelDRAW), na janela de personalização.
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 'F4') { e.preventDefault(); finishEditing(); latest.current.closeTab(latest.current.activeTab); return; }
      // Ctrl+L combina; Ctrl+Shift+D abre Etapa e repetição (como no CorelDRAW).
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'l' && !editable(e.target)) { e.preventDefault(); finishEditing(); void latest.current.combineCommand(); return; }
      if (e.ctrlKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'd' && !editable(e.target)) { e.preventDefault(); finishEditing(); openShapingWindow('stepRepeat'); return; }
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j' && !editable(e.target)) { e.preventDefault(); finishEditing(); customize(true); return; }
      if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'F5' || e.key === 'F3' || e.key === 'F6') && !editable(e.target)) { e.preventDefault(); finishEditing(); openLibrary(e.key === 'F5' ? 'styles' : e.key === 'F6' ? 'colors' : 'symbols'); return; }
      // Transformações (CorelDRAW): Alt+F7 posição, Alt+F8 girar, Alt+F9 escala, Alt+F10 tamanho; Ctrl+Shift+A alinhar e distribuir.
      const transformKey = e.altKey && !e.ctrlKey ? ({ F7: 'position', F8: 'rotate', F9: 'scale', F10: 'size' } as const)[e.key as 'F7'] : undefined;
      if (transformKey) { e.preventDefault(); openTransform(transformKey); return; }
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a' && !editable(e.target)) { e.preventDefault(); openTransform('align'); return; }
      // Ordem (CorelDRAW): Ctrl+Home/End frente/trás da página, Shift+PgUp/PgDn frente/trás, Ctrl+PgUp/PgDn um nível.
      const order = e.ctrlKey && e.key === 'Home' ? 'front' : e.ctrlKey && e.key === 'End' ? 'back' : e.shiftKey && e.key === 'PageUp' ? 'front' : e.shiftKey && e.key === 'PageDown' ? 'back' : e.ctrlKey && e.key === 'PageUp' ? 'forward' : e.ctrlKey && e.key === 'PageDown' ? 'backward' : null;
      // Page Up/Page Down sem modificadores: página anterior/próxima (CorelDRAW).
      if ((e.key === 'PageUp' || e.key === 'PageDown') && !e.ctrlKey && !e.shiftKey && !e.altKey && !editable(e.target)) { e.preventDefault(); finishEditing(); const doc = latest.current.document; latest.current.goToPage(activePage(doc) + (e.key === 'PageUp' ? -1 : 1)); return; }
      // Ctrl+Tab / Ctrl+Shift+Tab alternam entre os documentos abertos.
      if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); finishEditing(); const tabs=latest.current.tabs.filter(t=>!t.blank),{activeTab}=latest.current,i=tabs.findIndex(t=>t.id===activeTab);if(tabs.length>1)latest.current.switchTab(tabs[(i+(e.shiftKey?tabs.length-1:1))%tabs.length].id); return; }
      if (order && !editable(e.target)) { e.preventDefault(); finishEditing(); objectCommand(order); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (['s', 'o', 'z', 'y', 'g', 'd', 'e', 'i', 'a', 'q', 'k', 'u', 'n', 'p', 'r'].includes(key)) {
          if (key === 'a' && editable(e.target)) return;
          e.preventDefault();
          if (e.repeat) return;
          finishEditing();
          if (key === 's') { if (e.shiftKey) files.saveAs(); else files.save(); }
          else if (key === 'o') files.open();
          else if (key === 'n') newDocument();
          else if (key === 'p') print();
          else if (key === 'r') latest.current.repeatCommand();
          else if (key === 'e') setExporting(true);
          else if (key === 'i') importInput.current?.click();
          else if (key === 'a') setSelection(latest.current.document.objects.filter(o=>!o.clipParent&&!isBlocked(latest.current.document,o)).map(o=>o.id).flatMap(id=>clipContents(latest.current.document.objects,[id])));
          else if (key === 'k') latest.current.breakApartCommand();
          else if (key === 'u') objectCommand('ungroup');
          else if (key === 'q') void (e.shiftKey ? latest.current.outlineCommand() : latest.current.convertCurvesCommand());
          else if (key === 'g') objectCommand(e.shiftKey ? 'ungroup' : 'group');
          else if (key === 'd') objectCommand('duplicate');
          else if (key === 'y' || (key === 'z' && e.shiftKey)) redo();
          else undo();
        }
        return;
      }
      if (editable(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); finishEditing(); removeSelected(); return; }
      if (e.key === 'Escape') { finishEditing(); if (latest.current.clipPick) latest.current.pickClipFrame(null); else if (clipEdit) clipCommand('finish'); else { select(null); setTool('select'); } return; }
      // Com objetos selecionados, as letras alinham como no CorelDRAW; um único objeto alinha à página.
      const align = alignKeys[e.key.toLowerCase()];
      if (align && selectedIds.length && tool === 'select') { e.preventDefault(); finishEditing(); objectCommand(align); return; }
      const item = toolItems.find(t => t.key && t.key.toLowerCase() === e.key.toLowerCase());
      if (item) { e.preventDefault(); setTool(item.id); }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [selectedId, selectedIds, tool, removeSelected, select, setTool, undo, redo, files, objectCommand, clipEdit, clipCommand, setSelection]);
  useEffect(()=>{const open=(e:Event)=>{const {x,y,items}=(e as CustomEvent<{x:number;y:number;items?:MenuItem[]}>).detail;setMenu({x,y,items});};window.addEventListener('vectorstudio:context-menu',open);return()=>window.removeEventListener('vectorstudio:context-menu',open);},[]);
  /** Menu do botão direito: comandos do objeto selecionado ou, na área vazia, da página (como no CorelDRAW). */
  function contextItems():MenuItem[]{
    const selected=document.objects.filter(o=>selectedIds.includes(o.id)),frame=selected.find(o=>document.objects.some(c=>c.clipParent===o.id));
    const run=(action:()=>void)=>()=>{finishEditing();action();};
    const view:MenuItem={label:'Exibir',submenu:[{label:'Réguas',checked:layout.rulers,run:()=>setLayout(s=>({...s,rulers:!s.rulers}))},{label:'Tema escuro',checked:dark,run:()=>setLayout(s=>({...s,theme:dark?'light':'dark'}))},{label:'Ajustar página à tela',run:fitToScreen}]};
    const properties:MenuItem={label:'Objetos e camadas',key:'Alt+Enter',checked:inspectorShown,run:toggleInspector};
    if(!selected.length)return [
      {label:'Visualização de tela cheia',key:'F9',run:()=>setPreview(true)},view,menuSeparator,
      {label:'Criar objeto',submenu:([['rectangle','Retângulo','F6'],['ellipse','Elipse','F7'],['polygon','Polígono','Y'],['star','Estrela',''],['spiral','Espiral','A'],['graph','Papel milimetrado','D'],['freehand','Mão livre','F5'],['text','Texto','F8']] as const).map(([id,label,key])=>({label,key,run:()=>setTool(id)}))},
      {label:'Importar…',key:'Ctrl+I',run:()=>importInput.current?.click()},{label:'Colar',key:'Ctrl+V',run:()=>void pasteFromMenu()},menuSeparator,
      {label:'Propriedades do documento…',run:()=>setDocumentDialog(true)},properties];
    const order=(label:string,key:string,command:'front'|'back'|'forward'|'backward'):MenuItem=>({label,key,run:run(()=>objectCommand(command))});
    const align=(label:string,key:string,command:'left'|'right'|'top'|'bottom'|'center'|'middle'|'page'):MenuItem=>({label,key,run:run(()=>objectCommand(command))});
    const separate=separateLabel(document.objects,selectedIds);
    return [
      ...(separate?[{label:separate,key:'Ctrl+K',run:editor.breakApartCommand},menuSeparator]:[]),
      {label:'Desfazer',key:'Ctrl+Z',disabled:!canUndo,run:run(undo)},menuSeparator,
      {label:'Recortar',key:'Ctrl+X',run:()=>void copyFromMenu(true)},{label:'Copiar',key:'Ctrl+C',run:()=>void copyFromMenu(false)},{label:'Colar',key:'Ctrl+V',run:()=>void pasteFromMenu()},{label:'Duplicar',key:'Ctrl+D',run:run(()=>objectCommand('duplicate'))},{label:'Excluir',key:'Delete',run:run(removeSelected)},menuSeparator,
      // Texto (como no CorelDRAW): converter artístico ↔ parágrafo e revisor ortográfico no menu do botão direito.
      ...(selected.some(o=>o.type==='text')?[{label:selected.some(o=>o.type==='text'&&o.paragraph)&&!selected.some(o=>o.type==='text'&&!o.paragraph&&!o.textPath)?'Converter em texto artístico':'Converter em texto de parágrafo',key:'Ctrl+F8',disabled:!!textCommandError(editor,'paragraph'),run:()=>runTextCommand(editor,'paragraph')},{label:'Revisor ortográfico…',key:'Ctrl+F12',run:()=>checkSpelling(editor)}]:[]),
      {label:'Converter em curvas',key:'Ctrl+Q',disabled:!selected.some(canConvertToCurves),run:()=>void editor.convertCurvesCommand()},{label:'Converter contorno em objeto',key:'Ctrl+Shift+Q',run:()=>void editor.outlineCommand()},{label:'Combinar',key:'Ctrl+L',disabled:selected.length<2,run:()=>void editor.combineCommand()},{label:'Quebrar em partes',key:'Ctrl+K',run:editor.breakApartCommand},{label:'PowerClip dentro…',run:()=>editor.clipCommand('place')},{label:'Bloquear objeto',run:run(()=>editor.lockCommand(true))},
      ...(selected.some(o=>o.type==='text')?[{label:'Editar texto',key:'Duplo clique',run:()=>window.document.querySelector(`.canvas-viewport [data-object-id="${selected.find(o=>o.type==='text')!.id}"] *`)?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))}]:[]),
      {label:'Agrupar',key:'Ctrl+G',disabled:selected.length<2,run:run(()=>objectCommand('group'))},{label:'Desagrupar',key:'Ctrl+Shift+G',disabled:!selected.some(o=>o.groupPath?.length),run:run(()=>objectCommand('ungroup'))},menuSeparator,
      {label:'Ordem',submenu:[order('Para frente da página','Ctrl+Home','front'),order('Para trás da página','Ctrl+End','back'),order('Avançar um','Ctrl+PgUp','forward'),order('Recuar um','Ctrl+PgDn','backward')]},
      {label:'Alinhar e distribuir',submenu:[align('Alinhar à esquerda','L','left'),align('Alinhar à direita','R','right'),align('Alinhar ao topo','T','top'),align('Alinhar à base','B','bottom'),align('Centros verticalmente','C','center'),align('Centros horizontalmente','E','middle'),align('Centralizar na página','P','page'),...(Object.keys(distributionLabels) as Distribution[]).map(d=>({label:distributionLabels[d],disabled:selected.length<3,run:run(()=>objectCommand(d))})),{label:'Janela Alinhar e distribuir…',key:'Ctrl+Shift+A',run:()=>openTransform('align')}]},
      {label:'Transformações',submenu:[{label:'Posição…',key:'Alt+F7',run:()=>openTransform('position')},{label:'Girar…',key:'Alt+F8',run:()=>openTransform('rotate')},{label:'Escala e espelho…',key:'Alt+F9',run:()=>openTransform('scale')},{label:'Tamanho…',key:'Alt+F10',run:()=>openTransform('size')},{label:'Inclinar…',run:()=>openTransform('skew')}]},
      {label:'PowerClip',submenu:[{label:'PowerClip dentro… (clique no quadro)',run:()=>editor.clipCommand('place')},{label:'Editar conteúdo',disabled:!frame,run:()=>editor.clipCommand('edit')},{label:'Extrair conteúdo',disabled:!frame,run:()=>editor.clipCommand('extract')},{label:'Ajustar conteúdo proporcionalmente',disabled:!frame,run:()=>editor.clipCommand('fit')}]},
      ...(selected.length===1&&selected[0].type==='image'?[{label:'Remover fundo…',run:openRemoveBackground},{label:'Rastrear bitmap',submenu:traceMenuItems()}]:[]),
      {label:'Efeitos',submenu:effectItems.map(([kind,label])=>({label:kind==='shadow'||kind==='contour'||kind==='blockShadow'||kind==='envelope'||kind==='perspective'?label:`${label}…`,run:()=>runEffectItem(kind,editor.setTool)}))},menuSeparator,
      properties];
  }
  // Rastrear bitmap: rápido/repetir rodam direto; os tipos do contorno abrem a janela com pré-visualização.
  useEffect(()=>{const handle=async(e:Event)=>{const kind=(e as CustomEvent<TraceRequest>).detail,{document:doc,selectedIds:ids}=latest.current,image=doc.objects.find(o=>o.type==='image'&&ids.includes(o.id));
    if(!image){latest.current.setMessage('Selecione um bitmap para rastrear.');return;}
    if(isCenterlinePreset(kind)){setCenterline(kind);return;}
    if(kind!=='quick'&&kind!=='repeat'){setTracing(kind);return;}
    try{latest.current.setMessage('Rastreando…');const result=await quickTrace(doc.objects,image,kind==='repeat');latest.current.commitEdit();latest.current.dispatch({type:'set-objects',objects:result.objects});latest.current.setSelection(result.traced.map(o=>o.id));latest.current.setMessage(result.message);}
    catch(error){latest.current.setMessage(error instanceof Error?error.message:'Não foi possível rastrear.');}};
    window.addEventListener('vectorstudio:trace',handle);return()=>window.removeEventListener('vectorstudio:trace',handle);},[]);
  // Importar: vetores de CDR/PDF/AI/EPS/SVG entram no desenho atual, nas posições originais; imagens viram bitmaps.
  async function onImport(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(!externalKind(file.name)){void insertImage(file);return;}
    try{setMessage(`Convertendo ${file.name}…`);const result=await openExternal(file,'importar');if(!result){setMessage('Importação cancelada.');return;}const {document:imported,warnings}=result;addObjects(imported.objects);setMessage(`${imported.objects.length} objetos importados de ${file.name}.${warnings.length?' '+warnings.join(' '):''}`);}
    catch(error){setMessage(error instanceof Error?error.message:'Não foi possível importar o arquivo.');}}
  const active = toolItems.find(t => t.id === tool)!;
  const selectedImage=document.objects.find(o=>o.id===selectedId&&o.type==='image');
  const standard=<div className="standard-commands">
        <button className="theme-button" title="Novo documento" aria-label="Novo documento" onClick={newDocument}><FilePlus2 size={18}/></button>
        <button className="theme-button" title="Abrir projeto (Ctrl+O)" aria-label="Abrir projeto" onClick={files.open}><FolderOpen size={18} /></button>
        <button className="theme-button" title="Salvar projeto (Ctrl+S)" aria-label="Salvar projeto" onClick={files.save}><Save size={18} /></button>
        <button className="theme-button" title="Salvar como (Ctrl+Shift+S)" aria-label="Salvar como" onClick={files.saveAs}><SaveAll size={18} /></button>
        <button className="theme-button" title="Imprimir (Ctrl+P)" aria-label="Imprimir" onClick={print}><Printer size={18}/></button>
        <span className="action-divider" />
        <button className="theme-button" title="Recortar (Ctrl+X)" aria-label="Recortar" disabled={!selectedIds.length} onClick={()=>void copyFromMenu(true)}><Scissors size={18}/></button>
        <button className="theme-button" title="Copiar (Ctrl+C)" aria-label="Copiar" disabled={!selectedIds.length} onClick={()=>void copyFromMenu(false)}><Copy size={18}/></button>
        <button className="theme-button" title="Colar (Ctrl+V)" aria-label="Colar" onClick={()=>void pasteFromMenu()}><ClipboardPaste size={18}/></button>
        <span className="action-divider" />
        <button className="theme-button" title="Desfazer (Ctrl+Z)" aria-label="Desfazer" disabled={!canUndo} onClick={() => { finishEditing(); undo(); }}><Undo2 size={18} /></button>
        <button className="theme-button" title="Refazer (Ctrl+Y / Ctrl+Shift+Z)" aria-label="Refazer" disabled={!canRedo} onClick={() => { finishEditing(); redo(); }}><Redo2 size={18} /></button>
        <span className="action-divider" />
        <button className="theme-button" title="Importar imagem (Ctrl+I)" aria-label="Importar imagem" onClick={()=>{finishEditing();importInput.current?.click();}}><ImageDown size={18}/></button>
        <button className="theme-button" title="Exportar (Ctrl+E)" aria-label="Exportar" onClick={()=>{finishEditing();setExporting(true);}}><FileOutput size={18}/></button>
        <span className="action-divider" />
        <ZoomControls/>
        <button className="theme-button" title="Visualização de tela cheia (F9): só o desenho; qualquer tecla volta" aria-label="Tela cheia" onClick={()=>{finishEditing();setPreview(true);}}><Maximize size={18}/></button>
        <span className="action-divider" />
        <button className={`theme-button ${layout.rulers?'active':''}`} aria-pressed={layout.rulers} title="Mostrar réguas" aria-label="Mostrar réguas" onClick={()=>setLayout(s=>({...s,rulers:!s.rulers}))}><Ruler size={18}/></button>
        <button className={`theme-button ${layout.grid?'active':''}`} aria-pressed={layout.grid} title="Grade do documento" aria-label="Grade do documento" onClick={()=>setLayout(s=>({...s,grid:!s.grid}))}><Grid3x3 size={18}/></button>
        <button className={`theme-button ${layout.guides?'active':''}`} aria-pressed={layout.guides} title="Linhas-guia (arraste das réguas)" aria-label="Linhas-guia" onClick={()=>setLayout(s=>({...s,guides:!s.guides}))}><SeparatorVertical size={18}/></button>
        <button className={`theme-button snap-menu ${layout.smartGuides||layout.snapGrid||layout.snapGuides?'active':''}`} aria-haspopup="menu" title="Alinhar a: guias dinâmicas, linhas-guia e grade" aria-label="Alinhar a" onClick={e=>{const r=e.currentTarget.getBoundingClientRect();window.dispatchEvent(new CustomEvent('vectorstudio:context-menu',{detail:{x:r.left,y:r.bottom+2,items:[{label:'Objetos (guias dinâmicas)',key:'Alt+Shift+D',checked:layout.smartGuides,run:()=>setLayout(s=>({...s,smartGuides:!s.smartGuides}))},{label:'Linhas-guia',checked:layout.snapGuides,run:()=>setLayout(s=>({...s,snapGuides:!s.snapGuides}))},{label:'Grade do documento',checked:layout.snapGrid,run:()=>setLayout(s=>({...s,snapGrid:!s.snapGrid}))}]}}));}}><Magnet size={18}/><span className="snap-label">Alinhar a</span></button>
        <span className="action-divider" />
        <button className="theme-button" onClick={() => setLayout(s=>({...s,theme:dark?'light':'dark'}))} title={dark ? 'Usar tema claro' : 'Usar tema escuro'} aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        <button className="theme-button" title="Personalizar área de trabalho" aria-label="Personalizar área de trabalho" onClick={()=>{finishEditing();customize(true);}}><Settings2 size={18}/></button>
      </div>;
  const noDocument=editor.tabs.every(t=>t.blank);
  useEffect(()=>{window.document.title=noDocument?'GFX Studio':`GFX Studio - ${files.file?.name ?? document.name}${dirty?'*':''}`;},[files.file?.name,document.name,dirty,noDocument]);
  const statusHint = tool === 'select' ? (selectedIds.length ? 'Alinhar: L R T B C E · P: centralizar na página' : 'Clique para selecionar · Arraste para mover') : tool === 'text' ? 'Clique e digite · Clique numa curva para escrever nela · Clique em um texto para editá-lo · Esc conclui' : 'Clique e arraste para desenhar';
  return <div className={`app desktop-app ${dark ? 'dark' : ''} ${layout.compact?'compact':''} icons-${layout.iconSize} ${layout.locked?'workspace-locked':''}`}>
        <input ref={files.input} type="file" accept=".gfxs,.vectorstudio,.cdr,.pdf,.ai,.eps,.svg,.dxf,.dwg" hidden onChange={files.onFile} aria-label="Abrir projeto ou arquivo do CorelDRAW, PDF, AI, EPS, SVG, DXF ou DWG" />
        <input ref={importInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,.svg,.cdr,.pdf,.ai,.eps,.dxf,.dwg" hidden onChange={onImport} aria-label="Importar imagem, CDR, PDF, AI, EPS, SVG, DXF ou DWG" />
    <MenuBar print={print} open={files.open} save={files.save} saveAs={files.saveAs} newDocument={newDocument} importImage={()=>importInput.current?.click()} exportFile={()=>setExporting(true)} paste={()=>void pasteFromMenu()} copy={cut=>void copyFromMenu(cut)} canTrace={!!selectedImage}/>
    {files.saved > 0 && <SavedToast key={files.saved} />}
    {files.message && <div className={`file-message ${files.error ? 'file-error' : ''}`} role={files.error ? 'alert' : 'status'}>{files.message}<button aria-label="Fechar aviso" onClick={files.dismiss}><X size={14} /></button></div>}
    <DockLayout panels={{standard,property:<PropertyBar/>,tools:<Toolbar/>,inspector:<ObjectsPanel/>,palette:<ColorPalette/>,documentPalette:<DocumentPalette/>}}><DocumentTabs newDocument={newDocument}/><Canvas rulers={layout.rulers}/><div className="page-strip"><PageNavigator/><span>{document.artboard.width} × {document.artboard.height} px</span><span className="workspace-operation" role="status">{booleanMessage}</span></div></DockLayout>
    <footer className="statusbar"><div><active.icon size={14} /><strong>{active.label}</strong><span className="status-hint">{statusHint}</span></div><div><span className="object-count">{(()=>{const n=new Set(document.objects.filter(o=>selectedIds.includes(o.id)&&(!o.clipParent||!selectedIds.includes(o.clipParent))).map(o=>o.groupPath?.[0]??o.id)).size;return n?`${n} ${n===1?'objeto selecionado':'objetos selecionados'}`:`${document.objects.length} ${document.objects.length===1?'objeto':'objetos'}`;})()}</span><span className="footer-divider" /><span className="zoom-value" aria-label="Zoom atual">{Number((viewport.zoom * 100).toFixed(1))}%</span><button className="fit-button" title="Ajustar prancheta à tela" onClick={() => { finishEditing(); fitToScreen(); }}><Scan size={14} /><span>Ajustar à tela</span></button><span className="footer-divider" /><PaintStatus editFill={()=>{finishEditing();setPaintDialog('fill');}} editOutline={()=>{finishEditing();setPaintDialog('outline');}}/></div></footer>
    <WorkspaceSettings/>
    <EffectsDialog/>
    <TransformDialog/>
    <TextToolsDialogs/>
    <DistortDialog/>
    <BitmapDialog/>
    <ShapingDialogs/>
    <PdfPagesDialog/>
    <PrintPreview/>
    <WelcomeScreen openFile={files.open}/>
    <PropertiesWindows/>
    <RemoveBackgroundDialog/>
    <LibraryDialogs/>
    {menu&&<ContextMenu items={menu.items??contextItems()} x={menu.x} y={menu.y} close={()=>setMenu(null)}/>}
    {documentDialog&&<DocumentDialog close={()=>setDocumentDialog(false)}/>}
    {exporting&&<ExportDialog close={()=>setExporting(false)}/>}
    <CloseGuard save={files.saveAndConfirm}/>
    <RecoveryDialog/>
    {preview&&<FullScreenPreview close={closePreview}/>}
    {paintDialog==='fill'&&<FillDialog close={()=>setPaintDialog(null)}/>}
    {paintDialog==='outline'&&<OutlineDialog close={()=>setPaintDialog(null)}/>}
    {tracing&&selectedImage&&<TraceDialog image={selectedImage as VectorObject} preset={tracing} close={()=>setTracing(null)}/>}
    {centerline&&selectedImage&&<CenterlineDialog image={selectedImage as VectorObject} preset={centerline} close={()=>setCenterline(null)}/>}
  </div>;
}
export default function App() { return <WorkspaceProvider><EditorProvider><Editor /></EditorProvider></WorkspaceProvider>; }
