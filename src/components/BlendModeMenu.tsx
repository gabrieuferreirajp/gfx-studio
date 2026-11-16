import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import type { VectorObject } from '../document/model';
import { blendModes, photoshopBlendList, setTransparency, type BlendMode } from '../document/transparency';
import { finishEditing } from '../state/useProjectFiles';

/**
 * Modos de mesclagem como no Photoshop: lista agrupada e pré-visualização ao passar o mouse sobre cada modo
 * (o desenho muda na hora, sem entrar no Desfazer). Clique confirma; Esc ou sair da lista volta ao modo atual.
 */
export function BlendModeMenu({ ids, mode }: { ids: string[]; mode: BlendMode }) {
  const { document, dispatch, amend, commitEdit } = useEditor();
  const [open, setOpen] = useState<{ left: number; top: number; maxHeight: number } | null>(null), original = useRef<VectorObject[] | null>(null), root = useRef<HTMLSpanElement>(null), list = useRef<HTMLDivElement>(null);
  const restore = () => { if (original.current) { amend({ type: 'set-objects', objects: original.current }); } };
  const close = () => { restore(); original.current = null; setOpen(null); };
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); };
  });
  const preview = (m: BlendMode) => { if (original.current) amend({ type: 'set-objects', objects: setTransparency(original.current, ids, { blendMode: m }) }); };
  const choose = (m: BlendMode) => {
    const base = original.current ?? document.objects; restore(); original.current = null; setOpen(null);
    finishEditing(); commitEdit(); dispatch({ type: 'set-objects', objects: setTransparency(base, ids, { blendMode: m }) }); commitEdit();
  };
  return <span className="blend-menu" ref={root}>
    <button type="button" className="blend-menu-button" aria-haspopup="listbox" aria-expanded={!!open} aria-label="Modo de mesclagem" title="Modo de mesclagem (passe o mouse para ver o resultado)" onClick={e => { if (open) { close(); return; } const r = e.currentTarget.getBoundingClientRect(); original.current = document.objects; setOpen({ left: r.left, top: r.bottom + 2, maxHeight: Math.max(200, window.innerHeight - r.bottom - 12) }); }}>{blendModes[mode].label}<ChevronDown size={13} /></button>
    {open && createPortal(<div ref={list} className="blend-menu-list" role="listbox" aria-label="Modos de mesclagem" style={{ left: open.left, top: open.top, maxHeight: open.maxHeight }} onPointerLeave={restore}>
      {photoshopBlendList.map((group, g) => <div key={g} className="blend-menu-group">{group.map(item => 'key' in item
        ? <button key={item.key} type="button" role="option" aria-selected={item.key === mode} className={item.key === mode ? 'current' : ''} onPointerEnter={() => preview(item.key)} onFocus={() => preview(item.key)} onClick={() => choose(item.key)}>{blendModes[item.key].label}</button>
        : <button key={item.unavailable} type="button" role="option" aria-disabled="true" disabled className="unavailable" title="Indisponível: este modo precisa de cálculo por pixel que o motor de desenho não oferece">{item.unavailable}<small>indisponível</small></button>)}</div>)}
    </div>, window.document.body)}
  </span>;
}
