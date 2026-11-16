import type { EnvelopeMapping, EnvelopeMode, EnvelopeNode, PathCommand, VectorObject } from '../document/model.ts';
import type { Point } from './pathGeometry.ts';
import { mapCommands } from './pathGeometry.ts';
import type { Bounds, Matrix } from './objectTransforms.ts';
import { matrixOf, multiply, transformPoint } from './objectTransforms.ts';
import { bezier, cubics, mapPath, presetHandles, split, type Cubic, type EnvelopePreset, type PointMap } from './deform.ts';

/**
 * Envelope do CorelDRAW: contorno fechado de nós (no sentido horário, a partir do canto superior esquerdo) com
 * quatro cantos. Cada lado (cima, direita, baixo, esquerda) é o trecho entre dois cantos; o objeto é mapeado da
 * sua caixa original para a área delimitada pelos lados.
 */
export interface EnvelopeShape { nodes: EnvelopeNode[]; corners: [number, number, number, number] }
export const envelopeModes: [EnvelopeMode, string][] = [['line', 'Modo reta'], ['arc', 'Modo arco simples'], ['doubleArc', 'Modo arco duplo'], ['free', 'Modo sem restrições']];
export const envelopeMappings: [EnvelopeMapping, string][] = [['horizontal', 'Horizontal'], ['original', 'Original'], ['putty', 'Massa'], ['vertical', 'Vertical']];

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const add = (a: Point, b: Point, k = 1): Point => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const pt = (p: Point): Point => ({ x: p.x, y: p.y });
const clone = (s: EnvelopeShape): EnvelopeShape => ({ corners: [...s.corners], nodes: s.nodes.map(n => ({ ...n, ...(n.c1 ? { c1: pt(n.c1) } : {}), ...(n.c2 ? { c2: pt(n.c2) } : {}) })) });

/** Envelope inicial: a caixa, com nós nos cantos e nos meios dos lados. */
export function rectEnvelope(b: Bounds): EnvelopeShape {
  const { x, y, width: w, height: h } = b;
  const p: [number, number][] = [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2], [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]];
  return { nodes: p.map(([px, py], i) => ({ x: px, y: py, t: i % 2 ? 0.5 : 0 })), corners: [0, 2, 4, 6] };
}
/** Índices dos nós do lado `k` no sentido horário (de um canto ao seguinte). */
export function sideIndices(s: EnvelopeShape, k: number): number[] {
  const n = s.nodes.length, out = [s.corners[k]];
  for (let i = s.corners[k]; i !== s.corners[(k + 1) % 4];) { i = (i + 1) % n; out.push(i); }
  return out;
}
/** Lado de cada nó (cantos ficam no lado que começa neles). */
export function sideOf(s: EnvelopeShape, i: number): number {
  for (let k = 0; k < 4; k++) if (sideIndices(s, k).slice(0, -1).includes(i)) return k;
  return 0;
}
/** Posição original (0–1) do nó ao longo do lado `k`, no sentido canônico (cima/baixo: esquerda→direita; lados: cima→baixo). */
function nodeT(s: EnvelopeShape, i: number, k: number): number {
  const reversed = k >= 2;
  if (i === s.corners[k]) return reversed ? 1 : 0;
  if (i === s.corners[(k + 1) % 4]) return reversed ? 0 : 1;
  return s.nodes[i].t;
}
/** Segmento que sai do nó `i` (cúbica; sem alças = reta). */
export function segment(s: EnvelopeShape, i: number): Cubic {
  const a = s.nodes[i], b = s.nodes[(i + 1) % s.nodes.length];
  return [pt(a), a.c1 ? pt(a.c1) : lerp(a, b, 1 / 3), a.c2 ? pt(a.c2) : lerp(a, b, 2 / 3), pt(b)];
}
/** Lado como função do parâmetro canônico (0–1). Original: nós nas posições originais; Massa: por comprimento. */
function sideCurve(s: EnvelopeShape, k: number, mapping: EnvelopeMapping): (t: number) => Point {
  const idx = sideIndices(s, k);
  let segs = idx.slice(0, -1).map(i => segment(s, i)), ts = idx.map(i => nodeT(s, i, k));
  if (k >= 2) { segs = segs.reverse().map(c => [c[3], c[2], c[1], c[0]] as Cubic); ts = ts.reverse(); }
  if (mapping !== 'putty') return t => {
    let j = 0; while (j < segs.length - 1 && t > ts[j + 1]) j++;
    const span = ts[j + 1] - ts[j];
    return bezier(segs[j], span > 1e-9 ? Math.min(1, Math.max(0, (t - ts[j]) / span)) : 0);
  };
  const samples: Point[] = [], length: number[] = [];
  segs.forEach((c, j) => { for (let q = j ? 1 : 0; q <= 32; q++) samples.push(bezier(c, q / 32)); });
  samples.forEach((p, q) => length.push(q ? length[q - 1] + Math.hypot(p.x - samples[q - 1].x, p.y - samples[q - 1].y) : 0));
  const total = length[length.length - 1] || 1;
  return t => {
    const target = t * total; let q = 1; while (q < length.length - 1 && length[q] < target) q++;
    const span = length[q] - length[q - 1];
    return lerp(samples[q - 1], samples[q], span > 1e-12 ? Math.min(1, Math.max(0, (target - length[q - 1]) / span)) : 0);
  };
}
/**
 * Mapeamento (CorelDRAW): Original e Massa preenchem a área pelos quatro lados (retalho de Coons); Horizontal e
 * Vertical acompanham os lados esquerdo/direito (ou cima/baixo) linha a linha.
 */
export function envelopeMapping(s: EnvelopeShape, mapping: EnvelopeMapping): PointMap {
  const T = sideCurve(s, 0, mapping), R = sideCurve(s, 1, mapping), B = sideCurve(s, 2, mapping), L = sideCurve(s, 3, mapping);
  const [p00, p10, p11, p01] = s.corners.map(i => s.nodes[i]);
  const coons = (u: number, v: number) => {
    const t = T(u), b = B(u), l = L(v), r = R(v);
    const bx = (1 - u) * (1 - v) * p00.x + u * (1 - v) * p10.x + (1 - u) * v * p01.x + u * v * p11.x;
    const by = (1 - u) * (1 - v) * p00.y + u * (1 - v) * p10.y + (1 - u) * v * p01.y + u * v * p11.y;
    return { x: (1 - v) * t.x + v * b.x + (1 - u) * l.x + u * r.x - bx, y: (1 - v) * t.y + v * b.y + (1 - u) * l.y + u * r.y - by };
  };
  if (mapping === 'horizontal') return (u, v) => { const l = L(v), r = R(v); return { x: l.x + u * (r.x - l.x), y: coons(u, v).y }; };
  if (mapping === 'vertical') return (u, v) => { const t = T(u), b = B(u); return { x: coons(u, v).x, y: t.y + v * (b.y - t.y) }; };
  return coons;
}
export function applyEnvelope(source: PathCommand[], box: Bounds, s: EnvelopeShape, mapping: EnvelopeMapping, keepLines = false): PathCommand[] {
  return mapPath(source, box, envelopeMapping(s, mapping), 6, keepLines);
}
/** Cúbica de Catmull-Rom pelos pontos (lados com mais de um nó intermediário nos modos de arco). */
function smoothThrough(s: EnvelopeShape, idx: number[]) {
  const p = idx.map(i => s.nodes[i]);
  for (let j = 0; j < p.length - 1; j++) {
    const a = p[j - 1] ?? p[j], b = p[j], c = p[j + 1], d = p[j + 2] ?? c;
    s.nodes[idx[j]].c1 = add(b, sub(c, a), 1 / 6); s.nodes[idx[j]].c2 = add(c, sub(d, b), -1 / 6);
  }
}
/** Refaz os lados `sides` conforme o modo: reta, arco simples (arco pelo nó do meio) ou arco duplo (S). */
export function reshapeSides(shape: EnvelopeShape, mode: EnvelopeMode, sides: Iterable<number>): EnvelopeShape {
  if (mode === 'free') return shape;
  const s = clone(shape);
  for (const k of new Set(sides)) {
    const idx = sideIndices(s, k);
    for (const i of idx.slice(0, -1)) { delete s.nodes[i].c1; delete s.nodes[i].c2; }
    if (mode === 'line' || idx.length < 3) continue;
    if (idx.length > 3) { smoothThrough(s, idx); continue; }
    const [a, m, b] = idx.map(i => s.nodes[i]), mid = lerp(a, b, 0.5);
    if (Math.hypot(m.x - mid.x, m.y - mid.y) < 1e-9) continue;
    if (mode === 'arc') {
      // Quadrática de a até b que passa pelo nó do meio, dividida no meio e elevada a cúbicas.
      const q = { x: 2 * m.x - mid.x, y: 2 * m.y - mid.y }, q1 = lerp(a, q, 0.5), q2 = lerp(q, b, 0.5);
      s.nodes[idx[0]].c1 = lerp(a, q1, 2 / 3); s.nodes[idx[0]].c2 = lerp(m, q1, 2 / 3);
      s.nodes[idx[1]].c1 = lerp(m, q2, 2 / 3); s.nodes[idx[1]].c2 = lerp(b, q2, 2 / 3);
    } else {
      // Arco duplo: cada metade curva para um lado (forma de S) e a curva passa pelo nó.
      const off = { x: (m.x - mid.x) * 0.5, y: (m.y - mid.y) * 0.5 };
      s.nodes[idx[0]].c1 = add(lerp(a, m, 1 / 3), off); s.nodes[idx[0]].c2 = add(lerp(a, m, 2 / 3), off);
      s.nodes[idx[1]].c1 = add(lerp(m, b, 1 / 3), off, -1); s.nodes[idx[1]].c2 = add(lerp(m, b, 2 / 3), off, -1);
    }
  }
  return s;
}
/** Nó correspondente no lado oposto (cima↔baixo, esquerda↔direita; cantos: cima↔baixo), pela posição original. */
export function oppositeNode(s: EnvelopeShape, i: number): { index: number; vertical: boolean } {
  const corner = s.corners.indexOf(i as never);
  const k = corner >= 0 ? (corner < 2 ? 0 : 2) : sideOf(s, i), t = nodeT(s, i, k), target = (k + 2) % 4;
  const candidates = sideIndices(s, target);
  let best = candidates[0];
  for (const j of candidates) if (Math.abs(nodeT(s, j, target) - t) < Math.abs(nodeT(s, best, target) - t)) best = j;
  return { index: best, vertical: k === 0 || k === 2 };
}
export type Opposite = 'none' | 'same' | 'mirror';
/**
 * Move nós (CorelDRAW): Ctrl leva o nó oposto no mesmo sentido; Shift, no sentido contrário (espelhado).
 * No modo sem restrições as alças acompanham o nó; nos outros modos os lados afetados são refeitos.
 */
export function moveEnvelopeNodes(origin: EnvelopeShape, indices: number[], d: Point, mode: EnvelopeMode, opposite: Opposite = 'none'): EnvelopeShape {
  const s = clone(origin), deltas = new Map<number, Point>(indices.map(i => [i, d]));
  if (opposite !== 'none') for (const i of indices) {
    const o = oppositeNode(s, i);
    if (!deltas.has(o.index) && o.index !== i) deltas.set(o.index, opposite === 'same' ? d : o.vertical ? { x: d.x, y: -d.y } : { x: -d.x, y: d.y });
  }
  const n = s.nodes.length, sides = new Set<number>();
  for (const [i, delta] of deltas) {
    const node = s.nodes[i], prev = s.nodes[(i + n - 1) % n];
    node.x += delta.x; node.y += delta.y;
    if (node.c1) node.c1 = add(node.c1, delta);
    if (prev.c2) prev.c2 = add(prev.c2, delta);
    const k = sideOf(s, i); sides.add(k);
    if (s.corners.includes(i)) sides.add((k + 3) % 4);
  }
  return reshapeSides(s, mode, sides);
}
/** Arrasta uma alça (modo sem restrições); num nó suave a alça oposta fica alinhada. */
export function moveEnvelopeHandle(origin: EnvelopeShape, seg: number, which: 'c1' | 'c2', p: Point): EnvelopeShape {
  const s = clone(origin), n = s.nodes.length, [, c1, c2] = segment(s, seg);
  s.nodes[seg].c1 = which === 'c1' ? pt(p) : c1; s.nodes[seg].c2 = which === 'c2' ? pt(p) : c2;
  const nodeIndex = which === 'c1' ? seg : (seg + 1) % n, node = s.nodes[nodeIndex];
  if (node.smooth) {
    const otherSeg = which === 'c1' ? (seg + n - 1) % n : (seg + 1) % n, key = which === 'c1' ? 'c2' : 'c1';
    const other = segment(s, otherSeg)[key === 'c1' ? 1 : 2], len = Math.hypot(other.x - node.x, other.y - node.y), dir = sub(node, p), dl = Math.hypot(dir.x, dir.y);
    if (dl > 1e-9) { const sg = segment(s, otherSeg); s.nodes[otherSeg].c1 = sg[1]; s.nodes[otherSeg].c2 = sg[2]; s.nodes[otherSeg][key] = add(node, dir, len / dl); }
  }
  return s;
}
/** Ponto do contorno do envelope mais próximo de `p`: segmento e parâmetro. */
export function nearestOnEnvelope(s: EnvelopeShape, p: Point): { seg: number; t: number; distance: number } {
  let best = { seg: 0, t: 0, distance: Infinity };
  s.nodes.forEach((_, i) => { const c = segment(s, i); for (let q = 0; q <= 60; q++) { const b = bezier(c, q / 60), d = Math.hypot(b.x - p.x, b.y - p.y); if (d < best.distance) best = { seg: i, t: q / 60, distance: d }; } });
  return best;
}
/** Adiciona um nó no segmento `seg`, no parâmetro `t` (modo sem restrições). */
export function addEnvelopeNode(origin: EnvelopeShape, seg: number, t: number): EnvelopeShape {
  const s = clone(origin), n = s.nodes.length, a = s.nodes[seg], k = sideOf(s, seg);
  const [left, right] = split(segment(s, seg), Math.min(0.95, Math.max(0.05, t)));
  const ta = nodeT(s, seg, k), tb = nodeT(s, (seg + 1) % n, k), curved = !!(a.c1 || a.c2);
  const node: EnvelopeNode = { x: left[3].x, y: left[3].y, t: ta + (tb - ta) * t, ...(curved ? { c1: right[1], c2: right[2], smooth: true } : {}) };
  if (curved) { a.c1 = left[1]; a.c2 = left[2]; }
  s.nodes.splice(seg + 1, 0, node);
  s.corners = s.corners.map(c => c > seg ? c + 1 : c) as EnvelopeShape['corners'];
  return s;
}
/** Exclui um nó que não seja canto; o segmento que fica une os vizinhos. */
export function deleteEnvelopeNode(origin: EnvelopeShape, i: number): EnvelopeShape | null {
  if (origin.corners.includes(i) || origin.nodes.length <= 4) return null;
  const s = clone(origin), n = s.nodes.length, prev = s.nodes[(i + n - 1) % n], node = s.nodes[i];
  if (prev.c1 || node.c2) { const a = segment(s, (i + n - 1) % n), b = segment(s, i); prev.c1 = a[1]; prev.c2 = b[2]; } else { delete prev.c1; delete prev.c2; }
  s.nodes.splice(i, 1);
  s.corners = s.corners.map(c => c > i ? c - 1 : c) as EnvelopeShape['corners'];
  return s;
}
/** Segmentos que saem dos nós `indices` viram retas ou curvas. */
export function setSegmentKind(origin: EnvelopeShape, indices: number[], curve: boolean): EnvelopeShape {
  const s = clone(origin);
  for (const i of indices) { const c = segment(s, i); if (curve) { s.nodes[i].c1 = c[1]; s.nodes[i].c2 = c[2]; } else { delete s.nodes[i].c1; delete s.nodes[i].c2; } }
  return s;
}
/** Nó suave (alças alinhadas) ou cúspide (alças independentes). */
export function setNodeSmooth(origin: EnvelopeShape, indices: number[], smooth: boolean): EnvelopeShape {
  let s = clone(origin);
  const n = s.nodes.length;
  for (const i of indices) {
    s.nodes[i].smooth = smooth || undefined;
    if (!smooth) continue;
    const prev = (i + n - 1) % n, inH = segment(s, prev)[2], outH = segment(s, i)[1], node = s.nodes[i];
    const dir = sub(outH, inH), dl = Math.hypot(dir.x, dir.y); if (dl < 1e-9) continue;
    const li = Math.hypot(inH.x - node.x, inH.y - node.y), lo = Math.hypot(outH.x - node.x, outH.y - node.y);
    s = setSegmentKind(s, [prev, i], true);
    s.nodes[prev].c2 = add(node, dir, -li / dl); s.nodes[i].c1 = add(node, dir, lo / dl);
  }
  return s;
}
/** Predefinições: a caixa com os nós deslocados e lados em arco. */
export function presetEnvelope(b: Bounds, preset: EnvelopePreset): EnvelopeShape {
  const s = rectEnvelope(b), h = presetHandles(b, preset);
  h.forEach((p, i) => { s.nodes[i].x = p.x; s.nodes[i].y = p.y; });
  return reshapeSides(s, 'arc', [0, 1, 2, 3]);
}
export function transformEnvelope(s: EnvelopeShape, f: (p: Point) => Point): EnvelopeShape {
  return { corners: [...s.corners], nodes: s.nodes.map(n => ({ ...n, ...f(n), ...(n.c1 ? { c1: f(n.c1) } : {}), ...(n.c2 ? { c2: f(n.c2) } : {}) })) };
}
/** Leva o envelope de uma caixa para outra (Copiar propriedades do envelope). */
export function fitEnvelope(s: EnvelopeShape, from: Bounds, to: Bounds): EnvelopeShape {
  return transformEnvelope(s, p => ({ x: to.x + (p.x - from.x) / (from.width || 1) * to.width, y: to.y + (p.y - from.y) / (from.height || 1) * to.height }));
}
/**
 * Criar envelope a partir de uma forma (CorelDRAW): o primeiro contorno vira o envelope; os cantos são os nós mais
 * próximos dos cantos da caixa da forma. A forma é ajustada à caixa do objeto.
 */
export function envelopeFromShape(commands: PathCommand[], to: Bounds): EnvelopeShape | null {
  const contour = cubics(commands)[0];
  if (!contour) return null;
  let segs = contour.segments.slice();
  const last = segs[segs.length - 1][3], first = segs[0][0];
  if (Math.hypot(last.x - first.x, last.y - first.y) > 1e-6) segs.push([last, lerp(last, first, 1 / 3), lerp(last, first, 2 / 3), first]);
  let area = 0; for (const c of segs) area += c[0].x * c[3].y - c[3].x * c[0].y;
  if (area < 0) segs = segs.reverse().map(c => [c[3], c[2], c[1], c[0]] as Cubic);
  while (segs.length < 4) { let j = 0; segs.forEach((c, q) => { if (Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y) > Math.hypot(segs[j][3].x - segs[j][0].x, segs[j][3].y - segs[j][0].y)) j = q; }); segs.splice(j, 1, ...split(segs[j], 0.5)); }
  const pts = segs.flatMap(c => [0, 0.25, 0.5, 0.75].map(t => bezier(c, t))), xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const from = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  if (from.width < 1e-6 || from.height < 1e-6) return null;
  const straight = (c: Cubic) => { const dx = c[3].x - c[0].x, dy = c[3].y - c[0].y, len = Math.hypot(dx, dy) || 1; return [c[1], c[2]].every(p => Math.abs((p.x - c[0].x) * dy - (p.y - c[0].y) * dx) / len < 1e-6 * Math.max(1, len)); };
  const n = segs.length, near = (corner: Point, range: number[]) => range.reduce((b, i) => Math.hypot(segs[i][0].x - corner.x, segs[i][0].y - corner.y) < Math.hypot(segs[b][0].x - corner.x, segs[b][0].y - corner.y) ? i : b, range[0]);
  const all = segs.map((_, i) => i), tl = near({ x: from.x, y: from.y }, all);
  segs = [...segs.slice(tl), ...segs.slice(0, tl)];
  const range = (a: number, b: number) => Array.from({ length: Math.max(1, b - a + 1) }, (_, q) => a + q);
  const tr = near({ x: from.x + from.width, y: from.y }, range(1, n - 3)), br = near({ x: from.x + from.width, y: from.y + from.height }, range(tr + 1, n - 2)), bl = near({ x: from.x, y: from.y + from.height }, range(br + 1, n - 1));
  const s: EnvelopeShape = { corners: [0, tr, br, bl], nodes: segs.map(c => ({ x: c[0].x, y: c[0].y, t: 0, ...(straight(c) ? {} : { c1: c[1], c2: c[2] }) })) };
  for (let k = 0; k < 4; k++) {
    const idx = sideIndices(s, k), lens = [0];
    for (let j = 1; j < idx.length; j++) lens.push(lens[j - 1] + Math.hypot(s.nodes[idx[j]].x - s.nodes[idx[j - 1]].x, s.nodes[idx[j]].y - s.nodes[idx[j - 1]].y));
    const total = lens[lens.length - 1] || 1;
    for (let j = 1; j < idx.length - 1; j++) s.nodes[idx[j]].t = k >= 2 ? 1 - lens[j] / total : lens[j] / total;
  }
  return fitEnvelope(s, from, to);
}
/** Assinatura dos comandos (reconhece a curva que o envelope produziu). */
export function signature(commands: PathCommand[] | undefined): string {
  if (!commands) return '';
  let a = 0, b = 0;
  for (const c of commands) if (c.type !== 'Z') for (const v of c.type === 'C' ? [c.x1, c.y1, c.x2, c.y2, c.x, c.y] : [c.x, c.y]) { a += v; b = (b * 31 + Math.round(v * 1000)) % 2147483647; }
  return `${commands.length}:${a.toFixed(4)}:${b}`;
}
/** Matriz do espaço dos comandos do caminho para o documento. */
export function commandSpace(o: VectorObject): Matrix {
  const pw = o.pathSize?.width || o.width || 1, ph = o.pathSize?.height || o.height || 1;
  return multiply(matrixOf(o), [o.width / pw, 0, 0, o.height / ph, o.x, o.y]);
}
export const mapEnvelopeCommands = (commands: PathCommand[], m: Matrix) => mapCommands(commands, p => transformPoint(m, p));
