import type { VectorObject } from '../document/model.ts';
import { splitContours } from './compoundPaths.ts';
import { worldCommands } from './worldGeometry.ts';
import { flatten } from '../io/exporters.ts';
import { applyMatrix, around, boundsOf, clipRoot, multiply, translate, type Matrix } from './objectTransforms.ts';

export type ClipFit = 'center' | 'fit' | 'fill' | 'stretch';
export function canBeFrame(o: VectorObject | undefined): boolean {
  if (!o || o.type === 'text' || o.type === 'image') return false;
  return o.type !== 'path' || !!o.commands?.length && splitContours(o.commands).every(c => c.at(-1)?.type === 'Z');
}
export const directContents = (objects: VectorObject[], frameId: string) => objects.filter(o => o.clipParent === frameId);
/** Todos os objetos dentro do quadro, inclusive PowerClips aninhados. */
export function allContents(objects: VectorObject[], frameId: string): VectorObject[] {
  const ids = new Set([frameId]);
  for (let changed = true; changed;) { changed = false; for (const o of objects) if (o.clipParent && ids.has(o.clipParent) && !ids.has(o.id)) { ids.add(o.id); changed = true; } }
  ids.delete(frameId);
  return objects.filter(o => ids.has(o.id));
}
/**
 * Coloca os objetos selecionados dentro do quadro (PowerClip › Colocar dentro do quadro).
 * O conteúdo passa a seguir o quadro na ordem de empilhamento e no grupo do quadro.
 */
export function placeInside(objects: VectorObject[], contentIds: string[], frameId: string): VectorObject[] {
  const frame = objects.find(o => o.id === frameId);
  if (!canBeFrame(frame)) throw new Error('O quadro deve ser um retângulo, elipse ou caminho fechado.');
  if (clipRoot(objects, frame!).id !== frame!.id && contentIds.includes(clipRoot(objects, frame!).id)) throw new Error('O quadro não pode ficar dentro do próprio conteúdo.');
  const blocked = new Set([frameId, ...allContents(objects, frameId).map(o => o.id)]);
  const inside = new Set(objects.filter(o => contentIds.includes(o.id) && !blocked.has(o.id)).flatMap(o => [o.id, ...allContents(objects, o.id).map(c => c.id)]));
  if (inside.has(frameId)) throw new Error('O quadro não pode ficar dentro do próprio conteúdo.');
  if (!inside.size) throw new Error('Selecione o conteúdo e, por último, o quadro (Shift + clique).');
  const prefix = frame!.groupPath ?? [];
  const moved = objects.filter(o => inside.has(o.id)).map(o => {
    const next: VectorObject = { ...o, groupPath: [...prefix, ...(o.groupPath ?? []).filter(g => !prefix.includes(g))] };
    if (!next.groupPath!.length) delete next.groupPath;
    if (!o.clipParent || !inside.has(o.clipParent)) next.clipParent = frameId;
    return next;
  });
  const rest = objects.filter(o => !inside.has(o.id));
  const existing = new Set([frameId, ...allContents(rest, frameId).map(o => o.id)]);
  const at = Math.max(...rest.map((o, i) => existing.has(o.id) ? i : -1)) + 1;
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}
/** PowerClip › Extrair conteúdo: o conteúdo volta a ser independente e fica acima do quadro. */
export function extractContents(objects: VectorObject[], frameId: string): VectorObject[] {
  return objects.map(o => { if (o.clipParent !== frameId) return o; const next = { ...o }; delete next.clipParent; return next; });
}
export function setContentsLocked(objects: VectorObject[], frameId: string, locked: boolean): VectorObject[] {
  return objects.map(o => { if (o.id !== frameId) return o; const next = { ...o }; if (locked) delete next.clipUnlocked; else next.clipUnlocked = true; return next; });
}
/** Ao colocar dentro (CorelDRAW): conteúdo que já sobrepõe o quadro mantém a posição; o que está fora é centralizado. */
export function centerIfOutside(objects: VectorObject[], frameId: string): VectorObject[] {
  const frame = objects.find(o => o.id === frameId), contents = directContents(objects, frameId);
  if (!frame || !contents.length) return objects;
  const f = boundsOf([frame]), c = boundsOf(contents);
  const overlaps = c.x < f.x + f.width && c.x + c.width > f.x && c.y < f.y + f.height && c.y + c.height > f.y;
  return overlaps ? objects : fitContents(objects, frameId, 'center');
}
/** Ajusta o conteúdo ao quadro: centralizar, ajustar ou preencher proporcionalmente, ou esticar. */
export function fitContents(objects: VectorObject[], frameId: string, mode: ClipFit): VectorObject[] {
  const frame = objects.find(o => o.id === frameId), contents = allContents(objects, frameId);
  if (!frame || !contents.length) return objects;
  const f = boundsOf([frame]), c = boundsOf(directContents(objects, frameId));
  let sx = f.width / c.width, sy = f.height / c.height;
  if (mode === 'center') sx = sy = 1; else if (mode === 'fit') sx = sy = Math.min(sx, sy); else if (mode === 'fill') sx = sy = Math.max(sx, sy);
  const scale: Matrix = around({ x: c.x + c.width / 2, y: c.y + c.height / 2 }, [sx, 0, 0, sy, 0, 0]);
  const m = multiply(translate(f.x + f.width / 2 - c.x - c.width / 2, f.y + f.height / 2 - c.y - c.height / 2), scale);
  return applyMatrix(objects, contents.map(o => o.id), m);
}
/**
 * Forma fechada mais acima cujo interior contém o ponto (com ou sem preenchimento), para escolher o quadro
 * do "PowerClip dentro". Ignora os objetos que vão para dentro (`exclude`).
 */
export function frameAt(objects: VectorObject[], point: { x: number; y: number }, exclude: string[]): VectorObject | undefined {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (exclude.includes(o.id) || !canBeFrame(o)) continue;
    let winding = 0, crossings = 0;
    for (const contour of flatten(worldCommands(o))) {
      const p = contour.points;
      for (let j = 0; j < p.length; j++) {
        const a = p[j], b = p[(j + 1) % p.length];
        if ((a.y <= point.y) !== (b.y <= point.y)) {
          const x = a.x + (point.y - a.y) / (b.y - a.y) * (b.x - a.x);
          if (x > point.x) { crossings++; winding += b.y > a.y ? 1 : -1; }
        }
      }
    }
    if (o.fillRule === 'evenodd' ? crossings % 2 === 1 : winding !== 0) return o;
  }
  return undefined;
}
