import type { PathCommand, VectorObject } from '../document/model.ts';

export interface Point { x: number; y: number }
export interface PenNode extends Point { incoming?: Point; outgoing?: Point }
// A área de trabalho ultrapassa a página; caminhos ficam dentro de ±10.000 px (largura máxima de 20.000 px).
export const boundedPoint = (p: Point): Point => ({ x: Math.max(-10000, Math.min(10000, p.x)), y: Math.max(-10000, Math.min(10000, p.y)) });
export function dragHandle(node: PenNode, pointer: Point): PenNode {
  return { x: node.x, y: node.y, outgoing: boundedPoint(pointer), incoming: boundedPoint({ x: 2 * node.x - pointer.x, y: 2 * node.y - pointer.y }) };
}
export function shouldClose(nodes: PenNode[], point: Point, zoom: number) {
  return nodes.length >= 2 && Math.hypot(point.x - nodes[0].x, point.y - nodes[0].y) * zoom <= 8;
}
export function penCommands(nodes: PenNode[], closed = false): PathCommand[] {
  if (!nodes.length) return [];
  const commands: PathCommand[] = [{ type: 'M', x: nodes[0].x, y: nodes[0].y }];
  function segment(a: PenNode, b: PenNode) {
    if (a.outgoing || b.incoming) {
      const c1 = a.outgoing ?? a, c2 = b.incoming ?? b;
      commands.push({ type: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: b.x, y: b.y });
    } else commands.push({ type: 'L', x: b.x, y: b.y });
  }
  for (let i = 1; i < nodes.length; i++) segment(nodes[i - 1], nodes[i]);
  if (closed && nodes.length > 1) {
    if (nodes.at(-1)!.outgoing || nodes[0].incoming) segment(nodes.at(-1)!, nodes[0]);
    commands.push({ type: 'Z' });
  }
  return commands;
}
export function mapCommands(commands: PathCommand[], transform: (p: Point) => Point): PathCommand[] {
  return commands.map(c => c.type === 'Z' ? c : c.type === 'C' ? { type: 'C', ...transform(c), x1: transform({ x: c.x1, y: c.y1 }).x, y1: transform({ x: c.x1, y: c.y1 }).y, x2: transform({ x: c.x2, y: c.y2 }).x, y2: transform({ x: c.x2, y: c.y2 }).y } : { type: c.type, ...transform(c) });
}
export function commandsToSvg(commands: PathCommand[]): string {
  return commands.map(c => c.type === 'Z' ? 'Z' : c.type === 'C' ? `C ${c.x1} ${c.y1} ${c.x2} ${c.y2} ${c.x} ${c.y}` : `${c.type} ${c.x} ${c.y}`).join(' ');
}
export function createPathObject(nodes: PenNode[], closed: boolean, stroke: string, name = 'Caminho'): VectorObject {
  const commands = penCommands(nodes, closed);
  const points = commands.flatMap(c => c.type === 'Z' ? [] : c.type === 'C' ? [c, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }] : [c]);
  if (nodes.length < 2) throw new Error('Um caminho precisa de pelo menos dois nós.');
  // The control hull encloses the entire curve, including its control handles.
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  const width = Math.max(1, Math.max(...points.map(p => p.x)) - x), height = Math.max(1, Math.max(...points.map(p => p.y)) - y);
  return { id: crypto.randomUUID(), type: 'path', name, x, y, width, height, fill: 'none', stroke, strokeWidth: 2, commands: mapCommands(commands, p => ({ x: p.x - x, y: p.y - y })), pathSize: { width, height } };
}
export function pathData(object: VectorObject): string {
  if (!object.commands || !object.pathSize) return '';
  return commandsToSvg(mapCommands(object.commands, p => ({ x: object.x + p.x * object.width / object.pathSize!.width, y: object.y + p.y * object.height / object.pathSize!.height })));
}
export function finishPathDraft(nodes: PenNode[], tool: 'line' | 'pen', stroke: string, closed = false): VectorObject | null {
  if (nodes.length < 2) return null;
  if (tool === 'line' && Math.hypot(nodes[1].x - nodes[0].x, nodes[1].y - nodes[0].y) <= 0.001) return null;
  return createPathObject(nodes, closed, stroke, tool === 'line' ? 'Linha' : 'Caminho');
}
