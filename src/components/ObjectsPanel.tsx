import { useRef, useState } from 'react';
import { ChevronsUp, ChevronUp, ChevronDown, ChevronsDown, Image as ImageIcon, Layers2, Square, Circle, Type, PenTool, MousePointer2, SquareDot, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { LayersPanel } from './LayersPanel';
import { useMaskCommands } from './useMaskBrush';
import type { VectorObject } from '../document/model';
import { isBlocked } from '../document/layers';
import { moveInStack } from '../document/objectOrder';

/**
 * Janela Objetos (encaixada à direita): camadas e a lista de objetos. Clique escolhe; Ctrl+clique soma/tira;
 * Shift+clique escolhe o intervalo; arrastar muda a ordem. O olho oculta o objeto. Objetos com máscara mostram a
 * miniatura dela (clicar pinta, olho ativa/desativa, lixeira exclui), como no Photoshop.
 */
export function ObjectsPanel() {
  const { document, selectedIds, chooseObject, objectCommand, setTool, setSelection, dispatch, commitEdit, setMessage } = useEditor(), masks = useMaskCommands();
  const selected = document.objects.filter(o => selectedIds.includes(o.id));
  const anchor = useRef<string | null>(null), [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null), dragging = useRef<string[]>([]);
  const rows = [...document.objects].reverse();
  function click(o: VectorObject, event: React.MouseEvent) {
    finishEditing();
    if (event.shiftKey && anchor.current && rows.some(r => r.id === anchor.current)) {
      const a = rows.findIndex(r => r.id === anchor.current), b = rows.findIndex(r => r.id === o.id), [from, to] = a < b ? [a, b] : [b, a];
      const range = rows.slice(from, to + 1).filter(r => !isBlocked(document, r)).map(r => r.id);
      setSelection(event.ctrlKey ? [...new Set([...selectedIds, ...range])] : range);
      return;
    }
    anchor.current = o.id;
    chooseObject(o.id, event.ctrlKey || event.metaKey);
  }
  const setHidden = (ids: string[], hidden: boolean) => {
    finishEditing(); commitEdit();
    dispatch({ type: 'set-objects', objects: document.objects.map(o => ids.includes(o.id) ? (hidden ? { ...o, hidden: true } : (({ hidden: _h, ...rest }) => rest)(o)) : o) });
    commitEdit();
    if (hidden) setSelection(selectedIds.filter(id => !ids.includes(id)));
  };
  function dropOn(target: VectorObject) {
    const ids = dragging.current, d = drop; setDrop(null); dragging.current = [];
    if (!ids.length || !d) return;
    const next = moveInStack(document.objects, ids, target.id, d.after);
    if (next === document.objects) return;
    finishEditing(); commitEdit(); dispatch({ type: 'set-objects', objects: next }); commitEdit();
    setMessage(`${ids.length} objeto(s) movido(s) na ordem. Ctrl+Z desfaz.`);
  }
  return <aside className="properties objects-panel">
    <div className="panel-title"><Layers2 size={16} /><h2>Objetos</h2></div>
    <LayersPanel />
    <section className="layers-section"><div className="section-heading"><h3><Layers2 size={15} /> Objetos</h3><span className="layer-order">
      <button aria-label="Adicionar máscara de camada" title="Adicionar máscara de camada ao objeto selecionado (como no Photoshop)" disabled={!selected.some(o => !o.mask)} onClick={() => masks.add('white')}><SquareDot size={14} /></button>
      {([['front', ChevronsUp, 'Para frente da página (Ctrl+Home)'], ['forward', ChevronUp, 'Avançar um (Ctrl+PgUp)'], ['backward', ChevronDown, 'Recuar um (Ctrl+PgDn)'], ['back', ChevronsDown, 'Para trás da página (Ctrl+End)']] as const).map(([command, Icon, label]) => <button key={command} aria-label={label} title={label} disabled={!selectedIds.length} onClick={() => { finishEditing(); objectCommand(command); }}><Icon size={14} /></button>)}
    </span><span className="count">{document.objects.length}</span></div>
      <div className="layer-list" onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null); }}>{document.objects.length === 0 ? <div className="empty-layers"><MousePointer2 size={24} strokeWidth={1.3} /><p>Seu espaço para criar</p><span>Escolha uma ferramenta e desenhe na prancheta.</span></div> : rows.map((o, i) => {
        const Icon = o.type === 'rectangle' ? Square : o.type === 'ellipse' ? Circle : o.type === 'path' ? PenTool : o.type === 'image' ? ImageIcon : Type;
        const label = (o.clipParent ? '  ↳ ' : '') + (document.objects.some(c => c.clipParent === o.id) ? '◫ ' : '') + (o.groupPath?.length ? '▣ ' : '') + (o.locked ? '🔒 ' : '') + (o.type === 'text' ? o.text || 'Texto vazio' : o.name);
        const marker = drop?.id === o.id ? (drop.after ? 'drop-above' : 'drop-below') : '';
        return <div key={o.id} className={`layer object-row ${selectedIds.includes(o.id) ? 'selected' : ''} ${o.hidden ? 'is-hidden' : ''} ${marker}`}
          draggable onDragStart={e => { dragging.current = selectedIds.includes(o.id) ? selectedIds : [o.id]; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.name); }}
          onDragOver={e => { if (!dragging.current.length) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDrop({ id: o.id, after: e.clientY < r.top + r.height / 2 }); }}
          onDrop={e => { e.preventDefault(); dropOn(o); }} onDragEnd={() => { setDrop(null); dragging.current = []; }}>
          <button className="object-eye" title={o.hidden ? 'Mostrar objeto' : 'Ocultar objeto'} aria-label={o.hidden ? `Mostrar ${o.name}` : `Ocultar ${o.name}`} aria-pressed={!o.hidden} onClick={() => setHidden([o.id], !o.hidden)}>{o.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
          <button className="object-name" title="Clique: escolher · Ctrl+clique: somar/tirar · Shift+clique: intervalo · Arraste para mudar a ordem" onClick={event => click(o, event)}><Icon size={15} /><span>{label}</span></button>
          {o.mask && <span className="mask-controls">
            <button className={`mask-thumb ${o.mask.disabled ? 'is-disabled' : ''}`} title={o.mask.disabled ? 'Máscara desativada · clique para editar' : 'Máscara de camada · clique para pintar (pincel de máscara)'} aria-label={`Editar máscara de ${o.name}`} onClick={() => { finishEditing(); setSelection([o.id]); setTool('maskBrush'); }}><img src={o.mask.src} alt="" style={o.mask.background === 'black' ? { background: '#000' } : undefined} /></button>
            <button title={o.mask.disabled ? 'Ativar máscara' : 'Desativar máscara (a pintura fica guardada)'} aria-label={o.mask.disabled ? 'Ativar máscara' : 'Desativar máscara'} aria-pressed={!o.mask.disabled} onClick={() => masks.toggle([o.id])}>{o.mask.disabled ? <EyeOff size={13} /> : <Eye size={13} />}</button>
            <button title="Excluir máscara" aria-label={`Excluir máscara de ${o.name}`} onClick={() => masks.remove([o.id])}><Trash2 size={13} /></button>
          </span>}
          <small>{String(document.objects.length - i).padStart(2, '0')}</small>
        </div>;
      })}</div></section>
  </aside>;
}
