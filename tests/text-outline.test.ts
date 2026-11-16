import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createObject } from '../src/document/model.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { approximateMeasure, createText, defaultTextStyle, lineLayout, styleOf, updateText } from '../src/text/textLayout.ts';
import { performOutline } from '../src/geometry/outlineGeometry.ts';
import { outlineSelectionError } from '../src/geometry/outlineSelection.ts';
import { boundsOf } from '../src/geometry/objectTransforms.ts';
import { exportScene, standardFont, toDxf, toEps, toPdf, toSvg } from '../src/io/exporters.ts';
const measure = approximateMeasure;

test('texto com fonte real: tamanho em pt, caixa medida, estilos e várias linhas persistem', () => {
  const text = updateText(createText(100, 100, '#000000', defaultTextStyle, measure), { text: 'Olá\nmundo!!', fontFamily: 'Times New Roman', bold: true, italic: true, underline: true }, measure);
  assert.equal(text.fontSize, 24); assert.equal(text.bold, true); assert.equal(text.textAlign, undefined);
  assert.ok(Math.abs(text.height - 2 * 24 * 96 / 72 * 1.2) < 1e-9);
  assert.equal(lineLayout(text, measure).length, 2);
  const bigger = updateText(text, { fontSize: 48 }, measure);
  assert.ok(Math.abs(bigger.width - 2 * text.width) < 1e-9);
  const document = { ...createDocument(), objects: [bigger] };
  assert.deepEqual(parseProject(serializeProject(document)), document);
  for (const patch of [{ fontFamily: '<script>' }, { fontSize: 0 }, { bold: 'sim' }, { textAlign: 'justify' }]) assert.throws(() => parseProject(JSON.stringify({ ...document, objects: [{ ...bigger, ...patch }] })), JSON.stringify(patch));
});
test('alinhamento mantém a âncora ao editar e texto antigo é convertido sem perder posição', () => {
  const base = updateText(createText(0, 50, '#000000', defaultTextStyle, measure), { text: 'abc', textAlign: 'center' }, measure);
  const center = base.x + base.width / 2, longer = updateText(base, { text: 'abcdefgh' }, measure);
  assert.ok(Math.abs(longer.x + longer.width / 2 - center) < 1e-9);
  const right = updateText(base, { textAlign: 'right' }, measure), right2 = updateText(right, { text: 'a' }, measure);
  assert.ok(Math.abs(right.x + right.width - (right2.x + right2.width)) < 1e-9);
  const legacy = { ...createObject('text', 10, 20, '#000000'), text: 'Antigo' };
  const converted = updateText(legacy, {}, measure);
  assert.equal(converted.x, 10); assert.equal(converted.fontSize, styleOf(legacy).fontSize); assert.ok(converted.fontSize! > 0);
});
test('converter contorno em objeto gera área do traço e mantém o preenchimento original', () => {
  const rect = { ...createObject('rectangle', 0, 0, '#ffcc00', '#112233'), width: 100, height: 50, strokeWidth: 10 };
  const result = performOutline([rect], [rect.id]);
  assert.equal(result.objects.length, 2);
  const [fill, outline] = result.objects;
  assert.equal(fill.stroke, 'none'); assert.equal(fill.fill, '#ffcc00');
  assert.equal(outline.fill, '#112233'); assert.equal(outline.stroke, 'none'); assert.equal(result.resultId, outline.id);
  const b = boundsOf([outline]);
  assert.ok(Math.abs(b.x + 5) < 0.5 && Math.abs(b.y + 5) < 0.5 && Math.abs(b.width - 110) < 0.5 && Math.abs(b.height - 60) < 0.5, JSON.stringify(b));
  assert.ok(outline.commands!.filter(c => c.type === 'M').length >= 2, 'traço fechado tem contorno externo e interno');
  const line = { ...createObject('rectangle', 0, 0, 'none', '#000000'), width: 40, height: 40, strokeWidth: 4 };
  const replaced = performOutline([line], [line.id]);
  assert.equal(replaced.objects.length, 1); assert.notEqual(replaced.objects[0].id, line.id);
  assert.match(outlineSelectionError([{ ...line, stroke: 'none' }], [line.id])!, /contorno/);
  assert.throws(() => performOutline([{ ...line, stroke: 'none' }], [line.id]));
});
test('exportação usa a fonte, o estilo e as linhas do texto', () => {
  const text = updateText(createText(10, 40, '#ff0000', defaultTextStyle, measure), { text: 'Ação\nSegunda', fontFamily: 'Georgia', bold: true }, measure);
  const scene = exportScene({ ...createDocument(), objects: [text] }, 'page', []);
  assert.equal(standardFont(text), 'Times-Bold'); assert.equal(standardFont({ ...text, fontFamily: 'Consolas', bold: false, italic: true }), 'Courier-Oblique');
  const svg = toSvg(scene, measure); assert.match(svg, /font-family="Georgia, sans-serif"/); assert.equal((svg.match(/<tspan/g) ?? []).length, 2);
  const pdf = new TextDecoder('latin1').decode(toPdf(scene, new Map(), measure));
  assert.match(pdf, /\/BaseFont \/Times-Bold/); assert.match(pdf, /\(A\\347\\343o\) Tj/); assert.match(pdf, /\(Segunda\) Tj/);
  assert.match(toEps(scene, measure), /\/Times-Bold-ISOLatin1 findfont/);
  assert.equal((toDxf(scene).match(/\r\nTEXT\r\n/g) ?? []).length, 2);
});
