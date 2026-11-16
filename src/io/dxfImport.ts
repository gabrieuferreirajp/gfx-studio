/**
 * Importação de DXF (AutoCAD, texto ASCII): converte as entidades em SVG no espaço do documento, que segue
 * para o importador de SVG (grupos, textos e limites de tamanho). Blocos (INSERT) viram grupos.
 * Suporta LINE, LWPOLYLINE/POLYLINE (com arcos por bulge), CIRCLE, ARC, ELLIPSE, SPLINE, SOLID/TRACE,
 * HATCH sólida, TEXT/MTEXT/ATTRIB, INSERT (com matrizes) e DIMENSION (bloco da cota).
 */
type Pair = [number, string];
interface Entity { type: string; pairs: Pair[]; vertices?: Entity[] }
interface Layer { color: number; off: boolean; lineweight?: number; truecolor?: string }
type M = [number, number, number, number, number, number];
type Pt = { x: number; y: number };
const mul = (a: M, b: M): M => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const apply = (m: M, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
const ID: M = [1, 0, 0, 1, 0, 0];
const escapeXml = (t: string) => t.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** Cores ACI do AutoCAD (1–255); a 7 (branco/preto) vira preto sobre a página branca. */
export function aciColor(index: number): string {
  const base: Record<number, string> = { 1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#000000', 8: '#808080', 9: '#c0c0c0' };
  if (base[index]) return base[index];
  if (index >= 250 && index <= 255) { const v = Math.round(51 + (index - 250) * 40.8); return '#' + v.toString(16).padStart(2, '0').repeat(3); }
  if (index < 10 || index > 249) return '#000000';
  const hue = Math.floor((index - 10) / 10) * 15, variant = (index - 10) % 10, value = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][variant], sat = variant % 2 ? 0.5 : 1;
  const f = (n: number) => { const k = (n + hue / 60) % 6; return value - value * sat * Math.max(0, Math.min(k, 4 - k, 1)); };
  return '#' + [f(5), f(3), f(1)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
const trueColor = (value: string | undefined) => { const n = Number(value); return value !== undefined && Number.isInteger(n) && n >= 0 ? '#' + (n & 0xffffff).toString(16).padStart(6, '0') : undefined; };
/** Milímetros por unidade do desenho ($INSUNITS); sem unidade = milímetros. */
const unitMm: Record<number, number> = { 1: 25.4, 2: 304.8, 3: 1609344, 4: 1, 5: 10, 6: 1000, 7: 1e6, 8: 0.0000254, 9: 0.0254, 10: 914.4, 14: 100, 15: 10000, 16: 100000 };

/** Texto do DXF: códigos de formatação do MTEXT, símbolos %% e escapes \U+XXXX. */
export function dxfText(raw: string, mtext = false): string {
  let t = raw.replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoO]/g, '').replace(/%%%/g, '%');
  if (mtext) t = t.replace(/\\[Pp]/g, '\n').replace(/\\[\\{}]/g, m => '\u0000' + m[1]).replace(/\\S([^;]*);/g, (_, s) => s.replace(/[\^#]/, '/')).replace(/\\[A-Za-z][^;\\{}]*;/g, '').replace(/\\[LlOoKkNn~]/g, m => m === '\\~' ? ' ' : '').replace(/[{}]/g, '').replace(/\u0000/g, '');
  return t;
}
function readPairs(source: string): Pair[] {
  if (source.startsWith('AutoCAD Binary DXF')) throw new Error('DXF binário não é suportado. No AutoCAD, salve como DXF ASCII.');
  const lines = source.split(/\r?\n/), pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) { const code = parseInt(lines[i].trim(), 10); if (!Number.isFinite(code)) throw new Error('Arquivo DXF inválido.'); pairs.push([code, lines[i + 1].replace(/\s+$/, '')]); }
  if (!pairs.some(([c, v]) => c === 0 && v === 'SECTION')) throw new Error('Arquivo DXF inválido.');
  return pairs;
}
const get = (e: Entity, code: number, fallback = '') => e.pairs.find(([c]) => c === code)?.[1] ?? fallback;
const num = (e: Entity, code: number, fallback = 0) => { const v = Number(get(e, code, '')); return get(e, code, '') !== '' && Number.isFinite(v) ? v : fallback; };
const all = (e: Entity, code: number) => e.pairs.filter(([c]) => c === code).map(([, v]) => Number(v));

/** Converte DXF ASCII em SVG (px, y para baixo), com avisos do que não pôde ser reproduzido. */
export function dxfToSvg(source: string): { svg: string; warnings: string[] } {
  const pairs = readPairs(source), warnings = new Set<string>();
  const header = new Map<string, Pair[]>(), layers = new Map<string, Layer>(), blocks = new Map<string, { base: Pt; entities: Entity[] }>(), entities: Entity[] = [];
  // Seções: cabeçalho, tabelas (camadas), blocos e entidades.
  let section = '', i = 0, block: { name: string; base: Pt; entities: Entity[] } | null = null, variable = '';
  const take = () => { const e: Entity = { type: pairs[i][1], pairs: [] }; i++; while (i < pairs.length && pairs[i][0] !== 0) e.pairs.push(pairs[i++]); return e; };
  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code === 0 && value === 'SECTION') { section = pairs[i + 1]?.[1] ?? ''; i += 2; continue; }
    if (code === 0 && value === 'ENDSEC') { section = ''; i++; continue; }
    if (section === 'HEADER') { if (code === 9) { variable = value; header.set(variable, []); } else header.get(variable)?.push([code, value]); i++; continue; }
    if (code !== 0) { i++; continue; }
    const e = take();
    if (section === 'TABLES' && e.type === 'LAYER') { const color = num(e, 62, 7); layers.set(get(e, 2), { color: Math.abs(color) || 7, off: color < 0 || (num(e, 70) & 1) === 1, lineweight: num(e, 370, -3), truecolor: trueColor(get(e, 420, '') || undefined) }); continue; }
    if (section === 'BLOCKS') {
      if (e.type === 'BLOCK') block = { name: get(e, 2), base: { x: num(e, 10), y: num(e, 20) }, entities: [] };
      else if (e.type === 'ENDBLK') { if (block) blocks.set(block.name, block); block = null; }
      else block?.entities.push(e);
      continue;
    }
    if (section === 'ENTITIES') entities.push(e);
  }
  // POLYLINE + VERTEX… + SEQEND formam uma entidade.
  const group = (list: Entity[]) => { const out: Entity[] = []; for (const e of list) { if (e.type === 'VERTEX' && out.at(-1)?.type === 'POLYLINE') out.at(-1)!.vertices!.push(e); else if (e.type === 'SEQEND') continue; else out.push(e.type === 'POLYLINE' ? { ...e, vertices: [] } : e); } return out; };
  for (const b of blocks.values()) b.entities = group(b.entities);
  let model = group(entities);
  if (model.some(e => num(e, 67) !== 1) && model.some(e => num(e, 67) === 1)) { model = model.filter(e => num(e, 67) !== 1); warnings.add('Somente o espaço do modelo foi importado (layouts de papel foram ignorados).'); }
  const insUnits = Number(header.get('$INSUNITS')?.find(([c]) => c === 70)?.[1] ?? 0), mmPerUnit = unitMm[insUnits] ?? 1;
  if (!unitMm[insUnits] && insUnits !== 0) warnings.add('Unidade do desenho desconhecida: interpretada como milímetros.');

  type Item = { d: string; stroke: string; fill: string; weight: number; group: number[] } | { text: string; at: Pt; height: number; angle: number; anchor: 'start' | 'middle' | 'end'; color: string; group: number[]; lines: number; spacing: number };
  const items: Item[] = [], box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const extend = (p: Pt) => { if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return; box.minX = Math.min(box.minX, p.x); box.maxX = Math.max(box.maxX, p.x); box.minY = Math.min(box.minY, p.y); box.maxY = Math.max(box.maxY, p.y); };
  let groupCounter = 0;
  /** Caminho em coordenadas do mundo: lista de contornos com M/L/C. */
  type Seg = { type: 'M' | 'L'; p: Pt } | { type: 'C'; c1: Pt; c2: Pt; p: Pt } | { type: 'Z' };
  const emit = (segs: Seg[], m: M, style: { stroke: string; fill: string; weight: number }, groupPath: number[]) => {
    if (segs.length < 2) return;
    const T = (p: Pt) => { const q = apply(m, p); extend(q); return q; };
    const parts = segs.map(s => s.type === 'Z' ? 'Z' : s.type === 'C' ? (() => { const a = T(s.c1), b = T(s.c2), c = T(s.p); return `C${a.x} ${a.y} ${b.x} ${b.y} ${c.x} ${c.y}`; })() : (() => { const q = T(s.p); return `${s.type}${q.x} ${q.y}`; })());
    items.push({ d: parts.join(''), ...style, group: groupPath });
  };
  /** Arco de elipse (centro, semieixo maior, razão, parâmetros) em curvas de Bézier de até 90°. */
  const ellipse = (c: Pt, major: Pt, ratio: number, t0: number, t1: number, first: boolean): Seg[] => {
    const minor = { x: -major.y * ratio, y: major.x * ratio }, at = (t: number) => ({ x: c.x + major.x * Math.cos(t) + minor.x * Math.sin(t), y: c.y + major.y * Math.cos(t) + minor.y * Math.sin(t) }), d = (t: number) => ({ x: -major.x * Math.sin(t) + minor.x * Math.cos(t), y: -major.y * Math.sin(t) + minor.y * Math.cos(t) });
    const span = t1 - t0, n = Math.max(1, Math.ceil(Math.abs(span) / (Math.PI / 2))), step = span / n, k = 4 / 3 * Math.tan(step / 4), out: Seg[] = first ? [{ type: 'M', p: at(t0) }] : [];
    for (let j = 0; j < n; j++) { const a = t0 + j * step, b = a + step, pa = at(a), pb = at(b), da = d(a), db = d(b); out.push({ type: 'C', c1: { x: pa.x + k * da.x, y: pa.y + k * da.y }, c2: { x: pb.x - k * db.x, y: pb.y - k * db.y }, p: pb }); }
    return out;
  };
  /** Vértices com bulge (arco entre dois pontos) do LWPOLYLINE/POLYLINE/HATCH. */
  const bulgePath = (points: { p: Pt; bulge: number }[], closed: boolean): Seg[] => {
    if (!points.length) return [];
    const out: Seg[] = [{ type: 'M', p: points[0].p }], count = closed ? points.length : points.length - 1;
    for (let j = 0; j < count; j++) {
      const a = points[j], b = points[(j + 1) % points.length], bulge = a.bulge;
      if (!bulge || Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) < 1e-12) { out.push({ type: 'L', p: b.p }); continue; }
      const theta = 4 * Math.atan(bulge), chord = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y), r = chord / (2 * Math.sin(Math.abs(theta) / 2));
      const mid = { x: (a.p.x + b.p.x) / 2, y: (a.p.y + b.p.y) / 2 }, h = r * Math.cos(theta / 2), dir = { x: (b.p.x - a.p.x) / chord, y: (b.p.y - a.p.y) / chord }, sgn = bulge > 0 ? 1 : -1;
      const c = { x: mid.x - dir.y * h * sgn, y: mid.y + dir.x * h * sgn }, start = Math.atan2(a.p.y - c.y, a.p.x - c.x);
      out.push(...ellipse(c, { x: r, y: 0 }, 1, start, start + theta, false));
    }
    if (closed) out.push({ type: 'Z' });
    return out;
  };
  /** B-spline (com pesos) amostrada em segmentos de reta. */
  const bspline = (control: Pt[], knots: number[], weights: number[], degree: number, fit: Pt[], closed: boolean, first = true): Seg[] => {
    if (control.length < 2 || knots.length !== control.length + degree + 1) { const pts = fit.length >= 2 ? fit : control; return pts.length < 2 ? [] : [...(first ? [{ type: 'M' as const, p: pts[0] }] : [{ type: 'L' as const, p: pts[0] }]), ...pts.slice(1).map(p => ({ type: 'L' as const, p })), ...(closed ? [{ type: 'Z' as const }] : [])]; }
    const w = (j: number) => weights[j] ?? 1, lo = knots[degree], hi = knots[control.length], samples = Math.min(2000, control.length * 16), out: Seg[] = [];
    for (let s = 0; s <= samples; s++) {
      const t = lo + (hi - lo) * s / samples; let k = degree; while (k < control.length - 1 && t >= knots[k + 1]) k++;
      const d = Array.from({ length: degree + 1 }, (_, j) => { const P = control[k - degree + j], ww = w(k - degree + j); return { x: P.x * ww, y: P.y * ww, w: ww }; });
      for (let r = 1; r <= degree; r++) for (let j = degree; j >= r; j--) { const idx = k - degree + j, den = knots[idx + degree - r + 1] - knots[idx], a = den ? (t - knots[idx]) / den : 0; d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y, w: (1 - a) * d[j - 1].w + a * d[j].w }; }
      const p = { x: d[degree].x / d[degree].w, y: d[degree].y / d[degree].w };
      out.push({ type: s || !first ? 'L' : 'M', p });
    }
    if (closed) out.push({ type: 'Z' });
    return out;
  };
  const spline = (e: Entity): Seg[] => {
    const xs = all(e, 10), ys = all(e, 20), fx = all(e, 11), fy = all(e, 21);
    return bspline(xs.map((x, j) => ({ x, y: ys[j] ?? 0 })), all(e, 40), all(e, 41), num(e, 71, 3), fx.map((x, j) => ({ x, y: fy[j] ?? 0 })), (num(e, 70) & 1) === 1);
  };
  /** Contornos da HATCH sólida (polilinhas e arestas reta/arco/elipse). */
  const hatchLoops = (e: Entity): Seg[] => {
    const p = e.pairs, out: Seg[] = []; let j = p.findIndex(([c]) => c === 91); if (j < 0) return out;
    const loops = Number(p[j][1]); j++;
    const read = (code: number) => { while (j < p.length && p[j][0] !== code) j++; return Number(p[j++]?.[1]); };
    for (let l = 0; l < loops && j < p.length; l++) {
      const flags = read(92);
      if (flags & 2) {
        const hasBulge = read(72), count = (read(73), read(93)), pts: { p: Pt; bulge: number }[] = [];
        for (let v = 0; v < count; v++) { const x = read(10), y = read(20), bulge = hasBulge ? (p[j]?.[0] === 42 ? Number(p[j++][1]) : 0) : 0; pts.push({ p: { x, y }, bulge }); }
        out.push(...bulgePath(pts, true));
      } else {
        const count = read(93), loop: Seg[] = [];
        for (let v = 0; v < count; v++) {
          const kind = read(72);
          if (kind === 1) { const a = { x: read(10), y: read(20) }, b = { x: read(11), y: read(21) }; if (!loop.length) loop.push({ type: 'M', p: a }); loop.push({ type: 'L', p: b }); }
          // Arestas em sentido horário guardam os ângulos espelhados: percorre de −início a −fim, decrescendo.
          else if (kind === 2) { const c = { x: read(10), y: read(20) }, r = read(40), a0 = read(50) * Math.PI / 180, a1 = read(51) * Math.PI / 180, ccw = read(73); let t0 = ccw ? a0 : -a0, t1 = ccw ? a1 : -a1; if (ccw && t1 <= t0) t1 += Math.PI * 2; if (!ccw && t1 >= t0) t1 -= Math.PI * 2; loop.push(...ellipse(c, { x: r, y: 0 }, 1, t0, t1, !loop.length)); }
          else if (kind === 3) { const c = { x: read(10), y: read(20) }, major = { x: read(11), y: read(21) }, ratio = read(40); let t0 = read(50) * Math.PI / 180, t1 = read(51) * Math.PI / 180; read(73); if (t1 < t0) t1 += Math.PI * 2; loop.push(...ellipse(c, major, ratio, t0, t1, !loop.length)); }
          // Aresta spline: grau, nós, pontos de controle (com pesos se racional) e, no R2010+, pontos de ajuste.
          else if (kind === 4) {
            const degree = read(94), rational = read(73); read(74);
            const nk = read(95), nc = read(96), knots: number[] = [], control: Pt[] = [], weights: number[] = [], fit: Pt[] = [];
            for (let k = 0; k < nk; k++) knots.push(read(40));
            for (let k = 0; k < nc; k++) { control.push({ x: read(10), y: read(20) }); if (rational && p[j]?.[0] === 42) weights.push(Number(p[j++][1])); }
            if (p[j]?.[0] === 97) { const nf = Number(p[j++][1]); for (let k = 0; k < nf; k++) fit.push({ x: read(11), y: read(21) }); }
            loop.push(...bspline(control, knots, weights, degree, fit, false, !loop.length));
          }
        }
        if (loop.length) out.push(...loop, { type: 'Z' });
      }
    }
    return out;
  };
  const layerOf = (e: Entity) => layers.get(get(e, 8, '0'));
  const colorOf = (e: Entity, inherited: string) => {
    const tc = trueColor(get(e, 420, '') || undefined); if (tc) return tc;
    const aci = num(e, 62, 256);
    if (aci === 0) return inherited;
    if (aci === 256) { const layer = layerOf(e); if (get(e, 8, '0') === '0' && inherited) return inherited; return layer?.truecolor ?? aciColor(layer?.color ?? 7); }
    return aciColor(Math.abs(aci));
  };
  const weightOf = (e: Entity, inherited: number) => { const w = num(e, 370, -1); if (w >= 0) return w / 100; if (w === -2) return inherited; const lw = layerOf(e)?.lineweight; return lw !== undefined && lw >= 0 ? lw / 100 : 0.25; };
  const lineTypes = new Set<string>();
  const draw = (list: Entity[], m: M, inheritedColor: string, inheritedWeight: number, groupPath: number[], depth: number) => {
    if (depth > 16) { warnings.add('Blocos aninhados demais foram ignorados.'); return; }
    for (const e of list) {
      const layer = layerOf(e);
      if (layer?.off || num(e, 60) === 1) continue;
      const color = colorOf(e, inheritedColor), weight = weightOf(e, inheritedWeight), line = { stroke: color, fill: 'none', weight }, ltype = get(e, 6, '');
      if (ltype && !/^(BYLAYER|BYBLOCK|CONTINUOUS)$/i.test(ltype)) lineTypes.add(ltype);
      const elevation = num(e, 230, 1) < 0 ? -1 : 1; // extrusão (0,0,-1): figura espelhada no plano XY
      const em: M = elevation < 0 ? mul(m, [-1, 0, 0, 1, 0, 0]) : m;
      switch (e.type) {
        case 'LINE': emit([{ type: 'M', p: { x: num(e, 10), y: num(e, 20) } }, { type: 'L', p: { x: num(e, 11), y: num(e, 21) } }], m, line, groupPath); break;
        case 'LWPOLYLINE': {
          const pts: { p: Pt; bulge: number }[] = []; let current: { p: Pt; bulge: number } | null = null;
          for (const [c, v] of e.pairs) { if (c === 10) { current = { p: { x: Number(v), y: 0 }, bulge: 0 }; pts.push(current); } else if (c === 20 && current) current.p.y = Number(v); else if (c === 42 && current) current.bulge = Number(v); }
          emit(bulgePath(pts, (num(e, 70) & 1) === 1), em, line, groupPath); break;
        }
        case 'POLYLINE': {
          const flags = num(e, 70);
          if (flags & (16 | 64)) { warnings.add('Malhas 3D e faces poligonais foram ignoradas.'); break; }
          const pts = (e.vertices ?? []).filter(v => !(num(v, 70) & 16)).map(v => ({ p: { x: num(v, 10), y: num(v, 20) }, bulge: num(v, 42) }));
          emit(bulgePath(pts, (flags & 1) === 1), em, line, groupPath); break;
        }
        case 'CIRCLE': { const r = num(e, 40); emit([...ellipse({ x: num(e, 10), y: num(e, 20) }, { x: r, y: 0 }, 1, 0, Math.PI * 2, true), { type: 'Z' }], em, line, groupPath); break; }
        case 'ARC': { const r = num(e, 40), a0 = num(e, 50) * Math.PI / 180; let a1 = num(e, 51) * Math.PI / 180; if (a1 <= a0) a1 += Math.PI * 2; emit(ellipse({ x: num(e, 10), y: num(e, 20) }, { x: r, y: 0 }, 1, a0, a1, true), em, line, groupPath); break; }
        case 'ELLIPSE': { const t0 = num(e, 41, 0); let t1 = num(e, 42, Math.PI * 2); if (t1 <= t0) t1 += Math.PI * 2; const full = Math.abs(t1 - t0 - Math.PI * 2) < 1e-9; emit([...ellipse({ x: num(e, 10), y: num(e, 20) }, { x: num(e, 11), y: num(e, 21) }, num(e, 40, 1), t0, t1, true), ...(full ? [{ type: 'Z' } as Seg] : [])], em, line, groupPath); break; }
        case 'SPLINE': emit(spline(e), m, line, groupPath); break;
        case 'SOLID': case 'TRACE': {
          const c = [0, 1, 3, 2].map(k => ({ x: num(e, 10 + k), y: num(e, 20 + k) }));
          emit([{ type: 'M', p: c[0] }, { type: 'L', p: c[1] }, { type: 'L', p: c[2] }, { type: 'L', p: c[3] }, { type: 'Z' }], em, { stroke: 'none', fill: color, weight: 0 }, groupPath); break;
        }
        case 'HATCH': {
          if (num(e, 70) !== 1 && get(e, 2).toUpperCase() !== 'SOLID') { warnings.add('Hachuras com padrão foram importadas só como contorno.'); emit(hatchLoops(e), em, line, groupPath); break; }
          emit(hatchLoops(e), em, { stroke: 'none', fill: color, weight: 0 }, groupPath); break;
        }
        case 'TEXT': case 'ATTRIB': case 'MTEXT': {
          if (e.type === 'ATTRIB' && (num(e, 70) & 1)) break;
          const mtext = e.type === 'MTEXT', h = num(e, 40, 2.5);
          let text = mtext ? e.pairs.filter(([c]) => c === 3 || c === 1).map(([, v]) => v).join('') : get(e, 1);
          text = dxfText(text, mtext); if (!text.trim()) break;
          let at = { x: num(e, 10), y: num(e, 20) }, anchor: 'start' | 'middle' | 'end' = 'start', rotation: number;
          if (mtext) {
            const dx = num(e, 11, NaN), dy = num(e, 21, NaN); rotation = Number.isFinite(dx) && Number.isFinite(dy) && (dx || dy) ? Math.atan2(dy, dx) : num(e, 50) * (Math.abs(num(e, 50)) > 2 * Math.PI ? Math.PI / 180 : 1);
            const attach = num(e, 71, 1), col = (attach - 1) % 3, row = Math.floor((attach - 1) / 3), lines = text.split('\n').length, spacing = h * 5 / 3 * num(e, 44, 1);
            anchor = col === 1 ? 'middle' : col === 2 ? 'end' : 'start';
            // Âncora: topo da 1ª linha, meio ou base da última; a linha de base da 1ª linha fica uma altura abaixo do topo.
            const drop = row === 0 ? h : row === 1 ? h - (h + (lines - 1) * spacing) / 2 : -(lines - 1) * spacing;
            const dir = { x: Math.cos(rotation), y: Math.sin(rotation) }; at = { x: at.x + dir.y * drop, y: at.y - dir.x * drop };
            const p = apply(m, at); extend(p); const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
            items.push({ text, at: p, height: h * scale, angle: (rotation + Math.atan2(m[1], m[0])) * 180 / Math.PI, anchor, color, group: groupPath, lines, spacing: spacing * scale });
            break;
          }
          rotation = num(e, 50) * Math.PI / 180;
          const ha = num(e, 72), va = num(e, 73);
          if ((ha || va) && get(e, 11, '') !== '') at = { x: num(e, 11), y: num(e, 21) };
          anchor = ha === 1 || ha === 4 ? 'middle' : ha === 2 ? 'end' : 'start';
          // Alinhamento vertical (topo/meio): a linha de base desce perpendicularmente ao texto.
          const drop = va === 3 ? h : va === 2 || ha === 4 ? h / 2 : 0;
          at = { x: at.x + Math.sin(rotation) * drop, y: at.y - Math.cos(rotation) * drop };
          const p = apply(m, at); extend(p); const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
          items.push({ text: text.replace(/\n/g, ' '), at: p, height: h * scale, angle: (rotation + Math.atan2(m[1], m[0])) * 180 / Math.PI, anchor, color, group: groupPath, lines: 1, spacing: 0 });
          break;
        }
        case 'INSERT': case 'DIMENSION': {
          const b = blocks.get(get(e, 2)); if (!b) break;
          if (e.type === 'DIMENSION') { draw(b.entities, m, color, weight, [...groupPath, ++groupCounter], depth + 1); break; }
          const sx = num(e, 41, 1), sy = num(e, 42, 1), rot = num(e, 50) * Math.PI / 180, cols = Math.max(1, Math.min(100, num(e, 70, 1) || 1)), rows = Math.max(1, Math.min(100, num(e, 71, 1) || 1)), cs = num(e, 44), rs = num(e, 45);
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const local: M = mul([Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), num(e, 10), num(e, 20)], mul([1, 0, 0, 1, c * cs, r * rs], mul([sx, 0, 0, sy, 0, 0], [1, 0, 0, 1, -b.base.x, -b.base.y])));
            draw(b.entities, mul(em, local), color, weight, [...groupPath, ++groupCounter], depth + 1);
          }
          break;
        }
        case 'POINT': case 'VIEWPORT': case 'ATTDEF': case 'XLINE': case 'RAY': break;
        default: warnings.add(`Entidades ${e.type} não são suportadas e foram ignoradas.`);
      }
    }
  };
  draw(model, ID, '#000000', 0.25, [], 0);
  if (!items.length) throw new Error('O DXF não tem entidades desenháveis no espaço do modelo.');
  if (lineTypes.size) warnings.add('Tipos de linha tracejados foram importados como linhas contínuas.');
  // Escala real (unidade do desenho → px); desenhos maiores que 2,6 m são reduzidos para caber na página máxima.
  const pxPerUnit = mmPerUnit * 96 / 25.4, width = (box.maxX - box.minX) * pxPerUnit, height = (box.maxY - box.minY) * pxPerUnit, limit = 9000;
  const fit = Math.min(1, limit / Math.max(width, height, 1e-9)), s = pxPerUnit * fit;
  if (fit < 1) warnings.add(`Desenho reduzido para ${Math.round(fit * 10000) / 100}% para caber na página (escala real maior que o limite de 2,4 m).`);
  const X = (x: number) => +((x - box.minX) * s).toFixed(4), Y = (y: number) => +((box.maxY - y) * s).toFixed(4);
  const coord = (d: string) => d.replace(/([MLC])([^MLCZ]+)/g, (_, cmd: string, nums: string) => cmd + nums.trim().split(/\s+/).map(Number).map((v, k) => k % 2 ? Y(v) : X(v)).join(' '));
  const svgItem = (item: Item) => 'd' in item
    ? `<path d="${coord(item.d)}" fill="${item.fill}" stroke="${item.stroke}" stroke-width="${item.stroke === 'none' ? 0 : +(item.weight * 96 / 25.4).toFixed(4)}"/>`
    : item.text.split('\n').map((line, k) => { const a = item.angle * Math.PI / 180, x = X(item.at.x) + Math.sin(a) * k * item.spacing * s, y = Y(item.at.y) + Math.cos(a) * k * item.spacing * s; return `<text x="${x.toFixed(3)}" y="${y.toFixed(3)}" font-family="Arial" font-size="${(item.height * s / 0.72).toFixed(3)}" fill="${item.color}" text-anchor="${item.anchor}"${Math.abs(item.angle) > 1e-6 ? ` transform="rotate(${(-item.angle).toFixed(4)} ${x.toFixed(3)} ${y.toFixed(3)})"` : ''} xml:space="preserve">${escapeXml(line)}</text>`; }).join('');
  // Grupos aninhados conforme os blocos (INSERT).
  let body = '', open: number[] = [];
  for (const item of items) {
    let common = 0; while (common < open.length && common < item.group.length && open[common] === item.group[common]) common++;
    body += '</g>'.repeat(open.length - common) + item.group.slice(common).map(() => '<g>').join('');
    open = item.group; body += svgItem(item);
  }
  body += '</g>'.repeat(open.length);
  const W = Math.max(1, width * fit), H = Math.max(1, height * fit);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(3)}px" height="${H.toFixed(3)}px" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}">${body}</svg>`, warnings: [...warnings] };
}
/** Bytes do DXF em texto: UTF-8 (AutoCAD 2007+) ou Windows-1252 (versões antigas). */
export function decodeDxf(bytes: ArrayBuffer | Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}
