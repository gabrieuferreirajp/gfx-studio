import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, LockOpen, Plus, Printer, Trash2, CornerDownRight } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { activeLayerId, addLayer, deleteLayer, layerList, moveLayer, moveToLayer, setActiveLayer, updateLayer, type LayerState } from '../document/layers';
import { clipContents } from '../geometry/objectTransforms';

/** Camadas no painel Objetos (CorelDRAW): a camada ativa recebe os novos objetos; olho, cadeado e impressora por camada. */
export function LayersPanel() {
  const { document, dispatch, commitEdit, selectedIds, setMessage } = useEditor();
  const [renaming, setRenaming] = useState<string | null>(null);
  const layers = layerList(document), active = activeLayerId(document);
  const apply = (state: LayerState | null, message?: string) => { if (!state) return; finishEditing(); commitEdit(); dispatch({ type: 'set-layers', ...state }); commitEdit(); if (message) setMessage(message); };
  const count = (id: string) => document.objects.filter(o => (o.layer ?? layers[0].id) === id).length;
  const remove = (id: string, name: string) => {
    const n = count(id);
    if (layers.length < 2) { setMessage('O documento precisa de pelo menos uma camada.'); return; }
    if (n && !window.confirm(`Excluir a camada "${name}" e os ${n} objeto(s) dela?`)) return;
    apply(deleteLayer(document, id), `Camada "${name}" excluída. Ctrl+Z desfaz.`);
  };
  return <section className="layers-panel" aria-label="Camadas">
    <div className="section-heading"><h3>Camadas</h3><span className="layer-order">
      <button aria-label="Nova camada" title="Nova camada (acima da ativa)" onClick={() => apply(addLayer(document))}><Plus size={14} /></button>
      <button aria-label="Mover seleção para a camada ativa" title="Mover seleção para a camada ativa" disabled={!selectedIds.length} onClick={() => apply(moveToLayer(document, clipContents(document.objects, selectedIds), active), 'Seleção movida para a camada ativa.')}><CornerDownRight size={14} /></button>
    </span></div>
    <ul className="layer-rows">{[...layers].reverse().map(layer => {
      const i = layers.indexOf(layer), isActive = layer.id === active;
      const toggle = (key: 'visible' | 'locked' | 'printable', label: string, on: boolean, IconOn: typeof Eye, IconOff: typeof Eye) => <button aria-label={`${label}: ${layer.name}`} aria-pressed={on} title={label} className={on ? '' : 'off'} onClick={() => apply(updateLayer(document, layer.id, { [key]: !layer[key] }))}>{on ? <IconOn size={14} /> : <IconOff size={14} />}</button>;
      return <li key={layer.id} className={`layer-row ${isActive ? 'active' : ''}`}>
        {toggle('visible', 'Mostrar/ocultar', layer.visible, Eye, EyeOff)}
        {toggle('printable', 'Imprimir e exportar', layer.printable, Printer, Printer)}
        <button aria-label={`Travar/destravar: ${layer.name}`} aria-pressed={layer.locked} title="Travar (não seleciona)" className={layer.locked ? 'on' : ''} onClick={() => apply(updateLayer(document, layer.id, { locked: !layer.locked }))}>{layer.locked ? <Lock size={14} /> : <LockOpen size={14} />}</button>
        {renaming === layer.id
          ? <input className="layer-name-input" aria-label="Nome da camada" autoFocus defaultValue={layer.name} maxLength={256} onBlur={e => { apply(updateLayer(document, layer.id, { name: e.currentTarget.value })); setRenaming(null); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); e.stopPropagation(); }} />
          : <button className="layer-name" aria-current={isActive} title={isActive ? 'Camada ativa · duplo clique renomeia' : 'Clique para tornar ativa · duplo clique renomeia'} onClick={() => apply(setActiveLayer(document, layer.id))} onDoubleClick={() => setRenaming(layer.id)}>{layer.name}<small>{count(layer.id)}</small></button>}
        <button aria-label={`Subir camada ${layer.name}`} title="Subir" disabled={i === layers.length - 1} onClick={() => apply(moveLayer(document, layer.id, true))}><ArrowUp size={13} /></button>
        <button aria-label={`Descer camada ${layer.name}`} title="Descer" disabled={i === 0} onClick={() => apply(moveLayer(document, layer.id, false))}><ArrowDown size={13} /></button>
        <button aria-label={`Excluir camada ${layer.name}`} title="Excluir camada e seus objetos" disabled={layers.length < 2} onClick={() => remove(layer.id, layer.name)}><Trash2 size={13} /></button>
      </li>;
    })}</ul>
  </section>;
}
