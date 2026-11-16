import { useSyncExternalStore } from 'react';
import { useEditor } from '../state/EditorContext';
import { fromUnit, toUnit, unitDefinitions } from '../document/units';

/**
 * Preenchimento inteligente (CorelDRAW): clicar numa área fechada pelas formas cria um objeto novo com o
 * formato daquela área, por cima, sem alterar as formas originais. Opções de preenchimento e contorno na barra.
 */
type Mode = 'default' | 'specify' | 'none';
export interface SmartFillOptions { fillMode: Mode; fillColor: string; outlineMode: Mode; outlineColor: string; outlineWidth: number }
let options: SmartFillOptions = { fillMode: 'specify', fillColor: '#d9d9d9', outlineMode: 'none', outlineColor: '#000000', outlineWidth: 0.7559 };
const listeners = new Set<() => void>();
const store = {
  get: () => options,
  set: (patch: Partial<SmartFillOptions>) => { options = { ...options, ...patch }; listeners.forEach(l => l()); },
  subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
};
const useOptions = () => useSyncExternalStore(store.subscribe, store.get);
/** Cores e caneta do objeto criado: "Padrão" usa os atributos padrão dos objetos novos. */
export function smartFillStyle(defaults: { fill: string; outline: string; outlineWidth: number }) {
  const o = store.get();
  const fill = o.fillMode === 'none' ? 'none' : o.fillMode === 'default' ? defaults.fill : o.fillColor;
  const stroke = o.outlineMode === 'none' ? 'none' : o.outlineMode === 'default' ? defaults.outline : o.outlineColor;
  const strokeWidth = o.outlineMode === 'specify' ? o.outlineWidth : defaults.outlineWidth;
  return { fill, stroke, strokeWidth };
}
const modes: [Mode, string][] = [['default', 'Usar padrão'], ['specify', 'Especificar'], ['none', 'Nenhum']];
export function SmartFillControls() {
  const o = useOptions(), { document, fill, outline } = useEditor(), unit = document.unit ?? 'px';
  return <span className="tool-options">
    <label>Preenchimento<select aria-label="Opções de preenchimento" value={o.fillMode} onChange={e => store.set({ fillMode: e.target.value as Mode })}>{modes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    {o.fillMode === 'specify' && <input type="color" aria-label="Cor do preenchimento" value={o.fillColor} onChange={e => store.set({ fillColor: e.target.value })} />}
    {o.fillMode === 'default' && fill === 'none' && <span className="context-page" title="O preenchimento padrão dos objetos novos é nenhum">padrão: sem preenchimento</span>}
    <label>Contorno<select aria-label="Opções de contorno" value={o.outlineMode} onChange={e => store.set({ outlineMode: e.target.value as Mode })}>{modes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    {o.outlineMode === 'specify' && <>
      <input type="number" aria-label={`Espessura do contorno (${unitDefinitions[unit].short})`} min={0} step="any" value={Math.round(toUnit(o.outlineWidth, unit) * 1000) / 1000} onChange={e => { const v = fromUnit(Number(e.target.value), unit); if (Number.isFinite(v) && v >= 0 && v <= 500) store.set({ outlineWidth: v }); }} /><span>{unitDefinitions[unit].short}</span>
      <input type="color" aria-label="Cor do contorno" value={o.outlineColor} onChange={e => store.set({ outlineColor: e.target.value })} /></>}
    {o.outlineMode === 'default' && <span className="context-page">padrão: {outline === 'none' ? 'sem contorno' : outline}</span>}
  </span>;
}
