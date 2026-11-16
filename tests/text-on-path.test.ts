import test from 'node:test';
import assert from 'node:assert/strict';
import type { VectorDocument, VectorObject } from '../src/document/model.ts';
import { createDocument } from '../src/document/model.ts';
import { refreshLinks, remapLinks } from '../src/geometry/links.ts';
import { pathTextTarget } from '../src/text/pathLinks.ts';
import { createPathText, detachPathText, fitTextToPath } from '../src/text/textTools.ts';
import { approximateMeasure, defaultTextStyle, lineLayout, pathTextStart } from '../src/text/textLayout.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';

const line: VectorObject = { id: 'curve', type: 'path', name: 'Curva', x: 0, y: 0, width: 300, height: 100, fill: 'none', stroke: '#000000', strokeWidth: 1, pathSize: { width: 300, height: 100 }, commands: [{ type: 'M', x: 0, y: 100 }, { type: 'L', x: 300, y: 100 }] };
const doc = (objects: VectorObject[]): VectorDocument => ({ ...createDocument(), objects });
const text = (o: VectorObject) => ({ ...o, text: 'ABC' });

test('clicar na curva com a ferramenta Texto: o texto começa no ponto clicado e fica ligado', () => {
  const hit = pathTextTarget([line], { x: 120, y: 103 }, 6, () => false)!;
  assert.equal(hit.object.id, 'curve'); assert.ok(Math.abs(hit.s - 120) < 1e-6);
  assert.equal(pathTextTarget([line], { x: 120, y: 120 }, 6, () => false), null);
  const t = createPathText(line, hit.s, '#000000', { ...defaultTextStyle, textAlign: 'center' }, approximateMeasure);
  assert.equal(t.textPath?.source, 'curve'); assert.equal(t.textAlign, undefined);
  const first = lineLayout(text(t), approximateMeasure)[0];
  assert.ok(Math.abs(first.x - 120) < 1e-6 && Math.abs(first.baseline - 100) < 1e-6);
});
test('mover a curva leva o texto junto', () => {
  const t = text(createPathText(line, 50, '#000000', defaultTextStyle, approximateMeasure));
  const moved = refreshLinks(doc([{ ...line, transform: [1, 0, 0, 1, 10, 40] }, t])).objects[1];
  const g = lineLayout(moved, approximateMeasure)[0];
  assert.ok(Math.abs(g.x - 60) < 1e-6 && Math.abs(g.baseline - 140) < 1e-6);
});
test('arrastar só o texto o faz deslizar ao longo da curva', () => {
  const t = text(createPathText(line, 50, '#000000', defaultTextStyle, approximateMeasure));
  const slid = refreshLinks(doc([line, { ...t, transform: [1, 0, 0, 1, 80, 30] }])).objects[1];
  assert.equal(slid.transform, undefined); assert.ok(Math.abs(slid.textPath!.offset - 130) < 1e-6);
  assert.ok(Math.abs(lineLayout(slid, approximateMeasure)[0].baseline - 100) < 1e-6, 'continua sobre a curva');
});
test('posição vertical, letras em pé, separar e copiar sem a curva', () => {
  const t = text(createPathText(line, 0, '#000000', defaultTextStyle, approximateMeasure));
  const top = lineLayout({ ...t, textPath: { ...t.textPath!, vertical: 'top' } }, approximateMeasure)[0];
  assert.ok(top.baseline > 100, 'topo no caminho: letras abaixo da curva');
  const curve: VectorObject = { ...line, commands: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 100, y: 100 }] };
  const tilted = text(createPathText(curve, 0, '#000000', defaultTextStyle, approximateMeasure));
  assert.ok(Math.abs(lineLayout(tilted, approximateMeasure)[0].angle! - 45) < 1e-6);
  assert.equal(lineLayout({ ...tilted, textPath: { ...tilted.textPath!, upright: true } }, approximateMeasure)[0].angle, 0);
  assert.equal(detachPathText(t).textPath?.source, undefined);
  assert.equal(remapLinks(t, () => undefined).textPath?.source, undefined);
  assert.equal(remapLinks(t, id => id === 'curve' ? 'copy' : undefined).textPath?.source, 'copy');
  // Fica gravado no arquivo.
  const back = parseProject(serializeProject(doc([line, { ...t, textPath: { ...t.textPath!, vertical: 'center', upright: true } }]))).objects[1];
  assert.deepEqual([back.textPath?.source, back.textPath?.vertical, back.textPath?.upright], ['curve', 'center', true]);
  assert.ok(pathTextStart(back, approximateMeasure).path.total > 0);
});
test('Ajustar texto ao caminho pelo menu também liga o texto à curva', () => {
  const plain: VectorObject = { id: 't', type: 'text', name: 'Texto', x: 0, y: 0, width: 50, height: 20, fill: '#000000', text: 'Oi', fontFamily: 'Arial', fontSize: 24 };
  const fitted = fitTextToPath([line, plain], ['curve', 't'], approximateMeasure).find(o => o.id === 't')!;
  assert.equal(fitted.textPath?.source, 'curve');
});
