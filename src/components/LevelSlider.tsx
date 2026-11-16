import type { CSSProperties, InputHTMLAttributes } from 'react';

/** Régua de nível (como no CorelDRAW/Photoshop): trilho azul preenchido até o botão redondo branco. */
export function LevelSlider({ value, min = 0, max = 100, className = '', style, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & { value: number; min?: number; max?: number }) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return <input type="range" className={`level-slider ${className}`} min={min} max={max} value={value} style={{ ...style, '--fill': `${Math.max(0, Math.min(100, fill))}%` } as CSSProperties} {...rest} />;
}
