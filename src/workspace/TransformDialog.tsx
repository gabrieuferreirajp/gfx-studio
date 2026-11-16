import { useEffect, useMemo, useRef, useState } from 'react';
import { AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, Crosshair, AlignHorizontalDistributeStart, AlignHorizontalDistributeCenter, AlignHorizontalDistributeEnd, AlignHorizontalSpaceAround, AlignVerticalDistributeStart, AlignVerticalDistributeCenter, AlignVerticalDistributeEnd, AlignVerticalSpaceAround, FlipHorizontal2, FlipVertical2, X } from 'lucide-react';
import { useEditor, type ObjectCommand } from '../state/EditorContext';
import { boundsOf, distributionLabels, type Distribution } from '../geometry/objectTransforms';
import { anchorPoint, transformationMatrix, transformTabs, type Anchor, type TransformParams, type TransformTab } from '../geometry/transformations';
import { fromUnit, toUnit, unitDefinitions, unitStep } from '../document/units';
import { finishEditing } from '../state/useProjectFiles';

/** Abre a janela Transformações numa aba (menu Objeto, atalhos Alt+F7…Alt+F10 e Ctrl+Shift+A). */
export const openTransform = (tab: TransformTab) => window.dispatchEvent(new CustomEvent('vectorstudio:transform', { detail: tab }));
const alignButtons: [ObjectCommand, string, typeof Crosshair][] = [['left', 'Alinhar à esquerda (L)', AlignStartVertical], ['center', 'Centros verticalmente (C)', AlignCenterVertical], ['right', 'Alinhar à direita (R)', AlignEndVertical], ['top', 'Alinhar ao topo (T)', AlignStartHorizontal], ['middle', 'Centros horizontalmente (E)', AlignCenterHorizontal], ['bottom', 'Alinhar à base (B)', AlignEndHorizontal], ['page', 'Centralizar na página (P)', Crosshair]];
const distributeButtons: [Distribution, typeof Crosshair][] = [['distLeft', AlignHorizontalDistributeStart], ['distCenterX', AlignHorizontalDistributeCenter], ['distRight', AlignHorizontalDistributeEnd], ['distSpaceX', AlignHorizontalSpaceAround], ['distTop', AlignVerticalDistributeStart], ['distCenterY', AlignVerticalDistributeCenter], ['distBottom', AlignVerticalDistributeEnd], ['distSpaceY', AlignVerticalSpaceAround]];
const initial: TransformParams = { tab: 'position', x: 0, y: 0, relative: true, angle: 90, sx: 100, sy: 100, width: 0, height: 0, skewX: 0, skewY: 0, anchor: 4 };

/** Janela não modal (como a janela encaixada do CorelDRAW): continua aberta enquanto se seleciona no desenho. */
export function TransformDialog() {
  const { document, selectedIds, transformCommand, objectCommand } = useEditor();
  const ref = useRef<HTMLDialogElement>(null), [open, setOpen] = useState(false);
  const [p, setP] = useState<TransformParams>(initial), [copies, setCopies] = useState(0), [proportional, setProportional] = useState(true);
  const unit = document.unit ?? 'px', u = unitDefinitions[unit].short, step = unitStep(unit);
  const bounds = useMemo(() => { const sel = document.objects.filter(o => selectedIds.includes(o.id) && (!o.clipParent || !selectedIds.includes(o.clipParent))); return sel.length ? boundsOf(sel) : null; }, [document.objects, selectedIds]);
  useEffect(() => { const show = (e: Event) => { setP(s => ({ ...s, tab: (e as CustomEvent<TransformTab>).detail })); setOpen(true); }; window.addEventListener('vectorstudio:transform', show); return () => window.removeEventListener('vectorstudio:transform', show); }, []);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.show(); if (!open && d.open) d.close(); }, [open]);
  // Posição absoluta e Tamanho mostram os valores atuais da seleção (como o CorelDRAW).
  useEffect(() => { if (!bounds) return; const c = anchorPoint(bounds, p.anchor); setP(s => ({ ...s, ...(s.relative ? {} : { x: c.x, y: c.y }), width: bounds.width, height: bounds.height })); }, [bounds, p.anchor, p.relative]);
  const set = (patch: Partial<TransformParams>) => setP(s => ({ ...s, ...patch }));
  const length = (label: string, value: number, apply: (v: number) => void) => <label className="settings-row">{label}<input type="number" step={step} value={Number(toUnit(value, unit).toPrecision(7))} onChange={e => { const v = fromUnit(Number(e.target.value), unit); if (Number.isFinite(v)) apply(v); }} /><span>{u}</span></label>;
  const plain = (label: string, value: number, suffix: string, apply: (v: number) => void, stepValue = 1) => <label className="settings-row">{label}<input type="number" step={stepValue} value={value} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) apply(v); }} /><span>{suffix}</span></label>;
  const apply = () => { finishEditing(); transformCommand(b => transformationMatrix(p, b), copies); };
  const ratio = bounds && bounds.width > 0 ? bounds.height / bounds.width : 1;
  const transformTab = p.tab !== 'align';
  return <dialog ref={ref} className="workspace-settings transform-window" aria-label="Transformações" onCancel={e => { e.preventDefault(); setOpen(false); }}>
    <header className="transform-header"><h2>Transformações</h2><button type="button" className="dock-close" aria-label="Fechar Transformações" onClick={() => setOpen(false)}><X size={14} /></button></header>
    <div className="fill-tabs transform-tabs" role="tablist">{transformTabs.map(([id, label, key]) => <button type="button" role="tab" key={id} aria-selected={p.tab === id} className={p.tab === id ? 'active' : ''} title={key ? `${label} (${key})` : label} onClick={() => set({ tab: id })}>{label}</button>)}</div>
    {!bounds && <p className="muted">Selecione um ou mais objetos no desenho.</p>}
    {p.tab === 'position' && <>{length('X', p.x, x => set({ x }))}{length('Y', p.y, y => set({ y }))}<label className="settings-check"><input type="checkbox" checked={p.relative} onChange={e => set({ relative: e.target.checked, ...(e.target.checked ? { x: 0, y: 0 } : {}) })} />Posição relativa (deslocar)</label></>}
    {p.tab === 'rotate' && <>{plain('Ângulo', p.angle, '°', angle => set({ angle }))}<p className="muted">Positivo gira no sentido anti-horário, em torno do ponto de referência.</p></>}
    {p.tab === 'scale' && <>{plain('Horizontal', p.sx, '%', sx => set({ sx, ...(proportional ? { sy: Math.sign(p.sy || 1) * Math.abs(sx) } : {}) }))}{plain('Vertical', p.sy, '%', sy => set({ sy, ...(proportional ? { sx: Math.sign(p.sx || 1) * Math.abs(sy) } : {}) }))}
      <div className="transform-row"><label className="settings-check"><input type="checkbox" checked={proportional} onChange={e => setProportional(e.target.checked)} />Proporcional</label>
        <button type="button" className="command-icon" aria-pressed={p.sx < 0} title="Espelhar horizontalmente" aria-label="Espelhar horizontalmente" onClick={() => set({ sx: -p.sx })}><FlipHorizontal2 size={17} /></button>
        <button type="button" className="command-icon" aria-pressed={p.sy < 0} title="Espelhar verticalmente" aria-label="Espelhar verticalmente" onClick={() => set({ sy: -p.sy })}><FlipVertical2 size={17} /></button></div></>}
    {p.tab === 'size' && <>{length('Largura', p.width, width => set({ width, ...(proportional ? { height: width * ratio } : {}) }))}{length('Altura', p.height, height => set({ height, ...(proportional && ratio ? { width: height / ratio } : {}) }))}<label className="settings-check"><input type="checkbox" checked={proportional} onChange={e => setProportional(e.target.checked)} />Proporcional</label></>}
    {p.tab === 'skew' && <>{plain('Horizontal', p.skewX, '°', skewX => set({ skewX }))}{plain('Vertical', p.skewY, '°', skewY => set({ skewY }))}<p className="muted">Entre −88° e 88°.</p></>}
    {transformTab && <>
      <div className="transform-row"><span>Ponto de referência</span><div className="anchor-grid" role="radiogroup" aria-label="Ponto de referência">{Array.from({ length: 9 }, (_, i) => <button type="button" key={i} role="radio" aria-checked={p.anchor === i} aria-label={['Superior esquerdo', 'Superior centro', 'Superior direito', 'Centro esquerdo', 'Centro', 'Centro direito', 'Inferior esquerdo', 'Inferior centro', 'Inferior direito'][i]} className={p.anchor === i ? 'active' : ''} onClick={() => set({ anchor: i as Anchor })} />)}</div></div>
      {plain('Cópias', copies, '', v => setCopies(Math.max(0, Math.min(500, Math.round(v)))))}
      <footer><button type="button" onClick={() => setOpen(false)}>Fechar</button><button type="button" className="primary" disabled={!bounds} onClick={apply}>Aplicar</button></footer></>}
    {p.tab === 'align' && <>
      <h3>Alinhar</h3><div className="icon-group">{alignButtons.map(([command, label, Icon]) => <button type="button" key={command} title={label} aria-label={label} disabled={!bounds} onClick={() => { finishEditing(); objectCommand(command); }}><Icon size={18} /></button>)}</div>
      <h3>Distribuir (3 ou mais objetos)</h3><div className="icon-group">{distributeButtons.map(([command, Icon]) => <button type="button" key={command} title={distributionLabels[command]} aria-label={distributionLabels[command]} disabled={!bounds} onClick={() => { finishEditing(); objectCommand(command); }}><Icon size={18} /></button>)}</div>
      <p className="muted">O último objeto selecionado fica parado ao alinhar; um objeto sozinho alinha à página. Ao distribuir, os objetos das pontas ficam parados.</p>
      <footer><button type="button" onClick={() => setOpen(false)}>Fechar</button></footer></>}
  </dialog>;
}
