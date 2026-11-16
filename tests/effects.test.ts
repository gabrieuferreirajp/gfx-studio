import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createObject, documentReducer, type PathCommand, type VectorObject } from '../src/document/model.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { applyCorners } from '../src/geometry/corners.ts';
import { worldCommands } from '../src/geometry/worldGeometry.ts';
import { boundsOf } from '../src/geometry/objectTransforms.ts';
import { convertToCurves } from '../src/geometry/convertCurves.ts';
import { decodePath, mirrorEdit, moveNode } from '../src/geometry/nodeGeometry.ts';
import { blendObjects, effectSelectionError, mixColor } from '../src/geometry/effects.ts';
import { performContour, performSweep } from '../src/geometry/effectsGeometry.ts';
import { exportScene, toPdf, toSvg } from '../src/io/exporters.ts';
import { placeInside } from '../src/geometry/powerClip.ts';
const rect = (x: number, y: number, w: number, h: number, fill = '#3366cc') => ({ ...createObject('rectangle', x, y, fill, '#000000'), width: w, height: h });
const valid = (objects: VectorObject[]) => assert.doesNotThrow(() => parseProject(serializeProject({ ...createDocument(), objects })));

test('cantos arredondados, recortados e chanfrados no retângulo persistem e mantêm o tamanho', () => {
  for (const cornerType of ['round', 'scallop', 'chamfer'] as const) {
    const r = { ...rect(0, 0, 100, 60), cornerRadius: 12, cornerType };
    const commands = worldCommands(r), b = boundsOf([r]);
    assert.equal(commands.filter(c => c.type === 'C').length, cornerType === 'chamfer' ? 0 : 4);
    assert.equal(commands.filter(c => c.type === 'L').length, cornerType === 'chamfer' ? 7 : 4);
    assert.deepEqual([b.width, b.height], [100, 60]); valid([r]);
  }
  assert.throws(() => parseProject(JSON.stringify({ ...createDocument(), objects: [{ ...createObject('ellipse', 0, 0, 'none'), cornerRadius: 3 }] })));
  const huge = applyCorners(worldCommands(rect(0, 0, 20, 20)), 500);
  assert.ok(huge.filter(c => c.type !== 'Z').every(c => c.type === 'M' || c.x >= -1e-9 && c.x <= 20 + 1e-9), 'raio limitado à metade dos lados');
  // Retângulo esticado (2× na largura, 1× na altura): cantos continuam circulares e o raio acompanha a escala média.
  const stretched = { ...rect(0, 0, 50, 60), cornerRadius: 10, transform: [2, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] };
  const commands = worldCommands(stretched), at = commands.findIndex(c => c.type === 'C'), arc = commands[at], start = commands[at - 1] as { x: number; y: number };
  assert.ok(arc.type === 'C' && Math.abs(Math.abs(arc.x - start.x) - Math.abs(arc.y - start.y)) < 1e-9, 'canto circular');
  assert.ok(Math.abs(Math.abs(arc.y - start.y) - 10 * Math.SQRT2) < 1e-9, 'raio × escala média');
  const doubled = { ...rect(0, 0, 50, 30), cornerRadius: 10, transform: [2, 0, 0, 2, 0, 0] as [number, number, number, number, number, number] };
  assert.ok(Math.abs((worldCommands(doubled)[0] as { x: number }).x - 20) < 1e-9, 'escala uniforme dobra o raio');
  const open: PathCommand[] =[{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 50, y: 0 }, { type: 'L', x: 50, y: 50 }];
  assert.deepEqual(applyCorners(open, 10).map(c => c.type), ['M', 'L', 'C', 'L']);
});
test('converter em curvas (Ctrl+Q) troca retângulo, elipse e texto por caminhos com o mesmo ID', () => {
  const r = { ...rect(10, 10, 80, 40), cornerRadius: 8 }, e = { ...createObject('ellipse', 0, 0, '#ff0000'), width: 50, height: 30 }, t = { ...createObject('text', 0, 0, '#000000'), text: 'A' };
  const glyph: PathCommand[] = [{ type: 'M', x: 0, y: 10 }, { type: 'L', x: 5, y: 0 }, { type: 'L', x: 10, y: 10 }, { type: 'Z' }];
  const frame = rect(0, 0, 200, 200), clipped = placeInside([r, frame], [r.id], frame.id);
  const { objects, converted } = convertToCurves([...clipped, e, t], [frame.id, e.id, t.id], new Map([[t.id, glyph]]));
  assert.equal(converted, 4);
  assert.ok(objects.every(o => o.type === 'path')); assert.deepEqual(objects.map(o => o.id), [frame.id, r.id, e.id, t.id]);
  assert.equal(objects[1].clipParent, frame.id); assert.equal(objects[3].fill, '#000000');
  assert.ok(Math.abs(boundsOf([objects[1]]).width - 80) < 1e-6); valid(objects);
});
test('refletir nós move o nó espelhado na horizontal, na vertical ou em ambas', () => {
  const square = convertToCurves([rect(0, 0, 100, 100)], [], new Map()).objects[0];
  const path = decodePath(convertToCurves([square], [square.id], new Map()).objects[0]);
  const i = path.nodes.findIndex(n => n.x === 0 && n.y === 0), edited = moveNode(path, i, { x: 10, y: 5 });
  const h = mirrorEdit(path, edited, i, null, true, false), right = h.nodes.find(n => n.x === 90);
  assert.ok(right && right.y === 5, JSON.stringify(h.nodes));
  const both = mirrorEdit(path, edited, i, null, true, true);
  assert.ok(both.nodes.some(n => n.x === 90 && n.y === 95) && both.nodes.some(n => n.x === 10 && n.y === 95));
  assert.equal(mirrorEdit(path, edited, i, null, false, false), edited);
});
test('contorno para fora e para dentro gera passos agrupados com cores interpoladas', () => {
  const r = rect(0, 0, 100, 100, '#ff0000');
  const out = performContour([r], [r.id], { direction: 'outside', steps: 3, offset: 10, endColor: '#0000ff' }).objects;
  assert.equal(out.length, 4); assert.equal(out.at(-1)!.id, r.id);
  assert.ok(new Set(out.map(o => o.groupPath?.at(-1))).size === 1);
  const b = boundsOf([out[0]]); assert.ok(Math.abs(b.width - 160) < 1 && Math.abs(b.x + 30) < 1, JSON.stringify(b));
  assert.equal(out[0].fill, '#0000ff'); valid(out);
  const inside = performContour([r], [r.id], { direction: 'inside', steps: 2, offset: 10, endColor: '#ffffff' }).objects;
  assert.equal(inside[0].id, r.id); assert.ok(Math.abs(boundsOf([inside[2]]).width - 60) < 1);
});
test('bloquear sombra e extrusão varrem a forma para trás do objeto', () => {
  const r = rect(0, 0, 50, 50, '#22aa55');
  const block = performSweep([r], [r.id], { mode: 'shadow', dx: 40, dy: 40, color: '#111111', shade: 0 }).objects;
  assert.equal(block.length, 2); assert.equal(block[1].id, r.id); assert.equal(block[0].fill, '#111111');
  const b = boundsOf([block[0]]); assert.ok(Math.abs(b.width - 90) < 0.5 && Math.abs(b.height - 90) < 0.5);
  const extrude = performSweep([r], [r.id], { mode: 'extrude', dx: 0, dy: 20, color: '#000000', shade: 0.5 }).objects;
  assert.equal(extrude[0].fill, mixColor('#22aa55', '#000000', 0.5)); valid(extrude);
  assert.match(effectSelectionError([{ ...createObject('text', 0, 0, '#000000') }], [], 'sweep')!, /Selecione/);
});
test('misturar cria etapas entre dois objetos, agrupadas na ordem de empilhamento', () => {
  const a = rect(0, 0, 40, 40, '#ff0000'), b = { ...createObject('ellipse', 200, 0, '#0000ff', '#000000'), width: 80, height: 80 }, other = rect(500, 0, 10, 10);
  const objects = blendObjects([a, other, b], [a.id, b.id], 3);
  assert.equal(objects.length, 6); assert.equal(objects[0].id, other.id);
  assert.deepEqual([objects[1].id, objects[5].id], [a.id, b.id]);
  assert.equal(objects[3].fill, mixColor('#ff0000', '#0000ff', 0.5));
  const mid = boundsOf([objects[3]]); assert.ok(mid.x > 60 && mid.x < 140, JSON.stringify(mid)); valid(objects);
  assert.throws(() => blendObjects([a], [a.id], 3), /dois objetos/);
});
test('sombra projetada persiste e é exportada (SVG com desfoque, PDF como cópia deslocada)', () => {
  const r = { ...rect(10, 10, 50, 50), shadow: { x: 5, y: 6, blur: 4, color: '#000000', opacity: 0.5 } };
  valid([r]);
  assert.throws(() => parseProject(JSON.stringify({ ...createDocument(), objects: [{ ...r, shadow: { ...r.shadow, color: 'red' } }] })));
  const scene = exportScene({ ...createDocument(), objects: [r] }, 'page', []);
  assert.match(toSvg(scene), /feDropShadow dx="5" dy="6" stdDeviation="2"/);
  assert.match(new TextDecoder('latin1').decode(toPdf(scene)), /q 1 0 0 1 5 6 cm[\s\S]*0\.502 0\.502 0\.502 rg/);
});
test('propriedades do documento alteram nome e página com validação', () => {
  const document = documentReducer(createDocument(), { type: 'set-document', name: '  Placa  ', artboard: { width: 793.7, height: 1122.5 } });
  assert.equal(document.name, 'Placa'); assert.deepEqual(document.artboard, { width: 793.7, height: 1122.5 });
  assert.deepEqual(documentReducer(document, { type: 'set-document', artboard: { width: 0, height: 5 } }).artboard, document.artboard);
});
