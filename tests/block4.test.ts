import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCdrFills, cdrColor, parseCdrFills } from '../src/io/cdrText.ts';
import { importSvg } from '../src/io/svgImport.ts';
import { defaultLayout, parseLayout } from '../src/workspace/layout.ts';

test('cores do CorelDRAW: RGB, CMYK (% e 255), cinza e cor especial com alternativa', () => {
  assert.equal(cdrColor('RGB255,USER,36,112,52,100,00000000-0000-0000-0000-000000000000'), '#247034');
  assert.equal(cdrColor('CMYK,USER,0,0,0,100,100,00000000-0000-0000-0000-000000000000'), '#000000');
  assert.equal(cdrColor('CMYK255,USER,0,0,0,0,100,cccd19cb'), '#ffffff');
  assert.equal(cdrColor('CMYK255,USER,255,0,255,0,100,x'), '#00ff00');
  assert.equal(cdrColor('GRAY255,USER,128,100,x'), '#808080');
  assert.equal(cdrColor('SPOT,PANTONEC,354,100,id,~,PANTONE 2935 C,2,CMYK255,USER,255,133,0,0,100,id,~,RGB255,USER,0,94,196,100,id,~,id,PANTONE 2935 C'), '#005ec4');
  assert.equal(cdrColor('LAB,USER,1,2,3'), undefined);
  assert.equal(cdrColor(''), undefined);
});

// Blocos como os do page1.dat: um por objeto, com "fill" e "outline"; texto tem também "character".
const block = (fill: object, text = false) => JSON.stringify({ ...(text ? { character: { latin: { size: '35278' } }, frame: {}, paragraph: {} } : {}), fill, outline: { width: '0' }, transparency: {} });
const page = [
  block({ type: '1', primaryColor: 'RGB255,USER,255,0,0,100,a' }),
  block({ type: '0' }),
  block({ primaryColor: 'CMYK,USER,0,0,0,100,100,a' }), // sem tipo = sem preenchimento (estilo ~graphic~ padrão)
  block({ type: '2', primaryColor: 'RGB255,USER,0,0,0,100,a', secondaryColor: 'RGB255,USER,255,255,255,100,a', angle: '45' }),
  block({ type: '1', primaryColor: 'RGB255,USER,0,0,255,100,a' }, true),
  block({ type: '7' }),
  JSON.stringify({ character: {} }), // trecho de texto: não é objeto
].join('\u0000\u0001');

test('preenchimentos do CDR: uniforme, nenhum, sem tipo, degradê (média) e tipos não suportados', () => {
  const fills = parseCdrFills(page);
  assert.equal(fills.length, 6);
  assert.deepEqual(fills.map(f => f.color), ['#ff0000', 'none', 'none', '#808080', '#0000ff', undefined]);
  assert.equal(fills[3].fountain, true);
  assert.equal(fills[4].text, true);
});

const square = (n: number, closed = true) => `<path\n     d="M${n},0 L${n + 5},0 L${n + 5},5 L${n},5${closed ? ' Z' : ''}"\n     style="fill: none; stroke: #000000"\n     id="p${n}" />`;
test('aplica as cores na ordem inversa (o conversor desenha de trás para frente); textos e curvas abertas mantêm o original', () => {
  const fills = parseCdrFills(page);
  // 6 objetos no arquivo → 6 elementos no SVG, do último para o primeiro.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 10">${square(0)}<text x="0" y="9" style="fill:#0000ff">A</text>${square(10)}${square(20, false)}${square(30)}${square(40)}</svg>`;
  const result = applyCdrFills(svg, fills);
  assert.equal(result.applied, 2, 'vermelho (último elemento) e degradê; o aberto fica sem preenchimento');
  assert.equal(result.fountains, 1);
  const objects = importSvg(result.svg, {}).objects.filter(o => o.type === 'path');
  assert.deepEqual(objects.map(o => o.fill), ['none', '#808080', 'none', 'none', '#ff0000']);
  assert.ok(objects.every(o => o.stroke === '#000000'), 'o contorno do conversor continua');
});

test('sem os textos no SVG, associa só os blocos de formas; contagem divergente não altera nada', () => {
  const fills = parseCdrFills(page), shapes = fills.filter(f => !f.text);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg">${[0, 10, 20, 30, 40].map(n => square(n)).join('')}</svg>`;
  const result = applyCdrFills(svg, fills);
  assert.equal(shapes.length, 5);
  assert.equal(result.applied, 2);
  assert.match(result.svg, /fill: #ff0000/);
  const wrong = `<svg xmlns="http://www.w3.org/2000/svg">${square(0)}${square(10)}</svg>`;
  assert.deepEqual(applyCdrFills(wrong, fills), { svg: wrong, applied: 0, fountains: 0 });
  // Cor já lida pelo conversor (CDR antigo) não é trocada.
  const colored = `<svg xmlns="http://www.w3.org/2000/svg">${[0, 10, 20, 30, 40].map(n => square(n).replace('fill: none', 'fill: #123456')).join('')}</svg>`;
  assert.equal(applyCdrFills(colored, fills).applied, 0);
});

test('opções de salvamento: padrão ligado a cada 10 min e valores fora da faixa são limitados', () => {
  const d = defaultLayout();
  assert.equal(d.autoBackup, true); assert.equal(d.autoBackupMinutes, 10); assert.equal(d.backupOnSave, true);
  const parsed = parseLayout(JSON.stringify({ ...d, autoBackup: false, autoBackupMinutes: 500, backupOnSave: false }));
  assert.equal(parsed.autoBackup, false); assert.equal(parsed.autoBackupMinutes, 120, 'limitado a 120'); assert.equal(parsed.backupOnSave, false);
  assert.equal(parseLayout(JSON.stringify({ ...d, autoBackupMinutes: 3.4 })).autoBackupMinutes, 3);
});

test('DWG: roteiro do dwgadd com camadas por cor, texto escapado e polilinhas longas divididas', async () => {
  const { toDwgScript, exportScene, DWG_MAX_POINTS } = await import('../src/io/exporters.ts');
  const { createDocument } = await import('../src/document/model.ts');
  const { normalizeCommands } = await import('../src/geometry/compoundPaths.ts');
  const doc = createDocument();
  const ring = Array.from({ length: DWG_MAX_POINTS + 300 }, (_, i) => ({ type: i ? 'L' as const : 'M' as const, x: 300 + 50 * Math.cos(i / 900), y: 300 + 50 * Math.sin(i / 900) }));
  doc.objects = [
    { id: 'r', type: 'rectangle', name: 'R', x: 10, y: 10, width: 96, height: 48, fill: 'none', stroke: '#ff0000', strokeWidth: 1 },
    { id: 't', type: 'text', name: 'T', x: 10, y: 200, width: 100, height: 20, fill: '#0000ff', text: 'Ação "1"', fontSize: 20, fontFamily: 'Arial' },
    { id: 'b', type: 'path', name: 'B', fill: 'none', stroke: '#000000', strokeWidth: 1, ...normalizeCommands([...ring, { type: 'Z' }]) },
  ];
  const { script, warnings } = toDwgScript(exportScene(doc, 'page', []));
  const lines = script.trim().split('\n');
  assert.equal(lines[0], 'HEADER.INSUNITS = 4');
  assert.ok(lines.includes('layer "COR-1"') && lines.includes('layer.color = 1'), 'vermelho = ACI 1');
  assert.ok(lines.includes('layer "COR-5"'), 'azul = ACI 5');
  const rect = lines.findIndex(l => l.startsWith('lwpolyline 4 ((2.6458 '));
  assert.ok(rect >= 0); assert.equal(lines[rect + 1], 'lwpolyline.layer = "COR-1"'); assert.equal(lines[rect + 2], 'lwpolyline.flag = 512');
  assert.ok(lines.some(l => l.startsWith('text "A\\U+00E7\\U+00E3o \\U+00221\\U+0022" (')), 'acentos e aspas em \\U+XXXX');
  assert.ok(lines.includes('text.width_factor = 1.0'));
  const counts = lines.filter(l => l.startsWith('lwpolyline ')).map(l => Number(l.split(' ')[1]));
  assert.ok(counts.every(c => c <= DWG_MAX_POINTS));
  assert.ok(counts.filter(c => c > 4).length >= 2, 'o contorno longo virou trechos');
  assert.equal(warnings.length, 1);
});

test('preenchimento inteligente: interseção, diferença, buraco entre formas com ilha e clique fora', async () => {
  const { performCut } = await import('../src/geometry/cutGeometry.ts');
  type O = import('../src/document/model.ts').VectorObject;
  const rect = (id: string, x: number, y: number, w: number, h: number): O => ({ id, type: 'rectangle', name: id, x, y, width: w, height: h, fill: 'none', stroke: '#000000', strokeWidth: 1 });
  const ellipse = (id: string, x: number, y: number, w: number, h: number): O => ({ ...rect(id, x, y, w, h), type: 'ellipse' });
  const style = { fill: '#ff0000', stroke: 'none', strokeWidth: 1 };
  const fillAt = (objects: O[], x: number, y: number) => { const r = performCut(objects, objects.map(o => o.id), 'smartFill', { point: { x, y }, style }); assert.equal(r.objects.length, objects.length + 1, 'originais mantidos'); return r.objects.at(-1)!; };
  const box = (o: O) => [o.transform![4], o.transform![5], o.width * o.transform![0], o.height * o.transform![3]].map(Math.round);
  const a = rect('a', 0, 0, 100, 100), b = rect('b', 50, 50, 100, 100);
  const meet = fillAt([a, b], 75, 75);
  assert.deepEqual(box(meet), [50, 50, 50, 50]); assert.equal(meet.fill, '#ff0000'); assert.equal(meet.stroke, 'none');
  assert.deepEqual(box(fillAt([a, b], 25, 25)), [0, 0, 100, 100], 'a menos b (forma em L)');
  const frame = [rect('t', 0, 0, 200, 20), rect('u', 0, 180, 200, 20), rect('l', 0, 0, 20, 200), rect('r', 180, 0, 20, 200)];
  const hole = fillAt(frame, 100, 100);
  assert.deepEqual(box(hole), [20, 20, 160, 160], 'buraco formado por quatro retângulos');
  const island = fillAt([...frame, ellipse('e', 80, 80, 40, 40)], 40, 40);
  assert.ok(island.commands!.filter(c => c.type === 'M').length === 2, 'a elipse no meio vira furo');
  assert.throws(() => fillAt([a, b], 400, 400), /fora de todas/);
});

test('linha central: T vira três linhas abertas, anel vira laço fechado, espessura medida e pontas estendidas', async () => {
  const { traceCenterline } = await import('../src/bitmap/centerlineTrace.ts');
  const W = 120, H = 80, data = new Uint8ClampedArray(W * H * 4).fill(255);
  const ink = (x: number, y: number) => { const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; };
  for (let x = 10; x < 70; x++) for (let t = 0; t < 5; t++) ink(x, 20 + t);
  for (let y = 22; y < 70; y++) for (let t = 0; t < 5; t++) ink(38 + t, y);
  for (let a = 0; a < 720; a++) for (let r = 13; r < 17; r++) ink(Math.round(95 + r * Math.cos(a / 114.6)), Math.round(45 + r * Math.sin(a / 114.6)));
  ink(5, 75); // mancha de 1 pixel
  const result = traceCenterline({ width: W, height: H, data }, { threshold: 0, smoothing: 40, cornerAngle: 60, minArea: 4 });
  assert.equal(result.lines.length, 4);
  assert.equal(result.lines.filter(l => l.closed).length, 1);
  assert.ok(result.strokeWidth > 3.5 && result.strokeWidth < 5.5, `espessura ${result.strokeWidth}`);
  assert.equal(result.color, '#000000');
  const xs = result.lines.filter(l => !l.closed).flatMap(l => l.commands.filter(c => c.type !== 'Z').map(c => (c as { x: number }).x));
  assert.ok(Math.min(...xs) < 12 && Math.max(...xs) > 67, 'pontas recuperam a meia espessura perdida no afinamento');
  assert.throws(() => traceCenterline({ width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) }, { threshold: 0, smoothing: 40, cornerAngle: 60, minArea: 1 }), /Nenhum traço/);
});
