import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { useDialogDrag } from './useDialogDrag';
import { socialFormats, socialFrames, type SocialFormat } from './socialMedia';
import { fitBounds } from '../document/viewport';

/** Miniatura do formato na proporção certa (e, em carrossel, os slides lado a lado). */
function FormatThumb({ format, slides }: { format: SocialFormat; slides: number }) {
  const n = Math.min(slides, 5), w = format.width * n, h = format.height, k = Math.min(64 / w, 40 / h);
  return <svg width="66" height="42" viewBox="-1 -1 66 42" aria-hidden="true">{Array.from({ length: n }, (_, i) => <rect key={i} x={i * format.width * k + (64 - w * k) / 2} y={(40 - h * k) / 2} width={format.width * k} height={h * k} fill="#fff" stroke="currentColor" strokeWidth="1" />)}</svg>;
}
/**
 * Social media: janela móvel (não bloqueia o desenho) com os tamanhos oficiais das redes sociais. Clique num formato
 * cria o quadro; com Carrossel, cria os slides encostados lado a lado, agrupados.
 */
export function SocialMediaDialog({ close }: { close: () => void }) {
  const { document, addObjects, setViewport, setMessage, setSelection } = useEditor();
  const ref = useRef<HTMLDialogElement>(null), move = useDialogDrag();
  const [carousel, setCarousel] = useState(false), [slides, setSlides] = useState(5);
  useEffect(() => { ref.current?.show(); }, []);
  function create(format: SocialFormat) {
    finishEditing();
    const count = carousel ? slides : 1, frames = socialFrames(format, count, document.artboard.width + 60, 0);
    addObjects(frames); setSelection(frames.map(f => f.id));
    // Mostra os quadros criados inteiros na tela.
    const svg = window.document.querySelector('svg.canvas-viewport')?.getBoundingClientRect();
    if (svg) setViewport(fitBounds(svg.width, svg.height, { x: frames[0].x, y: frames[0].y, width: format.width * count, height: format.height }));
    setMessage(count > 1 ? `Carrossel ${format.ratio}: ${count} slides de ${format.width}×${format.height} px encostados e agrupados (Ctrl+U desagrupa).` : `${format.name} ${format.ratio}: quadro de ${format.width}×${format.height} px criado.`);
  }
  return <dialog ref={ref} className="workspace-settings social-dialog" aria-label="Social media" style={move.style} onCancel={e => { e.preventDefault(); close(); }} onKeyDown={e => e.stopPropagation()}>
    <header {...move.handle}><h2>Social media</h2><button type="button" className="command-icon" aria-label="Fechar" title="Fechar" onClick={close}><X size={15} /></button></header>
    <div className="social-options">
      <label className="settings-check"><input type="checkbox" checked={carousel} onChange={e => setCarousel(e.target.checked)} />Carrossel</label>
      <label className={carousel ? '' : 'disabled'}>Slides<input type="number" min={2} max={20} value={slides} disabled={!carousel} aria-label="Número de slides do carrossel" onChange={e => { const v = Math.round(Number(e.target.value)); if (v >= 2 && v <= 20) setSlides(v); }} /></label>
    </div>
    <div className="social-list" role="list">
      {socialFormats.map(f => <button type="button" key={f.id} role="listitem" className="social-format" title={`${f.use} — clique para criar`} onClick={() => create(f)}>
        <FormatThumb format={f} slides={carousel ? slides : 1} />
        <span className="social-text"><strong>{f.name} <em>{f.ratio}</em></strong><small>{f.width} × {f.height} px{carousel ? ` · ${slides} slides = ${f.width * slides} × ${f.height} px` : ''}</small><small>{f.use}</small></span>
      </button>)}
    </div>
  </dialog>;
}
