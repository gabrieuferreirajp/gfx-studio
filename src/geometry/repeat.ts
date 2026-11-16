import type { VectorObject } from '../document/model.ts';
import { applyMatrix, boundsOf, clipContents, duplicateObjects, multiply, translate, type Matrix } from './objectTransforms.ts';
import type { Point } from './pathGeometry.ts';

/**
 * Repetir (Ctrl+R, como no CorelDRAW): a última transformação da seleção — mover, girar, escalar — e, quando ela
 * foi feita numa cópia (Ctrl+D, botão direito ao arrastar ou um Ctrl+R anterior), uma nova cópia com o mesmo passo.
 */
export interface RepeatStep { matrix: Matrix; center: Point; duplicate: boolean }
export interface RepeatState { step: RepeatStep | null; copy: { ids: string[]; matrix: Matrix; center: Point } | null }
const top = (objects: VectorObject[], ids: string[]) => objects.filter(o => ids.includes(o.id) && (!o.clipParent || !ids.includes(o.clipParent)));
export function selectionCenter(objects: VectorObject[], ids: string[]): Point {
  const b = boundsOf(top(objects, ids));
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
/** Registra uma transformação. `copies`: ids da cópia criada (o passo passa a duplicar). */
export function recordTransform(state: RepeatState, before: VectorObject[], ids: string[], matrix: Matrix, copies?: string[]): RepeatState {
  const center = selectionCenter(before, ids);
  if (copies) return { step: { matrix, center, duplicate: true }, copy: { ids: copies, matrix, center } };
  // Mover a cópia recém-criada ajusta o passo da duplicação (ex.: Ctrl+D e depois arrastar para o lado).
  if (state.copy && sameIds(state.copy.ids, ids)) { const total = multiply(matrix, state.copy.matrix); return { step: { matrix: total, center: state.copy.center, duplicate: true }, copy: { ...state.copy, matrix: total } }; }
  return { step: { matrix, center, duplicate: false }, copy: null };
}
/** O passo é refeito em torno do centro da seleção atual (giro e escala acompanham a peça nova). */
export function relocate(step: RepeatStep, center: Point): Matrix {
  return multiply(translate(center.x - step.center.x, center.y - step.center.y), multiply(step.matrix, translate(step.center.x - center.x, step.center.y - center.y)));
}
export function repeatStep(state: RepeatState, objects: VectorObject[], ids: string[]): { objects: VectorObject[]; ids: string[]; state: RepeatState } | null {
  const step = state.step;
  if (!step || !ids.length) return null;
  const center = selectionCenter(objects, ids), matrix = relocate(step, center), all = clipContents(objects, ids);
  if (!step.duplicate) return { objects: applyMatrix(objects, all, matrix), ids, state };
  const result = duplicateObjects(objects, all, undefined, matrix);
  if (result.objects === objects) return null;
  const copies = result.ids.filter(id => { const o = result.objects.find(x => x.id === id)!; return !o.clipParent || !result.ids.includes(o.clipParent); });
  return { objects: result.objects, ids: copies, state: { step, copy: { ids: copies, matrix, center } } };
}
