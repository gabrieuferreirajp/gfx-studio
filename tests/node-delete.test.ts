import test from 'node:test';
import assert from 'node:assert/strict';
import { removeNodes, type EditablePath } from '../src/geometry/nodeGeometry.ts';

const n = (x: number, y: number) => ({ x, y, mode: 'cusp' as const });
// Dois contornos: um quadrado fechado e um traço aberto de 2 nós.
const path: EditablePath = { nodes: [n(0, 0), n(10, 0), n(10, 10), n(0, 10), n(20, 0), n(30, 0)], closed: false,
  contours: [{ start: 0, end: 4, closed: true }, { start: 4, end: 6, closed: false }] };

test('excluir nó de contorno com 2 nós remove o contorno (CorelDRAW)', () => {
  const r = removeNodes(path, [5]);
  assert.equal(r.nodes.length, 4); assert.equal(r.contours, undefined); assert.equal(r.closed, true);
});
test('excluir nós de vários contornos de uma vez', () => {
  const r = removeNodes(path, [1, 4]);
  assert.deepEqual(r.nodes.map(p => p.x), [0, 10, 0]);
});
test('excluir todos os nós deixa o caminho vazio (a curva é removida)', () => {
  assert.equal(removeNodes(path, [0, 1, 2, 3, 4, 5]).nodes.length, 0);
});
