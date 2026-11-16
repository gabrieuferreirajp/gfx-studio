import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createObject, type VectorObject } from '../src/document/model.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { alignObjects, boundsOf, duplicateObjects, translate } from '../src/geometry/objectTransforms.ts';
import { snapMove } from '../src/geometry/smartGuides.ts';
import { breakApart } from '../src/geometry/breakApart.ts';
import { approximateMeasure, createText, defaultTextStyle, updateText } from '../src/text/textLayout.ts';
import { pathFromWorld } from '../src/geometry/convertCurves.ts';
import { placeInside } from '../src/geometry/powerClip.ts';
const rect = (x: number, y: number, w: number, h: number) => ({ ...createObject('rectangle', x, y, '#336699', '#000000'), width: w, height: h });
const valid = (objects: VectorObject[]) => assert.doesNotThrow(() => parseProject(serializeProject({ ...createDocument(), objects })));

test('alinhar mantém fixo o último objeto selecionado (âncora)', () => {
  const a = rect(0, 0, 20, 20), b = rect(100, 50, 40, 40);
  const left = alignObjects([a, b], [a.id, b.id], 'left', undefined, b.id);
  assert.equal(boundsOf([left[1]]).x, 100, 'âncora parada'); assert.equal(boundsOf([left[0]]).x, 100);
  const top = alignObjects([a, b], [a.id, b.id], 'top', undefined, a.id);
  assert.equal(boundsOf([top[0]]).y, 0); assert.equal(boundsOf([top[1]]).y, 0);
  const center = alignObjects([a, b], [a.id, b.id], 'center', undefined, b.id);
  assert.equal(boundsOf([center[0]]).x + 10, 120);
});
test('duplicar com deslocamento deixa o original e coloca a cópia transformada por cima', () => {
  const a = rect(0, 0, 10, 10), frame = rect(50, 50, 30, 30), content = rect(55, 55, 5, 5);
  const clipped = placeInside([content, frame], [content.id], frame.id);
  const result = duplicateObjects([a, ...clipped], [a.id, frame.id, content.id], undefined, translate(100, 0));
  assert.equal(result.objects.length, 6); assert.equal(boundsOf([result.objects[0]]).x, 0);
  const copies = result.objects.slice(3);
  assert.equal(boundsOf([copies[0]]).x, 100); assert.equal(copies[2].clipParent, copies[1].id);
  valid(result.objects);
});
test('guias inteligentes encaixam bordas e centros dentro do limite', () => {
  const page = { x: 0, y: 0, width: 960, height: 640 }, other = { x: 300, y: 100, width: 100, height: 50 };
  const near = snapMove({ x: 403, y: 197, width: 50, height: 20 }, [page, other], 8);
  assert.equal(near.dx, -3, 'borda esquerda encaixa na direita do outro'); assert.equal(near.guides.find(g => g.axis === 'x')!.position, 400);
  const centered = snapMove({ x: 452, y: 0, width: 60, height: 30 }, [page], 8);
  assert.equal(centered.dx, -2, 'centro encaixa no centro da página');
  const far = snapMove({ x: 500, y: 500, width: 10, height: 10 }, [other], 8);
  assert.deepEqual([far.dx, far.dy, far.guides.length], [0, 0, 0]);
});
test('Ctrl+K quebra curva composta em partes e texto em linhas, palavras e letras', () => {
  const compound = pathFromWorld(rect(0, 0, 1, 1), [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 0 }, { type: 'L', x: 10, y: 10 }, { type: 'Z' }, { type: 'M', x: 20, y: 0 }, { type: 'L', x: 30, y: 0 }, { type: 'L', x: 30, y: 10 }, { type: 'Z' }]);
  const broken = breakApart([compound], [compound.id], approximateMeasure);
  assert.equal(broken.objects.length, 2); assert.equal(broken.objects[0].id, compound.id); assert.equal(boundsOf([broken.objects[1]]).x, 20); valid(broken.objects);
  const text = updateText(createText(10, 50, '#000000', defaultTextStyle, approximateMeasure), { text: 'Linha um\nLinha dois' }, approximateMeasure);
  const lines = breakApart([text], [text.id], approximateMeasure).objects;
  assert.deepEqual(lines.map(o => o.text), ['Linha um', 'Linha dois']); assert.ok(lines[1].y > lines[0].y); assert.equal(lines[0].x, text.x);
  const words = breakApart([lines[0]], [lines[0].id], approximateMeasure).objects;
  assert.deepEqual(words.map(o => o.text), ['Linha', 'um']); assert.ok(words[1].x > words[0].x + words[0].width - 1);
  const letters = breakApart([words[1]], [words[1].id], approximateMeasure).objects;
  assert.deepEqual(letters.map(o => o.text), ['u', 'm']); valid(lines); valid(words); valid(letters);
  const single = rect(0, 0, 5, 5);
  assert.equal(breakApart([single], [single.id], approximateMeasure).broken, 0);
});
