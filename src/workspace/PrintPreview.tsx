import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Printer, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { exportScene, toSvg } from '../io/exporters';
import { pageList } from '../document/pages';
import { browserMeasure } from '../text/textMeasure';
import { printDocument } from '../io/print';

export const openPrintPreview = () => window.dispatchEvent(new CustomEvent('vectorstudio:print-preview'));
/**
 * Visualização de impressão (Arquivo, como no CorelDRAW): cada página como sai na impressora (só camadas visíveis e
 * imprimíveis, objetos ocultos de fora), com navegação entre páginas, zoom e o botão Imprimir. Esc fecha.
 */
export function PrintPreview() {
  const { document, setMessage } = useEditor();
  const [open, setOpen] = useState(false), [index, setIndex] = useState(0), [zoom, setZoom] = useState<'fit' | number>('fit');
  useEffect(() => { const show = () => { setIndex(0); setZoom('fit'); setOpen(true); }; window.addEventListener('vectorstudio:print-preview', show); return () => window.removeEventListener('vectorstudio:print-preview', show); }, []);
  const pages = useMemo(() => open ? pageList(document) : [], [open, document]);
  const url = useMemo(() => {
    const page = pages[index]; if (!page) return '';
    const svg = toSvg(exportScene({ ...document, objects: page.objects, pages: undefined, page: undefined }, 'page', []), browserMeasure, '#ffffff');
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  }, [pages, index, document]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setOpen(false); }
      else if (e.key === 'PageDown' || e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); setIndex(i => Math.min(pages.length - 1, i + 1)); }
      else if (e.key === 'PageUp' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); setIndex(i => Math.max(0, i - 1)); }
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [open, pages.length]);
  if (!open) return null;
  const mm = (px: number) => (px * 25.4 / 96).toFixed(1).replace('.', ',');
  const style = zoom === 'fit' ? { maxWidth: '100%', maxHeight: '100%' } : { width: document.artboard.width * zoom, height: document.artboard.height * zoom };
  return <div className="print-preview" role="dialog" aria-label="Visualização de impressão">
    <header>
      <strong>Visualização de impressão</strong>
      <span className="print-preview-info">{document.name} · {mm(document.artboard.width)} × {mm(document.artboard.height)} mm</span>
      <span className="print-preview-tools">
        <button type="button" className="command-icon" aria-label="Página anterior" title="Página anterior (PgUp)" disabled={index === 0} onClick={() => setIndex(i => i - 1)}><ChevronLeft size={16} /></button>
        <span>Página {index + 1} de {pages.length}</span>
        <button type="button" className="command-icon" aria-label="Próxima página" title="Próxima página (PgDn)" disabled={index >= pages.length - 1} onClick={() => setIndex(i => i + 1)}><ChevronRight size={16} /></button>
        <span className="command-divider" />
        <button type="button" className="command-icon" aria-label="Diminuir zoom" title="Diminuir zoom" onClick={() => setZoom(z => Math.max(0.1, (z === 'fit' ? 1 : z) / 1.25))}><ZoomOut size={16} /></button>
        <button type="button" className={zoom === 'fit' ? 'active' : ''} onClick={() => setZoom('fit')}>Ajustar</button>
        <button type="button" className={zoom === 1 ? 'active' : ''} onClick={() => setZoom(1)}>100%</button>
        <button type="button" className="command-icon" aria-label="Aumentar zoom" title="Aumentar zoom" onClick={() => setZoom(z => Math.min(8, (z === 'fit' ? 1 : z) * 1.25))}><ZoomIn size={16} /></button>
        <span className="command-divider" />
        <button type="button" className="primary" onClick={() => { setOpen(false); setMessage('Preparando impressão…'); void printDocument(document).then(setMessage, e => setMessage(e instanceof Error ? e.message : 'Não foi possível imprimir.')); }}><Printer size={15} /> Imprimir…</button>
        <button type="button" className="command-icon" aria-label="Fechar visualização" title="Fechar (Esc)" onClick={() => setOpen(false)}><X size={16} /></button>
      </span>
    </header>
    <div className={`print-preview-sheet ${zoom === 'fit' ? 'fit' : ''}`}>{url && <img src={url} alt={`Página ${index + 1}`} style={style} draggable={false} />}</div>
  </div>;
}
