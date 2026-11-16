import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../state/EditorContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import type { DimLink, VectorObject } from '../document/model';
import { anchorAt } from '../geometry/links';
import type { Point } from '../geometry/pathGeometry';
import { angularDimension, axisFor, axisOffset, calloutObjects, constrain, dimensionLines, dimensionObjects, edgeSegments, formatAngle, formatMeasure, nearestEdge, nearestSegment, nearestSnap, offsetFrom, snapPoints, type DimensionOptions } from '../geometry/dimension';
import { browserMeasure } from '../text/textMeasure';

export const dimensionTools = ['dimension', 'dimHV', 'dimAngle', 'dimSegment', 'callout'] as const;
type DimTool = typeof dimensionTools[number];
type Snap = Point & { kind: 'node' | 'edge' };
/** Pontos clicados (`points`), ponto atual (`hover`) e se o primeiro foi arrastado. */
type Draft = { tool: DimTool; points: Point[]; hover: Point; pointer: number | null; dragged: boolean };
/** Pontos necessários antes do clique final de cada cota. */
const needed: Record<DimTool, number> = { dimension: 2, dimHV: 2, dimSegment: 2, dimAngle: 3, callout: 2 };
/**
 * Cotas (CorelDRAW): paralela, horizontal/vertical, angular, de segmento e legenda de 3 pontos.
 * Encaixa em nós e bordas; Ctrl restringe a 15°; Esc cancela. Opções na barra de propriedades.
 */
export function useDimensionTool(openText: (id: string) => void) {
  const { tool, document, dispatch, commitEdit, setSelection, setMessage, viewport, outline } = useEditor(), { layout } = useWorkspace();
  const mode = (dimensionTools as readonly string[]).includes(tool) ? tool as DimTool : null;
  const draft = useRef<Draft | null>(null);
  const [state, setState] = useState<{ draft: Draft | null; snap: Snap | null }>({ draft: null, snap: null });
  const points = useMemo(() => mode ? snapPoints(document.objects) : [], [mode, document.objects]);
  const edges = useMemo(() => mode ? edgeSegments(document.objects) : [], [mode, document.objects]);
  const options: DimensionOptions = { ...(layout.dimPrecision >= 0 ? { precision: layout.dimPrecision } : {}), showUnit: layout.dimShowUnit, fontSize: layout.dimFontSize };
  const unit = document.unit ?? 'px', color = outline === 'none' ? '#000000' : outline;
  const snap = (p: Point): Snap | null => { const node = nearestSnap(points, p, 8 / viewport.zoom); if (node) return { ...node, kind: 'node' }; const edge = nearestEdge(edges, p, 7 / viewport.zoom); return edge ? { ...edge, kind: 'edge' } : null; };
  const refresh = (hover: Snap | null) => setState({ draft: draft.current && { ...draft.current, points: [...draft.current.points] }, snap: hover });
  function cancel() { draft.current = null; refresh(null); }
  useEffect(() => { cancel(); }, [tool]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (draft.current && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); setMessage('Cota cancelada.'); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  /** Objetos da cota com o ponto final `p`. */
  function build(d: Draft, p: Point): VectorObject[] | null {
    const [a, b, c] = d.points;
    if (d.tool === 'dimension' || d.tool === 'dimSegment') return dimensionObjects(a, b, offsetFrom(a, b, p), unit, browserMeasure, color, options);
    if (d.tool === 'dimHV') { const axis = axisFor(a, b, p); return dimensionObjects(a, b, axisOffset(a, axis, p), unit, browserMeasure, color, { ...options, axis }); }
    if (d.tool === 'dimAngle') return angularDimension(a, b, c, Math.hypot(p.x - a.x, p.y - a.y), browserMeasure, color, options);
    return calloutObjects(a, b, p, 'Legenda', browserMeasure, color, options);
  }
  /** Cotas lineares presas a objetos: o texto guarda as âncoras e a cota é refeita quando eles mudam. */
  function link(d: Draft, p: Point, created: VectorObject[]): VectorObject[] {
    if (d.tool !== 'dimension' && d.tool !== 'dimHV' && d.tool !== 'dimSegment') return created;
    const [a, b] = d.points, tolerance = 1.5 / viewport.zoom, anchors = [anchorAt(document.objects, a, tolerance), anchorAt(document.objects, b, tolerance)];
    if (!anchors.some(x => x.id)) return created;
    const axis = d.tool === 'dimHV' ? axisFor(a, b, p) : undefined, offset = axis ? axisOffset(a, axis, p) : offsetFrom(a, b, p);
    const dimLink: DimLink = { a: anchors[0], b: anchors[1], offset, ...(axis ? { axis } : {}), unit, color, ...(options.precision !== undefined ? { precision: options.precision } : {}), showUnit: options.showUnit, fontSize: options.fontSize };
    return created.map(o => o.type === 'text' ? { ...o, dimLink } : o);
  }
  function place(d: Draft, p: Point) {
    const built = build(d, p); if (!built) return;
    const created = link(d, p, built);
    commitEdit(); dispatch({ type: 'set-objects', objects: [...document.objects, ...created] }); commitEdit();
    setSelection(created.map(o => o.id));
    const label = created.find(o => o.type === 'text');
    if (d.tool === 'callout' && label) { openText(label.id); setMessage('Legenda criada: digite o texto (Esc conclui).'); }
    else setMessage(`Cota: ${label?.text ?? ''}${label?.dimLink ? ' (acompanha o objeto)' : ''}. Ctrl+Z desfaz.`);
    cancel();
  }
  function down(p: Point, pointerId: number, ctrl: boolean) {
    if (!mode) return;
    const s = snap(p) ?? p, d = draft.current;
    if (!d) {
      if (mode === 'dimSegment') {
        const seg = nearestSegment(document.objects, p, 10 / viewport.zoom);
        if (!seg) { setMessage('Cota de segmento: clique sobre uma linha ou curva de um objeto.'); return; }
        draft.current = { tool: mode, points: seg, hover: p, pointer: null, dragged: false }; refresh(null); return;
      }
      draft.current = { tool: mode, points: [s], hover: s, pointer: pointerId, dragged: false }; refresh(null); return;
    }
    if (d.points.length < needed[d.tool]) {
      const last = d.points.at(-1)!, q = ctrl ? constrain(last, s) : s;
      if (Math.hypot(q.x - last.x, q.y - last.y) * viewport.zoom < 2) return;
      d.points.push(q); d.hover = q; refresh(null); return;
    }
    place(d, p);
  }
  function move(p: Point, ctrl: boolean) {
    const s = snap(p), d = draft.current;
    if (d) {
      const need = d.points.length < needed[d.tool], target = need ? s ?? p : p;
      d.hover = need && ctrl ? constrain(d.points.at(-1)!, target) : target;
      if (d.pointer !== null && d.points.length === 1 && Math.hypot(d.hover.x - d.points[0].x, d.hover.y - d.points[0].y) * viewport.zoom > 3) d.dragged = true;
    }
    refresh(s);
  }
  function up(pointerId: number) {
    const d = draft.current;
    if (!d || d.pointer !== pointerId) return;
    d.pointer = null;
    // Arrastou do primeiro ao segundo ponto (cotas lineares): só falta posicionar a linha de cota.
    if (d.dragged && d.points.length === 1 && d.tool !== 'dimAngle') d.points.push(d.hover);
    refresh(state.snap);
  }
  // Pré-visualização: linhas guia até completar os pontos; depois, a própria cota.
  const d = state.draft;
  let preview: { lines: Point[][]; text?: { at: Point; angle: number; value: string } } | null = null;
  if (d) {
    const pts = [...d.points, d.hover];
    if (d.points.length < needed[d.tool]) preview = { lines: [pts] };
    else if (d.tool === 'dimAngle') { const [v, a, b] = d.points, r = Math.hypot(d.hover.x - v.x, d.hover.y - v.y); const a1 = Math.atan2(a.y - v.y, a.x - v.x); let sw = Math.atan2(b.y - v.y, b.x - v.x) - a1; while (sw <= -Math.PI) sw += 2 * Math.PI; while (sw > Math.PI) sw -= 2 * Math.PI; preview = { lines: [[a, v, b], Array.from({ length: 25 }, (_, i) => ({ x: v.x + Math.cos(a1 + sw * i / 24) * r, y: v.y + Math.sin(a1 + sw * i / 24) * r }))], text: { at: { x: v.x + Math.cos(a1 + sw / 2) * r, y: v.y + Math.sin(a1 + sw / 2) * r }, angle: 0, value: formatAngle(Math.abs(sw) * 180 / Math.PI, options) } }; }
    else if (d.tool === 'callout') preview = { lines: [pts] };
    else {
      const [a, b] = d.points, axis = d.tool === 'dimHV' ? axisFor(a, b, d.hover) : undefined, offset = axis ? axisOffset(a, axis, d.hover) : offsetFrom(a, b, d.hover), l = dimensionLines(a, b, offset, axis);
      let angle = Math.atan2(l.u.y, l.u.x) * 180 / Math.PI; if (angle > 90) angle -= 180; else if (angle <= -90) angle += 180;
      preview = { lines: [[a, l.a2], [b, l.b2], [l.a2, l.b2]], text: { at: l.mid, angle, value: formatMeasure(l.length, unit, options) } };
    }
  }
  return { down, move, up, cancel, preview, snap: state.snap, active: () => draft.current !== null, isDragging: () => draft.current?.pointer != null };
}
