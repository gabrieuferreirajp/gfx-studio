// Copia o conversor de linha de comando do TraceDraw (tracedraw-cli, licenças MIT/Apache-2.0, gravador de .cdr
// próprio e independente) do aplicativo instalado pela Microsoft Store para vendor/tracedraw, junto com as licenças.
// O GFX Studio usa esse conversor para "Salvar como CDR" (SVG → CDR nas versões 7 a 27 do formato).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// A pasta WindowsApps não pode ser listada, mas o PowerShell informa onde o pacote está instalado.
let from = '';
try { from = execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-AppxPackage IghorToth.TraceDraw | Sort-Object Version | Select-Object -Last 1).InstallLocation'], { encoding: 'utf8' }).trim(); } catch { /* sem PowerShell */ }
if (!from || !existsSync(join(from, 'tracedraw-cli.exe'))) { console.error('TraceDraw não encontrado (instale pela Microsoft Store).'); process.exit(1); }
const to = new URL('../vendor/tracedraw/', import.meta.url);
mkdirSync(to, { recursive: true });
for (const file of ['tracedraw-cli.exe', 'LICENSE-MIT', 'LICENSE-APACHE', 'README.md']) if (existsSync(join(from, file))) cpSync(join(from, file), new URL(file, to));
console.log(`tracedraw-cli copiado de ${from} para vendor/tracedraw.`);
