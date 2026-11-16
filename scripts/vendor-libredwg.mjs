// Copia o conversor DWG → DXF e o gerador de DWG (dwgadd) do LibreDWG (GNU, GPL-3.0+) para vendor/libredwg, que o instalador leva em resources/libredwg.
// Uso: node scripts/vendor-libredwg.mjs <pasta extraída de libredwg-<versão>-win64.zip> <versão>
// Fonte oficial: https://github.com/LibreDWG/libredwg/releases (código-fonte no mesmo endereço).
import fs from 'node:fs';
import path from 'node:path';

const source = process.argv[2];
if (!source || !fs.existsSync(path.join(source, 'dwg2dxf.exe'))) {
  console.error('Informe a pasta extraída do LibreDWG para Windows (com dwg2dxf.exe).');
  process.exit(1);
}
const target = path.resolve('vendor', 'libredwg');
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
// O dwg2dxf usa a biblioteca libredwg e as DLLs de conversão de texto que acompanham o pacote.
for (const file of ['dwg2dxf.exe', 'libredwg-0.dll', 'libiconv-2.dll', 'libpcre2-8-0.dll', 'libpcre2-16-0.dll', 'README.txt']) {
  if (fs.existsSync(path.join(source, file))) fs.copyFileSync(path.join(source, file), path.join(target, file));
}
// Exportar DWG: o dwgadd (em examples/ no zip) cria o DWG 2000 do zero a partir de um roteiro simples.
if (fs.existsSync(path.join(source, 'examples', 'dwgadd.exe'))) fs.copyFileSync(path.join(source, 'examples', 'dwgadd.exe'), path.join(target, 'dwgadd.exe'));
else console.warn('dwgadd.exe não encontrado: Exportar DWG ficará indisponível.');
fs.writeFileSync(path.join(target, 'LICENCA.txt'), `LibreDWG — GNU LibreDWG, programa separado usado pelo GFX Studio para converter DWG em DXF e gerar DWG.
Licença: GNU General Public License versão 3 ou posterior (https://www.gnu.org/licenses/gpl-3.0.html).
Código-fonte: https://github.com/LibreDWG/libredwg (versão ${process.argv[3] ?? path.basename(path.resolve(source))}).
`, 'utf8');
const size = fs.readdirSync(target).reduce((sum, f) => sum + fs.statSync(path.join(target, f)).size, 0);
console.log(`LibreDWG copiado para ${target} (${(size / 1024 / 1024).toFixed(1)} MB).`);
