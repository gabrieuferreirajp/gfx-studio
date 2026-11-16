import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createObject, type VectorDocument } from '../src/document/model.ts';
import { approximateMeasure, createText, defaultTextStyle, updateText } from '../src/text/textLayout.ts';
import { applyMatrix, boundsOf, duplicateObjects, translate } from '../src/geometry/objectTransforms.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { exportScene, toSvg, transparencyNote } from '../src/io/exporters.ts';
import { boxHandles, boxQuad, deformObjects, deformSources, distortPath, envelopeMap, mapPath, perspectiveMap, presetHandles, validQuad } from '../src/geometry/deform.ts';
import { flatten } from '../src/io/exporters.ts';
import { defaultMesh, meshColor, meshFillOf, meshPixels, patternDef, patternFill, resizeMesh } from '../src/document/patterns.ts';
import { applyStyle, createSymbol, deleteStyle, insertSymbol, instancesOf, newStyle, redefineStyle, styleFrom, unlinkSymbol, updateSymbol } from '../src/document/library.ts';
import { applyBitmapEffect, resampleSize } from '../src/bitmap/bitmapEffects.ts';
import { angularDimension, axisFor, calloutObjects, dimensionObjects, formatMeasure, nearestSegment } from '../src/geometry/dimension.ts';
import { worldCommands } from '../src/geometry/worldGeometry.ts';
import { solidFill } from '../src/document/paint.ts';

const near = (a: number, b: number, t = 1e-6) => assert.ok(Math.abs(a - b) <= t, `${a} ≠ ${b}`);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const rect = (x = 0, y = 0, w = 100, h = 50) => ({ ...createObject('rectangle', x, y, '#ff0000', '#000000'), width: w, height: h });
const points = (c: ReturnType<typeof worldCommands>) => flatten(c).flatMap(x => x.points);

test('envelope e perspectiva: sem deslocar alças mantêm a forma; alças movidas deformam', () => {
  const box = { x: 10, y: 20, width: 100, height: 50 };
  const id = envelopeMap(boxHandles(box)), p = id(0.25, 0.75);
  near(p.x, 35); near(p.y, 57.5);
  const persp = perspectiveMap(boxQuad(box)), q = persp(0.5, 0.5);
  near(q.x, 60); near(q.y, 45);
  // Arco para cima: o meio do lado de cima sobe 30% da altura; os cantos não mudam.
  const arc = envelopeMap(presetHandles(box, 'arcUp'));
  near(arc(0.5, 0).y, 5); near(arc(0, 0).y, 20); near(arc(1, 1).x, 110);
  // Perspectiva: o lado de cima estreitado leva os cantos aos pontos dados.
  const quad = [{ x: 30, y: 20 }, { x: 90, y: 20 }, { x: 110, y: 70 }, { x: 10, y: 70 }] as const;
  const m = perspectiveMap([...quad] as never);
  for (const [u, v, k] of [[0, 0, 0], [1, 0, 1], [1, 1, 2], [0, 1, 3]] as const) { near(m(u, v).x, quad[k].x, 1e-6); near(m(u, v).y, quad[k].y, 1e-6); }
  assert.ok(validQuad([...quad] as never)); assert.ok(!validQuad([quad[0], quad[2], quad[1], quad[3]] as never));
  // Objeto real: retângulo → curva com o topo arqueado; cores e ID preservados.
  const r = { ...rect(10, 20), fillGradient: undefined };
  const src = deformSources([r], [r.id])!;
  const out = deformObjects([r], [r.id], src.sources, src.box, (c, b) => mapPath(c, b, envelopeMap(presetHandles(b, 'arcUp'))))[0];
  assert.equal(out.id, r.id); assert.equal(out.type, 'path'); assert.equal(out.fill, '#ff0000');
  near(Math.min(...points(worldCommands(out)).map(p => p.y)), 5, 0.6);
});

test('distorção: empurrar/puxar, zíper e torcer', () => {
  const r = rect(0, 0, 100, 100), box = { x: 0, y: 0, width: 100, height: 100 }, c = worldCommands(r);
  const push = distortPath(c, box, { kind: 'pushPull', amplitude: 50 }), first = push[0] as { x: number; y: number };
  near(first.x, 25); near(first.y, 25); // nó a meio caminho do centro
  const zip = distortPath(c, box, { kind: 'zipper', amplitude: 5, frequency: 3 });
  assert.ok(zip.filter(x => x.type === 'L').length >= 20); assert.equal(zip.at(-1)!.type, 'Z');
  const twist = distortPath(c, box, { kind: 'twister', angle: 90 }), pts = points(twist);
  // O canto (distância máxima) gira 90°: (0,0) → (100,0).
  near(pts[0].x, 100, 1e-6); near(pts[0].y, 0, 1e-6);
});

test('padrão de duas cores, bitmap e malha: SVG, persistência e cor sólida', () => {
  const r = patternFill(rect(), { kind: 'twoColor', preset: 'checker', fg: '#000000', bg: '#ffffff', size: 20, angle: 45 });
  assert.equal(r.fill, '#ffffff');
  assert.match(patternDef(r), /<pattern id="fpat-[^"]+" patternUnits="userSpaceOnUse" width="20" height="20" patternTransform="matrix\(1 0 0 1 0 0\) translate\(0 0\) rotate\(-45\)">/);
  const scene = exportScene({ ...createDocument(), objects: [r] }, 'objects', []);
  assert.match(toSvg(scene), /fill="url\(#fpat-/);
  assert.match(transparencyNote(scene, 'pdf'), /padrão e de malha saem com cor sólida/);
  assert.equal(solidFill(r, '#00ff00').fillPattern, undefined);
  const bmp = patternFill(rect(), { kind: 'bitmap', src: PNG, size: 30, ratio: 0.5 });
  assert.match(patternDef(bmp), /height="15"/);
  const mesh = { ...defaultMesh('#000000', 1, 1), src: PNG };
  mesh.colors[1] = '#ffffff'; mesh.colors[3] = '#ffffff';
  near(meshColor(mesh, 0.5, 0.3)[0], 127.5);
  const px = meshPixels(mesh, 3, 1); assert.deepEqual([px[0], px[8]], [0, 255]);
  const grown = resizeMesh(mesh, 2, 2); assert.equal(grown.colors.length, 9); assert.equal(grown.colors[1], '#808080');
  const shape = meshFillOf(rect(), mesh); assert.equal(shape.fill, '#808080');
  assert.match(toSvg(exportScene({ ...createDocument(), objects: [shape] }, 'objects', [])), /<clipPath id="mclip-[^"]+">.*<image href="data:image\/png/);
  const doc = parseProject(serializeProject({ ...createDocument(), objects: [r, bmp, shape] }));
  assert.deepEqual(doc.objects[0].fillPattern, r.fillPattern); assert.equal(doc.objects[2].meshFill?.rows, 1);
  assert.throws(() => parseProject(JSON.stringify({ ...createDocument(), objects: [{ ...r, fillPattern: { kind: 'twoColor', preset: 'x', size: 1 } }] })), /Padrão/);
});

test('estilos de objeto: criar, aplicar, redefinir em todas as páginas e excluir', () => {
  const source = { ...rect(), stroke: '#0000ff', strokeWidth: 4, strokeDash: [2, 2] };
  const style = newStyle(source, 'Destaque');
  assert.deepEqual(Object.keys(style.props).sort(), ['fill', 'stroke', 'strokeDash', 'strokeWidth']);
  const target = applyStyle({ ...rect(200), fill: '#00ff00', strokeDash: [9, 9] }, style, approximateMeasure);
  assert.equal(target.fill, '#ff0000'); assert.deepEqual(target.strokeDash, [2, 2]); assert.equal(target.style, style.id);
  const text = applyStyle(updateText(createText(0, 0, '#000000', defaultTextStyle, approximateMeasure), { text: 'A' }, approximateMeasure), newStyle({ ...createText(0, 0, '#123456', { ...defaultTextStyle, fontSize: 40 }, approximateMeasure) }, 'Título'), approximateMeasure);
  assert.equal(text.fontSize, 40); assert.equal(text.fill, '#123456');
  assert.equal(styleFrom(rect()).fontSize, undefined);
  const other = { ...rect(), id: 'p2', style: style.id };
  let doc: VectorDocument = { ...createDocument(), styles: [style], objects: [target], pages: [{ id: 'a', name: '1', objects: [] }, { id: 'b', name: '2', objects: [other] }], page: 0 };
  const changed = redefineStyle(doc, style.id, { ...style.props, fill: '#abcdef' }, approximateMeasure);
  assert.equal(changed.document.objects[0].fill, '#abcdef'); assert.equal(changed.document.pages![1].objects[0].fill, '#abcdef');
  doc = { ...doc, styles: changed.styles, ...changed.document };
  const reread = parseProject(serializeProject(doc)); assert.equal(reread.styles![0].props.fill, '#abcdef');
  const removed = deleteStyle(doc, style.id); assert.equal(removed.styles.length, 0); assert.equal(removed.document.objects[0].style, undefined);
});

test('símbolos: converter, inserir, mover, atualizar todas as instâncias e quebrar vínculo', () => {
  let n = 0; const uuid = () => `id-${++n}`;
  const a = rect(10, 10, 20, 20), b = { ...createObject('ellipse', 40, 10, '#00ff00'), width: 10, height: 10 };
  const made = createSymbol([a, b], [a.id, b.id], 'Logo', uuid);
  assert.equal(made.symbol.objects.length, 2); near(boundsOf(made.symbol.objects).x, 0);
  const placed = insertSymbol(made.objects, made.symbol, { x: 300, y: 300 }, uuid);
  near(boundsOf(placed.objects.filter(o => placed.ids.includes(o.id))).x, 280);
  // Mover a segunda instância compõe a matriz do vínculo.
  let objects = applyMatrix(placed.objects, placed.ids, translate(5, 0));
  let doc: VectorDocument = { ...createDocument(), symbols: [made.symbol], objects };
  assert.equal(instancesOf(objects, made.symbol.id).size, 2);
  // Editar a primeira instância (cor) e atualizar o símbolo: a outra instância recebe a cor, no próprio lugar.
  const edited = objects.map(o => made.ids[0] === o.id ? { ...o, fill: '#0000ff' } : o);
  doc = { ...doc, objects: edited };
  const updated = updateSymbol(doc, edited.filter(o => made.ids.includes(o.id)), uuid);
  const second = [...instancesOf(updated.document.objects, made.symbol.id).values()][1];
  assert.equal(second[0].fill, '#0000ff'); near(boundsOf(second).x, 285);
  doc = { ...doc, symbols: updated.symbols, objects: updated.document.objects };
  const reread = parseProject(serializeProject(doc));
  assert.equal(reread.symbols![0].objects.length, 2); assert.equal(instancesOf(reread.objects, made.symbol.id).size, 2);
  // Duplicar uma instância cria uma instância nova (grupo e vínculo próprios).
  const dup = duplicateObjects(reread.objects, second.map(o => o.id), uuid);
  assert.equal(instancesOf(dup.objects, made.symbol.id).size, 3);
  const free = unlinkSymbol(reread.objects, [second[0].id]);
  assert.equal(instancesOf(free, made.symbol.id).size, 1);
  assert.throws(() => createSymbol(free, [free.find(o => o.symbol)!.id], 'x'), /já contém um símbolo/);
});

test('bitmaps: ajustes de pixels e reamostragem', () => {
  const src = { width: 2, height: 1, data: new Uint8ClampedArray([200, 100, 50, 255, 0, 0, 0, 128]) };
  assert.deepEqual([...applyBitmapEffect(src, 'invert').data.slice(0, 4)], [55, 155, 205, 255]);
  const g = applyBitmapEffect(src, 'grayscale').data; assert.equal(g[0], g[1]); assert.equal(g[7], 128);
  assert.deepEqual([...applyBitmapEffect(src, 'blackWhite', { threshold: 100 }).data.slice(0, 8)], [255, 255, 255, 255, 0, 0, 0, 128]);
  assert.equal(applyBitmapEffect(src, 'brightness', { brightness: 100 }).data[0], 255);
  assert.equal(applyBitmapEffect(src, 'hsl', { saturation: -100 }).data[0], applyBitmapEffect(src, 'hsl', { saturation: -100 }).data[2]);
  assert.deepEqual([...applyBitmapEffect(src, 'posterize', { levels: 2 }).data.slice(0, 3)], [255, 0, 0]);
  const blurred = applyBitmapEffect({ width: 5, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]) }, 'blur', { radius: 2 }).data;
  assert.ok(blurred[8] < 255 && blurred[4] > 0);
  assert.deepEqual(resampleSize(96, 48, 300), { width: 300, height: 150 });
});

test('cotas: horizontal/vertical, angular, segmento e legenda', () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 40 };
  assert.deepEqual(axisFor(a, b, { x: 50, y: -30 }), { x: 1, y: 0 });
  assert.deepEqual(axisFor(a, b, { x: 150, y: 20 }), { x: 0, y: 1 });
  const h = dimensionObjects(a, b, -20, 'px', approximateMeasure, '#000000', { axis: { x: 1, y: 0 } });
  assert.equal(h.find(o => o.type === 'text')!.text, '100 px');
  const v = dimensionObjects(a, b, -20, 'mm', approximateMeasure, '#000000', { axis: { x: 0, y: 1 }, precision: 1, showUnit: false });
  assert.equal(v.find(o => o.type === 'text')!.text, '10,6');
  assert.equal(formatMeasure(96, 'in', { precision: 0 }), '1 pol');
  const ang = angularDimension({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: -100 }, 50, approximateMeasure);
  assert.equal(ang.find(o => o.type === 'text')!.text, '90,0°'); assert.equal(new Set(ang.map(o => o.groupPath![0])).size, 1);
  const seg = nearestSegment([rect(0, 0, 100, 50)], { x: 50, y: 2 }, 5)!;
  assert.deepEqual(seg, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  const call = calloutObjects({ x: 0, y: 0 }, { x: 20, y: -20 }, { x: 60, y: -20 }, 'Detalhe', approximateMeasure);
  const label = call.find(o => o.type === 'text')!; assert.equal(label.text, 'Detalhe'); assert.ok(label.x > 60);
});
