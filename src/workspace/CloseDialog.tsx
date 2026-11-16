import { useEffect, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { useEditor } from '../state/EditorContext';
import { finishEditing } from '../state/useProjectFiles';
import { desktop } from '../io/desktop';
import { clearSessionBackups } from '../state/autoBackup';

type Choice = 'save' | 'discard' | 'cancel';
/**
 * Fechar o aplicativo instalado: para cada documento com alterações, pergunta na janela do próprio
 * GFX Studio se deve salvar, sair sem salvar ou cancelar (substitui o aviso do Windows).
 */
export function CloseGuard({ save }: { save: () => Promise<boolean> }) {
  const editor = useEditor(), latest = useRef(editor), saveRef = useRef(save);
  latest.current = editor; saveRef.current = save;
  const [ask, setAsk] = useState<{ name: string; count: number; resolve: (choice: Choice) => void } | null>(null);
  const busy = useRef(false);
  useEffect(() => desktop?.onCloseRequest?.(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      finishEditing();
      const dirty = latest.current.tabs.filter(t => t.dirty);
      for (const [i, tab] of dirty.entries()) {
        if (latest.current.activeTab !== tab.id) { latest.current.switchTab(tab.id); await new Promise(r => setTimeout(r, 80)); }
        const choice = await new Promise<Choice>(resolve => setAsk({ name: tab.file?.name ?? tab.name, count: dirty.length - i, resolve }));
        setAsk(null);
        if (choice === 'cancel') return;
        if (choice === 'save' && !(await saveRef.current())) return;
      }
      // Fechamento normal: os backups automáticos desta execução não serão oferecidos para recuperação.
      await clearSessionBackups();
      desktop?.confirmClose?.();
    } finally { busy.current = false; }
  }), []);
  // Fechar aba (×, Ctrl+F4, Arquivo › Fechar/Fechar tudo): a mesma janela de salvar, para cada documento alterado.
  useEffect(() => {
    async function confirm(e: Event) {
      const { ids, all } = (e as CustomEvent<{ ids: string[]; all: boolean }>).detail;
      if (busy.current) return;
      busy.current = true;
      try {
        finishEditing();
        for (const [i, id] of ids.entries()) {
          const tab = latest.current.tabs.find(t => t.id === id); if (!tab) continue;
          if (latest.current.activeTab !== id) { latest.current.switchTab(id); await new Promise(r => setTimeout(r, 80)); }
          const choice = await new Promise<Choice>(resolve => setAsk({ name: tab.file?.name ?? tab.name, count: ids.length - i, resolve }));
          setAsk(null);
          if (choice === 'cancel') return;
          if (choice === 'save' && !(await saveRef.current())) return;
          await new Promise(r => setTimeout(r, 50));
          if (!all) latest.current.closeTab(id, true);
        }
        if (all) { await new Promise(r => setTimeout(r, 50)); latest.current.closeAllTabs(true); }
      } finally { busy.current = false; }
    }
    window.addEventListener('vectorstudio:confirm-close', confirm);
    return () => window.removeEventListener('vectorstudio:confirm-close', confirm);
  }, []);
  return ask && <CloseDialog name={ask.name} remaining={ask.count} choose={ask.resolve} />;
}
function CloseDialog({ name, remaining, choose }: { name: string; remaining: number; choose: (choice: Choice) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Enter salva, como no CorelDRAW.
  useEffect(() => { ref.current?.showModal(); ref.current?.querySelector<HTMLButtonElement>('.primary')?.focus(); }, []);
  return <dialog ref={ref} className="workspace-settings close-dialog" aria-labelledby="close-dialog-title" onCancel={e => { e.preventDefault(); choose('cancel'); }}>
    <div className="close-dialog-body">
      <img src="./icon.svg" alt="" width="44" height="44" />
      <div>
        <h2 id="close-dialog-title">Salvar as alterações em “{name}”?</h2>
        <p>Se você não salvar, as alterações feitas desde o último salvamento serão perdidas.{remaining > 1 ? ` Há mais ${remaining - 1} documento(s) com alterações.` : ''}</p>
      </div>
    </div>
    <footer>
      <button type="button" onClick={() => choose('cancel')}>Cancelar</button>
      <span className="paint-dialog-buttons">
        <button type="button" onClick={() => choose('discard')}>Não salvar</button>
        <button type="button" className="primary" onClick={() => choose('save')}><Save size={14} />Salvar</button>
      </span>
    </footer>
  </dialog>;
}
