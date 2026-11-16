import { useEffect, useId, useState, type Dispatch, type SetStateAction } from 'react';
import type { VectorDocument } from '../document/model';
import type { Viewport } from '../document/viewport';
import { ZoomIn, ZoomOut, ScanSearch, Scan, FileText, MoveHorizontal, MoveVertical } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { boundsOf, clipContents, type Bounds } from '../geometry/objectTransforms';
import { fitBounds, zoomAt } from '../document/viewport';
import { isHidden } from '../document/layers';
import { finishEditing } from '../state/useProjectFiles';

const levels = [10, 25, 50, 75, 100, 200, 400, 800, 1600, 3200];
/** Objetos visíveis (o conteúdo de PowerClip fica dentro do quadro e não conta). */
const visibleRoots = (document: VectorDocument) => document.objects.filter(o => !isHidden(document, o) && !o.clipParent);
/** Zoom em todos os objetos (F4 no CorelDRAW): enquadra tudo o que existe na página atual, dentro ou fora dela. */
export function zoomToAllObjects(document: VectorDocument, setViewport: Dispatch<SetStateAction<Viewport>>): boolean {
  const r = window.document.querySelector('.canvas-viewport')?.getBoundingClientRect(), objects = visibleRoots(document);
  if (!r || !objects.length) return false;
  finishEditing(); setViewport(fitBounds(r.width, r.height, boundsOf(objects)));
  return true;
}
/**
 * Barra de propriedades da ferramenta Zoom (CorelDRAW): níveis de zoom, mais zoom, menos zoom, zoom nos
 * selecionados, em todos os objetos, na página, na largura da página e na altura da página.
 */
export function ZoomControls() {
  const { document, selectedIds, viewport, setViewport } = useEditor();
  const listId = useId(), [text, setText] = useState(''), shown = `${Number((viewport.zoom * 100).toFixed(viewport.zoom < 1 ? 1 : 0))}%`;
  useEffect(() => setText(shown), [shown]);
  const area = () => window.document.querySelector('.canvas-viewport')?.getBoundingClientRect();
  const by = (factor: number) => { const r = area(); if (r) setViewport(v => zoomAt(v, r.width / 2, r.height / 2, v.zoom * factor)); };
  const to = (percent: number) => { const r = area(); if (r && percent > 0) setViewport(v => zoomAt(v, r.width / 2, r.height / 2, percent / 100)); };
  const fit = (b: Bounds | null, axis: 'both' | 'width' | 'height' = 'both') => { const r = area(); if (r && b) { finishEditing(); setViewport(fitBounds(r.width, r.height, b, axis)); } };
  const visible = visibleRoots(document);
  const selected = document.objects.filter(o => clipContents(document.objects, selectedIds).includes(o.id));
  const page = { x: 0, y: 0, width: document.artboard.width, height: document.artboard.height };
  const button = (label: string, Icon: typeof ZoomIn, run: () => void, disabled = false) => <button type="button" className="command-icon" aria-label={label} title={label} disabled={disabled} onClick={run}><Icon size={17} /></button>;
  return <span className="tool-options zoom-controls">
    <input className="zoom-level" list={listId} aria-label="Níveis de zoom" title="Níveis de zoom: escolha ou digite a porcentagem e tecle Enter" value={text}
      onChange={e => { setText(e.target.value); const v = Number(e.target.value.replace('%', '').replace(',', '.')); if (e.target.value.endsWith('%') && levels.includes(v)) to(v); }}
      onKeyDown={e => { if (e.key === 'Enter') { const v = Number(text.replace('%', '').replace(',', '.')); if (Number.isFinite(v) && v > 0) to(v); else setText(shown); e.currentTarget.blur(); } if (e.key === 'Escape') { setText(shown); e.currentTarget.blur(); } }}
      onBlur={() => setText(shown)} onFocus={e => e.currentTarget.select()} />
    <datalist id={listId}>{levels.map(v => <option key={v} value={`${v}%`} />)}</datalist>
    {button('Mais zoom', ZoomIn, () => by(2))}
    {button('Menos zoom', ZoomOut, () => by(0.5))}
    {button('Zoom nos selecionados', ScanSearch, () => fit(boundsOf(selected)), !selected.length)}
    {button('Zoom em todos os objetos (F4)', Scan, () => fit(boundsOf(visible)), !visible.length)}
    {button('Zoom na página', FileText, () => fit(page))}
    {button('Zoom na largura da página', MoveHorizontal, () => fit(page, 'width'))}
    {button('Zoom na altura da página', MoveVertical, () => fit(page, 'height'))}
  </span>;
}
