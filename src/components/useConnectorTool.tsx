import { useRef, useState } from 'react';
import { useEditor } from '../state/EditorContext';
import type { Anchor, Connector, VectorObject } from '../document/model';
import type { Point } from '../geometry/pathGeometry';
import { anchorOn, connectorObject, connectorPoints, linkPoints, nearestLink } from '../geometry/links';

export const connectorTools = { connector: 'straight', elbowConnector: 'elbow', roundConnector: 'rounded' } as const;
type Draft = { pointerId: number; from: Anchor; start: Point; end: Point; target: Anchor | null };
/**
 * Conectores (CorelDRAW): arraste de um objeto a outro. As pontas encaixam nos cantos, meios dos lados, centro e
 * nós; presas a objetos, acompanham quando eles se movem ou mudam de tamanho. Soltar fora de objetos deixa a ponta livre.
 */
export function useConnectorTool() {
  const { tool, document, dispatch, commitEdit, setSelection, setMessage, viewport, outline, outlineWidth } = useEditor();
  const kind = (connectorTools as Record<string, Connector['kind']>)[tool] as Connector['kind'] | undefined;
  const draft = useRef<Draft | null>(null), [preview, setPreview] = useState<Draft | null>(null), [hover, setHover] = useState<VectorObject | null>(null);
  const radius = 10 / viewport.zoom;
  const anchorFor = (p: Point, exclude: string[] = []): { anchor: Anchor; point: Point } => {
    const near = nearestLink(document.objects, p, radius, exclude);
    return near ? { anchor: anchorOn(near.object, near.point), point: near.point } : { anchor: { x: p.x, y: p.y }, point: p };
  };
  function down(p: Point, pointerId: number) {
    const start = anchorFor(p);
    draft.current = { pointerId, from: start.anchor, start: start.point, end: start.point, target: null }; setPreview(draft.current);
  }
  function move(p: Point, pointerId: number) {
    const near = nearestLink(document.objects, p, radius * 3);
    setHover(near?.object ?? null);
    const d = draft.current; if (!d || d.pointerId !== pointerId) return;
    const end = anchorFor(p, d.from.id ? [d.from.id] : []);
    draft.current = { ...d, end: end.point, target: end.anchor }; setPreview(draft.current);
  }
  function up(pointerId: number) {
    const d = draft.current; if (!d || d.pointerId !== pointerId || !kind) return;
    draft.current = null; setPreview(null);
    if (Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y) * viewport.zoom < 4 || !d.target) return;
    const base: VectorObject = { id: crypto.randomUUID(), type: 'path', name: 'Conector', x: 0, y: 0, width: 1, height: 1, fill: 'none', stroke: outline === 'none' ? '#000000' : outline, strokeWidth: outlineWidth || 1 };
    const object = connectorObject(base, { from: d.from, to: d.target, kind }, d.start, d.end);
    commitEdit(); dispatch({ type: 'set-objects', objects: [...document.objects, object] }); commitEdit();
    setSelection([object.id]);
    const tied = [d.from, d.target].filter(a => a.id).length;
    setMessage(tied ? `Conector criado, preso a ${tied === 2 ? 'dois objetos' : 'um objeto'}: acompanha quando ${tied === 2 ? 'eles se movem' : 'ele se move'}. Ctrl+Z desfaz.` : 'Conector criado com pontas livres (solte sobre um objeto para prendê-lo). Ctrl+Z desfaz.');
  }
  const z = viewport.zoom, d = preview, element = kind ? <g pointerEvents="none" className="connector-preview">
    {hover && linkPoints(hover).slice(0, 200).map((p, i) => <rect key={i} x={p.x - 3 / z} y={p.y - 3 / z} width={6 / z} height={6 / z} fill="#ffffff" stroke="#1f6fd1" strokeWidth={1 / z} />)}
    {d && <polyline points={connectorPoints(kind, d.start, d.end, Math.abs(d.end.x - d.start.x) >= Math.abs(d.end.y - d.start.y) ? 'h' : 'v', Math.abs(d.end.x - d.start.x) >= Math.abs(d.end.y - d.start.y) ? 'h' : 'v').map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#1f6fd1" strokeWidth={1.5 / z} strokeDasharray={`${5 / z} ${3 / z}`} />}
    {d && [d.from, d.target].map((a, i) => a?.id && <circle key={i} cx={i ? d.end.x : d.start.x} cy={i ? d.end.y : d.start.y} r={4 / z} fill="#1f6fd1" />)}
  </g> : null;
  return { active: !!kind, down, move, up, isDragging: () => !!draft.current, element };
}
