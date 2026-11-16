import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSvg, parsePathData, parseTransform, svgColor, svgLength, validContours } from '../src/io/svgImport.ts';
import { parseXml } from '../src/io/xml.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { createDocument } from '../src/document/model.ts';
import { boundsOf, transformPoint } from '../src/geometry/objectTransforms.ts';
import { worldCommands } from '../src/geometry/worldGeometry.ts';
const valid = (objects: ReturnType<typeof importSvg>['objects']) => assert.doesNotThrow(() => parseProject(serializeProject({ ...createDocument(), objects })));

test('XML tolerante: entidades, CDATA, comentários e atributos com aspas simples', () => {
  const root = parseXml(`<?xml version="1.0"?><!DOCTYPE svg><!-- c --><svg a='1' b="x &amp; y"><text>A &lt;b&gt; &#225;</text><style><![CDATA[.c{fill:red}]]></style></svg>`);
  assert.equal(root.attributes.a, '1'); assert.equal(root.attributes.b, 'x & y');
  assert.equal((root.children[0] as { children: string[] }).children[0], 'A <b> á');
});
test('unidades, cores e transformações SVG', () => {
  assert.equal(svgLength('1in'), 96); assert.equal(svgLength('72pt'), 96); assert.ok(Math.abs(svgLength('25.4mm') - 96) < 1e-9); assert.equal(svgLength('50%', 7), 7);
  assert.equal(svgColor('#abc'), '#aabbcc'); assert.equal(svgColor('rgb(255, 0, 128)'), '#ff0080'); assert.equal(svgColor('RED'), '#ff0000'); assert.equal(svgColor('none'), 'none'); assert.equal(svgColor('url(#g)'), undefined);
  const m = parseTransform('translate(10 20) rotate(90) scale(2)');
  const p = transformPoint(m, { x: 1, y: 0 }); assert.ok(Math.abs(p.x - 10) < 1e-9 && Math.abs(p.y - 22) < 1e-9);
});
test('dados de caminho: relativos, H/V, S/T, arcos com flags compactas e Z implícito', () => {
  assert.deepEqual(parsePathData('M0 0 10 0 10 10m5 5 1 1').map(x => x.type), ['M', 'L', 'L', 'M', 'L']);
  assert.deepEqual(parsePathData('m1 1 2 2').at(-1), { type: 'L', x: 3, y: 3 });
  const c = parsePathData('m10 10h20v20h-20zm5 5l1 1');
  assert.deepEqual(c.slice(0, 4).map(x => x.type === 'Z' ? 'Z' : `${x.type}${x.x},${x.y}`), ['M10,10', 'L30,10', 'L30,30', 'L10,30']);
  assert.deepEqual(c.at(-1), { type: 'L', x: 16, y: 16 });
  const arc = parsePathData('M0 0a10 10 0 01 20 0');
  assert.equal(arc.at(-1)!.type, 'C'); assert.ok(Math.abs((arc.at(-1) as { x: number }).x - 20) < 1e-9);
  const smooth = parsePathData('M0 0C0 10 10 10 10 0S20 -10 20 0Q25 5 30 0T40 0');
  assert.equal(smooth.filter(x => x.type === 'C').length, 4);
  const split = validContours(parsePathData('M0 0L10 0L10 10ZL5 5L0 5M50 50L60 60'));
  assert.equal(split.closed.length, 1); assert.equal(split.open.length, 2);
});
test('importa formas, estilos, grupos, textos, imagens e escala do viewBox', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100">
    <style>.azul{fill:#0000ff}</style>
    <defs><linearGradient id="g"><stop offset="0" stop-color="#00ff00"/></linearGradient></defs>
    <g transform="translate(10,10)">
      <rect x="0" y="0" width="50" height="20" rx="4" class="azul" stroke="#ff0000" stroke-width="2"/>
      <circle cx="80" cy="20" r="10" fill="url(#g)"/>
    </g>
    <path d="M100 10 L150 10 L150 60 Z" style="fill:#123456;fill-rule:evenodd"/>
    <polyline points="0,90 50,95 100,90" stroke="#000"/>
    <text x="100" y="80" font-family="'Times New Roman', serif" font-size="12pt" font-weight="bold" text-anchor="middle">Olá <tspan fill="#ff0000">mundo</tspan></text>
    <image x="160" y="60" width="30" height="30" href="data:image/png;base64,iVBORw0KGgo="/>
    <rect width="5" height="5" style="display:none"/>
  </svg>`;
  const r = importSvg(svg);
  assert.ok(Math.abs(r.artboard.width - 200 * 96 / 25.4) < 0.05, "página arredondada a 0,1 px");
  const [rect, circle, path, line, text, image] = r.objects;
  assert.equal(rect.type, 'rectangle'); assert.equal(rect.fill, '#0000ff'); assert.equal(rect.stroke, '#ff0000'); assert.equal(rect.cornerRadius, 4);
  assert.ok(Math.abs(rect.strokeWidth! - 2 * 96 / 25.4) < 1e-6, 'contorno escalado pelo viewBox');
  assert.equal(circle.type, 'ellipse'); assert.equal(circle.fill, '#00ff00'); assert.equal(rect.groupPath?.[0], circle.groupPath?.[0]);
  assert.equal(path.fill, '#123456'); assert.equal(path.fillRule, 'evenodd');
  assert.equal(line.fill, 'none'); assert.equal(line.stroke, '#000000');
  assert.equal(text.type, 'text'); assert.equal(text.text, 'Olá mundo'); assert.equal(text.fontFamily, 'Times New Roman'); assert.equal(text.bold, true); assert.equal(text.textAlign, 'center'); assert.equal(text.fontSize, 12);
  assert.equal(image.type, 'image');
  assert.equal(r.objects.length, 6); assert.match(r.warnings.join(), /Degradês/);
  const b = boundsOf([path]); assert.ok(Math.abs(b.x - 100 * 96 / 25.4) < 1e-6);
  valid(r.objects);
});
test('recorte que corta vira PowerClip; recorte de página é ignorado', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <defs><clipPath id="page"><path d="M0 0H100V100H0Z"/></clipPath><clipPath id="c"><rect x="0" y="0" width="20" height="20"/></clipPath></defs>
    <g clip-path="url(#page)"><rect x="10" y="10" width="10" height="10" fill="#111111"/></g>
    <g clip-path="url(#c)" transform="translate(50 50)"><circle cx="20" cy="20" r="15" fill="#ff0000"/></g>
  </svg>`;
  const r = importSvg(svg);
  assert.equal(r.objects.length, 3);
  const frame = r.objects.find(o => o.name === 'Quadro PowerClip')!, content = r.objects.find(o => o.clipParent)!;
  assert.equal(content.clipParent, frame.id); assert.ok(Math.abs(boundsOf([frame]).x - 50) < 1e-9, 'quadro no espaço do elemento');
  assert.ok(worldCommands(frame).at(-1)!.type === 'Z'); valid(r.objects);
});
test('desenhos maiores que 20.000 px são reduzidos com aviso; SVG inválido é recusado', () => {
  const r = importSvg('<svg xmlns="http://www.w3.org/2000/svg" width="40000" height="100"><rect x="0" y="0" width="40000" height="100"/></svg>');
  assert.match(r.warnings.join(), /reduzido/); valid(r.objects);
  assert.throws(() => importSvg('<html></html>'), /SVG/);
});
