import type { DocumentUnit } from './units.ts';
import type { BlendMode } from './transparency.ts';
import type { ArrowKind } from './paint.ts';
export type Tool = 'select' | 'rectangle' | 'ellipse' | 'text' | 'line' | 'pen' | 'nodes' | 'freehand' | 'polygon' | 'star' | 'spiral' | 'graph' | 'zoom' | 'pan' | 'eyedropper' | 'pentool' | 'bspline' | 'polyline' | 'threepoint' | 'dimension' | 'transparency' | 'crop' | 'knife' | 'eraser' | 'virtualDelete' | 'envelope' | 'perspective' | 'mesh' | 'dimHV' | 'dimAngle' | 'dimSegment' | 'callout' | 'smartFill' | 'connector' | 'elbowConnector' | 'roundConnector' | 'dropShadow' | 'contour' | 'blockShadow' | 'lasso' | 'maskBrush' | 'cloneStamp';
export type NodeMode = 'corner' | 'smooth' | 'symmetric';
export type VectorKind = 'rectangle' | 'ellipse' | 'text' | 'path' | 'image';
export type PathCommand = { type: 'M' | 'L'; x: number; y: number } | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number } | { type: 'Z' };
export interface VectorObject {
  id: string;
  type: VectorKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  fillRule?: 'nonzero' | 'evenodd';
  text?: string;
  /** Texto com fonte real (tamanho em pontos); ausente em textos antigos, que são esticados na caixa. */
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  /** Peso numérico da fonte (100–900), quando não é só normal/negrito (ex.: SemiBold 600, ExtraBold 800 vindos do CorelDRAW). */
  fontWeight?: number;
  /** Distância entre linhas em múltiplos do tamanho da fonte (padrão 1,2); vem do espaçamento do CorelDRAW. */
  lineSpacing?: number;
  /** Espaçamento entre caracteres em % da largura do espaço (CorelDRAW; 0 = normal). */
  letterSpacing?: number;
  italic?: boolean;
  underline?: boolean;
  /** Objeto oculto (Objeto › Ocultar, olho no painel Objetos): não aparece, não é clicado nem exportado. */
  hidden?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  /** Texto de parágrafo (CorelDRAW): as linhas quebram na largura do quadro; o que não cabe na altura fica oculto. */
  paragraph?: boolean;
  /** Texto em caminho (Ajustar texto ao caminho): letras ao longo de uma cópia do caminho, em coordenadas locais. */
  textPath?: TextPath;
  /** Preenchimento em degradê (Editar preenchimento); `fill` guarda a primeira cor. */
  fillGradient?: FillGradient;
  /** Preenchimento de padrão (duas cores ou bitmap); `fill` guarda a cor de fundo. */
  fillPattern?: FillPattern;
  /** Preenchimento de malha: grade de cores interpolada; `fill` guarda a cor média. */
  meshFill?: MeshFill;
  /** Estilo de objeto vinculado (ID em `document.styles`). */
  style?: string;
  /** Parte de uma instância de símbolo (ID em `document.symbols`). */
  symbol?: SymbolLink;
  /** Estilo de cor ligado ao preenchimento / ao contorno (ID em `document.colorStyles`). */
  fillStyle?: string;
  strokeStyle?: string;
  /** Cor especial (spot) do preenchimento / contorno, ex.: CutContour (vale enquanto a cor for a da cor especial). */
  fillSpot?: string;
  strokeSpot?: string;
  /** Cor de processo exata (C, M, Y, K em %), escolhida no modo CMYK ou na paleta CMYK; sai assim no PDF/EPS. */
  fillCmyk?: [number, number, number, number];
  strokeCmyk?: [number, number, number, number];
  /** Conector (caminho aberto) preso a objetos; refeito quando eles mudam. */
  connector?: Connector;
  /** No texto da cota: pontos medidos presos a objetos; a cota é refeita quando eles mudam. */
  dimLink?: DimLink;
  stroke?: string;
  strokeWidth?: number;
  /** Caneta de contorno (CorelDRAW): traço em múltiplos da largura, cantos, extremidades, posição e setas. */
  strokeDash?: number[];
  strokeJoin?: 'miter' | 'round' | 'bevel';
  strokeCap?: 'butt' | 'round' | 'square';
  strokeMiter?: number;
  strokePosition?: 'inside' | 'outside';
  /** Contorno atrás do preenchimento. */
  strokeBehind?: boolean;
  /** A largura do contorno acompanha a escala do objeto. */
  strokeScale?: boolean;
  arrowStart?: ArrowKind;
  arrowEnd?: ArrowKind;
  commands?: PathCommand[];
  /** Envelope (CorelDRAW) aplicado à curva: guarda a forma original e o envelope para continuar editando. */
  envelope?: EnvelopeData;
  pathSize?: { width: number; height: number };
  nodeModes?: NodeMode[];
  transform?: [number, number, number, number, number, number];
  groupPath?: string[];
  /** Imagem incorporada (data URL PNG, JPEG, GIF ou WebP). */
  src?: string;
  /** Envelope no bitmap: imagem original e nós (relativos à caixa atual) para continuar editando ou limpar. */
  warp?: BitmapWarp;
  /** ID do quadro PowerClip que contém este objeto. */
  clipParent?: string;
  /** Objeto bloqueado (botão direito › Bloquear objeto): não pode ser clicado, selecionado nem movido. */
  locked?: boolean;
  /** Quadro PowerClip cujo conteúdo não acompanha as transformações do quadro. */
  clipUnlocked?: boolean;
  /** Cantos do retângulo (raio em px do documento): arredondado, recortado (scallop) ou chanfrado. */
  cornerRadius?: number;
  cornerType?: CornerType;
  /** Raio de cada canto (superior esquerdo, superior direito, inferior direito, inferior esquerdo); substitui `cornerRadius`. */
  cornerRadii?: [number, number, number, number];
  /** Sombra projetada (deslocamento e desfoque em px, opacidade 0–1). */
  shadow?: Shadow;
  /** Máscara de camada (Photoshop): bitmap em tons de cinza sobre a caixa local do objeto; branco mostra, preto oculta. */
  mask?: LayerMask;
  /** Desfoque gaussiano (sombra separada da ferramenta Sombra). */
  blur?: number;
  /** Parte de um efeito vivo (Bloquear sombra, Contorno) do objeto `effectOf.id`. */
  effectOf?: EffectLink;
  /** Bitmap: contorno de recorte em coordenadas relativas à imagem (0–1); editável na ferramenta Forma. */
  crop?: PathCommand[];
  /** Transparência uniforme (ferramenta Transparência): opacidade 0–1; ausente = opaco. */
  opacity?: number;
  /** Transparência em degradê (ferramenta Transparência › degradê); substitui a uniforme. */
  transparencyGradient?: TransparencyGradient;
  /** Modo de mesclagem da transparência (CorelDRAW); ausente = Normal. */
  blendMode?: BlendMode;
  /** Camada do objeto (ID em `document.layers`); ausente = camada ativa/única. */
  layer?: string;
}
/** Pontos inicial e final em frações da caixa do objeto (antes da transformação); from/to em % de transparência. */
export interface TransparencyGradient { type: 'linear' | 'radial'; x1: number; y1: number; x2: number; y2: number; from: number; to: number }
/** Ponto de cor do degradê: posição 0–1, cor e opacidade 0–1 (ausente = opaca). */
export interface GradientStop { offset: number; color: string; opacity?: number }
/** Degradê de preenchimento: pontos em frações da caixa do objeto, como a transparência em degradê. */
export interface FillGradient { type: 'linear' | 'radial'; x1: number; y1: number; x2: number; y2: number; stops: GradientStop[]; spread?: 'pad' | 'reflect' | 'repeat'; steps?: number; acceleration?: number }
/**
 * Caminho do texto: `offset` = distância do início (px), `distance` = afastamento da linha de base, `flip` = lado oposto.
 * `source`: curva ligada (CorelDRAW: mover/editar a curva leva o texto junto); `vertical`: o que fica sobre o caminho
 * (linha de base, topo, centro ou base das letras); `upright`: letras em pé em vez de giradas pela curva.
 */
export type PathTextVertical = 'baseline' | 'top' | 'center' | 'bottom';
export interface TextPath { commands: PathCommand[]; offset: number; distance?: number; flip?: boolean; source?: string; vertical?: PathTextVertical; upright?: boolean }
/** Padrão de duas cores (desenho do mosaico `preset` em `fg` sobre `bg`) ou bitmap (`src`), em mosaicos de `size` px. */
export interface FillPattern { kind: 'twoColor' | 'bitmap'; preset?: string; fg?: string; bg?: string; src?: string; size: number; ratio?: number; angle?: number }
/** Malha: (rows + 1) × (cols + 1) cores, linha a linha, sobre a caixa local do objeto; `src` é a imagem gerada (PNG). */
/** Nó do envelope: posição, posição original ao longo do lado (`t`, 0–1) e alças do segmento que sai dele (sem alças = reta). */
export interface EnvelopeNode { x: number; y: number; t: number; c1?: { x: number; y: number }; c2?: { x: number; y: number }; smooth?: boolean }
export type EnvelopeMode = 'line' | 'arc' | 'doubleArc' | 'free';
export type EnvelopeMapping = 'horizontal' | 'original' | 'putty' | 'vertical';
/**
 * Envelope guardado no objeto. `source`, `nodes` e `box` ficam no espaço do envelope; `frame` leva esse espaço ao
 * espaço dos comandos do objeto (assim mover, girar ou escalar o objeto leva o envelope junto). `check` é a
 * assinatura dos comandos produzidos: se a curva for editada por outra ferramenta, o envelope deixa de valer.
 */
export interface EnvelopeData { id: string; source: PathCommand[]; nodes: EnvelopeNode[]; corners: [number, number, number, number]; box: { x: number; y: number; width: number; height: number }; frame: [number, number, number, number, number, number]; mode: EnvelopeMode; mapping: EnvelopeMapping; keepLines?: boolean; check: string }
/** Envelope de bitmap: nós e caixa original em coordenadas relativas (0–1) à caixa do objeto; `check` = assinatura do src produzido. */
export interface BitmapWarp { src: string; nodes: EnvelopeNode[]; corners: [number, number, number, number]; box: { x: number; y: number; width: number; height: number }; mode: EnvelopeMode; check: string }
export interface MeshFill { rows: number; cols: number; colors: string[]; src: string }
/** Instância de símbolo: `instance` agrupa as partes; `matrix` leva as coordenadas do símbolo ao documento. */
/** Ponto preso a um objeto (`id`, posição relativa `u`,`v` na caixa transformada) ou livre; `x`,`y` = último ponto usado. */
export interface Anchor { id?: string; u?: number; v?: number; x: number; y: number }
/**
 * Efeito vivo ligado a um objeto (CorelDRAW): Bloquear sombra e Contorno. O objeto do efeito guarda o ID do
 * original, os parâmetros e a assinatura da geometria do original quando foi calculado; mover o original move o
 * efeito, mudar a forma marca o efeito para ser refeito (`stale`). Separar (Ctrl+K) remove a ligação.
 */
/** Máscara de camada: imagem PNG (cinza) em coordenadas locais do objeto; `disabled` = desativada (como Shift+clique no Photoshop). */
export interface LayerMask { src: string; x: number; y: number; width: number; height: number; disabled?: boolean; background?: 'black' }
export interface EffectLink {
  id: string;
  kind: 'blockShadow' | 'contour';
  dx?: number; dy?: number;
  direction?: 'outside' | 'inside'; steps?: number; offset?: number; endColor?: string; corners?: 'miter' | 'round' | 'bevel';
  color?: string;
  origin: { x: number; y: number };
  /** Posição (translação da matriz) do efeito na última sincronização. */
  at?: { x: number; y: number };
  shape: string;
  stale?: boolean;
}
export interface Connector { from: Anchor; to: Anchor; kind: 'straight' | 'elbow' | 'rounded' }
export interface DimLink { a: Anchor; b: Anchor; offset: number; axis?: { x: number; y: number }; unit?: DocumentUnit; precision?: number; showUnit?: boolean; fontSize?: number; color: string }
export interface ColorStyle { id: string; name: string; color: string }
export interface SymbolLink { id: string; instance: string; matrix: [number, number, number, number, number, number] }
/** Estilo de objeto (CorelDRAW): atributos de preenchimento, contorno, transparência e texto. */
export interface ObjectStyle { id: string; name: string; props: Partial<VectorObject> }
/** Símbolo: objetos em coordenadas próprias (canto superior esquerdo em 0,0). */
export interface SymbolDef { id: string; name: string; objects: VectorObject[] }
export type CornerType = 'round' | 'scallop' | 'chamfer';
export interface Shadow { x: number; y: number; blur: number; color: string; opacity: number }
export interface VectorDocument {
  version: 1;
  unit?: DocumentUnit;
  /** Paleta do documento: cores registradas durante o uso. */
  palette?: string[];
  id: string;
  name: string;
  artboard: { width: number; height: number };
  /** Objetos da página ativa. */
  objects: VectorObject[];
  /** Páginas do documento (ausente = uma página). A entrada da página ativa fica com `objects` vazio. */
  pages?: DocumentPage[];
  /** Índice da página ativa em `pages`. */
  page?: number;
  /** Linhas-guia do documento (arrastadas das réguas), em px do documento. */
  guides?: Guideline[];
  /** Camadas (de baixo para cima); ausente = uma camada implícita. */
  layers?: Layer[];
  /** Camada que recebe os novos objetos. */
  activeLayer?: string;
  /** Estilos de objeto do documento. */
  styles?: ObjectStyle[];
  /** Estilos de cor (Ctrl+F6): cores com nome; objetos ligados por `fillStyle`/`strokeStyle`. */
  colorStyles?: ColorStyle[];
  /** Biblioteca de símbolos do documento. */
  symbols?: SymbolDef[];
}
/** Linha-guia: `axis` x é vertical (posição em x); y é horizontal. */
export interface Guideline { id: string; axis: 'x' | 'y'; position: number }
/** Camada (CorelDRAW): visível, travada (não seleciona) e imprimível (entra na impressão e exportação). */
export interface Layer { id: string; name: string; visible: boolean; locked: boolean; printable: boolean }
export interface DocumentPage { id: string; name: string; objects: VectorObject[] }
export const labels: Record<VectorKind, string> = { rectangle: 'Retângulo', ellipse: 'Elipse', text: 'Texto', path: 'Caminho', image: 'Bitmap' };
export const MAX_SIZE = 20000;
export function createDocument(): VectorDocument {
  // Página padrão: A4 em pé (210 × 297 mm), em milímetros, como no CorelDRAW.
  return { version: 1, unit: 'mm', id: crypto.randomUUID(), name: 'Sem título', artboard: { width: 793.7, height: 1122.52 }, objects: [] };
}
export function createObject(type: 'rectangle' | 'ellipse' | 'text', x: number, y: number, fill: string, stroke?: string): VectorObject {
  return { id: crypto.randomUUID(), type, name: labels[type], x, y, width: type === 'text' ? 200 : 1, height: type === 'text' ? 48 : 1, fill, ...(type === 'text' ? { text: 'Seu texto' } : {}), ...(stroke && type !== 'text' ? { stroke, strokeWidth: 1 } : {}) };
}
export type DocumentAction = { type: 'set-library'; styles?: ObjectStyle[]; symbols?: SymbolDef[]; colorStyles?: ColorStyle[]; document?: Pick<VectorDocument, 'objects' | 'pages' | 'page'> } | { type: 'set-guides'; guides: Guideline[] } | { type: 'set-layers'; layers: Layer[]; activeLayer: string; objects?: VectorObject[] } | { type: 'set-document'; name?: string; artboard?: { width: number; height: number } } | { type: 'set-unit'; unit: DocumentUnit } | { type: 'set-palette'; palette: string[] } | { type: 'set-objects'; objects: VectorObject[] } | { type: 'set-pages'; document: Pick<VectorDocument, 'objects' | 'pages' | 'page'> } | { type: 'add'; object: VectorObject } | { type: 'path-edit'; id: string; geometry: Pick<VectorObject, 'x' | 'y' | 'width' | 'height' | 'commands' | 'pathSize' | 'nodeModes'> } | { type: 'update'; id: string; patch: Partial<Pick<VectorObject, 'x' | 'y' | 'width' | 'height' | 'fill' | 'text' | 'stroke' | 'strokeWidth'>> } | { type: 'delete'; id: string };
const usedColors = (objects: VectorObject[]) => new Set(objects.flatMap(o => [o.fill, o.stroke ?? 'none']).filter(c => /^#[0-9a-f]{6}$/i.test(c)).map(c => c.toLowerCase()));
/** Registra na paleta do documento as cores que passaram a ser usadas nesta alteração. */
export function recordPalette(before: VectorDocument, after: VectorDocument): VectorDocument {
  if (before.objects === after.objects) return after;
  const old = usedColors(before.objects), palette = after.palette ?? [];
  const added = [...usedColors(after.objects)].filter(c => !old.has(c) && !palette.includes(c));
  return added.length ? { ...after, palette: [...palette, ...added].slice(-1000) } : after;
}
export function documentReducer(document: VectorDocument, action: DocumentAction): VectorDocument {
  return normalizeLayers(recordPalette(document, applyAction(document, action)));
}
/** Igual, mas sem registrar cores na paleta do documento (prévias ao vivo: a cor só entra quando confirmada). */
export function previewReducer(document: VectorDocument, action: DocumentAction): VectorDocument {
  return normalizeLayers(applyAction(document, action));
}
/**
 * Com camadas, os objetos ficam ordenados pela camada (de baixo para cima, ordem estável) e objetos sem camada
 * entram na camada ativa — assim novos objetos, colagens e importações vão para a camada certa.
 */
export function normalizeLayers(document: VectorDocument): VectorDocument {
  const layers = document.layers;
  if (!layers?.length) return document;
  const active = layers.some(l => l.id === document.activeLayer) ? document.activeLayer! : layers.at(-1)!.id;
  const index = new Map(layers.map((l, i) => [l.id, i]));
  let changed = active !== document.activeLayer;
  const tagged = document.objects.map(o => { if (o.layer && index.has(o.layer)) return o; changed = true; return { ...o, layer: active }; });
  const sorted = tagged.map((o, i) => ({ o, i })).sort((a, b) => index.get(a.o.layer!)! - index.get(b.o.layer!)! || a.i - b.i).map(e => e.o);
  if (!changed && sorted.every((o, i) => o === document.objects[i])) return document;
  return { ...document, activeLayer: active, objects: sorted };
}
function applyAction(document: VectorDocument, action: DocumentAction): VectorDocument {
  if (action.type === 'set-palette') return { ...document, palette: [...new Set(action.palette.filter(c => /^#[0-9a-f]{6}$/i.test(c)).map(c => c.toLowerCase()))].slice(0, 1000) };
  if (action.type === 'set-document') {
    const name = action.name?.trim().slice(0, 256), size = action.artboard;
    const valid = (v: number) => Number.isFinite(v) && v >= 1 && v <= 10000;
    return { ...document, ...(name ? { name } : {}), ...(size && valid(size.width) && valid(size.height) ? { artboard: { width: size.width, height: size.height } } : {}) };
  }
  if (action.type === 'set-unit') return { ...document, unit: action.unit };
  if (action.type === 'set-library') {
    const { styles: _s, symbols: _y, colorStyles: _c, ...rest } = document, styles = action.styles ?? document.styles, symbols = action.symbols ?? document.symbols, colorStyles = action.colorStyles ?? document.colorStyles;
    return { ...rest, ...(styles?.length ? { styles } : {}), ...(symbols?.length ? { symbols } : {}), ...(colorStyles?.length ? { colorStyles } : {}), ...(action.document ? { objects: action.document.objects, pages: action.document.pages, page: action.document.page } : {}) };
  }
  if (action.type === 'set-guides') { const { guides: _g, ...rest } = document; return action.guides.length ? { ...rest, guides: action.guides.slice(0, 500) } : rest; }
  if (action.type === 'set-layers') return { ...document, layers: action.layers, activeLayer: action.activeLayer, ...(action.objects ? { objects: action.objects } : {}) };
  if (action.type === 'set-objects') return { ...document, objects: action.objects };
  if (action.type === 'set-pages') return { ...document, objects: action.document.objects, pages: action.document.pages, page: action.document.page };
  if (action.type === 'add') return { ...document, objects: [...document.objects, action.object] };
  if (action.type === 'delete') return { ...document, objects: document.objects.filter(o => o.id !== action.id) };
  if (action.type === 'path-edit') return { ...document, objects: document.objects.map(o => o.id === action.id && o.type === 'path' ? { ...o, ...action.geometry } : o) };
  return { ...document, objects: document.objects.map(o => {
    if (o.id !== action.id) return o;
    const patch = { ...action.patch };
    if (patch.strokeWidth !== undefined) {
      if (!Number.isFinite(patch.strokeWidth)) delete patch.strokeWidth;
      else patch.strokeWidth = Math.max(0, Math.min(1000, patch.strokeWidth));
    }
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      if (patch[key] !== undefined) {
        if (!Number.isFinite(patch[key])) delete patch[key];
        else patch[key] = key === 'width' || key === 'height' ? Math.max(1, Math.min(MAX_SIZE, patch[key]!)) : Math.max(-MAX_SIZE, Math.min(MAX_SIZE, patch[key]!));
      }
    }
    if (patch.fill !== undefined) { const { fillGradient: _g, fillPattern: _p, meshFill: _m, ...rest } = o; return { ...rest, ...patch }; }
    return { ...o, ...patch };
  }) };
}
