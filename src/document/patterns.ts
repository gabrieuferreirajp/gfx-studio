import type { FillPattern, MeshFill, VectorObject } from './model.ts';
import { matrixOf } from '../geometry/objectTransforms.ts';

/** Padrões de duas cores (mosaico 10 × 10, desenhado na cor da frente sobre a cor de fundo). */
export const patternPresets: { id: string; label: string; d: string }[] = [
  { id: 'hlines', label: 'Listras horizontais', d: 'M0 0H10V3H0Z' },
  { id: 'vlines', label: 'Listras verticais', d: 'M0 0H3V10H0Z' },
  { id: 'diagonal', label: 'Listras diagonais', d: 'M0 8L8 0H10V2L2 10H0ZM0 0H2L0 2ZM10 8V10H8Z' },
  { id: 'crosshatch', label: 'Hachura cruzada', d: 'M0 8L8 0H10V2L2 10H0ZM0 0H2L0 2ZM10 8V10H8ZM0 0H2L10 8V10H8L0 2ZM8 0H10V2ZM0 8L2 10H0Z' },
  { id: 'grid', label: 'Grade', d: 'M0 0H10V1H0ZM0 0H1V10H0Z' },
  { id: 'checker', label: 'Xadrez', d: 'M0 0H5V5H0ZM5 5H10V10H5Z' },
  { id: 'dots', label: 'Pontos', d: 'M3 5A2 2 0 1 0 7 5A2 2 0 1 0 3 5Z' },
  { id: 'bricks', label: 'Tijolos', d: 'M0 0H10V1H0ZM0 5H10V6H0ZM5 1H6V5H5ZM0 6H1V10H0Z' },
  { id: 'waves', label: 'Ondas', d: 'M0 4C2.5 1 7.5 7 10 4V6C7.5 9 2.5 3 0 6Z' },
  { id: 'diamonds', label: 'Losangos', d: 'M5 1L9 5L5 9L1 5Z' },
  { id: 'triangles', label: 'Triângulos', d: 'M0 10L5 0L10 10Z' },
  { id: 'plus', label: 'Cruzes', d: 'M4 1H6V4H9V6H6V9H4V6H1V4H4Z' },
];
export const presetPath = (id: string | undefined) => patternPresets.find(p => p.id === id) ?? patternPresets[0];
export const defaultPattern = (fg = '#000000', bg = '#ffffff'): FillPattern => ({ kind: 'twoColor', preset: 'diagonal', fg, bg, size: 18.9 });
const n = (v: number) => Number(v.toFixed(4)).toString();
/**
 * Definição SVG do padrão: mosaico em coordenadas do objeto (acompanha mover, girar e escalar) a partir do
 * canto da caixa local; `local` para textos, desenhados dentro do grupo transformado.
 */
export function patternDef(o: VectorObject, local = false): string {
  const p = o.fillPattern!, w = p.size, h = p.size * (p.ratio ?? 1);
  const m = local ? null : matrixOf(o), transform = `${m ? `matrix(${m.map(n).join(' ')}) ` : ''}translate(${n(o.x)} ${n(o.y)})${p.angle ? ` rotate(${n(-p.angle)})` : ''}`;
  const body = p.kind === 'bitmap' && p.src
    ? `<image href="${p.src}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="none"/>`
    : `${p.bg && p.bg !== 'none' ? `<rect width="${n(w)}" height="${n(h)}" fill="${p.bg}"/>` : ''}<path d="${presetPath(p.preset).d}" transform="scale(${n(w / 10)} ${n(h / 10)})" fill="${p.fg ?? '#000000'}"/>`;
  return `<pattern id="fpat-${o.id}" patternUnits="userSpaceOnUse" width="${n(w)}" height="${n(h)}" patternTransform="${transform}">${body}</pattern>`;
}
/** Preenchimento de padrão: `fill` guarda o fundo (ou a frente, sem fundo) para formatos sem padrões. */
export function patternFill(o: VectorObject, pattern: FillPattern): VectorObject {
  const { fillGradient: _g, meshFill: _m, ...rest } = o;
  const fill = pattern.kind === 'bitmap' ? '#c0c0c0' : pattern.bg && pattern.bg !== 'none' ? pattern.bg : pattern.fg ?? '#000000';
  return { ...rest, fill, fillPattern: pattern };
}

const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
/** Malha nova (CorelDRAW: Preenchimento de malha) com todas as cores iguais à cor do objeto. */
export function defaultMesh(color: string, rows = 2, cols = 2): Omit<MeshFill, 'src'> {
  const base = /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff';
  return { rows, cols, colors: Array.from({ length: (rows + 1) * (cols + 1) }, () => base) };
}
/** Muda o número de linhas/colunas mantendo as cores (amostradas da malha anterior). */
export function resizeMesh(mesh: Omit<MeshFill, 'src'>, rows: number, cols: number): Omit<MeshFill, 'src'> {
  rows = Math.max(1, Math.min(12, Math.round(rows))); cols = Math.max(1, Math.min(12, Math.round(cols)));
  const colors: string[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) colors.push(toHex(meshColor(mesh, c / cols, r / rows)));
  return { rows, cols, colors };
}
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Cor RGB da malha em (u, v) ∈ [0, 1]²: interpolação suave entre os quatro nós da célula. */
export function meshColor(mesh: Omit<MeshFill, 'src'>, u: number, v: number): number[] {
  const fx = Math.max(0, Math.min(1, u)) * mesh.cols, fy = Math.max(0, Math.min(1, v)) * mesh.rows;
  const c = Math.min(mesh.cols - 1, Math.floor(fx)), r = Math.min(mesh.rows - 1, Math.floor(fy)), tx = smooth(fx - c), ty = smooth(fy - r);
  const at = (rr: number, cc: number) => channels(mesh.colors[rr * (mesh.cols + 1) + cc]);
  const a = at(r, c), b = at(r, c + 1), d = at(r + 1, c), e = at(r + 1, c + 1);
  return a.map((_, i) => (a[i] * (1 - tx) + b[i] * tx) * (1 - ty) + (d[i] * (1 - tx) + e[i] * tx) * ty);
}
/** Pixels RGBA da malha (a imagem é esticada sobre a caixa local do objeto). */
export function meshPixels(mesh: Omit<MeshFill, 'src'>, width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = meshColor(mesh, width > 1 ? x / (width - 1) : 0, height > 1 ? y / (height - 1) : 0), i = (y * width + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return data;
}
export const meshAverage = (mesh: Omit<MeshFill, 'src'>) => toHex([0, 1, 2].map(i => mesh.colors.reduce((s, c) => s + channels(c)[i], 0) / mesh.colors.length));
export const meshSize = (mesh: Omit<MeshFill, 'src'>) => ({ width: Math.min(256, mesh.cols * 32), height: Math.min(256, mesh.rows * 32) });
/** Ponto de cada nó da malha em coordenadas locais do objeto. */
export const meshNodes = (o: VectorObject, mesh: Omit<MeshFill, 'src'>) => mesh.colors.map((_, i) => ({ x: o.x + (i % (mesh.cols + 1)) / mesh.cols * o.width, y: o.y + Math.floor(i / (mesh.cols + 1)) / mesh.rows * o.height }));
export function meshFillOf(o: VectorObject, mesh: MeshFill): VectorObject {
  const { fillGradient: _g, fillPattern: _p, ...rest } = o;
  return { ...rest, fill: meshAverage(mesh), meshFill: mesh };
}
/** Imagem e recorte da malha em SVG (exportação); `d` é o contorno do objeto no documento. */
export function meshSvg(o: VectorObject, d: string): string {
  const m = matrixOf(o), rule = o.fillRule === 'evenodd' ? ' clip-rule="evenodd"' : '';
  return `<clipPath id="mclip-${o.id}"><path d="${d}"${rule}/></clipPath><g clip-path="url(#mclip-${o.id})"><image href="${o.meshFill!.src}" x="${n(o.x)}" y="${n(o.y)}" width="${n(o.width)}" height="${n(o.height)}" preserveAspectRatio="none" transform="matrix(${m.map(n).join(' ')})"/></g>`;
}
