import type { VectorDocument, VectorObject } from '../document/model.ts';
import { remapLinks } from '../geometry/links.ts';
import { worldCommands } from '../geometry/worldGeometry.ts';
import { polylineOf, topDistance } from './textPath.ts';
import { PT, createParagraph, defaultTextStyle, fontPx, layoutLines, measureText, styleOf, updateText, type Measure, type TextStyle } from './textLayout.ts';
import { pageList } from '../document/pages.ts';

/* ---------- Texto em caminho ---------- */
/** Seleção válida para Texto › Ajustar texto ao caminho: um texto e uma curva/retângulo/elipse. */
export function fitTextError(objects: VectorObject[], ids: string[]): string | null {
  const selected = objects.filter(o => ids.includes(o.id));
  const texts = selected.filter(o => o.type === 'text'), shapes = selected.filter(o => o.type === 'path' || o.type === 'rectangle' || o.type === 'ellipse');
  if (texts.length !== 1 || shapes.length !== 1 || selected.length !== 2) return 'Selecione um texto e uma curva, retângulo ou elipse (Shift+clique).';
  return null;
}
/**
 * Ajustar texto ao caminho (CorelDRAW): o texto passa a seguir o caminho e fica ligado a ele (mover ou editar a curva
 * leva o texto junto; apagar a curva deixa o texto com a última forma). A rotação do texto é descartada, como no CorelDRAW.
 */
export function fitTextToPath(objects: VectorObject[], ids: string[], measure: Measure): VectorObject[] {
  const error = fitTextError(objects, ids); if (error) throw new Error(error);
  const text = objects.find(o => ids.includes(o.id) && o.type === 'text')!, shape = objects.find(o => ids.includes(o.id) && o.type !== 'text')!;
  const styled = text.fontSize === undefined ? updateText(text, {}, measure) : text;
  const { transform: _t, paragraph: _p, ...rest } = styled;
  const content = (styled.paragraph ? layoutLines(styled, measure) : [styled.text ?? '']).join(' ').replace(/\s*\n\s*/g, ' ');
  const commands = worldCommands(shape), path = polylineOf(commands);
  // Caminho fechado: texto centralizado no ponto mais alto, como no CorelDRAW; aberto: começa no início.
  let offset = 0;
  if (path.closed) {
    const width = measureText({ ...rest, text: content }, measure).width, start = topDistance(path) - width / 2, align = rest.textAlign ?? 'left';
    offset = align === 'center' ? start - (path.total - width) / 2 : align === 'right' ? path.total - width - start : start;
  }
  const fitted = updateText({ ...rest, text: content, name: 'Texto em caminho', textPath: { commands, offset, source: shape.id } }, {}, measure);
  return objects.map(o => o.id === text.id ? fitted : o);
}
/** Ferramenta Texto clicada sobre uma curva (CorelDRAW): texto vazio ligado à curva, começando no ponto clicado. */
export function createPathText(shape: VectorObject, s: number, fill: string, style: TextStyle, measure: Measure): VectorObject {
  const { textAlign: _a, ...rest } = style;
  return updateText({ id: crypto.randomUUID(), type: 'text', name: 'Texto em caminho', x: 0, y: 0, width: 1, height: 1, fill, text: '', ...rest, textPath: { commands: worldCommands(shape), offset: s, source: shape.id } }, {}, measure);
}
/** Separar texto do caminho (Ctrl+K no CorelDRAW): o texto mantém a forma, mas deixa de acompanhar a curva. */
export function detachPathText(o: VectorObject): VectorObject {
  if (o.type !== 'text' || !o.textPath?.source) return o;
  const { source: _s, ...tp } = o.textPath;
  return { ...o, textPath: tp };
}
/** Texto › Endireitar texto: volta a ser texto artístico, no canto da caixa que ocupava. */
export function straightenText(o: VectorObject, measure: Measure): VectorObject {
  if (o.type !== 'text' || !o.textPath) return o;
  const { textPath: _tp, ...rest } = o;
  return updateText({ ...rest, name: rest.name === 'Texto em caminho' ? 'Texto' : rest.name, x: o.x, y: o.y }, {}, measure);
}

/* ---------- Localizar e substituir ---------- */
export interface FindOptions { matchCase: boolean; wholeWord: boolean }
function pattern(find: string, options: FindOptions) {
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(options.wholeWord ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped, `gu${options.matchCase ? '' : 'i'}`);
}
/** Textos da página que contêm a busca, na ordem do desenho. */
export function findTexts(objects: VectorObject[], find: string, options: FindOptions): VectorObject[] {
  if (!find) return [];
  const re = pattern(find, options);
  return objects.filter(o => o.type === 'text' && (re.lastIndex = 0, re.test(o.text ?? '')));
}
/** Substitui em todos os textos de todas as páginas (ou só nos IDs indicados, na página ativa). */
export function replaceInDocument(document: VectorDocument, find: string, replacement: string, options: FindOptions, measure: Measure, only?: string[]): { document: VectorDocument; count: number } {
  if (!find) return { document, count: 0 };
  const re = pattern(find, options); let count = 0;
  const replaceAll = (objects: VectorObject[]) => {
    let changed = false;
    const next = objects.map(o => {
      if (o.type !== 'text' || (only && !only.includes(o.id))) return o;
      const text = o.text ?? '', matches = text.match(re)?.length ?? 0;
      if (!matches) return o;
      count += matches; changed = true;
      return updateText(o, { text: text.replace(re, () => replacement).slice(0, 100000) }, measure);
    });
    return changed ? next : objects;
  };
  if (only || !document.pages) { const objects = replaceAll(document.objects); return { document: objects === document.objects ? document : { ...document, objects }, count }; }
  const active = document.page ?? 0;
  const pages = pageList(document).map(p => ({ ...p, objects: replaceAll(p.objects) }));
  return { document: { ...document, objects: pages[active].objects, pages: pages.map((p, i) => i === active ? { ...p, objects: [] } : p) }, count };
}

/* ---------- Tabelas ---------- */
export interface TableBox { x: number; y: number; width: number; height: number }
/**
 * Tabela (CorelDRAW: Tabela › Criar nova tabela): células como retângulos agrupados; com dados, cada célula
 * recebe um texto de parágrafo com margem interna de 4 px.
 */
export function createTable(box: TableBox, rows: number, columns: number, measure: Measure, data?: string[][], style: TextStyle = { ...defaultTextStyle, fontSize: 10 }, stroke = '#000000'): VectorObject[] {
  rows = Math.max(1, Math.min(100, Math.round(rows))); columns = Math.max(1, Math.min(50, Math.round(columns)));
  const group = crypto.randomUUID(), w = box.width / columns, h = box.height / rows, pad = Math.min(4, w / 4, h / 4), out: VectorObject[] = [];
  // A fonte é reduzida para caber na altura da linha (o texto de parágrafo oculta o que não cabe).
  const fitting = Math.max(1, Math.floor((h - pad * 2) / 1.2 / PT * 2) / 2), cellStyle = { ...style, fontSize: Math.min(style.fontSize, fitting) };
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    out.push({ id: crypto.randomUUID(), type: 'rectangle', name: `Célula ${r + 1},${c + 1}`, x: box.x + c * w, y: box.y + r * h, width: Math.max(1, w), height: Math.max(1, h), fill: 'none', stroke, strokeWidth: 1, groupPath: [group] });
    const value = data?.[r]?.[c];
    if (value) out.push({ ...updateText(createParagraph({ x: box.x + c * w + pad, y: box.y + r * h + pad, width: w - pad * 2, height: h - pad * 2 }, '#000000', cellStyle, measure), { text: value }, measure), name: `Texto ${r + 1},${c + 1}`, groupPath: [group] });
  }
  return out;
}
/** Separa linhas em colunas por tabulação, ponto e vírgula ou vírgula (o primeiro que aparecer). */
export function splitTable(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim());
  const sep = lines.some(l => l.includes('\t')) ? '\t' : lines.some(l => l.includes(';')) ? ';' : ',';
  return lines.map(l => l.split(sep).map(c => c.trim()));
}
/** Tabela › Converter texto em tabela: o texto selecionado vira uma tabela com uma linha por linha do texto. */
export function textToTable(o: VectorObject, measure: Measure): VectorObject[] {
  const data = splitTable(o.text ?? ''); if (!data.length) throw new Error('O texto está vazio.');
  const style = { ...styleOf(o), textAlign: 'left' as const }, columns = Math.max(...data.map(r => r.length));
  const px = fontPx({ ...o, fontSize: style.fontSize }), probe = (t: string) => updateText({ ...o, paragraph: undefined, textPath: undefined, transform: undefined }, { ...style, text: t }, measure).width;
  const widths = Array.from({ length: columns }, (_, c) => Math.max(px * 2, ...data.map(r => probe(r[c] ?? '') + 12)));
  const rowHeight = px * 1.2 + 10;
  // Colunas com larguras próprias: monta coluna a coluna e junta no mesmo grupo.
  const group = crypto.randomUUID(); let x = o.x;
  return widths.flatMap((w, c) => { const column = createTable({ x, y: o.y, width: w, height: rowHeight * data.length }, data.length, 1, measure, data.map(r => [r[c] ?? '']), style); x += w; return column.map(cell => ({ ...cell, name: cell.name.replace(/,1$/, `,${c + 1}`), groupPath: [group] })); });
}

/* ---------- Mesclagem de impressão ---------- */
/** Lê CSV (vírgula ou ponto e vírgula, aspas duplas, BOM do Excel). A primeira linha são os nomes dos campos. */
export function parseCsv(text: string): { fields: string[]; rows: string[][] } {
  const source = text.replace(/^﻿/, ''), firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const records: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) { if (ch === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; continue; }
    if (ch === '"' && !cell) quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && source[i + 1] === '\n') i++; row.push(cell); records.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); records.push(row); }
  const nonEmpty = records.filter(r => r.some(c => c.trim()));
  if (!nonEmpty.length) throw new Error('O arquivo CSV está vazio.');
  const fields = nonEmpty[0].map((f, i) => f.trim() || `Campo ${i + 1}`);
  if (new Set(fields).size !== fields.length) throw new Error('O CSV tem nomes de campo repetidos na primeira linha.');
  return { fields, rows: nonEmpty.slice(1).map(r => fields.map((_, i) => r[i] ?? '')) };
}
export const fieldToken = (field: string) => `«${field}»`;
/** Campos usados nos textos do documento («Campo»). */
export function usedFields(document: VectorDocument): string[] {
  const found = new Set<string>();
  for (const page of pageList(document)) for (const o of page.objects) if (o.type === 'text') for (const m of (o.text ?? '').matchAll(/«([^«»\n]{1,100})»/g)) found.add(m[1]);
  return [...found];
}
/**
 * Mesclagem de impressão (CorelDRAW): um documento novo com uma cópia de cada página por registro, trocando
 * «Campo» pelo valor do registro. O documento original não é alterado.
 */
export function mergeDocument(document: VectorDocument, fields: string[], rows: string[][], measure: Measure, uuid = () => crypto.randomUUID()): VectorDocument {
  const source = pageList(document);
  if (!rows.length) throw new Error('O CSV não tem registros (só a linha de títulos).');
  if (rows.length * source.length > 2000) throw new Error('A mesclagem geraria mais de 2.000 páginas; divida o arquivo CSV.');
  const pages = rows.flatMap((row, r) => source.map(page => {
    const ids = new Map<string, string>(), map = (id: string) => { if (!ids.has(id)) ids.set(id, uuid()); return ids.get(id)!; };
    const objects = page.objects.map(o => {
      const copy: VectorObject = { ...o, id: map(o.id), ...(o.groupPath ? { groupPath: o.groupPath.map(map) } : {}), ...(o.clipParent ? { clipParent: map(o.clipParent) } : {}), ...(o.symbol ? { symbol: { ...o.symbol, instance: map(o.symbol.instance) } } : {}) };
      Object.assign(copy, remapLinks(copy, map));
      if (o.type !== 'text' || !(o.text ?? '').includes('«')) return copy;
      const text = (o.text ?? '').replace(/«([^«»\n]{1,100})»/g, (whole, name: string) => { const i = fields.indexOf(name); return i < 0 ? whole : row[i]; });
      return updateText(copy, { text: text.slice(0, 100000) }, measure);
    });
    return { id: uuid(), name: source.length > 1 ? `${page.name} — registro ${r + 1}` : `Registro ${r + 1}`, objects };
  }));
  const base = { ...document, id: uuid(), name: `${document.name} (mesclado)` };
  return pages.length === 1 ? { ...base, objects: pages[0].objects, pages: undefined, page: undefined } : { ...base, objects: pages[0].objects, pages: pages.map((p, i) => i === 0 ? { ...p, objects: [] } : p), page: 0 };
}
