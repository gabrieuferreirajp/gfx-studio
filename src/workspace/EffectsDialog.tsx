import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/EditorContext';
import { fromUnit, toUnit, unitDefinitions, unitStep } from '../document/units';

/** Efeitos com janela (Misturar e Extrusão). Sombra, Contorno e Bloquear sombra são ferramentas de arrastar. */
export type DialogEffect = 'blend' | 'extrude';
export const effectLabels: Record<DialogEffect, string> = { blend: 'Misturar', extrude: 'Extrusão' };
const effectHints: Record<DialogEffect, string> = {
  blend: 'Selecione dois objetos (Shift + clique): cria as etapas intermediárias de forma e cor.',
  extrude: 'Profundidade sólida em um tom mais escuro da cor do objeto, atrás dele.',
};
/** Abre a janela de um efeito a partir da caixa de ferramentas, do menu ou do botão direito. */
export const openEffect = (kind: DialogEffect) => window.dispatchEvent(new CustomEvent('vectorstudio:effect', { detail: kind }));
export function EffectsDialog() {
  const { document, selectedIds, effectCommand, booleanBusy } = useEditor();
  const ref = useRef<HTMLDialogElement>(null), [kind, setKind] = useState<DialogEffect | null>(null);
  const unit = document.unit ?? 'px', u = unitDefinitions[unit].short;
  const [blendSteps, setBlendSteps] = useState(10);
  const [sweep, setSweep] = useState({ angle: 135, length: 60, shade: 0.35 });
  useEffect(() => { const open = (e: Event) => { setKind((e as CustomEvent<DialogEffect>).detail); if (!ref.current?.open) ref.current?.show(); }; window.addEventListener('vectorstudio:effect', open); return () => window.removeEventListener('vectorstudio:effect', open); }, []);
  const apply = () => {
    if (!kind) return;
    const radians = sweep.angle * Math.PI / 180;
    void effectCommand(kind === 'blend' ? { kind, steps: blendSteps } : { kind, params: { mode: 'extrude', dx: Math.cos(radians) * sweep.length, dy: Math.sin(radians) * sweep.length, color: '#000000', shade: sweep.shade } });
  };
  return <dialog ref={ref} className="workspace-settings effects-dialog" onClose={() => setKind(null)}>
    {kind && <form method="dialog" onSubmit={e => { e.preventDefault(); apply(); }}>
      <h2>{effectLabels[kind]}</h2><p>{effectHints[kind]}</p>
      {kind === 'blend' && <label className="settings-row">Etapas<input type="number" min="1" max="200" value={blendSteps} onChange={e => setBlendSteps(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} /></label>}
      {kind === 'extrude' && <>
        <label className="settings-row">Ângulo<input type="number" min="-360" max="360" value={sweep.angle} onChange={e => setSweep({ ...sweep, angle: Number(e.target.value) || 0 })} /><span>°</span></label>
        <label className="settings-row">Profundidade<input type="number" step={unitStep(unit)} min={0} value={Number(toUnit(sweep.length, unit).toPrecision(6))} onChange={e => { const v = fromUnit(Number(e.target.value), unit); if (Number.isFinite(v)) setSweep({ ...sweep, length: Math.max(1, v) }); }} /><span>{u}</span></label>
        <label className="settings-row">Sombreamento<input type="range" min="0" max="90" value={Math.round(sweep.shade * 100)} onChange={e => setSweep({ ...sweep, shade: Number(e.target.value) / 100 })} /><span>{Math.round(sweep.shade * 100)}%</span></label></>}
      <footer>
        <button type="button" onClick={() => ref.current?.close()}>Fechar</button>
        <button type="submit" className="primary" disabled={booleanBusy || !selectedIds.length}>Aplicar</button>
      </footer>
    </form>}
  </dialog>;
}
