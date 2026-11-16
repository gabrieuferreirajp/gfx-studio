import type { BitmapWarp, VectorObject } from '../document/model.ts';
import type { Point } from '../geometry/pathGeometry.ts';
import type { Bounds } from '../geometry/objectTransforms.ts';
import { envelopeMapping, sideIndices, transformEnvelope, type EnvelopeShape } from '../geometry/envelope.ts';
import { validQuad, type PointMap, type Quad } from '../geometry/deform.ts';

/**
 * Envelope em bitmap (CorelDRAW): a imagem é moldada aos nós do envelope. Os quatro cantos definem uma homografia
 * (perspectiva fiel: retas continuam retas e o encurtamento é o de uma parede vista de lado); lados curvos somam
 * uma deformação por cima, calculada no espaço já corrigido pela perspectiva. A imagem é redesenhada por uma malha
 * de triângulos; a original fica guardada em `warp.src` para continuar editando ou limpar o envelope.
 */
type M3 = [number, number, number, number, number, number, number, number, number];
const apply3 = (m: M3, p: Point): Point => { const w = m[6] * p.x + m[7] * p.y + m[8]; return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w }; };
/** Homografia do quadrado unitário para o quadrilátero (sup. esq., sup. dir., inf. dir., inf. esq.). */
export function squareToQuad(q: Point[]): M3 {
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(sx) > 1e-12 || Math.abs(sy) > 1e-12) {
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-12) throw new Error('Cantos do envelope alinhados.');
    g = (sx * dy2 - dx2 * sy) / det; h = (dx1 * sy - sx * dy1) / det;
  }
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}
function invert3(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) throw new Error('Cantos do envelope alinhados.');
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
/** (u, v) da imagem (0–1) → ponto no espaço local do bitmap, conforme o envelope. */
export function bitmapEnvelopeMap(shape: EnvelopeShape): PointMap {
  const [a, b, c, d] = shape.corners.map(i => shape.nodes[i]), q: Quad = [a, b, c, d];
  if (!validQuad(q)) return envelopeMapping(shape, 'original');
  try {
    const H = squareToQuad(q), back = invert3(H);
    // Lados no espaço corrigido: retos viram as bordas do quadrado; parâmetro por comprimento = sem distorção extra.
    const unit = transformEnvelope(shape, p => apply3(back, p));
    unit.corners.forEach((i, k) => { unit.nodes[i] = { ...unit.nodes[i], x: k === 1 || k === 2 ? 1 : 0, y: k >= 2 ? 1 : 0 }; });
    const inner = envelopeMapping(unit, 'putty');
    return (u, v) => apply3(H, inner(u, v));
  } catch { return envelopeMapping(shape, 'original'); }
}
/** Pontos da malha (grid+1)² e a caixa que eles ocupam. */
export function warpMesh(map: PointMap, grid: number): { points: Point[]; bounds: Bounds } {
  const points: Point[] = [];
  for (let j = 0; j <= grid; j++) for (let i = 0; i <= grid; i++) points.push(map(i / grid, j / grid));
  const xs = points.map(p => p.x), ys = points.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys);
  return { points, bounds: { x, y, width: Math.max(1e-6, Math.max(...xs) - x), height: Math.max(1e-6, Math.max(...ys) - y) } };
}

/** Assinatura curta do src produzido (detecta se outra ferramenta trocou a imagem). */
export function srcCheck(src: string | undefined): string {
  if (!src) return '';
  let h = 2166136261;
  const step = Math.max(1, Math.floor(src.length / 4096));
  for (let i = 0; i < src.length; i += step) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${src.length}:${(h >>> 0).toString(36)}`;
}
const norm = (p: Point, b: Bounds): Point => ({ x: (p.x - b.x) / b.width, y: (p.y - b.y) / b.height });
const denorm = (p: Point, b: Bounds): Point => ({ x: b.x + p.x * b.width, y: b.y + p.y * b.height });
const objectBox = (o: VectorObject): Bounds => ({ x: o.x, y: o.y, width: o.width || 1e-6, height: o.height || 1e-6 });
/** Envelope guardado no bitmap, com nós e caixa original relativos à caixa atual (acompanha mover e redimensionar). */
export function storeWarp(original: string, shape: EnvelopeShape, box: Bounds, at: Bounds, mode: BitmapWarp['mode'], src: string): BitmapWarp {
  const s = transformEnvelope(shape, p => norm(p, at)), b0 = norm(box, at), b1 = norm({ x: box.x + box.width, y: box.y + box.height }, at);
  return { src: original, nodes: s.nodes, corners: s.corners, box: { x: b0.x, y: b0.y, width: b1.x - b0.x, height: b1.y - b0.y }, mode, check: srcCheck(src) };
}
/** Envelope guardado e ainda válido (a imagem é a que ele produziu), no espaço local atual do objeto. */
export function restoreWarp(o: VectorObject): { original: string; shape: EnvelopeShape; box: Bounds; mode: BitmapWarp['mode'] } | null {
  const w = o.warp;
  if (o.type !== 'image' || !w || w.check !== srcCheck(o.src)) return null;
  const at = objectBox(o), b0 = denorm(w.box, at), b1 = denorm({ x: w.box.x + w.box.width, y: w.box.y + w.box.height }, at);
  return { original: w.src, shape: transformEnvelope({ nodes: w.nodes, corners: w.corners }, p => denorm(p, at)), box: { x: b0.x, y: b0.y, width: b1.x - b0.x, height: b1.y - b0.y }, mode: w.mode };
}

/**
 * Triângulo com cada lado empurrado `e` pixels para fora (interseção dos lados deslocados): os vizinhos se
 * sobrepõem e a suavização da borda não deixa fresta transparente. Pontas muito finas ficam limitadas a 4·e.
 */
function inflate(t: Point[], e: number): Point[] {
  const area = (t[1].x - t[0].x) * (t[2].y - t[0].y) - (t[2].x - t[0].x) * (t[1].y - t[0].y), sign = area > 0 ? 1 : -1;
  const lines = t.map((a, i) => {
    const b = t[(i + 1) % 3], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = dy / l * sign, ny = -dx / l * sign;
    return { p: { x: a.x + nx * e, y: a.y + ny * e }, d: { x: dx, y: dy } };
  });
  return t.map((v, i) => {
    const l1 = lines[(i + 2) % 3], l2 = lines[i], den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
    if (Math.abs(den) < 1e-12) return v;
    const s = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den, p = { x: l1.p.x + l1.d.x * s, y: l1.p.y + l1.d.y * s };
    const dx = p.x - v.x, dy = p.y - v.y, len = Math.hypot(dx, dy);
    return len > 4 * e ? { x: v.x + dx / len * 4 * e, y: v.y + dy / len * 4 * e } : p;
  });
}
/** Triângulo da imagem (s) desenhado no triângulo de destino (d), com a borda alargada para não ficar fresta. */
function triangle(ctx: CanvasRenderingContext2D, image: CanvasImageSource, iw: number, ih: number, s: Point[], d: Point[]) {
  const [s0, s1, s2] = s, [d0, d1, d2] = d;
  const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(det) < 1e-9) return;
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / det, c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / det;
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / det, dd = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / det;
  const [g0, g1, g2] = inflate([d0, d1, d2], 1);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.lineTo(g2.x, g2.y); ctx.closePath(); ctx.clip();
  ctx.setTransform(a, b, c, dd, d0.x - a * s0.x - c * s0.y, d0.y - b * s0.x - dd * s0.y);
  // Só o retângulo de origem do triângulo (mais 2 px) é desenhado: muito mais rápido que a imagem inteira.
  const x0 = Math.max(0, Math.floor(Math.min(s0.x, s1.x, s2.x)) - 2), y0 = Math.max(0, Math.floor(Math.min(s0.y, s1.y, s2.y)) - 2);
  const x1 = Math.min(iw, Math.ceil(Math.max(s0.x, s1.x, s2.x)) + 2), y1 = Math.min(ih, Math.ceil(Math.max(s0.y, s1.y, s2.y)) + 2);
  if (x1 > x0 && y1 > y0) ctx.drawImage(image, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}
/**
 * Desenha a imagem deformada. `density` = pixels por unidade do documento na imagem original; a saída é limitada a
 * `maxSide` pixels no maior lado. Retorna o canvas e a caixa (espaço local) que ele cobre.
 */
export function renderWarp(image: CanvasImageSource, iw: number, ih: number, map: PointMap, density: number, maxSide: number, grid: number): { canvas: HTMLCanvasElement; bounds: Bounds } {
  const { points, bounds } = warpMesh(map, grid);
  let k = density;
  if (bounds.width * k > maxSide || bounds.height * k > maxSide) k = maxSide / Math.max(bounds.width, bounds.height);
  // No máximo 16 megapixels (limite seguro de canvas).
  if (bounds.width * bounds.height * k * k > 16e6) k = Math.sqrt(16e6 / (bounds.width * bounds.height));
  const width = Math.max(1, Math.ceil(bounds.width * k)), height = Math.max(1, Math.ceil(bounds.height * k));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const dest = points.map(p => ({ x: (p.x - bounds.x) * k, y: (p.y - bounds.y) * k }));
  const at = (i: number, j: number) => j * (grid + 1) + i, src = (i: number, j: number) => ({ x: i / grid * iw, y: j / grid * ih });
  for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    triangle(ctx, image, iw, ih, [src(i, j), src(i + 1, j), src(i + 1, j + 1)], [dest[a], dest[b], dest[c]]);
    triangle(ctx, image, iw, ih, [src(i, j), src(i + 1, j + 1), src(i, j + 1)], [dest[a], dest[c], dest[d]]);
  }
  return { canvas, bounds: { x: bounds.x, y: bounds.y, width: width / k, height: height / k } };
}

/**
 * Modo reta no bitmap: ao mover cantos, os nós intermediários dos lados `sides` voltam para a reta entre os cantos,
 * na posição em perspectiva (o meio da parede, não o meio geométrico), como se a imagem fosse um plano.
 */
export function perspectiveSides(shape: EnvelopeShape, sides: Iterable<number>): EnvelopeShape {
  const [a, b, c, d] = shape.corners.map(i => shape.nodes[i]), q: Quad = [a, b, c, d];
  if (!validQuad(q)) return shape;
  let H: M3;
  try { H = squareToQuad(q); } catch { return shape; }
  const nodes = shape.nodes.map(n => ({ ...n }));
  const unit = (k: number, t: number): Point => k === 0 ? { x: t, y: 0 } : k === 1 ? { x: 1, y: t } : k === 2 ? { x: t, y: 1 } : { x: 0, y: t };
  for (const k of new Set(sides)) {
    const idx = sideIndices(shape, k);
    for (const i of idx.slice(1, -1)) { const p = apply3(H, unit(k, nodes[i].t)); nodes[i] = { ...nodes[i], x: p.x, y: p.y }; delete nodes[i].c1; delete nodes[i].c2; }
    for (const i of idx.slice(0, -1)) { delete nodes[i].c1; delete nodes[i].c2; }
  }
  return { nodes, corners: [...shape.corners] as EnvelopeShape['corners'] };
}
