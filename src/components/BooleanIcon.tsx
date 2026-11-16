import type { BooleanOperation } from '../geometry/booleanSelection';

// Ícones próprios do GFX Studio (não derivados do CorelDRAW): quadrado de trás (A, 3–15) e da frente (B, 9–21).
const A = 'M3 3H15V15H3Z', B = 'M9 9H21V21H9Z';
const union = 'M3 3H15V9H21V21H9V15H3Z', aMinusB = 'M3 3H15V9H9V15H3Z', bMinusA = 'M15 9H21V21H9V15H15Z', both = 'M9 9H15V15H9Z';
type Part = { d: string; kind: 'fill' | 'soft' | 'line' | 'dash' | 'bold'; rule?: 'evenodd' };
const icons: Record<BooleanOperation, Part[]> = {
  union: [{ d: union, kind: 'fill' }],
  subtract: [{ d: aMinusB, kind: 'fill' }, { d: B, kind: 'line' }],
  intersect: [{ d: A, kind: 'line' }, { d: B, kind: 'line' }, { d: both, kind: 'fill' }],
  xor: [{ d: `${union} ${both}`, kind: 'fill', rule: 'evenodd' }],
  simplify: [{ d: aMinusB, kind: 'soft' }, { d: B, kind: 'fill' }],
  frontMinusBack: [{ d: A, kind: 'dash' }, { d: bMinusA, kind: 'fill' }],
  backMinusFront: [{ d: aMinusB, kind: 'fill' }, { d: B, kind: 'dash' }],
  boundary: [{ d: A, kind: 'dash' }, { d: B, kind: 'dash' }, { d: union, kind: 'bold' }],
};
export function BooleanIcon({ operation }: { operation: BooleanOperation }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {icons[operation].map((p, i) => p.kind === 'fill' || p.kind === 'soft'
      ? <path key={i} d={p.d} fill="currentColor" fillRule={p.rule} opacity={p.kind === 'soft' ? 0.4 : 1} />
      : <path key={i} d={p.d} fill="none" stroke="currentColor" strokeWidth={p.kind === 'bold' ? 2 : 1.2} strokeDasharray={p.kind === 'dash' ? '2 1.6' : undefined} strokeLinejoin="round" />)}
  </svg>;
}
