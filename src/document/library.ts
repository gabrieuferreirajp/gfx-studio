import type { DocumentPage, ObjectStyle, SymbolDef, VectorDocument, VectorObject } from './model.ts';
import { applyMatrix, boundsOf, clipContents, inverse, translate, type Matrix } from '../geometry/objectTransforms.ts';
import { pageList } from './pages.ts';
import { updateText, type Measure } from '../text/textLayout.ts';
import type { Point } from '../geometry/pathGeometry.ts';

/** Atributos guardados num estilo de objeto (CorelDRAW: preenchimento, contorno, transparência e caractere). */
export const FILL_KEYS = ['fill', 'fillGradient', 'fillPattern', 'meshFill'] as const;
export const STROKE_KEYS = ['stroke', 'strokeWidth', 'strokeDash', 'strokeJoin', 'strokeCap', 'strokeMiter', 'strokePosition', 'strokeBehind', 'strokeScale', 'arrowStart', 'arrowEnd'] as const;
export const TRANSPARENCY_KEYS = ['opacity', 'blendMode', 'transparencyGradient'] as const;
export const TEXT_KEYS = ['fontFamily', 'fontSize', 'bold', 'fontWeight', 'italic', 'underline', 'textAlign', 'lineSpacing', 'letterSpacing'] as const;
export const STYLE_KEYS = [...FILL_KEYS, ...STROKE_KEYS, ...TRANSPARENCY_KEYS, ...TEXT_KEYS] as const;
type StyleKey = typeof STYLE_KEYS[number];
const groupsOf = (o: VectorObject) => [FILL_KEYS, STROKE_KEYS, TRANSPARENCY_KEYS, ...(o.type === 'text' ? [TEXT_KEYS] : [])];

/** Atributos de estilo do objeto (textos incluem a fonte). A malha não entra: depende da forma. */
export function styleFrom(o: VectorObject): Partial<VectorObject> {
  const props: Record<string, unknown> = {};
  for (const key of STYLE_KEYS) if (key !== 'meshFill' && o[key] !== undefined && (o.type === 'text' || !(TEXT_KEYS as readonly string[]).includes(key))) props[key] = structuredClone(o[key]);
  if (o.stroke === undefined) props.stroke = 'none';
  return props as Partial<VectorObject>;
}
/** Aplica o estilo: cada grupo de atributos presente no estilo substitui o grupo inteiro do objeto. */
export function applyStyle(o: VectorObject, style: ObjectStyle, measure: Measure): VectorObject {
  if (o.type === 'image') return o;
  const next: Record<string, unknown> = { ...o, style: style.id };
  for (const keys of groupsOf(o)) {
    if (!keys.some(k => style.props[k as StyleKey] !== undefined)) continue;
    for (const k of keys) if (k !== 'fill') delete next[k];
    for (const k of keys) if (style.props[k as StyleKey] !== undefined) next[k] = structuredClone(style.props[k as StyleKey]);
  }
  const result = next as unknown as VectorObject;
  return o.type === 'text' ? updateText(result, {}, measure) : result;
}
export function newStyle(o: VectorObject, name: string): ObjectStyle {
  return { id: crypto.randomUUID(), name: name.trim().slice(0, 256) || 'Estilo', props: styleFrom(o) };
}
/** Altera todos os objetos (todas as páginas); devolve a forma usada pela ação `set-pages`/`set-library`. */
export function mapDocument(document: VectorDocument, change: (objects: VectorObject[], active: boolean) => VectorObject[]): Pick<VectorDocument, 'objects' | 'pages' | 'page'> {
  const objects = change(document.objects, true);
  const pages = document.pages?.map((p, i): DocumentPage => i === (document.page ?? 0) ? p : { ...p, objects: change(p.objects, false) });
  return { objects, pages, page: document.page };
}
/** Redefine o estilo e atualiza todos os objetos vinculados a ele, em todas as páginas. */
export function redefineStyle(document: VectorDocument, styleId: string, props: Partial<VectorObject>, measure: Measure) {
  const styles = (document.styles ?? []).map(s => s.id === styleId ? { ...s, props } : s), style = styles.find(s => s.id === styleId)!;
  return { styles, document: mapDocument(document, list => list.map(o => o.style === styleId ? applyStyle(o, style, measure) : o)) };
}
/** Exclui o estilo: os objetos ficam com a aparência atual, sem vínculo. */
export function deleteStyle(document: VectorDocument, styleId: string) {
  const unlink = (o: VectorObject) => { if (o.style !== styleId) return o; const { style: _s, ...rest } = o; return rest; };
  return { styles: (document.styles ?? []).filter(s => s.id !== styleId), document: mapDocument(document, list => list.map(unlink)) };
}
export const styleUsage = (document: VectorDocument, styleId: string) => pageList(document).reduce((n, p) => n + p.objects.filter(o => o.style === styleId).length, 0);

// ---------- Símbolos ----------
const strip = (o: VectorObject): VectorObject => { const { symbol: _s, layer: _l, locked: _k, ...rest } = o; return rest; };
/** Cópias com IDs novos (objetos, grupos e PowerClip), mantendo as referências internas. */
function fresh(objects: VectorObject[], uuid: () => string): VectorObject[] {
  const ids = new Map<string, string>(), map = (id: string) => { if (!ids.has(id)) ids.set(id, uuid()); return ids.get(id)!; };
  const known = new Set(objects.map(o => o.id));
  return objects.map(o => ({ ...structuredClone(o), id: map(o.id), ...(o.groupPath ? { groupPath: o.groupPath.map(map) } : {}), ...(o.clipParent && known.has(o.clipParent) ? { clipParent: map(o.clipParent) } : {}) }));
}
/** Partes de cada instância do símbolo (na ordem do desenho). */
export function instancesOf(objects: VectorObject[], symbolId: string): Map<string, VectorObject[]> {
  const out = new Map<string, VectorObject[]>();
  for (const o of objects) if (o.symbol?.id === symbolId) { const list = out.get(o.symbol.instance) ?? []; list.push(o); out.set(o.symbol.instance, list); }
  return out;
}
/** Partes de uma instância posicionadas pela matriz (IDs novos; o grupo da instância envolve tudo). */
export function instantiate(def: SymbolDef, matrix: Matrix, instance: string, uuid: () => string = () => crypto.randomUUID()): VectorObject[] {
  const copies = fresh(def.objects, uuid), moved = applyMatrix(copies, copies.map(o => o.id), matrix);
  return moved.map(o => ({ ...o, groupPath: [instance, ...(o.groupPath ?? [])], symbol: { id: def.id, instance, matrix: [...matrix] as Matrix } }));
}
/**
 * Converter em símbolo (CorelDRAW): a seleção (com o conteúdo de PowerClips) vira a definição do símbolo
 * e passa a ser a primeira instância, agrupada.
 */
export function createSymbol(objects: VectorObject[], ids: string[], name: string, uuid: () => string = () => crypto.randomUUID()): { objects: VectorObject[]; symbol: SymbolDef; ids: string[] } {
  const chosen = new Set(clipContents(objects, ids)), selected = objects.filter(o => chosen.has(o.id));
  if (!selected.length) throw new Error('Selecione os objetos do símbolo.');
  if (selected.some(o => o.symbol)) throw new Error('A seleção já contém um símbolo. Use “Quebrar vínculo” antes.');
  const box = boundsOf(selected.filter(o => !o.clipParent || !chosen.has(o.clipParent))), origin = translate(-box.x, -box.y);
  const symbol: SymbolDef = { id: uuid(), name: name.trim().slice(0, 256) || 'Símbolo', objects: fresh(applyMatrix(selected.map(strip), selected.map(o => o.id), origin), uuid) };
  const instance = uuid(), matrix = translate(box.x, box.y);
  const pieces = selected.map(o => ({ ...o, groupPath: [instance, ...(o.groupPath ?? [])], symbol: { id: symbol.id, instance, matrix } }));
  const last = Math.max(...objects.map((o, i) => chosen.has(o.id) ? i : -1));
  return { symbol, ids: pieces.map(o => o.id), objects: objects.flatMap((o, i) => i === last ? pieces : chosen.has(o.id) ? [] : [o]) };
}
/** Inserir símbolo: nova instância centrada no ponto. */
export function insertSymbol(objects: VectorObject[], def: SymbolDef, center: Point, uuid: () => string = () => crypto.randomUUID()): { objects: VectorObject[]; ids: string[] } {
  if (objects.length + def.objects.length > 10000) throw new Error('Limite de 10.000 objetos por página.');
  const b = boundsOf(def.objects.filter(o => !o.clipParent)), pieces = instantiate(def, translate(center.x - b.x - b.width / 2, center.y - b.y - b.height / 2), uuid(), uuid);
  return { objects: [...objects, ...pieces], ids: pieces.map(o => o.id) };
}
/**
 * Atualizar símbolo a partir da instância editada: a definição passa a ser essa instância (desfeita a sua matriz)
 * e todas as outras instâncias, em todas as páginas, são refeitas no lugar, com a própria posição.
 */
export function updateSymbol(document: VectorDocument, instancePieces: VectorObject[], uuid: () => string = () => crypto.randomUUID()) {
  const link = instancePieces[0]?.symbol;
  const def = document.symbols?.find(s => s.id === link?.id);
  if (!link || !def) throw new Error('Selecione uma instância de símbolo.');
  const local = applyMatrix(instancePieces.map(o => ({ ...strip(o), groupPath: o.groupPath?.slice(o.groupPath.indexOf(link.instance) + 1) })).map(o => o.groupPath?.length ? o : (({ groupPath: _g, ...rest }) => rest)(o)), instancePieces.map(o => o.id), inverse(link.matrix));
  const symbol: SymbolDef = { ...def, objects: fresh(local, uuid) };
  const rebuild = (list: VectorObject[]) => {
    const groups = instancesOf(list, def.id);
    if (!groups.size) return list;
    const done = new Set<string>();
    return list.flatMap(o => {
      if (o.symbol?.id !== def.id) return [o];
      if (done.has(o.symbol.instance)) return [];
      done.add(o.symbol.instance);
      const parts = groups.get(o.symbol.instance)!, outer = o.groupPath!.slice(0, o.groupPath!.indexOf(o.symbol.instance));
      return instantiate(symbol, o.symbol.matrix, o.symbol.instance, uuid).map(p => ({ ...p, groupPath: [...outer, ...p.groupPath!], ...(parts[0].layer ? { layer: parts[0].layer } : {}), ...(parts[0].locked ? { locked: true } : {}) }));
    });
  };
  return { symbols: (document.symbols ?? []).map(s => s.id === def.id ? symbol : s), document: mapDocument(document, rebuild) };
}
/** Quebrar vínculo: as partes continuam agrupadas, como objetos comuns. */
export function unlinkSymbol(objects: VectorObject[], ids: string[]): VectorObject[] {
  const instances = new Set(objects.filter(o => ids.includes(o.id) && o.symbol).map(o => o.symbol!.instance));
  return objects.map(o => o.symbol && instances.has(o.symbol.instance) ? (({ symbol: _s, ...rest }) => rest)(o) : o);
}
/** Excluir símbolo da biblioteca: as instâncias viram grupos comuns. */
export function deleteSymbol(document: VectorDocument, symbolId: string) {
  const unlink = (o: VectorObject) => o.symbol?.id === symbolId ? (({ symbol: _s, ...rest }) => rest)(o) : o;
  return { symbols: (document.symbols ?? []).filter(s => s.id !== symbolId), document: mapDocument(document, list => list.map(unlink)) };
}
export const symbolUsage = (document: VectorDocument, symbolId: string) => pageList(document).reduce((n, p) => n + instancesOf(p.objects, symbolId).size, 0);
