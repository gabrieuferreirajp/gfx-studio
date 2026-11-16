# GFX Studio (antigo Vector Studio) — instruções para continuidade

Leia `CONTINUAR-NO-CLAUDE.md` (histórico das versões) antes de modificar o projeto.

## Projeto
Editor gráfico vetorial offline para Windows, existente e funcional. Vite + React 19 + TypeScript + SVG nativo + CSS + Lucide. Paper.js 0.12.18 realiza operações booleanas em Web Worker. Não recrie o projeto nem substitua o motor por canvas/rasterização.

## Preferências atuais do usuário
- Responder em português, com no máximo 8 linhas ao concluir: implementado, testes, pendências e como executar.
- A preferência inicial macOS foi substituída explicitamente por uma interface o mais semelhante possível ao **CorelDRAW atual para Windows**, com menus nos mesmos locais e área de trabalho personalizável.
- Usar ícones para operações booleanas, com tooltips e nomes acessíveis.
- Preservar todas as ferramentas já implementadas. Fazer somente o escopo solicitado, sem refatorações desnecessárias ou dependências supérfluas.
- Não implementar CDR/AI sem solicitação. O aplicativo instalado usa Electron (pedido do usuário; não há Rust nesta máquina, por isso não Tauri). Exportação PDF/SVG/EPS/DXF/DWG/PLT/PNG/JPG/WebP foi pedida e existe (`src/io/exporters.ts`; DWG só no app instalado, gerado pelo dwgadd do LibreDWG); abrir/importar DXF e DWG existe (DWG convertido pelo LibreDWG embutido em resources/libredwg).
- Não criar controles decorativos que aparentem funcionar. Comandos indisponíveis devem indicar isso.
- Executar testes e build e corrigir erros introduzidos.

## Arquitetura
- Pastas de `src`: `document/` (modelo, persistência, camadas, páginas, cores, unidades), `geometry/` (formas, nós, booleanas no worker, cortes, efeitos, ligações), `io/` (importar/exportar, área de transferência, ponte do Electron), `bitmap/` (rastreamento, recorte, máscara de camada), `text/`, `components/` (canvas e ferramentas), `workspace/` (interface Corel), `state/` (editor, histórico, arquivos, backup).
- Nome do programa: GFX Studio (antes Vector Studio). Projetos salvam como `.gfxs` desde a 0.26 (`.vectorstudio` antigo continua abrindo); IDs internos (`vectorstudio:` eventos, chaves do localStorage) e a pasta de dados do Electron (`%APPDATA%\Vector Studio`) foram mantidos para compatibilidade. O projeto não tem vínculo com nenhuma empresa: appId `com.gfxstudio.app`, autor/copyright "GFX Studio"; o `nsis.guid` fixo mantém a atualização por cima das instalações antigas.
- `src/document/model.ts`: documento JSON versão 1, objetos com UUID, comandos M/L/C/Z, matrizes afins, grupos e preenchimento nonzero/evenodd.
- `src/state/EditorContext.tsx`: estado centralizado, seleção, operações e coordenação com histórico.
- `src/state/history.ts`: histórico imutável, transações por gesto, no máximo 100 entradas.
- `src/document/persistence.ts`: validação estrita, limite de 10 MB e 10.000 objetos/comandos por caminho.
- `src/components/Canvas.tsx` e hooks associados: desenho, zoom/pan, seleção, transformação e edição de nós.
- `src/geometry/booleanGeometry.ts`, `boolean.worker.ts`, `booleanClient.ts`: motor Paper.js isolado, sem rasterização. Até 30 segundos de inicialização e 10 segundos de cálculo; falhas não substituem o documento.
- `src/geometry/worldGeometry.ts`: geometria em coordenadas do documento (canvas e exportação desenham caminhos sem matriz, para o contorno não distorcer).
- `src/geometry/powerClip.ts` (campo `clipParent`/`clipUnlocked`), `src/geometry/shapeFactory.ts` (polígono, estrela, espiral, papel milimetrado, mão livre), `src/bitmap/bitmapTrace.ts` (rastreamento), `src/io/clipboard.ts` (copiar/colar e imagens), `src/document/units.ts` (13 unidades do Corel).
- `src/workspace/`: nova interface desktop e preferências de disposição em localStorage, independentes do documento/histórico. Implementada, mas a validação interativa completa foi interrompida pelo pedido de migração.

## Comandos Windows
Node.js 22.18+ ou 24 LTS. Execute na raiz:
```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
node tests/boolean-worker-smoke.mjs
npm.cmd run dev -- --port 5174 --strictPort
```
Abra o endereço informado pelo Vite. Mantenha o processo em execução. Se a porta estiver ocupada, use o servidor já aberto ou escolha outra porta; não encerre processos indiscriminadamente. Preferências de interface são específicas da origem do navegador, incluindo a porta.

## Aplicativo instalado (Windows)
Electron 38 + electron-builder (NSIS). `electron/main.cjs` serve `dist/` pelo protocolo `app://`, pede confirmação ao fechar com alterações, abre `.vectorstudio` pelo Windows (associação de arquivo) e expõe em `electron/preload.cjs` só a lista/arquivos de fontes do Windows (Ctrl+Q em textos) e tela cheia.
```powershell
npm.cmd run desktop   # testa o app sem instalar
npm.cmd run vendor    # uma vez: copia o Inkscape (vendor/inkscape) e o tracedraw-cli do TraceDraw da Store (vendor/tracedraw); o modelo de IA fica em vendor/models
npm.cmd run dist      # gera release\GFX-Studio-Setup-<versão>.exe (≈156 MB, com o Inkscape embutido)
```
Ícone: `public/icon.svg` → `npm.cmd run icon` gera `build/icon.png`, `build/icon.ico` e `electron/icon.png`. O npm 11 bloqueia scripts de instalação; o do Electron foi aprovado em `allowScripts`. Sem modo desenvolvedor do Windows, a primeira execução do electron-builder falha ao extrair links de macOS do winCodeSign: extraia o `.7z` do cache para `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` (ignorando os dois erros) e rode de novo. O Inkscape (GPL-2.0+) vai embutido em `resources/inkscape` para converter CDR/PDF/AI/EPS; `scripts/vendor-inkscape.mjs` copia só as DLLs importadas pelo inkscape.exe (análise da tabela PE) e remove tutoriais, Python, depurador e traduções, mantendo licenças. O instalador não é assinado (o Windows SmartScreen avisa na primeira execução). Não edite JSON/JS com `Set-Content` do PowerShell 5: ele grava BOM e corrompe acentos.

Não confundir salvar a disposição com salvar o desenho: o projeto continua usando download `.vectorstudio` e abertura local explícita.
