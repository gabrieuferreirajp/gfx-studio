import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createObject, type VectorObject } from '../src/document/model.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { applyMatrix, boundsOf, duplicateObjects, translate } from '../src/geometry/objectTransforms.ts';
import { recordTransform, repeatStep, type RepeatState } from '../src/geometry/repeat.ts';
import { snapMove, spacingPairs } from '../src/geometry/smartGuides.ts';
import { cornerRadii, worldCommands } from '../src/geometry/worldGeometry.ts';
import { edgeSegments, nearestEdge } from '../src/geometry/dimension.ts';
import { parseLayout } from '../src/workspace/layout.ts';

const rect = (x: number, y: number, w: number, h: number) => ({ ...createObject('rectangle', x, y, '#336699', '#000000'), width: w, height: h });
const empty: RepeatState = { step: null, copy: null };
const xOf = (objects: VectorObject[], id: string) => boundsOf(objects.filter(o => o.id === id)).x;

test('Ctrl+R: duplicar (Ctrl+D), mover a cópia e repetir mantém o mesmo espaçamento', () => {
  const a = rect(0, 0, 10, 10);
  // Ctrl+D (cópia deslocada 20,20) e depois a cópia é arrastada para ficar 30 à direita do original.
  const dup = duplicateObjects([a], [a.id]);
  let state = recordTransform(empty, [a], [a.id], translate(20, 20), dup.ids);
  const moved = applyMatrix(dup.objects, dup.ids, translate(10, -20));
  state = recordTransform(state, dup.objects, dup.ids, translate(10, -20));
  assert.equal(xOf(moved, dup.ids[0]), 30);
  const third = repeatStep(state, moved, dup.ids)!;
  assert.equal(third.objects.length, 3, 'nova cópia');
  assert.equal(xOf(third.objects, third.ids[0]), 60);
  assert.equal(boundsOf(third.objects.filter(o => o.id === third.ids[0])).y, 0);
  const fourth = repeatStep(third.state, third.objects, third.ids)!;
  assert.equal(xOf(fourth.objects, fourth.ids[0]), 90, 'Ctrl+R de novo continua a sequência');
  // Mover sem copiar: repete só o movimento.
  const plain = recordTransform(empty, [a], [a.id], translate(5, 0));
  const again = repeatStep(plain, [a], [a.id])!;
  assert.equal(again.objects.length, 1); assert.equal(xOf(again.objects, a.id), 5);
  assert.equal(repeatStep(empty, [a], [a.id]), null);
});

test('guias de espaçamento igual: encaixa a seleção com o mesmo vão dos vizinhos', () => {
  const a = { x: 0, y: 0, width: 10, height: 10 }, b = { x: 25, y: 0, width: 10, height: 10 };
  const pairs = { x: spacingPairs([a, b], 'x'), y: spacingPairs([a, b], 'y') };
  assert.equal(pairs.x[0].gap, 15);
  // Arrastando para x = 48 (vão de 13): encaixa em 50 (vão de 15) e mostra os dois trechos iguais.
  const snap = snapMove({ x: 48, y: 1, width: 10, height: 10 }, [a, b], 3, pairs);
  assert.equal(snap.dx, 2);
  assert.equal(snap.spacings.length, 1);
  assert.deepEqual(snap.spacings[0].segments.map(s => [s.from, s.to]), [[10, 25], [35, 50]]);
  // Entre os dois, centralizado.
  const wide = { x: 40, y: 0, width: 10, height: 10 }, mid = snapMove({ x: 21, y: 0, width: 4, height: 4 }, [a, wide], 3, { x: spacingPairs([a, wide], 'x'), y: [] });
  assert.equal(21 + mid.dx, 23);
});

test('cantos independentes: quatro raios gravados e desenhados', () => {
  const r: VectorObject = { ...rect(0, 0, 100, 60), cornerRadii: [10, 0, 20, 0] };
  const loaded = parseProject(serializeProject({ ...createDocument(), objects: [r] })).objects[0];
  assert.deepEqual(loaded.cornerRadii, [10, 0, 20, 0]);
  assert.deepEqual(cornerRadii({ ...r, cornerRadii: undefined, cornerRadius: 5 }), [5, 5, 5, 5]);
  const commands = worldCommands(r);
  assert.equal(commands.filter(c => c.type === 'C').length, 2, 'só os cantos com raio viram curva');
  assert.ok(commands.some(c => c.type === 'L' && c.x === 100 && c.y === 0), 'canto superior direito continua reto');
  assert.throws(() => parseProject(JSON.stringify({ ...createDocument(), objects: [{ ...r, cornerRadii: [1, 2] }] })), /Cantos/);
});

test('dimensão: o ponto trava sobre a borda mais próxima', () => {
  const edges = edgeSegments([rect(0, 0, 100, 50)]);
  assert.deepEqual(nearestEdge(edges, { x: 40, y: 3 }, 5), { x: 40, y: 0 });
  assert.equal(nearestEdge(edges, { x: 40, y: 20 }, 5), null);
  const ellipse = { ...createObject('ellipse', 0, 0, '#000000'), width: 100, height: 100 };
  const p = nearestEdge(edgeSegments([ellipse]), { x: 50, y: -2 }, 5)!;
  assert.ok(Math.abs(p.x - 50) < 1 && Math.abs(p.y) < 0.5, 'curvas também');
});

test('preferências: cadeados de proporção e de cantos', () => {
  const d = parseLayout(null);
  assert.equal(d.lockRatio, false); assert.equal(d.lockCorners, true);
  const custom = parseLayout(JSON.stringify({ ...d, lockRatio: true, lockCorners: false }));
  assert.equal(custom.lockRatio, true); assert.equal(custom.lockCorners, false);
});
