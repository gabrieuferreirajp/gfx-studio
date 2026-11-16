import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/EditorContext';
import { documentUnits, fromUnit, toUnit, unitDefinitions, unitStep, type DocumentUnit } from '../document/units';
// Tamanhos de página comuns (mm), como no CorelDRAW.
import { pageSizes } from './PageControls';
const pages: [string, number, number][] = pageSizes.map(([name, w, h]) => [name, w * 25.4 / 96, h * 25.4 / 96]);
/** Propriedades do documento: nome, unidade e tamanho da página. */
export function DocumentDialog({ close }: { close: () => void }) {
  const { document, dispatch, commitEdit, fitToScreen } = useEditor(), ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(document.name), [unit, setUnit] = useState<DocumentUnit>(document.unit ?? 'px');
  const [size, setSize] = useState(document.artboard);
  useEffect(() => { ref.current?.showModal(); }, []);
  const field = (key: 'width' | 'height', label: string) => <label className="settings-row">{label}<input type="number" min={toUnit(1, unit)} max={toUnit(10000, unit)} step={unitStep(unit)} value={Number(toUnit(size[key], unit).toPrecision(6))} onChange={e => { const v = fromUnit(Number(e.target.value), unit); if (Number.isFinite(v) && v > 0) setSize({ ...size, [key]: Math.min(10000, v) }); }} /><span>{unitDefinitions[unit].short}</span></label>;
  return <dialog ref={ref} className="workspace-settings" onCancel={close} onClose={close}><form method="dialog" onSubmit={e => { e.preventDefault(); commitEdit(); dispatch({ type: 'set-document', name, artboard: size }); if (unit !== (document.unit ?? 'px')) dispatch({ type: 'set-unit', unit }); commitEdit(); fitToScreen(); close(); }}>
    <h2>Propriedades do documento</h2>
    <label className="settings-row">Nome<input value={name} maxLength={256} onChange={e => setName(e.target.value)} /></label>
    <label className="settings-row">Unidade<select value={unit} onChange={e => setUnit(e.target.value as DocumentUnit)}>{documentUnits.map(u => <option key={u} value={u}>{unitDefinitions[u].label}</option>)}</select></label>
    <label className="settings-row">Página<select value="" onChange={e => { const page = pages.find(p => p[0] === e.target.value.replace(/ .*/, '')); if (!page) return; const [w, h] = [page[1], page[2]].map(v => fromUnit(v, 'mm')); setSize(e.target.value.endsWith('paisagem') ? { width: h, height: w } : { width: w, height: h }); }}><option value="">Personalizado</option>{pages.flatMap(([p, w, h]) => [<option key={p} value={`${p} retrato`}>{p} retrato ({w} × {h} mm)</option>, <option key={`${p}l`} value={`${p} paisagem`}>{p} paisagem</option>])}</select></label>
    {field('width', 'Largura')}{field('height', 'Altura')}
    <footer><button type="button" onClick={close}>Cancelar</button><button type="submit" className="primary">OK</button></footer>
  </form></dialog>;
}
