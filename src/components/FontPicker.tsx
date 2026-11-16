import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Star } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import type { VectorObject } from '../document/model';
import { updateText } from '../text/textLayout';
import { browserMeasure } from '../text/textMeasure';

const RECENT = 'vectorstudio:recent-fonts';
const readRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT) ?? '[]'); return Array.isArray(v) ? v.filter(f => typeof f === 'string').slice(0, 6) : []; } catch { return []; } };
const FAVORITES = 'vectorstudio:favorite-fonts';
const readFavorites = (): string[] => { try { const v = JSON.parse(localStorage.getItem(FAVORITES) ?? '[]'); return Array.isArray(v) ? v.filter(f => typeof f === 'string') : []; } catch { return []; } };
const saveFavorites = (list: string[]) => { try { localStorage.setItem(FAVORITES, JSON.stringify(list)); } catch { /* preferências indisponíveis */ } };
const saveRecent = (font: string) => { try { localStorage.setItem(RECENT, JSON.stringify([font, ...readRecent().filter(f => f !== font)].slice(0, 6))); } catch { /* preferências indisponíveis */ } };

/**
 * Lista de fontes como no CorelDRAW: fontes usadas recentemente no topo e depois todas, em ordem alfabética, cada
 * nome escrito na própria fonte. Ao passar o mouse, o texto selecionado muda na hora (sem entrar no Desfazer) e um
 * quadro ao lado mostra a amostra grande. Clique confirma; Esc ou sair da lista volta à fonte de antes.
 * A ordem da lista fica parada enquanto ela está aberta (a prévia não mexe nos itens). Digitar filtra.
 */
export function FontPicker({ value, families, texts, choose }: { value: string; families: string[]; texts: VectorObject[]; choose: (font: string) => void }) {
  const { document, amend } = useEditor();
  const [open, setOpen] = useState<{ left: number; top: number; maxHeight: number; current: string; recent: string[] } | null>(null);
  const [filter, setFilter] = useState(''), [hover, setHover] = useState<{ font: string; top: number } | null>(null);
  // Favoritas (estrela, como no Photoshop): ficam no topo e podem ser mostradas sozinhas.
  const [favorites, setFavorites] = useState<string[]>(readFavorites), [onlyFavorites, setOnlyFavorites] = useState(false);
  const toggleFavorite = (font: string) => setFavorites(list => { const next = list.includes(font) ? list.filter(f => f !== font) : [...list, font].sort((a, b) => a.localeCompare(b, 'pt-BR')); saveFavorites(next); return next; });
  const original = useRef<VectorObject[] | null>(null), root = useRef<HTMLSpanElement>(null), list = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const ids = useMemo(() => new Set(texts.map(t => t.id)), [texts]);
  const sample = texts[0]?.text?.split('\n')[0]?.slice(0, 40) || 'AaBbCcDd 0123';
  const restore = () => { if (original.current) amend({ type: 'set-objects', objects: original.current }); };
  const close = () => { restore(); original.current = null; setOpen(null); setFilter(''); setHover(null); };
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    list.current?.querySelector('.current')?.scrollIntoView({ block: 'center' });
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); };
  }, [!!open]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = (font: string, el: HTMLElement) => {
    setHover({ font, top: el.getBoundingClientRect().top });
    if (original.current && ids.size) amend({ type: 'set-objects', objects: original.current.map(o => ids.has(o.id) ? updateText(o, { fontFamily: font }, browserMeasure) : o) });
  };
  const pick = (font: string) => { restore(); original.current = null; setOpen(null); setFilter(''); setHover(null); saveRecent(font); choose(font); };
  // Lista parada: a fonte de quando abriu, as recentes e todas em ordem alfabética.
  const all = useMemo(() => [...new Set([...(open ? [open.current] : []), ...families])].sort((a, b) => a.localeCompare(b, 'pt-BR')), [families, open]);
  const match = (f: string) => !filter || f.toLowerCase().includes(filter.toLowerCase());
  const favs = favorites.filter(f => match(f) && all.includes(f)), recent = onlyFavorites ? [] : (open?.recent ?? []).filter(f => match(f) && all.includes(f)), shown = onlyFavorites ? [] : all.filter(match);
  const item = (f: string, key: string) => <div key={key} className="font-row">
    <button type="button" className={`font-star ${favorites.includes(f) ? 'on' : ''}`} aria-pressed={favorites.includes(f)} aria-label={favorites.includes(f) ? `Tirar ${f} das favoritas` : `Marcar ${f} como favorita`} title={favorites.includes(f) ? 'Tirar das favoritas' : 'Marcar como favorita'} onClick={() => toggleFavorite(f)}><Star size={13} /></button>
    <button type="button" role="option" aria-selected={f === open?.current} className={f === open?.current ? 'current' : ''} style={{ fontFamily: `"${f}"` }} title={f}
      onPointerEnter={e => preview(f, e.currentTarget)} onFocus={e => preview(f, e.currentTarget)} onClick={() => pick(f)}>{f}</button>
  </div>;
  return <span className="font-picker" ref={root}>
    <button type="button" className="font-picker-button" aria-haspopup="listbox" aria-expanded={!!open} aria-label={`Fonte: ${open?.current ?? value}`} title="Fonte (passe o mouse sobre a lista para ver no texto)" style={{ fontFamily: `"${open?.current ?? value}"` }}
      onClick={e => { if (open) { close(); return; } const r = e.currentTarget.getBoundingClientRect(); original.current = document.objects; setOpen({ left: r.left, top: r.bottom + 2, maxHeight: Math.max(240, window.innerHeight - r.bottom - 14), current: value, recent: readRecent() }); }}>
      <span>{open?.current ?? value}</span><ChevronDown size={13} />
    </button>
    {open && createPortal(<>
      <div ref={list} className="font-picker-list" role="listbox" aria-label="Fontes" style={{ left: open.left, top: open.top, maxHeight: open.maxHeight }} onPointerLeave={() => { restore(); setHover(null); }}>
        <div className="font-picker-top"><input ref={search} className="font-picker-search" placeholder="Procurar fonte…" aria-label="Procurar fonte" value={filter} onChange={e => setFilter(e.target.value)} onKeyDown={e => { const first = shown[0] ?? favs[0]; if (e.key === 'Enter' && first) { e.preventDefault(); pick(first); } }} />
        <button type="button" className={`font-star ${onlyFavorites ? 'on' : ''}`} aria-pressed={onlyFavorites} aria-label="Mostrar só as favoritas" title="Mostrar só as favoritas" onClick={() => setOnlyFavorites(v => !v)}><Star size={14} /></button></div>
        <div className="font-picker-items">
          {favs.length > 0 && <><span className="font-picker-group">Favoritas</span>{favs.map(f => item(f, `f-${f}`))}</>}
          {recent.length > 0 && <><span className="font-picker-group">Usadas recentemente</span>{recent.map(f => item(f, `r-${f}`))}</>}
          {(favs.length > 0 || recent.length > 0) && shown.length > 0 && <span className="font-picker-group">Todas as fontes</span>}
          {shown.map(f => item(f, f))}
          {!shown.length && !favs.length && <span className="font-picker-empty">{onlyFavorites ? 'Nenhuma favorita ainda: clique na estrela ao lado de uma fonte.' : 'Nenhuma fonte com esse nome.'}</span>}
        </div>
      </div>
      {hover && <div className="font-picker-sample" style={{ left: open.left + 284, top: Math.max(open.top, Math.min(hover.top - 20, window.innerHeight - 120)) }} aria-hidden="true">
        <span className="font-picker-sample-name">{hover.font}</span>
        <span className="font-picker-sample-text" style={{ fontFamily: `"${hover.font}"` }}>{sample}</span>
      </div>}
    </>, root.current?.closest('.app') ?? window.document.body)}
  </span>;
}
