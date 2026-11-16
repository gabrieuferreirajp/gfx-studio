import type { VectorObject } from '../document/model';
import type { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { toggleParagraph } from '../text/textLayout';
import { browserMeasure } from '../text/textMeasure';
import { fitTextError, fitTextToPath, straightenText, textToTable } from '../text/textTools';

type Editor = ReturnType<typeof useEditor>;
export type TextCommand = 'paragraph' | 'fitPath' | 'straighten' | 'textToTable';
const selectedTexts = (editor: Editor) => editor.document.objects.filter(o => o.type === 'text' && editor.selectedIds.includes(o.id));
/** Motivo pelo qual o comando não se aplica à seleção atual (null = disponível). */
export function textCommandError(editor: Editor, command: TextCommand): string | null {
  const texts = selectedTexts(editor);
  if (command === 'fitPath') return fitTextError(editor.document.objects, editor.selectedIds);
  if (command === 'straighten') return texts.some(o => o.textPath) ? null : 'Selecione um texto em caminho.';
  if (command === 'textToTable') return texts.length === 1 && !texts[0].textPath && (texts[0].text ?? '').trim() ? null : 'Selecione um texto com linhas separadas por tabulação, ponto e vírgula ou vírgula.';
  return texts.some(o => !o.textPath) ? null : 'Selecione um texto artístico ou de parágrafo.';
}
/**
 * Ferramentas de escrita › Verificar ortografia: abre o texto selecionado para edição com a verificação do Windows
 * (palavras desconhecidas sublinhadas; o botão direito mostra sugestões e "Adicionar ao dicionário").
 */
export function checkSpelling(editor: Editor) {
  finishEditing();
  const text = selectedTexts(editor)[0];
  if (!text) { editor.setMessage('Selecione um texto para verificar a ortografia.'); return; }
  editor.setSelection([text.id]);
  window.setTimeout(() => window.document.querySelector(`.canvas-viewport [data-object-id="${text.id}"] *`)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), 0);
  editor.setMessage('Ortografia: palavras desconhecidas ficam sublinhadas em vermelho; clique com o botão direito numa delas para ver sugestões.');
}
/** Comandos do menu Texto/Tabela; cada um é uma etapa do histórico (Ctrl+Z desfaz). */
export function runTextCommand(editor: Editor, command: TextCommand) {
  finishEditing();
  const error = textCommandError(editor, command);
  if (error) { editor.setMessage(error); return; }
  const { document, dispatch, commitEdit } = editor, texts = selectedTexts(editor), ids = new Set(texts.map(o => o.id));
  let objects: VectorObject[] = document.objects, message = '';
  try {
    if (command === 'paragraph') {
      const toParagraph = texts.some(o => !o.paragraph && !o.textPath);
      objects = objects.map(o => ids.has(o.id) && !o.textPath && !!o.paragraph !== toParagraph ? toggleParagraph(o, browserMeasure) : o);
      message = toParagraph ? 'Convertido em texto de parágrafo: arraste as alças para mudar o quadro.' : 'Convertido em texto artístico.';
    } else if (command === 'fitPath') { objects = fitTextToPath(objects, editor.selectedIds, browserMeasure); message = 'Texto ajustado ao caminho. O caminho original continua no desenho.'; }
    else if (command === 'straighten') { objects = objects.map(o => ids.has(o.id) ? straightenText(o, browserMeasure) : o); message = 'Texto endireitado.'; }
    else {
      const cells = textToTable(texts[0], browserMeasure);
      if (objects.length + cells.length > 10000) throw new Error('Limite de 10.000 objetos por página.');
      objects = objects.flatMap(o => o.id === texts[0].id ? cells : [o]);
      commitEdit(); dispatch({ type: 'set-objects', objects }); commitEdit(); editor.setSelection(cells.map(o => o.id));
      editor.setMessage(`Tabela criada: ${cells.filter(o => o.type === 'rectangle').length} células.`); return;
    }
  } catch (e) { editor.setMessage(e instanceof Error ? e.message : 'Não foi possível aplicar o comando.'); return; }
  commitEdit(); dispatch({ type: 'set-objects', objects }); commitEdit();
  if (command === 'fitPath') editor.setSelection(texts.map(o => o.id));
  editor.setMessage(message);
}
