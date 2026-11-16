import { PaintBucket, PenTool } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { paintTargets } from '../document/paint';
import { MM_PER_PX } from '../document/units';
import { cmykLabel } from './ColorPicker';
import { activeCmyk } from './palettes';
import { GradientSwatch } from './FillDialog';

/** Indicadores de preenchimento e contorno no canto inferior direito (CorelDRAW): mostram a seleção ou o padrão e abrem os editores. */
export function PaintStatus({ editFill, editOutline }: { editFill: () => void; editOutline: () => void }) {
  const { document, selectedIds, fill, outline, outlineWidth } = useEditor();
  const o = paintTargets(document.objects, selectedIds)[0];
  const fillColor = o ? o.fill : fill, gradient = o?.fillGradient;
  const stroke = o ? (o.stroke && o.stroke !== 'none' && (o.strokeWidth ?? 0) > 0 ? o.stroke : 'none') : outline;
  const width = o ? o.strokeWidth ?? 0 : outlineWidth;
  const fillText = gradient ? `Degradê ${gradient.type === 'linear' ? 'linear' : 'elíptico'}` : fillColor === 'none' ? 'Nenhum' : cmykLabel(fillColor, o ? activeCmyk(o.fillCmyk, o.fill) : undefined);
  const strokeText = stroke === 'none' ? 'Nenhum' : `${cmykLabel(stroke, o ? activeCmyk(o.strokeCmyk, o.stroke) : undefined)}  ${(width * MM_PER_PX).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} mm`;
  const scope = o ? '' : ' (padrão para novos objetos)';
  return <div className="paint-status">
    <button type="button" className="paint-indicator" onClick={editFill} title={`Preenchimento${scope}: ${fillText}${!gradient && fillColor !== 'none' ? ` · ${fillColor.toUpperCase()}` : ''} — clique para editar (F11)`} aria-label={`Preenchimento: ${fillText}. Editar preenchimento`}>
      <PaintBucket size={14} />
      <span className={`paint-swatch ${!gradient && fillColor === 'none' ? 'is-none' : ''}`} style={!gradient && fillColor !== 'none' ? { background: fillColor } : undefined}>{gradient && <GradientSwatch gradient={gradient} id="status-fill-gradient" />}</span>
      <span className="paint-text">{fillText}</span>
    </button>
    <button type="button" className="paint-indicator" onClick={editOutline} title={`Contorno${scope}: ${strokeText}${stroke !== 'none' ? ` · ${stroke.toUpperCase()}` : ''} — clique para editar (F12)`} aria-label={`Contorno: ${strokeText}. Caneta de contorno`}>
      <PenTool size={14} />
      <span className={`paint-swatch ${stroke === 'none' ? 'is-none' : ''}`} style={stroke !== 'none' ? { background: stroke } : undefined} />
      <span className="paint-text">{strokeText}</span>
    </button>
  </div>;
}
