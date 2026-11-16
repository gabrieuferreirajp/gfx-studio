import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useEditor } from '../state/EditorContext';
import type { VectorObject } from '../document/model';
import type { Point } from '../geometry/pathGeometry';
import { inverse, matrixOf, transformPoint } from '../geometry/objectTransforms';
import { loadImage } from '../bitmap/layerMask';
import { brushFalloff } from '../bitmap/brushFalloff';
import { fromUnit, toUnit, unitDefinitions } from '../document/units';
import { LevelSlider } from './LevelSlider';

/**
 * Carimbo (ferramenta Carimbo do Photoshop) para bitmaps: Alt+clique marca a origem; depois, pintar copia os pixels
 * da origem para onde o pincel passa, com a mesma distância entre os dois. "Alinhado": a distância fica fixa entre
 * pinceladas; desligado, cada pincelada recomeça da origem. Tamanho, dureza e opacidade como no Photoshop;
 * [ e ] mudam o tamanho. Cada pincelada é um passo no Desfazer; o bitmap é regravado ao soltar.
 */
export interface StampOptions { size: number; hardness: number; opacity: number; aligned: boolean }
let options: StampOptions = { size: 40, hardness: 60, opacity: 100, aligned: true };
const listeners = new Set<() => void>();
export const stampStore = {
  get: () => options,
  set: (patch: Partial<StampOptions>) => { options = { ...options, ...patch }; listeners.forEach(l => l()); },
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
};
const useStamp = () => useSyncExternalStore(stampStore.subscribe, stampStore.get);
// Cursor e marca da origem fora do estado do Canvas (não redesenha o documento a cada movimento).
let view: { hover: Point | null; source: Point | null; sourceOf: string | null; alt: boolean; delta: Point | null; painting: boolean } = { hover: null, source: null, sourceOf: null, alt: false, delta: null, painting: false };
const viewListeners = new Set<() => void>();
const setView = (patch: Partial<typeof view>) => { view = { ...view, ...patch }; viewListeners.forEach(l => l()); };
const subscribeView = (l: () => void) => { viewListeners.add(l); return () => { viewListeners.delete(l); }; };

/** Ponto do documento → pixel do bitmap (tamanho natural). */
function toPixel(o: VectorObject, size: { width: number; height: number }, p: Point): Point {
  const l = transformPoint(inverse(matrixOf(o)), p);
  return { x: (l.x - o.x) / o.width * size.width, y: (l.y - o.y) / o.height * size.height };
}
type Stroke = { pointerId: number; object: VectorObject; base: HTMLCanvasElement | null; layer: HTMLCanvasElement | null; offset: Point; last: Point | null; remain: number; queue: Point[]; frame: number | null; encoding: boolean; url: string | null; mime: string };
export function useCloneStamp() {
  const { tool, document, selectedIds, dispatch, beginEdit, commitEdit, setMessage, viewport } = useEditor();
  const active = tool === 'cloneStamp';
  const stroke = useRef<Stroke | null>(null), offset = useRef<Point | null>(null);
  const latest = useRef(document.objects); latest.current = document.objects;
  useEffect(() => {
    if (!active) { setView({ hover: null }); return; }
    const key = (e: KeyboardEvent) => {
      setView({ alt: e.altKey });
      if (e.type !== 'keydown' || e.ctrlKey || e.metaKey || (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      const o = stampStore.get();
      if (e.key === '[') stampStore.set({ size: Math.max(1, Math.round(o.size / 1.25)) });
      else if (e.key === ']') stampStore.set({ size: Math.min(2000, Math.round(o.size * 1.25)) });
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', key, true); window.addEventListener('keyup', key, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true); };
  }, [active]);
  const image = (targetId: string | null) => {
    const selected = document.objects.filter(o => selectedIds.includes(o.id) && o.type === 'image');
    return selected.length === 1 ? selected[0] : document.objects.find(o => o.id === targetId && o.type === 'image');
  };
  function dab(s: Stroke, p: Point) {
    const o = stampStore.get(), base = s.base!, ctx = s.layer!.getContext('2d')!;
    const k = base.width / s.object.width / (Math.sqrt(Math.abs(matrixOf(s.object)[0] * matrixOf(s.object)[3] - matrixOf(s.object)[1] * matrixOf(s.object)[2])) || 1);
    const r = Math.max(0.5, o.size / 2 * k), size = Math.ceil(r * 2) + 2, c = size / 2;
    const tmp = window.document.createElement('canvas'); tmp.width = size; tmp.height = size;
    const t = tmp.getContext('2d')!;
    t.drawImage(base, p.x + s.offset.x - c, p.y + s.offset.y - c, size, size, 0, 0, size, size);
    t.globalCompositeOperation = 'destination-in';
    const g = t.createRadialGradient(c, c, 0, c, c, r), h = Math.min(0.99, o.hardness / 100);
    for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, `rgba(0,0,0,${brushFalloff(i / 12, h)})`);
    t.fillStyle = g; t.beginPath(); t.arc(c, c, r, 0, Math.PI * 2); t.fill();
    ctx.drawImage(tmp, p.x - c, p.y - c);
    return r;
  }
  function paint(s: Stroke, world: Point[]) {
    if (!s.base) { s.queue.push(...world); return; }
    for (const w of world) {
      const p = toPixel(s.object, s.base, w);
      if (!s.last) { const r = dab(s, p); s.last = p; s.remain = Math.max(0.5, r * 0.15); continue; }
      const dx = p.x - s.last.x, dy = p.y - s.last.y, len = Math.hypot(dx, dy);
      let d = s.remain, r = 1;
      while (d <= len) { r = dab(s, { x: s.last.x + dx * d / len, y: s.last.y + dy * d / len }); d += Math.max(0.5, r * 0.15); }
      s.remain = d - len; s.last = p;
    }
    schedule(s);
  }
  const compose = (s: Stroke) => {
    const out = window.document.createElement('canvas'); out.width = s.base!.width; out.height = s.base!.height;
    const ctx = out.getContext('2d')!; ctx.drawImage(s.base!, 0, 0); ctx.globalAlpha = stampStore.get().opacity / 100; ctx.drawImage(s.layer!, 0, 0);
    return out;
  };
  const imageElements = (id: string) => [...window.document.querySelectorAll(`.canvas-viewport [data-object-id="${CSS.escape(id)}"] image`)].filter(e => !e.closest('mask'));
  function schedule(s: Stroke) {
    if (s.frame !== null) return;
    s.frame = window.requestAnimationFrame(() => {
      s.frame = null;
      if (stroke.current !== s || s.encoding) return;
      s.encoding = true;
      compose(s).toBlob(blob => { s.encoding = false; if (stroke.current !== s || !blob) return; const url = URL.createObjectURL(blob); imageElements(s.object.id).forEach(e => e.setAttribute('href', url)); if (s.url) URL.revokeObjectURL(s.url); s.url = url; }, 'image/png');
    });
  }
  function down(p: Point, pointerId: number, targetId: string | null, alt: boolean): boolean {
    if (!active) return false;
    const o = image(targetId);
    if (!o) { setMessage('Carimbo: clique num bitmap (imagem). Alt+clique marca a origem.'); return false; }
    if (alt) {
      setView({ source: p, sourceOf: o.id, delta: null }); offset.current = null;
      setMessage('Origem do carimbo marcada. Agora pinte onde quer copiar (Alt+clique marca outra origem).'); return false;
    }
    if (!view.source || view.sourceOf !== o.id) { setMessage('Carimbo: primeiro segure Alt e clique na área que quer copiar (a origem).'); return false; }
    // Distância origem → destino em pixels do bitmap: fixa entre pinceladas (Alinhado) ou recomeça a cada uma.
    const mime = o.src!.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png';
    const s: Stroke = { pointerId, object: o, base: null, layer: null, offset: { x: 0, y: 0 }, last: null, remain: 0, queue: [p], frame: null, encoding: false, url: null, mime };
    stroke.current = s; beginEdit();
    // Marca da origem andando junto com o pincel (distância em coordenadas do documento).
    if (!stampStore.get().aligned || !view.delta) setView({ delta: { x: view.source.x - p.x, y: view.source.y - p.y } });
    setView({ painting: true });
    void loadImage(o.src!).then(img => {
      if (stroke.current !== s) return;
      const base = window.document.createElement('canvas'); base.width = img.naturalWidth; base.height = img.naturalHeight; base.getContext('2d')!.drawImage(img, 0, 0);
      const layer = window.document.createElement('canvas'); layer.width = base.width; layer.height = base.height;
      s.base = base; s.layer = layer;
      const src = toPixel(o, base, view.source!), dst = toPixel(o, base, p);
      if (!stampStore.get().aligned || !offset.current) offset.current = { x: src.x - dst.x, y: src.y - dst.y };
      s.offset = offset.current;
      const queued = s.queue; s.queue = []; paint(s, queued);
    }).catch(() => { setMessage('Não foi possível ler este bitmap.'); stroke.current = null; commitEdit(); });
    return true;
  }
  function move(p: Point, pointerId: number, points?: Point[]) {
    if (!active) return;
    setView({ hover: p });
    const s = stroke.current; if (s && s.pointerId === pointerId) paint(s, points?.length ? points : [p]);
  }
  function up(pointerId: number) {
    const s = stroke.current; if (!s || s.pointerId !== pointerId) return;
    stroke.current = null; setView({ painting: false });
    if (s.frame !== null) window.cancelAnimationFrame(s.frame);
    if (s.base && s.layer) {
      const src = compose(s).toDataURL(s.mime, 0.95);
      dispatch({ type: 'set-objects', objects: latest.current.map(o => o.id === s.object.id ? { ...o, src } : o) });
    }
    if (s.url) { const url = s.url; window.setTimeout(() => URL.revokeObjectURL(url), 2000); }
    commitEdit();
  }
  const element = active ? <StampCursor zoom={viewport.zoom} /> : null;
  return { active, down, move, up, isDragging: () => !!stroke.current, element, leave: () => setView({ hover: null }) };
}
function StampCursor({ zoom: z }: { zoom: number }) {
  const o = useStamp(), v = useSyncExternalStore(subscribeView, () => view);
  const r = o.size / 2;
  // Durante a pincelada, a marca da origem acompanha o pincel (como no Photoshop); parada, fica onde foi marcada.
  const src = v.painting && v.delta && v.hover ? { x: v.hover.x + v.delta.x, y: v.hover.y + v.delta.y } : v.source;
  return <g pointerEvents="none">
    {src && <g><circle cx={src.x} cy={src.y} r={r} fill="none" stroke="#fff" strokeWidth={3 / z} /><circle cx={src.x} cy={src.y} r={r} fill="none" stroke="#1e7cf2" strokeWidth={1 / z} strokeDasharray={`${4 / z} ${3 / z}`} /><path d={`M${src.x - 6 / z} ${src.y}h${12 / z}M${src.x} ${src.y - 6 / z}v${12 / z}`} stroke="#1e7cf2" strokeWidth={1.2 / z} /></g>}
    {v.hover && <g>
      <circle cx={v.hover.x} cy={v.hover.y} r={r} fill="none" stroke="#fff" strokeWidth={3 / z} />
      <circle cx={v.hover.x} cy={v.hover.y} r={r} fill="none" stroke={v.alt ? '#1e7cf2' : '#000'} strokeWidth={1 / z} />
      {v.alt ? <circle cx={v.hover.x} cy={v.hover.y} r={4 / z} fill="none" stroke="#1e7cf2" strokeWidth={1.5 / z} /> : <path d={`M${v.hover.x - 4 / z} ${v.hover.y}h${8 / z}M${v.hover.x} ${v.hover.y - 4 / z}v${8 / z}`} stroke="#000" strokeWidth={1 / z} />}
    </g>}
  </g>;
}
/** Barra de propriedades do Carimbo. */
export function CloneStampControls() {
  const o = useStamp(), { document } = useEditor(), unit = document.unit ?? 'px', short = unitDefinitions[unit].short;
  return <span className="tool-options mask-brush-options">
    <span className="muted">Alt+clique: origem</span>
    <label title="Tamanho do pincel ([ e ] mudam)">Tamanho<LevelSlider aria-label="Tamanho do carimbo" min={1} max={500} value={Math.min(500, o.size)} onChange={e => stampStore.set({ size: Number(e.target.value) })} /><input type="number" className="level-number" aria-label={`Tamanho do carimbo (${short})`} min={0} step="any" value={Math.round(toUnit(o.size, unit) * 100) / 100} onChange={e => { const v = fromUnit(Number(e.target.value), unit); if (Number.isFinite(v) && v >= 0.5 && v <= 2000) stampStore.set({ size: v }); }} /><span>{short}</span></label>
    <label title="Dureza: 100% = borda nítida; 0% = borda bem suave">Dureza<LevelSlider aria-label="Dureza do carimbo" value={o.hardness} onChange={e => stampStore.set({ hardness: Number(e.target.value) })} /><span>{o.hardness}%</span></label>
    <label title="Opacidade de cada pincelada">Opacidade<LevelSlider aria-label="Opacidade do carimbo" min={1} value={o.opacity} onChange={e => stampStore.set({ opacity: Number(e.target.value) })} /><span>{o.opacity}%</span></label>
    <label className="settings-check" title="Alinhado: a distância entre origem e pincel continua a mesma nas próximas pinceladas"><input type="checkbox" checked={o.aligned} onChange={e => stampStore.set({ aligned: e.target.checked })} />Alinhado</label>
  </span>;
}
