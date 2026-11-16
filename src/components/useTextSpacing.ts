import { useRef } from 'react';
import { useEditor } from '../state/EditorContext';
import type { Point } from '../geometry/pathGeometry';
import type { VectorObject } from '../document/model';
import { inverse, matrixOf, transformPoint } from '../geometry/objectTransforms';
import { cssFont, fontPx, textLines, updateText } from '../text/textLayout';
import { browserMeasure } from '../text/textMeasure';

type Drag = { pointerId: number; kind: 'letter' | 'line'; start: Point; object: VectorObject; letter: number; line: number };
/**
 * Ferramenta Forma (F10) sobre um texto, como no CorelDRAW: a seta da direita (embaixo) ajusta o
 * espaçamento entre caracteres e a seta da esquerda ajusta o espaçamento entre linhas.
 */
export function useTextSpacing() {
  const { document, selectedIds, tool, dispatch, beginEdit, commitEdit, setMessage } = useEditor();
  const drag = useRef<Drag | null>(null);
  const text = tool === 'nodes' && selectedIds.length === 1 ? document.objects.find(o => o.id === selectedIds[0] && o.type === 'text' && o.fontSize !== undefined) : undefined;
  const local = (o: VectorObject, p: Point) => transformPoint(inverse(matrixOf(o)), p);
  function down(target: Element, point: Point, pointerId: number) {
    const kind = target.closest('[data-text-spacing]')?.getAttribute('data-text-spacing') as Drag['kind'] | undefined;
    if (!kind || !text) return false;
    beginEdit(); drag.current = { pointerId, kind, start: local(text, point), object: text, letter: text.letterSpacing ?? 0, line: text.lineSpacing ?? 1.2 };
    return true;
  }
  function move(point: Point, pointerId: number) {
    const d = drag.current;
    if (!d || d.pointerId !== pointerId) return;
    const p = local(d.object, point), lines = textLines(d.object);
    let patch: { letterSpacing?: number; lineSpacing?: number };
    if (d.kind === 'letter') {
      // O deslocamento da seta é dividido entre os intervalos da linha mais longa.
      const chars = Math.max(1, ...lines.map(l => [...l].length)), space = browserMeasure(' ', cssFont(d.object)) || fontPx(d.object) * 0.25;
      patch = { letterSpacing: Math.round(Math.max(-100, Math.min(2000, d.letter + (p.x - d.start.x) / chars / space * 100))) };
    } else {
      const gaps = Math.max(1, lines.length - 1);
      patch = { lineSpacing: Math.max(0.1, Math.min(10, d.line + (p.y - d.start.y) / gaps / fontPx(d.object))) };
    }
    dispatch({ type: 'set-objects', objects: document.objects.map(o => o.id === d.object.id ? updateText(o, patch, browserMeasure) : o) });
    setMessage(d.kind === 'letter' ? `Espaçamento entre caracteres: ${patch.letterSpacing}%` : `Espaçamento entre linhas: ${Math.round(patch.lineSpacing! / 1.2 * 100)}%`);
  }
  function up(pointerId: number) { if (drag.current?.pointerId === pointerId) { drag.current = null; commitEdit(); } }
  /** Posições das duas setas (canto inferior do texto, um pouco abaixo). */
  const handles = text ? (() => { const m = matrixOf(text); return { letter: transformPoint(m, { x: text.x + text.width, y: text.y + text.height }), line: transformPoint(m, { x: text.x, y: text.y + text.height }), angle: Math.atan2(m[1], m[0]) * 180 / Math.PI }; })() : null;
  return { down, move, up, handles, isDragging: () => drag.current !== null };
}
