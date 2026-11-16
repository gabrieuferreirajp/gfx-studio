import type { Guideline, VectorDocument } from '../document/model.ts';
import type { Bounds } from './objectTransforms.ts';
import type { Point } from './pathGeometry.ts';

/** Encaixe em linhas-guia e na grade (CorelDRAW › Alinhar a). Limite em px do documento. */
export interface SnapLines { guides: Guideline[]; grid: number | null }
export function snapLines(doc: VectorDocument, layout: { snapGuides: boolean; snapGrid: boolean; guides: boolean; gridSize: number }): SnapLines {
  return { guides: layout.snapGuides && layout.guides ? doc.guides ?? [] : [], grid: layout.snapGrid && layout.gridSize > 0 ? layout.gridSize : null };
}
/** Melhor deslocamento (no limite) que leva um dos valores a uma guia do eixo ou a uma linha da grade. */
function best(values: number[], positions: number[], grid: number | null, threshold: number): number | null {
  let result: number | null = null;
  const consider = (diff: number) => { if (Math.abs(diff) <= threshold && (result === null || Math.abs(diff) < Math.abs(result))) result = diff; };
  for (const v of values) {
    for (const p of positions) consider(p - v);
    if (grid) consider(Math.round(v / grid) * grid - v);
  }
  return result;
}
/** Ponto de desenho encaixado (ferramentas de forma, linha, texto e cota). */
export function snapPoint(p: Point, lines: SnapLines, threshold: number): Point {
  const xs = lines.guides.filter(g => g.axis === 'x').map(g => g.position), ys = lines.guides.filter(g => g.axis === 'y').map(g => g.position);
  const dx = best([p.x], xs, lines.grid, threshold), dy = best([p.y], ys, lines.grid, threshold);
  return { x: p.x + (dx ?? 0), y: p.y + (dy ?? 0) };
}
/** Caixa em movimento: bordas e centro procuram guias/grade; devolve o ajuste por eixo (null = sem encaixe). */
export function snapBounds(b: Bounds, lines: SnapLines, threshold: number): { dx: number | null; dy: number | null } {
  const xs = lines.guides.filter(g => g.axis === 'x').map(g => g.position), ys = lines.guides.filter(g => g.axis === 'y').map(g => g.position);
  return { dx: best([b.x, b.x + b.width / 2, b.x + b.width], xs, lines.grid, threshold), dy: best([b.y, b.y + b.height / 2, b.y + b.height], ys, lines.grid, threshold) };
}
export const addGuide = (guides: Guideline[] | undefined, axis: 'x' | 'y', position: number): Guideline[] => [...(guides ?? []), { id: crypto.randomUUID(), axis, position: Math.round(position * 1000) / 1000 }];
