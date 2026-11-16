import { LevelSlider } from './LevelSlider';
import { useRef, useState } from 'react';
import { FlipHorizontal2, FlipVertical2 } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { applyMatrix, around, boundsOf, clipContents, corelAngle, matrixOf, rotation, transformPoint } from '../geometry/objectTransforms';
import { defaultGradient, hasTransparency, opacityFromTransparency, setTransparency, transparencyOf, type BlendMode } from '../document/transparency';
import { BlendModeMenu } from './BlendModeMenu';
import { finishEditing } from '../state/useProjectFiles';

/** Ferramenta Transparência (CorelDRAW): tipo, % de transparência e modo de mesclagem dos objetos selecionados. */
export function TransparencyControls({ compact = false }: { compact?: boolean }) {
  const { document, selectedIds, dispatch, beginEdit, commitEdit } = useEditor();
  // Um quadro PowerClip leva o conteúdo junto: só os objetos de topo recebem a transparência.
  const ids = selectedIds.filter(id => { const o = document.objects.find(x => x.id === id); return !!o && (!o.clipParent || !selectedIds.includes(o.clipParent)); });
  const selected = document.objects.filter(o => ids.includes(o.id));
  if (!selected.length) return compact ? <span className="context-page">Clique em um objeto para aplicar transparência</span> : null;
  const first = selected[0], active = selected.some(hasTransparency), percent = transparencyOf(first), mode: BlendMode = first.blendMode ?? 'normal';
  const apply = (value: Parameters<typeof setTransparency>[2]) => dispatch({ type: 'set-objects', objects: setTransparency(document.objects, ids, value) });
  const once = (value: Parameters<typeof setTransparency>[2]) => { finishEditing(); commitEdit(); apply(value); commitEdit(); };
  const percentInput = (value: number) => { if (Number.isFinite(value)) apply({ opacity: opacityFromTransparency(Math.max(0, Math.min(100, value))) }); };
  const gradient = first.transparencyGradient, type = gradient ? gradient.type : active ? 'uniform' : 'none';
  // Degradê: % de transparência no início e no fim (as alças no objeto ajustam a posição).
  const stop = (key: 'from' | 'to', value: number) => { if (gradient && Number.isFinite(value)) apply({ gradient: { ...gradient, [key]: Math.max(0, Math.min(100, value)) } }); };
  const chooseType = (value: string) => once(value === 'none' ? null : value === 'uniform' ? { opacity: first.opacity !== undefined && first.opacity < 1 ? first.opacity : 0.5, gradient: null } : { gradient: gradient?.type === value ? gradient : defaultGradient(value as 'linear' | 'radial') });
  return <div className={`transparency-controls ${compact ? 'compact' : ''}`}>
    <label>{compact ? '' : 'Tipo '}<select aria-label="Tipo de transparência" title="Tipo de transparência · com a ferramenta Transparência, arraste sobre o objeto para criar um degradê" value={type} onChange={e => chooseType(e.target.value)}>
      <option value="none">Sem transparência</option><option value="uniform">Transparência uniforme</option><option value="linear">Degradê linear</option><option value="radial">Degradê elíptico</option>
      {['Padrão vetorial', 'Textura'].map(t => <option key={t} disabled>{t} — não disponível</option>)}
    </select></label>
    <label>{compact ? '' : 'Mesclagem '}<BlendModeMenu ids={ids} mode={mode} /></label>
    {gradient ? <>
      <label className="transparency-amount" title="Transparência no ponto inicial do degradê">Início<input type="number" min="0" max="100" step="1" aria-label="Transparência no início do degradê (%)" value={Math.round(gradient.from)} onChange={e => { if (e.target.value !== '') stop('from', Number(e.target.value)); }} /><span>%</span></label>
      <label className="transparency-amount" title="Transparência no ponto final do degradê">Fim<input type="number" min="0" max="100" step="1" aria-label="Transparência no fim do degradê (%)" value={Math.round(gradient.to)} onChange={e => { if (e.target.value !== '') stop('to', Number(e.target.value)); }} /><span>%</span></label>
      <button type="button" className="paint-none" title="Trocar início e fim" onClick={() => once({ gradient: { ...gradient, from: gradient.to, to: gradient.from } })}>Inverter</button>
    </> : <label className="transparency-amount" title="Transparência: 0% opaco, 100% invisível">{compact ? '' : 'Transparência '}
      <LevelSlider aria-label="Transparência (controle deslizante)" value={percent} onPointerDown={beginEdit} onPointerUp={commitEdit} onKeyUp={commitEdit} onChange={e => percentInput(Number(e.target.value))} />
      <input type="number" min="0" max="100" step="1" aria-label="Transparência em %" value={percent} onChange={e => { if (e.target.value !== '') percentInput(Number(e.target.value)); }} /><span>%</span>
    </label>}
  </div>;
}

/**
 * Ângulo de rotação como no CorelDRAW: graus no sentido anti-horário, de 0 a 360, em torno do centro.
 * Um objeto mostra o ângulo atual (absoluto); vários objetos giram juntos pelo valor digitado.
 */
export function RotationControls({ compact = false }: { compact?: boolean }) {
  const { document, selectedIds, dispatch, objectCommand } = useEditor();
  const [multi, setMulti] = useState(''), previous = useRef(0);
  const ids = clipContents(document.objects, selectedIds), roots = document.objects.filter(o => selectedIds.includes(o.id) && (!o.clipParent || !selectedIds.includes(o.clipParent)));
  if (!roots.length) return null;
  const single = roots.length === 1 ? roots[0] : null;
  const value = single ? Number(corelAngle(single).toFixed(1)) : multi;
  function rotate(text: string) {
    if (text === '') return;
    const angle = Number(text.replace(',', '.'));
    if (!Number.isFinite(angle)) return;
    const b = boundsOf(roots), center = single ? transformPoint(matrixOf(single), { x: single.x + single.width / 2, y: single.y + single.height / 2 }) : { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const delta = single ? angle - corelAngle(single) : angle - previous.current;
    // Anti-horário positivo (CorelDRAW) = horário negativo na tela.
    dispatch({ type: 'set-objects', objects: applyMatrix(document.objects, ids, around(center, rotation(-delta))) });
    if (!single) { previous.current = angle; setMulti(text); }
  }
  return <span className={`rotation-controls ${compact ? 'compact' : ''}`}>
    <label className="number-field" title="Ângulo de rotação (graus, sentido anti-horário, como no CorelDRAW)"><span>{compact ? '↺' : 'Ângulo'}</span>
      <input type="number" aria-label="Ângulo de rotação" step="1" min="-360" max="360" value={value} placeholder="0" onBlur={() => { setMulti(''); previous.current = 0; }} onChange={e => rotate(e.target.value)} /><span>°</span></label>
    <button type="button" className="command-icon" aria-label="Espelhar horizontalmente" title="Espelhar horizontalmente (inverte da esquerda para a direita)" onClick={() => { finishEditing(); objectCommand('mirrorH'); }}><FlipHorizontal2 size={18} /></button>
    <button type="button" className="command-icon" aria-label="Espelhar verticalmente" title="Espelhar verticalmente (inverte de cima para baixo)" onClick={() => { finishEditing(); objectCommand('mirrorV'); }}><FlipVertical2 size={18} /></button>
  </span>;
}
