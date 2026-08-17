const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('schoolUpdater', {
  check: () => ipcRenderer.invoke('update:check'),
  download: () => ipcRenderer.invoke('update:download'),
  install: () => ipcRenderer.invoke('update:install'),
  status: () => ipcRenderer.invoke('update:status'),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  }
});

contextBridge.exposeInMainWorld('projectFile', {
  save: (contents) => ipcRenderer.invoke('project:save', contents),
  saveAs: (contents) => ipcRenderer.invoke('project:saveAs', contents),
  open: () => ipcRenderer.invoke('project:open'),
  current: () => ipcRenderer.invoke('project:current')
});

contextBridge.exposeInMainWorld('schoolRuntime', {
  status: () => ipcRenderer.invoke('runtime:status'),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('runtime:status', listener);
    return () => ipcRenderer.removeListener('runtime:status', listener);
  }
});
