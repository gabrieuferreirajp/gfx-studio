export interface Swatch { hex: string; name: string; cmyk?: [number, number, number, number] }
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
/** Conversão CMYK → RGB para exibição (sem perfil ICC). */
export function cmykToHex(c: number, m: number, y: number, k: number) {
  return hex(255 * (1 - c / 100) * (1 - k / 100), 255 * (1 - m / 100) * (1 - k / 100), 255 * (1 - y / 100) * (1 - k / 100));
}
export function hexToCmyk(value: string): [number, number, number, number] {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255), k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map(v => Math.round(v * 100)) as [number, number, number, number];
}
// Paletas padrão no arranjo do CorelDRAW atual: cinzas do preto ao branco, cores primárias e depois as famílias de
// tons (azuis, verdes, amarelos, laranjas, vermelhos, rosas e roxos), na ordem em que aparecem no Corel.
// Os cinzas da CMYK são K puro (saem como preto de processo no PDF/EPS); as demais cores são as exibidas na tela.
const grays = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0];
const cmykColors = '352d8e 00aaeb 00a456 fff33a eb2f2d eb1d8a a54984 f28633 f6adae 7f6b64 c8c3e0 9c94c6 6f8ac4 786eb0 837da6 4a5d86 504b68 667a96 0091d5 91d5f5 a6c1d0 859ca8 657782 435159 496d6d 3c8376 638f8e 4fa292 53a177 58c3ce 4aa4ad a8c0b2 cbe6d4 9ad2af 869a90 879978 abbc77 a9be94 a2ce4c cfe28f 57574b 808070 a8a792 a8a579 d3cc78 fff78f fff9b3 fffbd7 a58c6d cb8e62 cfad6d f2864e f7a956 f7ab76 fdcd3a fbd1a2 7f6a52 a05844 c86f40 f2876a f6ac92 fbd3c2 a37375 c8706c c87181 eb2b52 f28882 ef6073 cb9092 7d5769 a1597a f5aecc ca90aa a58e9a ceb1bf a66996 c6599e c77eb2 a686a8 c7a0c8 675169 866c88 9f76b1 a3278b 874584 7e519d 6c4d78 694184'.split(' ');
const rgbColors = '000000 191919 323332 4d4d4c 666666 808080 999999 b3b3b3 cccccc e6e6e6 ffffff 3300f8 25fdfe 00ff3f fcff47 fd281a ff17fa 9c00c7 fd6d24 ff9bcb 653434 ceccfd 9e97fb 6f96fa 7062f9 6b64c8 192f95 0c0063 396496 2bcafc 9cfeff 9acbcc 679899 346565 003232 006536 00983d 329869 2ecb6e 2bcb47 67fecf 34cb9b 98cc9c cbffcf 97ffa1 659969 63993e 96cc48 97cc6f 94ff42 c9ff76 313306 646637 989a6a 979a3f c9cd4a fcff78 fdffa2 feffd0 986839 ca6a3b ca9b41 fd6d3e fd9d44 fd9d6c fccf3a fece9e 653409 981309 cb3c15 fe6c69 fe9c9b ffcecd 983764 cb3b66 cc3a97 fe2667 fe6c99 ff3f97 cc6998 670363 9a0995 ff9afc cd67c9 9a6697 cd9aca 9c32c7 d033f9 cf66fa 9c65c8 cf98fb 350063 683195 9f63fa 9f00f9 6c00c7 702af9 3a0095 4000c6'.split(' ');
const named = (value: string, cmyk: boolean): Swatch => {
  const r = parseInt(value.slice(1, 3), 16), g = parseInt(value.slice(3, 5), 16), b = parseInt(value.slice(5, 7), 16), [C, M, Y, K] = hexToCmyk(value);
  return { hex: value, name: cmyk ? `C${C} M${M} Y${Y} K${K}` : `R${r} G${g} B${b}` };
};
export const cmykPalette: Swatch[] = [
  ...grays.map(k => ({ hex: cmykToHex(0, 0, 0, k), name: k === 100 ? 'Preto (C0 M0 Y0 K100)' : k === 0 ? 'Branco (C0 M0 Y0 K0)' : `${k}% preto (C0 M0 Y0 K${k})`, cmyk: [0, 0, 0, k] as [number, number, number, number] })),
  // Demais cores: percentuais redondos (múltiplos de 5) a partir da cor da tela; a amostra mostra a cor desses percentuais.
  ...cmykColors.map(c => { const v = hexToCmyk('#' + c).map(x => Math.round(x / 5) * 5) as [number, number, number, number]; return { hex: cmykToHex(...v), name: `C${v[0]} M${v[1]} Y${v[2]} K${v[3]}`, cmyk: v }; }),
];
export const rgbPalette: Swatch[] = rgbColors.map(c => named('#' + c, false));

/**
 * Cores especiais (spot) usadas por softwares de impressão e corte: o que vale para o RIP é o NOME da cor, que sai
 * como cor especial (Separation) no PDF e no EPS. A cor na tela é só referência.
 * Roland VersaWorks: CutContour = linha de corte; PerfCutContour = linha de corte perfurado (meio-corte).
 */
export interface SpotColor { name: string; cmyk: [number, number, number, number]; hex: string }
const spot = (name: string, c: number, m: number, y: number, k: number): SpotColor => ({ name, cmyk: [c, m, y, k], hex: cmykToHex(c, m, y, k) });
export const spotColors: SpotColor[] = [spot('CutContour', 0, 100, 0, 0), spot('PerfCutContour', 100, 0, 0, 0)];
export const spotByName = (name: string | undefined) => spotColors.find(s => s.name === name);
/** Cor especial válida do objeto: o nome só vale enquanto a cor continua a da cor especial. */
export function activeSpot(name: string | undefined, color: string | undefined) {
  const s = spotByName(name);
  return s && color && s.hex.toLowerCase() === color.toLowerCase() ? s : undefined;
}
export interface PaletteDef { id: string; group: string; name: string; swatches: (Swatch & { spot?: string })[] }
/** Paletas disponíveis (Janela › Paletas no CorelDRAW): várias podem ficar abertas lado a lado. */
export const paletteLibrary: PaletteDef[] = [
  { id: 'cmyk', group: 'Paletas padrão', name: 'Paleta padrão CMYK', swatches: cmykPalette },
  { id: 'rgb', group: 'Paletas padrão', name: 'Paleta padrão RGB', swatches: rgbPalette },
  { id: 'roland', group: 'Cores de corte › Roland', name: 'Roland VersaWorks', swatches: spotColors.map(s => ({ hex: s.hex, name: `${s.name} (cor especial, C${s.cmyk[0]} M${s.cmyk[1]} Y${s.cmyk[2]} K${s.cmyk[3]})`, spot: s.name })) },
];

/** CMYK guardado no objeto vale enquanto a cor (hex) for a mesma gerada por ele; trocar a cor por fora desfaz o vínculo. */
export function activeCmyk(cmyk: [number, number, number, number] | undefined, hex: string | undefined): [number, number, number, number] | undefined {
  if (!cmyk || !hex || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  return cmykToHex(cmyk[0], cmyk[1], cmyk[2], cmyk[3]) === hex.toLowerCase() ? cmyk : undefined;
}
