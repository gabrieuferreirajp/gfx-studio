import { Fragment, useEffect, useRef, useState } from 'react';
import { SquareStack, Layers, Blend, Sparkles, Expand, Box, Contrast } from 'lucide-react';
import type { EffectKind } from '../geometry/effects';
import { openEffect } from '../workspace/EffectsDialog';
import { MousePointer2, Square, Circle, Trash2, Minus, PenTool, PenLine, Waypoints, Activity, Tangent, ZoomIn, Hand, Pencil, Pentagon, Star, Shell, Grid3x3, Pipette, Ruler } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { Shapes } from 'lucide-react';
import { ShapeGallery } from '../workspace/ShapeGallery';
import { SocialMediaDialog } from '../workspace/SocialMediaDialog';
import { createObject, type Tool } from '../document/model';
import { NodeToolIcon, LayerMaskIcon, DropShadowIcon, TransparencyIcon, SocialMediaIcon, TextToolIcon } from './ToolIcons';
import { Stamp } from 'lucide-react';
import { Crop, Slice, ScissorsLineDashed, Eraser, Frame, Rotate3d, Grid2x2, MoveHorizontal, DraftingCompass, Scaling, MessageSquareText, PaintBucket, Cable, CornerDownRight, Route, Lasso } from 'lucide-react';
// Atalhos e agrupamento seguem a caixa de ferramentas do CorelDRAW (F5–F10, Y, A, D, Z, H).
// `flyout`: ferramentas que dividem o mesmo botão (menu suspenso com triângulo, como no Corel).
export const toolItems = [
  { id: 'select', label: 'Seleção', key: 'V', icon: MousePointer2, group: 0, flyout: 'select' },
  { id: 'nodes', label: 'Forma (editar nós)', key: 'F10', icon: NodeToolIcon, group: 0, flyout: 'nodes' },
  { id: 'crop', label: 'Cortar', key: '', icon: Crop, group: 0, flyout: 'crop' },
  { id: 'knife', label: 'Faca', key: '', icon: Slice, group: 0, flyout: 'crop' },
  { id: 'lasso', label: 'Laço poligonal (cortar)', key: '', icon: Lasso, group: 0, flyout: 'crop' },
  { id: 'virtualDelete', label: 'Excluir segmento virtual', key: '', icon: ScissorsLineDashed, group: 0, flyout: 'crop' },
  { id: 'eraser', label: 'Borracha', key: 'X', icon: Eraser, group: 0, flyout: 'crop' },
  { id: 'zoom', label: 'Zoom', key: 'Z', icon: ZoomIn, group: 1, flyout: 'zoom' },
  { id: 'pan', label: 'Mão (mover vista)', key: 'H', icon: Hand, group: 1, flyout: 'zoom' },
  { id: 'line', label: 'Linha de dois pontos', key: '', icon: Minus, group: 2, flyout: 'curve' },
  { id: 'freehand', label: 'Mão livre', key: 'F5', icon: Pencil, group: 2, flyout: 'curve' },
  { id: 'pen', label: 'Bézier', key: '', icon: PenTool, group: 2, flyout: 'curve' },
  { id: 'pentool', label: 'Caneta', key: '', icon: PenLine, group: 2, flyout: 'curve' },
  { id: 'bspline', label: 'B-Spline', key: '', icon: Waypoints, group: 2, flyout: 'curve' },
  { id: 'polyline', label: 'Polilinha', key: '', icon: Activity, group: 2, flyout: 'curve' },
  { id: 'threepoint', label: 'Curva de 3 pontos', key: '', icon: Tangent, group: 2, flyout: 'curve' },
  { id: 'rectangle', label: 'Retângulo', key: 'F6', icon: Square, group: 3, flyout: 'rectangle' },
  { id: 'ellipse', label: 'Elipse', key: 'F7', icon: Circle, group: 3, flyout: 'ellipse' },
  { id: 'polygon', label: 'Polígono', key: 'Y', icon: Pentagon, group: 4, flyout: 'polygon' },
  { id: 'star', label: 'Estrela', key: '', icon: Star, group: 4, flyout: 'polygon' },
  { id: 'spiral', label: 'Espiral', key: 'A', icon: Shell, group: 4, flyout: 'polygon' },
  { id: 'graph', label: 'Papel milimetrado', key: 'D', icon: Grid3x3, group: 4, flyout: 'polygon' },
  { id: 'text', label: 'Texto', key: 'F8', icon: TextToolIcon, group: 5, flyout: 'text' },
  { id: 'dimension', label: 'Dimensão paralela', key: '', icon: Ruler, group: 5, flyout: 'dimension' },
  { id: 'dimHV', label: 'Dimensão horizontal ou vertical', key: '', icon: MoveHorizontal, group: 5, flyout: 'dimension' },
  { id: 'dimAngle', label: 'Dimensão angular', key: '', icon: DraftingCompass, group: 5, flyout: 'dimension' },
  { id: 'dimSegment', label: 'Dimensão de segmento', key: '', icon: Scaling, group: 5, flyout: 'dimension' },
  { id: 'callout', label: 'Legenda de 3 pontos', key: '', icon: MessageSquareText, group: 5, flyout: 'dimension' },
  { id: 'connector', label: 'Conector reto', key: '', icon: Cable, group: 5, flyout: 'connector' },
  { id: 'elbowConnector', label: 'Conector de ângulo reto', key: '', icon: CornerDownRight, group: 5, flyout: 'connector' },
  { id: 'roundConnector', label: 'Conector de ângulo reto arredondado', key: '', icon: Route, group: 5, flyout: 'connector' },
  { id: 'envelope', label: 'Envelope', key: '', icon: Frame, group: 6, flyout: 'effects', inEffects: true },
  { id: 'perspective', label: 'Perspectiva', key: '', icon: Rotate3d, group: 6, flyout: 'effects', inEffects: true },
  { id: 'transparency', label: 'Transparência', key: '', icon: TransparencyIcon, group: 6, flyout: 'transparency' },
  { id: 'eyedropper', label: 'Conta-gotas de atributos', key: '', icon: Pipette, group: 6, flyout: 'eyedropper' },
  { id: 'mesh', label: 'Preenchimento de malha', key: 'M', icon: Grid2x2, group: 6, flyout: 'eyedropper' },
  { id: 'smartFill', label: 'Preenchimento inteligente', key: '', icon: PaintBucket, group: 6, flyout: 'eyedropper' },
  { id: 'maskBrush', label: 'Pincel de máscara', key: '', icon: LayerMaskIcon, group: 6, flyout: 'mask' },
  { id: 'cloneStamp', label: 'Carimbo (clonar bitmap)', key: 'S', icon: Stamp, group: 6, flyout: 'mask' },
  { id: 'dropShadow', label: 'Sombra', key: '', icon: DropShadowIcon, group: 6, flyout: 'effects', inEffects: true },
  { id: 'contour', label: 'Contorno', key: '', icon: Layers, group: 6, flyout: 'effects', inEffects: true },
  { id: 'blockShadow', label: 'Bloquear sombra', key: '', icon: Contrast, group: 6, flyout: 'effects', inEffects: true },
] as const;
type ToolItem = typeof toolItems[number];
// Sombra, Contorno, Bloquear sombra, Envelope e Perspectiva ficam só no botão Efeitos (acima da Transparência), sem botão repetido.
const boxItems = toolItems.filter(t => !('inEffects' in t));
const flyoutGroups = [...new Set(boxItems.map(t => t.flyout))].map(key => boxItems.filter(t => t.flyout === key));
const effectTools: string[] = toolItems.filter(t => 'inEffects' in t).map(t => t.id);
// Efeitos interativos (submenu da caixa de ferramentas do CorelDRAW): janelas de efeito ou ferramentas (Envelope, Perspectiva).
export type EffectItem = EffectKind | 'distort' | 'envelope' | 'perspective';
export const effectItems: [EffectItem, string, typeof SquareStack][] = [['shadow', 'Sombra', DropShadowIcon as unknown as typeof SquareStack], ['contour', 'Contorno', Layers], ['blend', 'Misturar', Blend], ['distort', 'Distorção', Sparkles], ['envelope', 'Envelope', Expand], ['perspective', 'Perspectiva', Rotate3d], ['extrude', 'Extrusão', Box], ['blockShadow', 'Bloquear sombra', Contrast]];
export const runEffectItem = (kind: EffectItem, setTool: (t: Tool) => void) => kind === 'shadow' ? setTool('dropShadow') : kind === 'contour' || kind === 'blockShadow' ? setTool(kind) : kind === 'envelope' || kind === 'perspective' ? setTool(kind) : kind === 'distort' ? window.dispatchEvent(new CustomEvent('vectorstudio:distort')) : openEffect(kind);
function useDismiss(close: () => void) {
  useEffect(() => { const away = (e: Event) => { if (!(e.target as Element).closest?.('.effects-flyout')) close(); }; const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; setTimeout(() => window.addEventListener('pointerdown', away)); window.addEventListener('keydown', key); return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', key); }; }, [close]);
}
export function EffectsFlyout({ x, y, close, chosen }: { x: number; y: number; close: () => void; chosen?: (kind: EffectItem) => void }) {
  useDismiss(close);
  const { setTool } = useEditor();
  return <div className="effects-flyout" role="menu" aria-label="Efeitos" style={{ left: x, top: y }}>{effectItems.map(([kind, label, Icon]) => <button key={label} role="menuitem" onClick={() => { close(); chosen?.(kind); runEffectItem(kind, setTool); }}><Icon size={16} />{label}</button>)}</div>;
}
/** Lista de um botão com várias ferramentas (ex.: Mão livre, Linha de dois pontos, Bézier, Caneta…). */
function ToolFlyout({ items, x, y, current, choose, close, extra }: { items: readonly ToolItem[]; x: number; y: number; current: Tool; choose: (item: ToolItem) => void; close: () => void; extra?: () => void }) {
  useDismiss(close);
  return <div className="effects-flyout tool-flyout" role="menu" style={{ left: x, top: y }}>{items.map(item => { const Icon = item.icon; return <button key={item.id} role="menuitemradio" aria-checked={current === item.id} className={current === item.id ? 'active' : ''} onClick={() => { close(); choose(item); }}><Icon size={16} />{item.label}<kbd>{item.key}</kbd></button>; })}{extra && <><hr /><button role="menuitem" aria-haspopup="dialog" onClick={() => { close(); extra(); }}><Shapes size={16} />Formas personalizadas…<kbd /></button></>}</div>;
}
export function Toolbar() {
  const { tool, setTool, selectedIds, removeSelected, document, fill, outline, outlineWidth, addObjects, setMessage } = useEditor();
  // Duplo clique na ferramenta Retângulo (CorelDRAW): retângulo do tamanho da página, alinhado a ela.
  const pageFrame = () => { const { width, height } = document.artboard; addObjects([{ ...createObject('rectangle', 0, 0, fill, outline), name: 'Retângulo da página', width, height, strokeWidth: outline === 'none' ? 0 : outlineWidth }]); setMessage('Retângulo do tamanho da página criado.'); };
  const [flyout, setFlyout] = useState<{ x: number; y: number } | null>(null);
  // Botão Efeitos: mostra o último efeito usado; clique repete, triângulo/botão direito/segurar abre a lista.
  const [lastEffect, setLastEffect] = useState<EffectItem | null>(null);
  const effectFor = (t: string): EffectItem | null => t === 'dropShadow' ? 'shadow' : t === 'contour' || t === 'blockShadow' || t === 'envelope' || t === 'perspective' ? t : null;
  const shownEffect = effectItems.find(([k]) => k === (effectFor(tool) ?? lastEffect)) ?? null;
  const openEffects = (element: Element) => { const r = element.getBoundingClientRect(); setFlyout({ x: r.right + 4, y: r.top }); };
  const EffectIcon = shownEffect?.[2] ?? (DropShadowIcon as unknown as typeof SquareStack);
  const effectsSlot = <span className="tool-slot" key="effects-slot">
    <button className={`tool-button ${flyout || effectTools.includes(tool) ? 'active' : ''}`} aria-label={`Efeitos${shownEffect ? `: ${shownEffect[1]}` : ''} (mais efeitos no menu)`} title={`${shownEffect ? `${shownEffect[1]} · ` : ''}Efeitos: sombra, contorno, misturar, distorção, envelope, perspectiva, extrusão, bloquear sombra · Clique no triângulo, segure ou use o botão direito para a lista`} aria-haspopup="menu" aria-expanded={!!flyout}
      onClick={e => { if (shownEffect) runEffectItem(shownEffect[0], setTool); else openEffects(e.currentTarget); }} onContextMenu={e => { e.preventDefault(); openEffects(e.currentTarget); }}
      onPointerDown={e => { const element = e.currentTarget; cancelHold(); hold.current = window.setTimeout(() => openEffects(element), 450); }} onPointerUp={() => cancelHold()} onPointerLeave={() => cancelHold()}><EffectIcon size={21} strokeWidth={1.7} /></button>
    <button className="tool-flyout-arrow" aria-label={`Outros efeitos: ${effectItems.map(([, l]) => l).join(', ')}`} aria-haspopup="menu" onClick={e => openEffects(e.currentTarget.parentElement!)}>◢</button></span>;
  // O botão de cada grupo mostra a última ferramenta escolhida nele.
  const [chosen, setChosen] = useState<Record<string, Tool>>({});
  const [toolFlyout, setToolFlyout] = useState<{ key: string; x: number; y: number } | null>(null);
  const [gallery, setGallery] = useState<{ x: number; y: number } | null>(null), [social, setSocial] = useState(false);
  const hold = useRef<number | null>(null);
  const openFlyout = (key: string, element: Element) => { const r = element.getBoundingClientRect(); setToolFlyout({ key, x: r.right + 4, y: r.top }); };
  const choose = (item: ToolItem) => { setChosen(c => ({ ...c, [item.flyout]: item.id as Tool })); setTool(item.id as Tool); };
  const cancelHold = () => { if (hold.current) { clearTimeout(hold.current); hold.current = null; } };
  return <aside className="toolbar" aria-label="Ferramentas"><div className="tool-group">{flyoutGroups.map((items, i) => {
    const key = items[0].flyout, active = items.find(t => t.id === tool), shown = active ?? items.find(t => t.id === chosen[key]) ?? items[0], Icon = shown.icon, many = items.length > 1;
    const title = (shown.key ? `${shown.label} (${shown.key})` : shown.label) + (shown.id === 'rectangle' ? ' · Duplo clique: retângulo do tamanho da página' : '');
    return <Fragment key={key}>{i > 0 && flyoutGroups[i - 1][0].group !== items[0].group && <span className="tool-separator" aria-hidden="true" />}
      {key === 'transparency' && effectsSlot}
      <span className="tool-slot"><button className={`tool-button ${active ? 'active' : ''}`} aria-label={many ? `${title} (mais ferramentas no menu)` : title} title={many ? `${title} · Segure, clique no triângulo ou use o botão direito para outras ferramentas` : title} aria-pressed={!!active}
        onClick={() => choose(shown)} onDoubleClick={() => { if (shown.id === 'rectangle') pageFrame(); }} onContextMenu={e => { if (!many) return; e.preventDefault(); openFlyout(key, e.currentTarget); }}
        onPointerDown={e => { if (!many) return; const element = e.currentTarget; cancelHold(); hold.current = window.setTimeout(() => openFlyout(key, element), 450); }} onPointerUp={cancelHold} onPointerLeave={cancelHold}><Icon size={21} strokeWidth={1.7} /></button>
        {many && <button className="tool-flyout-arrow" aria-label={`Outras ferramentas: ${items.map(t => t.label).join(', ')}`} aria-haspopup="menu" onClick={e => openFlyout(key, e.currentTarget.parentElement!)}>◢</button>}</span>
    </Fragment>;
  })}
    {toolFlyout && <ToolFlyout items={flyoutGroups.find(g => g[0].flyout === toolFlyout.key)!} x={toolFlyout.x} y={toolFlyout.y} current={tool} choose={choose} close={() => setToolFlyout(null)} extra={toolFlyout.key === 'polygon' ? () => setGallery({ x: toolFlyout.x, y: toolFlyout.y }) : undefined} />}
    {gallery && <ShapeGallery x={gallery.x} y={gallery.y} close={() => setGallery(null)} />}
    {flyout && <EffectsFlyout x={flyout.x} y={flyout.y} close={() => setFlyout(null)} chosen={setLastEffect} />}
    <span className="tool-separator" aria-hidden="true" />
    <button className={`tool-button ${social ? 'active' : ''}`} aria-label="Social media: tamanhos oficiais de redes sociais e carrossel" title="Social media: tamanhos oficiais (story 9:16, feed 4:5, 1:1, 1920×1080…) e carrossel" aria-pressed={social} onClick={() => setSocial(v => !v)}><SocialMediaIcon size={21} strokeWidth={1.7} /></button>
    {social && <SocialMediaDialog close={() => setSocial(false)} />}</div><div className="tool-bottom"><button className="tool-button danger" title="Excluir seleção (Delete)" aria-label="Excluir seleção" disabled={!selectedIds.length} onClick={removeSelected}><Trash2 size={20} /></button></div></aside>;
}
