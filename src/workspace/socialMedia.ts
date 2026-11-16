import { createObject, type VectorObject } from '../document/model.ts';

/** Formatos oficiais mais usados em redes sociais (pixels; 1 px do documento = 1 px). */
export interface SocialFormat { id: string; name: string; ratio: string; width: number; height: number; use: string }
export const socialFormats: SocialFormat[] = [
  { id: 'story', name: 'Story / Reels / TikTok', ratio: '9:16', width: 1080, height: 1920, use: 'Instagram Stories e Reels, TikTok, YouTube Shorts' },
  { id: 'feed45', name: 'Feed retrato', ratio: '4:5', width: 1080, height: 1350, use: 'Instagram e Facebook (feed e carrossel)' },
  { id: 'square', name: 'Quadrado', ratio: '1:1', width: 1080, height: 1080, use: 'Instagram, Facebook e LinkedIn (feed e carrossel)' },
  { id: 'feed34', name: 'Feed retrato (novo)', ratio: '3:4', width: 1080, height: 1440, use: 'Instagram (grade nova do perfil)' },
  { id: 'landscape', name: 'Paisagem', ratio: '1.91:1', width: 1080, height: 566, use: 'Instagram e Facebook (foto deitada)' },
  { id: 'fullhd', name: 'Full HD / miniatura web', ratio: '16:9', width: 1920, height: 1080, use: 'Banner de site, apresentação, vídeo' },
  { id: 'youtube', name: 'Miniatura do YouTube', ratio: '16:9', width: 1280, height: 720, use: 'Thumbnail de vídeo' },
  { id: 'ytbanner', name: 'Capa do YouTube', ratio: '16:9', width: 2560, height: 1440, use: 'Banner do canal' },
  { id: 'fbpost', name: 'Link / post', ratio: '1.91:1', width: 1200, height: 630, use: 'Facebook, LinkedIn, X (Twitter) e WhatsApp' },
  { id: 'fbcover', name: 'Capa do Facebook', ratio: '2.7:1', width: 820, height: 312, use: 'Capa de página' },
  { id: 'pinterest', name: 'Pin', ratio: '2:3', width: 1000, height: 1500, use: 'Pinterest' },
];
/**
 * Cria os quadros do formato: um só ou, em carrossel, `slides` quadros encostados lado a lado (sem vão), a partir
 * de (x, y). Cada quadro é um retângulo branco com contorno fino, com nome do formato e número do slide.
 */
export function socialFrames(format: SocialFormat, slides: number, x: number, y: number): VectorObject[] {
  const count = Math.max(1, Math.min(20, Math.round(slides))), group = count > 1 ? crypto.randomUUID() : null;
  return Array.from({ length: count }, (_, i) => ({
    ...createObject('rectangle', x + i * format.width, y, '#ffffff', '#9a9a9a'),
    width: format.width, height: format.height, strokeWidth: 1,
    name: count > 1 ? `${format.name} ${format.ratio} — slide ${i + 1}/${count}` : `${format.name} ${format.ratio} (${format.width}×${format.height})`,
    ...(group ? { groupPath: [group] } : {}),
  }));
}
