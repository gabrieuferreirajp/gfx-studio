import type { PathCommand, VectorObject } from '../document/model.ts';
import type { Point } from './pathGeometry.ts';
import type { Bounds } from './objectTransforms.ts';
import { normalizeCommands } from './compoundPaths.ts';
import { worldCommands } from './worldGeometry.ts';
import { flatten } from '../io/exporters.ts';

/**
 * Envelope (CorelDRAW): 8 alças sobre a caixa — cantos (0 sup. esq., 2 sup. dir., 4 inf. dir., 6 inf. esq.)
 * e meios dos lados (1 cima, 3 direita, 5 baixo, 7 esquerda). Cada lado é uma curva que passa pela alça do meio.
 */
export type EnvelopeHandles = [Point, Point, Point, Point, Point, Point, Point, Point];
export type Quad = [Point, Point, Point, Point];
export type PointMap = (u: number, v: number) => Point;

export function boxHandles(b: Bounds): EnvelopeHandles {
  const { x, y, width: w, height: h } = b;
  return [{ x, y }, { x: x + w / 2, y }, { x: x + w, y }, { x: x + w, y: y + h / 2 }, { x: x + w, y: y + h }, { x: x + w / 2, y: y + h }, { x, y: y + h }, { x, y: y + h / 2 }];
}
export const boxQuad = (b: Bounds): Quad => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }];
/** Curva quadrática de a até b que passa por m em t = ½. */
function edge(a: Point, m: Point, b: Point, t: number): Point {
  const c = { x: 2 * m.x - (a.x + b.x) / 2, y: 2 * m.y - (a.y + b.y) / 2 }, u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}
/** Retalho de Coons: interpola os quatro lados curvos (u na horizontal, v na vertical, 0–1). */
export function envelopeMap(h: EnvelopeHandles): PointMap {
  const [p00, top, p10, right, p11, bottom, p01, left] = h;
  return (u, v) => {
    const T = edge(p00, top, p10, u), B = edge(p01, bottom, p11, u), L = edge(p00, left, p01, v), R = edge(p10, right, p11, v);
    const bx = (1 - u) * (1 - v) * p00.x + u * (1 - v) * p10.x + (1 - u) * v * p01.x + u * v * p11.x;
    const by = (1 - u) * (1 - v) * p00.y + u * (1 - v) * p10.y + (1 - u) * v * p01.y + u * v * p11.y;
    return { x: (1 - v) * T.x + v * B.x + (1 - u) * L.x + u * R.x - bx, y: (1 - v) * T.y + v * B.y + (1 - u) * L.y + u * R.y - by };
  };
}
/** Perspectiva: homografia do quadrado unitário para o quadrilátero (sup. esq., sup. dir., inf. dir., inf. esq.). */
export function perspectiveMap(q: Quad): PointMap {
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, det = dx1 * dy2 - dx2 * dy1 || 1e-12;
    g = (sx * dy2 - dx2 * sy) / det; h = (dx1 * sy - sx * dy1) / det;
  }
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x, d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y;
  return (u, v) => { const w = g * u + h * v + 1 || 1e-12; return { x: (a * u + b * v + p0.x) / w, y: (d * u + e * v + p0.y) / w }; };
}
/** Quadrilátero convexo e sem cruzamentos (perspectiva válida). */
export function validQuad(q: Quad): boolean {
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  const signs = q.map((p, i) => Math.sign(cross(p, q[(i + 1) % 4], q[(i + 2) % 4])));
  return signs.every(s => s !== 0 && s === signs[0]);
}
export type Cubic = [Point, Point, Point, Point];
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export function split(c: Cubic, t: number): [Cubic, Cubic] {
  const ab = lerp(c[0], c[1], t), bc = lerp(c[1], c[2], t), cd = lerp(c[2], c[3], t), abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), m = lerp(abc, bcd, t);
  return [[c[0], ab, abc, m], [m, bcd, cd, c[3]]];
}
/** Segmento reto: alças sobre a reta entre os nós. */
function straight(s: Cubic): boolean {
  const dx = s[3].x - s[0].x, dy = s[3].y - s[0].y, len = Math.hypot(dx, dy) || 1;
  return [s[1], s[2]].every(p => Math.abs((p.x - s[0].x) * dy - (p.y - s[0].y) * dx) / len < 1e-6 * Math.max(1, len));
}
/** Segmentos do caminho como cúbicas (retas viram cúbicas com alças a ⅓ e ⅔), por contorno. */
export function cubics(commands: PathCommand[]): { segments: Cubic[]; closed: boolean }[] {
  const out: { segments: Cubic[]; closed: boolean }[] = [];
  let current: { segments: Cubic[]; closed: boolean } | null = null, start: Point | null = null, last: Point | null = null;
  for (const c of commands) {
    if (c.type === 'M') { current = { segments: [], closed: false }; out.push(current); start = last = { x: c.x, y: c.y }; continue; }
    if (!current || !last || !start) continue;
    if (c.type === 'Z') { if (Math.hypot(last.x - start.x, last.y - start.y) > 1e-9) current.segments.push([last, lerp(last, start, 1 / 3), lerp(last, start, 2 / 3), start]); current.closed = true; last = start; continue; }
    const p = { x: c.x, y: c.y };
    current.segments.push(c.type === 'C' ? [last, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, p] : [last, lerp(last, p, 1 / 3), lerp(last, p, 2 / 3), p]);
    last = p;
  }
  return out.filter(c => c.segments.length);
}
function toCommands(contours: { segments: Cubic[]; closed: boolean }[]): PathCommand[] {
  const out: PathCommand[] = [];
  for (const c of contours) {
    out.push({ type: 'M', x: c.segments[0][0].x, y: c.segments[0][0].y });
    for (const s of c.segments) out.push({ type: 'C', x1: s[1].x, y1: s[1].y, x2: s[2].x, y2: s[2].y, x: s[3].x, y: s[3].y });
    if (c.closed) out.push({ type: 'Z' });
  }
  return out;
}
/**
 * Deforma o caminho por uma função de pontos (envelope, perspectiva, torcer): cada segmento é subdividido
 * em `pieces` partes e os nós e alças das partes são levados pela função — fiel para deformações suaves.
 */
export function mapPath(commands: PathCommand[], box: Bounds, map: PointMap, pieces = 6, keepLines = false): PathCommand[] {
  const w = box.width || 1, h = box.height || 1, f = (p: Point) => map((p.x - box.x) / w, (p.y - box.y) / h);
  return toCommands(cubics(commands).map(c => ({ closed: c.closed, segments: c.segments.flatMap(s => {
    // Manter linhas (CorelDRAW): segmentos retos continuam retos; só os nós acompanham o envelope.
    if (keepLines && straight(s)) { const a = f(s[0]), b = f(s[3]); return [[a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b] as Cubic]; }
    const parts: Cubic[] = []; let rest = s;
    for (let i = pieces; i > 1; i--) { const [a, b] = split(rest, 1 / i); parts.push(a); rest = b; }
    parts.push(rest);
    return parts.map(p => p.map(f) as Cubic);
  }) })));
}
export type DistortKind = 'pushPull' | 'zipper' | 'twister';
export interface DistortParams { kind: DistortKind; amplitude: number; frequency?: number; smooth?: boolean; angle?: number }
export const distortLabels: Record<DistortKind, string> = { pushPull: 'Empurrar e puxar', zipper: 'Zíper', twister: 'Torcer' };
/**
 * Distorção (CorelDRAW), em torno do centro da caixa:
 * - Empurrar e puxar: amplitude −200…200 %; positiva empurra (nós para o centro, segmentos para fora), negativa puxa.
 * - Zíper: dentes de `amplitude` px, `frequency` por segmento; `smooth` arredonda.
 * - Torcer: gira cada ponto proporcionalmente à distância do centro, até `angle` graus na borda.
 */
export function distortPath(commands: PathCommand[], box: Bounds, p: DistortParams): PathCommand[] {
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (p.kind === 'twister') {
    const radius = Math.hypot(box.width, box.height) / 2 || 1, total = (p.angle ?? 0) * Math.PI / 180;
    return mapPath(commands, box, (u, v) => {
      const q = { x: box.x + u * box.width - c.x, y: box.y + v * box.height - c.y }, a = total * Math.min(1, Math.hypot(q.x, q.y) / radius);
      return { x: c.x + q.x * Math.cos(a) - q.y * Math.sin(a), y: c.y + q.x * Math.sin(a) + q.y * Math.cos(a) };
    }, 8);
  }
  if (p.kind === 'pushPull') {
    const k = Math.max(-2, Math.min(2, p.amplitude / 100));
    return toCommands(cubics(commands).map(contour => ({ closed: contour.closed, segments: contour.segments.map(s => [
      { x: s[0].x + (c.x - s[0].x) * k, y: s[0].y + (c.y - s[0].y) * k },
      { x: s[1].x - (c.x - s[1].x) * k, y: s[1].y - (c.y - s[1].y) * k },
      { x: s[2].x - (c.x - s[2].x) * k, y: s[2].y - (c.y - s[2].y) * k },
      { x: s[3].x + (c.x - s[3].x) * k, y: s[3].y + (c.y - s[3].y) * k }] as Cubic) })));
  }
  // Zíper: amostra cada contorno e alterna o deslocamento pela normal.
  const teeth = Math.max(1, Math.min(100, Math.round(p.frequency ?? 6))), out: PathCommand[] = [];
  for (const contour of cubics(commands)) {
    const points: Point[] = [];
    contour.segments.forEach((s, i) => { const n = teeth * 2; for (let k = i === 0 ? 0 : 1; k <= n; k++) points.push(bezier(s, k / n)); });
    if (contour.closed) points.pop();
    const moved = points.map((q, i) => {
      if (!contour.closed && (i === 0 || i === points.length - 1)) return q;
      const prev = points[(i - 1 + points.length) % points.length], next = points[(i + 1) % points.length], dx = next.x - prev.x, dy = next.y - prev.y, len = Math.hypot(dx, dy) || 1, sign = i % 2 ? 1 : -1;
      return { x: q.x - dy / len * p.amplitude * sign, y: q.y + dx / len * p.amplitude * sign };
    });
    if (p.smooth) {
      // Arredondado: curvas suaves (Catmull-Rom) passando pelos dentes.
      const at = (i: number) => moved[contour.closed ? (i + moved.length) % moved.length : Math.max(0, Math.min(moved.length - 1, i))];
      out.push({ type: 'M', ...moved[0] });
      const count = contour.closed ? moved.length : moved.length - 1;
      for (let i = 0; i < count; i++) { const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2); out.push({ type: 'C', x1: p1.x + (p2.x - p0.x) / 6, y1: p1.y + (p2.y - p0.y) / 6, x2: p2.x - (p3.x - p1.x) / 6, y2: p2.y - (p3.y - p1.y) / 6, x: p2.x, y: p2.y }); }
    } else { out.push({ type: 'M', ...moved[0] }); for (const q of moved.slice(1)) out.push({ type: 'L', ...q }); }
    if (contour.closed) out.push({ type: 'Z' });
  }
  return out;
}
export function bezier(s: Cubic, t: number): Point {
  const u = 1 - t;
  return { x: u * u * u * s[0].x + 3 * u * u * t * s[1].x + 3 * u * t * t * s[2].x + t * t * t * s[3].x, y: u * u * u * s[0].y + 3 * u * u * t * s[1].y + 3 * u * t * t * s[2].y + t * t * t * s[3].y };
}
/** Predefinições de envelope (em frações da caixa: deslocamento de cada alça). */
export const envelopePresets = {
  arcUp: { label: 'Arco para cima', move: (b: Bounds, h: EnvelopeHandles) => { h[1].y -= b.height * 0.3; h[5].y -= b.height * 0.3; } },
  arcDown: { label: 'Arco para baixo', move: (b: Bounds, h: EnvelopeHandles) => { h[1].y += b.height * 0.3; h[5].y += b.height * 0.3; } },
  bulge: { label: 'Inchar', move: (b: Bounds, h: EnvelopeHandles) => { h[1].y -= b.height * 0.25; h[5].y += b.height * 0.25; h[3].x += b.width * 0.15; h[7].x -= b.width * 0.15; } },
  pinch: { label: 'Comprimir', move: (b: Bounds, h: EnvelopeHandles) => { h[1].y += b.height * 0.25; h[5].y -= b.height * 0.25; h[3].x -= b.width * 0.1; h[7].x += b.width * 0.1; } },
  flag: { label: 'Bandeira', move: (b: Bounds, h: EnvelopeHandles) => { h[1].y -= b.height * 0.2; h[5].y -= b.height * 0.2; h[2].y += b.height * 0.1; h[4].y += b.height * 0.1; h[3].y += b.height * 0.1; } },
  wedge: { label: 'Cunha', move: (b: Bounds, h: EnvelopeHandles) => { h[2].y += b.height * 0.25; h[4].y -= b.height * 0.25; h[1].y += b.height * 0.125; h[5].y -= b.height * 0.125; } },
} as const;
export type EnvelopePreset = keyof typeof envelopePresets;
export function presetHandles(b: Bounds, preset: EnvelopePreset): EnvelopeHandles {
  const h = boxHandles(b); envelopePresets[preset].move(b, h); return h;
}
/** Objetos aceitos por envelope, perspectiva e distorção (textos e bitmaps precisam de Ctrl+Q antes). */
export const canDeform = (o: VectorObject) => o.type === 'rectangle' || o.type === 'ellipse' || o.type === 'path';
export function deformError(objects: VectorObject[], ids: string[]): string | null {
  const selected = objects.filter(o => ids.includes(o.id) && !o.locked);
  if (!selected.length) return 'Selecione um objeto.';
  if (!selected.some(canDeform)) return 'Selecione retângulos, elipses ou curvas. Converta textos em curvas (Ctrl+Q) antes.';
  return null;
}
/**
 * Substitui a geometria do objeto por comandos em coordenadas do documento (sem matriz), mantendo ID, cores,
 * caneta, grupo, PowerClip, camada e efeitos. Retângulos e elipses viram curvas.
 */
export function withWorldGeometry(o: VectorObject, world: PathCommand[]): VectorObject {
  if (world.length > 10000) throw new Error(`"${o.name}" passaria de 10.000 comandos; simplifique a curva.`);
  const g = normalizeCommands(world);
  const { transform: _t, cornerRadius: _r, cornerRadii: _rr, cornerType: _ct, nodeModes: _n, ...rest } = o;
  return { ...rest, type: 'path', name: o.type === 'path' ? o.name : 'Curva', x: g.x, y: g.y, width: g.width, height: g.height, pathSize: g.pathSize, commands: g.commands };
}
/** Aplica a deformação aos objetos (caixa comum da seleção); devolve a lista completa. */
export function deformObjects(objects: VectorObject[], ids: string[], sources: Map<string, PathCommand[]>, box: Bounds, deform: (commands: PathCommand[], box: Bounds) => PathCommand[]): VectorObject[] {
  return objects.map(o => { const source = sources.get(o.id); return ids.includes(o.id) && source ? withWorldGeometry(o, deform(source, box)) : o; });
}
/** Geometria de origem (documento) dos objetos deformáveis e a caixa que os envolve. */
export function deformSources(objects: VectorObject[], ids: string[]): { sources: Map<string, PathCommand[]>; box: Bounds } | null {
  const sources = new Map<string, PathCommand[]>();
  for (const o of objects) if (ids.includes(o.id) && canDeform(o) && !o.locked) sources.set(o.id, worldCommands(o));
  if (!sources.size) return null;
  const points = [...sources.values()].flatMap(c => flatten(c).flatMap(x => x.points));
  const xs = points.map(p => p.x), ys = points.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys);
  return { sources, box: { x, y, width: Math.max(1e-6, Math.max(...xs) - x), height: Math.max(1e-6, Math.max(...ys) - y) } };
}
