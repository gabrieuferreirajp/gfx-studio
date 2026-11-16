import test from 'node:test';
import assert from 'node:assert/strict';
import { bitmapEnvelopeMap, perspectiveSides, restoreWarp, srcCheck, storeWarp, warpMesh } from '../src/bitmap/bitmapEnvelope.ts';
import { moveEnvelopeNodes, rectEnvelope } from '../src/geometry/envelope.ts';
import { createDocument } from '../src/document/model.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';

const box = { x: 0, y: 0, width: 200, height: 100 };
const close = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('envelope intocado: o bitmap fica igual (identidade)', () => {
  const map = bitmapEnvelopeMap(rectEnvelope(box));
  for (const [u, v] of [[0, 0], [0.3, 0.7], [1, 1], [0.5, 0.5]]) { const p = map(u, v); close(p.x, u * 200); close(p.y, v * 100); }
});
test('cantos movidos no modo reta: perspectiva verdadeira (homografia)', () => {
  // Lado direito encolhe para o centro, como uma parede vista de lado.
  let s = moveEnvelopeNodes(rectEnvelope(box), [2], { x: 0, y: 30 }, 'line');
  s = perspectiveSides(moveEnvelopeNodes(s, [4], { x: 0, y: -30 }, 'line'), [0, 1, 2]);
  const map = bitmapEnvelopeMap(s);
  // O nó do meio de cima fica na reta entre os cantos, além do meio geométrico (perspectiva).
  close(s.nodes[1].y, s.nodes[1].x * 30 / 200, 1e-9); assert.ok(s.nodes[1].x > 100);
  close(map(1, 0).y, 30); close(map(1, 1).y, 70); close(map(0, 0).x, 0);
  // Retas da imagem continuam retas: pontos de uma diagonal ficam alinhados.
  const a = map(0, 0), b = map(0.5, 0.5), c = map(1, 1);
  close((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x), 0, 1e-6);
  // Encurtamento: o meio da imagem (u = 0,5) fica além do meio geométrico, no lado que se afasta.
  assert.ok(map(0.5, 0.5).x > 100, 'perspectiva deveria empurrar o centro para o lado mais distante');
  // Bordas de cima/baixo continuam retas.
  const t = map(0.25, 0); close(t.y, t.x * 30 / 200, 1e-6);
});
test('lado curvo: o nó do meio puxa a borda', () => {
  const s = moveEnvelopeNodes(rectEnvelope(box), [1], { x: 0, y: -20 }, 'arc');
  close(bitmapEnvelopeMap(s)(0.5, 0).y, -20, 1e-3);
  const { bounds } = warpMesh(bitmapEnvelopeMap(s), 16);
  assert.ok(bounds.y < -19 && bounds.height > 119);
});
test('envelope guardado acompanha mover e redimensionar o bitmap e volta do arquivo', () => {
  const s = moveEnvelopeNodes(rectEnvelope(box), [2], { x: 0, y: 30 }, 'line');
  const at = { x: 0, y: 0, width: 200, height: 100 }, warp = storeWarp(PNG, s, box, at, 'line', PNG);
  const doc = createDocument();
  doc.objects = [{ id: 'b', type: 'image', name: 'Bitmap', x: 50, y: 20, width: 400, height: 200, fill: 'none', src: PNG, warp }];
  const back = parseProject(serializeProject(doc)).objects[0];
  const r = restoreWarp(back)!;
  assert.ok(r, 'envelope deveria ser restaurado');
  close(r.box.x, 50); close(r.box.width, 400); close(r.shape.nodes[2].y, 20 + 30 * 2);
  assert.equal(r.mode, 'line'); assert.equal(r.original, PNG);
  // Outra ferramenta trocou a imagem: o envelope guardado deixa de valer.
  assert.equal(restoreWarp({ ...back, src: PNG.replace('A', 'B') }), null);
  assert.notEqual(srcCheck(PNG), srcCheck(PNG + 'x'));
});
