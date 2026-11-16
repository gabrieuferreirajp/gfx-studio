import type { CornerType, PathCommand } from '../document/model.ts';
import type { Point } from './pathGeometry.ts';
import { splitContours } from './compoundPaths.ts';

/**
 * Cantos do CorelDRAW (Filete, Recorte e Chanfro) aplicados aos vértices entre dois segmentos retos.
 * O recuo de cada canto é limitado à metade dos segmentos vizinhos para não sobrepor cantos adjacentes.
 * `radius` pode ser um raio por vértice (ex.: os quatro cantos de um retângulo).
 */
export function applyCorners(commands: PathCommand[], radius: number | number[], type: CornerType = 'round'): PathCommand[] {
  if (!(Array.isArray(radius) ? radius.some(r => r > 0) : radius > 0)) return commands;
  return splitContours(commands).flatMap(contour => {
    const closed = contour.at(-1)?.type === 'Z';
    const points: Point[] = [], straight: boolean[] = [];
    const curves = new Map<number, Extract<PathCommand, { type: 'C' }>>();
    for (const c of contour) {
      if (c.type === 'Z') continue;
      if (c.type === 'C') { curves.set(points.length, c); straight.push(false); } else straight.push(c.type === 'L');
      points.push({ x: c.x, y: c.y });
    }
    // Fechamento implícito (Z) é um segmento reto até o primeiro ponto.
    if (closed && points.length > 1 && Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) < 1e-9) { points.pop(); straight.pop(); if (curves.has(points.length)) { curves.set(0, curves.get(points.length)!); curves.delete(points.length); straight[0] = false; } else straight[0] = true; }
    else if (closed) straight[0] = true;
    const n = points.length;
    if (n < 3 && closed || n < 3 && !closed) return contour;
    const incoming = (i: number) => straight[i];
    const outgoing = (i: number) => straight[(i + 1) % n] && (closed || i < n - 1);
    const corner = points.map((p, i) => {
      if (!closed && (i === 0 || i === n - 1)) return null;
      const r = Array.isArray(radius) ? radius[i] ?? 0 : radius;
      if (!(r > 0)) return null;
      if (!incoming(i) || !outgoing(i)) return null;
      const a = points[(i - 1 + n) % n], b = points[(i + 1) % n];
      const la = Math.hypot(a.x - p.x, a.y - p.y), lb = Math.hypot(b.x - p.x, b.y - p.y);
      if (la < 1e-9 || lb < 1e-9) return null;
      const u1 = { x: (a.x - p.x) / la, y: (a.y - p.y) / la }, u2 = { x: (b.x - p.x) / lb, y: (b.y - p.y) / lb };
      const theta = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
      if (theta < 1e-3 || theta > Math.PI - 1e-3) return null;
      const t = Math.min(type === 'round' ? r / Math.tan(theta / 2) : r, la / 2, lb / 2);
      const p1 = { x: p.x + u1.x * t, y: p.y + u1.y * t }, p2 = { x: p.x + u2.x * t, y: p.y + u2.y * t };
      if (type === 'chamfer') return { p1, p2, c: null };
      if (type === 'round') {
        const sweep = Math.PI - theta, k = 4 / 3 * Math.tan(sweep / 4) / Math.tan(sweep / 2);
        return { p1, p2, c: [{ x: p1.x + (p.x - p1.x) * k, y: p1.y + (p.y - p1.y) * k }, { x: p2.x + (p.x - p2.x) * k, y: p2.y + (p.y - p2.y) * k }] as [Point, Point] };
      }
      // Recorte: arco côncavo centrado no próprio vértice.
      const h = 4 / 3 * Math.tan(theta / 4) * t, dot = u1.x * u2.x + u1.y * u2.y;
      const norm = (v: Point) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
      const d1 = norm({ x: u2.x - u1.x * dot, y: u2.y - u1.y * dot }), d2 = norm({ x: u1.x - u2.x * dot, y: u1.y - u2.y * dot });
      return { p1, p2, c: [{ x: p1.x + d1.x * h, y: p1.y + d1.y * h }, { x: p2.x + d2.x * h, y: p2.y + d2.y * h }] as [Point, Point] };
    });
    const out: PathCommand[] = [];
    const start = (i: number) => corner[i] ? corner[i]!.p2 : points[i];
    out.push({ type: 'M', ...start(0) });
    const last = closed ? n : n - 1;
    for (let step = 1; step <= last; step++) {
      const i = step % n, curve = curves.get(i), c = corner[i];
      if (curve) out.push({ ...curve, ...(c ? c.p1 : points[i]) });
      else out.push({ type: 'L', ...(c ? c.p1 : points[i]) });
      if (c && (closed || step < n)) out.push(c.c ? { type: 'C', x1: c.c[0].x, y1: c.c[0].y, x2: c.c[1].x, y2: c.c[1].y, x: c.p2.x, y: c.p2.y } : { type: 'L', ...c.p2 });
    }
    if (closed) {
      // Remove a última linha redundante até o ponto inicial e fecha o contorno.
      const end = out.at(-1)!;
      if (end.type === 'L' && Math.hypot(end.x - (out[0] as { x: number }).x, end.y - (out[0] as { y: number }).y) < 1e-9) out.pop();
      out.push({ type: 'Z' });
    }
    return out;
  });
}
