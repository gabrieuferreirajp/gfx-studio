import { PenTool } from 'lucide-react';
import { PenIcon } from '../workspace/OutlineDialog';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { MM_PER_PX } from '../document/units';
import type { VectorObject } from '../document/model';
// Larguras de contorno da barra de propriedades do CorelDRAW (milímetros).
export const outlinePresets: [string, number][] = [['Fio de cabelo', 0.076], ['0,1 mm', 0.1], ['0,2 mm', 0.2], ['0,25 mm', 0.25], ['0,5 mm', 0.5], ['0,75 mm', 0.75], ['1,0 mm', 1], ['1,5 mm', 1.5], ['2,0 mm', 2], ['2,5 mm', 2.5], ['3,0 mm', 3], ['5,0 mm', 5], ['8,0 mm', 8], ['10,0 mm', 10]];
const mm = (px: number) => Number((px * MM_PER_PX).toFixed(3));
/** Cantos e extremidades do contorno da seleção (barra de propriedades, como no CorelDRAW). */
export function StrokeCorners() {
  const { document, selectedIds, dispatch, commitEdit } = useEditor();
  const targets = document.objects.filter(o => selectedIds.includes(o.id) && o.type !== 'image' && o.stroke && o.stroke !== 'none');
  if (!targets.length) return null;
  const join = targets[0].strokeJoin ?? 'miter', cap = targets[0].strokeCap ?? 'butt';
  const set = (patch: Partial<Pick<VectorObject, 'strokeJoin' | 'strokeCap'>>) => {
    finishEditing(); commitEdit();
    dispatch({ type: 'set-objects', objects: document.objects.map(o => { if (!targets.some(t => t.id === o.id)) return o; const next = { ...o, ...patch }; if (next.strokeJoin === 'miter') delete next.strokeJoin; if (next.strokeCap === 'butt') delete next.strokeCap; return next; }) });
    commitEdit();
  };
  // Um botão só (ícone do canto atual ▾) abre a lista de cantos e extremidades, para a barra não ficar carregada.
  const joins: [NonNullable<VectorObject['strokeJoin']>, string][] = [['miter', 'Cantos retos (esquadria)'], ['round', 'Cantos arredondados'], ['bevel', 'Cantos chanfrados']];
  const caps: [NonNullable<VectorObject['strokeCap']>, string][] = [['butt', 'Extremidades retas'], ['round', 'Extremidades arredondadas'], ['square', 'Extremidades quadradas estendidas']];
  const label = `${joins.find(j => j[0] === join)![1]} · ${caps.find(c => c[0] === cap)![1]}`;
  return <button type="button" className="command-icon stroke-corners-menu" aria-haspopup="menu" aria-label={`Cantos e extremidades do contorno: ${label}`} title={`Cantos e extremidades do contorno: ${label}`} onClick={e => {
    const r = e.currentTarget.getBoundingClientRect();
    window.dispatchEvent(new CustomEvent('vectorstudio:context-menu', { detail: { x: r.left, y: r.bottom + 2, items: [
      ...joins.map(([value, text]) => ({ label: text, checked: join === value, run: () => set({ strokeJoin: value }) })),
      { label: '', separator: true },
      ...caps.map(([value, text]) => ({ label: text, checked: cap === value, run: () => set({ strokeCap: value }) })),
    ] } }));
  }}><PenIcon kind={join} /><span className="menu-caret" aria-hidden="true">▾</span></button>;
}
/** Espessura do contorno dos objetos selecionados ou, sem seleção, dos próximos objetos. */
export function OutlineWidth({ label = true }: { label?: boolean }) {
  const { document, selectedIds, dispatch, commitEdit, outline, setOutline, outlineWidth, setOutlineWidth, setMessage } = useEditor();
  const targets = document.objects.filter(o => selectedIds.includes(o.id) && o.type !== 'image' && (!o.clipParent || !selectedIds.includes(o.clipParent)));
  const current = targets.length ? (targets[0].stroke && targets[0].stroke !== 'none' ? targets[0].strokeWidth ?? 0 : 0) : outline === 'none' ? 0 : outlineWidth;
  function apply(valueMm: number) {
    if (!Number.isFinite(valueMm) || valueMm < 0 || valueMm > 264) return;
    const px = valueMm / MM_PER_PX;
    finishEditing();
    if (!targets.length) { if (px === 0) setOutline('none'); else { setOutlineWidth(px); if (outline === 'none') setOutline('#000000'); } setMessage(`Contorno padrão para novos objetos: ${valueMm ? valueMm + ' mm' : 'nenhum'}.`); return; }
    commitEdit();
    dispatch({ type: 'set-objects', objects: document.objects.map(o => !targets.some(t => t.id === o.id) ? o : px === 0 ? { ...o, stroke: 'none', strokeWidth: 0 } : { ...o, strokeWidth: px, stroke: o.stroke && o.stroke !== 'none' ? o.stroke : outline === 'none' ? '#000000' : outline }) });
    commitEdit();
  }
  const value = mm(current), preset = outlinePresets.find(([, v]) => Math.abs(v - value) < 0.0005);
  return <span className="outline-width" title="Largura do contorno">
    {label && <span className="outline-width-label" aria-hidden="true"><PenTool size={15} /></span>}
    <select aria-label="Largura do contorno (predefinições)" value={current === 0 ? 'none' : preset ? String(preset[1]) : 'custom'} onChange={e => { if (e.target.value !== 'custom') apply(e.target.value === 'none' ? 0 : Number(e.target.value)); }}>
      <option value="none">Nenhum</option>{outlinePresets.map(([name, v]) => <option key={v} value={v}>{name}</option>)}{!preset && current > 0 && <option value="custom">{value} mm</option>}
    </select>
    <input type="number" aria-label="Largura do contorno em milímetros" min="0" max="264" step="0.05" key={value} defaultValue={value} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={e => { const v = Number(e.target.value); if (v !== value) apply(v); }} /><span className="font-size-unit">mm</span>
  </span>;
}
