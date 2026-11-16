import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {defaultLayout,parseLayout,type WorkspaceLayout,type PanelLayout,type PanelId} from './layout';
const key='vectorstudio.workspace.v1';
function initial(){try{return parseLayout(localStorage.getItem(key));}catch{return defaultLayout();}}
interface WorkspaceState {layout:WorkspaceLayout;setLayout:React.Dispatch<React.SetStateAction<WorkspaceLayout>>;setPanel:(id:PanelId,patch:Partial<PanelLayout>)=>void;customizing:boolean;customize:(value:boolean)=>void;reset:()=>void;storageError:boolean}
const Context=createContext<WorkspaceState|null>(null);
export function WorkspaceProvider({children}:{children:ReactNode}){
 const [layout,setLayout]=useState(initial),[customizing,customize]=useState(false),[storageError,setStorageError]=useState(false);
 useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(layout));setStorageError(false);}catch{setStorageError(true);}},[layout]);
 return <Context.Provider value={{layout,setLayout,setPanel:(id,patch)=>setLayout(old=>({...old,panels:{...old.panels,[id]:{...old.panels[id],...patch}}})),customizing,customize,reset:()=>setLayout(defaultLayout()),storageError}}>{children}</Context.Provider>;
}
export function useWorkspace(){const state=useContext(Context);if(!state)throw new Error('WorkspaceProvider ausente');return state;}
