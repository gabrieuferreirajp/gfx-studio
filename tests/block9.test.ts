import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { VectorObject } from '../src/document/model.ts';
import { combine } from '../src/geometry/combine.ts';
import { decodePath, joinNodes, breakAtNodes, closeContours, extractSubpaths, alignNodes, reduceNodes, insertNode, convertNode, moveHandle } from '../src/geometry/nodeGeometry.ts';
import { parsePageRange } from '../src/document/pages.ts';
import { toPdfPages, toPdf, toEps } from '../src/io/exporters.ts';
import { activeCmyk, cmykToHex } from '../src/workspace/palettes.ts';
import { isHidden, isPrintable } from '../src/document/layers.ts';
import { createDocument } from '../src/document/model.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { copyProperties } from '../src/document/copyProperties.ts';
import { approximateMeasure } from '../src/text/textLayout.ts';
import { moveInStack } from '../src/document/objectOrder.ts';

const rect = (id: string, x: number, y: number, w = 100, h = 100, extra: Partial<VectorObject> = {}): VectorObject => ({ id, type: 'rectangle', name: id, x, y, width: w, height: h, fill: '#ff0000', stroke: '#000000', strokeWidth: 1, ...extra });
const line = (pts: [number, number][], closed = false): VectorObject => ({ id: 'p', type: 'path', name: 'p', x: 0, y: 0, width: 100, height: 100, pathSize: { width: 100, height: 100 }, fill: 'none', stroke: '#000', strokeWidth: 1, commands: [...pts.map(([x, y], i) => ({ type: i ? 'L' as const : 'M' as const, x, y })), ...(closed ? [{ type: 'Z' as const }] : [])] });

test('combinar (Ctrl+L): vira uma curva com todos os contornos, par-ímpar, com o estilo do objeto de referência', () => {
  const r = combine([rect('a', 0, 0), rect('b', 50, 50, 100, 100, { fill: '#00ff00' }), rect('c', 500, 500)], ['a', 'b'], new Map(), 'b')!;
  assert.equal(r.objects.length, 2);
  const c = r.objects.find(o => o.id === r.id)!;
  assert.deepEqual([c.type, c.fill, c.fillRule, c.commands!.filter(k => k.type === 'M').length], ['path', '#00ff00', 'evenodd', 2]);
});

test('nós: juntar, quebrar, fechar, extrair, alinhar, reduzir e simétrico', () => {
  const open = decodePath(line([[0, 0], [50, 0], [100, 0], [100, 100]]));
  const closed = joinNodes(open, 0, 3)!;
  assert.equal(closed.closed, true); assert.equal(closed.nodes.length, 3);
  const broken = breakAtNodes(open, [1]);
  assert.equal(broken.contours?.length, 2);
  const rejoined = joinNodes(broken, 1, 2)!;
  assert.equal(rejoined.nodes.length, 4); assert.ok(!rejoined.contours);
  assert.equal(closeContours(open, []).closed, true);
  const ex = extractSubpaths(broken, [0])!;
  assert.equal(ex.rest.nodes.length + ex.extracted.nodes.length, 5);
  const aligned = alignNodes(open, [2, 3], 'horizontal');
  assert.equal(aligned.nodes[2].y, aligned.nodes[3].y);
  // Nó colinear no meio de uma reta sai sem mudar a forma.
  const r = reduceNodes(open, 0.5);
  assert.equal(r.removed, 1); assert.equal(r.path.nodes.length, 3);
  const curve = insertNode(decodePath(line([[0, 0], [100, 0], [100, 100]])), 0);
  const sym = convertNode(convertNode(curve, 1, 'corner'), 1, 'symmetric'), n = sym.nodes[1];
  const moved = moveHandle(sym, 1, 'outgoing', { x: n.x + 30, y: n.y });
  assert.ok(Math.abs(Math.hypot(moved.nodes[1].incoming!.x - n.x, moved.nodes[1].incoming!.y - n.y) - 30) < 1e-9, 'alças simétricas com o mesmo comprimento');
});

test('páginas: intervalo "1-3, 5" e PDF com várias páginas', () => {
  assert.deepEqual(parsePageRange('1-3, 5, 9-', 10), [1, 2, 3, 5, 9, 10]);
  assert.deepEqual(parsePageRange('lixo', 4), []);
  const scene = (w: number) => ({ objects: [rect('a', 0, 0)], area: { x: 0, y: 0, width: w, height: 200 } });
  const pdf = new TextDecoder('latin1').decode(toPdfPages([{ scene: scene(200) }, { scene: scene(400) }]));
  assert.match(pdf, /\/Count 2/);
  assert.equal((pdf.match(/\/Type \/Page /g) ?? []).length, 2);
  assert.match(pdf, /MediaBox \[0 0 300 150\]/);
  for (const [, offset, id] of pdf.matchAll(/(\d{10}) 00000 n \n/g).map((m, i) => [m, Number(m[1]), i + 1] as const)) assert.equal(pdf.slice(offset, offset + `${id} 0 obj`.length), `${id} 0 obj`);
});

test('CMYK exato: sai como k/K no PDF e setcmykcolor no EPS; trocar a cor por fora desfaz', () => {
  const c: [number, number, number, number] = [10, 80, 0, 5], hex = cmykToHex(...c);
  const o = rect('a', 0, 0, 10, 10, { fill: hex, fillCmyk: c, stroke: cmykToHex(0, 0, 0, 100), strokeCmyk: [0, 0, 0, 100] });
  const scene = { objects: [o], area: { x: 0, y: 0, width: 10, height: 10 } };
  const pdf = new TextDecoder('latin1').decode(toPdf(scene));
  assert.match(pdf, /0\.1 0\.8 0 0\.05 k/); assert.match(pdf, /0 0 0 1 K/);
  assert.match(toEps(scene), /0\.1 0\.8 0 0\.05 setcmykcolor/);
  assert.equal(activeCmyk(c, '#123456'), undefined);
  assert.deepEqual(parseProject(serializeProject({ ...createDocument(), objects: [o] })).objects[0].fillCmyk, c);
});

test('ocultar objeto, copiar propriedades e reordenar no painel Objetos', () => {
  const doc = { ...createDocument(), objects: [rect('a', 0, 0, 10, 10, { hidden: true })] };
  assert.ok(isHidden(doc, doc.objects[0]) && !isPrintable(doc, doc.objects[0]));
  assert.equal(parseProject(serializeProject(doc)).objects[0].hidden, true);
  const src = rect('s', 0, 0, 10, 10, { fill: '#00ff00', stroke: '#0000ff', strokeWidth: 5, strokeJoin: 'round' });
  const out = copyProperties(rect('t', 0, 0), src, { outline: true, outlineColor: false, fill: true, text: false }, approximateMeasure);
  assert.deepEqual([out.fill, out.stroke, out.strokeWidth, out.strokeJoin], ['#00ff00', '#000000', 5, 'round']);
  const list = [rect('a', 0, 0), rect('b', 0, 0), rect('c', 0, 0)];
  assert.deepEqual(moveInStack(list, ['a'], 'c', true).map(o => o.id), ['b', 'c', 'a']);
  assert.deepEqual(moveInStack(list, ['c'], 'a', false).map(o => o.id), ['c', 'a', 'b']);
});

test('desagrupar tudo desfaz todos os níveis; desagrupar desfaz só um', async () => {
  const { ungroupAll, ungroupObjects } = await import('../src/geometry/objectTransforms.ts');
  const list = [rect('a', 0, 0, 10, 10, { groupPath: ['g1', 'g0'] }), rect('b', 0, 0, 10, 10, { groupPath: ['g1', 'g0'] }), rect('c', 0, 0, 10, 10, { groupPath: ['g1'] })];
  assert.deepEqual(ungroupObjects(list, ['a']).map(o => o.groupPath), [['g0'], ['g0'], undefined]);
  assert.deepEqual(ungroupAll(list, ['a']).map(o => o.groupPath), [undefined, undefined, undefined]);
});
