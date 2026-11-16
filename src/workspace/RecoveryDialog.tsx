import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/EditorContext';
import { backupStore, recoverableBackups, type BackupEntry } from '../state/autoBackup';
import { parseProject } from '../document/persistence';

/**
 * Recuperação (como o CorelDRAW após um travamento): ao abrir, lista os backups automáticos deixados por uma
 * execução que não fechou normalmente. Recuperar abre cada um numa aba com alterações (Salvar pergunta o local).
 */
export function RecoveryDialog() {
  const editor = useEditor(), latest = useRef(editor); latest.current = editor;
  const ref = useRef<HTMLDialogElement>(null);
  const [entries, setEntries] = useState<BackupEntry[]>([]), [chosen, setChosen] = useState<Set<string>>(new Set()), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { let alive = true; void recoverableBackups().then(list => { if (alive && list.length) { setEntries(list); setChosen(new Set(list.map(b => b.key))); } }); return () => { alive = false; }; }, []);
  useEffect(() => { const d = ref.current; if (d && entries.length && !d.open) d.showModal(); if (d && !entries.length && d.open) d.close(); }, [entries.length]);
  const selected = entries.filter(b => chosen.has(b.key));
  async function recover() {
    setBusy(true); setError('');
    const failed: string[] = [];
    for (const entry of selected) {
      try {
        const document = parseProject(await backupStore.read(entry.key));
        latest.current.openTab({ ...document, name: entry.name }, null);
        // Marca como alterado: o conteúdo recuperado ainda não está salvo em nenhum arquivo.
        latest.current.markSaved('recuperado');
        await new Promise(r => setTimeout(r, 80));
        await backupStore.remove(entry.key);
      } catch (e) { failed.push(`${entry.name}: ${e instanceof Error ? e.message : 'falha'}`); }
    }
    setBusy(false);
    if (failed.length) { setError(`Não foi possível recuperar ${failed.join('; ')}.`); setEntries(list => list.filter(b => !chosen.has(b.key) || failed.some(f => f.startsWith(b.name + ':')))); return; }
    latest.current.setMessage(`${selected.length} documento(s) recuperado(s). Use Salvar para gravá-los.`);
    setEntries(list => list.filter(b => !chosen.has(b.key)));
  }
  async function discard() {
    if (!window.confirm(`Excluir ${selected.length} backup(s) automático(s)? Essas alterações não salvas serão perdidas.`)) return;
    setBusy(true);
    await Promise.all(selected.map(b => backupStore.remove(b.key).catch(() => undefined)));
    setBusy(false); setEntries(list => list.filter(b => !chosen.has(b.key)));
  }
  const toggle = (key: string, on: boolean) => setChosen(s => { const next = new Set(s); if (on) next.add(key); else next.delete(key); return next; });
  return <dialog ref={ref} className="workspace-settings recovery-dialog" aria-labelledby="recovery-title" onCancel={e => { e.preventDefault(); setEntries([]); }}>
    <h2 id="recovery-title">Recuperar documentos</h2>
    <p>O GFX Studio não foi fechado normalmente da última vez. Estes documentos tinham alterações não salvas guardadas pelo backup automático:</p>
    <ul className="recovery-list">{entries.map(b => <li key={b.key}><label className="settings-check"><input type="checkbox" checked={chosen.has(b.key)} onChange={e => toggle(b.key, e.target.checked)} /><span><strong>{b.name}</strong><small>{new Date(b.saved).toLocaleString('pt-BR')}{b.path ? ` · original: ${b.path}` : ' · nunca salvo'}</small></span></label></li>)}</ul>
    {error && <p className="form-error" role="alert">{error}</p>}
    <p className="muted">"Agora não" mantém os backups para a próxima abertura.</p>
    <footer>
      <button type="button" disabled={busy || !selected.length} onClick={() => void discard()}>Excluir</button>
      <span className="paint-dialog-buttons">
        <button type="button" disabled={busy} onClick={() => setEntries([])}>Agora não</button>
        <button type="button" className="primary" disabled={busy || !selected.length} onClick={() => void recover()}>{busy ? 'Recuperando…' : 'Recuperar'}</button>
      </span>
    </footer>
  </dialog>;
}
