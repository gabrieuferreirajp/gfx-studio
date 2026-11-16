import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { browserMeasure } from '../text/textMeasure';
import { createBarcode, type BarcodeKind, type QrLevel } from '../text/barcode';
import { createTable, fieldToken, findTexts, mergeDocument, parseCsv, replaceInDocument, usedFields, type FindOptions } from '../text/textTools';
import { fromUnit, toUnit, unitDefinitions, unitStep } from '../document/units';
import { boundsOf } from '../geometry/objectTransforms';
import { updateText } from '../text/textLayout';
import { printDocument } from '../io/print';

/* Janelas do Bloco 2 (não modais, como as janelas encaixadas do CorelDRAW): abertas por eventos dos menus. */
export type TextToolDialog = 'find' | 'barcode' | 'table' | 'merge';
export const openTextTool = (dialog: TextToolDialog, detail?: string) => window.dispatchEvent(new CustomEvent('vectorstudio:text-tool', { detail: { dialog, detail } }));

function Window({ id, title, open, close, children }: { id: TextToolDialog; title: string; open: boolean; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.show(); if (!open && d.open) d.close(); }, [open]);
  return <dialog ref={ref} className={`workspace-settings transform-window text-tool-window text-tool-${id}`} aria-label={title} onCancel={e => { e.preventDefault(); close(); }} onKeyDown={e => e.stopPropagation()}>
    <header className="transform-header"><h2>{title}</h2><button type="button" className="dock-close" aria-label={`Fechar ${title}`} onClick={close}><X size={14} /></button></header>
    {open && children}
  </dialog>;
}

export function TextToolsDialogs() {
  const [open, setOpen] = useState<TextToolDialog | null>(null), [detail, setDetail] = useState<string | undefined>();
  useEffect(() => {
    const show = (e: Event) => { const d = (e as CustomEvent<{ dialog: TextToolDialog; detail?: string }>).detail; setDetail(d.detail); setOpen(d.dialog); };
    window.addEventListener('vectorstudio:text-tool', show); return () => window.removeEventListener('vectorstudio:text-tool', show);
  }, []);
  const close = () => setOpen(null);
  return <>
    <Window id="find" title="Localizar e substituir" open={open === 'find'} close={close}><FindReplace /></Window>
    <Window id="barcode" title="Inserir código" open={open === 'barcode'} close={close}><Barcode initial={(detail as BarcodeKind) ?? 'qr'} close={close} /></Window>
    <Window id="table" title="Criar nova tabela" open={open === 'table'} close={close}><Table close={close} /></Window>
    <Window id="merge" title="Mesclagem de impressão" open={open === 'merge'} close={close}><PrintMerge close={close} /></Window>
  </>;
}

/** Editar › Localizar e substituir (CorelDRAW): procura nos textos; Substituir tudo vale para todas as páginas. */
function FindReplace() {
  const { document, dispatch, commitEdit, setSelection, selectedIds } = useEditor();
  const [find, setFind] = useState(''), [replace, setReplace] = useState(''), [options, setOptions] = useState<FindOptions>({ matchCase: false, wholeWord: false }), [status, setStatus] = useState('');
  const matches = findTexts(document.objects, find, options);
  function next() {
    finishEditing();
    if (!matches.length) { setStatus(find ? 'Nenhum texto desta página contém a busca.' : 'Digite o texto a localizar.'); return; }
    const current = matches.findIndex(o => selectedIds.length === 1 && o.id === selectedIds[0]), target = matches[(current + 1) % matches.length];
    setSelection([target.id]); setStatus(`Texto ${matches.indexOf(target) + 1} de ${matches.length} nesta página.`);
  }
  function apply(onlySelected: boolean) {
    finishEditing();
    const ids = onlySelected ? matches.filter(o => selectedIds.includes(o.id)).map(o => o.id) : undefined;
    if (onlySelected && !ids!.length) { setStatus('Use “Localizar próximo” para selecionar um texto que contenha a busca.'); return; }
    const result = replaceInDocument(document, find, replace, options, browserMeasure, ids);
    if (!result.count) { setStatus('Nada para substituir.'); return; }
    commitEdit(); dispatch({ type: 'set-pages', document: result.document }); commitEdit();
    setStatus(`${result.count} ocorrência(s) substituída(s)${onlySelected ? ' no texto selecionado' : ' em todas as páginas'}. Ctrl+Z desfaz.`);
  }
  return <>
    <label className="settings-row">Localizar<input type="text" value={find} autoFocus onChange={e => { setFind(e.target.value); setStatus(''); }} onKeyDown={e => { if (e.key === 'Enter') next(); }} /></label>
    <label className="settings-row">Substituir por<input type="text" value={replace} onChange={e => setReplace(e.target.value)} /></label>
    <label className="settings-check"><input type="checkbox" checked={options.matchCase} onChange={e => setOptions({ ...options, matchCase: e.target.checked })} />Diferenciar maiúsculas e minúsculas</label>
    <label className="settings-check"><input type="checkbox" checked={options.wholeWord} onChange={e => setOptions({ ...options, wholeWord: e.target.checked })} />Somente palavras inteiras</label>
    <p className="muted" role="status">{status || (find ? `${matches.length} texto(s) nesta página contêm a busca.` : 'Procura no conteúdo dos textos (artísticos, de parágrafo e em caminho).')}</p>
    <footer><button type="button" onClick={next} disabled={!find}>Localizar próximo</button><button type="button" onClick={() => apply(true)} disabled={!find}>Substituir</button><button type="button" className="primary" onClick={() => apply(false)} disabled={!find}>Substituir tudo</button></footer>
  </>;
}

const pageCenter = (artboard: { width: number; height: number }) => ({ x: artboard.width / 2, y: artboard.height / 2 });

/** Objeto › Inserir › Código QR / Código de barras: gera curvas agrupadas no centro da página. */
function Barcode({ initial, close }: { initial: BarcodeKind; close: () => void }) {
  const { document, addObjects, setSelection } = useEditor();
  const [kind, setKind] = useState<BarcodeKind>(initial), [text, setText] = useState(''), [level, setLevel] = useState<QrLevel>('M');
  const unit = document.unit ?? 'px', u = unitDefinitions[unit].short;
  const [size, setSize] = useState(fromUnit(unit === 'px' ? 150 : 30, unit === 'px' ? 'px' : 'mm')), [height, setHeight] = useState(fromUnit(15, 'mm')), [showText, setShowText] = useState(true), [error, setError] = useState('');
  useEffect(() => setKind(initial), [initial]);
  function insert() {
    finishEditing();
    try {
      // QR: `size` é o lado do código; lineares: `size` é a largura total aproximada.
      const probe = createBarcode({ kind, text, level, module: 1, height: 1 }, 0, 0, browserMeasure), b = boundsOf(probe.filter(o => o.type === 'path'));
      const module = Math.max(0.05, size / Math.max(1, b.width)), c = pageCenter(document.artboard);
      const total = b.width * module;
      const objects = createBarcode({ kind, text, level, module, height, showText }, c.x - total / 2, c.y - (kind === 'qr' ? total : height) / 2, browserMeasure);
      addObjects(objects); setSelection(objects.map(o => o.id)); setError(''); close();
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível gerar o código.'); }
  }
  const length = (label: string, value: number, apply: (v: number) => void) => <label className="settings-row">{label}<input type="number" min={0} step={unitStep(unit)} value={Number(toUnit(value, unit).toPrecision(6))} onChange={e => { const v = fromUnit(Number(e.target.value), unit); if (Number.isFinite(v) && v > 0) apply(Math.min(v, 20000)); }} /><span>{u}</span></label>;
  return <>
    <label className="settings-row">Tipo<select value={kind} onChange={e => { setKind(e.target.value as BarcodeKind); setError(''); }}><option value="qr">Código QR</option><option value="code128">Code 128</option><option value="ean13">EAN-13</option></select></label>
    <label className="settings-row stacked">{kind === 'qr' ? 'Conteúdo (texto, link, telefone…)' : kind === 'ean13' ? '12 dígitos (o verificador é calculado)' : 'Conteúdo (ASCII)'}<textarea rows={kind === 'qr' ? 3 : 1} value={text} onChange={e => { setText(e.target.value); setError(''); }} spellCheck={false} /></label>
    {kind === 'qr' && <label className="settings-row">Correção de erros<select value={level} onChange={e => setLevel(e.target.value as QrLevel)}><option value="L">L (7%)</option><option value="M">M (15%)</option><option value="Q">Q (25%)</option><option value="H">H (30%)</option></select></label>}
    {length(kind === 'qr' ? 'Tamanho' : 'Largura', size, setSize)}
    {kind !== 'qr' && <>{length('Altura das barras', height, setHeight)}<label className="settings-check"><input type="checkbox" checked={showText} onChange={e => setShowText(e.target.checked)} />Mostrar o texto embaixo</label></>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <p className="muted">Gerado em curvas pretas agrupadas (sem zona de silêncio: deixe margem branca em volta ao imprimir).</p>
    <footer><button type="button" onClick={close}>Cancelar</button><button type="button" className="primary" disabled={!text.trim()} onClick={insert}>Inserir</button></footer>
  </>;
}

/** Tabela › Criar nova tabela: linhas × colunas no centro da página (células agrupadas). */
function Table({ close }: { close: () => void }) {
  const { document, addObjects, setSelection, textStyle } = useEditor();
  const unit = document.unit ?? 'px', u = unitDefinitions[unit].short;
  const [rows, setRows] = useState(3), [columns, setColumns] = useState(3), [width, setWidth] = useState(fromUnit(120, 'mm')), [height, setHeight] = useState(fromUnit(30, 'mm'));
  const [csv, setCsv] = useState<string[][] | null>(null), [error, setError] = useState('');
  async function load(file: File) {
    try { const data = parseCsv(await file.text()); const all = [data.fields, ...data.rows]; setCsv(all); setRows(Math.min(100, all.length)); setColumns(Math.min(50, data.fields.length)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'CSV inválido.'); }
  }
  function insert() {
    finishEditing();
    const c = pageCenter(document.artboard), objects = createTable({ x: c.x - width / 2, y: c.y - height / 2, width, height }, rows, columns, browserMeasure, csv ?? undefined, { ...textStyle, textAlign: 'left' });
    addObjects(objects); setSelection(objects.map(o => o.id)); close();
  }
  const count = (label: string, value: number, max: number, apply: (v: number) => void) => <label className="settings-row">{label}<input type="number" min={1} max={max} value={value} onChange={e => { const v = Math.round(Number(e.target.value)); if (v >= 1 && v <= max) apply(v); }} /></label>;
  const length = (label: string, value: number, apply: (v: number) => void) => <label className="settings-row">{label}<input type="number" min={0} step={unitStep(unit)} value={Number(toUnit(value, unit).toPrecision(6))} onChange={e => { const v = fromUnit(Number(e.target.value), unit); if (Number.isFinite(v) && v >= 1) apply(Math.min(v, 20000)); }} /><span>{u}</span></label>;
  return <>
    {count('Linhas', rows, 100, setRows)}{count('Colunas', columns, 50, setColumns)}
    {length('Largura', width, setWidth)}{length('Altura', height, setHeight)}
    <label className="settings-row">Preencher com CSV<input type="file" accept=".csv,.txt,text/csv" onChange={e => { const f = e.target.files?.[0]; if (f) void load(f); }} /></label>
    {csv && <p className="muted">{csv.length} linha(s) × {csv[0].length} coluna(s) do CSV (a primeira linha entra como título). <button type="button" className="link-button" onClick={() => setCsv(null)}>Remover dados</button></p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <p className="muted">Cada célula é um retângulo; os textos são de parágrafo, na fonte da barra de propriedades. Para escrever numa célula vazia, arraste a ferramenta Texto dentro dela.</p>
    <footer><button type="button" onClick={close}>Cancelar</button><button type="button" className="primary" onClick={insert}>Criar</button></footer>
  </>;
}

/** Arquivo › Mesclagem de impressão: campos «Nome» nos textos, dados de um CSV, um conjunto de páginas por registro. */
function PrintMerge({ close }: { close: () => void }) {
  const { document, dispatch, commitEdit, selectedIds, openTab, setMessage } = useEditor();
  const [data, setData] = useState<{ name: string; fields: string[]; rows: string[][] } | null>(null), [error, setError] = useState('');
  const used = usedFields(document), text = document.objects.find(o => o.type === 'text' && selectedIds.includes(o.id));
  async function load(file: File) {
    try { const parsed = parseCsv(await file.text()); setData({ name: file.name, ...parsed }); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'CSV inválido.'); }
  }
  function insertField(field: string) {
    if (!text) return;
    finishEditing(); commitEdit();
    dispatch({ type: 'set-objects', objects: document.objects.map(o => o.id === text.id ? updateText(o, { text: `${o.text ?? ''}${fieldToken(field)}` }, browserMeasure) : o) });
    commitEdit();
  }
  function merged() {
    if (!data) return null;
    try { return mergeDocument(document, data.fields, data.rows, browserMeasure); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível mesclar.'); return null; }
  }
  const missing = data ? used.filter(f => !data.fields.includes(f)) : [];
  return <>
    <label className="settings-row">Arquivo de dados (CSV)<input type="file" accept=".csv,.txt,text/csv" onChange={e => { const f = e.target.files?.[0]; if (f) void load(f); }} /></label>
    {data && <p className="muted">{data.name}: {data.rows.length} registro(s), campos {data.fields.join(', ')}.</p>}
    {data && <div className="merge-fields"><span>Inserir campo no texto selecionado:</span>{data.fields.map(f => <button type="button" key={f} disabled={!text} title={text ? `Acrescenta ${fieldToken(f)} ao fim do texto selecionado` : 'Selecione um texto no desenho'} onClick={() => insertField(f)}>{fieldToken(f)}</button>)}</div>}
    <p className="muted">Campos no documento: {used.length ? used.map(fieldToken).join(' ') : 'nenhum — digite «Campo» num texto ou use os botões acima.'}</p>
    {missing.length > 0 && <p className="form-error" role="alert">Campos sem coluna no CSV (ficam como estão): {missing.map(fieldToken).join(' ')}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer>
      <button type="button" onClick={close}>Fechar</button>
      <button type="button" disabled={!data || !used.length} title="Abre um documento novo com uma página por registro (o original não muda)" onClick={() => { finishEditing(); const doc = merged(); if (doc) { openTab(doc, null); setMessage(`Documento mesclado: ${data!.rows.length} registro(s).`); close(); } }}>Criar documento mesclado</button>
      <button type="button" className="primary" disabled={!data || !used.length} onClick={() => { finishEditing(); const doc = merged(); if (doc) { setMessage('Preparando impressão…'); void printDocument(doc).then(setMessage, e => setMessage(e instanceof Error ? e.message : 'Não foi possível imprimir.')); } }}>Imprimir mesclado</button>
    </footer>
  </>;
}
