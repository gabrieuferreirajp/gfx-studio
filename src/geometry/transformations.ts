import { around, translate, type Bounds, type Matrix } from './objectTransforms.ts';
import type { Point } from './pathGeometry.ts';

/** Abas da janela Transformações (CorelDRAW: Alt+F7 a Alt+F10, Inclinar e Alinhar e distribuir). */
export type TransformTab = 'position' | 'rotate' | 'scale' | 'size' | 'skew' | 'align';
export const transformTabs: [TransformTab, string, string][] = [['position', 'Posição', 'Alt+F7'], ['rotate', 'Girar', 'Alt+F8'], ['scale', 'Escala e espelho', 'Alt+F9'], ['size', 'Tamanho', 'Alt+F10'], ['skew', 'Inclinar', ''], ['align', 'Alinhar e distribuir', 'Ctrl+Shift+A']];
/** Ponto de referência 0–8 (linha × 3 + coluna), como a grade 3 × 3 do CorelDRAW; 4 = centro. */
export type Anchor = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const anchorPoint = (b: Bounds, anchor: Anchor): Point => ({ x: b.x + b.width * (anchor % 3) / 2, y: b.y + b.height * Math.floor(anchor / 3) / 2 });
/** Valores em px do documento (posição/tamanho), graus (girar/inclinar) e % (escala). */
export interface TransformParams { tab: TransformTab; x: number; y: number; relative: boolean; angle: number; sx: number; sy: number; width: number; height: number; skewX: number; skewY: number; anchor: Anchor }
const finite = (...values: number[]) => values.every(Number.isFinite);
/**
 * Matriz da transformação para a caixa atual da seleção; null quando os valores não fazem sentido.
 * Ângulos seguem o CorelDRAW: girar positivo é anti-horário; inclinar positivo puxa o topo para a direita / o lado direito para cima.
 */
export function transformationMatrix(p: TransformParams, b: Bounds): Matrix | null {
  const c = anchorPoint(b, p.anchor);
  if (p.tab === 'position') {
    if (!finite(p.x, p.y)) return null;
    return p.relative ? translate(p.x, p.y) : translate(p.x - c.x, p.y - c.y);
  }
  if (p.tab === 'rotate') {
    if (!finite(p.angle)) return null;
    const r = -p.angle * Math.PI / 180;
    return around(c, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
  }
  if (p.tab === 'scale') {
    if (!finite(p.sx, p.sy) || !p.sx || !p.sy) return null;
    return around(c, [p.sx / 100, 0, 0, p.sy / 100, 0, 0]);
  }
  if (p.tab === 'size') {
    if (!finite(p.width, p.height) || p.width <= 0 || p.height <= 0) return null;
    const sx = b.width > 1e-9 ? p.width / b.width : 1, sy = b.height > 1e-9 ? p.height / b.height : 1;
    return around(c, [sx, 0, 0, sy, 0, 0]);
  }
  if (p.tab === 'skew') {
    if (!finite(p.skewX, p.skewY) || Math.abs(p.skewX) >= 89 || Math.abs(p.skewY) >= 89) return null;
    const tx = Math.tan(p.skewX * Math.PI / 180), ty = Math.tan(p.skewY * Math.PI / 180);
    return around(c, [1, -ty, -tx, 1, 0, 0]);
  }
  return null;
}
