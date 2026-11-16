import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { FilePlus2, FolderOpen, LayoutTemplate, Plus } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { createDocument } from '../document/model';
import { documentUnits, fromUnit, toUnit, unitDefinitions, type DocumentUnit } from '../document/units';
import { pageSizes } from './PageControls';
import { socialFormats } from './socialMedia';
import { openRecent, recentFiles, recentThumbnail, refreshThumbnails } from '../state/useProjectFiles';
import { desktop } from '../io/desktop';
import { useDialogDrag } from './useDialogDrag';

/** Tela de boas-vindas (como no CorelDRAW): aba própria com Novo, Abrir, modelos e arquivos recentes. */
const STARTUP = 'vectorstudio:welcome-startup';
const showOnStartup = () => { try { return localStorage.getItem(STARTUP) !== 'false'; } catch { return true; } };
let open = showOnStartup();
const listeners = new Set<() => void>();
export const welcome = {
  get: () => open,
  set: (value: boolean) => { if (open === value) return; open = value; listeners.forEach(l => l()); },
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
};
export const useWelcome = () => useSyncExternalStore(welcome.subscribe, welcome.get);

/** Modelos em branco (tamanhos usuais), como a lista de páginas e modelos do CorelDRAW/Trace Draw. */
const mm = (v: number) => v * 96 / 25.4;
const templates: { name: string; detail: string; width: number; height: number; unit: DocumentUnit }[] = [
  { name: 'Cartão de visita', detail: '90 × 50 mm', width: mm(90), height: mm(50), unit: 'mm' },
  { name: 'Folheto A5', detail: '148 × 210 mm', width: mm(148), height: mm(210), unit: 'mm' },
  { name: 'Folha A4', detail: '210 × 297 mm', width: mm(210), height: mm(297), unit: 'mm' },
  { name: 'Cartaz A3', detail: '297 × 420 mm', width: mm(297), height: mm(420), unit: 'mm' },
  { name: 'Banner 1 × 0,5 m', detail: '1000 × 500 mm', width: mm(1000), height: mm(500), unit: 'mm' },
  { name: 'Etiqueta 100 × 50 mm', detail: '100 × 50 mm', width: mm(100), height: mm(50), unit: 'mm' },
  ...socialFormats.filter(f => ['story', 'feed45', 'square', 'fullhd', 'youtube'].includes(f.id)).map(f => ({ name: `${f.name} ${f.ratio}`, detail: `${f.width} × ${f.height} px`, width: f.width, height: f.height, unit: 'px' as DocumentUnit })),
];
function Thumb({ width, height }: { width: number; height: number }) {
  const k = Math.min(84 / width, 84 / height);
  return <span className="welcome-thumb-page" style={{ width: Math.max(8, width * k), height: Math.max(8, height * k) }} />;
}
/** Criar novo documento: nome, tamanho, orientação e unidade. */
function NewDocumentDialog({ close, preset }: { close: () => void; preset?: { name: string; width: number; height: number; unit: DocumentUnit } }) {
  const { openTab } = useEditor(), ref = useRef<HTMLDialogElement>(null), move = useDialogDrag();
  const [name, setName] = useState(preset?.name ?? 'Sem título'), [unit, setUnit] = useState<DocumentUnit>(preset?.unit ?? 'mm');
  const [size, setSize] = useState({ width: preset?.width ?? mm(210), height: preset?.height ?? mm(297) });
  useEffect(() => { ref.current?.showModal(); }, []);
  const preset_ = pageSizes.find(([, w, h]) => (Math.abs(w - size.width) < 0.6 && Math.abs(h - size.height) < 0.6) || (Math.abs(h - size.width) < 0.6 && Math.abs(w - size.height) < 0.6))?.[0] ?? '';
  const landscape = size.width > size.height;
  const field = (key: 'width' | 'height', label: string) => <label className="settings-row">{label}<input type="number" min={toUnit(1, unit)} step="any" value={Number(toUnit(size[key], unit).toPrecision(6))} onChange={e => { const v = fromUnit(Number(e.target.value), unit); if (Number.isFinite(v) && v >= 1 && v <= 10000) setSize(s => ({ ...s, [key]: v })); }} /><span>{unitDefinitions[unit].short}</span></label>;
  return <dialog ref={ref} className="workspace-settings paint-dialog small-dialog" aria-label="Criar novo documento" style={move.style} onCancel={e => { e.preventDefault(); close(); }} onKeyDown={e => e.stopPropagation()}>
    <form method="dialog" onSubmit={e => { e.preventDefault(); openTab({ ...createDocument(), name: name.trim() || 'Sem título', unit, artboard: { width: Math.round(size.width * 100) / 100, height: Math.round(size.height * 100) / 100 } }, null); welcome.set(false); close(); }}>
      <header {...move.handle}><h2>Criar novo documento</h2></header>
      <div className="floating-body">
        <label className="settings-row">Nome<input value={name} maxLength={256} onChange={e => setName(e.target.value)} autoFocus /></label>
        <label className="settings-row">Tamanho<select value={preset_} onChange={e => { const p = pageSizes.find(([n]) => n === e.target.value); if (p) setSize(landscape ? { width: p[2], height: p[1] } : { width: p[1], height: p[2] }); }}>{!preset_ && <option value="">Personalizado</option>}{pageSizes.map(([n]) => <option key={n} value={n}>{n}</option>)}</select></label>
        {field('width', 'Largura')}{field('height', 'Altura')}
        <label className="settings-row">Orientação<select value={landscape ? 'l' : 'p'} onChange={e => { const wantLand = e.target.value === 'l'; if (wantLand !== landscape) setSize(s => ({ width: s.height, height: s.width })); }}><option value="p">Retrato</option><option value="l">Paisagem</option></select></label>
        <label className="settings-row">Unidade<select value={unit} onChange={e => setUnit(e.target.value as DocumentUnit)}>{documentUnits.map(u => <option key={u} value={u}>{unitDefinitions[u].label}</option>)}</select></label>
      </div>
      <footer><span /><span className="paint-dialog-buttons"><button type="submit" className="primary">OK</button><button type="button" onClick={close}>Cancelar</button></span></footer>
    </form>
  </dialog>;
}
function TemplatesDialog({ close, choose }: { close: () => void; choose: (t: typeof templates[number]) => void }) {
  const ref = useRef<HTMLDialogElement>(null), move = useDialogDrag();
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="workspace-settings paint-dialog welcome-templates" aria-label="Novo baseado em modelo" style={move.style} onCancel={e => { e.preventDefault(); close(); }} onKeyDown={e => e.stopPropagation()}>
    <header {...move.handle}><h2>Novo baseado em modelo</h2></header>
    <p className="muted welcome-note">Modelos em branco nos tamanhos mais usados. Escolha um para criar o documento.</p>
    <div className="welcome-template-grid">{templates.map(t => <button key={t.name} type="button" className="welcome-tile" onClick={() => choose(t)}><span className="welcome-thumb"><Thumb width={t.width} height={t.height} /></span><strong>{t.name}</strong><small>{t.detail}</small></button>)}</div>
    <footer><span /><span className="paint-dialog-buttons"><button type="button" onClick={close}>Cancelar</button></span></footer>
  </dialog>;
}
export function WelcomeScreen({ openFile }: { openFile: () => void }) {
  // Sem documento aberto (só o de reserva), a Tela de boas-vindas fica sempre à vista.
  const { tabs } = useEditor(), visible = useWelcome() || tabs.every(t => t.blank), [host, setHost] = useState<Element | null>(null);
  const [dialog, setDialog] = useState<null | { kind: 'new'; preset?: typeof templates[number] } | { kind: 'templates' }>(null);
  const [sizes, setSizes] = useState<Record<string, number | null>>({}), [startup, setStartup] = useState(showOnStartup);
  const recents = desktop ? recentFiles() : [];
  useEffect(() => { setHost(window.document.querySelector('.document-workspace')); }, [visible]);
  const [, setThumbs] = useState(0);
  useEffect(() => { if (!visible || !desktop?.fileInfo || !recents.length) return; void desktop.fileInfo(recents.map(r => r.path)).then(list => { setSizes(Object.fromEntries(list.map(f => [f.path, f.exists ? f.size : null]))); return refreshThumbnails(list.filter(f => f.exists).map(f => f.path)); }).then(changed => { if (changed) setThumbs(n => n + 1); }).catch(() => {}); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const screen = visible && host ? createPortal(<section className="welcome-screen" aria-label="Tela de boas-vindas">
    <nav className="welcome-nav"><span className="active">Começar</span></nav>
    <div className="welcome-main">
      <div className="welcome-row">
        <button type="button" className="welcome-tile" onClick={() => setDialog({ kind: 'new' })}><span className="welcome-thumb welcome-thumb-new"><Plus size={40} strokeWidth={1.4} /></span><strong>Novo documento…</strong></button>
        {recents.map(r => { const thumb = recentThumbnail(r.path), bytes = sizes[r.path]; return <button key={r.path} type="button" className={`welcome-tile ${bytes === null ? 'missing' : ''}`} title={bytes === null ? `${r.path} (arquivo não encontrado)` : r.path} onClick={() => openRecent(r.path)}>
          <span className="welcome-thumb">{thumb ? <img src={thumb} alt="" /> : <FilePlus2 size={30} strokeWidth={1.2} />}</span>
          <strong>{r.name.replace(/\.(?:gfxs|vectorstudio)$/i, '')}</strong><small>{bytes === null ? 'não encontrado' : bytes !== undefined ? size(bytes) : ' '}</small>
        </button>; })}
        {!recents.length && <p className="muted welcome-note">{desktop ? 'Os arquivos que você abrir ou salvar aparecem aqui.' : 'Arquivos recentes aparecem no GFX Studio instalado.'}</p>}
      </div>
      <div className="welcome-actions">
        <button type="button" onClick={openFile}><FolderOpen size={15} /> Abrir documento…</button>
        <button type="button" onClick={() => setDialog({ kind: 'templates' })}><LayoutTemplate size={15} /> Novo baseado em modelo…</button>
      </div>
      <label className="settings-check welcome-startup"><input type="checkbox" checked={startup} onChange={e => { setStartup(e.target.checked); try { localStorage.setItem(STARTUP, String(e.target.checked)); } catch { /* preferências indisponíveis */ } }} />Mostrar a tela de boas-vindas ao abrir o GFX Studio</label>
    </div>
  </section>, host) : null;
  return <>
    {screen}
    {dialog?.kind === 'new' && <NewDocumentDialog preset={dialog.preset} close={() => setDialog(null)} />}
    {dialog?.kind === 'templates' && <TemplatesDialog close={() => setDialog(null)} choose={t => setDialog({ kind: 'new', preset: t })} />}
  </>;
}
