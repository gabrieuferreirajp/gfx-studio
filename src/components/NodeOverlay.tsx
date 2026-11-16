import { segmentPoints, type EditablePath } from '../geometry/nodeGeometry';
import { identity, transformEditablePath, type Matrix } from '../geometry/objectTransforms';

export function NodeOverlay({ path: source, objectId, selectedNodes, zoom, matrix=identity(), fillets=[] }: { path: EditablePath; objectId: string; selectedNodes: number[]; zoom: number; matrix?: Matrix; fillets?: { index: number; x: number; y: number }[] }) {
  const path=transformEditablePath(source,matrix);
  return <g className="node-overlay" data-object-id={objectId} stroke="#7165e8" fill="none">
    {path.nodes.map((_, i) => {
      const s = segmentPoints(path, i);
      if (!s) return null;
      const d = `M ${s.a.x} ${s.a.y} ${s.curved ? `C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.b.x} ${s.b.y}` : `L ${s.b.x} ${s.b.y}`}`;
      return <g key={i}><path d={d} stroke="#fff" strokeWidth={3 / zoom} pointerEvents="none" /><path d={d} strokeWidth={1.2 / zoom} pointerEvents="none" /><path data-segment-index={i} d={d} stroke="transparent" strokeWidth={12 / zoom} pointerEvents="stroke"><title>Arraste para curvar · Duplo clique: adicionar nó · Botão direito: Para curva / Para linha</title></path></g>;
    })}
    {path.nodes.map((node, i) => <g key={i}>
      {(['incoming', 'outgoing'] as const).map(side => {
        const handle = node[side];
        return handle && <g key={side}><line x1={node.x} y1={node.y} x2={handle.x} y2={handle.y} strokeWidth={1 / zoom} pointerEvents="none" /><circle data-node-index={i} data-handle={side} cx={handle.x} cy={handle.y} r={4 / zoom} fill="white" strokeWidth={1.5 / zoom}><title>Arrastar alça Bézier</title></circle></g>;
      })}
    </g>)}
    {/* Pontos de arredondar ficam por baixo dos nós: o clique no nó sempre vale para o nó. */}
    {fillets.map(f => <circle key={`f${f.index}`} className="fillet-handle" data-fillet-index={f.index} cx={f.x} cy={f.y} r={4.5 / zoom} fill="white" stroke="#2b7de9" strokeWidth={1.5 / zoom}><title>Arraste ao longo do lado para arredondar o canto (com vários nós marcados, arredonda todos)</title></circle>)}
    {path.nodes.map((node, i) => <rect key={i} data-node-index={i} x={node.x - 4 / zoom} y={node.y - 4 / zoom} width={8 / zoom} height={8 / zoom} rx={node.mode !== 'corner' ? 4 / zoom : 0} fill={selectedNodes.includes(i) ? '#7165e8' : 'white'} strokeWidth={1.5 / zoom}><title>{`Nó ${i + 1} · ${node.mode === 'smooth' ? 'Suave' : node.mode === 'symmetric' ? 'Simétrico' : 'Canto'} · Shift/Ctrl+clique: marcar/desmarcar · Duplo clique: apagar`}</title></rect>)}
  </g>;
}
