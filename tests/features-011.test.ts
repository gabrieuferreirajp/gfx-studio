import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createObject, documentReducer, type VectorObject } from '../src/document/model.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { arrowShapes, averageFill, colorAt, defaultFill, gradientFill, renderStops, solidFill, strokePlacement, strokeStyle } from '../src/document/paint.ts';
import { exportScene, toDxf, toEps, toPdf, toSvg, transparencyNote } from '../src/io/exporters.ts';
import { applyMatrix } from '../src/geometry/objectTransforms.ts';
const scale = (x: number, y: number): [number, number, number, number, number, number] => [x, 0, 0, y, 0, 0];
import { aciColor, dxfText, dxfToSvg, decodeDxf } from '../src/io/dxfImport.ts';
import { importSvg } from '../src/io/svgImport.ts';
import { parseLayout } from '../src/workspace/layout.ts';
import { createPathObject } from '../src/geometry/pathGeometry.ts';

const rect = (x: number, y: number, w: number, h: number) => ({ ...createObject('rectangle', x, y, '#336699', '#000000'), width: w, height: h });
const doc = (objects: VectorObject[]) => ({ ...createDocument(), objects });
const line = () => ({ ...createPathObject([{ x: 0, y: 0 }, { x: 100, y: 0 }], false, '#ff0000'), strokeWidth: 2 });

test('degradê de preenchimento: pontos de cor, etapas, aceleração e cor sólida', () => {
  const g = { ...defaultFill('linear', '#000000', '#ffffff'), stops: [{ offset: 0, color: '#000000' }, { offset: 0.5, color: '#ff0000' }, { offset: 1, color: '#ffffff' }] };
  assert.equal(colorAt(g.stops, 0.25).color, '#800000');
  assert.equal(renderStops({ ...g, steps: 4 }).length, 8, 'etapas viram faixas sólidas');
  assert.equal(renderStops({ ...g, acceleration: 50 }).length, 33);
  assert.match(averageFill(g), /^#[0-9a-f]{6}$/);
  const o = gradientFill(rect(0, 0, 100, 50), g);
  assert.equal(o.fill, '#000000', 'fill guarda a primeira cor');
  assert.equal(solidFill(o, '#00ff00').fillGradient, undefined, 'cor sólida remove o degradê');
  const changed = documentReducer(doc([o]), { type: 'update', id: o.id, patch: { fill: '#123456' } });
  assert.equal(changed.objects[0].fillGradient, undefined, 'preenchimento pelo painel também remove');
});

test('degradê e caneta de contorno são gravados e validados', () => {
  const o: VectorObject = { ...gradientFill(rect(0, 0, 10, 10), { ...defaultFill('radial'), spread: 'reflect', steps: 6 }), strokeDash: [4, 2], strokeJoin: 'miter', strokeCap: 'butt', strokeMiter: 8, strokePosition: 'inside', strokeBehind: true, strokeScale: true };
  const p = { ...line(), arrowStart: 'triangle' as const, arrowEnd: 'circle' as const };
  const [a, b] = parseProject(serializeProject(doc([o, p]))).objects;
  assert.deepEqual(a.fillGradient, o.fillGradient);
  for (const key of ['strokeDash', 'strokeJoin', 'strokeCap', 'strokeMiter', 'strokePosition', 'strokeBehind', 'strokeScale'] as const) assert.deepEqual(a[key], o[key]);
  assert.equal(b.arrowStart, 'triangle'); assert.equal(b.arrowEnd, 'circle');
  assert.throws(() => parseProject(JSON.stringify(doc([{ ...o, fillGradient: { ...o.fillGradient!, stops: [{ offset: 0, color: 'red' }, { offset: 1, color: '#fff' }] } }]))), /degradê/i);
  assert.throws(() => parseProject(JSON.stringify(doc([{ ...p, arrowEnd: 'foguete' as never }]))), /seta/i);
  assert.throws(() => parseProject(JSON.stringify(doc([{ ...o, strokePosition: 'meio' as never }]))), /Posição/);
});

test('caneta: tracejado proporcional à largura, posição só em formas fechadas, escala com objeto', () => {
  const o = { ...rect(0, 0, 100, 100), strokeWidth: 2, strokeDash: [4, 2], strokeJoin: 'bevel' as const, strokePosition: 'outside' as const };
  assert.deepEqual(strokeStyle(o), { strokeLinecap: 'butt', strokeLinejoin: 'bevel', strokeDasharray: '8 4' });
  assert.equal(strokePlacement(o), 'outside');
  assert.equal(strokePlacement({ ...line(), strokePosition: 'inside' }), 'center', 'linha aberta: contorno centralizado');
  const scaled = applyMatrix([{ ...o, strokeScale: true }, o], [o.id], scale(2, 2));
  assert.equal(scaled[0].strokeWidth, 4); assert.equal(scaled[1].strokeWidth, 2);
});

test('pontas de seta nas extremidades de caminhos abertos', () => {
  const p = { ...line(), arrowStart: 'square' as const, arrowEnd: 'triangle' as const }, [start, end] = arrowShapes(p);
  assert.equal(arrowShapes({ ...rect(0, 0, 10, 10), arrowEnd: 'triangle' }).length, 0, 'forma fechada não tem setas');
  const tip = end.find((c, i) => i === 1) as { x: number; y: number };
  assert.ok(tip.x > 100 && Math.abs(tip.y) < 1e-9, 'a ponta aponta para fora, na direção da linha');
  assert.ok(start.every(c => c.type === 'Z' || (c as { x: number }).x <= 10), 'seta inicial no começo');
});

test('exportação: degradê em SVG/PDF, caneta em SVG/PDF/EPS e setas no DXF', () => {
  const g = gradientFill({ ...rect(0, 0, 100, 50), strokeWidth: 3, strokeDash: [2, 2], strokeJoin: 'miter', strokeCap: 'butt', strokePosition: 'inside' }, defaultFill('linear', '#ff0000', '#0000ff'));
  const p = { ...line(), arrowEnd: 'triangle' as const }, scene = exportScene(doc([g, p]), 'page', []);
  const svg = toSvg(scene);
  assert.match(svg, /<linearGradient id="fgrad-[^"]+" gradientUnits="userSpaceOnUse"[^>]*><stop offset="0" stop-color="#ff0000"\/><stop offset="1" stop-color="#0000ff"\/>/);
  assert.match(svg, /fill="url\(#fgrad-/);
  assert.match(svg, /stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="4" stroke-dasharray="6 6" stroke-width="6" clip-path="url\(#sclip-/);
  assert.match(svg, /<path d="M 100 [^"]+Z" fill="#ff0000"\/>/, 'seta na cor do contorno');
  const pdf = new TextDecoder('latin1').decode(toPdf(scene));
  assert.match(pdf, /\/Shading << \/Sh1 << \/ShadingType 2/);
  assert.match(pdf, /W n \/Sh1 sh Q/);
  assert.match(pdf, /0 J 0 j 4 M \[6 6\] 0 d 6 w/);
  assert.match(toEps(scene), /0 setlinecap 0 setlinejoin 4 setmiterlimit \[6 6\] 0 setdash stroke/);
  assert.equal(toDxf(scene).split('POLYLINE').length - 1, 3, 'retângulo, linha e seta');
  assert.match(transparencyNote(scene, 'eps'), /cor média/);
});

test('DXF: linhas, polilinha com arco, círculo, texto, bloco e cores', () => {
  const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '0', 'LAYER', '2', 'Paredes', '70', '0', '62', '1', '0', 'LAYER', '2', 'Oculta', '70', '0', '62', '-3', '0', 'ENDTAB', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'BLOCKS', '0', 'BLOCK', '2', 'Porta', '10', '0', '20', '0', '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '10', '21', '0', '0', 'ARC', '8', '0', '10', '0', '20', '0', '40', '10', '50', '0', '51', '90', '0', 'ENDBLK', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'Paredes', '10', '0', '20', '0', '11', '100', '21', '0',
    '0', 'LWPOLYLINE', '8', 'Paredes', '62', '5', '90', '2', '70', '1', '10', '0', '20', '10', '42', '1', '10', '20', '20', '10',
    '0', 'CIRCLE', '8', 'Paredes', '10', '50', '20', '50', '40', '10',
    '0', 'LINE', '8', 'Oculta', '10', '0', '20', '0', '11', '5', '21', '5',
    '0', 'TEXT', '8', 'Paredes', '10', '10', '20', '40', '40', '5', '1', 'Sala %%c20',
    '0', 'INSERT', '8', 'Paredes', '2', 'Porta', '10', '60', '20', '0', '50', '90',
    '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
  const { svg, warnings } = dxfToSvg(dxf);
  assert.deepEqual(warnings, []);
  const result = importSvg(svg, { uuid: (() => { let i = 0; return () => `id-${i++}`; })() });
  const paths = result.objects.filter(o => o.type === 'path'), texts = result.objects.filter(o => o.type === 'text');
  assert.equal(paths.length, 5, 'camada desligada não entra');
  assert.equal(texts[0].text, 'Sala Ø20');
  assert.ok(paths.every(p => p.stroke === '#ff0000' || p.stroke === '#0000ff'), 'cor da camada e cor ACI da entidade');
  assert.ok(paths.some(p => p.commands!.some(c => c.type === 'C')), 'bulge e círculo viram curvas');
  assert.ok(paths.some(p => p.groupPath?.length), 'bloco vira grupo');
  // 100 mm de largura em escala real.
  assert.ok(Math.abs(result.artboard.width - 100 * 96 / 25.4) < 0.5, `largura ${result.artboard.width}`);
});

test('DXF: exportado pelo Vector Studio volta com a mesma geometria; textos e cores do AutoCAD', () => {
  const r = rect(10, 20, 100, 50), back = importSvg(dxfToSvg(toDxf(exportScene(doc([r]), 'objects', []))).svg);
  assert.equal(back.objects.length, 1);
  assert.ok(Math.abs(back.artboard.width - 100) < 0.01 && Math.abs(back.artboard.height - 50) < 0.01);
  assert.equal(dxfText('{\\fArial|b1;Linha 1}\\PLinha\\~2', true), 'Linha 1\nLinha 2');
  assert.equal(aciColor(7), '#000000'); assert.equal(aciColor(1), '#ff0000'); assert.match(aciColor(30), /^#[0-9a-f]{6}$/);
  assert.equal(decodeDxf(Uint8Array.from([0x6d, 0xe3, 0x6f])), 'mão', 'DXF antigo em Windows-1252');
  assert.throws(() => dxfToSvg('AutoCAD Binary DXF\r\n'), /binário/);
});

test('deslocamento das setas: preferências com valores padrão e limites', () => {
  const d = parseLayout(null);
  assert.deepEqual([d.nudge, d.superNudge, d.microNudge], [9.6, 19.2, 4.8]);
  const custom = parseLayout(JSON.stringify({ ...d, nudge: 3.78, superNudge: -5, microNudge: 'x' }));
  assert.deepEqual([custom.nudge, custom.superNudge, custom.microNudge], [3.78, 0.01, 4.8]);
});
