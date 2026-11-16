import { useEffect, useRef, useState } from 'react';
import { useDialogDrag } from './useDialogDrag';
import { parsePageRange } from '../document/pages';

/** Pergunta quais páginas de um PDF abrir/importar. Resolve com os números (1, 2…) ou null se cancelar. */
export function askPdfPages(name: string, count: number, action: 'abrir' | 'importar'): Promise<number[] | null> {
  return new Promise(resolve => window.dispatchEvent(new CustomEvent('vectorstudio:pdf-pages', { detail: { name, count, action, resolve } })));
}
type Request = { name: string; count: number; action: string; resolve: (pages: number[] | null) => void };
/** Janela "Páginas do PDF" (como a escolha de páginas do CorelDRAW ao importar PDF). */
export function PdfPagesDialog() {
  const [request, setRequest] = useState<Request | null>(null), [mode, setMode] = useState<'all' | 'first' | 'range'>('all'), [range, setRange] = useState('');
  const ref = useRef<HTMLDialogElement>(null), move = useDialogDrag();
  useEffect(() => { const show = (e: Event) => { const r = (e as CustomEvent<Request>).detail; setRequest(r); setMode('all'); setRange(`1-${r.count}`); }; window.addEventListener('vectorstudio:pdf-pages', show); return () => window.removeEventListener('vectorstudio:pdf-pages', show); }, []);
  useEffect(() => { if (request) ref.current?.showModal(); }, [request]);
  if (!request) return null;
  const pages = mode === 'all' ? Array.from({ length: request.count }, (_, i) => i + 1) : mode === 'first' ? [1] : parsePageRange(range, request.count);
  const finish = (value: number[] | null) => { request.resolve(value); setRequest(null); };
  return <dialog ref={ref} className="workspace-settings paint-dialog small-dialog" aria-label="Páginas do PDF" style={move.style} onCancel={e => { e.preventDefault(); finish(null); }} onKeyDown={e => e.stopPropagation()}>
    <form method="dialog" onSubmit={e => { e.preventDefault(); if (pages.length) finish(pages); }}>
      <header {...move.handle}><h2>Páginas do PDF</h2></header>
      <div className="floating-body">
        <span className="muted">{request.name} tem {request.count} páginas. Quais {request.action === 'abrir' ? 'abrir (cada uma vira uma página do documento)' : 'importar (ficam lado a lado na página atual)'}?</span>
        <label className="settings-check"><input type="radio" name="pdf-pages" checked={mode === 'all'} onChange={() => setMode('all')} />Todas ({request.count})</label>
        <label className="settings-check"><input type="radio" name="pdf-pages" checked={mode === 'first'} onChange={() => setMode('first')} />Só a primeira</label>
        <label className="settings-check"><input type="radio" name="pdf-pages" checked={mode === 'range'} onChange={() => setMode('range')} />Escolher:<input type="text" value={range} aria-label="Páginas (ex.: 1-3, 5)" placeholder="ex.: 1-3, 5" onFocus={() => setMode('range')} onChange={e => { setMode('range'); setRange(e.target.value); }} /></label>
        <span className="muted">{pages.length ? `${pages.length} página(s): ${pages.length > 12 ? pages.slice(0, 12).join(', ') + '…' : pages.join(', ')}` : 'Nenhuma página válida (use por ex. 1-3, 5).'}{pages.length > 1 ? ' · cada página leva alguns segundos para converter.' : ''}</span>
      </div>
      <footer><span /><span className="paint-dialog-buttons"><button type="submit" className="primary" disabled={!pages.length}>OK</button><button type="button" onClick={() => finish(null)}>Cancelar</button></span></footer>
    </form>
  </dialog>;
}
