import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { importSvg } from '../io/svgImport';
import { browserMeasure } from '../text/textMeasure';
import { screenToDocument } from '../document/viewport';
import { applyMatrix, boundsOf, translate } from '../geometry/objectTransforms';
import { shapeCategories, shapeLibrary, shapeSvg, type LibraryShape } from './shapeLibrary';

const SIZE = 40 * 96 / 25.4; // 40 mm
/** Converte a forma da biblioteca em objetos editáveis, centrados no ponto (agrupados quando há várias partes). */
export function libraryObjects(shape: LibraryShape, center: { x: number; y: number }, fill: string, outline: string, outlineWidth: number) {
  let objects = importSvg(shapeSvg(shape, SIZE, fill, outline, outlineWidth), { measure: browserMeasure }).objects.map(o => ({ ...o, name: shape.name }));
  const b = boundsOf(objects);
  objects = applyMatrix(objects, objects.map(o => o.id), translate(center.x - b.x - b.width / 2, center.y - b.y - b.height / 2));
  if (objects.length > 1) { const group = crypto.randomUUID(); objects = objects.map(o => ({ ...o, groupPath: [group] })); }
  return objects;
}
/** Formas personalizadas (caixa de ferramentas › Polígono): galeria com busca; o clique coloca a forma no centro da vista. */
export function ShapeGallery({ x, y, close }: { x: number; y: number; close: () => void }) {
  const { viewport, fill, outline, outlineWidth, addObjects, setMessage } = useEditor();
  const [category, setCategory] = useState(shapeCategories[0]), [query, setQuery] = useState('');
  useEffect(() => {
    const away = (e: Event) => { if (!(e.target as Element).closest?.('.shape-gallery')) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    setTimeout(() => window.addEventListener('pointerdown', away));
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', key); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const shown = useMemo(() => { const q = query.trim().toLocaleLowerCase('pt-BR'); return shapeLibrary.filter(s => q ? s.name.toLocaleLowerCase('pt-BR').includes(q) : s.category === category); }, [category, query]);
  function insert(shape: LibraryShape) {
    const area = window.document.querySelector('.canvas-viewport')?.getBoundingClientRect();
    const center = area ? screenToDocument(viewport, area.width / 2, area.height / 2) : { x: 200, y: 200 };
    addObjects(libraryObjects(shape, center, fill, outline, outlineWidth));
    setMessage(`${shape.name} inserido no centro da vista. Use as alças para ajustar o tamanho.`);
    close();
  }
  return <div className="shape-gallery effects-flyout" role="dialog" aria-label="Formas personalizadas" style={{ left: x, top: Math.max(8, Math.min(y, window.innerHeight - 470)) }}>
    <header><strong>Formas personalizadas</strong><button type="button" aria-label="Fechar formas personalizadas" onClick={close}><X size={14} /></button></header>
    <label className="shape-search"><Search size={14} aria-hidden="true" /><input autoFocus placeholder="Buscar forma ou ícone…" aria-label="Buscar forma ou ícone" value={query} onChange={e => setQuery(e.target.value)} /></label>
    {!query && <div className="shape-tabs" role="tablist">{shapeCategories.map(c => <button key={c} type="button" role="tab" aria-selected={c === category} className={c === category ? 'active' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div>}
    <div className="shape-grid">{shown.map(s => { const Icon = s.icon; return <button key={s.name} type="button" title={s.name} aria-label={`Inserir ${s.name}`} onClick={() => insert(s)}>
      {Icon ? <Icon size={26} strokeWidth={1.6} /> : <svg viewBox="0 0 100 100" width="28" height="28" aria-hidden="true"><path d={s.d} fillRule={s.evenodd ? 'evenodd' : 'nonzero'} /></svg>}
      <span>{s.name}</span></button>; })}
      {!shown.length && <p className="shape-empty">Nenhuma forma encontrada.</p>}</div>
  </div>;
}
