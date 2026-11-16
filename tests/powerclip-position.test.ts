import test from 'node:test';
import assert from 'node:assert/strict';
import { centerIfOutside, placeInside } from '../src/geometry/powerClip.ts';
import type { VectorObject } from '../src/document/model.ts';

const rect = (id: string, x: number, y: number, w: number, h: number): VectorObject => ({ id, type: 'rectangle', name: id, x, y, width: w, height: h, fill: '#000' });
const frame = rect('f', 0, 0, 100, 100);

test('PowerClip: conteúdo sobre o quadro mantém a posição', () => {
  const out = centerIfOutside(placeInside([frame, rect('c', 80, 70, 50, 50)], ['c'], 'f'), 'f');
  const c = out.find(o => o.id === 'c')!;
  assert.equal(c.clipParent, 'f'); assert.equal(c.x, 80); assert.equal(c.y, 70); assert.equal(c.transform, undefined);
});
test('PowerClip: conteúdo fora do quadro é centralizado', () => {
  const out = centerIfOutside(placeInside([frame, rect('c', 300, 300, 20, 20)], ['c'], 'f'), 'f');
  const c = out.find(o => o.id === 'c')!, t = c.transform ?? [1, 0, 0, 1, 0, 0];
  assert.equal(c.x + t[4] + 10, 50); assert.equal(c.y + t[5] + 10, 50);
});
