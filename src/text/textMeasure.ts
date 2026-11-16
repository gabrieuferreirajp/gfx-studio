import type { Measure } from './textLayout';
let context: CanvasRenderingContext2D | null = null;
/** Medição pelo navegador, com a mesma fonte usada para desenhar o texto. */
export const browserMeasure: Measure = (text, font) => {
  context ??= document.createElement('canvas').getContext('2d');
  if (!context) return text.length * 10;
  context.font = font;
  return context.measureText(text).width;
};
