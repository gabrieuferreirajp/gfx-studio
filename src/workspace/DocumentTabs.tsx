import { useEffect, useState } from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Home, Plus, X } from 'lucide-react';
import { useWelcome, welcome } from './WelcomeScreen';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { activePage, pageList } from '../document/pages';
import type { MenuItem } from './ContextMenu';

const openMenu = (x: number, y: number, items: MenuItem[]) => window.dispatchEvent(new CustomEvent('vectorstudio:context-menu', { detail: { x, y, items } }));

/** Abas de documentos acima da área de desenho (como no CorelDRAW). */
export function DocumentTabs({ newDocument }: { newDocument: () => void }) {
  const editor = useEditor(), { activeTab, switchTab, closeTab } = editor, tabs = editor.tabs.filter(t => !t.blank), home = useWelcome() || !tabs.length;
  useEffect(() => { const hide = () => welcome.set(false); window.addEventListener('vectorstudio:welcome-close', hide); return () => window.removeEventListener('vectorstudio:welcome-close', hide); }, []);
  const title = (name: string) => name.replace(/\.(?:gfxs|vectorstudio)$/i, '');
  return <div className="document-tabs" role="tablist" aria-label="Documentos abertos">
    <div role="tab" aria-selected={home} tabIndex={0} className={`document-tab welcome-tab ${home ? 'active' : ''}`} title="Tela de boas-vindas" onClick={() => { finishEditing(); welcome.set(true); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); welcome.set(true); } }}><Home size={13} /><span className="document-tab-name">Tela de boas-vindas</span></div>
    {tabs.map(tab => <div key={tab.id} role="tab" aria-selected={!home && tab.id === activeTab} tabIndex={0} className={`document-tab ${!home && tab.id === activeTab ? 'active' : ''}`} title={tab.file?.path ?? `${title(tab.name)} (não salvo)`}
      onClick={() => { finishEditing(); welcome.set(false); switchTab(tab.id); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(tab.id); } }}
      onAuxClick={e => { if (e.button === 1) { e.preventDefault(); finishEditing(); closeTab(tab.id); } }}
      onContextMenu={e => { e.preventDefault(); openMenu(e.clientX, e.clientY, [{ label: 'Fechar', run: () => { finishEditing(); closeTab(tab.id); } }, { label: 'Fechar os outros', disabled: tabs.length < 2, run: () => { finishEditing(); for (const other of tabs) if (other.id !== tab.id && !closeTab(other.id)) break; } }]); }}>
      <span className="document-tab-name">{title(tab.name)}{tab.dirty ? ' *' : ''}</span>
      <button className="document-tab-close" aria-label={`Fechar ${title(tab.name)}`} title="Fechar (botão do meio também fecha)" onClick={e => { e.stopPropagation(); finishEditing(); closeTab(tab.id); }}><X size={12} /></button>
    </div>)}
    <button className="document-tab-new" aria-label="Novo documento" title="Novo documento (Ctrl+N)" onClick={() => { welcome.set(false); newDocument(); }}><Plus size={14} /></button>
  </div>;
}

/** Navegador de páginas da barra inferior: primeira/anterior/próxima/última, "+" adiciona e abas de página. */
export function PageNavigator() {
  const { document, goToPage, pageCommand } = useEditor();
  const pages = pageList(document), active = activePage(document), last = pages.length - 1;
  const [renaming, setRenaming] = useState<number | null>(null);
  useEffect(() => { const rename = () => setRenaming(activePage(document)); window.addEventListener('vectorstudio:rename-page', rename); return () => window.removeEventListener('vectorstudio:rename-page', rename); }, [document]);
  const go = (index: number) => { finishEditing(); goToPage(index); };
  const command = (run: () => void) => () => { finishEditing(); run(); };
  const pageMenu = (index: number): MenuItem[] => [
    { label: 'Renomear página…', run: () => setRenaming(index) },
    { label: 'Inserir página depois', run: command(() => pageCommand('insert-after', { index })) },
    { label: 'Inserir página antes', run: command(() => pageCommand('insert-before', { index })) },
    { label: 'Duplicar página', run: command(() => pageCommand('duplicate', { index })) },
    { label: 'Excluir página', disabled: pages.length < 2, run: command(() => { if (!pages[index].objects.length || window.confirm(`Excluir "${pages[index].name}" e todos os seus objetos?`)) pageCommand('delete', { index }); }) },
    { label: 'Mover para a esquerda', disabled: index === 0, run: command(() => pageCommand('move', { index, to: index - 1 })) },
    { label: 'Mover para a direita', disabled: index === last, run: command(() => pageCommand('move', { index, to: index + 1 })) },
  ];
  return <nav className="page-navigator" aria-label="Navegador de páginas">
    <button aria-label="Inserir página antes da primeira" title="Inserir página no início" onClick={command(() => pageCommand('insert-before', { index: 0 }))}><Plus size={12} /></button>
    <button aria-label="Primeira página" title="Primeira página" disabled={active === 0} onClick={() => go(0)}><ChevronFirst size={13} /></button>
    <button aria-label="Página anterior" title="Página anterior (Page Up)" disabled={active === 0} onClick={() => go(active - 1)}><ChevronLeft size={13} /></button>
    <span className="page-counter" aria-live="polite">{active + 1} de {pages.length}</span>
    {/* Na última página, o botão "próxima" vira "adicionar página", como no CorelDRAW. */}
    {active === last
      ? <button aria-label="Adicionar página depois desta" title="Adicionar página" onClick={command(() => pageCommand('insert-after'))}><Plus size={12} /></button>
      : <button aria-label="Próxima página" title="Próxima página (Page Down)" onClick={() => go(active + 1)}><ChevronRight size={13} /></button>}
    <button aria-label="Última página" title="Última página" disabled={active === last} onClick={() => go(last)}><ChevronLast size={13} /></button>
    <button aria-label="Inserir página depois da última" title="Inserir página no final" onClick={command(() => pageCommand('insert-after', { index: last }))}><Plus size={12} /></button>
    <div className="page-tabs" role="tablist" aria-label="Páginas">
      {pages.map((page, index) => renaming === index
        ? <input key={page.id} className="page-rename" aria-label="Nome da página" autoFocus defaultValue={page.name} maxLength={256}
          onFocus={e => e.currentTarget.select()} onBlur={e => { setRenaming(null); if (e.currentTarget.value.trim() && e.currentTarget.value !== page.name) pageCommand('rename', { index, name: e.currentTarget.value }); }}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = page.name; e.currentTarget.blur(); } }} />
        : <button key={page.id} role="tab" aria-selected={index === active} className={`page-tab ${index === active ? 'active' : ''}`} title={`${page.name} · Duplo clique renomeia · Botão direito: mais opções`}
          onClick={() => go(index)} onDoubleClick={() => setRenaming(index)} onContextMenu={e => { e.preventDefault(); openMenu(e.clientX, e.clientY, pageMenu(index)); }}>{page.name}</button>)}
    </div>
  </nav>;
}
/** Itens do menu Layout (páginas). */
export function pageMenuItems(editor: ReturnType<typeof useEditor>) {
  const { document, pageCommand, goToPage } = editor, pages = pageList(editor.document), active = activePage(document);
  return [
    { label: 'Inserir página (depois desta)', run: () => pageCommand('insert-after') },
    { label: 'Inserir página antes desta', run: () => pageCommand('insert-before') },
    { label: 'Duplicar página', run: () => pageCommand('duplicate') },
    { label: 'Renomear página…', run: () => window.dispatchEvent(new Event('vectorstudio:rename-page')) },
    { label: 'Excluir página', disabled: pages.length < 2, run: () => { if (!document.objects.length || window.confirm(`Excluir "${pages[active].name}" e todos os seus objetos?`)) pageCommand('delete'); } },
    { label: 'Ir para a página anterior', key: 'PgUp', disabled: active === 0, run: () => goToPage(active - 1) },
    { label: 'Ir para a próxima página', key: 'PgDn', disabled: active === pages.length - 1, run: () => goToPage(active + 1) },
  ];
}
