import type { VectorDocument } from '../document/model.ts';
import { exportScene, toSvg } from './exporters.ts';
import { pageList } from '../document/pages.ts';
import { browserMeasure } from '../text/textMeasure.ts';
import { desktop } from './desktop.ts';

const escapeHtml = (text: string) => text.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
/** HTML de impressão: uma folha por página do documento, no tamanho real da página (mm), sem margens. */
export function printHtml(document: VectorDocument): string {
  const w = document.artboard.width * 25.4 / 96, h = document.artboard.height * 25.4 / 96;
  const pages = pageList(document).map(page => toSvg(exportScene({ ...document, objects: page.objects, pages: undefined, page: undefined }, 'page', []), browserMeasure, '#ffffff').replace(/^<\?xml[^>]*>\s*/, ''));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(document.name)}</title><style>@page{size:${w.toFixed(3)}mm ${h.toFixed(3)}mm;margin:0}html,body{margin:0;padding:0;background:#fff}.page{width:${w.toFixed(3)}mm;height:${h.toFixed(3)}mm;overflow:hidden;break-after:page}.page:last-child{break-after:auto}.page>svg{display:block;width:100%;height:100%}</style></head><body>${pages.map(svg => `<div class="page">${svg}</div>`).join('')}</body></html>`;
}
/**
 * Arquivo › Imprimir (Ctrl+P): abre a janela de impressão do Windows com todas as páginas.
 * No aplicativo instalado a impressão roda numa janela oculta própria; no navegador, num iframe.
 */
export async function printDocument(document: VectorDocument): Promise<string> {
  const html = printHtml(document), count = pageList(document).length;
  if (desktop?.print) {
    const result = await desktop.print(html);
    if (!result.ok) throw new Error(result.error || 'Não foi possível imprimir.');
    return result.canceled ? 'Impressão cancelada.' : `Enviado para impressão: ${count} página(s).`;
  }
  const frame = window.document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.srcdoc = html;
  window.document.body.appendChild(frame);
  await new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
  await Promise.all([...frame.contentDocument!.images].map(image => image.decode().catch(() => undefined)));
  frame.contentWindow!.focus(); frame.contentWindow!.print();
  window.setTimeout(() => frame.remove(), 60000);
  return `Janela de impressão aberta: ${count} página(s).`;
}
