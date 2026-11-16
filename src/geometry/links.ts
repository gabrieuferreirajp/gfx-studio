import type { Anchor, Connector, DimLink, PathCommand, VectorDocument, VectorObject } from '../document/model.ts';
import type { Point } from './pathGeometry.ts';
import { objectCorners } from './objectTransforms.ts';
import { normalizeCommands } from './compoundPaths.ts';
import { dimensionObjects } from './dimension.ts';
import { approximateMeasure, updateText } from '../text/textLayout.ts';
import { worldCommands } from './worldGeometry.ts';
import { refreshEffects, remapEffect } from './effectLinks.ts';
import { refreshPathTexts } from '../text/pathLinks.ts';

/**
 * Ligações vivas (CorelDRAW): conectores presos a objetos e cotas que acompanham o objeto medido.
 * Uma âncora guarda o objeto e a posição relativa (u, v) na caixa dele, além do último ponto (x, y) usado;
 * a cada alteração do documento, o que estiver ligado a um objeto que mudou é refeito (`refreshLinks`).
 */
const linkable = (o: VectorObject) => !o.connector && !o.dimLink && o.width > 0 && o.height > 0;
/** Ponto do documento na caixa (transformada) do objeto. */
export function anchorWorld(o: VectorObject, u: number, v: number): Point {
  const [tl, tr, , bl] = objectCorners(o);
  return { x: tl.x + (tr.x - tl.x) * u + (bl.x - tl.x) * v, y: tl.y + (tr.y - tl.y) * u + (bl.y - tl.y) * v };
}
/** Âncora presa ao objeto no ponto `p` (coordenadas relativas à caixa transformada). */
export function anchorOn(o: VectorObject, p: Point): Anchor {
  const [tl, tr, , bl] = objectCorners(o), ax = tr.x - tl.x, ay = tr.y - tl.y, bx = bl.x - tl.x, by = bl.y - tl.y, det = ax * by - ay * bx;
  if (Math.abs(det) < 1e-12) return { x: p.x, y: p.y };
  const dx = p.x - tl.x, dy = p.y - tl.y;
  return { id: o.id, u: (dx * by - dy * bx) / det, v: (ax * dy - ay * dx) / det, x: p.x, y: p.y };
}
/** Pontos de ligação do objeto: cantos, meios dos lados, centro e nós dos caminhos. */
export function linkPoints(o: VectorObject): Point[] {
  const c = objectCorners(o), mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const points = [...c, mid(c[0], c[1]), mid(c[1], c[2]), mid(c[2], c[3]), mid(c[3], c[0]), mid(c[0], c[2])];
  if (o.type === 'path' && (o.commands?.length ?? 0) < 2000) for (const k of worldCommands(o)) if (k.type !== 'Z') points.push({ x: k.x, y: k.y });
  return points;
}
/** Objeto e ponto de ligação mais próximos de `p` (dentro de `radius`); objetos da frente têm prioridade no empate. */
export function nearestLink(objects: VectorObject[], p: Point, radius: number, exclude: string[] = []): { object: VectorObject; point: Point } | null {
  let best: { object: VectorObject; point: Point } | null = null, distance = radius;
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (!linkable(o) || exclude.includes(o.id)) continue;
    for (const q of linkPoints(o)) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < distance - 1e-9) { distance = d; best = { object: o, point: q }; } }
  }
  return best;
}
/** Âncora para um ponto já encaixado: presa ao objeto cujo ponto de ligação ou borda passa por ele. */
export function anchorAt(objects: VectorObject[], p: Point, tolerance: number): Anchor {
  const node = nearestLink(objects, p, tolerance);
  if (node) return anchorOn(node.object, p);
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (!linkable(o) || (o.type !== 'path' && o.type !== 'rectangle' && o.type !== 'ellipse')) continue;
    const a = anchorOn(o, p);
    if (a.id === undefined || a.u! < -0.01 || a.u! > 1.01 || a.v! < -0.01 || a.v! > 1.01) continue;
    if (nearEdge(o, p, tolerance)) return a;
  }
  return { x: p.x, y: p.y };
}
function nearEdge(o: VectorObject, p: Point, tolerance: number) {
  let last: Point | null = null, start: Point | null = null;
  const segment = (a: Point, b: Point) => { const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0; return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) <= tolerance; };
  for (const c of worldCommands(o)) {
    if (c.type === 'M') { last = start = { x: c.x, y: c.y }; continue; }
    if (c.type === 'Z') { if (last && start && segment(last, start)) return true; last = start; continue; }
    if (!last) continue;
    if (c.type === 'C') { let prev = last; for (let k = 1; k <= 12; k++) { const t = k / 12, s = 1 - t, q = { x: s * s * s * last.x + 3 * s * s * t * c.x1 + 3 * s * t * t * c.x2 + t * t * t * c.x, y: s * s * s * last.y + 3 * s * s * t * c.y1 + 3 * s * t * t * c.y2 + t * t * t * c.y }; if (segment(prev, q)) return true; prev = q; } }
    else if (segment(last, c)) return true;
    last = { x: c.x, y: c.y };
  }
  return false;
}
const resolve = (byId: Map<string, VectorObject>, a: Anchor): Point => {
  const o = a.id !== undefined ? byId.get(a.id) : undefined;
  return o && a.u !== undefined && a.v !== undefined ? anchorWorld(o, a.u, a.v) : { x: a.x, y: a.y };
};
const moved = (a: Anchor, p: Point) => Math.hypot(a.x - p.x, a.y - p.y) > 1e-6;
/** Direção de saída: âncora num lado esquerdo/direito sai na horizontal; topo/base, na vertical. */
function exit(a: Anchor, from: Point, to: Point): 'h' | 'v' {
  if (a.u !== undefined && a.v !== undefined) {
    const side = Math.min(Math.abs(a.u), Math.abs(1 - a.u)), top = Math.min(Math.abs(a.v), Math.abs(1 - a.v));
    if (side < 0.02 && top >= 0.02) return 'h';
    if (top < 0.02 && side >= 0.02) return 'v';
  }
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? 'h' : 'v';
}
/** Pontos do traçado: reto, ou em ângulo reto (H-V-H, V-H-V ou em L conforme as saídas). */
export function connectorPoints(kind: Connector['kind'], a: Point, b: Point, exitA: 'h' | 'v', exitB: 'h' | 'v'): Point[] {
  if (kind === 'straight') return [a, b];
  if (Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6) return [a, b];
  if (exitA === 'h' && exitB === 'h') { const mx = (a.x + b.x) / 2; return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]; }
  if (exitA === 'v' && exitB === 'v') { const my = (a.y + b.y) / 2; return [a, { x: a.x, y: my }, { x: b.x, y: my }, b]; }
  return exitA === 'h' ? [a, { x: b.x, y: a.y }, b] : [a, { x: a.x, y: b.y }, b];
}
/** Comandos do conector; no arredondado, os cantos viram arcos (raio até 12 px, limitado pelos trechos). */
export function connectorCommands(kind: Connector['kind'], points: Point[]): PathCommand[] {
  const commands: PathCommand[] = [{ type: 'M', ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const p = points[i], prev = points[i - 1], next = points[i + 1];
    if (kind !== 'rounded' || !next) { commands.push({ type: 'L', ...p }); continue; }
    const l1 = Math.hypot(p.x - prev.x, p.y - prev.y), l2 = Math.hypot(next.x - p.x, next.y - p.y), r = Math.min(12, l1 / 2, l2 / 2);
    if (r < 0.5) { commands.push({ type: 'L', ...p }); continue; }
    const s = { x: p.x + (prev.x - p.x) / l1 * r, y: p.y + (prev.y - p.y) / l1 * r }, e = { x: p.x + (next.x - p.x) / l2 * r, y: p.y + (next.y - p.y) / l2 * r }, k = 0.5523;
    commands.push({ type: 'L', ...s }, { type: 'C', x1: s.x + (p.x - s.x) * k, y1: s.y + (p.y - s.y) * k, x2: e.x + (p.x - e.x) * k, y2: e.y + (p.y - e.y) * k, x: e.x, y: e.y });
  }
  return commands;
}
/** Caminho do conector com os pontos atuais das âncoras (sem matriz: geometria em coordenadas do documento). */
export function connectorObject(base: VectorObject, connector: Connector, a: Point, b: Point): VectorObject {
  const geometry = normalizeCommands(connectorCommands(connector.kind, connectorPoints(connector.kind, a, b, exit(connector.from, a, b), exit(connector.to, b, a))));
  const { transform: _t, nodeModes: _n, ...rest } = base;
  return { ...rest, ...geometry, connector: { ...connector, from: { ...connector.from, x: a.x, y: a.y }, to: { ...connector.to, x: b.x, y: b.y } } };
}
/** Cota refeita entre os novos pontos, mantendo IDs, grupo, camada, cor e o tamanho do texto já medido. */
function rebuildDimension(parts: VectorObject[], text: VectorObject, link: DimLink, a: Point, b: Point): VectorObject[] {
  const generated = dimensionObjects(a, b, link.offset, link.unit ?? 'px', approximateMeasure, link.color, { precision: link.precision, showUnit: link.showUnit, fontSize: link.fontSize, ...(link.axis ? { axis: link.axis } : {}) });
  const others = parts.filter(o => o !== text), extras = { groupPath: text.groupPath, ...(text.layer ? { layer: text.layer } : {}) };
  let k = 0;
  return generated.map(g => {
    if (g.type !== 'text') return { ...g, ...extras, id: others[k++]?.id ?? crypto.randomUUID() };
    // Largura real (fonte da tela) proporcional à medida aproximada: o texto continua centrado na cota.
    const reference = updateText({ ...g, text: text.text }, {}, approximateMeasure), ratio = reference.width > 0 ? text.width / reference.width : 1;
    const width = g.text === text.text ? text.width : g.width * ratio;
    return { ...text, x: g.x + (g.width - width) / 2, y: g.y, width, height: text.height, text: g.text, ...(g.transform ? { transform: g.transform } : { transform: undefined }), ...extras, dimLink: { ...link, a: { ...link.a, x: a.x, y: a.y }, b: { ...link.b, x: b.x, y: b.y } } };
  }).map(o => { if (o.transform === undefined) delete o.transform; return o; });
}
/** Refaz conectores e cotas cujos objetos ligados mudaram; devolve o mesmo documento se nada mudou. */
export function refreshLinks(document: VectorDocument): VectorDocument {
  return refreshPathTexts(refreshEffects(refreshConnections(document)));
}
function refreshConnections(document: VectorDocument): VectorDocument {
  if (!document.objects.some(o => o.connector || o.dimLink)) return document;
  const byId = new Map(document.objects.map(o => [o.id, o]));
  let objects = document.objects, changed = false;
  for (const o of document.objects) {
    if (!o.connector) continue;
    const a = resolve(byId, o.connector.from), b = resolve(byId, o.connector.to);
    if (!moved(o.connector.from, a) && !moved(o.connector.to, b)) continue;
    const next = connectorObject(o, o.connector, a, b);
    objects = objects.map(x => x.id === o.id ? next : x); changed = true;
  }
  for (const text of document.objects) {
    if (!text.dimLink || text.type !== 'text') continue;
    const link = text.dimLink, a = resolve(byId, link.a), b = resolve(byId, link.b);
    if (!moved(link.a, a) && !moved(link.b, b)) continue;
    const group = text.groupPath?.at(-1);
    const parts = group ? objects.filter(o => o.groupPath?.at(-1) === group) : [text];
    const current = objects.find(o => o.id === text.id)!, rebuilt = rebuildDimension(parts, current, link, a, b), first = objects.findIndex(o => parts.includes(o));
    const rest = objects.filter(o => !parts.includes(o));
    objects = [...rest.slice(0, first), ...rebuilt, ...rest.slice(first)]; changed = true;
  }
  return changed ? { ...document, objects } : document;
}
/** Ao copiar objetos com IDs novos: âncoras passam aos novos IDs; ligadas a algo que não foi copiado viram estáticas. */
export function remapLinks(o: VectorObject, map: (id: string) => string | undefined): VectorObject {
  const anchor = (a: Anchor): Anchor | null => { if (a.id === undefined) return a; const id = map(a.id); return id ? { ...a, id } : null; };
  let next = remapEffect(o, map);
  if (o.connector) { const from = anchor(o.connector.from), to = anchor(o.connector.to); if (from && to) next = { ...next, connector: { ...o.connector, from, to } }; else { const { connector: _, ...rest } = next; next = rest; } }
  if (o.dimLink) { const a = anchor(o.dimLink.a), b = anchor(o.dimLink.b); if (a && b) next = { ...next, dimLink: { ...o.dimLink, a, b } }; else { const { dimLink: _, ...rest } = next; next = rest; } }
  // Texto em caminho copiado sem a curva: fica com a forma do caminho, sem ligação.
  if (o.textPath?.source) { const source = map(o.textPath.source); const { source: _s, ...tp } = o.textPath; next = { ...next, textPath: source ? { ...tp, source } : tp }; }
  return next;
}
