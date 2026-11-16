import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, type VectorObject } from '../src/document/model.ts';
import { parseProject, serializeProject } from '../src/document/persistence.ts';
import { separateShadows, separateLabel } from '../src/geometry/effectLinks.ts';
import { boundsOf } from '../src/geometry/objectTransforms.ts';
import { strokeStyle } from '../src/document/paint.ts';
import { objectInside } from '../src/geometry/hitTest.ts';
import { blendChannel, blendModes, photoshopBlendList, invertedBlend } from '../src/document/transparency.ts';
import { toEps, toPdf, toSvg } from '../src/io/exporters.ts';
import { activeSpot, paletteLibrary } from '../src/workspace/palettes.ts';
import { fitBounds } from '../src/document/viewport.ts';
import { maskBox, maskPixel, maskPixels, maskSvg } from '../src/bitmap/layerMask.ts';

const rect = (id: string, x: number, y: number, w = 100, h = 100, extra: Partial<VectorObject> = {}): VectorObject => ({ id, type: 'rectangle', name: id, x, y, width: w, height: h, fill: 'none', stroke: '#000000', strokeWidth: 1, ...extra });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const box = (o: VectorObject) => { const b = boundsOf([o]); return [b.x, b.y, b.width, b.height].map(v => Math.round(v)); };

test('sombra: separar (Ctrl+K) cria o objeto da sombra atrás, deslocado, com cor, opacidade e desfoque', () => {
  const a = rect('a', 0, 0, 100, 50, { fill: '#ff0000', shadow: { x: 10, y: 20, blur: 6, color: '#222222', opacity: 0.4 } });
  assert.equal(separateLabel([a], ['a']), 'Separar Grupo de sombra');
  const r = separateShadows([a], ['a']);
  assert.equal(r.objects.length, 2);
  const [shadow, original] = r.objects;
  assert.equal(original.shadow, undefined);
  assert.deepEqual(box(shadow), [10, 20, 100, 50]);
  assert.deepEqual([shadow.fill, shadow.stroke, shadow.opacity, shadow.blur], ['#222222', '#222222', 0.4, 6]);
  const saved = parseProject(serializeProject({ ...createDocument(), objects: r.objects }));
  assert.equal(saved.objects[0].blur, 6);
  assert.match(toSvg({ objects: r.objects, area: { x: 0, y: 0, width: 200, height: 200 } }), /feGaussianBlur stdDeviation="3"/);
});

test('contorno: cantos e extremidades retos por padrão; arredondado só quando escolhido', () => {
  assert.deepEqual(strokeStyle(rect('a', 0, 0)), { strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeMiterlimit: 4 });
  assert.deepEqual(strokeStyle(rect('a', 0, 0, 10, 10, { strokeJoin: 'round', strokeCap: 'round' })), { strokeLinecap: 'round', strokeLinejoin: 'round' });
});

test('seleção: clicar dentro de uma forma vazada a encontra (a de cima vence); bloqueadas são ignoradas', () => {
  const objects = [rect('fundo', 0, 0, 300, 300), rect('meio', 50, 50, 100, 100), rect('linha', 0, 0, 10, 10)];
  assert.equal(objectInside(objects, { x: 100, y: 100 }, () => false)?.id, 'meio');
  assert.equal(objectInside(objects, { x: 250, y: 250 }, () => false)?.id, 'fundo');
  assert.equal(objectInside(objects, { x: 100, y: 100 }, o => o.id === 'meio')?.id, 'fundo');
  assert.equal(objectInside(objects, { x: 400, y: 400 }, () => false), null);
});

test('mesclagem: lista e nomes do Photoshop; indisponíveis marcados; Subtrair = fundo − cor', () => {
  const names = photoshopBlendList.flat().map(i => 'key' in i ? blendModes[i.key].label : `(${i.unavailable})`);
  assert.deepEqual(names, ['Normal', '(Dissolver)', 'Escurecer', 'Multiplicação', 'Superexposição de cores', 'Superexposição linear', '(Cor mais escura)', 'Clarear', 'Divisão', 'Subexposição de cores', 'Subexposição linear (Adicionar)', '(Cor mais clara)', 'Sobrepor', 'Luz indireta', 'Luz direta', '(Luz brilhante)', '(Luz linear)', '(Luz do pino)', '(Mistura sólida)', 'Diferença', 'Exclusão', 'Subtrair', '(Dividir)', 'Matiz', 'Saturação', 'Cor', 'Luminosidade']);
  assert.equal(blendChannel('minus', 0.8, 0.3)!.toFixed(2), '0.50');
  assert.equal(blendChannel('subtract', 0.8, 0.3)!.toFixed(2), '0.10');
  assert.ok(invertedBlend('minus') && invertedBlend('subtract') && !invertedBlend('multiply'));
  const svg = toSvg({ objects: [rect('a', 0, 0, 10, 10, { fill: '#808080' }), rect('b', 0, 0, 10, 10, { fill: '#404040', blendMode: 'minus' })], area: { x: 0, y: 0, width: 10, height: 10 } });
  assert.match(svg, /<g style="mix-blend-mode:plus-lighter">/, 'Subtrair soma a cor sem inverter');
  assert.equal(parseProject(serializeProject({ ...createDocument(), objects: [rect('b', 0, 0, 10, 10, { blendMode: 'minus' })] })).objects[0].blendMode, 'minus');
});

test('cores de corte: CutContour sai como cor especial (Separation) no PDF e no EPS', () => {
  const roland = paletteLibrary.find(p => p.id === 'roland')!;
  const cut = roland.swatches.find(s => s.spot === 'CutContour')!;
  const o = rect('a', 0, 0, 100, 50, { stroke: cut.hex, strokeSpot: 'CutContour' });
  assert.equal(activeSpot('CutContour', cut.hex)?.name, 'CutContour');
  assert.equal(activeSpot('CutContour', '#000000'), undefined, 'trocou a cor por fora: perde o vínculo');
  const scene = { objects: [o], area: { x: 0, y: 0, width: 100, height: 50 } };
  const pdf = new TextDecoder('latin1').decode(toPdf(scene));
  assert.match(pdf, /\/CS1 CS 1 SCN/);
  assert.match(pdf, /\/ColorSpace << \/CS1 \[\/Separation \/CutContour \/DeviceCMYK << \/FunctionType 2 \/Domain \[0 1\] \/C0 \[0 0 0 0\] \/C1 \[0 1 0 0\] \/N 1 >>\]/);
  assert.match(toEps(scene), /\[\/Separation \(CutContour\) \/DeviceCMYK \{dup 0 mul exch dup 1 mul exch dup 0 mul exch 0 mul\}\] setcolorspace 1 setcolor/);
  assert.equal(parseProject(serializeProject({ ...createDocument(), objects: [o] })).objects[0].strokeSpot, 'CutContour');
});

test('zoom: enquadrar página, largura e altura', () => {
  const page = { x: 0, y: 0, width: 800, height: 400 };
  const all = fitBounds(1000, 600, page);
  assert.equal(all.zoom, Math.min(920 / 800, 520 / 400));
  assert.equal(fitBounds(1000, 600, page, 'height').zoom, 520 / 400);
  const w = fitBounds(1000, 600, page, 'width');
  assert.equal(w.x + 400 * w.zoom, 500, 'centro da página no centro da tela');
});

test('máscara de camada: caixa com folga, pixels, conversão de ponto, SVG e persistência', () => {
  const o = rect('a', 10, 20, 100, 50, { transform: [2, 0, 0, 2, 0, 0] });
  const b = maskBox(o);
  assert.ok(b.x < 10 && b.width > 100);
  const size = maskPixels(b);
  assert.equal(size.width, Math.round(b.width * 4));
  const mask = { src: png, ...b };
  const px = maskPixel(o, mask, size, { x: 2 * (b.x + b.width / 2), y: 2 * (b.y + b.height / 2) });
  assert.deepEqual([Math.round(px.x), Math.round(px.y)], [Math.round(size.width / 2), Math.round(size.height / 2)]);
  const masked = { ...o, mask };
  const svg = toSvg({ objects: [masked], area: { x: 0, y: 0, width: 300, height: 200 } });
  assert.match(svg, /<g mask="url\(#lmask-a\)"><mask id="lmask-a" maskUnits="userSpaceOnUse"/);
  assert.match(maskSvg(masked, 'm', 'matrix(2 0 0 2 0 0)'), /style="mask-type:luminance"><rect [^>]*fill="#fff"\/><image href="data:image\/png/);
  const saved = parseProject(serializeProject({ ...createDocument(), objects: [{ ...masked, mask: { ...mask, disabled: true, background: 'black' } }] }));
  assert.deepEqual([saved.objects[0].mask!.disabled, saved.objects[0].mask!.background], [true, 'black']);
  assert.doesNotMatch(toSvg({ objects: saved.objects, area: { x: 0, y: 0, width: 300, height: 200 } }), /lmask/, 'máscara desativada não é aplicada');
});

test('contorno (efeito): cantos retos, arredondados ou chanfrados nos passos', async () => {
  const { performContour } = await import('../src/geometry/effectsGeometry.ts');
  const { worldCommands } = await import('../src/geometry/worldGeometry.ts');
  const corner = (corners: 'miter' | 'round' | 'bevel') => {
    const r = performContour([rect('a', 0, 0)], ['a'], { direction: 'outside', steps: 1, offset: 10, endColor: '#000000', corners });
    const step = r.objects[0], pts = worldCommands(step).filter(c => c.type !== 'Z') as { x: number; y: number }[];
    return { box: box(step), fill: step.fill, sharp: pts.some(p => Math.abs(p.x + 10) < 0.05 && Math.abs(p.y + 10) < 0.05), cut: pts.some(p => Math.abs(p.x + 10) < 0.05 && Math.abs(p.y) < 0.05) };
  };
  assert.deepEqual(corner('miter'), { box: [-10, -10, 120, 120], fill: '#000000', sharp: true, cut: false });
  assert.equal(corner('round').sharp, false);
  const bevel = corner('bevel');
  assert.deepEqual([bevel.sharp, bevel.cut], [false, true]);
});
