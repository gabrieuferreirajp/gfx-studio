import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeftRight, Ban, Square, Trash2 } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import type { FillGradient, GradientStop } from '../document/model';
import { colorAt, defaultFill, gradientFill, paintTargets, renderStops, solidFill, sortStops } from '../document/paint';
import { ColorPicker } from './ColorPicker';
import { PatternEditor } from './PatternEditor';
import { defaultPattern, patternFill } from '../document/patterns';
import type { FillPattern, VectorObject } from '../document/model';
import { useDialogDrag } from './useDialogDrag';
import type { Cmyk } from './ColorPicker';
import { activeCmyk } from './palettes';
/** Preenchimento com o CMYK exato (ou sem ele). */
const withCmyk = (o: VectorObject, c: Cmyk | undefined): VectorObject => { const { fillCmyk: _c, ...rest } = o; return c ? { ...rest, fillCmyk: c } : rest; };

type Kind = 'none' | 'uniform' | 'gradient' | 'twocolor' | 'bitmap';
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
/** Valores da área Transformações (CorelDRAW): largura %, deslocamento X/Y % e rotação °, a partir dos pontos do degradê. */
function transformOf(g: FillGradient) {
  const dx = g.x2 - g.x1, dy = g.y2 - g.y1, linear = g.type === 'linear';
  const cx = linear ? (g.x1 + g.x2) / 2 : g.x1, cy = linear ? (g.y1 + g.y2) / 2 : g.y1;
  return { size: Math.hypot(dx, dy) * (linear ? 100 : 200), x: (cx - 0.5) * 100, y: -(cy - 0.5) * 100, angle: Math.atan2(-dy, dx) * 180 / Math.PI };
}
function withTransform(g: FillGradient, t: { size: number; x: number; y: number; angle: number }): FillGradient {
  const a = t.angle * Math.PI / 180, ux = Math.cos(a), uy = -Math.sin(a), cx = 0.5 + t.x / 100, cy = 0.5 - t.y / 100;
  if (g.type === 'linear') { const half = t.size / 200; return { ...g, x1: cx - ux * half, y1: cy - uy * half, x2: cx + ux * half, y2: cy + uy * half }; }
  const r = t.size / 200; return { ...g, x1: cx, y1: cy, x2: cx + ux * r, y2: cy + uy * r };
}
/** Amostra do degradê no quadrado de visualização (mesmas frações da caixa do objeto). */
export function GradientSwatch({ gradient: g, id, className }: { gradient: FillGradient; id: string; className?: string }) {
  const stops = renderStops(g).map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />);
  return <svg className={className} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <defs>{g.type === 'linear' ? <linearGradient id={id} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} spreadMethod={g.spread ?? 'pad'}>{stops}</linearGradient> : <radialGradient id={id} cx={g.x1} cy={g.y1} fx={g.x1} fy={g.y1} r={Math.hypot(g.x2 - g.x1, g.y2 - g.y1)} spreadMethod={g.spread ?? 'pad'}>{stops}</radialGradient>}</defs>
    <rect width="100" height="100" fill={`url(#${id})`} />
  </svg>;
}
const typeIcon = (kind: string) => <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><defs>
  <linearGradient id={`ti-l`}><stop offset="0" stopColor="currentColor" /><stop offset="1" stopColor="currentColor" stopOpacity=".05" /></linearGradient>
  <radialGradient id={`ti-r`}><stop offset="0" stopColor="currentColor" stopOpacity=".05" /><stop offset="1" stopColor="currentColor" /></radialGradient>
  <linearGradient id={`ti-c`} x2="0" y2="1"><stop offset="0" stopColor="currentColor" /><stop offset=".5" stopColor="currentColor" stopOpacity=".1" /><stop offset="1" stopColor="currentColor" /></linearGradient></defs>
  <rect x="2" y="2" width="16" height="16" fill={kind === 'linear' ? 'url(#ti-l)' : kind === 'radial' ? 'url(#ti-r)' : kind === 'conical' ? 'url(#ti-c)' : 'none'} stroke="currentColor" strokeWidth="1" />
  {kind === 'square' && [3, 6].map(i => <rect key={i} x={2 + i} y={2 + i} width={16 - 2 * i} height={16 - 2 * i} fill="none" stroke="currentColor" strokeWidth="1" opacity=".6" />)}
</svg>;

/**
 * Pontos do degradê sobre a amostra, para mover livremente: arrastar o ponto inicial (ou a área) desloca o degradê
 * inteiro para qualquer lado; arrastar o ponto final muda direção e tamanho. Valem as mesmas frações da caixa do objeto.
 */
function GradientHandles({ gradient: g, onChange }: { gradient: FillGradient; onChange: (g: FillGradient) => void }) {
  const box = useRef<SVGSVGElement>(null);
  function drag(event: ReactPointerEvent<SVGElement>, part: 'start' | 'end' | 'all') {
    event.preventDefault(); event.stopPropagation();
    const r = box.current!.getBoundingClientRect(), start = { x: event.clientX, y: event.clientY }, base = g, el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    const clamp = (v: number) => Math.max(-2, Math.min(3, v));
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - start.x) / r.width, dy = (e.clientY - start.y) / r.height;
      if (part === 'end') onChange({ ...base, x2: clamp(base.x2 + dx), y2: clamp(base.y2 + dy) });
      else onChange({ ...base, x1: clamp(base.x1 + dx), y1: clamp(base.y1 + dy), x2: clamp(base.x2 + dx), y2: clamp(base.y2 + dy) });
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  // Unidades em % (sem esticar): os pontos ficam redondos/quadrados em qualquer proporção da amostra.
  const P = (v: number) => `${v * 100}%`;
  return <svg ref={box} className="gradient-handles">
    <rect width="100%" height="100%" fill="transparent" style={{ cursor: 'move' }} onPointerDown={e => drag(e, 'all')}><title>Arraste para mover o degradê</title></rect>
    <line x1={P(g.x1)} y1={P(g.y1)} x2={P(g.x2)} y2={P(g.y2)} stroke="#fff" strokeWidth="3" />
    <line x1={P(g.x1)} y1={P(g.y1)} x2={P(g.x2)} y2={P(g.y2)} stroke="#1a1a1a" strokeWidth="1" strokeDasharray="4 3" />
    <svg x={P(g.x1)} y={P(g.y1)} overflow="visible"><rect className="gradient-handle" x="-5" y="-5" width="10" height="10" onPointerDown={e => drag(e, 'start')}><title>Ponto inicial: arraste para mover o degradê</title></rect></svg>
    <circle className="gradient-handle" cx={P(g.x2)} cy={P(g.y2)} r="5.5" onPointerDown={e => drag(e, 'end')}><title>Ponto final: arraste para girar e mudar o tamanho</title></circle>
  </svg>;
}
/** Editar preenchimento (F11): nenhum, uniforme (CMYK/RGB/HSB) ou degradê com pontos de cor, como no CorelDRAW. */
export function FillDialog({ close }: { close: () => void }) {
  const { document, selectedIds, dispatch, amend, commitEdit, fill, setFill, setMessage } = useEditor();
  const move = useDialogDrag(), original = useRef(document.objects), finished = useRef(false), previewed = useRef(false);
  const ref = useRef<HTMLDialogElement>(null), bar = useRef<HTMLDivElement>(null);
  const targets = paintTargets(document.objects, selectedIds), first = targets[0];
  const startColor = first ? (first.fill === 'none' ? '#000000' : first.fill) : fill === 'none' ? '#000000' : fill;
  const [kind, setKind] = useState<Kind>(first ? first.fillPattern ? (first.fillPattern.kind === 'bitmap' ? 'bitmap' : 'twocolor') : first.fillGradient ? 'gradient' : first.fill === 'none' ? 'none' : 'uniform' : fill === 'none' ? 'none' : 'uniform');
  const [color, setColor] = useState(startColor), [cmyk, setCmyk] = useState<Cmyk | undefined>(() => first ? activeCmyk(first.fillCmyk, first.fill) : undefined);
  const pick = (hex: string, c?: Cmyk) => { setColor(hex); setCmyk(c); };
  const [gradient, setGradient] = useState<FillGradient>(() => first?.fillGradient ?? defaultFill('linear', startColor, '#ffffff'));
  const [active, setActive] = useState(0);
  const [pattern, setPattern] = useState<FillPattern>(() => first?.fillPattern ?? defaultPattern(startColor));
  const [tile, setTile] = useState<FillPattern>(() => first?.fillPattern?.kind === 'bitmap' ? first.fillPattern : { kind: 'bitmap', size: 37.8 });
  const latest = useRef(gradient); latest.current = gradient;
  useEffect(() => { ref.current?.showModal(); }, []);
  const fillOf = (o: VectorObject): VectorObject => kind === 'twocolor' ? patternFill(o, pattern) : kind === 'bitmap' ? (tile.src ? patternFill(o, tile) : o) : kind === 'gradient' ? gradientFill(o, gradient) : withCmyk(solidFill(o, kind === 'none' ? 'none' : color), kind === 'none' ? undefined : activeCmyk(cmyk, color));
  // Prévia ao vivo no desenho (sem entrar no Desfazer): a janela fica por cima sem desfocar o fundo e pode ser arrastada.
  useEffect(() => {
    if (!targets.length || finished.current) return;
    const ids = new Set(targets.map(o => o.id));
    amend({ type: 'set-objects', objects: original.current.map(o => ids.has(o.id) ? fillOf(o) : o) }); previewed.current = true;
  }, [kind, color, cmyk, gradient, pattern, tile]); // eslint-disable-line react-hooks/exhaustive-deps
  const restore = () => { if (previewed.current) { amend({ type: 'set-objects', objects: original.current }); previewed.current = false; } };
  const cancel = () => { if (!finished.current) { finished.current = true; restore(); } close(); };
  const stops = sortStops(gradient.stops), stop = stops[Math.min(active, stops.length - 1)], t = transformOf(gradient);
  const setStops = (next: GradientStop[], select?: GradientStop) => { const sorted = sortStops(next); setGradient(g => ({ ...g, stops: sorted })); if (select) setActive(sorted.indexOf(select)); };
  const updateStop = (patch: Partial<GradientStop>) => { const next = { ...stop, ...patch }; setStops(stops.map(s => s === stop ? next : s), next); };
  const removeStop = () => { if (stops.length > 2) { setStops(stops.filter(s => s !== stop)); setActive(0); } };
  const setTransform = (patch: Partial<typeof t>) => { const v = { ...t, ...patch }; if (Object.values(v).every(Number.isFinite) && v.size > 0) setGradient(g => withTransform(g, v)); };
  function dragStop(event: ReactPointerEvent<HTMLButtonElement>, s: GradientStop) {
    event.preventDefault(); setActive(stops.indexOf(s));
    const rect = bar.current!.getBoundingClientRect(), target = event.currentTarget; let index = stops.indexOf(s);
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const g = latest.current, sorted = sortStops(g.stops), next = { ...sorted[index], offset: round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), 3) };
      const moved = sortStops(sorted.map((x, i) => i === index ? next : x)); index = moved.indexOf(next);
      latest.current = { ...g, stops: moved }; setGradient(latest.current); setActive(index);
    };
    const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up);
  }
  function addStop(clientX: number) {
    const r = bar.current!.getBoundingClientRect(), offset = round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)), 3);
    if (stops.length >= 64) return;
    const added = { ...colorAt(stops, offset), offset };
    setStops([...stops, added], added);
  }
  function apply() {
    finishEditing();
    if (!targets.length) {
      setFill(kind === 'none' ? 'none' : kind === 'gradient' ? stops[0].color : color);
      setMessage(`Preenchimento padrão para novos objetos: ${kind === 'none' ? 'nenhum' : (kind === 'gradient' ? stops[0].color : color).toUpperCase()}.`);
      close(); return;
    }
    const ids = new Set(targets.map(o => o.id));
    if (kind === 'bitmap' && !tile.src) { setMessage('Escolha a imagem do padrão de bitmap.'); return; }
    finished.current = true; restore();
    commitEdit();
    dispatch({ type: 'set-objects', objects: original.current.map(o => !ids.has(o.id) ? o : fillOf(o)) });
    commitEdit();
    setMessage(kind === 'twocolor' || kind === 'bitmap' ? 'Preenchimento de padrão aplicado.' : kind === 'gradient' ? `Degradê ${gradient.type === 'linear' ? 'linear' : 'elíptico'} aplicado (${stops.length} cores).` : kind === 'none' ? 'Preenchimento removido.' : `Preenchimento ${color.toUpperCase()} aplicado.`);
    close();
  }
  const tabs: [Kind | string, string, boolean][] = [['none', 'Nenhum preenchimento', true], ['uniform', 'Preenchimento uniforme', true], ['gradient', 'Preenchimento gradiente', true], ['vector', 'Preenchimento de padrão vetorial — não disponível', false], ['bitmap', 'Preenchimento de padrão de bitmap', true], ['twocolor', 'Preenchimento de padrão de duas cores', true], ['texture', 'Preenchimento de textura — não disponível', false], ['postscript', 'Preenchimento PostScript — não disponível', false]];
  const tabIcon = (id: string) => id === 'none' ? <Ban size={17} /> : id === 'uniform' ? <Square size={17} fill="currentColor" /> : id === 'gradient' ? typeIcon('linear') : <span className="fill-tab-off">{{ vector: '▦', bitmap: '▩', twocolor: '◧', texture: '▤', postscript: 'PS' }[id]}</span>;
  const gradientDisabled = !targets.length;
  return <dialog ref={ref} className="workspace-settings paint-dialog fill-dialog" aria-label="Editar preenchimento" style={move.style} onCancel={cancel} onClose={cancel}>
    <form method="dialog" onSubmit={e => { e.preventDefault(); apply(); }}>
      <header {...move.handle}><h2>Editar preenchimento</h2>{!targets.length && <span className="paint-dialog-scope">Padrão para novos objetos</span>}</header>
      <div className="fill-tabs" role="tablist" aria-label="Tipo de preenchimento">{tabs.map(([id, label, available]) => <button type="button" role="tab" key={id} aria-selected={kind === id} className={kind === id ? 'active' : ''} title={label + (id !== 'none' && id !== 'uniform' && gradientDisabled ? ' — selecione um objeto' : '')} aria-label={label} disabled={!available || (id !== 'none' && id !== 'uniform' && gradientDisabled)} onClick={() => setKind(id as Kind)}>{tabIcon(id)}</button>)}</div>
      {kind === 'none' && <div className="fill-empty"><Ban size={42} strokeWidth={1.2} /><p>{targets.length ? 'O objeto ficará sem preenchimento (transparente por dentro).' : 'Os próximos objetos serão criados sem preenchimento.'}</p></div>}
      {kind === 'uniform' && <div className="fill-uniform"><section><h3>Preenchimento uniforme</h3><ColorPicker value={color} cmyk={cmyk} onChange={pick} /></section>
        <aside className="fill-compare"><span>Antigo</span><span className="swatch-large" style={{ background: first?.fill && first.fill !== 'none' ? first.fill : 'transparent' }} /><span>Novo</span><span className="swatch-large" style={{ background: color }} /></aside></div>}
      {kind === 'twocolor' && <PatternEditor pattern={pattern} onChange={setPattern} unit={document.unit ?? 'px'} />}
      {kind === 'bitmap' && <PatternEditor pattern={tile} onChange={setTile} unit={document.unit ?? 'px'} />}
      {kind === 'gradient' && <div className="fill-gradient">
        <section className="fill-gradient-left">
          <h3>Preenchimento gradiente</h3>
          <div className="fill-gradient-preview-wrap"><GradientSwatch gradient={gradient} id="fill-dialog-preview" className="fill-gradient-preview" /><GradientHandles gradient={gradient} onChange={setGradient} /></div>
          <div className="gradient-bar-wrap">
            <div ref={bar} className="gradient-bar" title="Duplo clique: adicionar ponto de cor" onDoubleClick={e => addStop(e.clientX)}><GradientSwatch gradient={{ ...gradient, type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5, spread: 'pad' }} id="fill-dialog-bar" className="gradient-bar-fill" /></div>
            {stops.map((s, i) => <button type="button" key={i} className={`gradient-stop ${s === stop ? 'active' : ''}`} style={{ left: `${s.offset * 100}%` }} aria-label={`Ponto de cor ${i + 1}: ${s.color.toUpperCase()} em ${Math.round(s.offset * 100)}%`} title="Arraste para mover · Delete remove" onPointerDown={e => dragStop(e, s)} onKeyDown={e => { if (e.key === 'Delete') { e.preventDefault(); removeStop(); } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); updateStop({ offset: Math.max(0, Math.min(1, round(s.offset + (e.key === 'ArrowLeft' ? -0.01 : 0.01), 3))) }); } }}><span style={{ background: s.color }} /></button>)}
          </div>
          <p className="gradient-hint">Duplo clique na barra adiciona um ponto de cor; arraste os pontos para movê-los.</p>
          <div className="gradient-stop-fields">
            <label>Transparência<span className="unit-input"><input type="number" min={0} max={100} value={Math.round((1 - (stop.opacity ?? 1)) * 100)} aria-label="Transparência do ponto de cor (%)" onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) updateStop({ opacity: 1 - Math.max(0, Math.min(100, v)) / 100 }); }} />%</span></label>
            <label>Posição<span className="unit-input"><input type="number" min={0} max={100} value={round(stop.offset * 100)} aria-label="Posição do ponto de cor (%)" onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) updateStop({ offset: Math.max(0, Math.min(100, v)) / 100 }); }} />%</span></label>
            <button type="button" className="icon-text" disabled={stops.length <= 2} onClick={removeStop} title="Excluir o ponto de cor selecionado (Delete)"><Trash2 size={14} />Excluir ponto</button>
          </div>
          <ColorPicker value={stop.color} onChange={c => updateStop({ color: c })} label="Cor do ponto" />
        </section>
        <section className="fill-gradient-right">
          <h3>Transição de mistura</h3>
          <div className="option-row"><span>Tipo:</span><div className="icon-group" role="radiogroup" aria-label="Tipo de degradê">{([['linear', 'Preenchimento gradiente linear'], ['radial', 'Preenchimento gradiente elíptico'], ['conical', 'Preenchimento gradiente cônico — não disponível'], ['square', 'Preenchimento gradiente retangular — não disponível']] as const).map(([id, label]) => <button type="button" role="radio" key={id} aria-checked={gradient.type === id} aria-label={label} title={label} className={gradient.type === id ? 'active' : ''} disabled={id === 'conical' || id === 'square'} onClick={() => setGradient(g => withTransform({ ...g, type: id as FillGradient['type'] }, transformOf(g)))}>{typeIcon(id)}</button>)}</div></div>
          <div className="option-row"><span>Arranjo:</span><div className="icon-group" role="radiogroup" aria-label="Arranjo do degradê">{([['pad', 'Padrão'], ['reflect', 'Repetir e espelhar'], ['repeat', 'Repetir']] as const).map(([id, label]) => <button type="button" role="radio" key={id} aria-checked={(gradient.spread ?? 'pad') === id} aria-label={label} title={label} className={(gradient.spread ?? 'pad') === id ? 'active' : ''} onClick={() => setGradient(g => id === 'pad' ? { ...g, spread: undefined } : { ...g, spread: id })}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="2" y="3" width="16" height="14" fill="none" stroke="currentColor" />{id === 'pad' ? <rect x="4" y="5" width="6" height="10" fill="currentColor" opacity=".55" /> : id === 'reflect' ? <><rect x="4" y="5" width="6" height="10" fill="currentColor" opacity=".55" /><rect x="10" y="5" width="6" height="10" fill="currentColor" opacity=".25" /></> : <><rect x="4" y="5" width="4" height="10" fill="currentColor" opacity=".55" /><rect x="11" y="5" width="4" height="10" fill="currentColor" opacity=".55" /></>}</svg></button>)}</div></div>
          <button type="button" className="icon-text" onClick={() => setStops(stops.map(s => ({ ...s, offset: round(1 - s.offset, 4) })))}><ArrowLeftRight size={14} />Reverter preenchimento</button>
          <h3>Fluxo</h3>
          <div className="option-row"><label className="settings-check"><input type="checkbox" checked={!!gradient.steps} onChange={e => setGradient(g => e.target.checked ? { ...g, steps: 8 } : { ...g, steps: undefined })} />Etapas:</label><input type="number" className="small-number" min={2} max={256} disabled={!gradient.steps} value={gradient.steps ?? 256} aria-label="Número de etapas" onChange={e => { const v = Math.round(Number(e.target.value)); if (v >= 2 && v <= 256) setGradient(g => ({ ...g, steps: v })); }} /></div>
          <div className="option-row"><span>Aceleração:</span><input type="number" className="small-number" min={-100} max={100} step={1} value={gradient.acceleration ?? 0} aria-label="Aceleração do degradê" onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) setGradient(g => ({ ...g, acceleration: Math.max(-100, Math.min(100, v)) || undefined })); }} /></div>
          <h3>Transformações</h3>
          <div className="transform-grid">
            <label>L:<span className="unit-input"><input type="number" min={1} max={10000} step={1} value={round(t.size)} aria-label="Largura do degradê (%)" onChange={e => setTransform({ size: Number(e.target.value) })} />%</span></label>
            <label>X:<span className="unit-input"><input type="number" step={1} value={round(t.x)} aria-label="Deslocamento horizontal do degradê (%)" onChange={e => setTransform({ x: Number(e.target.value) })} />%</span></label>
            <label>Girar:<span className="unit-input"><input type="number" step={1} value={round(t.angle)} aria-label="Rotação do degradê (graus)" onChange={e => setTransform({ angle: Number(e.target.value) })} />°</span></label>
            <label>Y:<span className="unit-input"><input type="number" step={1} value={round(t.y)} aria-label="Deslocamento vertical do degradê (%)" onChange={e => setTransform({ y: Number(e.target.value) })} />%</span></label>
          </div>
        </section>
      </div>}
      <footer><label className="settings-check" title="Impressão sobreposta — não disponível"><input type="checkbox" disabled />Impressão sobreposta do preenchimento (não disponível)</label><span className="paint-dialog-buttons"><button type="submit" className="primary">OK</button><button type="button" onClick={cancel}>Cancelar</button></span></footer>
    </form>
  </dialog>;
}
