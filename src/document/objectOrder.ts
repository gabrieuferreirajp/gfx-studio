import type { VectorObject } from './model.ts';

/**
 * Move os objetos `ids` (com o conteúdo de PowerClip deles) para logo acima (`after`) ou abaixo do objeto `target`
 * na pilha; passam para a camada do alvo (como arrastar camadas no Photoshop ou objetos no CorelDRAW).
 */
export function moveInStack(objects: VectorObject[], ids: string[], target: string, after: boolean): VectorObject[] {
  const moving = new Set(ids);
  let grew = true; while (grew) { grew = false; for (const o of objects) if (o.clipParent && moving.has(o.clipParent) && !moving.has(o.id)) { moving.add(o.id); grew = true; } }
  if (moving.has(target)) return objects;
  const goal = objects.find(o => o.id === target);
  if (!goal) return objects;
  const picked = objects.filter(o => moving.has(o.id)).map(o => goal.layer && o.layer !== goal.layer ? { ...o, layer: goal.layer } : o), rest = objects.filter(o => !moving.has(o.id));
  let at = rest.findIndex(o => o.id === target) + (after ? 1 : 0);
  // Acima de um quadro de PowerClip: depois do conteúdo dele (que é desenhado junto com o quadro).
  if (after) while (at < rest.length && rest[at].clipParent === target) at++;
  return [...rest.slice(0, at), ...picked, ...rest.slice(at)];
}
