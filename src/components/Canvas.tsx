import { Pencil, MousePointerClick, LogOut, Lock, Unlock, Scaling, Expand, StretchHorizontal, Crosshair } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { smartFillStyle } from './SmartFill';
import { blendCss, gradientMask, invertedBlend } from '../document/transparency';
import { createObject, type Tool, type VectorObject } from '../document/model';
import { useEditor } from '../state/EditorContext';
import { clampZoom, fitViewport, screenToDocument, zoomAt } from '../document/viewport';
import { commandsToSvg, mapCommands, penCommands, type Point } from '../geometry/pathGeometry';
import { usePathTools } from './usePathTools';
import { curveDraftTools, useCurveTools } from './useCurveTools';
import { useNodeEditing } from './useNodeEditing';
import { dimensionTools, useDimensionTool } from './useDimensionTool';
import { useDeformTool } from './useDeformTool';
import { useMeshTool } from './useMeshTool';
import { useTextSpacing } from './useTextSpacing';
import { useCornerHandles } from './useCornerHandles';
import { useGradientTool } from './useGradientTool';
import { NodeOverlay } from './NodeOverlay';
import { useObjectManipulation } from './useObjectManipulation';
import { TransformOverlay } from './TransformOverlay';
import { svgTransform, matrixOf, inverse, transformPoint, clipContents, boundsOf, selectionIds, type Bounds } from '../geometry/objectTransforms';
import { localCommands, worldCommands } from '../geometry/worldGeometry';
import { freehandObject, graphPaperObjects, polygonObject, spiralObject, starObject } from '../geometry/shapeFactory';
import { allContents, canBeFrame, directContents, frameAt } from '../geometry/powerClip';
import { Rulers } from '../workspace/Rulers';
import { TextEditor } from './TextEditor';
import { createParagraph, createText, cssFont, letterSpacingPx, textWeight, fontPx, isStyledText, lineLayout, updateText } from '../text/textLayout';
import { browserMeasure } from '../text/textMeasure';
import { FillGradientDef, PaintedPath, PatternDef, fillValue } from './paintSvg';
import { solidFill, strokeStyle } from '../document/paint';
import { isBlocked, isHidden } from '../document/layers';
import { pathTextTarget } from '../text/pathLinks';
import { createPathText } from '../text/textTools';
import { DocumentGrid, GuidesLayer } from './GuidesLayer';
import { snapLines, snapPoint } from '../geometry/guides';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { useCutTools } from './useCutTools';
import { useConnectorTool } from './useConnectorTool';
import { useEffectTools } from './useEffectTools';
import { useMaskBrush } from './useMaskBrush';
import { useCloneStamp } from './useCloneStamp';
import { cropLocal } from '../bitmap/imageCrop';
import { objectInside } from '../geometry/hitTest';
import { maskActive, maskSvg } from '../bitmap/layerMask';
import { useJoinedAdd } from './useJoinedAdd';
import { ParagraphFrames, useTextFrame } from './useTextFrame';
const imageCache = new Map<string, Promise<CanvasRenderingContext2D | null>>();
/** Cor do pixel do bitmap sob o ponto do documento (null se transparente). */
async function imagePixel(o: VectorObject, p: Point): Promise<string | null> {
  if (!imageCache.has(o.src!)) imageCache.set(o.src!, new Promise(resolve => { const image = new Image(); image.onload = () => { const canvas = window.document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const context = canvas.getContext('2d', { willReadFrequently: true }); context?.drawImage(image, 0, 0); resolve(context); }; image.onerror = () => resolve(null); image.src = o.src!; }));
  const context = await imageCache.get(o.src!); if (!context) return null;
  const local = transformPoint(inverse(matrixOf(o)), p), u = Math.floor((local.x - o.x) / o.width * context.canvas.width), v = Math.floor((local.y - o.y) / o.height * context.canvas.height);
  if (u < 0 || v < 0 || u >= context.canvas.width || v >= context.canvas.height) return null;
  const [r, g, b, a] = context.getImageData(u, v, 1, 1).data;
  return a < 128 ? null : '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}
/** Barra flutuante do PowerClip (CorelDRAW 2026): editar, selecionar conteúdo, extrair, travar e ajustar o conteúdo. */
type PowerClipAction = 'edit' | 'select' | 'extract' | 'lock' | 'unlock' | 'fit' | 'fill' | 'stretch' | 'center';
function PowerClipBar({ frame, viewport, command }: { frame: VectorObject; viewport: { x: number; y: number; zoom: number }; command: (c: PowerClipAction) => void }) {
  const b = boundsOf([frame]), left = viewport.x + (b.x + b.width / 2) * viewport.zoom, top = viewport.y + (b.y + b.height) * viewport.zoom + 14;
  const button = (label: string, Icon: typeof Pencil, action: PowerClipAction, text?: string) => <button type="button" title={label} aria-label={label} onClick={() => command(action)}><Icon size={15} />{text && <span>{text}</span>}</button>;
  return <div className="powerclip-bar" role="toolbar" aria-label="PowerClip" style={{ left, top }} onPointerDown={e => e.stopPropagation()}>
    {button('Editar PowerClip (ou Ctrl+clique / duplo clique no quadro)', Pencil, 'edit')}
    {button('Selecionar conteúdo (mover e ajustar o que está dentro)', MousePointerClick, 'select')}
    {button('Extrair conteúdo', LogOut, 'extract')}
    {frame.clipUnlocked ? button('Bloquear conteúdo do PowerClip (move junto com o quadro)', Unlock, 'lock') : button('Desbloquear conteúdo do PowerClip (o quadro se move sozinho)', Lock, 'unlock')}
    <span className="powerclip-sep" />
    {button('Ajustar conteúdo proporcionalmente', Scaling, 'fit')}
    {button('Preencher quadro proporcionalmente', Expand, 'fill')}
    {button('Esticar conteúdo para o quadro', StretchHorizontal, 'stretch')}
    {button('Centralizar conteúdo', Crosshair, 'center')}
  </div>;
}
type ShapeTool = 'rectangle' | 'ellipse' | 'polygon' | 'star' | 'spiral' | 'graph';
const shapeTools: Tool[] = ['rectangle', 'ellipse', 'polygon', 'star', 'spiral', 'graph'];
type Creation = { pointerId: number; tool: ShapeTool; start: Point; base: VectorObject[]; ids: string[]; moved: boolean };
type Paint = 'all' | 'fill' | 'stroke';
function Shape({ object: o, zoom, paint = 'all' }: { object: VectorObject; zoom: number; paint?: Paint }) {
  if (o.type === 'image') return paint === 'stroke' ? null : o.crop
    // Bitmap recortado (Cortar, Laço, ferramenta Forma): só a parte dentro do contorno aparece e recebe cliques.
    ? <g transform={svgTransform(o)}><clipPath id={`iclip-${o.id}`}><path d={commandsToSvg(cropLocal(o))} clipRule="evenodd" /></clipPath><image href={o.src} x={o.x} y={o.y} width={o.width} height={o.height} preserveAspectRatio="none" clipPath={`url(#iclip-${o.id})`} /></g>
    : <image href={o.src} x={o.x} y={o.y} width={o.width} height={o.height} preserveAspectRatio="none" transform={svgTransform(o)} />;
  const stroke = paint === 'fill' ? 'none' : o.stroke ?? 'none', strokeWidth = o.strokeWidth ?? 0;
  if (o.type === 'text' && isStyledText(o)) {
    // Texto com fonte real: linhas posicionadas pela medição da fonte, sem esticar.
    const lines = lineLayout(o, browserMeasure);
    return <g transform={svgTransform(o)}>{o.fillGradient && paint !== 'stroke' && <FillGradientDef object={o} local />}{o.fillPattern && paint !== 'stroke' && <PatternDef object={o} local />}{paint !== 'stroke' && <rect x={o.x} y={o.y} width={o.width} height={o.height} fill="transparent" />}<text fontFamily={cssFont(o).replace(/^.*?px /, '')} fontSize={fontPx(o)} fontWeight={textWeight(o)} letterSpacing={o.letterSpacing ? letterSpacingPx(o, browserMeasure) : undefined} fontStyle={o.italic ? 'italic' : 'normal'} textDecoration={o.underline ? 'underline' : undefined} fill={paint === 'stroke' ? 'none' : fillValue(o)} stroke={stroke} strokeWidth={strokeWidth} {...strokeStyle(o)} paintOrder={o.strokeBehind ? 'stroke' : undefined} style={{ whiteSpace: 'pre' }}>{lines.map((l, i) => <tspan key={i} x={l.x} y={l.baseline} rotate={l.angle || undefined}>{l.line || ' '}</tspan>)}</text></g>;
  }
  if (o.type === 'text') return <g transform={svgTransform(o)}><svg x={o.x} y={o.y} width={o.width} height={o.height} viewBox="0 0 200 48" preserveAspectRatio="none" overflow="visible"><text x="0" y="36" fontSize="36" fontFamily="Arial, sans-serif" fill={paint === 'stroke' ? 'none' : o.fill} stroke={stroke} strokeWidth={strokeWidth} textLength="200" lengthAdjust="spacingAndGlyphs">{o.text || ' '}</text></svg></g>;
  // Geometria em coordenadas do documento: o contorno mantém a espessura ao esticar, como no CorelDRAW.
  const d = commandsToSvg(worldCommands(o));
  return <>{paint !== 'stroke' && <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(strokeWidth, 8 / zoom)} pointerEvents="stroke" />}<PaintedPath object={o} d={d} paint={paint} /></>;
}
const invert: CSSProperties = { filter: 'invert(1)' };
/**
 * Modo Subtrair (CorelDRAW: fundo + cor − 255): o que já foi desenhado abaixo é invertido, o objeto invertido
 * é somado (plus-lighter) e o conjunto volta a ser invertido. O branco da página é neutro, como no CorelDRAW.
 */
export function blendLayers(objects: VectorObject[], view: (o: VectorObject) => ReactNode): ReactNode[] {
  // Superexposição linear: objeto invertido somado; Subtrair (Photoshop): objeto somado sem inverter.
  return objects.reduce<ReactNode[]>((below, o) => invertedBlend(o.blendMode) ? [<g key={`subtract-${o.id}`} style={invert}><g style={invert}>{below}</g><g style={{ ...(o.blendMode === 'subtract' ? invert : {}), mixBlendMode: 'plus-lighter' }}>{view(o)}</g></g>] : [...below, view(o)], []);
}
type ObjectViewProps = { object: VectorObject; objects: VectorObject[]; frames: Set<string>; zoom: number; clipEdit: string | null; interactive?: boolean; hidden?: string | null };
// Só redesenha o objeto que mudou (importante em logos importadas com centenas de curvas).
const ObjectView = memo(ObjectViewBase, (a, b) => a.object === b.object && a.zoom === b.zoom && a.clipEdit === b.clipEdit && a.interactive === b.interactive && (a.hidden === b.hidden || (a.hidden !== a.object.id && b.hidden !== b.object.id)) && (a.objects === b.objects || (!a.frames.has(a.object.id) && !b.frames.has(b.object.id))));
function ObjectViewBase(props: ObjectViewProps) {
  const o = props.object;
  // Máscara de camada (Photoshop): o objeto inteiro (preenchimento, contorno, sombra) passa pela máscara.
  if (!maskActive(o)) return <ObjectPaint {...props} />;
  // A máscara isola o grupo: o modo de mesclagem vai no grupo de fora para continuar misturando com o que está atrás.
  const blend = blendCss(o);
  return <g {...(props.interactive !== false ? { 'data-mask-of': o.id } : {})} style={blend ? { mixBlendMode: blend as CSSProperties['mixBlendMode'] } : undefined}><g mask={`url(#lmask-${o.id})`}><defs dangerouslySetInnerHTML={{ __html: maskSvg(o, `lmask-${o.id}`, svgTransform(o) ?? '') }} /><ObjectPaint {...props} object={blend ? { ...o, blendMode: undefined } : o} /></g></g>;
}
function ObjectPaint({ object: o, objects, frames, zoom, clipEdit, interactive = true, hidden }: ObjectViewProps) {
  const contents = directContents(objects, o.id);
  // Transparência uniforme e modo de mesclagem valem para o objeto inteiro (preenchimento e contorno).
  const blend = blendCss(o);
  // Transparência em degradê: máscara alfa com o degradê em coordenadas do documento.
  const mask = o.transparencyGradient && (() => { const m = gradientMask(o), g = o.transparencyGradient!, stops = m.stops.map(st => <stop key={st.offset} offset={st.offset} stopColor="white" stopOpacity={st.opacity} />);
    return <mask id={`tmask-${o.id}`} maskUnits="userSpaceOnUse" x={m.box.x} y={m.box.y} width={m.box.width} height={m.box.height} style={{ maskType: 'alpha' }}>
      {g.type === 'linear' ? <linearGradient id={`tgrad-${o.id}`} gradientUnits="userSpaceOnUse" x1={m.start.x} y1={m.start.y} x2={m.end.x} y2={m.end.y}>{stops}</linearGradient> : <radialGradient id={`tgrad-${o.id}`} gradientUnits="userSpaceOnUse" cx={m.start.x} cy={m.start.y} fx={m.start.x} fy={m.start.y} r={m.radius}>{stops}</radialGradient>}
      <rect x={m.box.x} y={m.box.y} width={m.box.width} height={m.box.height} fill={`url(#tgrad-${o.id})`} /></mask>; })();
  const attributes = { ...(interactive ? { 'data-object-id': o.id, className: o.locked ? 'vector-object is-locked' : 'vector-object' } : {}), ...(o.opacity !== undefined && o.opacity < 1 ? { opacity: o.opacity } : {}), ...(blend ? { style: { mixBlendMode: blend as CSSProperties['mixBlendMode'] } } : {}), ...(mask ? { mask: `url(#tmask-${o.id})` } : {}), ...(hidden === o.id ? { opacity: 0 } : {}), ...(o.shadow ? { filter: `url(#shadow-${o.id})` } : o.blur ? { filter: `url(#blur-${o.id})` } : {}) };
  // Sombra projetada: filtro SVG no grupo do objeto (deslocamento e desfoque em unidades do documento).
  const shadow = !o.shadow && o.blur ? <filter id={`blur-${o.id}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={o.blur / 2} /></filter> : o.shadow && <filter id={`shadow-${o.id}`} x="-50%" y="-50%" width="200%" height="200%" filterUnits="objectBoundingBox"><feDropShadow dx={o.shadow.x} dy={o.shadow.y} stdDeviation={o.shadow.blur / 2} floodColor={o.shadow.color} floodOpacity={o.shadow.opacity} /></filter>;
  if (!contents.length || o.type === 'text' || o.type === 'image') return <g {...attributes}>{shadow}{mask}<Shape object={o} zoom={zoom} /></g>;
  // PowerClip: preenchimento do quadro, conteúdo recortado e, por cima, o contorno do quadro.
  return <g {...attributes}>{shadow}{mask}<Shape object={o} zoom={zoom} paint="fill" />
    {clipEdit !== o.id && <><clipPath id={`clip-${o.id}`}><path d={commandsToSvg(worldCommands(o))} clipRule={o.fillRule ?? 'nonzero'} /></clipPath><g clipPath={`url(#clip-${o.id})`}>{blendLayers(contents, c => <ObjectView key={c.id} object={c} objects={objects} frames={frames} zoom={zoom} clipEdit={clipEdit} interactive={false} />)}</g></>}
    <Shape object={o} zoom={zoom} paint="stroke" /></g>;
}
function shapeBox(start: Point, p: Point, square: boolean, center: boolean): Bounds {
  let dx = p.x - start.x, dy = p.y - start.y;
  if (square) { const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = (dx < 0 ? -1 : 1) * s; dy = (dy < 0 ? -1 : 1) * s; }
  if (center) return { x: start.x - Math.abs(dx), y: start.y - Math.abs(dy), width: Math.max(1, 2 * Math.abs(dx)), height: Math.max(1, 2 * Math.abs(dy)) };
  return { x: Math.min(start.x, start.x + dx), y: Math.min(start.y, start.y + dy), width: Math.max(1, Math.abs(dx)), height: Math.max(1, Math.abs(dy)) };
}
const captions: Partial<Record<Tool, string>> = {
  nodes: 'Arraste nós e alças (Ctrl ou Shift: só horizontal/vertical) · Duplo clique: adicionar nó · Delete: remover nó · Retângulo: arraste os pontos dos cantos para arredondar',
  pen: 'Clique: ponto · Arraste: curva · Enter: finalizar · Primeiro nó: fechar · Esc: cancelar',
  freehand: 'Arraste para desenhar à mão livre · Termine no ponto inicial para fechar',
  pentool: 'Caneta: clique para nó de canto, arraste para curva · Duplo clique ou Enter conclui · Primeiro nó fecha',
  polyline: 'Polilinha: clique para retas, arraste para trecho à mão livre · Duplo clique ou Enter conclui',
  bspline: 'B-Spline: clique para pontos de controle · Duplo clique ou Enter conclui · Primeiro ponto fecha',
  threepoint: 'Curva de 3 pontos: arraste do início ao fim e clique para definir a curvatura',
  crop: 'Cortar: arraste o retângulo a manter (formas e bitmaps JPG/PNG) · sem seleção corta todos os objetos da página',
  lasso: 'Laço poligonal: clique para pontos, arraste para trecho livre · feche no 1º ponto, duplo clique ou Enter · Backspace desfaz o último ponto · Esc cancela',
  knife: 'Faca: arraste uma linha atravessando o objeto · Ctrl: 15° · sem seleção corta o que a linha cruzar',
  eraser: 'Borracha: arraste sobre formas e linhas · espessura na barra de propriedades',
  virtualDelete: 'Excluir segmento virtual: clique no trecho entre cruzamentos para apagá-lo',
  connector: 'Conector reto: arraste de um objeto a outro (encaixa nos cantos, lados, centro e nós); acompanha os objetos',
  elbowConnector: 'Conector de ângulo reto: arraste de um objeto a outro; acompanha os objetos',
  roundConnector: 'Conector de ângulo reto arredondado: arraste de um objeto a outro; acompanha os objetos',
  cloneStamp: 'Carimbo: Alt+clique marca a origem · pinte para copiar · [ e ] mudam o tamanho · tamanho, dureza, opacidade e Alinhado na barra',
  maskBrush: 'Pincel de máscara: pinte sobre o objeto · preto oculta, branco revela · Alt + arrastar com o botão direito: ← → tamanho, ↑ ↓ dureza · botão direito: seletor de pincel · X troca a cor',
  dropShadow: 'Sombra: arraste a partir do objeto até onde a sombra deve ficar · arraste a ponta (quadrado) para ajustar · opacidade, desfoque e cor na barra',
  contour: 'Contorno: arraste da forma para fora (ou para dentro) até a distância desejada · passos e cor final na barra · Ctrl+K separa',
  blockShadow: 'Bloquear sombra: arraste a partir do objeto na direção e no comprimento da sombra · arraste a ponta para ajustar · Ctrl+K separa',
  smartFill: 'Preenchimento inteligente: clique numa área fechada pelas formas para criar um objeto com esse formato (as formas originais ficam)',
  dimension: 'Dimensão paralela: clique no 1º ponto, depois no 2º, afaste a linha e clique · Encaixa nos nós · Ctrl: 15° · Esc cancela',
  dimHV: 'Dimensão horizontal ou vertical: clique nos dois pontos e afaste para cima/baixo (horizontal) ou para os lados (vertical)',
  dimAngle: 'Dimensão angular: clique no vértice, num ponto de cada braço e depois no raio do arco · Esc cancela',
  dimSegment: 'Dimensão de segmento: clique sobre uma linha ou curva, afaste e clique',
  callout: 'Legenda de 3 pontos: clique na ponta, no cotovelo e no fim; depois digite o texto',
  envelope: 'Envelope: clique num objeto e arraste os nós · Ctrl: nó oposto junto · Shift: oposto espelhado · Modo sem restrições: duplo clique adiciona/exclui nós',
  perspective: 'Perspectiva: clique num objeto e arraste os quatro cantos',
  mesh: 'Preenchimento de malha: clique numa forma, clique nos nós (Shift soma) e escolha a cor na paleta · Linhas/colunas na barra',
  transparency: 'Transparência: clique no objeto e ajuste na barra · Arraste sobre o objeto para criar um degradê · Alças: início e fim',
  line: 'Linha de 2 pontos: arraste do início ao fim · Shift ou Ctrl: ângulos de 15° (horizontal, vertical, 45°)',
  zoom: 'Clique: aproximar · Shift + clique ou botão direito: afastar',
  pan: 'Arraste para mover a vista',
  text: 'Clique para digitar · Clique numa curva para escrever nela (texto em caminho) · Arraste: texto de parágrafo · Esc conclui',
  select: 'Arraste na área vazia para selecionar por área (Alt: tocar) · Duplo clique em texto: editar',
  eyedropper: 'Clique para pegar uma cor (vai para a paleta do documento) · Shift + clique aplica a última cor ao objeto',
};
/** Ferramentas cujos pontos encaixam em guias/grade. */
const snapTools: string[] = ['rectangle', 'ellipse', 'line', 'pen', 'pentool', 'bspline', 'polyline', 'threepoint', 'polygon', 'star', 'spiral', 'graph', 'text', ...dimensionTools];
export function Canvas({rulers=false}:{rulers?:boolean}) {
  const { textStyle, selectedIds, chooseObject, document, dispatch, tool, setTool, selectedId, select, setSelection, selectedNodes, fill, outline, shapeOptions, outlineWidth, beginEdit, commitEdit, viewport, setViewport, fitRequest, clipEdit, clipCommand, setMessage, clipPick, pickClipFrame, setFill, lockCommand, cutCommand } = useEditor();
  const paths = usePathTools();
  const curves = useCurveTools();
  const nodes = useNodeEditing();
  const deform = useDeformTool();
  const mesh = useMeshTool();
  const spacing = useTextSpacing();
  const corners = useCornerHandles();
  const gradientTool = useGradientTool();
  const manipulation = useObjectManipulation();
  const cut = useCutTools();
  const connector = useConnectorTool();
  const effectsTool = useEffectTools();
  const maskBrush = useMaskBrush(), stamp = useCloneStamp();
  const fitted = useRef(new WeakSet<object>()), autoFitOn = useRef(false);
  // Qualquer mudança de vista que não seja um enquadramento (zoom, rolagem, mão) desliga o reenquadramento automático.
  useEffect(() => { if (!fitted.current.has(viewport)) autoFitOn.current = false; }, [viewport]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Ferramenta Texto sobre o contorno de uma curva: clicar escreve nela (Ajustar texto ao caminho do CorelDRAW).
  const [pathHover, setPathHover] = useState<string | null>(null);
  const pathTarget = (p: Point) => pathTextTarget(document.objects, p, 6 / viewport.zoom, o => isBlocked(document, o));
  const addJoined = useJoinedAdd();
  const textFrame = useTextFrame(viewport.zoom, (start, box) => {
    const color = fill === 'none' ? '#000000' : fill;
    const object = box ? createParagraph(box, color, textStyle, browserMeasure) : createText(start.x, start.y, color, textStyle, browserMeasure);
    commitEdit(); dispatch({ type: 'add', object }); select(object.id); setEditingText(object.id);
  });
  const { layout: workspaceLayout } = useWorkspace();
  const ref = useRef<SVGSVGElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const creation = useRef<Creation | null>(null);
  const freehand = useRef<{ pointerId: number; points: Point[] } | null>(null);
  const [freehandPoints, setFreehandPoints] = useState<Point[]>([]);
  const [sample, setSample] = useState<string | null>(null);
  const suppressMenu = useRef(0);
  const pan = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  // Zoom suave (como no Trace Draw): a roda define um zoom-alvo e a vista chega nele aos poucos, quadro a quadro.
  const zoomAnim = useRef<{ target: number; x: number; y: number; frame: number } | null>(null), liveZoom = useRef(viewport.zoom);
  liveZoom.current = viewport.zoom;
  function smoothZoom(x: number, y: number, factor: number) {
    const a = zoomAnim.current, target = clampZoom((a ? a.target : liveZoom.current) * factor);
    if (a) { a.target = target; a.x = x; a.y = y; return; }
    const anim = { target, x, y, frame: 0 };
    zoomAnim.current = anim;
    const step = () => {
      const current = liveZoom.current, gap = Math.log(anim.target / current);
      const next = Math.abs(gap) < 0.003 ? anim.target : current * Math.exp(gap * 0.28);
      liveZoom.current = next;
      setViewport(view => zoomAt(view, anim.x, anim.y, next));
      if (next === anim.target) { zoomAnim.current = null; return; }
      anim.frame = requestAnimationFrame(step);
    };
    anim.frame = requestAnimationFrame(step);
  }
  useEffect(() => () => { if (zoomAnim.current) cancelAnimationFrame(zoomAnim.current.frame); }, []);
  const space = useRef(false);
  const [panning, setPanning] = useState(false);
  const [editingText, setEditingText] = useState<string | null>(null);
  const editingObject = document.objects.find(o => o.id === editingText && o.type === 'text');
  function openText(id: string) {
    const o = document.objects.find(x => x.id === id);
    if (!o) return;
    // Textos antigos (esticados) são convertidos para fonte real ao editar.
    if (!isStyledText(o)) { commitEdit(); dispatch({ type: 'set-objects', objects: document.objects.map(x => x.id === id ? updateText(x, {}, browserMeasure) : x) }); }
    select(id); setEditingText(id);
  }
  // A legenda abre o editor depois que o novo texto já está no documento (referência sempre atual).
  const openTextRef = useRef(openText); openTextRef.current = openText;
  const dimension = useDimensionTool(id => window.setTimeout(() => openTextRef.current(id)));
  const [spaceHeld, setSpaceHeld] = useState(false);
  const isDimension = (dimensionTools as readonly string[]).includes(tool);
  useEffect(() => { if (tool !== 'eyedropper') setSample(null); }, [tool]);
  useEffect(() => {
    const element = workspace.current!;
    const fit = () => { const v = fitViewport(element.clientWidth, element.clientHeight, document.artboard); fitted.current.add(v); autoFitOn.current = true; setViewport(v); };
    fit();
    // Enquanto ninguém mexeu na vista (zoom/rolagem) desde o enquadramento, a página é reenquadrada a cada mudança de
    // tamanho (janela maximizando, painéis se encaixando) — abre sempre centralizada. Depois, mantém o zoom e o centro.
    let width = element.clientWidth, height = element.clientHeight;
    const observer = new ResizeObserver(() => {
      const nextWidth = element.clientWidth, nextHeight = element.clientHeight;
      if (autoFitOn.current) { fit(); width = nextWidth; height = nextHeight; return; }
      setViewport(view => ({ ...view, x: view.x + (nextWidth - width) / 2, y: view.y + (nextHeight - height) / 2 }));
      width = nextWidth; height = nextHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitRequest, document.artboard, setViewport]);
  useEffect(() => {
    const element = ref.current!;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      if (creation.current || freehand.current || pan.current || paths.isDragging() || curves.isDragging() || nodes.isDragging() || manipulation.isDragging() || dimension.isDragging() || deform.isDragging() || cut.isDragging() || connector.isDragging() || effectsTool.isDragging() || maskBrush.isDragging() || stamp.isDragging() || textFrame.isDragging() || spacing.isDragging() || corners.isDragging() || gradientTool.isDragging()) return;
      const bounds = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      smoothZoom(event.clientX - bounds.left, event.clientY - bounds.top, Math.exp(-Math.max(-600, Math.min(600, delta)) * 0.0015));
    }
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [setViewport, paths, nodes, manipulation]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input, textarea, button, select, [contenteditable="true"]'))) return;
      event.preventDefault(); space.current = true; setSpaceHeld(true);
    }
    function keyup(event: KeyboardEvent) { if (event.code === 'Space') { space.current = false; setSpaceHeld(false); } }
    function stop() {
      space.current = false; setSpaceHeld(false); setPanning(false);
      const pointerId = creation.current?.pointerId ?? freehand.current?.pointerId ?? pan.current?.pointerId;
      if (creation.current) commitEdit();
      creation.current = null; freehand.current = null; pan.current = null; setFreehandPoints([]);
      if (pointerId !== undefined && ref.current?.hasPointerCapture(pointerId)) ref.current.releasePointerCapture(pointerId);
    }
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', stop);
    window.addEventListener('vectorstudio:finish-gesture', stop);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', stop); window.removeEventListener('vectorstudio:finish-gesture', stop); };
  }, [commitEdit]);
  function point(event: { clientX: number; clientY: number; currentTarget: SVGSVGElement }) {
    const bounds = event.currentTarget.getBoundingClientRect();
    let p = screenToDocument(viewport, event.clientX - bounds.left, event.clientY - bounds.top);
    // Ferramentas de desenho encaixam em linhas-guia e na grade (Alinhar a); Alt desliga, como nas guias dinâmicas.
    if (snapTools.includes(tool) && !(event as { altKey?: boolean }).altKey) p = snapPoint(p, snapLines(document, workspaceLayout), 8 / viewport.zoom);
    return { x: Math.max(-10000, Math.min(10000, p.x)), y: Math.max(-10000, Math.min(10000, p.y)) };
  }
  function screen(event: { clientX: number; clientY: number; currentTarget: SVGSVGElement }) { const bounds = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; }
  // Objetos bloqueados são ignorados nos cliques: o clique passa para o que está embaixo.
  const lockedIds = useMemo(() => new Set(document.objects.filter(o => isBlocked(document, o)).map(o => o.id)), [document]);
  const targetId = (target: EventTarget) => { const id = (target as Element).closest('[data-object-id]')?.getAttribute('data-object-id') ?? null; return id && lockedIds.has(id) ? null : id; };
  // Objeto sob o ponteiro, mesmo quando o canvas captura o ponteiro (cliques e duplos cliques após arrastar).
  const idAt = (clientX: number, clientY: number) => { for (const element of window.document.elementsFromPoint(clientX, clientY)) { const id = element.closest('.canvas-viewport [data-object-id]')?.getAttribute('data-object-id'); if (id && !lockedIds.has(id)) return id; } return null; };
  /** Elemento clicado para a seleção: alças da moldura ou o primeiro objeto desbloqueado sob o ponteiro. */
  const pickTarget = (event: { clientX: number; clientY: number; currentTarget: Element }, p: Point) => {
    let hit: Element | null = null, hitId: string | null = null;
    for (const element of window.document.elementsFromPoint(event.clientX, event.clientY)) { if (element.closest('[data-transform-handle]')) return element; const id = element.closest('.canvas-viewport [data-object-id]')?.getAttribute('data-object-id'); if (id && !lockedIds.has(id)) { hit = element; hitId = id; break; } }
    // Clique dentro de uma forma sem preenchimento também a seleciona (vale a que estiver mais à frente).
    const inside = objectInside(document.objects, p, o => lockedIds.has(o.id) || isHidden(document, o));
    if (inside && (!hitId || document.objects.findIndex(o => o.id === inside.id) > document.objects.findIndex(o => o.id === hitId))) return window.document.querySelector(`.canvas-viewport [data-object-id="${inside.id}"]`) ?? hit ?? event.currentTarget;
    return hit ?? event.currentTarget;
  };
  /** Objeto mais acima sob o ponteiro, bloqueado ou não (menu Desbloquear). */
  const topObjectAt = (clientX: number, clientY: number) => { for (const element of window.document.elementsFromPoint(clientX, clientY)) { const id = element.closest('.canvas-viewport [data-object-id]')?.getAttribute('data-object-id'); if (id) return id; } return null; };
  /** Conta-gotas: cor do objeto (preenchimento, ou contorno se vazio), pixel do bitmap, ou branco da página. */
  async function pickColor(event: { clientX: number; clientY: number; shiftKey: boolean }, p: Point) {
    const object = document.objects.find(o => o.id === idAt(event.clientX, event.clientY));
    if (event.shiftKey) {
      if (!object || !sample) { setMessage(sample ? 'Shift + clique em um objeto aplica a cor pega.' : 'Pegue uma cor primeiro (clique sem Shift).'); return; }
      commitEdit(); dispatch({ type: 'set-objects', objects: document.objects.map(o => o.id === object.id && o.type !== 'image' ? (o.fill === 'none' && o.stroke && o.stroke !== 'none' && o.type === 'path' && !o.commands?.some(c => c.type === 'Z') ? { ...o, stroke: sample } : solidFill(o, sample)) : o) }); commitEdit(); return;
    }
    let color: string | null = null;
    if (object?.type === 'image') color = await imagePixel(object, p);
    else if (object) color = object.fill !== 'none' ? object.fill : object.stroke && object.stroke !== 'none' ? object.stroke : null;
    else if (p.x >= 0 && p.y >= 0 && p.x <= document.artboard.width && p.y <= document.artboard.height) color = '#ffffff';
    if (!color) { setMessage('Conta-gotas: nenhuma cor neste ponto.'); return; }
    const palette = document.palette ?? [];
    setSample(color); setFill(color);
    if (!palette.includes(color)) { commitEdit(); dispatch({ type: 'set-palette', palette: [...palette, color] }); commitEdit(); }
    setMessage(`Cor ${color.toUpperCase()} na paleta do documento e definida como preenchimento padrão. Shift + clique aplica a um objeto.`);
  }
  function build(c: Creation, box: Bounds): VectorObject[] {
    const style = { fill, stroke: outline };
    if (c.tool === 'rectangle' || c.tool === 'ellipse') return [{ ...createObject(c.tool, box.x, box.y, fill, outline), id: c.ids[0] ?? crypto.randomUUID(), width: box.width, height: box.height }];
    if (c.tool === 'graph') return graphPaperObjects(box, shapeOptions, style, crypto.randomUUID());
    const object = (c.tool === 'polygon' ? polygonObject : c.tool === 'star' ? starObject : spiralObject)(box, shapeOptions, style);
    return [{ ...object, id: c.ids[0] ?? object.id }];
  }
  function updateCreation(c: Creation, box: Bounds) {
    const created = build(c, box).map(o => ({ ...o, stroke: outline, strokeWidth: outline === 'none' ? 0 : outlineWidth }));
    c.ids = created.map(o => o.id);
    dispatch({ type: 'set-objects', objects: [...c.base, ...created] });
  }
  function down(event: PointerEvent<SVGSVGElement>) {
    if (creation.current || freehand.current || pan.current || paths.isDragging() || curves.isDragging() || nodes.isDragging() || manipulation.isDragging()) return;
    // Pincel de máscara (Photoshop): Alt + botão direito arrastando ajusta tamanho/dureza; botão direito abre o seletor de pincel.
    if (event.button === 2 && maskBrush.active) { event.preventDefault(); if (maskBrush.right(point(event), event.pointerId, event.clientX, event.clientY, event.altKey)) event.currentTarget.setPointerCapture(event.pointerId); return; }
    if (event.button !== 0 && event.button !== 1) return;
    // Preventing pointer default keeps inputs focused; end their edit explicitly.
    if (window.document.activeElement instanceof HTMLElement) window.document.activeElement.blur();
    if (event.button === 1 || (event.button === 0 && (space.current || tool === 'pan'))) {
      event.preventDefault();
      pan.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: viewport.x, y: viewport.y };
      setPanning(true); event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    event.preventDefault();
    const p = point(event);
    // PowerClip dentro: o próximo clique escolhe o quadro.
    if (clipPick) {
      // Quadro clicado (contorno) ou, se não for uma forma fechada válida, a forma cujo interior contém o ponto.
      const exclude = clipContents(document.objects, selectedIds), direct = document.objects.find(o => o.id === idAt(event.clientX, event.clientY));
      pickClipFrame((direct && canBeFrame(direct) && !exclude.includes(direct.id) ? direct : frameAt(document.objects, p, exclude))?.id ?? null); return;
    }
    if (tool === 'zoom') { const s = screen(event); smoothZoom(s.x, s.y, event.shiftKey ? 0.5 : 2); return; }
    if (tool === 'eyedropper') { void pickColor(event, p); return; }
    if (isDimension) { dimension.down(p, event.pointerId, event.ctrlKey); event.currentTarget.setPointerCapture(event.pointerId); return; }
    if (deform.active) { if (deform.down(event.target as Element, p, event.pointerId, idAt(event.clientX, event.clientY), event)) event.currentTarget.setPointerCapture(event.pointerId); return; }
    if (mesh.active) { mesh.down(event.target as Element, p, idAt(event.clientX, event.clientY), event.shiftKey || event.ctrlKey); return; }
    if (maskBrush.active) { if (maskBrush.down(p, event.pointerId, idAt(event.clientX, event.clientY))) event.currentTarget.setPointerCapture(event.pointerId); return; }
    if (stamp.active) { if (stamp.down(p, event.pointerId, idAt(event.clientX, event.clientY), event.altKey)) event.currentTarget.setPointerCapture(event.pointerId); return; }
    if (effectsTool.active) { if (effectsTool.down(p, event.pointerId, idAt(event.clientX, event.clientY))) event.currentTarget.setPointerCapture(event.pointerId); return; }
    if (cut.active) { if (cut.down(p, event.pointerId, idAt(event.clientX, event.clientY))) event.currentTarget.setPointerCapture(event.pointerId); return; }
    if (connector.active) { connector.down(p, event.pointerId); event.currentTarget.setPointerCapture(event.pointerId); return; }
    if (tool === 'smartFill') { void cutCommand('smartFill', { point: p, style: smartFillStyle({ fill, outline, outlineWidth }) }); return; }
    // Transparência: o clique só escolhe o objeto; os valores ficam na barra de propriedades (como no CorelDRAW).
    if (tool === 'transparency') { if (gradientTool.down(event.target as Element, p, event.pointerId, idAt(event.clientX, event.clientY), event.shiftKey)) event.currentTarget.setPointerCapture(event.pointerId); return; }
    if (tool === 'select') {
      manipulation.down(pickTarget(event,p),p,event.pointerId,event.shiftKey);
      if(manipulation.isDragging())event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === 'nodes') {
      if (spacing.down(event.target as Element, p, event.pointerId) || corners.down(event.target as Element, p, event.pointerId)) { event.currentTarget.setPointerCapture(event.pointerId); return; }
      nodes.down(event.target as Element, p, event.pointerId, event.shiftKey || event.ctrlKey);
      if (nodes.isDragging()) event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (curveDraftTools.includes(tool)) { curves.down(p, event.pointerId); event.currentTarget.setPointerCapture(event.pointerId); return; }
    if (tool === 'line' || tool === 'pen' || tool === 'pentool') {
      paths.down(p, event.pointerId);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === 'freehand') { select(null); freehand.current = { pointerId: event.pointerId, points: [p] }; setFreehandPoints([p]); event.currentTarget.setPointerCapture(event.pointerId); return; }
    if (tool === 'text') {
      // Clique em um texto: edita; em área vazia: cria um texto novo e começa a digitar.
      const existing = document.objects.find(o => o.id === targetId(event.target) && o.type === 'text');
      if (existing) { openText(existing.id); return; }
      const onPath = pathTarget(p);
      if (onPath) {
        const object = createPathText(onPath.object, onPath.s, fill === 'none' ? '#000000' : fill, textStyle, browserMeasure);
        commitEdit(); dispatch({ type: 'add', object }); select(object.id); setEditingText(object.id); setPathHover(null); return;
      }
      textFrame.down(p, event.pointerId); event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    if (shapeTools.includes(tool)) {
      beginEdit(); select(null);
      creation.current = { pointerId: event.pointerId, tool: tool as ShapeTool, start: p, base: document.objects, ids: [], moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const drag = pan.current;
    if (drag && drag.pointerId === event.pointerId) {
      setViewport(view => ({ ...view, x: drag.x + event.clientX - drag.clientX, y: drag.y + event.clientY - drag.clientY })); return;
    }
    // Destaque ao passar o mouse (CorelDRAW): o contorno do objeto sob o cursor fica azul na ferramenta Seleção.
    if (tool === 'select' && event.buttons === 0 && !manipulation.isDragging()) {
      const hit = pickTarget(event, point(event)), id = hit.closest('[data-transform-handle]') ? null : hit.closest('.canvas-viewport [data-object-id]')?.getAttribute('data-object-id') ?? null;
      if (id !== hoverId) setHoverId(id);
    } else if (hoverId) setHoverId(null);
    if (tool === 'text' && event.buttons === 0 && !textFrame.isDragging()) {
      const overText = document.objects.some(o => o.id === targetId(event.target) && o.type === 'text'), id = overText ? null : pathTarget(point(event))?.object.id ?? null;
      if (id !== pathHover) setPathHover(id);
    } else if (pathHover) setPathHover(null);
    if(manipulation.isDragging()){if(manipulation.isTransforming()&&(event.buttons&2)&&manipulation.markDuplicate())suppressMenu.current=Date.now();manipulation.move(point(event),event.pointerId,{shift:event.shiftKey,ctrl:event.ctrlKey,alt:event.altKey});return;}
    if (nodes.isDragging()) { nodes.move(point(event), event.pointerId, event.ctrlKey || event.shiftKey); return; }
    if (spacing.isDragging()) { spacing.move(point(event), event.pointerId); return; }
    if (corners.isDragging()) { corners.move(point(event), event.pointerId); return; }
    if (gradientTool.isDragging()) { gradientTool.move(point(event), event.pointerId); return; }
    if (isDimension) { dimension.move(point(event), event.ctrlKey); return; }
    if (deform.isDragging()) { deform.move(point(event), event.pointerId, event); return; }
    if (stamp.active) { const svg = event.currentTarget, coalesced = stamp.isDragging() ? event.nativeEvent.getCoalescedEvents?.() : undefined; stamp.move(point(event), event.pointerId, coalesced?.map(e => point({ clientX: e.clientX, clientY: e.clientY, currentTarget: svg }))); return; }
    if (maskBrush.active) { const svg = event.currentTarget, coalesced = maskBrush.isDragging() ? event.nativeEvent.getCoalescedEvents?.() : undefined; maskBrush.move(point(event), event.pointerId, coalesced?.map(e => point({ clientX: e.clientX, clientY: e.clientY, currentTarget: svg })), { x: event.clientX, y: event.clientY }); return; }
    if (effectsTool.active) { effectsTool.move(point(event), event.pointerId); return; }
    if (cut.active) { cut.move(point(event), event.pointerId, event.ctrlKey); return; }
    if (connector.active) { connector.move(point(event), event.pointerId); return; }
    if (textFrame.isDragging()) { textFrame.move(point(event), event.pointerId); return; }
    const f = freehand.current;
    if (f && f.pointerId === event.pointerId) { const p = point(event), last = f.points.at(-1)!; if (Math.hypot(p.x - last.x, p.y - last.y) * viewport.zoom >= 1.5 && f.points.length < 20000) { f.points.push(p); setFreehandPoints([...f.points]); } return; }
    const c = creation.current;
    if (curveDraftTools.includes(tool)) { curves.move(point(event), event.pointerId); return; }
    if (!c && (tool === 'line' || tool === 'pen' || tool === 'pentool')) { paths.move(point(event), event.pointerId, event.shiftKey || event.ctrlKey, event.altKey); return; }
    if (!c || c.pointerId !== event.pointerId) return;
    const p = point(event);
    if (!c.moved && Math.hypot(p.x - c.start.x, p.y - c.start.y) * viewport.zoom < 3) return;
    c.moved = true;
    // Retângulo/elipse (CorelDRAW): Ctrl = quadrado/círculo, Shift = a partir do centro.
    // Polígono, estrela, espiral e papel milimetrado: Shift (ou Ctrl) mantém a proporção; Alt desenha a partir do centro.
    const regular = c.tool !== 'rectangle' && c.tool !== 'ellipse';
    updateCreation(c, shapeBox(c.start, p, event.ctrlKey || (regular && event.shiftKey), regular ? event.altKey : event.shiftKey));
  }
  function finish(event: PointerEvent<SVGSVGElement>) {
    if(manipulation.isDragging()){if(event.type==='pointerup')manipulation.move(point(event),event.pointerId,{shift:event.shiftKey,ctrl:event.ctrlKey,alt:event.altKey});manipulation.stop();}
    if (nodes.isDragging()) { if (event.type === 'pointerup') nodes.move(point(event), event.pointerId, event.ctrlKey || event.shiftKey); nodes.stop(); }
    if (paths.isDragging() && event.type === 'pointerup') paths.move(point(event), event.pointerId, event.shiftKey || event.ctrlKey);
    paths.up(event.pointerId, event.type === 'pointercancel');
    if (gradientTool.isDragging()) { if (event.type === 'pointerup') gradientTool.move(point(event), event.pointerId); gradientTool.up(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    if (corners.isDragging()) { if (event.type === 'pointerup') corners.move(point(event), event.pointerId); corners.up(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    if (spacing.isDragging()) { spacing.up(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    if (deform.isDragging()) { if (event.type === 'pointerup') deform.move(point(event), event.pointerId, event); deform.up(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    if (isDimension) { dimension.up(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    if (textFrame.isDragging()) { textFrame.up(event.pointerId, event.type !== 'pointerup'); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    if (stamp.active) { stamp.up(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    if (maskBrush.active) { maskBrush.up(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    if (effectsTool.active) { effectsTool.up(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    if (cut.active) { if (event.type === 'pointerup') cut.up(event.pointerId); else cut.up(-1); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    if (connector.active) { connector.up(event.type === 'pointerup' ? event.pointerId : -1); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    if (curveDraftTools.includes(tool)) { curves.up(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    const release = () => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
    if (pan.current?.pointerId === event.pointerId) { pan.current = null; setPanning(false); release(); return; }
    const f = freehand.current;
    if (f && f.pointerId === event.pointerId) {
      freehand.current = null; setFreehandPoints([]); release();
      const curve = event.type === 'pointerup' ? freehandObject(f.points, viewport.zoom, outline) : null, object = curve && { ...curve, strokeWidth: outlineWidth };
      if (object) addJoined(object);
      return;
    }
    const c = creation.current;
    if (!c || c.pointerId !== event.pointerId) { if (!creation.current && !pan.current) release(); return; }
    creation.current = null;
    if (event.type === 'pointerup' && !c.moved) updateCreation(c, { x: c.start.x, y: c.start.y, width: ['rectangle', 'ellipse', 'graph'].includes(c.tool) ? 140 : 100, height: 100 });
    if (event.type === 'pointercancel' && !c.moved) dispatch({ type: 'set-objects', objects: c.base });
    commitEdit();
    if (c.ids.length) { setTool('select'); setSelection(c.ids); }
    release();
  }
  const roots = useMemo(() => document.objects.filter(o => !o.clipParent && !isHidden(document, o)), [document]);
  const frames = useMemo(() => new Set(document.objects.flatMap(o => o.clipParent ? [o.clipParent] : [])), [document.objects]);
  const editing = clipEdit ? document.objects.find(o => o.id === clipEdit) : undefined;
  const powerClipFrame = selectedIds.length && !manipulation.isDragging() ? document.objects.find(o => frames.has(o.id) && selectedIds.includes(o.id) && !o.clipParent) : undefined;
  const page = document.artboard;
  return <main ref={workspace} className="workspace navigable-workspace">
    <svg ref={ref} className={`canvas-viewport cursor-${tool} ${pathHover && tool === 'text' ? 'text-on-path' : ''} ${clipPick ? 'picking-frame' : ''} ${manipulation.duplicating ? 'is-duplicating' : ''} ${panning ? 'is-panning' : spaceHeld ? 'can-pan' : ''}`} aria-label="Área de trabalho vetorial" onMouseDown={event => { if (event.button === 2 && manipulation.isTransforming() && manipulation.markDuplicate()) { suppressMenu.current = Date.now(); event.preventDefault(); } }} onDoubleClick={event => { if (tool === 'lasso') { cut.complete(); return; } if (tool === 'pen' || tool === 'pentool') { paths.complete(); return; } if (curveDraftTools.includes(tool)) { curves.complete(); return; } const id = idAt(event.clientX, event.clientY), text = document.objects.find(o => o.id === id && o.type === 'text'); if (tool === 'select' && text) { openText(text.id); return; }
      // PowerClip: duplo clique no quadro abre o conteúdo; duplo clique fora do conteúdo conclui a edição.
      if (tool === 'select' && clipEdit) { if (!id || !allContents(document.objects, clipEdit).some(o => o.id === id)) clipCommand('finish'); return; }
      const p = point(event), frame = document.objects.find(o => o.id === id && frames.has(o.id)) ?? frameAt(document.objects.filter(o => frames.has(o.id)), p, []);
      if (tool === 'select' && frame) { clipCommand('edit', frame.id); return; } nodes.doubleClick(window.document.elementFromPoint(event.clientX, event.clientY) ?? (event.target as Element), point(event)); }} onPointerDown={down} onPointerMove={move} onPointerLeave={() => { maskBrush.leave(); stamp.leave(); setHoverId(null); }} onPointerUp={finish} onPointerCancel={finish} onAuxClick={e => e.preventDefault()} onContextMenu={event => { event.preventDefault(); if (maskBrush.active) return; if (Date.now() - suppressMenu.current < 1500 || manipulation.isTransforming()) { suppressMenu.current = 0; return; } if (clipPick) { pickClipFrame(null); return; }
      const top = topObjectAt(event.clientX, event.clientY);
      if (top && lockedIds.has(top)) { window.dispatchEvent(new CustomEvent('vectorstudio:context-menu', { detail: { x: event.clientX, y: event.clientY, items: [{ label: 'Desbloquear objeto', run: () => lockCommand(false, top) }, { label: 'Desbloquear todos os objetos', run: () => lockCommand(false, 'all') }] } })); return; }
      if (tool === 'nodes') { const items = nodes.contextItems(window.document.elementFromPoint(event.clientX, event.clientY) ?? (event.target as Element), point(event)); if (items) window.dispatchEvent(new CustomEvent('vectorstudio:context-menu', { detail: { x: event.clientX, y: event.clientY, items } })); return; } if (tool === 'zoom') { const s = screen(event); smoothZoom(s.x, s.y, 0.5); return; } const id = targetId(event.target), p = point(event), b = manipulation.selected.length ? boundsOf(manipulation.selected) : null;
      // Alças, cruz central ou interior da moldura da seleção mantêm a seleção (menu do objeto, com PowerClip dentro).
      const onSelection = !!(event.target as Element).closest('[data-transform-handle]') || (!!b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height);
      if (id && !selectedIds.includes(id)) { setTool('select'); chooseObject(id); } else if (!id && !onSelection && tool === 'select') select(null); window.dispatchEvent(new CustomEvent('vectorstudio:context-menu', { detail: { x: event.clientX, y: event.clientY } })); }} onLostPointerCapture={event => { manipulation.stop(); nodes.stop(); paths.up(event.pointerId, true); if (creation.current) commitEdit(); creation.current = null; freehand.current = null; setFreehandPoints([]); pan.current = null; setPanning(false); }}>
      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
        <rect className="artboard-shadow" x={4 / viewport.zoom} y={4 / viewport.zoom} width={page.width} height={page.height} pointerEvents="none" />
        <rect className="artboard-paper" width={page.width} height={page.height} fill="white" strokeWidth={1 / viewport.zoom} pointerEvents="none" />
        <DocumentGrid width={page.width} height={page.height} zoom={viewport.zoom} />
        {manipulation.ghost && <g className="move-ghost" opacity={0.3} pointerEvents="none" aria-hidden="true">{manipulation.ghost.objects.filter(o => manipulation.ghost!.ids.includes(o.id) && (!o.clipParent || !manipulation.ghost!.ids.includes(o.clipParent))).map(o => <ObjectView key={o.id} object={o} objects={manipulation.ghost!.objects} frames={frames} zoom={viewport.zoom} clipEdit={clipEdit} interactive={false} />)}</g>}
        <g className={editing ? 'clip-edit-dimmed' : undefined}>{blendLayers(roots, o => <ObjectView key={o.id} object={o} objects={document.objects} frames={frames} zoom={viewport.zoom} clipEdit={clipEdit} hidden={editingObject?.textPath ? null : editingText} />)}</g>
        {editing && <g>{directContents(document.objects, editing.id).map(o => <ObjectView key={o.id} object={o} objects={document.objects} frames={frames} zoom={viewport.zoom} clipEdit={clipEdit} />)}<path d={commandsToSvg(worldCommands(editing))} fill="none" stroke="#7165e8" strokeWidth={1.5 / viewport.zoom} strokeDasharray={`${6 / viewport.zoom} ${4 / viewport.zoom}`} pointerEvents="none" /></g>}
        <GuidesLayer svg={ref} />
        {cut.element}
        {connector.element}
        {effectsTool.element}
        {maskBrush.element}
        {stamp.element}
        {hoverId && tool === 'select' && (() => { const unit = selectionIds(document.objects, hoverId), shapes = document.objects.filter(o => unit.includes(o.id) && !o.clipParent && o.type !== 'text'); return <path className="hover-outline" d={shapes.map(o => commandsToSvg(worldCommands(o))).join(' ')} fill="none" stroke="#1e7cf2" strokeWidth={1.5 / viewport.zoom} pointerEvents="none" />; })()}
        {pathHover && tool === 'text' && (() => { const o = document.objects.find(x => x.id === pathHover); return o ? <path className="hover-outline" d={commandsToSvg(worldCommands(o))} fill="none" stroke="#1e7cf2" strokeWidth={2 / viewport.zoom} pointerEvents="none" /> : null; })()}
        {deform.element}
        {mesh.element}
        {textFrame.element}
        <ParagraphFrames objects={document.objects.filter(o => selectedIds.includes(o.id) || o.id === editingText)} zoom={viewport.zoom} />
        {freehandPoints.length > 1 && <polyline points={freehandPoints.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={outline === 'none' ? '#000000' : outline} strokeWidth={1 / viewport.zoom} pointerEvents="none" />}
        {curves.preview && <g pointerEvents="none" fill="none" stroke="#7165e8">
          {curves.preview.control.length > 1 && <polyline points={curves.preview.control.map(p => `${p.x},${p.y}`).join(' ')} strokeWidth={1 / viewport.zoom} strokeDasharray={`${3 / viewport.zoom} ${3 / viewport.zoom}`} opacity={0.6} />}
          {curves.preview.nodes.length > 1 && <path d={commandsToSvg(penCommands(curves.preview.nodes))} strokeWidth={1.5 / viewport.zoom} />}
          {curves.preview.points.map((p, i) => <rect key={i} x={p.x - 3 / viewport.zoom} y={p.y - 3 / viewport.zoom} width={6 / viewport.zoom} height={6 / viewport.zoom} fill={i === 0 ? '#7165e8' : 'white'} strokeWidth={1 / viewport.zoom} />)}
        </g>}
        {dimension.preview && (() => { const d = dimension.preview, z = viewport.zoom;
          return <g pointerEvents="none" fill="none" stroke="#7165e8" strokeWidth={1.25 / z}>
            {d.lines.map((l, i) => <polyline key={i} points={l.map(p => `${p.x},${p.y}`).join(' ')} strokeDasharray={d.text && i < d.lines.length - 1 && d.lines.length === 3 ? `${3 / z} ${3 / z}` : undefined} />)}
            {d.text && <text x={d.text.at.x} y={d.text.at.y - 6 / z} transform={`rotate(${d.text.angle} ${d.text.at.x} ${d.text.at.y})`} fontSize={13 / z} fontFamily="Segoe UI, sans-serif" textAnchor="middle" fill="#7165e8" stroke="white" strokeWidth={3 / z} paintOrder="stroke">{d.text.value}</text>}
          </g>; })()}
        {isDimension && dimension.snap?.kind === 'edge' && <g pointerEvents="none" stroke="#e8465e" strokeWidth={1.5 / viewport.zoom}><circle cx={dimension.snap.x} cy={dimension.snap.y} r={5 / viewport.zoom} fill="white" fillOpacity={0.6} /><path d={`M${dimension.snap.x - 3 / viewport.zoom} ${dimension.snap.y - 3 / viewport.zoom}l${6 / viewport.zoom} ${6 / viewport.zoom}m0 ${-6 / viewport.zoom}l${-6 / viewport.zoom} ${6 / viewport.zoom}`} /><title>Encaixar na borda</title></g>}
        {isDimension && dimension.snap?.kind === 'node' && <rect x={dimension.snap.x - 5 / viewport.zoom} y={dimension.snap.y - 5 / viewport.zoom} width={10 / viewport.zoom} height={10 / viewport.zoom} fill="none" stroke="#e8465e" strokeWidth={1.5 / viewport.zoom} pointerEvents="none"><title>Encaixar no nó</title></rect>}
        {tool === 'transparency' && manipulation.selected.length > 0 && (() => { const b = boundsOf(manipulation.selected); return <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="none" stroke="#7165e8" strokeWidth={1 / viewport.zoom} strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`} pointerEvents="none" />; })()}
        {paths.snap && (tool === 'line' || tool === 'pen' || tool === 'pentool') && <rect x={paths.snap.x - 5 / viewport.zoom} y={paths.snap.y - 5 / viewport.zoom} width={10 / viewport.zoom} height={10 / viewport.zoom} fill="#1f6fd1" fillOpacity={0.25} stroke="#1f6fd1" strokeWidth={1.5 / viewport.zoom} pointerEvents="none"><title>Ponta da curva: a linha continua a partir daqui (ou fecha a forma)</title></rect>}
        {paths.nodes.length > 0 && <g pointerEvents="none" fill="none" stroke="#7165e8">
          <path d={commandsToSvg(penCommands(paths.nodes))} strokeWidth={2 / viewport.zoom} />
          {!paths.isDragging() && paths.hover && (tool === 'pen' || tool === 'pentool') && <path d={commandsToSvg(penCommands([paths.nodes.at(-1)!, paths.hover]))} strokeWidth={1 / viewport.zoom} strokeDasharray={tool === 'pentool' ? undefined : `${4 / viewport.zoom} ${4 / viewport.zoom}`} />}
          {paths.nodes.map((node, i) => <g key={i}>
            {([node.incoming, node.outgoing]).map((handle, h) => handle && <g key={h}><line x1={node.x} y1={node.y} x2={handle.x} y2={handle.y} strokeWidth={1 / viewport.zoom} /><circle cx={handle.x} cy={handle.y} r={3 / viewport.zoom} fill="white" strokeWidth={1 / viewport.zoom} /></g>)}
            <circle cx={node.x} cy={node.y} r={(i === 0 ? 5 : 3) / viewport.zoom} fill={i === 0 ? '#7165e8' : 'white'} strokeWidth={1 / viewport.zoom} />
          </g>)}
        </g>}
        {manipulation.spacings.map((sp, i) => { const z = viewport.zoom, tick = 5 / z; return <g key={`sp-${i}`} className="spacing-guide" pointerEvents="none">{sp.segments.map((seg, j) => sp.axis === 'x'
          ? <g key={j}><line x1={seg.from} x2={seg.to} y1={seg.at} y2={seg.at} strokeWidth={1.2 / z} /><line x1={seg.from} x2={seg.from} y1={seg.at - tick} y2={seg.at + tick} strokeWidth={1.2 / z} /><line x1={seg.to} x2={seg.to} y1={seg.at - tick} y2={seg.at + tick} strokeWidth={1.2 / z} /></g>
          : <g key={j}><line y1={seg.from} y2={seg.to} x1={seg.at} x2={seg.at} strokeWidth={1.2 / z} /><line y1={seg.from} y2={seg.from} x1={seg.at - tick} x2={seg.at + tick} strokeWidth={1.2 / z} /><line y1={seg.to} y2={seg.to} x1={seg.at - tick} x2={seg.at + tick} strokeWidth={1.2 / z} /></g>)}</g>; })}
        {manipulation.contact && <g className="snap-contact" pointerEvents="none"><rect x={manipulation.contact.x - 4 / viewport.zoom} y={manipulation.contact.y - 4 / viewport.zoom} width={8 / viewport.zoom} height={8 / viewport.zoom} fill="none" stroke="#e8336d" strokeWidth={1.5 / viewport.zoom} /><text x={manipulation.contact.x + 7 / viewport.zoom} y={manipulation.contact.y - 7 / viewport.zoom} fontSize={11 / viewport.zoom} fill="#e8336d">borda</text></g>}
        {manipulation.guides.map((g, i) => <line key={i} className="smart-guide" x1={g.axis === 'x' ? g.position : g.from} x2={g.axis === 'x' ? g.position : g.to} y1={g.axis === 'x' ? g.from : g.position} y2={g.axis === 'x' ? g.to : g.position} strokeWidth={1 / viewport.zoom} pointerEvents="none" />)}
        {manipulation.marquee && <rect className="selection-marquee" x={Math.min(manipulation.marquee.start.x, manipulation.marquee.end.x)} y={Math.min(manipulation.marquee.start.y, manipulation.marquee.end.y)} width={Math.abs(manipulation.marquee.end.x - manipulation.marquee.start.x)} height={Math.abs(manipulation.marquee.end.y - manipulation.marquee.start.y)} strokeWidth={1 / viewport.zoom} strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`} pointerEvents="none" />}
        {manipulation.rotating && <g pointerEvents="none" transform={`translate(${manipulation.rotating.point.x + 14 / viewport.zoom} ${manipulation.rotating.point.y - 14 / viewport.zoom})`}><rect x={0} y={-16 / viewport.zoom} width={70 / viewport.zoom} height={22 / viewport.zoom} rx={4 / viewport.zoom} fill="#262935" opacity={0.85} /><text x={35 / viewport.zoom} y={0} fontSize={13 / viewport.zoom} fontFamily="Segoe UI, sans-serif" textAnchor="middle" fill="white">{manipulation.rotating.angle.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°</text></g>}
        {/* Durante a transformação: contorno da posição nova por cima de tudo (halo branco + azul), visível sobre fotos, preto e objetos sobrepostos. */}
        {manipulation.preview && (() => { const d = manipulation.preview.filter(o => !o.clipParent || !manipulation.preview!.some(p => p.id === o.clipParent)).map(o => commandsToSvg(o.type === 'text' ? mapCommands(localCommands(o), q => transformPoint(matrixOf(o), q)) : worldCommands(o))).join(' ');
          return <g className="live-outline" fill="none" pointerEvents="none"><path d={d} stroke="#fff" strokeWidth={3 / viewport.zoom} /><path d={d} stroke="#1e7cf2" strokeWidth={1.2 / viewport.zoom} /></g>; })()}
        {tool === 'select' && !editingObject && manipulation.selected.length > 0 && <TransformOverlay bounds={manipulation.frame.bounds} matrix={manipulation.frame.matrix} zoom={viewport.zoom} mode={manipulation.mode} pivot={manipulation.pivot} />}
        {tool === 'transparency' && gradientTool.handles && (() => { const h = gradientTool.handles, z = viewport.zoom, node = (kind: 'start' | 'end', p: Point, value: number) => <g key={kind} data-gradient-handle={kind} className="gradient-handle"><rect x={p.x - 6 / z} y={p.y - 6 / z} width={12 / z} height={12 / z} fill={kind === 'start' ? 'white' : '#262935'} stroke={kind === 'start' ? '#262935' : 'white'} strokeWidth={1.5 / z} /><text x={p.x + 10 / z} y={p.y - 9 / z} fontSize={11 / z} fontFamily="Segoe UI, sans-serif" fill="#262935" stroke="white" strokeWidth={3 / z} paintOrder="stroke">{Math.round(value)}%</text><title>{kind === 'start' ? 'Início do degradê (arraste)' : 'Fim do degradê (arraste)'}</title></g>;
          return <g>{h.gradient.type === 'radial' && <circle cx={h.start.x} cy={h.start.y} r={Math.hypot(h.end.x - h.start.x, h.end.y - h.start.y)} fill="none" stroke="#7165e8" strokeWidth={1 / z} strokeDasharray={`${4 / z} ${3 / z}`} pointerEvents="none" />}<line x1={h.start.x} y1={h.start.y} x2={h.end.x} y2={h.end.y} stroke="#262935" strokeWidth={3 / z} pointerEvents="none" /><line x1={h.start.x} y1={h.start.y} x2={h.end.x} y2={h.end.y} stroke="white" strokeWidth={1.2 / z} strokeDasharray={`${5 / z} ${4 / z}`} pointerEvents="none" />{node('start', h.start, h.gradient.from)}{node('end', h.end, h.gradient.to)}</g>; })()}
        {corners.handles && <g className="corner-handles">{corners.handles.map(h => <circle key={h.corner} data-corner-handle={h.corner} cx={h.x} cy={h.y} r={4.5 / viewport.zoom} strokeWidth={1.5 / viewport.zoom}><title>Arraste ao longo da borda para arredondar o canto</title></circle>)}</g>}
        {spacing.handles && (() => { const h = spacing.handles, z = viewport.zoom, arrow = (kind: 'letter' | 'line', p: Point, title: string) => <g key={kind} data-text-spacing={kind} className="text-spacing-handle" transform={`translate(${p.x} ${p.y}) rotate(${h.angle}) translate(${kind === 'letter' ? 10 / z : -10 / z} ${12 / z}) scale(${1 / z})`}><rect x={-9} y={-9} width={18} height={18} rx={3} fill="white" stroke="#7165e8" strokeWidth={1.2} /><path d={kind === 'letter' ? 'M-6 0H6M-6 0l3-3M-6 0l3 3M6 0l-3-3M6 0l-3 3' : 'M0 -6V6M0 -6l-3 3M0 -6l3 3M0 6l-3-3M0 6l3-3'} fill="none" stroke="#262935" strokeWidth={1.4} strokeLinecap="round" /><title>{title}</title></g>;
          return <g>{arrow('line', h.line, 'Arraste para cima/baixo: espaçamento entre linhas')}{arrow('letter', h.letter, 'Arraste para os lados: espaçamento entre caracteres')}</g>; })()}
        {tool === 'nodes' && nodes.object && <NodeOverlay path={nodes.path} matrix={matrixOf(nodes.object)} objectId={nodes.object.id} selectedNodes={selectedNodes} zoom={viewport.zoom} fillets={nodes.fillets} />}
        {nodes.marquee && <rect className="selection-marquee" x={Math.min(nodes.marquee.start.x, nodes.marquee.end.x)} y={Math.min(nodes.marquee.start.y, nodes.marquee.end.y)} width={Math.abs(nodes.marquee.end.x - nodes.marquee.start.x)} height={Math.abs(nodes.marquee.end.y - nodes.marquee.start.y)} strokeWidth={1 / viewport.zoom} strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`} pointerEvents="none" />}
      </g>
    </svg>
    {editingObject && <TextEditor key={editingObject.id} object={editingObject} close={(removed, escape) => { setEditingText(null); if (escape) setTool('select'); if (removed) select(null); else select(editingObject.id); }} />}
    {tool === 'select' && !editing && powerClipFrame && <PowerClipBar frame={powerClipFrame} viewport={viewport} command={action => { if (action === 'select') { clipCommand('edit', powerClipFrame.id); setSelection(directContents(document.objects, powerClipFrame.id).map(o => o.id)); return; } clipCommand(action); }} />}
    {editing && <div className="clip-edit-bar" role="status">Editando PowerClip ({allContents(document.objects, editing.id).length} objeto(s))<button onClick={() => clipCommand('finish')}>Concluir edição</button></div>}
    <div className="workspace-caption">{captions[tool] ?? (selectedId || tool !== 'select' ? 'Ctrl: proporção quadrada · Shift: a partir do centro · Scroll: zoom' : 'Scroll para zoom · Espaço + arrastar para mover a vista')}</div>{rulers && <Rulers />}</main>;
}
