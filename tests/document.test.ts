import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createObject, documentReducer } from '../src/document/model.ts';
test('objetos têm IDs únicos e operações preservam o documento anterior', () => {
  const initial = createDocument();
  const a = createObject('rectangle', 10, 20, '#7774e7');
  const b = createObject('ellipse', 30, 40, '#ffffff');
  assert.notEqual(a.id, b.id);
  const added = documentReducer(documentReducer(initial, { type: 'add', object: a }), { type: 'add', object: b });
  const moved = documentReducer(added, { type: 'update', id: a.id, patch: { x: 100, y: 200, width: 80, fill: '#000000' } });
  assert.equal(initial.objects.length, 0);
  assert.equal(added.objects[0].x, 10);
  assert.equal(moved.objects[0].id, a.id);
  assert.equal(moved.objects[0].width, 80);
  assert.equal(moved.objects[0].fill, '#000000');
  assert.equal(moved.objects[1], b);
  assert.deepEqual(documentReducer(moved, { type: 'delete', id: a.id }).objects, [b]);
});
test('dimensões inválidas são normalizadas e texto continua editável', () => {
  const object = createObject('text', 0, 0, '#000000');
  const document = documentReducer(createDocument(), { type: 'add', object });
  const updated = documentReducer(document, { type: 'update', id: object.id, patch: { width: -5, height: NaN, x: Infinity, text: '<script>texto</script>' } });
  assert.equal(updated.objects[0].width, 1);
  assert.equal(updated.objects[0].height, 48);
  assert.equal(updated.objects[0].x, 0);
  assert.equal(updated.objects[0].text, '<script>texto</script>');
});
