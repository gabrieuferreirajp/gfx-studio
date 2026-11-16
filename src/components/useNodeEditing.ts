import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/EditorContext';
import { bendSegment, closestSegmentParameter, convertNode, filletCandidates, filletNeighbors, filletNodes, mirrorEdit, decodePath, encodePath, insertNode, moveHandle, moveNodes, removeNodes, segmentPoints, segmentToCurve, segmentToLine, type EditablePath, type PathGeometry } from '../geometry/nodeGeometry';
import type { Point } from '../geometry/pathGeometry';
import { inverse, matrixOf, transformPoint } from '../geometry/objectTransforms';
import type { MenuItem } from '../workspace/ContextMenu';
import { cropFromGeometry, imageAsPath, withCrop } from '../bitmap/imageCrop';

type Drag = { pointerId: number; objectId: string; start: Point; path: EditablePath; original: PathGeometry; changed: boolean; started: boolean }
  & ({ kind: 'nodes'; indexes: number[]; primary: number } | { kind: 'handle'; index: number; side: 'incoming' | 'outgoing' } | { kind: 'segment'; index: number; t: number } | { kind: 'fillet'; index: number; indexes: number[] });
/** Ferramenta Forma (F10): nós, alças e segmentos, como no CorelDRAW. */
export function useNodeEditing() {
  const { tool, document, selectedId, select, selectedNodes, removeSelected, setSelectedNodes, dispatch, beginEdit, commitEdit, nodeMirror, viewport, setMessage } = useEditor();
  // Bitmap: os nós são os do contorno de recorte (CorelDRAW: Forma sobre a imagem ajusta o corte).
  const raw = document.objects.find(o => o.id === selectedId && (o.type === 'path' || o.type === 'image'));
  const image = raw?.type === 'image' ? raw : null;
  const object = image ? imageAsPath(image) : raw;
  const path = object ? decodePath(object) : { nodes: [], closed: false };
  const drag = useRef<Drag | null>(null);
  const marqueeRef = useRef<{ pointerId: number; start: Point; end: Point; additive: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ start: Point; end: Point } | null>(null);
  const toLocal = (p: Point) => object ? transformPoint(inverse(matrixOf(object)), p) : p;
  const geometryOf = () => ({ x: object!.x, y: object!.y, width: object!.width, height: object!.height, commands: object!.commands, pathSize: object!.pathSize, nodeModes: object!.nodeModes });
  function apply(next: EditablePath, selection: number[] = selectedNodes) {
    if (!object || next === path) return;
    const geometry = encodePath(next);
    if (geometry) { commitEdit(); write(object.id, geometry); commitEdit(); setSelectedNodes(selection.filter(i => i < next.nodes.length)); }
  }
  /** Delete na ferramenta Forma: contornos com menos de 2 nós somem; sem nós, a curva é excluída (CorelDRAW). */
  function remove(indexes: number[]) {
    if (!object || !indexes.length) return;
    const next = removeNodes(path, indexes);
    if (next.nodes.length) { apply(next, []); return; }
    if (image) { setMessage('O recorte do bitmap precisa de ao menos um contorno com 2 nós.'); return; }
    removeSelected(); setSelectedNodes([]); setMessage('Todos os nós excluídos: a curva foi removida. Ctrl+Z desfaz.');
  }
  function write(id: string, geometry: PathGeometry) {
    if (image && id === image.id) dispatch({ type: 'set-objects', objects: document.objects.map(o => o.id === id ? withCrop(o, cropFromGeometry(o, geometry)) : o) });
    else dispatch({ type: 'path-edit', id, geometry });
  }
  function finishMarquee() {
    const m = marqueeRef.current; if (!m) return; marqueeRef.current = null; setMarquee(null);
    if (!object) return;
    const x1 = Math.min(m.start.x, m.end.x), x2 = Math.max(m.start.x, m.end.x), y1 = Math.min(m.start.y, m.end.y), y2 = Math.max(m.start.y, m.end.y);
    if ((x2 - x1) * viewport.zoom < 3 && (y2 - y1) * viewport.zoom < 3) { if (!m.additive) setSelectedNodes([]); return; }
    const inside = path.nodes.flatMap((n, i) => { const p = transformPoint(matrixOf(object), n); return p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2 ? [i] : []; });
    setSelectedNodes(m.additive ? [...new Set([...selectedNodes, ...inside])] : inside);
  }
  function stop() { finishMarquee(); if (drag.current) { if (drag.current.kind === 'fillet' && drag.current.changed) setMessage('Canto arredondado. Ctrl+Z desfaz.'); drag.current = null; commitEdit(); } }
  useEffect(() => { stop(); }, [tool, selectedId]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      // Ctrl+A na ferramenta Forma: marca todos os nós da curva.
      if (tool === 'nodes' && object && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a' && !(event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]'))) {
        event.preventDefault(); event.stopImmediatePropagation(); setSelectedNodes(path.nodes.map((_, i) => i)); setMessage(`${path.nodes.length} nós marcados · Delete apaga · arraste para mover juntos`); return;
      }
      if (tool !== 'nodes' || event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault(); event.stopImmediatePropagation(); stop();
        remove(selectedNodes);
      }
    }
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('blur', stop);
    window.addEventListener('vectorstudio:finish-gesture', stop);
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('blur', stop); window.removeEventListener('vectorstudio:finish-gesture', stop); };
  });
  function down(target: Element, world: Point, pointerId: number, additive = false) {
    const point = toLocal(world);
    const fillet = target.closest('[data-fillet-index]');
    if (fillet && object) {
      // Ponto de arredondar canto: com vários nós marcados, arredonda todos os cantos marcados juntos.
      const index = Number(fillet.getAttribute('data-fillet-index'));
      const indexes = selectedNodes.includes(index) ? selectedNodes.filter(i => filletNeighbors(path, i)) : [index];
      beginEdit(); drag.current = { pointerId, objectId: object.id, start: point, path, original: geometryOf(), changed: false, started: false, kind: 'fillet', index, indexes };
      return;
    }
    const anchor = target.closest('[data-node-index]'), segment = target.closest('[data-segment-index]');
    if (anchor && object) {
      const index = Number(anchor.getAttribute('data-node-index')), side = anchor.getAttribute('data-handle');
      if (!path.nodes[index]) return;
      const base = { pointerId, objectId: object.id, start: point, path, original: geometryOf(), changed: false, started: false };
      if (side === 'incoming' || side === 'outgoing') { setSelectedNodes([index]); beginEdit(); drag.current = { ...base, kind: 'handle', index, side }; return; }
      // Shift ou Ctrl + clique marca/desmarca o nó, sem arrastar.
      if (additive) { setSelectedNodes(selectedNodes.includes(index) ? selectedNodes.filter(i => i !== index) : [...selectedNodes, index]); return; }
      const indexes = selectedNodes.includes(index) ? selectedNodes : [index];
      if (!selectedNodes.includes(index)) setSelectedNodes([index]);
      beginEdit(); drag.current = { ...base, kind: 'nodes', indexes, primary: index }; return;
    }
    if (segment && object && segment.closest('.node-overlay')?.getAttribute('data-object-id') === object.id) {
      // Arrastar o segmento curva o trecho entre os dois nós.
      const index = Number(segment.getAttribute('data-segment-index'));
      beginEdit(); drag.current = { pointerId, objectId: object.id, start: point, path, original: geometryOf(), changed: false, started: false, kind: 'segment', index, t: closestSegmentParameter(path, index, point) };
      return;
    }
    const id = target.closest('[data-object-id]')?.getAttribute('data-object-id');
    if (id && id !== selectedId && document.objects.some(o => o.id === id && (o.type === 'path' || o.type === 'image'))) { select(id); return; }
    // Arrastar no vazio ou por cima da própria curva abre a caixa de seleção de nós (como no CorelDRAW).
    if (object && (!id || id === selectedId || !document.objects.some(o => o.id === id && (o.type === 'path' || o.type === 'image')))) { marqueeRef.current = { pointerId, start: world, end: world, additive }; setMarquee({ start: world, end: world }); return; }
    if (!id) select(null);
  }
  function move(world: Point, pointerId: number, ctrl = false) {
    const m = marqueeRef.current;
    if (m && m.pointerId === pointerId) { m.end = world; setMarquee({ start: m.start, end: world }); return; }
    const g = drag.current;
    if (!g || g.pointerId !== pointerId) return;
    const point = toLocal(world), delta = { x: point.x - g.start.x, y: point.y - g.start.y };
    // Ctrl (CorelDRAW) ou Shift: o nó só anda na horizontal ou na vertical; ao soltar, a restrição continua valendo.
    if (ctrl && g.kind === 'nodes') { if (Math.abs(delta.x) >= Math.abs(delta.y)) delta.y = 0; else delta.x = 0; }
    if (!g.started) { if (Math.hypot(world.x - transformPoint(matrixOf(object!), g.start).x, world.y - transformPoint(matrixOf(object!), g.start).y) * viewport.zoom < 3) return; g.started = true; }
    let next: EditablePath;
    if (g.kind === 'handle') { const h = g.path.nodes[g.index][g.side]!; next = mirrorEdit(g.path, moveHandle(g.path, g.index, g.side, { x: h.x + delta.x, y: h.y + delta.y }), g.index, g.side, nodeMirror.h, nodeMirror.v); }
    else if (g.kind === 'segment') next = bendSegment(g.path, g.index, g.t, delta);
    else if (g.kind === 'fillet') {
      // Distância do canto ao longo do lado de saída (em unidades locais), limitada à metade do lado mais curto.
      const f = filletNeighbors(g.path, g.index)!, n = g.path.nodes[g.index];
      const along = (point.x - n.x) * f.u2.x + (point.y - n.y) * f.u2.y, d = Math.max(0, Math.min(f.max, along));
      next = d > 1e-6 ? filletNodes(g.path, g.indexes, d) : g.path;
      setMessage(`Arredondar canto${g.indexes.length > 1 ? ` (${g.indexes.length} cantos)` : ''}: arraste ao longo do lado · solte para aplicar`);
    }
    else if (g.indexes.length > 1 && (nodeMirror.h || nodeMirror.v)) {
      // Refletir nós (CorelDRAW): o nó arrastado segue o mouse e os outros nós marcados se movem espelhados.
      const others = g.indexes.filter(i => i !== g.primary), mirrored = { x: nodeMirror.h ? -delta.x : delta.x, y: nodeMirror.v ? -delta.y : delta.y };
      next = moveNodes(moveNodes(g.path, [g.primary], delta), others, mirrored);
    }
    else { next = moveNodes(g.path, g.indexes, delta); if (g.indexes.length === 1) next = mirrorEdit(g.path, next, g.primary, null, nodeMirror.h, nodeMirror.v); }
    const geometry = next === g.path ? g.original : encodePath(next);
    if (geometry) { write(g.objectId, geometry); g.changed = true; }
    if (g.kind === 'fillet') setSelectedNodes([]);
  }
  /** Duplo clique: em um nó, apaga o nó; em um segmento, adiciona um nó ali. */
  function doubleClick(target: Element, world: Point) {
    if (tool !== 'nodes' || !object) return;
    stop();
    const anchor = target.closest('[data-node-index]');
    if (anchor && !anchor.getAttribute('data-handle')) {
      remove([Number(anchor.getAttribute('data-node-index'))]);
      return;
    }
    const segment = target.closest('[data-segment-index]');
    if (!segment) return;
    const index = Number(segment.getAttribute('data-segment-index'));
    apply(insertNode(path, index, closestSegmentParameter(path, index, toLocal(world))), [index + 1]);
  }
  /** Menu do botão direito na ferramenta Forma: segmento (curva/linha) e nó (canto/suave/excluir). */
  function contextItems(target: Element, world: Point): MenuItem[] | null {
    if (tool !== 'nodes' || !object) return null;
    const anchor = target.closest('[data-node-index]'), segment = target.closest('[data-segment-index]');
    if (anchor) {
      const index = Number(anchor.getAttribute('data-node-index')), indexes = selectedNodes.includes(index) ? selectedNodes : [index];
      if (!selectedNodes.includes(index)) setSelectedNodes([index]);
      return [
        { label: indexes.length > 1 ? `Excluir ${indexes.length} nós` : 'Excluir nó', key: 'Delete', run: () => remove(indexes) },
        { label: 'Nó de canto (cúspide)', run: () => apply(indexes.reduce((p, i) => convertNode(p, i, 'corner'), path)) },
        { label: 'Nó suave', run: () => apply(indexes.reduce((p, i) => convertNode(p, i, 'smooth'), path)) },
      ];
    }
    if (!segment) return null;
    const index = Number(segment.getAttribute('data-segment-index')), s = segmentPoints(path, index);
    if (!s) return null;
    return [
      { label: 'Para curva (curvar o trecho)', disabled: s.curved, run: () => apply(segmentToCurve(path, index)) },
      { label: 'Para linha', disabled: !s.curved, run: () => apply(segmentToLine(path, index)) },
      { label: 'Adicionar nó aqui', key: 'Duplo clique', run: () => apply(insertNode(path, index, closestSegmentParameter(path, index, toLocal(world))), [index + 1]) },
    ];
  }
  // Pontos de arredondar: sobre o lado de saída de cada canto entre dois lados retos, perto do nó (como no retângulo).
  const candidates = object ? filletCandidates(path) : [];
  const shown = candidates.length <= 80 ? candidates : candidates.filter(i => selectedNodes.includes(i));
  const fillets = object && !drag.current ? shown.map(index => {
    const m = matrixOf(object), n = path.nodes[index], f = filletNeighbors(path, index)!, a = transformPoint(m, n), b = transformPoint(m, f.next);
    // Só em lados com pelo menos 40 px na tela: em lados curtos o ponto ficaria em cima dos nós e roubaria o clique.
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, d = 14 / viewport.zoom;
    return len * viewport.zoom < 40 ? null : { index, x: a.x + (b.x - a.x) / len * d, y: a.y + (b.y - a.y) / len * d };
  }).filter((f): f is { index: number; x: number; y: number } => !!f) : [];
  return { path, object, marquee, fillets, down, move, stop, doubleClick, contextItems, isDragging: () => drag.current !== null || marqueeRef.current !== null };
}
