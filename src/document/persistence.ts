import type { Anchor, ColorStyle, EffectLink, DocumentPage, EnvelopeMapping, EnvelopeMode, FillGradient, Guideline, Layer, ObjectStyle, PathCommand, SymbolDef, VectorDocument, VectorObject } from './model.ts';
import { patternPresets } from './patterns.ts';
import { STYLE_KEYS } from './library.ts';
import { decodePath } from '../geometry/nodeGeometry.ts';
import { MAX_SIZE } from './model.ts';
import { FONT_FAMILY } from '../text/textLayout.ts';
import { isDocumentUnit, type DocumentUnit } from './units.ts';
import { isBlendMode } from './transparency.ts';
import { isArrowKind } from './paint.ts';

const IMAGE_SOURCE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;
export function imageSource(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_FILE_BYTES || !IMAGE_SOURCE.test(value)) throw new Error('Imagem incorporada inválida (aceitos PNG, JPEG, GIF e WebP).');
  return value;
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Estrutura de projeto inválida.');
  return value as Record<string, unknown>;
}
function string(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new Error('Texto ou identificador inválido.');
  return value;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Coordenadas ou dimensões inválidas.');
  return value;
}
/** Valida a lista de objetos de uma página; `ids` é compartilhado entre as páginas (IDs únicos no projeto). */
function parseObjects(list: unknown, ids: Set<string>): VectorObject[] {
  if (!Array.isArray(list) || list.length > 10000) throw new Error('Lista de objetos inválida (máximo de 10.000).');
  const objects: VectorObject[] = list.map(value => {
    const o = record(value);
    const id = string(o.id, 128);
    if (ids.has(id)) throw new Error('O projeto contém IDs duplicados.');
    ids.add(id);
    if (o.type !== 'rectangle' && o.type !== 'ellipse' && o.type !== 'text' && o.type !== 'path' && o.type !== 'image') throw new Error('Tipo de objeto não suportado.');
    const fill = string(o.fill, 7);
    if (fill !== 'none' && !/^#[0-9a-f]{6}$/i.test(fill)) throw new Error('Cor de preenchimento inválida.');
    let stroke: string | undefined;
    if (o.stroke !== undefined) {
      stroke = string(o.stroke, 7);
      if (stroke !== 'none' && !/^#[0-9a-f]{6}$/i.test(stroke)) throw new Error('Cor de contorno inválida.');
    }
    let geometry: Pick<VectorObject, 'commands' | 'pathSize'> = {};
    if (o.type === 'path') {
      const size = record(o.pathSize);
      const pathSize = { width: number(size.width, 1, MAX_SIZE), height: number(size.height, 1, MAX_SIZE) };
      if (!Array.isArray(o.commands) || o.commands.length < 2 || o.commands.length > 10000) throw new Error('Comandos de caminho inválidos.');
      const commands: PathCommand[] = o.commands.map((value, index, list) => {
        const c = record(value);
        if(c.type==='M' && index===list.length-1)throw new Error('Contorno sem segmentos.');
        if ((index === 0 && c.type !== 'M') || (index>0&&c.type==='M'&&record(list[index-1]).type!=='Z') || (index>0&&c.type!=='M'&&record(list[index-1]).type==='Z')) throw new Error('Cada contorno deve começar com M; contornos intermediários devem estar fechados.');
        if (c.type === 'Z') {
          if (index < 2 || !['L','C'].includes(String(record(list[index-1]).type))) throw new Error('Fechamento de caminho inválido.');
          return { type: 'Z' };
        }
        if (c.type !== 'M' && c.type !== 'L' && c.type !== 'C') throw new Error('Comando SVG não suportado.');
        const x = number(c.x, 0, pathSize.width), y = number(c.y, 0, pathSize.height);
        return c.type === 'C' ? { type: 'C', x, y, x1: number(c.x1, 0, pathSize.width), y1: number(c.y1, 0, pathSize.height), x2: number(c.x2, 0, pathSize.width), y2: number(c.y2, 0, pathSize.height) } : { type: c.type, x, y };
      });
      geometry = { commands, pathSize };
    }
    const object: VectorObject = {
      id, type: o.type, name: string(o.name, 256),
      x: number(o.x, -MAX_SIZE, MAX_SIZE), y: number(o.y, -MAX_SIZE, MAX_SIZE),
      width: number(o.width, 1, MAX_SIZE), height: number(o.height, 1, MAX_SIZE), fill,
      ...(o.type === 'text' ? { text: string(o.text, 100000, true) } : {}),
      ...(o.type === 'image' ? { src: imageSource(o.src) } : {}),
      ...(stroke !== undefined ? { stroke } : {}),
      ...(o.strokeWidth !== undefined ? { strokeWidth: number(o.strokeWidth, 0, 1000) } : {}),
      ...geometry,
    };
    if(o.fillRule!==undefined){if(o.fillRule!=='nonzero'&&o.fillRule!=='evenodd')throw new Error('Regra de preenchimento inválida.');object.fillRule=o.fillRule;}
    if (o.nodeModes !== undefined) {
      if (o.type !== 'path' || !Array.isArray(o.nodeModes) || o.nodeModes.length !== decodePath(object).nodes.length || !o.nodeModes.every(mode => mode === 'corner' || mode === 'smooth' || mode === 'symmetric')) throw new Error('Tipos de nós inválidos.');
      object.nodeModes = [...o.nodeModes];
    }
    if (o.transform !== undefined) {
      if (!Array.isArray(o.transform) || o.transform.length !== 6) throw new Error('Matriz de transformação inválida.');
      const m=o.transform.map((v,i)=>number(v,i<4?-1e6:-1e9,i<4?1e6:1e9)) as [number,number,number,number,number,number];
      if(Math.abs(m[0]*m[3]-m[1]*m[2])<1e-12)throw new Error('Transformação não invertível.');
      object.transform=m;
    }
    if (o.groupPath !== undefined) {
      if(o.type === undefined || !Array.isArray(o.groupPath) || !o.groupPath.length || o.groupPath.length>32)throw new Error('Grupo inválido.');
      const groups=o.groupPath.map(id=>string(id,128));
      if(new Set(groups).size!==groups.length)throw new Error('Hierarquia de grupo circular.');
      object.groupPath=groups;
    }
    if (o.type === 'text') {
      if (o.fontFamily !== undefined) { if (typeof o.fontFamily !== 'string' || !FONT_FAMILY.test(o.fontFamily)) throw new Error('Fonte inválida.'); object.fontFamily = o.fontFamily; }
      if (o.fontSize !== undefined) object.fontSize = number(o.fontSize, 1, 3000);
      if (o.lineSpacing !== undefined) object.lineSpacing = number(o.lineSpacing, 0.1, 10);
      if (o.letterSpacing !== undefined) object.letterSpacing = number(o.letterSpacing, -100, 2000);
      if (o.fontWeight !== undefined) { const w = number(o.fontWeight, 1, 1000); if (!Number.isInteger(w)) throw new Error('Peso de fonte inválido.'); object.fontWeight = w; }
      for (const key of ['bold', 'italic', 'underline'] as const) if (o[key] !== undefined) { if (typeof o[key] !== 'boolean') throw new Error('Estilo de texto inválido.'); if (o[key]) object[key] = true; }
      if (o.textAlign !== undefined) { if (o.textAlign !== 'center' && o.textAlign !== 'right') throw new Error('Alinhamento de texto inválido.'); object.textAlign = o.textAlign; }
      if (o.paragraph !== undefined) { if (typeof o.paragraph !== 'boolean') throw new Error('Texto de parágrafo inválido.'); if (o.paragraph) object.paragraph = true; }
      if (o.textPath !== undefined) {
        const tp = record(o.textPath), list = tp.commands;
        if (!Array.isArray(list) || list.length < 2 || list.length > 10000) throw new Error('Caminho do texto inválido.');
        const coord = (v: unknown) => number(v, -MAX_SIZE, MAX_SIZE);
        const commands: PathCommand[] = list.map((value, index) => {
          const c = record(value);
          if (index === 0 && c.type !== 'M') throw new Error('Caminho do texto inválido.');
          if (c.type === 'Z') return { type: 'Z' };
          if (c.type === 'C') return { type: 'C', x1: coord(c.x1), y1: coord(c.y1), x2: coord(c.x2), y2: coord(c.y2), x: coord(c.x), y: coord(c.y) };
          if (c.type !== 'M' && c.type !== 'L') throw new Error('Caminho do texto inválido.');
          return { type: c.type, x: coord(c.x), y: coord(c.y) };
        });
        object.textPath = { commands, offset: number(tp.offset, -MAX_SIZE, MAX_SIZE), ...(tp.distance !== undefined ? { distance: number(tp.distance, -MAX_SIZE, MAX_SIZE) } : {}) };
        if (tp.flip !== undefined) { if (typeof tp.flip !== 'boolean') throw new Error('Caminho do texto inválido.'); if (tp.flip) object.textPath.flip = true; }
        if (tp.upright !== undefined) { if (typeof tp.upright !== 'boolean') throw new Error('Caminho do texto inválido.'); if (tp.upright) object.textPath.upright = true; }
        if (tp.source !== undefined) { if (typeof tp.source !== 'string' || !tp.source || tp.source.length > 200) throw new Error('Caminho do texto inválido.'); object.textPath.source = tp.source; }
        if (tp.vertical !== undefined) { if (tp.vertical !== 'top' && tp.vertical !== 'center' && tp.vertical !== 'bottom') throw new Error('Caminho do texto inválido.'); object.textPath.vertical = tp.vertical; }
      }
    }
    if (o.cornerRadius !== undefined) { if (o.type !== 'rectangle') throw new Error('Cantos só se aplicam a retângulos.'); object.cornerRadius = number(o.cornerRadius, 0, MAX_SIZE); }
    if (o.cornerRadii !== undefined) { if (o.type !== 'rectangle' || !Array.isArray(o.cornerRadii) || o.cornerRadii.length !== 4) throw new Error('Cantos inválidos.'); object.cornerRadii = o.cornerRadii.map(v => number(v, 0, MAX_SIZE)) as [number, number, number, number]; }
    if (o.cornerType !== undefined) { if (o.cornerType !== 'round' && o.cornerType !== 'scallop' && o.cornerType !== 'chamfer') throw new Error('Tipo de canto inválido.'); object.cornerType = o.cornerType; }
    if (o.blur !== undefined) object.blur = number(o.blur, 0, 500);
    if (o.mask !== undefined) {
      const k = record(o.mask);
      object.mask = { src: imageSource(k.src), x: number(k.x, -MAX_SIZE, MAX_SIZE), y: number(k.y, -MAX_SIZE, MAX_SIZE), width: number(k.width, 0.01, MAX_SIZE), height: number(k.height, 0.01, MAX_SIZE) };
      if (k.disabled === true) object.mask.disabled = true;
      if (k.background !== undefined) { if (k.background !== 'black') throw new Error('Máscara inválida.'); object.mask.background = 'black'; }
    }
    if (o.shadow !== undefined) {
      const s = record(o.shadow), color = string(s.color, 7);
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Cor de sombra inválida.');
      object.shadow = { x: number(s.x, -5000, 5000), y: number(s.y, -5000, 5000), blur: number(s.blur, 0, 500), color, opacity: number(s.opacity, 0, 1) };
    }
    if (o.opacity !== undefined) object.opacity = number(o.opacity, 0, 1);
    if (o.transparencyGradient !== undefined) {
      const g = record(o.transparencyGradient);
      if (g.type !== 'linear' && g.type !== 'radial') throw new Error('Degradê de transparência inválido.');
      object.transparencyGradient = { type: g.type, x1: number(g.x1, -100, 100), y1: number(g.y1, -100, 100), x2: number(g.x2, -100, 100), y2: number(g.y2, -100, 100), from: number(g.from, 0, 100), to: number(g.to, 0, 100) };
    }
    if (o.fillGradient !== undefined) {
      if (o.type === 'image') throw new Error('Bitmaps não têm degradê.');
      const g = record(o.fillGradient);
      if (g.type !== 'linear' && g.type !== 'radial') throw new Error('Degradê de preenchimento inválido.');
      if (!Array.isArray(g.stops) || g.stops.length < 2 || g.stops.length > 64) throw new Error('Degradê de preenchimento inválido.');
      const stops = g.stops.map(raw => { const st = record(raw), color = string(st.color, 7); if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Cor do degradê inválida.'); return { offset: number(st.offset, 0, 1), color, ...(st.opacity !== undefined ? { opacity: number(st.opacity, 0, 1) } : {}) }; });
      const fill: FillGradient = { type: g.type, x1: number(g.x1, -100, 100), y1: number(g.y1, -100, 100), x2: number(g.x2, -100, 100), y2: number(g.y2, -100, 100), stops };
      if (g.spread !== undefined) { if (g.spread !== 'pad' && g.spread !== 'reflect' && g.spread !== 'repeat') throw new Error('Arranjo do degradê inválido.'); fill.spread = g.spread; }
      if (g.steps !== undefined) { const steps = number(g.steps, 2, 256); if (!Number.isInteger(steps)) throw new Error('Etapas do degradê inválidas.'); fill.steps = steps; }
      if (g.acceleration !== undefined) fill.acceleration = number(g.acceleration, -100, 100);
      object.fillGradient = fill;
    }
    if (o.strokeDash !== undefined) { if (!Array.isArray(o.strokeDash) || o.strokeDash.length > 16) throw new Error('Estilo de linha inválido.'); object.strokeDash = o.strokeDash.map(v => number(v, 0, 1000)); }
    if (o.strokeJoin !== undefined) { if (o.strokeJoin !== 'miter' && o.strokeJoin !== 'round' && o.strokeJoin !== 'bevel') throw new Error('Cantos do contorno inválidos.'); object.strokeJoin = o.strokeJoin; }
    if (o.strokeCap !== undefined) { if (o.strokeCap !== 'butt' && o.strokeCap !== 'round' && o.strokeCap !== 'square') throw new Error('Extremidades do contorno inválidas.'); object.strokeCap = o.strokeCap; }
    if (o.strokeMiter !== undefined) object.strokeMiter = number(o.strokeMiter, 1, 100);
    if (o.strokePosition !== undefined) { if (o.strokePosition !== 'inside' && o.strokePosition !== 'outside') throw new Error('Posição do contorno inválida.'); object.strokePosition = o.strokePosition; }
    for (const key of ['strokeBehind', 'strokeScale'] as const) if (o[key] !== undefined) { if (typeof o[key] !== 'boolean') throw new Error('Opção de contorno inválida.'); if (o[key]) object[key] = true; }
    for (const key of ['arrowStart', 'arrowEnd'] as const) if (o[key] !== undefined) { if (!isArrowKind(o[key])) throw new Error('Ponta de seta inválida.'); object[key] = o[key]; }
    if (o.blendMode !== undefined) { if (!isBlendMode(o.blendMode)) throw new Error('Modo de mesclagem inválido.'); object.blendMode = o.blendMode; }
    if (o.clipParent !== undefined) object.clipParent = string(o.clipParent, 128);
    if (o.locked !== undefined) { if (typeof o.locked !== 'boolean') throw new Error('Bloqueio inválido.'); if (o.locked) object.locked = true; }
    if (o.hidden !== undefined) { if (typeof o.hidden !== 'boolean') throw new Error('Objeto oculto inválido.'); if (o.hidden) object.hidden = true; }
    if (o.clipUnlocked !== undefined) { if (typeof o.clipUnlocked !== 'boolean') throw new Error('PowerClip inválido.'); if (o.clipUnlocked) object.clipUnlocked = true; }
    if (o.layer !== undefined) object.layer = string(o.layer, 128);
    const color = (v: unknown) => { const c = string(v, 7); if (c !== 'none' && !/^#[0-9a-f]{6}$/i.test(c)) throw new Error('Cor inválida.'); return c; };
    if (o.fillPattern !== undefined) {
      if (o.type === 'image') throw new Error('Bitmaps não têm padrão.');
      const p = record(o.fillPattern);
      if (p.kind !== 'twoColor' && p.kind !== 'bitmap') throw new Error('Padrão de preenchimento inválido.');
      object.fillPattern = { kind: p.kind, size: number(p.size, 0.1, MAX_SIZE) };
      if (p.kind === 'bitmap') object.fillPattern.src = imageSource(p.src);
      else { if (typeof p.preset !== 'string' || !patternPresets.some(x => x.id === p.preset)) throw new Error('Padrão de preenchimento inválido.'); object.fillPattern.preset = p.preset; object.fillPattern.fg = color(p.fg); object.fillPattern.bg = color(p.bg); }
      if (p.ratio !== undefined) object.fillPattern.ratio = number(p.ratio, 0.01, 100);
      if (p.angle !== undefined) object.fillPattern.angle = number(p.angle, -360, 360);
    }
    if (o.meshFill !== undefined) {
      if (o.type === 'image' || o.type === 'text') throw new Error('Malha só se aplica a formas.');
      const m = record(o.meshFill), rows = number(m.rows, 1, 12), cols = number(m.cols, 1, 12);
      if (!Number.isInteger(rows) || !Number.isInteger(cols) || !Array.isArray(m.colors) || m.colors.length !== (rows + 1) * (cols + 1)) throw new Error('Malha inválida.');
      object.meshFill = { rows, cols, colors: m.colors.map(c => { const v = color(c); if (v === 'none') throw new Error('Malha inválida.'); return v; }), src: imageSource(m.src) };
    }
    if (o.style !== undefined) object.style = string(o.style, 128);
    if (o.fillStyle !== undefined) object.fillStyle = string(o.fillStyle, 128);
    if (o.fillSpot !== undefined) object.fillSpot = string(o.fillSpot, 64);
    if (o.strokeSpot !== undefined) object.strokeSpot = string(o.strokeSpot, 64);
    if (o.envelope !== undefined) {
      // Envelope guardado (CorelDRAW): forma original, nós e opções; só em curvas.
      if (o.type !== 'path') throw new Error('Envelope inválido.');
      const e = record(o.envelope), coord = (v: unknown) => number(v, -MAX_SIZE, MAX_SIZE), point = (v: unknown) => { const r = record(v); return { x: coord(r.x), y: coord(r.y) }; };
      if (typeof e.id !== 'string' || e.id.length > 64 || typeof e.check !== 'string' || e.check.length > 200) throw new Error('Envelope inválido.');
      if (!Array.isArray(e.source) || e.source.length < 2 || e.source.length > 10000 || !Array.isArray(e.nodes) || e.nodes.length < 4 || e.nodes.length > 500) throw new Error('Envelope inválido.');
      const source: PathCommand[] = e.source.map((value, index) => {
        const c = record(value);
        if (index === 0 && c.type !== 'M') throw new Error('Envelope inválido.');
        if (c.type === 'Z') return { type: 'Z' };
        if (c.type === 'C') return { type: 'C', x1: coord(c.x1), y1: coord(c.y1), x2: coord(c.x2), y2: coord(c.y2), x: coord(c.x), y: coord(c.y) };
        if (c.type !== 'M' && c.type !== 'L') throw new Error('Envelope inválido.');
        return { type: c.type, x: coord(c.x), y: coord(c.y) };
      });
      const nodes = e.nodes.map(value => { const n = record(value); return { ...point(n), t: number(n.t, 0, 1), ...(n.c1 !== undefined ? { c1: point(n.c1) } : {}), ...(n.c2 !== undefined ? { c2: point(n.c2) } : {}), ...(n.smooth === true ? { smooth: true } : {}) }; });
      const corners = Array.isArray(e.corners) && e.corners.length === 4 ? e.corners.map(c => Math.round(number(c, 0, nodes.length - 1))) : [];
      if (corners.length !== 4 || corners[0] !== 0 || !corners.every((c, i) => !i || c > corners[i - 1])) throw new Error('Envelope inválido.');
      const box = record(e.box), frame = Array.isArray(e.frame) && e.frame.length === 6 ? e.frame.map(coord) : null;
      if (!frame || !['line', 'arc', 'doubleArc', 'free'].includes(String(e.mode)) || !['horizontal', 'original', 'putty', 'vertical'].includes(String(e.mapping))) throw new Error('Envelope inválido.');
      object.envelope = { id: e.id, check: e.check, source, nodes, corners: corners as [number, number, number, number], box: { x: coord(box.x), y: coord(box.y), width: number(box.width, 1e-6, MAX_SIZE), height: number(box.height, 1e-6, MAX_SIZE) }, frame: frame as [number, number, number, number, number, number], mode: e.mode as EnvelopeMode, mapping: e.mapping as EnvelopeMapping, ...(e.keepLines === true ? { keepLines: true } : {}) };
    }
    if (o.warp !== undefined) {
      // Envelope de bitmap: imagem original e nós relativos à caixa do objeto.
      if (o.type !== 'image') throw new Error('Envelope de bitmap inválido.');
      const w = record(o.warp), rel = (v: unknown) => number(v, -1000, 1000), point = (v: unknown) => { const r = record(v); return { x: rel(r.x), y: rel(r.y) }; };
      if (typeof w.check !== 'string' || w.check.length > 100 || !Array.isArray(w.nodes) || w.nodes.length < 4 || w.nodes.length > 500 || !['line', 'arc', 'doubleArc', 'free'].includes(String(w.mode))) throw new Error('Envelope de bitmap inválido.');
      const nodes = w.nodes.map(value => { const n = record(value); return { ...point(n), t: number(n.t, 0, 1), ...(n.c1 !== undefined ? { c1: point(n.c1) } : {}), ...(n.c2 !== undefined ? { c2: point(n.c2) } : {}), ...(n.smooth === true ? { smooth: true } : {}) }; });
      const corners = Array.isArray(w.corners) && w.corners.length === 4 ? w.corners.map(c => Math.round(number(c, 0, nodes.length - 1))) : [];
      if (corners.length !== 4 || corners[0] !== 0 || !corners.every((c, i) => !i || c > corners[i - 1])) throw new Error('Envelope de bitmap inválido.');
      const box = record(w.box);
      object.warp = { src: imageSource(w.src), nodes, corners: corners as [number, number, number, number], box: { x: rel(box.x), y: rel(box.y), width: number(box.width, 1e-6, 1000), height: number(box.height, 1e-6, 1000) }, mode: w.mode as EnvelopeMode, check: w.check };
    }
    for (const key of ['fillCmyk', 'strokeCmyk'] as const) if (o[key] !== undefined) { const v = o[key] as unknown; if (!Array.isArray(v) || v.length !== 4 || !v.every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100)) throw new Error('Cor CMYK inválida.'); object[key] = [v[0], v[1], v[2], v[3]]; }
    if (o.strokeStyle !== undefined) object.strokeStyle = string(o.strokeStyle, 128);
    const anchor = (value: unknown): Anchor => {
      const a = record(value), out: Anchor = { x: number(a.x, -MAX_SIZE, MAX_SIZE), y: number(a.y, -MAX_SIZE, MAX_SIZE) };
      if (a.id !== undefined) { out.id = string(a.id, 128); out.u = number(a.u, -1000, 1000); out.v = number(a.v, -1000, 1000); }
      return out;
    };
    if (o.connector !== undefined) {
      if (o.type !== 'path') throw new Error('Conector inválido.');
      const c = record(o.connector);
      if (c.kind !== 'straight' && c.kind !== 'elbow' && c.kind !== 'rounded') throw new Error('Conector inválido.');
      object.connector = { from: anchor(c.from), to: anchor(c.to), kind: c.kind };
    }
    if (o.effectOf !== undefined) {
      if (o.type !== 'path') throw new Error('Efeito inválido.');
      const e = record(o.effectOf), origin = record(e.origin);
      if (e.kind !== 'blockShadow' && e.kind !== 'contour') throw new Error('Efeito inválido.');
      const link: EffectLink = { id: string(e.id, 128), kind: e.kind, origin: { x: number(origin.x, -MAX_SIZE, MAX_SIZE), y: number(origin.y, -MAX_SIZE, MAX_SIZE) }, shape: string(e.shape, 64) };
      if (e.dx !== undefined) link.dx = number(e.dx, -MAX_SIZE, MAX_SIZE);
      if (e.dy !== undefined) link.dy = number(e.dy, -MAX_SIZE, MAX_SIZE);
      if (e.direction !== undefined) { if (e.direction !== 'outside' && e.direction !== 'inside') throw new Error('Efeito inválido.'); link.direction = e.direction; }
      if (e.steps !== undefined) link.steps = number(e.steps, 1, 30);
      if (e.corners !== undefined) { if (e.corners !== 'miter' && e.corners !== 'round' && e.corners !== 'bevel') throw new Error('Efeito inválido.'); link.corners = e.corners; }
      if (e.offset !== undefined) link.offset = number(e.offset, 0.01, MAX_SIZE);
      if (e.endColor !== undefined) { const c = color(e.endColor); if (c === 'none') throw new Error('Efeito inválido.'); link.endColor = c; }
      if (e.color !== undefined) { const c = color(e.color); if (c === 'none') throw new Error('Efeito inválido.'); link.color = c; }
      if (e.at !== undefined) { const at = record(e.at); link.at = { x: number(at.x, -1e9, 1e9), y: number(at.y, -1e9, 1e9) }; }
      if (e.stale === true) link.stale = true;
      object.effectOf = link;
    }
    if (o.crop !== undefined) {
      if (o.type !== 'image' || !Array.isArray(o.crop) || o.crop.length < 3 || o.crop.length > 10000) throw new Error('Recorte de bitmap inválido.');
      const coord = (v: unknown) => number(v, -10, 11);
      object.crop = o.crop.map((value, index) => {
        const c = record(value);
        if (index === 0 && c.type !== 'M') throw new Error('Recorte de bitmap inválido.');
        if (c.type === 'Z') return { type: 'Z' };
        if (c.type === 'C') return { type: 'C', x1: coord(c.x1), y1: coord(c.y1), x2: coord(c.x2), y2: coord(c.y2), x: coord(c.x), y: coord(c.y) };
        if (c.type !== 'M' && c.type !== 'L') throw new Error('Recorte de bitmap inválido.');
        return { type: c.type, x: coord(c.x), y: coord(c.y) };
      });
    }
    if (o.dimLink !== undefined) {
      if (o.type !== 'text') throw new Error('Cota inválida.');
      const d = record(o.dimLink), axis = d.axis === undefined ? undefined : record(d.axis);
      object.dimLink = { a: anchor(d.a), b: anchor(d.b), offset: number(d.offset, -MAX_SIZE, MAX_SIZE), color: color(d.color),
        ...(axis ? { axis: { x: number(axis.x, -1, 1), y: number(axis.y, -1, 1) } } : {}),
        ...(d.unit !== undefined ? { unit: string(d.unit, 8) as DocumentUnit } : {}),
        ...(d.precision !== undefined ? { precision: number(d.precision, 0, 4) } : {}),
        ...(d.showUnit !== undefined ? { showUnit: d.showUnit === true } : {}),
        ...(d.fontSize !== undefined ? { fontSize: number(d.fontSize, 1, 1000) } : {}) };
    }
    if (o.symbol !== undefined) {
      const s = record(o.symbol);
      if (!Array.isArray(s.matrix) || s.matrix.length !== 6) throw new Error('Símbolo inválido.');
      const matrix = s.matrix.map((v, i) => number(v, i < 4 ? -1e6 : -1e9, i < 4 ? 1e6 : 1e9)) as [number, number, number, number, number, number];
      if (Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-12) throw new Error('Símbolo inválido.');
      const instance = string(s.instance, 128);
      if (!object.groupPath?.includes(instance)) throw new Error('Instância de símbolo sem grupo.');
      object.symbol = { id: string(s.id, 128), instance, matrix };
    }
    return object;
  });
  const byId = new Map(objects.map(o => [o.id, o]));
  for (const o of objects) {
    let parent = o.clipParent, depth = 0;
    while (parent !== undefined) {
      const frame = byId.get(parent);
      if (!frame || frame.type === 'text' || frame.type === 'image' || parent === o.id || ++depth > 32) throw new Error('PowerClip inválido ou circular.');
      parent = frame.clipParent;
    }
  }
  const groups=new Map<string,{parent:string;last:number}>();
  objects.forEach((o,i)=>o.groupPath?.forEach((id,depth)=>{
    const parent=JSON.stringify(o.groupPath!.slice(0,depth)), previous=groups.get(id);
    if(ids.has(id) || (previous && (previous.parent!==parent || previous.last!==i-1)))throw new Error('Hierarquia ou ordem dos grupos inválida.');
    groups.set(id,{parent,last:i});
  }));
  return objects;
}
export function parseProject(source: string): VectorDocument {
  if (new TextEncoder().encode(source).length > MAX_FILE_BYTES) throw new Error('O arquivo excede o limite de 10 MB.');
  let raw: unknown;
  try { raw = JSON.parse(source); } catch { throw new Error('O arquivo não contém JSON válido.'); }
  const data = record(raw);
  if (data.version !== 1) throw new Error('Versão de projeto não suportada. Esperado: versão 1.');
  const artboard = record(data.artboard);
  const ids = new Set<string>(), objects = parseObjects(data.objects, ids);
  // Páginas (como no CorelDRAW): `objects` é a página ativa; as demais guardam seus objetos em `pages`.
  let pages: DocumentPage[] | undefined, page = 0;
  if (data.pages !== undefined) {
    if (!Array.isArray(data.pages) || data.pages.length < 1 || data.pages.length > 999) throw new Error('Lista de páginas inválida.');
    page = data.page === undefined ? 0 : number(data.page, 0, data.pages.length - 1);
    if (!Number.isInteger(page)) throw new Error('Página ativa inválida.');
    pages = data.pages.map((value, i) => { const p = record(value); const list = parseObjects(p.objects, ids); if (i === page && list.length) throw new Error('Página ativa inválida.'); return { id: string(p.id, 128), name: string(p.name, 256), objects: list }; });
    if (new Set(pages.map(p => p.id)).size !== pages.length) throw new Error('O projeto contém páginas duplicadas.');
  }
  let palette: string[] | undefined;
  if (data.palette !== undefined) {
    if (!Array.isArray(data.palette) || data.palette.length > 1000 || !data.palette.every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) throw new Error('Paleta do documento inválida.');
    palette = [...data.palette] as string[];
  }
  // Rebuild known fields instead of trusting arbitrary imported properties.
  if(data.unit!==undefined&&!isDocumentUnit(data.unit))throw new Error('Unidade inválida.');
  let guides: Guideline[] | undefined;
  if (data.guides !== undefined) {
    if (!Array.isArray(data.guides) || data.guides.length > 500) throw new Error('Linhas-guia inválidas.');
    guides = data.guides.map(value => { const g = record(value); if (g.axis !== 'x' && g.axis !== 'y') throw new Error('Linha-guia inválida.'); return { id: string(g.id, 128), axis: g.axis, position: number(g.position, -100000, 100000) }; });
  }
  let layers: Layer[] | undefined, activeLayer: string | undefined;
  if (data.layers !== undefined) {
    if (!Array.isArray(data.layers) || data.layers.length < 1 || data.layers.length > 200) throw new Error('Camadas inválidas.');
    layers = data.layers.map(value => { const l = record(value); for (const key of ['visible', 'locked', 'printable'] as const) if (typeof l[key] !== 'boolean') throw new Error('Camada inválida.'); return { id: string(l.id, 128), name: string(l.name, 256), visible: l.visible as boolean, locked: l.locked as boolean, printable: l.printable as boolean }; });
    if (new Set(layers.map(l => l.id)).size !== layers.length) throw new Error('O projeto contém camadas duplicadas.');
    activeLayer = string(data.activeLayer, 128);
    if (!layers.some(l => l.id === activeLayer)) throw new Error('Camada ativa inválida.');
  }
  let styles: ObjectStyle[] | undefined, symbols: SymbolDef[] | undefined, colorStyles: ColorStyle[] | undefined;
  if (data.colorStyles !== undefined) {
    if (!Array.isArray(data.colorStyles) || data.colorStyles.length > 500) throw new Error('Estilos de cor inválidos.');
    colorStyles = data.colorStyles.map(value => { const s = record(value), color = string(s.color, 7); if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Estilo de cor inválido.'); return { id: string(s.id, 128), name: string(s.name, 256), color: color.toLowerCase() }; });
    if (new Set(colorStyles.map(s => s.id)).size !== colorStyles.length) throw new Error('Estilos de cor duplicados.');
  }
  if (data.styles !== undefined) {
    if (!Array.isArray(data.styles) || data.styles.length > 500) throw new Error('Estilos inválidos.');
    styles = data.styles.map(value => {
      const st = record(value), props = record(st.props);
      // Os atributos são validados como os de um texto (que aceita todos) e só os de estilo são mantidos.
      const parsed = parseObjects([{ ...props, id: 'estilo', type: 'text', name: 'estilo', x: 0, y: 0, width: 1, height: 1, text: '', fill: props.fill ?? 'none' }], new Set())[0] as unknown as Record<string, unknown>;
      const clean: Record<string, unknown> = {};
      for (const key of STYLE_KEYS) if (props[key] !== undefined && parsed[key] !== undefined) clean[key] = parsed[key];
      if (props.meshFill !== undefined) throw new Error('Estilo inválido.');
      return { id: string(st.id, 128), name: string(st.name, 256), props: clean as Partial<VectorObject> };
    });
    if (new Set(styles.map(s => s.id)).size !== styles.length) throw new Error('Estilos duplicados.');
  }
  if (data.symbols !== undefined) {
    if (!Array.isArray(data.symbols) || data.symbols.length > 500) throw new Error('Símbolos inválidos.');
    symbols = data.symbols.map(value => { const s = record(value), list = parseObjects(s.objects, new Set()); if (!list.length || list.some(o => o.symbol)) throw new Error('Símbolo inválido.'); return { id: string(s.id, 128), name: string(s.name, 256), objects: list }; });
    if (new Set(symbols.map(s => s.id)).size !== symbols.length) throw new Error('Símbolos duplicados.');
  }
  return { version: 1, ...(styles?{styles}:{}), ...(colorStyles?.length?{colorStyles}:{}), ...(symbols?{symbols}:{}), ...(data.unit?{unit:data.unit as DocumentUnit}:{}), ...(palette?{palette}:{}), ...(pages?{pages,page}:{}), ...(guides?{guides}:{}), ...(layers?{layers,activeLayer}:{}), id: string(data.id, 128), name: string(data.name, 256), artboard: { width: number(artboard.width, 1, 10000), height: number(artboard.height, 1, 10000) }, objects };
}
/**
 * Prévia gravada no começo do arquivo (`"thumbnail"`, JPEG/PNG em data URL): o Explorador do Windows mostra a miniatura
 * do projeto lendo só esse trecho (build/thumbs/GfxThumbnail.cs). Ao abrir, o campo é ignorado.
 */
export function embedThumbnail(source: string, dataUrl: string | null): string {
  if (!dataUrl || dataUrl.length > 1024 * 1024 || !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || !source.startsWith('{"') || new TextEncoder().encode(source).length + dataUrl.length + 20 > MAX_FILE_BYTES) return source;
  return `{"thumbnail":${JSON.stringify(dataUrl)},${source.slice(1)}`;
}
export function serializeProject(document: VectorDocument): string {
  const source = JSON.stringify(document);
  parseProject(source);
  return source;
}
