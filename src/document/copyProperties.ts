import type { VectorObject } from './model.ts';
import { updateText, type Measure } from '../text/textLayout.ts';

/** Grupos de atributos copiáveis (Editar › Copiar propriedades de…, como no CorelDRAW). */
export interface PropertySet { outline: boolean; outlineColor: boolean; fill: boolean; text: boolean }
const PEN = /^(strokeWidth|strokeJoin|strokeCap|strokeMiter|strokeDash|strokeScale|arrow)/;
/** Copia de `source` para `target` os atributos escolhidos. */
export function copyProperties(target: VectorObject, source: VectorObject, which: PropertySet, measure: Measure): VectorObject {
  let next: VectorObject = { ...target };
  const set = (test: (key: string) => boolean) => {
    for (const key of Object.keys(next)) if (test(key)) delete (next as unknown as Record<string, unknown>)[key];
    for (const [key, value] of Object.entries(source)) if (test(key)) (next as unknown as Record<string, unknown>)[key] = value;
  };
  if (which.outline) set(k => PEN.test(k));
  if (which.outlineColor) set(k => k === 'stroke' || k === 'strokeSpot');
  if (which.fill && target.type !== 'image') set(k => k.startsWith('fill') && k !== 'fillRule');
  if (which.text && target.type === 'text' && source.type === 'text') next = updateText(next, { fontFamily: source.fontFamily, fontSize: source.fontSize, bold: source.bold, italic: source.italic, underline: source.underline, textAlign: source.textAlign, letterSpacing: source.letterSpacing, lineSpacing: source.lineSpacing }, measure);
  return next;
}
