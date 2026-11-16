import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { VectorObject } from '../src/document/model.ts';
import { decodePath, filletCandidates, filletNodes, moveNodes, encodePath } from '../src/geometry/nodeGeometry.ts';
import { outlineSnap, snapOutline } from '../src/geometry/objectSnap.ts';
import { brushFalloff } from '../src/bitmap/brushFalloff.ts';

const rect = (id: string, x: number, y: number, w = 100, h = 100): VectorObject => ({ id, type: 'rectangle', name: id, x, y, width: w, height: h, fill: 'none', stroke: '#000000', strokeWidth: 1 });
const square: VectorObject = { id: 'p', type: 'path', name: 'Curva', x: 0, y: 0, width: 100, height: 100, pathSize: { width: 100, height: 100 }, fill: 'none', stroke: '#000', strokeWidth: 1,
  commands: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 100, y: 0 }, { type: 'L', x: 100, y: 100 }, { type: 'L', x: 0, y: 100 }, { type: 'Z' }] };

test('forma: arredondar canto de curva troca o nó por um arco tangente (Bézier de quarto de círculo)', () => {
  const path = decodePath(square);
  assert.deepEqual(filletCandidates(path), [0, 1, 2, 3]);
  const r = filletNodes(path, [1], 20);
  assert.equal(r.nodes.length, 5);
  const [a, b] = [r.nodes[1], r.nodes[2]];
  assert.deepEqual([a.x, a.y, b.x, b.y], [80, 0, 100, 20]);
  const k = 20 * 4 / 3 * Math.tan(Math.PI / 8);
  assert.ok(Math.abs(a.outgoing!.x - (80 + k)) < 1e-9 && Math.abs(b.incoming!.y - (20 - k)) < 1e-9);
  assert.deepEqual(filletCandidates(r), [0, 3, 4], 'os nós do arco não recebem outro ponto');
  // Vários cantos de uma vez, limitado à metade do lado: o quadrado vira círculo.
  const all = filletNodes(path, [0, 1, 2, 3], 999);
  assert.equal(all.nodes.length, 8);
  assert.ok(encodePath(all));
});

test('forma: refletir nós move os outros nós marcados espelhados', () => {
  const path = decodePath(square), delta = { x: 10, y: 5 };
  const next = moveNodes(moveNodes(path, [1], delta), [0], { x: -delta.x, y: delta.y });
  assert.deepEqual([next.nodes[1].x, next.nodes[1].y, next.nodes[0].x, next.nodes[0].y], [110, 5, -10, 5]);
});

test('encaixe em objetos: encosta a borda no contorno real, inclusive em curvas', () => {
  const moving = snapOutline([rect('a', 0, 0)])!, target = snapOutline([rect('b', 103, 20)])!;
  const s = outlineSnap(moving, [target], 0, 0, 8)!;
  assert.ok(Math.abs(s.dx - 3) < 1e-9 && Math.abs(s.dy) < 1e-9);
  assert.equal(outlineSnap(moving, [target], -20, 0, 8), null, 'longe demais: sem encaixe');
  const circle: VectorObject = { ...rect('c', 106, 0), type: 'ellipse' };
  const c = outlineSnap(moving, [snapOutline([circle])!], 0, 0, 8)!;
  assert.ok(Math.abs(c.dx - 6) < 0.05 && Math.abs(c.dy) < 1, 'encosta no ponto mais à esquerda do círculo');
});

test('pincel de máscara: borda suave conforme a dureza', () => {
  assert.equal(brushFalloff(0.3, 0.5), 1);
  assert.equal(brushFalloff(1, 0.5), 0);
  assert.equal(brushFalloff(0.75, 0.5), 0.5);
  assert.ok(brushFalloff(0.6, 0) > brushFalloff(0.7, 0));
});

test('rastreio: cores de anti-serrilhado não viram camadas e o quadrado sai com cantos vivos e 4 retas', async () => {
  const { traceBitmap } = await import('../src/bitmap/bitmapTrace.ts');
  const width = 120, height = 120, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // Quadrado preto de 20 a 100 com uma faixa de 3 px em dois tons de cinza (como o anti-serrilhado ampliado).
    const d = Math.max(Math.abs(x + 0.5 - 60), Math.abs(y + 0.5 - 60)), v = d < 40 ? 0 : d < 41.5 ? 80 : d < 43 ? 170 : 255;
    data.set([v, v, v, 255], (y * width + x) * 4);
  }
  const layers = traceBitmap({ width, height, data }, { colors: 4, smoothing: 35, cornerAngle: 55, removeBackground: true, despeckle: 1 });
  assert.equal(layers.length, 1, 'só o preto (os cinzas da borda são absorvidos)');
  const c = layers[0].contours[0];
  assert.deepEqual(c.map(k => k.type).join(''), 'MLLLLZ');
});

test('remover fundo: fundo liso some, objeto fica; miolo da mesma cor só sai com "áreas internas"', async () => {
  const { removeBackground } = await import('../src/bitmap/removeBackground.ts');
  const width = 80, height = 80, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const r = Math.hypot(x - 40, y - 40), ring = r < 30 && r > 12;
    data.set(ring ? [200, 20, 30, 255] : [250, 250, 248, 255], (y * width + x) * 4);
  }
  const a = removeBackground({ width, height, data }, { tolerance: 22, inner: false, softness: 0 });
  assert.equal(a[0], 0, 'canto (fundo) transparente');
  assert.equal(a[40 * width + 20], 255, 'anel (objeto) opaco');
  assert.equal(a[40 * width + 40], 255, 'miolo fechado fica sem "áreas internas"');
  const b = removeBackground({ width, height, data }, { tolerance: 22, inner: true, softness: 0 });
  assert.equal(b[40 * width + 40], 0, 'com "áreas internas" o miolo também sai');
});

test('social media: carrossel cria slides encostados lado a lado, agrupados, no tamanho oficial', async () => {
  const { socialFormats, socialFrames } = await import('../src/workspace/socialMedia.ts');
  const story = socialFormats.find(f => f.id === 'story')!;
  assert.deepEqual([story.width, story.height], [1080, 1920]);
  const frames = socialFrames(socialFormats.find(f => f.id === 'feed45')!, 3, 100, 0);
  assert.deepEqual(frames.map(f => [f.x, f.width, f.height]), [[100, 1080, 1350], [1180, 1080, 1350], [2260, 1080, 1350]]);
  assert.ok(frames.every(f => f.groupPath?.[0] === frames[0].groupPath?.[0]));
  assert.equal(socialFrames(story, 1, 0, 0)[0].groupPath, undefined);
});

test('remover fundo com IA: entrada do modelo e firmeza da borda', async () => {
  const { aiInput, aiAlpha } = await import('../src/bitmap/removeBackground.ts');
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
  const t = aiInput({ width: 2, height: 1, data });
  assert.deepEqual([...t].map(v => Math.round(v * 1000) / 1000), [0.515, -0.485, -0.456, 0.544, -0.406, -0.406]);
  const m = new Uint8ClampedArray([0, 40, 128, 220, 255]);
  assert.deepEqual([...aiAlpha(m, 0)], [0, 40, 128, 220, 255]);
  const hard = [...aiAlpha(m, 80)];
  assert.ok(hard[1] === 0 && hard[3] === 255 && Math.abs(hard[2] - 128) <= 2);
});
