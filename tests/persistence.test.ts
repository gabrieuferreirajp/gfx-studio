import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createObject } from '../src/document/model.ts';
import { MAX_FILE_BYTES, parseProject, serializeProject } from '../src/document/persistence.ts';

function fixture() {
  const document = createDocument();
  document.name = 'Composição — edição';
  document.artboard = { width: 1200, height: 800 };
  document.objects = ['rectangle', 'ellipse', 'text'].map((type, index) => ({ ...createObject(type as 'rectangle' | 'ellipse' | 'text', index * 34.25, -12.5, '#aAbBcC'), width: 234.5, height: 72 }));
  document.objects[2].text = 'Olá <svg onload="alert(1)"> & mundo';
  return document;
}
test('persistência recupera versão, IDs, ordem e todas as propriedades editáveis', () => {
  const document = fixture();
  assert.deepEqual(parseProject(serializeProject(document)), document);
});
test('importação rejeita JSON inválido, versão futura e estruturas incompletas', () => {
  for (const source of ['{', 'null', '[]', '{}', JSON.stringify({ ...fixture(), version: 2 }), JSON.stringify({ ...fixture(), artboard: null })]) assert.throws(() => parseProject(source));
});
test('importação rejeita IDs repetidos, tipos desconhecidos, URLs e números fora dos limites', () => {
  for (const patch of [{ id: 'duplicate' }, { type: 'script' }, { fill: 'url(x)' }, { width: 0 }, { height: 20001 }, { x: 20001 }, { y: '12' }, { text: null, type: 'text' }]) {
    const document = fixture();
    document.objects[1].id = 'duplicate';
    Object.assign(document.objects[0], patch);
    assert.throws(() => parseProject(JSON.stringify(document)), JSON.stringify(patch));
  }
  const source = JSON.stringify(fixture()).replace('234.5', '1e999');
  assert.throws(() => parseProject(source));
});
test('importação limita tamanho e quantidade de objetos e descarta propriedades externas', () => {
  assert.throws(() => parseProject(' '.repeat(MAX_FILE_BYTES + 1)));
  const document = fixture();
  assert.throws(() => parseProject(JSON.stringify({ ...document, objects: Array(10001).fill(document.objects[0]) })));
  const source = JSON.stringify({ ...document, external: 'https://example.com', objects: document.objects.map(o => ({ ...o, onclick: 'alert(1)', __proto__: { evil: true } })) });
  assert.deepEqual(parseProject(source), document);
});
test('salvar não produz arquivo que o próprio editor rejeitaria', () => {
  const document = fixture();
  document.objects[0].width = NaN;
  assert.throws(() => serializeProject(document));
});
