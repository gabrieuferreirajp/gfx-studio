export interface Viewport { x: number; y: number; zoom: number }
export const clampZoom = (zoom: number) => Math.max(0.1, Math.min(32, zoom));
export function screenToDocument(view: Viewport, x: number, y: number) {
  return { x: (x - view.x) / view.zoom, y: (y - view.y) / view.zoom };
}
export function zoomAt(view: Viewport, x: number, y: number, zoom: number): Viewport {
  const point = screenToDocument(view, x, y);
  const next = clampZoom(zoom);
  return { zoom: next, x: x - point.x * next, y: y - point.y * next };
}
export function fitViewport(width: number, height: number, artboard: { width: number; height: number }): Viewport {
  const zoom = clampZoom(Math.min(Math.max(1, width - 80) / artboard.width, Math.max(1, height - 100) / artboard.height));
  return { zoom, x: (width - artboard.width * zoom) / 2, y: (height - artboard.height * zoom) / 2 };
}
/** Vista que enquadra `b` no canvas (com margem), centralizada; `axis` limita o ajuste à largura ou à altura. */
export function fitBounds(width: number, height: number, b: { x: number; y: number; width: number; height: number }, axis: 'both' | 'width' | 'height' = 'both', margin = 40): Viewport {
  const zx = Math.max(1, width - 2 * margin) / Math.max(b.width, 1e-6), zy = Math.max(1, height - 2 * margin) / Math.max(b.height, 1e-6);
  const zoom = clampZoom(axis === 'width' ? zx : axis === 'height' ? zy : Math.min(zx, zy));
  return { zoom, x: width / 2 - (b.x + b.width / 2) * zoom, y: height / 2 - (b.y + b.height / 2) * zoom };
}
