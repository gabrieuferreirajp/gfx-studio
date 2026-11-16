import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { MAX_FILE_BYTES, embedThumbnail, parseProject, serializeProject } from '../document/persistence';
import { useEditor } from './EditorContext';
import { flushSync } from 'react-dom';
import { desktop } from '../io/desktop';
import { documentFromConverted, externalKind, openExternal, pdfDocuments, multiPageDocument } from '../io/importDocument';
import type { VectorDocument } from '../document/model';
import { fingerprint } from './history';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { pageList } from '../document/pages';
import { exportScene, toSvg } from '../io/exporters';
import { browserMeasure } from '../text/textMeasure';
/** Fecha a Tela de boas-vindas ao abrir um documento (evento, para não criar dependência circular). */
const welcomeClose = () => window.dispatchEvent(new CustomEvent('vectorstudio:welcome-close'));

/** Arquivos recentes (Arquivo › Abrir recente), só no aplicativo instalado: caminho e nome, mais recente primeiro. */
const RECENT = 'vectorstudio:recent-files';
export function recentFiles(): { path: string; name: string }[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT) ?? '[]'); return Array.isArray(v) ? v.filter(f => f && typeof f.path === 'string' && typeof f.name === 'string').slice(0, 10) : []; } catch { return []; }
}
// v2: a miniatura mostra todo o desenho (também o que fica fora da página).
const THUMB = 'vectorstudio:recent-thumb2:';
export const recentThumbnail = (path: string) => { try { return localStorage.getItem(THUMB + path.toLowerCase()); } catch { return null; } };
/** Prévia da primeira página em JPEG (lado maior `size`): enquadra todos os objetos, dentro ou fora da página. */
export function renderThumbnail(document: VectorDocument, size: number, quality: number): Promise<string | null> {
  return new Promise(done => { try {
    const page = pageList(document)[0], doc = { ...document, objects: page.objects, pages: undefined, page: undefined };
    let scene; try { scene = exportScene(doc, 'objects', []); } catch { scene = exportScene(doc, 'page', []); }
    const svg = toSvg(scene, browserMeasure, '#ffffff');
    const image = new Image();
    image.onerror = () => done(null);
    image.onload = () => { try { const w = image.naturalWidth || size, h = image.naturalHeight || size, k = size / Math.max(w, h), c = window.document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k)); const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(image, 0, 0, c.width, c.height); done(c.toDataURL('image/jpeg', quality)); } catch { done(null); } };
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  } catch { done(null); /* documento sem página exportável */ } });
}
/** Miniatura (JPEG pequeno) para a Tela de boas-vindas. */
export async function rememberThumbnail(path: string, document: VectorDocument): Promise<void> {
  const thumb = await renderThumbnail(document, 220, 0.7);
  if (thumb) try { localStorage.setItem(THUMB + path.toLowerCase(), thumb); } catch { /* sem espaço: fica sem miniatura */ }
}
/** Recentes sem miniatura (ou da versão antiga): lê o projeto em segundo plano e gera a prévia. */
export async function refreshThumbnails(paths: string[]): Promise<boolean> {
  let changed = false;
  for (const path of paths) {
    if (recentThumbnail(path) || !/\.(?:gfxs|vectorstudio)$/i.test(path) || !desktop?.openPath) continue;
    try { const r = await desktop.openPath(path); if (r.ok && r.file.kind === 'project') { await rememberThumbnail(path, parseProject(r.file.content)); changed = true; } } catch { /* fica sem miniatura */ }
  }
  return changed;
}
function rememberRecent(path: string, name: string) { try { localStorage.setItem(RECENT, JSON.stringify([{ path, name }, ...recentFiles().filter(f => f.path.toLowerCase() !== path.toLowerCase())].slice(0, 10))); } catch { /* preferências indisponíveis */ } }
function forgetRecent(path: string) { try { localStorage.setItem(RECENT, JSON.stringify(recentFiles().filter(f => f.path !== path))); } catch { /* preferências indisponíveis */ } }
export const openRecent = (path: string) => window.dispatchEvent(new CustomEvent('vectorstudio:open-recent', { detail: path }));

export function finishEditing() {
  flushSync(() => {
    window.dispatchEvent(new Event('vectorstudio:finish-gesture'));
    if (window.document.activeElement instanceof HTMLElement) window.document.activeElement.blur();
  });
}
export function useProjectFiles() {
  const editor = useEditor();
  const latest = useRef(editor);
  latest.current = editor;
  const { layout } = useWorkspace(), backupOnSave = useRef(layout.backupOnSave);
  backupOnSave.current = layout.backupOnSave;
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  // Salvar mostra só um aviso pequeno (1 s) abaixo das barras; abrir não mostra aviso (só erros).
  const [saved, setSaved] = useState(0);
  const flashSaved = () => { setMessage(''); setSaved(n => n + 1); };
  // Arquivo de projeto (.gfxs; .vectorstudio das versões antigas) em edição (aplicativo instalado): Salvar grava nele sem perguntar.
  const { file, setFile } = editor;
  const fileRef = useRef(file); fileRef.current = file;
  useEffect(() => {
    if (!editor.anyDirty) return;
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [editor.anyDirty]);
  const report = (cause: unknown, fallback: string) => { setError(true); setMessage(cause instanceof Error ? cause.message : fallback); };
  /** Salvar (Ctrl+S) grava no arquivo atual; Salvar como (Ctrl+Shift+S) ou o primeiro salvamento perguntam o local. */
  async function save(saveAs = false): Promise<boolean> {
    finishEditing();
    if (busy.current) return false;
    try {
      const document = latest.current.document;
      // A prévia vai no começo do arquivo: o Explorador do Windows mostra a miniatura do projeto.
      const source = embedThumbnail(serializeProject(document), await renderThumbnail(document, 384, 0.85));
      if (!desktop) {
        const url = URL.createObjectURL(new Blob([source], { type: 'application/json;charset=utf-8' }));
        const anchor = window.document.createElement('a');
        anchor.href = url; anchor.download = `${document.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'Projeto'}.gfxs`;
        window.document.body.appendChild(anchor); anchor.click(); anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        latest.current.markSaved(fingerprint(document));
        setError(false); flashSaved();
        return true;
      }
      busy.current = true;
      const result = await desktop.saveProject(source, fileRef.current?.path ?? null, fileRef.current?.name.replace(/\.(?:gfxs|vectorstudio)$/i, '') ?? document.name, saveAs, backupOnSave.current);
      if (!result.ok) { if (!result.canceled) throw new Error(result.error); return false; }
      setFile({ path: result.path, name: result.name }); rememberRecent(result.path, result.name); void rememberThumbnail(result.path, latest.current.document);
      latest.current.markSaved(fingerprint(document));
      setError(false); flashSaved();
      return true;
    } catch (cause) { report(cause, 'Não foi possível salvar o projeto.'); return false; }
    finally { busy.current = false; }
  }
  function load(document: VectorDocument, opened: { path: string; name: string } | null, text: string) {
    finishEditing();
    if (opened?.path) { rememberRecent(opened.path, opened.name); void rememberThumbnail(opened.path, document); }
    welcomeClose();
    // Como no CorelDRAW, cada arquivo aberto ganha sua própria aba (o mesmo arquivo só alterna para ela).
    const existing = opened && latest.current.tabs.find(t => t.file?.path.toLowerCase() === opened.path.toLowerCase());
    void text;
    if (existing) { latest.current.switchTab(existing.id); setError(false); setMessage(''); return; }
    latest.current.openTab(document, opened);
    setError(false); setMessage('');
  }
  // No aplicativo instalado, projetos abertos pelo Windows (duplo clique no arquivo) chegam por aqui.
  useEffect(() => desktop?.onOpenFile(opened => {
    try { load(parseProject(opened.content), opened.path ? { path: opened.path, name: opened.name } : null, `Projeto ${opened.name} aberto.`); }
    catch (cause) { report(cause, 'Não foi possível abrir o projeto.'); }
  }), []);
  /** Abrir recente (Arquivo › Abrir recente): mesmo caminho do Abrir, a partir do arquivo guardado. */
  async function openRecent(path: string) {
    if (busy.current || !desktop?.openPath) return;
    finishEditing(); busy.current = true;
    try {
      setError(false); setMessage('');
      const result = await desktop.openPath(path);
      if (!result.ok) { forgetRecent(path); throw new Error(result.error); }
      await openResult(result.file);
    } catch (cause) { report(cause, 'Não foi possível abrir o arquivo.'); }
    finally { busy.current = false; }
  }
  useEffect(() => { const handle = (e: Event) => void openRecent((e as CustomEvent<string>).detail); window.addEventListener('vectorstudio:open-recent', handle); return () => window.removeEventListener('vectorstudio:open-recent', handle); });
  async function open() {
    if (busy.current) return;
    finishEditing();
    if (!desktop) { input.current?.click(); return; }
    busy.current = true;
    try {
      setError(false); setMessage('');
      const result = await desktop.openDialog();
      if (!result.ok) { if (result.canceled) setMessage(''); else throw new Error(result.error); return; }
      await openResult(result.file);
    } catch (cause) { report(cause, 'Não foi possível abrir o arquivo.'); }
    finally { busy.current = false; }
  }
  type Opened = Extract<Awaited<ReturnType<NonNullable<typeof desktop>['openDialog']>>, { ok: true }>['file'];
  async function openResult(opened: Opened) {
    {
      if (opened.kind === 'project') { load(parseProject(opened.content), { path: opened.path, name: opened.name }, `Projeto ${opened.name} aberto.`); return; }
      if (opened.kind === 'pdf') {
        const name = opened.name.replace(/\.[^.]+$/, ''), r = await pdfDocuments(opened.bytes, name, 'abrir', opened.pages);
        if (!r) { setMessage('Abertura cancelada.'); return; }
        const document = multiPageDocument(r.documents, name, r.pages);
        load(document, null, `${opened.name} aberto: ${r.pages.length > 1 ? `${r.pages.length} páginas` : `${document.objects.length} objetos editáveis`}.${r.warnings.length ? ' ' + r.warnings.join(' ') : ''} Salvar cria um projeto .gfxs.`);
        return;
      }
      const { document, warnings } = await documentFromConverted(opened.content, opened.name.replace(/\.[^.]+$/, ''), opened.source, opened.bytes);
      load(document, null, `${opened.name} aberto: ${document.objects.length} objetos editáveis.${warnings.length ? ' ' + warnings.join(' ') : ''} Salvar cria um projeto .gfxs.`);
    }
  }
  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen || busy.current) return;
    busy.current = true;
    try {
      // CorelDRAW (.cdr), PDF, AI, EPS e SVG são convertidos em objetos editáveis.
      if (externalKind(chosen.name)) {
        setError(false); setMessage(`Convertendo ${chosen.name}…`);
        const opened = await openExternal(chosen, 'abrir');
        if (!opened) { setMessage('Abertura cancelada.'); return; }
        const { document, warnings } = opened;
        load(document, null, `${chosen.name} aberto: ${document.objects.length} objetos editáveis.${warnings.length ? ' ' + warnings.join(' ') : ''} Use Salvar para gravar como .gfxs.`);
        return;
      }
      if (!/\.(?:gfxs|vectorstudio)$/i.test(chosen.name)) throw new Error('Formato não suportado. Abra .gfxs, .cdr, .pdf, .ai, .eps, .svg, .dxf ou .dwg.');
      if (chosen.size > MAX_FILE_BYTES) throw new Error('O arquivo excede o limite de 10 MB.');
      load(parseProject(await chosen.text()), null, 'Projeto aberto. Todos os objetos estão disponíveis para edição.');
    } catch (cause) { report(cause, 'Não foi possível abrir o projeto.'); }
    finally { busy.current = false; }
  }
  return { input, saveAndConfirm: () => save(false), save: () => void save(false), saveAs: () => void save(true), open: () => void open(), onFile, file, message, error, saved, dismiss: () => setMessage('') };
}
