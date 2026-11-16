import { useState } from 'react';
import { FlipHorizontal2, FlipVertical2, Plus, Minus, CornerDownRight, Spline, Link2, Unlink2, BoxSelect, Merge, Scissors, Ungroup, CircleDashed, Minimize2, MoveHorizontal, AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter } from 'lucide-react';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { applyCorners } from '../geometry/corners';
import { pathFromWorld } from '../geometry/convertCurves';
import { cornerRadii, cornerScale, worldCommands } from '../geometry/worldGeometry';
import { alignNodes, breakAtNodes, closeContours, convertNode, decodePath, encodePath, extractSubpaths, insertNode, joinNodes, nodeContour, reduceNodes, removeNodes, type EditablePath } from '../geometry/nodeGeometry';
import { fromUnit, toUnit, unitDefinitions, unitStep } from '../document/units';
import type { CornerType, VectorObject } from '../document/model';
const cornerTypes: [CornerType, string][] = [['round', 'Arredondado'], ['scallop', 'Recortado'], ['chamfer', 'Chanfrado']];
/** Ícones dos tipos de canto (como na barra do CorelDRAW): canto arredondado, recortado (côncavo) e chanfrado. */
function CornerTypeIcon({ type }: { type: CornerType }) {
  const d = type === 'round' ? 'M4 20V11a7 7 0 0 1 7-7h9' : type === 'scallop' ? 'M4 20V11a7 7 0 0 0 7-7h9' : 'M4 20V11l7-7h9';
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={d} /></svg>;
}
/** Cantos: retângulos guardam raio e tipo (editáveis); curvas recebem os cantos nos vértices retos. */
/** Novo raio (no documento) para um canto ou, com `together`, para os quatro; guarda em unidades locais. */
export function withCorners(o: VectorObject, patch: { radius?: number; type?: CornerType; corner?: number }, together: boolean): VectorObject {
  const k = cornerScale(o), next: VectorObject = { ...o, cornerType: patch.type ?? o.cornerType ?? 'round' };
  if (patch.radius === undefined) return next;
  const r = Math.max(0, patch.radius / k);
  if (together || patch.corner === undefined) { delete next.cornerRadii; next.cornerRadius = r; return next; }
  const radii = cornerRadii(o); radii[patch.corner] = r;
  delete next.cornerRadius;
  if (radii.every(v => Math.abs(v - radii[0]) < 1e-9)) { next.cornerRadius = radii[0]; delete next.cornerRadii; } else next.cornerRadii = radii;
  return next;
}
export function CornerControls() {
  const { document, selectedIds, dispatch, commitEdit, setMessage } = useEditor(), { layout, setLayout } = useWorkspace();
  const unit = document.unit ?? 'px', lock = layout.lockCorners;
  const selected = document.objects.filter(o => selectedIds.includes(o.id) && (!o.clipParent || !selectedIds.includes(o.clipParent)));
  const rects = selected.filter(o => o.type === 'rectangle'), paths = selected.filter(o => o.type === 'path');
  const [pathRadius, setPathRadius] = useState(10), [pathType, setPathType] = useState<CornerType>('round');
  if (!rects.length && !paths.length) return null;
  // O raio exibido é o do documento (raio guardado × escala do objeto).
  const type = rects[0]?.cornerType ?? (rects.length ? 'round' : pathType), radius = rects.length ? (rects[0].cornerRadius ?? 0) * cornerScale(rects[0]) : pathRadius;
  /** `corner`: índice do canto (0 sup. esq., 1 sup. dir., 2 inf. dir., 3 inf. esq.); com o cadeado, vale para os quatro. */
  function apply(patch: { radius?: number; type?: CornerType; corner?: number }) {
    finishEditing();
    if (!rects.length) { if (patch.radius !== undefined) setPathRadius(patch.radius); if (patch.type) setPathType(patch.type); return; }
    commitEdit();
    dispatch({ type: 'set-objects', objects: document.objects.map(o => !rects.some(r => r.id === o.id) ? o : withCorners(o, patch, lock)) });
    commitEdit();
  }
  const radii = rects.length ? cornerRadii(rects[0]).map(r => r * cornerScale(rects[0])) : [];
  const field = (corner: number, label: string) => <input key={`${corner}-${radii[corner]}-${unit}`} type="number" className="corner-field" aria-label={`Raio do canto ${label}`} title={`Canto ${label} (Enter aplica)`} min="0" step={unitStep(unit)} defaultValue={Number(toUnit(radii[corner], unit).toPrecision(6))} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={e => { const v = fromUnit(Number(e.target.value.replace(',', '.')), unit); if (Number.isFinite(v) && v >= 0 && Math.abs(v - radii[corner]) > 1e-9) apply({ radius: v, corner }); }} />;
  function applyToPaths() {
    finishEditing();
    try {
      commitEdit();
      dispatch({ type: 'set-objects', objects: document.objects.map(o => !paths.some(p => p.id === o.id) ? o : { ...pathFromWorld(o, applyCorners(worldCommands(o), pathRadius, pathType), o.name), nodeModes: undefined }) });
      setMessage('Cantos aplicados aos vértices retos da curva. Ctrl+Z desfaz.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível aplicar os cantos.'); }
  }
  return <span className="corner-controls" title="Cantos">
    {cornerTypes.map(([id, label]) => <button key={id} type="button" className={`command-icon corner-type ${type === id ? 'active' : ''}`} aria-pressed={type === id} aria-label={`Canto ${label.toLowerCase()}`} title={`Canto ${label.toLowerCase()}`} onClick={() => apply({ type: id })}><CornerTypeIcon type={id} /></button>)}
    {rects.length > 0 && <span className="corner-grid">{field(0, 'superior esquerdo')}{field(1, 'superior direito')}{field(3, 'inferior esquerdo')}{field(2, 'inferior direito')}</span>}
    {rects.length > 0 && <button type="button" className={`command-icon corner-lock ${lock ? 'active' : ''}`} aria-pressed={lock} aria-label="Editar cantos juntos" title={lock ? 'Cantos juntos: um valor muda os quatro' : 'Cantos independentes'} onClick={() => setLayout(st => ({ ...st, lockCorners: !st.lockCorners }))}>{lock ? <Link2 size={14} /> : <Unlink2 size={14} />}</button>}
    {!rects.length && <input type="number" aria-label="Raio do canto" title="Raio do canto (Enter aplica)" min="0" step={unitStep(unit)} key={`${radius}-${unit}`} defaultValue={Number(toUnit(radius, unit).toPrecision(6))} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={e => { const v = fromUnit(Number(e.target.value), unit); if (Number.isFinite(v) && v >= 0 && Math.abs(v - radius) > 1e-9) apply({ radius: v }); }} />}
    <span className="font-size-unit">{unitDefinitions[unit].short}</span>
    {!rects.length && <button type="button" className="paint-none corner-apply" onClick={applyToPaths} title="Aplicar cantos aos vértices retos da curva">Aplicar cantos</button>}
  </span>;
}
/** Barra da ferramenta Forma: nós e Refletir nós horizontal/vertical, como no CorelDRAW. */
export function NodeToolbar() {
  const { document, selectedId, selectedNode, selectNode, selectedNodes, setSelectedNodes, dispatch, commitEdit, select, removeSelected, nodeMirror, setNodeMirror, setMessage } = useEditor();
  const [reduceAmount, setReduceAmount] = useState(0.5);
  const toggleMirror = (axis: 'h' | 'v') => {
    const next = { ...nodeMirror, [axis]: !nodeMirror[axis] };
    setNodeMirror(next);
    setMessage(next.h || next.v ? `Refletir nós ${next.h && next.v ? 'na horizontal e na vertical' : next.h ? 'na horizontal' : 'na vertical'}: marque 2 ou mais nós (Shift+clique ou arraste uma área) e arraste um deles; os outros se movem espelhados.` : 'Refletir nós desligado.');
  };
  const object = document.objects.find(o => o.id === selectedId && o.type === 'path');
  const path = object ? decodePath(object) : null, node = path && selectedNode !== null ? path.nodes[selectedNode] : undefined;
  function apply(next: EditablePath, selection: number | null = selectedNode) {
    if (!object || !path || next === path) return;
    const geometry = encodePath(next);
    if (geometry) { finishEditing(); dispatch({ type: 'path-edit', id: object.id, geometry }); selectNode(selection); }
  }
  const marked = selectedNodes.length ? selectedNodes : selectedNode !== null ? [selectedNode] : [];
  const run = (next: EditablePath | null, done: string, fail: string) => { if (!next || next === path) { setMessage(fail); return; } apply(next, null); setSelectedNodes([]); setMessage(done); };
  /** Extrair subcaminho: o contorno dos nós marcados vira um objeto novo (mesmo estilo e transformação). */
  function extract() {
    if (!object || !path) return;
    const r = extractSubpaths(path, marked), rest = r && encodePath(r.rest), out = r && encodePath(r.extracted);
    if (!rest || !out) { setMessage('Extrair subcaminho: marque um nó de um dos contornos de uma curva com várias partes.'); return; }
    finishEditing(); commitEdit();
    const piece = { ...object, ...out, id: crypto.randomUUID(), name: `${object.name} (subcaminho)` };
    dispatch({ type: 'set-objects', objects: document.objects.flatMap(o => o.id === object.id ? [{ ...o, ...rest }, piece] : [o]) });
    commitEdit(); setSelectedNodes([]); select(piece.id); setMessage('Subcaminho extraído para um objeto próprio. Ctrl+Z desfaz.');
  }
  const contour = path ? nodeContour(path, selectedNode ?? 0) : null;
  const segment = !path || selectedNode === null ? 0 : Math.min(selectedNode, contour!.closed ? contour!.end - 1 : contour!.end - 2);
  const button = (label: string, Icon: typeof Plus, onClick: () => void, disabled: boolean, pressed?: boolean) => <button type="button" className={`command-icon ${pressed ? 'active' : ''}`} aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}><Icon size={17} /></button>;
  return <span className="node-toolbar">
    {button('Adicionar nó', Plus, () => path && apply(insertNode(path, segment), segment + 1), !path || path.nodes.length >= 9998)}
    {button(selectedNodes.length > 1 ? `Excluir ${selectedNodes.length} nós (Delete)` : 'Excluir nó (Delete)', Minus, () => { if (!path || !marked.length) return; const next = removeNodes(path, marked); if (next.nodes.length) { apply(next, null); setSelectedNodes([]); } else { removeSelected(); setSelectedNodes([]); setMessage('Todos os nós excluídos: a curva foi removida. Ctrl+Z desfaz.'); } }, !marked.length)}
    {button('Selecionar todos os nós (Ctrl+A) · arraste uma caixa para marcar vários · Shift+clique soma', BoxSelect, () => { if (path) setSelectedNodes(path.nodes.map((_, i) => i)); }, !path)}
    {button('Nó de canto (cúspide)', CornerDownRight, () => path && apply(convertNode(path, selectedNode!, 'corner')), !node, node?.mode === 'corner')}
    {button('Nó suave', Spline, () => path && apply(marked.reduce((p, i) => convertNode(p, i, 'smooth'), path)), !node, node?.mode === 'smooth')}
    {button('Nó simétrico (alças iguais)', MoveHorizontal, () => path && apply(marked.reduce((p, i) => convertNode(p, i, 'symmetric'), path)), !node, node?.mode === 'symmetric')}
    <span className="command-divider" />
    {button('Juntar dois nós (pontas soltas)', Merge, () => path && run(marked.length === 2 ? joinNodes(path, marked[0], marked[1]) : null, 'Nós juntados. Ctrl+Z desfaz.', 'Juntar dois nós: marque exatamente duas pontas soltas (Shift+clique).'), !path || marked.length !== 2)}
    {button('Quebrar curva no nó', Scissors, () => path && run(breakAtNodes(path, marked), 'Curva quebrada no nó. Ctrl+Z desfaz.', 'Quebrar curva: marque um nó do meio (ou de um contorno fechado).'), !path || !marked.length)}
    {button('Fechar curva (liga as pontas)', CircleDashed, () => path && run(closeContours(path, marked), 'Curva fechada. Ctrl+Z desfaz.', 'Fechar curva: não há contorno aberto com 3 ou mais nós.'), !path)}
    {button('Extrair subcaminho', Ungroup, extract, !path || !marked.length)}
    <span className="command-divider" />
    {button('Alinhar nós na horizontal (mesma altura)', AlignHorizontalJustifyCenter, () => path && run(alignNodes(path, marked, 'horizontal'), 'Nós alinhados na horizontal.', 'Alinhar nós: marque 2 ou mais nós.'), !path || marked.length < 2)}
    {button('Alinhar nós na vertical (mesma coluna)', AlignVerticalJustifyCenter, () => path && run(alignNodes(path, marked, 'vertical'), 'Nós alinhados na vertical.', 'Alinhar nós: marque 2 ou mais nós.'), !path || marked.length < 2)}
    <span className="command-divider" />
    <label className="reduce-nodes" title="Reduzir nós: tira nós que quase não mudam a forma (nos marcados ou, sem marcação, em toda a curva). Valor = desvio máximo permitido">
      <button type="button" className="command-icon" aria-label="Reduzir nós" title="Reduzir nós" disabled={!path} onClick={() => { if (!path || !object) return; const scale = Math.max(object.width, object.height) / 1000 || 1; const r = reduceNodes(path, reduceAmount * scale * 4, selectedNodes.length > 1 ? selectedNodes : undefined); run(r.removed ? r.path : null, `${r.removed} nó(s) removido(s) sem mudar a forma. Ctrl+Z desfaz.`, 'Reduzir nós: nenhum nó pode sair sem mudar a forma nesse nível (aumente o valor).'); }}><Minimize2 size={17} /></button>
      <input type="range" min={0.1} max={5} step={0.1} value={reduceAmount} aria-label="Nível de redução de nós" onChange={e => setReduceAmount(Number(e.target.value))} /><span>{reduceAmount.toFixed(1)}</span>
    </label>
    <span className="command-divider" />
    {button('Refletir nós horizontalmente', FlipHorizontal2, () => toggleMirror('h'), false, nodeMirror.h)}
    {button('Refletir nós verticalmente', FlipVertical2, () => toggleMirror('v'), false, nodeMirror.v)}
    {!object && <span className="context-page">Clique em uma curva (Ctrl+Q converte formas e textos)</span>}
  </span>;
}
