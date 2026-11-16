import type { ReactElement } from 'react';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { useEditor } from '../state/EditorContext';
import { envelopePresets, type EnvelopePreset } from '../geometry/deform';
import { envelopeMappings, envelopeModes } from '../geometry/envelope';
import type { EnvelopeMapping, EnvelopeMode } from '../document/model';
import { perspectiveEvent } from './useDeformTool';
import { envelopeAction, envelopeSettings, useEnvelopeSettings } from './useEnvelopeTool';
import { ChevronUp, Eraser, Minus, Pipette, Plus, Ruler, Shapes, Slash, Spline, Waves } from 'lucide-react';
import { meshSelection, useMeshCommands, useMeshSelection } from './useMeshTool';
import { resizeMesh } from '../document/patterns';

/** Ícones dos modos do envelope (lados em reta, arco simples, arco duplo e livre), no estilo do CorelDRAW. */
const modeIcon = (d: string) => <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d={d} />{[[3, 3], [15, 3], [15, 15], [3, 15]].map(([x, y]) => <rect key={`${x}${y}`} x={x - 1.5} y={y - 1.5} width="3" height="3" fill="currentColor" stroke="none" />)}</svg>;
const modeIcons: Record<EnvelopeMode, ReactElement> = {
  line: modeIcon('M3 3L9 6L15 3L15 15L3 15Z'),
  arc: modeIcon('M3 3Q9 9 15 3L15 15L3 15Z'),
  doubleArc: modeIcon('M3 3C6 8 12 -2 15 3L15 15L3 15Z'),
  free: modeIcon('M3 3C7 7 10 0 15 3C12 8 17 11 15 15C11 12 7 17 3 15C5 11 1 7 3 3Z'),
};
/** Barra de propriedades do Envelope (CorelDRAW) e da Perspectiva. */
export function DeformControls({ mode }: { mode: 'envelope' | 'perspective' }) {
  const opts = useEnvelopeSettings();
  if (mode === 'perspective') return <span className="tool-options"><button type="button" title="Volta à forma de quando a perspectiva começou nesta seleção" onClick={perspectiveEvent}>Limpar perspectiva</button></span>;
  const change = (patch: { mapping?: EnvelopeMapping; keepLines?: boolean }) => { envelopeSettings.set(patch); envelopeAction({ reapply: true }); };
  const node = (kind: 'add' | 'delete' | 'line' | 'curve' | 'cusp' | 'smooth', label: string, icon: ReactElement) => <button type="button" className="command-icon" aria-label={label} title={opts.nodes ? label : `${label} (escolha um nó do envelope)`} disabled={!opts.nodes} onClick={() => envelopeAction({ node: kind })}>{icon}</button>;
  return <span className="tool-options envelope-options">
    <label>Predefinição<select aria-label="Predefinição de envelope" value="" onChange={e => { if (e.target.value) envelopeAction({ preset: e.target.value as EnvelopePreset }); }}><option value="">Escolher…</option>{(Object.keys(envelopePresets) as EnvelopePreset[]).map(k => <option key={k} value={k}>{envelopePresets[k].label}</option>)}</select></label>
    <span className="segmented" role="group" aria-label="Modo do envelope">{envelopeModes.map(([m, label]) => <button key={m} type="button" className={`command-icon ${opts.mode === m ? 'active' : ''}`} aria-pressed={opts.mode === m} aria-label={label} title={label} onClick={() => envelopeSettings.set({ mode: m })}>{modeIcons[m]}</button>)}</span>
    {opts.mode === 'free' && <span className="segmented" role="group" aria-label="Nós do envelope">
      {node('add', 'Adicionar nó', <Plus size={15} />)}{node('delete', 'Excluir nó', <Minus size={15} />)}
      {node('line', 'Converter em linha', <Slash size={15} />)}{node('curve', 'Converter em curva', <Spline size={15} />)}
      {node('cusp', 'Nó cúspide', <ChevronUp size={15} />)}{node('smooth', 'Nó suave', <Waves size={15} />)}
    </span>}
    <label title={opts.bitmap ? 'Bitmap: mapeamento sempre em perspectiva (os cantos definem a perspectiva)' : 'Mapeamento: como o objeto se ajusta ao envelope'}>Mapeamento<select aria-label="Modo de mapeamento" disabled={opts.bitmap} value={opts.bitmap ? 'original' : opts.mapping} onChange={e => change({ mapping: e.target.value as EnvelopeMapping })}>{envelopeMappings.map(([m, label]) => <option key={m} value={m}>{label}</option>)}</select></label>
    <button type="button" className={`command-icon ${opts.keepLines ? 'active' : ''}`} aria-pressed={opts.keepLines} aria-label="Manter linhas" disabled={opts.bitmap} title={opts.bitmap ? 'Manter linhas: só para curvas (no bitmap as retas já continuam retas na perspectiva)' : 'Manter linhas: segmentos retos continuam retos'} onClick={() => change({ keepLines: !opts.keepLines })}><Ruler size={15} /></button>
    <button type="button" className={`command-icon ${opts.pick === 'copy' ? 'active' : ''}`} aria-pressed={opts.pick === 'copy'} aria-label="Copiar propriedades do envelope" title="Copiar propriedades do envelope: clique depois num objeto com envelope" onClick={() => envelopeSettings.set({ pick: opts.pick === 'copy' ? null : 'copy' })}><Pipette size={15} /></button>
    <button type="button" className={`command-icon ${opts.pick === 'create' ? 'active' : ''}`} aria-pressed={opts.pick === 'create'} aria-label="Criar envelope a partir de" title="Criar envelope a partir de: clique depois na forma que servirá de envelope" onClick={() => envelopeSettings.set({ pick: opts.pick === 'create' ? null : 'create' })}><Shapes size={15} /></button>
    <button type="button" className="command-icon" aria-label="Limpar envelope" title="Limpar envelope: volta à forma original" onClick={() => envelopeAction({ clear: true })}><Eraser size={15} /></button>
  </span>;
}
/** Barra do Preenchimento de malha: linhas, colunas, cor dos nós escolhidos e remover. */
export function MeshControls() {
  const { target, set, paintNodes } = useMeshCommands(), nodes = useMeshSelection(), mesh = target?.meshFill;
  if (!target) return <span className="context-page">Clique numa forma para criar a malha</span>;
  if (!mesh) return <span className="context-page">Clique na forma para criar a malha</span>;
  const grid = (rows: number, cols: number) => { meshSelection.set([]); set(resizeMesh(mesh, rows, cols)); };
  return <span className="tool-options">
    <label>Linhas<input type="number" aria-label="Linhas da malha" min={1} max={12} value={mesh.rows} onChange={e => { const v = Number(e.target.value); if (v >= 1 && v <= 12) grid(v, mesh.cols); }} /></label>
    <label>Colunas<input type="number" aria-label="Colunas da malha" min={1} max={12} value={mesh.cols} onChange={e => { const v = Number(e.target.value); if (v >= 1 && v <= 12) grid(mesh.rows, v); }} /></label>
    <label title={nodes.length ? 'Cor dos nós selecionados' : 'Clique num nó para escolher a cor'}>Cor do nó<input type="color" aria-label="Cor dos nós selecionados" disabled={!nodes.length} value={nodes.length ? mesh.colors[nodes[0]] : '#ffffff'} onChange={e => paintNodes(e.target.value)} /></label>
    <span className="context-page">{nodes.length ? `${nodes.length} nó(s)` : 'nenhum nó'}</span>
    <button type="button" onClick={() => meshSelection.set(mesh.colors.map((_, i) => i))}>Todos os nós</button>
    <button type="button" onClick={() => set(null)}>Remover malha</button>
  </span>;
}
/** Opções das cotas novas: casas decimais, unidade visível e tamanho do texto. */
export function DimensionControls() {
  const { layout, setLayout } = useWorkspace(), { document } = useEditor();
  return <span className="tool-options">
    <label>Precisão<select aria-label="Casas decimais da cota" value={layout.dimPrecision} onChange={e => setLayout(s => ({ ...s, dimPrecision: Number(e.target.value) }))}><option value={-1}>Automática</option>{[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 0 ? '0' : `0,${'0'.repeat(n)}`}</option>)}</select></label>
    <label className="settings-check"><input type="checkbox" checked={layout.dimShowUnit} onChange={e => setLayout(s => ({ ...s, dimShowUnit: e.target.checked }))} />Mostrar unidade ({document.unit ?? 'px'})</label>
    <label>Texto<input type="number" aria-label="Tamanho do texto da cota em pontos" min={4} max={200} value={layout.dimFontSize} onChange={e => { const v = Number(e.target.value); if (v >= 4 && v <= 200) setLayout(s => ({ ...s, dimFontSize: v })); }} />pt</label>
  </span>;
}
