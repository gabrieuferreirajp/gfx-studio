import { createPathObject, type PenNode, type Point } from './pathGeometry.ts';
import type { VectorObject } from '../document/model.ts';
import type { Bounds } from './objectTransforms.ts';

export interface ShapeOptions { sides: number; points: number; sharpness: number; revolutions: number; columns: number; rows: number }
export const defaultShapeOptions: ShapeOptions = { sides: 5, points: 5, sharpness: 53, revolutions: 4, columns: 4, rows: 3 };
const clampInt = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));
export function normalizeShapeOptions(o: Partial<ShapeOptions>): ShapeOptions {
  const d = defaultShapeOptions;
  return { sides: clampInt(o.sides ?? d.sides, 3, 500), points: clampInt(o.points ?? d.points, 3, 500), sharpness: clampInt(o.sharpness ?? d.sharpness, 1, 99), revolutions: clampInt(o.revolutions ?? d.revolutions, 1, 100), columns: clampInt(o.columns ?? d.columns, 1, 99), rows: clampInt(o.rows ?? d.rows, 1, 99) };
}
interface Style { fill: string; stroke: string }
const styled = (object: VectorObject, style: Style, name: string): VectorObject => ({ ...object, name, fill: style.fill, stroke: style.stroke, strokeWidth: 1 });
const onBox = (b: Bounds, u: number, v: number): Point => ({ x: b.x + b.width * (u + 1) / 2, y: b.y + b.height * (v + 1) / 2 });
/** Polígono regular inscrito na caixa, com um vértice no topo. */
export function polygonObject(b: Bounds, options: ShapeOptions, style: Style): VectorObject {
  const nodes = Array.from({ length: options.sides }, (_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / options.sides; return onBox(b, Math.cos(a), Math.sin(a)); });
  return styled(createPathObject(nodes, true, style.stroke), style, 'Polígono');
}
/** Estrela com pontas alternando raio externo e interno; nitidez 1–99 como no CorelDRAW. */
export function starObject(b: Bounds, options: ShapeOptions, style: Style): VectorObject {
  const inner = 1 - options.sharpness / 100;
  const nodes = Array.from({ length: options.points * 2 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / options.points, r = i % 2 ? inner : 1; return onBox(b, r * Math.cos(a), r * Math.sin(a)); });
  return styled(createPathObject(nodes, true, style.stroke), style, 'Estrela');
}
/** Espiral simétrica (arquimediana) suavizada com curvas Bézier. */
export function spiralObject(b: Bounds, options: ShapeOptions, style: Style): VectorObject {
  const steps = options.revolutions * 16, points: Point[] = [];
  for (let i = 0; i <= steps; i++) { const t = i / steps, a = t * options.revolutions * 2 * Math.PI; points.push(onBox(b, t * Math.cos(a), t * Math.sin(a))); }
  return { ...styled(createPathObject(smoothNodes(points), false, style.stroke), style, 'Espiral'), fill: 'none' };
}
/** Papel milimetrado: retângulos agrupados em colunas e linhas. */
export function graphPaperObjects(b: Bounds, options: ShapeOptions, style: Style, groupId: string): VectorObject[] {
  const w = b.width / options.columns, h = b.height / options.rows, objects: VectorObject[] = [];
  for (let r = 0; r < options.rows; r++) for (let c = 0; c < options.columns; c++) objects.push({ id: crypto.randomUUID(), type: 'rectangle', name: 'Retângulo', x: b.x + c * w, y: b.y + r * h, width: Math.max(1, w), height: Math.max(1, h), fill: style.fill, stroke: style.stroke, strokeWidth: 1, groupPath: [groupId] });
  return objects;
}
/** Douglas–Peucker: remove pontos a menos de `tolerance` da reta entre os vizinhos mantidos. */
export function simplifyPoints(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!, p = points[a], q = points[b], dx = q.x - p.x, dy = q.y - p.y, length = Math.hypot(dx, dy);
    let index = -1, max = tolerance;
    for (let i = a + 1; i < b; i++) { const r = points[i], d = length ? Math.abs(dy * r.x - dx * r.y + q.x * p.y - q.y * p.x) / length : Math.hypot(r.x - p.x, r.y - p.y); if (d > max) { max = d; index = i; } }
    if (index >= 0) { keep[index] = 1; stack.push([a, index], [index, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
/** Alças Catmull–Rom: curvas suaves que passam por todos os pontos. */
export function smoothNodes(points: Point[], closed = false): PenNode[] {
  return points.map((p, i) => {
    const prev = points[i - 1] ?? (closed ? points.at(-1)! : p), next = points[i + 1] ?? (closed ? points[0] : p);
    const tx = (next.x - prev.x) / 6, ty = (next.y - prev.y) / 6;
    return { x: p.x, y: p.y, incoming: { x: p.x - tx, y: p.y - ty }, outgoing: { x: p.x + tx, y: p.y + ty } };
  });
}
export function freehandObject(points: Point[], zoom: number, stroke: string): VectorObject | null {
  const simplified = simplifyPoints(points, 1.5 / zoom);
  if (simplified.length < 2 || Math.hypot(simplified.at(-1)!.x - simplified[0].x, simplified.at(-1)!.y - simplified[0].y) + simplified.length < 3) return null;
  const closed = simplified.length > 3 && Math.hypot(simplified.at(-1)!.x - simplified[0].x, simplified.at(-1)!.y - simplified[0].y) * zoom < 8;
  const nodes = smoothNodes(closed ? simplified.slice(0, -1) : simplified, closed);
  return { ...createPathObject(nodes.slice(0, 9998), closed, stroke, 'Curva'), strokeWidth: 1 };
}
