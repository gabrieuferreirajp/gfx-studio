import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { cdrStyleMatcher, parseCdrTextStyles, readCdrTextStyles } from '../src/io/cdrText.ts';
import { importSvg } from '../src/io/svgImport.ts';
import { approximateMeasure, lineLayout, measureText, updateText } from '../src/text/textLayout.ts';
import { createDocument, type VectorObject } from '../src/document/model.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';

// Blocos como os do content/data/page1.dat do CorelDRAW 2017+ (tamanho em 0,1 µm; 1 pt = 3527,78).
const size = (pt: number) => String(Math.round(pt * 25.4 / 72 * 10000));
const latin = (pt: number, weight: string, axes = '') => ({ font: 'Montserrat', size: size(pt), weight, italic: '0', font_axes: axes });
const record = (pt: number, weight: string, justify: string | undefined, axes = '', runs: object[] = []) => [
  JSON.stringify({ character: { latin: latin(pt, weight, axes) }, fill: {}, frame: {}, outline: {}, paragraph: justify ? { justify, interLineSpacing: '597915', spacingMethod: '0' } : {}, transparency: {} }),
  '\u0000\u0001',
  JSON.stringify({ character: { latin: latin(pt, weight, axes) }, frame: {}, paragraph: justify ? { justify, interLineSpacing: '597915', spacingMethod: '0' } : {} }),
  ...runs.map(r => JSON.stringify({ character: r })),
  '\u0000TEXTO\u0000',
].join('\u0000');
const page = [JSON.stringify({ fill: {}, outline: {}, transparency: {} }), record(149, '16384', '2', '<10>2003265652<29>2003265652 0 800 100 900 100 '), record(107, '64', '1', '', [{}, { latin: latin(107, '4096') }]), record(95, '4096', undefined)].join('\u0000');

test('estilos de texto do CDR: peso (eixo wght ou código), alinhamento, espaçamento e trechos', () => {
  const styles = parseCdrTextStyles(page);
  assert.equal(styles.length, 3);
  assert.ok(Math.abs(styles[0].size - 149) < 0.01);
  assert.equal(styles[0].weight, 800); assert.equal(styles[0].align, 'center');
  assert.equal(styles[1].weight, 400); assert.equal(styles[1].align, 'left'); assert.deepEqual(styles[1].runs?.map(r => r.weight), [undefined, 700]);
  assert.equal(styles[2].weight, 700); assert.equal(styles[2].align, undefined, 'sem justify = padrão');
  assert.ok(Math.abs(styles[1].lineSpacing! - 0.5979 * 1.635) < 0.001);
  // Associação: o conversor desenha de trás para frente; o tamanho confirma.
  const match = cdrStyleMatcher(styles);
  assert.equal(match(95)?.weight, 700); assert.equal(match(149)?.weight, 800, 'pula o que não confere'); assert.equal(match(107), undefined, 'já passou');
});

test('lê o page1.dat de dentro do ZIP do CDR', async () => {
  const name = Buffer.from('content/data/page1.dat'), data = deflateRawSync(Buffer.from(page, 'latin1'));
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const offset = local.length + name.length + data.length, end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([local, name, data, central, name, end]);
  const styles = await readCdrTextStyles(zip);
  assert.equal(styles.length, 3); assert.equal(styles[0].weight, 800);
  assert.deepEqual(await readCdrTextStyles(Buffer.from('não é zip')), []);
});

test('texto do CDR: quebras de linha, trechos coloridos, centro e linha de base da última linha', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 2000" width="2000" height="2000">
    <text x="100" y="1000"><tspan font-family="Montserrat" font-size="95" fill="#ffffff">\nFAZEMOS 100% ONLINE\nPARA </tspan><tspan font-family="Montserrat" font-size="95" fill="#009245">\nTODO O BRASIL!</tspan></text>
    <text x="300" y="400"><tspan font-family="Montserrat" font-size="149" fill="#003153">\nTRANSFORME</tspan></text>
    <text x="50" y="1500"><tspan font-family="Montserrat" font-size="107" fill="#003153">\nSEM VENDA, SEM\nDOR DE CABEÇA.</tspan></text>
  </svg>`;
  // Ordem do arquivo = inversa à do SVG.
  const styles = [{ size: 107, weight: 600, align: 'left' as const, lineSpacing: 1 }, { size: 149, weight: 800, align: 'center' as const }, { size: 95, weight: 700, align: 'center' as const, lineSpacing: 1 }];
  const result = importSvg(svg, { cdrStyles: styles, measure: approximateMeasure, uuid: (() => { let i = 0; return () => `id-${++i}`; })() });
  const texts = result.objects.filter(o => o.type === 'text');
  const local = (o: VectorObject) => ({ ...o, transform: undefined });
  // Trechos de cores diferentes: um texto por trecho, agrupados; a 2ª linha continua depois de "PARA ".
  const fazemos = texts.filter(o => /FAZEMOS|PARA|TODO/.test(o.text!));
  assert.deepEqual(fazemos.map(o => o.text), ['FAZEMOS 100% ONLINE', 'PARA ', 'TODO O BRASIL!']);
  assert.equal(new Set(fazemos.map(o => o.groupPath?.[0])).size, 1);
  assert.ok(fazemos.every(o => o.bold && o.fontWeight === undefined), 'peso 700 = negrito');
  const [l1, para, todo] = fazemos.map(o => lineLayout(local(o), approximateMeasure)[0]);
  assert.ok(Math.abs(todo.x - (para.x + para.width)) < 1e-6, 'o trecho verde segue na mesma linha');
  // Centro = x + largura da 1ª linha; linhas centradas nele.
  const center = 100 + l1.width;
  assert.ok(Math.abs(l1.x + l1.width / 2 - center) < 1e-6 && Math.abs(para.x + (para.width + todo.width) / 2 - center) < 1e-6);
  // y do conversor = linha de base da última linha (espaçamento 1 × 95).
  assert.ok(Math.abs(para.baseline - 1000) < 1e-6 && Math.abs(l1.baseline - 905) < 1e-6);
  // Um estilo só: um texto de várias linhas, peso 600 guardado e espaçamento do CorelDRAW.
  const sem = texts.find(o => o.text === 'SEM VENDA, SEM\nDOR DE CABEÇA.')!;
  assert.equal(sem.fontWeight, 600); assert.equal(sem.lineSpacing, 1); assert.equal(sem.textAlign, undefined);
  const semLines = lineLayout(local(sem), approximateMeasure);
  assert.ok(Math.abs(semLines[1].baseline - 1500) < 1e-6 && Math.abs(semLines[0].baseline - 1393) < 1e-6);
  const transforme = texts.find(o => o.text === 'TRANSFORME')!;
  assert.equal(transforme.fontWeight, 800); assert.equal(transforme.textAlign, 'center');
  const t = lineLayout(local(transforme), approximateMeasure)[0];
  assert.ok(Math.abs(t.x + t.width / 2 - (300 + t.width)) < 1e-6, 'centro conferido com a prévia do Corel');
});

test('peso numérico e espaçamento: persistência, medida e botão Negrito', () => {
  const text: VectorObject = updateText({ id: 't', type: 'text', name: 'Texto', x: 0, y: 0, width: 1, height: 1, fill: '#000000', text: 'A\nB', fontFamily: 'Arial', fontSize: 10, bold: true, fontWeight: 800, lineSpacing: 2 }, {}, approximateMeasure);
  const loaded = parseProject(serializeProject({ ...createDocument(), objects: [text] })).objects[0];
  assert.equal(loaded.fontWeight, 800); assert.equal(loaded.lineSpacing, 2);
  assert.ok(Math.abs(measureText(text, approximateMeasure).height - (10 * 96 / 72) * 3.2) < 1e-9, 'altura = 1 linha + espaçamento');
  assert.equal(updateText(text, { bold: false }, approximateMeasure).fontWeight, undefined, 'desligar o negrito remove o peso importado');
  assert.throws(() => parseProject(JSON.stringify({ ...createDocument(), objects: [{ ...text, fontWeight: 12.5 }] })), /Peso/);
});
