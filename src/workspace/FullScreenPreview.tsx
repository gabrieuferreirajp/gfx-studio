import { useEffect, useMemo } from 'react';
import { useEditor } from '../state/EditorContext';
import { exportScene, toSvg } from '../io/exporters';
import { browserMeasure } from '../text/textMeasure';
import { desktop } from '../io/desktop';

/**
 * Visualização em tela cheia (F9 no CorelDRAW): esconde menus, barras e painéis e mostra só o desenho da página,
 * centralizado, sobre fundo branco. Qualquer tecla ou clique volta ao editor.
 */
export function FullScreenPreview({ close }: { close: () => void }) {
  const { document, viewport } = useEditor();
  // Como no CorelDRAW: mostra exatamente o que está na janela de desenho (mesmo zoom e posição), sem menus e barras.
  const svg = useMemo(() => {
    const scene = exportScene(document, 'page', []), box = window.document.querySelector('svg.canvas-viewport')?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return toSvg(scene, browserMeasure, '#ffffff');
    // A tela cheia tem outra proporção: a área visível cresce em volta do mesmo centro para preencher o monitor.
    const screenW = window.screen.width || box.width, screenH = window.screen.height || box.height;
    let w = box.width / viewport.zoom, h = box.height / viewport.zoom;
    const cx = (box.width / 2 - viewport.x) / viewport.zoom, cy = (box.height / 2 - viewport.y) / viewport.zoom;
    if (w / h < screenW / screenH) w = h * screenW / screenH; else h = w * screenH / screenW;
    return toSvg({ ...scene, area: { x: cx - w / 2, y: cy - h / 2, width: w, height: h } }, browserMeasure, '#ffffff');
  }, [document, viewport]);
  // Imagem embutida (data URL): não depende de link temporário que pode ser liberado antes de a imagem carregar.
  const url = useMemo(() => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), [svg]);
  useEffect(() => {
    // Tela cheia de verdade (sem a barra do Windows/navegador) enquanto a visualização estiver aberta.
    const enter = () => { if (desktop) desktop.setFullscreen?.(true); else void window.document.documentElement.requestFullscreen?.().catch(() => {}); };
    const leave = () => { if (desktop) desktop.setFullscreen?.(false); else if (window.document.fullscreenElement) void window.document.exitFullscreen(); };
    enter();
    const key = (e: KeyboardEvent) => { e.preventDefault(); e.stopImmediatePropagation(); close(); };
    // O navegador sai da tela cheia com Esc sozinho: a visualização fecha junto.
    const change = () => { if (!desktop && !window.document.fullscreenElement) close(); };
    const t = window.setTimeout(() => window.document.addEventListener('fullscreenchange', change), 300);
    window.addEventListener('keydown', key, true);
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', key, true); window.document.removeEventListener('fullscreenchange', change); leave(); };
  }, [close]);
  return <div className="fullscreen-preview" role="dialog" aria-label="Visualização em tela cheia (qualquer tecla ou clique volta)" onPointerDown={close} onContextMenu={e => { e.preventDefault(); close(); }}>
    <img src={url} alt="Visualização da página" draggable={false} />
  </div>;
}
