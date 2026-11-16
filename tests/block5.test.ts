import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, documentReducer, type VectorObject } from '../src/document/model.ts';
import { anchorAt, anchorOn, connectorObject, refreshLinks } from '../src/geometry/links.ts';
import { applyMatrix, duplicateObjects } from '../src/geometry/objectTransforms.ts';
import { dimensionObjects } from '../src/geometry/dimension.ts';
import { approximateMeasure } from '../src/text/textLayout.ts';
import { worldCommands } from '../src/geometry/worldGeometry.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';

const rect = (id: string, x: number, y: number, w = 100, h = 60): VectorObject => ({ id, type: 'rectangle', name: id, x, y, width: w, height: h, fill: '#cccccc', stroke: '#000000', strokeWidth: 1 });
const ends = (o: VectorObject) => { const w = worldCommands(o).filter(c => c.type !== 'Z') as { x: number; y: number }[]; return [w[0], w.at(-1)!].map(p => [Math.round(p.x), Math.round(p.y)]); };
const apply = (objects: VectorObject[]) => refreshLinks(documentReducer({ ...createDocument(), objects }, { type: 'set-objects', objects }));
const base: VectorObject = { id: 'c', type: 'path', name: 'Conector', x: 0, y: 0, width: 1, height: 1, fill: 'none', stroke: '#000000', strokeWidth: 1 };

test('conector reto acompanha os dois objetos e ponta livre fica onde está', () => {
  const a = rect('a', 0, 0), b = rect('b', 300, 200);
  const from = anchorOn(a, { x: 100, y: 30 }), to = anchorOn(b, { x: 300, y: 230 });
  assert.deepEqual([from.u, from.v, to.u, to.v], [1, 0.5, 0, 0.5]);
  const c = connectorObject(base, { from, to, kind: 'straight' }, { x: 100, y: 30 }, { x: 300, y: 230 });
  assert.deepEqual(ends(c), [[100, 30], [300, 230]]);
  // Move o B 50 px para a direita e aumenta o A para o dobro da largura.
  let doc = apply([a, b, c]);
  doc = apply(applyMatrix(doc.objects, ['b'], [1, 0, 0, 1, 50, 0]));
  assert.deepEqual(ends(doc.objects.find(o => o.id === 'c')!), [[100, 30], [350, 230]]);
  doc = apply(applyMatrix(doc.objects, ['a'], [2, 0, 0, 1, 0, 0]));
  assert.deepEqual(ends(doc.objects.find(o => o.id === 'c')!), [[200, 30], [350, 230]]);
  // Nada mudou → o mesmo documento (sem etapa extra no Desfazer).
  assert.equal(refreshLinks(doc), doc);
  // Objeto apagado: a ponta fica no último ponto.
  doc = apply(doc.objects.filter(o => o.id !== 'b'));
  assert.deepEqual(ends(doc.objects.find(o => o.id === 'c')!), [[200, 30], [350, 230]]);
});

test('conector em ângulo reto sai pelos lados (H-V-H) e o arredondado tem curvas nos cantos', () => {
  const a = rect('a', 0, 0), b = rect('b', 300, 200), from = anchorOn(a, { x: 100, y: 30 }), to = anchorOn(b, { x: 300, y: 230 });
  const elbow = connectorObject(base, { from, to, kind: 'elbow' }, { x: 100, y: 30 }, { x: 300, y: 230 });
  assert.deepEqual(worldCommands(elbow).map(c => c.type === 'Z' ? 'Z' : `${c.type}${Math.round(c.x)},${Math.round(c.y)}`), ['M100,30', 'L200,30', 'L200,230', 'L300,230']);
  const round = connectorObject(base, { from, to, kind: 'rounded' }, { x: 100, y: 30 }, { x: 300, y: 230 });
  assert.equal(worldCommands(round).filter(c => c.type === 'C').length, 2);
  // Topo → base: saídas verticais (V-H-V).
  const down = connectorObject(base, { from: anchorOn(a, { x: 50, y: 60 }), to: anchorOn(b, { x: 350, y: 200 }), kind: 'elbow' }, { x: 50, y: 60 }, { x: 350, y: 200 });
  assert.deepEqual(worldCommands(down).map(c => c.type === 'Z' ? 'Z' : `${Math.round(c.x)},${Math.round(c.y)}`), ['50,60', '50,130', '350,130', '350,200']);
});

test('cota ligada refaz o valor e a posição quando o objeto muda de tamanho', () => {
  const a = rect('a', 0, 0, 96, 50);
  const parts = dimensionObjects({ x: 0, y: 50 }, { x: 96, y: 50 }, 20, 'mm', approximateMeasure, '#000000', { precision: 1 });
  const anchors = [anchorAt([a], { x: 0, y: 50 }, 0.5), anchorAt([a], { x: 96, y: 50 }, 0.5)];
  assert.ok(anchors.every(x => x.id === 'a'));
  const linked = parts.map(o => o.type === 'text' ? { ...o, dimLink: { a: anchors[0], b: anchors[1], offset: 20, unit: 'mm' as const, precision: 1, color: '#000000' } } : o);
  const text0 = linked.find(o => o.type === 'text')!;
  assert.equal(text0.text, '25,4 mm');
  let doc = apply([a, ...linked]);
  doc = apply(applyMatrix(doc.objects, ['a'], [2, 0, 0, 1, 0, 0]));
  const text = doc.objects.find(o => o.type === 'text')!;
  assert.equal(text.text, '50,8 mm');
  assert.equal(text.id, text0.id, 'mantém os IDs');
  assert.equal(doc.objects.length, 1 + parts.length);
  assert.ok(Math.abs(text.x + text.width / 2 - 96) < 1, 'texto centrado no meio da nova cota');
  // Arquivo: ligações sobrevivem a salvar/abrir.
  const reopened = parseProject(serializeProject(doc));
  assert.deepEqual(reopened.objects.find(o => o.type === 'text')!.dimLink!.a.id, 'a');
});

test('duplicar: ligações seguem para as cópias; sem o objeto ligado, a cópia vira linha comum', () => {
  const a = rect('a', 0, 0), b = rect('b', 300, 200);
  const c = connectorObject(base, { from: anchorOn(a, { x: 100, y: 30 }), to: anchorOn(b, { x: 300, y: 230 }), kind: 'straight' }, { x: 100, y: 30 }, { x: 300, y: 230 });
  const all = duplicateObjects([a, b, c], ['a', 'b', 'c']).objects.slice(3);
  const copy = all.find(o => o.connector)!;
  assert.deepEqual([copy.connector!.from.id, copy.connector!.to.id], [all[0].id, all[1].id]);
  const alone = duplicateObjects([a, b, c], ['c']).objects.at(-1)!;
  assert.equal(alone.connector, undefined);
  assert.throws(() => parseProject(JSON.stringify({ version: 1, id: 'x', name: 'x', artboard: { width: 10, height: 10 }, objects: [{ ...a, connector: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, kind: 'curva' } }] })), /Conector inválido/);
});

test('estilos de cor: criar da seleção, mudar a cor muda os ligados (todas as páginas) e vínculo quebra ao trocar a cor', async () => {
  const { stylesFromSelection, recolorStyle, deleteColorStyle, colorStyleUsage, paintWith } = await import('../src/document/colorStyles.ts');
  let n = 0; const uuid = () => `s${++n}`;
  const a = { ...rect('a', 0, 0), fill: '#00AA00', stroke: '#000000' }, b = { ...rect('b', 200, 0), fill: '#00aa00', stroke: 'none' }, c = { ...rect('c', 400, 0), fill: '#ff0000' };
  const other = { ...rect('d', 0, 0), fill: '#00aa00', fillStyle: 's1' };
  let doc = { ...createDocument(), objects: [a, b, c], pages: [{ id: 'p1', name: 'Página 1', objects: [] }, { id: 'p2', name: 'Página 2', objects: [other] }], page: 0 };
  const made = stylesFromSelection(doc, ['a', 'b'], uuid);
  assert.deepEqual(made.colorStyles.map(s => s.color), ['#00aa00', '#000000'], 'uma cor por estilo, sem repetir');
  assert.equal(made.linked, 3);
  doc = documentReducer(doc, { type: 'set-library', colorStyles: made.colorStyles, document: made.document });
  assert.equal(colorStyleUsage(doc, doc.colorStyles![0]), 3, 'a, b e o objeto da outra página');
  // b ganha outra cor por fora (paleta): deixa de acompanhar.
  doc = documentReducer(doc, { type: 'set-objects', objects: doc.objects.map(o => o.id === 'b' ? { ...o, fill: '#123456' } : o) });
  const r = recolorStyle(doc, 's1', '#FF8800');
  doc = documentReducer(doc, { type: 'set-library', colorStyles: r.colorStyles, document: r.document });
  assert.equal(doc.objects.find(o => o.id === 'a')!.fill, '#ff8800');
  assert.equal(doc.objects.find(o => o.id === 'a')!.stroke, '#000000', 'o contorno tem outro estilo');
  const bb = doc.objects.find(o => o.id === 'b')!;
  assert.equal(bb.fill, '#123456'); assert.equal(bb.fillStyle, undefined);
  assert.equal(doc.pages![1].objects[0].fill, '#ff8800', 'outra página também muda');
  // Aplicar estilo ao contorno de c; excluir mantém as cores.
  const painted = paintWith(doc.objects.find(o => o.id === 'c')!, 'stroke', doc.colorStyles![0]);
  assert.equal(painted.stroke, '#ff8800'); assert.equal(painted.strokeStyle, 's1');
  const del = deleteColorStyle(doc, 's1');
  doc = documentReducer(doc, { type: 'set-library', colorStyles: del.colorStyles, document: del.document });
  assert.equal(doc.objects.find(o => o.id === 'a')!.fill, '#ff8800'); assert.equal(doc.objects.find(o => o.id === 'a')!.fillStyle, undefined);
  const saved = parseProject(serializeProject(doc));
  assert.deepEqual(saved.colorStyles?.map(s => s.id), ['s2']);
});
