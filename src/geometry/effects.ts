import type { Shadow, VectorObject } from '../document/model.ts';
import { createPathObject, type Point } from './pathGeometry.ts';
import { worldCommands } from './worldGeometry.ts';
import { flatten } from '../io/exporters.ts';
import { smoothNodes } from './shapeFactory.ts';

export type EffectKind = 'shadow' | 'contour' | 'blend' | 'extrude' | 'blockShadow';
export interface ContourParams { direction: 'outside' | 'inside'; steps: number; offset: number; endColor: string; corners?: 'miter' | 'round' | 'bevel' }
export interface SweepParams { mode: 'shadow' | 'extrude'; dx: number; dy: number; color: string; shade: number }
export function mixColor(a: string, b: string, t: number) {
  const c = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return /^#[0-9a-f]{6}$/i.test(a) ? a : b;
  const [x, y] = [c(a), c(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, '0')).join('');
}
const shapeLike = (o: VectorObject) => o.type === 'rectangle' || o.type === 'ellipse' || o.type === 'path';
/** Mensagem de erro (ou null) para aplicar o efeito à seleção. */
export function effectSelectionError(objects: VectorObject[], ids: string[], kind: 'contour' | 'sweep' | 'blend' | 'shadow'): string | null {
  const selected = objects.filter(o => ids.includes(o.id));
  if (!selected.length) return 'Selecione um objeto.';
  if (kind === 'shadow') return null;
  if (selected.some(o => objects.some(c => c.clipParent === o.id))) return 'Extraia o conteúdo do PowerClip antes de aplicar o efeito.';
  if (kind === 'blend') {
    if (selected.length !== 2) return 'Selecione exatamente dois objetos para misturar (Shift + clique).';
    if (!selected.every(shapeLike)) return 'Misturar aceita retângulos, elipses e curvas. Converta textos em curvas (Ctrl+Q).';
    if (selected.some(o => o.groupPath?.length || o.clipParent)) return 'Desagrupe os objetos antes de misturar.';
    return null;
  }
  if (!selected.some(shapeLike)) return 'Selecione retângulos, elipses ou curvas fechadas. Converta textos em curvas (Ctrl+Q).';
  if (selected.length > 32) return 'Limite de 32 objetos por efeito.';
  return null;
}
/** Reamostra o maior contorno em `count` pontos igualmente espaçados ao longo do comprimento. */
function resample(o: VectorObject, count: number): { points: Point[]; closed: boolean } {
  const contours = flatten(worldCommands(o));
  const length = (c: { points: Point[]; closed: boolean }) => { const pts = c.closed ? [...c.points, c.points[0]] : c.points; let sum = 0; for (let i = 1; i < pts.length; i++) sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return sum; };
  const main = contours.reduce((best, c) => length(c) > length(best) ? c : best);
  const pts = main.closed ? [...main.points, main.points[0]] : main.points, cumulative = [0], out: Point[] = [];
  for (let i = 1; i < pts.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cumulative.at(-1)!, samples = main.closed ? count : count - 1;
  for (let k = 0, j = 1; k < count; k++) {
    const target = total * k / samples;
    while (j < pts.length - 1 && cumulative[j] < target) j++;
    const a = pts[j - 1], b = pts[j], seg = cumulative[j] - cumulative[j - 1], t = seg ? Math.max(0, Math.min(1, (target - cumulative[j - 1]) / seg)) : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return { points: out, closed: main.closed };
}
const area = (p: Point[]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0) / 2;
/** Misturar: etapas intermediárias de forma, cor e contorno entre dois objetos, agrupadas com eles. */
export function blendObjects(objects: VectorObject[], ids: string[], steps: number, firstId?: string): VectorObject[] {
  const error = effectSelectionError(objects, ids, 'blend'); if (error) throw new Error(error);
  const pair = objects.filter(o => ids.includes(o.id));
  const [a, b] = firstId && pair[1].id === firstId ? [pair[1], pair[0]] : pair;
  const n = 160, A = resample(a, n), B = resample(b, n), closed = A.closed && B.closed;
  let target = B.points;
  if (closed) {
    if (Math.sign(area(A.points)) !== Math.sign(area(target))) target = [...target].reverse();
    // Alinha o ponto inicial pelo menor deslocamento total entre os contornos (centralizados).
    const center = (p: Point[]) => ({ x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length });
    const ca = center(A.points), cb = center(target);
    let best = 0, bestCost = Infinity;
    for (let shift = 0; shift < n; shift += 2) { let cost = 0; for (let i = 0; i < n; i += 4) { const p = A.points[i], q = target[(i + shift) % n]; cost += (p.x - ca.x - q.x + cb.x) ** 2 + (p.y - ca.y - q.y + cb.y) ** 2; } if (cost < bestCost) { bestCost = cost; best = shift; } }
    target = target.map((_, i) => target[(i + best) % n]);
  }
  const count = Math.max(1, Math.min(200, Math.round(steps))), group = crypto.randomUUID();
  const color = (x: string | undefined, y: string | undefined, t: number) => (x ?? 'none') === 'none' && (y ?? 'none') === 'none' ? 'none' : mixColor(x && x !== 'none' ? x : y!, y && y !== 'none' ? y : x!, t);
  const middle = Array.from({ length: count }, (_, k) => {
    const t = (k + 1) / (count + 1);
    const points = A.points.map((p, i) => ({ x: p.x + (target[i].x - p.x) * t, y: p.y + (target[i].y - p.y) * t }));
    const path = createPathObject(smoothNodes(points, closed), closed, color(a.stroke, b.stroke, t), `Mistura ${k + 1}`);
    return { ...path, fill: closed ? color(a.fill, b.fill, t) : 'none', strokeWidth: (a.strokeWidth ?? 0) + ((b.strokeWidth ?? 0) - (a.strokeWidth ?? 0)) * t, groupPath: [group] } as VectorObject;
  });
  const rest = objects.filter(o => o.id !== a.id && o.id !== b.id);
  const at = Math.min(rest.length, objects.findIndex(o => o.id === (objects.indexOf(a) > objects.indexOf(b) ? a : b).id) - 1);
  return [...rest.slice(0, at), { ...a, groupPath: [group] }, ...middle, { ...b, groupPath: [group] }, ...rest.slice(at)];
}
