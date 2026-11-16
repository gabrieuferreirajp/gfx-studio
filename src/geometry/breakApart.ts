import type { VectorObject } from '../document/model.ts';
import { splitContours } from './compoundPaths.ts';
import { worldCommands } from './worldGeometry.ts';
import { pathFromWorld } from './convertCurves.ts';
import { cssFont, fontPx, lineLayout, updateText, type Measure } from '../text/textLayout.ts';

/** Partes de um texto: várias linhas → linhas; uma linha → palavras; uma palavra → letras (como no CorelDRAW). */
function textPieces(o: VectorObject, measure: Measure): VectorObject[] {
  const lines = lineLayout(o, measure).filter(l => l.line.trim());
  const piece = (text: string, x: number, top: number, id: string): VectorObject => {
    const base: VectorObject = { ...o, id, text, x, y: top, textAlign: undefined };
    delete base.textAlign; delete base.paragraph; if (base.name === 'Texto de parágrafo') base.name = 'Texto';
    return updateText(base, {}, measure);
  };
  if (lines.length > 1) return lines.map((l, i) => piece(l.line, l.x, l.baseline - fontPx(o) * 0.9, i === 0 ? o.id : crypto.randomUUID()));
  const line = lines[0];
  if (!line) return [o];
  const font = cssFont(o), top = line.baseline - fontPx(o) * 0.9;
  const words = [...line.line.matchAll(/\S+/g)];
  const parts = words.length > 1 ? words.map(w => ({ text: w[0], at: w.index! })) : [...line.line.trim()].length > 1 ? [...line.line].map((ch, i) => ({ text: ch, at: [...line.line].slice(0, i).join('').length })).filter(p => p.text.trim()) : [];
  if (!parts.length) return [o];
  return parts.map((p, i) => piece(p.text, line.x + measure(line.line.slice(0, p.at), font), top, i === 0 ? o.id : crypto.randomUUID()));
}
/**
 * Objeto › Quebrar curva em partes (Ctrl+K): cada contorno de uma curva vira um objeto; textos se separam
 * em linhas, palavras ou letras. Estilo, grupo e PowerClip do original são mantidos; o primeiro pedaço mantém o ID.
 */
export function breakApart(objects: VectorObject[], ids: string[], measure: Measure): { objects: VectorObject[]; pieces: string[]; broken: number } {
  const pieces: string[] = []; let broken = 0;
  const output = objects.flatMap(o => {
    if (!ids.includes(o.id)) return [o];
    if (objects.some(c => c.clipParent === o.id)) { pieces.push(o.id); return [o]; }
    let parts: VectorObject[] = [o];
    if (o.type === 'path') {
      const contours = splitContours(worldCommands(o));
      if (contours.length > 1) parts = contours.map((c, i) => ({ ...pathFromWorld({ ...o, id: i === 0 ? o.id : crypto.randomUUID() }, c, o.name), ...(c.at(-1)?.type === 'Z' ? {} : { fill: 'none' }) }));
    } else if (o.type === 'text' && o.fontSize !== undefined && !o.textPath) parts = textPieces(o, measure);
    if (parts.length > 1) broken++;
    pieces.push(...parts.map(p => p.id));
    return parts;
  });
  return { objects: output, pieces, broken };
}
