import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Plus,X,ChevronRight,Pipette} from 'lucide-react';
import type {VectorObject} from '../document/model';
import {useEditor} from '../state/EditorContext';
import {useWorkspace} from './WorkspaceContext';
import {finishEditing} from '../state/useProjectFiles';
import {hexToCmyk,paletteLibrary} from './palettes';
import {solidFill} from '../document/paint';
import {useMeshCommands} from '../components/useMeshTool';
/** Clique: preenchimento; botão direito: contorno. Sem seleção, define as cores dos próximos objetos. */
function usePaint(){
 const {document,selectedIds,dispatch,commitEdit,setFill,setOutline,setMessage,tool}=useEditor(),mesh=useMeshCommands();
 return (color:string,stroke=false,spot?:string,cmyk?:[number,number,number,number])=>{
  finishEditing();
  // Ferramenta Malha com nós escolhidos: a cor vai para os nós (CorelDRAW).
  if(tool==='mesh'&&!stroke&&mesh.paintNodes(color))return;
  if(!selectedIds.length){if(stroke)setOutline(color);else setFill(color);setMessage(`${stroke?'Contorno':'Preenchimento'} padrão para novos objetos: ${color==='none'?'nenhum':color.toUpperCase()}.`);return;}
  commitEdit();
  // Cor especial (ex.: CutContour): o nome vai junto e sai como cor especial no PDF/EPS para o RIP de corte.
  const tag=(o:VectorObject):VectorObject=>{const key=stroke?'strokeSpot':'fillSpot',ck=stroke?'strokeCmyk':'fillCmyk';const next={...o};if(spot)next[key]=spot;else delete next[key];if(cmyk)next[ck]=cmyk;else delete next[ck];return next;};
  // Com um PowerClip selecionado, a cor vai para o quadro e não para o conteúdo.
  dispatch({type:'set-objects',objects:document.objects.map(o=>!selectedIds.includes(o.id)||o.type==='image'||(o.clipParent&&selectedIds.includes(o.clipParent))?o:tag(stroke?{...o,stroke:color,strokeWidth:color==='none'?0:o.strokeWidth||1}:solidFill(o,color)))});
  if(spot)setMessage(`${spot}: cor especial aplicada ${stroke?'ao contorno':'ao preenchimento'} (sai com esse nome no PDF e no EPS para o software de corte).`);
 };
}
/** Menu da seta da paleta (como Janela › Paletas do CorelDRAW): abrir e fechar paletas, agrupadas. */
function PaletteMenu({x,y,close}:{x:number;y:number;close:()=>void}){
 const {layout,setLayout}=useWorkspace(),ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const away=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))close();};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')close();};window.addEventListener('pointerdown',away,true);window.addEventListener('keydown',key);return()=>{window.removeEventListener('pointerdown',away,true);window.removeEventListener('keydown',key);};},[close]);
 const groups=[...new Set(paletteLibrary.map(p=>p.group))];
 const toggle=(id:string)=>setLayout(s=>{const open=s.openPalettes.includes(id)?s.openPalettes.filter(v=>v!==id):[...s.openPalettes,id];return {...s,openPalettes:open.length?open:s.openPalettes,paletteMode:open.includes('cmyk')||!open.includes('rgb')?'cmyk':'rgb'};});
 return <div ref={ref} className="palette-menu" role="menu" aria-label="Paletas" style={{left:x,top:y}}>
  {groups.map(g=><div key={g} className="palette-menu-group"><span className="palette-menu-title">{g}</span>
   {paletteLibrary.filter(p=>p.group===g).map(p=><label key={p.id} role="menuitemcheckbox" aria-checked={layout.openPalettes.includes(p.id)}><input type="checkbox" checked={layout.openPalettes.includes(p.id)} disabled={layout.openPalettes.length===1&&layout.openPalettes.includes(p.id)} onChange={()=>toggle(p.id)}/>{p.name}</label>)}</div>)}
 </div>;
}
/** Amostras enchendo coluna por coluna; a largura acompanha quantas colunas cabem na altura (como no CorelDRAW). */
function Swatches({count,children}:{count:number;children:React.ReactNode}){
 const ref=useRef<HTMLDivElement>(null),[columns,setColumns]=useState<number|null>(null);
 useLayoutEffect(()=>{
  const el=ref.current;if(!el)return;
  const measure=()=>{const vertical=!!el.closest('.dock-left, .dock-right');if(!vertical){setColumns(null);return;}const size=el.firstElementChild?.getBoundingClientRect().height||16,h=el.parentElement!.getBoundingClientRect().height-24;setColumns(size*Math.max(1,Math.ceil(count/Math.max(1,Math.floor(h/size)))));};
  measure();const o=new ResizeObserver(measure);o.observe(el.parentElement!);return()=>o.disconnect();
 },[count]);
 return <div ref={ref} className="palette-swatches" style={columns?{width:columns}:undefined}>{children}</div>;
}
/** Paletas de cores encaixadas (estilo CorelDRAW atual): colunas finas, sem espaço entre as amostras. */
export function ColorPalette(){
 const {layout}=useWorkspace(),{setTool,tool}=useEditor(),paint=usePaint(),[menu,setMenu]=useState<{x:number;y:number}|null>(null);
 const open=paletteLibrary.filter(p=>layout.openPalettes.includes(p.id));
 return <div className="palette-strip">
  {open.map(p=><div key={p.id} className="palette-column" aria-label={p.name}>
   <div className="palette-head">
    <button className="palette-arrow" aria-label={`Paletas (${p.name})`} title={`${p.name} · abrir/fechar paletas`} aria-haspopup="menu" onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setMenu({x:Math.max(4,r.left-230),y:r.bottom+2});}}><ChevronRight size={12}/></button>
    <button className={`palette-eyedropper ${tool==='eyedropper'?'active':''}`} aria-label="Conta-gotas de cor" title="Conta-gotas: clique numa cor do desenho" onClick={()=>setTool('eyedropper')}><Pipette size={13}/></button>
   </div>
   <Swatches count={p.swatches.length+1}>
    <button className="palette-none" aria-label="Sem preenchimento; botão direito: sem contorno" title="Sem preenchimento · Botão direito: sem contorno" onClick={()=>paint('none')} onContextMenu={e=>{e.preventDefault();paint('none',true);}}/>
    {p.swatches.map(s=><button key={s.hex+s.name} className={s.spot?'is-spot':undefined} style={{background:s.hex}} aria-label={`Preencher com ${s.name}`} title={`${s.name} · Clique: preenchimento · Botão direito: contorno`} onClick={()=>paint(s.hex,false,s.spot,s.cmyk)} onContextMenu={e=>{e.preventDefault();paint(s.hex,true,s.spot,s.cmyk);}}/>)}
   </Swatches>
  </div>)}
  {menu&&<PaletteMenu x={menu.x} y={menu.y} close={()=>setMenu(null)}/>}
 </div>;
}
/** Paleta do documento: registra as cores usadas no projeto; as cores podem ser removidas. */
export function DocumentPalette(){
 const {document,selectedIds,dispatch,commitEdit}=useEditor(),paint=usePaint();
 const palette=document.palette??[];
 const selectionColors=[...new Set(document.objects.filter(o=>selectedIds.includes(o.id)).flatMap(o=>[o.fill,o.stroke??'none']).filter(c=>/^#[0-9a-f]{6}$/i.test(c)).map(c=>c.toLowerCase()))].filter(c=>!palette.includes(c));
 const set=(next:string[])=>{finishEditing();commitEdit();dispatch({type:'set-palette',palette:next});};
 const name=(c:string)=>{const [C,M,Y,K]=hexToCmyk(c);return `${c.toUpperCase()} (C${C} M${M} Y${Y} K${K})`;};
 return <div className="document-palette" aria-label="Paleta do documento">
  <button className="document-palette-add" disabled={!selectionColors.length} title="Adicionar cores da seleção" aria-label="Adicionar cores da seleção à paleta do documento" onClick={()=>set([...palette,...selectionColors])}><Plus size={13}/></button>
  <button className="palette-none document-palette-none" aria-label="Sem preenchimento; botão direito: sem contorno" title="Sem preenchimento · Botão direito: sem contorno" onClick={()=>paint('none')} onContextMenu={e=>{e.preventDefault();paint('none',true);}}>×</button>
  {palette.length===0&&<span className="document-palette-empty">As cores usadas no documento aparecem aqui.</span>}
  {palette.map(c=><span className="document-swatch" key={c}><button style={{background:c}} aria-label={`Preencher com ${c}`} title={`${name(c)} · Clique: preenchimento · Botão direito: contorno`} onClick={()=>paint(c)} onContextMenu={e=>{e.preventDefault();paint(c,true);}}/><button className="document-swatch-remove" aria-label={`Remover ${c} da paleta do documento`} title="Remover da paleta do documento" onClick={()=>set(palette.filter(p=>p!==c))}><X size={9}/></button></span>)}
 </div>;
}
