import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useEditor } from '../state/EditorContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import type { Point } from '../geometry/pathGeometry';

export const cutTools = ['crop', 'knife', 'eraser', 'virtualDelete', 'lasso'] as const;
/** Laço poligonal: manter o que fica dentro ou apagar o que fica dentro (barra de propriedades). */
let lassoMode: 'keep' | 'remove' = 'keep';
const lassoListeners = new Set<() => void>();
const lassoStore = { get: () => lassoMode, set: (m: 'keep' | 'remove') => { lassoMode = m; lassoListeners.forEach(l => l()); }, subscribe: (l: () => void) => { lassoListeners.add(l); return () => { lassoListeners.delete(l); }; } };
export function LassoControls() {
  const mode = useSyncExternalStore(lassoStore.subscribe, lassoStore.get);
  return <span className="tool-options">
    <span className="segmented" role="group" aria-label="O que fazer com a área do laço">
      <button type="button" aria-pressed={mode === 'keep'} title="Mantém só o que fica dentro do laço (corta o resto)" onClick={() => lassoStore.set('keep')}>Manter dentro</button>
      <button type="button" aria-pressed={mode === 'remove'} title="Apaga o que fica dentro do laço (abre um buraco)" onClick={() => lassoStore.set('remove')}>Apagar dentro</button>
    </span>
    <span className="context-page">Clique: ponto reto · arraste: trecho livre · 1º ponto, duplo clique ou Enter fecha · Esc cancela · sem seleção: toda a página</span>
  </span>;
}
type Draft = { pointerId: number; start: Point; end: Point; points: Point[] };
/**
 * Grupo Cortar (CorelDRAW): Cortar arrasta um retângulo; Faca arrasta uma linha (Ctrl: 15°);
 * Borracha arrasta um pincel (espessura na barra de propriedades); Excluir segmento virtual clica no trecho.
 * Sem seleção, atuam em todos os objetos desbloqueados da página.
 */
export function useCutTools() {
  const { tool, cutCommand, viewport } = useEditor(), { layout } = useWorkspace();
  const draft = useRef<Draft | null>(null), [preview, setPreview] = useState<Draft | null>(null);
  const active = (cutTools as readonly string[]).includes(tool);
  // Laço poligonal (como no Photoshop): pontos clicados e trechos arrastados, fechado no primeiro ponto.
  const lasso = useRef<{ points: Point[]; pointerId: number | null } | null>(null), [lassoView, setLassoView] = useState<{ points: Point[]; hover: Point | null } | null>(null);
  const lassoHover = useRef<Point | null>(null);
  const showLasso = () => setLassoView(lasso.current ? { points: [...lasso.current.points], hover: lassoHover.current } : null);
  const cancelLasso = () => { lasso.current = null; lassoHover.current = null; setLassoView(null); };
  function completeLasso() {
    const l = lasso.current; cancelLasso();
    const points = l?.points.filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-6) ?? [];
    if (points.length < 3) return;
    void cutCommand('crop', { lasso: { points, mode: lassoStore.get() } });
  }
  useEffect(() => { if (tool !== 'lasso') cancelLasso(); }, [tool]);
  useEffect(() => {
    if (tool !== 'lasso') return;
    const key = (e: KeyboardEvent) => {
      const l = lasso.current;
      if (!l || (e.target instanceof HTMLElement && e.target.closest('input, textarea, select'))) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancelLasso(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); completeLasso(); }
      else if (e.key === 'Backspace' && l.points.length > 1) { e.preventDefault(); e.stopImmediatePropagation(); l.points.pop(); showLasso(); }
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  });
  function down(p: Point, pointerId: number, targetId: string | null) {
    if (tool === 'lasso') {
      const l = lasso.current;
      if (l && l.points.length >= 3 && Math.hypot(p.x - l.points[0].x, p.y - l.points[0].y) * viewport.zoom <= 8) { completeLasso(); return false; }
      if (l) { l.points.push(p); l.pointerId = pointerId; } else lasso.current = { points: [p], pointerId };
      showLasso(); return true;
    }
    if (tool === 'virtualDelete') { if (targetId) void cutCommand('virtualDelete', { point: p }, targetId); return false; }
    draft.current = { pointerId, start: p, end: p, points: [p] }; setPreview(draft.current); return true;
  }
  function move(p: Point, pointerId: number, ctrl: boolean) {
    if (tool === 'lasso') {
      const l = lasso.current; if (!l) return;
      lassoHover.current = p;
      // Arrastando com o botão apertado: trecho à mão livre.
      if (l.pointerId === pointerId) { const last = l.points.at(-1)!; if (Math.hypot(p.x - last.x, p.y - last.y) * viewport.zoom >= 3 && l.points.length < 5000) l.points.push(p); }
      showLasso(); return;
    }
    const d = draft.current; if (!d || d.pointerId !== pointerId) return;
    let end = p;
    if (tool === 'knife' && ctrl) { const a = Math.atan2(p.y - d.start.y, p.x - d.start.x), step = Math.PI / 12, r = Math.hypot(p.x - d.start.x, p.y - d.start.y), k = Math.round(a / step) * step; end = { x: d.start.x + r * Math.cos(k), y: d.start.y + r * Math.sin(k) }; }
    const last = d.points.at(-1)!;
    draft.current = { ...d, end, points: tool === 'eraser' && Math.hypot(p.x - last.x, p.y - last.y) * viewport.zoom >= 2 && d.points.length < 5000 ? [...d.points, p] : d.points };
    setPreview(draft.current);
  }
  function up(pointerId: number) {
    if (tool === 'lasso') { if (lasso.current && lasso.current.pointerId === pointerId) lasso.current.pointerId = null; return; }
    const d = draft.current; if (!d || d.pointerId !== pointerId) return;
    draft.current = null; setPreview(null);
    const tiny = Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y) * viewport.zoom < 3;
    if (tool === 'crop') { if (tiny) return; void cutCommand('crop', { crop: { x: Math.min(d.start.x, d.end.x), y: Math.min(d.start.y, d.end.y), width: Math.abs(d.end.x - d.start.x), height: Math.abs(d.end.y - d.start.y) } }); }
    else if (tool === 'knife') { if (tiny) return; void cutCommand('knife', { knife: { a: d.start, b: d.end } }); }
    else if (tool === 'eraser') void cutCommand('erase', { erase: { points: d.points, radius: layout.eraserSize / 2 } });
  }
  const z = viewport.zoom, d = preview;
  if (tool === 'lasso') {
    const v = lassoView, line = v ? [...v.points, ...(v.hover ? [v.hover] : [])].map(p => `${p.x},${p.y}`).join(' ') : '';
    const closing = !!v && !!v.hover && v.points.length >= 3 && Math.hypot(v.hover.x - v.points[0].x, v.hover.y - v.points[0].y) * z <= 8;
    const element = v ? <g pointerEvents="none" className="cut-preview">
      <polygon points={line} fill="#1f6fd1" fillOpacity={0.08} stroke="none" />
      <polyline points={line} fill="none" stroke="#ffffff" strokeWidth={3 / z} />
      <polyline points={line} fill="none" stroke="#1f1f1f" strokeWidth={1.2 / z} strokeDasharray={`${5 / z} ${3 / z}`} />
      <circle cx={v.points[0].x} cy={v.points[0].y} r={(closing ? 7 : 4) / z} fill={closing ? '#1f6fd1' : '#ffffff'} stroke="#1f1f1f" strokeWidth={1 / z} />
    </g> : null;
    return { active, down, move, up, complete: completeLasso, isDragging: () => lasso.current !== null && lasso.current.pointerId !== null, element };
  }
  const element = active && d ? <g pointerEvents="none" className="cut-preview">
    {tool === 'crop' && <rect x={Math.min(d.start.x, d.end.x)} y={Math.min(d.start.y, d.end.y)} width={Math.abs(d.end.x - d.start.x)} height={Math.abs(d.end.y - d.start.y)} fill="#1f6fd1" fillOpacity={0.06} stroke="#1f6fd1" strokeWidth={1 / z} strokeDasharray={`${4 / z} ${3 / z}`} />}
    {tool === 'knife' && <line x1={d.start.x} y1={d.start.y} x2={d.end.x} y2={d.end.y} stroke="#e8465e" strokeWidth={1.5 / z} strokeDasharray={`${6 / z} ${3 / z}`} />}
    {tool === 'eraser' && <polyline points={d.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#e8465e" strokeOpacity={0.35} strokeWidth={layout.eraserSize} strokeLinecap="round" strokeLinejoin="round" />}
  </g> : null;
  return { active, down, move, up, complete: completeLasso, isDragging: () => !!draft.current, element };
}
