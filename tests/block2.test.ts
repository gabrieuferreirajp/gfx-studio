import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createObject, type VectorDocument, type VectorObject } from '../src/document/model.ts';
import { approximateMeasure, createParagraph, defaultTextStyle, lineLayout, textOverflows, toggleParagraph, updateText, wrapLines, createText } from '../src/text/textLayout.ts';
import { applyMatrix, translate } from '../src/geometry/objectTransforms.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { exportScene, toDxf, toEps, toPdf, toSvg } from '../src/io/exporters.ts';
import { code128Widths, createBarcode, ean13Widths, eanCheckDigit, qrMatrix } from '../src/text/barcode.ts';
import { createTable, findTexts, fitTextToPath, mergeDocument, parseCsv, replaceInDocument, splitTable, straightenText, textToTable, usedFields } from '../src/text/textTools.ts';
import { createPathObject } from '../src/geometry/pathGeometry.ts';
import { pageList } from '../src/document/pages.ts';

const m = approximateMeasure; // 0,55 × tamanho em px por caractere
const style = { ...defaultTextStyle, fontSize: 12 }; // 16 px → 8,8 px por caractere
const near = (a: number, b: number, t = 1e-6) => assert.ok(Math.abs(a - b) <= t, `${a} ≠ ${b}`);

test('texto de parágrafo: quebra no quadro, oculta o excesso e reorganiza ao redimensionar', () => {
  let p = updateText(createParagraph({ x: 10, y: 20, width: 100, height: 60 }, '#000000', style, m), { text: 'um dois tres quatro cinco seis sete oito' }, m);
  assert.equal(p.paragraph, true); assert.equal(p.width, 100); assert.equal(p.height, 60);
  const lines = wrapLines(p, m);
  assert.ok(lines.every(l => l.length * 8.8 <= 100.01), lines.join('|')); assert.equal(lines.join(' '), 'um dois tres quatro cinco seis sete oito');
  // 60 px de altura, linha de 19,2 px: cabem 3 linhas; o resto fica oculto e o quadro "transborda".
  assert.equal(lineLayout(p, m).length, 3); assert.ok(lines.length > 3); assert.equal(textOverflows(p, m), true);
  // Palavra maior que o quadro quebra por letra.
  assert.deepEqual(wrapLines({ ...p, text: 'abcdefghijklmnop' }, m), ['abcdefghijk', 'lmnop']);
  // Redimensionar (escala sem giro) muda o quadro, não a fonte.
  const [wide] = applyMatrix([p], [p.id], [2, 0, 0, 2, -10, -20]);
  assert.equal(wide.transform, undefined); assert.equal(wide.width, 200); assert.equal(wide.height, 120); assert.equal(wide.fontSize, 12); assert.equal(wide.x, 10);
  assert.equal(textOverflows(wide, m), false);
  // Girado: continua com a matriz.
  const [turned] = applyMatrix([p], [p.id], [0, 1, -1, 0, 0, 0]); assert.ok(turned.transform);
  // Ctrl+F8: artístico ↔ parágrafo.
  const art = toggleParagraph(p, m); assert.equal(art.paragraph, undefined); assert.equal(art.text, lines.join('\n'));
  p = toggleParagraph(art, m); assert.equal(p.paragraph, true); assert.equal(textOverflows(p, m), false);
  assert.deepEqual(parseProject(serializeProject({ ...createDocument(), objects: [p] })).objects[0], p);
});

test('texto em caminho: letras ao longo da curva, persistência, exportação e endireitar', () => {
  const line = createPathObject([{ x: 0, y: 100 }, { x: 200, y: 100 }], false, '#000000');
  let text = updateText(createText(0, 0, '#000000', style, m), { text: 'ABC' }, m);
  const objects = fitTextToPath([line, text], [line.id, text.id], m);
  text = objects[1];
  assert.ok(text.textPath); assert.equal(text.name, 'Texto em caminho');
  let glyphs = lineLayout(text, m);
  assert.deepEqual(glyphs.map(g => [g.line, Number(g.x.toFixed(6)), g.baseline, g.angle]), [['A', 0, 100, 0], ['B', 8.8, 100, 0], ['C', 17.6, 100, 0]]);
  // Caminho vertical: letras giradas 90°; centralizado com deslocamento e distância.
  const vertical = updateText({ ...text, textAlign: 'center', textPath: { commands: [{ type: 'M', x: 50, y: 0 }, { type: 'L', x: 50, y: 100 }], offset: 0, distance: 5 } }, {}, m);
  glyphs = lineLayout(vertical, m);
  near(glyphs[0].angle!, 90); near(glyphs[0].baseline, 50 - 13.2); near(glyphs[0].x, 55);
  // Lado oposto inverte o sentido.
  const flipped = lineLayout({ ...text, textPath: { ...text.textPath!, flip: true } }, m);
  near(Math.abs(flipped[0].angle!), 180); near(flipped[0].x, 200);
  assert.deepEqual(parseProject(serializeProject({ ...createDocument(), objects: [vertical] })).objects[0], vertical);
  const scene = exportScene({ ...createDocument(), objects: [vertical] }, 'page', []);
  assert.match(toSvg(scene, m), /rotate="90"/);
  assert.match(new TextDecoder('latin1').decode(toPdf(scene, new Map(), m)), /0 1 1 0 55 36\.8 Tm \(A\) Tj/);
  assert.match(toEps(scene, m), /90 rotate 1 -1 scale/);
  assert.match(toDxf(scene), /\nA\r?\n50\r?\n-90\r?\n/);
  const straight = straightenText(vertical, m); assert.equal(straight.textPath, undefined); assert.equal(straight.text, 'ABC');
  assert.throws(() => fitTextToPath([text], [text.id], m));
  // Caminho fechado: centralizado no ponto mais alto, lendo da esquerda para a direita (dá a volta no fim).
  const circle = { ...createObject('ellipse', 0, 0, 'none', '#000000'), width: 200, height: 200 };
  const round = fitTextToPath([circle, { ...text, textPath: undefined, name: 'Texto' }], [circle.id, text.id], m)[1];
  const placed = lineLayout(round, m), middle = placed[1];
  near(middle.x + middle.width / 2, 100, 0.5); near(middle.baseline, 0, 0.5); near(middle.angle!, 0, 2);
});

test('localizar e substituir em todas as páginas', () => {
  const a = { ...updateText(createText(0, 0, '#000000', style, m), { text: 'Preço: R$ 10' }, m) }, b = updateText(createText(0, 50, '#000000', style, m), { text: 'preço final' }, m);
  const other = updateText(createText(0, 0, '#000000', style, m), { text: 'sem preço aqui; Preço!' }, m);
  const doc: VectorDocument = { ...createDocument(), objects: [a, b], pages: [{ id: 'p1', name: 'Página 1', objects: [] }, { id: 'p2', name: 'Página 2', objects: [other] }], page: 0 };
  assert.equal(findTexts(doc.objects, 'preço', { matchCase: false, wholeWord: true }).length, 2);
  assert.equal(findTexts(doc.objects, 'preço', { matchCase: true, wholeWord: false }).length, 1);
  assert.equal(findTexts(doc.objects, 'Pre', { matchCase: false, wholeWord: true }).length, 0);
  const all = replaceInDocument(doc, 'preço', 'valor', { matchCase: false, wholeWord: true }, m);
  assert.equal(all.count, 4);
  const texts = pageList(all.document).flatMap(p => p.objects.map(o => o.text));
  assert.deepEqual(texts, ['valor: R$ 10', 'valor final', 'sem valor aqui; valor!']);
  assert.equal(all.document.objects[0].width, 'valor: R$ 10'.length * 8.8);
  const one = replaceInDocument(doc, 'preço', 'X', { matchCase: false, wholeWord: false }, m, [b.id]);
  assert.equal(one.count, 1); assert.equal(one.document.objects[0], a); assert.equal(one.document.objects[1].text, 'X final');
});

test('códigos de barras e QR', () => {
  // Code 128: cada símbolo tem 11 módulos (parada 13); números longos usam o subconjunto C.
  const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
  const widths = code128Widths(printable);
  // Os 10 dígitos seguidos viram 5 símbolos do subconjunto C (+2 trocas): 94 símbolos.
  assert.equal(widths.reduce((s, w) => s + w, 0), 11 * 94 + 13);
  for (let i = 0; i < widths.length - 7; i += 6) assert.equal(widths.slice(i, i + 6).reduce((s, w) => s + w, 0), 11, `símbolo ${i / 6}`);
  assert.equal(code128Widths('12345678').length, 6 * (1 + 4 + 1) + 7);
  assert.throws(() => code128Widths('Ação'));
  // EAN-13: 95 módulos, 30 barras, dígito verificador.
  assert.equal(eanCheckDigit('400638133393'), 1); assert.equal(eanCheckDigit('789123456789'), 5);
  const ean = ean13Widths('789123456789');
  assert.equal(ean.digits, '7891234567895'); assert.equal(ean.widths.reduce((s, w) => s + w, 0), 95); assert.equal(ean.widths.length, 59);
  assert.throws(() => ean13Widths('7891234567890'), /verificador/);
  // QR: versão mínima pelo tamanho, padrões de localização nos cantos.
  const qr = qrMatrix('https://exemplo.com.br', 'M');
  assert.equal(qr.length, 25);
  for (const [x, y] of [[0, 0], [18, 0], [0, 18]]) { assert.equal(qr[y][x], true); assert.equal(qr[y + 1][x + 1], false); assert.equal(qr[y + 3][x + 3], true); }
  assert.equal((qrMatrix('x'.repeat(1000), 'L').length - 17) % 4, 0);
  assert.throws(() => qrMatrix('x'.repeat(3000), 'H'));
  const objects = createBarcode({ kind: 'code128', text: 'ABC-123', module: 2, height: 50, showText: true }, 10, 10, m);
  assert.equal(objects.length, 2); assert.ok(objects.every(o => o.groupPath?.length === 1 && o.groupPath[0] === objects[0].groupPath![0]));
  assert.equal(objects[1].text, 'ABC-123');
  const big = createBarcode({ kind: 'qr', text: 'y'.repeat(2500), level: 'L', module: 1, height: 0 }, 0, 0, m);
  assert.ok(big.length > 1 && big.every(o => o.commands!.length <= 10000));
  parseProject(serializeProject({ ...createDocument(), objects: big }));
});

test('tabelas e conversão de texto em tabela', () => {
  const table = createTable({ x: 0, y: 0, width: 300, height: 90 }, 3, 4, m, [['a', 'b'], ['c']]);
  assert.equal(table.filter(o => o.type === 'rectangle').length, 12); assert.equal(table.filter(o => o.type === 'text').length, 3);
  assert.equal(new Set(table.map(o => o.groupPath![0])).size, 1);
  assert.deepEqual(table.filter(o => o.type === 'rectangle').slice(0, 2).map(o => [o.x, o.y, o.width, o.height]), [[0, 0, 75, 30], [75, 0, 75, 30]]);
  assert.deepEqual(splitTable('Nome;Qtd\nParafuso;10\n'), [['Nome', 'Qtd'], ['Parafuso', '10']]);
  assert.deepEqual(splitTable('a\tb,c'), [['a', 'b,c']]);
  const src = updateText(createText(5, 5, '#000000', style, m), { text: 'Item,Preço\nCabo,12' }, m);
  const cells = textToTable(src, m);
  assert.equal(cells.filter(o => o.type === 'rectangle').length, 4); assert.deepEqual(cells.filter(o => o.type === 'text').map(o => o.text), ['Item', 'Cabo', 'Preço', '12']);
  assert.ok(cells.every(o => o.type !== 'text' || !textOverflows(o, m)));
});

test('mesclagem de impressão: CSV e uma página por registro', () => {
  const csv = parseCsv('﻿Nome;Cidade\r\n"Silva; Ana";Goiânia\r\nJoão "Jô";Anápolis\r\n\r\n');
  assert.deepEqual(csv.fields, ['Nome', 'Cidade']); assert.deepEqual(csv.rows, [['Silva; Ana', 'Goiânia'], ['João "Jô"', 'Anápolis']]);
  assert.deepEqual(parseCsv('a,b\n"x, y","z ""q"""').rows, [['x, y', 'z "q"']]);
  assert.throws(() => parseCsv('a,a\n1,2'));
  const name = updateText(createText(0, 0, '#000000', style, m), { text: 'Olá «Nome» de «Cidade» «Outro»' }, m), box: VectorObject = { ...createObject('rectangle', 0, 0, '#ff0000'), groupPath: ['g'] };
  const doc: VectorDocument = { ...createDocument(), name: 'Crachá', objects: [box, { ...name, groupPath: ['g'] }] };
  assert.deepEqual(usedFields(doc), ['Nome', 'Cidade', 'Outro']);
  const merged = mergeDocument(doc, csv.fields, csv.rows, m);
  const pages = pageList(merged);
  assert.equal(pages.length, 2); assert.equal(merged.name, 'Crachá (mesclado)'); assert.notEqual(merged.id, doc.id);
  assert.equal(pages[1].objects[1].text, 'Olá João "Jô" de Anápolis «Outro»');
  assert.ok(pages[0].objects[0].id !== box.id && pages[0].objects[0].groupPath![0] === pages[0].objects[1].groupPath![0] && pages[0].objects[0].groupPath![0] !== pages[1].objects[0].groupPath![0]);
  assert.equal(doc.objects[1].text, name.text);
  parseProject(serializeProject(merged));
  assert.throws(() => mergeDocument(doc, csv.fields, [], m));
});
