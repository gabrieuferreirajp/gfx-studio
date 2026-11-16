import type { PathCommand, VectorObject } from '../document/model.ts';
import { worldCommands } from './worldGeometry.ts';
import { pathFromWorld } from './convertCurves.ts';

/**
 * Objeto › Combinar (Ctrl+L, como no CorelDRAW): as formas selecionadas viram uma única curva com todos os
 * contornos; onde elas se sobrepõem fica vazado (regra par-ímpar). O resultado fica com o preenchimento, contorno e
 * posição na pilha do objeto de referência: o último escolhido com Shift ou, numa seleção por área, o de baixo.
 * Textos entram pelo contorno das letras (`textOutlines`). Bitmaps e conteúdo de PowerClip ficam de fora.
 */
export function combine(objects: VectorObject[], ids: string[], textOutlines: Map<string, PathCommand[]>, reference?: string): { objects: VectorObject[]; id: string; count: number } | null {
  const targets = objects.filter(o => ids.includes(o.id) && o.type !== 'image' && !o.clipParent && !o.effectOf && (o.type !== 'text' || textOutlines.has(o.id)));
  if (targets.length < 2) return null;
  const base = targets.find(o => o.id === reference) ?? targets[0];
  const commands: PathCommand[] = targets.flatMap(o => o.type === 'text' ? textOutlines.get(o.id)! : worldCommands(o));
  const combined: VectorObject = { ...pathFromWorld(base, commands, base.type === 'path' ? base.name : 'Curva'), fillRule: 'evenodd', nodeModes: undefined };
  delete combined.nodeModes;
  // Preenchimento, contorno e transparência do objeto de referência vão juntos (degradê, padrão, cor especial, pontas…).
  for (const [key, value] of Object.entries(base)) if (/^(fill|stroke)/.test(key) && key !== 'fillRule' || ['opacity', 'blendMode', 'layer', 'transparency', 'style'].includes(key)) (combined as unknown as Record<string, unknown>)[key] = value;
  const gone = new Set(targets.map(o => o.id));
  const out: VectorObject[] = [];
  for (const o of objects) { if (o.id === base.id) out.push(combined); else if (!gone.has(o.id)) out.push(o); }
  return { objects: out, id: combined.id, count: targets.length };
}
