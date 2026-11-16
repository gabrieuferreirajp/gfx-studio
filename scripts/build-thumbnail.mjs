// Compila o provedor de miniaturas do Explorador (build/thumbs/GfxThumbnail.cs) com o csc do .NET Framework 4,
// que já vem no Windows. O instalador registra a DLL para os arquivos .gfxs e .vectorstudio (build/installer.nsh).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const csc = join(process.env.WINDIR ?? 'C:\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!existsSync(csc)) throw new Error(`csc não encontrado: ${csc}`);
execFileSync(csc, ['/nologo', '/target:library', '/optimize+', '/platform:anycpu', '/r:System.Drawing.dll', '/out:GfxThumbnail.dll', 'GfxThumbnail.cs'], { stdio: 'inherit', cwd: join(import.meta.dirname, '..', 'build', 'thumbs') });
console.log('build/thumbs/GfxThumbnail.dll gerada.');
