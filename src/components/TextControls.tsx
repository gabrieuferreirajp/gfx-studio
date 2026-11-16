import { AlignCenter, AlignLeft, AlignRight, Bold, FlipVertical2, Italic, Underline, Unlink } from 'lucide-react';
import type { PathTextVertical, VectorObject } from '../document/model';
import { detachPathText } from '../text/textTools';
import { fromUnit, toUnit, unitDefinitions, unitStep } from '../document/units';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { FONT_FAMILY, fontFamilies, fontSizes, styleOf, updateText, type TextAlign, type TextStyle } from '../text/textLayout';
import { browserMeasure } from '../text/textMeasure';
import { useEffect, useState } from 'react';
import { desktop } from '../io/desktop';
import { FontPicker } from './FontPicker';
// No aplicativo instalado, a lista vem das fontes do Windows; no navegador, das fontes comuns.
let installed: Promise<string[]> | null = null;
type Face = { family: string; style: string; weight: number; italic: boolean; variable: boolean };
let facesPromise: Promise<Face[]> | null = null;
/** Estilos de cada família (Thin, Light, Regular, Bold, ExtraBold… e itálicos), lidos dos arquivos de fonte. */
function useFontFaces() {
  const [faces, setFaces] = useState<Face[]>([]);
  useEffect(() => { if (!desktop?.fontFaces) return; facesPromise ??= desktop.fontFaces().catch(() => []); void facesPromise.then(setFaces); }, []);
  return faces;
}
const basicStyles: Face[] = [{ style: 'Regular', weight: 400, italic: false }, { style: 'Italic', weight: 400, italic: true }, { style: 'Bold', weight: 700, italic: false }, { style: 'Bold Italic', weight: 700, italic: true }].map(f => ({ ...f, family: '', variable: false }));
function useFontFamilies() {
  const [families, setFamilies] = useState(fontFamilies);
  useEffect(() => { if (!desktop) return; installed ??= desktop.fontFamilies().catch(() => fontFamilies); void installed.then(list => { if (list.length) setFamilies(list.filter(f => FONT_FAMILY.test(f))); }); }, []);
  return families;
}
/** Fonte, tamanho (pt), estilos e alinhamento: aplica aos textos selecionados ou, sem seleção, aos próximos textos. */
export function TextControls({ compact = false }: { compact?: boolean }) {
  const { document, selectedIds, dispatch, commitEdit, textStyle, setTextStyle } = useEditor();
  const texts = document.objects.filter(o => o.type === 'text' && selectedIds.includes(o.id));
  const style = texts.length ? styleOf(texts[0]) : textStyle, families = useFontFamilies(), faces = useFontFaces();
  const weight = style.fontWeight ?? (style.bold ? 700 : 400);
  const familyFaces = faces.filter(f => f.family.toLowerCase() === style.fontFamily.toLowerCase()).sort((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight);
  const styles = familyFaces.length ? familyFaces.filter((f, i, all) => all.findIndex(g => g.weight === f.weight && g.italic === f.italic) === i) : basicStyles;
  const current = styles.find(f => f.weight === weight && f.italic === style.italic) ?? styles.reduce((a, b) => (Math.abs(b.weight - weight) + (b.italic === style.italic ? 0 : 1000)) < (Math.abs(a.weight - weight) + (a.italic === style.italic ? 0 : 1000)) ? b : a, styles[0]);
  /** Trocar de família mantém o estilo mais próximo que a nova família tiver. */
  const nearest = (family: string) => { const list = faces.filter(f => f.family.toLowerCase() === family.toLowerCase()); if (!list.length) return {}; const pick = list.reduce((a, b) => (Math.abs(b.weight - weight) + (b.italic === style.italic ? 0 : 1000)) < (Math.abs(a.weight - weight) + (a.italic === style.italic ? 0 : 1000)) ? b : a); return { fontWeight: pick.weight, italic: pick.italic }; };
  function apply(patch: Partial<TextStyle>) {
    if (!texts.length) { setTextStyle({ ...textStyle, ...patch }); return; }
    commitEdit();
    dispatch({ type: 'set-objects', objects: document.objects.map(o => texts.some(t => t.id === o.id) ? updateText(o, patch, browserMeasure) : o) });
    commitEdit();
  }
  function spacing(patch: { letterSpacing?: number; lineSpacing?: number }) {
    commitEdit();
    dispatch({ type: 'set-objects', objects: document.objects.map(o => texts.some(t => t.id === o.id) ? updateText(o, patch, browserMeasure) : o) });
    commitEdit();
  }
  const toggle = (key: 'bold' | 'italic' | 'underline', label: string, Icon: typeof Bold) => <button type="button" className={`text-toggle ${style[key] ? 'active' : ''}`} aria-pressed={style[key]} aria-label={label} title={label} onClick={() => { finishEditing(); apply({ [key]: !style[key] }); }}><Icon size={15} /></button>;
  const align = (value: TextAlign, label: string, Icon: typeof AlignLeft) => <button type="button" className={`text-toggle ${style.textAlign === value ? 'active' : ''}`} aria-pressed={style.textAlign === value} aria-label={label} title={label} onClick={() => { finishEditing(); apply({ textAlign: value }); }}><Icon size={15} /></button>;
  return <div className={`text-controls ${compact ? 'compact' : ''}`}>
    <FontPicker value={style.fontFamily} families={families} texts={texts} choose={f => { if (FONT_FAMILY.test(f)) { finishEditing(); apply({ fontFamily: f, ...nearest(f) }); } }} />
    <select className="font-style" aria-label="Estilo da fonte" title="Estilo da fonte (peso e itálico)" value={`${current.weight}|${current.italic}`} onChange={e => { const [w, it] = e.target.value.split('|'); finishEditing(); apply({ fontWeight: Number(w), italic: it === 'true' }); }}>
      {styles.map(f => <option key={`${f.weight}|${f.italic}`} value={`${f.weight}|${f.italic}`} style={{ fontFamily: `"${style.fontFamily}"`, fontWeight: f.weight, fontStyle: f.italic ? 'italic' : 'normal' }}>{f.style}</option>)}
    </select>
    <input className="font-size" type="number" min="1" max="3000" step="0.5" aria-label="Tamanho da fonte (pt)" title="Tamanho da fonte em pontos (Enter aplica)" key={`s-${style.fontSize}`} defaultValue={style.fontSize}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={e => { const value = Number(e.target.value); if (Number.isFinite(value) && value >= 1 && value <= 3000 && value !== style.fontSize) apply({ fontSize: value }); else e.target.value = String(style.fontSize); }} />
    <select className="font-size-presets" aria-label="Tamanhos de fonte predefinidos" title="Tamanhos predefinidos" value="" onChange={e => { if (e.target.value) apply({ fontSize: Number(e.target.value) }); }}><option value="">pt ▾</option>{fontSizes.map(s => <option key={s} value={s}>{s}</option>)}</select>
    {toggle('bold', 'Negrito', Bold)}{toggle('italic', 'Itálico', Italic)}{toggle('underline', 'Sublinhado', Underline)}
    <span className="command-divider" />
    {align('left', 'Alinhar à esquerda', AlignLeft)}{align('center', 'Centralizar', AlignCenter)}{align('right', 'Alinhar à direita', AlignRight)}
    {texts.length > 0 && <>
      <span className="command-divider" />
      <label className="spacing-field" title="Espaçamento entre caracteres (% da largura do espaço, como no CorelDRAW) · Ferramenta Forma: seta da direita"><span className="spacing-icon" aria-hidden="true">AV</span><input type="number" step="5" min="-100" max="2000" aria-label="Espaçamento entre caracteres (%)" value={Math.round(texts[0].letterSpacing ?? 0)} onChange={e => { const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v)) spacing({ letterSpacing: Math.max(-100, Math.min(2000, v)) }); }} /><span className="unit">%</span></label>
      <label className="spacing-field" title="Espaçamento entre linhas (100% = normal) · Ferramenta Forma: seta da esquerda"><span className="spacing-icon" aria-hidden="true">↕</span><input type="number" step="5" min="10" max="800" aria-label="Espaçamento entre linhas (%)" value={Math.round((texts[0].lineSpacing ?? 1.2) / 1.2 * 100)} onChange={e => { const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v) && v >= 10) spacing({ lineSpacing: Math.min(800, v) / 100 * 1.2 }); }} /><span className="unit">%</span></label>
    </>}
  </div>;
}
/**
 * Texto em caminho (barra de propriedades do CorelDRAW): orientação das letras, posição vertical, distância do caminho,
 * deslocamento ao longo dele, lado do caminho e separar do caminho. A posição do texto (esquerda/centro/direita) é o
 * alinhamento, nos botões ao lado.
 */
export function PathTextControls() {
  const { document, selectedIds, dispatch, commitEdit, setMessage } = useEditor();
  const texts = document.objects.filter(o => o.type === 'text' && o.textPath && selectedIds.includes(o.id));
  if (!texts.length) return null;
  const tp = texts[0].textPath!, unit = document.unit ?? 'px', u = unitDefinitions[unit].short;
  function apply(patch: Partial<NonNullable<VectorObject['textPath']>>) {
    finishEditing(); commitEdit();
    dispatch({ type: 'set-objects', objects: document.objects.map(o => texts.some(t => t.id === o.id) ? updateText({ ...o, textPath: { ...o.textPath!, ...patch } }, {}, browserMeasure) : o) });
    commitEdit();
  }
  const length = (label: string, title: string, value: number, key: 'offset' | 'distance') => <label className="spacing-field" title={title}><span className="spacing-icon">{label}</span><input type="number" step={unitStep(unit)} aria-label={title} key={`${key}-${value}`} defaultValue={Number(toUnit(value, unit).toPrecision(6))} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={e => { const v = fromUnit(Number(e.target.value), unit); if (e.target.value !== '' && Number.isFinite(v) && Math.abs(v) <= 20000 && Math.abs(v - value) > 1e-9) apply({ [key]: v }); }} /><span className="unit">{u}</span></label>;
  const linked = texts.some(t => t.textPath?.source && document.objects.some(o => o.id === t.textPath!.source));
  function detach() {
    finishEditing(); commitEdit();
    dispatch({ type: 'set-objects', objects: document.objects.map(o => texts.some(t => t.id === o.id) ? detachPathText(o) : o) });
    commitEdit(); setMessage('Texto separado do caminho: mantém a forma, mas não acompanha mais a curva.');
  }
  return <div className="text-controls compact path-text-controls">
    <select aria-label="Orientação do texto" title="Orientação do texto: letras giradas pela curva ou em pé" value={tp.upright ? 'upright' : 'rotate'} onChange={e => apply({ upright: e.target.value === 'upright' ? true : undefined })}>
      <option value="rotate">Girar letras</option><option value="upright">Letras em pé</option>
    </select>
    <select aria-label="Posição vertical" title="Posição vertical: parte das letras que fica sobre o caminho" value={tp.vertical ?? 'baseline'} onChange={e => apply({ vertical: e.target.value === 'baseline' ? undefined : e.target.value as PathTextVertical })}>
      <option value="baseline">Linha de base no caminho</option><option value="top">Topo no caminho</option><option value="center">Centro no caminho</option><option value="bottom">Base no caminho</option>
    </select>
    {length('↕', 'Distância do caminho', tp.distance ?? 0, 'distance')}
    {length('↔', 'Deslocamento ao longo do caminho (ou arraste o texto com a Seleção)', tp.offset, 'offset')}
    <button type="button" className={`text-toggle ${tp.flip ? 'active' : ''}`} aria-pressed={!!tp.flip} aria-label="Colocar no outro lado do caminho" title="Colocar no outro lado do caminho (inverte o sentido)" onClick={() => apply({ flip: !tp.flip })}><FlipVertical2 size={15} /></button>
    {linked && <button type="button" className="text-toggle" aria-label="Separar texto do caminho" title="Separar texto do caminho (Ctrl+K): o texto mantém a forma e deixa de acompanhar a curva" onClick={detach}><Unlink size={15} /></button>}
  </div>;
}
