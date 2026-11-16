import type { PathCommand, VectorObject } from '../document/model.ts';
import { normalizeCommands } from './compoundPaths.ts';
import { mapCommands } from './pathGeometry.ts';
import { worldCommands } from './worldGeometry.ts';
import { clipContents } from './objectTransforms.ts';

export const canConvertToCurves = (o: VectorObject) => o.type === 'rectangle' || o.type === 'ellipse' || o.type === 'text' || (o.type === 'path' && (!!o.transform || false));
/** Caminho editável a partir de geometria em coordenadas do documento, preservando ID, estilo, grupo e PowerClip. */
export function pathFromWorld(o: VectorObject, world: PathCommand[], name = 'Curva'): VectorObject {
  if (world.length > 10000) throw new Error(`"${o.name}" gera mais de 10.000 comandos; divida o texto ou simplifique.`);
  const geometry = normalizeCommands(world);
  const keep: (keyof VectorObject)[] = ['id', 'fill', 'fillRule', 'stroke', 'strokeWidth', 'groupPath', 'clipParent', 'clipUnlocked', 'shadow'];
  const path: VectorObject = { type: 'path', name, x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, pathSize: geometry.pathSize, commands: mapCommands(geometry.commands, p => p), fill: o.fill } as VectorObject;
  for (const key of keep) if (o[key] !== undefined) (path as unknown as Record<string, unknown>)[key] = o[key];
  return path;
}
/**
 * Objeto › Converter em curvas (Ctrl+Q): retângulos, elipses e textos viram caminhos com nós editáveis.
 * `textOutlines` traz o contorno dos glifos (coordenadas do documento) para cada texto selecionado.
 */
export function convertToCurves(objects: VectorObject[], ids: string[], textOutlines: Map<string, PathCommand[]>): { objects: VectorObject[]; converted: number } {
  const targets = new Set(clipContents(objects, ids));
  let converted = 0;
  const output = objects.map(o => {
    if (!targets.has(o.id)) return o;
    if (o.type === 'rectangle' || o.type === 'ellipse') { converted++; return pathFromWorld(o, worldCommands(o)); }
    if (o.type === 'path' && o.transform) { converted++; return { ...pathFromWorld(o, worldCommands(o)), name: o.name, ...(o.nodeModes ? {} : {}) }; }
    if (o.type === 'text') {
      const outline = textOutlines.get(o.id);
      if (!outline?.length) return o;
      converted++;
      return { ...pathFromWorld(o, outline, `Texto: ${(o.text ?? '').slice(0, 30)}`), fillRule: 'nonzero' as const };
    }
    return o;
  });
  return { objects: output, converted };
}
