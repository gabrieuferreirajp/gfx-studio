import type { NodeMode, VectorObject } from '../document/model.ts';
import { createPathObject, type PenNode, type Point } from './pathGeometry.ts';
import { normalizeCommands, splitContours } from './compoundPaths.ts';

export interface EditableNode extends PenNode { mode: NodeMode }
export interface EditablePath { nodes: EditableNode[]; closed: boolean; contours?: { start:number; end:number; closed:boolean }[] }
export function nodeContour(path: EditablePath, index: number) {
  return path.contours?.find(c=>index>=c.start&&index<c.end) ?? {start:0,end:path.nodes.length,closed:path.closed};
}
export const canRemoveNode = (path:EditablePath,index:number) => { const c=nodeContour(path,index);return index>=c.start&&index<c.end&&c.end-c.start>2; };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
function inferredMode(n: PenNode): NodeMode {
  if (!n.incoming || !n.outgoing) return 'corner';
  const a = { x: n.incoming.x - n.x, y: n.incoming.y - n.y }, b = { x: n.outgoing.x - n.x, y: n.outgoing.y - n.y };
  return a.x * b.x + a.y * b.y < 0 && Math.abs(a.x * b.y - a.y * b.x) <= 1e-6 * Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) ? 'smooth' : 'corner';
}
export function decodePath(object: VectorObject): EditablePath {
  if (object.type !== 'path' || !object.commands || !object.pathSize) return { nodes: [], closed: false };
  const parts=splitContours(object.commands);
  if(parts.length>1){
    const nodes:EditableNode[]=[], contours:NonNullable<EditablePath['contours']>=[];
    for(const commands of parts){const part=decodePath({...object,commands,nodeModes:undefined});const start=nodes.length;nodes.push(...part.nodes);contours.push({start,end:nodes.length,closed:part.closed});}
    nodes.forEach((n,i)=>{n.mode=object.nodeModes?.[i]??n.mode;});
    return {nodes,closed:contours.every(c=>c.closed),contours};
  }
  const point = (x: number, y: number): Point => ({ x: object.x + x * object.width / object.pathSize!.width, y: object.y + y * object.height / object.pathSize!.height });
  const nodes: EditableNode[] = [];
  const closed = object.commands.at(-1)?.type === 'Z';
  for (const c of object.commands) {
    if (c.type === 'Z') continue;
    const node: EditableNode = { ...point(c.x, c.y), mode: 'corner' };
    if (c.type === 'C' && nodes.length) {
      nodes.at(-1)!.outgoing = point(c.x1, c.y1);
      node.incoming = point(c.x2, c.y2);
    }
    nodes.push(node);
  }
  // A closing cubic explicitly ends at the first anchor; expose that anchor once.
  if (closed && nodes.length > 2 && distance(nodes[0], nodes.at(-1)!) < 1e-9) {
    nodes[0].incoming = nodes.pop()!.incoming;
  }
  nodes.forEach((node, i) => { node.mode = object.nodeModes?.[i] ?? inferredMode(node); });
  return { nodes, closed };
}
export type PathGeometry = Pick<VectorObject, 'x' | 'y' | 'width' | 'height' | 'commands' | 'pathSize' | 'nodeModes'>;
export function encodePath(path: EditablePath): PathGeometry | null {
  if (path.nodes.length < 2 || path.nodes.length > 9998) return null;
  if(path.contours){
    const parts=path.contours.map(c=>encodePath({nodes:path.nodes.slice(c.start,c.end),closed:c.closed}));
    if(parts.some(p=>!p))return null;
    const commands=parts.flatMap(p=>p!.commands!.map(c=>c.type==='Z'?c:c.type==='C'?{...c,x:c.x+p!.x,y:c.y+p!.y,x1:c.x1+p!.x,y1:c.y1+p!.y,x2:c.x2+p!.x,y2:c.y2+p!.y}:{...c,x:c.x+p!.x,y:c.y+p!.y}));
    const geometry=normalizeCommands(commands);
    if(geometry.width>10000||geometry.height>10000||Math.abs(geometry.x)>10000||Math.abs(geometry.y)>10000||commands.length>10000)return null;
    return {...geometry,nodeModes:path.nodes.map(n=>n.mode)};
  }
  const result = createPathObject(path.nodes, path.closed, '#000000');
  // Explicit closing edge keeps coincident user anchors distinct from the closing endpoint.
  if (path.closed && !path.nodes.at(-1)!.outgoing && !path.nodes[0].incoming) {
    const first = result.commands![0];
    if (first.type === 'M') result.commands!.splice(-1, 0, { type: 'L', x: first.x, y: first.y });
  }
  if (![result.x, result.y, result.width, result.height].every(Number.isFinite) || Math.abs(result.x) > 10000 || Math.abs(result.y) > 10000 || result.width > 10000 || result.height > 10000) return null;
  return { x: result.x, y: result.y, width: result.width, height: result.height, commands: result.commands, pathSize: result.pathSize, nodeModes: path.nodes.map(n => n.mode) };
}
export function moveNode(path: EditablePath, index: number, position: Point): EditablePath {
  return { ...path, nodes: path.nodes.map((n, i) => {
    if (i !== index) return n;
    const translate = (p: Point) => ({ x: p.x + position.x - n.x, y: p.y + position.y - n.y });
    return { ...n, ...position, incoming: n.incoming && translate(n.incoming), outgoing: n.outgoing && translate(n.outgoing) };
  }) };
}
export function moveHandle(path: EditablePath, index: number, side: 'incoming' | 'outgoing', position: Point): EditablePath {
  return { ...path, nodes: path.nodes.map((n, i) => {
    if (i !== index) return n;
    const next = { ...n, [side]: position };
    const opposite = side === 'incoming' ? 'outgoing' : 'incoming';
    if ((n.mode === 'smooth' || n.mode === 'symmetric') && n[opposite]) {
      // Simétrico: as duas alças com o mesmo comprimento; suave: cada uma mantém o seu.
      const length = distance(n, position), oppositeLength = n.mode === 'symmetric' ? length : distance(n, n[opposite]!);
      if (length > 1e-9) next[opposite] = { x: n.x - (position.x - n.x) * oppositeLength / length, y: n.y - (position.y - n.y) * oppositeLength / length };
    }
    return next;
  }) };
}
export function convertNode(path: EditablePath, index: number, mode: NodeMode): EditablePath {
  const nodes = path.nodes.map(n => ({ ...n }));
  const n = nodes[index];
  if (!n || n.mode === mode) return path;
  n.mode = mode;
  if (mode === 'corner') return { ...path, nodes };
  const contour=nodeContour(path,index);
  const prev = index>contour.start?nodes[index-1]:contour.closed?nodes[contour.end-1]:undefined;
  const next = index<contour.end-1?nodes[index+1]:contour.closed?nodes[contour.start]:undefined;
  const a = prev ?? n, b = next ?? n;
  const length = distance(a, b);
  const direction = length > 1e-9 ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length } : { x: 1, y: 0 };
  const d1 = prev ? distance(prev, n) / 3 : 0, d2 = next ? distance(next, n) / 3 : 0, same = (d1 + d2) / (prev && next ? 2 : 1);
  if (prev) { const d = mode === 'symmetric' ? same : d1; n.incoming = { x: n.x - direction.x * d, y: n.y - direction.y * d }; }
  if (next) { const d = mode === 'symmetric' ? same : d2; n.outgoing = { x: n.x + direction.x * d, y: n.y + direction.y * d }; }
  return { ...path, nodes };
}
export function segmentPoints(path: EditablePath, index: number) {
  const contour=nodeContour(path,index);
  const a = path.nodes[index], b = path.nodes[index+1<contour.end?index+1:contour.start];
  if (!a || !b || (!contour.closed && index >= contour.end - 1)) return null;
  return { a, b, c1: a.outgoing ?? a, c2: b.incoming ?? b, curved: !!(a.outgoing || b.incoming) };
}
export function pointOnSegment(path: EditablePath, index: number, t: number): Point {
  const s = segmentPoints(path, index);
  if (!s) throw new Error('Segmento inexistente.');
  if (!s.curved) return lerp(s.a, s.b, t);
  const a = lerp(s.a, s.c1, t), b = lerp(s.c1, s.c2, t), c = lerp(s.c2, s.b, t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
}
export function insertNode(path: EditablePath, index: number, t = 0.5): EditablePath {
  const s = segmentPoints(path, index);
  if (!s || path.nodes.length >= 9998) return path;
  t = Math.max(0.001, Math.min(0.999, t));
  const nodes = path.nodes.map(n => ({ ...n }));
  let node: EditableNode = { ...lerp(s.a, s.b, t), mode: 'corner' };
  if (s.curved) {
    const a = lerp(s.a, s.c1, t), b = lerp(s.c1, s.c2, t), c = lerp(s.c2, s.b, t);
    const d = lerp(a, b, t), e = lerp(b, c, t);
    nodes[index].outgoing = a;
    const contour=nodeContour(path,index);
    nodes[index+1<contour.end?index+1:contour.start].incoming = c;
    node = { ...lerp(d, e, t), incoming: d, outgoing: e, mode: 'smooth' };
  }
  nodes.splice(index + 1, 0, node);
  return { ...path, nodes, ...(path.contours?{contours:path.contours.map(c=>c.start>index?{...c,start:c.start+1,end:c.end+1}:c.end>index?{...c,end:c.end+1}:c)}:{}) };
}
export function removeNode(path: EditablePath, index: number): EditablePath {
  if (!canRemoveNode(path,index)) return path;
  const nodes = path.nodes.filter((_, i) => i !== index).map(n => ({ ...n }));
  const contours=path.contours?.map(c=>c.start>index?{...c,start:c.start-1,end:c.end-1}:c.end>index?{...c,end:c.end-1}:c);
  for(const c of contours??[{start:0,end:nodes.length,closed:path.closed}])if(!c.closed){delete nodes[c.start].incoming;delete nodes[c.end-1].outgoing;}
  return { ...path, nodes, ...(contours?{contours}:{}) };
}
export function closestSegmentParameter(path: EditablePath, index: number, point: Point): number {
  const s = segmentPoints(path, index);
  if (!s) return 0.5;
  if (!s.curved) {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    return Math.max(0.001, Math.min(0.999, ((point.x - s.a.x) * dx + (point.y - s.a.y) * dy) / (dx * dx + dy * dy || 1)));
  }
  let best = 0, min = Infinity;
  for (let i = 0; i <= 96; i++) { const d = distance(pointOnSegment(path, index, i / 96), point); if (d < min) { min = d; best = i / 96; } }
  let lo = Math.max(0, best - 1 / 96), hi = Math.min(1, best + 1 / 96);
  for (let i = 0; i < 32; i++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (distance(pointOnSegment(path, index, a), point) < distance(pointOnSegment(path, index, b), point)) hi = b; else lo = a;
  }
  return Math.max(0.001, Math.min(0.999, (lo + hi) / 2));
}
/**
 * Refletir nós (CorelDRAW): ao editar um nó ou alça, o nó espelhado em relação ao centro do caminho
 * acompanha a edição de forma simétrica, na horizontal, na vertical ou em ambas.
 */
export function mirrorEdit(original: EditablePath, edited: EditablePath, index: number, side: 'incoming' | 'outgoing' | null, horizontal: boolean, vertical: boolean): EditablePath {
  if (!horizontal && !vertical) return edited;
  const xs = original.nodes.map(n => n.x), ys = original.nodes.map(n => n.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const tolerance = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.002 + 1e-6;
  const reflect = (p: Point, h: boolean, v: boolean) => ({ x: h ? 2 * cx - p.x : p.x, y: v ? 2 * cy - p.y : p.y });
  const source = original.nodes[index], moved = edited.nodes[index];
  const modes: [boolean, boolean][] = [];
  if (horizontal) modes.push([true, false]);
  if (vertical) modes.push([false, true]);
  if (horizontal && vertical) modes.push([true, true]);
  let result = edited;
  for (const [h, v] of modes) {
    const target = reflect(source, h, v);
    const partner = original.nodes.findIndex((n, i) => i !== index && distance(n, target) < tolerance);
    if (partner < 0) continue;
    if (!side) result = moveNode(result, partner, reflect(moved, h, v));
    else {
      // Um eixo inverte o sentido do contorno: a alça de entrada corresponde à de saída do parceiro.
      const partnerSide = h !== v ? (side === 'incoming' ? 'outgoing' : 'incoming') : side;
      if (moved[side] && result.nodes[partner][partnerSide]) result = moveHandle(result, partner, partnerSide, reflect(moved[side]!, h, v));
    }
  }
  return result;
}
const nextIndex = (path: EditablePath, index: number) => { const c = nodeContour(path, index); return index + 1 < c.end ? index + 1 : c.start; };
/** Para curva (CorelDRAW): o segmento reto vira Bézier, com alças a 1/3 e 2/3 do trecho. */
export function segmentToCurve(path: EditablePath, index: number): EditablePath {
  const s = segmentPoints(path, index);
  if (!s || s.curved) return path;
  const nodes = path.nodes.map(n => ({ ...n })), j = nextIndex(path, index);
  nodes[index].outgoing = lerp(s.a, s.b, 1 / 3); nodes[j].incoming = lerp(s.a, s.b, 2 / 3);
  return { ...path, nodes };
}
/** Para linha (CorelDRAW): remove as alças do segmento; nós suaves que perdem uma alça viram canto. */
export function segmentToLine(path: EditablePath, index: number): EditablePath {
  const s = segmentPoints(path, index);
  if (!s || !s.curved) return path;
  const nodes = path.nodes.map(n => ({ ...n })), j = nextIndex(path, index);
  delete nodes[index].outgoing; delete nodes[j].incoming;
  nodes[index].mode = 'corner'; nodes[j].mode = 'corner';
  return { ...path, nodes };
}
/**
 * Curvar o segmento arrastando um ponto dele: as duas alças se movem para que o ponto do parâmetro `t`
 * acompanhe o deslocamento exatamente (segmentos retos viram curva antes). Nós suaves continuam suaves.
 */
export function bendSegment(path: EditablePath, index: number, t: number, delta: Point): EditablePath {
  const curved = segmentToCurve(path, index), s = segmentPoints(curved, index);
  if (!s) return path;
  const b1 = 3 * t * (1 - t) ** 2, b2 = 3 * t * t * (1 - t), norm = b1 * b1 + b2 * b2;
  if (norm < 1e-9) return path;
  const c1 = { x: s.c1.x + delta.x * b1 / norm, y: s.c1.y + delta.y * b1 / norm }, c2 = { x: s.c2.x + delta.x * b2 / norm, y: s.c2.y + delta.y * b2 / norm };
  return moveHandle(moveHandle(curved, index, 'outgoing', c1), nextIndex(curved, index), 'incoming', c2);
}
/** Remove vários nós (do maior índice para o menor), respeitando o mínimo de 2 nós por contorno. */
/**
 * Excluir nós (CorelDRAW): o contorno que ficaria com menos de 2 nós sai inteiro.
 * Se nenhum contorno sobrar, o caminho volta sem nós (quem chama remove o objeto).
 */
export function removeNodes(path: EditablePath, indexes: number[]): EditablePath {
  const drop = new Set(indexes.filter(i => i >= 0 && i < path.nodes.length));
  if (!drop.size) return path;
  return fromContours(contoursOf(path).map(c => {
    const nodes: EditableNode[] = [];
    for (let i = c.start; i < c.end; i++) if (!drop.has(i)) nodes.push({ ...path.nodes[i] });
    if (nodes.length < 2) return { nodes: [], closed: c.closed };
    if (!c.closed) { delete nodes[0].incoming; delete nodes[nodes.length - 1].outgoing; }
    return { nodes, closed: c.closed };
  }));
}
/** Move vários nós juntos (com as alças). */
export function moveNodes(path: EditablePath, indexes: number[], delta: Point): EditablePath {
  let result = path;
  for (const index of indexes) { const n = path.nodes[index]; if (n) result = moveNode(result, index, { x: n.x + delta.x, y: n.y + delta.y }); }
  return result;
}
/**
 * Arredondar canto de curva (ferramenta Forma, como no CorelDRAW): nós de canto entre dois segmentos retos
 * recebem um ponto de arraste; arrastar troca o nó por um arco tangente aos dois lados.
 */
export function filletNeighbors(path: EditablePath, index: number) {
  const c = nodeContour(path, index), n = path.nodes[index];
  if (!n || n.mode === 'smooth' || n.incoming || n.outgoing) return null;
  if (!c.closed && (index === c.start || index === c.end - 1)) return null;
  if (c.end - c.start < 3) return null;
  const prevIndex = index > c.start ? index - 1 : c.end - 1, nextIndex = index + 1 < c.end ? index + 1 : c.start;
  const prev = path.nodes[prevIndex], next = path.nodes[nextIndex];
  if (prev.outgoing || next.incoming) return null;
  const l1 = distance(n, prev), l2 = distance(n, next);
  if (l1 < 1e-9 || l2 < 1e-9) return null;
  const u1 = { x: (prev.x - n.x) / l1, y: (prev.y - n.y) / l1 }, u2 = { x: (next.x - n.x) / l2, y: (next.y - n.y) / l2 };
  const cos = u1.x * u2.x + u1.y * u2.y;
  if (cos < -0.9999 || cos > 0.9999) return null; // reto (sem canto) ou volta sobre si
  return { prev, next, u1, u2, l1, l2, cos, max: Math.min(l1, l2) / 2 };
}
export const filletCandidates = (path: EditablePath) => path.nodes.flatMap((_, i) => filletNeighbors(path, i) ? [i] : []);
/** Troca os nós `indexes` por arcos com distância `d` (do canto até onde o arco começa, ao longo de cada lado). */
export function filletNodes(path: EditablePath, indexes: number[], d: number): EditablePath {
  let result: EditablePath = { ...path, nodes: path.nodes.map(n => ({ ...n })), ...(path.contours ? { contours: path.contours.map(c => ({ ...c })) } : {}) };
  for (const index of [...new Set(indexes)].sort((a, b) => b - a)) {
    const f = filletNeighbors(result, index);
    if (!f || d <= 1e-9) continue;
    const t = Math.min(d, f.max), n = result.nodes[index];
    // Arco circular: ângulo interno θ, raio R = t·tan(θ/2), alça = 4/3·tan(φ/4)·R com φ = π − θ.
    const theta = Math.acos(Math.max(-1, Math.min(1, f.cos))), phi = Math.PI - theta, k = 4 / 3 * Math.tan(phi / 4) * t * Math.tan(theta / 2);
    const a = { x: n.x + f.u1.x * t, y: n.y + f.u1.y * t }, b = { x: n.x + f.u2.x * t, y: n.y + f.u2.y * t };
    const nodeA: EditableNode = { ...a, mode: 'corner', outgoing: { x: a.x - f.u1.x * k, y: a.y - f.u1.y * k } };
    const nodeB: EditableNode = { ...b, mode: 'corner', incoming: { x: b.x - f.u2.x * k, y: b.y - f.u2.y * k } };
    const nodes = [...result.nodes.slice(0, index), nodeA, nodeB, ...result.nodes.slice(index + 1)];
    const contours = result.contours?.map(c => c.start > index ? { ...c, start: c.start + 1, end: c.end + 1 } : c.end > index ? { ...c, end: c.end + 1 } : c);
    result = { ...result, nodes, ...(contours ? { contours } : {}) };
  }
  return result;
}

// ---------- Comandos de nó do CorelDRAW (ferramenta Forma) ----------
type Contour = { start: number; end: number; closed: boolean };
const contoursOf = (path: EditablePath): Contour[] => path.contours ?? [{ start: 0, end: path.nodes.length, closed: path.closed }];
/** Monta um caminho a partir de listas de nós por contorno. */
function fromContours(parts: { nodes: EditableNode[]; closed: boolean }[]): EditablePath {
  const nodes: EditableNode[] = [], contours: Contour[] = [];
  for (const p of parts) { if (!p.nodes.length) continue; const start = nodes.length; nodes.push(...p.nodes); contours.push({ start, end: nodes.length, closed: p.closed }); }
  return contours.length === 1 ? { nodes, closed: contours[0].closed } : { nodes, closed: contours.every(c => c.closed), contours };
}
const partsOf = (path: EditablePath) => contoursOf(path).map(c => ({ nodes: path.nodes.slice(c.start, c.end).map(n => ({ ...n })), closed: c.closed }));
const isEnd = (path: EditablePath, i: number) => { const c = nodeContour(path, i); return !c.closed && (i === c.start || i === c.end - 1); };
/** Quebrar curva no nó: contorno fechado abre nesse nó; aberto vira dois contornos. O nó fica duplicado nas pontas. */
export function breakAtNodes(path: EditablePath, indexes: number[]): EditablePath {
  let result = path;
  for (const index of [...new Set(indexes)].sort((a, b) => b - a)) {
    const parts = partsOf(result), cs = contoursOf(result), k = cs.findIndex(c => index >= c.start && index < c.end);
    if (k < 0) continue;
    const c = cs[k], local = index - c.start, part = parts[k], n = part.nodes.length;
    if (c.closed) {
      const rotated = [...part.nodes.slice(local), ...part.nodes.slice(0, local)], tail = { ...rotated[0] };
      delete rotated[0].incoming; delete tail.outgoing; rotated[0].mode = 'corner'; tail.mode = 'corner';
      parts[k] = { nodes: [...rotated, tail], closed: false };
    } else {
      if (local === 0 || local === n - 1) continue;
      const a = part.nodes.slice(0, local + 1), b = part.nodes.slice(local).map(x => ({ ...x }));
      a[a.length - 1] = { ...a[a.length - 1], mode: 'corner' }; delete a[a.length - 1].outgoing;
      b[0].mode = 'corner'; delete b[0].incoming;
      parts.splice(k, 1, { nodes: a, closed: false }, { nodes: b, closed: false });
    }
    result = fromContours(parts);
  }
  return result;
}
const shifted = (h: Point | undefined, from: Point, to: Point) => h && { x: h.x + to.x - from.x, y: h.y + to.y - from.y };
const reversed = (nodes: EditableNode[]) => nodes.slice().reverse().map(n => { const r: EditableNode = { ...n, incoming: n.outgoing, outgoing: n.incoming }; if (!r.incoming) delete r.incoming; if (!r.outgoing) delete r.outgoing; return r; });
/**
 * Juntar dois nós: duas pontas soltas viram um nó só, no meio do caminho entre elas. Pontas do mesmo contorno
 * fecham a curva; de contornos diferentes, emendam os dois em um.
 */
export function joinNodes(path: EditablePath, a: number, b: number): EditablePath | null {
  if (a === b || !isEnd(path, a) || !isEnd(path, b)) return null;
  const parts = partsOf(path), cs = contoursOf(path), ka = cs.findIndex(c => a >= c.start && a < c.end), kb = cs.findIndex(c => b >= c.start && b < c.end);
  const mid = (p: Point, q: Point) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  if (ka === kb) {
    const part = parts[ka];
    if (part.nodes.length < 3) return null;
    const first = part.nodes[0], last = part.nodes[part.nodes.length - 1], m = mid(first, last);
    const merged: EditableNode = { x: m.x, y: m.y, mode: 'corner' };
    const inc = shifted(last.incoming, last, m), out = shifted(first.outgoing, first, m);
    if (inc) merged.incoming = inc; if (out) merged.outgoing = out;
    parts[ka] = { nodes: [merged, ...part.nodes.slice(1, -1)], closed: true };
    return fromContours(parts);
  }
  // Orienta: o contorno A termina em `a`, o B começa em `b`.
  let A = parts[ka].nodes, B = parts[kb].nodes;
  if (a === cs[ka].start) A = reversed(A);
  if (b !== cs[kb].start) B = reversed(B);
  const p = A[A.length - 1], q = B[0], m = mid(p, q);
  const merged: EditableNode = { x: m.x, y: m.y, mode: 'corner' };
  const inc = shifted(p.incoming, p, m), out = shifted(q.outgoing, q, m);
  if (inc) merged.incoming = inc; if (out) merged.outgoing = out;
  const joined = { nodes: [...A.slice(0, -1), merged, ...B.slice(1)], closed: false };
  return fromContours([joined, ...parts.filter((_, i) => i !== ka && i !== kb)]);
}
/** Fechar curva: liga a última ponta à primeira com uma reta, nos contornos abertos dos nós escolhidos (ou em todos). */
export function closeContours(path: EditablePath, indexes: number[]): EditablePath {
  const cs = contoursOf(path), parts = partsOf(path);
  let changed = false;
  cs.forEach((c, k) => { if (!c.closed && parts[k].nodes.length > 2 && (!indexes.length || indexes.some(i => i >= c.start && i < c.end))) { parts[k].closed = true; changed = true; } });
  return changed ? fromContours(parts) : path;
}
/** Extrair subcaminho: separa o(s) contorno(s) dos nós escolhidos. Devolve o que fica e o que sai. */
export function extractSubpaths(path: EditablePath, indexes: number[]): { rest: EditablePath; extracted: EditablePath } | null {
  const cs = contoursOf(path), parts = partsOf(path), pick = cs.map(c => indexes.some(i => i >= c.start && i < c.end));
  if (!pick.some(Boolean) || pick.every(Boolean)) return null;
  return { rest: fromContours(parts.filter((_, k) => !pick[k])), extracted: fromContours(parts.filter((_, k) => pick[k])) };
}
/** Alinhar nós: na horizontal (mesma altura) ou na vertical (mesma coluna), pela média dos escolhidos. */
export function alignNodes(path: EditablePath, indexes: number[], axis: 'horizontal' | 'vertical'): EditablePath {
  const list = [...new Set(indexes)].filter(i => path.nodes[i]);
  if (list.length < 2) return path;
  const avg = list.reduce((s, i) => s + (axis === 'horizontal' ? path.nodes[i].y : path.nodes[i].x), 0) / list.length;
  let result = path;
  for (const i of list) { const n = result.nodes[i]; result = moveNode(result, i, axis === 'horizontal' ? { x: n.x, y: avg } : { x: avg, y: n.y }); }
  return result;
}
const sampleSegment = (a: EditableNode, b: EditableNode, t: number): Point => {
  const c1 = a.outgoing ?? a, c2 = b.incoming ?? b, u = 1 - t;
  return { x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y };
};
/**
 * Reduzir nós: tira nós que não mudam a forma além de `tolerance` (unidades do caminho). Cada nó candidato sai se
 * uma única Bézier entre os vizinhos (mantendo a direção das alças deles) cobre os dois trechos.
 */
export function reduceNodes(path: EditablePath, tolerance: number, only?: number[]): { path: EditablePath; removed: number } {
  const parts = partsOf(path), allowed = only?.length ? new Set(only) : null;
  let removed = 0;
  contoursOf(path).forEach((c, k) => {
    let nodes = parts[k].nodes, ids = nodes.map((_, i) => c.start + i), changed = true;
    const closed = parts[k].closed;
    while (changed && nodes.length > (closed ? 3 : 2)) {
      changed = false;
      for (let i = 0; i < nodes.length; i++) {
        if (!closed && (i === 0 || i === nodes.length - 1)) continue;
        if (allowed && !allowed.has(ids[i])) continue;
        const pi = (i - 1 + nodes.length) % nodes.length, ni = (i + 1) % nodes.length, prev = nodes[pi], cur = nodes[i], next = nodes[ni];
        const chord = distance(prev, next);
        if (chord < 1e-9) continue;
        const samples: Point[] = [];
        for (let s = 1; s < 8; s++) samples.push(sampleSegment(prev, cur, s / 8));
        samples.push(cur);
        for (let s = 1; s < 8; s++) samples.push(sampleSegment(cur, next, s / 8));
        const d1 = prev.outgoing ? { x: prev.outgoing.x - prev.x, y: prev.outgoing.y - prev.y } : { x: cur.x - prev.x, y: cur.y - prev.y };
        const d2 = next.incoming ? { x: next.incoming.x - next.x, y: next.incoming.y - next.y } : { x: cur.x - next.x, y: cur.y - next.y };
        const n1 = Math.hypot(d1.x, d1.y) || 1, n2 = Math.hypot(d2.x, d2.y) || 1;
        let best: { a: EditableNode; b: EditableNode; err: number } | null = null;
        for (const f of [0.2, 0.28, 0.33, 0.4, 0.5, 0.6, 0.75]) {
          const a: EditableNode = { ...prev, outgoing: { x: prev.x + d1.x / n1 * chord * f, y: prev.y + d1.y / n1 * chord * f } };
          const b: EditableNode = { ...next, incoming: { x: next.x + d2.x / n2 * chord * f, y: next.y + d2.y / n2 * chord * f } };
          let err = 0;
          // Distância de cada amostra à curva nova (polilinha fina da Bézier, medindo até os segmentos).
          const poly: Point[] = []; for (let t = 0; t <= 64; t++) poly.push(sampleSegment(a, b, t / 64));
          for (const p of samples) {
            let m = Infinity;
            for (let j = 1; j < poly.length; j++) { const u = poly[j - 1], v = poly[j], dx = v.x - u.x, dy = v.y - u.y, l = dx * dx + dy * dy, q = l ? Math.max(0, Math.min(1, ((p.x - u.x) * dx + (p.y - u.y) * dy) / l)) : 0; m = Math.min(m, Math.hypot(u.x + dx * q - p.x, u.y + dy * q - p.y)); }
            err = Math.max(err, m); if (err > tolerance) break;
          }
          if (!best || err < best.err) best = { a, b, err };
        }
        if (best && best.err <= tolerance) {
          const keep = best;
          nodes = nodes.map((n, j) => j === pi ? { ...keep.a, mode: n.mode } : j === ni ? { ...keep.b, mode: n.mode } : n).filter((_, j) => j !== i);
          ids = ids.filter((_, j) => j !== i); removed++; changed = true; break;
        }
      }
    }
    parts[k] = { nodes, closed };
  });
  return { path: removed ? fromContours(parts) : path, removed };
}
