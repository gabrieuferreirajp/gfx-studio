import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPathObject, dragHandle, pathData } from '../src/geometry/pathGeometry.ts';
import { closestSegmentParameter, convertNode, decodePath, encodePath, insertNode, moveHandle, moveNode, pointOnSegment, removeNode, type EditablePath } from '../src/geometry/nodeGeometry.ts';
import { createDocument, createObject, documentReducer } from '../src/document/model.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { createHistory, historyReducer, isDirty } from '../src/state/history.ts';
import { screenToDocument } from '../src/document/viewport.ts';

const approx = (a: { x: number; y: number }, b: { x: number; y: number }) => { assert.ok(Math.abs(a.x - b.x) < 1e-7, `${a.x} ≠ ${b.x}`); assert.ok(Math.abs(a.y - b.y) < 1e-7, `${a.y} ≠ ${b.y}`); };
function fixture(closed = false) {
  return createPathObject([dragHandle({ x: 100, y: 100 }, { x: 150, y: 50 }), dragHandle({ x: 300, y: 200 }, { x: 350, y: 250 }), { x: 450, y: 100 }], closed, '#7774e7');
}
test('decodificação preserva âncoras, alças e fechamento sem nó de fechamento duplicado', () => {
  for (const closed of [false, true]) {
    const object = fixture(closed), path = decodePath(object);
    assert.equal(path.nodes.length, 3); assert.equal(path.closed, closed);
    approx(path.nodes[0], { x: 100, y: 100 });
    approx(path.nodes[1].incoming!, { x: 250, y: 150 });
    const recovered = decodePath({ ...object, ...encodePath(path)! });
    assert.equal(recovered.nodes.length, 3);
    for (let s = 0; s < (closed ? 3 : 2); s++) for (const t of [0, .2, .5, .8, 1]) approx(pointOnSegment(path, s, t), pointOnSegment(recovered, s, t));
  }
});
test('editar objeto redimensionado usa coordenadas do documento e mantém os demais nós', () => {
  const object = { ...fixture(), x: -200, y: 80, width: 700, height: 100 };
  const path = decodePath(object), original = structuredClone(path);
  const moved = moveNode(path, 1, { x: path.nodes[1].x + 25, y: path.nodes[1].y - 30 });
  approx(moved.nodes[1].incoming!, { x: path.nodes[1].incoming!.x + 25, y: path.nodes[1].incoming!.y - 30 });
  assert.deepEqual(moved.nodes[0], path.nodes[0]); assert.deepEqual(moved.nodes[2], path.nodes[2]);
  const result = decodePath({ ...object, ...encodePath(moved)! });
  result.nodes.forEach((n, i) => approx(n, moved.nodes[i]));
  assert.deepEqual(path, original);
});
test('nó suave alinha alças preservando comprimento oposto; canto libera alças', () => {
  const path = decodePath(fixture());
  const smooth = convertNode({ ...path, nodes: path.nodes.map(n => ({ ...n, mode: 'corner' as const })) }, 1, 'smooth');
  const original = smooth.nodes[1], length = Math.hypot(original.incoming!.x - original.x, original.incoming!.y - original.y);
  const moved = moveHandle(smooth, 1, 'outgoing', { x: original.x, y: original.y + 60 });
  approx(moved.nodes[1].incoming!, { x: original.x, y: original.y - length });
  const corner = convertNode(moved, 1, 'corner');
  const independent = moveHandle(corner, 1, 'outgoing', { x: original.x + 70, y: original.y });
  assert.deepEqual(independent.nodes[1].incoming, corner.nodes[1].incoming);
  assert.equal(independent.nodes[1].mode, 'corner');
});
test('converter extremos de linha em suaves cria alças úteis sem alterar âncoras', () => {
  let path = decodePath(createPathObject([{ x: 0, y: 0 }, { x: 300, y: 0 }], false, '#000000'));
  path = convertNode(path, 0, 'smooth'); path = convertNode(path, 1, 'smooth');
  approx(path.nodes[0].outgoing!, { x: 100, y: 0 }); approx(path.nodes[1].incoming!, { x: 200, y: 0 });
  assert.equal(path.nodes[0].incoming, undefined); assert.equal(path.nodes[1].outgoing, undefined);
});
test('subdivisão de Casteljau preserva exatamente a curva para qualquer parâmetro', () => {
  const path = decodePath(fixture());
  for (const split of [.01, .2, .5, .9]) {
    const inserted = insertNode(path, 0, split);
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      approx(pointOnSegment(path, 0, split * t), pointOnSegment(inserted, 0, t));
      approx(pointOnSegment(path, 0, split + (1 - split) * t), pointOnSegment(inserted, 1, t));
    }
    assert.equal(inserted.nodes[1].mode, 'smooth');
  }
});
test('inserir no segmento de fechamento mantém caminho fechado e curva original', () => {
  const path = decodePath(fixture(true));
  const inserted = insertNode(path, 2, .4);
  assert.equal(inserted.closed, true); assert.equal(inserted.nodes.length, 4);
  for (const t of [0, .25, .5, 1]) {
    approx(pointOnSegment(path, 2, .4 * t), pointOnSegment(inserted, 2, t));
    approx(pointOnSegment(path, 2, .4 + .6 * t), pointOnSegment(inserted, 3, t));
  }
  assert.equal(decodePath({ ...fixture(true), ...encodePath(inserted)! }).nodes.length, 4);
});
test('inserção em linha e busca de ponto mais próximo funcionam em retas e curvas', () => {
  const line = decodePath(createPathObject([{ x: 0, y: 50 }, { x: 200, y: 50 }], false, '#000000'));
  approx(insertNode(line, 0, .25).nodes[1], { x: 50, y: 50 });
  assert.equal(closestSegmentParameter(line, 0, { x: 80, y: 60 }), .4);
  const curve = decodePath(fixture());
  const t = closestSegmentParameter(curve, 0, pointOnSegment(curve, 0, .37));
  assert.ok(Math.abs(t - .37) < 1e-6);
});
test('remoção reconecta vizinhos, conserva fechamento e protege mínimo de dois nós', () => {
  for (const closed of [false, true]) for (const index of [0, 1, 2]) {
    const path = decodePath(fixture(closed)), next = removeNode(path, index);
    assert.equal(next.nodes.length, 2); assert.equal(next.closed, closed);
    assert.equal(removeNode(next, 0), next);
    if (!closed) { assert.equal(next.nodes[0].incoming, undefined); assert.equal(next.nodes[1].outgoing, undefined); }
    assert.doesNotThrow(() => serializeProject({ ...createDocument(), objects: [{ ...fixture(closed), ...encodePath(next)! }] }));
  }
});
test('nós coincidentes em caminho fechado continuam distintos após salvar', () => {
  let path = decodePath(fixture(true));
  path = moveNode(path, 2, path.nodes[0]);
  const object = { ...fixture(true), ...encodePath(path)! };
  const recovered = parseProject(serializeProject({ ...createDocument(), objects: [object] }));
  assert.equal(decodePath(recovered.objects[0]).nodes.length, 3);
});
test('edições agrupadas têm undo/redo, identidade e estilo preservados', () => {
  const object = fixture(), document = { ...createDocument(), objects: [object] };
  let state = historyReducer(createHistory(document), { type: 'begin' });
  const path = decodePath(object);
  for (let x = 101; x <= 200; x++) state = historyReducer(state, { type: 'edit', action: { type: 'path-edit', id: object.id, geometry: encodePath(moveNode(path, 0, { x, y: 100 }))! } });
  state = historyReducer(state, { type: 'commit' });
  assert.equal(state.past.length, 1); assert.equal(isDirty(state), true);
  assert.equal(state.present.objects[0].id, object.id); assert.equal(state.present.objects[0].stroke, object.stroke);
  const edited = state.present;
  state = historyReducer(state, { type: 'undo' }); assert.deepEqual(state.present, document); assert.equal(isDirty(state), false);
  state = historyReducer(state, { type: 'redo' }); assert.deepEqual(state.present, edited);
});
test('persistência mantém modos, coordenadas e curvas; valida metadados sem quebrar arquivos antigos', () => {
  const object = fixture(true);
  let path = convertNode(decodePath(object), 0, 'smooth');
  path = insertNode(path, 1, .6); path = convertNode(path, 1, 'corner');
  const edited = { ...object, ...encodePath(path)! };
  const document = { ...createDocument(), objects: [edited] };
  assert.deepEqual(parseProject(serializeProject(document)), document);
  assert.doesNotThrow(() => parseProject(serializeProject({ ...document, objects: [object] })));
  for (const nodeModes of [['smooth'], ['invalid', 'corner', 'smooth', 'corner'], null]) assert.throws(() => parseProject(JSON.stringify({ ...document, objects: [{ ...edited, nodeModes }] })));
});
test('zoom/pan preservam deslocamento de nó e limites de geometria são respeitados', () => {
  const object = fixture(), path = decodePath(object);
  for (const zoom of [.1, 1, 32]) {
    const view = { x: -400, y: 80, zoom };
    const start = screenToDocument(view, 300, 400), end = screenToDocument(view, 300 + 15 * zoom, 400 - 20 * zoom);
    const moved = moveNode(path, 0, { x: path.nodes[0].x + end.x - start.x, y: path.nodes[0].y + end.y - start.y });
    approx(moved.nodes[0], { x: 115, y: 80 });
  }
  assert.equal(encodePath(moveNode(path, 0, { x: 30000, y: 100 })), null);
  const rectangle = createObject('rectangle', 0, 0, '#ffffff');
  const result = documentReducer({ ...createDocument(), objects: [rectangle] }, { type: 'path-edit', id: rectangle.id, geometry: encodePath(path)! });
  assert.equal(result.objects[0], rectangle);
});
