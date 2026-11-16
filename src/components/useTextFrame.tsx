import { useRef, useState } from 'react';
import type { VectorObject } from '../document/model';
import type { Point } from '../geometry/pathGeometry';
import { svgTransform } from '../geometry/objectTransforms';
import { textOverflows } from '../text/textLayout';
import { browserMeasure } from '../text/textMeasure';

type Draft = { pointerId: number; start: Point; end: Point };
/**
 * Ferramenta Texto (CorelDRAW): clicar cria texto artístico; arrastar desenha o quadro de um texto de parágrafo.
 * `finish` recebe o retângulo arrastado, ou null quando foi só um clique.
 */
export function useTextFrame(zoom: number, finish: (start: Point, box: { x: number; y: number; width: number; height: number } | null) => void) {
  const draft = useRef<Draft | null>(null), [preview, setPreview] = useState<Draft | null>(null);
  function down(p: Point, pointerId: number) { draft.current = { pointerId, start: p, end: p }; setPreview(draft.current); }
  function move(p: Point, pointerId: number) { const d = draft.current; if (!d || d.pointerId !== pointerId) return; draft.current = { ...d, end: p }; setPreview(draft.current); }
  function up(pointerId: number, cancel = false) {
    const d = draft.current; if (!d || d.pointerId !== pointerId) return;
    draft.current = null; setPreview(null);
    if (cancel) return;
    const width = Math.abs(d.end.x - d.start.x), height = Math.abs(d.end.y - d.start.y);
    // Arrasto curto conta como clique (texto artístico), como no CorelDRAW.
    finish(d.start, width * zoom >= 6 && height * zoom >= 6 ? { x: Math.min(d.start.x, d.end.x), y: Math.min(d.start.y, d.end.y), width, height } : null);
  }
  const d = preview;
  const element = d ? <rect pointerEvents="none" x={Math.min(d.start.x, d.end.x)} y={Math.min(d.start.y, d.end.y)} width={Math.abs(d.end.x - d.start.x)} height={Math.abs(d.end.y - d.start.y)} fill="none" stroke="#000" strokeOpacity={0.6} strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} /> : null;
  return { down, move, up, element, isDragging: () => !!draft.current };
}
/** Quadros tracejados dos textos de parágrafo selecionados; vermelho quando o texto não cabe (como no CorelDRAW). */
export function ParagraphFrames({ objects, zoom }: { objects: VectorObject[]; zoom: number }) {
  return <g pointerEvents="none">{objects.filter(o => o.type === 'text' && o.paragraph && !o.textPath).map(o => {
    const over = textOverflows(o, browserMeasure);
    return <rect key={o.id} transform={svgTransform(o)} x={o.x} y={o.y} width={o.width} height={o.height} fill="none" stroke={over ? '#e0262f' : '#000'} strokeOpacity={over ? 0.9 : 0.45} strokeWidth={(over ? 1.5 : 1) / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`}><title>{over ? 'O texto não cabe no quadro: aumente o quadro ou reduza o texto' : 'Quadro do texto de parágrafo'}</title></rect>;
  })}</g>;
}
