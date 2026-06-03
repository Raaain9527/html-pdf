const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('open-file'),
  exportFile: (inputPath, options) => ipcRenderer.invoke('export-file', inputPath, options),
  exportUrl: (url, options) => ipcRenderer.invoke('export-url', url, options),
  onFileSelected: (callback) => ipcRenderer.on('file-selected', (_event, filePath) => callback(filePath)),
  isElectron: true,
});
