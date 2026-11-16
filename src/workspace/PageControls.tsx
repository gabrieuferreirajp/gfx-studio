import { RectangleHorizontal, RectangleVertical } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { fromUnit, toUnit, unitDefinitions, unitStep } from '../document/units';
import { NudgeField } from './NudgeField';

const mm = (v: number) => v * 96 / 25.4;
/** Tamanhos de página do CorelDRAW (em pé, em px do documento). */
export const pageSizes: [string, number, number][] = ([
  ['A0', 841, 1189], ['A1', 594, 841], ['A2', 420, 594], ['A3', 297, 420], ['A4', 210, 297], ['A5', 148, 210], ['A6', 105, 148], ['A7', 74, 105],
  ['B3', 353, 500], ['B4', 250, 353], ['B5', 176, 250], ['SRA3', 320, 450],
  ['Carta', 215.9, 279.4], ['Ofício', 215.9, 355.6], ['Ofício 2 (Brasil)', 216, 330], ['Tabloide', 279.4, 431.8], ['Executivo', 184.15, 266.7],
  ['Envelope DL', 110, 220], ['Envelope C5', 162, 229], ['Envelope C4', 229, 324],
  ['Cartão de visita', 50, 90], ['Cartão de visita (EUA)', 50.8, 88.9], ['Postal 10 × 15 cm', 100, 150], ['Foto 13 × 18 cm', 130, 180], ['Foto 20 × 25 cm', 203.2, 254],
] as [string, number, number][]).map(([name, w, h]) => [name, mm(w), mm(h)] as [string, number, number]);
/** Barra de propriedades sem seleção (CorelDRAW): tamanho da página e botões Retrato/Paisagem. */
export function PageControls() {
  const { document, dispatch, commitEdit } = useEditor();
  const { width, height } = document.artboard, unit = document.unit ?? 'px', landscape = width > height;
  const close = (a: number, b: number) => Math.abs(a - b) < 0.6;
  const preset = pageSizes.find(([, w, h]) => (close(w, width) && close(h, height)) || (close(h, width) && close(w, height)))?.[0] ?? '';
  const resize = (w: number, h: number) => { finishEditing(); commitEdit(); dispatch({ type: 'set-document', artboard: { width: Math.round(w * 100) / 100, height: Math.round(h * 100) / 100 } }); commitEdit(); };
  const orient = (wide: boolean) => { if (wide !== landscape && width !== height) resize(height, width); };
  const field = (label: string, value: number, apply: (v: number) => void) => <label className="number-field page-size-field" title={`${label} da página`}><span>{label[0]}</span><input type="number" aria-label={`${label} da página`} step={unitStep(unit)} min={0.01} value={Number(toUnit(value, unit).toPrecision(6))} onChange={e => { const v = fromUnit(Number(e.target.value), unit); if (Number.isFinite(v) && v >= 1 && v <= 10000) apply(v); }} /><span>{unitDefinitions[unit].short}</span></label>;
  return <span className="page-controls">
    <select aria-label="Tamanho da página" title="Tamanho da página" value={preset} onChange={e => { const size = pageSizes.find(([name]) => name === e.target.value); if (size) resize(landscape ? size[2] : size[1], landscape ? size[1] : size[2]); }}>
      {!preset && <option value="">Personalizado</option>}
      {pageSizes.map(([name]) => <option key={name} value={name}>{name}</option>)}
    </select>
    <span className="stacked-fields">{field('Largura', width, v => dispatch({ type: 'set-document', artboard: { width: v, height } }))}
    {field('Altura', height, v => dispatch({ type: 'set-document', artboard: { width, height: v } }))}</span>
    <button type="button" className={`command-icon ${!landscape ? 'active' : ''}`} aria-pressed={!landscape} aria-label="Página em pé (retrato)" title="Retrato" onClick={() => orient(false)}><RectangleVertical size={18} /></button>
    <button type="button" className={`command-icon ${landscape ? 'active' : ''}`} aria-pressed={landscape} aria-label="Página deitada (paisagem)" title="Paisagem" onClick={() => orient(true)}><RectangleHorizontal size={18} /></button>
    <span className="command-divider" />
    <NudgeField bar />
  </span>;
}
