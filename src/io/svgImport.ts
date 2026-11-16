import type { PathCommand, VectorObject } from '../document/model.ts';
import { MAX_SIZE } from '../document/model.ts';
import { elements, localName, parseXml, type XmlElement } from './xml.ts';
import { applyMatrix, boundsOf, identity, multiply, transformPoint, type Matrix } from '../geometry/objectTransforms.ts';
import { mapCommands } from '../geometry/pathGeometry.ts';
import { normalizeCommands } from '../geometry/compoundPaths.ts';
import { flatten } from './exporters.ts';
import { approximateMeasure, FONT_FAMILY, PT, updateText, type Measure, type TextAlign } from '../text/textLayout.ts';
import { cdrStyleMatcher, type CdrTextStyle } from './cdrText.ts';

export interface SvgImport { name: string; artboard: { width: number; height: number }; objects: VectorObject[]; warnings: string[] }
type Style = Record<string, string>;
const INHERITED = ['fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'text-decoration', 'visibility'];
const SKIP = new Set(['defs', 'clipPath', 'mask', 'symbol', 'linearGradient', 'radialGradient', 'pattern', 'marker', 'style', 'title', 'desc', 'metadata', 'namedview', 'filter', 'script', 'foreignObject']);
const named: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000', navy: '#000080', purple: '#800080', teal: '#008080', orange: '#ffa500', brown: '#a52a2a', pink: '#ffc0cb', gold: '#ffd700' };
const n2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');

/** Comprimento SVG em px (96 dpi). */
export function svgLength(value: string | undefined, fallback = 0): number {
  const match = value?.trim().match(/^([-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?)\s*(px|pt|pc|mm|cm|in|%)?$/i);
  if (!match) return fallback;
  const unit = (match[2] ?? 'px').toLowerCase(), v = Number(match[1]);
  return unit === '%' ? fallback : v * ({ px: 1, pt: PT, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 } as Record<string, number>)[unit];
}
export function parseTransform(value: string | undefined): Matrix {
  let m = identity();
  for (const [, name, args] of (value ?? '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = (args.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    const r = (deg: number) => deg * Math.PI / 180;
    const t: Matrix = name === 'matrix' && a.length >= 6 ? [a[0], a[1], a[2], a[3], a[4], a[5]] : name === 'translate' ? [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0] : name === 'scale' ? [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]
      : name === 'rotate' ? (() => { const c = Math.cos(r(a[0] ?? 0)), s = Math.sin(r(a[0] ?? 0)), cx = a[1] ?? 0, cy = a[2] ?? 0; return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy] as Matrix; })()
      : name === 'skewX' ? [1, 0, Math.tan(r(a[0] ?? 0)), 1, 0, 0] : [1, Math.tan(r(a[0] ?? 0)), 0, 1, 0, 0];
    m = multiply(m, t);
  }
  return m;
}
/** Cor SVG em #rrggbb, 'none' ou undefined (herdar / desconhecida). */
export function svgColor(value: string | undefined): string | undefined {
  const v = value?.trim().toLowerCase();
  if (!v || v === 'inherit') return undefined;
  if (v === 'none' || v === 'transparent') return 'none';
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + [...v.slice(1)].map(c => c + c).join('');
  const rgb = v.match(/^rgba?\(([^)]*)\)/);
  if (rgb) { const p = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(x => x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x)); return '#' + p.map(n2).join(''); }
  if (v === 'currentcolor') return '#000000';
  return named[v];
}
// --- Dados de caminho: M L H V C S Q T A Z (relativos e absolutos) → M L C Z absolutos ---
export function parsePathData(d: string): PathCommand[] {
  const out: PathCommand[] = []; let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, qx = 0, qy = 0, last = '';
  const space = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const number = () => { space(); const m = /^[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/.exec(d.slice(i, i + 40)); if (!m) throw new Error('Caminho SVG inválido.'); i += m[0].length; return Number(m[0]); };
  const flag = () => { space(); const f = d[i++]; if (f !== '0' && f !== '1') throw new Error('Arco SVG inválido.'); return f === '1'; };
  const hasNumber = () => { space(); return i < d.length && /[-+.\d]/.test(d[i]); };
  while (true) {
    space(); if (i >= d.length) break;
    if (/[a-z]/i.test(d[i])) cmd = d[i++]; else if (!cmd) throw new Error('Caminho SVG inválido.');
    const rel = cmd === cmd.toLowerCase();
    let C = cmd.toUpperCase();
    const px = (v: number) => rel ? x + v : v, py = (v: number) => rel ? y + v : v;
    if (C === 'Z') { out.push({ type: 'Z' }); x = sx; y = sy; last = 'Z'; continue; }
    do {
      // Pares após M são "linha até" implícitos (relativos se o M for relativo).
      if (C === 'M') { x = px(number()); y = py(number()); sx = x; sy = y; out.push({ type: 'M', x, y }); C = 'L'; cmd = rel ? 'l' : 'L'; last = 'M'; continue; }
      if (C === 'L') { x = px(number()); y = py(number()); out.push({ type: 'L', x, y }); }
      else if (C === 'H') { x = rel ? x + number() : number(); out.push({ type: 'L', x, y }); }
      else if (C === 'V') { y = rel ? y + number() : number(); out.push({ type: 'L', x, y }); }
      else if (C === 'C' || C === 'S') {
        const [x1, y1] = C === 'C' ? [px(number()), py(number())] : last === 'C' || last === 'S' ? [2 * x - cx, 2 * y - cy] : [x, y];
        const x2 = px(number()), y2 = py(number()), ex = px(number()), ey = py(number());
        out.push({ type: 'C', x1, y1, x2, y2, x: ex, y: ey }); cx = x2; cy = y2; x = ex; y = ey;
      } else if (C === 'Q' || C === 'T') {
        const [x1, y1] = C === 'Q' ? [px(number()), py(number())] : last === 'Q' || last === 'T' ? [2 * x - qx, 2 * y - qy] : [x, y];
        const ex = px(number()), ey = py(number());
        out.push({ type: 'C', x1: x + 2 / 3 * (x1 - x), y1: y + 2 / 3 * (y1 - y), x2: ex + 2 / 3 * (x1 - ex), y2: ey + 2 / 3 * (y1 - ey), x: ex, y: ey }); qx = x1; qy = y1; x = ex; y = ey;
      } else if (C === 'A') {
        const rx = number(), ry = number(), rotation = number(), large = flag(), sweep = flag(), ex = px(number()), ey = py(number());
        out.push(...arcToCubics(x, y, rx, ry, rotation, large, sweep, ex, ey)); x = ex; y = ey;
      } else throw new Error(`Comando de caminho não suportado: ${cmd}`);
      last = C;
    } while (hasNumber());
  }
  return out;
}
/** Arco elíptico SVG convertido em curvas cúbicas (≤ 90° cada). */
function arcToCubics(x1: number, y1: number, rx: number, ry: number, angle: number, large: boolean, sweep: boolean, x2: number, y2: number): PathCommand[] {
  if (Math.hypot(x2 - x1, y2 - y1) < 1e-12) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [{ type: 'L', x: x2, y: y2 }];
  const phi = angle * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lambda = x1p ** 2 / rx ** 2 + y1p ** 2 / ry ** 2; if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const sign = large === sweep ? -1 : 1, num = rx ** 2 * ry ** 2 - rx ** 2 * y1p ** 2 - ry ** 2 * x1p ** 2;
  const coef = sign * Math.sqrt(Math.max(0, num / (rx ** 2 * y1p ** 2 + ry ** 2 * x1p ** 2)));
  const cxp = coef * rx * y1p / ry, cyp = -coef * ry * x1p / rx, cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const vec = (ux: number, uy: number, vx: number, vy: number) => { const a = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))))); return ux * vy - uy * vx < 0 ? -a : a; };
  const theta = vec(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = vec((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI; else if (sweep && delta < 0) delta += 2 * Math.PI;
  const segments = Math.ceil(Math.abs(delta) / (Math.PI / 2)), step = delta / segments, k = 4 / 3 * Math.tan(step / 4);
  const point = (t: number) => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  const deriv = (t: number) => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos });
  const out: PathCommand[] = [];
  for (let s = 0; s < segments; s++) {
    const a = theta + s * step, b = a + step, pa = point(a), pb = s === segments - 1 ? { x: x2, y: y2 } : point(b), da = deriv(a), db = deriv(b);
    out.push({ type: 'C', x1: pa.x + k * da.x, y1: pa.y + k * da.y, x2: pb.x - k * db.x, y2: pb.y - k * db.y, x: pb.x, y: pb.y });
  }
  return out;
}
/** Separa em contornos válidos para o projeto: cada um começa em M; contornos abertos ficam isolados. */
export function validContours(commands: PathCommand[]): { closed: PathCommand[][]; open: PathCommand[][] } {
  const closed: PathCommand[][] = [], open: PathCommand[][] = [];
  let current: PathCommand[] = [], start = { x: 0, y: 0 };
  const flush = (isClosed: boolean) => {
    const drawing = current.filter(c => c.type === 'L' || c.type === 'C').length;
    if (drawing >= 1 && (!isClosed || drawing >= 2 || current.some(c => c.type === 'C'))) (isClosed ? closed : open).push(isClosed ? [...current, { type: 'Z' }] : current);
    current = [];
  };
  for (const c of commands) {
    if (c.type === 'M') { flush(false); start = { x: c.x, y: c.y }; current = [c]; }
    else if (c.type === 'Z') { if (current.length) flush(true); current = []; }
    else { if (!current.length) current = [{ type: 'M', ...start }]; current.push(c); }
  }
  flush(false);
  return { closed, open };
}
interface Context { ctm: Matrix; style: Style; group: string[]; depth: number }
/** `cdrStyles`: estilos lidos do próprio CDR (peso, itálico, alinhamento); indica também SVG vindo de CDR. */
export interface SvgImportOptions { name?: string; measure?: Measure; uuid?: () => string; cdrStyles?: CdrTextStyle[] }
/** Converte SVG (inclusive o gerado do CorelDRAW e de PDF pelo Inkscape) em objetos editáveis do GFX Studio. */
export function importSvg(source: string, options: SvgImportOptions = {}): SvgImport {
  const root = parseXml(source);
  if (localName(root.name) !== 'svg') throw new Error('O arquivo não é um SVG.');
  const uuid = options.uuid ?? (() => crypto.randomUUID()), measure = options.measure ?? approximateMeasure;
  const ids = new Map<string, XmlElement>(), css = new Map<string, Style>();
  (function index(e: XmlElement) { if (e.attributes.id) ids.set(e.attributes.id, e); if (localName(e.name) === 'style') parseCss(e.children.filter((c): c is string => typeof c === 'string').join(''), css); elements(e).forEach(index); })(root);
  const vb = (root.attributes.viewBox ?? '').split(/[\s,]+/).map(Number);
  const hasViewBox = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const width = svgLength(root.attributes.width, hasViewBox ? vb[2] : 960), height = svgLength(root.attributes.height, hasViewBox ? vb[3] : 640);
  const base: Matrix = hasViewBox ? [width / vb[2], 0, 0, height / vb[3], -vb[0] * width / vb[2], -vb[1] * height / vb[3]] : identity();
  let warnings = new Set<string>(), matchCdr: ReturnType<typeof cdrStyleMatcher> | null = null;
  const convert = (factor: number) => {
    warnings = new Set(); matchCdr = options.cdrStyles ? cdrStyleMatcher(options.cdrStyles) : null;
    const objects = walkChildren(root, { ctm: multiply([factor, 0, 0, factor, 0, 0], base), style: {}, group: [], depth: 0 });
    return objects;
  };
  function styleOf(e: XmlElement, parent: Style): Style {
    const own: Style = {};
    for (const key of [...INHERITED, 'opacity', 'display', 'clip-path']) if (e.attributes[key] !== undefined) own[key] = e.attributes[key];
    for (const cls of (e.attributes.class ?? '').split(/\s+/).filter(Boolean)) Object.assign(own, css.get(cls));
    for (const part of (e.attributes.style ?? '').split(';')) { const [k, ...v] = part.split(':'); if (k?.trim() && v.length) own[k.trim()] = v.join(':').trim(); }
    const inherited: Style = {}; for (const key of INHERITED) if (parent[key] !== undefined) inherited[key] = parent[key];
    return { ...inherited, ...own };
  }
  function paint(value: string | undefined, fallback: string): string {
    if (value === undefined) return fallback;
    const url = value.match(/url\(\s*#([^)\s]+)\s*\)/);
    if (url) { const color = gradientColor(url[1]); if (color) { warnings.add('Degradês foram convertidos em cor sólida.'); return color; } warnings.add('Padrões de preenchimento foram convertidos em cinza.'); return '#808080'; }
    return svgColor(value) ?? fallback;
  }
  function gradientColor(id: string, guard = 0): string | undefined {
    const g = ids.get(id); if (!g || guard > 8) return undefined;
    const stops = elements(g).filter(s => localName(s.name) === 'stop');
    if (!stops.length) { const href = (g.attributes['xlink:href'] ?? g.attributes.href ?? '').replace(/^#/, ''); return href ? gradientColor(href, guard + 1) : undefined; }
    const stop = stops[0], st = styleOf(stop, {});
    return svgColor(stop.attributes['stop-color'] ?? st['stop-color']) ?? '#000000';
  }
  const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  function shapeStyle(style: Style, ctm: Matrix): Pick<VectorObject, 'fill' | 'stroke' | 'strokeWidth' | 'fillRule'> {
    const visible = (key: string) => Number(style[key] ?? 1) * Number(style.opacity ?? 1) > 0.001;
    if (Number(style['fill-opacity'] ?? 1) < 0.999 || Number(style.opacity ?? 1) < 0.999) warnings.add('Transparências foram ignoradas (cores sólidas).');
    const fill = visible('fill-opacity') ? paint(style.fill, '#000000') : 'none';
    const stroke = visible('stroke-opacity') ? paint(style.stroke, 'none') : 'none';
    const width = Math.max(0, Math.min(1000, svgLength(style['stroke-width'], 1) * scaleOf(ctm)));
    return { fill, stroke, strokeWidth: stroke === 'none' ? 0 : width, ...(style['fill-rule'] === 'evenodd' ? { fillRule: 'evenodd' as const } : {}) };
  }
  function pathObjects(world: PathCommand[], style: Pick<VectorObject, 'fill' | 'stroke' | 'strokeWidth' | 'fillRule'>, name: string): VectorObject[] {
    const { closed, open: rawOpen } = validContours(world), out: VectorObject[] = [];
    // PDF/SVG preenchem contornos abertos fechando-os implicitamente: viram contornos fechados (booleanas funcionam).
    const ends = (c: PathCommand[]) => { const a = c[0] as { x: number; y: number }, b = c.at(-1) as { x: number; y: number }; return Math.hypot(a.x - b.x, a.y - b.y) < 1e-6; };
    const open = rawOpen.filter(c => { if (style.fill === 'none' || (style.stroke !== 'none' && !ends(c)) || c.length < 3) return true; closed.push([...c, { type: 'Z' }]); return false; });
    const make = (commands: PathCommand[]) => { const g = normalizeCommands(commands); out.push({ id: uuid(), type: 'path', name, x: g.x, y: g.y, width: g.width, height: g.height, pathSize: g.pathSize, commands: g.commands, ...style }); };
    let chunk: PathCommand[] = [];
    for (const contour of closed) { if (contour.length > 9990) continue; if (chunk.length + contour.length > 9990) { make(chunk); chunk = []; } chunk.push(...contour); }
    if (chunk.length) make(chunk);
    for (const contour of open) if (contour.length <= 9990) make(contour);
    return out;
  }
  const inRange = (...values: number[]) => values.every(v => Number.isFinite(v) && Math.abs(v) <= MAX_SIZE);
  function geometryOf(e: XmlElement): PathCommand[] | null {
    const a = e.attributes, num = (k: string, f = 0) => svgLength(a[k], f), tag = localName(e.name);
    if (tag === 'path') return a.d ? parsePathData(a.d) : null;
    if (tag === 'line') return [{ type: 'M', x: num('x1'), y: num('y1') }, { type: 'L', x: num('x2'), y: num('y2') }];
    if (tag === 'polyline' || tag === 'polygon') {
      const p = (a.points?.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
      if (p.length < 4) return null;
      const out: PathCommand[] = [{ type: 'M', x: p[0], y: p[1] }];
      for (let i = 2; i + 1 < p.length; i += 2) out.push({ type: 'L', x: p[i], y: p[i + 1] });
      if (tag === 'polygon') out.push({ type: 'Z' });
      return out;
    }
    if (tag === 'rect') { const x = num('x'), y = num('y'), w = num('width'), h = num('height'); return w > 0 && h > 0 ? [{ type: 'M', x, y }, { type: 'L', x: x + w, y }, { type: 'L', x: x + w, y: y + h }, { type: 'L', x, y: y + h }, { type: 'Z' }] : null; }
    if (tag === 'circle' || tag === 'ellipse') {
      const cx = num('cx'), cy = num('cy'), rx = tag === 'circle' ? num('r') : num('rx', num('ry')), ry = tag === 'circle' ? num('r') : num('ry', num('rx'));
      if (!(rx > 0 && ry > 0)) return null;
      return [{ type: 'M', x: cx + rx, y: cy }, ...arcToCubics(cx + rx, cy, rx, ry, 0, false, true, cx - rx, cy), ...arcToCubics(cx - rx, cy, rx, ry, 0, false, true, cx + rx, cy), { type: 'Z' }];
    }
    return null;
  }
  function shape(e: XmlElement, ctx: Context, style: Style): VectorObject[] {
    const tag = localName(e.name), a = e.attributes, paintStyle = shapeStyle(style, ctx.ctm), m = ctx.ctm;
    const native = (type: 'rectangle' | 'ellipse', x: number, y: number, w: number, h: number, extra: Partial<VectorObject> = {}): VectorObject[] | null => {
      if (!(w > 0 && h > 0) || !inRange(x, y, w, h, x + w, y + h) || m.some((v, i) => Math.abs(v) > (i < 4 ? 1e6 : 1e9)) || Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-12) return null;
      const object: VectorObject = { id: uuid(), type, name: type === 'rectangle' ? 'Retângulo' : 'Elipse', x, y, width: w, height: h, ...paintStyle, ...extra };
      if (m.some((v, i) => Math.abs(v - identity()[i]) > 1e-12)) object.transform = [...m] as Matrix;
      return [object];
    };
    if (tag === 'rect') {
      const rx = svgLength(a.rx, svgLength(a.ry)), ry = svgLength(a.ry, rx);
      const made = native('rectangle', svgLength(a.x), svgLength(a.y), svgLength(a.width), svgLength(a.height), rx > 0 && Math.abs(rx - ry) < 1e-9 ? { cornerRadius: rx } : {});
      if (made) return made;
    }
    if (tag === 'circle' || tag === 'ellipse') {
      const cx = svgLength(a.cx), cy = svgLength(a.cy), rx = tag === 'circle' ? svgLength(a.r) : svgLength(a.rx, svgLength(a.ry)), ry = tag === 'circle' ? rx : svgLength(a.ry, rx);
      const made = native('ellipse', cx - rx, cy - ry, 2 * rx, 2 * ry); if (made) return made;
    }
    const local = geometryOf(e);
    if (!local?.length) return [];
    const world = mapCommands(local, p => transformPoint(m, p));
    const name = tag === 'path' ? 'Curva' : tag === 'rect' ? 'Retângulo' : tag === 'circle' || tag === 'ellipse' ? 'Elipse' : tag === 'line' ? 'Linha' : 'Polígono';
    return pathObjects(world, tag === 'line' || tag === 'polyline' ? { ...paintStyle, fill: style.fill ? paintStyle.fill : 'none' } : paintStyle, name);
  }
  type TextLook = { weight?: number; italic?: boolean; lineSpacing?: number };
  const familyOf = (st: Style) => { const family = (st['font-family'] ?? 'Arial').split(',')[0].replace(/['"]/g, '').trim(); return FONT_FAMILY.test(family) ? family : 'Arial'; };
  const sizeOf = (st: Style) => svgLength(st['font-size']?.replace(/^(\d)/, '$1'), 16);
  const lookOf = (st: Style, cdr?: CdrTextStyle): TextLook => {
    const css = st['font-weight'] ?? '', numeric = Number(css), weight = cdr?.weight ?? (numeric >= 100 && numeric <= 1000 ? numeric : /bold/.test(css) ? 700 : undefined);
    return { weight, italic: cdr?.italic || /italic|oblique/.test(st['font-style'] ?? ''), lineSpacing: cdr?.lineSpacing };
  };
  const fontOf = (st: Style, look: TextLook, px = sizeOf(st)) => `${look.italic ? 'italic ' : ''}${look.weight ?? 400} ${px}px "${familyOf(st)}", sans-serif`;
  /** Texto com a linha de base em (x, baseline) nas coordenadas locais; a caixa começa em x. */
  function textObject(content: string, st: Style, x: number, baseline: number, ctx: Context, look: TextLook, align: TextAlign): VectorObject {
    const px = sizeOf(st);
    let local = { x, y: baseline, px }, matrix = ctx.ctm;
    // Mantém o tamanho em pontos dentro dos limites, passando a escala para a matriz.
    const pt = px / PT; if (pt < 1 || pt > 2000) { const f = (pt < 1 ? 12 : 1000) / pt; local = { x: x * f, y: baseline * f, px: px * f }; matrix = multiply(ctx.ctm, [1 / f, 0, 0, 1 / f, 0, 0]); }
    const fill = Number(st['fill-opacity'] ?? 1) * Number(st.opacity ?? 1) > 0.001 ? paint(st.fill, '#000000') : 'none';
    const weight = look.weight;
    let object: VectorObject = { id: uuid(), type: 'text', name: 'Texto', x: local.x, y: local.y - local.px * 0.9, width: 1, height: 1, fill, text: content, fontFamily: familyOf(st), fontSize: local.px / PT, ...(weight !== undefined && weight >= 600 ? { bold: true } : {}), ...(weight !== undefined && weight !== 400 && weight !== 700 ? { fontWeight: weight } : {}), ...(look.italic ? { italic: true } : {}), ...(look.lineSpacing && Math.abs(look.lineSpacing - 1.2) > 1e-6 ? { lineSpacing: look.lineSpacing } : {}), ...(/underline/.test(st['text-decoration'] ?? '') ? { underline: true } : {}), ...(align !== 'left' ? { textAlign: align } : {}) };
    object = updateText(object, {}, measure);
    if (matrix.some((v, i) => Math.abs(v - identity()[i]) > 1e-12)) object.transform = [...matrix] as Matrix;
    return object;
  }
  function text(e: XmlElement, ctx: Context, style: Style): VectorObject[] {
    if (options.cdrStyles) return cdrText(e, ctx, style);
    // Cada trecho com posição própria (x/y) vira um objeto de texto; vários trechos ficam agrupados.
    const lines: { x: number; y: number; text: string; style: Style }[] = [];
    let cursor = { x: svgLength(e.attributes.x?.split(/[\s,]+/)[0]), y: svgLength(e.attributes.y?.split(/[\s,]+/)[0]) };
    const visit = (node: XmlElement, st: Style) => {
      for (const child of node.children) {
        if (typeof child === 'string') { const t = child.replace(/\s+/g, ' '); if (!t.trim()) continue; const line = lines.at(-1); if (line && line.x === cursor.x && line.y === cursor.y) line.text += t; else lines.push({ ...cursor, text: t, style: st }); continue; }
        if (localName(child.name) !== 'tspan' && localName(child.name) !== 'a') continue;
        const cs = styleOf(child, st);
        if (child.attributes.x !== undefined || child.attributes.y !== undefined) cursor = { x: child.attributes.x !== undefined ? svgLength(child.attributes.x.split(/[\s,]+/)[0]) : cursor.x, y: child.attributes.y !== undefined ? svgLength(child.attributes.y.split(/[\s,]+/)[0]) : cursor.y };
        visit(child, cs);
      }
    };
    visit(e, style);
    return lines.map(line => {
      const anchor = line.style['text-anchor'], align = anchor === 'middle' ? 'center' as const : anchor === 'end' ? 'right' as const : 'left' as const;
      let object = textObject(line.text.trim(), line.style, line.x, line.y, ctx, lookOf(line.style), align);
      // Âncora central/direita: a caixa medida é posicionada a partir do ponto x do SVG.
      if (align !== 'left') { const scale = object.fontSize! * PT / sizeOf(line.style); object = { ...object, x: line.x * scale - (align === 'center' ? object.width / 2 : object.width) }; }
      return object;
    }).filter(o => o.text && inRange(o.x, o.y, o.width, o.height));
  }
  /**
   * Texto vindo do CorelDRAW (libcdr): quebras de linha reais ("\n") dentro dos trechos, um ponto (x, y) na
   * linha de base da primeira linha e trechos de cores diferentes que continuam na mesma linha.
   * Peso, itálico e alinhamento vêm do próprio CDR. Um estilo só → um texto de várias linhas; estilos
   * misturados → um texto por trecho, posicionados pela medida da fonte e agrupados.
   */
  function cdrText(e: XmlElement, ctx: Context, style: Style): VectorObject[] {
    const runs: { text: string; style: Style; index: number }[] = [];
    let spans = 0;
    const visit = (node: XmlElement, st: Style, index: number) => {
      let first = true;
      for (const child of node.children) {
        if (typeof child === 'string') { let t = child.replace(/\r/g, ''); if (first && node !== e) t = t.replace(/^\n/, ''); first = false; if (node === e && !t.trim()) continue; if (t) runs.push({ text: t, style: st, index }); continue; }
        first = false;
        if (localName(child.name) === 'tspan' || localName(child.name) === 'a') visit(child, styleOf(child, st), node === e ? spans++ : index);
      }
    };
    visit(e, style, 0);
    if (!runs.length) return [];
    const firstStyle = runs[0].style, cdr = matchCdr?.(sizeOf(firstStyle)), look = lookOf(firstStyle, cdr), align = cdr?.align ?? 'left';
    // Cada trecho (tspan) pode ter peso/itálico próprios no CDR.
    const runLook = (index: number): TextLook => { const run = cdr?.runs?.[index]; return { ...look, weight: run?.weight ?? look.weight, italic: run?.italic ?? look.italic }; };
    type Seg = { text: string; style: Style; look: TextLook };
    const lines: Seg[][] = [[]];
    for (const run of runs) run.text.split('\n').forEach((part, i) => { if (i) lines.push([]); if (part) lines.at(-1)!.push({ text: part, style: run.style, look: runLook(run.index) }); });
    // Espaços no fim da linha não contam para o alinhamento (como no CorelDRAW).
    for (const line of lines) { const last = line.at(-1); if (last) { last.text = last.text.replace(/\s+$/, ''); if (!last.text) line.pop(); } }
    while (lines.length > 1 && !lines.at(-1)!.length) lines.pop();
    const x = svgLength(e.attributes.x?.split(/[\s,]+/)[0]), lineHeight = sizeOf(firstStyle) * (look.lineSpacing ?? 1.2);
    // O y do conversor é a linha de base da última linha (conferido com a prévia do CorelDRAW).
    const y = svgLength(e.attributes.y?.split(/[\s,]+/)[0]) - (lines.length - 1) * lineHeight;
    const key = (seg: Seg) => [familyOf(seg.style), sizeOf(seg.style), paint(seg.style.fill, '#000000'), seg.look.weight ?? '', !!seg.look.italic, seg.style['text-decoration'] ?? ''].join('|');
    const segs = lines.flat();
    const width = (line: Seg[]) => line.reduce((sum, seg) => sum + measure(seg.text, fontOf(seg.style, seg.look)), 0);
    // O conversor grava o x como (referência − largura da primeira linha) no texto centralizado: o centro
    // fica em x + largura (conferido com a prévia do CorelDRAW); à direita, a borda é x + largura.
    const firstWidth = width(lines[0]), anchor = align === 'left' ? x : x + firstWidth;
    const startOf = (w: number) => align === 'center' ? anchor - w / 2 : align === 'right' ? anchor - w : x;
    let made: VectorObject[];
    if (segs.every(seg => key(seg) === key(segs[0]))) {
      const content = lines.map(line => line.map(seg => seg.text).join('')).join('\n');
      const object = textObject(content, firstStyle, x, y, ctx, segs[0].look, align), scale = object.fontSize! * PT / sizeOf(firstStyle);
      // A caixa do texto alinhado tem a largura da linha mais longa; o ponto de referência fica no lugar.
      made = [{ ...object, x: (align === 'center' ? anchor - object.width / scale / 2 : align === 'right' ? anchor - object.width / scale : x) * scale }];
    } else {
      made =lines.flatMap((line, i) => {
        let at = startOf(width(line));
        return line.map(seg => { const o = textObject(seg.text, seg.style, at, y + i * lineHeight, ctx, seg.look, 'left'); at += measure(seg.text, fontOf(seg.style, seg.look)); return o; });
      });
      if (made.length > 1) { const group = uuid(); made = made.map(o => ({ ...o, groupPath: [group] })); }
    }
    return made.filter(o => o.text?.trim() && inRange(o.x, o.y, o.width, o.height));
  }
  function image(e: XmlElement, ctx: Context): VectorObject[] {
    const href = e.attributes['xlink:href'] ?? e.attributes.href ?? '', w = svgLength(e.attributes.width), h = svgLength(e.attributes.height), x = svgLength(e.attributes.x), y = svgLength(e.attributes.y);
    if (!href.startsWith('data:image/')) { if (href) warnings.add('Imagens vinculadas a arquivos externos não foram importadas.'); return []; }
    if (!(w > 0 && h > 0) || !inRange(x, y, w, h)) return [];
    const object: VectorObject = { id: uuid(), type: 'image', name: 'Bitmap', x, y, width: w, height: h, fill: 'none', src: href.replace(/\s+/g, '') };
    if (ctx.ctm.some((v, i) => Math.abs(v - identity()[i]) > 1e-12)) object.transform = [...ctx.ctm] as Matrix;
    return [object];
  }
  function clipGeometry(url: string | undefined, ctm: Matrix): PathCommand[] | null {
    const id = url?.match(/url\(\s*#([^)\s]+)\s*\)/)?.[1], clip = id ? ids.get(id) : undefined;
    if (!clip) return null;
    const m = multiply(ctm, parseTransform(clip.attributes.transform));
    const parts = elements(clip).flatMap(child => { const g = geometryOf(child); return g ? mapCommands(g, p => transformPoint(multiply(m, parseTransform(child.attributes.transform)), p)) : []; });
    return parts.length ? parts : null;
  }
  function walk(e: XmlElement, parent: Context): VectorObject[] {
    const tag = localName(e.name);
    if (SKIP.has(tag) || parent.depth > 60) return [];
    const style = styleOf(e, parent.style);
    if (style.display === 'none' || style.visibility === 'hidden') return [];
    let ctm = multiply(parent.ctm, parseTransform(e.attributes.transform));
    if (tag === 'svg' || tag === 'use') ctm = multiply(ctm, [1, 0, 0, 1, svgLength(e.attributes.x), svgLength(e.attributes.y)]);
    const ctx: Context = { ctm, style, group: parent.group, depth: parent.depth + 1 };
    let objects: VectorObject[];
    if (tag === 'g' || tag === 'a' || tag === 'switch' || tag === 'svg') objects = walkChildren(e, ctx);
    else if (tag === 'use') { const ref = ids.get((e.attributes['xlink:href'] ?? e.attributes.href ?? '').replace(/^#/, '')); objects = ref ? localName(ref.name) === 'symbol' ? walkChildren(ref, ctx) : walk(ref, { ...ctx, depth: ctx.depth + 1 }) : []; }
    else if (tag === 'text') objects = text(e, ctx, style);
    else if (tag === 'image') objects = image(e, ctx);
    else if (['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(tag)) { try { objects = shape(e, ctx, style); } catch { warnings.add('Alguns caminhos inválidos foram ignorados.'); objects = []; } }
    else return [];
    // Recorte (clip-path): ignorado se não corta nada; caso contrário vira PowerClip.
    const clip = style['clip-path'] && objects.length ? clipGeometry(style['clip-path'], ctm) : null;
    if (clip) {
      const content = boundsOf(objects.filter(o => !o.clipParent)), frameBox = normalizeCommands(clip), tolerance = 0.5;
      // Só um recorte retangular que contém o conteúdo é dispensável (ex.: recorte da página no PDF).
      const area = flatten(clip).reduce((sum, c) => sum + Math.abs(c.points.reduce((a, p, i) => { const q = c.points[(i + 1) % c.points.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2), 0);
      const rectangular = area >= frameBox.width * frameBox.height * 0.995;
      const cuts = !rectangular || content.x < frameBox.x - tolerance || content.y < frameBox.y - tolerance || content.x + content.width > frameBox.x + frameBox.width + tolerance || content.y + content.height > frameBox.y + frameBox.height + tolerance;
      const frame = cuts ? pathObjects(clip, { fill: 'none', stroke: 'none', strokeWidth: 0 }, 'Quadro PowerClip').find(o => o.commands!.at(-1)?.type === 'Z') : undefined;
      if (frame && inRange(frame.x, frame.y)) objects = [frame, ...objects.map(o => o.clipParent ? o : { ...o, clipParent: frame.id })];
    }
    return objects;
  }
  function walkChildren(e: XmlElement, ctx: Context): VectorObject[] {
    const objects = elements(e).flatMap(child => walk(child, ctx));
    // Grupos SVG com mais de um objeto viram grupos editáveis (até 30 níveis).
    const units = new Set(objects.map(o => o.groupPath?.[0] ?? (o.clipParent ? rootFrame(objects, o) : o.id)));
    if (localName(e.name) === 'svg' && ctx.depth === 0 || units.size < 2 || objects.some(o => (o.groupPath?.length ?? 0) >= 30)) return objects;
    const id = uuid();
    return objects.map(o => ({ ...o, groupPath: [id, ...(o.groupPath ?? [])] }));
  }
  let objects = convert(1);
  if (objects.length) {
    const b = boundsOf(objects);
    const extent = Math.max(Math.abs(b.x), Math.abs(b.y), Math.abs(b.x + b.width), Math.abs(b.y + b.height), b.width, b.height);
    if (extent > MAX_SIZE * 0.95) { const factor = MAX_SIZE * 0.9 / extent; objects = convert(factor); warnings.add(`O desenho foi reduzido para ${Math.round(factor * 100)}% para caber nos limites do projeto (20.000 px).`); return finish(objects, factor); }
  }
  return finish(objects, 1);
  function finish(list: VectorObject[], factor: number): SvgImport {
    // O grupo que envolve o desenho inteiro (comum em PDF) não ajuda a editar: é removido.
    while (list.length > 1 && list.every(o => o.groupPath?.length && o.groupPath[0] === list[0].groupPath?.[0])) list = list.map(o => { const next: VectorObject = { ...o, groupPath: o.groupPath!.slice(1) }; if (!next.groupPath!.length) delete next.groupPath; return next; });
    if (list.length > 10000) throw new Error(`O arquivo tem ${list.length} objetos; o limite é 10.000.`);
    const clamp = (v: number) => Math.round(Math.max(1, Math.min(10000, v * factor)) * 10) / 10, artboard = { width: clamp(width), height: clamp(height) };
    // Desenho totalmente fora da página (comum em CDR recentes): centraliza na página.
    if (list.length) {
      const b = boundsOf(list.filter(o => !o.clipParent));
      if (b.x > artboard.width || b.y > artboard.height || b.x + b.width < 0 || b.y + b.height < 0) {
        const dx = artboard.width / 2 - b.x - b.width / 2, dy = artboard.height / 2 - b.y - b.height / 2;
        list = applyMatrix(list, list.map(o => o.id), [1, 0, 0, 1, dx, dy]);
        warnings.add('O desenho estava fora da página e foi centralizado nela.');
      }
    }
    return { name: options.name ?? 'Importado', artboard, objects: list, warnings: [...warnings] };
  }
}
function rootFrame(objects: VectorObject[], o: VectorObject): string {
  let current = o; for (let i = 0; i < 32 && current.clipParent; i++) { const parent = objects.find(p => p.id === current.clipParent); if (!parent) break; current = parent; }
  return current.groupPath?.[0] ?? current.id;
}
function parseCss(text: string, css: Map<string, Style>) {
  for (const [, selectors, body] of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const style: Style = {};
    for (const part of body.split(';')) { const [k, ...v] = part.split(':'); if (k?.trim() && v.length) style[k.trim()] = v.join(':').trim(); }
    for (const selector of selectors.split(',')) { const cls = selector.trim().match(/^\.([\w-]+)$/)?.[1]; if (cls) css.set(cls, { ...css.get(cls), ...style }); }
  }
}
