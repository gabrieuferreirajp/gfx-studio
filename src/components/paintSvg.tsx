import type { VectorObject } from '../document/model';
import { arrowShapes, fillGradientGeometry, outerBox, strokePlacement, strokeStyle, strokeVisible } from '../document/paint';
import { commandsToSvg } from '../geometry/pathGeometry';
import { patternDef } from '../document/patterns';
import { svgTransform } from '../geometry/objectTransforms';

/** Degradê de preenchimento (linear ou elíptico) em coordenadas do documento, ou locais para textos. */
export function FillGradientDef({ object: o, local = false }: { object: VectorObject; local?: boolean }) {
  const g = fillGradientGeometry(o, local), id = `fgrad-${o.id}`;
  const stops = g.stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />);
  return o.fillGradient!.type === 'linear'
    ? <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={g.start.x} y1={g.start.y} x2={g.end.x} y2={g.end.y} spreadMethod={g.spread}>{stops}</linearGradient>
    : <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={g.start.x} cy={g.start.y} fx={g.start.x} fy={g.start.y} r={g.radius} spreadMethod={g.spread}>{stops}</radialGradient>;
}
export const fillValue = (o: VectorObject) => o.fillPattern ? `url(#fpat-${o.id})` : o.fillGradient ? `url(#fgrad-${o.id})` : o.fill;
/** Padrão de preenchimento (duas cores ou bitmap) como definição SVG. */
export const PatternDef = ({ object, local = false }: { object: VectorObject; local?: boolean }) => <defs dangerouslySetInnerHTML={{ __html: patternDef(object, local) }} />;
/**
 * Caminho com a caneta de contorno do CorelDRAW: contorno no centro, dentro (recortado pela forma) ou fora
 * (mascarado), atrás ou na frente do preenchimento, e pontas de seta na cor do contorno.
 */
export function PaintedPath({ object: o, d, paint }: { object: VectorObject; d: string; paint: 'all' | 'fill' | 'stroke' }) {
  const rule = o.fillRule ?? 'nonzero', w = o.strokeWidth ?? 0, place = strokePlacement(o);
  // Malha: imagem gerada esticada sobre a caixa local do objeto e recortada pela forma.
  const fill = paint !== 'stroke' && (o.meshFill ? <g key="fill"><clipPath id={`mclip-${o.id}`}><path d={d} clipRule={rule} /></clipPath><path d={d} fill="transparent" /><image href={o.meshFill.src} x={o.x} y={o.y} width={o.width} height={o.height} preserveAspectRatio="none" transform={svgTransform(o)} clipPath={`url(#mclip-${o.id})`} /></g> : <path key="fill" d={d} fill={fillValue(o)} fillRule={rule} stroke="none" />);
  let stroke = null;
  if (paint !== 'fill' && strokeVisible(o)) {
    const common = { d, fill: 'none', stroke: o.stroke, pointerEvents: 'none' as const, ...strokeStyle(o) };
    if (place === 'center') stroke = <path key="stroke" {...common} strokeWidth={w} />;
    else if (place === 'inside') stroke = <g key="stroke"><clipPath id={`sclip-${o.id}`}><path d={d} clipRule={rule} /></clipPath><path {...common} strokeWidth={w * 2} clipPath={`url(#sclip-${o.id})`} /></g>;
    else { const b = outerBox(o); stroke = <g key="stroke"><mask id={`smask-${o.id}`} maskUnits="userSpaceOnUse" x={b.x} y={b.y} width={b.width} height={b.height}><rect x={b.x} y={b.y} width={b.width} height={b.height} fill="white" /><path d={d} fill="black" fillRule={rule} /></mask><path {...common} strokeWidth={w * 2} mask={`url(#smask-${o.id})`} /></g>; }
  }
  const arrows = paint !== 'fill' && arrowShapes(o).map((a, i) => <path key={`arrow-${i}`} d={commandsToSvg(a)} fill={o.stroke} pointerEvents="none" />);
  return <>{o.fillGradient && paint !== 'stroke' && <FillGradientDef object={o} />}{o.fillPattern && paint !== 'stroke' && <PatternDef object={o} />}{o.strokeBehind ? [stroke, fill] : [fill, stroke]}{arrows}</>;
}
