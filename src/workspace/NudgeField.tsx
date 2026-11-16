import { Move } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { fromUnit, toUnit, unitDefinitions, unitStep } from '../document/units';
import { useWorkspace } from './WorkspaceContext';

export const nudgeLabels = { nudge: ['Deslocamento', 'Distância das setas do teclado'], superNudge: ['Superdeslocamento', 'Distância com Shift + seta'], microNudge: ['Microdeslocamento', 'Distância com Ctrl + seta'] } as const;
export type NudgeKind = keyof typeof nudgeLabels;
/** Distância das setas do teclado (CorelDRAW: Deslocamento, Superdeslocamento e Microdeslocamento), na unidade do documento. */
export function NudgeField({ kind = 'nudge', bar = false }: { kind?: NudgeKind; bar?: boolean }) {
  const { document } = useEditor(), { layout, setLayout } = useWorkspace();
  const unit = document.unit ?? 'px', [label, hint] = nudgeLabels[kind], value = Number(toUnit(layout[kind], unit).toPrecision(6));
  // Campo não controlado: valores intermediários ("0", "0,") podem ser digitados; vale ao sair, Enter ou setas do campo.
  const commit = (text: string) => { const px = fromUnit(Number(text.replace(',', '.')), unit); if (Number.isFinite(px) && px > 0 && px <= 5000) setLayout(s => ({ ...s, [kind]: px })); };
  const step = unit === 'mm' ? 0.1 : unitStep(unit);
  const input = <input type="number" min={unitStep(unit)} step={step} key={`${value}-${unit}`} defaultValue={value} aria-label={`${label} (${unitDefinitions[unit].short})`} onBlur={e => commit(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); e.currentTarget.blur(); } }} onChange={e => { if (!(e.nativeEvent as InputEvent).inputType) commit(e.target.value); }} />;
  // Distâncias rápidas, como a lista do CorelDRAW (0,1 mm para ajustes finos).
  const presets = [0.1, 0.5, 1, 2.54, 5, 10].map(mm => fromUnit(mm, 'mm'));
  const quick = <select className="nudge-presets" aria-label={`${label}: distâncias rápidas`} title="Distâncias rápidas" value="" onChange={e => { if (e.target.value) setLayout(s => ({ ...s, [kind]: Number(e.target.value) })); }}><option value="">▾</option>{presets.map(px => <option key={px} value={px}>{Number(toUnit(px, unit).toPrecision(4)).toLocaleString('pt-BR')} {unitDefinitions[unit].short}</option>)}</select>;
  if (bar) return <label className="number-field nudge-field" title={`${label}: ${hint}`}><Move size={14} aria-hidden="true" />{input}<span>{unitDefinitions[unit].short}</span>{quick}</label>;
  return <label className="settings-row">{label}<span className="unit-input" title={hint}>{input}{unitDefinitions[unit].short}{quick}</span></label>;
}
