import { useRef } from 'react';
import { useEditor } from '../state/EditorContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { screenToDocument } from '../document/viewport';
import { finishEditing } from '../state/useProjectFiles';

const FAR = 100000;
/** Grade do documento sobre a página (Exibir › Grade do documento), em coordenadas do documento. */
export function DocumentGrid({ width, height, zoom }: { width: number; height: number; zoom: number }) {
  const { layout } = useWorkspace();
  if (!layout.grid || layout.gridSize <= 0) return null;
  // Linhas mais finas que 4 px na tela viram ruído: a grade agrupa passos até ficar legível.
  let step = layout.gridSize; while (step * zoom < 4) step *= 2;
  return <g pointerEvents="none" aria-hidden="true">
    <defs><pattern id="vs-document-grid" width={step} height={step} patternUnits="userSpaceOnUse"><path d={`M${step} 0H0V${step}`} fill="none" stroke="#9aa4b2" strokeOpacity={0.55} strokeWidth={1 / zoom} /></pattern></defs>
    <rect width={width} height={height} fill="url(#vs-document-grid)" />
  </g>;
}
/**
 * Linhas-guia do documento: arraste com o botão esquerdo para mover; soltar sobre a régua (ou fora da área) exclui.
 * Botão direito: excluir a guia.
 */
export function GuidesLayer({ svg }: { svg: React.RefObject<SVGSVGElement | null> }) {
  const { document, dispatch, commitEdit, viewport, setMessage } = useEditor(), { layout } = useWorkspace();
  const drag = useRef<{ id: string; pointerId: number } | null>(null);
  if (!layout.guides || !document.guides?.length) return null;
  const z = viewport.zoom;
  const locate = (clientX: number, clientY: number) => { const r = svg.current!.getBoundingClientRect(); return { inside: clientX - r.left > 20 && clientY - r.top > 20 && clientX < r.right && clientY < r.bottom, p: screenToDocument(viewport, clientX - r.left, clientY - r.top) }; };
  const remove = (id: string) => { commitEdit(); dispatch({ type: 'set-guides', guides: (document.guides ?? []).filter(g => g.id !== id) }); commitEdit(); setMessage('Linha-guia excluída. Ctrl+Z desfaz.'); };
  return <g className="guidelines">{document.guides.map(g => {
    const line = g.axis === 'x' ? { x1: g.position, x2: g.position, y1: -FAR, y2: FAR } : { x1: -FAR, x2: FAR, y1: g.position, y2: g.position };
    return <g key={g.id} data-guide={g.id}>
      <line {...line} className="guideline" strokeWidth={1 / z} strokeDasharray={`${5 / z} ${3 / z}`} pointerEvents="none" />
      <line {...line} className={`guideline-hit axis-${g.axis}`} stroke="transparent" strokeWidth={7 / z}
        onPointerDown={e => { if (e.button !== 0) return; e.stopPropagation(); finishEditing(); commitEdit(); drag.current = { id: g.id, pointerId: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { const d = drag.current; if (!d || d.pointerId !== e.pointerId) return; const { p } = locate(e.clientX, e.clientY); dispatch({ type: 'set-guides', guides: (document.guides ?? []).map(x => x.id === d.id ? { ...x, position: Math.round((x.axis === 'x' ? p.x : p.y) * 1000) / 1000 } : x) }); }}
        onPointerUp={e => { const d = drag.current; if (!d) return; drag.current = null; if (!locate(e.clientX, e.clientY).inside) remove(d.id); else commitEdit(); }}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new CustomEvent('vectorstudio:context-menu', { detail: { x: e.clientX, y: e.clientY, items: [{ label: 'Excluir linha-guia', run: () => remove(g.id) }, { label: 'Excluir todas as linhas-guia', run: () => { commitEdit(); dispatch({ type: 'set-guides', guides: [] }); commitEdit(); } }] } })); }}>
        <title>Linha-guia · arraste para mover; solte na régua para excluir</title>
      </line>
    </g>;
  })}</g>;
}
