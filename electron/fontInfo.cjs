// Lê de cada arquivo de fonte (TTF/OTF/TTC) a família tipográfica, o nome do estilo, o peso (OS/2 usWeightClass) e o
// itálico, e as instâncias de fontes variáveis (tabela fvar, eixo wght). Só os cabeçalhos e as tabelas name/OS2/fvar
// são lidos, sem carregar o arquivo inteiro. Usado para a lista de fontes com estilos (Thin, Bold, ExtraBold…).
const fs = require('node:fs');

function readAt(fd, offset, length) { const b = Buffer.alloc(length); const n = fs.readSync(fd, b, 0, length, offset); return n === length ? b : b.subarray(0, n); }
function decodeName(b, platform) {
  if (platform === 0 || platform === 3) { let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i)); return s; }
  return b.toString('latin1');
}
function tables(fd, base) {
  const head = readAt(fd, base, 12), count = head.readUInt16BE(4), dir = readAt(fd, base + 12, count * 16), out = {};
  for (let i = 0; i < count; i++) out[dir.toString('latin1', i * 16, i * 16 + 4)] = { offset: dir.readUInt32BE(i * 16 + 8), length: dir.readUInt32BE(i * 16 + 12) };
  return out;
}
function names(fd, t) {
  if (!t.name) return {};
  const b = readAt(fd, t.name.offset, Math.min(t.name.length, 1 << 20)), count = b.readUInt16BE(2), store = b.readUInt16BE(4), out = {};
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12, platform = b.readUInt16BE(r), lang = b.readUInt16BE(r + 4), id = b.readUInt16BE(r + 6), len = b.readUInt16BE(r + 8), off = b.readUInt16BE(r + 10);
    if (store + off + len > b.length) continue;
    // Prefere Windows/inglês (0x409); senão, qualquer Windows; por último, Mac.
    const rank = platform === 3 && lang === 0x409 ? 3 : platform === 3 ? 2 : platform === 0 ? 1 : 0;
    if (!out[id] || out[id].rank < rank) out[id] = { rank, text: decodeName(b.subarray(store + off, store + off + len), platform) };
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.text]));
}
function fontFaces(fd, base, file) {
  const t = tables(fd, base), n = names(fd, t);
  let family = (n[16] || n[1] || '').trim(), style = (n[17] || n[2] || 'Regular').trim();
  // Larguras diferentes (Narrow, Condensed…) ficam como família própria: o peso sozinho não escolhe a largura.
  if (/narrow|condensed|compressed|expanded|extended/i.test(style) && n[1] && n[1].trim() !== family) { family = n[1].trim(); style = (n[2] || 'Regular').trim(); }
  if (!family) return [];
  let weight = 400, italic = /italic|oblique/i.test(style);
  if (t['OS/2']) { const os2 = readAt(fd, t['OS/2'].offset, 64); weight = os2.readUInt16BE(4) || 400; italic = italic || !!(os2.readUInt16BE(62) & 1); }
  const faces = [{ family, style, weight, italic, file, variable: false }];
  // Fonte variável: cada instância nomeada com eixo de peso vira um estilo próprio.
  if (t.fvar) {
    const f = readAt(fd, t.fvar.offset, Math.min(t.fvar.length, 1 << 16)), axesOff = f.readUInt16BE(4), axisCount = f.readUInt16BE(8), axisSize = f.readUInt16BE(10), instCount = f.readUInt16BE(12), instSize = f.readUInt16BE(14);
    const axes = []; for (let a = 0; a < axisCount; a++) axes.push(f.toString('latin1', axesOff + a * axisSize, axesOff + a * axisSize + 4));
    const w = axes.indexOf('wght'), it = axes.indexOf('ital');
    if (w >= 0) {
      faces.length = 0;
      const start = axesOff + axisCount * axisSize;
      for (let i = 0; i < instCount; i++) {
        const r = start + i * instSize, nameId = f.readUInt16BE(r), coord = c => f.readInt32BE(r + 4 + c * 4) / 65536;
        faces.push({ family, style: (n[nameId] || '').trim() || `Peso ${Math.round(coord(w))}`, weight: Math.round(coord(w)), italic: italic || (it >= 0 && coord(it) > 0.5), file, variable: true });
      }
    }
  }
  return faces;
}
/** Faces de um arquivo (TTC traz várias fontes). Erros de leitura devolvem lista vazia. */
function readFontFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const tag = readAt(fd, 0, 12);
    if (tag.toString('latin1', 0, 4) === 'ttcf') { const count = tag.readUInt32BE(8), offs = readAt(fd, 12, count * 4); const out = []; for (let i = 0; i < count; i++) out.push(...fontFaces(fd, offs.readUInt32BE(i * 4), file)); return out; }
    return fontFaces(fd, 0, file);
  } catch { return []; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* já fechado */ } }
}
module.exports = { readFontFile };
