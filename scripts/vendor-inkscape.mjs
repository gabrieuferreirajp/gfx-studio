// Copia do Inkscape instalado apenas o necessário para converter CDR/PDF/AI/EPS em SVG pela linha de comando.
// Uso: node scripts/vendor-inkscape.mjs ["C:\Program Files\Inkscape"]  →  vendor/inkscape (embutido no instalador).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';

const source = process.argv[2] ?? 'C:\\Program Files\\Inkscape';
const target = new URL('../vendor/inkscape/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
if (!existsSync(join(source, 'bin', 'inkscape.com'))) throw new Error(`Inkscape não encontrado em ${source}`);

/** Nomes das DLLs importadas por um executável PE (tabela de importação e importação atrasada). */
function imports(file) {
  const b = readFileSync(file), pe = b.readUInt32LE(0x3c), magic = b.readUInt16LE(pe + 24), opt = pe + 24;
  const dirs = opt + (magic === 0x20b ? 112 : 96), sections = opt + b.readUInt16LE(pe + 20), count = b.readUInt16LE(pe + 6);
  const rvaToOffset = rva => { for (let i = 0; i < count; i++) { const s = sections + i * 40, va = b.readUInt32LE(s + 12), size = Math.max(b.readUInt32LE(s + 8), b.readUInt32LE(s + 16)); if (rva >= va && rva < va + size) return rva - va + b.readUInt32LE(s + 20); } return -1; };
  const name = rva => { const o = rvaToOffset(rva); return o < 0 ? '' : b.toString('latin1', o, b.indexOf(0, o)); };
  const out = new Set();
  for (const [index, stride, nameField] of [[1, 20, 12], [13, 32, 4]]) {
    const rva = b.readUInt32LE(dirs + index * 8); if (!rva) continue;
    for (let o = rvaToOffset(rva); o > 0 && b.readUInt32LE(o + nameField); o += stride) out.add(name(b.readUInt32LE(o + nameField)).toLowerCase());
  }
  return out;
}
const walk = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const bin = join(source, 'bin'), dlls = new Map(readdirSync(bin).filter(f => /\.dll$/i.test(f)).map(f => [f.toLowerCase(), join(bin, f)]));
// Módulos carregados em tempo de execução (gdk-pixbuf, gio) também puxam DLLs.
const runtimeModules = ['gdk-pixbuf-2.0', 'gio'].flatMap(d => existsSync(join(source, 'lib', d)) ? walk(join(source, 'lib', d)).filter(f => /\.dll$/i.test(f)) : []);
const needed = new Set(), queue = [join(bin, 'inkscape.exe'), join(bin, 'inkscape.com'), join(bin, 'gspawn-win64-helper-console.exe'), join(bin, 'gspawn-win64-helper.exe'), join(bin, 'gdbus.exe'), ...runtimeModules];
while (queue.length) {
  const file = queue.pop();
  for (const dll of imports(file)) if (dlls.has(dll) && !needed.has(dll)) { needed.add(dll); queue.push(dlls.get(dll)); }
}
rmSync(target, { recursive: true, force: true }); mkdirSync(join(target, 'bin'), { recursive: true });
for (const f of ['inkscape.exe', 'inkscape.com', 'gdbus.exe', 'gspawn-win64-helper-console.exe', 'gspawn-win64-helper.exe']) cpSync(join(bin, f), join(target, 'bin', f));
for (const dll of needed) cpSync(dlls.get(dll), join(target, 'bin', basename(dlls.get(dll))));
// Recursos: mantém o que a importação usa; remove tutoriais, exemplos, Python, depurador e traduções (exceto pt-BR).
const skip = [/^lib[\\/]python/i, /^lib[\\/](aspell|tcl|tk|cmake|pkgconfig)/i, /^include/i, /^share[\\/]inkscape[\\/](tutorials|examples|symbols|screens|paint|templates)/i, /^share[\\/]gdb/i, /^share[\\/]locale[\\/](?!pt_BR)/i, /^share[\\/]inkscape[\\/]extensions[\\/].*\.py$/i];
for (const dir of ['etc', 'lib', 'share']) for (const file of walk(join(source, dir))) {
  const rel = relative(source, file);
  if (skip.some(r => r.test(rel))) continue;
  mkdirSync(dirname(join(target, rel)), { recursive: true }); cpSync(file, join(target, rel));
}
for (const f of readdirSync(source).filter(f => /^(COPYING|LICENSE|AUTHORS|NEWS|README|GPL)/i.test(f))) cpSync(join(source, f), join(target, f));
const size = walk(target).reduce((s, f) => s + statSync(f).size, 0);
console.log(`Inkscape reduzido em vendor/inkscape: ${(size / 1048576).toFixed(0)} MB, ${needed.size} de ${dlls.size} DLLs.`);
writeFileSync(join(target, 'LEIA-ME-INKSCAPE.txt'), 'Este diretório contém uma cópia reduzida do Inkscape (https://inkscape.org), usada pelo GFX Studio apenas para converter arquivos CDR, PDF, AI e EPS em SVG.\r\nO Inkscape é software livre sob a GNU GPL versão 2 ou posterior (ver share/inkscape/doc/COPYING e GPL-2.0.txt).\r\nCódigo-fonte: https://inkscape.org/release/ e https://gitlab.com/inkscape/inkscape\r\n');
