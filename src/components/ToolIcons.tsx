/** Ícones próprios da caixa de ferramentas (mesma interface dos ícones Lucide: size e strokeWidth). */
type IconProps = { size?: number; strokeWidth?: number; className?: string };

/** Ferramenta Forma (editar nós): seta preenchida apontando para um nó sobre uma curva. */
export function NodeToolIcon({ size = 24, strokeWidth = 1.7, className }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 21c2-7 6-11 13-13" />
    <rect x="1.5" y="18.5" width="4" height="4" fill="var(--panel, #fff)" strokeWidth={strokeWidth * 0.8} />
    <path d="M10 3l10 6.5-4.6 1.2 3.1 5.3-2.2 1.3-3.1-5.3-3.2 3.5z" fill="currentColor" strokeWidth={strokeWidth * 0.6} />
  </svg>;
}

/** Ferramenta Texto (como no CorelDRAW): a letra "A". */
export function TextToolIcon({ size = 24, strokeWidth = 1.7, className }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth * 1.15} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 20.5 12 3.5l7.5 17M7.6 14h8.8" />
  </svg>;
}

/** Máscara de camada (como no Photoshop): retângulo com um círculo no meio. */
export function LayerMaskIcon({ size = 24, strokeWidth = 1.7, className }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="5" width="19" height="14" rx="1" />
    <circle cx="12" cy="12" r="4.2" fill="currentColor" />
  </svg>;
}

/** Sombra (como na caixa do CorelDRAW): quadrado com a sombra sólida embaixo e à direita. */
export function DropShadowIcon({ size = 24, strokeWidth = 1.7, className }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="miter" aria-hidden="true">
    <path d="M8 19.5h12.5V8" strokeWidth={strokeWidth * 2.2} />
    <rect x="3.5" y="3.5" width="14" height="14" fill="var(--panel, #fff)" />
  </svg>;
}

/** Transparência (como na caixa do CorelDRAW): quadrado xadrez. */
export function TransparencyIcon({ size = 24, strokeWidth = 1.7, className }: IconProps) {
  const cells = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if ((r + c) % 2 === 0) cells.push(<rect key={`${r}-${c}`} x={4 + c * 4} y={4 + r * 4} width="4" height="4" fill="currentColor" stroke="none" />);
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth * 0.7} aria-hidden="true">
    {cells}<rect x="4" y="4" width="16" height="16" />
  </svg>;
}

/** Social media: celular com uma postagem (imagem) e um coração. */
export function SocialMediaIcon({ size = 24, strokeWidth = 1.7, className }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <rect x="5.5" y="2.5" width="13" height="19" rx="2.2" />
    <rect x="8" y="6" width="8" height="7" rx="0.8" />
    <path d="M10.6 16.6c.5-.6 1.4-.5 1.4.2 0-.7.9-.8 1.4-.2.4.5 0 1.1-1.4 2-1.4-.9-1.8-1.5-1.4-2z" fill="currentColor" strokeWidth={strokeWidth * 0.5} />
  </svg>;
}
