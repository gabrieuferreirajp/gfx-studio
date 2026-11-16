import type { PathCommand, VectorObject } from '../document/model.ts';
import { mapCommands } from './pathGeometry.ts';
import { matrixOf, transformPoint } from './objectTransforms.ts';
import { applyCorners } from './corners.ts';

/** Geometria do objeto em coordenadas locais (antes da matriz), para retângulos, elipses, caminhos e bitmaps. */
export function localCommands(o: VectorObject): PathCommand[] {
  if (o.type === 'path') {
    if (!o.commands || !o.pathSize) throw new Error('Caminho inválido.');
    return mapCommands(o.commands, p => ({ x: o.x + p.x * o.width / o.pathSize!.width, y: o.y + p.y * o.height / o.pathSize!.height }));
  }
  if (o.type === 'rectangle' || o.type === 'image' || o.type === 'text') return [{ type: 'M', x: o.x, y: o.y }, { type: 'L', x: o.x + o.width, y: o.y }, { type: 'L', x: o.x + o.width, y: o.y + o.height }, { type: 'L', x: o.x, y: o.y + o.height }, { type: 'Z' }];
  // Sixteen analytic cubic arcs keep ellipse approximation below 7e-8 of its radius.
  const cx = o.x + o.width / 2, cy = o.y + o.height / 2, rx = o.width / 2, ry = o.height / 2, step = Math.PI / 8, k = 4 / 3 * Math.tan(step / 4);
  const commands: PathCommand[] = [{ type: 'M', x: cx + rx, y: cy }];
  for (let i = 0; i < 16; i++) { const a = i * step, b = (i + 1) * step; commands.push({ type: 'C', x1: cx + rx * (Math.cos(a) - k * Math.sin(a)), y1: cy + ry * (Math.sin(a) + k * Math.cos(a)), x2: cx + rx * (Math.cos(b) + k * Math.sin(b)), y2: cy + ry * (Math.sin(b) - k * Math.cos(b)), x: i === 15 ? cx + rx : cx + rx * Math.cos(b), y: i === 15 ? cy : cy + ry * Math.sin(b) }); }
  commands.push({ type: 'Z' });
  return commands;
}
/** Geometria em coordenadas do documento; o contorno é desenhado sobre ela sem distorção. */
export function worldCommands(o: VectorObject): PathCommand[] {
  if (o.type === 'text') throw new Error('Tipo não suportado.');
  // Cantos são aplicados depois da escala: continuam circulares quando o retângulo é esticado
  // e o raio acompanha o tamanho da forma (escala média da matriz).
  if (o.type === 'rectangle' && (o.cornerRadius || o.cornerRadii?.some(r => r > 0))) { const k = cornerScale(o); return applyCorners(worldCommands({ ...o, cornerRadius: undefined, cornerRadii: undefined }), o.cornerRadii ? o.cornerRadii.map(r => r * k) : o.cornerRadius! * k, o.cornerType); }
  return mapCommands(localCommands(o), p => transformPoint(matrixOf(o), p));
}
/** Fator entre o raio guardado (unidades locais) e o raio exibido no documento. */
/** Raios dos quatro cantos do retângulo em unidades locais (sup. esq., sup. dir., inf. dir., inf. esq.). */
export const cornerRadii = (o: VectorObject): [number, number, number, number] => o.cornerRadii ? [...o.cornerRadii] : [0, 0, 0, 0].map(() => o.cornerRadius ?? 0) as [number, number, number, number];
export const cornerScale = (o: VectorObject) => { const m = matrixOf(o); return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; };
