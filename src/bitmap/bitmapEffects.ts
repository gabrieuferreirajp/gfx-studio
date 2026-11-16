/** Ajustes e efeitos de bitmap (menu Bitmaps do CorelDRAW), sobre pixels RGBA. */
export interface Pixels { data: Uint8ClampedArray; width: number; height: number }
export type BitmapEffect = 'brightness' | 'hsl' | 'grayscale' | 'blackWhite' | 'invert' | 'sepia' | 'posterize' | 'blur' | 'sharpen';
export interface BitmapParams { brightness?: number; contrast?: number; hue?: number; saturation?: number; lightness?: number; threshold?: number; levels?: number; radius?: number; amount?: number }
export const bitmapEffectLabels: Record<BitmapEffect, string> = {
  brightness: 'Brilho e contraste', hsl: 'Matiz, saturação e luminosidade', grayscale: 'Escala de cinza', blackWhite: 'Preto e branco (limiar)',
  invert: 'Inverter cores', sepia: 'Sépia', posterize: 'Posterizar', blur: 'Desfoque gaussiano', sharpen: 'Nitidez',
};
const clamp = (v: number) => Math.max(0, Math.min(255, v));
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t % 1 + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
/** Desfoque por três passadas de caixa (aproxima o gaussiano), separável. */
function blur(src: Pixels, radius: number): Uint8ClampedArray {
  const { width: w, height: h } = src; let a = Float32Array.from(src.data);
  const r = Math.max(1, Math.round(radius / 1.5));
  const pass = (input: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(input.length), len = horizontal ? w : h, lines = horizontal ? h : w;
    for (let line = 0; line < lines; line++) for (let c = 0; c < 4; c++) {
      const at = (i: number) => (horizontal ? line * w + Math.max(0, Math.min(w - 1, i)) : Math.max(0, Math.min(h - 1, i)) * w + line) * 4 + c;
      let sum = 0; for (let i = -r; i <= r; i++) sum += input[at(i)];
      for (let i = 0; i < len; i++) { out[at(i)] = sum / (2 * r + 1); sum += input[at(i + r + 1)] - input[at(i - r)]; }
    }
    return out;
  };
  for (let k = 0; k < 3; k++) a = pass(pass(a, true), false);
  return Uint8ClampedArray.from(a, clamp);
}
/** Aplica o efeito e devolve pixels novos (a transparência é mantida). */
export function applyBitmapEffect(src: Pixels, effect: BitmapEffect, p: BitmapParams = {}): Pixels {
  const { width, height } = src, d = src.data;
  if (effect === 'blur') return { width, height, data: blur(src, p.radius ?? 3) };
  if (effect === 'sharpen') {
    const soft = blur(src, p.radius ?? 2), k = (p.amount ?? 100) / 100, out = new Uint8ClampedArray(d.length);
    for (let i = 0; i < d.length; i += 4) { for (let c = 0; c < 3; c++) out[i + c] = clamp(d[i + c] + (d[i + c] - soft[i + c]) * k); out[i + 3] = d[i + 3]; }
    return { width, height, data: out };
  }
  const out = new Uint8ClampedArray(d.length);
  const contrast = (p.contrast ?? 0) / 100, cf = contrast >= 0 ? 1 / Math.max(0.01, 1 - contrast) : 1 + contrast, bright = (p.brightness ?? 0) * 2.55;
  const levels = Math.max(2, Math.min(32, Math.round(p.levels ?? 4))), step = 255 / (levels - 1);
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    if (effect === 'brightness') { r = (r - 128) * cf + 128 + bright; g = (g - 128) * cf + 128 + bright; b = (b - 128) * cf + 128 + bright; }
    else if (effect === 'hsl') {
      const [h, s, l] = rgbToHsl(r, g, b), sat = Math.max(0, Math.min(1, s * (1 + (p.saturation ?? 0) / 100))), lig = p.lightness ?? 0;
      const ll = lig >= 0 ? l + (1 - l) * lig / 100 : l * (1 + lig / 100);
      [r, g, b] = hslToRgb(h + (p.hue ?? 0) / 360, sat, ll);
    }
    else if (effect === 'grayscale') r = g = b = gray;
    else if (effect === 'blackWhite') r = g = b = gray >= (p.threshold ?? 128) ? 255 : 0;
    else if (effect === 'invert') { r = 255 - r; g = 255 - g; b = 255 - b; }
    else if (effect === 'sepia') { const [x, y, z] = [r, g, b]; r = 0.393 * x + 0.769 * y + 0.189 * z; g = 0.349 * x + 0.686 * y + 0.168 * z; b = 0.272 * x + 0.534 * y + 0.131 * z; }
    else if (effect === 'posterize') { r = Math.round(r / step) * step; g = Math.round(g / step) * step; b = Math.round(b / step) * step; }
    out[i] = clamp(r); out[i + 1] = clamp(g); out[i + 2] = clamp(b); out[i + 3] = d[i + 3];
  }
  return { width, height, data: out };
}
/** Novo tamanho em pixels ao reamostrar para `dpi` (o tamanho no documento não muda; 96 px = 1 pol). */
export function resampleSize(widthDoc: number, heightDoc: number, dpi: number) {
  const k = Math.max(10, Math.min(1200, dpi)) / 96;
  return { width: Math.max(1, Math.min(8000, Math.round(widthDoc * k))), height: Math.max(1, Math.min(8000, Math.round(heightDoc * k))) };
}
