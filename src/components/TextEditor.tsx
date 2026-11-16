import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { VectorObject } from '../document/model';
import { useEditor } from '../state/EditorContext';
import { boundsOf, matrixOf } from '../geometry/objectTransforms';
import { fontPx, letterSpacingPx, textWeight, updateText } from '../text/textLayout';
import { browserMeasure } from '../text/textMeasure';
/** Edição direta do texto sobre a área de trabalho (como a ferramenta Texto do CorelDRAW). Esc ou clique fora conclui. */
export function TextEditor({ object: o, close }: { object: VectorObject; close: (removed: boolean, escape: boolean) => void }) {
  const { document, dispatch, beginEdit, commitEdit, viewport } = useEditor();
  const ref = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(document); latest.current = document;
  const escape = useRef(false);
  useEffect(() => {
    beginEdit();
    const element = ref.current!;
    element.focus(); element.setSelectionRange(element.value.length, element.value.length);
  }, []);
  function finish() {
    const current = latest.current.objects.find(x => x.id === o.id);
    const removed = !!current && !(current.text ?? '').trim();
    if (removed) dispatch({ type: 'set-objects', objects: latest.current.objects.filter(x => x.id !== o.id) });
    commitEdit(); close(removed, escape.current);
  }
  const m = matrixOf(o), z = viewport.zoom, px = fontPx(o), dx = o.paragraph ? 0 : o.textAlign === 'center' ? -px : o.textAlign === 'right' ? -px * 2 : 0;
  const change = (value: string) => { const current = latest.current.objects.find(x => x.id === o.id); if (current) dispatch({ type: 'set-objects', objects: latest.current.objects.map(x => x.id === o.id ? updateText(x, { text: value.slice(0, 100000) }, browserMeasure) : x) }); };
  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) { e.preventDefault(); escape.current = true; ref.current?.blur(); } };
  if (o.textPath) {
    // Texto em caminho: as letras ficam no caminho; o conteúdo é editado numa caixa logo abaixo delas.
    const b = boundsOf([o]);
    return <textarea ref={ref} className="canvas-text-editor path-text-editor" aria-label="Editar texto em caminho" spellCheck lang="pt-BR" value={o.text ?? ''} rows={1} style={{ transform: `translate(${b.x * z + viewport.x}px,${(b.y + b.height) * z + viewport.y + 6}px)` }}
      onChange={e => change(e.target.value.replace(/\r?\n/g, ' '))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); escape.current = true; ref.current?.blur(); return; } keyDown(e); }} onBlur={finish} onPointerDown={e => e.stopPropagation()} />;
  }
  // A caixa de edição fica no tamanho da tela (fonte × zoom), e não reduzida pela matriz: assim o cursor de digitação
  // tem sempre 1 px de largura visível. A cor do cursor é a do texto, e um tracejado azul marca onde se está digitando.
  const transform = `matrix(${m[0]},${m[1]},${m[2]},${m[3]},${m[4] * z + viewport.x},${m[5] * z + viewport.y}) translate(${(o.x + dx) * z}px,${(o.y - px * 0.1) * z}px)`;
  const color = o.fill === 'none' || !/^#|^rgb/i.test(o.fill) ? '#000' : o.fill;
  return <textarea ref={ref} aria-label="Editar texto" spellCheck lang="pt-BR" value={o.text ?? ''} rows={1} className={`canvas-text-editor${o.paragraph ? ' paragraph' : ''}`}
    style={{ transform, width: (o.paragraph ? o.width : o.width + px * 2) * z, height: (o.paragraph ? o.height : o.height + px * 0.2) * z, fontFamily: `"${o.fontFamily ?? 'Arial'}", sans-serif`, fontSize: px * z, lineHeight: o.lineSpacing ?? 1.2, letterSpacing: letterSpacingPx(o, browserMeasure) * z, fontWeight: textWeight(o), fontStyle: o.italic ? 'italic' : 'normal', textDecoration: o.underline ? 'underline' : 'none', textAlign: o.textAlign ?? 'left', color, caretColor: color, ...(o.paragraph ? {} : { outline: '1px dashed #1e7cf2', outlineOffset: 2 }) }}
    onChange={e => change(e.target.value)} onKeyDown={keyDown}
    onBlur={finish} onPointerDown={e => e.stopPropagation()} />;
}
