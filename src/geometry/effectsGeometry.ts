import paper from 'paper';
import type { PathCommand, VectorObject } from '../document/model.ts';
import { commandsToSvg, mapCommands } from './pathGeometry.ts';
import { normalizeCommands, splitContours } from './compoundPaths.ts';
import { parseProject } from '../document/persistence.ts';
import { worldCommands } from './worldGeometry.ts';
import { flatten } from '../io/exporters.ts';
import { resultCommands, type BooleanResult } from './booleanGeometry.ts';
import { effectSelectionError, mixColor, type ContourParams, type SweepParams } from './effects.ts';

type Point = { x: number; y: number };
/** Sessão Paper.js com coordenadas normalizadas (~1000 unidades) para estabilidade numérica. */
function session(world: PathCommand[], pad: number) {
  const box = normalizeCommands(world), scale = 1000 / (Math.max(box.width, box.height) + 2 * pad);
  const scope = new paper.PaperScope(); scope.setup(new scope.Size(1, 1));
  const local = (p: Point) => ({ x: (p.x - box.x + pad) * scale, y: (p.y - box.y + pad) * scale });
  const back = (commands: PathCommand[]) => mapCommands(commands, p => ({ x: p.x / scale + box.x - pad, y: p.y / scale + box.y - pad }));
  const item = (commands: PathCommand[], rule: 'nonzero' | 'evenodd' = 'nonzero') => { const path = new scope.CompoundPath({ pathData: commandsToSvg(mapCommands(commands, local)), insert: false }); path.fillRule = rule; return path; };
  return { scope, scale, local, back, item };
}
function unionAll(shapes: paper.PathItem[]): paper.PathItem | null {
  while (shapes.length > 1) { const next: paper.PathItem[] = []; for (let i = 0; i < shapes.length; i += 2) next.push(shapes[i + 1] ? shapes[i].unite(shapes[i + 1], { insert: false }) : shapes[i]); shapes = next; }
  return shapes[0] ?? null;
}
/**
 * Área coberta por um traço de raio r sobre os contornos achatados. Junções: arredondadas (círculo em cada vértice),
 * retas (esquadria, limite 4 como no CorelDRAW; acima disso vira chanfro) ou chanfradas.
 */
export type ContourCorners = 'miter' | 'round' | 'bevel';
function strokeArea(scope: paper.PaperScope, contours: { points: Point[]; closed: boolean }[], r: number, corners: ContourCorners = 'round') {
  const shapes: paper.PathItem[] = [];
  for (const contour of contours) {
    const points = contour.points.map(p => new scope.Point(p.x, p.y)).filter((p, i, all) => i === 0 || p.getDistance(all[i - 1]) > 1e-6);
    if (contour.closed && points.length > 2 && points[0].getDistance(points.at(-1)!) <= 1e-6) points.pop();
    const n = points.length, closed = contour.closed && n > 2;
    for (let i = 0; i < n; i++) {
      const a = points[i], b = closed ? points[(i + 1) % n] : points[i + 1];
      if (b) { const nn = b.subtract(a).normalize(r).rotate(90, new scope.Point(0, 0)); shapes.push(new scope.Path({ segments: [a.add(nn), b.add(nn), b.subtract(nn), a.subtract(nn)], closed: true, insert: false })); }
      const prev = closed ? points[(i - 1 + n) % n] : points[i - 1], next = b;
      // Pontas de linha aberta e junções arredondadas: círculo (sem ele, ângulos pequenos deixam frestas).
      if (corners === 'round' || !prev || !next) { shapes.push(new scope.Path.Circle({ center: a, radius: r, insert: false })); continue; }
      const d1 = a.subtract(prev).normalize(), d2 = next.subtract(a).normalize();
      if (Math.abs(d1.cross(d2)) < 1e-9 && d1.dot(d2) > 0) continue;
      const n1 = d1.rotate(90, new scope.Point(0, 0)), n2 = d2.rotate(90, new scope.Point(0, 0)), denom = 1 + n1.dot(n2);
      for (const side of [1, -1]) {
        const p1 = a.add(n1.multiply(r * side)), p2 = a.add(n2.multiply(r * side));
        const segments = corners === 'miter' && denom >= 0.125 ? [a, p1, a.add(n1.add(n2).multiply(r * side / denom)), p2] : [a, p1, p2];
        shapes.push(new scope.Path({ segments, closed: true, insert: false }));
      }
    }
  }
  if (shapes.length > 12000) throw new Error('Forma complexa demais para este efeito. Simplifique a curva.');
  return unionAll(shapes);
}
/** Converte o resultado em caminho do documento (geometria normalizada, como nas booleanas). */
function pathObject(world: PathCommand[], name: string, fill: string, base: VectorObject, groupPath: string[]): VectorObject | null {
  if (!world.length) return null;
  if (world.length > 10000) throw new Error('Resultado excede o limite de 10.000 comandos.');
  const box = normalizeCommands(world), storage = Math.min(1, 9000 / Math.max(box.width, box.height));
  const geometry = normalizeCommands(mapCommands(world, p => ({ x: (p.x - box.x) * storage, y: (p.y - box.y) * storage })));
  return { id: crypto.randomUUID(), type: 'path', name, ...geometry, fill, fillRule: 'nonzero', stroke: 'none', strokeWidth: 0, transform: [1 / storage, 0, 0, 1 / storage, box.x, box.y], groupPath, ...(base.clipParent ? { clipParent: base.clipParent } : {}) };
}
const closedOnly = (commands: PathCommand[]) => splitContours(commands).every(c => c.at(-1)?.type === 'Z');
function finish(objects: VectorObject[], replaced: Map<string, VectorObject[]>, label: string): BooleanResult {
  if (!replaced.size) throw new Error(`Nenhum objeto aceitou o efeito ${label}.`);
  const output = objects.flatMap(o => replaced.get(o.id) ?? [o]);
  parseProject(JSON.stringify({ version: 1, id: 'effect-validation', name: label, artboard: { width: 1, height: 1 }, objects: output }));
  return { objects: output, resultId: [...replaced.values()][0].find(o => o.name !== 'original')?.id ?? null };
}
/** Efeito Contorno: passos concêntricos para fora ou para dentro, com cores interpoladas até a cor final. */
export function performContour(objects: VectorObject[], ids: string[], params: ContourParams): BooleanResult {
  const error = effectSelectionError(objects, ids, 'contour'); if (error) throw new Error(error);
  const steps = Math.max(1, Math.min(30, Math.round(params.steps))), offset = Math.max(0.1, params.offset);
  const replaced = new Map<string, VectorObject[]>();
  for (const o of objects.filter(o => ids.includes(o.id))) {
    const world = worldCommands(o);
    if (!closedOnly(world)) continue;
    const reach = params.direction === 'outside' ? offset * steps : 0;
    const s = session(world, reach + 1);
    try {
      const base = s.item(world, o.fillRule ?? 'nonzero'), contours = flatten(world).map(c => ({ ...c, points: c.points.map(s.local) }));
      const group = [...(o.groupPath ?? []), crypto.randomUUID()], start = o.fill !== 'none' ? o.fill : o.stroke && o.stroke !== 'none' ? o.stroke : '#000000';
      const made: VectorObject[] = [];
      for (let i = 1; i <= steps; i++) {
        const area = strokeArea(s.scope, contours, offset * i * s.scale, params.corners ?? 'round');
        if (!area) continue;
        const result = params.direction === 'outside' ? base.unite(area, { insert: false }) : base.subtract(area, { insert: false });
        result.reorient(false, true);
        const object = pathObject(s.back(resultCommands(result)), `Contorno ${i}`, mixColor(start, params.endColor, i / steps), o, group);
        if (object) made.push(object);
      }
      const original = { ...o, groupPath: group };
      replaced.set(o.id, params.direction === 'outside' ? [...made.reverse(), original] : [original, ...made]);
    } finally { s.scope.project.remove(); }
  }
  return finish(objects, replaced, 'Contorno');
}
/** Bloquear sombra e Extrusão: a forma varrida na direção (dx, dy), colocada atrás do objeto. */
export function performSweep(objects: VectorObject[], ids: string[], params: SweepParams): BooleanResult {
  const error = effectSelectionError(objects, ids, 'sweep'); if (error) throw new Error(error);
  const replaced = new Map<string, VectorObject[]>();
  for (const o of objects.filter(o => ids.includes(o.id))) {
    const world = worldCommands(o);
    if (!closedOnly(world)) continue;
    const length = Math.hypot(params.dx, params.dy), s = session(world, length + 1);
    try {
      const v = { x: params.dx * s.scale, y: params.dy * s.scale };
      const shapes: paper.PathItem[] = [s.item(world, o.fillRule ?? 'nonzero'), s.item(mapCommands(world, p => ({ x: p.x + params.dx, y: p.y + params.dy })), o.fillRule ?? 'nonzero')];
      for (const contour of flatten(world)) {
        const points = contour.points.map(s.local), closed = contour.closed ? [...points, points[0]] : points;
        for (let i = 0; i + 1 < closed.length; i++) {
          const a = closed[i], b = closed[i + 1];
          if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
          shapes.push(new s.scope.Path({ segments: [[a.x, a.y], [b.x, b.y], [b.x + v.x, b.y + v.y], [a.x + v.x, a.y + v.y]], closed: true, insert: false }));
        }
      }
      if (shapes.length > 8000) throw new Error('Forma complexa demais para este efeito. Simplifique a curva.');
      const result = unionAll(shapes)!;
      result.reorient(false, true);
      const group = [...(o.groupPath ?? []), crypto.randomUUID()];
      const color = params.mode === 'extrude' ? mixColor(o.fill !== 'none' ? o.fill : o.stroke ?? '#000000', '#000000', params.shade) : params.color;
      const sweep = pathObject(s.back(resultCommands(result)), params.mode === 'extrude' ? 'Extrusão' : 'Bloquear sombra', color, o, group);
      if (sweep) replaced.set(o.id, [sweep, { ...o, groupPath: group }]);
    } finally { s.scope.project.remove(); }
  }
  return finish(objects, replaced, params.mode === 'extrude' ? 'Extrusão' : 'Bloquear sombra');
}
