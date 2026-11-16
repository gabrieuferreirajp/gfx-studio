import opentype from 'opentype.js';
import type { PathCommand, VectorObject } from '../document/model';
import { mapCommands } from '../geometry/pathGeometry';
import { matrixOf, transformPoint } from '../geometry/objectTransforms';
import { cssFont, fontPx, letterSpacingPx, lineLayout, textWeight, updateText } from './textLayout';
import { browserMeasure } from './textMeasure';
import { desktop } from '../io/desktop';
import { traceBitmap } from '../bitmap/bitmapTrace';

const fonts = new Map<string, Promise<{ font: opentype.Font; synthetic: boolean } | null>>();
function loadFont(o: VectorObject) {
  const key = `${o.fontFamily}|${!!o.bold}|${!!o.italic}|${textWeight(o)}`;
  if (!fonts.has(key)) fonts.set(key, (async () => {
    const file = await desktop?.fontFile(o.fontFamily ?? 'Arial', !!o.bold, !!o.italic, textWeight(o));
    return file ? { font: opentype.parse(file.bytes), synthetic: file.synthetic } : null;
  })().catch(() => null));
  return fonts.get(key)!;
}
/** Converte comandos do opentype.js (M, L, Q, C, Z) em contornos válidos com curvas cúbicas. */
function glyphCommands(path: opentype.Path, skew: number, baseline: number): PathCommand[] {
  const out: PathCommand[] = []; let current = { x: 0, y: 0 }, start = current;
  const p = (x: number, y: number) => ({ x: x - (y - baseline) * skew, y });
  for (const c of path.commands) {
    if (c.type === 'M') { if (out.length && out.at(-1)!.type !== 'Z') { if (out.at(-1)!.type === 'M') out.pop(); else out.push({ type: 'Z' }); } current = start = { x: c.x, y: c.y }; out.push({ type: 'M', ...p(c.x, c.y) }); }
    else if (c.type === 'L') { current = { x: c.x, y: c.y }; out.push({ type: 'L', ...p(c.x, c.y) }); }
    else if (c.type === 'C') { out.push({ type: 'C', x1: p(c.x1, c.y1).x, y1: c.y1, x2: p(c.x2, c.y2).x, y2: c.y2, ...p(c.x, c.y) }); current = { x: c.x, y: c.y }; }
    else if (c.type === 'Q') {
      const c1 = { x: current.x + 2 / 3 * (c.x1 - current.x), y: current.y + 2 / 3 * (c.y1 - current.y) }, c2 = { x: c.x + 2 / 3 * (c.x1 - c.x), y: c.y + 2 / 3 * (c.y1 - c.y) };
      out.push({ type: 'C', x1: p(c1.x, c1.y).x, y1: c1.y, x2: p(c2.x, c2.y).x, y2: c2.y, ...p(c.x, c.y) }); current = { x: c.x, y: c.y };
    } else if (c.type === 'Z') { if (out.length && out.at(-1)!.type !== 'Z' && out.at(-1)!.type !== 'M') out.push({ type: 'Z' }); else if (out.at(-1)?.type === 'M') out.pop(); current = start; }
  }
  if (out.length && out.at(-1)!.type !== 'Z') { if (out.at(-1)!.type === 'M') out.pop(); else out.push({ type: 'Z' }); }
  return out;
}
const rect = (x: number, y: number, w: number, h: number): PathCommand[] => [{ type: 'M', x, y }, { type: 'L', x: x + w, y }, { type: 'L', x: x + w, y: y + h }, { type: 'L', x, y: y + h }, { type: 'Z' }];
/** Alternativa sem arquivo de fonte: desenha o texto em alta resolução e rastreia o contorno. */
function tracedOutline(o: VectorObject): PathCommand[] {
  const px = fontPx(o), scale = Math.max(1, Math.min(8, 160 / px, 4000 / Math.max(o.width + px, o.height + px))), canvas = document.createElement('canvas');
  canvas.width = Math.ceil((o.width + px) * scale); canvas.height = Math.ceil((o.height + px * 0.5) * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000'; context.font = cssFont(o, px * scale);
  for (const l of lineLayout(o, browserMeasure)) { if (l.angle) { context.save(); context.translate((l.x - o.x) * scale, (l.baseline - o.y) * scale); context.rotate(l.angle * Math.PI / 180); context.fillText(l.line, 0, 0); context.restore(); continue; } context.fillText(l.line, (l.x - o.x) * scale, (l.baseline - o.y) * scale); if (o.underline) context.fillRect((l.x - o.x) * scale, (l.baseline - o.y + px * 0.1) * scale, l.width * scale, px * 0.06 * scale); }
  const layer = traceBitmap(context.getImageData(0, 0, canvas.width, canvas.height), { colors: 2, smoothing: 15, cornerAngle: 75, removeBackground: true, despeckle: 0 })[0];
  return layer ? mapCommands(layer.contours.flat(), p => ({ x: o.x + p.x / scale, y: o.y + p.y / scale })) : [];
}
/** Contorno do texto em coordenadas do documento, pronto para Converter em curvas. */
export async function textOutline(source: VectorObject): Promise<{ commands: PathCommand[]; exact: boolean }> {
  const o = source.fontSize === undefined ? updateText(source, {}, browserMeasure) : source;
  const loaded = await loadFont(o);
  let local: PathCommand[];
  if (loaded) {
    const px = fontPx(o), skew = loaded.synthetic && o.italic ? 0.2 : 0, letterSpacing = letterSpacingPx(o, browserMeasure) / px;
    local = lineLayout(o, browserMeasure).flatMap(l => {
      if (l.angle !== undefined) {
        // Texto em caminho: cada letra é desenhada na origem e girada para o seu ponto do caminho.
        const a = l.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        return mapCommands(glyphCommands(loaded.font.getPath(l.line, 0, 0, px, { kerning: false }), skew, 0), p => ({ x: l.x + p.x * c - p.y * s, y: l.baseline + p.x * s + p.y * c }));
      }
      const width = loaded.font.getAdvanceWidth(l.line, px, { kerning: true, letterSpacing });
      const x = o.textAlign === 'center' ? o.x + (o.width - width) / 2 : o.textAlign === 'right' ? o.x + o.width - width : o.x;
      return [...glyphCommands(loaded.font.getPath(l.line, x, l.baseline, px, { kerning: true, letterSpacing }), skew, l.baseline), ...(o.underline && l.line ? rect(x, l.baseline + px * 0.1, width, px * 0.06) : [])];
    });
  } else local = tracedOutline(o);
  return { commands: mapCommands(local, p => transformPoint(matrixOf(source), p)), exact: !!loaded };
}
