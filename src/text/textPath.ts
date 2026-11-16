import type { PathCommand } from '../document/model.ts';
import type { Point } from '../geometry/pathGeometry.ts';

/** Polilinha do caminho (curvas amostradas) com comprimentos acumulados, para posicionar letras ao longo dele. */
export interface Polyline { points: Point[]; lengths: number[]; total: number; closed?: boolean }
export function polylineOf(commands: PathCommand[]): Polyline {
  const points: Point[] = []; let start: Point | null = null, current: Point | null = null, closed = false;
  for (const c of commands) {
    if (c.type === 'M') { if (points.length) break; start = current = { x: c.x, y: c.y }; points.push(current); }
    else if (c.type === 'L' && current) { current = { x: c.x, y: c.y }; points.push(current); }
    else if (c.type === 'C' && current) {
      const p0 = current, steps = 24;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        points.push({ x: u * u * u * p0.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, y: u * u * u * p0.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y });
      }
      current = { x: c.x, y: c.y };
    } else if (c.type === 'Z' && start && current) { if (current.x !== start.x || current.y !== start.y) points.push(start); closed = true; break; }
  }
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  return { points, lengths, total: lengths.at(-1) ?? 0, ...(closed ? { closed } : {}) };
}
export const reversePolyline = (p: Polyline): Polyline => ({ ...polylineOf(p.points.slice().reverse().map((q, i) => ({ type: i ? 'L' : 'M', ...q }) as PathCommand)), ...(p.closed ? { closed: true } : {}) });
/** Ponto e ângulo (radianos) a uma distância `s` do início; fora do caminho, prolonga a primeira/última direção. */
export function pointAt(p: Polyline, s: number): { point: Point; angle: number } {
  const n = p.points.length;
  // Caminho fechado: o texto dá a volta (continua do início).
  if (p.closed && p.total > 0) s = ((s % p.total) + p.total) % p.total;
  if (n < 2) return { point: p.points[0] ?? { x: 0, y: 0 }, angle: 0 };
  let i = 1;
  while (i < n - 1 && p.lengths[i] < s) i++;
  // Segmentos de comprimento zero não definem direção: procura o vizinho.
  let a = i - 1; while (a > 0 && p.lengths[i] - p.lengths[a] < 1e-9) a--;
  const from = p.points[a], to = p.points[i], len = p.lengths[i] - p.lengths[a] || 1, t = (s - p.lengths[a]) / len;
  return { point: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, angle: Math.atan2(to.y - from.y, to.x - from.x) };
}
export interface PathGlyph { char: string; x: number; y: number; angle: number; width: number }
/**
 * Letras ao longo do caminho (Ajustar texto ao caminho do CorelDRAW): cada letra fica centrada no ponto do caminho
 * na metade da sua largura, girada pela tangente; `distance` afasta a linha de base do caminho.
 */
export function placeGlyphs(path: Polyline, advances: { char: string; width: number }[], start: number, distance: number, upright = false): PathGlyph[] {
  let s = start;
  return advances.map(({ char, width }) => {
    const { point, angle: tangent } = pointAt(path, s + width / 2);
    // Letras em pé (orientação do CorelDRAW): a letra só acompanha a posição, sem girar.
    if (upright) { const up = { x: Math.sin(tangent), y: -Math.cos(tangent) }; s += width; return { char, width, x: point.x - width / 2 + up.x * distance, y: point.y + up.y * distance, angle: 0 }; }
    const angle = tangent;
    // "Para cima" da letra (eixo y do documento para baixo): (sen θ, −cos θ).
    const up = { x: Math.sin(angle), y: -Math.cos(angle) };
    const glyph = { char, width, x: point.x - Math.cos(angle) * width / 2 + up.x * distance, y: point.y - Math.sin(angle) * width / 2 + up.y * distance, angle: angle * 180 / Math.PI };
    s += width; return glyph;
  });
}
/** Ponto do caminho mais próximo de `q`: distância ao longo do caminho (`s`) e afastamento. */
export function nearestOnPath(p: Polyline, q: Point): { s: number; distance: number; point: Point } {
  let best = { s: 0, distance: Infinity, point: p.points[0] ?? q };
  for (let i = 1; i < p.points.length; i++) {
    const a = p.points[i - 1], b = p.points[i], dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l)) : 0, x = a.x + dx * t, y = a.y + dy * t, d = Math.hypot(x - q.x, y - q.y);
    if (d < best.distance) best = { s: p.lengths[i - 1] + Math.sqrt(l) * t, distance: d, point: { x, y } };
  }
  return best;
}
/** Distância (ao longo do caminho) do ponto mais alto: onde o CorelDRAW centraliza o texto em caminhos fechados. */
export function topDistance(p: Polyline): number {
  let best = 0;
  p.points.forEach((q, i) => { if (q.y < p.points[best].y - 1e-9) best = i; });
  return p.lengths[best] ?? 0;
}
