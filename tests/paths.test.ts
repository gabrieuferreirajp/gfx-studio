import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, documentReducer } from '../src/document/model.ts';
import { boundedPoint, commandsToSvg, createPathObject, dragHandle, finishPathDraft, pathData, penCommands, shouldClose } from '../src/geometry/pathGeometry.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { createHistory, historyReducer, isDirty } from '../src/state/history.ts';
import { screenToDocument, zoomAt } from '../src/document/viewport.ts';

test('Linha conserva direção, segmentos horizontais/verticais e coordenadas SVG', () => {
  for (const [a, b] of [[{ x: 90, y: 80 }, { x: 10, y: 20 }], [{ x: 20, y: 30 }, { x: 120, y: 30 }], [{ x: 20, y: 30 }, { x: 20, y: 130 }]]) {
    const line = createPathObject([a, b], false, '#7774e7', 'Linha');
    assert.equal(pathData(line), `M ${a.x} ${a.y} L ${b.x} ${b.y}`);
    assert.ok(line.width >= 1 && line.height >= 1);
    assert.equal(line.fill, 'none');
    assert.equal(line.type, 'path');
  }
});
test('Caneta produz segmentos retos por clique e curvas por arraste com alças espelhadas', () => {
  const a = { x: 50, y: 50 }, b = { x: 150, y: 150 };
  assert.deepEqual(penCommands([a, b]), [{ type: 'M', ...a }, { type: 'L', ...b }]);
  const curved = dragHandle(b, { x: 180, y: 170 });
  assert.deepEqual(curved.incoming, { x: 120, y: 130 });
  assert.deepEqual(curved.outgoing, { x: 180, y: 170 });
  assert.equal(commandsToSvg(penCommands([a, curved, { x: 250, y: 50 }])), 'M 50 50 C 50 50 120 130 150 150 C 180 170 250 50 250 50');
});
test('fechar caminho usa Z e preserva tangente do primeiro e do último nó', () => {
  const nodes = [dragHandle({ x: 100, y: 100 }, { x: 130, y: 100 }), dragHandle({ x: 200, y: 200 }, { x: 200, y: 250 })];
  const open = penCommands(nodes);
  assert.equal(open.at(-1)?.type, 'C');
  const closed = penCommands(nodes, true);
  assert.deepEqual(closed.at(-2), { type: 'C', x1: 200, y1: 250, x2: 70, y2: 100, x: 100, y: 100 });
  assert.deepEqual(closed.at(-1), { type: 'Z' });
  assert.equal(penCommands([{ x: 0, y: 0 }, { x: 10, y: 10 }], true).at(-1)?.type, 'Z');
});
test('alvo de fechamento tem tolerância em pixels de tela em qualquer zoom', () => {
  const nodes = [{ x: 100, y: 100 }, { x: 200, y: 200 }];
  for (const zoom of [0.1, 1, 32]) {
    assert.equal(shouldClose(nodes, { x: 100 + 7 / zoom, y: 100 }, zoom), true);
    assert.equal(shouldClose(nodes, { x: 100 + 9 / zoom, y: 100 }, zoom), false);
  }
  assert.equal(shouldClose(nodes.slice(0, 1), nodes[0], 1), false);
});
test('movimentação e dimensões transformam comandos sem alterar IDs ou dados originais', () => {
  const path = createPathObject([{ x: 10, y: 20 }, { x: 110, y: 120 }], false, '#000000');
  const document = { ...createDocument(), objects: [path] };
  const moved = documentReducer(document, { type: 'update', id: path.id, patch: { x: 30, y: 40, width: 200, height: 50, stroke: '#ff0000', strokeWidth: 5 } }).objects[0];
  assert.equal(pathData(moved), 'M 30 40 L 230 90');
  assert.equal(moved.id, path.id);
  assert.equal(moved.commands, path.commands);
  assert.equal(pathData(path), 'M 10 20 L 110 120');
});
test('geometria construída após zoom/pan mantém posição no documento', () => {
  const view = zoomAt({ x: -100, y: 50, zoom: 1 }, 300, 200, 4);
  const a = screenToDocument(view, 300, 200), b = screenToDocument(view, 700, 600);
  assert.equal(pathData(createPathObject([a, b], false, '#000000')), 'M 400 150 L 500 250');
});
test('finalizar descarta rascunhos insuficientes; criar, mover e excluir são reversíveis', () => {
  let state = createHistory(createDocument());
  assert.equal(finishPathDraft([], 'pen', '#000000'), null);
  assert.equal(finishPathDraft([{ x: 10, y: 20 }], 'pen', '#000000'), null);
  assert.equal(finishPathDraft([{ x: 10, y: 20 }, { x: 10, y: 20 }], 'line', '#000000'), null);
  assert.equal(isDirty(state), false);
  assert.throws(() => createPathObject([{ x: 0, y: 0 }], false, '#000000'));
  const path = finishPathDraft([{ x: 20, y: 30 }, { x: 200, y: 100 }], 'pen', '#000000')!;
  state = historyReducer(state, { type: 'edit', action: { type: 'add', object: path } });
  assert.equal(state.past.length, 1);
  state = historyReducer(state, { type: 'begin' });
  for (let x = 21; x <= 100; x++) state = historyReducer(state, { type: 'edit', action: { type: 'update', id: path.id, patch: { x } } });
  state = historyReducer(state, { type: 'commit' });
  assert.equal(state.past.length, 2);
  state = historyReducer(state, { type: 'undo' });
  assert.equal(state.present.objects[0].x, 20);
  state = historyReducer(state, { type: 'undo' });
  assert.equal(state.present.objects.length, 0);
  state = historyReducer(state, { type: 'redo' });
  assert.deepEqual(state.present.objects[0], path);
  state = historyReducer(state, { type: 'edit', action: { type: 'delete', id: path.id } });
  state = historyReducer(state, { type: 'undo' });
  assert.deepEqual(state.present.objects[0], path);
});
test('persistência recupera linhas, curvas, fechamento, preenchimento e contorno', () => {
  const path = createPathObject([dragHandle({ x: 40, y: 60 }, { x: 70, y: 90 }), { x: 300, y: 250 }], true, '#abcdef');
  path.fill = '#7774e7'; path.strokeWidth = 7.5;
  const line = createPathObject([{ x: 100, y: 20 }, { x: 100, y: 300 }], false, '#222222', 'Linha');
  const document = { ...createDocument(), objects: [path, line] };
  assert.deepEqual(parseProject(serializeProject(document)), document);
});
test('importação rejeita comandos malformados, alças inválidas e estilos inseguros', () => {
  const path = createPathObject([{ x: 10, y: 20 }, { x: 100, y: 200 }], false, '#000000');
  for (const patch of [
    { commands: [{ type: 'L', x: 0, y: 0 }, { type: 'Z' }] },
    { commands: [{ type: 'M', x: 0, y: 0 }, { type: 'Q', x: 2, y: 2 }] },
    { commands: [{ type: 'M', x: 0, y: 0 }, { type: 'C', x: 2, y: 2, x1: '1', y1: 0, x2: 0, y2: 0 }] },
    { commands: [{ type: 'M', x: 0, y: 0 }, { type: 'Z' }, { type: 'L', x: 1, y: 1 }] },
    { pathSize: { width: 0, height: 1 } }, { stroke: 'url(x)' }, { strokeWidth: -1 }, { strokeWidth: 1001 },
  ]) assert.throws(() => parseProject(JSON.stringify({ ...createDocument(), objects: [{ ...path, ...patch }] })));
});
test('limites numéricos mantêm geometria e contornos serializáveis', () => {
  assert.deepEqual(boundedPoint({ x: -200, y: 20000 }), { x: -200, y: 10000 });
  assert.deepEqual(boundedPoint({ x: -20000, y: 0 }), { x: -10000, y: 0 });
  const node = dragHandle({ x: 0, y: 0 }, { x: 20000, y: 20000 });
  const path = createPathObject([node, { x: 10000, y: 10000 }], true, '#000000');
  const document = { ...createDocument(), objects: [path] };
  assert.doesNotThrow(() => serializeProject(document));
  const edited = documentReducer(document, { type: 'update', id: path.id, patch: { strokeWidth: Infinity } });
  assert.equal(edited.objects[0].strokeWidth, 2);
});
