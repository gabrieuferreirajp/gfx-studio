import type { PenNode, Point } from './pathGeometry.ts';

/**
 * B-Spline (CorelDRAW): os pontos de controle puxam a curva sem que ela passe por eles.
 * Aberta: extremidades triplicadas para a curva começar e terminar nos pontos das pontas.
 * Fechada: periódica. Cada trecho uniforme cúbico vira um segmento Bézier.
 */
export function bsplineNodes(control: Point[], closed: boolean): PenNode[] {
  if (control.length < 2) return control.map(p => ({ ...p }));
  if (control.length === 2) return control.map(p => ({ ...p }));
  const q = closed ? control : [control[0], control[0], ...control, control.at(-1)!, control.at(-1)!];
  const n = q.length, segments = closed ? n : n - 3, at = (i: number) => q[((i % n) + n) % n];
  const mix = (a: Point, b: Point, c: Point, wa: number, wb: number, wc: number, d: number) => ({ x: (a.x * wa + b.x * wb + c.x * wc) / d, y: (a.y * wa + b.y * wb + c.y * wc) / d });
  const nodes: PenNode[] = [];
  for (let i = 0; i < segments; i++) {
    const p0 = at(i), p1 = at(i + 1), p2 = at(i + 2), p3 = at(i + 3);
    const start = mix(p0, p1, p2, 1, 4, 1, 6), c1 = mix(p1, p2, p2, 2, 1, 0, 3), c2 = mix(p1, p2, p2, 1, 2, 0, 3), end = mix(p1, p2, p3, 1, 4, 1, 6);
    if (!nodes.length) nodes.push({ ...start });
    nodes.at(-1)!.outgoing = c1;
    nodes.push({ ...end, incoming: c2 });
  }
  // Fechada: o último nó coincide com o primeiro; une as alças nele.
  if (closed) { const last = nodes.pop()!; nodes[0].incoming = last.incoming; }
  return nodes;
}
/** Curva de 3 pontos: começa em A, termina em B e passa pelo ponto C no meio do trecho. */
export function threePointNodes(a: Point, b: Point, c: Point): PenNode[] {
  const q = { x: 2 * c.x - (a.x + b.x) / 2, y: 2 * c.y - (a.y + b.y) / 2 };
  return [{ ...a, outgoing: { x: a.x + 2 / 3 * (q.x - a.x), y: a.y + 2 / 3 * (q.y - a.y) } }, { ...b, incoming: { x: b.x + 2 / 3 * (q.x - b.x), y: b.y + 2 / 3 * (q.y - b.y) } }];
}
