import type { Pixels } from './bitmapTrace.ts';

/**
 * Remover fundo (como "Remover plano de fundo" do Photoshop, para fundos lisos ou de poucas cores): as cores de fundo
 * são estimadas pela borda da imagem; a partir da borda, a área parecida com elas é marcada como fundo (só o que
 * está ligado à borda, ou também ilhas internas da mesma cor). A borda do objeto recebe transparência gradual
 * (anti-serrilhado) e manchas soltas são limpas. Devolve a opacidade de cada pixel (0 = fundo, 255 = objeto).
 */
export interface RemoveBackgroundOptions { tolerance: number; inner: boolean; softness: number }
const dist = (r: number, g: number, b: number, c: number[]) => { const mr = (r + c[0]) / 2, dr = r - c[0], dg = g - c[1], db = b - c[2]; return Math.sqrt((2 + mr / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mr) / 256) * db * db) / 3; };

/** Cores de fundo: grupos de cor que ocupam boa parte da borda da imagem (até 3). */
export function borderColors(pixels: Pixels): number[][] {
  const { width: w, height: h, data } = pixels, idx: number[] = [];
  for (let x = 0; x < w; x++) idx.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) idx.push(y * w, y * w + w - 1);
  const opaque = idx.filter(i => data[i * 4 + 3] > 16);
  if (!opaque.length) return [];
  const groups: { c: number[]; n: number }[] = [];
  for (const i of opaque) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const hit = groups.find(q => dist(r, g, b, q.c) < 12);
    if (hit) { hit.c = hit.c.map((v, k) => v + ([r, g, b][k] - v) / (hit.n + 1)); hit.n++; } else groups.push({ c: [r, g, b], n: 1 });
  }
  return groups.sort((a, b) => b.n - a.n).filter((g, i) => i === 0 || g.n >= opaque.length * 0.12).slice(0, 3).map(g => g.c);
}
export function removeBackground(pixels: Pixels, options: RemoveBackgroundOptions): Uint8ClampedArray {
  const { width: w, height: h, data } = pixels, n = w * h, alpha = new Uint8ClampedArray(n).fill(255);
  const colors = borderColors(pixels), t = Math.max(1, options.tolerance);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] <= 16) { d[i] = 0; continue; }
    let m = Infinity; for (const c of colors) m = Math.min(m, dist(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], c)); d[i] = m;
  }
  if (!colors.length) { for (let i = 0; i < n; i++) alpha[i] = data[i * 4 + 3]; return alpha; }
  // Fundo: preenchimento a partir da borda (ou, com "áreas internas", todo pixel parecido).
  const bg = new Uint8Array(n);
  if (options.inner) for (let i = 0; i < n; i++) bg[i] = d[i] < t ? 1 : 0;
  else {
    const stack: number[] = [];
    const seed = (i: number) => { if (!bg[i] && d[i] < t) { bg[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (stack.length) { const i = stack.pop()!, x = i % w; if (x > 0) seed(i - 1); if (x < w - 1) seed(i + 1); if (i >= w) seed(i - w); if (i < n - w) seed(i + w); }
  }
  // Manchas: ilhas pequenas de "objeto" no meio do fundo viram fundo.
  const minIsland = Math.max(4, Math.round(n * 0.0004)), seen = new Uint8Array(n), region: number[] = [], stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (bg[s] || seen[s]) continue;
    region.length = 0; stack.push(s); seen[s] = 1;
    while (stack.length) { const i = stack.pop()!; region.push(i); const x = i % w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1]) if (j >= 0 && !bg[j] && !seen[j]) { seen[j] = 1; stack.push(j); } }
    if (region.length < minIsland) for (const i of region) bg[i] = 1;
  }
  // Borda suave: pixels de fundo encostados no objeto ganham opacidade pela distância de cor (anti-serrilhado).
  for (let i = 0; i < n; i++) {
    if (!bg[i]) { alpha[i] = data[i * 4 + 3]; continue; }
    const x = i % w, near = (x > 0 && !bg[i - 1]) || (x < w - 1 && !bg[i + 1]) || (i >= w && !bg[i - w]) || (i < n - w && !bg[i + w]);
    alpha[i] = near ? Math.round(Math.max(0, Math.min(1, (d[i] - t * 0.45) / (t * 0.55))) * 255) : 0;
  }
  // Suavização extra da borda (média 3×3 repetida), sem mexer no miolo do objeto.
  for (let pass = 0; pass < Math.max(0, Math.min(4, Math.round(options.softness))); pass++) {
    const src = alpha.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, v = src[i];
      if (src[i - 1] === v && src[i + 1] === v && src[i - w] === v && src[i + w] === v) continue;
      let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[i + dy * w + dx];
      alpha[i] = Math.round(s / 9);
    }
  }
  return alpha;
}

/** IA (IS-Net): imagem 1024×1024 → entrada do modelo (RGB dividido pelo maior valor, menos a média; canais separados). */
export function aiInput(pixels: Pixels): Float32Array {
  const { width, height, data } = pixels, n = width * height, out = new Float32Array(3 * n), mean = [0.485, 0.456, 0.406];
  let max = 1; for (let i = 0; i < n; i++) max = Math.max(max, data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[c * n + i] = data[i * 4 + c] / max - mean[c];
  return out;
}
/**
 * Opacidade a partir da máscara da IA (0–255, já no tamanho da imagem): `edge` (0–100) firma a borda — 0 deixa a
 * transição suave do modelo, valores maiores deixam a borda mais nítida (cabelo e pelos ficam melhores com valor baixo).
 */
export function aiAlpha(mask: Uint8ClampedArray, edge: number): Uint8ClampedArray {
  const lo = Math.max(0, Math.min(0.45, edge / 220)) * 255, hi = 255 - lo, out = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = hi > lo ? Math.round((mask[i] - lo) / (hi - lo) * 255) : mask[i] >= 128 ? 255 : 0;
  return out;
}
