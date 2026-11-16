import { createDocument, type VectorDocument, type VectorObject } from '../document/model';
import { MAX_FILE_BYTES, parseProject, serializeProject } from '../document/persistence';
import { importSvg } from './svgImport';
import { updateText } from '../text/textLayout';
import { browserMeasure } from '../text/textMeasure';
import { desktop } from './desktop';
import { applyCdrFills, readCdrData, type CdrTextStyle } from './cdrText';
import { decodeDxf, dxfToSvg } from './dxfImport';
import { askPdfPages } from '../workspace/PdfPagesDialog';
import { applyMatrix, translate } from '../geometry/objectTransforms';

const SUPPORTED = /^data:image\/(png|jpeg|gif|webp);base64,/;
function load(src: string) { return new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Imagem incorporada ilegível.')); image.src = src; }); }
/** Converte bitmaps (BMP etc.) para PNG/JPEG e reduz imagens grandes para caber no limite do projeto. */
async function normalizeImage(src: string, budget: number): Promise<string> {
  if (SUPPORTED.test(src) && src.length <= budget) return src;
  const image = await load(src), canvas = document.createElement('canvas');
  let scale = Math.min(1, 4000 / Math.max(image.naturalWidth, image.naturalHeight));
  for (let attempt = 0; attempt < 6; attempt++) {
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d')!; context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png'); if (png.length <= budget) return png;
    const jpeg = canvas.toDataURL('image/jpeg', 0.85); if (jpeg.length <= budget) return jpeg;
    scale *= 0.7;
  }
  throw new Error('Uma imagem do arquivo é grande demais para o limite de 10 MB do projeto.');
}
/** Abre SVG (e, no aplicativo instalado, CDR e PDF convertidos pelo Inkscape) como documento editável. */
export async function documentFromSvg(svg: string, name: string, cdrStyles?: CdrTextStyle[]): Promise<{ document: VectorDocument; warnings: string[] }> {
  const result = importSvg(svg, { name, measure: browserMeasure, cdrStyles });
  const images = result.objects.filter(o => o.type === 'image'), budget = Math.floor(MAX_FILE_BYTES * 0.85 / Math.max(1, images.length));
  const objects: VectorObject[] = [];
  // PDFs costumam trazer objetos achatados (escala zero): invisíveis e impossíveis de transformar — ficam de fora.
  const flat = (o: VectorObject) => !!o.transform && Math.abs(o.transform[0] * o.transform[3] - o.transform[1] * o.transform[2]) < 1e-12;
  const skipped = result.objects.filter(flat).length;
  if (skipped) result.warnings.push(`${skipped} objeto(s) achatado(s) (sem área) foram ignorados.`);
  for (const o of result.objects.filter(o => !flat(o))) {
    if (o.type === 'image') objects.push({ ...o, src: await normalizeImage(o.src!, budget) });
    else if (o.type === 'text') objects.push(updateText(o, {}, browserMeasure));
    else objects.push(o);
  }
  const document = parseProject(serializeProject({ ...createDocument(), name, unit: 'mm', artboard: result.artboard, objects }));
  return { document, warnings: result.warnings };
}
export type ExternalKind = 'svg' | 'cdr' | 'pdf' | 'ai' | 'eps' | 'dxf' | 'dwg';
export const externalKind = (fileName: string): ExternalKind | null => { const ext = fileName.toLowerCase().match(/\.(svg|cdr|pdf|ai|eps|dxf|dwg)$/)?.[1]; return (ext as ExternalKind) ?? null; };
/** DXF (AutoCAD) como documento editável; o DWG chega aqui já convertido em DXF pelo aplicativo instalado. */
export async function documentFromDxf(bytes: ArrayBuffer | Uint8Array, name: string) {
  const { svg, warnings } = dxfToSvg(decodeDxf(bytes));
  const result = await documentFromSvg(svg, name);
  return { ...result, warnings: [...warnings, ...result.warnings] };
}
/**
 * PDF com uma ou mais páginas: pergunta quais (se tiver mais de uma), converte cada uma pelo Inkscape e devolve
 * um documento por página. `null` se o usuário cancelar.
 */
export async function pdfDocuments(bytes: ArrayBuffer | Uint8Array, name: string, action: 'abrir' | 'importar', known?: number): Promise<{ documents: VectorDocument[]; pages: number[]; warnings: string[] } | null> {
  if (!desktop) throw new Error('Para abrir PDF, use o GFX Studio instalado (o navegador não acessa o conversor).');
  let count = known ?? 1;
  if (known === undefined && desktop.pdfPageCount) { const r = await desktop.pdfPageCount(bytes); if (r.ok) count = r.pages; }
  const pages = count > 1 ? await askPdfPages(name, count, action) : [1];
  if (!pages) return null;
  const documents: VectorDocument[] = [], warnings = new Set<string>();
  for (const page of pages) {
    const converted = await desktop.convertExternal(bytes, name + '.pdf', page);
    if (!converted.ok) throw new Error(`Página ${page}: ${converted.error}`);
    const r = await documentFromSvg(converted.svg, name);
    documents.push(r.document); r.warnings.forEach(w => warnings.add(w));
  }
  return { documents, pages, warnings: [...warnings] };
}
/** Junta documentos (um por página) num documento com várias páginas, como no CorelDRAW. */
export function multiPageDocument(documents: VectorDocument[], name: string, pageNumbers: number[]): VectorDocument {
  const first = documents[0];
  if (documents.length === 1) return first;
  const pages = documents.map((d, i) => ({ id: crypto.randomUUID(), name: `Página ${pageNumbers[i] ?? i + 1}`, objects: i === 0 ? [] : d.objects }));
  return parseProject(serializeProject({ ...first, name, objects: first.objects, pages, page: 0 }));
}
/** Lê o arquivo externo e devolve o documento; CDR/PDF/AI/EPS exigem o aplicativo instalado com Inkscape. */
export async function openExternal(file: File, action: 'abrir' | 'importar' = 'abrir'): Promise<{ document: VectorDocument; warnings: string[] } | null> {
  const kind = externalKind(file.name), name = file.name.replace(/\.[^.]+$/, '');
  if (!kind) throw new Error('Formato não suportado.');
  if (kind === 'svg') return documentFromSvg(await file.text(), name);
  if (kind === 'dxf') { if (file.size > 300 * 1024 * 1024) throw new Error('Arquivo grande demais (limite de 300 MB).'); return documentFromDxf(await file.arrayBuffer(), name); }
  if (!desktop) throw new Error(`Para abrir ${kind.toUpperCase()}, use o GFX Studio instalado (o navegador não acessa o conversor).`);
  if (file.size > 300 * 1024 * 1024) throw new Error('Arquivo grande demais (limite de 300 MB).');
  const bytes = await file.arrayBuffer();
  if (kind === 'pdf') {
    const r = await pdfDocuments(bytes, name, action);
    if (!r) return null;
    if (action === 'abrir') return { document: multiPageDocument(r.documents, name, r.pages), warnings: r.warnings };
    // Importar: as páginas escolhidas ficam lado a lado na página atual.
    let x = 0; const objects: VectorObject[] = [];
    for (const d of r.documents) { const dx = x; objects.push(...(dx ? applyMatrix(d.objects, d.objects.map(o => o.id), translate(dx, 0)) : d.objects)); x += d.artboard.width + 40; }
    return { document: { ...r.documents[0], objects }, warnings: r.warnings };
  }
  const converted = await desktop.convertExternal(bytes, file.name);
  if (!converted.ok) throw new Error(converted.error);
  if (kind === 'dwg') return documentFromDxf(converted.dxf!, name);
  return documentFromConverted(converted.svg, name, '.' + kind, kind === 'cdr' ? bytes : undefined);
}
/** Documento a partir do SVG convertido; avisa quando um CDR recente perde as cores de preenchimento. */
export async function documentFromConverted(svg: string, name: string, source: string, bytes?: ArrayBuffer | Uint8Array) {
  if (source === '.dxf' || source === '.dwg') return documentFromDxf(bytes!, name);
  if (source !== '.cdr') return documentFromSvg(svg, name);
  // CDR: peso da fonte, itálico e alinhamento dos textos e as cores de preenchimento são lidos do próprio arquivo.
  const cdr = bytes ? await readCdrData(bytes) : { styles: [], fills: [] }, painted = applyCdrFills(svg, cdr.fills);
  const result = await documentFromSvg(painted.svg, name, cdr.styles);
  if (painted.fountains) result.warnings.unshift(`${painted.fountains} preenchimento(s) em degradê do CDR viraram cor sólida (média das cores).`);
  if (!painted.applied && result.document.objects.filter(o => o.type === 'path').every(o => o.fill === 'none') && cdr.fills.some(f => f.color && f.color !== 'none')) result.warnings.unshift('Não foi possível associar as cores de preenchimento deste CDR às formas. Para fidelidade total, no CorelDRAW use Arquivo › Exportar › PDF e abra o PDF aqui.');
  return result;
}
