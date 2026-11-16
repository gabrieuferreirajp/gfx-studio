import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import type { LayerMask, VectorObject } from '../document/model';
import { aiAlpha, aiInput, removeBackground, type RemoveBackgroundOptions } from '../bitmap/removeBackground';
import { desktop } from '../io/desktop';
import { loadImage, maskBox, maskPixels } from '../bitmap/layerMask';
import { useDialogDrag } from './useDialogDrag';

export const openRemoveBackground = () => window.dispatchEvent(new CustomEvent('vectorstudio:remove-background'));
const ANALYSIS = 1600, AI = 1024;
type Mode = 'ai' | 'color';
/** Máscara da IA (1024×1024, 0–1) redimensionada para w×h, em tons 0–255. */
function aiMaskAt(mask: Float32Array, w: number, h: number): Uint8ClampedArray {
  const small = document.createElement('canvas'); small.width = AI; small.height = AI;
  const s = small.getContext('2d')!, img = s.createImageData(AI, AI);
  for (let i = 0; i < mask.length; i++) { const v = Math.round(mask[i] * 255); img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  s.putImageData(img, 0, 0);
  const big = document.createElement('canvas'); big.width = w; big.height = h;
  const b = big.getContext('2d', { willReadFrequently: true })!; b.imageSmoothingEnabled = true; b.imageSmoothingQuality = 'high'; b.drawImage(small, 0, 0, w, h);
  const data = b.getImageData(0, 0, w, h).data, out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4];
  return out;
}
/** Opacidade calculada → máscara de camada do objeto (preto = fundo oculto), na caixa da máscara. */
async function maskFrom(o: VectorObject, alpha: Uint8ClampedArray, w: number, h: number): Promise<LayerMask> {
  const box = maskBox(o), size = maskPixels(box), gray = document.createElement('canvas');
  gray.width = w; gray.height = h;
  const g = gray.getContext('2d')!, img = g.createImageData(w, h);
  for (let i = 0; i < alpha.length; i++) { const v = alpha[i]; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const sx = size.width / box.width, sy = size.height / box.height;
  ctx.drawImage(gray, (o.x - box.x) * sx, (o.y - box.y) * sy, o.width * sx, o.height * sy);
  return { src: canvas.toDataURL('image/png'), ...box, background: 'black' };
}
/**
 * Remover fundo (Bitmaps › Remover fundo…): calcula o fundo pela borda da imagem e cria uma máscara de camada
 * (não apaga pixels: dá para refinar com o Pincel de máscara ou desativar a máscara). Prévia ao vivo no desenho.
 */
export function RemoveBackgroundDialog() {
  const { document, selectedIds, dispatch, amend, commitEdit, setMessage, setTool } = useEditor();
  const [target, setTarget] = useState<VectorObject | null>(null), [options, setOptions] = useState<RemoveBackgroundOptions>({ tolerance: 22, inner: false, softness: 1 });
  const [busy, setBusy] = useState(false), ref = useRef<HTMLDialogElement>(null), move = useDialogDrag();
  // IA (fotos, fundo complexo) quando o modelo está instalado com o aplicativo; senão, pela cor da borda.
  const [aiReady, setAiReady] = useState(false), [mode, setMode] = useState<Mode>('color'), [edge, setEdge] = useState(30), [status, setStatus] = useState('');
  const aiMask = useRef<Float32Array | null>(null), image = useRef<HTMLImageElement | null>(null);
  useEffect(() => { void desktop?.removeBackgroundAIAvailable?.().then(ok => { setAiReady(!!ok); if (ok) setMode('ai'); }).catch(() => {}); }, []);
  const original = useRef<VectorObject[] | null>(null), pixels = useRef<ImageData | null>(null), result = useRef<LayerMask | null>(null);
  useEffect(() => {
    const show = () => {
      const image = document.objects.find(o => selectedIds.length === 1 && o.id === selectedIds[0] && o.type === 'image' && o.src);
      if (!image) { setMessage('Remover fundo: selecione uma imagem (bitmap).'); return; }
      finishEditing(); original.current = document.objects; pixels.current = null; result.current = null; aiMask.current = null; setStatus(''); setTarget(image);
    };
    window.addEventListener('vectorstudio:remove-background', show); return () => window.removeEventListener('vectorstudio:remove-background', show);
  });
  useEffect(() => { if (target) ref.current?.showModal(); }, [target]);
  // Lê a imagem uma vez (até 1600 px) e recalcula a máscara a cada ajuste.
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setBusy(true);
        if (!pixels.current) {
          const img = image.current = await loadImage(target.src!), k = Math.min(1, ANALYSIS / Math.max(img.naturalWidth, img.naturalHeight));
          const c = window.document.createElement('canvas'); c.width = Math.max(2, Math.round(img.naturalWidth * k)); c.height = Math.max(2, Math.round(img.naturalHeight * k));
          const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0, c.width, c.height); pixels.current = ctx.getImageData(0, 0, c.width, c.height);
        }
        const p = pixels.current;
        let alpha: Uint8ClampedArray;
        if (mode === 'ai' && desktop?.removeBackgroundAI) {
          // O modelo roda uma vez por imagem; o ajuste da borda só reprocessa a máscara.
          if (!aiMask.current) {
            setStatus('Analisando a imagem com IA…');
            const c = window.document.createElement('canvas'); c.width = AI; c.height = AI;
            const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image.current!, 0, 0, AI, AI);
            const t0 = performance.now(), r = await desktop.removeBackgroundAI(aiInput(ctx.getImageData(0, 0, AI, AI)));
            if (cancelled) return;
            if (!r.ok) throw new Error(r.error);
            aiMask.current = r.mask; setStatus(`IA: ${Math.round(performance.now() - t0)} ms (${r.provider === 'dml' ? 'placa de vídeo' : 'processador'})`);
          }
          alpha = aiAlpha(aiMaskAt(aiMask.current, p.width, p.height), edge);
        } else alpha = removeBackground(p, options);
        const mask = await maskFrom(target, alpha, p.width, p.height);
        if (cancelled) return;
        result.current = mask;
        amend({ type: 'set-objects', objects: original.current!.map(o => o.id === target.id ? { ...o, mask } : o) });
      } catch (error) { if (!cancelled) { setStatus(''); setMessage(error instanceof Error && error.message ? `Remover fundo: ${error.message}` : 'Não foi possível ler esta imagem para remover o fundo.'); } }
      finally { if (!cancelled) setBusy(false); }
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [target, options, mode, edge]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!target) return null;
  const finish = (apply: boolean) => {
    const id = target.id, mask = result.current, base = original.current!;
    amend({ type: 'set-objects', objects: base });
    if (apply && mask) { commitEdit(); dispatch({ type: 'set-objects', objects: base.map(o => o.id === id ? { ...o, mask } : o) }); commitEdit(); setMessage('Fundo removido com máscara de camada: refine com o Pincel de máscara (preto oculta, branco revela). Ctrl+Z desfaz.'); }
    setTarget(null); original.current = null;
    if (apply && mask) setTool('maskBrush');
  };
  const set = (patch: Partial<RemoveBackgroundOptions>) => setOptions(o => ({ ...o, ...patch }));
  return <dialog ref={ref} className="workspace-settings paint-dialog remove-bg-dialog" aria-label="Remover fundo" style={move.style} onCancel={e => { e.preventDefault(); finish(false); }} onKeyDown={e => e.stopPropagation()}>
    <form method="dialog" onSubmit={e => { e.preventDefault(); finish(true); }}>
      <header {...move.handle}><h2>Remover fundo</h2>{(busy || status) && <span className="paint-dialog-scope">{busy && !status ? 'Calculando…' : status}</span>}</header>
      <div className="remove-bg-body">
        <span className="segmented" role="radiogroup" aria-label="Método">
          <button type="button" role="radio" aria-checked={mode === 'ai'} aria-pressed={mode === 'ai'} disabled={!aiReady} title={aiReady ? 'IA (IS-Net): pessoas, produtos e fotos com fundo complexo' : 'IA: disponível no GFX Studio instalado'} onClick={() => setMode('ai')}>IA (fotos)</button>
          <button type="button" role="radio" aria-checked={mode === 'color'} aria-pressed={mode === 'color'} title="Pela cor da borda: fundo liso ou de poucas cores" onClick={() => setMode('color')}>Cor do fundo</button>
        </span>
        {mode === 'ai' ? <>
          <p className="muted">A IA separa o objeto principal (pessoa, produto, animal…) do fundo, como no Photoshop. Roda no seu computador, sem internet. O resultado é uma máscara de camada: refine com o Pincel de máscara.</p>
          <label className="settings-row" title="Baixo: borda suave (cabelo, pelos). Alto: borda nítida (produtos, logotipos).">Firmeza da borda<input type="range" min={0} max={100} value={edge} onChange={e => setEdge(Number(e.target.value))} /><span>{edge}</span></label>
        </> : <>
          <p className="muted">O fundo é detectado pelas cores da borda da imagem. Funciona melhor com fundo liso ou de poucas cores (estúdio, logotipo, produto). O resultado é uma máscara de camada: dá para refinar com o Pincel de máscara.</p>
          <label className="settings-row">Tolerância<input type="range" min={2} max={90} value={options.tolerance} onChange={e => set({ tolerance: Number(e.target.value) })} /><span>{options.tolerance}</span></label>
          <label className="settings-row">Suavizar borda<input type="range" min={0} max={4} value={options.softness} onChange={e => set({ softness: Number(e.target.value) })} /><span>{options.softness}</span></label>
          <label className="settings-check"><input type="checkbox" checked={options.inner} onChange={e => set({ inner: e.target.checked })} />Remover também áreas internas da mesma cor (ex.: miolo de letras)</label>
        </>}
      </div>
      <footer><span /><span className="paint-dialog-buttons"><button type="submit" className="primary" disabled={!result.current && busy}>OK</button><button type="button" onClick={() => finish(false)}>Cancelar</button></span></footer>
    </form>
  </dialog>;
}
