import { activeCmyk } from './palettes';
import type { Cmyk } from './ColorPicker';
import { useDialogDrag } from './useDialogDrag';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import type { VectorObject } from '../document/model';
import { arrowKinds, dashStyles, paintTargets, type ArrowKind } from '../document/paint';
import { outlinePresets } from '../components/OutlineWidth';
import { ColorPicker } from './ColorPicker';

type Pen = Pick<VectorObject, 'stroke' | 'strokeWidth' | 'strokeDash' | 'strokeJoin' | 'strokeCap' | 'strokeMiter' | 'strokePosition' | 'strokeBehind' | 'strokeScale' | 'arrowStart' | 'arrowEnd'>;
const widthUnits = { mm: ['milímetros', 96 / 25.4], pt: ['pontos', 96 / 72], px: ['pixels', 1], in: ['polegadas', 96] } as const;
type WidthUnit = keyof typeof widthUnits;
const UNIT_KEY = 'vectorstudio.outlineUnit';
const sameDash = (a?: number[], b?: number[]) => (a ?? []).join() === (b ?? []).join();
/** Ícones dos botões de cantos, extremidades e posição (como na Caneta de contorno do CorelDRAW). */
export function PenIcon({ kind }: { kind: string }) {
  const line = { fill: 'none', stroke: 'currentColor' };
  const shapes: Record<string, ReactNode> = {
    miter: <path d="M4 17V4h13" {...line} strokeWidth="5" strokeLinejoin="miter" />,
    round: <path d="M4 17V4h13" {...line} strokeWidth="5" strokeLinejoin="round" />,
    bevel: <path d="M4 17V4h13" {...line} strokeWidth="5" strokeLinejoin="bevel" />,
    butt: <><path d="M3 10h11" {...line} strokeWidth="7" strokeLinecap="butt" opacity=".75" /><path d="M14 4v12" stroke="currentColor" strokeWidth="1" /></>,
    'round-cap': <><path d="M3 10h11" {...line} strokeWidth="7" strokeLinecap="round" opacity=".75" /><path d="M14 4v12" stroke="currentColor" strokeWidth="1" /></>,
    square: <><path d="M3 10h11" {...line} strokeWidth="7" strokeLinecap="square" opacity=".75" /><path d="M14 4v12" stroke="currentColor" strokeWidth="1" /></>,
    outside: <><rect x="6" y="6" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1" /><path d="M3.5 17V3.5H17" {...line} strokeWidth="3" opacity=".75" /></>,
    center: <><rect x="6" y="6" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1" /><path d="M6 17V6h11" {...line} strokeWidth="3" opacity=".75" /></>,
    inside: <><rect x="6" y="6" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1" /><path d="M8.5 17V8.5H17" {...line} strokeWidth="3" opacity=".75" /></>,
  };
  return <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">{shapes[kind]}</svg>;
}
function ArrowIcon({ kind, flip }: { kind: ArrowKind | 'none'; flip?: boolean }) {
  const head = { triangle: 'M18 10l-6-4v8z', barbed: 'M18 10l-7-4 2 4-2 4z', circle: 'M15 10m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0', square: 'M12 7h6v6h-6z', bar: 'M14 5h2v10h-2z', none: '' }[kind];
  return <svg viewBox="0 0 20 20" width="34" height="16" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}><path d="M2 10h13" stroke="currentColor" strokeWidth="1.5" />{head && <path d={head} fill="currentColor" />}</svg>;
}
function DashPreview({ dash }: { dash: number[] }) {
  return <svg viewBox="0 0 120 8" width="120" height="8" aria-hidden="true"><line x1="0" y1="4" x2="120" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray={dash.length ? dash.map(v => v * 2).join(' ') : undefined} /></svg>;
}

/** Caneta de contorno (F12): cor, largura, estilo, cantos, extremidades, posição, setas e opções, como no CorelDRAW. */
export function OutlineDialog({ close }: { close: () => void }) {
  const { document, selectedIds, dispatch, commitEdit, outline, setOutline, outlineWidth, setOutlineWidth, setMessage } = useEditor();
  const ref = useRef<HTMLDialogElement>(null);
  const targets = paintTargets(document.objects, selectedIds), first = targets[0], editing = !!first;
  const [pen, setPen] = useState<Pen>(() => first ? { ...first, stroke: first.stroke && first.stroke !== 'none' ? first.stroke : 'none', strokeWidth: first.strokeWidth || 0 } : { stroke: outline, strokeWidth: outline === 'none' ? 0 : outlineWidth });
  const [color, setColor] = useState(pen.stroke && pen.stroke !== 'none' ? pen.stroke : '#000000'), [cmyk, setCmyk] = useState<Cmyk | undefined>(() => first ? activeCmyk(first.strokeCmyk, first.stroke) : undefined);
  const [none, setNone] = useState(!pen.stroke || pen.stroke === 'none' || !pen.strokeWidth);
  const [picker, setPicker] = useState(false), [styles, setStyles] = useState(false);
  const [unit, setUnitState] = useState<WidthUnit>(() => { try { const u = localStorage.getItem(UNIT_KEY); return u && u in widthUnits ? u as WidthUnit : 'mm'; } catch { return 'mm'; } });
  const setUnit = (u: WidthUnit) => { setUnitState(u); try { localStorage.setItem(UNIT_KEY, u); } catch { /* preferências indisponíveis */ } };
  useEffect(() => { ref.current?.showModal(); }, []);
  const move = useDialogDrag();
  const scale = widthUnits[unit][1], width = none ? 0 : Number(((pen.strokeWidth || 0) / scale).toFixed(3));
  const set = (patch: Partial<Pen>) => setPen(p => ({ ...p, ...patch }));
  const choose = <K extends keyof Pen>(key: K, value: Pen[K], label: string, icon: string, disabled = false) => <button type="button" role="radio" aria-checked={pen[key] === value} aria-label={label} title={label} className={pen[key] === value ? 'active' : ''} disabled={disabled || !editing} onClick={() => set({ [key]: value } as Partial<Pen>)}><PenIcon kind={icon} /></button>;
  function setWidth(value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    const px = Math.min(1000, value * scale);
    set({ strokeWidth: px }); setNone(px === 0);
  }
  function apply() {
    finishEditing();
    const stroke = none ? 'none' : color, strokeWidth = none ? 0 : Math.max(pen.strokeWidth || 0, 0.01);
    if (!editing) { setOutline(stroke); if (!none) setOutlineWidth(strokeWidth); setMessage(`Contorno padrão para novos objetos: ${none ? 'nenhum' : `${color.toUpperCase()}, ${width} ${unit}`}.`); close(); return; }
    const ids = new Set(targets.map(o => o.id));
    // Valores padrão não são gravados: o arquivo continua igual ao de versões anteriores.
    const clean = (o: VectorObject): VectorObject => {
      const next: VectorObject = { ...o, stroke, strokeWidth, strokeDash: pen.strokeDash?.length ? pen.strokeDash : undefined, strokeJoin: pen.strokeJoin, strokeCap: pen.strokeCap, strokeMiter: (pen.strokeJoin ?? 'miter') === 'miter' && pen.strokeMiter && pen.strokeMiter !== 4 ? pen.strokeMiter : undefined, strokePosition: pen.strokePosition, strokeBehind: pen.strokeBehind || undefined, strokeScale: pen.strokeScale || undefined, arrowStart: pen.arrowStart, arrowEnd: pen.arrowEnd, strokeCmyk: none ? undefined : activeCmyk(cmyk, color) };
      for (const key of Object.keys(next) as (keyof VectorObject)[]) if (next[key] === undefined) delete next[key];
      return next;
    };
    commitEdit();
    dispatch({ type: 'set-objects', objects: document.objects.map(o => ids.has(o.id) ? clean(o) : o) });
    commitEdit();
    setMessage(none ? 'Contorno removido.' : `Caneta de contorno aplicada: ${color.toUpperCase()}, ${width} ${unit}.`);
    close();
  }
  const offTitle = editing ? '' : ' — selecione um objeto';
  return <dialog ref={ref} className="workspace-settings paint-dialog outline-dialog" aria-label="Caneta de contorno" style={move.style} onCancel={close} onClose={close}>
    <form method="dialog" onSubmit={e => { e.preventDefault(); apply(); }}>
      <header {...move.handle}><h2>Caneta de contorno</h2>{!editing && <span className="paint-dialog-scope">Padrão para novos objetos</span>}</header>
      <div className="outline-columns">
        <fieldset className="pen-group">
          <legend>Geral</legend>
          <div className="pen-row"><span>Cor:</span><span className="pen-control">
            <button type="button" className="pen-color" aria-haspopup="dialog" aria-expanded={picker} aria-label={`Cor do contorno: ${none ? 'nenhuma' : color.toUpperCase()}`} onClick={() => setPicker(v => !v)}><span className={`pen-swatch ${none ? 'is-none' : ''}`} style={none ? undefined : { background: color }} />▾</button>
            <label className="settings-check"><input type="checkbox" checked={none} onChange={e => { setNone(e.target.checked); if (!e.target.checked && !pen.strokeWidth) set({ strokeWidth: 0.2 * 96 / 25.4 }); }} />Sem contorno</label></span></div>
          {picker && <div className="pen-picker"><ColorPicker value={color} cmyk={cmyk} onChange={(c, k) => { setColor(c); setCmyk(k); if (none) { setNone(false); if (!pen.strokeWidth) set({ strokeWidth: 0.2 * 96 / 25.4 }); } }} label="Cor do contorno" /></div>}
          <div className="pen-row"><span>Largura:</span><span className="pen-control">
            <input type="number" list="outline-widths" min={0} step={unit === 'px' || unit === 'pt' ? 0.1 : 0.05} value={width} aria-label={`Largura do contorno (${widthUnits[unit][0]})`} onChange={e => setWidth(Number(e.target.value))} />
            <datalist id="outline-widths">{outlinePresets.map(([, mm]) => <option key={mm} value={Number((mm * 96 / 25.4 / scale).toFixed(3))} />)}</datalist>
            <select value={unit} aria-label="Unidade da largura" onChange={e => setUnit(e.target.value as WidthUnit)}>{(Object.keys(widthUnits) as WidthUnit[]).map(u => <option key={u} value={u}>{widthUnits[u][0]}</option>)}</select></span></div>
          <div className="pen-row"><span>Estilo:</span><span className="pen-control pen-style">
            <button type="button" className="pen-style-button" disabled={!editing} title={`Estilo de linha${offTitle}`} aria-haspopup="listbox" aria-expanded={styles} aria-label="Estilo de linha" onClick={() => setStyles(v => !v)}><DashPreview dash={pen.strokeDash ?? []} />▾</button>
            {styles && <div className="pen-style-list" role="listbox" aria-label="Estilos de linha">{dashStyles.map((dash, i) => <button type="button" role="option" key={i} aria-selected={sameDash(dash, pen.strokeDash)} aria-label={dash.length ? `Tracejado ${dash.join('-')}` : 'Contínuo'} onClick={() => { set({ strokeDash: dash.length ? dash : undefined }); setStyles(false); }}><DashPreview dash={dash} /></button>)}</div>}</span></div>
          <div className="pen-row"><span>Limite de meia-esquadria:</span><span className="pen-control"><input type="number" min={1} max={100} step={0.5} disabled={!editing || (pen.strokeJoin ?? 'miter') !== 'miter'} title={(pen.strokeJoin ?? 'miter') !== 'miter' ? 'Usado com cantos em esquadria' : undefined} value={pen.strokeMiter ?? 4} aria-label="Limite de meia-esquadria" onChange={e => { const v = Number(e.target.value); if (v >= 1 && v <= 100) set({ strokeMiter: v }); }} /></span></div>
          <div className="pen-row"><span>Cantos:</span><span className="icon-group" role="radiogroup" aria-label="Cantos">{choose('strokeJoin', undefined, 'Cantos em esquadria (retos)', 'miter')}{choose('strokeJoin', 'round', 'Cantos arredondados', 'round')}{choose('strokeJoin', 'bevel', 'Cantos chanfrados', 'bevel')}</span></div>
          <div className="pen-row"><span>Extremidades da linha:</span><span className="icon-group" role="radiogroup" aria-label="Extremidades da linha">{choose('strokeCap', undefined, 'Extremidades retas', 'butt')}{choose('strokeCap', 'round', 'Extremidades arredondadas', 'round-cap')}{choose('strokeCap', 'square', 'Extremidades quadradas estendidas', 'square')}</span></div>
          <div className="pen-row"><span>Posição:</span><span className="icon-group" role="radiogroup" aria-label="Posição do contorno">{choose('strokePosition', 'outside', 'Contorno externo', 'outside')}{choose('strokePosition', undefined, 'Contorno centralizado', 'center')}{choose('strokePosition', 'inside', 'Contorno interno', 'inside')}</span></div>
          <div className="pen-row"><span>Traços:</span><span className="pen-note">Ajuste de traços nos cantos — não disponível</span></div>
        </fieldset>
        <div className="outline-side">
          <fieldset className="pen-group">
            <legend>Pontas de setas</legend>
            <div className="arrow-row">
              <label><span className="visually-hidden">Seta inicial</span><span aria-hidden="true">←</span><select disabled={!editing} title={`Ponta inicial (caminhos abertos)${offTitle}`} aria-label="Seta inicial" value={pen.arrowStart ?? 'none'} onChange={e => set({ arrowStart: e.target.value === 'none' ? undefined : e.target.value as ArrowKind })}>{Object.entries(arrowKinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><ArrowIcon kind={pen.arrowStart ?? 'none'} flip />
            </div>
            <div className="arrow-row">
              <label><span className="visually-hidden">Seta final</span><span aria-hidden="true">→</span><select disabled={!editing} title={`Ponta final (caminhos abertos)${offTitle}`} aria-label="Seta final" value={pen.arrowEnd ?? 'none'} onChange={e => set({ arrowEnd: e.target.value === 'none' ? undefined : e.target.value as ArrowKind })}>{Object.entries(arrowKinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><ArrowIcon kind={pen.arrowEnd ?? 'none'} />
            </div>
            <p className="pen-note">As setas aparecem nas extremidades de linhas e curvas abertas.</p>
          </fieldset>
          <fieldset className="pen-group" disabled title="Caligrafia — não disponível">
            <legend>Caligrafia <small>(não disponível)</small></legend>
            <div className="pen-row"><span>Esticar:</span><span className="pen-control"><input type="number" value={100} readOnly aria-label="Esticar (não disponível)" />%</span></div>
            <div className="pen-row"><span>Ângulo:</span><span className="pen-control"><input type="number" value={0} readOnly aria-label="Ângulo da caligrafia (não disponível)" />°</span></div>
          </fieldset>
          <fieldset className="pen-group">
            <legend>Opções</legend>
            <label className="settings-check" title={offTitle ? 'Selecione um objeto' : undefined}><input type="checkbox" disabled={!editing} checked={!!pen.strokeBehind} onChange={e => set({ strokeBehind: e.target.checked })} />Atrás do preenchimento</label>
            <label className="settings-check" title={offTitle ? 'Selecione um objeto' : undefined}><input type="checkbox" disabled={!editing} checked={!!pen.strokeScale} onChange={e => set({ strokeScale: e.target.checked })} />Escala com objeto</label>
          </fieldset>
        </div>
      </div>
      <p className="pen-note">Contorno variável e impressão sobreposta do contorno — não disponíveis.</p>
      <footer><span /><span className="paint-dialog-buttons"><button type="submit" className="primary">OK</button><button type="button" onClick={close}>Cancelar</button></span></footer>
    </form>
  </dialog>;
}
