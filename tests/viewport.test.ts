import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitViewport, screenToDocument, zoomAt } from '../src/document/viewport.ts';
test('zoom mantém o ponto do documento sob o cursor, inclusive nos limites', () => {
  const view = { x: -300, y: 70, zoom: 1.25 };
  const before = screenToDocument(view, 283, 140);
  for (const zoom of [0.01, 0.1, 3.7, 32, 100]) {
    const next = zoomAt(view, 283, 140, zoom);
    const after = screenToDocument(next, 283, 140);
    assert.ok(Math.abs(before.x - after.x) < 1e-9);
    assert.ok(Math.abs(before.y - after.y) < 1e-9);
    assert.ok(next.zoom >= 0.1 && next.zoom <= 32);
  }
});
test('pan e escala preservam deslocamentos usados para desenhar e arrastar', () => {
  for (const zoom of [0.1, 1, 32]) {
    const view = { x: -450, y: 230, zoom };
    const a = screenToDocument(view, 100, 200);
    const b = screenToDocument(view, 100 + 20 * zoom, 200 + 40 * zoom);
    assert.ok(Math.abs(b.x - a.x - 20) < 1e-9);
    assert.ok(Math.abs(b.y - a.y - 40) < 1e-9);
  }
});
test('ajustar à tela centraliza a prancheta e respeita o limite de zoom', () => {
  const view = fitViewport(1000, 800, { width: 960, height: 640 });
  assert.equal(view.x + 960 * view.zoom / 2, 500);
  assert.equal(view.y + 640 * view.zoom / 2, 400);
  assert.equal(fitViewport(1, 1, { width: 960, height: 640 }).zoom, 0.1);
});
