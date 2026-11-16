import type { PathCommand } from '../document/model.ts';
import { simplifyPoints } from '../geometry/shapeFactory.ts';
import type { Point } from '../geometry/pathGeometry.ts';
import type { Pixels } from './bitmapTrace.ts';

/**
 * Rastreio da linha central (CorelDRAW PowerTRACE › Linha central): traços do desenho viram linhas abertas
 * de uma só passada (bom para plotter, fresa e gravação), com a espessura média medida no bitmap.
 * Etapas: binarização, remoção de manchas, afinamento Zhang–Suen, percurso do esqueleto, poda de ramos curtos,
 * simplificação (Douglas–Peucker) e suavização com cantos preservados.
 */
export interface CenterlineOptions {
  /** Limiar de tinta 1–254 (pixel mais escuro que isso é traço); 0 = automático (Otsu). */
  threshold: number;
  /** 0–100: tolerância da simplificação. */
  smoothing: number;
  /** Ângulo acima do qual o vértice vira canto (graus). */
  cornerAngle: number;
  /** Manchas menores que isso (pixels) são ignoradas. */
  minArea: number;
}
export interface CenterlineLine { commands: PathCommand[]; closed: boolean }
export interface CenterlineResult { lines: CenterlineLine[]; color: string; strokeWidth: number }

const luminance = (d: ArrayLike<number>, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
/** Limiar de Otsu sobre a luminância dos pixels opacos. */
export function otsu(pixels: Pixels): number {
  const histogram = new Array<number>(256).fill(0); let total = 0;
  for (let i = 0; i < pixels.data.length; i += 4) if (pixels.data[i + 3] >= 128) { histogram[Math.round(luminance(pixels.data, i))]++; total++; }
  if (!total) return 128;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * histogram[t];
  let below = 0, sumBelow = 0, best = 128, max = -1;
  for (let t = 0; t < 256; t++) {
    below += histogram[t]; if (!below) continue;
    const above = total - below; if (!above) break;
    sumBelow += t * histogram[t];
    const mb = sumBelow / below, ma = (sum - sumBelow) / above, between = below * above * (mb - ma) ** 2;
    if (between > max) { max = between; best = t; }
  }
  return Math.max(1, Math.min(254, best + 1));
}
/** Máscara de tinta (1 = traço). */
export function inkMask(pixels: Pixels, threshold: number): Uint8Array {
  const { width, height, data } = pixels, mask = new Uint8Array(width * height), t = threshold || otsu(pixels);
  for (let p = 0, i = 0; p < width * height; p++, i += 4) mask[p] = data[i + 3] >= 128 && luminance(data, i) < t ? 1 : 0;
  return mask;
}
/** Remove componentes (8-vizinhança) com menos de `minArea` pixels. */
function despeckle(mask: Uint8Array, width: number, height: number, minArea: number) {
  if (minArea <= 1) return;
  const seen = new Uint8Array(mask.length), stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const component: number[] = []; stack.push(start); seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!, x = p % width, y = (p - x) / width; component.push(p);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, q = ny * width + nx;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < width && ny < height && mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (component.length < minArea) for (const p of component) mask[p] = 0;
  }
}
/** Distância (chanfro 3-4, em pixels) de cada pixel de tinta até o fundo. */
function distanceMap(mask: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e9, d = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) d[i] = mask[i] ? INF : 0;
  const at = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? 0 : d[y * width + x];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = y * width + x; if (d[i]) d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4); }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) { const i = y * width + x; if (d[i]) d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4); }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}
/** Afinamento de Zhang–Suen: reduz cada traço a 1 pixel de largura, preservando a ligação. */
export function thin(mask: Uint8Array, width: number, height: number): Uint8Array {
  const img = mask.slice(), remove: number[] = [];
  const v = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? 0 : img[y * width + x];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      remove.length = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (!img[y * width + x]) continue;
        const p = [v(x, y - 1), v(x + 1, y - 1), v(x + 1, y), v(x + 1, y + 1), v(x, y + 1), v(x - 1, y + 1), v(x - 1, y), v(x - 1, y - 1)];
        const b = p.reduce((s, q) => s + q, 0); if (b < 2 || b > 6) continue;
        let a = 0; for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) a++;
        if (a !== 1) continue;
        if (step === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        remove.push(y * width + x);
      }
      if (remove.length) { changed = true; for (const i of remove) img[i] = 0; }
    }
  }
  return img;
}
const OFFSETS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
/** Percorre o esqueleto: trechos entre pontas/junções e laços fechados, em coordenadas de pixel (centro). */
export function skeletonPaths(skeleton: Uint8Array, width: number, height: number): { points: Point[]; closed: boolean; ends: [boolean, boolean] }[] {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && skeleton[y * width + x] === 1;
  // Vizinhança mista (m-adjacência): a diagonal só conta se não houver caminho ortogonal entre os dois pixels;
  // assim os "degraus" do esqueleto não viram junções falsas.
  const neighbors = (p: number) => { const x = p % width, y = (p - x) / width, out: number[] = []; for (const [dx, dy] of OFFSETS) if (on(x + dx, y + dy) && !(dx && dy && (on(x + dx, y) || on(x, y + dy)))) out.push((y + dy) * width + x + dx); return out; };
  const degree = new Uint8Array(skeleton.length);
  for (let p = 0; p < skeleton.length; p++) if (skeleton[p]) degree[p] = neighbors(p).length;
  const node = (p: number) => degree[p] !== 2;
  const used = new Set<string>(), key = (a: number, b: number) => a < b ? `${a},${b}` : `${b},${a}`;
  const point = (p: number): Point => ({ x: p % width + 0.5, y: Math.floor(p / width) + 0.5 });
  const paths: { points: Point[]; closed: boolean; ends: [boolean, boolean] }[] = [];
  const walk = (start: number, next: number) => {
    const chain = [start]; let prev = start, cur = next;
    used.add(key(prev, cur));
    while (true) {
      chain.push(cur);
      if (node(cur) || cur === start) break;
      const step = neighbors(cur).find(n => n !== prev && !used.has(key(cur, n)));
      if (step === undefined) break;
      used.add(key(cur, step)); prev = cur; cur = step;
    }
    const closed = chain.length > 2 && chain[0] === chain.at(-1);
    paths.push({ points: (closed ? chain.slice(0, -1) : chain).map(point), closed, ends: [degree[chain[0]] <= 1, degree[chain.at(-1)!] <= 1] });
  };
  for (let p = 0; p < skeleton.length; p++) if (skeleton[p] && node(p)) for (const n of neighbors(p)) if (!used.has(key(p, n))) walk(p, n);
  // Sobram laços sem junção (círculos, anéis).
  for (let p = 0; p < skeleton.length; p++) if (skeleton[p] && !node(p)) { const n = neighbors(p).find(q => !used.has(key(p, q))); if (n !== undefined) walk(p, n); }
  // Ponto isolado: vira um traço mínimo.
  for (let p = 0; p < skeleton.length; p++) if (skeleton[p] && degree[p] === 0) { const c = point(p); paths.push({ points: [{ x: c.x - 0.5, y: c.y }, { x: c.x + 0.5, y: c.y }], closed: false, ends: [true, true] }); }
  return paths;
}
const pathLength = (pts: Point[]) => pts.reduce((s, p, i) => i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0, 0);
/** Polilinha → curvas suaves que passam pelos pontos; vértices com giro maior que `cornerAngle` ficam em canto. */
export function lineCommands(raw: Point[], closed: boolean, tolerance: number, cornerAngle: number): PathCommand[] | null {
  let points = closed ? (() => { let far = 0; for (let i = 1; i < raw.length; i++) if (Math.hypot(raw[i].x - raw[0].x, raw[i].y - raw[0].y) > Math.hypot(raw[far].x - raw[0].x, raw[far].y - raw[0].y)) far = i; return [...simplifyPoints(raw.slice(0, far + 1), tolerance).slice(0, -1), ...simplifyPoints([...raw.slice(far), raw[0]], tolerance).slice(0, -1)]; })() : simplifyPoints(raw, tolerance);
  if (points.length < 2 || (closed && points.length < 3)) { if (closed || raw.length < 2) return null; points = [raw[0], raw.at(-1)!]; }
  const n = points.length, at = (i: number) => points[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  const sharp = points.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return true;
    const a = at(i - 1), b = at(i + 1);
    return Math.abs(Math.atan2((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x), (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y))) * 180 / Math.PI > cornerAngle;
  });
  const handle = (i: number, sign: number): Point => { const p = at(i); if (sharp[(i + n) % n]) return p; const a = at(i - 1), b = at(i + 1); return { x: p.x + sign * (b.x - a.x) / 6, y: p.y + sign * (b.y - a.y) / 6 }; };
  const commands: PathCommand[] = [{ type: 'M', ...points[0] }];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    if (sharp[i] && sharp[j]) commands.push({ type: 'L', ...points[j] });
    else { const c1 = handle(i, 1), c2 = handle(j, -1); commands.push({ type: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, ...points[j] }); }
  }
  if (closed) commands.push({ type: 'Z' });
  return commands;
}
export function traceCenterline(pixels: Pixels, options: CenterlineOptions): CenterlineResult {
  const { width, height, data } = pixels, mask = inkMask(pixels, options.threshold);
  despeckle(mask, width, height, Math.max(1, options.minArea));
  const distance = distanceMap(mask, width, height), skeleton = thin(mask, width, height);
  // Espessura: dobro da distância ao fundo medida no esqueleto (mediana, robusta a junções).
  const radii: number[] = []; let r = 0, g = 0, b = 0, ink = 0;
  for (let p = 0; p < mask.length; p++) {
    if (skeleton[p]) radii.push(distance[p]);
    if (mask[p]) { r += data[p * 4]; g += data[p * 4 + 1]; b += data[p * 4 + 2]; ink++; }
  }
  if (!radii.length) throw new Error('Nenhum traço encontrado. Ajuste o limiar (imagem clara demais ou sem linhas escuras).');
  radii.sort((a, c) => a - c);
  const strokeWidth = Math.max(1, 2 * radii[Math.floor(radii.length / 2)] - 0.5);
  // Poda: ramos que terminam em ponta e são mais curtos que a espessura são ruído do afinamento.
  const raw = skeletonPaths(skeleton, width, height).filter(p => !(p.ends[0] !== p.ends[1] && pathLength(p.points) < strokeWidth * 1.2));
  const tolerance = 0.6 + options.smoothing / 100 * 2.4;
  // O afinamento encurta cada ponta livre em cerca de meia espessura: devolve esse trecho na direção do traço.
  const extend = (pts: Point[], fromStart: boolean) => {
    const end = fromStart ? pts[0] : pts.at(-1)!, ref = fromStart ? pts[Math.min(pts.length - 1, 3)] : pts[Math.max(0, pts.length - 4)], len = Math.hypot(end.x - ref.x, end.y - ref.y);
    if (len < 1e-6) return;
    const k = (strokeWidth / 2 - 0.5) / len, moved = { x: Math.max(0, Math.min(width, end.x + (end.x - ref.x) * k)), y: Math.max(0, Math.min(height, end.y + (end.y - ref.y) * k)) };
    if (fromStart) pts[0] = moved; else pts[pts.length - 1] = moved;
  };
  for (const p of raw) if (!p.closed && p.points.length > 1) { if (p.ends[0]) extend(p.points, true); if (p.ends[1]) extend(p.points, false); }
  const lines = raw.map(p => ({ commands: lineCommands(p.points, p.closed, tolerance, options.cornerAngle), closed: p.closed })).filter((l): l is CenterlineLine => !!l.commands);
  const hex = (v: number) => Math.round(v / ink).toString(16).padStart(2, '0');
  return { lines, color: `#${hex(r)}${hex(g)}${hex(b)}`, strokeWidth };
}
