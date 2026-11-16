import paper from 'paper';
import type { PathCommand, VectorObject } from '../document/model.ts';
import { mapCommands } from './pathGeometry.ts';
import { normalizeCommands } from './compoundPaths.ts';
import { parseProject } from '../document/persistence.ts';
import { worldCommands } from './worldGeometry.ts';
import { flatten } from '../io/exporters.ts';
import { resultCommands, type BooleanResult } from './booleanGeometry.ts';
import { hasOutline, outlineSelectionError } from './outlineSelection.ts';

/**
 * Converter contorno em objeto: a área do traço (pontas e junções arredondadas, como o desenho na tela)
 * vira um caminho preenchido com a cor do contorno. O objeto original mantém o preenchimento, sem contorno.
 */
export function performOutline(objects: VectorObject[], ids: string[]): BooleanResult {
  const error = outlineSelectionError(objects, ids); if (error) throw new Error(error);
  const scope = new paper.PaperScope(); scope.setup(new scope.Size(1, 1));
  const replaced = new Map<string, VectorObject[]>();
  try {
    for (const o of objects.filter(o => ids.includes(o.id) && hasOutline(o))) {
      const contours = flatten(worldCommands(o)), box = normalizeCommands(worldCommands(o));
      const radius = o.strokeWidth! / 2, scale = 1000 / (Math.max(box.width, box.height) + 2 * radius);
      const local = (p: { x: number; y: number }) => new scope.Point((p.x - box.x + radius) * scale, (p.y - box.y + radius) * scale);
      const r = radius * scale;
      let shapes: paper.PathItem[] = [];
      for (const contour of contours) {
        const points = contour.points.map(local).filter((p, i, all) => i === 0 || p.getDistance(all[i - 1]) > 1e-6);
        if (contour.closed && points.length > 1 && points[0].getDistance(points.at(-1)!) > 1e-6) points.push(points[0]);
        for (let i = 0; i < points.length; i++) {
          const a = points[i], b = points[i + 1];
          if (b) { const n = b.subtract(a).normalize(r).rotate(90, new scope.Point(0, 0)); shapes.push(new scope.Path({ segments: [a.add(n), b.add(n), b.subtract(n), a.subtract(n)], closed: true, insert: false })); }
          // Junção arredondada em todo vértice: sem ela, mesmo ângulos pequenos deixam frestas finas no traço.
          shapes.push(new scope.Path.Circle({ center: a, radius: r, insert: false }));
        }
      }
      if (shapes.length > 8000) throw new Error('Contorno complexo demais para converter. Simplifique a curva.');
      if (!shapes.length) continue;
      while (shapes.length > 1) { const next: paper.PathItem[] = []; for (let i = 0; i < shapes.length; i += 2) next.push(shapes[i + 1] ? shapes[i].unite(shapes[i + 1], { insert: false }) : shapes[i]); shapes = next; }
      const result = shapes[0];
      result.reorient(false, true);
      for (const child of (result instanceof scope.CompoundPath ? result.children : [result]) as paper.Path[]) if (child.segments.length > 40) child.simplify(0.2);
      const commands: PathCommand[] = resultCommands(result);
      if (!commands.length) continue;
      if (commands.length > 10000) throw new Error('Resultado excede o limite de 10.000 comandos.');
      const world = mapCommands(commands, p => ({ x: p.x / scale + box.x - radius, y: p.y / scale + box.y - radius }));
      const worldBox = normalizeCommands(world), storage = Math.min(1, 9000 / Math.max(worldBox.width, worldBox.height));
      const geometry = normalizeCommands(mapCommands(world, p => ({ x: (p.x - worldBox.x) * storage, y: (p.y - worldBox.y) * storage })));
      const outline: VectorObject = { id: crypto.randomUUID(), type: 'path', name: 'Contorno', ...geometry, fill: o.stroke!, fillRule: 'nonzero', stroke: 'none', strokeWidth: 0, transform: [1 / storage, 0, 0, 1 / storage, worldBox.x, worldBox.y], ...(o.groupPath ? { groupPath: o.groupPath } : {}), ...(o.clipParent ? { clipParent: o.clipParent } : {}) };
      replaced.set(o.id, o.fill !== 'none' || objects.some(c => c.clipParent === o.id) ? [{ ...o, stroke: 'none', strokeWidth: 0 }, outline] : [outline]);
    }
    if (!replaced.size) throw new Error('Nenhum contorno pôde ser convertido.');
    const output = objects.flatMap(o => replaced.get(o.id) ?? [o]);
    parseProject(JSON.stringify({ version: 1, id: 'outline-validation', name: 'Contorno', artboard: { width: 1, height: 1 }, objects: output }));
    return { objects: output, resultId: [...replaced.values()][0].at(-1)!.id };
  } finally { scope.project.remove(); }
}
