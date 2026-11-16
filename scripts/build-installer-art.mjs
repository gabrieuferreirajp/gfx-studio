// Gera as imagens do instalador NSIS na identidade do GFX Studio (roxo do ícone (nós de curva brancos)):
// build/installerSidebar.bmp e build/uninstallerSidebar.bmp (164×314, telas de boas-vindas e conclusão) e
// build/installerHeader.bmp (150×57, faixa das demais telas). O NSIS só aceita BMP de 24 bits.
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const icon = 'data:image/png;base64,' + readFileSync(new URL('../build/icon.png', import.meta.url)).toString('base64');
const font = "font-family='Segoe UI, Arial, sans-serif'";
// Pena estilizada (mesma forma do ícone), usada como marca d'água.
const nib = (x, y, s, opacity) => `<g transform="translate(${x} ${y}) scale(${s})" opacity="${opacity}" fill="#d9ceff">
  <path d="M0 -60 L34 0 C34 22 22 36 16 46 L-16 46 C-22 36 -34 22 -34 0 Z"/><rect x="-24" y="54" width="48" height="10" rx="5"/></g>`;

function sidebar(subtitle) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#7a4dff"/><stop offset="0.55" stop-color="#5a2df0"/><stop offset="1" stop-color="#2a0aa8"/></linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.28"/></linearGradient>
  </defs>
  <rect width="164" height="314" fill="url(#bg)"/>
  <path d="M164 120 L164 314 L20 314 Z" fill="url(#shade)"/>
  ${nib(128, 250, 1.35, 0.07)}
  <g stroke="#ffffff" stroke-opacity="0.18" fill="none"><path d="M-10 300 C60 240 110 250 180 170"/><path d="M-10 286 C64 228 112 236 180 156"/></g>
  <image href="${icon}" x="42" y="44" width="80" height="80"/>
  <text x="82" y="160" text-anchor="middle" ${font} font-size="23" font-weight="700" fill="#ffffff">GFX <tspan fill="#d9ceff">Studio</tspan></text>
  <rect x="62" y="172" width="40" height="3" rx="1.5" fill="#d9ceff"/>
  <text x="82" y="196" text-anchor="middle" ${font} font-size="10.5" fill="#ece6ff">${subtitle}</text>
</svg>`;
}
const header = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <defs><linearGradient id="h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#efeaff"/></linearGradient></defs>
  <rect width="150" height="57" fill="url(#h)"/>
  <image href="${icon}" x="10" y="10" width="37" height="37"/>
  <text x="55" y="33" ${font} font-size="17" font-weight="700" fill="#2a0aa8">GFX <tspan fill="#6a35ff">Studio</tspan></text>
  <rect x="55" y="39" width="28" height="2.5" rx="1.25" fill="#6a35ff"/>
</svg>`;

/** PNG renderizado → BMP de 24 bits (linhas de baixo para cima, alinhadas em 4 bytes). */
function bmp(svg) {
  const image = new Resvg(svg, { font: { loadSystemFonts: true } }).render(), { width, height } = image, rgba = image.pixels;
  const row = Math.ceil(width * 3 / 4) * 4, size = 54 + row * height, out = Buffer.alloc(size);
  out.write('BM', 0); out.writeUInt32LE(size, 2); out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14); out.writeInt32LE(width, 18); out.writeInt32LE(height, 22); out.writeUInt16LE(1, 26); out.writeUInt16LE(24, 28);
  out.writeUInt32LE(row * height, 34); out.writeInt32LE(2835, 38); out.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const s = (y * width + x) * 4, a = rgba[s + 3] / 255, d = 54 + (height - 1 - y) * row + x * 3;
    // Fundo branco onde houver transparência.
    out[d] = Math.round(rgba[s + 2] * a + 255 * (1 - a)); out[d + 1] = Math.round(rgba[s + 1] * a + 255 * (1 - a)); out[d + 2] = Math.round(rgba[s] * a + 255 * (1 - a));
  }
  return { data: out, png: image.asPng() };
}
const files = [['installerSidebar', sidebar('Editor vetorial profissional')], ['uninstallerSidebar', sidebar('Obrigado por usar o GFX Studio')], ['installerHeader', header]];
for (const [name, svg] of files) {
  const { data, png } = bmp(svg);
  writeFileSync(new URL(`../build/${name}.bmp`, import.meta.url), data);
  writeFileSync(new URL(`../build/${name}.png`, import.meta.url), png); // só para conferência
}
console.log('Imagens do instalador geradas em build/ (installerSidebar, uninstallerSidebar, installerHeader).');
