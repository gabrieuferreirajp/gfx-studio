import type { VectorObject } from '../document/model.ts';
import { placeGlyphs, pointAt, polylineOf, reversePolyline } from './textPath.ts';

export type TextAlign = 'left' | 'center' | 'right';
export interface TextStyle { fontFamily: string; fontSize: number; bold: boolean; italic: boolean; underline: boolean; textAlign: TextAlign; fontWeight?: number }
/** Tamanho em pontos, como no CorelDRAW; 1 pt = 96/72 px. */
export const PT = 96 / 72;
export const defaultTextStyle: TextStyle = { fontFamily: 'Arial', fontSize: 24, bold: false, italic: false, underline: false, textAlign: 'left' };
export const fontFamilies = ['Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
export const fontSizes = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 96, 120, 150, 200, 300];
export const FONT_FAMILY = /^[\p{L}\p{N} _\-.,'&]{1,100}$/u;
/** Texto com fonte e tamanho reais; textos antigos (sem `fontSize`) são esticados na caixa. */
export const isStyledText = (o: VectorObject) => o.type === 'text' && o.fontSize !== undefined;
export const fontPx = (o: VectorObject) => (o.fontSize ?? defaultTextStyle.fontSize) * PT;
export const lineHeight = (o: VectorObject) => fontPx(o) * (o.lineSpacing ?? 1.2);
export const textLines = (o: VectorObject) => (o.text ?? '').split('\n');
export const styleOf = (o: VectorObject): TextStyle => ({ fontFamily: o.fontFamily ?? defaultTextStyle.fontFamily, fontSize: o.fontSize ?? Math.round((36 * o.height / 48) / PT * 10) / 10, bold: !!o.bold, italic: !!o.italic, underline: !!o.underline, textAlign: o.textAlign ?? 'left', ...(o.fontWeight !== undefined ? { fontWeight: o.fontWeight } : {}) });
/** Peso usado para desenhar e medir: o numérico (CorelDRAW) ou 700/400 pelo negrito. */
export const textWeight = (o: VectorObject) => o.fontWeight ?? (o.bold ? 700 : 400);
/** Espaçamento entre caracteres em px: % da largura do espaço na fonte (como no CorelDRAW). */
export const letterSpacingPx = (o: VectorObject, measure: Measure) => o.letterSpacing ? o.letterSpacing / 100 * measure(' ', cssFont(o)) : 0;
const spaced = (o: VectorObject, line: string, measure: Measure, font: string) => measure(line, font) + letterSpacingPx(o, measure) * [...line].length;
export const cssFont = (o: VectorObject, px = fontPx(o)) => `${o.italic ? 'italic ' : ''}${textWeight(o)} ${px}px "${o.fontFamily ?? defaultTextStyle.fontFamily}", sans-serif`;
/** Mede a largura (px) de uma linha na fonte CSS indicada. */
export type Measure = (text: string, font: string) => number;
export const approximateMeasure: Measure = (text, font) => text.length * (parseFloat(font.replace(/^(italic |bold |\d{3} )*/, '')) || 16) * 0.55;
/**
 * Texto de parágrafo: quebra cada linha nas palavras que cabem na largura do quadro (palavras maiores que o
 * quadro são quebradas por letra). Espaços no fim da linha não contam para a largura.
 */
export function wrapLines(o: VectorObject, measure: Measure): string[] {
  const font = cssFont(o), max = Math.max(1, o.width), out: string[] = [];
  const fits = (text: string) => spaced(o, text.replace(/\s+$/, ''), measure, font) <= max + 0.01;
  for (const hard of textLines(o)) {
    let line = '';
    for (const token of hard.match(/\S+\s*|\s+/g) ?? ['']) {
      if (fits(line + token)) { line += token; continue; }
      if (line) { out.push(line.replace(/\s+$/, '')); line = ''; }
      let rest = token;
      while (rest && !fits(rest)) {
        let n = 1; while (n < rest.length && fits(rest.slice(0, n + 1))) n++;
        out.push(rest.slice(0, n)); rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line.replace(/\s+$/, ''));
  }
  return out;
}
/** Linhas exibidas: quebradas no quadro (parágrafo) ou só nas quebras digitadas (artístico). */
export const layoutLines = (o: VectorObject, measure: Measure) => o.paragraph && !o.textPath ? wrapLines(o, measure) : textLines(o);
/** Quantas linhas do parágrafo cabem na altura do quadro. */
const fittingLines = (o: VectorObject) => Math.max(0, Math.floor((o.height + 0.5 - fontPx(o) * 1.2) / lineHeight(o)) + 1);
/** O texto do parágrafo não cabe no quadro (o CorelDRAW mostra o quadro em vermelho). */
export const textOverflows = (o: VectorObject, measure: Measure) => !!o.paragraph && !o.textPath && layoutLines(o, measure).length > fittingLines(o);
export interface LineBox { line: string; width: number; x: number; baseline: number; angle?: number }
/** Letras do texto em caminho, em coordenadas locais do texto (antes da matriz). */
/** Início do texto em caminho: polilinha usada (invertida no outro lado) e distância, ao longo dela, da primeira letra. */
export function pathTextStart(o: VectorObject, measure: Measure) {
  const tp = o.textPath!, font = cssFont(o), ls = letterSpacingPx(o, measure);
  let path = polylineOf(tp.commands); if (tp.flip) path = reversePolyline(path);
  const advances = [...(o.text ?? '').replace(/\r?\n/g, ' ')].map(char => ({ char, width: measure(char, font) + ls }));
  const total = advances.reduce((sum, a) => sum + a.width, 0);
  const start = o.textAlign === 'center' ? (path.total - total) / 2 + tp.offset : o.textAlign === 'right' ? path.total - total - tp.offset : tp.offset;
  return { path, advances, start };
}
/** Posição vertical (CorelDRAW): quanto a linha de base se afasta do caminho para pôr o topo, o centro ou a base nele. */
const verticalShift = (o: VectorObject) => { const v = o.textPath?.vertical, px = fontPx(o); return v === 'top' ? -px * 0.72 : v === 'center' ? -px * 0.36 : v === 'bottom' ? px * 0.22 : 0; };
function pathLayout(o: VectorObject, measure: Measure): LineBox[] {
  const tp = o.textPath!, { path, advances, start } = pathTextStart(o, measure);
  return placeGlyphs(path, advances, start, (tp.distance ?? 0) + verticalShift(o), !!tp.upright).map(g => ({ line: g.char, width: g.width, x: g.x, baseline: g.y, angle: g.angle }));
}
/** Linha de base e deslocamento horizontal de cada linha (ou letra, no texto em caminho) dentro da caixa do texto. */
export function lineLayout(o: VectorObject, measure: Measure): LineBox[] {
  if (o.textPath) return pathLayout(o, measure);
  const px = fontPx(o), font = cssFont(o);
  const lines = layoutLines(o, measure), shown = o.paragraph ? lines.slice(0, fittingLines(o)) : lines;
  return shown.map((line, i) => { const width = spaced(o, line, measure, font); return { line, width, x: o.x + (o.textAlign === 'center' ? (o.width - width) / 2 : o.textAlign === 'right' ? o.width - width : 0), baseline: o.y + px * 0.9 + i * lineHeight(o) }; });
}
/** Caixa das letras do texto em caminho (cada letra vai de 0,9 da fonte acima a 0,3 abaixo da linha de base). */
function pathBounds(o: VectorObject, measure: Measure) {
  const px = fontPx(o), xs: number[] = [], ys: number[] = [];
  for (const g of pathLayout(o, measure)) {
    const a = (g.angle ?? 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    for (const [u, v] of [[0, -px * 0.9], [g.width, -px * 0.9], [g.width, px * 0.3], [0, px * 0.3]]) { xs.push(g.x + u * c - v * s); ys.push(g.baseline + u * s + v * c); }
  }
  if (!xs.length) { const { path, start } = pathTextStart(o, measure), p = path.points.length ? pointAt(path, start).point : { x: o.x, y: o.y }; return { x: p.x, y: p.y - px, width: px, height: px }; }
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) };
}
export function measureText(o: VectorObject, measure: Measure) {
  const font = cssFont(o), lines = layoutLines(o, measure);
  return { width: Math.max(1, ...lines.map(line => spaced(o, line, measure, font))), height: Math.max(1, fontPx(o) * 1.2 + (lines.length - 1) * lineHeight(o)) };
}
/** Aplica texto/estilo e recalcula a caixa, mantendo fixa a âncora do alinhamento (esquerda, centro ou direita). */
export function updateText(o: VectorObject, patch: Partial<TextStyle> & { text?: string; letterSpacing?: number; lineSpacing?: number }, measure: Measure): VectorObject {
  const next: VectorObject = { ...o, ...styleOf(o), ...patch };
  if (!next.letterSpacing) delete next.letterSpacing;
  if (next.lineSpacing !== undefined && Math.abs(next.lineSpacing - 1.2) < 1e-9) delete next.lineSpacing;
  // Ligar/desligar o negrito pelo botão substitui o peso numérico importado.
  if (patch.bold !== undefined && patch.fontWeight === undefined) delete next.fontWeight;
  // Estilo escolhido na lista (Thin, ExtraBold…): o peso numérico vale; o negrito acompanha (600 ou mais).
  if (patch.fontWeight !== undefined) { if (patch.fontWeight === 400 || patch.fontWeight === 700) { next.bold = patch.fontWeight === 700; delete next.fontWeight; } else next.bold = patch.fontWeight >= 600; }
  for (const key of ['bold', 'italic', 'underline'] as const) if (!next[key]) delete next[key];
  if (next.textAlign === 'left') delete next.textAlign;
  if (next.fontSize !== undefined) next.fontSize = Math.max(1, Math.min(3000, next.fontSize));
  // Parágrafo: o quadro mantém o tamanho; o texto se ajusta a ele. Texto em caminho: a caixa envolve as letras.
  if (next.paragraph && !next.textPath) return { ...next, x: o.fontSize === undefined ? o.x : next.x };
  if (next.textPath) return { ...next, ...pathBounds(next, measure) };
  const size = measureText(next, measure);
  const align = next.textAlign ?? 'left', dx = align === 'center' ? (o.width - size.width) / 2 : align === 'right' ? o.width - size.width : 0;
  // Texto antigo era esticado na caixa: a conversão preserva a posição do topo à esquerda.
  return { ...next, x: o.fontSize === undefined ? o.x : o.x + dx, width: size.width, height: size.height };
}
export function createText(x: number, y: number, fill: string, style: TextStyle, measure: Measure): VectorObject {
  const base: VectorObject = { id: crypto.randomUUID(), type: 'text', name: 'Texto', x, y: y - style.fontSize * PT * 0.9, width: 1, height: 1, fill, text: '', ...style, fontSize: style.fontSize };
  return updateText({ ...base, fontSize: style.fontSize }, {}, measure);
}
/** Texto de parágrafo criado arrastando a ferramenta Texto: quadro com a largura e a altura arrastadas. */
export function createParagraph(box: { x: number; y: number; width: number; height: number }, fill: string, style: TextStyle, measure: Measure): VectorObject {
  const base: VectorObject = { id: crypto.randomUUID(), type: 'text', name: 'Texto de parágrafo', x: box.x, y: box.y, width: Math.max(1, box.width), height: Math.max(1, box.height), fill, text: '', paragraph: true, ...style };
  return updateText(base, {}, measure);
}
/** Converter texto artístico ↔ parágrafo (Ctrl+F8 no CorelDRAW). O parágrafo vira artístico com as quebras exibidas. */
export function toggleParagraph(o: VectorObject, measure: Measure): VectorObject {
  if (o.type !== 'text' || o.textPath) return o;
  const styled = o.fontSize === undefined ? updateText(o, {}, measure) : o;
  if (styled.paragraph) { const { paragraph: _p, ...rest } = styled; return updateText({ ...rest, text: layoutLines(styled, measure).join('\n'), name: rest.name === 'Texto de parágrafo' ? 'Texto' : rest.name }, {}, measure); }
  return { ...styled, paragraph: true, width: styled.width + 1, height: styled.height + 1, name: styled.name === 'Texto' ? 'Texto de parágrafo' : styled.name };
}
