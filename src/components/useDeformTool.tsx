import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/EditorContext';
import type { PathCommand, VectorObject } from '../document/model';
import type { Point } from '../geometry/pathGeometry';
import type { Bounds } from '../geometry/objectTransforms';
import { selectionIds } from '../geometry/objectTransforms';
import { canDeform, boxQuad, deformError, deformObjects, deformSources, mapPath, perspectiveMap, validQuad, type Quad } from '../geometry/deform';
import { useEnvelopeTool, type Modifiers } from './useEnvelopeTool';

/** Sessão: geometria original e alças; vale enquanto os objetos são os que a própria ferramenta produziu. */
type Session = { mode: 'perspective'; ids: string[]; sources: Map<string, PathCommand[]>; box: Bounds; handles: Point[]; produced: Map<string, string> };
/** Impressão digital da geometria: reconhece os objetos que a ferramenta produziu, mesmo recriados pelo histórico. */
const print = (o: VectorObject | undefined) => o ? `${o.type}|${o.x}|${o.y}|${o.width}|${o.height}|${o.commands?.length ?? 0}|${JSON.stringify(o.commands?.[1] ?? null)}|${(o.transform ?? []).join(',')}` : '';
type Drag = { pointerId: number; index: number; start: Point; origin: Point[] };
/** Limpar perspectiva (o Envelope tem a própria barra, em useEnvelopeTool). */
export const perspectiveEvent = () => window.dispatchEvent(new CustomEvent('vectorstudio:perspective'));
/**
 * Perspectiva (CorelDRAW): 4 cantos sobre a caixa da seleção (homografia). Clique num objeto para escolhê-lo;
 * textos precisam de Ctrl+Q. Com a ferramenta Envelope ativa, devolve a ferramenta de useEnvelopeTool.
 */
export function useDeformTool(): { active: boolean; down: (target: Element, p: Point, pointerId: number, clickedId: string | null, mods?: Modifiers) => boolean; move: (p: Point, pointerId: number, mods?: Modifiers) => void; up: (pointerId: number) => void; isDragging: () => boolean; element: ReactElement | null } {
  const envelope = useEnvelopeTool();
  const { tool, document, selectedIds, setSelection, dispatch, beginEdit, commitEdit, setMessage, viewport } = useEditor();
  const mode = tool === 'perspective' ? tool : null;
  const session = useRef<Session | null>(null), drag = useRef<Drag | null>(null), [, redraw] = useState(0);
  const objects = document.objects;
  // A sessão é refeita quando a seleção ou os objetos mudam por fora (outra ferramenta, Desfazer…).
  const deformable = selectedIds.filter(id => objects.some(o => o.id === id && canDeform(o) && !o.locked));
  const valid = (s: Session | null) => !!s && s.mode === mode && s.ids.length === deformable.length && deformable.every(id => s.sources.has(id)) && s.ids.every(id => print(objects.find(o => o.id === id)) === s.produced.get(id));
  if (mode && !valid(session.current)) {
    const found = deformSources(objects, selectedIds);
    session.current = found ? { mode, ids: [...found.sources.keys()], sources: found.sources, box: found.box, handles: boxQuad(found.box), produced: new Map(objects.filter(o => found.sources.has(o.id)).map(o => [o.id, print(o)])) } : null;
  }
  if (!mode) session.current = null;
  const s = mode ? session.current : null;
  function apply(handles: Point[], commit: boolean) {
    const ss = session.current; if (!ss) return;
    if (!validQuad(handles as Quad)) { setMessage('Perspectiva inválida: os cantos não podem se cruzar.'); return; }
    const map = perspectiveMap(handles as Quad);
    try {
      const next = deformObjects(objects, ss.ids, ss.sources, ss.box, (c, b) => mapPath(c, b, map, 1));
      ss.handles = handles; ss.produced = new Map(next.filter(o => ss.sources.has(o.id)).map(o => [o.id, print(o)]));
      if (commit) commitEdit();
      dispatch({ type: 'set-objects', objects: next });
      if (commit) commitEdit();
    } catch (e) { setMessage((e as Error).message); }
  }
  useEffect(() => {
    const listen = (e: Event) => {
      const ss = session.current;
      if (!ss) { setMessage(deformError(objects, selectedIds) ?? 'Selecione um objeto.'); return; }
      apply(boxQuad(ss.box), true);
    };
    window.addEventListener('vectorstudio:perspective', listen);
    return () => window.removeEventListener('vectorstudio:perspective', listen);
  });
  function down(target: Element, p: Point, pointerId: number, clickedId: string | null) {
    const handle = target.closest('[data-deform-handle]')?.getAttribute('data-deform-handle');
    if (handle != null && session.current) { beginEdit(); drag.current = { pointerId, index: Number(handle), start: p, origin: session.current.handles.map(h => ({ ...h })) }; return true; }
    if (clickedId) { setSelection(selectionIds(objects, clickedId)); const error = deformError(objects, selectionIds(objects, clickedId)); if (error) setMessage(error); }
    else setSelection([]);
    return false;
  }
  function move(p: Point, pointerId: number) {
    const d = drag.current, ss = session.current; if (!d || d.pointerId !== pointerId || !ss) return;
    const dx = p.x - d.start.x, dy = p.y - d.start.y, handles = d.origin.map(h => ({ ...h }));
    handles[d.index] = { x: d.origin[d.index].x + dx, y: d.origin[d.index].y + dy };
    apply(handles, false); redraw(n => n + 1);
  }
  function up(pointerId: number) { if (drag.current?.pointerId !== pointerId) return; drag.current = null; commitEdit(); redraw(n => n + 1); }
  const z = viewport.zoom;
  let element = null;
  if (s) {
    const h = s.handles;
    const outline = `M${h.map(p => `${p.x} ${p.y}`).join('L')}Z`;
    element = <g className="deform-handles">
      <path d={outline} fill="none" stroke="#1f6fd1" strokeWidth={1 / z} strokeDasharray={`${5 / z} ${3 / z}`} pointerEvents="none" />
      {(() => { const m = perspectiveMap(h as Quad); return [0.25, 0.5, 0.75].map(t => <g key={t} pointerEvents="none" stroke="#1f6fd1" strokeOpacity={0.4} strokeWidth={0.8 / z}><line x1={m(t, 0).x} y1={m(t, 0).y} x2={m(t, 1).x} y2={m(t, 1).y} /><line x1={m(0, t).x} y1={m(0, t).y} x2={m(1, t).x} y2={m(1, t).y} /></g>); })()}
      {h.map((p, i) => <rect key={i} data-deform-handle={i} x={p.x - 4.5 / z} y={p.y - 4.5 / z} width={9 / z} height={9 / z} fill="#1f6fd1" stroke="#1f6fd1" strokeWidth={1.2 / z} style={{ cursor: 'move' }}><title>Arraste o canto da perspectiva</title></rect>)}
    </g>;
  }
  if (envelope.active) return envelope;
  return { active: !!mode, down, move, up, isDragging: () => drag.current !== null, element };
}
