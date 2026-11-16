import type { PathCommand, VectorObject } from '../document/model.ts';
import { mapCommands } from '../geometry/pathGeometry.ts';
import { inverse, matrixOf, transformPoint } from '../geometry/objectTransforms.ts';
import type { PathGeometry } from '../geometry/nodeGeometry.ts';

/**
 * Recorte de bitmap (CorelDRAW): a imagem inteira continua guardada e um contorno define a parte visível.
 * O contorno fica em coordenadas relativas à imagem (0–1), por isso acompanha redimensionamentos.
 * Cortar, Laço poligonal e a ferramenta Forma (nós) alteram esse contorno.
 */
export const fullCrop: PathCommand[] = [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 1, y: 0 }, { type: 'L', x: 1, y: 1 }, { type: 'L', x: 0, y: 1 }, { type: 'Z' }];
/** Contorno visível em coordenadas locais da imagem (antes da matriz). */
export const cropLocal = (o: VectorObject): PathCommand[] => mapCommands(o.crop ?? fullCrop, p => ({ x: o.x + p.x * o.width, y: o.y + p.y * o.height }));
/** Contorno visível em coordenadas do documento. */
export const cropWorld = (o: VectorObject): PathCommand[] => { const m = matrixOf(o); return mapCommands(cropLocal(o), p => transformPoint(m, p)); };
/** Converte um contorno do documento no recorte relativo da imagem. */
export function cropFromWorld(o: VectorObject, world: PathCommand[]): PathCommand[] {
  const m = inverse(matrixOf(o));
  return mapCommands(world, p => { const l = transformPoint(m, p); return { x: (l.x - o.x) / o.width, y: (l.y - o.y) / o.height }; });
}
/** A imagem como um caminho editável (ferramenta Forma): os nós são os do recorte. */
export function imageAsPath(o: VectorObject): VectorObject {
  const { crop: _c, src: _s, ...rest } = o;
  return { ...rest, type: 'path', fill: 'none', commands: mapCommands(cropLocal(o), p => ({ x: p.x - o.x, y: p.y - o.y })), pathSize: { width: o.width, height: o.height } };
}
/** Recorte a partir da geometria editada na ferramenta Forma (mesmo formato de `path-edit`). */
export function cropFromGeometry(o: VectorObject, g: PathGeometry): PathCommand[] {
  return mapCommands(g.commands!, p => ({ x: (g.x + p.x * g.width / g.pathSize!.width - o.x) / o.width, y: (g.y + p.y * g.height / g.pathSize!.height - o.y) / o.height }));
}
/** Recorte igual à imagem inteira (sem corte). */
export const isFullCrop = (crop: PathCommand[]) => crop.length === 5 && crop.every((c, i) => c.type === fullCrop[i].type && (c.type === 'Z' || (Math.abs(c.x - (fullCrop[i] as { x: number }).x) < 1e-9 && Math.abs(c.y - (fullCrop[i] as { y: number }).y) < 1e-9)));
/** Atualiza o recorte (remove o campo quando volta a ser a imagem inteira). */
export function withCrop(o: VectorObject, crop: PathCommand[]): VectorObject {
  if (isFullCrop(crop)) { const { crop: _, ...rest } = o; return rest; }
  return { ...o, crop };
}
