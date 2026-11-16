import { useEffect, useRef } from 'react';
import { desktop } from '../io/desktop';
import { serializeProject } from '../document/persistence';
import { fingerprint } from './history';
import { useEditor } from './EditorContext';

/**
 * Backup automático (CorelDRAW: Opções › Salvar): a cada N minutos grava uma cópia de cada documento com
 * alterações não salvas. No aplicativo instalado vai para a pasta "Backup automático" do usuário; no navegador,
 * para o IndexedDB desta origem. A cópia some quando o documento é salvo, fechado ou o programa fecha normalmente;
 * se o programa travar ou o Windows desligar, a próxima abertura oferece a recuperação.
 */
export interface BackupEntry { key: string; name: string; path?: string; saved: number }
export interface BackupStore {
  write(key: string, meta: Omit<BackupEntry, 'key'>, content: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<BackupEntry[]>;
  read(key: string): Promise<string>;
}
/** Identifica esta execução: backups de outras execuções são os recuperáveis. */
export const backupSession = crypto.randomUUID().slice(0, 8);
export const backupKey = (tab: string) => `${backupSession}_${tab.replace(/[^a-zA-Z0-9-]/g, '')}`;
const sessionOf = (key: string) => key.split('_')[0];

// Navegador: IndexedDB (o localStorage não comporta projetos de até 10 MB).
const DB = 'vectorstudio-backup', STORE = 'docs', ALIVE = 'vectorstudio-backup-alive';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: 'key' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponível.'));
  });
}
async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Falha no backup.'));
    });
  } finally { db.close(); }
}
/** Execuções do navegador ainda abertas (outra aba do mesmo endereço) avisam que estão vivas a cada minuto. */
function aliveSessions(): Set<string> {
  try { const raw = JSON.parse(localStorage.getItem(ALIVE) ?? '{}') as Record<string, number>; return new Set(Object.keys(raw).filter(k => Date.now() - raw[k] < 3 * 60000)); } catch { return new Set(); }
}
function heartbeat() {
  try { const raw = JSON.parse(localStorage.getItem(ALIVE) ?? '{}') as Record<string, number>, now = Date.now(); for (const k of Object.keys(raw)) if (now - raw[k] > 10 * 60000) delete raw[k]; raw[backupSession] = now; localStorage.setItem(ALIVE, JSON.stringify(raw)); } catch { /* sem armazenamento: só não distingue abas */ }
}
const browserStore: BackupStore = {
  write: async (key, meta, content) => { await transact('readwrite', s => s.put({ key, ...meta, content })); },
  remove: async key => { await transact('readwrite', s => s.delete(key)); },
  list: async () => {
    const alive = aliveSessions();
    const rows = await transact<(BackupEntry & { content: string })[]>('readonly', s => s.getAll());
    return rows.filter(r => !alive.has(sessionOf(r.key))).map(({ key, name, path, saved }) => ({ key, name, path, saved }));
  },
  read: async key => { const row = await transact<{ content: string } | undefined>('readonly', s => s.get(key)); if (!row) throw new Error('Backup não encontrado.'); return row.content; },
};
export const backupStore: BackupStore = desktop?.backup ?? browserStore;
/** Backups de execuções anteriores (as desta execução nunca aparecem). */
export async function recoverableBackups(): Promise<BackupEntry[]> {
  try { return (await backupStore.list()).filter(b => sessionOf(b.key) !== backupSession).sort((a, b) => b.saved - a.saved); } catch { return []; }
}
/** Ao fechar normalmente, os backups desta execução deixam de ser necessários. */
export async function clearSessionBackups() {
  try { await Promise.all((await backupStore.list()).filter(b => sessionOf(b.key) === backupSession).map(b => backupStore.remove(b.key))); } catch { /* ignora */ }
}

/** Grava periodicamente os documentos com alterações e apaga as cópias dos que foram salvos ou fechados. */
export function useAutoBackup(enabled: boolean, minutes: number, onError: (message: string) => void) {
  const { tabs } = useEditor(), tabsRef = useRef(tabs), written = useRef(new Map<string, string>()), errorRef = useRef(onError);
  tabsRef.current = tabs; errorRef.current = onError;
  // Documento salvo (ou fechado): remove a cópia na hora.
  const dirtyKeys = tabs.filter(t => t.dirty).map(t => backupKey(t.id)).join('|');
  useEffect(() => {
    const keep = new Set(enabled ? dirtyKeys.split('|') : []);
    for (const key of [...written.current.keys()]) if (!keep.has(key)) { written.current.delete(key); void backupStore.remove(key).catch(() => undefined); }
  }, [dirtyKeys, enabled]);
  useEffect(() => {
    if (desktop) return;
    // Ao sair da página (recarregar, fechar a aba) a execução deixa de constar como viva.
    const leave = () => { try { const raw = JSON.parse(localStorage.getItem(ALIVE) ?? '{}') as Record<string, number>; delete raw[backupSession]; localStorage.setItem(ALIVE, JSON.stringify(raw)); } catch { /* ignora */ } };
    heartbeat(); const timer = window.setInterval(heartbeat, 60000);
    window.addEventListener('pagehide', leave);
    return () => { window.clearInterval(timer); window.removeEventListener('pagehide', leave); };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let failed = false;
    const timer = window.setInterval(async () => {
      for (const tab of tabsRef.current.filter(t => t.dirty)) {
        const key = backupKey(tab.id), print = fingerprint(tab.document);
        if (written.current.get(key) === print) continue;
        try {
          await backupStore.write(key, { name: tab.file?.name.replace(/\.(?:gfxs|vectorstudio)$/i, '') ?? tab.document.name, path: tab.file?.path, saved: Date.now() }, serializeProject(tab.document));
          written.current.set(key, print); failed = false;
        } catch (error) {
          if (!failed) errorRef.current(`Backup automático falhou: ${error instanceof Error ? error.message : 'erro desconhecido'}.`);
          failed = true;
        }
      }
    }, Math.max(1, minutes) * 60000);
    return () => window.clearInterval(timer);
  }, [enabled, minutes]);
}
