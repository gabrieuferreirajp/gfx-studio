import type { TransparencyGradient, VectorObject } from './model.ts';
import { matrixOf, objectCorners, transformPoint } from '../geometry/objectTransforms.ts';

/**
 * Modos de mesclagem com os nomes e a ordem do Photoshop em português (grupos separados por linhas).
 * `css`: modo nativo de mix-blend-mode; `pdf`: nome do /BM no PDF (ausente = PDF não tem o modo).
 * Superexposição linear (chave `subtract`, compatível com arquivos antigos): fundo + cor − 1, desenhada com o fundo
 * invertido: 1 − ((1 − fundo) + (1 − cor)). Subtrair (`minus`): fundo − cor = 1 − ((1 − fundo) + cor).
 */
export const blendModes = {
  normal: { label: 'Normal', css: 'normal', pdf: 'Normal', group: 0 },
  darken: { label: 'Escurecer', css: 'darken', pdf: 'Darken', group: 1 },
  multiply: { label: 'Multiplicação', css: 'multiply', pdf: 'Multiply', group: 1 },
  colorBurn: { label: 'Superexposição de cores', css: 'color-burn', pdf: 'ColorBurn', group: 1 },
  subtract: { label: 'Superexposição linear', css: 'plus-lighter', group: 1 },
  lighten: { label: 'Clarear', css: 'lighten', pdf: 'Lighten', group: 2 },
  screen: { label: 'Divisão', css: 'screen', pdf: 'Screen', group: 2 },
  colorDodge: { label: 'Subexposição de cores', css: 'color-dodge', pdf: 'ColorDodge', group: 2 },
  add: { label: 'Subexposição linear (Adicionar)', css: 'plus-lighter', group: 2 },
  overlay: { label: 'Sobrepor', css: 'overlay', pdf: 'Overlay', group: 3 },
  softLight: { label: 'Luz indireta', css: 'soft-light', pdf: 'SoftLight', group: 3 },
  hardLight: { label: 'Luz direta', css: 'hard-light', pdf: 'HardLight', group: 3 },
  difference: { label: 'Diferença', css: 'difference', pdf: 'Difference', group: 4 },
  exclusion: { label: 'Exclusão', css: 'exclusion', pdf: 'Exclusion', group: 4 },
  minus: { label: 'Subtrair', css: 'plus-lighter', group: 4 },
  hue: { label: 'Matiz', css: 'hue', pdf: 'Hue', group: 5 },
  saturation: { label: 'Saturação', css: 'saturation', pdf: 'Saturation', group: 5 },
  color: { label: 'Cor', css: 'color', pdf: 'Color', group: 5 },
  luminosity: { label: 'Luminosidade', css: 'luminosity', pdf: 'Luminosity', group: 5 },
} as const satisfies Record<string, { label: string; css: string; pdf?: string; group: number }>;
/**
 * Lista completa do Photoshop, na ordem dele. Os modos sem chave dependem de operações por pixel que o motor de
 * desenho (SVG/navegador) não tem: aparecem desativados, com a indicação "indisponível".
 */
export const photoshopBlendList: ({ key: BlendMode } | { unavailable: string })[][] = [
  [{ key: 'normal' }, { unavailable: 'Dissolver' }],
  [{ key: 'darken' }, { key: 'multiply' }, { key: 'colorBurn' }, { key: 'subtract' }, { unavailable: 'Cor mais escura' }],
  [{ key: 'lighten' }, { key: 'screen' }, { key: 'colorDodge' }, { key: 'add' }, { unavailable: 'Cor mais clara' }],
  [{ key: 'overlay' }, { key: 'softLight' }, { key: 'hardLight' }, { unavailable: 'Luz brilhante' }, { unavailable: 'Luz linear' }, { unavailable: 'Luz do pino' }, { unavailable: 'Mistura sólida' }],
  [{ key: 'difference' }, { key: 'exclusion' }, { key: 'minus' }, { unavailable: 'Dividir' }],
  [{ key: 'hue' }, { key: 'saturation' }, { key: 'color' }, { key: 'luminosity' }],
];
/** Modos desenhados com o fundo invertido (sem mix-blend-mode nativo). */
export const invertedBlend = (mode?: BlendMode) => mode === 'subtract' || mode === 'minus';
export type BlendMode = keyof typeof blendModes;
export const isBlendMode = (value: unknown): value is BlendMode => typeof value === 'string' && Object.hasOwn(blendModes, value);

/** Transparência do CorelDRAW em % (0 = opaco, 100 = invisível). */
export const transparencyOf = (o: VectorObject) => Math.round((1 - (o.opacity ?? 1)) * 100);
export const opacityFromTransparency = (percent: number) => Math.max(0, Math.min(1, 1 - percent / 100));
export const hasTransparency = (o: VectorObject) => (o.opacity ?? 1) < 1 || !!o.transparencyGradient || (!!o.blendMode && o.blendMode !== 'normal');
/** Degradê padrão do CorelDRAW: opaco à esquerda, transparente à direita (ou do centro para fora). */
export const defaultGradient = (type: TransparencyGradient['type']): TransparencyGradient => type === 'linear' ? { type, x1: 0, y1: 0.5, x2: 1, y2: 0.5, from: 0, to: 100 } : { type, x1: 0.5, y1: 0.5, x2: 1, y2: 0.5, from: 0, to: 100 };
/** Pontos do degradê no documento (acompanham mover, girar e escalar o objeto). */
export function gradientPoints(o: VectorObject, g: { x1: number; y1: number; x2: number; y2: number } = o.transparencyGradient!) {
  const m = matrixOf(o), at = (fx: number, fy: number) => transformPoint(m, { x: o.x + fx * o.width, y: o.y + fy * o.height });
  return { start: at(g.x1, g.y1), end: at(g.x2, g.y2) };
}
/** Fração da caixa do objeto correspondente a um ponto do documento. */
export function gradientFraction(o: VectorObject, p: { x: number; y: number }) {
  const [a, b, c, d, e, f] = matrixOf(o), det = a * d - b * c, x = (d * (p.x - e) - c * (p.y - f)) / det, y = (-b * (p.x - e) + a * (p.y - f)) / det;
  return { x: (x - o.x) / (o.width || 1), y: (y - o.y) / (o.height || 1) };
}
/** Máscara SVG (alfa) do degradê, em coordenadas do documento. */
export function gradientMask(o: VectorObject) {
  const g = o.transparencyGradient!, { start, end } = gradientPoints(o, g), corners = objectCorners(o), pad = (o.strokeWidth ?? 0) + 2;
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y), box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, width: Math.max(...xs) - Math.min(...xs) + 2 * pad, height: Math.max(...ys) - Math.min(...ys) + 2 * pad };
  return { box, start, end, radius: Math.hypot(end.x - start.x, end.y - start.y) || 1, stops: [{ offset: 0, opacity: 1 - g.from / 100 }, { offset: 1, opacity: 1 - g.to / 100 }] };
}
export const blendCss = (o: VectorObject) => o.blendMode && o.blendMode !== 'normal' && !invertedBlend(o.blendMode) ? blendModes[o.blendMode].css : undefined;

/** Aplica transparência uniforme e modo de mesclagem aos objetos (null remove). */
export function setTransparency(objects: VectorObject[], ids: string[], value: { opacity?: number; blendMode?: BlendMode; gradient?: TransparencyGradient | null } | null): VectorObject[] {
  const set = new Set(ids);
  return objects.map(o => {
    if (!set.has(o.id)) return o;
    if (!value) { const { opacity: _o, blendMode: _b, transparencyGradient: _g, ...rest } = o; return rest; }
    const { gradient, ...plain } = value, next: VectorObject = { ...o, ...plain };
    // Uniforme e degradê são tipos exclusivos, como no CorelDRAW.
    if (gradient) { next.transparencyGradient = gradient; delete next.opacity; }
    else if (gradient === null || value.opacity !== undefined) delete next.transparencyGradient;
    if (next.opacity !== undefined && next.opacity >= 1) delete next.opacity;
    if (next.blendMode === 'normal') delete next.blendMode;
    return next;
  });
}
/** Mistura um modo separável do CorelDRAW por canal (0–1), usada nos testes e na pré-visualização numérica. */
export function blendChannel(mode: BlendMode, backdrop: number, source: number): number | null {
  const b = backdrop, s = source;
  switch (mode) {
    case 'normal': return s;
    case 'add': return Math.min(1, b + s);
    case 'subtract': return Math.max(0, b + s - 1);
    case 'minus': return Math.max(0, b - s);
    case 'difference': return Math.abs(b - s);
    case 'multiply': return b * s;
    case 'lighten': return Math.max(b, s);
    case 'darken': return Math.min(b, s);
    case 'screen': return b + s - b * s;
    case 'exclusion': return b + s - 2 * b * s;
    default: return null;
  }
}
