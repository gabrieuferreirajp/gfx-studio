import type { FillGradient, GradientStop, PathCommand, VectorObject } from './model.ts';
import { gradientPoints } from './transparency.ts';
import { worldCommands } from '../geometry/worldGeometry.ts';
import { splitContours } from '../geometry/compoundPaths.ts';
import { objectCorners } from '../geometry/objectTransforms.ts';

/** Degradê padrão do CorelDRAW: da cor atual para o branco, da esquerda para a direita (ou do centro para fora). */
export function defaultFill(type: FillGradient['type'], from = '#000000', to = '#ffffff'): FillGradient {
  const stops = [{ offset: 0, color: from }, { offset: 1, color: to }];
  return type === 'linear' ? { type, x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops } : { type, x1: 0.5, y1: 0.5, x2: 1, y2: 0.5, stops };
}
const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = (values: number[]) => '#' + values.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export const mixColor = (a: string, b: string, t: number) => { const ca = channels(a), cb = channels(b); return toHex(ca.map((v, i) => v + (cb[i] - v) * t)); };
export const sortStops = (stops: GradientStop[]) => [...stops].sort((a, b) => a.offset - b.offset);
/** Cor e opacidade do degradê numa posição 0–1 (interpolação linear entre os pontos de cor). */
export function colorAt(stops: GradientStop[], t: number): GradientStop {
  const s = sortStops(stops);
  if (t <= s[0].offset) return { ...s[0], offset: t };
  for (let i = 1; i < s.length; i++) if (t <= s[i].offset) {
    const a = s[i - 1], b = s[i], k = b.offset - a.offset < 1e-9 ? 1 : (t - a.offset) / (b.offset - a.offset);
    return { offset: t, color: mixColor(a.color, b.color, k), opacity: (a.opacity ?? 1) + ((b.opacity ?? 1) - (a.opacity ?? 1)) * k };
  }
  return { ...s.at(-1)!, offset: t };
}
/**
 * Pontos efetivos do degradê: com Etapas, faixas de cor sólida (como no CorelDRAW);
 * com Aceleração, a transição é amostrada numa curva de potência.
 */
export function renderStops(g: FillGradient): GradientStop[] {
  const stops = sortStops(g.stops);
  if (g.steps && g.steps >= 2) {
    const out: GradientStop[] = [];
    for (let i = 0; i < g.steps; i++) { const c = colorAt(stops, ease(g, i / (g.steps - 1))); out.push({ ...c, offset: i / g.steps }, { ...c, offset: (i + 1) / g.steps }); }
    return out;
  }
  if (!g.acceleration) return stops;
  return Array.from({ length: 33 }, (_, i) => ({ ...colorAt(stops, ease(g, i / 32)), offset: i / 32 }));
}
const ease = (g: FillGradient, t: number) => g.acceleration ? Math.pow(t, Math.pow(2, -g.acceleration / 50)) : t;
/** Geometria do degradê no documento (acompanha mover, girar e escalar o objeto). */
export function fillGradientGeometry(o: VectorObject, local = false) {
  // Textos são desenhados dentro do grupo transformado: lá o degradê usa coordenadas locais.
  const g = o.fillGradient!, { start, end } = local ? { start: { x: o.x + g.x1 * o.width, y: o.y + g.y1 * o.height }, end: { x: o.x + g.x2 * o.width, y: o.y + g.y2 * o.height } } : gradientPoints(o, g);
  return { start, end, radius: Math.hypot(end.x - start.x, end.y - start.y) || 1, stops: renderStops(g), spread: g.spread ?? 'pad' };
}
/** Cor média aproximada (formatos sem degradê: EPS, DXF, PLT e a amostra da barra de status). */
export function averageFill(g: FillGradient) {
  const samples = Array.from({ length: 9 }, (_, i) => channels(colorAt(g.stops, i / 8).color));
  return toHex([0, 1, 2].map(i => samples.reduce((sum, c) => sum + c[i], 0) / samples.length));
}
/** Preenchimento sólido (paleta, conta-gotas…): remove o degradê. */
export function solidFill(o: VectorObject, color: string): VectorObject {
  const { fillGradient: _g, fillPattern: _p, meshFill: _m, ...rest } = o;
  return { ...rest, fill: color };
}
/** Preenchimento em degradê: `fill` guarda a primeira cor para quem só entende cor sólida. */
export function gradientFill(o: VectorObject, g: FillGradient): VectorObject {
  const { fillPattern: _p, meshFill: _m, ...rest } = o;
  return { ...rest, fill: sortStops(g.stops)[0].color, fillGradient: { ...g, stops: sortStops(g.stops) } };
}

/** Estilos de linha do CorelDRAW (traço e espaço em múltiplos da largura do contorno). */
export const dashStyles: number[][] = [[], [1, 1], [2, 2], [4, 2], [4, 4], [8, 4], [12, 4], [6, 2, 1, 2], [8, 3, 2, 3, 2, 3], [1, 3], [0.1, 2]];
export const strokeVisible = (o: VectorObject) => !!o.stroke && o.stroke !== 'none' && (o.strokeWidth ?? 0) > 0;
/** Atributos do contorno (nomes do React; o SVG exportado converte para hífens). Ausente = cantos e pontas arredondados. */
export function strokeStyle(o: VectorObject) {
  const w = o.strokeWidth ?? 0, dash = o.strokeDash?.length ? o.strokeDash.map(v => Number((v * Math.max(w, 0.5)).toFixed(4))).join(' ') : undefined;
  // Padrão do CorelDRAW: cantos em esquadria (retos) e extremidades retas; arredondado só quando escolhido.
  const join = o.strokeJoin ?? 'miter';
  return { strokeLinecap: o.strokeCap ?? 'butt', strokeLinejoin: join, ...(join === 'miter' ? { strokeMiterlimit: o.strokeMiter ?? 4 } : {}), ...(dash ? { strokeDasharray: dash } : {}) };
}
/** Posição do contorno efetiva: dentro/fora só em formas fechadas (como no CorelDRAW). */
export function strokePlacement(o: VectorObject): 'center' | 'inside' | 'outside' {
  if (!o.strokePosition || o.type === 'text' || o.type === 'image') return 'center';
  return worldCommands(o).some(c => c.type === 'Z') ? o.strokePosition : 'center';
}
/** Retângulo envolvente (com folga) para máscaras de contorno externo. */
export function outerBox(o: VectorObject) {
  const c = objectCorners(o), pad = (o.strokeWidth ?? 0) * 2 + 4, xs = c.map(p => p.x), ys = c.map(p => p.y);
  return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, width: Math.max(...xs) - Math.min(...xs) + 2 * pad, height: Math.max(...ys) - Math.min(...ys) + 2 * pad };
}

export const arrowKinds = { none: 'Nenhuma', triangle: 'Triângulo', barbed: 'Seta farpada', circle: 'Círculo', square: 'Quadrado', bar: 'Barra' } as const;
export type ArrowKind = keyof typeof arrowKinds;
export const isArrowKind = (value: unknown): value is ArrowKind => typeof value === 'string' && Object.hasOwn(arrowKinds, value) && value !== 'none';
type P = { x: number; y: number };
const K = 0.5523;
/** Pontas de seta (no documento) nas extremidades de caminhos abertos, preenchidas com a cor do contorno. */
export function arrowShapes(o: VectorObject): PathCommand[][] {
  if ((!o.arrowStart && !o.arrowEnd) || o.type === 'text' || o.type === 'image' || !strokeVisible(o)) return [];
  const contours = splitContours(worldCommands(o));
  if (!contours.length) return [];
  const first = contours[0], last = contours.at(-1)!, out: PathCommand[][] = [];
  const w = o.strokeWidth ?? 1, length = 6 + 3 * w, half = length * 0.4;
  const place = (kind: ArrowKind, tip: P, from: P) => {
    const d = Math.hypot(tip.x - from.x, tip.y - from.y);
    if (!d) return;
    const u = { x: (tip.x - from.x) / d, y: (tip.y - from.y) / d }, at = (a: number, b: number): P => ({ x: tip.x + u.x * a - u.y * b, y: tip.y + u.y * a + u.x * b });
    const poly = (points: P[]): PathCommand[] => [{ type: 'M', ...points[0] }, ...points.slice(1).map(p => ({ type: 'L' as const, ...p })), { type: 'Z' }];
    if (kind === 'triangle') out.push(poly([at(0, -half), at(length, 0), at(0, half)]));
    else if (kind === 'barbed') out.push(poly([at(-length * 0.15, -half), at(length, 0), at(-length * 0.15, half), at(length * 0.2, 0)]));
    else if (kind === 'square') { const s = half * 0.8; out.push(poly([at(-s, -s), at(s, -s), at(s, s), at(-s, s)])); }
    else if (kind === 'bar') { const t = Math.max(w, 1) * 0.75; out.push(poly([at(-t, -half), at(t, -half), at(t, half), at(-t, half)])); }
    else if (kind === 'circle') {
      const r = half * 0.75, c = (a: number, b: number) => at(a, b), p0 = c(r, 0), p1 = c(0, r), p2 = c(-r, 0), p3 = c(0, -r);
      const arc = (b: P, c1: P, c2: P): PathCommand => ({ type: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: b.x, y: b.y });
      out.push([{ type: 'M', ...p0 }, arc(p1, c(r, r * K), c(r * K, r)), arc(p2, c(-r * K, r), c(-r, r * K)), arc(p3, c(-r, -r * K), c(-r * K, -r)), arc(p0, c(r * K, -r), c(r, -r * K)), { type: 'Z' }]);
    }
  };
  const isOpen = (contour: PathCommand[]) => contour.at(-1)?.type !== 'Z';
  if (o.arrowStart && isOpen(first) && first.length > 1) {
    const m = first[0] as P, next = first[1];
    const toward = next.type === 'C' && Math.hypot(next.x1 - m.x, next.y1 - m.y) > 1e-6 ? { x: next.x1, y: next.y1 } : next as P;
    place(o.arrowStart, m, toward);
  }
  if (o.arrowEnd && isOpen(last) && last.length > 1) {
    const end = last.at(-1)!, prev = last.at(-2)!;
    if (end.type !== 'Z' && prev.type !== 'Z') {
      const from = end.type === 'C' && Math.hypot(end.x2 - end.x, end.y2 - end.y) > 1e-6 ? { x: end.x2, y: end.y2 } : prev as P;
      place(o.arrowEnd, end, from);
    }
  }
  return out;
}
/** Objetos que recebem cor: a seleção sem bitmaps; num PowerClip selecionado, só o quadro (não o conteúdo). */
export const paintTargets = (objects: VectorObject[], ids: string[]) => objects.filter(o => ids.includes(o.id) && o.type !== 'image' && (!o.clipParent || !ids.includes(o.clipParent)));
