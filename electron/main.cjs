// Processo principal do GFX Studio para Windows: janela, protocolo local, arquivos e fontes do sistema.
const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, allowServiceWorkers: false, corsEnabled: true, stream: true } }]);
let window = null;
const pendingFiles = [];
// Projeto do GFX Studio: .gfxs (as versões antigas gravavam .vectorstudio, que continua abrindo).
const isProject = file => /\.(?:gfxs|vectorstudio)$/i.test(file);
const projectArgument = argv => argv.slice(1).find(arg => isProject(arg) && fs.existsSync(arg));

function sendFile(file) {
  if (!file) return;
  try {
    const stats = fs.statSync(file);
    if (stats.size > 10 * 1024 * 1024) throw new Error('O arquivo excede o limite de 10 MB.');
    const payload = { name: path.basename(file), path: file, content: fs.readFileSync(file, 'utf8') };
    if (window && !window.webContents.isLoading()) window.webContents.send('vs:open-file', payload); else pendingFiles.push(payload);
  } catch (error) { dialog.showErrorBox('GFX Studio', `Não foi possível abrir ${file}: ${error.message}`); }
}

// Preferências do aplicativo (pasta da última exportação), na pasta de dados do usuário.
const preferencesFile = () => path.join(app.getPath('userData'), 'preferencias.json');
function readPreferences() { try { return JSON.parse(fs.readFileSync(preferencesFile(), 'utf8')); } catch { return {}; } }
function writePreferences(patch) { try { fs.writeFileSync(preferencesFile(), JSON.stringify({ ...readPreferences(), ...patch }), 'utf8'); } catch { /* sem permissão de gravação: só não lembra */ } }

function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, show: false, backgroundColor: '#ffffff',
    title: 'GFX Studio', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  window.setMenu(null);
  // Ortografia (Ferramentas de escrita): o corretor do Windows sublinha a palavra; o botão direito mostra sugestões.
  window.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable || !params.misspelledWord) return;
    const items = params.dictionarySuggestions.slice(0, 8).map(word => ({ label: word, click: () => window.webContents.replaceMisspelling(word) }));
    Menu.buildFromTemplate([...(items.length ? items : [{ label: 'Nenhuma sugestão', enabled: false }]), { type: 'separator' }, { label: 'Adicionar ao dicionário', click: () => window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }]).popup({ window });
  });
  window.once('ready-to-show', () => { window.maximize(); window.show(); });
  window.webContents.on('did-finish-load', () => { while (pendingFiles.length) window.webContents.send('vs:open-file', pendingFiles.shift()); });
  // Links externos abrem no navegador padrão; a janela do editor nunca navega para fora do app.
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', event => event.preventDefault());
  // Fechar: o próprio editor pergunta (Salvar / Não salvar / Cancelar) na janela do GFX Studio e confirma por vs:close-confirmed.
  window.on('close', event => {
    if (window.webContents.isCrashed() || window.webContents.isLoading()) return;
    event.preventDefault();
    window.webContents.send('vs:close-request');
  });
  // Exportar sempre pergunta onde gravar e começa na última pasta usada, com o formato escolhido no filtro.
  window.webContents.session.on('will-download', (_event, item) => {
    const name = item.getFilename(), ext = path.extname(name).slice(1).toLowerCase(), last = readPreferences().exportDir;
    const dir = last && fs.existsSync(last) ? last : app.getPath('documents');
    item.setSaveDialogOptions({ title: 'Exportar', defaultPath: path.join(dir, name), filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'Todos os arquivos', extensions: ['*'] }] : [] });
    item.once('done', (_e, state) => { if (state === 'completed' && item.getSavePath()) writePreferences({ exportDir: path.dirname(item.getSavePath()) }); });
  });
  window.loadURL('app://vectorstudio/index.html');
  window.on('closed', () => { window = null; });
}

// Fontes instaladas no Windows (para listar e converter textos em curvas).
let fontCache = null;
function readFonts() {
  if (fontCache) return fontCache;
  const keys = ['HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'];
  fontCache = Promise.all(keys.map(key => new Promise(resolve => execFile('reg', ['query', key], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => resolve(error ? '' : stdout)))))
    .then(outputs => {
      const fonts = [];
      const systemDir = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
      for (const output of outputs) for (const line of output.split(/\r?\n/)) {
        const match = line.match(/^\s+(.+?)\s+REG_SZ\s+(.+)$/);
        if (!match || !/\.(ttf|otf)$/i.test(match[2].trim())) continue;
        const name = match[1].replace(/\s*\((TrueType|OpenType)\)\s*$/i, '').trim();
        const file = path.isAbsolute(match[2].trim()) ? match[2].trim() : path.join(systemDir, match[2].trim());
        const bold = /\bbold\b|\bblack\b|\bheavy\b/i.test(name), italic = /\bitalic\b|\boblique\b/i.test(name);
        const family = name.replace(/\b(Bold|Italic|Oblique|Regular)\b/gi, '').replace(/\s+/g, ' ').trim();
        fonts.push({ family, name, bold, italic, file });
      }
      return fonts;
    });
  return fontCache;
}

// Estilos de verdade (lidos dos arquivos): família tipográfica, nome do estilo, peso e itálico; inclui fontes variáveis.
let faceCache = null;
function readFaces() {
  if (faceCache) return faceCache;
  const { readFontFile } = require('./fontInfo.cjs');
  faceCache = readFonts().then(fonts => {
    const seen = new Set(), faces = [];
    for (const f of fonts) { const key = f.file.toLowerCase(); if (seen.has(key) || !fs.existsSync(f.file)) continue; seen.add(key); faces.push(...readFontFile(f.file)); }
    return faces.filter(f => f.family && !/^[0-9a-f]{10,}/i.test(f.family) && !f.family.startsWith('.'));
  });
  return faceCache;
}
ipcMain.handle('vs:font-families', async () => [...new Set((await readFaces()).map(f => f.family))].sort((a, b) => a.localeCompare(b)));
ipcMain.handle('vs:font-faces', async () => (await readFaces()).map(({ family, style, weight, italic, variable }) => ({ family, style, weight, italic, variable })));
ipcMain.handle('vs:font-file', async (_event, request) => {
  const family = String(request?.family ?? '').toLowerCase(), bold = !!request?.bold, italic = !!request?.italic, weight = Number(request?.weight) || (bold ? 700 : 400);
  // Primeiro pelos estilos lidos dos arquivos (peso mais próximo, mesmo itálico); fonte variável não serve para o contorno exato.
  const faces = (await readFaces()).filter(f => f.family.toLowerCase() === family && f.italic === italic);
  if (faces.length) {
    const face = faces.reduce((a, b) => Math.abs(b.weight - weight) < Math.abs(a.weight - weight) ? b : a);
    if (face.variable) return null;
    if (fs.existsSync(face.file)) { const data = fs.readFileSync(face.file); return { bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), synthetic: false }; }
  }
  const fonts = (await readFonts()).filter(f => f.family.toLowerCase() === family || f.name.toLowerCase() === family);
  const font = fonts.find(f => f.bold === bold && f.italic === italic) ?? fonts.find(f => !f.bold && !f.italic) ?? fonts[0];
  if (!font || !fs.existsSync(font.file)) return null;
  const data = fs.readFileSync(font.file);
  return { bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), synthetic: font.bold !== bold || font.italic !== italic };
});
// CDR, PDF, AI e EPS são convertidos em SVG pelo Inkscape (libcdr/poppler) e importados pelo editor.
function findInkscape() {
  const roots = [process.resourcesPath && path.join(process.resourcesPath, 'inkscape'), process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Inkscape'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Inkscape'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Inkscape')].filter(Boolean);
  for (const root of roots) { const exe = path.join(root, 'bin', 'inkscape.com'); if (fs.existsSync(exe)) return exe; }
  return null;
}
const EXTERNAL = ['.cdr', '.pdf', '.ai', '.eps'];
/** LibreDWG (GPL-3.0+, programa separado): dwg2dxf.exe embutido em resources/libredwg ou em vendor/libredwg no desenvolvimento. */
function findDwg2Dxf() {
  const roots = [process.resourcesPath && path.join(process.resourcesPath, 'libredwg'), path.join(__dirname, '..', 'vendor', 'libredwg')].filter(Boolean);
  for (const root of roots) { const exe = path.join(root, 'dwg2dxf.exe'); if (fs.existsSync(exe)) return exe; }
  return null;
}
/** Gerador de DWG do LibreDWG (dwgadd), na mesma pasta do dwg2dxf. */
function findDwgAdd() { const dwg2dxf = findDwg2Dxf(), exe = dwg2dxf && path.join(path.dirname(dwg2dxf), 'dwgadd.exe'); return exe && fs.existsSync(exe) ? exe : null; }
const runTool = (tool, args, ms) => new Promise(resolve => execFile(tool, args, { windowsHide: true, timeout: ms, maxBuffer: 32 * 1024 * 1024, cwd: path.dirname(tool) }, error => resolve(error)));
/** Exportar DWG: o dwgadd cria o DWG 2000; o dwg2dxf relê o arquivo para confirmar que não saiu corrompido. */
ipcMain.handle('vs:export-dwg', async (_event, request) => {
  const tool = findDwgAdd(), reader = findDwg2Dxf(), script = String(request?.script ?? '');
  if (!tool || !reader) return { ok: false, error: 'O gerador de DWG (LibreDWG) não está instalado com o GFX Studio. Use DXF.' };
  if (!script || script.length > 200 * 1024 * 1024) return { ok: false, error: 'Nada para exportar.' };
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'vectorstudio-dwgout-')), input = path.join(dir, 'desenho.add'), output = path.join(dir, 'desenho.dwg'), check = path.join(dir, 'conferencia.dxf');
  try {
    fs.writeFileSync(input, script, 'utf8');
    const error = await runTool(tool, ['-o', output, input], 180000);
    if (!fs.existsSync(output) || fs.statSync(output).size === 0) return { ok: false, error: error?.killed ? 'A geração do DWG demorou mais de 3 minutos.' : 'O LibreDWG não conseguiu gerar o DWG. Use DXF.' };
    await runTool(reader, ['-y', '-o', check, output], 180000);
    if (!fs.existsSync(check) || fs.statSync(check).size === 0) return { ok: false, error: 'O DWG gerado não passou na conferência de leitura. Use DXF.' };
    return { ok: true, dwg: new Uint8Array(fs.readFileSync(output)) };
  } catch (error) { return { ok: false, error: error.message }; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
/** Remover fundo com IA (IS-Net): a janela manda a imagem 1024×1024 normalizada e recebe a máscara. */
const backgroundAI = require('./removeBackgroundAI.cjs');
ipcMain.handle('vs:remove-bg-ai-available', () => backgroundAI.available());
ipcMain.handle('vs:remove-bg-ai', async (_event, input) => {
  try { const { mask, provider } = await backgroundAI.run(input instanceof Float32Array ? input : new Float32Array(input ?? [])); return { ok: true, mask, provider }; }
  catch (error) { return { ok: false, error: error?.message ?? 'Não foi possível rodar o modelo de IA.' }; }
});
/** Conversor de CDR (tracedraw-cli, MIT/Apache-2.0): o embutido em resources/tracedraw ou o da pasta vendor. */
function findTraceDraw() {
  const roots = [process.resourcesPath && path.join(process.resourcesPath, 'tracedraw'), path.join(__dirname, '..', 'vendor', 'tracedraw')].filter(Boolean);
  for (const root of roots) { const exe = path.join(root, 'tracedraw-cli.exe'); if (fs.existsSync(exe)) return exe; }
  return null;
}
/** Salvar como CDR: o SVG do desenho vira .cdr na versão pedida (7 a 27); o `check` do conversor relê o arquivo. */
ipcMain.handle('vs:export-cdr', async (_event, request) => {
  const tool = findTraceDraw(), svg = String(request?.svg ?? ''), version = Math.round(Number(request?.version));
  if (!tool) return { ok: false, error: 'O conversor de CDR não está instalado com o GFX Studio. Use PDF ou SVG.' };
  if (!svg || svg.length > 300 * 1024 * 1024) return { ok: false, error: 'Nada para exportar.' };
  if (!(version >= 7 && version <= 27)) return { ok: false, error: 'Versão de CDR inválida.' };
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'vectorstudio-cdr-')), input = path.join(dir, 'desenho.svg'), output = path.join(dir, 'desenho.cdr');
  try {
    fs.writeFileSync(input, svg, 'utf8');
    const run = args => new Promise(resolve => execFile(tool, args, { windowsHide: true, timeout: 180000, maxBuffer: 32 * 1024 * 1024, cwd: dir, env: { ...process.env, TRACEDRAW_CDR_VERSION: String(version) } }, (error, stdout, stderr) => resolve({ error, out: `${stdout}${stderr}` })));
    const made = await run(['convert', input, output]);
    if (!fs.existsSync(output) || fs.statSync(output).size === 0) return { ok: false, error: made.error?.killed ? 'A geração do CDR demorou mais de 3 minutos.' : 'Não foi possível gerar o CDR. Use PDF ou SVG.' };
    const check = await run(['check', output]);
    return { ok: true, cdr: new Uint8Array(fs.readFileSync(output)), note: /no findings/i.test(check.out) ? '' : check.out.trim().slice(0, 300) };
  } catch (error) { return { ok: false, error: error.message }; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
/** Converte DWG (bytes) em DXF numa pasta temporária. */
async function convertDwg(bytes) {
  const tool = findDwg2Dxf();
  if (!tool) throw new Error('O conversor de DWG (LibreDWG) não está instalado com o GFX Studio.');
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'vectorstudio-dwg-')), input = path.join(dir, 'entrada.dwg'), output = path.join(dir, 'saida.dxf');
  try {
    fs.writeFileSync(input, bytes);
    await new Promise((resolve, reject) => execFile(tool, ['-y', '-o', output, input], { windowsHide: true, timeout: 180000, maxBuffer: 32 * 1024 * 1024, cwd: path.dirname(tool) }, error => {
      if (fs.existsSync(output) && fs.statSync(output).size > 0) resolve(null); else reject(new Error(error?.killed ? 'A conversão do DWG demorou mais de 3 minutos.' : 'Não foi possível ler este DWG (versão não suportada ou arquivo danificado). No AutoCAD, salve como DXF e abra o DXF.'));
    }));
    return new Uint8Array(fs.readFileSync(output));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
/** Aquece o Inkscape (DLLs e cache de fontes) em segundo plano, para a primeira importação não demorar. */
function prewarmInkscape() {
  const inkscape = findInkscape();
  if (!inkscape) return;
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'vectorstudio-')), input = path.join(dir, 'aquecer.svg');
  fs.writeFileSync(input, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text y="9" font-family="Arial">Aa</text></svg>');
  execFile(inkscape, [input, '--export-type=svg', '--export-plain-svg', `--export-filename=${path.join(dir, 'saida.svg')}`], { windowsHide: true, timeout: 120000 }, () => fs.rmSync(dir, { recursive: true, force: true }));
}
/** Converte CDR/PDF/AI/EPS (bytes) em SVG numa pasta temporária. */
/**
 * Número de páginas de um PDF: maior /Count das árvores de páginas, inclusive dentro de fluxos compactados
 * (PDF 1.5+ guarda os objetos em fluxos FlateDecode).
 */
function pdfPageCount(bytes) {
  const zlib = require('node:zlib'), buffer = Buffer.from(bytes), texts = [buffer.toString('latin1')];
  const raw = texts[0];
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length, end = raw.indexOf('endstream', start);
    if (end < 0 || end - start > 20 * 1024 * 1024) continue;
    try { texts.push(zlib.inflateSync(buffer.subarray(start, end)).toString('latin1')); } catch { /* não é FlateDecode */ }
  }
  let count = 0;
  for (const t of texts) for (const m of t.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)) count = Math.max(count, Number(m[1] ?? m[2]));
  if (!count) count = (raw.match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
  return Math.max(1, Math.min(count, 9999));
}
ipcMain.handle('vs:pdf-page-count', (_event, request) => { try { return { ok: true, pages: pdfPageCount(request?.bytes ?? new Uint8Array()) }; } catch (error) { return { ok: false, error: error.message }; } });
async function convertToSvg(bytes, ext, page = 1) {
  const inkscape = findInkscape();
  if (!inkscape) throw new Error('Para abrir CDR, PDF, AI ou EPS é preciso o Inkscape (gratuito: inkscape.org).');
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'vectorstudio-')), input = path.join(dir, 'entrada' + ext), output = path.join(dir, 'saida.svg');
  try {
    fs.writeFileSync(input, bytes);
    await new Promise((resolve, reject) => execFile(inkscape, [input, ...(ext === '.pdf' && page > 1 ? [`--pages=${Math.round(page)}`] : []), '--export-type=svg', '--export-plain-svg', `--export-filename=${output}`], { windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024 }, error => {
      if (fs.existsSync(output)) resolve(null); else reject(new Error(error?.killed ? 'A conversão demorou mais de 3 minutos.' : `O Inkscape não conseguiu ler o arquivo${ext === '.eps' ? ' (EPS exige o Ghostscript)' : ''}.`));
    }));
    return fs.readFileSync(output, 'utf8');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// Imprimir: o editor monta o HTML das páginas; uma janela oculta abre a impressão do Windows no tamanho da página.
ipcMain.handle('vs:print', async (_event, request) => {
  const html = String(request?.html ?? '');
  if (!html || html.length > 200 * 1024 * 1024) return { ok: false, error: 'Nada para imprimir.' };
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'vectorstudio-print-')), file = path.join(dir, 'imprimir.html');
  const printer = new BrowserWindow({ show: false, parent: window ?? undefined, webPreferences: { sandbox: true, javascript: false } });
  try {
    fs.writeFileSync(file, html, 'utf8');
    await printer.loadFile(file);
    return await new Promise(resolve => printer.webContents.print({ silent: false, printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } }, (success, reason) => resolve(success ? { ok: true } : reason === 'cancelled' || reason === 'canceled' ? { ok: true, canceled: true } : { ok: false, error: `Falha na impressão: ${reason}` })));
  } catch (error) { return { ok: false, error: error.message }; }
  finally { if (!printer.isDestroyed()) printer.destroy(); fs.rmSync(dir, { recursive: true, force: true }); }
});
ipcMain.handle('vs:convert-external', async (_event, request) => {
  const ext = path.extname(String(request?.name ?? '')).toLowerCase();
  if (ext === '.dwg') { try { return { ok: true, svg: '', dxf: await convertDwg(Buffer.from(request.bytes)) }; } catch (error) { return { ok: false, error: error.message }; } }
  if (!EXTERNAL.includes(ext)) return { ok: false, error: 'Formato não suportado.' };
  try { return { ok: true, svg: await convertToSvg(Buffer.from(request.bytes), ext, Number(request.page) || 1) }; } catch (error) { return { ok: false, error: error.message }; }
});
/** Lê um arquivo escolhido: projeto (.gfxs ou .vectorstudio), SVG ou formato externo convertido em SVG. */
async function readForEditor(file) {
  const ext = path.extname(file).toLowerCase(), name = path.basename(file);
  if (fs.statSync(file).size > (isProject(file) ? 10 : 300) * 1024 * 1024) throw new Error('O arquivo excede o limite de tamanho.');
  if (isProject(file)) return { kind: 'project', path: file, name, content: fs.readFileSync(file, 'utf8') };
  if (ext === '.svg') return { kind: 'svg', name, source: ext, content: fs.readFileSync(file, 'utf8') };
  // AutoCAD: o DXF é lido pelo editor; o DWG é convertido antes em DXF.
  if (ext === '.dxf') return { kind: 'svg', name, source: ext, content: '', bytes: new Uint8Array(fs.readFileSync(file)) };
  if (ext === '.dwg') return { kind: 'svg', name, source: ext, content: '', bytes: await convertDwg(fs.readFileSync(file)) };
  // CDR: os bytes vão junto para o editor ler os estilos de texto (peso, alinhamento) gravados no arquivo.
  if (ext === '.pdf') { const bytes = fs.readFileSync(file); return { kind: 'pdf', name, source: ext, content: '', bytes: new Uint8Array(bytes), pages: pdfPageCount(bytes) }; }
  if (EXTERNAL.includes(ext)) { const bytes = fs.readFileSync(file); return { kind: 'svg', name, source: ext, content: await convertToSvg(bytes, ext), ...(ext === '.cdr' ? { bytes: new Uint8Array(bytes) } : {}) }; }
  throw new Error('Formato não suportado.');
}
/** Tela de boas-vindas: tamanho e existência dos arquivos recentes. */
ipcMain.handle('vs:file-info', (_event, request) => (Array.isArray(request?.paths) ? request.paths.slice(0, 20) : []).map(p => { const file = String(p); try { const st = fs.statSync(file); return { path: file, exists: st.isFile(), size: st.size }; } catch { return { path: file, exists: false, size: 0 }; } }));
/** Abrir recente: lê um arquivo pelo caminho guardado na lista de recentes. */
ipcMain.handle('vs:open-path', async (_event, request) => {
  const file = String(request?.path ?? '');
  if (!file || !path.isAbsolute(file)) return { ok: false, error: 'Caminho inválido.' };
  if (!fs.existsSync(file)) return { ok: false, error: `O arquivo não existe mais: ${file}` };
  try { return { ok: true, file: await readForEditor(file) }; } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('vs:open-dialog', async () => {
  const result = await dialog.showOpenDialog(window, { title: 'Abrir', properties: ['openFile'], filters: [{ name: 'Todos os suportados', extensions: ['gfxs', 'vectorstudio', 'cdr', 'pdf', 'ai', 'eps', 'svg', 'dxf', 'dwg'] }, { name: 'Projeto GFX Studio', extensions: ['gfxs', 'vectorstudio'] }, { name: 'CorelDRAW', extensions: ['cdr'] }, { name: 'PDF', extensions: ['pdf'] }, { name: 'Illustrator / EPS', extensions: ['ai', 'eps'] }, { name: 'SVG', extensions: ['svg'] }, { name: 'AutoCAD (DXF / DWG)', extensions: ['dxf', 'dwg'] }] });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  try { return { ok: true, file: await readForEditor(result.filePaths[0]) }; } catch (error) { return { ok: false, error: error.message }; }
});
/** Salvar: grava no arquivo atual; sem arquivo (ou Salvar como) pergunta o local. */
ipcMain.handle('vs:save-project', async (_event, request) => {
  let file = request?.path;
  if (!file || request?.saveAs) {
    const suggested = String(request?.name || 'Sem título').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + '.gfxs';
    // Salvar como sugere .gfxs, também para projetos antigos (.vectorstudio).
    const result = await dialog.showSaveDialog(window, { title: request?.saveAs ? 'Salvar como' : 'Salvar', defaultPath: file ? file.replace(/\.vectorstudio$/i, '.gfxs') : path.join(app.getPath('documents'), suggested), filters: [{ name: 'Projeto GFX Studio', extensions: ['gfxs'] }] });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    file = isProject(result.filePath) ? result.filePath : result.filePath + '.gfxs';
  }
  try {
    // Cópia de segurança ao salvar (CorelDRAW: "Cópia_de_segurança_de_<nome>"): guarda a versão anterior do arquivo.
    if (request?.backup && fs.existsSync(file)) { try { fs.copyFileSync(file, path.join(path.dirname(file), 'Cópia_de_segurança_de_' + path.basename(file))); } catch { /* sem permissão: salva mesmo assim */ } }
    // Grava num temporário e renomeia: uma falha no meio não corrompe o arquivo anterior.
    const temporary = file + '.salvando';
    fs.writeFileSync(temporary, String(request.content), 'utf8'); fs.renameSync(temporary, file);
    return { ok: true, path: file, name: path.basename(file) };
  } catch (error) { return { ok: false, error: `Não foi possível salvar: ${error.message}` }; }
});
// Backup automático: um .vectorstudio + um .json (nome, caminho original, hora) por documento com alterações.
const backupDir = () => path.join(app.getPath('userData'), 'Backup automático');
const backupFile = (key, ext) => { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(key))) throw new Error('Chave de backup inválida.'); return path.join(backupDir(), key + ext); };
const reply = run => { try { return { ok: true, value: run() }; } catch (error) { return { ok: false, error: error.message }; } };
ipcMain.handle('vs:backup-write', (_event, request) => reply(() => {
  const content = String(request?.content ?? '');
  if (content.length > 12 * 1024 * 1024) throw new Error('documento grande demais para o backup');
  fs.mkdirSync(backupDir(), { recursive: true });
  const file = backupFile(request.key, '.vectorstudio'), meta = request?.meta ?? {};
  fs.writeFileSync(file + '.salvando', content, 'utf8'); fs.renameSync(file + '.salvando', file);
  fs.writeFileSync(backupFile(request.key, '.json'), JSON.stringify({ name: String(meta.name ?? 'Sem título'), path: meta.path ? String(meta.path) : undefined, saved: Number(meta.saved) || Date.now() }), 'utf8');
}));
ipcMain.handle('vs:backup-remove', (_event, request) => reply(() => { for (const ext of ['.vectorstudio', '.json']) fs.rmSync(backupFile(request?.key, ext), { force: true }); }));
ipcMain.handle('vs:backup-list', () => reply(() => {
  if (!fs.existsSync(backupDir())) return [];
  return fs.readdirSync(backupDir()).filter(f => f.endsWith('.vectorstudio')).map(f => {
    const key = f.slice(0, -'.vectorstudio'.length), file = path.join(backupDir(), f);
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(backupFile(key, '.json'), 'utf8')); } catch { /* sem metadados: usa o arquivo */ }
    return { key, name: meta.name ?? key, path: meta.path, saved: meta.saved ?? fs.statSync(file).mtimeMs };
  }).filter(b => /^[a-zA-Z0-9_-]{1,80}$/.test(b.key));
}));
ipcMain.handle('vs:backup-read', (_event, request) => reply(() => fs.readFileSync(backupFile(request?.key, '.vectorstudio'), 'utf8')));
ipcMain.handle('vs:backup-folder', async () => { fs.mkdirSync(backupDir(), { recursive: true }); await shell.openPath(backupDir()); });
ipcMain.on('vs:close-confirmed', () => { if (window) window.destroy(); });
ipcMain.on('vs:toggle-fullscreen', () => { if (window) window.setFullScreen(!window.isFullScreen()); });
// Visualização em tela cheia (F9): entra e sai explicitamente.
ipcMain.on('vs:set-fullscreen', (_event, on) => { if (window) window.setFullScreen(on === true); });

// Perfil separado (testes lado a lado com o app instalado aberto): VECTORSTUDIO_PROFILE=<pasta>.
// O programa passou a se chamar GFX Studio: preferências e backups continuam na pasta de dados de antes.
if (process.env.VECTORSTUDIO_PROFILE) app.setPath('userData', path.resolve(process.env.VECTORSTUDIO_PROFILE));
else app.setPath('userData', path.join(app.getPath('appData'), 'Vector Studio'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } sendFile(projectArgument(argv)); });
  app.whenReady().then(() => {
    protocol.handle('app', request => {
      const { pathname } = new URL(request.url);
      const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
      if (!file.startsWith(DIST)) return new Response('Não encontrado', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    createWindow();
    sendFile(projectArgument(process.argv));
    setTimeout(prewarmInkscape, 4000);
  });
  app.on('window-all-closed', () => app.quit());
}

