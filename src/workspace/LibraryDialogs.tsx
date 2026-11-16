import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { browserMeasure } from '../text/textMeasure';
import { applyStyle, createSymbol, deleteStyle, deleteSymbol, insertSymbol, newStyle, redefineStyle, styleFrom, styleUsage, symbolUsage, unlinkSymbol, updateSymbol } from '../document/library';
import { boundsOf } from '../geometry/objectTransforms';
import { toSvg } from '../io/exporters';
import { screenToDocument } from '../document/viewport';
import type { ColorStyle, ObjectStyle, SymbolDef, VectorDocument } from '../document/model';
import { colorStyleUsage, deleteColorStyle, paintWith, recolorStyle, stylesFromSelection } from '../document/colorStyles';
import { ColorPicker } from './ColorPicker';

export type LibraryWindow = 'styles' | 'symbols' | 'colors';
export const openLibrary = (window_: LibraryWindow, action?: 'new' | 'unlink') => window.dispatchEvent(new CustomEvent('vectorstudio:library', { detail: { window: window_, action } }));
function Window({ title, open, close, children }: { title: string; open: boolean; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.show(); if (!open && d.open) d.close(); }, [open]);
  return <dialog ref={ref} className="workspace-settings transform-window text-tool-window library-window" aria-label={title} onCancel={e => { e.preventDefault(); close(); }} onKeyDown={e => e.stopPropagation()}>
    <header className="transform-header"><h2>{title}</h2><button type="button" className="dock-close" aria-label={`Fechar ${title}`} onClick={close}><X size={14} /></button></header>
    {open && children}
  </dialog>;
}
export function LibraryDialogs() {
  const [open, setOpen] = useState<LibraryWindow | null>(null), [action, setAction] = useState<'new' | 'unlink' | undefined>();
  useEffect(() => {
    const show = (e: Event) => { const d = (e as CustomEvent<{ window: LibraryWindow; action?: 'new' | 'unlink' }>).detail; setOpen(d.window); setAction(d.action); };
    window.addEventListener('vectorstudio:library', show); return () => window.removeEventListener('vectorstudio:library', show);
  }, []);
  const close = () => setOpen(null);
  return <>
    <Window title="Estilos de objeto" open={open === 'styles'} close={close}><StylesPanel /></Window>
    <Window title="Gerenciador de símbolos" open={open === 'symbols'} close={close}><SymbolsPanel action={action} done={() => setAction(undefined)} /></Window>
    <Window title="Estilos de cor" open={open === 'colors'} close={close}><ColorStylesPanel /></Window>
  </>;
}
/** Resumo legível do estilo (cores, contorno e fonte). */
function describe(props: ReturnType<typeof styleFrom>) {
  const parts: string[] = [];
  if (props.fillPattern) parts.push('padrão'); else if (props.fillGradient) parts.push('degradê'); else if (props.fill) parts.push(props.fill === 'none' ? 'sem preenchimento' : props.fill.toUpperCase());
  if (props.stroke && props.stroke !== 'none') parts.push(`contorno ${props.stroke.toUpperCase()} ${Number((props.strokeWidth ?? 0).toFixed(2))} px`);
  if (props.fontFamily || props.fontSize) parts.push(`${props.fontFamily ?? ''} ${props.fontSize ? `${props.fontSize} pt` : ''}`.trim());
  if (props.opacity !== undefined) parts.push(`${Math.round((1 - props.opacity) * 100)}% transparente`);
  return parts.join(' · ');
}
function StylesPanel() {
  const { document, selectedIds, dispatch, commitEdit, setMessage } = useEditor();
  const styles = document.styles ?? [], [active, setActive] = useState<string | null>(null), [name, setName] = useState('');
  const source = document.objects.find(o => selectedIds.includes(o.id) && o.type !== 'image'), style = styles.find(s => s.id === active);
  const save = (result: { styles: ObjectStyle[]; document?: Pick<VectorDocument, 'objects' | 'pages' | 'page'> }, message: string) => { finishEditing(); commitEdit(); dispatch({ type: 'set-library', styles: result.styles, document: result.document }); commitEdit(); setMessage(message); };
  return <>
    <p className="muted">Guarda preenchimento, contorno, transparência e (em textos) a fonte. Objetos vinculados mudam juntos ao redefinir o estilo.</p>
    <ul className="library-list" role="listbox" aria-label="Estilos do documento">{styles.length ? styles.map(s => <li key={s.id} role="option" aria-selected={s.id === active} className={s.id === active ? 'active' : ''} onClick={() => setActive(s.id)}>
      <span className="style-swatch" style={{ background: s.props.fill && s.props.fill !== 'none' ? s.props.fill : 'transparent', borderColor: s.props.stroke && s.props.stroke !== 'none' ? s.props.stroke : undefined }} />
      <span><strong>{s.name}</strong><small>{describe(s.props)} · {styleUsage(document, s.id)} objeto(s)</small></span></li>) : <li className="muted">Nenhum estilo. Selecione um objeto e use “Novo a partir da seleção”.</li>}</ul>
    <label className="settings-row">Nome<input type="text" value={name} placeholder="Ex.: Título, Destaque, Linha de corte" onChange={e => setName(e.target.value)} /></label>
    <div className="library-actions">
      <button type="button" disabled={!source} title="Cria um estilo com os atributos do objeto selecionado e vincula o objeto" onClick={() => { if (!source) return; const st = newStyle(source, name || `Estilo ${styles.length + 1}`); save({ styles: [...styles, st], document: { objects: document.objects.map(o => o.id === source.id ? { ...o, style: st.id } : o), pages: document.pages, page: document.page } }, `Estilo “${st.name}” criado.`); setActive(st.id); setName(''); }}>Novo a partir da seleção</button>
      <button type="button" className="primary" disabled={!style || !selectedIds.length} onClick={() => { if (!style) return; save({ styles, document: { objects: document.objects.map(o => selectedIds.includes(o.id) ? applyStyle(o, style, browserMeasure) : o), pages: document.pages, page: document.page } }, `Estilo “${style.name}” aplicado.`); }}>Aplicar à seleção</button>
      <button type="button" disabled={!style || !source} title="O estilo passa a ter os atributos do objeto selecionado; todos os objetos vinculados são atualizados (todas as páginas)" onClick={() => { if (!style || !source) return; const r = redefineStyle(document, style.id, styleFrom(source), browserMeasure); save(r, `Estilo “${style.name}” redefinido e aplicado aos objetos vinculados.`); }}>Redefinir pela seleção</button>
      <button type="button" disabled={!style || !name.trim()} onClick={() => { if (!style) return; save({ styles: styles.map(s => s.id === style.id ? { ...s, name: name.trim().slice(0, 256) } : s) }, 'Estilo renomeado.'); setName(''); }}>Renomear</button>
      <button type="button" disabled={!selectedIds.some(id => document.objects.find(o => o.id === id)?.style)} onClick={() => save({ styles, document: { objects: document.objects.map(o => selectedIds.includes(o.id) && o.style ? (({ style: _s, ...rest }) => rest)(o) : o), pages: document.pages, page: document.page } }, 'Vínculo com o estilo removido (a aparência fica).')}>Desvincular seleção</button>
      <button type="button" disabled={!style} onClick={() => { if (!style) return; save(deleteStyle(document, style.id), `Estilo “${style.name}” excluído; os objetos mantêm a aparência.`); setActive(null); }}>Excluir estilo</button>
    </div>
  </>;
}
/** Miniatura do símbolo (SVG exportado da definição). */
function SymbolPreview({ symbol }: { symbol: SymbolDef }) {
  const url = useMemo(() => { try { const roots = symbol.objects.filter(o => !o.clipParent), b = boundsOf(roots), pad = Math.max(b.width, b.height) * 0.05; return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(toSvg({ objects: symbol.objects, area: { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 } }, browserMeasure))}`; } catch { return ''; } }, [symbol]);
  return url ? <img src={url} alt="" className="symbol-preview" /> : <span className="symbol-preview" />;
}
function SymbolsPanel({ action, done }: { action?: 'new' | 'unlink'; done: () => void }) {
  const { document, selectedIds, dispatch, commitEdit, setMessage, setSelection, viewport } = useEditor();
  const symbols = document.symbols ?? [], [active, setActive] = useState<string | null>(null), [name, setName] = useState('');
  const instance = document.objects.find(o => o.symbol && selectedIds.includes(o.id))?.symbol, symbol = symbols.find(s => s.id === (active ?? instance?.id));
  const commit = (run: () => void, message: string) => { finishEditing(); try { commitEdit(); run(); commitEdit(); setMessage(message); } catch (e) { setMessage(e instanceof Error ? e.message : 'Não foi possível concluir.'); } };
  const create = () => commit(() => { const r = createSymbol(document.objects, selectedIds, name || `Símbolo ${symbols.length + 1}`); dispatch({ type: 'set-library', symbols: [...symbols, r.symbol], document: { objects: r.objects, pages: document.pages, page: document.page } }); setSelection(r.ids); setActive(r.symbol.id); setName(''); }, 'Símbolo criado; a seleção é a primeira instância.');
  const unlink = () => commit(() => dispatch({ type: 'set-objects', objects: unlinkSymbol(document.objects, selectedIds) }), 'Vínculo quebrado: as partes ficam como um grupo comum.');
  useEffect(() => { if (action === 'new' && selectedIds.length && !instance) create(); else if (action === 'unlink' && instance) unlink(); if (action) done(); }, [action]);
  const insert = () => { if (!symbol) return; const el = window.document.querySelector('.canvas-viewport')?.getBoundingClientRect(); const center = el ? screenToDocument(viewport, el.width / 2, el.height / 2) : { x: document.artboard.width / 2, y: document.artboard.height / 2 };
    commit(() => { const r = insertSymbol(document.objects, symbol, center); dispatch({ type: 'set-objects', objects: r.objects }); setSelection(r.ids); }, `Instância de “${symbol.name}” inserida.`); };
  const update = () => { if (!instance) return; const pieces = document.objects.filter(o => o.symbol?.instance === instance.instance);
    commit(() => { const r = updateSymbol(document, pieces); dispatch({ type: 'set-library', symbols: r.symbols, document: r.document }); }, 'Símbolo atualizado em todas as instâncias (todas as páginas).'); };
  return <>
    <p className="muted">Símbolos reutilizam o mesmo desenho: edite uma instância e use “Atualizar símbolo” para mudar todas.</p>
    <ul className="library-list symbol-list" role="listbox" aria-label="Símbolos do documento">{symbols.length ? symbols.map(s => <li key={s.id} role="option" aria-selected={s.id === symbol?.id} className={s.id === symbol?.id ? 'active' : ''} onClick={() => setActive(s.id)} onDoubleClick={insert}>
      <SymbolPreview symbol={s} /><span><strong>{s.name}</strong><small>{symbolUsage(document, s.id)} instância(s)</small></span></li>) : <li className="muted">Nenhum símbolo. Selecione objetos e use “Novo símbolo”.</li>}</ul>
    <label className="settings-row">Nome<input type="text" value={name} placeholder="Ex.: Logotipo, Carimbo" onChange={e => setName(e.target.value)} /></label>
    <div className="library-actions">
      <button type="button" disabled={!selectedIds.length || !!instance} title={instance ? 'A seleção já é um símbolo' : 'Converte a seleção em símbolo'} onClick={create}>Novo símbolo</button>
      <button type="button" className="primary" disabled={!symbol} title="Insere no centro da vista (duplo clique na lista também)" onClick={insert}>Inserir</button>
      <button type="button" disabled={!instance} onClick={update}>Atualizar símbolo pela instância</button>
      <button type="button" disabled={!instance} onClick={unlink}>Quebrar vínculo</button>
      <button type="button" disabled={!symbol || !name.trim()} onClick={() => { if (symbol) commit(() => dispatch({ type: 'set-library', symbols: symbols.map(s => s.id === symbol.id ? { ...s, name: name.trim().slice(0, 256) } : s) }), 'Símbolo renomeado.'); setName(''); }}>Renomear</button>
      <button type="button" disabled={!symbol} onClick={() => { if (!symbol) return; commit(() => { const r = deleteSymbol(document, symbol.id); dispatch({ type: 'set-library', symbols: r.symbols, document: r.document }); }, `Símbolo “${symbol.name}” excluído; as instâncias viram grupos comuns.`); setActive(null); }}>Excluir símbolo</button>
    </div>
  </>;
}

/** Estilos de cor (Ctrl+F6): cores com nome; mudar a cor do estilo muda todos os objetos ligados, em todas as páginas. */
function ColorStylesPanel() {
  const { document, selectedIds, dispatch, beginEdit, commitEdit, setMessage } = useEditor();
  const styles = document.colorStyles ?? [], [active, setActive] = useState<string | null>(null), [name, setName] = useState('');
  const style = styles.find(s => s.id === active), selected = document.objects.filter(o => selectedIds.includes(o.id));
  const save = (result: { colorStyles: ColorStyle[]; document?: Pick<VectorDocument, 'objects' | 'pages' | 'page'> }, message: string) => { finishEditing(); commitEdit(); dispatch({ type: 'set-library', colorStyles: result.colorStyles, document: result.document }); commitEdit(); setMessage(message); };
  const apply = (part: 'fill' | 'stroke') => { if (!style) return; save({ colorStyles: styles, document: { objects: document.objects.map(o => selectedIds.includes(o.id) ? paintWith(o, part, style) : o), pages: document.pages, page: document.page } }, `“${style.name}” aplicado ao ${part === 'fill' ? 'preenchimento' : 'contorno'} de ${selected.length} objeto(s).`); };
  // Edição ao vivo: uma etapa do Desfazer por gesto no seletor de cor.
  const recolor = (color: string) => { if (!style) return; try { const r = recolorStyle(document, style.id, color); beginEdit(); dispatch({ type: 'set-library', colorStyles: r.colorStyles, document: r.document }); } catch (e) { setMessage(e instanceof Error ? e.message : 'Não foi possível mudar a cor.'); } };
  return <>
    <p className="muted">Cores com nome. Mudar a cor do estilo muda todos os objetos ligados (todas as páginas); trocar a cor de um objeto por outro meio desfaz o vínculo dele.</p>
    <ul className="library-list" role="listbox" aria-label="Estilos de cor do documento">{styles.length ? styles.map(s => <li key={s.id} role="option" aria-selected={s.id === active} className={s.id === active ? 'active' : ''} onClick={() => setActive(s.id)}>
      <span className="style-swatch" style={{ background: s.color }} />
      <span><strong>{s.name}</strong><small>{s.color.toUpperCase()} · {colorStyleUsage(document, s)} objeto(s)</small></span></li>) : <li className="muted">Nenhum estilo de cor. Selecione objetos e use “Novo a partir da seleção”.</li>}</ul>
    {style && <div className="color-style-editor" onPointerUp={() => commitEdit()} onKeyUp={() => commitEdit()} onBlur={() => commitEdit()}><ColorPicker value={style.color} onChange={recolor} label={`Cor de ${style.name}`} /></div>}
    <label className="settings-row">Nome<input type="text" value={name} placeholder="Ex.: Verde da marca, Corte, Vinco" onChange={e => setName(e.target.value)} /></label>
    <div className="library-actions">
      <button type="button" disabled={!selected.length} title="Cria um estilo para cada cor (preenchimento e contorno) dos objetos selecionados e liga os objetos" onClick={() => { try { const r = stylesFromSelection(document, selectedIds); if (!r.linked) { setMessage('A seleção não tem cores sólidas de preenchimento ou contorno.'); return; } save(r, `${r.created.length} estilo(s) de cor criado(s); ${r.linked} cor(es) ligada(s).`); if (r.created[0]) setActive(r.created[0].id); } catch (e) { setMessage(e instanceof Error ? e.message : 'Não foi possível criar.'); } }}>Novo a partir da seleção</button>
      <button type="button" onClick={() => { const st: ColorStyle = { id: crypto.randomUUID(), name: name.trim().slice(0, 256) || `Estilo de cor ${styles.length + 1}`, color: '#1f6fd1' }; save({ colorStyles: [...styles, st] }, `Estilo de cor “${st.name}” criado.`); setActive(st.id); setName(''); }}>Novo</button>
      <button type="button" className="primary" disabled={!style || !selected.length} onClick={() => apply('fill')}>Aplicar ao preenchimento</button>
      <button type="button" disabled={!style || !selected.length} onClick={() => apply('stroke')}>Aplicar ao contorno</button>
      <button type="button" disabled={!style || !name.trim()} onClick={() => { if (!style) return; save({ colorStyles: styles.map(s => s.id === style.id ? { ...s, name: name.trim().slice(0, 256) } : s) }, 'Estilo de cor renomeado.'); setName(''); }}>Renomear</button>
      <button type="button" disabled={!style} onClick={() => { if (!style) return; save(deleteColorStyle(document, style.id), `Estilo de cor “${style.name}” excluído; os objetos mantêm a cor.`); setActive(null); }}>Excluir estilo</button>
    </div>
  </>;
}
