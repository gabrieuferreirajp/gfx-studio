import type { PathCommand, VectorObject } from '../document/model.ts';
import { pathFromWorld } from '../geometry/convertCurves.ts';
import { createText, defaultTextStyle, updateText, type Measure } from './textLayout.ts';

/*
 * Inserir código de barras / QR (CorelDRAW: Objeto › Inserir › Código de barras e Código QR).
 * Geradores próprios, vetoriais: QR Code (ISO/IEC 18004, modo byte UTF-8, versões 1–40, níveis L/M/Q/H),
 * Code 128 (subconjuntos B e C automáticos) e EAN-13 (com dígito verificador).
 */

export type QrLevel = 'L' | 'M' | 'Q' | 'H';
const ECC_PER_BLOCK: Record<QrLevel, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const BLOCKS: Record<QrLevel, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};
const FORMAT_LEVEL: Record<QrLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

function rawModules(ver: number) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const n = Math.floor(ver / 7) + 2; result -= (25 * n - 10) * n - 55; if (ver >= 7) result -= 36; }
  return result;
}
const dataCodewords = (ver: number, level: QrLevel) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[level][ver] * BLOCKS[level][ver];
function gfMul(x: number, y: number) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; }
function rsDivisor(degree: number) {
  const result = new Array<number>(degree - 1).fill(0); result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) { result[j] = gfMul(result[j], root); if (j + 1 < result.length) result[j] ^= result[j + 1]; }
    root = gfMul(root, 2);
  }
  return result;
}
function rsRemainder(data: number[], divisor: number[]) {
  const result = divisor.map(() => 0);
  for (const b of data) { const factor = b ^ result.shift()!; result.push(0); divisor.forEach((c, i) => { result[i] ^= gfMul(c, factor); }); }
  return result;
}
function alignmentPositions(ver: number) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2, size = ver * 4 + 17, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < n; pos -= step) result.splice(1, 0, pos);
  return result;
}
const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];
/** Penalidade da máscara (regras 1–4 da norma): a de menor valor é a escolhida. */
function penalty(m: boolean[][]) {
  const size = m.length; let score = 0;
  const lines: boolean[][] = [...m, ...m.map((_, x) => m.map(row => row[x]))];
  const finder = [true, false, true, true, true, false, true];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) { if (i < size && line[i] === line[i - 1]) run++; else { if (run >= 5) score += run - 2; run = 1; } }
    for (let i = 0; i + 7 <= size; i++) {
      if (!finder.every((v, k) => line[i + k] === v)) continue;
      const lightBefore = [1, 2, 3, 4].every(k => i - k < 0 || !line[i - k]), lightAfter = [0, 1, 2, 3].every(k => i + 7 + k >= size || !line[i + 7 + k]);
      if (lightBefore || lightAfter) score += 40;
    }
  }
  for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3; }
  const dark = m.flat().filter(Boolean).length, total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}
/** Matriz de módulos do QR (true = escuro), sem a zona de silêncio. */
export function qrMatrix(text: string, level: QrLevel = 'M'): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  for (; ver <= 40; ver++) { const cc = ver < 10 ? 8 : 16; if (4 + cc + bytes.length * 8 <= dataCodewords(ver, level) * 8) break; }
  if (ver > 40) throw new Error('Texto longo demais para um código QR (reduza o conteúdo ou use o nível L).');
  const capacity = dataCodewords(ver, level) * 8, bits: number[] = [];
  const put = (value: number, length: number) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity - bits.length)); put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = []; for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  // Blocos com correção de erros, intercalados.
  const blocks = BLOCKS[level][ver], eccLen = ECC_PER_BLOCK[level][ver], raw = Math.floor(rawModules(ver) / 8), short = blocks - raw % blocks, shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLen), parts: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < short ? 0 : 1)); k += dat.length;
    const ecc = rsRemainder(dat, divisor); if (i < short) dat.push(0);
    parts.push([...dat, ...ecc]);
  }
  const codewords: number[] = [];
  for (let i = 0; i < parts[0].length; i++) parts.forEach((p, j) => { if (i !== shortLen - eccLen || j >= short) codewords.push(p[i]); });
  // Padrões fixos.
  const size = ver * 4 + 17, modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false)), fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; fixed[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
    if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
  }
  const align = alignmentPositions(ver), last = align.length - 1;
  align.forEach((ax, i) => align.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = (mask: number) => {
    const value = (FORMAT_LEVEL[level] << 3) | mask; let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((value << 10) | rem) ^ 0x5412, bit = (i: number) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const dark = ((v >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3); set(a, b, dark); set(b, a, dark); }
  }
  // Dados em zigue-zague, de baixo para cima, em pares de colunas.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (!fixed[y][x] && i < codewords.length * 8) { modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const applyMask = (mask: number) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x]; };
  let best = 0, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) { applyMask(mask); drawFormat(mask); const s = penalty(modules); if (s < bestScore) { bestScore = s; best = mask; } applyMask(mask); }
  applyMask(best); drawFormat(best);
  return modules;
}

/* ---------- Code 128 ---------- */
const CODE128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
/** Larguras alternadas barra/espaço (em módulos) do Code 128, com troca automática para o subconjunto C nos números. */
export function code128Widths(text: string): number[] {
  if (!text) throw new Error('Digite o conteúdo do código de barras.');
  if ([...text].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126)) throw new Error('Code 128 aceita só letras sem acento, números e símbolos ASCII.');
  const codes: number[] = []; let set: 'B' | 'C' | null = null, i = 0;
  const digitsAt = (k: number) => { let n = 0; while (k + n < text.length && /\d/.test(text[k + n])) n++; return n; };
  while (i < text.length) {
    const run = digitsAt(i), useC = run >= 4 || (set === 'C' && run >= 2);
    if (useC) {
      if (set !== 'C') { codes.push(set === null ? 105 : 99); set = 'C'; }
      codes.push(Number(text.slice(i, i + 2))); i += 2; continue;
    }
    if (set !== 'B') { codes.push(set === null ? 104 : 100); set = 'B'; }
    codes.push(text.charCodeAt(i) - 32); i++;
  }
  const check = codes.reduce((sum, c, k) => sum + c * (k === 0 ? 1 : k), 0) % 103;
  return [...codes, check, 106].flatMap(c => [...CODE128[c]].map(Number));
}
/* ---------- EAN-13 ---------- */
const EAN_L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'];
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
export function eanCheckDigit(twelve: string) { return (10 - [...twelve].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0) % 10) % 10; }
/** Larguras do EAN-13 (começando por barra) e o número completo com dígito verificador. */
export function ean13Widths(text: string): { widths: number[]; digits: string } {
  const clean = text.replace(/\s/g, '');
  if (!/^\d{12,13}$/.test(clean)) throw new Error('EAN-13 precisa de 12 dígitos (o 13º, verificador, é calculado).');
  const check = eanCheckDigit(clean.slice(0, 12));
  if (clean.length === 13 && Number(clean[12]) !== check) throw new Error(`Dígito verificador incorreto: o correto é ${check}.`);
  const digits = clean.slice(0, 12) + check, parity = EAN_PARITY[Number(digits[0])];
  const left = [...digits.slice(1, 7)].flatMap((d, i) => { const w = [...EAN_L[Number(d)]].map(Number); return parity[i] === 'L' ? w : w.slice().reverse(); });
  const right = [...digits.slice(7)].flatMap(d => [...EAN_L[Number(d)]].map(Number));
  // L começa por espaço; após a guarda inicial (barra-espaço-barra) a sequência continua alternando.
  return { widths: [1, 1, 1, ...left, 1, 1, 1, 1, 1, ...right, 1, 1, 1], digits };
}

/* ---------- Geometria ---------- */
export type BarcodeKind = 'qr' | 'code128' | 'ean13';
export interface BarcodeOptions { kind: BarcodeKind; text: string; level?: QrLevel; /** Largura do módulo/barra mais fina em px. */ module: number; /** Altura das barras em px (códigos lineares). */ height: number; showText?: boolean; color?: string }
const rect = (x: number, y: number, w: number, h: number): PathCommand[] => [{ type: 'M', x, y }, { type: 'L', x: x + w, y }, { type: 'L', x: x + w, y: y + h }, { type: 'L', x, y: y + h }, { type: 'Z' }];
/** Retângulos agrupados em caminhos de até ~9.000 comandos (limite de 10.000 por caminho do projeto). */
function pathsOf(rects: PathCommand[][], name: string, color: string): VectorObject[] {
  const out: VectorObject[] = []; let chunk: PathCommand[] = [];
  const flush = () => { if (chunk.length) out.push(pathFromWorld({ id: crypto.randomUUID(), type: 'path', name, x: 0, y: 0, width: 1, height: 1, fill: color }, chunk, name)); chunk = []; };
  for (const r of rects) { if (chunk.length + r.length > 9000) flush(); chunk.push(...r); }
  flush();
  return out;
}
/**
 * Cria o código como curvas agrupadas, com o canto superior esquerdo em (x, y). Códigos lineares podem levar
 * o texto legível embaixo (texto editável, no mesmo grupo).
 */
export function createBarcode(options: BarcodeOptions, x: number, y: number, measure: Measure): VectorObject[] {
  const color = options.color ?? '#000000', m = Math.max(0.05, options.module), group = crypto.randomUUID();
  let objects: VectorObject[] = [];
  if (options.kind === 'qr') {
    const matrix = qrMatrix(options.text, options.level ?? 'M'), rects: PathCommand[][] = [];
    matrix.forEach((row, r) => { for (let c = 0; c < row.length;) { if (!row[c]) { c++; continue; } let e = c; while (e < row.length && row[e]) e++; rects.push(rect(x + c * m, y + r * m, (e - c) * m, m)); c = e; } });
    objects = pathsOf(rects, `Código QR: ${options.text.slice(0, 60)}`, color);
  } else {
    const ean = options.kind === 'ean13' ? ean13Widths(options.text) : null, widths = ean ? ean.widths : code128Widths(options.text);
    const rects: PathCommand[][] = []; let cursor = x;
    widths.forEach((w, i) => { if (i % 2 === 0) rects.push(rect(cursor, y, w * m, options.height)); cursor += w * m; });
    const label = ean ? ean.digits : options.text;
    objects = pathsOf(rects, `${ean ? 'EAN-13' : 'Code 128'}: ${label.slice(0, 60)}`, color);
    if (options.showText) {
      const size = Math.max(4, Math.min(72, m * 7 / (96 / 72)));
      const text = updateText(createText(x, y + options.height + size * 96 / 72 * 0.95, color, { ...defaultTextStyle, fontFamily: ean ? 'Arial' : defaultTextStyle.fontFamily, fontSize: size, textAlign: 'center' }, measure), { text: label }, measure);
      objects.push({ ...text, x: x + (cursor - x - text.width) / 2, name: 'Texto do código' });
    }
  }
  return objects.length > 1 ? objects.map(o => ({ ...o, groupPath: [group] })) : objects;
}
