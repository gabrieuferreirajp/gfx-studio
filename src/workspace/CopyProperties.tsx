import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import type { VectorObject } from '../document/model';
import { updateText } from '../text/textLayout';
import { copyProperties, type PropertySet } from '../document/copyProperties';
import { browserMeasure } from '../text/textMeasure';
import { parseClip, imageObjectFromBlob } from '../io/clipboard';
import { useDialogDrag } from './useDialogDrag';

export type PropertiesWindow = 'copy' | 'pasteSpecial';
export const openPropertiesWindow = (which: PropertiesWindow) => window.dispatchEvent(new CustomEvent('vectorstudio:properties-window', { detail: which }));

function Modal({ title, close, children, submit }: { title: string; close: () => void; children: React.ReactNode; submit: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), move = useDialogDrag();
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="workspace-settings paint-dialog small-dialog" aria-label={title} style={move.style} onCancel={e => { e.preventDefault(); close(); }} onKeyDown={e => e.stopPropagation()}>
    <form method="dialog" onSubmit={e => { e.preventDefault(); submit(); }}>
      <header {...move.handle}><h2>{title}</h2></header>
      <div className="floating-body">{children}</div>
      <footer><span /><span className="paint-dialog-buttons"><button type="submit" className="primary">OK</button><button type="button" onClick={close}>Cancelar</button></span></footer>
    </form>
  </dialog>;
}
/**
 * Copiar propriedades de… (escolha os atributos, OK e clique no objeto de origem — Esc cancela) e Colar especial
 * (objetos do GFX Studio, imagem, texto sem formatação ou só preenchimento e contorno nos selecionados).
 */
export function PropertiesWindows() {
  const { document, selectedIds, dispatch, commitEdit, setMessage, addObjects, viewport } = useEditor();
  const [open, setOpen] = useState<PropertiesWindow | null>(null);
  const [which, setWhich] = useState<PropertySet>({ outline: true, outlineColor: true, fill: true, text: false });
  const [mode, setMode] = useState<'objects' | 'image' | 'text' | 'attributes'>('objects');
  const latest = useRef({ document, selectedIds }); latest.current = { document, selectedIds };
  useEffect(() => { const show = (e: Event) => setOpen((e as CustomEvent<PropertiesWindow>).detail); window.addEventListener('vectorstudio:properties-window', show); return () => window.removeEventListener('vectorstudio:properties-window', show); }, []);
  const apply = (source: VectorObject, set: PropertySet) => {
    const { document: doc, selectedIds: ids } = latest.current, targets = new Set(ids.filter(id => id !== source.id));
    if (!targets.size) { setMessage('Copiar propriedades: selecione os objetos que vão receber os atributos.'); return; }
    commitEdit(); dispatch({ type: 'set-objects', objects: doc.objects.map(o => targets.has(o.id) ? copyProperties(o, source, set, browserMeasure) : o) }); commitEdit();
    setMessage(`Propriedades copiadas de "${source.name}" para ${targets.size} objeto(s). Ctrl+Z desfaz.`);
  };
  /** Modo de escolha: o próximo clique no desenho indica o objeto de origem (como a seta grande do CorelDRAW). */
  function pickSource(set: PropertySet) {
    window.document.body.classList.add('picking-source');
    setMessage('Clique no objeto de onde copiar as propriedades (Esc cancela).');
    const end = () => { window.document.body.classList.remove('picking-source'); window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
    const down = (e: PointerEvent) => {
      const el = e.target as Element, inCanvas = el.closest?.('.canvas-viewport');
      if (!inCanvas) { end(); setMessage('Copiar propriedades cancelado.'); return; }
      e.preventDefault(); e.stopPropagation(); end();
      const id = el.closest('[data-object-id]')?.getAttribute('data-object-id'), source = latest.current.document.objects.find(o => o.id === id);
      if (!source) { setMessage('Nenhum objeto nesse ponto. Copiar propriedades cancelado.'); return; }
      apply(source, set);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); end(); setMessage('Copiar propriedades cancelado.'); } };
    window.setTimeout(() => { window.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key, true); });
  }
  async function pasteSpecial() {
    finishEditing();
    try {
      const items = await navigator.clipboard.read();
      const svg = window.document.querySelector('svg.canvas-viewport')?.getBoundingClientRect();
      const center = svg ? { x: (svg.width / 2 - viewport.x) / viewport.zoom, y: (svg.height / 2 - viewport.y) / viewport.zoom } : { x: 0, y: 0 };
      const text = async () => { for (const item of items) if (item.types.includes('text/plain')) return (await item.getType('text/plain')).text(); return ''; };
      if (mode === 'image') {
        for (const item of items) { const type = item.types.find(t => t.startsWith('image/')); if (type) { addObjects([await imageObjectFromBlob(await item.getType(type), center, document.artboard.width, document.artboard.height)]); setMessage('Imagem colada.'); return; } }
        setMessage('A área de transferência não tem imagem.'); return;
      }
      const raw = await text();
      if (mode === 'text') {
        if (!raw.trim()) { setMessage('A área de transferência não tem texto.'); return; }
        const plain = raw.startsWith('vectorstudio-clip:') ? '' : raw.replace(/\r\n/g, '\n').slice(0, 20000);
        if (!plain) { setMessage('O conteúdo copiado são objetos, não texto.'); return; }
        addObjects([updateText({ id: crypto.randomUUID(), type: 'text', name: 'Texto', x: center.x, y: center.y, width: 1, height: 1, fill: '#000000', text: plain, fontFamily: 'Arial', fontSize: 24 }, {}, browserMeasure)]);
        setMessage('Texto colado sem formatação.'); return;
      }
      const objects = parseClip(raw);
      if (!objects?.length) { setMessage('A área de transferência não contém objetos do GFX Studio.'); return; }
      if (mode === 'attributes') { apply({ ...objects[0], id: '__clip__' }, { outline: true, outlineColor: true, fill: true, text: true }); return; }
      addObjects(objects); setMessage(`${objects.length} objeto(s) colado(s).`);
    } catch { setMessage('Não foi possível ler a área de transferência.'); }
  }
  if (open === 'copy') return <Modal title="Copiar propriedades" close={() => setOpen(null)} submit={() => { setOpen(null); if (!selectedIds.length) { setMessage('Copiar propriedades: primeiro selecione os objetos que vão receber os atributos.'); return; } pickSource(which); }}>
    <span className="muted">Selecione os objetos de destino, marque o que copiar, dê OK e clique no objeto de origem.</span>
    {([['outline', 'Caneta do contorno (espessura, cantos, tracejado, pontas)'], ['outlineColor', 'Cor do contorno'], ['fill', 'Preenchimento'], ['text', 'Propriedades do texto']] as const).map(([key, label]) => <label key={key} className="settings-check"><input type="checkbox" checked={which[key]} onChange={e => setWhich(w => ({ ...w, [key]: e.target.checked }))} />{label}</label>)}
  </Modal>;
  if (open === 'pasteSpecial') return <Modal title="Colar especial" close={() => setOpen(null)} submit={() => { setOpen(null); void pasteSpecial(); }}>
    <span className="muted">Como colar o conteúdo da área de transferência:</span>
    {([['objects', 'Objetos do GFX Studio'], ['image', 'Imagem (bitmap)'], ['text', 'Texto sem formatação'], ['attributes', 'Somente atributos (preenchimento, contorno e texto) nos selecionados']] as const).map(([key, label]) => <label key={key} className="settings-check"><input type="radio" name="paste-special" checked={mode === key} onChange={() => setMode(key)} />{label}</label>)}
  </Modal>;
  return null;
}
