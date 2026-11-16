import type { EffectLink, VectorDocument, VectorObject } from '../document/model.ts';
import { worldCommands } from './worldGeometry.ts';
import { localBox, matrixOf, multiply } from './objectTransforms.ts';
import type { ContourParams, SweepParams } from './effects.ts';

/**
 * Efeitos vivos do CorelDRAW (Bloquear sombra e Contorno): os objetos do efeito ficam ligados ao original.
 * Mover o original move o efeito na hora; mudar a forma (tamanho, nós, giro) marca o efeito para ser
 * recalculado no motor vetorial (`stale`). Apagar o original apaga o efeito. Separar (Ctrl+K) solta as peças.
 */
export type LinkedKind = EffectLink['kind'];
const linkable = (o: VectorObject) => (o.type === 'rectangle' || o.type === 'ellipse' || o.type === 'path') && !o.effectOf;

/** Assinatura da geometria do original: posição do 1º ponto e um resumo da forma relativa a ele. */
export function effectSignature(o: VectorObject): { origin: { x: number; y: number }; shape: string } {
  const world = worldCommands(o), first = world.find(c => c.type !== 'Z') as { x: number; y: number } | undefined;
  const ox = first?.x ?? 0, oy = first?.y ?? 0;
  let h = 2166136261;
  const mix = (v: number) => { h ^= v & 0xffff; h = Math.imul(h, 16777619); h ^= v >>> 16; h = Math.imul(h, 16777619); };
  const feed = (x: number, y: number) => { mix(Math.round((x - ox) * 100) | 0); mix(Math.round((y - oy) * 100) | 0); };
  for (const c of world) { mix(c.type.charCodeAt(0)); if (c.type === 'C') { feed(c.x1, c.y1); feed(c.x2, c.y2); } if (c.type !== 'Z') feed(c.x, c.y); }
  return { origin: { x: ox, y: oy }, shape: `${(o.fillRule ?? 'nonzero')[0]}${(h >>> 0).toString(36)}:${world.length}` };
}
export const sweepParams = (link: EffectLink): SweepParams => ({ mode: 'shadow', dx: link.dx ?? 0, dy: link.dy ?? 0, color: link.color ?? '#000000', shade: 0 });
export const contourParams = (link: EffectLink): ContourParams => ({ direction: link.direction ?? 'outside', steps: link.steps ?? 1, offset: link.offset ?? 4, endColor: link.endColor ?? '#ffffff', corners: link.corners ?? 'round' });

/** Efeitos ligados ao objeto `id` (de um tipo, ou todos). */
export const linkedPieces = (objects: VectorObject[], id: string, kind?: LinkedKind) => objects.filter(o => o.effectOf?.id === id && (!kind || o.effectOf.kind === kind));
/** Original do efeito de que `o` faz parte (ou o próprio objeto). */
export const effectSource = (objects: VectorObject[], o: VectorObject) => o.effectOf ? objects.find(s => s.id === o.effectOf!.id) ?? null : o;

/**
 * Peças novas do efeito (resultado do motor vetorial) ligadas ao original e colocadas junto dele:
 * a sombra e o contorno para fora ficam atrás; o contorno para dentro fica na frente.
 * Peças antigas do mesmo efeito são substituídas.
 */
export function placeLinked(objects: VectorObject[], source: VectorObject, kind: LinkedKind, pieces: VectorObject[], link: Omit<EffectLink, 'id' | 'kind' | 'origin' | 'shape' | 'stale'>): { objects: VectorObject[]; ids: string[] } {
  const sig = effectSignature(source), group = kind === 'contour' && pieces.length > 1 ? crypto.randomUUID() : null;
  const made = pieces.map(p => {
    const { groupPath: _g, effectOf: _e, ...rest } = p;
    const groupPath = [...(source.groupPath ?? []), ...(group ? [group] : [])];
    const m = matrixOf(p);
    return { ...rest, ...(groupPath.length ? { groupPath } : {}), ...(source.layer ? { layer: source.layer } : {}), effectOf: { id: source.id, kind, ...link, ...sig, at: { x: m[4], y: m[5] } } } as VectorObject;
  });
  const rest = objects.filter(o => !(o.effectOf?.id === source.id && o.effectOf.kind === kind));
  const at = rest.findIndex(o => o.id === source.id);
  if (at < 0) return { objects, ids: [] };
  const front = kind === 'contour' && link.direction === 'inside';
  const index = front ? at + 1 : at;
  return { objects: [...rest.slice(0, index), ...made, ...rest.slice(index)], ids: made.map(o => o.id) };
}

/** Acompanha os originais: move os efeitos com eles, marca para refazer quando a forma muda, apaga órfãos. */
export function refreshEffects(document: VectorDocument): VectorDocument {
  if (!document.objects.some(o => o.effectOf)) return document;
  const byId = new Map(document.objects.map(o => [o.id, o])), sigs = new Map<string, ReturnType<typeof effectSignature>>();
  let changed = false;
  const objects = document.objects.flatMap(o => {
    const link = o.effectOf; if (!link) return [o];
    const source = byId.get(link.id);
    if (!source || !linkable(source)) { changed = true; return []; }
    let sig = sigs.get(source.id); if (!sig) { sig = effectSignature(source); sigs.set(source.id, sig); }
    if (sig.shape !== link.shape) { if (link.stale) return [o]; changed = true; return [{ ...o, effectOf: { ...link, stale: true } }]; }
    // O efeito anda junto com o original: só compensa o que o próprio efeito ainda não andou
    // (mover os dois juntos ou duplicar não desloca em dobro; mover só o efeito o devolve ao lugar).
    const m = matrixOf(o), at = link.at ?? { x: m[4], y: m[5] };
    const dx = sig.origin.x - link.origin.x - (m[4] - at.x), dy = sig.origin.y - link.origin.y - (m[5] - at.y);
    const moved = Math.abs(sig.origin.x - link.origin.x) > 1e-9 || Math.abs(sig.origin.y - link.origin.y) > 1e-9 || Math.abs(m[4] - at.x) > 1e-9 || Math.abs(m[5] - at.y) > 1e-9;
    if (!moved && !link.stale) return [o];
    changed = true;
    const { stale: _s, ...rest } = link, transform = Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9 ? multiply([1, 0, 0, 1, dx, dy], m) : m;
    return [{ ...o, transform, effectOf: { ...rest, origin: sig.origin, at: { x: transform[4], y: transform[5] } } }];
  });
  return changed ? { ...document, objects } : document;
}

/** Separar (Ctrl+K): solta as peças dos efeitos ligados aos objetos selecionados (ou das peças selecionadas). */
export function separateEffects(objects: VectorObject[], ids: string[]): { objects: VectorObject[]; pieces: string[]; kind: LinkedKind | null } {
  const chosen = new Set(ids), sources = new Set(objects.filter(o => chosen.has(o.id)).map(o => o.effectOf ? o.effectOf.id : o.id));
  const pieces: string[] = []; let kind: LinkedKind | null = null;
  const next = objects.map(o => {
    if (!o.effectOf || !sources.has(o.effectOf.id)) return o;
    pieces.push(o.id); kind = o.effectOf.kind;
    const { effectOf: _, ...rest } = o; return rest;
  });
  return { objects: pieces.length ? next : objects, pieces, kind };
}
/**
 * Separar Grupo de sombra (CorelDRAW): a sombra projetada vira um objeto próprio atrás do original, com a cor,
 * a opacidade e o desfoque da sombra, já deslocado. O original fica sem sombra.
 */
export function separateShadows(objects: VectorObject[], ids: string[]): { objects: VectorObject[]; pieces: string[] } {
  const chosen = new Set(ids), pieces: string[] = [];
  const next = objects.flatMap(o => {
    if (!chosen.has(o.id) || !o.shadow) return [o];
    const s = o.shadow, { shadow: _s, ...plain } = o;
    const { effectOf: _e, crop: _c, mask: _m, connector: _k, dimLink: _d, fillGradient: _g, fillPattern: _p, meshFill: _h, transparencyGradient: _t, blendMode: _b, style: _y, fillStyle: _f, strokeStyle: _z, symbol: _q, src: _i, ...base } = plain;
    const box = localBox(o), painted = (c?: string) => !!c && c !== 'none';
    const shape: VectorObject = o.type === 'image'
      ? { ...base, type: 'rectangle', x: box.x, y: box.y, width: box.width, height: box.height, fill: s.color, stroke: 'none', strokeWidth: 0 }
      : { ...base, fill: painted(o.fill) || o.fillGradient || o.fillPattern || o.meshFill ? s.color : 'none', stroke: painted(o.stroke) ? s.color : o.stroke };
    const shadow: VectorObject = { ...shape, id: crypto.randomUUID(), name: 'Sombra', transform: multiply([1, 0, 0, 1, s.x, s.y], matrixOf(o)), opacity: s.opacity, ...(s.blur > 0 ? { blur: s.blur } : {}) };
    if (shadow.opacity! >= 1) delete shadow.opacity;
    pieces.push(shadow.id);
    return [shadow, plain];
  });
  return { objects: pieces.length ? next : objects, pieces };
}
/** Nome do comando Separar para a seleção (ou null se não há efeito ligado). */
export function separateLabel(objects: VectorObject[], ids: string[]): string | null {
  const chosen = new Set(ids), sources = new Set(objects.filter(o => chosen.has(o.id)).map(o => o.effectOf ? o.effectOf.id : o.id));
  const piece = objects.find(o => o.effectOf && sources.has(o.effectOf.id));
  if (!piece && objects.some(o => chosen.has(o.id) && o.shadow)) return 'Separar Grupo de sombra';
  return piece ? `Separar ${piece.effectOf!.kind === 'blockShadow' ? 'Bloquear sombra' : 'Grupo de contorno'}` : null;
}
/** Ao copiar com IDs novos: o efeito segue a cópia do original; sem o original, vira objeto comum. */
export function remapEffect(o: VectorObject, map: (id: string) => string | undefined): VectorObject {
  if (!o.effectOf) return o;
  const id = map(o.effectOf.id);
  if (id) return { ...o, effectOf: { ...o.effectOf, id } };
  const { effectOf: _, ...rest } = o; return rest;
}
