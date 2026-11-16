import { useSyncExternalStore } from 'react';
import { useEditor } from '../state/EditorContext';
import type { MeshFill, VectorObject } from '../document/model';
import type { Point } from '../geometry/pathGeometry';
import { matrixOf, selectionIds, transformPoint } from '../geometry/objectTransforms';
import { defaultMesh, meshFillOf, meshNodes, meshPixels, meshSize } from '../document/patterns';

/** Nós da malha selecionados (compartilhado entre a tela, a paleta e a barra de propriedades). */
let selectedNodes: number[] = [];
const listeners = new Set<() => void>();
export const meshSelection = {
  get: () => selectedNodes,
  set: (nodes: number[]) => { selectedNodes = nodes; listeners.forEach(l => l()); },
  subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
};
export const useMeshSelection = () => useSyncExternalStore(meshSelection.subscribe, meshSelection.get);
/** Gera a imagem PNG da malha (interpolação suave das cores dos nós). */
export function meshImage(mesh: Omit<MeshFill, 'src'>): MeshFill {
  const { width, height } = meshSize(mesh), canvas = window.document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!, image = context.createImageData(width, height);
  image.data.set(meshPixels(mesh, width, height)); context.putImageData(image, 0, 0);
  return { ...mesh, src: canvas.toDataURL('image/png') };
}
export const meshTarget = (objects: VectorObject[], ids: string[]) => ids.length === 1 ? objects.find(o => o.id === ids[0] && (o.type === 'rectangle' || o.type === 'ellipse' || o.type === 'path') && !o.locked) : undefined;
/** Muda a malha do objeto (cores, linhas ou colunas) numa etapa do Desfazer. */
export function useMeshCommands() {
  const { document, selectedIds, dispatch, commitEdit, setMessage } = useEditor();
  const target = meshTarget(document.objects, selectedIds);
  const set = (mesh: Omit<MeshFill, 'src'> | null) => {
    if (!target) return;
    commitEdit();
    dispatch({ type: 'set-objects', objects: document.objects.map(o => o.id !== target.id ? o : mesh ? meshFillOf(o, meshImage(mesh)) : (({ meshFill: _m, ...rest }) => rest)(o)) });
    commitEdit();
    if (!mesh) { meshSelection.set([]); setMessage('Malha removida (fica a cor média).'); }
  };
  /** Cor nos nós selecionados (paleta ou seletor); devolve false se não há nós escolhidos. */
  const paintNodes = (color: string) => {
    const mesh = target?.meshFill, nodes = meshSelection.get();
    if (!mesh || !nodes.length || color === 'none') return false;
    set({ ...mesh, colors: mesh.colors.map((c, i) => nodes.includes(i) ? color : c) });
    return true;
  };
  return { target, set, paintNodes };
}
/**
 * Preenchimento de malha (CorelDRAW): clique numa forma para criar a malha (2 × 2) e mostrar os nós; clique nos nós
 * (Shift/Ctrl soma) e escolha uma cor na paleta. Linhas e colunas na barra de propriedades.
 */
export function useMeshTool() {
  const { tool, document, setSelection, setMessage, viewport, dispatch, commitEdit } = useEditor(), commands = useMeshCommands(), nodes = useMeshSelection();
  const target = tool === 'mesh' ? commands.target : undefined;
  function down(element: Element, _p: Point, clickedId: string | null, additive: boolean) {
    const node = element.closest('[data-mesh-node]')?.getAttribute('data-mesh-node');
    if (node != null && target) { const i = Number(node); meshSelection.set(additive ? (nodes.includes(i) ? nodes.filter(n => n !== i) : [...nodes, i]) : [i]); return; }
    meshSelection.set([]);
    if (!clickedId) { setSelection([]); return; }
    const o = document.objects.find(x => x.id === clickedId);
    if (!o || (o.type !== 'rectangle' && o.type !== 'ellipse' && o.type !== 'path')) { setSelection(selectionIds(document.objects, clickedId)); setMessage('A malha se aplica a retângulos, elipses e curvas (textos: Ctrl+Q antes).'); return; }
    setSelection([o.id]);
    if (!o.meshFill) {
      const mesh = meshImage(defaultMesh(o.fill === 'none' ? '#ffffff' : o.fill));
      commitEdit(); dispatch({ type: 'set-objects', objects: document.objects.map(x => x.id === o.id ? meshFillOf(x, mesh) : x) }); commitEdit();
    }
    setMessage('Malha: clique nos nós (Shift soma) e escolha a cor na paleta.');
  }
  const z = viewport.zoom, mesh = target?.meshFill;
  const element = target && mesh ? <g className="mesh-nodes">{(() => {
    const m = matrixOf(target), pts = meshNodes(target, mesh).map(p => transformPoint(m, p)), cols = mesh.cols + 1;
    const lines = [...Array.from({ length: mesh.rows + 1 }, (_, r) => pts.slice(r * cols, r * cols + cols)), ...Array.from({ length: cols }, (_, c) => pts.filter((_, i) => i % cols === c))];
    return <>{lines.map((l, i) => <polyline key={`l${i}`} points={l.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#1f6fd1" strokeOpacity={0.6} strokeWidth={1 / z} strokeDasharray={`${4 / z} ${3 / z}`} pointerEvents="none" />)}
      {pts.map((p, i) => <rect key={i} data-mesh-node={i} x={p.x - 5 / z} y={p.y - 5 / z} width={10 / z} height={10 / z} fill={mesh.colors[i]} stroke={nodes.includes(i) ? '#e8465e' : '#1f6fd1'} strokeWidth={(nodes.includes(i) ? 2.4 : 1.2) / z}><title>{`Nó ${i + 1}: ${mesh.colors[i].toUpperCase()} · clique e escolha a cor na paleta`}</title></rect>)}</>;
  })()}</g> : null;
  return { active: tool === 'mesh', down, element };
}
