import type { LayerMask, VectorObject } from '../document/model.ts';
import { localBox, matrixOf, transformPoint } from '../geometry/objectTransforms.ts';

/**
 * Máscara de camada (como no Photoshop): um bitmap em tons de cinza sobre a caixa local do objeto — branco mostra,
 * preto oculta, cinza deixa parcialmente transparente. Fora do bitmap vale a cor de fundo da máscara (`background`).
 * Pintada com o pincel de máscara (tamanho e dureza); pode ser desativada sem perder a pintura, invertida ou excluída.
 */
export const MASK_MAX_PIXELS = 2048;
/** Caixa local da máscara: a caixa do objeto com folga para o contorno. */
export function maskBox(o: VectorObject) {
  const b = localBox(o), pad = (o.strokeWidth ?? 0) + Math.max(2, Math.max(b.width, b.height) * 0.02);
  return { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad };
}
/** Resolução do bitmap da máscara (até 4 pixels por unidade, no máximo 2048 no lado maior). */
export function maskPixels(box: { width: number; height: number }) {
  const scale = Math.min(4, MASK_MAX_PIXELS / Math.max(box.width, box.height, 1));
  return { width: Math.max(1, Math.round(box.width * scale)), height: Math.max(1, Math.round(box.height * scale)) };
}
/** Região da máscara no documento (cantos transformados), usada no elemento <mask> do SVG. */
export function maskRegion(o: VectorObject, mask: LayerMask) {
  const m = matrixOf(o), pts = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => transformPoint(m, { x: mask.x + u * mask.width, y: mask.y + v * mask.height }));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
/** Ponto do documento → pixel do bitmap da máscara. */
export function maskPixel(o: VectorObject, mask: LayerMask, size: { width: number; height: number }, p: { x: number; y: number }) {
  const [a, b, c, d, e, f] = matrixOf(o), det = a * d - b * c, lx = (d * (p.x - e) - c * (p.y - f)) / det, ly = (-b * (p.x - e) + a * (p.y - f)) / det;
  return { x: (lx - mask.x) / mask.width * size.width, y: (ly - mask.y) / mask.height * size.height };
}
/** Pixels da máscara por unidade do documento (para converter o tamanho do pincel). */
export function maskScale(o: VectorObject, mask: LayerMask, size: { width: number }) {
  const m = matrixOf(o), objectScale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  return size.width / mask.width / objectScale;
}
/** Marcação SVG da máscara (a mesma no canvas e na exportação). Fora do bitmap vale a cor de fundo. */
export function maskSvg(o: VectorObject, id: string, transform: string, n: (v: number) => string = String) {
  const mask = o.mask!, r = maskRegion(o, mask), pad = Math.max(r.width, r.height) * 4 + 1e4, bg = mask.background === 'black' ? '#000' : '#fff';
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="${n(r.x - pad)}" y="${n(r.y - pad)}" width="${n(r.width + 2 * pad)}" height="${n(r.height + 2 * pad)}" style="mask-type:luminance"><rect x="${n(r.x - pad)}" y="${n(r.y - pad)}" width="${n(r.width + 2 * pad)}" height="${n(r.height + 2 * pad)}" fill="${bg}"/><image href="${mask.src}" x="${n(mask.x)}" y="${n(mask.y)}" width="${n(mask.width)}" height="${n(mask.height)}" preserveAspectRatio="none"${transform ? ` transform="${transform}"` : ''}/></mask>`;
}
export const maskActive = (o: VectorObject) => !!o.mask && !o.mask.disabled;

/** Cria o bitmap de uma máscara nova (navegador): branco = revelar tudo, preto = ocultar tudo. */
export function createMask(o: VectorObject, fill: 'white' | 'black' = 'white'): LayerMask {
  const box = maskBox(o), size = maskPixels(box), canvas = document.createElement('canvas');
  canvas.width = size.width; canvas.height = size.height;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = fill; ctx.fillRect(0, 0, size.width, size.height);
  return { src: canvas.toDataURL('image/png'), ...box, ...(fill === 'black' ? { background: 'black' as const } : {}) };
}
/** Inverte a máscara (navegador): preto ↔ branco, inclusive o fundo. */
export async function invertMask(mask: LayerMask): Promise<LayerMask> {
  const image = await loadImage(mask.src), canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d')!; ctx.filter = 'invert(1)'; ctx.drawImage(image, 0, 0);
  const { background, ...rest } = mask;
  return { ...rest, src: canvas.toDataURL('image/png'), ...(background === 'black' ? {} : { background: 'black' as const }) };
}
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Não foi possível ler a máscara.')); image.src = src; });
}
