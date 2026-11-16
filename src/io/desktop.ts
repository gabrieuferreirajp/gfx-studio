/** Recursos do aplicativo instalado (Electron); ausentes quando o editor roda no navegador. */
export interface DesktopBridge {
  /** Estilos das fontes instaladas (família, nome do estilo, peso, itálico, variável). */
  fontFaces?: () => Promise<{ family: string; style: string; weight: number; italic: boolean; variable: boolean }[]>;
  fileInfo?: (paths: string[]) => Promise<{ path: string; exists: boolean; size: number }[]>;
  fontFamilies: () => Promise<string[]>;
  fontFile: (family: string, bold: boolean, italic: boolean, weight?: number) => Promise<{ bytes: ArrayBuffer; synthetic: boolean } | null>;
  /** CDR/PDF/AI/EPS → SVG (Inkscape); DWG → DXF (LibreDWG). */
  pdfPageCount?: (bytes: ArrayBuffer | Uint8Array) => Promise<{ ok: true; pages: number } | { ok: false; error: string }>;
  convertExternal: (bytes: ArrayBuffer | Uint8Array, name: string, page?: number) => Promise<{ ok: true; svg: string; dxf?: Uint8Array } | { ok: false; error: string }>;
  toggleFullscreen: () => void;
  setFullscreen?: (on: boolean) => void;
  print?: (html: string) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
  /** Pedido de fechar a janela: o editor pergunta sobre alterações e responde com confirmClose. */
  onCloseRequest?: (callback: () => void) => () => void;
  confirmClose?: () => void;
  onOpenFile: (callback: (file: { name: string; content: string; path?: string }) => void) => () => void;
  openDialog: () => Promise<{ ok: true; file: { kind: 'project'; path: string; name: string; content: string } | { kind: 'svg'; name: string; source: string; content: string; bytes?: Uint8Array } | { kind: 'pdf'; name: string; source: string; content: string; bytes: Uint8Array; pages: number } } | { ok: false; canceled?: boolean; error?: string }>;
  openPath?: (path: string) => Promise<{ ok: true; file: { kind: 'project'; path: string; name: string; content: string } | { kind: 'svg'; name: string; source: string; content: string; bytes?: Uint8Array } | { kind: 'pdf'; name: string; source: string; content: string; bytes: Uint8Array; pages: number } } | { ok: false; canceled?: boolean; error?: string }>;
  /** `backup`: antes de sobrescrever, copia o arquivo anterior para "Cópia_de_segurança_de_<nome>" (como o CorelDRAW). */
  saveProject: (content: string, path: string | null, name: string, saveAs: boolean, backup?: boolean) => Promise<{ ok: true; path: string; name: string } | { ok: false; canceled?: boolean; error?: string }>;
  /** Backup automático na pasta de dados do usuário (ausente em versões antigas do aplicativo). */
  backup?: {
    write: (key: string, meta: { name: string; path?: string; saved: number }, content: string) => Promise<void>;
    remove: (key: string) => Promise<void>;
    list: () => Promise<{ key: string; name: string; path?: string; saved: number }[]>;
    read: (key: string) => Promise<string>;
  };
  openBackupFolder?: () => Promise<void>;
  /** DWG 2000 a partir do roteiro do dwgadd (LibreDWG). */
  exportDwg?: (script: string) => Promise<{ ok: true; dwg: Uint8Array } | { ok: false; error: string }>;
  /** CDR (versões 7 a 27) a partir do SVG do desenho, pelo tracedraw-cli embutido. */
  /** Remover fundo com IA (IS-Net 1024×1024): entrada RGB normalizada em CHW; saída máscara 0–1. */
  removeBackgroundAIAvailable?: () => Promise<boolean>;
  removeBackgroundAI?: (input: Float32Array) => Promise<{ ok: true; mask: Float32Array; provider: string } | { ok: false; error: string }>;
  exportCdr?: (svg: string, version: number) => Promise<{ ok: true; cdr: Uint8Array; note: string } | { ok: false; error: string }>;
}
export const desktop = (globalThis as { vectorStudioDesktop?: DesktopBridge }).vectorStudioDesktop;
export function toggleFullscreen() {
  if (desktop) { desktop.toggleFullscreen(); return; }
  if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.();
}
