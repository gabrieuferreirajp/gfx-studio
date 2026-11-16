import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createObject, type VectorObject } from '../src/document/model.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { blendChannel, opacityFromTransparency, setTransparency, transparencyOf } from '../src/document/transparency.ts';
import { exportScene, toPdf, toSvg, transparencyNote } from '../src/io/exporters.ts';
import { applyMatrix, around, boundsOf, corelAngle, mirror, rotation } from '../src/geometry/objectTransforms.ts';
import { constrain, dimensionObjects, formatMeasure, nearestSnap, offsetFrom, snapPoints } from '../src/geometry/dimension.ts';
import { approximateMeasure } from '../src/text/textLayout.ts';
import { fromUnit } from '../src/document/units.ts';

const rect = (x: number, y: number, w: number, h: number, fill = '#336699') => ({ ...createObject('rectangle', x, y, fill, '#000000'), width: w, height: h });
const doc = (objects: VectorObject[]) => ({ ...createDocument(), objects });

test('transparência: % do CorelDRAW, mesclagem, remoção e persistência', () => {
  const a = rect(0, 0, 10, 10), b = rect(5, 5, 10, 10);
  let objects = setTransparency([a, b], [a.id], { opacity: opacityFromTransparency(35) });
  assert.equal(transparencyOf(objects[0]), 35); assert.equal(objects[1].opacity, undefined);
  objects = setTransparency(objects, [a.id], { blendMode: 'subtract' });
  assert.equal(objects[0].blendMode, 'subtract'); assert.equal(transparencyOf(objects[0]), 35, 'mudar o modo mantém a %');
  const loaded = parseProject(serializeProject(doc(objects)));
  assert.equal(loaded.objects[0].opacity, objects[0].opacity); assert.equal(loaded.objects[0].blendMode, 'subtract');
  assert.throws(() => parseProject(JSON.stringify(doc([{ ...a, blendMode: 'xpto' as never }]))), /mesclagem/);
  assert.throws(() => parseProject(JSON.stringify(doc([{ ...a, opacity: 1.5 }]))));
  const cleared = setTransparency(objects, [a.id], null)[0];
  assert.equal(cleared.opacity, undefined); assert.equal(cleared.blendMode, undefined);
  assert.equal(setTransparency([a], [a.id], { opacity: 1, blendMode: 'normal' })[0].opacity, undefined, '0% e Normal não gravam nada');
});

test('modos de mesclagem seguem as fórmulas do CorelDRAW', () => {
  assert.equal(blendChannel('add', 0.5, 0.7), 1);
  assert.ok(Math.abs(blendChannel('subtract', 0.6, 0.7)! - 0.3) < 1e-12, 'Subtrair: fundo + cor − 255');
  assert.ok(Math.abs(blendChannel('subtract', 1, 0.4)! - 0.4) < 1e-12, 'branco é neutro no Subtrair');
  assert.equal(blendChannel('difference', 0.2, 0.9), 0.7);
  assert.equal(blendChannel('multiply', 0.5, 0.5), 0.25);
  assert.equal(blendChannel('lighten', 0.2, 0.9), 0.9); assert.equal(blendChannel('darken', 0.2, 0.9), 0.2);
});

test('exportação: SVG com opacidade, mix-blend e Subtrair; PDF com ExtGState; avisos', () => {
  const base = rect(0, 0, 100, 100), multiply = { ...rect(20, 20, 50, 50, '#ff0000'), opacity: 0.5, blendMode: 'multiply' as const }, sub = { ...rect(40, 40, 50, 50, '#ccaa88'), blendMode: 'subtract' as const };
  const scene = exportScene(doc([base, multiply, sub]), 'page', []);
  const svg = toSvg(scene);
  assert.match(svg, /opacity="0\.5" style="mix-blend-mode:multiply"/);
  assert.match(svg, /<filter id="vs-invert"/); assert.match(svg, /style="mix-blend-mode:plus-lighter"/);
  assert.ok(svg.indexOf('filter="url(#vs-invert)"') < svg.indexOf('#336699'), 'o fundo fica dentro do grupo invertido');
  const pdf = new TextDecoder('latin1').decode(toPdf(scene));
  assert.match(pdf, /\/ExtGState << \/GS1 << \/Type \/ExtGState \/ca 0\.5 \/CA 0\.5 \/BM \/Multiply >>/);
  assert.match(pdf, /\/GS1 gs/);
  assert.match(transparencyNote(scene, 'pdf'), /Subexposição linear \(Adicionar\), Superexposição linear e Subtrair/);
  assert.match(transparencyNote(scene, 'eps'), /opacos/);
  assert.equal(transparencyNote(exportScene(doc([base]), 'page', []), 'pdf'), '');
  assert.match(toSvg(scene, undefined, '#ffffff'), /fill="#ffffff"/);
});

test('ângulo de rotação no padrão CorelDRAW (anti-horário) e espelhar', () => {
  const o = rect(0, 0, 100, 50), center = { x: 50, y: 25 };
  const turn = (deg: number) => applyMatrix([o], [o.id], around(center, rotation(deg)))[0];
  assert.equal(corelAngle(o), 0);
  assert.ok(Math.abs(corelAngle(turn(-30)) - 30) < 1e-9, 'girar para cima/esquerda na tela = +30°');
  assert.ok(Math.abs(corelAngle(turn(30)) - 330) < 1e-9);
  const flippedH = applyMatrix([o], [o.id], mirror(center, true))[0], flippedV = applyMatrix([o], [o.id], mirror(center, false))[0];
  assert.equal(corelAngle(flippedH), 0); assert.equal(corelAngle(flippedV), 0);
  assert.deepEqual(boundsOf([flippedH]), boundsOf([o]), 'espelha no lugar');
  assert.equal(flippedH.transform![0], -1); assert.equal(flippedV.transform![3], -1);
  assert.ok(Math.abs(corelAngle(applyMatrix([flippedH], [o.id], around(center, rotation(-45)))[0]) - 45) < 1e-9, 'girar um objeto espelhado');
});

test('dimensão paralela: medida na unidade do documento, cota agrupada e encaixe', () => {
  const a = { x: 10, y: 10 }, b = { x: 10 + fromUnit(100, 'mm'), y: 10 };
  const objects = dimensionObjects(a, b, -20, 'mm', approximateMeasure);
  const text = objects.find(o => o.type === 'text')!;
  assert.equal(text.text, '100,00 mm'); assert.equal(formatMeasure(fromUnit(12.5, 'cm'), 'cm'), '12,50 cm');
  assert.equal(new Set(objects.map(o => o.groupPath?.[0])).size, 1, 'tudo em um grupo');
  assert.ok(objects.filter(o => o.name === 'Seta').length === 2 && objects.some(o => o.name === 'Linha de cota') && objects.filter(o => o.name === 'Linha de extensão').length === 2);
  assert.ok(text.y + text.height < 10 - 20 + 1e-9, 'texto acima da linha de cota');
  assert.ok(offsetFrom(a, b, { x: 50, y: 40 }) > 0 && offsetFrom(a, b, { x: 50, y: -40 }) < 0);
  const c = constrain({ x: 0, y: 0 }, { x: 100, y: 8 }); assert.ok(Math.abs(c.y) < 1e-9, 'Ctrl: 15°');
  const vertical = dimensionObjects({ x: 0, y: 0 }, { x: 0, y: 100 }, 10, 'px', approximateMeasure).find(o => o.type === 'text')!;
  assert.ok(vertical.transform && Math.abs(Math.abs(Math.atan2(vertical.transform[1], vertical.transform[0]) * 180 / Math.PI) - 90) < 1e-9, 'texto acompanha a cota');
  assert.ok(parseProject(serializeProject(doc(objects))).objects.length === objects.length, 'cota é um desenho válido');
  const points = snapPoints([rect(0, 0, 100, 50)]);
  assert.deepEqual(nearestSnap(points, { x: 97, y: 3 }, 8), { x: 100, y: 0 });
  assert.equal(nearestSnap(points, { x: 70, y: 20 }, 8), null);
});
