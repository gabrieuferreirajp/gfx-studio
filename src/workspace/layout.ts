export const panelIds = ['standard','property','tools','inspector','palette','documentPalette'] as const;
export type PanelId = typeof panelIds[number];
export type Dock = 'top'|'left'|'right'|'bottom'|'floating';
export const panelNames:Record<PanelId,string>={standard:'Barra padrão',property:'Barra de propriedades',tools:'Caixa de ferramentas',inspector:'Objetos e camadas',palette:'Paleta de cores',documentPalette:'Paleta do documento'};
export const dockNames:Record<Dock,string>={top:'Superior',left:'Esquerda',right:'Direita',bottom:'Inferior',floating:'Flutuante'};
/** `size`: largura definida pelo usuário (encaixe lateral ou flutuante); `height`: altura do painel flutuante. */
export interface PanelLayout { dock:Dock; visible:boolean; x:number; y:number; size?:number; height?:number }
export type IconSize='small'|'medium'|'large';
export type PaletteMode='rgb'|'cmyk';
export interface WorkspaceLayout { version:1; theme:'light'|'dark'; compact:boolean; rulers:boolean; inspectorWidth:number; locked:boolean; smartGuides:boolean; iconSize:IconSize; paletteMode:PaletteMode; openPalettes:string[]; panels:Record<PanelId,PanelLayout>;
  /** Setas do teclado (px do documento): Deslocamento, Shift = Superdeslocamento, Ctrl = Microdeslocamento. */
  nudge:number; superNudge:number; microNudge:number;
  /** Cadeados da barra de propriedades: largura/altura proporcionais e os quatro cantos juntos. */
  lockRatio:boolean; lockCorners:boolean;
  /** Janela encaixada à direita (Propriedades/Objetos) aberta; fechada mostra só as abas verticais, como no CorelDRAW. */
  inspectorOpen:boolean;
  /** Exibir: grade do documento (espaçamento em px do documento) e linhas-guia; Alinhar a: grade, guias. */
  grid:boolean; gridSize:number; guides:boolean; snapGrid:boolean; snapGuides:boolean;
  /** Borracha: diâmetro do pincel em px do documento. */
  eraserSize:number;
  /** Cotas: casas decimais (-1 = conforme a unidade), mostrar unidade e tamanho do texto em pt. */
  dimPrecision:number; dimShowUnit:boolean; dimFontSize:number;
  /** Backup automático a cada `autoBackupMinutes` e cópia de segurança ao salvar (Opções › Salvar do CorelDRAW). */
  autoBackup:boolean; autoBackupMinutes:number; backupOnSave:boolean }
export function defaultLayout():WorkspaceLayout {
  const panel=(dock:Dock,x=120,y=120):PanelLayout=>({dock,visible:true,x,y});
  return {version:1,theme:'light',compact:true,rulers:true,inspectorWidth:280,locked:false,smartGuides:true,iconSize:'medium',paletteMode:'rgb',openPalettes:['cmyk'],nudge:9.6,superNudge:19.2,microNudge:4.8,lockRatio:false,lockCorners:true,inspectorOpen:false,grid:false,gridSize:37.795,guides:true,snapGrid:false,snapGuides:true,eraserSize:18.9,dimPrecision:-1,dimShowUnit:true,dimFontSize:10,autoBackup:true,autoBackupMinutes:10,backupOnSave:true,panels:{standard:panel('top'),property:panel('top',150,160),tools:panel('left',80,150),inspector:panel('right',500,160),palette:panel('right',900,160),documentPalette:panel('bottom',200,400)}};
}
export function parseLayout(source:string|null):WorkspaceLayout {
  const fallback=defaultLayout();
  try {
    const raw=JSON.parse(source??'null');if(!raw||raw.version!==1)return fallback;
    const finite=(n:unknown,min:number,max:number,base:number)=>typeof n==='number'&&Number.isFinite(n)?Math.max(min,Math.min(max,n)):base;
    for(const id of panelIds){const p=raw.panels?.[id],base=fallback.panels[id];if(p&&typeof p==='object'){
      const next:PanelLayout={dock:Object.hasOwn(dockNames,p.dock)?p.dock:base.dock,visible:typeof p.visible==='boolean'?p.visible:true,x:finite(p.x,0,10000,base.x),y:finite(p.y,0,10000,base.y)};
      if(typeof p.size==='number')next.size=finite(p.size,MIN_PANEL,MAX_PANEL,280);if(typeof p.height==='number')next.height=finite(p.height,60,2000,300);
      fallback.panels[id]=next;}}
    fallback.theme=raw.theme==='dark'?'dark':'light';fallback.compact=raw.compact!==false;fallback.rulers=raw.rulers!==false;fallback.locked=raw.locked===true;fallback.smartGuides=raw.smartGuides!==false;
    fallback.iconSize=['small','medium','large'].includes(raw.iconSize)?raw.iconSize:'medium';fallback.paletteMode=raw.paletteMode==='cmyk'?'cmyk':'rgb';fallback.openPalettes=Array.isArray(raw.openPalettes)&&raw.openPalettes.every((v:unknown)=>v==='cmyk'||v==='rgb'||v==='roland')&&raw.openPalettes.length?[...new Set(raw.openPalettes as string[])]:[fallback.paletteMode];
    fallback.inspectorWidth=finite(raw.inspectorWidth,230,700,280);
    fallback.lockRatio=raw.lockRatio===true;fallback.inspectorOpen=raw.inspectorOpen===true;fallback.grid=raw.grid===true;fallback.guides=raw.guides!==false;fallback.snapGrid=raw.snapGrid===true;fallback.snapGuides=raw.snapGuides!==false;fallback.gridSize=finite(raw.gridSize,0.5,5000,37.795);fallback.eraserSize=finite(raw.eraserSize,0.5,2000,18.9);fallback.lockCorners=raw.lockCorners!==false;fallback.dimPrecision=Math.round(finite(raw.dimPrecision,-1,4,-1));fallback.dimShowUnit=raw.dimShowUnit!==false;fallback.dimFontSize=finite(raw.dimFontSize,4,200,10);fallback.autoBackup=raw.autoBackup!==false;fallback.autoBackupMinutes=Math.round(finite(raw.autoBackupMinutes,1,120,10));fallback.backupOnSave=raw.backupOnSave!==false;
    for(const key of ['nudge','superNudge','microNudge'] as const)fallback[key]=finite(raw[key],0.01,5000,fallback[key]);
    return fallback;
  } catch {return fallback;}
}
export const MIN_PANEL=29,MAX_PANEL=900;
// Deve coincidir com .dock-panel.is-floating em workspace.css.
export const floatingWidth=(id:PanelId,inspectorWidth:number,size?:number)=>id==='inspector'?inspectorWidth:size??280;
export function clampFloating(x:number,y:number,width:number,height:number,panelWidth:number){
  return {x:Math.max(0,Math.min(x,Math.max(0,width-panelWidth))),y:Math.max(0,Math.min(y,Math.max(0,height-70)))};
}
export function dropDock(x:number,y:number,width:number,height:number):Dock {
  if(y<38)return 'top';if(y>height-38)return 'bottom';if(x<48)return 'left';if(x>width-48)return 'right';return 'floating';
}
