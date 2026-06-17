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

contextBridge.exposeInMainWorld('schoolRuntime', {
  status: () => ipcRenderer.invoke('runtime:status'),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('runtime:status', listener);
    return () => ipcRenderer.removeListener('runtime:status', listener);
  }
});
