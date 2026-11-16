import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { activeCmyk, cmykToHex, hexToCmyk } from './palettes';
export type Cmyk = [number, number, number, number];

type Hsv = { h: number; s: number; v: number };
export type ColorModel = 'cmyk' | 'rgb' | 'hsb';
const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = (values: number[]) => '#' + values.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = channels(hex).map(v => v / 255), max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max ? d / max : 0, v: max };
}
export function hsvToHex({ h, s, v }: Hsv) {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return toHex([f(5), f(3), f(1)].map(x => x * 255));
}
/** Nome da cor como na barra de status do CorelDRAW. */
export const cmykLabel = (hex: string, exact?: [number, number, number, number]) => { const [c, m, y, k] = exact ?? hexToCmyk(hex); return `C:${c} M:${m} Y:${y} K:${k}`; };
const MODEL_KEY = 'vectorstudio.colorModel';
function storedModel(): ColorModel { try { const v = localStorage.getItem(MODEL_KEY); return v === 'rgb' || v === 'hsb' ? v : 'cmyk'; } catch { return 'cmyk'; } }

/** Seletor de cor do CorelDRAW: visualizador (saturação × brilho e faixa de matiz) e valores CMYK, RGB ou HSB. */
export function ColorPicker({ value, onChange, label = 'Cor', cmyk: exact }: { value: string; onChange: (hex: string, cmyk?: Cmyk) => void; label?: string; cmyk?: Cmyk }) {
  const [model, setModelState] = useState<ColorModel>(storedModel);
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value.toUpperCase());
  const square = useRef<HTMLDivElement>(null), strip = useRef<HTMLDivElement>(null), lastCmyk = useRef<Cmyk | null>(null);
  /** Avisa a cor; no modo CMYK, junto com os percentuais exatos. */
  const emit = (hex: string) => { const c = model === 'cmyk' && lastCmyk.current && cmykToHex(...lastCmyk.current) === hex ? lastCmyk.current : undefined; lastCmyk.current = null; onChange(hex, c); };
  // Mantém a matiz ao passar por cinzas (saturação ou brilho zero), como no CorelDRAW.
  useEffect(() => { setHexText(value.toUpperCase()); setHsv(h => { if (hsvToHex(h) === value.toLowerCase()) return h; const next = hexToHsv(value); return next.s === 0 || next.v === 0 ? { ...next, h: h.h } : next; }); }, [value]);
  const setModel = (m: ColorModel) => { setModelState(m); try { localStorage.setItem(MODEL_KEY, m); } catch { /* preferências indisponíveis */ } };
  const apply = (next: Hsv) => { setHsv(next); onChange(hsvToHex(next)); };
  function drag(event: ReactPointerEvent<HTMLDivElement>, target: 'square' | 'strip') {
    const element = (target === 'square' ? square : strip).current!;
    const move = (x: number, y: number) => {
      const r = element.getBoundingClientRect(), u = Math.max(0, Math.min(1, (x - r.left) / r.width)), w = Math.max(0, Math.min(1, (y - r.top) / r.height));
      setHsv(h => { const next = target === 'square' ? { ...h, s: u, v: 1 - w } : { ...h, h: w * 359.99 }; onChange(hsvToHex(next)); return next; });
    };
    element.setPointerCapture(event.pointerId); move(event.clientX, event.clientY);
    const onMove = (e: PointerEvent) => move(e.clientX, e.clientY), onUp = () => { element.removeEventListener('pointermove', onMove); element.removeEventListener('pointerup', onUp); };
    element.addEventListener('pointermove', onMove); element.addEventListener('pointerup', onUp);
  }
  // No modo CMYK valem os percentuais digitados (guardados no objeto); sem eles, a conversão aproximada do RGB.
  const rgb = channels(value), cmyk: Cmyk = activeCmyk(exact, value) ?? hexToCmyk(value);
  const fields: [string, number, number, (v: number) => string][] = model === 'cmyk'
    ? (['C', 'M', 'Y', 'K'] as const).map((name, i) => [name, cmyk[i], 100, v => { const next = [...cmyk] as Cmyk; next[i] = v; lastCmyk.current = next; return cmykToHex(next[0], next[1], next[2], next[3]); }])
    : model === 'rgb' ? (['R', 'G', 'B'] as const).map((name, i) => [name, rgb[i], 255, v => { const next = [...rgb]; next[i] = v; return toHex(next); }])
    : [['H', Math.round(hsv.h), 359, v => hsvToHex({ ...hsv, h: v })], ['S', Math.round(hsv.s * 100), 100, v => hsvToHex({ ...hsv, s: v / 100 })], ['B', Math.round(hsv.v * 100), 100, v => hsvToHex({ ...hsv, v: v / 100 })]];
  return <div className="color-picker" aria-label={label}>
    <div className="color-viewer">
      <div ref={square} className="color-square" style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,${hsvToHex({ h: hsv.h, s: 1, v: 1 })})` }} onPointerDown={e => drag(e, 'square')} role="slider" aria-label={`${label}: saturação e brilho`} aria-valuetext={`Saturação ${Math.round(hsv.s * 100)}%, brilho ${Math.round(hsv.v * 100)}%`} aria-valuenow={Math.round(hsv.s * 100)} tabIndex={0}
        onKeyDown={e => { const d = e.shiftKey ? 0.1 : 0.02, k = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[e.key]; if (k) { e.preventDefault(); apply({ ...hsv, s: Math.max(0, Math.min(1, hsv.s + k[0])), v: Math.max(0, Math.min(1, hsv.v + k[1])) }); } }}>
        <span className="color-square-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <div ref={strip} className="color-hue" onPointerDown={e => drag(e, 'strip')} role="slider" aria-label={`${label}: matiz`} aria-valuemin={0} aria-valuemax={359} aria-valuenow={Math.round(hsv.h)} tabIndex={0}
        onKeyDown={e => { const d = { ArrowUp: -5, ArrowDown: 5 }[e.key]; if (d) { e.preventDefault(); apply({ ...hsv, h: (hsv.h + d + 360) % 360 }); } }}>
        <span className="color-hue-thumb" style={{ top: `${hsv.h / 360 * 100}%` }} />
      </div>
    </div>
    <div className="color-values">
      <div className="color-models" role="radiogroup" aria-label="Modelo de cor">{(['cmyk', 'rgb', 'hsb'] as const).map(m => <button type="button" key={m} role="radio" aria-checked={model === m} className={model === m ? 'active' : ''} onClick={() => setModel(m)}>{m.toUpperCase()}</button>)}</div>
      {fields.map(([name, current, max, build]) => <label key={name} className="color-channel"><span>{name}</span><input type="range" min={0} max={max} value={current} aria-label={`${name} (${model.toUpperCase()})`} onChange={e => emit(build(Number(e.target.value)))} /><input type="number" min={0} max={max} value={current} aria-label={`${name} valor`} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) emit(build(Math.max(0, Math.min(max, v)))); }} /></label>)}
      <label className="color-channel color-hex"><span>Hex</span><input value={hexText} aria-label="Cor hexadecimal" spellCheck={false} maxLength={7} onChange={e => { const t = e.target.value.trim(); setHexText(t.toUpperCase()); const hex = (t.startsWith('#') ? t : '#' + t).toLowerCase(); if (/^#[0-9a-f]{6}$/.test(hex)) onChange(hex); }} /></label>
    </div>
  </div>;
}
