// Gera build/icon.png (512 px) e build/icon.ico (16–256 px, PNG embutido) a partir de public/icon.svg.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const render = size => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
writeFileSync(new URL('../build/icon.png', import.meta.url), render(512));
writeFileSync(new URL('../electron/icon.png', import.meta.url), render(256));
const sizes = [16, 24, 32, 48, 64, 128, 256], images = sizes.map(render);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size % 256, entry); header.writeUInt8(size % 256, entry + 1);
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
writeFileSync(new URL('../build/icon.ico', import.meta.url), Buffer.concat([header, ...images]));
console.log('Ícones gerados em build/ (icon.png e icon.ico).');
