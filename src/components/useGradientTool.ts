import { useRef } from 'react';
import { useEditor } from '../state/EditorContext';
import type { Point } from '../geometry/pathGeometry';
import { defaultGradient, gradientFraction, gradientPoints, setTransparency } from '../document/transparency';

type Drag = { pointerId: number; kind: 'start' | 'end' | 'create'; id: string; from: Point; started: boolean };
/**
 * Ferramenta Transparência, como no CorelDRAW: clique escolhe o objeto; arrastar sobre ele cria um degradê
 * do ponto inicial (opaco) ao final (transparente); as alças quadradas ajustam início e fim.
 */
export function useGradientTool() {
  const { document, selectedIds, tool, chooseObject, select, dispatch, beginEdit, commitEdit, viewport, setMessage } = useEditor();
  const drag = useRef<Drag | null>(null);
  const roots = selectedIds.filter(id => { const o = document.objects.find(x => x.id === id); return !!o && (!o.clipParent || !selectedIds.includes(o.clipParent)); });
  const target = tool === 'transparency' && roots.length === 1 ? document.objects.find(o => o.id === roots[0]) : undefined;
  function down(element: Element, p: Point, pointerId: number, id: string | null, shift: boolean) {
    const handle = element.closest('[data-gradient-handle]')?.getAttribute('data-gradient-handle') as 'start' | 'end' | undefined;
    if (handle && target?.transparencyGradient) { beginEdit(); drag.current = { pointerId, kind: handle, id: target.id, from: p, started: true }; return true; }
    if (!id) { select(null); return false; }
    const ids = selectedIds.includes(id) && !shift ? selectedIds : chooseObject(id, shift);
    if (shift || !ids.length) return false;
    const unit = ids.find(i => { const o = document.objects.find(x => x.id === i); return !!o && (!o.clipParent || !ids.includes(o.clipParent)); });
    if (!unit) return false;
    beginEdit(); drag.current = { pointerId, kind: 'create', id: unit, from: p, started: false };
    return true;
  }
  function move(p: Point, pointerId: number) {
    const d = drag.current, o = d && document.objects.find(x => x.id === d.id);
    if (!d || !o || d.pointerId !== pointerId) return;
    if (!d.started) { if (Math.hypot(p.x - d.from.x, p.y - d.from.y) * viewport.zoom < 4) return; d.started = true; }
    const at = gradientFraction(o, p), base = o.transparencyGradient ?? defaultGradient('linear');
    const gradient = d.kind === 'create' ? { ...base, ...(() => { const s = gradientFraction(o, d.from); return { x1: s.x, y1: s.y, x2: at.x, y2: at.y }; })() } : d.kind === 'start' ? { ...base, x1: at.x, y1: at.y } : { ...base, x2: at.x, y2: at.y };
    dispatch({ type: 'set-objects', objects: setTransparency(document.objects, [o.id], { gradient }) });
  }
  function up(pointerId: number) {
    const d = drag.current;
    if (!d || d.pointerId !== pointerId) return;
    drag.current = null; commitEdit();
    if (d.kind === 'create' && d.started) setMessage('Degradê de transparência criado. Arraste as alças para ajustar; a barra define o início e o fim.');
  }
  const handles = target?.transparencyGradient ? { ...gradientPoints(target), gradient: target.transparencyGradient } : null;
  return { down, move, up, handles, isDragging: () => drag.current !== null };
}
