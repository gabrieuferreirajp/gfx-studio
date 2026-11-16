import type { DocumentPage, VectorDocument, VectorObject } from './model.ts';
import { remapLinks } from '../geometry/links.ts';

/** Páginas do documento como no CorelDRAW. `document.objects` é sempre a página ativa. */
type PageState = Pick<VectorDocument, 'objects' | 'pages' | 'page'>;
export function pageCount(document: VectorDocument) { return document.pages?.length ?? 1; }
export function activePage(document: VectorDocument) { return document.pages ? document.page ?? 0 : 0; }
/** Lista completa, com os objetos da página ativa no lugar. */
export function pageList(document: VectorDocument): DocumentPage[] {
  if (!document.pages) return [{ id: 'page-1', name: 'Página 1', objects: document.objects }];
  const active = activePage(document);
  return document.pages.map((p, i) => i === active ? { ...p, objects: document.objects } : p);
}
function fromList(pages: DocumentPage[], active: number): PageState {
  const index = Math.max(0, Math.min(pages.length - 1, active));
  // Uma página com o nome padrão volta ao formato simples; renomeada, continua em `pages` para manter o nome.
  if (pages.length === 1 && pages[0].name === 'Página 1') return { objects: pages[0].objects, pages: undefined, page: undefined };
  return { objects: pages[index].objects, pages: pages.map((p, i) => i === index ? { ...p, objects: [] } : p), page: index };
}
/** Vai para a página `index` (navegação não altera o conteúdo). */
export function goToPage(document: VectorDocument, index: number): VectorDocument {
  if (!document.pages || index === activePage(document) || index < 0 || index >= document.pages.length) return document;
  return { ...document, ...fromList(pageList(document), index) };
}
/** Versão para o histórico: vai para a página com o mesmo id, se ela existir naquela versão. */
export function goToPageId(document: VectorDocument, id: string): VectorDocument {
  const index = document.pages?.findIndex(p => p.id === id) ?? -1;
  return index < 0 ? document : goToPage(document, index);
}
const defaultName = (pages: DocumentPage[]) => { let n = pages.length + 1; while (pages.some(p => p.name === `Página ${n}`)) n++; return `Página ${n}`; };
/** Inserir página antes/depois de `at` (padrão: depois da ativa) e torná-la ativa. */
export function insertPage(document: VectorDocument, after = true, at = activePage(document), objects: VectorObject[] = []): PageState {
  const pages = pageList(document);
  if (pages.length >= 999) throw new Error('Limite de 999 páginas por documento.');
  // A primeira página de um documento sem páginas recebe um id real.
  if (!document.pages) pages[0] = { ...pages[0], id: crypto.randomUUID() };
  const index = after ? at + 1 : at;
  pages.splice(index, 0, { id: crypto.randomUUID(), name: defaultName(pages), objects });
  return fromList(pages, index);
}
/** Duplicar página: copia os objetos com novos ids (grupos e PowerClip preservados). */
export function duplicatePage(document: VectorDocument, at = activePage(document)): PageState {
  const source = pageList(document)[at], ids = new Map<string, string>();
  const fresh = (id: string) => { let next = ids.get(id); if (!next) { next = crypto.randomUUID(); ids.set(id, next); } return next; };
  const copy = source.objects.map(o => ({ ...o, id: fresh(o.id), ...(o.groupPath ? { groupPath: o.groupPath.map(fresh) } : {}), ...(o.clipParent ? { clipParent: fresh(o.clipParent) } : {}), ...(o.symbol ? { symbol: { ...o.symbol, instance: fresh(o.symbol.instance) } } : {}) })).map(o => remapLinks(o, fresh));
  const state = insertPage(document, true, at, copy);
  const pages = state.pages!, index = state.page!;
  pages[index] = { ...pages[index], name: `${source.name} (cópia)`.slice(0, 256) };
  return state;
}
export function deletePage(document: VectorDocument, at = activePage(document)): PageState {
  const pages = pageList(document);
  if (pages.length <= 1) throw new Error('O documento precisa ter pelo menos uma página.');
  pages.splice(at, 1);
  const active = activePage(document);
  return fromList(pages, at < active ? active - 1 : Math.min(active, pages.length - 1));
}
export function renamePage(document: VectorDocument, at: number, name: string): PageState {
  const clean = name.trim().slice(0, 256), pages = pageList(document);
  if (!clean) throw new Error('Informe um nome para a página.');
  if (!document.pages) pages[0] = { ...pages[0], id: crypto.randomUUID() };
  pages[at] = { ...pages[at], name: clean };
  return fromList(pages, activePage(document));
}
/** Reordenar: move a página `from` para a posição `to` (a ativa continua ativa). */
export function movePage(document: VectorDocument, from: number, to: number): PageState {
  const pages = pageList(document), activeId = pages[activePage(document)].id;
  if (from === to || to < 0 || to >= pages.length) return { objects: document.objects, pages: document.pages, page: document.page };
  const [page] = pages.splice(from, 1); pages.splice(to, 0, page);
  return fromList(pages, pages.findIndex(p => p.id === activeId));
}

/** "1-3, 5, 8-" → [1, 2, 3, 5, 8, …, max] (números de página a partir de 1, sem repetir, em ordem). */
export function parsePageRange(text: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/), single = part.match(/^\d+$/);
    if (single) { const v = Number(part); if (v >= 1 && v <= max) out.add(v); continue; }
    if (!m || (!m[1] && !m[2])) continue;
    const a = m[1] ? Number(m[1]) : 1, b = m[2] ? Number(m[2]) : max;
    for (let v = Math.max(1, Math.min(a, b)); v <= Math.min(max, Math.max(a, b)); v++) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}
