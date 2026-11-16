import { test } from 'node:test';
import assert from 'node:assert/strict';
import paper from 'paper';
import { performBoolean, worldCommands } from '../src/geometry/booleanGeometry.ts';
import { performCut } from '../src/geometry/cutGeometry.ts';
import { createDocument, createObject, documentReducer, type VectorObject } from '../src/document/model.ts';
import { commandsToSvg, createPathObject } from '../src/geometry/pathGeometry.ts';
import { boundsOf, distributeObjects, translate } from '../src/geometry/objectTransforms.ts';
import { transformationMatrix, type TransformParams } from '../src/geometry/transformations.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { addLayer, deleteLayer, isBlocked, isPrintable, moveLayer, moveToLayer, updateLayer } from '../src/document/layers.ts';
import { exportScene } from '../src/io/exporters.ts';
import { addGuide, snapBounds, snapPoint } from '../src/geometry/guides.ts';
import { splitContours } from '../src/geometry/compoundPaths.ts';

const rect = (x: number, y: number, w: number, h: number, fill = '#3366cc'): VectorObject => ({ ...createObject('rectangle', x, y, fill, '#000000'), width: w, height: h });
function area(o: VectorObject) {
  const s = new paper.PaperScope(); s.setup(new s.Size(1, 1));
  const p = new s.CompoundPath({ pathData: commandsToSvg(worldCommands(o)), insert: false });
  const value = Math.abs(p.area), length = p.length; s.project.remove(); return { area: value, length };
}
const near = (a: number, b: number, t = 1e-3) => assert.ok(Math.abs(a - b) <= t, `${a} ≠ ${b}`);

test('modelagem: frente menos trás, trás menos frente, simplificar e criar limite', () => {
  const back = rect(0, 0, 100, 100, '#ff0000'), front = rect(50, 0, 100, 100, '#00ff00');
  const fmb = performBoolean([back, front], [back.id, front.id], 'frontMinusBack');
  assert.equal(fmb.objects.length, 1); near(area(fmb.objects[0]).area, 5000); assert.equal(fmb.objects[0].fill, '#00ff00');
  const bmf = performBoolean([back, front], [back.id, front.id], 'backMinusFront');
  assert.equal(bmf.objects.length, 1); near(area(bmf.objects[0]).area, 5000); assert.equal(bmf.objects[0].fill, '#ff0000');
  const simple = performBoolean([back, front], [back.id, front.id], 'simplify');
  assert.equal(simple.objects.length, 2); assert.equal(simple.resultIds?.length, 2);
  near(area(simple.objects[0]).area, 5000); near(area(simple.objects[1]).area, 10000); assert.equal(simple.objects[1].fill, '#00ff00');
  const limit = performBoolean([back, front], [back.id, front.id], 'boundary');
  assert.equal(limit.objects.length, 3); assert.equal(limit.objects[0], back); assert.equal(limit.objects[1], front);
  assert.equal(limit.objects[2].fill, 'none'); assert.equal(limit.objects[2].stroke, '#000000'); near(area(limit.objects[2]).area, 15000);
});

test('distribuir mantém as pontas e iguala centros e espaçamentos', () => {
  const a = rect(0, 0, 10, 10), b = rect(15, 0, 30, 10), c = rect(100, 0, 20, 10);
  const centers = distributeObjects([a, b, c], [a.id, b.id, c.id], 'distCenterX').map(o => { const k = boundsOf([o]); return k.x + k.width / 2; });
  near(centers[0], 5); near(centers[2], 110); near(centers[1], 57.5);
  const spaced = distributeObjects([a, b, c], [a.id, b.id, c.id], 'distSpaceX').map(o => boundsOf([o]));
  near(spaced[1].x - (spaced[0].x + spaced[0].width), spaced[2].x - (spaced[1].x + spaced[1].width)); near(spaced[0].x, 0); near(spaced[2].x, 100);
  const pair = [a, b]; assert.equal(distributeObjects(pair, [a.id, b.id], 'distLeft'), pair, 'dois objetos não se distribuem');
});

test('janela Transformações: posição, girar, escala, tamanho e inclinar em torno da referência', () => {
  const b = { x: 10, y: 20, width: 100, height: 50 };
  const base: TransformParams = { tab: 'position', x: 5, y: -5, relative: true, angle: 90, sx: 200, sy: 50, width: 50, height: 100, skewX: 45, skewY: 0, anchor: 4 };
  assert.deepEqual(transformationMatrix(base, b), translate(5, -5));
  assert.deepEqual(transformationMatrix({ ...base, relative: false, x: 0, y: 0, anchor: 0 }, b), translate(-10, -20));
  const r = transformationMatrix({ ...base, tab: 'rotate' }, b)!; // 90° anti-horário em torno do centro (60, 45)
  near(r[0] * 110 + r[2] * 45 + r[4], 60); near(r[1] * 110 + r[3] * 45 + r[5], -5);
  const s = transformationMatrix({ ...base, tab: 'scale', anchor: 0 }, b)!; assert.deepEqual([s[0], s[3], s[0] * 10 + s[4], s[3] * 20 + s[5]], [2, 0.5, 10, 20]);
  const z = transformationMatrix({ ...base, tab: 'size' }, b)!; near(z[0], 0.5); near(z[3], 2);
  const k = transformationMatrix({ ...base, tab: 'skew' }, b)!; near(k[2], -1);
  assert.equal(transformationMatrix({ ...base, tab: 'size', width: 0 }, b), null);
});

test('camadas: novos objetos na ativa, ordem por camada, ocultar/travar/imprimir e persistência', () => {
  let doc = { ...createDocument(), objects: [rect(0, 0, 10, 10)] };
  const second = addLayer(doc, 'c2'); doc = documentReducer(doc, { type: 'set-layers', ...second });
  assert.equal(doc.layers!.length, 2); assert.equal(doc.activeLayer, 'c2'); assert.equal(doc.objects[0].layer, 'camada-1');
  doc = documentReducer(doc, { type: 'add', object: rect(20, 0, 10, 10) });
  assert.equal(doc.objects[1].layer, 'c2');
  // Camada 2 abaixo da 1: os objetos dela passam para trás.
  doc = documentReducer(doc, { type: 'set-layers', ...moveLayer(doc, 'c2', false) });
  assert.equal(doc.objects[0].layer, 'c2');
  doc = documentReducer(doc, { type: 'set-layers', ...updateLayer(doc, 'c2', { locked: true }) });
  assert.equal(isBlocked(doc, doc.objects[0]), true); assert.equal(isBlocked(doc, doc.objects[1]), false);
  doc = documentReducer(doc, { type: 'set-layers', ...updateLayer(doc, 'camada-1', { printable: false }) });
  assert.equal(isPrintable(doc, doc.objects[1]), false); assert.equal(exportScene(doc, 'page', []).objects.length, 1);
  doc = documentReducer(doc, { type: 'set-layers', ...moveToLayer(doc, [doc.objects[1].id], 'c2') });
  assert.ok(doc.objects.every(o => o.layer === 'c2'));
  assert.deepEqual(parseProject(serializeProject(doc)), doc);
  const removed = deleteLayer(doc, 'c2')!; assert.equal(removed.objects!.length, 0); assert.equal(removed.layers.length, 1);
  assert.equal(deleteLayer({ ...doc, layers: [doc.layers![0]] }, doc.layers![0].id), null);
});

test('linhas-guia e grade: persistência e encaixe', () => {
  let doc = createDocument();
  doc = documentReducer(doc, { type: 'set-guides', guides: addGuide(addGuide(undefined, 'x', 100), 'y', 50) });
  assert.equal(doc.guides!.length, 2); assert.deepEqual(parseProject(serializeProject(doc)).guides, doc.guides);
  const lines = { guides: doc.guides!, grid: null };
  assert.deepEqual(snapPoint({ x: 97, y: 53 }, lines, 5), { x: 100, y: 50 });
  assert.deepEqual(snapPoint({ x: 90, y: 40 }, lines, 5), { x: 90, y: 40 });
  assert.deepEqual(snapBounds({ x: 0, y: 0, width: 196, height: 10 }, lines, 5), { dx: 2, dy: null });
  assert.deepEqual(snapPoint({ x: 12, y: 19 }, { guides: [], grid: 10 }, 3), { x: 10, y: 20 });
  assert.equal(documentReducer(doc, { type: 'set-guides', guides: [] }).guides, undefined);
});

test('cortar, faca, borracha e excluir segmento virtual', () => {
  const square = rect(0, 0, 100, 100);
  const cropped = performCut([square], [square.id], 'crop', { crop: { x: 50, y: 0, width: 100, height: 50 } });
  near(area(cropped.objects[0]).area, 2500);
  const cut = performCut([square], [square.id], 'knife', { knife: { a: { x: 50, y: -10 }, b: { x: 50, y: 110 } } });
  assert.equal(cut.objects.length, 2); near(area(cut.objects[0]).area + area(cut.objects[1]).area, 10000); near(area(cut.objects[0]).area, 5000);
  assert.throws(() => performCut([square], [square.id], 'knife', { knife: { a: { x: 200, y: 0 }, b: { x: 300, y: 0 } } }));
  const erased = performCut([square], [square.id], 'erase', { erase: { points: [{ x: 50, y: -20 }, { x: 50, y: 120 }], radius: 5 } });
  near(area(erased.objects[0]).area, 9000, 1); assert.equal(splitContours(erased.objects[0].commands!).length, 2);
  // Linha horizontal cruzada por duas verticais: clicar no trecho do meio remove só ele.
  const line = createPathObject([{ x: 0, y: 50 }, { x: 300, y: 50 }], false, '#000000');
  const v1 = createPathObject([{ x: 100, y: 0 }, { x: 100, y: 100 }], false, '#000000'), v2 = createPathObject([{ x: 200, y: 0 }, { x: 200, y: 100 }], false, '#000000');
  const deleted = performCut([line, v1, v2], [line.id, v1.id, v2.id], 'virtualDelete', { point: { x: 150, y: 50 } });
  const pieces = deleted.objects.filter(o => deleted.resultIds!.includes(o.id));
  assert.equal(pieces.length, 2); near(pieces.reduce((sum, o) => sum + area(o).length, 0), 200, 1e-6);
  // Quadrado cortado por uma vertical: clicar no lado de cima à direita deixa um caminho aberto.
  const sq = rect(0, 0, 100, 100), cutter = createPathObject([{ x: 50, y: -10 }, { x: 50, y: 110 }], false, '#000000');
  const open = performCut([sq, cutter], [sq.id, cutter.id], 'virtualDelete', { point: { x: 100, y: 50 } }).objects[0];
  near(area(open).length, 200, 1e-6); assert.equal(open.fill, 'none');
});
