import { useRef } from 'react';
import { useEditor } from '../state/EditorContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import type { Point } from '../geometry/pathGeometry';
import type { VectorObject } from '../document/model';
import { matrixOf, transformPoint } from '../geometry/objectTransforms';
import { cornerRadii, cornerScale } from '../geometry/worldGeometry';
import { withCorners } from './ShapeControls';
import { toUnit, unitDefinitions } from '../document/units';

type Drag = { pointerId: number; corner: number; object: VectorObject };
/** Canto do retângulo no documento, direção da borda horizontal (para dentro) e raio máximo. */
export function cornerFrame(o: VectorObject, corner: number) {
  const m = matrixOf(o), local = [{ x: o.x, y: o.y }, { x: o.x + o.width, y: o.y }, { x: o.x + o.width, y: o.y + o.height }, { x: o.x, y: o.y + o.height }];
  const p = transformPoint(m, local[corner]), along = transformPoint(m, local[corner === 0 ? 1 : corner === 1 ? 0 : corner === 2 ? 3 : 2]), down = transformPoint(m, local[corner === 0 ? 3 : corner === 1 ? 2 : corner === 2 ? 1 : 0]);
  const w = Math.hypot(along.x - p.x, along.y - p.y) || 1, h = Math.hypot(down.x - p.x, down.y - p.y) || 1;
  return { p, u: { x: (along.x - p.x) / w, y: (along.y - p.y) / w }, max: Math.min(w, h) / 2 };
}
/**
 * Ferramenta Forma (F10) sobre um retângulo, como no CorelDRAW: um ponto em cada canto, sobre a borda;
 * arrastar ao longo da borda arredonda o canto (com o cadeado de cantos, os quatro juntos).
 */
export function useCornerHandles() {
  const { document, selectedIds, tool, dispatch, beginEdit, commitEdit, setMessage } = useEditor(), { layout } = useWorkspace();
  const drag = useRef<Drag | null>(null);
  const rect = tool === 'nodes' && selectedIds.length === 1 ? document.objects.find(o => o.id === selectedIds[0] && o.type === 'rectangle' && !o.locked) : undefined;
  function down(target: Element, _point: Point, pointerId: number) {
    const corner = target.closest('[data-corner-handle]')?.getAttribute('data-corner-handle');
    if (corner === null || corner === undefined || !rect) return false;
    beginEdit(); drag.current = { pointerId, corner: Number(corner), object: rect };
    return true;
  }
  function move(point: Point, pointerId: number) {
    const d = drag.current;
    if (!d || d.pointerId !== pointerId) return;
    const f = cornerFrame(d.object, d.corner), radius = Math.max(0, Math.min(f.max, (point.x - f.p.x) * f.u.x + (point.y - f.p.y) * f.u.y));
    dispatch({ type: 'set-objects', objects: document.objects.map(o => o.id === d.object.id ? withCorners(d.object, { radius, corner: d.corner }, layout.lockCorners) : o) });
    const unit = document.unit ?? 'px';
    setMessage(`Raio do canto${layout.lockCorners ? ' (os quatro)' : ''}: ${Number(toUnit(radius, unit).toFixed(3)).toLocaleString('pt-BR')} ${unitDefinitions[unit].short}`);
  }
  function up(pointerId: number) { if (drag.current?.pointerId === pointerId) { drag.current = null; commitEdit(); } }
  /** Pontos sobre a borda superior/inferior, afastados do canto pelo raio atual. */
  const handles = rect ? cornerRadii(rect).map((r, corner) => { const f = cornerFrame(rect, corner), d = Math.min(f.max, r * cornerScale(rect)); return { corner, x: f.p.x + f.u.x * d, y: f.p.y + f.u.y * d }; }) : null;
  return { down, move, up, handles, isDragging: () => drag.current !== null };
}
