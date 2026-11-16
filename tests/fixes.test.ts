import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createObject } from '../src/document/model.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { groupObjects } from '../src/geometry/objectTransforms.ts';
import { booleanGroupPath, booleanSelectionError } from '../src/geometry/booleanSelection.ts';
import { performBoolean } from '../src/geometry/booleanGeometry.ts';
import { importSvg } from '../src/io/svgImport.ts';
import { frameAt } from '../src/geometry/powerClip.ts';
const rect = (x: number, y: number, w: number, h: number, fill = '#336699') => ({ ...createObject('rectangle', x, y, fill, '#000000'), width: w, height: h });

test('página padrão é A4 em pé, em milímetros', () => {
  const d = createDocument();
  assert.equal(d.unit, 'mm'); assert.ok(d.artboard.height > d.artboard.width);
  assert.ok(Math.abs(d.artboard.width * 25.4 / 96 - 210) < 0.01 && Math.abs(d.artboard.height * 25.4 / 96 - 297) < 0.01);
});
test('booleana com objetos dentro de um grupo mantém o resultado no grupo', () => {
  const [a, b, c] = [rect(0, 0, 50, 50), rect(25, 0, 50, 50), rect(200, 0, 10, 10)];
  const grouped = groupObjects([a, b, c], [a.id, b.id, c.id], 'g');
  assert.equal(booleanSelectionError(grouped, [a.id, b.id]), null);
  assert.deepEqual(booleanGroupPath(grouped, [a.id, b.id]), ['g']);
  const result = performBoolean(grouped, [a.id, b.id], 'union');
  assert.equal(result.objects.length, 2); assert.deepEqual(result.objects.find(o => o.id === result.resultId)!.groupPath, ['g']);
  assert.doesNotThrow(() => parseProject(serializeProject({ ...createDocument(), objects: result.objects })));
  assert.deepEqual(booleanGroupPath(grouped, [a.id, b.id, c.id]), [], 'grupo inteiro selecionado: resultado fora do grupo');
  const other = rect(400, 0, 10, 10), mixed = groupObjects([...grouped, other, rect(500, 0, 5, 5)], [other.id], 'h');
  assert.match(booleanSelectionError(mixed, [a.id, other.id]) ?? '', /mesmo grupo/);
});
test('importação de PDF: sem grupo da página e contornos preenchidos fechados', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><g id="pagina"><g><path d="M10 10 L40 10 L40 40 L10 40 L10 10" fill="#ff0000"/><path d="M50 50 L90 50 L90 90" fill="#00ff00"/></g><path d="M0 95 L100 95" stroke="#000" fill="none"/></g></svg>`;
  const r = importSvg(svg);
  assert.equal(r.objects.length, 3); assert.ok(r.objects.every(o => !o.groupPath || o.groupPath.length === 1), 'grupo externo removido');
  assert.equal(r.objects[0].commands!.at(-1)!.type, 'Z'); assert.equal(r.objects[1].commands!.at(-1)!.type, 'Z', 'preenchido sem contorno fecha');
  assert.equal(r.objects[2].commands!.at(-1)!.type, 'L', 'linha só com contorno continua aberta');
  assert.equal(booleanSelectionError(r.objects, [r.objects[0].id, r.objects[1].id]), null);
});
test('PowerClip dentro: o quadro é a forma cujo interior contém o clique, mesmo sem preenchimento', () => {
  const content = rect(10, 10, 5, 5), hollow = { ...createObject('ellipse', 0, 0, 'none', '#000000'), width: 100, height: 100 }, line = { ...rect(0, 0, 200, 200), fill: 'none' };
  const objects = [line, hollow, content];
  assert.equal(frameAt(objects, { x: 50, y: 50 }, [content.id])?.id, hollow.id, 'elipse vazia acima do retângulo');
  assert.equal(frameAt(objects, { x: 150, y: 150 }, [content.id])?.id, line.id);
  assert.equal(frameAt(objects, { x: 300, y: 300 }, [content.id]), undefined);
  assert.equal(frameAt(objects, { x: 12, y: 12 }, [content.id, hollow.id])?.id, line.id, 'ignora os objetos selecionados');
});
