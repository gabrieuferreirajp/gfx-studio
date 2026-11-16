import type { PathCommand, VectorObject } from '../document/model.ts';
import type { Point } from './pathGeometry.ts';
import { worldCommands } from './worldGeometry.ts';
import { normalizeCommands, splitContours } from './compoundPaths.ts';

/**
 * Junção automática de linhas (CorelDRAW): começar uma linha nova na ponta de uma curva aberta continua a curva;
 * terminar na outra ponta da mesma curva fecha a forma. Vale para Linha de 2 pontos, Mão livre, Bézier, Caneta,
 * Polilinha, B-Spline e Curva de 3 pontos.
 */
export type Endpoint = { id: string; which: 'start' | 'end'; point: Point };
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
/** Pontas (coordenadas do documento) de um caminho aberto de um só contorno, ou null. */
export function openEnds(o: VectorObject): { start: Point; end: Point } | null {
  if (o.type !== 'path' || !o.commands?.length || o.connector || o.effectOf || o.locked || o.clipParent) return null;
  const parts = splitContours(o.commands);
  if (parts.length !== 1 || parts[0].at(-1)?.type === 'Z') return null;
  const w = worldCommands(o) as Exclude<PathCommand, { type: 'Z' }>[];
  return { start: { x: w[0].x, y: w[0].y }, end: { x: w.at(-1)!.x, y: w.at(-1)!.y } };
}
/** Ponta de curva aberta mais próxima de `p` (até `tolerance`). */
export function endpointNear(objects: VectorObject[], p: Point, tolerance: number, exclude: string[] = []): Endpoint | null {
  let best: Endpoint | null = null, distance = tolerance;
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]; if (exclude.includes(o.id)) continue;
    const ends = openEnds(o); if (!ends) continue;
    for (const which of ['start', 'end'] as const) { const d = dist(ends[which], p); if (d <= distance) { distance = d; best = { id: o.id, which, point: ends[which] }; } }
  }
  return best;
}
/** Inverte um contorno aberto (M + segmentos). */
export function reverseCommands(commands: PathCommand[]): PathCommand[] {
  const c = commands.filter(k => k.type !== 'Z') as Exclude<PathCommand, { type: 'Z' }>[];
  const out: PathCommand[] = [{ type: 'M', x: c.at(-1)!.x, y: c.at(-1)!.y }];
  for (let i = c.length - 1; i >= 1; i--) {
    const k = c[i], prev = c[i - 1];
    out.push(k.type === 'C' ? { type: 'C', x1: k.x2, y1: k.y2, x2: k.x1, y2: k.y1, x: prev.x, y: prev.y } : { type: 'L', x: prev.x, y: prev.y });
  }
  return out;
}
const segments = (commands: PathCommand[]) => commands.slice(1).filter(k => k.type !== 'Z');
const endOf = (commands: PathCommand[]) => { const k = commands.at(-1) as Exclude<PathCommand, { type: 'Z' }>; return { x: k.x, y: k.y }; };
/** Termina o contorno exatamente em `p` e fecha. */
function closeAt(commands: PathCommand[], p: Point): PathCommand[] {
  const last = { ...commands.at(-1)! } as Exclude<PathCommand, { type: 'Z' }>;
  last.x = p.x; last.y = p.y;
  return [...commands.slice(0, -1), last, { type: 'Z' }];
}
/**
 * Liga a curva recém-criada às pontas próximas. Devolve os objetos atualizados (a curva existente cresce no lugar
 * dela e mantém cor e espessura), o ID da curva resultante e se ela fechou; ou null se nada foi ligado.
 */
export function joinPaths(objects: VectorObject[], created: VectorObject, tolerance: number): { objects: VectorObject[]; id: string; closed: boolean } | null {
  const world = worldCommands(created);
  if (world.some(k => k.type === 'Z') || splitContours(world).length !== 1) return null;
  const s = (world[0] as { x: number; y: number }), e = endOf(world), others = objects.filter(o => o.id !== created.id);
  const a = endpointNear(others, s, tolerance);
  let combined: PathCommand[] = world, base: VectorObject | null = null, closed = false;
  const removed = new Set<string>([created.id]);
  if (a) {
    const owner = objects.find(o => o.id === a.id)!;
    let aw = worldCommands(owner); if (a.which === 'start') aw = reverseCommands(aw);
    combined = [...aw, ...segments(world)]; base = owner;
  }
  const b = endpointNear(others, e, tolerance, a ? [] : []);
  if (b && a && b.id === a.id) {
    if (b.which !== a.which) { combined = closeAt(combined, (combined[0] as Point)); closed = true; }
  } else if (b) {
    const owner = objects.find(o => o.id === b.id)!;
    let bw = worldCommands(owner); if (b.which === 'end') bw = reverseCommands(bw);
    combined = [...combined, ...segments(bw)];
    if (base) removed.add(owner.id); else base = owner;
  } else if (!a && segments(world).length >= 2 && dist(s, e) <= tolerance) { combined = closeAt(world, s); closed = true; }
  if (!base && !closed) return null;
  const style = base ?? created;
  if (combined.length > 10000) return null;
  const { transform: _t, nodeModes: _n, commands: _c, pathSize: _p, ...rest } = style;
  const object: VectorObject = { ...rest, ...normalizeCommands(combined) };
  const keep = base?.id ?? created.id;
  const next = objects.flatMap(o => o.id === keep ? [object] : removed.has(o.id) && o.id !== keep ? [] : [o]);
  if (!base) next.push(object);
  return { objects: next, id: object.id, closed };
}
