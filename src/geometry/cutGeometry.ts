import paper from 'paper';
import type { PathCommand, VectorObject } from '../document/model.ts';
import { commandsToSvg, mapCommands, type Point } from './pathGeometry.ts';
import { matrixOf } from './objectTransforms.ts';
import { normalizeCommands, splitContours } from './compoundPaths.ts';
import { worldCommands } from './worldGeometry.ts';
import { parseProject } from '../document/persistence.ts';
import type { BooleanResult } from './booleanGeometry.ts';
import { cropFromWorld, cropWorld, withCrop } from '../bitmap/imageCrop.ts';

/**
 * Ferramentas de corte do CorelDRAW (grupo Cortar): Cortar (retângulo), Faca (linha), Borracha (pincel) e
 * Excluir segmento virtual (trecho entre interseções). Calculadas com Paper.js, sem rasterizar.
 */
export type CutOperation = 'crop' | 'knife' | 'erase' | 'virtualDelete' | 'smartFill';
export interface CutParams {
  crop?: { x: number; y: number; width: number; height: number };
  /** Laço poligonal: mantém o que fica dentro (`keep`) ou apaga o que fica dentro (`remove`). */
  lasso?: { points: Point[]; mode: 'keep' | 'remove' };
  knife?: { a: Point; b: Point };
  erase?: { points: Point[]; radius: number };
  /** Excluir segmento virtual: ponto clicado; `ids[0]` é o objeto clicado e os demais servem de cortadores. */
  point?: Point;
  /** Preenchimento inteligente: cores e caneta do novo objeto (o ponto vem em `point`). */
  style?: { fill: string; stroke: string; strokeWidth: number };
}
const cuttable = (objects: VectorObject[], o: VectorObject) => (o.type === 'path' && !!o.commands?.length) || o.type === 'rectangle' || o.type === 'ellipse'
  ? !o.clipParent && !objects.some(c => c.clipParent === o.id) : false;
const isClosed = (o: VectorObject) => o.type !== 'path' || splitContours(o.commands!).every(c => c.at(-1)?.type === 'Z');
/** Comandos de um item do Paper.js, respeitando caminhos abertos. */
function itemCommands(item: paper.PathItem): PathCommand[] {
  const paths = item instanceof paper.CompoundPath ? item.children as paper.Path[] : [item as paper.Path], commands: PathCommand[] = [];
  for (const path of paths) {
    const s = path.segments;
    if (s.length < 2 || path.length < 1e-6) continue;
    commands.push({ type: 'M', x: s[0].point.x, y: s[0].point.y });
    const count = path.closed ? s.length : s.length - 1;
    for (let i = 0; i < count; i++) {
      const a = s[i], b = s[(i + 1) % s.length];
      if (a.handleOut.isZero() && b.handleIn.isZero()) commands.push({ type: 'L', x: b.point.x, y: b.point.y });
      else { const c1 = a.point.add(a.handleOut), c2 = b.point.add(b.handleIn); commands.push({ type: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: b.point.x, y: b.point.y }); }
    }
    if (path.closed) commands.push({ type: 'Z' });
  }
  return commands;
}
/** Novo caminho com o estilo de `base` (cores, caneta, transparência, camada e grupo). */
function fromWorld(base: VectorObject, world: PathCommand[], name: string, open: boolean): VectorObject | null {
  if (!world.length) return null;
  if (world.length > 10000) throw new Error('Resultado excede o limite de 10.000 comandos.');
  const box = normalizeCommands(world), m = matrixOf(base);
  const stroke = (base.strokeWidth ?? 0) * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const storage = Math.min(1, 9000 / Math.max(box.width, box.height), stroke ? 1000 / stroke : 1);
  const geometry = normalizeCommands(mapCommands(world, p => ({ x: (p.x - box.x) * storage, y: (p.y - box.y) * storage })));
  const { id: _i, type: _t, x: _x, y: _y, width: _w, height: _h, commands: _c, pathSize: _p, nodeModes: _n, transform: _m, cornerRadius: _r, cornerRadii: _rr, cornerType: _ct, ...style } = base;
  // Caminho que ficou aberto não tem preenchimento; sem contorno ele sumiria, então recebe um traço preto fino.
  const openStyle: Partial<VectorObject> = open ? { fill: 'none', fillGradient: undefined, ...(!base.stroke || base.stroke === 'none' ? { stroke: '#000000', strokeWidth: 1 } : {}) } : {};
  const object: VectorObject = { ...style, ...openStyle, id: crypto.randomUUID(), type: 'path', name, ...geometry, fillRule: 'nonzero', transform: [1 / storage, 0, 0, 1 / storage, box.x, box.y] };
  if (object.strokeWidth !== undefined) object.strokeWidth = (openStyle.strokeWidth ?? stroke) * storage;
  if (object.fillGradient === undefined) delete object.fillGradient;
  return object;
}
/** O formato só aceita um contorno aberto por caminho (no fim): trechos abertos extras viram objetos próprios. */
function fromWorldParts(base: VectorObject, world: PathCommand[], name: string, open: boolean): VectorObject[] {
  const contours = splitContours(world), closed = contours.filter(c => c.at(-1)?.type === 'Z'), opens = contours.filter(c => c.at(-1)?.type !== 'Z');
  if (opens.length <= 1) { const o = fromWorld(base, [...closed, ...opens].flat(), name, open || opens.length > 0); return o ? [o] : []; }
  const parts = [[...closed, opens[0]].flat(), ...opens.slice(1)];
  return parts.flatMap((part, i) => { const o = fromWorld(base, part, `${name} (parte ${i + 1})`, true); return o ? [o] : []; });
}
const unite = (items: paper.PathItem[]): paper.PathItem => items.length === 1 ? items[0] : unite(Array.from({ length: Math.ceil(items.length / 2) }, (_, i) => items[2 * i + 1] ? items[2 * i].unite(items[2 * i + 1], { insert: false }) : items[2 * i]));
/** Traço do pincel da borracha: círculos nos pontos e faixas entre eles, unidos. */
function brush(scope: paper.PaperScope, points: Point[], radius: number): paper.PathItem {
  const sampled: Point[] = [];
  for (const p of points) { const last = sampled.at(-1); if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= radius * 0.4) sampled.push(p); }
  if (points.length && sampled.at(-1) !== points.at(-1)) sampled.push(points.at(-1)!);
  const pts = sampled.slice(0, 600), parts: paper.PathItem[] = pts.map(p => new scope.Path.Circle({ center: [p.x, p.y], radius, insert: false }));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const nx = -(b.y - a.y) / len * radius, ny = (b.x - a.x) / len * radius;
    parts.push(new scope.Path({ segments: [[a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny], [a.x - nx, a.y - ny]], closed: true, insert: false }));
  }
  return unite(parts);
}
const FAR = 1e6;
/**
 * Área fechada que contém o ponto, formada pelos contornos fechados: dentro de formas, é a interseção das que
 * contêm o ponto menos as que não o contêm; fora de todas, é o "buraco" da união que envolve o ponto.
 */
function smartFillRegion(scope: paper.PaperScope, shapes: paper.PathItem[], click: Point): paper.PathItem {
  const at = new scope.Point(click.x, click.y);
  const inside = shapes.filter(s => s.contains(at)), outside = shapes.filter(s => !s.contains(at));
  let region: paper.PathItem;
  if (inside.length) {
    region = inside.slice(1).reduce<paper.PathItem>((r, s) => r.intersect(s, { insert: false }), inside[0]);
    for (const s of outside) if (s.bounds.intersects(region.bounds)) region = region.subtract(s, { insert: false });
  } else {
    if (!shapes.length) throw new Error('Clique dentro de uma área fechada pelas formas.');
    const all = unite(shapes);
    const rings = (all instanceof scope.CompoundPath ? all.children as paper.Path[] : [all as paper.Path]).filter(c => c.closed && c.bounds.contains(at));
    const ring = rings.map(c => { const p = (c.clone({ insert: false }) as paper.Path); p.clockwise = true; return p; }).filter(p => p.contains(at)).sort((a, b) => Math.abs(a.area) - Math.abs(b.area))[0];
    if (!ring) throw new Error('Clique dentro de uma área fechada pelas formas (o ponto está fora de todas).');
    region = ring.subtract(all, { insert: false });
  }
  if (!region.contains(at) || Math.abs((region as paper.Path).area) < 1e-6) throw new Error('Não há área fechada neste ponto.');
  // Mantém só a parte que contém o clique (a diferença pode deixar pedaços separados).
  if (region instanceof scope.CompoundPath) {
    // Contorno externo = o menor contorno que envolve o clique; furos = contornos logo abaixo dele na hierarquia.
    const children = (region.children as paper.Path[]).map(c => { const p = c.clone({ insert: false }) as paper.Path; p.clockwise = true; return { path: p, inner: c.firstSegment.point }; });
    // Contornos de um resultado booleano não se cruzam: um ponto do contorno basta para saber quem envolve quem.
    const depth = (k: typeof children[number]) => children.filter(o => o !== k && Math.abs(o.path.area) > Math.abs(k.path.area) && o.path.contains(k.inner)).length;
    const outer = children.filter(c => c.path.contains(at)).sort((a, b) => Math.abs(a.path.area) - Math.abs(b.path.area))[0];
    if (outer) {
      const level = depth(outer), holes = children.filter(c => c !== outer && Math.abs(c.path.area) < Math.abs(outer.path.area) && outer.path.contains(c.inner) && depth(c) === level + 1);
      region = holes.reduce<paper.PathItem>((r, h) => r.subtract(h.path, { insert: false }), outer.path);
    }
  }
  return region;
}
export function performCut(objects: VectorObject[], ids: string[], operation: CutOperation, params: CutParams): BooleanResult {
  const scope = new paper.PaperScope(); scope.setup(new scope.Size(1, 1));
  try {
    const item = (o: VectorObject) => { const p = new scope.CompoundPath({ pathData: commandsToSvg(worldCommands(o)), insert: false }); p.fillRule = o.fillRule ?? 'nonzero'; return p; };
    const replaced = new Map<string, VectorObject[]>(), resultIds: string[] = [];
    const put = (o: VectorObject, list: (VectorObject | VectorObject[] | null)[]) => { const kept = list.flat().filter((x): x is VectorObject => !!x); replaced.set(o.id, kept); resultIds.push(...kept.map(x => x.id)); };
    const targets = objects.filter(o => ids.includes(o.id) && cuttable(objects, o));
    if (operation === 'smartFill') {
      const click = params.point, style = params.style;
      if (!click || !style) throw new Error('Clique dentro de uma área fechada.');
      const created = smartFillRegion(scope, targets.filter(isClosed).map(item), click);
      const base: VectorObject = { id: '', type: 'path', name: 'Preenchimento inteligente', x: 0, y: 0, width: 0, height: 0, fill: style.fill, stroke: style.stroke, strokeWidth: style.stroke === 'none' ? 0 : style.strokeWidth };
      const object = fromWorld(base, itemCommands(created), 'Preenchimento inteligente', false);
      if (!object) throw new Error('A área clicada está vazia.');
      if (object.stroke === 'none') delete object.strokeWidth;
      const output = [...objects, object];
      parseProject(JSON.stringify({ version: 1, id: 'cut-validation', name: 'Cut', artboard: { width: 1, height: 1 }, objects: output }));
      return { objects: output, resultId: object.id, resultIds: [object.id] };
    }
    if (operation === 'crop') {
      const r = params.crop, lasso = params.lasso;
      let cutter: paper.PathItem;
      if (lasso) { if (lasso.points.length < 3) throw new Error('Feche o laço com pelo menos 3 pontos.'); cutter = new scope.Path({ segments: lasso.points.map(p => [p.x, p.y]), closed: true, insert: false }); }
      else { if (!r || r.width < 1e-6 || r.height < 1e-6) throw new Error('Arraste um retângulo para cortar.'); cutter = new scope.Path.Rectangle({ point: [r.x, r.y], size: [r.width, r.height], insert: false }); }
      const remove = lasso?.mode === 'remove';
      // Só altera o que a área toca (ou o que fica todo de fora, ao manter): o resto da página fica como está.
      const touched = (shape: paper.PathItem) => shape.bounds.intersects(cutter.bounds) || !remove;
      // Apagar dentro: só se o laço cruza a forma, a cobre inteira ou fica todo dentro dela (abre um buraco).
      const cutterPoint = (cutter as paper.Path).firstSegment.point;
      const overlaps = (shape: paper.PathItem) => shape.getIntersections(cutter).length > 0 || cutter.contains((shape.children[0] as paper.Path | undefined)?.firstSegment?.point ?? shape.bounds.center) || shape.contains(cutterPoint);
      for (const o of targets) {
        const closed = isClosed(o), shape = item(o), options = closed ? { insert: false } : { insert: false, trace: false };
        if (!touched(shape)) continue;
        if (remove && !overlaps(shape)) continue;
        put(o, [fromWorldParts(o, itemCommands(remove ? shape.subtract(cutter, options) : shape.intersect(cutter, options)), o.name, !closed)]);
      }
      // Bitmaps (JPG, PNG…): a imagem continua inteira e ganha um contorno de recorte, editável na ferramenta Forma.
      for (const o of objects.filter(o => ids.includes(o.id) && o.type === 'image' && !o.clipParent)) {
        const shape = new scope.CompoundPath({ pathData: commandsToSvg(cropWorld(o)), insert: false }); shape.fillRule = 'evenodd';
        if (!shape.bounds.intersects(cutter.bounds)) { if (!remove) put(o, []); continue; }
        if (remove && !overlaps(shape)) continue;
        const result = itemCommands(remove ? shape.subtract(cutter, { insert: false }) : shape.intersect(cutter, { insert: false }));
        put(o, [result.length ? withCrop(o, cropFromWorld(o, result)) : null]);
      }
    } else if (operation === 'knife') {
      const k = params.knife; if (!k || Math.hypot(k.b.x - k.a.x, k.b.y - k.a.y) < 1e-6) throw new Error('Arraste a faca atravessando o objeto.');
      const len = Math.hypot(k.b.x - k.a.x, k.b.y - k.a.y), d = { x: (k.b.x - k.a.x) / len, y: (k.b.y - k.a.y) / len }, n = { x: -d.y, y: d.x };
      const line = new scope.Path.Line({ from: [k.a.x, k.a.y], to: [k.b.x, k.b.y], insert: false });
      const half = (s: number) => new scope.Path({ segments: [[k.a.x - d.x * FAR, k.a.y - d.y * FAR], [k.b.x + d.x * FAR, k.b.y + d.y * FAR], [k.b.x + d.x * FAR + s * n.x * FAR, k.b.y + d.y * FAR + s * n.y * FAR], [k.a.x - d.x * FAR + s * n.x * FAR, k.a.y - d.y * FAR + s * n.y * FAR]], closed: true, insert: false });
      for (const o of targets) {
        const shape = item(o);
        if (!shape.getIntersections(line).length) continue;
        if (isClosed(o)) { put(o, [fromWorldParts(o, itemCommands(shape.intersect(half(1), { insert: false })), `${o.name} (parte 1)`, false), fromWorldParts(o, itemCommands(shape.intersect(half(-1), { insert: false })), `${o.name} (parte 2)`, false)]); continue; }
        // Caminho aberto: separa nos pontos em que a faca o cruza.
        const pieces: paper.Path[] = [];
        for (const child of (shape.children as paper.Path[]).map(c => c.clone({ insert: false }) as paper.Path)) {
          const offsets = [...new Set(child.getIntersections(line).map(l => l.offset))].sort((a, b) => b - a);
          let rest: paper.Path = child;
          for (const off of offsets) { if (off < 1e-6 || off > rest.length - 1e-6) continue; const tail = rest.splitAt(rest.getLocationAt(off)); if (tail) pieces.push(tail); }
          pieces.push(rest);
        }
        put(o, pieces.reverse().map((p, i) => fromWorldParts(o, itemCommands(p), `${o.name} (parte ${i + 1})`, true)));
      }
    } else if (operation === 'erase') {
      const e = params.erase; if (!e || !e.points.length || !(e.radius > 0)) throw new Error('Arraste a borracha sobre o objeto.');
      const b = brush(scope, e.points, e.radius);
      for (const o of targets) {
        const shape = item(o);
        // Só altera o que o pincel tocou: cruzou o contorno ou cobriu o objeto inteiro.
        const first = (shape.children[0] as paper.Path | undefined)?.firstSegment?.point;
        if (!shape.bounds.intersects(b.bounds) || (!shape.getIntersections(b).length && !(first && b.contains(first)))) continue;
        const closed = isClosed(o), result = shape.subtract(b, closed ? { insert: false } : { insert: false, trace: false });
        put(o, [fromWorldParts(o, itemCommands(result), o.name, !closed)]);
      }
    } else {
      const click = params.point, target = objects.find(o => o.id === ids[0]);
      if (!click || !target || !cuttable(objects, target)) throw new Error('Clique sobre o trecho de uma linha ou forma.');
      const shape = item(target), at = new scope.Point(click.x, click.y);
      const children = (shape.children as paper.Path[]).map(c => c.clone({ insert: false }) as paper.Path);
      let index = 0, nearest = Infinity;
      children.forEach((c, i) => { const d = c.getNearestPoint(at).getDistance(at); if (d < nearest) { nearest = d; index = i; } });
      const child = children[index], cutters = objects.filter(o => o.id !== target.id && ids.includes(o.id) && cuttable(objects, o)).map(item);
      const offsets = [...cutters.flatMap(c => child.getIntersections(c).map(l => l.offset)), ...child.getIntersections(null as unknown as paper.PathItem).map(l => l.offset)]
        .sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > 1e-6);
      const o = child.getNearestLocation(at).offset, L = child.length, keep: paper.Path[] = [];
      if (child.closed) {
        if (offsets.length >= 2) {
          // Intervalo (prev, next) que contém o clique; abre em next e corta em prev: sobra next → prev.
          const next = offsets.find(v => v > o) ?? offsets[0], prev = [...offsets].reverse().find(v => v < o) ?? offsets.at(-1)!;
          child.splitAt(child.getLocationAt(next));
          const q = ((prev - next) % L + L) % L;
          if (q > 1e-6) { child.splitAt(child.getLocationAt(q)); keep.push(child); }
        }
      } else {
        const a = [...offsets].reverse().find(v => v < o) ?? 0, b = offsets.find(v => v > o) ?? L;
        const tail = b < L - 1e-6 ? child.splitAt(child.getLocationAt(b)) : null;
        if (a > 1e-6) { child.splitAt(child.getLocationAt(a)); keep.push(child); }
        if (tail) keep.push(tail);
      }
      const others = children.filter((_, i) => i !== index), world = [...others, ...keep].flatMap(p => itemCommands(p));
      const nowOpen = keep.length > 0 || !isClosed(target) || others.some(p => !p.closed);
      put(target, [fromWorldParts(target, world, target.name, nowOpen && (keep.length > 0 || !isClosed(target)))]);
    }
    if (!replaced.size) throw new Error(operation === 'knife' ? 'A faca não atravessou nenhum objeto (textos e bitmaps: converta em curvas).' : operation === 'erase' ? 'A borracha não tocou em nenhuma forma.' : operation === 'crop' ? 'Nada foi cortado: a área não toca nenhuma forma ou bitmap (textos: converta em curvas, Ctrl+Q).' : 'Nenhuma forma ou linha para cortar (textos e bitmaps: converta em curvas, Ctrl+Q).');
    const output = objects.flatMap(o => replaced.has(o.id) ? replaced.get(o.id)! : [o]);
    parseProject(JSON.stringify({ version: 1, id: 'cut-validation', name: 'Cut', artboard: { width: 1, height: 1 }, objects: output }));
    return { objects: output, resultId: resultIds[0] ?? null, resultIds };
  } finally { scope.project.remove(); }
}
