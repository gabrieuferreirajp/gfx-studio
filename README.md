# GFX Studio

Editor gráfico vetorial gratuito para Windows, com interface e atalhos inspirados no CorelDRAW. Funciona offline.

> Projeto em fase de testes. Encontrou um problema ou tem uma sugestão? Abra uma [Issue](../../issues) descrevendo o que
> fez, o que esperava e o que aconteceu (um print ajuda muito).

## Baixar e instalar (para testar)
1. Abra a página **[Releases](../../releases)** e baixe o arquivo `GFX-Studio-Setup-….exe` mais recente.
2. Execute o instalador. O instalador não é assinado digitalmente: o Windows SmartScreen pode avisar —
   clique em **Mais informações › Executar assim mesmo**.
3. Instalar uma versão nova por cima atualiza o programa sem apagar seus arquivos.

Requisitos: Windows 10 ou 11, 64 bits.

## O que ele faz
- Desenho vetorial: retângulo, elipse, polígono, estrela, espiral, mão livre, Bézier, caneta, B-Spline, polilinha.
- Ferramenta Forma (nós), operações de modelagem (Soldar, Aparar, Interseção…), PowerClip, envelope, perspectiva,
  sombra, contorno, mistura, extrusão, transparência, malha e preenchimentos.
- Texto artístico, de parágrafo e **texto no caminho**; tabelas; cotas e conectores.
- Páginas, camadas, guias, réguas, grade e guias dinâmicas.
- Bitmaps: rastreamento (vetorizar), recorte, máscara, carimbo e remoção de fundo por IA (local).
- Abrir/importar: CDR, PDF, AI, EPS, SVG, DXF, DWG e imagens. Exportar: PDF, SVG, EPS, DXF, DWG, PLT, CDR, PNG, JPG e WebP.
- Projeto próprio `.gfxs` com miniatura no Explorador do Windows.

## Rodar a partir do código-fonte
Requer [Node.js](https://nodejs.org) 22.18+ ou 24 LTS. No PowerShell, na pasta do projeto:
```powershell
npm.cmd ci
npm.cmd run dev          # abre no navegador (endereço mostrado no terminal)
npm.cmd run desktop      # abre como aplicativo (Electron)
```
Testes: `npm.cmd test`, `npm.cmd run build` e `node tests/boolean-worker-smoke.mjs`.

### Gerar o instalador
As ferramentas embutidas não ficam no repositório (são grandes e têm licenças próprias). Para copiá-las para `vendor/`:
- `npm.cmd run vendor` — Inkscape (precisa estar instalado) e o `tracedraw-cli` do TraceDraw (Microsoft Store).
- `node scripts/vendor-libredwg.mjs <pasta do libredwg-win64> <versão>` — LibreDWG (DWG).
- `vendor/models` — modelo de remoção de fundo `isnet-general-use.onnx` (Apache-2.0).

Depois: `npm.cmd run dist` gera `release\GFX-Studio-Setup-<versão>.exe`.

## Estrutura
- `src/` — editor (React + TypeScript + SVG). Pastas: `document`, `geometry`, `text`, `bitmap`, `io`, `state`,
  `components` (área de desenho e ferramentas) e `workspace` (menus, barras e janelas).
- `electron/` — aplicativo desktop (abrir/salvar, fontes do Windows, conversões).
- `tests/` — testes automáticos (`node --test`).
- `scripts/` — ícone, telas do instalador, provedor de miniaturas e cópia das ferramentas embutidas.
- `CLAUDE.md` e `CONTINUAR-NO-CLAUDE.md` — notas de desenvolvimento e histórico das versões.

## Componentes de terceiros (incluídos no instalador)
- [Inkscape](https://inkscape.org) — GPL-2.0+ (conversão de CDR, PDF, AI e EPS).
- [LibreDWG](https://www.gnu.org/software/libredwg/) — GPL-3.0+ (DWG).
- TraceDraw `tracedraw-cli` — MIT / Apache-2.0 (gravar CDR).
- Modelo IS-Net (`isnet-general-use.onnx`) — Apache-2.0 (remover fundo), via [ONNX Runtime](https://onnxruntime.ai) (MIT).
- [Paper.js](https://paperjs.org) (MIT), [React](https://react.dev) (MIT), [Lucide](https://lucide.dev) (ISC),
  [opentype.js](https://opentype.js.org) (MIT), [Electron](https://www.electronjs.org) (MIT).

As licenças acompanham cada componente na pasta `resources` da instalação.

GFX Studio não tem vínculo com a Corel Corporation nem com o CorelDRAW; os nomes são citados só como referência de
compatibilidade.
