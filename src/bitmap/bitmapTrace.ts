import type { PathCommand } from '../document/model.ts';
import type { Point } from '../geometry/pathGeometry.ts';

/**
 * Rastreamento de contorno (como o PowerTRACE do CorelDRAW), em quatro etapas:
 * 1. cores: k-means com peso perceptual; 2. limpeza: manchas menores que o detalhe pedido são absorvidas pela cor
 * vizinha (sem arredondar cantos como um filtro de maioria); 3. camadas empilhadas: cada cor é traçada junto com as
 * cores menores que ficam por cima dela, para não sobrar fresta branca entre cores vizinhas; 4. curvas: a borda em
 * escada dos pixels é alisada, os cantos são detectados pelo ângulo e cada trecho entre cantos é ajustado por
 * curvas de Bézier (ajuste por mínimos quadrados de Schneider), com poucos nós e retas onde o trecho é reto.
 */
export interface Pixels { width: number; height: number; data: Uint8ClampedArray | Uint8Array }
export interface TraceOptions { colors: number; smoothing: number; cornerAngle: number; removeBackground: boolean; despeckle: number }
export interface TracedLayer { color: string; area: number; contours: PathCommand[][] }
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Agrupa as cores em `count` tons (k-means determinístico, distância com peso perceptual); transparentes recebem -1. */
export function quantize(pixels: Pixels, count: number): { labels: Int16Array; palette: [number, number, number][] } {
  const { width, height, data } = pixels, total = width * height, labels = new Int16Array(total).fill(-1);
  const opaque: number[] = [];
  for (let i = 0; i < total; i++) if (data[i * 4 + 3] >= 128) opaque.push(i);
  if (!opaque.length) return { labels, palette: [] };
  const step = Math.max(1, Math.floor(opaque.length / 40000)), sample = opaque.filter((_, i) => i % step === 0);
  const dist = (i: number, c: [number, number, number]) => { const r = data[i * 4] - c[0], g = data[i * 4 + 1] - c[1], b = data[i * 4 + 2] - c[2], mr = (data[i * 4] + c[0]) / 2; return (2 + mr / 256) * r * r + 4 * g * g + (2 + (255 - mr) / 256) * b * b; };
  // Início "mais distante primeiro" (como k-means++ determinístico): cores raras mas marcantes ganham um centro.
  const k = Math.min(count, sample.length), centers: [number, number, number][] = [];
  const lum = (i: number) => data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  const darkest = sample.reduce((a, b) => lum(b) < lum(a) ? b : a, sample[0]);
  centers.push([data[darkest * 4], data[darkest * 4 + 1], data[darkest * 4 + 2]]);
  const near = new Float64Array(sample.length).fill(Infinity);
  while (centers.length < k) {
    let far = -1, best = -1;
    for (let s = 0; s < sample.length; s++) { near[s] = Math.min(near[s], dist(sample[s], centers[centers.length - 1])); if (near[s] > best) { best = near[s]; far = s; } }
    if (best <= 0) break;
    const i = sample[far]; centers.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  }
  const nearest = (i: number) => { let best = 0, d = Infinity; for (let c = 0; c < centers.length; c++) { const v = dist(i, centers[c]); if (v < d) { d = v; best = c; } } return best; };
  for (let iteration = 0; iteration < 12; iteration++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const i of sample) { const c = nearest(i), s = sums[c]; s[0] += data[i * 4]; s[1] += data[i * 4 + 1]; s[2] += data[i * 4 + 2]; s[3]++; }
    centers.splice(0, centers.length, ...centers.map((c, j) => (sums[j][3] ? [sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]] : c) as [number, number, number]));
  }
  for (const i of opaque) labels[i] = nearest(i);
  return { labels, palette: centers };
}
/** Remove manchas: regiões conectadas menores que `minArea` pixels passam para a cor vizinha mais presente. */
export function removeSpecks(labels: Int16Array, width: number, height: number, minArea: number): Int16Array {
  if (minArea <= 1) return labels;
  const out = new Int16Array(labels), seen = new Uint8Array(labels.length), stack: number[] = [], region: number[] = [];
  for (let start = 0; start < out.length; start++) {
    if (seen[start] || out[start] < 0) continue;
    const label = out[start]; region.length = 0; stack.push(start); seen[start] = 1;
    const border = new Map<number, number>();
    while (stack.length) {
      const i = stack.pop()!; region.push(i);
      const x = i % width, y = (i - x) / width;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx, l = out[j];
        if (l === label) { if (!seen[j]) { seen[j] = 1; stack.push(j); } } else if (l >= 0) border.set(l, (border.get(l) ?? 0) + 1);
      }
    }
    if (region.length >= minArea || !border.size) continue;
    let to = label, most = 0; for (const [l, n] of border) if (n > most) { most = n; to = l; }
    for (const i of region) out[i] = to;
  }
  return out;
}
/**
 * Cores de transição (anti-serrilhado): um grupo de cor que fica entre duas cores vizinhas, numa faixa fina ao longo
 * da borda delas, não é cor do desenho. Cada pixel dele vai para a vizinha de cor mais próxima (sem halo nas bordas).
 */
export function mergeEdgeColors(labels: Int16Array, palette: [number, number, number][], pixels: Pixels): Int16Array {
  const { width, height, data } = pixels, n = palette.length, out = new Int16Array(labels);
  const area = new Float64Array(n), edge = new Float64Array(n), adj = Array.from({ length: n }, () => new Float64Array(n));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, l = out[i]; if (l < 0) continue;
    area[l]++;
    let onEdge = false;
    for (const j of [x + 1 < width ? i + 1 : -1, y + 1 < height ? i + width : -1, x > 0 ? i - 1 : -1, y > 0 ? i - width : -1]) {
      if (j < 0) continue; const m = out[j];
      if (m !== l) { onEdge = true; if (m >= 0) adj[l][m]++; }
    }
    if (onEdge) edge[l]++;
  }
  // Cores principais: grupos "cheios". As de transição são faixas finas cuja cor fica no meio do caminho entre duas
  // principais (ex.: cinza entre preto e branco, rosa entre vermelho e branco), mesmo em faixas de várias cores.
  const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const ratio = (c: number) => area[c] ? edge[c] / area[c] : 0;
  const main = palette.map((_, c) => area[c] > 0 && ratio(c) <= 0.45).map((v, c) => v ? c : -1).filter(c => c >= 0);
  const targets = new Map<number, [number, number]>();
  for (let c = 0; c < n; c++) {
    if (!area[c] || ratio(c) <= 0.45 || main.length < 2) continue;
    let best: [number, number] | null = null, bestD = 40 * 40;
    for (let i = 0; i < main.length; i++) for (let j = i + 1; j < main.length; j++) {
      const A = palette[main[i]], B = palette[main[j]], C = palette[c], ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      if (!l2) continue;
      const t = ((C[0] - A[0]) * ab[0] + (C[1] - A[1]) * ab[1] + (C[2] - A[2]) * ab[2]) / l2;
      if (t < 0.05 || t > 0.95) continue;
      const d = d2(C, [A[0] + ab[0] * t, A[1] + ab[1] * t, A[2] + ab[2] * t]);
      // Prefere pares que de fato encostam no grupo (vizinhos na imagem).
      const touching = (adj[c][main[i]] > 0 ? 1 : 0) + (adj[c][main[j]] > 0 ? 1 : 0), score = d / (1 + touching);
      if (score < bestD) { bestD = score; best = [main[i], main[j]]; }
    }
    if (best) targets.set(c, best);
  }
  if (!targets.size) return out;
  for (let i = 0; i < out.length; i++) {
    const pair = out[i] >= 0 ? targets.get(out[i]) : undefined; if (!pair) continue;
    const p = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    out[i] = d2(p, palette[pair[0]]) <= d2(p, palette[pair[1]]) ? pair[0] : pair[1];
  }
  return out;
}
/** Filtro de maioria 3×3 (mantido por compatibilidade). */
export function despeckle(labels: Int16Array, width: number, height: number, passes: number): Int16Array {
  let current = labels;
  for (let pass = 0; pass < passes; pass++) {
    const next = new Int16Array(current);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const counts = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < width && ny < height) { const l = current[ny * width + nx]; counts.set(l, (counts.get(l) ?? 0) + 1); } }
      let best = current[y * width + x], score = counts.get(best)!;
      for (const [l, c] of counts) if (c > score) { best = l; score = c; }
      if (score >= 5) next[y * width + x] = best;
    }
    current = next;
  }
  return current;
}
/** Contornos fechados nas bordas dos pixels do rótulo, com a região sempre à direita do sentido de percurso. */
export function traceRegions(labels: Int16Array | Uint8Array, width: number, height: number, label: number): Point[][] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === label;
  const edges = new Map<number, number[]>(), key = (x: number, y: number) => y * (width + 1) + x;
  const add = (x1: number, y1: number, x2: number, y2: number) => { const k = key(x1, y1); const list = edges.get(k); const e = key(x2, y2); if (list) list.push(e); else edges.set(k, [e]); };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!at(x, y)) continue;
    if (!at(x, y - 1)) add(x, y, x + 1, y);
    if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!at(x - 1, y)) add(x, y + 1, x, y);
  }
  const point = (k: number): Point => ({ x: k % (width + 1), y: Math.floor(k / (width + 1)) });
  const loops: Point[][] = [];
  for (const [start] of edges) {
    while (edges.get(start)?.length) {
      const loop: Point[] = [point(start)];
      let from = start, to = edges.get(start)!.pop()!;
      for (let guard = 0; to !== start && guard < 8_000_000; guard++) {
        loop.push(point(to));
        const options = edges.get(to)!;
        if (!options?.length) break;
        let index = 0;
        if (options.length > 1) {
          // Em vértices diagonais, vira à direita para manter regiões que só se tocam no canto separadas.
          const a = point(from), b = point(to), dx = b.x - a.x, dy = b.y - a.y;
          index = options.findIndex(o => { const c = point(o); return (c.x - b.x) === -dy && (c.y - b.y) === dx; });
          if (index < 0) index = 0;
        }
        from = to; to = options.splice(index, 1)[0];
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

// ---------- Ajuste de curvas (Schneider, "An Algorithm for Automatically Fitting Digitized Curves") ----------
type V = Point;
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y }), add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k }), dot = (a: V, b: V) => a.x * b.x + a.y * b.y, len = (a: V) => Math.hypot(a.x, a.y);
const unit = (a: V): V => { const l = len(a); return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 }; };
type Bez = [V, V, V, V];
const bezier = (b: Bez, t: number): V => { const u = 1 - t; return { x: u * u * u * b[0].x + 3 * u * u * t * b[1].x + 3 * u * t * t * b[2].x + t * t * t * b[3].x, y: u * u * u * b[0].y + 3 * u * u * t * b[1].y + 3 * u * t * t * b[2].y + t * t * t * b[3].y }; };
function generate(pts: V[], u: number[], t1: V, t2: V): Bez {
  const first = pts[0], last = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i], s = 1 - t, b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
    const a1 = mul(t1, b1), a2 = mul(t2, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(first, b0 + b1), mul(last, b2 + b3)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01, seg = len(sub(last, first));
  let alpha1 = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0, alpha2 = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0;
  if (!(alpha1 > seg * 1e-3) || !(alpha2 > seg * 1e-3) || alpha1 > seg * 2 || alpha2 > seg * 2) alpha1 = alpha2 = seg / 3;
  return [first, add(first, mul(t1, alpha1)), add(last, mul(t2, alpha2)), last];
}
function maxError(pts: V[], b: Bez, u: number[]) {
  let max = 0, at = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) { const d = len(sub(bezier(b, u[i]), pts[i])); if (d > max) { max = d; at = i; } }
  return { max, at };
}
function reparameterize(pts: V[], b: Bez, u: number[]) {
  return u.map((t, i) => {
    const d = sub(bezier(b, t), pts[i]), s = 1 - t;
    const q1 = add(add(mul(sub(b[1], b[0]), 3 * s * s), mul(sub(b[2], b[1]), 6 * s * t)), mul(sub(b[3], b[2]), 3 * t * t));
    const q2 = add(mul(add(sub(b[2], mul(b[1], 2)), b[0]), 6 * s), mul(add(sub(b[3], mul(b[2], 2)), b[1]), 6 * t));
    const den = dot(q1, q1) + dot(d, q2);
    return den ? Math.max(0, Math.min(1, t - dot(d, q1) / den)) : t;
  });
}
function chord(pts: V[]) {
  const u = [0]; for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  const total = u[u.length - 1] || 1; return u.map(v => v / total);
}
function fitCubic(pts: V[], t1: V, t2: V, error: number, out: Bez[], depth = 0) {
  if (pts.length === 2) { const d = len(sub(pts[1], pts[0])) / 3; out.push([pts[0], add(pts[0], mul(t1, d)), add(pts[1], mul(t2, d)), pts[1]]); return; }
  let u = chord(pts), b = generate(pts, u, t1, t2), e = maxError(pts, b, u);
  if (e.max < error) { out.push(b); return; }
  if (e.max < error * 4) for (let i = 0; i < 6; i++) { u = reparameterize(pts, b, u); b = generate(pts, u, t1, t2); e = maxError(pts, b, u); if (e.max < error) { out.push(b); return; } }
  if (depth > 40 || pts.length < 3) { out.push(b); return; }
  const at = Math.max(1, Math.min(pts.length - 2, e.at)), center = unit(sub(pts[at - 1], pts[at + 1]));
  fitCubic(pts.slice(0, at + 1), t1, center, error, out, depth + 1);
  fitCubic(pts.slice(at), mul(center, -1), t2, error, out, depth + 1);
}
const turn = (a: V, b: V) => Math.abs(Math.atan2(a.x * b.y - a.y * b.x, dot(a, b))) * 180 / Math.PI;

/**
 * Converte um laço de bordas de pixel em comandos de curva: alisa a escada, acha os cantos (ângulo maior que
 * `cornerAngle`) e ajusta Bézier entre eles com erro máximo `tolerance` (pixels). Trechos retos viram linhas.
 */
export function loopCommands(loop: Point[], tolerance: number, cornerAngle: number, maxX: number, maxY: number, window = 2): PathCommand[] | null {
  const n = loop.length;
  if (n < 4) return null;
  // Pontos médios das arestas (tiram a escada) e média móvel circular.
  const mids = loop.map((p, i) => { const q = loop[(i + 1) % n]; return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; });
  const w = Math.max(0, Math.min(window, Math.floor((n - 1) / 4)));
  const smooth = mids.map((_, i) => { let x = 0, y = 0; for (let k = -w; k <= w; k++) { const p = mids[(i + k + n) % n]; x += p.x; y += p.y; } return { x: x / (2 * w + 1), y: y / (2 * w + 1) }; });
  // Cantos: ângulo medido numa escala um pouco maior que a da suavização; fica só o máximo local.
  const k = Math.max(2, Math.min(w + 5, Math.floor(n / 6))), angles = smooth.map((p, i) => turn(sub(p, smooth[(i - k + n) % n]), sub(smooth[(i + k) % n], p)));
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (angles[i] <= cornerAngle) continue;
    // Máximo local (em empate, vale o primeiro).
    let peak = true; for (let d = 1; d <= k; d++) if (angles[(i + d) % n] > angles[i] || angles[(i - d + n) % n] >= angles[i]) { peak = false; break; }
    if (peak && !corners.some(c => Math.min(Math.abs(c - i), n - Math.abs(c - i)) <= k)) corners.push(i);
  }
  // Canto vivo: cruzamento das retas que chegam e saem do canto (o pixel e o anti-serrilhado arredondam a ponta);
  // se as retas não se cruzam perto, vale o vértice de pixel mais afastado da corda.
  const pts = smooth.slice();
  for (const c of corners) {
    const a = smooth[(c - k + n) % n], b = smooth[(c + k) % n], a2 = smooth[(c - 2 * k + 2 * n) % n], b2 = smooth[(c + 2 * k) % n];
    const d1 = sub(a, a2), d2 = sub(b2, b), den = d1.x * d2.y - d1.y * d2.x;
    let best: V | null = null;
    if (Math.abs(den) > 1e-9) { const t = ((b.x - a.x) * d2.y - (b.y - a.y) * d2.x) / den, q = add(a, mul(d1, t)); if (t > 0 && len(sub(q, smooth[c])) <= 1.5 * k) best = q; }
    if (!best) {
      const dir = unit(sub(b, a)); let far = -1; best = smooth[c];
      for (let d = -k; d <= k + 1; d++) { const p = loop[(c + d + n) % n], dist = Math.abs((p.x - a.x) * dir.y - (p.y - a.y) * dir.x); if (dist > far) { far = dist; best = p; } }
    }
    pts[c] = best;
  }
  // Pontos arredondados logo ao lado do canto ficam fora do ajuste (senão a curva "puxa" a ponta).
  const trim = Math.ceil(k * 0.6), nearCorner = new Uint8Array(n);
  for (const c of corners) for (let d = 1; d <= trim; d++) { nearCorner[(c + d) % n] = 1; nearCorner[(c - d + n) % n] = 1; }
  const clamp = (p: V): V => ({ x: Math.max(0, Math.min(maxX, p.x)), y: Math.max(0, Math.min(maxY, p.y)) });
  const tangent = (i: number) => unit(sub(pts[(i + 1) % n], pts[(i - 1 + n) % n]));
  // Sem cantos (forma redonda): divide em dois trechos com tangente contínua.
  const splits = corners.length ? corners.slice().sort((a, b) => a - b) : [0, Math.floor(n / 2)];
  const isCorner = new Set(corners), curves: Bez[] = [];
  for (let s = 0; s < splits.length; s++) {
    const a = splits[s], b = splits[(s + 1) % splits.length], count = ((b - a + n) % n) || n, seg: V[] = [];
    for (let i = 0; i <= count; i++) { const j = (a + i) % n; if (i === 0 || i === count || !nearCorner[j]) seg.push(pts[j]); }
    if (seg.length < 2) continue;
    const t1 = isCorner.has(a) ? unit(sub(seg[Math.min(seg.length - 1, Math.max(1, Math.min(3, seg.length - 1)))], seg[0])) : tangent(a);
    const t2 = isCorner.has(b % n) ? unit(sub(seg[Math.max(0, seg.length - 1 - Math.max(1, Math.min(3, seg.length - 1)))], seg[seg.length - 1])) : mul(tangent(b % n), -1);
    fitCubic(seg, t1, t2, tolerance, curves);
  }
  if (!curves.length) return null;
  const commands: PathCommand[] = [{ type: 'M', ...clamp(curves[0][0]) }];
  for (const [p0, c1, c2, p3] of curves) {
    const d = len(sub(p3, p0)), dir = unit(sub(p3, p0)), off = (p: V) => Math.abs((p.x - p0.x) * dir.y - (p.y - p0.y) * dir.x);
    const straight = d > 1e-9 && off(c1) < 0.15 && off(c2) < 0.15;
    if (d < 1e-9 && len(sub(c1, p0)) < 1e-9) continue;
    if (straight) commands.push({ type: 'L', ...clamp(p3) });
    else { const q1 = clamp(c1), q2 = clamp(c2); commands.push({ type: 'C', x1: q1.x, y1: q1.y, x2: q2.x, y2: q2.y, ...clamp(p3) }); }
  }
  if (commands.length < 3) return null;
  commands.push({ type: 'Z' });
  return commands;
}
/** Rastreamento de contorno: uma camada por cor, da maior para a menor área, empilhadas como no CorelDRAW. */
export function traceBitmap(pixels: Pixels, options: TraceOptions): TracedLayer[] {
  const { width, height } = pixels;
  const { labels: raw, palette } = quantize(pixels, Math.max(2, Math.min(32, Math.round(options.colors))));
  // Manchas: área mínima proporcional à imagem e ao nível escolhido (0 = só pontos soltos).
  const scale = Math.max(1, width * height / 250000), minArea = Math.round([3, 10, 30][Math.max(0, Math.min(2, options.despeckle))] * scale);
  const labels = removeSpecks(mergeEdgeColors(raw, palette, pixels), width, height, minArea);
  const area = palette.map(() => 0); for (const l of labels) if (l >= 0) area[l]++;
  let background = -1;
  if (options.removeBackground) {
    const border = palette.map(() => 0);
    for (let x = 0; x < width; x++) for (const y of [0, height - 1]) { const l = labels[y * width + x]; if (l >= 0) border[l]++; }
    for (let y = 0; y < height; y++) for (const x of [0, width - 1]) { const l = labels[y * width + x]; if (l >= 0) border[l]++; }
    background = border.indexOf(Math.max(...border));
  }
  const tolerance = 0.35 + options.smoothing / 100 * 1.65, window = 1 + Math.round(options.smoothing / 35);
  const order = palette.map((c, label) => ({ label, color: hex(c[0], c[1], c[2]), area: area[label] })).filter(l => l.area > 0 && l.label !== background).sort((a, b) => b.area - a.area);
  const rank = new Int16Array(palette.length).fill(-1); order.forEach((l, i) => { rank[l.label] = i; });
  const mask = new Uint8Array(labels.length);
  return order.map((l, i) => {
    // Camada empilhada: a cor e todas as menores que ficam por cima dela (sem frestas entre cores vizinhas).
    for (let p = 0; p < labels.length; p++) { const r = labels[p] >= 0 ? rank[labels[p]] : -1; mask[p] = r >= i ? 1 : 0; }
    const contours = traceRegions(mask, width, height, 1).map(loop => loopCommands(loop, tolerance, options.cornerAngle, width, height, window)).filter((c): c is PathCommand[] => !!c);
    return { color: l.color, area: l.area, contours };
  }).filter(l => l.contours.length > 0);
}
