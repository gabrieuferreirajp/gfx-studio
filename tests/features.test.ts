import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createObject, documentReducer, type VectorObject } from '../src/document/model.ts';
import { documentUnits, fromUnit, toUnit, unitScale } from '../src/document/units.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { alignObjects, boundsOf, resizeMatrix, selectionIds, transformPoint } from '../src/geometry/objectTransforms.ts';
import { allContents, extractContents, fitContents, placeInside, setContentsLocked } from '../src/geometry/powerClip.ts';
import { graphPaperObjects, normalizeShapeOptions, polygonObject, spiralObject, starObject, freehandObject, defaultShapeOptions } from '../src/geometry/shapeFactory.ts';
import { exportScene, toDxf, toEps, toPdf, toPlt, toSvg } from '../src/io/exporters.ts';
import { traceBitmap } from '../src/bitmap/bitmapTrace.ts';
import { parseClip, serializeClip } from '../src/io/clipboard.ts';
import { worldCommands } from '../src/geometry/worldGeometry.ts';
import { cmykPalette, cmykToHex, hexToCmyk, rgbPalette } from '../src/workspace/palettes.ts';
const rect = (x: number, y: number, w: number, h: number, fill = 'none') => ({ ...createObject('rectangle', x, y, fill, '#000000'), width: w, height: h });
const style = { fill: '#ff0000', stroke: '#000000' };

test('unidades do CorelDRAW convertem ida e volta a partir de pixels a 96 dpi', () => {
  assert.ok(documentUnits.length >= 13);
  for (const unit of documentUnits) assert.ok(Math.abs(toUnit(fromUnit(12.5, unit), unit) - 12.5) < 1e-9);
  assert.equal(unitScale('in'), 96); assert.ok(Math.abs(toUnit(96, 'cm') - 2.54) < 1e-12); assert.ok(Math.abs(toUnit(96, 'pt') - 72) < 1e-12); assert.equal(toUnit(16, 'pc'), 1);
  const document = { ...createDocument(), unit: 'cicero' as const };
  assert.equal(parseProject(serializeProject(document)).unit, 'cicero');
  assert.throws(() => parseProject(JSON.stringify({ ...document, unit: 'furlong' })));
});
test('novas formas vêm sem preenchimento e com contorno; paleta do documento registra e remove cores', () => {
  const shape = createObject('ellipse', 0, 0, 'none', '#000000');
  assert.equal(shape.fill, 'none'); assert.equal(shape.stroke, '#000000'); assert.equal(shape.strokeWidth, 1);
  let document = documentReducer(createDocument(), { type: 'add', object: shape });
  assert.deepEqual(document.palette, ['#000000']);
  document = documentReducer(document, { type: 'update', id: shape.id, patch: { fill: '#AA0000' } });
  assert.deepEqual(document.palette, ['#000000', '#aa0000']);
  document = documentReducer(document, { type: 'set-palette', palette: ['#aa0000'] });
  assert.deepEqual(document.palette, ['#aa0000']);
  document = documentReducer(document, { type: 'update', id: shape.id, patch: { x: 5 } });
  assert.deepEqual(document.palette, ['#aa0000'], 'cor removida não volta sem novo uso');
  assert.deepEqual(parseProject(serializeProject(document)).palette, ['#aa0000']);
  assert.throws(() => parseProject(JSON.stringify({ ...document, palette: ['red'] })));
});
test('cantos redimensionam proporcionalmente e Shift escala a partir do centro', () => {
  const b = { x: 0, y: 0, width: 100, height: 50 }, id = [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number];
  const m = resizeMatrix(b, id, 'se', { x: 100, y: 50 }, { x: 200, y: 60 }, true);
  assert.deepEqual(transformPoint(m, { x: 100, y: 50 }), { x: 200, y: 100 });
  const c = resizeMatrix(b, id, 'e', { x: 100, y: 25 }, { x: 150, y: 25 }, false, true);
  assert.deepEqual([transformPoint(c, { x: 0, y: 0 }).x, transformPoint(c, { x: 100, y: 0 }).x], [-50, 150]);
});
test('um único objeto alinha à página; vários alinham entre si', () => {
  const a = rect(10, 10, 20, 20), b = rect(100, 50, 10, 10), page = { x: 0, y: 0, width: 960, height: 640 };
  const single = [a]; assert.equal(alignObjects(single, [a.id], 'left'), single, 'sem referência, um objeto não muda');
  const right = alignObjects([a], [a.id], 'right', page);
  assert.equal(boundsOf(right).x + boundsOf(right).width, 960);
  const left = alignObjects([a, b], [a.id, b.id], 'left', page);
  assert.equal(boundsOf([left[1]]).x, 10);
});
test('PowerClip coloca, move com o quadro, ajusta, destrava, extrai e persiste', () => {
  const frame = rect(0, 0, 100, 100, '#eeeeee'), content = rect(50, 50, 200, 100, '#ff0000'), other = rect(300, 0, 10, 10);
  let objects: VectorObject[] = placeInside([content, frame, other], [content.id], frame.id);
  assert.deepEqual(objects.map(o => o.id), [frame.id, content.id, other.id]);
  assert.equal(objects[1].clipParent, frame.id);
  assert.deepEqual(new Set(selectionIds(objects, frame.id)), new Set([frame.id, content.id]));
  assert.deepEqual(selectionIds(objects, content.id).sort(), [frame.id, content.id].sort(), 'clicar no conteúdo seleciona o quadro');
  objects = fitContents(objects, frame.id, 'fit');
  const fitted = boundsOf([objects[1]]);
  assert.ok(Math.abs(fitted.width - 100) < 1e-9 && Math.abs(fitted.height - 50) < 1e-9 && Math.abs(fitted.y - 25) < 1e-9);
  const document = { ...createDocument(), objects };
  assert.deepEqual(parseProject(serializeProject(document)), document);
  assert.deepEqual(selectionIds(setContentsLocked(objects, frame.id, false), frame.id), [frame.id]);
  assert.equal(extractContents(objects, frame.id)[1].clipParent, undefined);
  assert.throws(() => placeInside(objects, [frame.id], content.id), /quadro/);
  assert.throws(() => parseProject(JSON.stringify({ ...document, objects: [{ ...objects[1], clipParent: 'missing' }] })));
  assert.equal(allContents(objects, frame.id).length, 1);
});
test('polígono, estrela, espiral e papel milimetrado preenchem a caixa desenhada', () => {
  const box = { x: 10, y: 20, width: 100, height: 80 }, options = normalizeShapeOptions({ sides: 6, points: 7, columns: 3, rows: 2 });
  for (const object of [polygonObject(box, options, style), starObject(box, options, style), spiralObject(box, options, style)]) {
    const b = boundsOf([object]); assert.ok(b.x >= 9.9 && b.y >= 19.9 && b.x + b.width <= 110.1 && b.y + b.height <= 100.1);
    assert.doesNotThrow(() => parseProject(serializeProject({ ...createDocument(), objects: [object] })));
  }
  assert.equal(worldCommands(polygonObject(box, options, style)).filter(c => c.type === 'L').length, 5);
  assert.equal(worldCommands(starObject(box, options, style)).filter(c => c.type === 'L').length, 13);
  const grid = graphPaperObjects(box, options, style, 'g'); assert.equal(grid.length, 6); assert.ok(grid.every(o => o.groupPath?.[0] === 'g'));
  assert.equal(normalizeShapeOptions({ sides: 1, sharpness: 500 }).sides, 3); assert.equal(normalizeShapeOptions({ sharpness: 500 }).sharpness, 99);
  assert.equal(defaultShapeOptions.sides, 5);
  const curve = freehandObject(Array.from({ length: 50 }, (_, i) => ({ x: i * 2, y: Math.sin(i / 5) * 20 })), 1, '#000000');
  assert.ok(curve && curve.commands!.length < 50 && curve.fill === 'none');
});
test('exportação gera SVG, PDF, EPS, DXF e PLT válidos com PowerClip e texto', () => {
  const frame = rect(0, 0, 100, 100, '#00ff00'), content = rect(50, 50, 200, 100, '#ff0000'), text = { ...createObject('text', 10, 10, '#000000'), text: 'Ação <1>' };
  const document = { ...createDocument(), artboard: { width: 960, height: 640 }, objects: [...placeInside([content, frame], [content.id], frame.id), text] };
  const scene = exportScene(document, 'page', []);
  const svg = toSvg(scene);
  assert.match(svg, /^<\?xml/); assert.match(svg, /clip-path="url\(#clip-/); assert.match(svg, /A&amp;|Ação &lt;1&gt;/);
  const pdf = new TextDecoder('latin1').decode(toPdf(scene));
  assert.match(pdf, /^%PDF-1\.4/); assert.match(pdf, /W n/); assert.match(pdf, /\/MediaBox \[0 0 720 480\]/); assert.match(pdf, /\(A\\347\\343o <1>\) Tj/);
  const xref = Number(pdf.match(/startxref\n(\d+)/)![1]); assert.equal(pdf.slice(xref, xref + 4), 'xref');
  for (const [, offset, id] of pdf.matchAll(/(\d{10}) 00000 n \n/g).map((m, i) => [m, Number(m[1]), i + 1] as const)) assert.equal(pdf.slice(offset, offset + `${id} 0 obj`.length), `${id} 0 obj`);
  assert.match(toEps(scene), /%%BoundingBox: 0 0 720 480[\s\S]*clip[\s\S]*%%EOF/);
  const dxf = toDxf(scene); assert.match(dxf, /AC1009/); assert.ok((dxf.match(/POLYLINE/g) ?? []).length >= 2); assert.match(dxf, /\r\nTEXT\r\n/); assert.ok(dxf.trimEnd().endsWith('EOF'));
  assert.match(toPlt(scene), /^IN;\nSP1;\nPU0,\d+;\nPD/);
  assert.equal(exportScene(document, 'selection', [frame.id]).objects.length, 2);
  assert.throws(() => exportScene(document, 'selection', []));
});
test('rastreamento converte bitmap em camadas vetoriais por cor, com furos e sem fundo', () => {
  const width = 40, height = 40, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ring = Math.hypot(x - 20, y - 20), dark = ring < 15 && ring > 7, i = (y * width + x) * 4;
    data.set(dark ? [20, 20, 120, 255] : [255, 255, 255, 255], i);
  }
  const layers = traceBitmap({ width, height, data }, { colors: 2, smoothing: 30, cornerAngle: 60, removeBackground: true, despeckle: 0 });
  assert.equal(layers.length, 1); assert.equal(layers[0].contours.length, 2, 'anel: contorno externo e furo');
  const path = { ...createObject('rectangle', 0, 0, layers[0].color), type: 'path' as const, fillRule: 'evenodd' as const, width: 40, height: 40, commands: layers[0].contours.flat(), pathSize: { width, height } };
  assert.doesNotThrow(() => parseProject(serializeProject({ ...createDocument(), objects: [path] })));
  assert.equal(traceBitmap({ width, height, data }, { colors: 2, smoothing: 30, cornerAngle: 60, removeBackground: false, despeckle: 0 }).length, 2);
});
test('copiar e colar revalida objetos e gera novos IDs, preservando grupos e PowerClip', () => {
  const frame = rect(0, 0, 100, 100), content = rect(10, 10, 50, 50);
  const objects = placeInside([content, frame], [content.id], frame.id);
  const pasted = parseClip(serializeClip(objects))!;
  assert.equal(pasted.length, 2); assert.ok(pasted.every(o => !objects.some(p => p.id === o.id)));
  assert.equal(pasted[1].clipParent, pasted[0].id);
  assert.equal(parseClip('texto qualquer'), null);
  assert.throws(() => parseClip('vectorstudio-clip:{"objects":[{"type":"script"}]}'));
  const image = { ...rect(0, 0, 10, 10), type: 'image' as const, src: 'data:image/png;base64,iVBORw0KGgo=' };
  assert.doesNotThrow(() => parseProject(serializeProject({ ...createDocument(), objects: [image] })));
  assert.throws(() => parseProject(JSON.stringify({ ...createDocument(), objects: [{ ...image, src: 'javascript:alert(1)' }] })));
});
test('paletas padrão RGB e CMYK têm cores válidas e conversão coerente', () => {
  assert.ok(rgbPalette.length >= 30 && cmykPalette.length >= 40);
  assert.ok([...rgbPalette, ...cmykPalette].every(s => /^#[0-9a-f]{6}$/.test(s.hex)));
  assert.equal(cmykToHex(0, 0, 0, 100), '#000000'); assert.equal(cmykToHex(100, 0, 0, 0), '#00ffff');
  assert.deepEqual(hexToCmyk('#ff0000'), [0, 100, 100, 0]);
});
