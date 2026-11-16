import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useEditor } from '../state/EditorContext';
import type { Shadow, VectorObject } from '../document/model';
import type { Point } from '../geometry/pathGeometry';
import { commandsToSvg, mapCommands } from '../geometry/pathGeometry';
import { worldCommands } from '../geometry/worldGeometry';
import { outlineDistance } from '../geometry/hitTest';
import { boundsOf } from '../geometry/objectTransforms';
import { effectSource, linkedPieces } from '../geometry/effectLinks';
import { fromUnit, toUnit, unitDefinitions } from '../document/units';
import { LevelSlider } from './LevelSlider';
import { PenIcon } from '../workspace/OutlineDialog';

/**
 * Ferramentas interativas Sombra, Contorno e Bloquear sombra (CorelDRAW): arraste a partir do objeto e veja onde
 * o efeito vai ficar. Sombra: arraste até onde a sombra deve ir. Bloquear sombra: arraste na direção e no
 * comprimento da sombra. Contorno: arraste para fora (ou para dentro) da forma até a distância desejada.
 * Opções (cor, opacidade, desfoque, passos…) ficam na barra de propriedades.
 */
export const effectTools = ['dropShadow', 'contour', 'blockShadow'] as const;
type EffectTool = typeof effectTools[number];
export interface EffectToolOptions { opacity: number; blur: number; shadowColor: string; blockColor: string; steps: number; endColor: string; corners: 'miter' | 'round' | 'bevel' }
let options: EffectToolOptions = { opacity: 0.5, blur: 6, shadowColor: '#000000', blockColor: '#000000', steps: 1, endColor: '#000000', corners: 'miter' };
const listeners = new Set<() => void>();
export const effectToolStore = {
  get: () => options,
  set: (patch: Partial<EffectToolOptions>) => { options = { ...options, ...patch }; listeners.forEach(l => l()); },
  subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
};
const useOptions = () => useSyncExternalStore(effectToolStore.subscribe, effectToolStore.get);
const shapeLike = (o: VectorObject) => o.type === 'rectangle' || o.type === 'ellipse' || o.type === 'path';
const center = (o: VectorObject) => { const b = boundsOf([o]); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

type Drag = { pointerId: number; id: string; start: Point; base: Point; end: Point; moved: boolean };
export function useEffectTools() {
  const { tool, document, dispatch, beginEdit, commitEdit, selectedIds, setSelection, setMessage, viewport, linkedEffect } = useEditor();
  const kind = (effectTools as readonly string[]).includes(tool) ? tool as EffectTool : null;
  const drag = useRef<Drag | null>(null), [preview, setPreview] = useState<Drag | null>(null);
  useEffect(() => { drag.current = null; setPreview(null); }, [tool]);
  const z = viewport.zoom;
  // Objeto do efeito: o original selecionado (selecionar a sombra ou o contorno conta como o original).
  const selected = document.objects.filter(o => selectedIds.includes(o.id)).map(o => effectSource(document.objects, o)).find((o): o is VectorObject => !!o) ?? null;
  const blockLink = selected && linkedPieces(document.objects, selected.id, 'blockShadow')[0]?.effectOf;
  /** Ponta da seta do efeito atual (arrastar a ponta ajusta o efeito existente). */
  const handle = !selected ? null : kind === 'dropShadow' && selected.shadow ? { x: center(selected).x + selected.shadow.x, y: center(selected).y + selected.shadow.y }
    : kind === 'blockShadow' && blockLink ? { x: center(selected).x + (blockLink.dx ?? 0), y: center(selected).y + (blockLink.dy ?? 0) } : null;

  function down(p: Point, pointerId: number, targetId: string | null): boolean {
    if (!kind) return false;
    if (handle && selected && Math.hypot(p.x - handle.x, p.y - handle.y) * z <= 9) {
      const base = kind === 'dropShadow' ? { x: selected.shadow!.x, y: selected.shadow!.y } : { x: blockLink!.dx ?? 0, y: blockLink!.dy ?? 0 };
      if (kind === 'dropShadow') beginEdit();
      drag.current = { pointerId, id: selected.id, start: p, base, end: p, moved: false }; setPreview(drag.current); return true;
    }
    // Formas sem preenchimento: o clique no interior também vale (como no CorelDRAW, a seta pode sair do centro).
    const inside = [...document.objects].reverse().find(o => shapeLike(o) && !o.locked && outlineDistance(o, p).inside);
    const target = document.objects.find(o => o.id === targetId) ?? inside, source = target ? effectSource(document.objects, target) : null;
    if (!source) { setSelection([]); return false; }
    if (kind !== 'dropShadow' && !shapeLike(source)) { setSelection([source.id]); setMessage('Bloquear sombra e Contorno aceitam retângulos, elipses e curvas fechadas. Converta textos em curvas (Ctrl+Q).'); return false; }
    setSelection([source.id]);
    if (kind === 'dropShadow') beginEdit();
    drag.current = { pointerId, id: source.id, start: p, base: { x: 0, y: 0 }, end: p, moved: false }; setPreview(drag.current); return true;
  }
  const vector = (d: Drag) => ({ x: d.base.x + d.end.x - d.start.x, y: d.base.y + d.end.y - d.start.y });
  function move(p: Point, pointerId: number) {
    const d = drag.current; if (!d || d.pointerId !== pointerId) return;
    d.end = p; if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * z >= 3) d.moved = true;
    setPreview({ ...d });
    if (kind === 'dropShadow' && d.moved) {
      // Sombra projetada aparece ao vivo enquanto arrasta.
      const v = vector(d), o = effectToolStore.get(), current = document.objects.find(x => x.id === d.id);
      const shadow: Shadow = { x: v.x, y: v.y, blur: current?.shadow?.blur ?? o.blur, color: current?.shadow?.color ?? o.shadowColor, opacity: current?.shadow?.opacity ?? o.opacity };
      dispatch({ type: 'set-objects', objects: document.objects.map(x => x.id === d.id ? { ...x, shadow } : x) });
    }
  }
  function up(pointerId: number) {
    const d = drag.current; if (!d || d.pointerId !== pointerId) return;
    drag.current = null; setPreview(null);
    if (kind === 'dropShadow') { commitEdit(); if (d.moved) setMessage('Sombra aplicada: arraste a ponta para mudar a direção; opacidade, desfoque e cor na barra de propriedades. Ctrl+Z desfaz.'); return; }
    if (!d.moved) return;
    const source = document.objects.find(o => o.id === d.id); if (!source) return;
    if (kind === 'blockShadow') { const v = vector(d); void linkedEffect('blockShadow', [d.id], { dx: v.x, dy: v.y, color: blockLink?.color ?? effectToolStore.get().blockColor }); return; }
    const contour = contourFrom(source, d.end);
    if (contour) void linkedEffect('contour', [d.id], contour);
  }
  function contourFrom(source: VectorObject, p: Point) {
    const { distance, inside } = outlineDistance(source, p), o = effectToolStore.get();
    if (!(distance > 0.01)) return null;
    return { direction: inside ? 'inside' as const : 'outside' as const, steps: o.steps, offset: distance / o.steps, endColor: o.endColor, corners: o.corners };
  }
  const d = preview, source = d && document.objects.find(o => o.id === d.id);
  let element = null;
  if (kind) {
    const arrow = (a: Point, b: Point) => { const ang = Math.atan2(b.y - a.y, b.x - a.x), s = 9 / z; return <g><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#1f1f1f" strokeWidth={1.2 / z} /><path d={`M${b.x} ${b.y}L${b.x - s * Math.cos(ang - 0.4)} ${b.y - s * Math.sin(ang - 0.4)}L${b.x - s * Math.cos(ang + 0.4)} ${b.y - s * Math.sin(ang + 0.4)}Z`} fill="#1f1f1f" /></g>; };
    const knob = (p: Point) => <rect x={p.x - 5 / z} y={p.y - 5 / z} width={10 / z} height={10 / z} fill="#262935" stroke="white" strokeWidth={1 / z}><title>Arraste para mudar a direção e o comprimento</title></rect>;
    let body = null;
    if (d && source && d.moved) {
      const v = vector(d), c = center(source), from = { x: c.x, y: c.y }, to = { x: c.x + v.x, y: c.y + v.y };
      if (kind === 'blockShadow') body = <>{<path d={commandsToSvg(mapCommands(worldCommands(source), q => ({ x: q.x + v.x, y: q.y + v.y })))} fill="none" stroke="#1f6fd1" strokeWidth={1.2 / z} />}{arrow(from, to)}{knob(to)}</>;
      else if (kind === 'dropShadow') body = <>{arrow(from, to)}{knob(to)}</>;
      else {
        const contour = contourFrom(source, d.end), path = commandsToSvg(worldCommands(source)), total = contour ? contour.offset * contour.steps : 0;
        if (contour) {
          const id = `contour-preview-${source.id}`, b = boundsOf([source]), pad = total + 10;
          body = <>
            {contour.direction === 'inside' ? <clipPath id={id}><path d={path} /></clipPath> : <mask id={id} maskUnits="userSpaceOnUse" x={b.x - pad} y={b.y - pad} width={b.width + 2 * pad} height={b.height + 2 * pad}><rect x={b.x - pad} y={b.y - pad} width={b.width + 2 * pad} height={b.height + 2 * pad} fill="white" /><path d={path} fill="black" /></mask>}
            <g {...(contour.direction === 'inside' ? { clipPath: `url(#${id})` } : { mask: `url(#${id})` })}>
              {Array.from({ length: contour.steps }, (_, i) => <path key={i} d={path} fill="none" stroke="#1f6fd1" strokeOpacity={0.9} strokeWidth={2 * contour.offset * (i + 1)} strokeLinejoin="round" opacity={0.18} />)}
            </g>
            <line x1={d.start.x} y1={d.start.y} x2={d.end.x} y2={d.end.y} stroke="#1f1f1f" strokeWidth={1 / z} strokeDasharray={`${4 / z} ${3 / z}`} />
            <text x={d.end.x + 10 / z} y={d.end.y - 8 / z} fontSize={12 / z} fontFamily="Segoe UI, sans-serif" fill="#262935" stroke="white" strokeWidth={3 / z} paintOrder="stroke">{`${contour.direction === 'inside' ? 'Para dentro' : 'Para fora'} · ${contour.steps} passo(s) · ${toUnit(total, document.unit ?? 'px').toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unitDefinitions[document.unit ?? 'px'].short}`}</text>
          </>;
        }
      }
    } else if (handle && selected) body = <>{arrow(center(selected), handle)}<g data-effect-handle="end">{knob(handle)}</g></>;
    element = body && <g className="effect-tool-preview" pointerEvents="none">{body}</g>;
  }
  return { active: !!kind, down, move, up, isDragging: () => !!drag.current, element };
}

/** Barra de propriedades das ferramentas Sombra, Contorno e Bloquear sombra. */
export function EffectToolControls({ tool }: { tool: EffectTool }) {
  const o = useOptions(), { document, selectedIds, dispatch, beginEdit, commitEdit, linkedEffect, breakApartCommand, booleanBusy } = useEditor();
  const unit = document.unit ?? 'px', short = unitDefinitions[unit].short;
  const sources = [...new Map(document.objects.filter(x => selectedIds.includes(x.id)).map(x => effectSource(document.objects, x)).filter((x): x is VectorObject => !!x).map(x => [x.id, x])).values()];
  const update = (map: (x: VectorObject) => VectorObject) => { commitEdit(); dispatch({ type: 'set-objects', objects: document.objects.map(map) }); commitEdit(); };
  const contourTimer = useRef<number | null>(null);
  if (tool === 'dropShadow') {
    const shadowed = sources.filter(x => x.shadow), current = shadowed[0]?.shadow;
    const set = (patch: Partial<Shadow & EffectToolOptions>, live = false) => {
      effectToolStore.set({ ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {}), ...(patch.blur !== undefined ? { blur: patch.blur } : {}), ...(patch.color !== undefined ? { shadowColor: patch.color } : {}) });
      const ids = new Set(shadowed.map(x => x.id));
      // Durante o arraste da régua: um único passo no Desfazer (começa no pointerdown, fecha no pointerup).
      if (ids.size) (live ? (map: (x: VectorObject) => VectorObject) => dispatch({ type: 'set-objects', objects: document.objects.map(map) }) : update)(x => ids.has(x.id) ? { ...x, shadow: { ...x.shadow!, ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {}), ...(patch.blur !== undefined ? { blur: patch.blur } : {}), ...(patch.color !== undefined ? { color: patch.color } : {}) } } : x);
    };
    const opacity = current?.opacity ?? o.opacity, blur = current?.blur ?? o.blur, color = current?.color ?? o.shadowColor;
    return <span className="tool-options effect-tool-options">
      <label title="Opacidade da sombra (arraste a régua)">Opacidade<LevelSlider aria-label="Opacidade da sombra" value={Math.round(opacity * 100)} onPointerDown={beginEdit} onPointerUp={commitEdit} onKeyUp={commitEdit} onChange={e => set({ opacity: Number(e.target.value) / 100 }, true)} /><input type="number" className="level-number" aria-label="Opacidade da sombra em %" min={0} max={100} value={Math.round(opacity * 100)} onChange={e => { const v = Number(e.target.value); if (v >= 0 && v <= 100) set({ opacity: v / 100 }); }} /><span>%</span></label>
      <label title="Desfoque (suavização) da borda da sombra">Desfoque<input type="number" min={0} step="any" value={Math.round(toUnit(blur, unit) * 100) / 100} onChange={e => { const v = fromUnit(Number(e.target.value), unit); if (Number.isFinite(v) && v >= 0 && v <= 500) set({ blur: v }); }} /><span>{short}</span></label>
      <label title="Cor da sombra">Cor<input type="color" value={color} onChange={e => set({ color: e.target.value })} /></label>
      <button type="button" disabled={!shadowed.length} title="Separar Grupo de sombra (Ctrl+K): a sombra vira um objeto próprio" onClick={breakApartCommand}>Separar</button>
      <button type="button" disabled={!shadowed.length} title="Remove a sombra dos objetos selecionados" onClick={() => { const ids = new Set(shadowed.map(x => x.id)); update(x => ids.has(x.id) ? (({ shadow: _, ...rest }) => rest)(x) : x); }}>Limpar sombra</button>
      {!shadowed.length && <span className="context-page">Arraste a partir do objeto até onde a sombra deve ficar</span>}
    </span>;
  }
  if (tool === 'blockShadow') {
    const pieces = sources.flatMap(s => linkedPieces(document.objects, s.id, 'blockShadow')), color = pieces[0]?.effectOf?.color ?? o.blockColor;
    const setColor = (value: string) => { effectToolStore.set({ blockColor: value }); const ids = new Set(pieces.map(x => x.id)); if (ids.size) update(x => ids.has(x.id) ? { ...x, fill: value, effectOf: { ...x.effectOf!, color: value } } : x); };
    return <span className="tool-options effect-tool-options">
      <label title="Cor da sombra">Cor<input type="color" value={color} onChange={e => setColor(e.target.value)} /></label>
      <button type="button" disabled={!pieces.length} title="Separar Bloquear sombra (Ctrl+K): a sombra vira um objeto independente" onClick={breakApartCommand}>Separar</button>
      <button type="button" disabled={!pieces.length} title="Remove a sombra" onClick={() => { const ids = new Set(pieces.map(x => x.id)); commitEdit(); dispatch({ type: 'set-objects', objects: document.objects.filter(x => !ids.has(x.id)) }); commitEdit(); }}>Limpar</button>
      {!pieces.length && <span className="context-page">Arraste a partir do objeto na direção da sombra</span>}
    </span>;
  }
  const pieces = sources.flatMap(s => linkedPieces(document.objects, s.id, 'contour')), link = pieces[0]?.effectOf;
  const steps = link?.steps ?? o.steps, endColor = link?.endColor ?? o.endColor, corners = link ? link.corners ?? 'round' : o.corners;
  // Mudanças nos números refazem o contorno existente (com uma pequena espera enquanto digita).
  const redo = (patch: { direction?: 'outside' | 'inside'; steps?: number; offset?: number; endColor?: string; corners?: 'miter' | 'round' | 'bevel' }) => {
    if (!link) return;
    const params = { direction: link.direction ?? 'outside', steps: link.steps ?? 1, offset: link.offset ?? 4, endColor: link.endColor ?? '#ffffff', corners: link.corners ?? 'round', ...patch };
    if (contourTimer.current) window.clearTimeout(contourTimer.current);
    contourTimer.current = window.setTimeout(() => void linkedEffect('contour', [link.id], params), 300);
  };
  return <span className="tool-options effect-tool-options">
    <span className="segmented" role="group" aria-label="Direção do contorno">
      <button type="button" aria-pressed={link?.direction === 'inside'} disabled={!link || booleanBusy} title="Contorno para dentro" onClick={() => redo({ direction: 'inside' })}>Para dentro</button>
      <button type="button" aria-pressed={link?.direction === 'outside'} disabled={!link || booleanBusy} title="Contorno para fora" onClick={() => redo({ direction: 'outside' })}>Para fora</button>
    </span>
    <span className="pen-choices" role="radiogroup" aria-label="Cantos do contorno" title="Cantos do contorno">{([['miter', 'Cantos retos (esquadria)'], ['round', 'Cantos arredondados'], ['bevel', 'Cantos chanfrados']] as const).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={corners === value} className={`command-icon pen-choice ${corners === value ? 'active' : ''}`} aria-label={label} title={label} disabled={booleanBusy} onClick={() => { effectToolStore.set({ corners: value }); redo({ corners: value }); }}><PenIcon kind={value} /></button>)}</span>
    <label title="Número de passos do contorno">Passos<input type="number" min={1} max={30} value={steps} onChange={e => { const v = Math.round(Number(e.target.value)); if (v >= 1 && v <= 30) { effectToolStore.set({ steps: v }); redo({ steps: v }); } }} /></label>
    <label title="Distância entre os passos">Distância<input type="number" min={0} step="any" disabled={!link} value={link ? Math.round(toUnit(link.offset ?? 4, unit) * 100) / 100 : ''} onChange={e => { const v = fromUnit(Number(e.target.value), unit); if (Number.isFinite(v) && v > 0.01 && v < 5000) redo({ offset: v }); }} /><span>{short}</span></label>
    <label title="Cor do contorno (com vários passos, a cor do último; os do meio são misturados)">Cor<input type="color" value={endColor} onChange={e => { effectToolStore.set({ endColor: e.target.value }); redo({ endColor: e.target.value }); }} /></label>
    <button type="button" disabled={!pieces.length} title="Separar Grupo de contorno (Ctrl+K)" onClick={breakApartCommand}>Separar</button>
    <button type="button" disabled={!pieces.length} title="Remove o contorno" onClick={() => { const ids = new Set(pieces.map(x => x.id)); commitEdit(); dispatch({ type: 'set-objects', objects: document.objects.filter(x => !ids.has(x.id)) }); commitEdit(); }}>Limpar</button>
    {!link && <span className="context-page">Arraste da forma para fora (ou para dentro) até a distância desejada</span>}
  </span>;
}
