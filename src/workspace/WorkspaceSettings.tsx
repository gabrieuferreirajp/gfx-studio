import {NudgeField} from './NudgeField';
import {useEffect,useRef} from 'react';
import {useWorkspace} from './WorkspaceContext';
import {panelIds,panelNames,dockNames,type Dock,type IconSize,type PaletteMode} from './layout';
import {desktop} from '../io/desktop';
export function WorkspaceSettings(){
 const {layout,setLayout,setPanel,customizing,customize,reset,storageError}=useWorkspace(),ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(customizing)ref.current?.showModal();else ref.current?.close();},[customizing]);
 return <dialog ref={ref} className="workspace-settings" onCancel={()=>customize(false)} onClose={()=>customize(false)}><form method="dialog" noValidate onSubmit={()=>customize(false)}>
  <h2>Personalizar área de trabalho</h2><p>Arraste a alça de uma barra para movê-la, a borda para redimensioná-la, ou escolha uma posição abaixo.</p>
  <div className="settings-panels">{panelIds.map(id=><div key={id}><label><input type="checkbox" checked={layout.panels[id].visible} onChange={e=>setPanel(id,{visible:e.target.checked})}/>{panelNames[id]}</label><select aria-label={`Posição de ${panelNames[id]}`} value={layout.panels[id].dock} onChange={e=>setPanel(id,{dock:e.target.value as Dock})}>{Object.entries(dockNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>)}</div>
  <label className="settings-row">Tema<select value={layout.theme} onChange={e=>setLayout(s=>({...s,theme:e.target.value as 'light'|'dark'}))}><option value="light">Claro</option><option value="dark">Escuro</option></select></label>
  <label className="settings-row">Largura do painel<input type="range" min="230" max="700" value={layout.inspectorWidth} onChange={e=>setLayout(s=>({...s,inspectorWidth:Number(e.target.value)}))}/><span>{layout.inspectorWidth}px</span></label>
  <label className="settings-row">Tamanho dos ícones<select value={layout.iconSize} onChange={e=>setLayout(s=>({...s,iconSize:e.target.value as IconSize}))}><option value="small">Pequeno</option><option value="medium">Médio</option><option value="large">Grande</option></select></label>
  <label className="settings-row">Paleta padrão<select value={layout.paletteMode} onChange={e=>setLayout(s=>({...s,paletteMode:e.target.value as PaletteMode}))}><option value="rgb">Paleta padrão RGB</option><option value="cmyk">Paleta padrão CMYK</option></select></label>
  <h3 className="settings-subtitle">Grade e linhas-guia</h3>
  <label className="settings-row">Espaçamento da grade<input type="number" min="0.1" max="1000" step="0.5" value={Number((layout.gridSize*25.4/96).toFixed(3))} onChange={e=>{const mm=Number(e.target.value);if(Number.isFinite(mm)&&mm>=0.1&&mm<=1000)setLayout(s=>({...s,gridSize:mm*96/25.4}));}}/><span>mm</span></label>
  <label className="settings-check"><input type="checkbox" checked={layout.grid} onChange={e=>setLayout(s=>({...s,grid:e.target.checked}))}/>Mostrar grade do documento</label>
  <label className="settings-check"><input type="checkbox" checked={layout.snapGrid} onChange={e=>setLayout(s=>({...s,snapGrid:e.target.checked}))}/>Encaixar na grade</label>
  <label className="settings-check"><input type="checkbox" checked={layout.guides} onChange={e=>setLayout(s=>({...s,guides:e.target.checked}))}/>Mostrar linhas-guia</label>
  <label className="settings-check"><input type="checkbox" checked={layout.snapGuides} onChange={e=>setLayout(s=>({...s,snapGuides:e.target.checked}))}/>Encaixar nas linhas-guia</label>
  <h3 className="settings-subtitle">Salvar</h3>
  <label className="settings-row settings-check"><input type="checkbox" checked={layout.autoBackup} onChange={e=>setLayout(s=>({...s,autoBackup:e.target.checked}))}/>Backup automático a cada<input type="number" aria-label="Minutos entre backups automáticos" min="1" max="120" disabled={!layout.autoBackup} value={layout.autoBackupMinutes} onChange={e=>{const v=Math.round(Number(e.target.value));if(v>=1&&v<=120)setLayout(s=>({...s,autoBackupMinutes:v}));}}/><span>min</span></label>
  <label className="settings-check" title={desktop?undefined:'Disponível só no aplicativo instalado'}><input type="checkbox" disabled={!desktop} checked={!!desktop&&layout.backupOnSave} onChange={e=>setLayout(s=>({...s,backupOnSave:e.target.checked}))}/>Ao salvar, guardar a versão anterior como “Cópia_de_segurança_de_…”{desktop?'':' (só no aplicativo instalado)'}</label>
  <p className="muted">{desktop?'O backup automático guarda os documentos com alterações não salvas na pasta de dados do GFX Studio e oferece a recuperação se o programa fechar inesperadamente.':'No navegador, o backup automático fica guardado neste endereço (com esta porta).'}</p>
  {desktop?.openBackupFolder&&<button type="button" onClick={()=>void desktop!.openBackupFolder!()}>Abrir pasta do backup automático</button>}
  <h3 className="settings-subtitle">Setas do teclado</h3>
  <NudgeField kind="nudge"/><NudgeField kind="superNudge"/><NudgeField kind="microNudge"/>
  <label className="settings-check"><input type="checkbox" checked={layout.locked} onChange={e=>setLayout(s=>({...s,locked:e.target.checked}))}/>Travar barras de ferramentas</label>
  <label className="settings-check"><input type="checkbox" checked={layout.compact} onChange={e=>setLayout(s=>({...s,compact:e.target.checked}))}/>Controles compactos</label>
  <label className="settings-check"><input type="checkbox" checked={layout.rulers} onChange={e=>setLayout(s=>({...s,rulers:e.target.checked}))}/>Mostrar réguas</label>
  <p role="status">{storageError?'O navegador não permitiu salvar a disposição. Ela será mantida apenas nesta sessão.':'A disposição é salva automaticamente neste navegador, separada dos projetos.'}</p>
  <footer><button type="button" onClick={reset}>Restaurar disposição padrão</button><button type="submit" className="primary">Concluir</button></footer>
 </form></dialog>;
}
