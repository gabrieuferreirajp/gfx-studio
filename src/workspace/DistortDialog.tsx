import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { deformError, deformObjects, deformSources, distortLabels, distortPath, type DistortKind } from '../geometry/deform';
import { fromUnit, toUnit, unitDefinitions } from '../document/units';

/**
 * Distorção (CorelDRAW): Empurrar e puxar, Zíper e Torcer, em torno do centro da seleção.
 * "Aplicar" pode ser repetido (cada aplicação é uma etapa do Desfazer).
 */
export function DistortDialog() {
  const { document, selectedIds, dispatch, commitEdit, setMessage } = useEditor();
  const ref = useRef<HTMLDialogElement>(null), [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DistortKind>('pushPull'), [amplitude, setAmplitude] = useState(40), [zipper, setZipper] = useState({ amplitude: 3.7795, frequency: 8, smooth: false }), [angle, setAngle] = useState(90);
  const unit = document.unit ?? 'px', error = deformError(document.objects, selectedIds);
  useEffect(() => { const show = () => setOpen(true); window.addEventListener('vectorstudio:distort', show); return () => window.removeEventListener('vectorstudio:distort', show); }, []);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.show(); if (!open && d.open) d.close(); }, [open]);
  function apply() {
    finishEditing();
    const found = deformSources(document.objects, selectedIds);
    if (!found) { setMessage(error ?? 'Selecione um objeto.'); return; }
    const params = kind === 'pushPull' ? { kind, amplitude } : kind === 'twister' ? { kind, amplitude: 0, angle } : { kind, ...zipper };
    try {
      const next = deformObjects(document.objects, [...found.sources.keys()], found.sources, found.box, (c, b) => distortPath(c, b, params));
      commitEdit(); dispatch({ type: 'set-objects', objects: next }); commitEdit();
      setMessage(`${distortLabels[kind]} aplicado a ${found.sources.size} objeto(s). Ctrl+Z desfaz.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Não foi possível distorcer.'); }
  }
  return <dialog ref={ref} className="workspace-settings transform-window text-tool-window" aria-label="Distorção" onCancel={e => { e.preventDefault(); setOpen(false); }} onKeyDown={e => e.stopPropagation()}>
    <header className="transform-header"><h2>Distorção</h2><button type="button" className="dock-close" aria-label="Fechar Distorção" onClick={() => setOpen(false)}><X size={14} /></button></header>
    {open && <form onSubmit={e => { e.preventDefault(); apply(); }}>
      <div className="icon-group" role="radiogroup" aria-label="Tipo de distorção">{(Object.keys(distortLabels) as DistortKind[]).map(k => <button type="button" role="radio" key={k} aria-checked={kind === k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{distortLabels[k]}</button>)}</div>
      {kind === 'pushPull' && <><label className="settings-row">Amplitude<input type="number" min={-200} max={200} value={amplitude} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) setAmplitude(Math.max(-200, Math.min(200, v))); }} /><span>%</span></label>
        <p className="muted">Positiva empurra (lados para fora, como pétalas); negativa puxa (pontas para fora, como estrela).</p></>}
      {kind === 'zipper' && <>
        <label className="settings-row">Amplitude<input type="number" min={0} step="any" value={Math.round(toUnit(zipper.amplitude, unit) * 1000) / 1000} onChange={e => { const v = fromUnit(Number(e.target.value), unit); if (Number.isFinite(v) && v >= 0 && v <= 2000) setZipper({ ...zipper, amplitude: v }); }} /><span>{unitDefinitions[unit].short}</span></label>
        <label className="settings-row">Frequência<input type="number" min={1} max={100} value={zipper.frequency} onChange={e => { const v = Math.round(Number(e.target.value)); if (v >= 1 && v <= 100) setZipper({ ...zipper, frequency: v }); }} /><span>por lado</span></label>
        <label className="settings-check"><input type="checkbox" checked={zipper.smooth} onChange={e => setZipper({ ...zipper, smooth: e.target.checked })} />Distorção suave (ondas em vez de dentes)</label></>}
      {kind === 'twister' && <label className="settings-row">Ângulo na borda<input type="number" min={-3600} max={3600} value={angle} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && Math.abs(v) <= 3600) setAngle(v); }} /><span>°</span></label>}
      <p className="muted">{error ?? 'Retângulos e elipses viram curvas. O centro da distorção é o centro da seleção.'}</p>
      <footer><button type="button" onClick={() => setOpen(false)}>Fechar</button><button type="submit" className="primary" disabled={!!error}>Aplicar</button></footer>
    </form>}
  </dialog>;
}
