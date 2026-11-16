import { createDocument, type VectorObject } from '../document/model.ts';
import { remapLinks } from '../geometry/links.ts';
import { parseProject, MAX_FILE_BYTES } from '../document/persistence.ts';

export const CLIP_MARKER = 'vectorstudio-clip:';
const MARKER = CLIP_MARKER;
export function serializeClip(objects: VectorObject[]): string { return MARKER + JSON.stringify({ objects }); }
/** Lê objetos copiados do GFX Studio, revalidando-os e gerando novos IDs. */
export function parseClip(text: string, uuid = () => crypto.randomUUID()): VectorObject[] | null {
  if (!text.startsWith(MARKER)) return null;
  const raw = JSON.parse(text.slice(MARKER.length)) as { objects?: unknown };
  const objects = parseProject(JSON.stringify({ ...createDocument(), objects: raw.objects })).objects;
  const ids = new Map<string, string>();
  const map = (id: string) => { if (!ids.has(id)) ids.set(id, uuid()); return ids.get(id)!; };
  const known = new Set(objects.map(o => o.id));
  return objects.map(o => ({ ...o, id: map(o.id), ...(o.groupPath ? { groupPath: o.groupPath.map(map) } : {}), ...(o.clipParent && known.has(o.clipParent) ? { clipParent: map(o.clipParent) } : {}), ...(o.symbol ? { symbol: { ...o.symbol, instance: map(o.symbol.instance) } } : {}) })).map(o => remapLinks(o, id => known.has(id) ? map(id) : undefined));
}
const MAX_IMAGE_SIDE = 4000;
function load(url: string) { return new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Não foi possível ler a imagem.')); image.src = url; }); }
function readAsDataUrl(blob: Blob) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Não foi possível ler a imagem.')); reader.readAsDataURL(blob); }); }
/** Cria um objeto bitmap centralizado na área indicada; imagens grandes são reduzidas para caber no projeto. */
export async function imageObjectFromBlob(blob: Blob, center: { x: number; y: number }, fitWidth: number, fitHeight: number): Promise<VectorObject> {
  if (!/^image\/(png|jpeg|gif|webp|bmp|svg\+xml)$/.test(blob.type)) throw new Error('Formato de imagem não suportado. Use PNG, JPEG, GIF, WebP, BMP ou SVG.');
  let src = await readAsDataUrl(blob);
  const image = await load(src);
  let width = image.naturalWidth || 300, height = image.naturalHeight || 150;
  const reduce = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
  if (reduce < 1 || blob.type === 'image/bmp' || blob.type === 'image/svg+xml' || src.length > MAX_FILE_BYTES * 0.7) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * reduce)); canvas.height = Math.max(1, Math.round(height * reduce));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    src = canvas.toDataURL('image/png');
    if (src.length > MAX_FILE_BYTES * 0.7) src = canvas.toDataURL('image/jpeg', 0.9);
    width = canvas.width; height = canvas.height;
  }
  if (src.length > MAX_FILE_BYTES * 0.9) throw new Error('A imagem é grande demais para o limite de 10 MB do projeto.');
  const scale = Math.min(1, fitWidth * 0.9 / width, fitHeight * 0.9 / height);
  const w = Math.max(1, width * scale), h = Math.max(1, height * scale);
  return { id: crypto.randomUUID(), type: 'image', name: 'Bitmap', x: center.x - w / 2, y: center.y - h / 2, width: w, height: h, fill: 'none', src };
}
