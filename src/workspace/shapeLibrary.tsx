import { renderToStaticMarkup } from 'react-dom/server';
import { Accessibility, Ban, Bell, Bike, Calendar, Camera, Car, Clock, Coffee, CreditCard, Facebook, Gift, Github, Globe, Headphones, House, Info, Instagram, Key, Laptop, Leaf, Lightbulb, Linkedin, Lock, Mail, MapPin, MessageCircle, Music, Package, Phone, Plane, Printer, Recycle, Search, Settings, ShoppingCart, Smartphone, Store, ThumbsUp, Trash2, TriangleAlert, Truck, Twitch, Twitter, User, Utensils, Wallet, Wifi, Youtube, type LucideIcon } from 'lucide-react';

/**
 * Formas personalizadas (caixa de ferramentas › Polígono): formas prontas desenhadas num quadro de 100 × 100
 * (preenchidas com as cores padrão) e ícones de linha (24 × 24, contorno) das bibliotecas Lucide.
 */
export type LibraryShape = { name: string; category: string; d?: string; evenodd?: boolean; icon?: LucideIcon; extra?: string };
const f = (n: number) => Number(n.toFixed(2));
/** Polígono regular ou estrela (raio interno) centrado no quadro 100 × 100, com a primeira ponta para cima. */
function polygon(points: number, outer = 45, inner?: number, rotate = 0): string {
  const count = inner ? points * 2 : points, out: string[] = [];
  for (let i = 0; i < count; i++) { const r = inner && i % 2 ? inner : outer, a = -Math.PI / 2 + rotate + i * Math.PI * 2 / count; out.push(`${f(50 + r * Math.cos(a))} ${f(50 + r * Math.sin(a))}`); }
  return `M${out.join('L')}Z`;
}
/** Engrenagem: dentes de topo reto e furo central (par-ímpar). */
function gear(teeth = 10): string {
  const out: string[] = [], step = Math.PI * 2 / teeth;
  for (let i = 0; i < teeth; i++) { const a = -Math.PI / 2 + i * step; for (const [r, k] of [[34, -0.32], [45, -0.2], [45, 0.2], [34, 0.32]] as const) out.push(`${f(50 + r * Math.cos(a + k * step))} ${f(50 + r * Math.sin(a + k * step))}`); }
  return `M${out.join('L')}ZM50 36A14 14 0 1 0 50 64A14 14 0 1 0 50 36Z`;
}
const rotateD = (d: string, turns: number) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => { let px = Number(x), py = Number(y); for (let i = 0; i < turns; i++) [px, py] = [100 - py, px]; return `${f(px)} ${f(py)}`; });
const arrow = 'M5 38L60 38L60 16L95 50L60 84L60 62L5 62Z';
export const shapeLibrary: LibraryShape[] = [
  // Básicas
  { name: 'Triângulo', category: 'Básicas', d: 'M50 6L95 88L5 88Z' },
  { name: 'Triângulo retângulo', category: 'Básicas', d: 'M10 10L10 90L90 90Z' },
  { name: 'Losango', category: 'Básicas', d: 'M50 5L92 50L50 95L8 50Z' },
  { name: 'Pentágono', category: 'Básicas', d: polygon(5) },
  { name: 'Hexágono', category: 'Básicas', d: polygon(6, 45, undefined, Math.PI / 6) },
  { name: 'Octógono', category: 'Básicas', d: polygon(8, 47, undefined, Math.PI / 8) },
  { name: 'Paralelogramo', category: 'Básicas', d: 'M28 20L95 20L72 80L5 80Z' },
  { name: 'Trapézio', category: 'Básicas', d: 'M25 20L75 20L95 80L5 80Z' },
  { name: 'Pílula', category: 'Básicas', d: 'M30 25L70 25A25 25 0 0 1 70 75L30 75A25 25 0 0 1 30 25Z' },
  { name: 'Anel', category: 'Básicas', d: 'M50 5A45 45 0 1 0 50 95A45 45 0 1 0 50 5ZM50 28A22 22 0 1 1 50 72A22 22 0 1 1 50 28Z', evenodd: true },
  { name: 'Semicírculo', category: 'Básicas', d: 'M5 70A45 45 0 0 1 95 70Z' },
  { name: 'Moldura', category: 'Básicas', d: 'M5 5L95 5L95 95L5 95ZM20 20L20 80L80 80L80 20Z', evenodd: true },
  // Setas
  { name: 'Seta para a direita', category: 'Setas', d: arrow },
  { name: 'Seta para baixo', category: 'Setas', d: rotateD(arrow, 1) },
  { name: 'Seta para a esquerda', category: 'Setas', d: rotateD(arrow, 2) },
  { name: 'Seta para cima', category: 'Setas', d: rotateD(arrow, 3) },
  { name: 'Seta dupla', category: 'Setas', d: 'M5 50L30 20L30 38L70 38L70 20L95 50L70 80L70 62L30 62L30 80Z' },
  { name: 'Seta em quatro sentidos', category: 'Setas', d: 'M50 3L66 20L57 20L57 43L80 43L80 34L97 50L80 66L80 57L57 57L57 80L66 80L50 97L34 80L43 80L43 57L20 57L20 66L3 50L20 34L20 43L43 43L43 20L34 20Z' },
  { name: 'Divisa (chevron)', category: 'Setas', d: 'M10 10L55 10L90 50L55 90L10 90L45 50Z' },
  { name: 'Pentágono seta', category: 'Setas', d: 'M5 20L70 20L95 50L70 80L5 80Z' },
  { name: 'Seta de retorno', category: 'Setas', d: 'M30 15L5 40L30 65L30 50L60 50A15 15 0 0 1 60 80L45 80L45 95L60 95A30 30 0 0 0 60 35L30 35Z' },
  { name: 'Seta curva', category: 'Setas', d: 'M10 90L10 60A40 40 0 0 1 50 20L65 20L65 5L95 32L65 60L65 45L50 45A15 15 0 0 0 35 60L35 90Z' },
  // Símbolos
  { name: 'Coração', category: 'Símbolos', d: 'M50 90C22 70 5 54 5 32C5 17 17 6 31 6C40 6 46 11 50 18C54 11 60 6 69 6C83 6 95 17 95 32C95 54 78 70 50 90Z' },
  { name: 'Estrela', category: 'Símbolos', d: polygon(5, 48, 20) },
  { name: 'Estrela de 6 pontas', category: 'Símbolos', d: polygon(6, 48, 26) },
  { name: 'Explosão', category: 'Símbolos', d: polygon(16, 48, 34) },
  { name: 'Selo', category: 'Símbolos', d: polygon(24, 47, 41) },
  { name: 'Engrenagem', category: 'Símbolos', d: gear(), evenodd: true },
  { name: 'Cruz', category: 'Símbolos', d: 'M37 5L63 5L63 37L95 37L95 63L63 63L63 95L37 95L37 63L5 63L5 37L37 37Z' },
  { name: 'Xis', category: 'Símbolos', d: 'M23 5L50 32L77 5L95 23L68 50L95 77L77 95L50 68L23 95L5 77L32 50L5 23Z' },
  { name: 'Visto (check)', category: 'Símbolos', d: 'M8 52L22 38L40 56L78 16L92 30L40 84Z' },
  { name: 'Raio', category: 'Símbolos', d: 'M58 3L18 56L46 56L38 97L82 40L54 40Z' },
  { name: 'Lua', category: 'Símbolos', d: 'M62 6A44 44 0 1 0 94 64A34 34 0 1 1 62 6Z' },
  { name: 'Gota', category: 'Símbolos', d: 'M50 4C50 4 16 44 16 64A34 34 0 0 0 84 64C84 44 50 4 50 4Z' },
  { name: 'Nuvem', category: 'Símbolos', d: 'M26 82A21 21 0 0 1 22 40A26 26 0 0 1 72 32A22 22 0 0 1 76 82Z' },
  { name: 'Escudo', category: 'Símbolos', d: 'M50 4L90 18L90 46C90 70 73 87 50 96C27 87 10 70 10 46L10 18Z' },
  { name: 'Balão de fala', category: 'Símbolos', d: 'M18 10L82 10A10 10 0 0 1 92 20L92 60A10 10 0 0 1 82 70L44 70L22 90L26 70L18 70A10 10 0 0 1 8 60L8 20A10 10 0 0 1 18 10Z' },
  { name: 'Faixa', category: 'Símbolos', d: 'M3 28L97 28L82 50L97 72L3 72L18 50Z' },
  { name: 'Etiqueta', category: 'Símbolos', d: 'M5 25L68 25L95 50L68 75L5 75ZM70 44A6 6 0 1 0 70 56A6 6 0 1 0 70 44Z', evenodd: true },
  { name: 'Alvo', category: 'Símbolos', d: 'M50 5A45 45 0 1 0 50 95A45 45 0 1 0 50 5ZM50 20A30 30 0 1 1 50 80A30 30 0 1 1 50 20ZM50 35A15 15 0 1 0 50 65A15 15 0 1 0 50 35Z', evenodd: true },
  // Redes sociais (ícones de linha)
  { name: 'Facebook', category: 'Redes sociais', icon: Facebook },
  { name: 'Instagram', category: 'Redes sociais', icon: Instagram },
  { name: 'WhatsApp', category: 'Redes sociais', icon: MessageCircle, extra: '<g transform="translate(7.6 7.4) scale(0.38)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></g>' },
  { name: 'YouTube', category: 'Redes sociais', icon: Youtube },
  { name: 'LinkedIn', category: 'Redes sociais', icon: Linkedin },
  { name: 'Twitter', category: 'Redes sociais', icon: Twitter },
  { name: 'GitHub', category: 'Redes sociais', icon: Github },
  { name: 'Twitch', category: 'Redes sociais', icon: Twitch },
  { name: 'E-mail', category: 'Redes sociais', icon: Mail },
  { name: 'Site', category: 'Redes sociais', icon: Globe },
  // Dia a dia (ícones de linha)
  ...([['Telefone', Phone], ['Celular', Smartphone], ['Localização', MapPin], ['Casa', House], ['Relógio', Clock], ['Calendário', Calendar], ['Carrinho', ShoppingCart], ['Loja', Store], ['Pessoa', User], ['Wi-Fi', Wifi], ['Câmera', Camera], ['Música', Music], ['Sino', Bell], ['Busca', Search], ['Caminhão', Truck], ['Carro', Car], ['Bicicleta', Bike], ['Avião', Plane], ['Cartão', CreditCard], ['Carteira', Wallet], ['Presente', Gift], ['Caixa', Package], ['Café', Coffee], ['Talheres', Utensils], ['Cadeado', Lock], ['Chave', Key], ['Lâmpada', Lightbulb], ['Engrenagem (ícone)', Settings], ['Curtir', ThumbsUp], ['Impressora', Printer], ['Lixeira', Trash2], ['Reciclagem', Recycle], ['Folha', Leaf], ['Acessibilidade', Accessibility], ['Informação', Info], ['Atenção', TriangleAlert], ['Proibido', Ban], ['Fone de ouvido', Headphones], ['Notebook', Laptop]] as [string, LucideIcon][]).map(([name, icon]) => ({ name, category: 'Dia a dia', icon })),
];
export const shapeCategories = [...new Set(shapeLibrary.map(s => s.category))];
/**
 * SVG da forma no tamanho pedido (px do documento). Formas: preenchimento e contorno padrão
 * (sem nenhum dos dois, preto); ícones: traço na cor do contorno padrão (ou preto).
 */
export function shapeSvg(shape: LibraryShape, size: number, fill: string, outline: string, outlineWidth: number): string {
  if (shape.icon) {
    const Icon = shape.icon, inner = renderToStaticMarkup(<Icon size={24} />).replace(/^<svg[^>]*>|<\/svg>$/g, '') + (shape.extra ?? '');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><g fill="none" stroke="${outline === 'none' ? '#000000' : outline}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`;
  }
  const paint = fill === 'none' && outline === 'none' ? { fill: '#000000', stroke: 'none' } : { fill, stroke: outline };
  const width = paint.stroke === 'none' ? 0 : outlineWidth * 100 / size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100"><path d="${shape.d}" fill="${paint.fill}"${shape.evenodd ? ' fill-rule="evenodd"' : ''} stroke="${paint.stroke}" stroke-width="${width}"/></svg>`;
}
