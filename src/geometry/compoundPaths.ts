import type { PathCommand } from '../document/model.ts';
import { mapCommands } from './pathGeometry.ts';

export function splitContours(commands: PathCommand[]): PathCommand[][] {
  const contours: PathCommand[][] = [];
  for (const command of commands) {
    if (command.type === 'M') contours.push([]);
    if (!contours.length) throw new Error('O contorno deve começar com M.');
    contours.at(-1)!.push(command);
  }
  return contours;
}
export function normalizeCommands(commands: PathCommand[]) {
  const points = commands.flatMap(c => c.type === 'Z' ? [] : c.type === 'C' ? [c, { x:c.x1,y:c.y1 }, { x:c.x2,y:c.y2 }] : [c]);
  if (!points.length || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Geometria inválida.');
  const x=Math.min(...points.map(p=>p.x)), y=Math.min(...points.map(p=>p.y));
  const width=Math.max(1,Math.max(...points.map(p=>p.x))-x), height=Math.max(1,Math.max(...points.map(p=>p.y))-y);
  return { x,y,width,height,pathSize:{width,height},commands:mapCommands(commands,p=>({x:p.x-x,y:p.y-y})) };
}
