import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createObject, type VectorDocument } from '../src/document/model.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { activePage, deletePage, duplicatePage, goToPage, insertPage, movePage, pageCount, pageList, renamePage } from '../src/document/pages.ts';
import { createHistory, historyReducer, isDirty } from '../src/state/history.ts';
import { bendSegment, pointOnSegment, removeNodes, moveNodes, segmentToCurve, segmentToLine, type EditablePath } from '../src/geometry/nodeGeometry.ts';
import { bsplineNodes, threePointNodes } from '../src/geometry/curveTools.ts';
import { fitContents, placeInside } from '../src/geometry/powerClip.ts';
import { boundsOf } from '../src/geometry/objectTransforms.ts';

const rect = (x: number, y: number, w: number, h: number) => ({ ...createObject('rectangle', x, y, '#336699', '#000000'), width: w, height: h });
const apply = (doc: VectorDocument, state: Pick<VectorDocument, 'objects' | 'pages' | 'page'>): VectorDocument => ({ ...doc, ...state });
const roundTrip = (doc: VectorDocument) => parseProject(serializeProject(doc));

test('páginas: inserir, navegar, duplicar, renomear, mover e excluir', () => {
  const a = rect(0, 0, 10, 10);
  let doc: VectorDocument = { ...createDocument(), objects: [a] };
  assert.equal(pageCount(doc), 1);
  doc = apply(doc, insertPage(doc));
  assert.equal(pageCount(doc), 2); assert.equal(activePage(doc), 1); assert.deepEqual(doc.objects, []);
  assert.deepEqual(pageList(doc).map(p => p.name), ['Página 1', 'Página 2']);
  doc = goToPage(doc, 0);
  assert.deepEqual(doc.objects.map(o => o.id), [a.id]);
  assert.deepEqual(doc.pages![0].objects, [], 'a página ativa não é duplicada em pages');
  doc = apply(doc, duplicatePage(doc));
  assert.equal(pageCount(doc), 3); assert.equal(activePage(doc), 1);
  assert.equal(doc.objects.length, 1); assert.notEqual(doc.objects[0].id, a.id, 'cópia recebe novos ids');
  assert.equal(pageList(doc)[1].name, 'Página 1 (cópia)');
  doc = apply(doc, renamePage(doc, 2, '  Verso  '));
  assert.equal(pageList(doc)[2].name, 'Verso');
  doc = apply(doc, movePage(doc, 2, 0));
  assert.deepEqual(pageList(doc).map(p => p.name), ['Verso', 'Página 1', 'Página 1 (cópia)']);
  assert.equal(pageList(doc)[activePage(doc)].name, 'Página 1 (cópia)', 'a ativa continua ativa');
  doc = apply(doc, deletePage(doc));
  assert.equal(pageCount(doc), 2); assert.equal(pageList(doc)[activePage(doc)].name, 'Página 1');
  assert.throws(() => deletePage(apply(doc, deletePage(doc))), /pelo menos uma página/);
  // Persistência mantém páginas, nomes, página ativa e objetos de cada uma.
  const loaded = roundTrip(doc);
  assert.deepEqual(pageList(loaded), pageList(doc)); assert.equal(activePage(loaded), activePage(doc));
});

test('páginas: validação rejeita ids repetidos entre páginas e página ativa com objetos', () => {
  const a = rect(0, 0, 10, 10);
  let doc: VectorDocument = { ...createDocument(), objects: [a] };
  doc = apply(doc, insertPage(doc));
  const repeated = { ...doc, objects: [a], pages: doc.pages!.map((p, i) => i === 0 ? p : { ...p, objects: [] }) };
  assert.throws(() => parseProject(JSON.stringify(repeated)), /duplicados/);
  const wrong = { ...doc, pages: doc.pages!.map((p, i) => i === 1 ? { ...p, objects: [rect(1, 1, 2, 2)] } : p) };
  assert.throws(() => parseProject(JSON.stringify(wrong)), /Página ativa/);
  assert.throws(() => parseProject(JSON.stringify({ ...doc, page: 5 })));
});

test('histórico: navegar entre páginas não marca alteração nem entra no Desfazer', () => {
  let doc: VectorDocument = { ...createDocument(), objects: [rect(0, 0, 10, 10)] };
  doc = apply(doc, insertPage(doc));
  let state = createHistory(doc);
  state = historyReducer(state, { type: 'edit', action: { type: 'add', object: rect(5, 5, 5, 5) } });
  const first = doc.pages![0].id;
  state = historyReducer(state, { type: 'page', id: first });
  assert.equal(activePage(state.present), 0); assert.equal(state.present.objects.length, 1);
  assert.equal(state.past.length, 1, 'navegação não cria passo');
  state = historyReducer(state, { type: 'undo' });
  assert.equal(activePage(state.present), 0, 'desfazer continua na página visível');
  assert.equal(isDirty(state), false);
  assert.equal(pageList(state.present)[1].objects.length, 0, 'o objeto da página 2 foi desfeito');
});

const square: EditablePath = { closed: true, nodes: [{ x: 0, y: 0, mode: 'corner' }, { x: 100, y: 0, mode: 'corner' }, { x: 100, y: 100, mode: 'corner' }, { x: 0, y: 100, mode: 'corner' }] } as EditablePath;
test('nós: para curva, para linha, curvar arrastando, excluir e mover vários', () => {
  const curved = segmentToCurve(square, 0);
  assert.ok(Math.abs(curved.nodes[0].outgoing!.x - 100 / 3) < 1e-9 && curved.nodes[0].outgoing!.y === 0);
  assert.equal(segmentToLine(curved, 0).nodes[0].outgoing, undefined);
  const bent = bendSegment(square, 0, 0.5, { x: 0, y: -20 });
  const middle = pointOnSegment(bent, 0, 0.5)!;
  assert.ok(Math.abs(middle.x - 50) < 1e-6 && Math.abs(middle.y + 20) < 1e-6, 'o ponto arrastado acompanha o cursor');
  assert.equal(removeNodes(square, [1, 3]).nodes.length, 2);
  const moved = moveNodes(square, [0, 1], { x: 5, y: 7 });
  assert.deepEqual(moved.nodes.slice(0, 2).map(n => [n.x, n.y]), [[5, 7], [105, 7]]);
  assert.deepEqual([moved.nodes[2].x, moved.nodes[2].y], [100, 100]);
});

test('curvas: B-Spline começa e termina nas pontas; curva de 3 pontos passa pelo ponto do meio', () => {
  const nodes = bsplineNodes([{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }, { x: 150, y: 100 }], false);
  assert.deepEqual([nodes[0].x, nodes[0].y], [0, 0]); assert.deepEqual([nodes.at(-1)!.x, nodes.at(-1)!.y], [150, 100]);
  assert.equal(bsplineNodes([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], true).length, 3);
  const [a, b] = threePointNodes({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 40 });
  const mid = { x: (a.x + 3 * a.outgoing!.x + 3 * b.incoming!.x + b.x) / 8, y: (a.y + 3 * a.outgoing!.y + 3 * b.incoming!.y + b.y) / 8 };
  assert.ok(Math.abs(mid.x - 50) < 1e-9 && Math.abs(mid.y - 40) < 1e-9);
});

test('PowerClip dentro: conteúdo fica centralizado e visível no quadro', () => {
  const frame = rect(0, 0, 100, 100), content = rect(500, 500, 40, 20);
  const objects = fitContents(placeInside([content, frame], [content.id], frame.id), frame.id, 'center');
  const b = boundsOf(objects.filter(o => o.clipParent === frame.id));
  assert.ok(Math.abs(b.x + b.width / 2 - 50) < 1e-6 && Math.abs(b.y + b.height / 2 - 50) < 1e-6);
});
