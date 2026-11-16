import type { VectorObject } from '../document/model.ts';
export const hasOutline = (o: VectorObject) => (o.type === 'rectangle' || o.type === 'ellipse' || o.type === 'path') && !!o.stroke && o.stroke !== 'none' && (o.strokeWidth ?? 0) > 0;
export function outlineSelectionError(objects: VectorObject[], ids: string[]): string | null {
  const targets = objects.filter(o => ids.includes(o.id) && hasOutline(o));
  if (!targets.length) return 'Selecione retângulos, elipses ou curvas com contorno visível.';
  if (targets.length > 64) return 'Limite de 64 objetos por conversão.';
  if (targets.reduce((sum, o) => sum + (o.commands?.length ?? 17), 0) > 4000) return 'Seleção muito complexa: limite de 4.000 comandos por conversão.';
  return null;
}
