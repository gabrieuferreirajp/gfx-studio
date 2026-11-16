import { documentReducer, previewReducer, type DocumentAction, type VectorDocument } from '../document/model.ts';
import { refreshLinks } from '../geometry/links.ts';
import { goToPageId, pageList } from '../document/pages.ts';

export interface HistoryState {
  past: VectorDocument[];
  present: VectorDocument;
  future: VectorDocument[];
  transaction: VectorDocument | null;
  saved: string;
}
export type HistoryAction =
  | { type: 'edit'; action: DocumentAction }
  /** Ajuste automático do documento atual (efeitos ligados recalculados): não cria etapa no Desfazer. */
  | { type: 'amend'; action: DocumentAction }
  | { type: 'begin' | 'commit' | 'undo' | 'redo' }
  | { type: 'load'; document: VectorDocument }
  | { type: 'page'; id: string }
  | { type: 'restore'; state: HistoryState }
  | { type: 'saved'; snapshot: string };
// Documentos são imutáveis: a impressão digital (JSON) é calculada uma única vez por versão.
const fingerprints = new WeakMap<VectorDocument, string>();
export function fingerprint(document: VectorDocument): string {
  let value = fingerprints.get(document);
  // A página ativa não faz parte do conteúdo: navegar entre páginas não marca alterações.
  if (value === undefined) { value = JSON.stringify(document.pages ? { ...document, objects: [], pages: pageList(document), page: undefined } : document); fingerprints.set(document, value); }
  return value;
}
const same = (a: VectorDocument, b: VectorDocument) => a === b || fingerprint(a) === fingerprint(b);
export function createHistory(document: VectorDocument): HistoryState {
  return { past: [], present: document, future: [], transaction: null, saved: fingerprint(document) };
}
export function isDirty(state: HistoryState) { return fingerprint(state.present) !== state.saved; }
function commit(state: HistoryState): HistoryState {
  if (!state.transaction) return state;
  const changed = !same(state.transaction, state.present);
  return { ...state, transaction: null, past: changed ? [...state.past, state.transaction].slice(-100) : state.past, future: changed ? [] : state.future };
}
export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === 'load') return createHistory(action.document);
  if (action.type === 'restore') return action.state;
  // Navegar entre páginas não entra no Desfazer: todas as versões passam a mostrar a mesma página.
  if (action.type === 'page') { const go = (d: VectorDocument) => goToPageId(d, action.id); return { ...state, present: go(state.present), past: state.past.map(go), future: state.future.map(go), transaction: state.transaction && go(state.transaction) }; }
  if (action.type === 'saved') return { ...commit(state), saved: action.snapshot };
  if (action.type === 'begin') return state.transaction ? state : { ...state, transaction: state.present };
  if (action.type === 'commit') return commit(state);
  if (action.type === 'amend') { const present = previewReducer(state.present, action.action); return same(present, state.present) ? state : { ...state, present }; }
  if (action.type === 'edit') {
    // Conectores e cotas ligados acompanham os objetos alterados por esta ação.
    const present = refreshLinks(documentReducer(state.present, action.action));
    if (same(present, state.present)) return state;
    return { ...state, present, past: state.transaction ? state.past : [...state.past, state.present].slice(-100), future: state.transaction ? state.future : [] };
  }
  const settled = commit(state);
  if (action.type === 'undo') {
    const previous = settled.past.at(-1);
    return previous ? { ...settled, present: previous, past: settled.past.slice(0, -1), future: [settled.present, ...settled.future] } : settled;
  }
  const next = settled.future[0];
  return next ? { ...settled, present: next, past: [...settled.past, settled.present].slice(-100), future: settled.future.slice(1) } : settled;
}
