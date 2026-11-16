import type { TextAlign } from '../text/textLayout.ts';
import { cmykToHex } from '../workspace/palettes.ts';

/**
 * Estilos de texto gravados no CDR do CorelDRAW 2017+ (arquivo ZIP com content/data/page1.dat).
 * O conversor (libcdr/Inkscape) entrega fonte, tamanho e cor, mas perde peso (SemiBold, ExtraBold…),
 * itálico e alinhamento; esses dados estão em blocos JSON dentro do page1.dat, um conjunto por texto.
 */
export interface CdrRunStyle { weight?: number; italic?: boolean }
/** `runs`: estilo de cada trecho, na ordem do texto (trecho sem alteração = estilo do parágrafo). */
export interface CdrTextStyle { size: number; weight?: number; italic?: boolean; align?: TextAlign; lineSpacing?: number; runs?: CdrRunStyle[] }
/** Tamanho do CorelDRAW em décimos de micrômetro (1 pt = 25,4/72 mm). */
const SIZE_PER_PT = 25.4 / 72 * 10000;
/** Altura do caractere do CorelDRAW em múltiplos do tamanho da fonte (base do espaçamento em %). */
const CHARACTER_HEIGHT = 1.635;

/** Lê as entradas content/data/page1.dat do ZIP (descompressão nativa, sem dependências). */
export async function readCdrTextStyles(bytes: ArrayBuffer | Uint8Array): Promise<CdrTextStyle[]> {
  return (await readCdrData(bytes)).styles;
}
/** Estilos de texto e preenchimentos dos objetos da 1ª página (uma única descompressão). */
export async function readCdrData(bytes: ArrayBuffer | Uint8Array): Promise<{ styles: CdrTextStyle[]; fills: CdrFill[] }> {
  try {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const page = await zipEntry(data, 'content/data/page1.dat');
    if (!page) return { styles: [], fills: [] };
    const source = latin1(page);
    return { styles: parseCdrTextStyles(source), fills: parseCdrFills(source) };
  } catch { return { styles: [], fills: [] }; }
}
const latin1 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return s; };
async function zipEntry(zip: Uint8Array, name: string): Promise<Uint8Array | null> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (zip.length < 22 || view.getUint32(0, true) !== 0x04034b50) return null;
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let n = 0; n < count && at + 46 <= zip.length; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) return null;
    const method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true), nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true), local = view.getUint32(at + 42, true);
    const entry = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    if (entry === name) {
      if (size > 50 * 1024 * 1024) return null;
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true), raw = zip.subarray(start, start + size);
      if (method === 0) return raw;
      if (method !== 8) return null;
      const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    at += 46 + nameLength + extra + comment;
  }
  return null;
}
type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Json : undefined;
/** Peso: eixo variável "wght" (font_axes) ou o código do CorelDRAW (64 = 400, 1024 = 600, 4096 = 700, 16384 = 800…). */
function weightOf(latin: Json | undefined): number | undefined {
  const axes = String(latin?.font_axes ?? ''), tags = axes.replace(/<\d+>/g, ' ').trim().split(/\s+/);
  const wght = tags.indexOf('2003265652', 1);
  if (wght >= 0) { const v = Number(tags[wght + 2]); if (v >= 1 && v <= 1000) return Math.round(v); }
  const code = Number(latin?.weight);
  if (code > 0 && Number.isInteger(Math.log2(code) / 2)) return Math.max(100, Math.min(900, (Math.log2(code) / 2 + 1) * 100));
  return undefined;
}
const alignOf = (justify: unknown): TextAlign | undefined => justify === '2' ? 'center' : justify === '3' ? 'right' : justify === undefined ? undefined : 'left';
/** Extrai, na ordem do arquivo, o estilo efetivo de cada texto (bloco do objeto + bloco do parágrafo). */
export function parseCdrTextStyles(source: string): CdrTextStyle[] {
  const styles: CdrTextStyle[] = [];
  let current: { object: Json; paragraph?: Json; runs: CdrRunStyle[] } | null = null;
  const flush = () => {
    if (!current) return;
    const character = obj((current.paragraph ?? current.object).character), paragraph = obj((current.paragraph ?? current.object).paragraph) ?? obj(current.object.paragraph);
    const latin = obj(character?.latin) ?? obj(character?.RTL), size = Number(latin?.size) / SIZE_PER_PT;
    // Espaçamento entre linhas em % da altura do caractere do CorelDRAW (1000000 = 100%). Medido na prévia do
    // próprio CDR: 59,79% resulta em 0,98 × o tamanho da fonte, ou seja, 100% ≈ 1,635 × o tamanho.
    const spacing = Number(paragraph?.interLineSpacing), lineSpacing = paragraph?.spacingMethod === '0' && spacing > 0 ? Math.max(0.5, Math.min(10, spacing / 1e6 * CHARACTER_HEIGHT)) : undefined;
    if (size > 0) styles.push({ size, weight: weightOf(latin), italic: latin?.italic === '1', align: alignOf(paragraph?.justify), ...(lineSpacing ? { lineSpacing } : {}), ...(current.runs.length ? { runs: current.runs } : {}) });
    current = null;
  };
  for (let i = source.indexOf('{'); i >= 0 && styles.length < 20000; i = source.indexOf('{', i + 1)) {
    if (!/["\s]/.test(source[i + 1] ?? '')) continue;
    const end = jsonEnd(source, i);
    if (end < 0) continue;
    let json: Json;
    try { json = JSON.parse(source.slice(i, end + 1)); } catch { continue; }
    i = end;
    const keys = Object.keys(json), character = obj(json.character);
    // Depois do parágrafo vêm os trechos: {"character":{}} mantém o estilo; com fonte, altera peso/itálico.
    if (character && keys.length === 1 && current?.paragraph) { const latin = obj(character.latin) ?? obj(character.RTL); current.runs.push(latin ? { weight: weightOf(latin), italic: latin.italic === '1' } : {}); continue; }
    if (!character || !obj(character.latin ?? character.RTL)) continue;
    // Bloco completo (preenchimento + quadro + parágrafo) inicia um texto; o de parágrafo logo depois o completa.
    if (keys.includes('fill') && keys.includes('frame')) { flush(); current = { object: json, runs: [] }; }
    else if (current && !current.paragraph && keys.includes('frame') && keys.includes('paragraph')) current.paragraph = json;
  }
  flush();
  return styles;
}
function jsonEnd(s: string, start: number): number {
  let depth = 0, string = false;
  for (let j = start; j < s.length && j - start < 300000; j++) {
    const c = s[j];
    if (string) { if (c === '\\') j++; else if (c === '"') string = false; continue; }
    if (c === '"') string = true; else if (c === '{') depth++; else if (c === '}' && !--depth) return j;
  }
  return -1;
}
/**
 * Associa cada texto do SVG convertido ao estilo do CDR. O conversor desenha de trás para frente
 * (ordem inversa à do arquivo), então a busca segue do último para o primeiro, conferindo o tamanho.
 */
export function cdrStyleMatcher(styles: CdrTextStyle[]) {
  const used = new Set<number>();
  let cursor = styles.length - 1;
  return (sizePt: number): CdrTextStyle | undefined => {
    for (let i = cursor; i >= 0; i--) {
      if (used.has(i) || Math.abs(styles[i].size - sizePt) > Math.max(0.6, sizePt * 0.01)) continue;
      used.add(i); cursor = i - 1; return styles[i];
    }
    return undefined;
  };
}

/**
 * Preenchimento de cada objeto do CDR 2017+ (a libcdr não lê as cores de preenchimento dos arquivos recentes).
 * Cada objeto tem um bloco JSON com "fill" e "outline", na ordem do arquivo; `color` ausente = manter o do conversor.
 */
export interface CdrFill { color?: string; text: boolean; fountain?: boolean }
const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
/** Cor do CorelDRAW ("RGB255,USER,r,g,b,…", "CMYK,USER,c,m,y,k,…" em %, "CMYK255", "GRAY255", "SPOT,…" com alternativa). */
export function cdrColor(spec: string): string | undefined {
  const p = spec.split(','), n = (i: number) => Number(p[i]);
  const rgb = (i: number) => [n(i), n(i + 1), n(i + 2)].every(v => p[i] !== undefined && Number.isFinite(v)) ? '#' + [n(i), n(i + 1), n(i + 2)].map(hex2).join('') : undefined;
  const cmyk = (i: number, scale: number) => { const v = [0, 1, 2, 3].map(k => Math.max(0, Math.min(100, n(i + k) / scale * 100))); return v.every(Number.isFinite) && p[i + 3] !== undefined ? cmykToHex(v[0], v[1], v[2], v[3]) : undefined; };
  switch (p[0]) {
    case 'RGB255': return rgb(2);
    case 'GRAY255': return p[2] !== undefined && Number.isFinite(n(2)) ? '#' + hex2(n(2)).repeat(3) : undefined;
    case 'CMYK': case 'CMYK100': return cmyk(2, 100);
    case 'CMYK255': return cmyk(2, 255);
    case 'SPOT': {
      // Cor especial (Pantone): usa a alternativa RGB gravada no arquivo; sem ela, a CMYK.
      const r = p.indexOf('RGB255'); if (r > 0) return rgb(r + 2);
      const c = p.indexOf('CMYK255'); if (c > 0) return cmyk(c + 2, 255);
      return undefined;
    }
    default: return undefined;
  }
}
const mix = (a: string, b: string) => '#' + [1, 3, 5].map(i => hex2((parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) / 2)).join('');
export function parseCdrFills(source: string): CdrFill[] {
  const fills: CdrFill[] = [];
  for (let i = source.indexOf('{'); i >= 0 && fills.length < 200000; i = source.indexOf('{', i + 1)) {
    if (source[i + 1] !== '"') continue;
    const end = jsonEnd(source, i);
    if (end < 0) continue;
    let json: Json;
    try { json = JSON.parse(source.slice(i, end + 1)); } catch { continue; }
    i = end;
    const fill = obj(json.fill);
    if (!fill || !obj(json.outline)) continue;
    const text = !!obj(json.character), type = fill.type, primary = cdrColor(String(fill.primaryColor ?? ''));
    // Tipo 1 = uniforme, 2 = degradê (vira a cor média), 0 ou ausente = sem preenchimento; outros (padrão, textura…) ficam como vieram.
    if (type === '1') fills.push({ text, color: primary });
    else if (type === '2') { const secondary = cdrColor(String(fill.secondaryColor ?? '')); fills.push({ text, color: primary && secondary ? mix(primary, secondary) : primary, fountain: true }); }
    else if (type === '0' || type === undefined) fills.push({ text, color: 'none' });
    else fills.push({ text });
  }
  return fills;
}
/**
 * Aplica os preenchimentos do CDR ao SVG da libcdr. O conversor desenha de trás para frente (ordem inversa à do
 * arquivo), um elemento por objeto: só aplica quando a contagem confere (com ou sem os textos). Textos mantêm a
 * cor do conversor; curvas abertas ficam sem preenchimento, como no CorelDRAW.
 */
export function applyCdrFills(svg: string, fills: CdrFill[]): { svg: string; applied: number; fountains: number } {
  const tags = [...svg.matchAll(/<(path|text)[\s>/]/g)].map(m => ({ at: m.index!, text: m[1] === 'text' }));
  let order: CdrFill[];
  if (tags.length === fills.length) order = [...fills].reverse();
  else {
    const shapes = fills.filter(f => !f.text);
    if (!fills.length || tags.some(t => t.text) || tags.length !== shapes.length) return { svg, applied: 0, fountains: 0 };
    order = [...shapes].reverse();
  }
  let out = '', last = 0, applied = 0, fountains = 0;
  tags.forEach((tag, index) => {
    const fill = order[index];
    if (tag.text || !fill?.color || fill.color === 'none') return;
    const close = svg.indexOf('>', tag.at);
    if (close < 0) return;
    const element = svg.slice(tag.at, close), d = element.match(/\sd="([^"]*)"/)?.[1] ?? '';
    if (!/[zZ]/.test(d)) return;
    const style = element.match(/\sstyle="([^"]*)"/), styleFill = style?.[1].match(/(?:^|;)\s*fill\s*:\s*([^;]+)/)?.[1].trim();
    const current = styleFill ?? element.match(/\sfill="([^"]*)"/)?.[1];
    if (current && current !== 'none') return;
    const next = styleFill !== undefined
      ? element.replace(style![0], ` style="${style![1].replace(/((?:^|;)\s*fill\s*:\s*)none/, `$1${fill.color}`)}"`)
      : element.replace(/\sfill="none"/, '').replace(/^<path/, `<path fill="${fill.color}"`);
    out += svg.slice(last, tag.at) + next; last = close;
    applied++; if (fill.fountain) fountains++;
  });
  return { svg: out + svg.slice(last), applied, fountains };
}
