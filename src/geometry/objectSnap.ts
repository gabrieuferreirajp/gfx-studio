import type { VectorObject } from '../document/model.ts';
import type { Point } from './pathGeometry.ts';
import { worldCommands } from './worldGeometry.ts';
import { flatten } from '../io/exporters.ts';

/**
 * Encaixe em objetos (como "Alinhar a › Objetos" do CorelDRAW): ao arrastar, um ponto do contorno da seleção que
 * chega perto do contorno de outro objeto (ou um ponto do outro perto do contorno da seleção) é puxado até encostar
 * exatamente. Usa o contorno real (retas e curvas achatadas), não só a caixa delimitadora.
 */
export interface SnapOutline { lines: Point[][]; points: Point[]; box: { x1: number; y1: number; x2: number; y2: number } }
const MAX_POINTS = 400, MAX_LINES = 30000;

export function snapOutline(objects: VectorObject[]): SnapOutline | null {
  const lines: Point[][] = [];
  for (const o of objects) {
    if (o.type === 'text' || o.type === 'image') continue;
    try { for (const c of flatten(worldCommands(o))) if (c.points.length > 1) lines.push(c.closed ? [...c.points, c.points[0]] : c.points); } catch { /* objeto sem contorno */ }
  }
  if (!lines.length) return null;
  const all = lines.flat(), step = Math.max(1, Math.ceil(all.length / MAX_POINTS)), points = all.filter((_, i) => i % step === 0);
  const xs = all.map(p => p.x), ys = all.map(p => p.y);
  return { lines, points, box: { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) } };
}
/** Contornos dos alvos, com limite total de segmentos para o arraste continuar leve. */
export function snapTargets(units: VectorObject[][]): SnapOutline[] {
  const out: SnapOutline[] = []; let count = 0;
  for (const unit of units) { const s = snapOutline(unit); if (!s) continue; count += s.lines.reduce((n, l) => n + l.length, 0); if (count > MAX_LINES) break; out.push(s); }
  return out;
}
function closestOn(lines: Point[][], p: Point, best: { d: number; q: Point | null }) {
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
    const x = a.x + dx * t, y = a.y + dy * t, d = Math.hypot(x - p.x, y - p.y);
    if (d < best.d) { best.d = d; best.q = { x, y }; }
  }
}
const near = (box: SnapOutline['box'], dx: number, dy: number, other: SnapOutline['box'], r: number) =>
  box.x1 + dx <= other.x2 + r && box.x2 + dx >= other.x1 - r && box.y1 + dy <= other.y2 + r && box.y2 + dy >= other.y1 - r;
/** Correção (ddx, ddy) para o deslocamento (dx, dy) encostar a seleção no contorno mais próximo, dentro de `threshold`. */
export function outlineSnap(moving: SnapOutline, targets: SnapOutline[], dx: number, dy: number, threshold: number): { dx: number; dy: number; point: Point } | null {
  let result: { dx: number; dy: number; point: Point; d: number } | null = null;
  for (const target of targets) {
    if (!near(moving.box, dx, dy, target.box, threshold)) continue;
    // Pontos da seleção sobre o contorno do alvo.
    for (const m of moving.points) {
      const p = { x: m.x + dx, y: m.y + dy };
      if (p.x < target.box.x1 - threshold || p.x > target.box.x2 + threshold || p.y < target.box.y1 - threshold || p.y > target.box.y2 + threshold) continue;
      const best: { d: number; q: Point | null } = { d: Math.min(threshold, result ? result.d : Infinity), q: null };
      closestOn(target.lines, p, best);
      if (best.q) result = { dx: best.q.x - p.x, dy: best.q.y - p.y, point: best.q, d: best.d };
    }
    // Pontos do alvo sobre o contorno da seleção (ex.: canto do outro objeto tocando o lado da seleção).
    const shifted = moving.lines.map(line => line.map(p => ({ x: p.x + dx, y: p.y + dy })));
    for (const t of target.points) {
      if (t.x < moving.box.x1 + dx - threshold || t.x > moving.box.x2 + dx + threshold || t.y < moving.box.y1 + dy - threshold || t.y > moving.box.y2 + dy + threshold) continue;
      const best: { d: number; q: Point | null } = { d: Math.min(threshold, result ? result.d : Infinity), q: null };
      closestOn(shifted, t, best);
      if (best.q) result = { dx: t.x - best.q.x, dy: t.y - best.q.y, point: t, d: best.d };
    }
  }
  return result && { dx: result.dx, dy: result.dy, point: result.point };
}
