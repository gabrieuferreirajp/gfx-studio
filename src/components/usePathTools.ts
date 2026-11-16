import { useEffect, useRef, useState } from 'react';
import { constrain } from '../geometry/dimension';
import { boundedPoint, finishPathDraft, dragHandle, shouldClose, type PenNode, type Point } from '../geometry/pathGeometry';
import { useEditor } from '../state/EditorContext';
import { endpointNear } from '../geometry/pathJoin';
import { JOIN_RADIUS, useJoinedAdd } from './useJoinedAdd';

export function usePathTools() {
  const { tool, outline: fill, outlineWidth, document, select, setDraftPending, viewport } = useEditor();
  const addJoined = useJoinedAdd();
  // Ponta de curva aberta sob o cursor: a linha começa/termina exatamente nela (e liga as duas).
  const [snap, setSnap] = useState<Point | null>(null);
  const snapped = (p: Point) => endpointNear(document.objects, p, JOIN_RADIUS / viewport.zoom)?.point ?? null;
  const draft = useRef<PenNode[]>([]);
  const pointer = useRef<number | null>(null);
  const draftTool = useRef(tool);
  const draftColor = useRef(fill);
  const [nodes, setNodes] = useState<PenNode[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  function update(next: PenNode[]) { draft.current = next; setNodes(next); setDraftPending(next.length > 0); }
  function cancel() { pointer.current = null; update([]); setHover(null); }
  function complete(closed = false) {
    // Duplo clique adiciona o mesmo nó duas vezes; nós repetidos são descartados.
    const current = draft.current.filter((n, i, all) => i === 0 || Math.hypot(n.x - all[i - 1].x, n.y - all[i - 1].y) > 0.01);
    const draftObject = finishPathDraft(current, draftTool.current === 'line' ? 'line' : 'pen', draftColor.current, closed);
    const object = draftObject && { ...draftObject, strokeWidth: outlineWidth };
    if (object) addJoined(object);
    cancel();
  }
  useEffect(() => {
    setSnap(null);
    if (tool !== draftTool.current && draft.current.length) cancel();
  }, [tool]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (!draft.current.length || event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select'))) return;
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === 'Escape') cancel(); else complete();
      }
    }
    function finish() { if (draft.current.length) complete(); }
    function blur() { pointer.current = null; }
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('vectorstudio:finish-gesture', finish);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('vectorstudio:finish-gesture', finish); window.removeEventListener('blur', blur); };
  });
  function down(position: Point, pointerId: number) {
    const point = snapped(boundedPoint(position)) ?? boundedPoint(position);
    if ((tool === 'pen' || tool === 'pentool') && shouldClose(draft.current, point, viewport.zoom)) { complete(true); return; }
    if (!draft.current.length) { draftTool.current = tool; draftColor.current = fill; select(null); }
    pointer.current = pointerId;
    if (tool === 'line') update([point, point]);
    else if (draft.current.length < 9998) update([...draft.current, point]);
  }
  /** `straight`: Shift/Ctrl na linha de dois pontos restringe a passos de 15° (horizontal, vertical e 45°). */
  function move(position: Point, pointerId: number, straight = false, alt = false) {
    let point = boundedPoint(position);
    if (straight && draftTool.current === 'line' && draft.current.length) point = boundedPoint(constrain(draft.current[0], point));
    // Guias dinâmicas (como no CorelDRAW): quase na horizontal ou na vertical (até 3°), a linha encaixa reta (Alt desliga).
    else if (!alt && draftTool.current === 'line' && draft.current.length) {
      const o = draft.current[0], dx = point.x - o.x, dy = point.y - o.y, angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
      if (Math.hypot(dx, dy) * viewport.zoom > 8) { if (Math.min(angle, 180 - angle) <= 3) point = { x: point.x, y: o.y }; else if (Math.abs(angle - 90) <= 3) point = { x: o.x, y: point.y }; }
    }
    const end = (tool === 'line' || tool === 'pen' || tool === 'pentool') && !(pointer.current === pointerId && tool !== 'line') ? snapped(point) : null;
    setSnap(end); if (end) point = end;
    setHover(point);
    if (pointer.current !== pointerId || !draft.current.length) return;
    if (draftTool.current === 'line') update([draft.current[0], point]);
    else {
      const last = draft.current.at(-1)!;
      if (Math.hypot(last.x - point.x, last.y - point.y) * viewport.zoom >= 2 || last.outgoing) update([...draft.current.slice(0, -1), dragHandle(last, point)]);
    }
  }
  function up(pointerId: number, cancelled = false) {
    if (pointer.current !== pointerId) return;
    pointer.current = null;
    if (cancelled) cancel();
    // Linha de 2 pontos: continua na ferramenta (como no CorelDRAW) para ir emendando a forma.
    else if (draftTool.current === 'line') complete();
  }
  return { nodes, hover, snap, down, move, up, complete, isDragging: () => pointer.current !== null };
}
