/** Leitor de XML mínimo e tolerante (SVG): elementos, atributos e texto; ignora comentários, DOCTYPE e instruções. */
export interface XmlElement { name: string; attributes: Record<string, string>; children: XmlNode[] }
export type XmlNode = XmlElement | string;
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeEntities = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => code[0] === '#' ? String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : entities[code.toLowerCase()] ?? match);
export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: '#document', attributes: {}, children: [] }, stack = [root];
  const tag = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  const attribute = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let last = 0, match: RegExpExecArray | null;
  while ((match = tag.exec(source))) {
    const text = source.slice(last, match.index);
    if (text.trim()) stack.at(-1)!.children.push(decodeEntities(text));
    last = tag.lastIndex;
    if (match[1] !== undefined) stack.at(-1)!.children.push(match[1]);
    else if (match[2]) { const name = match[2]; for (let i = stack.length - 1; i > 0; i--) if (stack[i].name === name) { stack.length = i; break; } }
    else if (match[3]) {
      const element: XmlElement = { name: match[3], attributes: {}, children: [] };
      for (const a of (match[4] ?? '').matchAll(attribute)) element.attributes[a[1]] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
      stack.at(-1)!.children.push(element);
      if (!match[5]) stack.push(element);
    }
  }
  const svg = root.children.find((c): c is XmlElement => typeof c !== 'string');
  if (!svg) throw new Error('Arquivo XML vazio ou inválido.');
  return svg;
}
export const elements = (e: XmlElement) => e.children.filter((c): c is XmlElement => typeof c !== 'string');
export const localName = (name: string) => name.replace(/^.*:/, '');
