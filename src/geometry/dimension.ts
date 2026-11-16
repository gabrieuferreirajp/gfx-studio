import type { VectorObject } from '../document/model.ts';
import type { Point } from './pathGeometry.ts';
import { createPathObject } from './pathGeometry.ts';
import { smoothNodes } from './shapeFactory.ts';
import { createText, defaultTextStyle, updateText, type Measure } from '../text/textLayout.ts';
import { around, objectCorners, rotation } from './objectTransforms.ts';
import { worldCommands } from './worldGeometry.ts';
import { toUnit, unitDefinitions, type DocumentUnit } from '../document/units.ts';

/** Casas decimais da cota por unidade (CorelDRAW: precisão 0,00). */
const decimals = (unit: DocumentUnit) => unit === 'px' ? 0 : unit === 'm' || unit === 'km' || unit === 'mi' || unit === 'in' || unit === 'ft' || unit === 'yd' ? 3 : 2;
/** Opções das cotas (barra de propriedades): casas decimais, mostrar unidade e tamanho do texto em pt. */
export interface DimensionOptions { precision?: number; showUnit?: boolean; fontSize?: number }
export function formatMeasure(px: number, unit: DocumentUnit, options: DimensionOptions = {}) {
  const d = options.precision ?? decimals(unit);
  return `${toUnit(px, unit).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })}${options.showUnit === false ? '' : ` ${unitDefinitions[unit].short}`}`;
}
export function formatAngle(degrees: number, options: DimensionOptions = {}) {
  const d = Math.min(options.precision ?? 1, 4);
  return `${degrees.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })}°`;
}
/** Distância assinada de `p` até a reta AB (positiva à esquerda de A→B na tela). */
export function offsetFrom(a: Point, b: Point, p: Point) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len;
}
/** Restringe B a múltiplos de 15° em relação a A (Ctrl, como no CorelDRAW). */
export function constrain(a: Point, b: Point): Point {
  const angle = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 12)) * (Math.PI / 12), len = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len };
}
/**
 * Pontos da cota: linha de cota deslocada `offset` de A (pela normal). Sem `axis`, cota paralela a AB;
 * com `axis` (vetor unitário), cota horizontal/vertical: mede a projeção de AB no eixo.
 */
export function dimensionLines(a: Point, b: Point, offset: number, axis?: Point) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, u = axis ?? { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, n = { x: -u.y, y: u.x };
  const back = (a.x - b.x) * n.x + (a.y - b.y) * n.y;
  const a2 = { x: a.x + n.x * offset, y: a.y + n.y * offset }, b2 = { x: b.x + n.x * (offset + back), y: b.y + n.y * (offset + back) };
  return { u, n, a2, b2, length: axis ? Math.abs((b.x - a.x) * u.x + (b.y - a.y) * u.y) : Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 } };
}
/** Horizontal ou vertical (CorelDRAW): decide pelo lado para onde a linha de cota é afastada. */
export function axisFor(a: Point, b: Point, p: Point): Point {
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  const outY = p.y < minY ? minY - p.y : p.y > maxY ? p.y - maxY : 0, outX = p.x < minX ? minX - p.x : p.x > maxX ? p.x - maxX : 0;
  return outX > outY ? { x: 0, y: 1 } : { x: 1, y: 0 };
}
/** Deslocamento da linha de cota (a partir de A, pela normal do eixo) até o ponto. */
export const axisOffset = (a: Point, axis: Point, p: Point) => (p.x - a.x) * -axis.y + (p.y - a.y) * axis.x;
const readable = (u: Point) => { let angle = Math.atan2(u.y, u.x) * 180 / Math.PI; if (angle > 90) angle -= 180; else if (angle <= -90) angle += 180; return angle; };
function label(text: string, at: Point, angle: number, measure: Measure, color: string, options: DimensionOptions, name = 'Medida') {
  const t = updateText(createText(0, 0, color, { ...defaultTextStyle, fontSize: options.fontSize ?? 10, textAlign: 'center' }, measure), { text }, measure), up = 3;
  const box = { ...t, name, x: at.x - t.width / 2, y: at.y - t.height - up };
  return Math.abs(angle) < 1e-9 ? box : { ...box, transform: around(at, rotation(angle)) };
}
function arrowHead(tip: Point, dir: Point, color: string): VectorObject {
  const arrow = 11, wing = 3.5, n = { x: -dir.y, y: dir.x };
  return { ...createPathObject([tip, { x: tip.x - dir.x * arrow + n.x * wing, y: tip.y - dir.y * arrow + n.y * wing }, { x: tip.x - dir.x * arrow - n.x * wing, y: tip.y - dir.y * arrow - n.y * wing }], true, 'none', 'Seta'), fill: color, strokeWidth: 0 };
}
/** Cota angular: vértice, pontos nos dois braços e raio do arco (com setas e o ângulo em graus). */
export function angularDimension(vertex: Point, p1: Point, p2: Point, radius: number, measure: Measure, color = '#000000', options: DimensionOptions = {}): VectorObject[] {
  const a1 = Math.atan2(p1.y - vertex.y, p1.x - vertex.x); let sweep = Math.atan2(p2.y - vertex.y, p2.x - vertex.x) - a1;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI; while (sweep > Math.PI) sweep -= 2 * Math.PI;
  const r = Math.max(4, Math.abs(radius)), at = (t: number) => ({ x: vertex.x + Math.cos(a1 + sweep * t) * r, y: vertex.y + Math.sin(a1 + sweep * t) * r });
  const arm = (p: Point, angle: number) => { const far = Math.max(Math.hypot(p.x - vertex.x, p.y - vertex.y), r + 6); return { ...createPathObject([vertex, { x: vertex.x + Math.cos(angle) * far, y: vertex.y + Math.sin(angle) * far }], false, color, 'Linha de extensão'), strokeWidth: 1 }; };
  const steps = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 16))), arcNodes = Array.from({ length: steps + 1 }, (_, i) => at(i / steps));
  const arc = { ...createPathObject(smoothNodes(arcNodes, false), false, color, 'Arco de cota'), strokeWidth: 1 };
  const tangent = (t: number, s: number) => { const ang = a1 + sweep * t + Math.sign(sweep) * Math.PI / 2 * s; return { x: Math.cos(ang), y: Math.sin(ang) }; };
  const mid = at(0.5), outward = { x: (mid.x - vertex.x) / r, y: (mid.y - vertex.y) / r };
  const text = label(formatAngle(Math.abs(sweep) * 180 / Math.PI, options), { x: mid.x + outward.x * 4, y: mid.y + outward.y * 4 }, readable({ x: -outward.y, y: outward.x }), measure, color, options);
  const group = crypto.randomUUID();
  return [arm(p1, a1), arm(p2, a1 + sweep), arc, arrowHead(at(0), tangent(0, -1), color), arrowHead(at(1), tangent(1, 1), color), text].map(o => ({ ...o, groupPath: [group] }));
}
/** Legenda de 3 pontos: linha de chamada (ponta, cotovelo, fim) e o texto ao lado do fim. */
export function calloutObjects(tip: Point, elbow: Point, end: Point, text: string, measure: Measure, color = '#000000', options: DimensionOptions = {}): VectorObject[] {
  const line = { ...createPathObject([tip, elbow, end], false, color, 'Linha da legenda'), strokeWidth: 1 };
  const dot = { ...createPathObject([{ x: tip.x - 2, y: tip.y }, { x: tip.x, y: tip.y - 2 }, { x: tip.x + 2, y: tip.y }, { x: tip.x, y: tip.y + 2 }], true, 'none', 'Ponta'), fill: color, strokeWidth: 0 };
  const right = end.x >= elbow.x, t = updateText(createText(0, 0, color, { ...defaultTextStyle, fontSize: options.fontSize ?? 10, textAlign: right ? 'left' : 'right' }, measure), { text }, measure);
  const box = { ...t, name: 'Legenda', x: right ? end.x + 3 : end.x - 3 - t.width, y: end.y - t.height / 2 };
  const group = crypto.randomUUID();
  return [line, dot, box].map(o => ({ ...o, groupPath: [group] }));
}
/** Segmento (reta ou curva) da borda mais próxima do ponto: extremos do trecho entre dois nós. */
export function nearestSegment(objects: VectorObject[], p: Point, radius: number): [Point, Point] | null {
  let best: [Point, Point] | null = null, distance = radius;
  for (const o of objects) {
    if (o.type !== 'path' && o.type !== 'rectangle' && o.type !== 'ellipse') continue;
    let start: Point | null = null, last: Point | null = null;
    for (const c of worldCommands(o)) {
      if (c.type === 'M') { start = last = { x: c.x, y: c.y }; continue; }
      if (!last) continue;
      const end = c.type === 'Z' ? start! : { x: c.x, y: c.y };
      const samples = c.type === 'C' ? Array.from({ length: 17 }, (_, i) => { const t = i / 16, u = 1 - t; return { x: u * u * u * last!.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, y: u * u * u * last!.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y }; }) : [last, end];
      for (let i = 1; i < samples.length; i++) { const q = nearestEdge([[samples[i - 1], samples[i]]], p, distance); if (q) { distance = Math.hypot(q.x - p.x, q.y - p.y); best = [last, end]; } }
      last = end;
    }
  }
  return best && Math.hypot(best[1].x - best[0].x, best[1].y - best[0].y) > 1e-6 ? best : null;
}
/**
 * Dimensão paralela (CorelDRAW): linhas de extensão, linha de cota com setas e o texto da medida,
 * alinhado à linha e sempre legível. Tudo agrupado; tamanhos fixos em px do documento.
 */
export function dimensionObjects(a: Point, b: Point, offset: number, unit: DocumentUnit, measure: Measure, color = '#000000', options: DimensionOptions & { axis?: Point } = {}): VectorObject[] {
  const { u, n, a2, b2, length, mid } = dimensionLines(a, b, offset, options.axis);
  const gap = 3, over = 6, arrow = 11, wing = 3.5, width = 1;
  const ext = (p: Point, q: Point) => { const side = Math.sign((q.x - p.x) * n.x + (q.y - p.y) * n.y) || 1; return createPathObject([{ x: p.x + n.x * gap * side, y: p.y + n.y * gap * side }, { x: q.x + n.x * over * side, y: q.y + n.y * over * side }], false, color, 'Linha de extensão'); };
  const head = (tip: Point, dir: number) => ({ ...createPathObject([tip, { x: tip.x - u.x * arrow * dir + n.x * wing, y: tip.y - u.y * arrow * dir + n.y * wing }, { x: tip.x - u.x * arrow * dir - n.x * wing, y: tip.y - u.y * arrow * dir - n.y * wing }], true, 'none', 'Seta'), fill: color, strokeWidth: 0 });
  const line = createPathObject([a2, b2], false, color, 'Linha de cota');
  const far = (p: Point, q: Point) => Math.hypot(q.x - p.x, q.y - p.y) > gap;
  const objects: VectorObject[] = [...(far(a, a2) ? [ext(a, a2)] : []), ...(far(b, b2) ? [ext(b, b2)] : []), line, head(a2, -1), head(b2, 1)].map(o => o.fill === color ? o : { ...o, strokeWidth: width });
  // Texto: centrado acima da linha de cota, girado com ela e nunca de cabeça para baixo.
  let angle = Math.atan2(u.y, u.x) * 180 / Math.PI;
  if (angle > 90) angle -= 180; else if (angle <= -90) angle += 180;
  const text = updateText(createText(0, 0, color, { ...defaultTextStyle, fontSize: options.fontSize ?? 10, textAlign: 'center' }, measure), { text: formatMeasure(length, unit, options) }, measure), up = 3;
  // Caixa local centrada no meio da cota, acima da linha (−y local); a rotação leva o "acima" junto com a cota.
  const box = { ...text, name: 'Medida', x: mid.x - text.width / 2, y: mid.y - text.height - up };
  const group = crypto.randomUUID();
  return [...objects, Math.abs(angle) < 1e-9 ? box : { ...box, transform: around(mid, rotation(angle)) }].map(o => ({ ...o, groupPath: [group] }));
}
/** Pontos de encaixe: nós dos caminhos e cantos/centro das caixas dos objetos (coordenadas do documento). */
export function snapPoints(objects: VectorObject[]): Point[] {
  const points: Point[] = [];
  for (const o of objects) {
    if (points.length > 50000) break;
    if (o.type === 'path' || o.type === 'rectangle' || o.type === 'ellipse') for (const c of worldCommands(o)) if (c.type !== 'Z') points.push({ x: c.x, y: c.y });
    const corners = objectCorners(o);
    points.push(...corners, { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 });
  }
  return points;
}
export function nearestSnap(points: Point[], p: Point, radius: number): Point | null {
  let best: Point | null = null, distance = radius;
  for (const q of points) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d <= distance) { distance = d; best = q; } }
  return best;
}

/** Bordas dos objetos em segmentos de reta (curvas amostradas), para a cota "travar" sobre uma linha. */
export function edgeSegments(objects: VectorObject[]): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (const o of objects) {
    if (out.length > 200000) break;
    if (o.type !== 'path' && o.type !== 'rectangle' && o.type !== 'ellipse') { const c = objectCorners(o); c.forEach((p, i) => out.push([p, c[(i + 1) % 4]])); continue; }
    let start: Point | null = null, last: Point | null = null;
    for (const c of worldCommands(o)) {
      if (c.type === 'M') { start = last = { x: c.x, y: c.y }; continue; }
      if (c.type === 'Z') { if (start && last) out.push([last, start]); last = start; continue; }
      if (!last) continue;
      if (c.type === 'L') { const p = { x: c.x, y: c.y }; out.push([last, p]); last = p; continue; }
      if (c.type !== 'C') continue;
      const a = last;
      for (let i = 1; i <= 16; i++) { const t = i / 16, u = 1 - t, p = { x: u * u * u * a.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, y: u * u * u * a.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y }; out.push([last, p]); last = p; }
    }
  }
  return out;
}
/** Ponto mais próximo sobre as bordas, dentro do raio (projeção perpendicular no segmento). */
export function nearestEdge(segments: [Point, Point][], p: Point, radius: number): Point | null {
  let best: Point | null = null, distance = radius;
  for (const [a, b] of segments) {
    const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0, q = { x: a.x + dx * t, y: a.y + dy * t }, d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= distance) { distance = d; best = q; }
  }
  return best;
}
