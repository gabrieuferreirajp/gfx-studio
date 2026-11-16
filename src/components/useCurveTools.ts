import { useJoinedAdd } from './useJoinedAdd';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/EditorContext';
import { createPathObject, type PenNode, type Point } from '../geometry/pathGeometry';
import { bsplineNodes, threePointNodes } from '../geometry/curveTools';
import { simplifyPoints } from '../geometry/shapeFactory';
import type { Tool } from '../document/model';

export const curveDraftTools: Tool[] = ['polyline', 'bspline', 'threepoint'];
type Draft = { tool: Tool; points: Point[]; pointer: number | null; dragging: boolean; phase: 'points' | 'end' | 'curve' };
/**
 * Polilinha (clique: reta; arrastar: mão livre), B-Spline (pontos de controle) e Curva de 3 pontos
 * (arrastar de A até B e clicar para definir a curvatura). Enter ou duplo clique conclui; Esc cancela;
 * clicar no primeiro ponto fecha a forma (como no CorelDRAW).
 */
export function useCurveTools() {
  const { tool, outline, outlineWidth, select, setDraftPending, viewport } = useEditor();
  const addJoined = useJoinedAdd();
  const draft = useRef<Draft | null>(null);
  const [state, setState] = useState<{ points: Point[]; hover: Point | null; tool: Tool } | null>(null);
  const refresh = (hover: Point | null = state?.hover ?? null) => { const d = draft.current; setState(d ? { points: [...d.points], hover, tool: d.tool } : null); setDraftPending(!!d); };
  function cancel() { draft.current = null; refresh(null); }
  function nodesFor(points: Point[], kind: Tool, closed: boolean): PenNode[] {
    if (kind === 'bspline') return bsplineNodes(points, closed);
    if (kind === 'threepoint' && points.length === 3) return threePointNodes(points[0], points[1], points[2]);
    return points.map(p => ({ ...p }));
  }
  function complete(closed = false) {
    const d = draft.current;
    if (!d) return;
    const points = d.points.filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-6);
    draft.current = null; refresh(null);
    if (points.length < 2 || (closed && points.length < 3)) return;
    const object = { ...createPathObject(nodesFor(points, d.tool, closed).slice(0, 9998), closed, outline === 'none' ? '#000000' : outline, d.tool === 'bspline' ? 'B-Spline' : d.tool === 'polyline' ? 'Polilinha' : 'Curva de 3 pontos'), strokeWidth: outlineWidth };
    addJoined(object);
  }
  useEffect(() => { if (draft.current && draft.current.tool !== tool) cancel(); }, [tool]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (!draft.current || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select'))) return;
      if (event.key === 'Escape' || event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); if (event.key === 'Escape') cancel(); else complete(); }
    }
    const finish = () => { if (draft.current) complete(); };
    window.addEventListener('keydown', keydown, true); window.addEventListener('vectorstudio:finish-gesture', finish);
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('vectorstudio:finish-gesture', finish); };
  });
  const nearFirst = (p: Point) => !!draft.current && draft.current.points.length >= 3 && Math.hypot(p.x - draft.current.points[0].x, p.y - draft.current.points[0].y) * viewport.zoom <= 8;
  function down(point: Point, pointerId: number) {
    const d = draft.current;
    if (tool === 'threepoint') {
      if (d?.phase === 'curve') { d.points[2] = point; complete(); return; }
      draft.current = { tool, points: [point, point], pointer: pointerId, dragging: true, phase: 'end' }; refresh(point); return;
    }
    if (d && nearFirst(point)) { complete(true); return; }
    if (!d) { select(null); draft.current = { tool, points: [point], pointer: pointerId, dragging: false, phase: 'points' }; }
    else if (d.points.length < 9990) { d.points.push(point); d.pointer = pointerId; d.dragging = false; }
    refresh(point);
  }
  function move(point: Point, pointerId: number) {
    const d = draft.current;
    if (!d) return;
    if (d.tool === 'threepoint') { if (d.phase === 'end' && d.pointer === pointerId) d.points[1] = point; else if (d.phase === 'curve') d.points[2] = point; refresh(point); return; }
    // Polilinha: arrastar com o botão pressionado desenha um trecho à mão livre.
    if (d.tool === 'polyline' && d.pointer === pointerId) { const last = d.points.at(-1)!; if (Math.hypot(point.x - last.x, point.y - last.y) * viewport.zoom >= 2) { d.points.push(point); d.dragging = true; } }
    refresh(point);
  }
  function up(pointerId: number) {
    const d = draft.current;
    if (!d || d.pointer !== pointerId) return;
    d.pointer = null;
    if (d.tool === 'threepoint' && d.phase === 'end') {
      if (Math.hypot(d.points[1].x - d.points[0].x, d.points[1].y - d.points[0].y) * viewport.zoom < 3) { cancel(); return; }
      d.phase = 'curve'; d.points[2] = { x: (d.points[0].x + d.points[1].x) / 2, y: (d.points[0].y + d.points[1].y) / 2 };
    }
    if (d.tool === 'polyline' && d.dragging) {
      // Simplifica o trecho à mão livre recém-desenhado.
      d.points = simplifyPoints(d.points, 1 / viewport.zoom);
      d.dragging = false;
    }
    refresh();
  }
  /** Pré-visualização: curva resultante (incluindo o ponto sob o cursor) e polígono de controle da B-Spline. */
  const preview = state ? (() => {
    const pts = state.tool === 'threepoint' ? state.points : state.hover && state.points.length ? [...state.points, state.hover] : state.points;
    return { nodes: nodesFor(pts, state.tool, false), control: state.tool === 'bspline' ? pts : [], points: state.points };
  })() : null;
  return { preview, down, move, up, complete, cancel, isActive: () => draft.current !== null, isDragging: () => draft.current?.pointer != null };
}
