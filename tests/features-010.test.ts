import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createObject, type VectorObject } from '../src/document/model.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { defaultGradient, gradientFraction, gradientMask, gradientPoints, hasTransparency, setTransparency } from '../src/document/transparency.ts';
import { exportScene, toPdf, toSvg, transparencyNote } from '../src/io/exporters.ts';
import { applyMatrix, around, rotation } from '../src/geometry/objectTransforms.ts';
import { approximateMeasure, letterSpacingPx, lineLayout, measureText, updateText } from '../src/text/textLayout.ts';

const rect = (x: number, y: number, w: number, h: number) => ({ ...createObject('rectangle', x, y, '#336699', '#000000'), width: w, height: h });
const doc = (objects: VectorObject[]) => ({ ...createDocument(), objects });
const text = (patch: Partial<VectorObject> = {}): VectorObject => updateText({ id: 't', type: 'text', name: 'Texto', x: 10, y: 10, width: 1, height: 1, fill: '#000000', text: 'ABCD\nEF', fontFamily: 'Arial', fontSize: 12, ...patch }, {}, approximateMeasure);

test('bloqueio e novos campos são gravados e validados', () => {
  const objects = [{ ...rect(0, 0, 10, 10), locked: true }, { ...text({ letterSpacing: 50, lineSpacing: 1.8 }) }, { ...rect(5, 5, 10, 10), transparencyGradient: defaultGradient('radial') }];
  const loaded = parseProject(serializeProject(doc(objects))).objects;
  assert.equal(loaded[0].locked, true); assert.equal(loaded[1].letterSpacing, 50); assert.equal(loaded[1].lineSpacing, 1.8);
  assert.deepEqual(loaded[2].transparencyGradient, defaultGradient('radial'));
  assert.throws(() => parseProject(JSON.stringify(doc([{ ...rect(0, 0, 1, 1), locked: 'sim' as never }]))), /Bloqueio/);
  assert.throws(() => parseProject(JSON.stringify(doc([{ ...rect(0, 0, 1, 1), transparencyGradient: { ...defaultGradient('linear'), type: 'cone' as never } }]))), /Degradê/);
});

test('degradê de transparência: exclusivo com a uniforme, acompanha o objeto e vira máscara', () => {
  const r = rect(0, 0, 100, 50);
  let [o] = setTransparency([{ ...r, opacity: 0.5 }], [r.id], { gradient: defaultGradient('linear') });
  assert.equal(o.opacity, undefined, 'degradê substitui a uniforme'); assert.ok(hasTransparency(o));
  assert.deepEqual(gradientPoints(o), { start: { x: 0, y: 25 }, end: { x: 100, y: 25 } });
  // Girar o objeto leva o degradê junto; a fração volta ao mesmo ponto.
  const turned = applyMatrix([o], [o.id], around({ x: 50, y: 25 }, rotation(90)))[0], points = gradientPoints(turned);
  assert.ok(Math.abs(points.start.x - 50) < 1e-9 && Math.abs(points.start.y + 25) < 1e-9);
  const back = gradientFraction(turned, points.end); assert.ok(Math.abs(back.x - 1) < 1e-9 && Math.abs(back.y - 0.5) < 1e-9);
  const m = gradientMask(o); assert.deepEqual(m.stops.map(s => s.opacity), [1, 0]); assert.ok(m.box.x < 0 && m.box.width > 100);
  [o] = setTransparency([o], [o.id], { opacity: 0.7 }); assert.equal(o.transparencyGradient, undefined, 'uniforme remove o degradê');
  [o] = setTransparency([{ ...o, transparencyGradient: defaultGradient('linear') }], [o.id], null); assert.ok(!hasTransparency(o));
});

test('exportação do degradê: SVG com máscara; PDF com média e aviso', () => {
  const o = { ...rect(0, 0, 100, 50), transparencyGradient: { ...defaultGradient('linear'), from: 20, to: 80 } };
  const scene = exportScene(doc([o]), 'page', []), svg = toSvg(scene);
  assert.match(svg, /<mask id="tmask-[^"]+" maskUnits="userSpaceOnUse"[^>]*style="mask-type:alpha"><linearGradient/);
  assert.match(svg, /stop-opacity="0\.8"\/><stop offset="1" stop-color="#fff" stop-opacity="0\.2"/);
  assert.match(svg, /mask="url\(#tmask-/);
  assert.match(new TextDecoder('latin1').decode(toPdf(scene)), /\/ca 0\.5 \/CA 0\.5/);
  assert.match(transparencyNote(scene, 'pdf'), /média/);
});

test('espaçamento entre caracteres e entre linhas (CorelDRAW)', () => {
  const plain = text(), spaced = text({ letterSpacing: 100 }), space = approximateMeasure(' ', '400 16px "Arial", sans-serif');
  assert.ok(space > 0 && letterSpacingPx(spaced, approximateMeasure) > 0);
  const [a, b] = [lineLayout(plain, approximateMeasure)[0], lineLayout(spaced, approximateMeasure)[0]];
  assert.ok(Math.abs(b.width - a.width - letterSpacingPx(spaced, approximateMeasure) * 4) < 1e-9, '100% = um espaço a mais por letra');
  assert.ok(spaced.width > plain.width, 'a caixa cresce');
  const tall = text({ lineSpacing: 2.4 }), lines = lineLayout(tall, approximateMeasure);
  assert.ok(Math.abs(lines[1].baseline - lines[0].baseline - 12 * 96 / 72 * 2.4) < 1e-9);
  assert.ok(measureText(tall, approximateMeasure).height > measureText(plain, approximateMeasure).height);
  assert.equal(updateText(spaced, { letterSpacing: 0 }, approximateMeasure).letterSpacing, undefined, '0% não grava nada');
  const svg = toSvg(exportScene(doc([spaced]), 'page', []));
  assert.match(svg, /letter-spacing="[\d.]+"/);
});

test('impressão: uma folha por página, no tamanho real e sem margens', async () => {
  const { printHtml } = await import('../src/io/print.ts');
  const { insertPage } = await import('../src/document/pages.ts');
  let d = { ...doc([rect(10, 10, 50, 50)]), name: 'Cartaz <A>' };
  d = { ...d, ...insertPage(d) };
  const html = printHtml(d);
  assert.match(html, /@page\{size:210\.000mm 297\.000mm;margin:0\}/);
  assert.equal(html.match(/class="page"/g)?.length, 2);
  assert.match(html, /<title>Cartaz &lt;A&gt;<\/title>/);
  assert.ok(!html.includes('<?xml'));
});
