import type { Layer, VectorDocument, VectorObject } from './model.ts';

/** Camadas no estilo CorelDRAW (de baixo para cima). Documento sem `layers` tem uma camada implícita. */
export const DEFAULT_LAYER = 'camada-1';
export const newLayer = (name: string, id: string = crypto.randomUUID()): Layer => ({ id, name, visible: true, locked: false, printable: true });
export const layerList = (doc: VectorDocument): Layer[] => doc.layers?.length ? doc.layers : [newLayer('Camada 1', DEFAULT_LAYER)];
export const activeLayerId = (doc: VectorDocument) => { const list = layerList(doc); return list.some(l => l.id === doc.activeLayer) ? doc.activeLayer! : list.at(-1)!.id; };
const layerOf = (doc: VectorDocument, o: VectorObject) => doc.layers?.find(l => l.id === o.layer);
export const isHidden = (doc: VectorDocument, o: VectorObject) => !!o.hidden || layerOf(doc, o)?.visible === false;
/** Não pode ser clicado nem selecionado: objeto bloqueado, camada travada ou oculta. */
export const isBlocked = (doc: VectorDocument, o: VectorObject) => !!o.locked || layerOf(doc, o)?.locked === true || isHidden(doc, o);
/** Entra na impressão e na exportação: camada visível e imprimível. */
export const isPrintable = (doc: VectorDocument, o: VectorObject) => { if (o.hidden) return false; const l = layerOf(doc, o); return !l || (l.visible && l.printable); };

export interface LayerState { layers: Layer[]; activeLayer: string; objects?: VectorObject[] }
/** Documento antigo ganha a camada 1 explícita, com todos os objetos nela. */
function explicit(doc: VectorDocument): { layers: Layer[]; objects: VectorObject[] } {
  if (doc.layers?.length) return { layers: doc.layers, objects: doc.objects };
  return { layers: [newLayer('Camada 1', DEFAULT_LAYER)], objects: doc.objects.map(o => ({ ...o, layer: DEFAULT_LAYER })) };
}
export function addLayer(doc: VectorDocument, id: string = crypto.randomUUID()): LayerState {
  const { layers, objects } = explicit(doc), active = activeLayerId(doc);
  let n = layers.length + 1; while (layers.some(l => l.name === `Camada ${n}`)) n++;
  const at = layers.findIndex(l => l.id === active) + 1;
  return { layers: [...layers.slice(0, at), newLayer(`Camada ${n}`, id), ...layers.slice(at)], activeLayer: id, objects };
}
/** Exclui a camada e os objetos dela (como no CorelDRAW); sempre resta ao menos uma. */
export function deleteLayer(doc: VectorDocument, id: string): LayerState | null {
  const { layers, objects } = explicit(doc);
  if (layers.length < 2 || !layers.some(l => l.id === id)) return null;
  const rest = layers.filter(l => l.id !== id), removed = new Set(objects.filter(o => o.layer === id).map(o => o.id));
  // Conteúdo de PowerClip segue o quadro.
  let grew = true; while (grew) { grew = false; for (const o of objects) if (o.clipParent && removed.has(o.clipParent) && !removed.has(o.id)) { removed.add(o.id); grew = true; } }
  const active = activeLayerId(doc) === id ? rest[Math.max(0, layers.findIndex(l => l.id === id) - 1)].id : activeLayerId(doc);
  return { layers: rest, activeLayer: active, objects: objects.filter(o => !removed.has(o.id)) };
}
export function updateLayer(doc: VectorDocument, id: string, patch: Partial<Omit<Layer, 'id'>>): LayerState {
  const { layers, objects } = explicit(doc);
  const name = patch.name?.trim().slice(0, 256);
  return { layers: layers.map(l => l.id === id ? { ...l, ...patch, ...(patch.name !== undefined ? { name: name || l.name } : {}) } : l), activeLayer: activeLayerId(doc), objects };
}
export function setActiveLayer(doc: VectorDocument, id: string): LayerState {
  const { layers, objects } = explicit(doc);
  return { layers, activeLayer: layers.some(l => l.id === id) ? id : activeLayerId(doc), objects };
}
/** `up` sobe a camada uma posição (fica mais à frente). */
export function moveLayer(doc: VectorDocument, id: string, up: boolean): LayerState {
  const { layers, objects } = explicit(doc), i = layers.findIndex(l => l.id === id), j = up ? i + 1 : i - 1;
  if (i < 0 || j < 0 || j >= layers.length) return { layers, activeLayer: activeLayerId(doc), objects };
  const next = [...layers];[next[i], next[j]] = [next[j], next[i]];
  return { layers: next, activeLayer: activeLayerId(doc), objects };
}
/** Move os objetos (com grupos e conteúdo de PowerClip já incluídos em `ids`) para a camada. */
export function moveToLayer(doc: VectorDocument, ids: string[], id: string): LayerState {
  const { layers, objects } = explicit(doc), set = new Set(ids);
  return { layers, activeLayer: activeLayerId(doc), objects: objects.map(o => set.has(o.id) ? { ...o, layer: id } : o) };
}
