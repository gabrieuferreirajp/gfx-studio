import { cropLocal } from '../bitmap/imageCrop.ts';
import { activeSpot, type SpotColor , activeCmyk } from '../workspace/palettes.ts';
import { maskActive, maskSvg } from '../bitmap/layerMask.ts';
import type { PathCommand, VectorDocument, VectorObject } from '../document/model.ts';
import { boundsOf, matrixOf, svgTransform, type Bounds, type Matrix } from '../geometry/objectTransforms.ts';
import { commandsToSvg } from '../geometry/pathGeometry.ts';
import { worldCommands } from '../geometry/worldGeometry.ts';
import { splitContours } from '../geometry/compoundPaths.ts';
import { clipContents } from '../geometry/objectTransforms.ts';
import { blendCss, blendModes, gradientMask, hasTransparency, invertedBlend } from '../document/transparency.ts';
import { letterSpacingPx, textWeight } from '../text/textLayout.ts';
import { arrowShapes, averageFill, fillGradientGeometry, outerBox, strokePlacement, strokeStyle, strokeVisible } from '../document/paint.ts';
import { approximateMeasure, fontPx, isStyledText, lineLayout, type Measure } from '../text/textLayout.ts';
import { isPrintable } from '../document/layers.ts';
import { meshSvg, patternDef } from '../document/patterns.ts';

export type VectorFormat = 'svg' | 'pdf' | 'eps' | 'dxf' | 'dwg' | 'plt' | 'cdr';
export type RasterFormat = 'png' | 'jpg' | 'webp';
export type ExportFormat = VectorFormat | RasterFormat;
export type ExportArea = 'page' | 'objects' | 'selection';
export const formatInfo: Record<ExportFormat, { label: string; extension: string; mime: string }> = {
  cdr: { label: 'CDR — CorelDRAW (escolha a versão)', extension: 'cdr', mime: 'application/vnd.corel-draw' },
  pdf: { label: 'PDF — Adobe Portable Document Format', extension: 'pdf', mime: 'application/pdf' },
  svg: { label: 'SVG — Scalable Vector Graphics', extension: 'svg', mime: 'image/svg+xml' },
  eps: { label: 'EPS — Encapsulated PostScript', extension: 'eps', mime: 'application/postscript' },
  dxf: { label: 'DXF — AutoCAD (milímetros)', extension: 'dxf', mime: 'application/dxf' },
  dwg: { label: 'DWG — AutoCAD 2000 (milímetros)', extension: 'dwg', mime: 'application/acad' },
  plt: { label: 'PLT — HPGL para plotter de recorte', extension: 'plt', mime: 'application/vnd.hp-hpgl' },
  png: { label: 'PNG — Portable Network Graphics', extension: 'png', mime: 'image/png' },
  jpg: { label: 'JPG — JPEG', extension: 'jpg', mime: 'image/jpeg' },
  webp: { label: 'WEBP — WebP', extension: 'webp', mime: 'image/webp' },
};
/** Objetos e área exportados. O conteúdo de PowerClips acompanha o quadro. */
export interface Scene { objects: VectorObject[]; area: Bounds }
export function exportScene(document: VectorDocument, area: ExportArea, selectedIds: string[]): Scene {
  const ids = area === 'selection' ? new Set(clipContents(document.objects, selectedIds)) : null;
  // Camadas ocultas ou não imprimíveis ficam fora da exportação e da impressão (CorelDRAW).
  const printable = document.objects.filter(o => isPrintable(document, o));
  const objects = ids ? printable.filter(o => ids.has(o.id)) : printable;
  if (!objects.length && area !== 'page') throw new Error(area === 'selection' ? 'Nada selecionado para exportar.' : 'O documento não tem objetos.');
  const visible = objects.filter(o => !o.clipParent || !objects.some(p => p.id === o.clipParent));
  const b = area === 'page' ? { x: 0, y: 0, ...document.artboard } : boundsOf(visible);
  return { objects, area: { x: b.x, y: b.y, width: Math.max(1, b.width), height: Math.max(1, b.height) } };
}
const roots = (scene: Scene) => scene.objects.filter(o => !o.clipParent || !scene.objects.some(p => p.id === o.clipParent));
const contentsOf = (scene: Scene, id: string) => scene.objects.filter(o => o.clipParent === id);
const escapeXml = (text: string) => text.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
const n = (v: number) => Number(v.toFixed(4)).toString();

/** Avisos de transparência/mesclagem que o formato não reproduz fielmente. */
export function transparencyNote(scene: Scene, format: ExportFormat): string {
  const used = scene.objects.filter(hasTransparency), gradients = scene.objects.filter(o => o.fillGradient);
  const special = scene.objects.filter(o => o.fillPattern || o.meshFill), rasterNote = special.length && format !== 'svg' && format !== 'png' && format !== 'jpg' && format !== 'webp' ? 'Preenchimentos de padrão e de malha saem com cor sólida neste formato (fundo do padrão ou cor média da malha). ' : '';
  const maskNote = scene.objects.some(o => o.mask && !o.mask.disabled) && format !== 'svg' && format !== 'png' && format !== 'jpg' && format !== 'webp' ? 'Máscaras de camada só saem em SVG, PNG, JPG e WebP: neste formato os objetos mascarados saem inteiros. ' : '';
  return maskNote + rasterNote + baseNote(scene, format, used, gradients);
}
function baseNote(scene: Scene, format: ExportFormat, used: VectorObject[], gradients: VectorObject[]): string {
  if (gradients.length && (format === 'eps' || format === 'dxf' || format === 'dwg' || format === 'plt')) return 'Degradês de preenchimento não existem neste formato: saem com a cor média.' + (used.length && format === 'eps' ? ' Transparências saem opacas.' : '');
  if (!used.length) return format === 'pdf' && gradients.some(o => (o.fillGradient!.spread && o.fillGradient!.spread !== 'pad') || o.fillGradient!.stops.some(st => (st.opacity ?? 1) < 1) || o.type === 'text') ? 'No PDF, degradês saem sem repetição, sem transparência nos pontos de cor e, em textos, com a primeira cor. Para fidelidade total, exporte SVG ou PNG.' : '';
  if (format === 'eps' || format === 'dxf' || format === 'dwg' || format === 'plt') return 'Transparências e modos de mesclagem não existem neste formato: os objetos saem opacos.';
  if (format === 'pdf' && used.some(o => o.transparencyGradient)) return 'Degradês de transparência saem no PDF com a transparência média, uniforme. Para manter o degradê, exporte PNG ou SVG.';
  if (format === 'pdf' && used.some(o => o.blendMode && !('pdf' in blendModes[o.blendMode]))) return 'O PDF não tem os modos Subexposição linear (Adicionar), Superexposição linear e Subtrair: esses objetos saem com mesclagem Normal (a transparência % é mantida).';
  return '';
}
export function toSvg(scene: Scene, measure: TextMeasure = averageMeasure, background?: string): string {
  const { area } = scene;
  // Transparência uniforme e modo de mesclagem envolvem o objeto inteiro.
  const draw = (o: VectorObject): string => {
    const blend = blendCss(o), opacity = o.opacity !== undefined && o.opacity < 1, g = o.transparencyGradient;
    let mask = '';
    if (g) { const m = gradientMask(o), stops = m.stops.map(st => `<stop offset="${st.offset}" stop-color="#fff" stop-opacity="${n(st.opacity)}"/>`).join(''), grad = g.type === 'linear' ? `<linearGradient id="tgrad-${o.id}" gradientUnits="userSpaceOnUse" x1="${n(m.start.x)}" y1="${n(m.start.y)}" x2="${n(m.end.x)}" y2="${n(m.end.y)}">${stops}</linearGradient>` : `<radialGradient id="tgrad-${o.id}" gradientUnits="userSpaceOnUse" cx="${n(m.start.x)}" cy="${n(m.start.y)}" r="${n(m.radius)}">${stops}</radialGradient>`;
      mask = `<mask id="tmask-${o.id}" maskUnits="userSpaceOnUse" x="${n(m.box.x)}" y="${n(m.box.y)}" width="${n(m.box.width)}" height="${n(m.box.height)}" style="mask-type:alpha">${grad}<rect x="${n(m.box.x)}" y="${n(m.box.y)}" width="${n(m.box.width)}" height="${n(m.box.height)}" fill="url(#tgrad-${o.id})"/></mask>`; }
    if (blend || opacity || g) return `<g${opacity ? ` opacity="${n(o.opacity!)}"` : ''}${blend ? ` style="mix-blend-mode:${blend}"` : ''}${g ? ` mask="url(#tmask-${o.id})"` : ''}>${mask}${paint(o)}</g>`;
    return paint(o);
  };
  // Subtrair: fundo invertido + objeto invertido somado, tudo invertido de novo (ver Canvas.blendLayers).
  const layers = (objects: VectorObject[]) => objects.reduce<string[]>((below, o) => invertedBlend(o.blendMode) ? [`<g filter="url(#vs-invert)"><g filter="url(#vs-invert)">${below.join('')}</g><g${o.blendMode === 'subtract' ? ' filter="url(#vs-invert)"' : ''} style="mix-blend-mode:plus-lighter">${draw(o)}</g></g>`] : [...below, draw(o)], []);
  const subtract = scene.objects.some(o => invertedBlend(o.blendMode)) ? `<filter id="vs-invert" filterUnits="userSpaceOnUse" x="${n(area.x - area.width)}" y="${n(area.y - area.height)}" width="${n(area.width * 3)}" height="${n(area.height * 3)}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0"/></filter>\n` : '';
  const kebab = (attrs: Record<string, string | number>) => Object.entries(attrs).map(([k, v]) => ` ${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${v}"`).join('');
  const gradientDef = (o: VectorObject, local = false) => {
    if (!o.fillGradient) return '';
    const g = fillGradientGeometry(o, local), stops = g.stops.map(st => `<stop offset="${n(st.offset)}" stop-color="${st.color}"${(st.opacity ?? 1) < 1 ? ` stop-opacity="${n(st.opacity!)}"` : ''}/>`).join(''), spread = g.spread !== 'pad' ? ` spreadMethod="${g.spread}"` : '';
    return o.fillGradient.type === 'linear' ? `<linearGradient id="fgrad-${o.id}" gradientUnits="userSpaceOnUse" x1="${n(g.start.x)}" y1="${n(g.start.y)}" x2="${n(g.end.x)}" y2="${n(g.end.y)}"${spread}>${stops}</linearGradient>` : `<radialGradient id="fgrad-${o.id}" gradientUnits="userSpaceOnUse" cx="${n(g.start.x)}" cy="${n(g.start.y)}" r="${n(g.radius)}"${spread}>${stops}</radialGradient>`;
  };
  const fillOf = (o: VectorObject) => o.fillPattern ? `url(#fpat-${o.id})` : o.fillGradient ? `url(#fgrad-${o.id})` : o.fill;
  const patternOf = (o: VectorObject, local = false) => o.fillPattern ? patternDef(o, local) : '';
  /** Caminho com a caneta de contorno: centro, dentro (recorte) ou fora (máscara), atrás do preenchimento e setas. */
  const paintedPath = (o: VectorObject, d: string, part: 'all' | 'fill' | 'stroke') => {
    const rule = o.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '', place = strokePlacement(o), w = o.strokeWidth ?? 0;
    const fill = part === 'stroke' ? '' : o.meshFill ? meshSvg(o, d) : `${gradientDef(o)}${patternOf(o)}<path d="${d}" fill="${fillOf(o)}"${rule}/>`;
    let stroke = '';
    if (part !== 'fill' && strokeVisible(o)) {
      const attrs = ` fill="none" stroke="${o.stroke}"${kebab(strokeStyle(o))}`;
      if (place === 'center') stroke = `<path d="${d}"${attrs} stroke-width="${n(w)}"/>`;
      else if (place === 'inside') stroke = `<clipPath id="sclip-${o.id}"><path d="${d}"${rule.replace('fill-rule', 'clip-rule')}/></clipPath><path d="${d}"${attrs} stroke-width="${n(w * 2)}" clip-path="url(#sclip-${o.id})"/>`;
      else { const b = outerBox(o); stroke = `<mask id="smask-${o.id}" maskUnits="userSpaceOnUse" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.width)}" height="${n(b.height)}"><rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.width)}" height="${n(b.height)}" fill="#fff"/><path d="${d}" fill="#000"${rule}/></mask><path d="${d}"${attrs} stroke-width="${n(w * 2)}" mask="url(#smask-${o.id})"/>`; }
      stroke += arrowShapes(o).map(a => `<path d="${commandsToSvg(a)}" fill="${o.stroke}"/>`).join('');
    }
    return o.strokeBehind ? stroke + fill : fill + stroke;
  };
  const paint = (o: VectorObject): string => {
    if (maskActive(o)) return `<g mask="url(#lmask-${o.id})">${maskSvg(o, `lmask-${o.id}`, svgTransform(o) ?? '', n)}${paint({ ...o, mask: undefined })}</g>`;
    if (o.blur && !o.shadow) return `<g filter="url(#blur-${o.id})"><filter id="blur-${o.id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n(o.blur / 2)}"/></filter>${paint({ ...o, blur: undefined })}</g>`;
    if (o.shadow) { const s = o.shadow; return `<g filter="url(#shadow-${o.id})"><filter id="shadow-${o.id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${n(s.x)}" dy="${n(s.y)}" stdDeviation="${n(s.blur / 2)}" flood-color="${s.color}" flood-opacity="${n(s.opacity)}"/></filter>${paint({ ...o, shadow: undefined })}</g>`; }
    if (o.type === 'image' && o.crop) return `<g transform="${svgTransform(o)}"><clipPath id="iclip-${o.id}"><path d="${commandsToSvg(cropLocal(o))}" clip-rule="evenodd"/></clipPath><image href="${o.src}" x="${n(o.x)}" y="${n(o.y)}" width="${n(o.width)}" height="${n(o.height)}" preserveAspectRatio="none" clip-path="url(#iclip-${o.id})"/></g>`;
    if (o.type === 'image') return `<image href="${o.src}" x="${n(o.x)}" y="${n(o.y)}" width="${n(o.width)}" height="${n(o.height)}" preserveAspectRatio="none" transform="${svgTransform(o)}"/>`;
    const stroke = strokeVisible(o) ? ` stroke="${o.stroke}" stroke-width="${n(o.strokeWidth!)}"${kebab(strokeStyle(o))}${o.strokeBehind ? ' paint-order="stroke"' : ''}` : '';
    if (o.type === 'text' && isStyledText(o)) return `<g transform="${svgTransform(o)}">${gradientDef(o, true)}${patternOf(o, true)}<text font-family="${escapeXml(o.fontFamily ?? 'Arial')}, sans-serif" font-size="${n(fontPx(o))}"${textWeight(o) !== 400 ? ` font-weight="${textWeight(o)}"` : ''}${o.letterSpacing ? ` letter-spacing="${n(letterSpacingPx(o, measure))}"` : ''}${o.italic ? ' font-style="italic"' : ''}${o.underline ? ' text-decoration="underline"' : ''} fill="${fillOf(o)}"${stroke} xml:space="preserve">${lineLayout(o, measure).map(l => `<tspan x="${n(l.x)}" y="${n(l.baseline)}"${l.angle ? ` rotate="${n(l.angle)}"` : ''}>${escapeXml(l.line)}</tspan>`).join('')}</text></g>`;
    if (o.type === 'text') return `<g transform="${svgTransform(o)}"><svg x="${n(o.x)}" y="${n(o.y)}" width="${n(o.width)}" height="${n(o.height)}" viewBox="0 0 200 48" preserveAspectRatio="none" overflow="visible"><text x="0" y="36" font-size="36" font-family="Arial, sans-serif" fill="${o.fill}"${stroke} textLength="200" lengthAdjust="spacingAndGlyphs">${escapeXml(o.text ?? '')}</text></svg></g>`;
    const d = commandsToSvg(worldCommands(o)), rule = o.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
    const contents = contentsOf(scene, o.id);
    if (!contents.length) return paintedPath(o, d, 'all');
    return `${paintedPath(o, d, 'fill')}<clipPath id="clip-${o.id}"><path d="${d}"${rule.replace('fill-rule', 'clip-rule')}/></clipPath><g clip-path="url(#clip-${o.id})">${layers(contents).join('')}</g>${paintedPath(o, d, 'stroke')}`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n(area.width * 25.4 / 96)}mm" height="${n(area.height * 25.4 / 96)}mm" viewBox="${n(area.x)} ${n(area.y)} ${n(area.width)} ${n(area.height)}">\n${subtract}${background ? `<rect x="${n(area.x)}" y="${n(area.y)}" width="${n(area.width)}" height="${n(area.height)}" fill="${background}"/>\n` : ''}${layers(roots(scene)).join('\n')}\n</svg>\n`;
}

/** Nome PDF com caracteres fora de [A-Za-z0-9._-] escapados (#xx). */
const pdfName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, ch => '#' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
/** Cor especial no PostScript: Separation com o nome e a função de tinta CMYK. */
const epsSpot = (spot: SpotColor) => `[/Separation (${spot.name.replace(/[()\\]/g, '')}) /DeviceCMYK {${spot.cmyk.map((v, i) => i < 3 ? `dup ${n(v / 100)} mul exch` : `${n(v / 100)} mul`).join(' ')}}] setcolorspace 1 setcolor`;
/** Sombra sem desfoque para formatos vetoriais: cor sólida equivalente sobre fundo branco. */
function shadowCopy(o: VectorObject): VectorObject {
  const s = o.shadow!, [r, g, b] = rgb(s.color).map(v => Math.round((v * s.opacity + (1 - s.opacity)) * 255)), color = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  return { ...o, shadow: undefined, type: o.type === 'image' ? 'rectangle' : o.type, fill: o.type === 'image' || painted(o.fill) ? color : 'none', stroke: painted(o.stroke) ? color : o.stroke };
}
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const painted = (c?: string) => !!c && c !== 'none';
/** Mede o texto para reproduzir o ajuste horizontal do GFX Studio; fora do navegador usa largura média. */
export type TextMeasure = Measure;
const averageMeasure: TextMeasure = approximateMeasure;
/** Fonte padrão de PDF/PostScript mais próxima (Helvetica, Times ou Courier), com negrito e itálico. */
export function standardFont(o: VectorObject): string {
  const f = (o.fontFamily ?? 'Arial').toLowerCase(), b = !!o.bold, i = !!o.italic;
  if (/times|georgia|cambria|garamond|palatino|constantia|book|serif/.test(f) && !/sans/.test(f)) return b && i ? 'Times-BoldItalic' : b ? 'Times-Bold' : i ? 'Times-Italic' : 'Times-Roman';
  const family = /courier|consolas|mono|lucida console/.test(f) ? 'Courier' : 'Helvetica';
  return family + (b && i ? '-BoldOblique' : b ? '-Bold' : i ? '-Oblique' : '');
}
function textPlacement(o: VectorObject, measure: TextMeasure) {
  const size = 36 * o.height / 48, width = Math.max(1e-6, measure(o.text ?? '', '100px Arial') / 100 * size);
  return { size, scaleX: o.width / width, x: o.x, baseline: o.y + 36 * o.height / 48 };
}
function pathOps(commands: PathCommand[], ops: { m: string; l: string; c: string; z: string }) {
  return commands.map(c => c.type === 'Z' ? ops.z : c.type === 'C' ? `${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)} ${ops.c}` : `${n(c.x)} ${n(c.y)} ${c.type === 'M' ? ops.m : ops.l}`).join('\n');
}
/** Texto em WinAnsi (Latin-1), suficiente para o português; outros caracteres viram "?". */
const latin1 = (text: string) => [...text].map(ch => { const code = ch.charCodeAt(0); return code < 256 ? (ch === '(' || ch === ')' || ch === '\\' ? '\\' + ch : code < 32 || code > 126 ? '\\' + code.toString(8).padStart(3, '0') : ch) : '?'; }).join('');
export interface RasterImage { jpeg: Uint8Array; width: number; height: number }

/** Cor de preenchimento/contorno no PDF: CMYK exato (k/K) quando o objeto guarda os percentuais; senão RGB (rg/RG). */
const pdfFill = (o: VectorObject) => { const c = activeCmyk(o.fillCmyk, o.fill); return c ? `${c.map(v => n(v / 100)).join(' ')} k` : `${rgb(o.fill).map(n).join(' ')} rg`; };
const pdfStroke = (o: VectorObject) => { const c = activeCmyk(o.strokeCmyk, o.stroke); return c ? `${c.map(v => n(v / 100)).join(' ')} K` : `${rgb(o.stroke!).map(n).join(' ')} RG`; };
const epsColor = (cmyk: [number, number, number, number] | undefined, hex: string) => cmyk ? `${cmyk.map(v => n(v / 100)).join(' ')} setcmykcolor` : `${rgb(hex).map(n).join(' ')} setrgbcolor`;
/** PDF de uma página (atalho para `toPdfPages`). */
export function toPdf(scene: Scene, images: Map<string, RasterImage> = new Map(), measure: TextMeasure = averageMeasure): Uint8Array {
  return toPdfPages([{ scene, images }], measure);
}
/** Conteúdo e recursos de uma página do PDF. */
function pdfPage(scene: Scene, images: Map<string, RasterImage>, measure: TextMeasure) {
  // Cores especiais (spot, ex.: CutContour do Roland VersaWorks): espaço de cor Separation com o nome da cor.
  const spaces = new Map<SpotColor, string>(), spotSpace = (spot: SpotColor) => { if (!spaces.has(spot)) spaces.set(spot, `CS${spaces.size + 1}`); return spaces.get(spot)!; };
  const { area } = scene, k = 0.75, used: string[] = [], fonts = new Map<string, string>();
  const font = (name: string) => { if (!fonts.has(name)) fonts.set(name, `F${fonts.size + 1}`); return fonts.get(name)!; };
  const states = new Map<string, string>(), shadings: string[] = [];
  // Degradê de preenchimento: sombreamento axial/radial com função por partes entre os pontos de cor.
  const shading = (o: VectorObject) => {
    const g = fillGradientGeometry(o), stops = [...g.stops];
    if (stops[0].offset > 0) stops.unshift({ ...stops[0], offset: 0 });
    if (stops.at(-1)!.offset < 1) stops.push({ ...stops.at(-1)!, offset: 1 });
    const color = (hex: string) => `[${rgb(hex).map(n).join(' ')}]`, parts = stops.slice(1).map((b, i) => `<< /FunctionType 2 /Domain [0 1] /C0 ${color(stops[i].color)} /C1 ${color(b.color)} /N 1 >>`);
    const bounds = stops.slice(1, -1).map(st => st.offset), encode = parts.map(() => '0 1').join(' ');
    const coords = o.fillGradient!.type === 'linear' ? `/ShadingType 2 /Coords [${[g.start.x, g.start.y, g.end.x, g.end.y].map(n).join(' ')}]` : `/ShadingType 3 /Coords [${[g.start.x, g.start.y, 0, g.start.x, g.start.y, g.radius].map(n).join(' ')}]`;
    shadings.push(`<< ${coords} /ColorSpace /DeviceRGB /Extend [true true] /Function << /FunctionType 3 /Domain [0 1] /Functions [${parts.join(' ')}] /Bounds [${bounds.map(n).join(' ')}] /Encode [${encode}] >> >>`);
    return `Sh${shadings.length}`;
  };
  const penOps = (o: VectorObject) => { const st = strokeStyle(o); return `${{ butt: 0, round: 1, square: 2 }[st.strokeLinecap]} J ${{ miter: 0, round: 1, bevel: 2 }[st.strokeLinejoin]} j ${'strokeMiterlimit' in st ? `${n(st.strokeMiterlimit!)} M ` : ''}${'strokeDasharray' in st ? `[${st.strokeDasharray}] 0 d ` : ''}`; };
  // Transparência e mesclagem: estado gráfico /ca /CA /BM (Adicionar e Subtrair não existem no PDF e saem Normal).
  const draw = (o: VectorObject): string => {
    // Degradê de transparência sai com a transparência média (o PDF exigiria máscara suave).
    const pdfMode = o.blendMode ? (blendModes[o.blendMode] as { pdf?: string }).pdf : undefined, alpha = o.transparencyGradient ? 1 - (o.transparencyGradient.from + o.transparencyGradient.to) / 200 : o.opacity !== undefined && o.opacity < 1 ? o.opacity : 1;
    if (alpha < 1 || (pdfMode && pdfMode !== 'Normal')) {
      const key = `/ca ${n(alpha)} /CA ${n(alpha)}${pdfMode ? ` /BM /${pdfMode}` : ''}`;
      if (!states.has(key)) states.set(key, `GS${states.size + 1}`);
      return `q /${states.get(key)} gs\n${drawPlain(o)}\nQ`;
    }
    return drawPlain(o);
  };
  const drawPlain = (o: VectorObject): string => {
    if (o.shadow) return `q 1 0 0 1 ${n(o.shadow.x)} ${n(o.shadow.y)} cm\n${drawPlain(shadowCopy(o))}\nQ\n${drawPlain({ ...o, shadow: undefined })}`;
    if (o.type === 'image') { const image = images.get(o.id); if (!image) return ''; used.push(o.id); const m = matrixOf(o), clip = o.crop ? `
${pathOps(cropLocal(o), { m: 'm', l: 'l', c: 'c', z: 'h' })}
W* n ` : ' '; return `q ${m.map(n).join(' ')} cm${clip}${n(o.width)} 0 0 ${n(-o.height)} ${n(o.x)} ${n(o.y + o.height)} cm /Im${used.length} Do Q`; }
    const fill = painted(o.fill), stroke = painted(o.stroke) && (o.strokeWidth ?? 0) > 0;
    const colors = `${fill ? pdfFill(o) + ' ' : ''}${stroke ? pdfStroke(o) + ' ' + n(o.strokeWidth!) + ' w ' : ''}`;
    if (o.type === 'text') {
      if (!fill && !stroke) return '';
      const mode = fill && stroke ? 2 : stroke ? 1 : 0;
      if (isStyledText(o)) {
        const px = fontPx(o), lines = lineLayout(o, measure), f = font(standardFont(o));
        return `q ${matrixOf(o).map(n).join(' ')} cm ${colors}BT ${mode} Tr /${f} ${n(px)} Tf ${o.letterSpacing ? `${n(letterSpacingPx(o, measure))} Tc ` : ''}${lines.map(l => { const a = (l.angle ?? 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return `${n(c)} ${n(s)} ${n(s)} ${n(-c)} ${n(l.x)} ${n(l.baseline)} Tm (${latin1(l.line)}) Tj`; }).join(' ')} ET${o.underline && fill && !o.textPath ? ' ' + lines.map(l => `${n(l.x)} ${n(l.baseline + px * 0.1)} ${n(l.width)} ${n(px * 0.06)} re f`).join(' ') : ''} Q`;
      }
      const t = textPlacement(o, measure);
      return `q ${matrixOf(o).map(n).join(' ')} cm ${colors}BT ${mode} Tr /${font('Helvetica')} ${n(t.size)} Tf ${n(t.scaleX * 100)} Tz 1 0 0 -1 ${n(t.x)} ${n(t.baseline)} Tm (${latin1(o.text ?? '')}) Tj ET Q`;
    }
    const path = pathOps(worldCommands(o), { m: 'm', l: 'l', c: 'c', z: 'h' }), even = o.fillRule === 'evenodd' ? '*' : '';
    const contents = contentsOf(scene, o.id), place = strokePlacement(o), w = o.strokeWidth ?? 0;
    const fillSpot = !o.fillGradient && !o.fillPattern && !o.meshFill ? activeSpot(o.fillSpot, o.fill) : undefined, strokeSpot = activeSpot(o.strokeSpot, o.stroke);
    const fillPart = !fill ? '' : o.fillGradient ? `q\n${path}\nW${even} n /${shading(o)} sh Q` : `q ${fillSpot ? `/${spotSpace(fillSpot)} cs 1 scn` : pdfFill(o)}\n${path}\nf${even} Q`;
    let strokePart = '';
    if (stroke) {
      const pen = `${strokeSpot ? `/${spotSpace(strokeSpot)} CS 1 SCN` : pdfStroke(o)} ${penOps(o)}`;
      if (place === 'center') strokePart = `q ${pen}${n(w)} w\n${path}\nS Q`;
      else if (place === 'inside') strokePart = `q\n${path}\nW${even} n ${pen}${n(w * 2)} w\n${path}\nS Q`;
      else { const b = outerBox(o); strokePart = `q ${n(b.x)} ${n(b.y)} ${n(b.width)} ${n(b.height)} re\n${path}\nW* n ${pen}${n(w * 2)} w\n${path}\nS Q`; }
      const arrows = arrowShapes(o);
      if (arrows.length) strokePart += `\nq ${rgb(o.stroke!).map(n).join(' ')} rg\n${arrows.map(a => pathOps(a, { m: 'm', l: 'l', c: 'c', z: 'h' })).join('\n')}\nf Q`;
    }
    if (!contents.length) return (o.strokeBehind ? [strokePart, fillPart] : [fillPart, strokePart]).filter(Boolean).join('\n');
    return `${fillPart}\nq\n${path}\nW${even} n\n${contents.map(draw).join('\n')}\nQ${strokePart ? '\n' + strokePart : ''}`;
  };
  const content = `${n(k)} 0 0 ${n(-k)} ${n(-area.x * k)} ${n((area.y + area.height) * k)} cm\n${roots(scene).map(draw).filter(Boolean).join('\n')}`;
  return { content, area, k, fonts: [...fonts.entries()], shadings, states: [...states], spaces: [...spaces], used, images };
}
/**
 * PDF com várias páginas (uma cena por página, cada uma com o próprio tamanho): Exportar › PDF com as páginas
 * escolhidas do documento. Cada página tem seus próprios recursos (fontes, imagens, sombreamentos, cores especiais).
 */
export function toPdfPages(pages: { scene: Scene; images?: Map<string, RasterImage> }[], measure: TextMeasure = averageMeasure): Uint8Array {
  if (!pages.length) throw new Error('Nenhuma página para exportar.');
  const built = pages.map(p => pdfPage(p.scene, p.images ?? new Map(), measure));
  const encoder = new TextEncoder(), parts: Uint8Array[] = [], offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => { const bytes = typeof data === 'string' ? Uint8Array.from(data, ch => ch.charCodeAt(0) & 255) : data; parts.push(bytes); length += bytes.length; };
  const object = (id: number, body: string, stream?: Uint8Array) => { offsets[id] = length; push(`${id} 0 obj\n${body}\n`); if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); } push('endobj\n'); };
  // Numeração: 1 catálogo, 2 árvore de páginas; depois, por página: página, conteúdo, fontes e imagens.
  let next = 3;
  const layout = built.map(b => { const page = next, contents = next + 1, firstFont = next + 2, firstImage = firstFont + b.fonts.length; next = firstImage + b.used.length; return { page, contents, firstFont, firstImage }; });
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${layout.map(l => `${l.page} 0 R`).join(' ')}] /Count ${built.length} >>`);
  built.forEach((b, p) => {
    const l = layout[p], { area, k } = b;
    const xobjects = b.used.map((id, i) => `/Im${i + 1} ${l.firstImage + i} 0 R`).join(' ');
    const fontResources = b.fonts.map(([, ref], i) => `/${ref} ${l.firstFont + i} 0 R`).join(' ');
    const contentBytes = encoder.encode(b.content);
    object(l.page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(area.width * k)} ${n(area.height * k)}] /Resources << ${fontResources ? `/Font << ${fontResources} >>` : ''}${b.shadings.length ? ` /Shading << ${b.shadings.map((sh, i) => `/Sh${i + 1} ${sh}`).join(' ')} >>` : ''}${b.states.length ? ` /ExtGState << ${b.states.map(([key, name]) => `/${name} << /Type /ExtGState ${key} >>`).join(' ')} >>` : ''}${b.spaces.length ? ` /ColorSpace << ${b.spaces.map(([spot, name]) => `/${name} [/Separation /${pdfName(spot.name)} /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [${spot.cmyk.map(v => n(v / 100)).join(' ')}] /N 1 >>]`).join(' ')} >>` : ''}${xobjects ? ` /XObject << ${xobjects} >>` : ''} >> /Contents ${l.contents} 0 R >>`);
    object(l.contents, `<< /Length ${contentBytes.length} >>`, contentBytes);
    b.fonts.forEach(([name], i) => object(l.firstFont + i, `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`));
    b.used.forEach((id, i) => { const image = b.images.get(id)!; object(l.firstImage + i, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.length} >>`, image.jpeg); });
  });
  const count = next, xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.slice(1, count).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const result = new Uint8Array(length); let at = 0; for (const p of parts) { result.set(p, at); at += p.length; }
  return result;
}

export function toEps(scene: Scene, measure: TextMeasure = averageMeasure): string {
  const { area } = scene, k = 0.75, fonts = new Set<string>(['Helvetica']);
  const draw = (o: VectorObject): string => {
    if (o.shadow) return `gsave ${n(o.shadow.x)} ${n(o.shadow.y)} translate\n${draw(shadowCopy(o))}\ngrestore\n${draw({ ...o, shadow: undefined })}`;
    if (o.type === 'image') return '';
    const fill = painted(o.fill), stroke = painted(o.stroke) && (o.strokeWidth ?? 0) > 0;
    const epsFillSpot = !o.fillGradient && !o.fillPattern && !o.meshFill ? activeSpot(o.fillSpot, o.fill) : undefined;
    const fillOp = `${epsFillSpot ? epsSpot(epsFillSpot) : o.fillGradient || o.fill === 'none' ? `${rgb(o.fill === 'none' ? '#000000' : averageFill(o.fillGradient!)).map(n).join(' ')} setrgbcolor` : epsColor(activeCmyk(o.fillCmyk, o.fill), o.fill)} ${o.fillRule === 'evenodd' ? 'eofill' : 'fill'}`;
    const st = strokeStyle(o), place = strokePlacement(o), clip = o.fillRule === 'evenodd' ? 'eoclip' : 'clip';
    const epsStrokeSpot = activeSpot(o.strokeSpot, o.stroke);
    const strokeOp = stroke ? `${epsStrokeSpot ? epsSpot(epsStrokeSpot) : epsColor(activeCmyk(o.strokeCmyk, o.stroke), o.stroke!)} ${n(o.strokeWidth! * (place === 'center' ? 1 : 2))} setlinewidth ${{ butt: 0, round: 1, square: 2 }[st.strokeLinecap]} setlinecap ${{ miter: 0, round: 1, bevel: 2 }[st.strokeLinejoin]} setlinejoin ${'strokeMiterlimit' in st ? `${n(st.strokeMiterlimit!)} setmiterlimit ` : ''}${'strokeDasharray' in st ? `[${st.strokeDasharray}] 0 setdash ` : ''}stroke` : '';
    if (o.type === 'text') {
      if (!fill) return '';
      if (isStyledText(o)) {
        const px = fontPx(o), name = standardFont(o); fonts.add(name);
        return lineLayout(o, measure).map(l => `gsave [${matrixOf(o).map(n).join(' ')}] concat ${rgb(o.fill).map(n).join(' ')} setrgbcolor${o.underline && !o.textPath ? ` newpath ${n(l.x)} ${n(l.baseline + px * 0.1)} ${n(l.width)} ${n(px * 0.06)} rectfill` : ''} /${name}-ISOLatin1 findfont ${n(px)} scalefont setfont ${n(l.x)} ${n(l.baseline)} translate ${l.angle ? `${n(l.angle)} rotate ` : ''}1 -1 scale 0 0 moveto (${latin1(l.line)}) show grestore`).join('\n');
      }
      const t = textPlacement(o, measure);
      return `gsave [${matrixOf(o).map(n).join(' ')}] concat ${rgb(o.fill).map(n).join(' ')} setrgbcolor /Helvetica-ISOLatin1 findfont ${n(t.size)} scalefont setfont ${n(t.x)} ${n(t.baseline)} translate ${n(t.scaleX)} -1 scale 0 0 moveto (${latin1(o.text ?? '')}) show grestore`;
    }
    const path = `newpath\n${pathOps(worldCommands(o), { m: 'moveto', l: 'lineto', c: 'curveto', z: 'closepath' })}`;
    const contents = contentsOf(scene, o.id);
    const b = outerBox(o), arrows = arrowShapes(o);
    const strokePart = !stroke ? '' : `gsave ${place === 'inside' ? `${path} ${clip} ` : place === 'outside' ? `newpath ${n(b.x)} ${n(b.y)} ${n(b.width)} ${n(b.height)} rectpath ${path.replace('newpath', '')} eoclip ` : ''}${path} ${strokeOp} grestore${arrows.length ? `\ngsave ${rgb(o.stroke!).map(n).join(' ')} setrgbcolor newpath ${arrows.map(a => pathOps(a, { m: 'moveto', l: 'lineto', c: 'curveto', z: 'closepath' })).join(' ')} fill grestore` : ''}`;
    const fillPart = fill ? `gsave ${path} ${fillOp} grestore\n` : '';
    return `${o.strokeBehind ? strokePart + '\n' : ''}${fillPart}${contents.length ? `gsave ${path} ${clip} newpath\n${contents.map(draw).join('\n')}\ngrestore\n` : ''}${o.strokeBehind ? '' : strokePart}`;
  };
  const body = roots(scene).map(draw).filter(Boolean).join('\n');
  const encodings = [...fonts].map(f => `/${f} findfont dup length dict begin {1 index /FID ne {def} {pop pop} ifelse} forall /Encoding ISOLatin1Encoding def currentdict end /${f}-ISOLatin1 exch definefont pop`).join('\n');
  const w = Math.ceil(area.width * k), h = Math.ceil(area.height * k);
  return `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${w} ${h}\n%%HiResBoundingBox: 0 0 ${n(area.width * k)} ${n(area.height * k)}\n%%Creator: GFX Studio\n%%LanguageLevel: 2\n%%EndComments\n/rectpath { 4 dict begin /h exch def /w exch def /y exch def /x exch def x y moveto w 0 rlineto 0 h rlineto w neg 0 rlineto closepath end } bind def\n${encodings}\ngsave\n[${n(k)} 0 0 ${n(-k)} ${n(-area.x * k)} ${n((area.y + area.height) * k)}] concat\n${body}\ngrestore\nshowpage\n%%EOF\n`;
}

/** Curvas convertidas em segmentos com erro visual abaixo de ~0,05 mm. */
export function flatten(commands: PathCommand[]): { points: { x: number; y: number }[]; closed: boolean }[] {
  return splitContours(commands).map(contour => {
    const points: { x: number; y: number }[] = []; let last = { x: 0, y: 0 };
    for (const c of contour) {
      if (c.type === 'Z') continue;
      if (c.type === 'C') {
        const steps = Math.max(4, Math.min(64, Math.ceil(Math.hypot(c.x - last.x, c.y - last.y) / 4)));
        for (let i = 1; i <= steps; i++) { const t = i / steps, u = 1 - t; points.push({ x: u * u * u * last.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, y: u * u * u * last.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y }); }
      } else points.push({ x: c.x, y: c.y });
      last = { x: c.x, y: c.y };
    }
    return { points, closed: contour.at(-1)?.type === 'Z' };
  }).filter(c => c.points.length > 1);
}
const aci: [number, number, number, number][] = [[1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255], [7, 0, 0, 0], [8, 128, 128, 128], [9, 192, 192, 192]];
const aciColor = (hex: string) => { const [r, g, b] = rgb(hex).map(v => v * 255); return aci.reduce((best, c) => (c[1] - r) ** 2 + (c[2] - g) ** 2 + (c[3] - b) ** 2 < (best[1] - r) ** 2 + (best[2] - g) ** 2 + (best[3] - b) ** 2 ? c : best)[0]; };
const drawable = (scene: Scene) => scene.objects.filter(o => o.type !== 'image');

/** Entidades de CAD (DXF e DWG): polilinhas e textos em milímetros, com Y para cima e cor ACI. */
type CadEntity = { kind: 'poly'; color: number; closed: boolean; points: { x: string; y: string }[] } | { kind: 'text'; color: number; x: string; y: string; height: string; text: string; angle: string };
function cadEntities(scene: Scene): CadEntity[] {
  const { area } = scene, mm = 25.4 / 96, X = (x: number) => n((x - area.x) * mm), Y = (y: number) => n((area.y + area.height - y) * mm);
  const out: CadEntity[] = [];
  for (const o of drawable(scene)) {
    const color = aciColor(painted(o.stroke) ? o.stroke! : painted(o.fill) ? o.fill : '#000000');
    if (o.type === 'text' && isStyledText(o)) {
      const m: Matrix = matrixOf(o), px = fontPx(o), angle = -Math.atan2(m[1], m[0]) * 180 / Math.PI, height = px * 0.72 * Math.hypot(m[2], m[3]) * mm;
      for (const l of lineLayout(o, averageMeasure)) { const base = { x: m[0] * l.x + m[2] * l.baseline + m[4], y: m[1] * l.x + m[3] * l.baseline + m[5] }; if (l.line.trim()) out.push({ kind: 'text', color, x: X(base.x), y: Y(base.y), height: n(height), text: l.line, angle: n(angle - (l.angle ?? 0)) }); }
      continue;
    }
    if (o.type === 'text') {
      const m: Matrix = matrixOf(o), t = textPlacement(o, averageMeasure), base = { x: m[0] * t.x + m[2] * t.baseline + m[4], y: m[1] * t.x + m[3] * t.baseline + m[5] };
      const angle = -Math.atan2(m[1], m[0]) * 180 / Math.PI, height = t.size * Math.hypot(m[2], m[3]) * 0.72 * mm;
      out.push({ kind: 'text', color, x: X(base.x), y: Y(base.y), height: n(height), text: (o.text ?? '').replace(/[\r\n]/g, ' '), angle: n(angle) });
      continue;
    }
    for (const contour of flatten([...worldCommands(o), ...arrowShapes(o).flat()])) out.push({ kind: 'poly', color, closed: contour.closed, points: contour.points.map(p => ({ x: X(p.x), y: Y(p.y) })) });
  }
  return out;
}
export function toDxf(scene: Scene): string {
  const { area } = scene, mm = 25.4 / 96;
  const lines: string[] = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '9', '$EXTMIN', '10', '0', '20', '0', '9', '$EXTMAX', '10', n(area.width * mm), '20', n(area.height * mm), '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  for (const e of cadEntities(scene)) {
    if (e.kind === 'text') { lines.push('0', 'TEXT', '8', '0', '62', String(e.color), '10', e.x, '20', e.y, '40', e.height, '1', e.text, '50', e.angle); continue; }
    lines.push('0', 'POLYLINE', '8', '0', '62', String(e.color), '66', '1', '70', e.closed ? '1' : '0');
    for (const p of e.points) lines.push('0', 'VERTEX', '8', '0', '10', p.x, '20', p.y);
    lines.push('0', 'SEQEND', '8', '0');
  }
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\r\n') + '\r\n';
}
/** Caracteres fora do ASCII (e aspas/barra) no formato \U+XXXX, que o AutoCAD interpreta em textos. */
const cadText = (s: string) => [...s].map(c => { const code = c.codePointAt(0)!; return code < 32 ? ' ' : code > 126 || c === '"' || c === '\\' ? (code > 0xffff ? '?' : `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}`) : c; }).join('');
/** Pontos por polilinha aceitos pelo gerador de DWG (dwgadd do LibreDWG). */
export const DWG_MAX_POINTS = 5000;
/**
 * Roteiro para o dwgadd do LibreDWG gerar um DWG 2000 do zero (o dxf2dwg exige um DXF completo, com tabelas).
 * Cada cor ACI vira uma camada "COR-n" com essa cor (o dwgadd não define a cor da entidade); entidades ficam "PorCamada".
 */
export function toDwgScript(scene: Scene): { script: string; warnings: string[] } {
  const entities = cadEntities(scene), warnings = new Set<string>();
  const lines = ['HEADER.INSUNITS = 4', ...[...new Set(entities.map(e => e.color))].sort((a, b) => a - b).flatMap(c => [`layer "COR-${c}"`, `layer.color = ${c}`])];
  for (const e of entities) {
    if (e.kind === 'text') {
      let text = cadText(e.text);
      // O dwgadd lê no máximo 119 caracteres por texto.
      if (text.length > 119) { text = text.slice(0, 119).replace(/\\U\+[0-9A-F]{0,3}$/, ''); warnings.add('Textos com mais de ~110 caracteres por linha foram encurtados no DWG.'); }
      lines.push(`text "${text}" (${e.x} ${e.y} 0) ${e.height}`, `text.rotation = ${e.angle}`, 'text.width_factor = 1.0', `text.layer = "COR-${e.color}"`);
      continue;
    }
    if (e.points.length < 2) continue;
    // Contornos muito longos são divididos em trechos abertos que se encostam.
    const chunks: typeof e.points[] = [];
    if (e.points.length <= DWG_MAX_POINTS) chunks.push(e.points);
    else { for (let i = 0; i < e.points.length - 1; i += DWG_MAX_POINTS - 1) chunks.push(e.points.slice(i, i + DWG_MAX_POINTS)); if (e.closed) chunks.push([e.points[e.points.length - 1], e.points[0]]); warnings.add(`Contornos com mais de ${DWG_MAX_POINTS} pontos foram divididos em trechos.`); }
    for (const chunk of chunks) {
      lines.push(`lwpolyline ${chunk.length} (${chunk.map(p => `(${p.x} ${p.y})`).join(' ')})`, `lwpolyline.layer = "COR-${e.color}"`);
      if (e.closed && chunks.length === 1) lines.push('lwpolyline.flag = 512');
    }
  }
  return { script: lines.join('\n') + '\n', warnings: [...warnings] };
}

export function toPlt(scene: Scene): string {
  const { area } = scene, units = 40 * 25.4 / 96, X = (x: number) => Math.round((x - area.x) * units), Y = (y: number) => Math.round((area.y + area.height - y) * units);
  const out = ['IN;', 'SP1;'];
  for (const o of drawable(scene)) {
    if (o.type === 'text') continue;
    for (const contour of flatten([...worldCommands(o), ...arrowShapes(o).flat()])) {
      const points = contour.closed ? [...contour.points, contour.points[0]] : contour.points;
      out.push(`PU${X(points[0].x)},${Y(points[0].y)};`, `PD${points.slice(1).map(p => `${X(p.x)},${Y(p.y)}`).join(',')};`);
    }
  }
  out.push('PU;', 'SP0;');
  return out.join('\n') + '\n';
}
