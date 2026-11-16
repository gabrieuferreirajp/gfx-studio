import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { useDialogDrag } from './useDialogDrag';
import { booleanLabels, booleanSelectionError, type BooleanOperation } from '../geometry/booleanSelection';
import { BooleanIcon } from '../components/BooleanIcon';
import { translate } from '../geometry/objectTransforms';
import { fromUnit, toUnit, unitDefinitions, unitStep } from '../document/units';

export type ShapingWindow = 'shaping' | 'stepRepeat';
export const openShapingWindow = (which: ShapingWindow) => window.dispatchEvent(new CustomEvent('vectorstudio:shaping-window', { detail: which }));

/** Janela flutuante e arrastável (não bloqueia o desenho), como as janelas encaixáveis do CorelDRAW. */
function Floating({ title, close, children, className }: { title: string; close: () => void; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null), move = useDialogDrag();
  useEffect(() => { ref.current?.show(); }, []);
  return <dialog ref={ref} className={`workspace-settings floating-window ${className ?? ''}`} aria-label={title} style={move.style} onCancel={e => { e.preventDefault(); close(); }} onKeyDown={e => e.stopPropagation()}>
    <header {...move.handle}><h2>{title}</h2><button type="button" className="command-icon" aria-label="Fechar" title="Fechar" onClick={close}><X size={15} /></button></header>
    {children}
  </dialog>;
}
/** Moldar (Objeto › Moldar › Janela Moldar): operação, manter originais e Aplicar. */
function ShapingWindowView({ close }: { close: () => void }) {
  const { document, selectedIds, booleanCommand, booleanBusy } = useEditor();
  const [operation, setOperation] = useState<BooleanOperation>('union'), [source, setSource] = useState(false), [target, setTarget] = useState(false);
  const error = booleanSelectionError(document.objects, selectedIds);
  return <Floating title="Moldar" close={close} className="shaping-window">
    <div className="floating-body">
      <div className="shaping-ops" role="radiogroup" aria-label="Operação">{(Object.keys(booleanLabels) as BooleanOperation[]).map(op => <button key={op} type="button" role="radio" aria-checked={operation === op} className={`command-icon ${operation === op ? 'active' : ''}`} title={booleanLabels[op]} aria-label={booleanLabels[op]} onClick={() => setOperation(op)}><BooleanIcon operation={op} /></button>)}</div>
      <strong className="shaping-name">{booleanLabels[operation]}</strong>
      {operation !== 'boundary' && <>
        <span className="muted">Deixar original:</span>
        <label className="settings-check"><input type="checkbox" checked={source} onChange={e => setSource(e.target.checked)} />Objetos de origem (os de cima)</label>
        <label className="settings-check"><input type="checkbox" checked={target} onChange={e => setTarget(e.target.checked)} />Objeto de destino (o de baixo)</label>
      </>}
      <button type="button" className="primary" disabled={!!error || booleanBusy} title={error ?? ''} onClick={() => { finishEditing(); void booleanCommand(operation, { source, target }); }}>{booleanLabels[operation]}</button>
      {error && <span className="muted">{error}</span>}
    </div>
  </Floating>;
}
/** Etapa e repetição (Ctrl+Shift+D): N cópias com deslocamento ou espaço entre objetos, na horizontal e na vertical. */
function StepRepeatView({ close }: { close: () => void }) {
  const { document, selectedIds, transformCommand, setMessage } = useEditor();
  const unit = document.unit ?? 'px', short = unitDefinitions[unit].short;
  const [copies, setCopies] = useState(3);
  const [h, setH] = useState({ mode: 'spacing' as 'none' | 'offset' | 'spacing', value: 5 / 0.2645833, dir: 1 });
  const [v, setV] = useState({ mode: 'none' as 'none' | 'offset' | 'spacing', value: 0, dir: 1 });
  const axis = (label: string, state: typeof h, set: (s: typeof h) => void, dirs: [string, string]) => <fieldset className="step-axis">
    <legend>{label}</legend>
    <select value={state.mode} onChange={e => set({ ...state, mode: e.target.value as typeof h.mode })} aria-label={`${label}: modo`}><option value="none">Sem deslocamento</option><option value="offset">Deslocamento</option><option value="spacing">Espaço entre objetos</option></select>
    <label>Distância<input type="number" step={unitStep(unit)} disabled={state.mode === 'none'} value={Number(toUnit(state.value, unit).toPrecision(6))} onChange={e => { const n = fromUnit(Number(e.target.value), unit); if (Number.isFinite(n)) set({ ...state, value: n }); }} />{short}</label>
    <label>Direção<select disabled={state.mode !== 'spacing'} value={state.dir} onChange={e => set({ ...state, dir: Number(e.target.value) })}><option value={1}>{dirs[0]}</option><option value={-1}>{dirs[1]}</option></select></label>
  </fieldset>;
  function apply() {
    if (!selectedIds.length) { setMessage('Etapa e repetição: selecione o objeto a copiar.'); return; }
    finishEditing();
    transformCommand(b => {
      const dx = h.mode === 'none' ? 0 : h.mode === 'offset' ? h.value : h.dir * (b.width + h.value);
      const dy = v.mode === 'none' ? 0 : v.mode === 'offset' ? v.value : v.dir * (b.height + v.value);
      return dx || dy ? translate(dx, dy) : null;
    }, copies);
    setMessage(`Etapa e repetição: ${copies} cópia(s) criadas. Ctrl+Z desfaz.`);
  }
  return <Floating title="Etapa e repetição" close={close} className="step-window">
    <div className="floating-body">
      {axis('Configurações horizontais', h, setH, ['À direita', 'À esquerda'])}
      {axis('Configurações verticais', v, setV, ['Abaixo', 'Acima'])}
      <label className="settings-row">Número de cópias<input type="number" min={1} max={500} value={copies} onChange={e => { const n = Math.round(Number(e.target.value)); if (n >= 1 && n <= 500) setCopies(n); }} /></label>
      <button type="button" className="primary" disabled={!selectedIds.length} onClick={apply}>Aplicar</button>
    </div>
  </Floating>;
}
export function ShapingDialogs() {
  const [open, setOpen] = useState<ShapingWindow | null>(null);
  useEffect(() => { const show = (e: Event) => setOpen((e as CustomEvent<ShapingWindow>).detail); window.addEventListener('vectorstudio:shaping-window', show); return () => window.removeEventListener('vectorstudio:shaping-window', show); }, []);
  return open === 'shaping' ? <ShapingWindowView close={() => setOpen(null)} /> : open === 'stepRepeat' ? <StepRepeatView close={() => setOpen(null)} /> : null;
}
