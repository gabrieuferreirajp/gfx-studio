import type { PathCommand, VectorDocument, VectorObject } from '../document/model.ts';
import { worldCommands } from '../geometry/worldGeometry.ts';
import { nearestOnPath, pointAt, polylineOf, type Polyline } from './textPath.ts';
import { approximateMeasure, pathTextStart, updateText, type Measure } from './textLayout.ts';
import { browserMeasure } from './textMeasure.ts';

/**
 * Texto em caminho ligado à curva (CorelDRAW): mover, girar ou editar os nós da curva leva o texto junto; arrastar só o
 * texto o faz deslizar ao longo da curva (a matriz que o arraste aplicou vira deslocamento no caminho).
 */
const measure: Measure = (text, font) => typeof document !== 'undefined' ? browserMeasure(text, font) : approximateMeasure(text, font);
const safeWorld = (o: VectorObject): PathCommand[] => { try { return worldCommands(o); } catch { return []; } };
const r = (v: number) => Math.round(v * 1000) / 1000;
const signature = (commands: PathCommand[]) => commands.map(c => c.type === 'Z' ? 'Z' : c.type === 'C' ? `C${r(c.x1)},${r(c.y1)},${r(c.x2)},${r(c.y2)},${r(c.x)},${r(c.y)}` : `${c.type}${r(c.x)},${r(c.y)}`).join(' ');
const isIdentity = (m?: number[]) => !m || m.every((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) < 1e-9);
/** Curvas, retângulos e elipses podem receber texto (não textos nem bitmaps). */
export const canCarryText = (o: VectorObject) => (o.type === 'path' || o.type === 'rectangle' || o.type === 'ellipse') && !o.dimLink && !o.connector;

export function refreshPathTexts(document: VectorDocument): VectorDocument {
  if (!document.objects.some(o => o.textPath?.source)) return document;
  const byId = new Map(document.objects.map(o => [o.id, o]));
  let changed = false;
  const objects = document.objects.map(o => {
    const tp = o.textPath, source = tp?.source ? byId.get(tp.source) : undefined;
    if (o.type !== 'text' || !tp || !source || !canCarryText(source)) return o;
    const m = o.transform, moved = !isIdentity(m), commands = safeWorld(source);
    if (commands.length < 2) return o;
    const pathChanged = signature(commands) !== signature(tp.commands);
    if (!pathChanged && !moved) return o;
    const { transform: _t, ...rest } = o;
    let next: VectorObject = { ...rest, textPath: { ...tp, commands } };
    if (moved && m) {
      // Escala aplicada ao texto (sozinho ou junto com a curva) muda o tamanho da fonte; o giro é o da curva.
      const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      if (Math.abs(scale - 1) > 1e-6 && o.fontSize) next.fontSize = Math.max(1, Math.min(3000, o.fontSize * scale));
      if (!pathChanged) {
        // Só o texto foi arrastado: o começo dele vai para o ponto da curva mais próximo de onde foi solto.
        const { path, start } = pathTextStart(o, measure), from = pointAt(path, start).point;
        const to = { x: m[0] * from.x + m[2] * from.y + m[4], y: m[1] * from.x + m[3] * from.y + m[5] };
        next = { ...next, textPath: { ...next.textPath!, offset: tp.offset + slide(path, start, nearestOnPath(path, to).s) } };
      }
    }
    changed = true;
    return updateText(next, {}, measure);
  });
  return changed ? { ...document, objects } : document;
}
/** Quanto andar ao longo da curva; em curvas fechadas, pelo caminho mais curto (o texto dá a volta). */
function slide(path: Polyline, from: number, to: number) {
  let d = to - from;
  if (path.closed && path.total > 0) { const from0 = ((from % path.total) + path.total) % path.total; d = to - from0; if (d > path.total / 2) d -= path.total; if (d < -path.total / 2) d += path.total; }
  return d;
}
/** Curva sob o cursor da ferramenta Texto (a menos de `tolerance` do contorno): onde o texto em caminho começaria. */
export function pathTextTarget(objects: VectorObject[], p: { x: number; y: number }, tolerance: number, skip: (o: VectorObject) => boolean): { object: VectorObject; s: number; point: { x: number; y: number } } | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (!canCarryText(o) || skip(o)) continue;
    const c = cached(o);
    if (!c || p.x < c.box.x - tolerance || p.x > c.box.x2 + tolerance || p.y < c.box.y - tolerance || p.y > c.box.y2 + tolerance) continue;
    const hit = nearestOnPath(c.path, p);
    if (hit.distance <= tolerance) return { object: o, s: hit.s, point: hit.point };
  }
  return null;
}
/** Polilinha e caixa de cada objeto, guardadas enquanto o objeto não muda (o objeto é imutável). */
const cache = new WeakMap<VectorObject, { path: Polyline; box: { x: number; y: number; x2: number; y2: number } } | null>();
function cached(o: VectorObject) {
  if (cache.has(o)) return cache.get(o)!;
  const commands = safeWorld(o);
  let value = null;
  if (commands.length >= 2 && commands.length <= 20000) {
    const path = polylineOf(commands), box = { x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity };
    for (const q of path.points) { box.x = Math.min(box.x, q.x); box.y = Math.min(box.y, q.y); box.x2 = Math.max(box.x2, q.x); box.y2 = Math.max(box.y2, q.y); }
    if (path.points.length > 1) value = { path, box };
  }
  cache.set(o, value);
  return value;
}
