import type { Bounds } from './objectTransforms.ts';

/** Linha-guia exibida durante o encaixe: vertical (axis x) ou horizontal (axis y). */
export interface Guide { axis: 'x' | 'y'; position: number; from: number; to: number }
/** Espaçamento igual (como no Photoshop): trechos de mesmo tamanho ao longo do eixo, na altura `at`. */
export interface Spacing { axis: 'x' | 'y'; gap: number; segments: { from: number; to: number; at: number }[] }
/** Dois objetos vizinhos no mesmo alinhamento (sobrepostos no outro eixo) e o vão entre eles. */
export interface SpacingPair { a: Bounds; b: Bounds; gap: number }
const lines = (b: Bounds, axis: 'x' | 'y') => axis === 'x' ? [b.x, b.x + b.width / 2, b.x + b.width] : [b.y, b.y + b.height / 2, b.y + b.height];
const start = (b: Bounds, axis: 'x' | 'y') => axis === 'x' ? b.x : b.y;
const size = (b: Bounds, axis: 'x' | 'y') => axis === 'x' ? b.width : b.height;
const cross = (b: Bounds, axis: 'x' | 'y'): [number, number] => axis === 'x' ? [b.y, b.y + b.height] : [b.x, b.x + b.width];
const overlap = (a: Bounds, b: Bounds, axis: 'x' | 'y') => { const [a1, a2] = cross(a, axis), [b1, b2] = cross(b, axis); return a1 < b2 && b1 < a2; };
const middle = (a: Bounds, b: Bounds, axis: 'x' | 'y') => { const [a1, a2] = cross(a, axis), [b1, b2] = cross(b, axis); return (Math.max(a1, b1) + Math.min(a2, b2)) / 2; };
/** Calculado uma vez no início do arraste: cada objeto com o vizinho mais próximo à direita (ou abaixo). */
export function spacingPairs(targets: Bounds[], axis: 'x' | 'y'): SpacingPair[] {
  const list = targets.slice(0, 400), out: SpacingPair[] = [];
  for (const a of list) {
    let best: SpacingPair | null = null;
    for (const b of list) {
      if (a === b || !overlap(a, b, axis)) continue;
      const gap = start(b, axis) - (start(a, axis) + size(a, axis));
      if (gap > 0.01 && (!best || gap < best.gap)) best = { a, b, gap };
    }
    if (best) out.push(best);
  }
  return out;
}
/** Posição em que a seleção repete o vão de um par vizinho (antes, depois ou centralizada entre os dois). */
function snapSpacing(moving: Bounds, pairs: SpacingPair[], axis: 'x' | 'y', threshold: number): { diff: number; spacing: Spacing } | null {
  let best: { diff: number; spacing: Spacing } | null = null;
  const m0 = start(moving, axis), ms = size(moving, axis);
  const offer = (position: number, segments: (pos: number) => [number, number, Bounds, Bounds][]) => {
    const diff = position - m0;
    if (Math.abs(diff) > threshold || (best && Math.abs(diff) >= Math.abs(best.diff))) return;
    const shifted = axis === 'x' ? { ...moving, x: position } : { ...moving, y: position };
    best = { diff, spacing: { axis, gap: 0, segments: segments(position).map(([from, to, p, q]) => ({ from, to, at: middle(p === moving ? shifted : p, q === moving ? shifted : q, axis) })) } };
    best.spacing.gap = best.spacing.segments[0].to - best.spacing.segments[0].from;
  };
  for (const { a, b, gap } of pairs) {
    const aEnd = start(a, axis) + size(a, axis), bStart = start(b, axis), bEnd = bStart + size(b, axis);
    if (overlap(moving, b, axis)) offer(bEnd + gap, pos => [[aEnd, bStart, a, b], [bEnd, pos, b, moving]]);
    if (overlap(moving, a, axis)) offer(start(a, axis) - gap - ms, pos => [[pos + ms, start(a, axis), moving, a], [aEnd, bStart, a, b]]);
    const inner = (gap - ms) / 2;
    if (inner > 0.01 && overlap(moving, a, axis) && overlap(moving, b, axis)) offer(aEnd + inner, pos => [[aEnd, pos, a, moving], [pos + ms, bStart, moving, b]]);
  }
  return best;
}
/**
 * Guias inteligentes: aproxima bordas e centros da seleção em movimento das bordas e centros
 * de outros objetos e da página; dentro do limite, "trava" na linha e devolve as guias a desenhar.
 * Com `pairs`, também encaixa no mesmo espaçamento entre vizinhos (guias de espaçamento igual).
 */
export function snapMove(moving: Bounds, targets: Bounds[], threshold: number, pairs?: { x: SpacingPair[]; y: SpacingPair[] }): { dx: number; dy: number; guides: Guide[]; spacings: Spacing[] } {
  const result = { dx: 0, dy: 0, guides: [] as Guide[], spacings: [] as Spacing[] };
  for (const axis of ['x', 'y'] as const) {
    let best: { diff: number; target: Bounds; position: number } | null = null;
    for (const target of targets) for (const t of lines(target, axis)) for (const m of lines(moving, axis)) {
      const diff = t - m;
      if (Math.abs(diff) <= threshold && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, target, position: t };
    }
    const spacing = pairs ? snapSpacing(moving, pairs[axis], axis, threshold) : null;
    // O espaçamento igual vence quando está mais perto (ou empata) que a guia de borda.
    if (spacing && (!best || Math.abs(spacing.diff) <= Math.abs(best.diff) + 1e-9)) {
      if (axis === 'x') result.dx = spacing.diff; else result.dy = spacing.diff;
      result.spacings.push(spacing.spacing);
      continue;
    }
    if (!best) continue;
    if (axis === 'x') result.dx = best.diff; else result.dy = best.diff;
    const snapped = { ...moving, x: moving.x + (axis === 'x' ? best.diff : 0), y: moving.y + (axis === 'y' ? best.diff : 0) };
    const [a, b] = axis === 'x' ? [snapped.y, snapped.y + snapped.height] : [snapped.x, snapped.x + snapped.width];
    const [c, d] = axis === 'x' ? [best.target.y, best.target.y + best.target.height] : [best.target.x, best.target.x + best.target.width];
    result.guides.push({ axis, position: best.position, from: Math.min(a, c), to: Math.max(b, d) });
  }
  return result;
}
