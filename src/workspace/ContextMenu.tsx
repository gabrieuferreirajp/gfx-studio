import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { MenuIcon } from './menuIcons';
export interface MenuItem { label: string; key?: string; run?: () => void; disabled?: boolean; checked?: boolean; submenu?: MenuItem[]; separator?: boolean }
export const menuSeparator: MenuItem = { label: '', separator: true };
function MenuList({ items, x, y, close, back, level }: { items: MenuItem[]; x: number; y: number; close: () => void; back?: () => void; level: number }) {
  const ref = useRef<HTMLDivElement>(null), buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [position, setPosition] = useState({ x, y }), [open, setOpen] = useState<{ index: number; focus: boolean } | null>(null);
  // Mantém o menu dentro da janela, abrindo para a esquerda/para cima quando necessário.
  useLayoutEffect(() => { const r = ref.current!.getBoundingClientRect(); setPosition({ x: x + r.width > innerWidth ? Math.max(0, innerWidth - r.width - 4) : x, y: y + r.height > innerHeight ? Math.max(0, innerHeight - r.height - 4) : y }); }, [x, y]);
  useEffect(() => { if (!level || back) buttons.current.find(b => b && !b.disabled)?.focus(); }, [level, back]);
  const enabled = () => buttons.current.filter((b): b is HTMLButtonElement => !!b && !b.disabled);
  const anchor = open ? buttons.current[open.index]?.getBoundingClientRect() : undefined, width = ref.current?.getBoundingClientRect().width ?? 250;
  return <>
    <div ref={ref} className="context-menu" role="menu" style={{ left: position.x, top: position.y }} onKeyDown={e => {
      const list = enabled(), index = list.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); list[(index + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus(); }
      if (e.key === 'ArrowLeft' && back) { e.preventDefault(); back(); }
    }}>
      {items.map((item, i) => item.separator ? <hr key={`s${i}`} role="separator" /> : <button key={item.label} ref={b => { buttons.current[i] = b; }} role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={item.checked} aria-haspopup={item.submenu ? 'menu' : undefined} aria-expanded={item.submenu ? open?.index === i : undefined} disabled={item.disabled}
        onPointerEnter={() => setOpen(item.submenu ? { index: i, focus: false } : null)}
        onKeyDown={e => { if (item.submenu && (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); setOpen({ index: i, focus: true }); } }}
        onClick={() => { if (item.submenu) { setOpen({ index: i, focus: true }); return; } close(); item.run?.(); }}>
        <MenuIcon label={item.label} checked={item.checked} /><span className="menu-label">{item.label}</span><kbd>{item.key}</kbd>{item.submenu ? <ChevronRight size={13} /> : <span />}
      </button>)}
    </div>
    {open && items[open.index]?.submenu && anchor && <MenuList key={open.index} items={items[open.index].submenu!} x={position.x + width - 3} y={anchor.top - 4} close={close} level={level + 1} back={open.focus ? () => { setOpen(null); buttons.current[open.index]?.focus(); } : undefined} />}
  </>;
}
/** Menu de contexto (botão direito), com submenus e navegação por teclado; Esc ou clique fora fecha. */
export function ContextMenu({ items, x, y, close }: { items: MenuItem[]; x: number; y: number; close: () => void }) {
  useEffect(() => {
    const away = (e: Event) => { if (!(e.target as Element).closest?.('.context-menu')) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key, true); window.addEventListener('blur', close); window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', close); window.removeEventListener('resize', close); };
  }, [close]);
  return <MenuList items={items} x={x} y={y} close={close} level={0} />;
}
