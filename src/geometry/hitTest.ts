import type { VectorObject } from '../document/model.ts';
import type { Point } from './pathGeometry.ts';
import { worldCommands } from './worldGeometry.ts';
import { flatten } from '../io/exporters.ts';

/** Distância do ponto ao contorno e se ele está dentro da forma (regra par-ímpar sobre o contorno achatado). */
export function outlineDistance(o: VectorObject, p: Point): { distance: number; inside: boolean } {
  let distance = Infinity, inside = false;
  for (const c of flatten(worldCommands(o))) {
    const pts = c.closed ? [...c.points, c.points[0]] : c.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
      distance = Math.min(distance, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
      if (c.closed && (a.y > p.y) !== (b.y > p.y) && p.x < a.x + (p.y - a.y) * dx / dy) inside = !inside;
    }
  }
  return { distance, inside };
}

/** Formas que aceitam clique no interior (mesmo sem preenchimento): retângulo, elipse e curvas fechadas. */
const closedShape = (o: VectorObject) => o.type === 'rectangle' || o.type === 'ellipse' || (o.type === 'path' && !!o.commands?.some(c => c.type === 'Z'));
/**
 * Objeto mais acima cujo interior contém o ponto (clicar dentro de uma forma vazada seleciona, como numa foto).
 * `skip`: objetos que não podem ser escolhidos (bloqueados, ocultos, conteúdo de PowerClip).
 */
export function objectInside(objects: VectorObject[], p: Point, skip: (o: VectorObject) => boolean): VectorObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (!closedShape(o) || o.clipParent || skip(o)) continue;
    try { if (outlineDistance(o, p).inside) return o; } catch { /* geometria inválida: ignora */ }
  }
  return null;
}
