import { useState } from 'react';
import type { FillPattern } from '../document/model';
import { patternPresets, presetPath } from '../document/patterns';
import { fromUnit, toUnit, unitDefinitions, type DocumentUnit } from '../document/units';
import { ColorPicker } from './ColorPicker';

/** Lê a imagem escolhida (PNG/JPEG/GIF/WebP) como data URL e mede a proporção, para o padrão de bitmap. */
async function readTile(file: File): Promise<{ src: string; ratio: number }> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Use uma imagem PNG, JPEG, GIF ou WebP.');
  if (file.size > 3 * 1024 * 1024) throw new Error('A imagem do padrão deve ter até 3 MB.');
  const src = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Não foi possível ler a imagem.')); r.readAsDataURL(file); });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('Não foi possível ler a imagem.')); i.src = src; });
  return { src, ratio: (image.naturalHeight || 1) / (image.naturalWidth || 1) };
}
/** Amostra do padrão (mosaico repetido no quadrado de visualização). */
export function PatternSwatch({ pattern, id, className }: { pattern: FillPattern; id: string; className?: string }) {
  const w = 25, h = 25 * (pattern.ratio ?? 1);
  return <svg className={className} viewBox="0 0 100 100" aria-hidden="true"><defs><pattern id={id} patternUnits="userSpaceOnUse" width={w} height={h} patternTransform={pattern.angle ? `rotate(${-pattern.angle})` : undefined}>
    {pattern.kind === 'bitmap' && pattern.src ? <image href={pattern.src} width={w} height={h} preserveAspectRatio="none" /> : <>{pattern.bg && pattern.bg !== 'none' && <rect width={w} height={h} fill={pattern.bg} />}<path d={presetPath(pattern.preset).d} transform={`scale(${w / 10} ${h / 10})`} fill={pattern.fg} /></>}
  </pattern></defs><rect width="100" height="100" fill={`url(#${id})`} /></svg>;
}
/** Padrão de duas cores ou de bitmap (Editar preenchimento): mosaico, cores, tamanho e rotação. */
export function PatternEditor({ pattern, onChange, unit }: { pattern: FillPattern; onChange: (p: FillPattern) => void; unit: DocumentUnit }) {
  const [error, setError] = useState(''), [editing, setEditing] = useState<'fg' | 'bg'>('fg');
  return <div className="fill-pattern">
    <section>
      <h3>{pattern.kind === 'bitmap' ? 'Padrão de bitmap' : 'Padrão de duas cores'}</h3>
      <PatternSwatch pattern={pattern} id="fill-dialog-pattern" className="fill-gradient-preview" />
      {pattern.kind === 'twoColor' ? <div className="pattern-presets" role="radiogroup" aria-label="Padrão">{patternPresets.map(p => <button type="button" role="radio" key={p.id} aria-checked={pattern.preset === p.id} className={pattern.preset === p.id ? 'active' : ''} title={p.label} aria-label={p.label} onClick={() => onChange({ ...pattern, preset: p.id })}><PatternSwatch pattern={{ ...pattern, preset: p.id, angle: 0, size: 10, ratio: 1 }} id={`preset-${p.id}`} /></button>)}</div>
        : <label className="settings-row">Imagem<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={e => { const f = e.target.files?.[0]; if (f) readTile(f).then(t => { setError(''); onChange({ ...pattern, ...t }); }, (err: Error) => setError(err.message)); }} /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
    <section>
      <label className="settings-row">Largura do mosaico<input type="number" min={toUnit(0.5, unit)} step="any" value={Math.round(toUnit(pattern.size, unit) * 1000) / 1000} onChange={e => { const v = fromUnit(Number(e.target.value), unit); if (Number.isFinite(v) && v >= 0.5 && v <= 5000) onChange({ ...pattern, size: v }); }} /><span>{unitDefinitions[unit].short}</span></label>
      <label className="settings-row">Girar<input type="number" min={-360} max={360} value={pattern.angle ?? 0} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && Math.abs(v) <= 360) onChange({ ...pattern, angle: v || undefined }); }} /><span>°</span></label>
      {pattern.kind === 'twoColor' && <>
        <div className="icon-group" role="tablist" aria-label="Cor a editar">
          <button type="button" role="tab" aria-selected={editing === 'fg'} className={editing === 'fg' ? 'active' : ''} onClick={() => setEditing('fg')}><span className="swatch-small" style={{ background: pattern.fg }} />Frente</button>
          <button type="button" role="tab" aria-selected={editing === 'bg'} className={editing === 'bg' ? 'active' : ''} onClick={() => setEditing('bg')}><span className="swatch-small" style={{ background: pattern.bg === 'none' ? 'transparent' : pattern.bg }} />Fundo</button>
          <label className="settings-check"><input type="checkbox" checked={pattern.bg === 'none'} onChange={e => onChange({ ...pattern, bg: e.target.checked ? 'none' : '#ffffff' })} />Fundo transparente</label>
        </div>
        {(editing === 'fg' || pattern.bg !== 'none') && <ColorPicker value={(editing === 'fg' ? pattern.fg : pattern.bg) ?? '#000000'} onChange={c => onChange({ ...pattern, [editing]: c })} label={editing === 'fg' ? 'Cor da frente' : 'Cor de fundo'} />}
      </>}
    </section>
  </div>;
}
