import test from 'node:test';
import assert from 'node:assert/strict';
import type { PathCommand } from '../src/document/model.ts';
import { addEnvelopeNode, applyEnvelope, deleteEnvelopeNode, envelopeFromShape, moveEnvelopeNodes, oppositeNode, presetEnvelope, rectEnvelope, reshapeSides, signature } from '../src/geometry/envelope.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { createDocument } from '../src/document/model.ts';

const box = { x: 0, y: 0, width: 100, height: 50 };
const square: PathCommand[] = [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 100, y: 0 }, { type: 'L', x: 100, y: 50 }, { type: 'L', x: 0, y: 50 }, { type: 'Z' }];
const points = (c: PathCommand[]) => c.flatMap(x => x.type === 'Z' ? [] : [{ x: x.x, y: x.y }]);
const close = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);

test('envelope intocado mantém a forma em todos os mapeamentos', () => {
  for (const mapping of ['original', 'putty', 'horizontal', 'vertical'] as const) {
    const out = points(applyEnvelope(square, box, rectEnvelope(box), mapping));
    for (const p of out) { assert.ok(p.x > -1e-6 && p.x < 100 + 1e-6); assert.ok(p.y > -1e-6 && p.y < 50 + 1e-6); }
    close(out[0].x, 0); close(out[0].y, 0); assert.ok(out.some(p => Math.abs(p.x - 100) < 1e-6 && Math.abs(p.y - 50) < 1e-6));
  }
});
test('arco simples: o lado passa pelo nó do meio e os cantos ficam', () => {
  const s = moveEnvelopeNodes(rectEnvelope(box), [1], { x: 0, y: -20 }, 'arc');
  const out = applyEnvelope(square, box, s, 'original');
  const top = points(out).filter(p => Math.abs(p.x - 50) < 1e-6);
  assert.ok(top.some(p => Math.abs(p.y + 20) < 1e-6), 'topo deveria subir 20 no meio');
  assert.ok(s.nodes[0].c1 && s.nodes[1].c1, 'lados em arco ganham alças');
});
test('modo reta: lados retos; Ctrl move o nó oposto junto e Shift espelha', () => {
  const same = moveEnvelopeNodes(rectEnvelope(box), [1], { x: 0, y: -10 }, 'line', 'same');
  close(same.nodes[5].y, 40); assert.equal(same.nodes[0].c1, undefined);
  const mirror = moveEnvelopeNodes(rectEnvelope(box), [3], { x: 10, y: 0 }, 'line', 'mirror');
  close(mirror.nodes[7].x, -10);
  assert.equal(oppositeNode(rectEnvelope(box), 0).index, 6);
});
test('nós: adicionar no lado e excluir; cantos não podem ser excluídos', () => {
  const s = addEnvelopeNode(rectEnvelope(box), 0, 0.5);
  assert.equal(s.nodes.length, 9); assert.deepEqual(s.corners, [0, 3, 5, 7]); close(s.nodes[1].t, 0.25);
  assert.equal(deleteEnvelopeNode(s, 3), null);
  assert.equal(deleteEnvelopeNode(s, 1)!.nodes.length, 8);
  // Nó novo num lado reto não muda o resultado.
  assert.deepEqual(points(applyEnvelope(square, box, s, 'original')).map(p => Math.round(p.x * 1e6)), points(applyEnvelope(square, box, rectEnvelope(box), 'original')).map(p => Math.round(p.x * 1e6)));
});
test('predefinição, arco duplo e envelope a partir de uma forma', () => {
  const p = presetEnvelope(box, 'arcUp'); assert.ok(p.nodes[1].y < 0);
  const d = reshapeSides(moveEnvelopeNodes(rectEnvelope(box), [1], { x: 0, y: -10 }, 'free'), 'doubleArc', [0]);
  assert.ok(d.nodes[0].c1 && d.nodes[1].c1);
  const from = envelopeFromShape([{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 0, y: 10 }, { type: 'L', x: 20, y: 10 }, { type: 'L', x: 20, y: 0 }, { type: 'Z' }], box)!;
  assert.equal(from.nodes.length, 4); close(from.nodes[from.corners[2]].x, 100); close(from.nodes[from.corners[2]].y, 50);
});
test('manter linhas e envelope guardado no arquivo', () => {
  const s = moveEnvelopeNodes(rectEnvelope(box), [1], { x: 0, y: -20 }, 'arc');
  const kept = applyEnvelope(square, box, s, 'original', true);
  assert.equal(kept.filter(c => c.type === 'C').length, 4);
  const doc = createDocument(), commands = kept.map(c => c.type === 'Z' ? c : c.type === 'C' ? { ...c, y1: c.y1 + 20, y2: c.y2 + 20, y: c.y + 20 } : { ...c, y: c.y + 20 });
  doc.objects = [{ id: 'a', type: 'path', name: 'Curva', x: 0, y: 0, width: 100, height: 70, pathSize: { width: 100, height: 70 }, commands, fill: '#000000', envelope: { id: 'e', source: square, nodes: s.nodes, corners: s.corners, box, frame: [1, 0, 0, 1, 0, 20], mode: 'arc', mapping: 'original', keepLines: true, check: signature(commands) } }];
  const back = parseProject(serializeProject(doc)).objects[0];
  assert.equal(back.envelope?.check, signature(back.commands));
  assert.equal(back.envelope?.mode, 'arc'); assert.equal(back.envelope?.nodes.length, 8);
});
