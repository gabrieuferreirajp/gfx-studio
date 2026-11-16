import test from 'node:test';
import assert from 'node:assert/strict';
import { performBoolean } from '../src/geometry/booleanGeometry.ts';
import { booleanSelectionError } from '../src/geometry/booleanSelection.ts';
import { placeInside } from '../src/geometry/powerClip.ts';
import { clipContents } from '../src/geometry/objectTransforms.ts';
import type { VectorObject } from '../src/document/model.ts';

const rect = (id: string, x: number, y: number, w: number, h: number, fill = '#000000'): VectorObject => ({ id, type: 'rectangle', name: id, x, y, width: w, height: h, fill });
// Quadro com conteúdo (o conteúdo vem junto na seleção, como ao clicar no quadro) e uma forma solta.
const doc = placeInside([rect('frame', 0, 0, 100, 50), rect('photo', -20, -10, 140, 80, '#11aa77'), rect('shape', 80, 0, 60, 50, '#333333')], ['photo'], 'frame');
const ids = [...clipContents(doc, ['frame']), 'shape'];

test('Soldar forma com quadro PowerClip: liberado', () => assert.equal(booleanSelectionError(doc, ids), null));
for (const op of ['union', 'subtract', 'intersect'] as const) {
  test(`${op} com PowerClip: o conteúdo fica no lugar e passa para o resultado`, () => {
    const r = performBoolean(doc, ids, op), result = r.objects.find(o => o.id === r.resultId)!, photo = r.objects.find(o => o.id === 'photo')!;
    assert.ok(result, 'resultado'); assert.equal(photo.clipParent, result.id);
    assert.equal(photo.x, -20); assert.equal(photo.y, -10); assert.equal(photo.width, 140);
    assert.ok(r.objects.indexOf(photo) > r.objects.indexOf(result), 'conteúdo depois do quadro');
    assert.ok(!r.objects.some(o => o.id === 'frame'));
  });
}
test('objeto dentro do PowerClip sozinho continua recusado', () => assert.ok(booleanSelectionError(doc, ['photo', 'shape'])));
