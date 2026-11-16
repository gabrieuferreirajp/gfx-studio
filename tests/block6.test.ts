import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, documentReducer, type VectorObject } from '../src/document/model.ts';
import { refreshLinks } from '../src/geometry/links.ts';
import { applyMatrix, duplicateObjects, boundsOf } from '../src/geometry/objectTransforms.ts';
import { worldCommands } from '../src/geometry/worldGeometry.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { performSweep, performContour } from '../src/geometry/effectsGeometry.ts';
import { placeLinked, separateEffects, separateLabel, effectSignature } from '../src/geometry/effectLinks.ts';
import { joinPaths, reverseCommands } from '../src/geometry/pathJoin.ts';
import { performCut } from '../src/geometry/cutGeometry.ts';
import { cropFromGeometry, cropWorld, imageAsPath } from '../src/bitmap/imageCrop.ts';
import { decodePath, encodePath, moveNodes } from '../src/geometry/nodeGeometry.ts';
import { createPathObject } from '../src/geometry/pathGeometry.ts';
import { historyReducer, createHistory } from '../src/state/history.ts';

const rect = (id: string, x: number, y: number, w = 100, h = 100): VectorObject => ({ id, type: 'rectangle', name: id, x, y, width: w, height: h, fill: 'none', stroke: '#000000', strokeWidth: 1 });
const apply = (objects: VectorObject[]) => refreshLinks(documentReducer({ ...createDocument(), objects }, { type: 'set-objects', objects }));
const box = (o: VectorObject) => { const b = boundsOf([o]); return [b.x, b.y, b.width, b.height].map(v => Math.round(v)); };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function blockShadow(objects: VectorObject[], id: string, dx: number, dy: number) {
  const source = objects.find(o => o.id === id)!;
  const r = performSweep([source], [id], { mode: 'shadow', dx, dy, color: '#000000', shade: 0 });
  return placeLinked(objects, source, 'blockShadow', r.objects.filter(o => o.id !== id), { dx, dy, color: '#000000' }).objects;
}

test('bloquear sombra: forma varrida atrás do objeto, ligada a ele, como no CorelDRAW', () => {
  const objects = blockShadow([rect('a', 0, 0)], 'a', 100, 120);
  assert.deepEqual(objects.map(o => o.id === 'a' ? 'a' : o.name), ['Bloquear sombra', 'a'], 'sombra atrás do original, sem grupo');
  const shadow = objects[0];
  assert.equal(shadow.groupPath, undefined);
  assert.deepEqual(box(shadow), [0, 0, 200, 220]);
  assert.equal(shadow.effectOf!.id, 'a');
  // Mover o original leva a sombra junto (na hora, sem recalcular).
  let doc = apply(objects);
  doc = apply(applyMatrix(doc.objects, ['a'], [1, 0, 0, 1, 30, -10]));
  assert.deepEqual(box(doc.objects[0]), [30, -10, 200, 220]);
  assert.equal(doc.objects[0].effectOf!.stale, undefined);
  // Mover os dois juntos (ou duplicar) não desloca a sombra em dobro.
  doc = apply(applyMatrix(doc.objects, ['a', doc.objects[0].id], [1, 0, 0, 1, 10, 0]));
  assert.deepEqual(box(doc.objects[0]), [40, -10, 200, 220]);
  const copies = apply(duplicateObjects(doc.objects, doc.objects.map(o => o.id)).objects);
  const copyShadow = copies.objects.filter(o => o.effectOf).at(-1)!, copySource = copies.objects.find(o => o.id === copyShadow.effectOf!.id)!;
  assert.notEqual(copySource.id, 'a', 'a cópia da sombra segue a cópia do original');
  assert.deepEqual(box(copyShadow).map((v, i) => v - box(doc.objects[0])[i]), box(copySource).map((v, i) => v - box(doc.objects[1])[i]));
  // Redimensionar o original marca a sombra para ser refeita; apagar o original apaga a sombra.
  doc = apply(applyMatrix(doc.objects, ['a'], [2, 0, 0, 1, 0, 0]));
  assert.equal(doc.objects[0].effectOf!.stale, true);
  assert.equal(apply(doc.objects.filter(o => o.id !== 'a')).objects.length, 0);
});

test('separar (Ctrl+K) solta a sombra; menu mostra "Separar Bloquear sombra"; salva e abre com a ligação', () => {
  const objects = blockShadow([rect('a', 0, 0)], 'a', 50, 50), shadowId = objects[0].id;
  assert.equal(separateLabel(objects, [shadowId]), 'Separar Bloquear sombra');
  assert.equal(separateLabel(objects, ['a']), 'Separar Bloquear sombra');
  const reopened = parseProject(serializeProject({ ...createDocument(), objects }));
  assert.equal(reopened.objects[0].effectOf!.kind, 'blockShadow');
  const s = separateEffects(objects, [shadowId]);
  assert.deepEqual(s.pieces, [shadowId]);
  assert.equal(s.objects[0].effectOf, undefined);
  // Solta, a sombra não segue mais o original.
  const moved = apply(applyMatrix(s.objects, ['a'], [1, 0, 0, 1, 40, 0]));
  assert.deepEqual(box(moved.objects[0]), [0, 0, 150, 150]);
  assert.equal(separateLabel(s.objects, ['a']), null);
});

test('contorno ligado: passos para fora atrás do original, agrupados entre si e refeitos pela assinatura', () => {
  const a = rect('a', 0, 0);
  const r = performContour([a], ['a'], { direction: 'outside', steps: 3, offset: 5, endColor: '#ffffff' });
  const placed = placeLinked([a], a, 'contour', r.objects.filter(o => o.id !== 'a'), { direction: 'outside', steps: 3, offset: 5, endColor: '#ffffff' });
  assert.equal(placed.objects.length, 4);
  assert.equal(placed.objects.at(-1)!.id, 'a', 'contorno para fora fica atrás');
  assert.deepEqual(box(placed.objects[0]), [-15, -15, 130, 130]);
  assert.equal(new Set(placed.objects.slice(0, 3).map(o => o.groupPath?.at(-1))).size, 1, 'passos formam um grupo próprio');
  assert.equal(separateLabel(placed.objects, ['a']), 'Separar Grupo de contorno');
  assert.equal(effectSignature(a).shape, placed.objects[0].effectOf!.shape);
});

test('histórico: ajuste automático (amend) não cria etapa no Desfazer', () => {
  let h = createHistory(createDocument());
  h = historyReducer(h, { type: 'edit', action: { type: 'add', object: rect('a', 0, 0) } });
  const past = h.past.length;
  h = historyReducer(h, { type: 'amend', action: { type: 'add', object: rect('b', 0, 0) } });
  assert.equal(h.past.length, past);
  assert.equal(h.present.objects.length, 2);
});

test('linhas: começar na ponta de uma curva continua a curva e terminar no 1º ponto fecha a forma', () => {
  const line = (id: string, a: [number, number], b: [number, number]) => ({ ...createPathObject([{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }], false, '#000000'), id, strokeWidth: 2 });
  let objects: VectorObject[] = [line('l1', [0, 0], [100, 0])];
  let r = joinPaths(objects, line('l2', [100.5, 0.3], [100, 100]), 2)!;
  assert.equal(r.closed, false); assert.equal(r.objects.length, 1); assert.equal(r.id, 'l1');
  objects = r.objects;
  r = joinPaths(objects, line('l3', [100, 100], [0, 100]), 2)!; objects = r.objects;
  // Última linha volta ao primeiro ponto: fecha (Z) e vira uma forma.
  r = joinPaths(objects, line('l4', [0, 100], [0.4, 0.2]), 2)!;
  assert.equal(r.closed, true); assert.equal(r.objects.length, 1);
  const w = worldCommands(r.objects[0]);
  assert.equal(w.at(-1)!.type, 'Z');
  assert.deepEqual(w.filter(c => c.type !== 'Z').map(c => [Math.round((c as { x: number }).x), Math.round((c as { y: number }).y)]), [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]);
  assert.equal(r.objects[0].strokeWidth, 2, 'mantém a caneta da curva original');
  // Ponta inicial também serve (a curva existente é invertida) e linha solta não liga nada.
  const rev = joinPaths([line('m', [0, 0], [50, 0])], line('n', [0, 0], [0, 50]), 2)!;
  assert.deepEqual(worldCommands(rev.objects[0]).map(c => c.type === 'Z' ? 'Z' : `${Math.round(c.x)},${Math.round(c.y)}`), ['50,0', '0,0', '0,50']);
  assert.equal(joinPaths([line('m', [0, 0], [50, 0])], line('far', [300, 300], [400, 400]), 2), null);
  assert.equal(reverseCommands(reverseCommands(worldCommands(objects[0]))).length, worldCommands(objects[0]).length);
});

test('cortar bitmap: retângulo e laço criam recorte; a caixa da imagem passa a ser a parte visível', () => {
  const image: VectorObject = { id: 'img', type: 'image', name: 'foto.jpg', x: 0, y: 0, width: 200, height: 100, fill: 'none', src: png };
  let r = performCut([image], ['img'], 'crop', { crop: { x: 50, y: -10, width: 100, height: 80 } });
  const cut = r.objects[0];
  assert.equal(cut.src, png, 'a imagem continua inteira (pode ser reajustada na ferramenta Forma)');
  assert.deepEqual(box(cut), [50, 0, 100, 70]);
  // Laço: apagar um triângulo de dentro.
  r = performCut([image], ['img'], 'crop', { lasso: { points: [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 10, y: 60 }], mode: 'remove' } });
  assert.ok(r.objects[0].crop!.length > 6);
  assert.deepEqual(box(r.objects[0]), [0, 0, 200, 100]);
  // Fora da área (manter): a imagem sai, como os vetores.
  r = performCut([image, rect('r', 500, 500)], ['img', 'r'], 'crop', { crop: { x: 490, y: 490, width: 200, height: 200 } });
  assert.deepEqual(r.objects.map(o => o.type), ['path']);
  // Laço manter em forma vetorial.
  r = performCut([rect('a', 0, 0)], ['a'], 'crop', { lasso: { points: [{ x: -10, y: -10 }, { x: 50, y: -10 }, { x: -10, y: 50 }], mode: 'keep' } });
  assert.deepEqual(box(r.objects[0]), [0, 0, 40, 40]);
  // Salvar e abrir mantém o recorte.
  const saved = parseProject(serializeProject({ ...createDocument(), objects: [cut] }));
  assert.deepEqual(saved.objects[0].crop, cut.crop);
});

test('ferramenta Forma em bitmap: os 4 cantos viram nós e mover um nó ajusta o recorte', () => {
  const image: VectorObject = { id: 'img', type: 'image', name: 'foto.png', x: 10, y: 20, width: 200, height: 100, fill: 'none', src: png, transform: [1, 0, 0, 1, 5, 5] };
  const path = decodePath(imageAsPath(image));
  assert.equal(path.nodes.length, 4);
  const moved = moveNodes(path, [2], { x: -50, y: -40 });
  const crop = cropFromGeometry(image, encodePath(moved)!);
  const edited = { ...image, crop };
  const world = cropWorld(edited).filter(c => c.type !== 'Z').map(c => [Math.round((c as { x: number }).x), Math.round((c as { y: number }).y)]);
  assert.deepEqual(world, [[15, 25], [215, 25], [165, 85], [15, 125], [15, 25]]);
  assert.deepEqual(box(edited), [15, 25, 200, 100]);
});

test('exportar: bitmap recortado sai com clipPath no SVG e recorte W* n no PDF', async () => {
  const { toSvg, toPdf } = await import('../src/io/exporters.ts');
  const image: VectorObject = { id: 'img', type: 'image', name: 'foto', x: 0, y: 0, width: 200, height: 100, fill: 'none', src: png, crop: [{ type: 'M', x: 0.25, y: 0 }, { type: 'L', x: 0.75, y: 0 }, { type: 'L', x: 0.5, y: 1 }, { type: 'Z' }] };
  const scene = { objects: [image], area: { x: 0, y: 0, width: 200, height: 100 } };
  assert.match(toSvg(scene), /<clipPath id="iclip-img"><path d="M 50 0 L 150 0 L 100 100 Z"/);
  const pdf = new TextDecoder('latin1').decode(toPdf(scene, new Map([['img', { width: 1, height: 1, jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }]])));
  assert.match(pdf, /50 0 m\s*150 0 l\s*100 100 l\s*h\s*W\* n 200 0 0 -100 0 100 cm \/Im1 Do Q/);
});
