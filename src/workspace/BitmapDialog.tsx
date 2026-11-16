import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { applyBitmapEffect, bitmapEffectLabels, resampleSize, type BitmapEffect, type BitmapParams, type Pixels } from '../bitmap/bitmapEffects';
import { exportScene } from '../io/exporters';
import { rasterize } from './ExportDialog';
import { clipContents, matrixOf } from '../geometry/objectTransforms';
import { MAX_FILE_BYTES } from '../document/persistence';
import type { VectorObject } from '../document/model';

export type BitmapCommand = BitmapEffect | 'convert' | 'resample';
export const openBitmap = (command: BitmapCommand) => window.dispatchEvent(new CustomEvent('vectorstudio:bitmap', { detail: command }));
const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('Não foi possível ler o bitmap.')); i.src = src; });
async function pixelsOf(src: string, maxSide = Infinity): Promise<Pixels> {
  const image = await loadImage(src), k = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = window.document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * k)); canvas.height = Math.max(1, Math.round(image.naturalHeight * k));
  const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  return { data: data.data, width: canvas.width, height: canvas.height };
}
/** Codifica os pixels mantendo o formato (JPEG continua JPEG; o resto vira PNG), dentro do limite do projeto. */
function encode(p: Pixels, jpeg: boolean): string {
  const canvas = window.document.createElement('canvas'); canvas.width = p.width; canvas.height = p.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  let src = canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.92);
  if (src.length > MAX_FILE_BYTES * 0.7) src = canvas.toDataURL('image/jpeg', 0.85);
  if (src.length > MAX_FILE_BYTES * 0.7) throw new Error('O bitmap resultante passa do limite do projeto (10 MB). Reamostre para menos DPI.');
  return src;
}
const sliders: Partial<Record<BitmapEffect, [keyof BitmapParams, string, number, number, number, string][]>> = {
  brightness: [['brightness', 'Brilho', -100, 100, 0, ''], ['contrast', 'Contraste', -100, 100, 0, '']],
  hsl: [['hue', 'Matiz', -180, 180, 0, '°'], ['saturation', 'Saturação', -100, 100, 0, ''], ['lightness', 'Luminosidade', -100, 100, 0, '']],
  blackWhite: [['threshold', 'Limiar', 1, 254, 128, '']],
  posterize: [['levels', 'Níveis', 2, 32, 4, '']],
  blur: [['radius', 'Raio', 1, 50, 3, 'px']],
  sharpen: [['amount', 'Intensidade', 10, 500, 100, '%'], ['radius', 'Raio', 1, 10, 2, 'px']],
};
/** Menu Bitmaps (CorelDRAW): converter vetores em bitmap, reamostrar e ajustes/efeitos com pré-visualização. */
export function BitmapDialog() {
  const { document, selectedIds, dispatch, commitEdit, setMessage, setSelection } = useEditor();
  const ref = useRef<HTMLDialogElement>(null), preview = useRef<HTMLCanvasElement>(null);
  const [command, setCommand] = useState<BitmapCommand | null>(null), [params, setParams] = useState<BitmapParams>({}), [dpi, setDpi] = useState(300), [transparent, setTransparent] = useState(true), [busy, setBusy] = useState(false), [base, setBase] = useState<Pixels | null>(null);
  const image = document.objects.find(o => o.type === 'image' && selectedIds.includes(o.id));
  useEffect(() => { const show = (e: Event) => { setCommand((e as CustomEvent<BitmapCommand>).detail); setParams({}); }; window.addEventListener('vectorstudio:bitmap', show); return () => window.removeEventListener('vectorstudio:bitmap', show); }, []);
  useEffect(() => { const d = ref.current; if (!d) return; if (command && !d.open) d.show(); if (!command && d.open) d.close(); }, [command]);
  const effect = command && command !== 'convert' && command !== 'resample' ? command : null;
  // Pré-visualização em resolução reduzida (até 260 px).
  useEffect(() => { setBase(null); if (effect && image?.src) pixelsOf(image.src, 260).then(setBase, () => setBase(null)); }, [effect, image?.src]);
  useEffect(() => {
    const canvas = preview.current; if (!canvas || !base || !effect) return;
    const out = applyBitmapEffect(base, effect, params); canvas.width = out.width; canvas.height = out.height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);
  }, [base, effect, params]);
  const close = () => setCommand(null);
  async function run() {
    finishEditing(); setBusy(true);
    try {
      if (command === 'convert') {
        const scene = exportScene(document, 'selection', selectedIds), blob = await rasterize(scene, 'png', dpi, transparent, 1);
        if (blob.size > MAX_FILE_BYTES * 0.7) throw new Error('O bitmap passa do limite do projeto (10 MB). Use menos DPI.');
        const src = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Falha ao ler o bitmap.')); r.readAsDataURL(blob); });
        const removed = new Set(clipContents(document.objects, selectedIds)), top = Math.max(...document.objects.map((o, i) => removed.has(o.id) ? i : -1));
        const bitmap: VectorObject = { id: crypto.randomUUID(), type: 'image', name: 'Bitmap', x: scene.area.x, y: scene.area.y, width: scene.area.width, height: scene.area.height, fill: 'none', src };
        commitEdit(); dispatch({ type: 'set-objects', objects: document.objects.flatMap((o, i) => i === top ? [bitmap] : removed.has(o.id) ? [] : [o]) }); commitEdit();
        setSelection([bitmap.id]); setMessage(`Convertido em bitmap (${dpi} DPI). Ctrl+Z desfaz.`);
      } else if (image?.src) {
        let src: string;
        if (command === 'resample') {
          const m = matrixOf(image), scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])), size = resampleSize(image.width * scale, image.height * scale, dpi), img = await loadImage(image.src);
          const canvas = window.document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
          const context = canvas.getContext('2d')!; context.imageSmoothingQuality = 'high'; context.drawImage(img, 0, 0, size.width, size.height);
          const data = context.getImageData(0, 0, size.width, size.height);
          src = encode({ data: data.data, width: size.width, height: size.height }, image.src.startsWith('data:image/jpeg'));
          setMessage(`Bitmap reamostrado para ${size.width} × ${size.height} px (${dpi} DPI).`);
        } else {
          src = encode(applyBitmapEffect(await pixelsOf(image.src), effect!, params), image.src.startsWith('data:image/jpeg'));
          setMessage(`${bitmapEffectLabels[effect!]} aplicado. Ctrl+Z desfaz.`);
        }
        commitEdit(); dispatch({ type: 'set-objects', objects: document.objects.map(o => o.id === image.id ? { ...o, src } : o) }); commitEdit();
      }
      close();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Não foi possível processar o bitmap.'); }
    finally { setBusy(false); }
  }
  const title = command === 'convert' ? 'Converter em bitmap' : command === 'resample' ? 'Reamostrar' : effect ? bitmapEffectLabels[effect] : '';
  const needsImage = command !== 'convert';
  return <dialog ref={ref} className="workspace-settings transform-window text-tool-window bitmap-window" aria-label={title} onCancel={e => { e.preventDefault(); close(); }} onKeyDown={e => e.stopPropagation()}>
    <header className="transform-header"><h2>{title}</h2><button type="button" className="dock-close" aria-label={`Fechar ${title}`} onClick={close}><X size={14} /></button></header>
    {command && <form onSubmit={e => { e.preventDefault(); void run(); }}>
      {needsImage && !image && <p className="form-error" role="alert">Selecione um bitmap (imagem importada ou convertida).</p>}
      {command === 'convert' && <>
        <p className="muted">Os objetos selecionados viram uma única imagem no mesmo lugar (o original sai do desenho; Ctrl+Z desfaz).</p>
        <label className="settings-check"><input type="checkbox" checked={transparent} onChange={e => setTransparent(e.target.checked)} />Fundo transparente</label></>}
      {(command === 'convert' || command === 'resample') && <label className="settings-row">Resolução<select value={dpi} onChange={e => setDpi(Number(e.target.value))}>{[72, 96, 150, 200, 300, 600].map(v => <option key={v} value={v}>{v} DPI</option>)}</select></label>}
      {command === 'resample' && image && <p className="muted">O tamanho no documento não muda; só a quantidade de pixels.</p>}
      {effect && image && <>
        <canvas ref={preview} className="bitmap-preview" aria-label="Pré-visualização" />
        {(sliders[effect] ?? []).map(([key, label, min, max, initial, suffix]) => <label key={key} className="settings-row">{label}<input type="range" min={min} max={max} value={params[key] ?? initial} onChange={e => setParams({ ...params, [key]: Number(e.target.value) })} /><span>{params[key] ?? initial}{suffix}</span></label>)}
      </>}
      <footer><button type="button" onClick={close}>Cancelar</button><button type="submit" className="primary" disabled={busy || (needsImage && !image) || (!needsImage && !selectedIds.length)}>{busy ? 'Processando…' : 'Aplicar'}</button></footer>
    </form>}
  </dialog>;
}
