import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, ChevronDown } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import type { LayerMask, VectorObject } from '../document/model';
import type { Point } from '../geometry/pathGeometry';
import { createMask, invertMask, loadImage, maskPixel, maskScale } from '../bitmap/layerMask';
import { finishEditing } from '../state/useProjectFiles';
import { LevelSlider } from './LevelSlider';
import { brushFalloff } from '../bitmap/brushFalloff';

/**
 * Pincel de máscara (Photoshop): pinta a máscara de camada do objeto selecionado. Preto oculta, branco revela.
 * Tamanho e dureza como no Photoshop: Alt + arrastar com o botão direito (lados = tamanho, cima/baixo = dureza),
 * botão direito abre o seletor de pincel; [ e ] também mudam o tamanho, X troca preto/branco, D volta ao preto.
 * Cada pincelada é um passo no Desfazer. Sem máscara, a primeira pincelada cria uma (revelar tudo).
 * Para ficar suave: carimbo pré-desenhado, pontos intermediários do mouse (coalescidos), traço alisado por curvas e
 * visualização trocada direto no SVG (sem redesenhar o documento); o PNG final é gerado só ao soltar.
 */
export interface BrushOptions { size: number; hardness: number; opacity: number; color: 'black' | 'white' }
let options: BrushOptions = { size: 30, hardness: 50, opacity: 100, color: 'black' };
const listeners = new Set<() => void>();
export const brushStore = {
  get: () => options,
  set: (patch: Partial<BrushOptions>) => { options = { ...options, ...patch }; listeners.forEach(l => l()); },
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
};
const useBrush = () => useSyncExternalStore(brushStore.subscribe, brushStore.get);
// Posição do cursor do pincel: fora do estado do Canvas, para não redesenhar o documento a cada movimento.
let hoverPoint: Point | null = null;
const hoverListeners = new Set<() => void>();
const setHover = (p: Point | null) => { if (p === hoverPoint) return; hoverPoint = p; hoverListeners.forEach(l => l()); };
const subscribeHover = (l: () => void) => { hoverListeners.add(l); return () => { hoverListeners.delete(l); }; };
// Alt + botão direito arrastando (Photoshop): ajuste ao vivo de tamanho/dureza, com o círculo parado no ponto inicial.
type Resize = { pointerId: number; x: number; y: number; size: number; hardness: number; zoom: number };
let resizing: Resize | null = null;
const setResizing = (r: Resize | null) => { resizing = r; hoverListeners.forEach(l => l()); };
// Seletor de pincel (botão direito no desenho ou botão da barra), em coordenadas da tela.
let picker: { x: number; y: number } | null = null;
const pickerListeners = new Set<() => void>();
export const brushPicker = { open: (x: number, y: number) => { picker = { x, y }; pickerListeners.forEach(l => l()); }, close: () => { if (!picker) return; picker = null; pickerListeners.forEach(l => l()); } };
const subscribePicker = (l: () => void) => { pickerListeners.add(l); return () => { pickerListeners.delete(l); }; };
// Bitmap da máscara em edição, reaproveitado entre pinceladas enquanto o `src` não muda por fora (Desfazer, etc.).
const cache = new Map<string, { src: string; canvas: HTMLCanvasElement }>();
async function maskCanvas(id: string, mask: LayerMask): Promise<HTMLCanvasElement> {
  const hit = cache.get(id); if (hit && hit.src === mask.src) return hit.canvas;
  const image = await loadImage(mask.src), canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  cache.set(id, { src: mask.src, canvas }); return canvas;
}
/** Carimbo do pincel (círculo com borda suave), desenhado uma vez por tamanho/dureza/cor. */
let stampCache: { key: string; canvas: HTMLCanvasElement } | null = null;
function stamp(r: number, hardness: number, color: string) {
  const key = `${r.toFixed(2)}|${hardness}|${color}`;
  if (stampCache?.key === key) return stampCache.canvas;
  const size = Math.max(1, Math.ceil(r * 2) + 2), canvas = document.createElement('canvas'), c = size / 2;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!, g = ctx.createRadialGradient(c, c, 0, c, c, r), h = Math.min(0.99, hardness / 100);
  for (let i = 0; i <= 16; i++) { const t = i / 16; g.addColorStop(t, `rgba(${color},${brushFalloff(t, h)})`); }
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fill();
  stampCache = { key, canvas }; return canvas;
}
const rgb = (o: BrushOptions) => o.color === 'black' ? '0,0,0' : '255,255,255';

type Stroke = {
  pointerId: number; id: string; mask: LayerMask; object: VectorObject; base: HTMLCanvasElement | null; layer: HTMLCanvasElement | null; out: HTMLCanvasElement | null;
  queue: Point[]; raw: Point | null; mid: Point | null; remain: number; frame: number | null; encoding: boolean; dirty: boolean; url: string | null;
};
export function useMaskBrush() {
  const { tool, document, selectedIds, setSelection, dispatch, beginEdit, commitEdit, setMessage, viewport } = useEditor();
  const active = tool === 'maskBrush';
  const stroke = useRef<Stroke | null>(null);
  const latestObjects = useRef(document.objects); latestObjects.current = document.objects;
  useEffect(() => {
    if (!active) { setHover(null); return; }
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      const o = brushStore.get();
      if (e.key === '[') brushStore.set({ size: Math.max(1, Math.round(o.size / 1.25)) });
      else if (e.key === ']') brushStore.set({ size: Math.min(2000, Math.round(o.size * 1.25)) });
      else if (e.key === 'x' || e.key === 'X') brushStore.set({ color: o.color === 'black' ? 'white' : 'black' });
      else if (e.key === 'd' || e.key === 'D') brushStore.set({ color: 'black' });
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [active]);

  const radius = (s: Stroke) => Math.max(0.5, brushStore.get().size / 2 * maskScale(s.object, s.mask, s.base!));
  const spacingOf = (r: number) => Math.max(0.35, r * 0.1);
  /** Carimbos espaçados ao longo de uma lista de pontos (pixels da máscara), continuando o espaçamento anterior. */
  function along(s: Stroke, points: Point[]) {
    const ctx = s.layer!.getContext('2d')!, o = brushStore.get(), r = radius(s), image = stamp(r, o.hardness, rgb(o));
    const spacing = spacingOf(r), half = image.width / 2;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], len = Math.hypot(b.x - a.x, b.y - a.y);
      let d = s.remain;
      while (d <= len) { const t = len ? d / len : 0; ctx.drawImage(image, a.x + (b.x - a.x) * t - half, a.y + (b.y - a.y) * t - half); d += spacing; }
      s.remain = d - len;
    }
  }
  /** Traço alisado: curva quadrática entre os pontos médios (como o alisamento do Photoshop). */
  function addPoint(s: Stroke, p: Point) {
    if (!s.raw) {
      const o = brushStore.get(), r = radius(s), image = stamp(r, o.hardness, rgb(o));
      s.layer!.getContext('2d')!.drawImage(image, p.x - image.width / 2, p.y - image.height / 2);
      s.raw = p; s.mid = p; s.remain = spacingOf(r); return;
    }
    if (Math.hypot(p.x - s.raw.x, p.y - s.raw.y) < 0.25) return;
    const mid = { x: (s.raw.x + p.x) / 2, y: (s.raw.y + p.y) / 2 }, from = s.mid!, c = s.raw;
    const n = Math.max(2, Math.ceil((Math.hypot(c.x - from.x, c.y - from.y) + Math.hypot(mid.x - c.x, mid.y - c.y)) / 2));
    const pts: Point[] = [];
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; pts.push({ x: u * u * from.x + 2 * u * t * c.x + t * t * mid.x, y: u * u * from.y + 2 * u * t * c.y + t * t * mid.y }); }
    along(s, pts);
    s.raw = p; s.mid = mid;
  }
  function compose(s: Stroke) {
    if (!s.out) { s.out = window.document.createElement('canvas'); s.out.width = s.base!.width; s.out.height = s.base!.height; }
    const ctx = s.out.getContext('2d')!; ctx.globalAlpha = 1; ctx.clearRect(0, 0, s.out.width, s.out.height); ctx.drawImage(s.base!, 0, 0);
    ctx.globalAlpha = brushStore.get().opacity / 100; ctx.drawImage(s.layer!, 0, 0); ctx.globalAlpha = 1;
    return s.out;
  }
  /** Visualização durante a pincelada: codifica em segundo plano e troca a imagem da máscara direto no SVG. */
  function preview(s: Stroke) {
    s.frame = null;
    if (stroke.current !== s || !s.base || !s.layer) return;
    if (s.encoding) { s.dirty = true; return; }
    s.encoding = true; s.dirty = false;
    compose(s).toBlob(blob => {
      s.encoding = false;
      if (stroke.current !== s || !blob) return;
      const url = URL.createObjectURL(blob);
      window.document.querySelectorAll(`mask[id="lmask-${CSS.escape(s.id)}"] image`).forEach(image => image.setAttribute('href', url));
      if (s.url) URL.revokeObjectURL(s.url);
      s.url = url;
      if (s.dirty) schedule(s);
    }, 'image/png');
  }
  function schedule(s: Stroke) { if (s.frame === null) s.frame = window.requestAnimationFrame(() => preview(s)); }
  function paint(s: Stroke, points: Point[]) {
    if (!s.base) { s.queue.push(...points); return; }
    for (const p of points) addPoint(s, maskPixel(s.object, s.mask, s.base, p));
    schedule(s);
  }

  /** Botão direito: com Alt, ajusta tamanho/dureza arrastando; sem Alt, abre o seletor de pincel. */
  function right(p: Point, pointerId: number, clientX: number, clientY: number, alt: boolean): boolean {
    if (!active || stroke.current) return false;
    if (!alt) { brushPicker.open(clientX, clientY); return false; }
    brushPicker.close(); setHover(p);
    const o = brushStore.get();
    setResizing({ pointerId, x: clientX, y: clientY, size: o.size, hardness: o.hardness, zoom: viewport.zoom });
    return true;
  }
  function down(p: Point, pointerId: number, targetId: string | null): boolean {
    if (!active) return false;
    brushPicker.close();
    const selected = document.objects.filter(o => selectedIds.includes(o.id));
    let object = selected.length === 1 ? selected[0] : document.objects.find(o => o.id === targetId);
    if (!object) { setMessage('Pincel de máscara: selecione um objeto (ou clique nele) e pinte. Preto oculta, branco revela.'); return false; }
    setSelection([object.id]);
    beginEdit();
    if (!object.mask || object.mask.disabled) {
      const mask = object.mask ? { ...object.mask, disabled: undefined } : createMask(object, 'white');
      if (mask.disabled === undefined) delete mask.disabled;
      object = { ...object, mask };
      const updated = object;
      dispatch({ type: 'set-objects', objects: document.objects.map(o => o.id === updated.id ? updated : o) });
      latestObjects.current = latestObjects.current.map(o => o.id === updated.id ? updated : o);
    }
    const s: Stroke = { pointerId, id: object.id, mask: object.mask!, object, base: null, layer: null, out: null, queue: [p], raw: null, mid: null, remain: 0, frame: null, encoding: false, dirty: false, url: null };
    stroke.current = s;
    void maskCanvas(object.id, object.mask!).then(base => {
      if (stroke.current !== s) return;
      s.base = base; s.layer = window.document.createElement('canvas'); s.layer.width = base.width; s.layer.height = base.height;
      const queued = s.queue; s.queue = [];
      paint(s, queued);
    }).catch(() => { setMessage('Não foi possível ler a máscara deste objeto.'); stroke.current = null; commitEdit(); });
    return true;
  }
  /** `points`: os pontos intermediários do mouse (eventos coalescidos), para o traço não sair em segmentos retos. */
  function move(p: Point, pointerId: number, points?: Point[], client?: { x: number; y: number }) {
    if (!active) return;
    if (resizing) {
      // Para os lados: o diâmetro acompanha o mouse (2× o deslocamento na tela); para baixo endurece, para cima suaviza.
      if (resizing.pointerId === pointerId && client) brushStore.set({ size: Math.max(1, Math.min(2000, Math.round(resizing.size + (client.x - resizing.x) * 2 / resizing.zoom))), hardness: Math.max(0, Math.min(100, Math.round(resizing.hardness + (client.y - resizing.y) / 2))) });
      return;
    }
    setHover(p);
    const s = stroke.current; if (s && s.pointerId === pointerId) paint(s, points?.length ? points : [p]);
  }
  function up(pointerId: number) {
    if (resizing?.pointerId === pointerId) { setResizing(null); return; }
    const s = stroke.current; if (!s || s.pointerId !== pointerId) return;
    if (s.base && s.raw && s.mid) along(s, [s.mid, s.raw]);
    stroke.current = null;
    if (s.frame !== null) window.cancelAnimationFrame(s.frame);
    if (s.base && s.layer) {
      const out = compose(s), copy = window.document.createElement('canvas');
      copy.width = out.width; copy.height = out.height; copy.getContext('2d')!.drawImage(out, 0, 0);
      const src = copy.toDataURL('image/png');
      cache.set(s.id, { src, canvas: copy });
      dispatch({ type: 'set-objects', objects: latestObjects.current.map(o => o.id === s.id && o.mask ? { ...o, mask: { ...o.mask, src } } : o) });
    }
    if (s.url) { const url = s.url; window.setTimeout(() => URL.revokeObjectURL(url), 2000); }
    commitEdit();
  }
  const element = active ? <MaskBrushCursor zoom={viewport.zoom} /> : null;
  return { active, down, right, move, up, isDragging: () => !!stroke.current || !!resizing, element, leave: () => { if (!resizing) setHover(null); } };
}
function MaskBrushCursor({ zoom: z }: { zoom: number }) {
  const brush = useBrush(), hover = useSyncExternalStore(subscribeHover, () => hoverPoint), resize = useSyncExternalStore(subscribeHover, () => resizing);
  const open = useSyncExternalStore(subscribePicker, () => picker);
  const pickerView = open ? createPortal(<BrushPicker x={open.x} y={open.y} />, window.document.querySelector('.app') ?? window.document.body) : null;
  if (!hover) return pickerView;
  const r = brush.size / 2;
  // Ajuste com Alt + botão direito: prévia vermelha com a dureza, como no Photoshop.
  if (resize) return <g pointerEvents="none" className="mask-brush-cursor">
    <defs><radialGradient id="mask-brush-resize"><stop offset={`${Math.min(99, brush.hardness)}%`} stopColor="#ff0000" stopOpacity={0.5} /><stop offset="100%" stopColor="#ff0000" stopOpacity={brush.hardness >= 100 ? 0.5 : 0} /></radialGradient></defs>
    <circle cx={hover.x} cy={hover.y} r={r} fill="url(#mask-brush-resize)" stroke="#000" strokeOpacity={0.6} strokeWidth={1 / z} />
    <text x={hover.x + r + 8 / z} y={hover.y} fontSize={12 / z} fontFamily="Segoe UI, sans-serif" fill="#262935" stroke="#fff" strokeWidth={3 / z} paintOrder="stroke">{`Tamanho: ${Math.round(brush.size)} px · Dureza: ${brush.hardness}%`}</text>
  </g>;
  return <g pointerEvents="none" className="mask-brush-cursor">{pickerView}
    <circle cx={hover.x} cy={hover.y} r={r} fill="none" stroke="#fff" strokeWidth={3 / z} />
    <circle cx={hover.x} cy={hover.y} r={r} fill="none" stroke="#000" strokeWidth={1 / z} />
    {brush.hardness < 100 && <circle cx={hover.x} cy={hover.y} r={r * brush.hardness / 100} fill="none" stroke="#000" strokeOpacity={0.35} strokeWidth={1 / z} strokeDasharray={`${3 / z} ${3 / z}`} />}
    <path d={`M${hover.x - 4 / z} ${hover.y}h${8 / z}M${hover.x} ${hover.y - 4 / z}v${8 / z}`} stroke="#000" strokeWidth={1 / z} />
  </g>;
}
/** Seletor de pincel do Photoshop: Tamanho e Dureza com régua e campo; fecha com Enter, Esc ou clique fora. */
function BrushPicker({ x, y }: { x: number; y: number }) {
  const o = useBrush(), ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) brushPicker.close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); brushPicker.close(); } };
    const t = window.setTimeout(() => window.addEventListener('pointerdown', outside, true), 0);
    window.addEventListener('keydown', key, true);
    return () => { window.clearTimeout(t); window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', key, true); };
  }, []);
  const left = Math.max(4, Math.min(x, window.innerWidth - 264)), top = Math.max(4, Math.min(y, window.innerHeight - 200));
  const preview = Math.max(2, Math.min(28, o.size / 4));
  return <div ref={ref} className="brush-picker" role="dialog" aria-label="Seletor de pincel" style={{ left, top }} onContextMenu={e => e.preventDefault()}>
    <label>Tamanho:<input type="number" aria-label="Tamanho do pincel (px)" min={1} max={2000} value={Math.round(o.size)} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 1 && v <= 2000) brushStore.set({ size: v }); }} /><span>px</span></label>
    <LevelSlider aria-label="Tamanho do pincel" min={1} max={500} value={Math.min(500, o.size)} onChange={e => brushStore.set({ size: Number(e.target.value) })} />
    <label>Dureza:<input type="number" aria-label="Dureza do pincel (%)" min={0} max={100} value={o.hardness} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v <= 100) brushStore.set({ hardness: v }); }} /><span>%</span></label>
    <LevelSlider aria-label="Dureza do pincel" value={o.hardness} onChange={e => brushStore.set({ hardness: Number(e.target.value) })} />
    <div className="brush-picker-preview" aria-hidden="true"><span style={{ width: preview * 2, height: preview * 2, background: `radial-gradient(circle, #000 ${Math.min(99, o.hardness)}%, transparent 100%)` }} /></div>
    <small>No desenho: Alt + arrastar com o botão direito · ← → tamanho · ↑ ↓ dureza</small>
  </div>;
}

/** Comandos de máscara (menu Objeto › Máscara, painel Objetos e barra do pincel). */
export function useMaskCommands() {
  const { document, selectedIds, dispatch, commitEdit, setMessage, setTool } = useEditor();
  const targets = () => document.objects.filter(o => selectedIds.includes(o.id));
  const apply = (map: (o: VectorObject) => VectorObject, ids: string[], message: string) => {
    finishEditing(); commitEdit(); dispatch({ type: 'set-objects', objects: document.objects.map(o => ids.includes(o.id) ? map(o) : o) }); commitEdit(); setMessage(message);
  };
  return {
    add(fill: 'white' | 'black' = 'white', ids = targets().filter(o => !o.mask).map(o => o.id)) {
      if (!ids.length) { setMessage(targets().length ? 'O objeto selecionado já tem máscara.' : 'Selecione um objeto para adicionar a máscara.'); return; }
      apply(o => ({ ...o, mask: createMask(o, fill) }), ids, fill === 'white' ? 'Máscara adicionada (revelar tudo): pinte de preto com o pincel de máscara para ocultar. Ctrl+Z desfaz.' : 'Máscara adicionada (ocultar tudo): pinte de branco para revelar. Ctrl+Z desfaz.');
      setTool('maskBrush');
    },
    remove(ids = targets().filter(o => o.mask).map(o => o.id)) { if (ids.length) apply(o => { const { mask: _, ...rest } = o; return rest; }, ids, 'Máscara excluída. Ctrl+Z desfaz.'); },
    toggle(ids = targets().filter(o => o.mask).map(o => o.id)) {
      if (!ids.length) return;
      const off = !document.objects.find(o => o.id === ids[0])!.mask!.disabled;
      apply(o => { if (!o.mask) return o; const { disabled: _, ...mask } = o.mask; return { ...o, mask: off ? { ...mask, disabled: true } : mask }; }, ids, off ? 'Máscara desativada (a pintura fica guardada).' : 'Máscara ativada.');
    },
    async invert(ids = targets().filter(o => o.mask).map(o => o.id)) {
      if (!ids.length) return;
      const inverted = new Map<string, LayerMask>();
      for (const id of ids) inverted.set(id, await invertMask(document.objects.find(o => o.id === id)!.mask!));
      apply(o => ({ ...o, mask: inverted.get(o.id)! }), ids, 'Máscara invertida. Ctrl+Z desfaz.');
    },
  };
}

/** Barra de propriedades do pincel de máscara. */
export function MaskBrushControls() {
  const o = useBrush(), { document, selectedIds } = useEditor(), commands = useMaskCommands();
  const target = document.objects.find(x => selectedIds.length === 1 && x.id === selectedIds[0]);
  return <span className="tool-options mask-brush-options">
    <span className="segmented" role="group" aria-label="Cor do pincel">
      <button type="button" aria-pressed={o.color === 'black'} title="Preto: oculta (D)" onClick={() => brushStore.set({ color: 'black' })}><span className="brush-swatch black" />Ocultar</button>
      <button type="button" aria-pressed={o.color === 'white'} title="Branco: revela" onClick={() => brushStore.set({ color: 'white' })}><span className="brush-swatch white" />Revelar</button>
    </span>
    <button type="button" className="command-icon" title="Trocar preto/branco (X)" aria-label="Trocar preto e branco (X)" onClick={() => brushStore.set({ color: o.color === 'black' ? 'white' : 'black' })}><ArrowLeftRight size={15} /></button>
    <button type="button" className="brush-picker-button" aria-label={`Seletor de pincel: tamanho ${Math.round(o.size)} px, dureza ${o.hardness}%`} title="Seletor de pincel (tamanho e dureza) · no desenho: botão direito, ou Alt + arrastar com o botão direito" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); brushPicker.open(r.left, r.bottom + 4); }}>
      <span className="brush-picker-dot" style={{ background: `radial-gradient(circle, #000 ${Math.min(99, o.hardness)}%, transparent 100%)` }} /><span>{Math.round(o.size)}</span><ChevronDown size={12} />
    </button>
    <label title="Opacidade de cada pincelada">Opacidade<LevelSlider aria-label="Opacidade do pincel" min={1} value={o.opacity} onChange={e => brushStore.set({ opacity: Number(e.target.value) })} /><span>{o.opacity}%</span></label>
    <span className="command-divider" />
    {!target?.mask ? <><button type="button" disabled={!target} title="Máscara branca: tudo visível, pinte de preto para ocultar" onClick={() => commands.add('white')}>Adicionar máscara</button><button type="button" disabled={!target} title="Máscara preta: tudo oculto, pinte de branco para revelar" onClick={() => commands.add('black')}>Ocultar tudo</button></>
      : <><button type="button" onClick={() => commands.toggle()} title="Desativar/ativar a máscara sem perder a pintura">{target.mask.disabled ? 'Ativar' : 'Desativar'}</button><button type="button" onClick={() => void commands.invert()} title="Inverter a máscara (Ctrl+I no Photoshop)">Inverter</button><button type="button" onClick={() => commands.remove()} title="Excluir a máscara">Excluir máscara</button></>}
  </span>;
}
