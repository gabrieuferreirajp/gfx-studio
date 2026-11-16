import { useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Janela arrastável pela barra de título (como as janelas do CorelDRAW): devolve o estilo de deslocamento e o
 * manipulador para o cabeçalho. A janela continua dentro da tela.
 */
export function useDialogDrag() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as Element).closest('button, input, select, textarea')) return;
    const dialog = event.currentTarget.closest('dialog');
    if (!dialog) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY }, base = offset, rect = dialog.getBoundingClientRect(), header = event.currentTarget;
    header.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      // Pelo menos 60 px da janela e o título sempre visíveis.
      const dx = Math.max(60 - rect.right, Math.min(window.innerWidth - 60 - rect.left, e.clientX - start.x));
      const dy = Math.max(-rect.top, Math.min(window.innerHeight - 40 - rect.top, e.clientY - start.y));
      setOffset({ x: base.x + dx, y: base.y + dy });
    };
    const up = () => { header.removeEventListener('pointermove', move); header.removeEventListener('pointerup', up); header.removeEventListener('pointercancel', up); };
    header.addEventListener('pointermove', move); header.addEventListener('pointerup', up); header.addEventListener('pointercancel', up);
  }
  return { style: { translate: `${offset.x}px ${offset.y}px` }, handle: { onPointerDown, className: 'paint-dialog-title dialog-drag-handle', title: 'Arraste para mover a janela' } };
}
