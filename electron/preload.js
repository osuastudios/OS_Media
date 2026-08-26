const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  getBinariesInfo: () => ipcRenderer.invoke('binaries:get-info'),
  updateYtDlpNow: () => ipcRenderer.invoke('binaries:update-ytdlp'),
  onBinariesStatus: (callback) => subscribe('binaries:status', callback),
  onBinariesReady: (callback) => subscribe('binaries:ready', callback),

  chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),
  openFolder: (folderPath) => ipcRenderer.invoke('shell:open-folder', folderPath),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),

  startDownload: (options) => ipcRenderer.invoke('download:start', options),
  cancelDownload: (id) => ipcRenderer.invoke('download:cancel', id),
  onDownloadProgress: (callback) => subscribe('download:progress', callback),
  onDownloadDone: (callback) => subscribe('download:done', callback),

  getGifPresets: () => ipcRenderer.invoke('gif:get-presets'),
  chooseVideoFile: () => ipcRenderer.invoke('dialog:choose-video'),
  convertToGif: (options) => ipcRenderer.invoke('gif:convert', options),
  cancelGifConversion: (id) => ipcRenderer.invoke('gif:cancel', id),
  onGifProgress: (callback) => subscribe('gif:progress', callback),
  onGifDone: (callback) => subscribe('gif:done', callback),
});
