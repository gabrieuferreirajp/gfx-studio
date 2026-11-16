import { transformPoint, type Bounds, type Matrix } from '../geometry/objectTransforms';
export type TransformMode = 'scale' | 'rotate';
/**
 * Moldura de seleção como no CorelDRAW (só as alças pretas pequenas e o × central, sem linhas): no 1º clique, alças de escala; clicando de novo no objeto,
 * setas curvas nos cantos (girar) e setas retas nos lados (inclinar), com o centro de rotação marcado.
 */
export function TransformOverlay({ bounds: b, matrix, zoom, mode = 'scale', pivot }: { bounds: Bounds; matrix: Matrix; zoom: number; mode?: TransformMode; pivot?: { x: number; y: number } }) {
  const handles = [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5], ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5]] as const;
  const points = handles.map(([id, x, y]) => ({ id, ...transformPoint(matrix, { x: b.x + x * b.width, y: b.y + y * b.height }) }));
  const center = transformPoint(matrix, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  // Cruz central: arrasta a seleção sem precisar acertar o contorno (útil em objetos sem preenchimento).
  // Contorno branco em volta das alças e do ×: continuam visíveis sobre preto e sobre outros objetos (tamanho fixo na tela).
  const cross = `M${center.x - 4 / zoom} ${center.y - 4 / zoom}L${center.x + 4 / zoom} ${center.y + 4 / zoom}M${center.x + 4 / zoom} ${center.y - 4 / zoom}L${center.x - 4 / zoom} ${center.y + 4 / zoom}`;
  const move = <g data-transform-handle="move" className="move-handle"><circle cx={center.x} cy={center.y} r={9 / zoom} fill="transparent" stroke="none" /><path d={cross} fill="none" stroke="#fff" strokeWidth={3.2 / zoom} strokeLinecap="round" /><path d={cross} fill="none" stroke="#000" strokeWidth={1.2 / zoom} /><title>Arraste para mover</title></g>;
  if (mode === 'scale') return <g className="transform-overlay" fill="#000" stroke="#fff" strokeWidth={1.2 / zoom}>
    {points.map(p => <rect key={p.id} data-transform-handle={p.id} x={p.x - 3.5 / zoom} y={p.y - 3.5 / zoom} width={7 / zoom} height={7 / zoom}><title>{p.id.length === 2 ? 'Cantos mantêm proporções · Alt: livre · Shift: a partir do centro' : 'Esticar · Shift: a partir do centro'}</title></rect>)}
    {move}
  </g>;
  // Seta dupla desenhada no sistema do canto/lado e girada para acompanhar a moldura.
  const angle = Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI, s = 1 / zoom;
  const arrow = (id: string, x: number, y: number, rotate: number, curved: boolean, title: string) =>
    <g key={id} data-transform-handle={id} className={curved ? 'rotate-handle' : 'skew-handle'} transform={`translate(${x} ${y}) rotate(${angle + rotate}) scale(${s})`}>
      <circle r={10} fill="transparent" stroke="none" />
      <path d={curved ? 'M-7 2 A8 8 0 0 1 2 -7' : 'M-7 0 H7'} fill="none" stroke="#262935" strokeWidth={4} strokeLinecap="round" />
      <path d={curved ? 'M-7 2 A8 8 0 0 1 2 -7' : 'M-7 0 H7'} fill="none" stroke="white" strokeWidth={1.6} strokeLinecap="round" />
      <path d={curved ? 'M-10 0 L-7 5 L-4 0 Z M0 -10 L5 -7 L0 -4 Z' : 'M-10 0 L-6 -3.5 L-6 3.5 Z M10 0 L6 -3.5 L6 3.5 Z'} fill="white" stroke="#262935" strokeWidth={1} />
      <title>{title}</title>
    </g>;
  const corner = { nw: 0, ne: 90, se: 180, sw: 270 } as const, side = { n: 0, s: 0, e: 90, w: 90 } as const;
  return <g className="transform-overlay rotate-mode" fill="white" stroke="none">
    {points.map(p => p.id.length === 2
      ? arrow(`rotate-${p.id}`, p.x, p.y, corner[p.id as keyof typeof corner], true, 'Girar · Ctrl: passos de 15° · clique de novo no objeto para voltar às alças de tamanho')
      : arrow(`skew-${p.id}`, p.x, p.y, side[p.id as keyof typeof side], false, 'Inclinar · Ctrl: passos de 15°'))}
    {(() => { const p = pivot ?? center; return <g data-transform-handle="pivot" className="pivot-handle"><circle cx={p.x} cy={p.y} r={9 / zoom} fill="transparent" stroke="none" /><circle cx={p.x} cy={p.y} r={6 / zoom} fill="white" fillOpacity={0.6} stroke="#262935" strokeWidth={1.5 / zoom} /><circle cx={p.x} cy={p.y} r={1.8 / zoom} fill="#262935" stroke="none" /><title>Centro de rotação: arraste para girar em volta de outro ponto (encaixa no centro, cantos e lados)</title></g>; })()}
  </g>;
}
