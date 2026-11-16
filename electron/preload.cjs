// Ponte mínima e segura entre o editor e o Windows.
const { contextBridge, ipcRenderer } = require('electron');
/** Respostas { ok, value | error } do processo principal viram valor ou erro. */
const check = result => { if (!result?.ok) throw new Error(result?.error ?? 'Falha no backup.'); return result.value; };
contextBridge.exposeInMainWorld('vectorStudioDesktop', {
  fontFamilies: () => ipcRenderer.invoke('vs:font-families'),
  fontFile: (family, bold, italic, weight) => ipcRenderer.invoke('vs:font-file', { family, bold, italic, weight }),
  fontFaces: () => ipcRenderer.invoke('vs:font-faces'),
  convertExternal: (bytes, name, page) => ipcRenderer.invoke('vs:convert-external', { bytes, name, page }),
  pdfPageCount: bytes => ipcRenderer.invoke('vs:pdf-page-count', { bytes }),
  openDialog: () => ipcRenderer.invoke('vs:open-dialog'),
  openPath: path => ipcRenderer.invoke('vs:open-path', { path }),
  fileInfo: paths => ipcRenderer.invoke('vs:file-info', { paths }),
  saveProject: (content, path, name, saveAs, backup) => ipcRenderer.invoke('vs:save-project', { content, path, name, saveAs, backup }),
  backup: {
    write: (key, meta, content) => ipcRenderer.invoke('vs:backup-write', { key, meta, content }).then(check),
    remove: key => ipcRenderer.invoke('vs:backup-remove', { key }).then(check),
    list: () => ipcRenderer.invoke('vs:backup-list').then(check),
    read: key => ipcRenderer.invoke('vs:backup-read', { key }).then(check),
  },
  openBackupFolder: () => ipcRenderer.invoke('vs:backup-folder'),
  exportDwg: script => ipcRenderer.invoke('vs:export-dwg', { script }),
  exportCdr: (svg, version) => ipcRenderer.invoke('vs:export-cdr', { svg, version }),
  removeBackgroundAIAvailable: () => ipcRenderer.invoke('vs:remove-bg-ai-available'),
  removeBackgroundAI: input => ipcRenderer.invoke('vs:remove-bg-ai', input),
  toggleFullscreen: () => ipcRenderer.send('vs:toggle-fullscreen'),
  setFullscreen: on => ipcRenderer.send('vs:set-fullscreen', on === true),
  print: html => ipcRenderer.invoke('vs:print', { html }),
  onCloseRequest: callback => { const listener = () => callback(); ipcRenderer.on('vs:close-request', listener); return () => ipcRenderer.removeListener('vs:close-request', listener); },
  confirmClose: () => ipcRenderer.send('vs:close-confirmed'),
  onOpenFile: callback => { const listener = (_event, file) => callback(file); ipcRenderer.on('vs:open-file', listener); return () => ipcRenderer.removeListener('vs:open-file', listener); },
});
