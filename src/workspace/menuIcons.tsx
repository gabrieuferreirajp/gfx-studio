import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, Blend, Box, Check, ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, ClipboardPaste, Contrast, Copy, CopyPlus, Eye, FileMinus, FileOutput, FilePlus, FilePlus2, Files, FlipHorizontal2, FlipVertical2, FolderOpen, Frame, Grid2x2, Group, ImageDown, Info, Keyboard, Layers, LocateFixed, Lock, LockOpen, Magnet, Maximize, Moon, Palette, PanelsTopLeft, Pencil, PenLine, Printer, Redo2, Repeat2, Ruler, RotateCcw, Save, SaveAll, Scan, ScanLine, Scissors, Settings2, Shapes, SlidersHorizontal, Sparkles, Spline, SplitSquareHorizontal, SquareDashedMousePointer, SquareStack, TextCursorInput, Trash2, Type, Undo2, Ungroup, Wine, X, type LucideIcon } from 'lucide-react';

/** Ícone de cada comando de menu (pelo início do rótulo), para os menus terem leitura rápida como no CorelDRAW. */
const icons: [string, LucideIcon][] = [
  ['Novo documento', FilePlus2], ['Abrir', FolderOpen], ['Salvar como', SaveAll], ['Salvar', Save], ['Importar', ImageDown], ['Exportar', FileOutput], ['Imprimir', Printer],
  ['Desfazer', Undo2], ['Refazer', Redo2], ['Recortar', Scissors], ['Copiar', Copy], ['Colar', ClipboardPaste], ['Duplicar página', Files], ['Duplicar', CopyPlus], ['Excluir página', FileMinus], ['Excluir', Trash2], ['Selecionar tudo', SquareDashedMousePointer],
  ['Desagrupar', Ungroup], ['Agrupar', Group], ['Quebrar', SplitSquareHorizontal], ['Converter em curvas', Spline], ['Converter contorno', PenLine], ['PowerClip', Frame], ['Desbloquear', LockOpen], ['Bloquear sombra', Contrast], ['Bloquear', Lock],
  ['Espelhar horizontalmente', FlipHorizontal2], ['Espelhar verticalmente', FlipVertical2], ['Para frente', ChevronsUp], ['Para trás', ChevronsDown], ['Avançar um', ChevronUp], ['Recuar um', ChevronDown],
  ['Alinhar à esquerda', AlignStartVertical], ['Alinhar à direita', AlignEndVertical], ['Alinhar ao topo', AlignStartHorizontal], ['Alinhar à base', AlignEndHorizontal], ['Alinhar centros verticalmente', AlignCenterVertical], ['Centros verticalmente', AlignCenterVertical], ['Alinhar centros horizontalmente', AlignCenterHorizontal], ['Centros horizontalmente', AlignCenterHorizontal], ['Centralizar na página', LocateFixed], ['Alinhar e distribuir', AlignCenterVertical], ['Ordem', Layers],
  ['Rastreio', ScanLine], ['Rastrear', ScanLine], ['Repetir o último', RotateCcw], ['Repetir', Repeat2], ['Inserir página', FilePlus], ['Renomear', Pencil], ['Ir para', Files], ['Ajustar página', Scan], ['Visualização de tela cheia', Maximize], ['Guias dinâmicas', Magnet], ['Réguas', Ruler], ['Tema escuro', Moon], ['Exibir', Eye],
  ['Personalizar', Settings2], ['Restaurar disposição', PanelsTopLeft], ['Travar barras', Lock], ['Propriedades', SlidersHorizontal], ['Atalhos', Keyboard], ['Sobre', Info], ['Ferramenta Texto', Type], ['Editar texto', TextCursorInput], ['Dimensão', Ruler], ['Transparência', Wine], ['Fechar', X],
  ['Sombra', SquareStack], ['Contorno', Layers], ['Misturar', Blend], ['Extrusão', Box], ['Distorção', Sparkles], ['Envelope', Grid2x2], ['Criar objeto', Shapes], ['Efeitos', Sparkles], ['Paleta', Palette],
];
export function menuIcon(label: string): LucideIcon | undefined {
  return icons.find(([prefix]) => label.startsWith(prefix))?.[1];
}
/** Coluna do ícone: marca de seleção quando ativo, senão o ícone do comando. */
export function MenuIcon({ label, checked }: { label: string; checked?: boolean }) {
  const Icon = checked ? Check : menuIcon(label.replace(/^\d+ /, ''));
  return <span className={`menu-icon ${checked ? 'checked' : ''}`} aria-hidden="true">{Icon && <Icon size={15} strokeWidth={1.8} />}</span>;
}
