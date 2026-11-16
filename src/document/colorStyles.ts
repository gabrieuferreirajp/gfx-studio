import type { ColorStyle, VectorDocument, VectorObject } from './model.ts';
import { mapDocument } from './library.ts';
import { solidFill } from './paint.ts';

/**
 * Estilos de cor (CorelDRAW, Ctrl+F6): cores com nome guardadas no documento. Objetos ligados (`fillStyle`,
 * `strokeStyle`) mudam juntos quando a cor do estilo é alterada, em todas as páginas.
 * O vínculo só vale enquanto o objeto continua com a cor do estilo: se a cor for trocada por outro meio
 * (paleta, conta-gotas…), o objeto deixa de acompanhar, como no Corel.
 */
type Part = 'fill' | 'stroke';
const same = (a: string | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();
const solid = (o: VectorObject) => !o.fillGradient && !o.fillPattern && !o.meshFill;
/** Cor atual do objeto que pode virar estilo (preenchimento sólido ou contorno). */
export function colorOf(o: VectorObject, part: Part): string | null {
  const c = part === 'fill' ? (solid(o) ? o.fill : 'none') : o.stroke ?? 'none';
  return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null;
}
const unlinked = (o: VectorObject, part: Part): VectorObject => { const { [part === 'fill' ? 'fillStyle' : 'strokeStyle']: _, ...rest } = o; return rest as VectorObject; };
/** O objeto está de fato ligado ao estilo (vínculo + mesma cor)? */
export function isLinked(o: VectorObject, part: Part, style: ColorStyle) {
  return (part === 'fill' ? o.fillStyle : o.strokeStyle) === style.id && same(colorOf(o, part) ?? undefined, style.color);
}
/** Aplica a cor do estilo ao preenchimento ou contorno e liga o objeto. */
export function paintWith(o: VectorObject, part: Part, style: ColorStyle): VectorObject {
  if (part === 'fill') return o.type === 'image' ? o : { ...solidFill(o, style.color), fillStyle: style.id };
  return { ...o, stroke: style.color, strokeWidth: o.strokeWidth || 1, strokeStyle: style.id };
}
/** Cria estilos com as cores dos objetos (reaproveita estilos de mesma cor) e liga os objetos a eles. */
export function stylesFromSelection(document: VectorDocument, ids: string[], uuid = () => crypto.randomUUID()) {
  const styles = [...(document.colorStyles ?? [])], created: ColorStyle[] = [];
  const styleFor = (color: string) => {
    const found = styles.find(s => same(color, s.color)); if (found) return found;
    const style = { id: uuid(), name: `Estilo de cor ${styles.length + 1}`, color }; styles.push(style); created.push(style); return style;
  };
  let linked = 0;
  const objects = document.objects.map(o => {
    if (!ids.includes(o.id)) return o;
    let next = o;
    for (const part of ['fill', 'stroke'] as Part[]) { const c = colorOf(o, part); if (c && !(part === 'fill' && o.type === 'image')) { next = { ...next, [part === 'fill' ? 'fillStyle' : 'strokeStyle']: styleFor(c).id }; linked++; } }
    return next;
  });
  if (styles.length > 500) throw new Error('Limite de 500 estilos de cor.');
  return { colorStyles: styles, created, linked, document: { objects, pages: document.pages, page: document.page } };
}
/** Muda a cor do estilo e de todos os objetos ainda ligados a ele (todas as páginas); vínculos quebrados são limpos. */
export function recolorStyle(document: VectorDocument, id: string, color: string) {
  const old = document.colorStyles?.find(s => s.id === id);
  if (!old) throw new Error('Estilo de cor não encontrado.');
  const style = { ...old, color: color.toLowerCase() }, colorStyles = (document.colorStyles ?? []).map(s => s.id === id ? style : s);
  let changed = 0;
  const update = (o: VectorObject) => {
    let next = o;
    for (const part of ['fill', 'stroke'] as Part[]) {
      if ((part === 'fill' ? o.fillStyle : o.strokeStyle) !== id) continue;
      if (isLinked(o, part, old)) { next = paintWith(next, part, style); changed++; } else next = unlinked(next, part);
    }
    return next;
  };
  return { colorStyles, changed, document: mapDocument(document, list => list.map(update)) };
}
/** Exclui o estilo; os objetos mantêm a cor e perdem o vínculo. */
export function deleteColorStyle(document: VectorDocument, id: string) {
  return { colorStyles: (document.colorStyles ?? []).filter(s => s.id !== id), document: mapDocument(document, list => list.map(o => { let next = o; if (o.fillStyle === id) next = unlinked(next, 'fill'); if (o.strokeStyle === id) next = unlinked(next, 'stroke'); return next; })) };
}
/** Objetos (todas as páginas) que acompanham o estilo. */
export function colorStyleUsage(document: VectorDocument, style: ColorStyle) {
  const all = [...document.objects, ...(document.pages ?? []).flatMap((p, i) => i === (document.page ?? 0) ? [] : p.objects)];
  return all.filter(o => isLinked(o, 'fill', style) || isLinked(o, 'stroke', style)).length;
}
