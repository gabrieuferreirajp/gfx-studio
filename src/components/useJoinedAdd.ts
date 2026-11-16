import { useEditor } from '../state/EditorContext';
import type { VectorObject } from '../document/model';
import { joinPaths } from '../geometry/pathJoin';

/** Raio (pixels de tela) para ligar uma linha nova à ponta de uma curva aberta, como no CorelDRAW. */
export const JOIN_RADIUS = 8;
/** Adiciona a curva desenhada; começando ou terminando na ponta de outra curva aberta, as duas viram uma só. */
export function useJoinedAdd() {
  const { document, dispatch, select, commitEdit, viewport, setMessage } = useEditor();
  return (object: VectorObject) => {
    commitEdit();
    const joined = joinPaths(document.objects, object, JOIN_RADIUS / viewport.zoom);
    if (!joined) { dispatch({ type: 'add', object }); select(object.id); return; }
    dispatch({ type: 'set-objects', objects: joined.objects }); select(joined.id);
    setMessage(joined.closed ? 'Forma fechada: a curva virou um objeto fechado (clique numa cor da paleta para preencher). Ctrl+Z desfaz.' : 'Linha ligada à curva existente: continue a partir da ponta ou termine no primeiro ponto para fechar a forma.');
  };
}
