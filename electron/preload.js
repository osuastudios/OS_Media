const { contextBridge, ipcRenderer, webUtils } = require('electron');

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

  // Desde Electron 32, File.path ya no existe: la ruta de un archivo arrastrado
  // solo se puede obtener así.
  getPathForFile: (file) => webUtils.getPathForFile(file),

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

  openVideoInEditor: (inputPath) => ipcRenderer.invoke('editor:open', inputPath),
  getEditorThumbnails: (options) => ipcRenderer.invoke('editor:thumbnails', options),
  makeEditorPreview: (options) => ipcRenderer.invoke('editor:make-preview', options),
  chooseEditorOutput: (inputPath) => ipcRenderer.invoke('editor:choose-output', inputPath),
  exportEditedVideo: (options) => ipcRenderer.invoke('editor:export', options),
  cancelEditorJob: (id) => ipcRenderer.invoke('editor:cancel', id),
  onEditorPreviewProgress: (callback) => subscribe('editor:preview-progress', callback),
  onEditorPreviewDone: (callback) => subscribe('editor:preview-done', callback),
  onEditorExportProgress: (callback) => subscribe('editor:export-progress', callback),
  onEditorExportDone: (callback) => subscribe('editor:export-done', callback),

  getSoundsInfo: () => ipcRenderer.invoke('sounds:get-info'),
  setFreesoundKey: (key) => ipcRenderer.invoke('sounds:set-key', key),
  searchSounds: (options) => ipcRenderer.invoke('sounds:search', options),
  downloadSound: (options) => ipcRenderer.invoke('sounds:download', options),
  getDownloadedSounds: () => ipcRenderer.invoke('sounds:downloaded'),
  openFreesoundSignup: () => ipcRenderer.invoke('shell:open-freesound'),
  openSoundsFolder: () => ipcRenderer.invoke('sounds:open-folder'),
  showSoundFile: (filePath) => ipcRenderer.invoke('sounds:show-file', filePath),
  startSoundDrag: (filePath) => ipcRenderer.send('sounds:start-drag', filePath),

  getVoiceEffects: () => ipcRenderer.invoke('voice:get-effects'),
  chooseMediaFile: () => ipcRenderer.invoke('dialog:choose-media'),
  openVoiceSource: (inputPath) => ipcRenderer.invoke('voice:open', inputPath),
  requestMicAccess: () => ipcRenderer.invoke('voice:mic-access'),
  saveVoiceRecording: (bytes) => ipcRenderer.invoke('voice:save-recording', bytes),
  makeVoicePreview: (options) => ipcRenderer.invoke('voice:preview', options),
  discardVoicePreview: (filePath) => ipcRenderer.invoke('voice:discard-preview', filePath),
  chooseVoiceOutput: (options) => ipcRenderer.invoke('voice:choose-output', options),
  exportVoice: (options) => ipcRenderer.invoke('voice:export', options),
  cancelVoiceJob: (id) => ipcRenderer.invoke('voice:cancel', id),
  onVoicePreviewProgress: (callback) => subscribe('voice:preview-progress', callback),
  onVoicePreviewDone: (callback) => subscribe('voice:preview-done', callback),
  onVoiceExportProgress: (callback) => subscribe('voice:export-progress', callback),
  onVoiceExportDone: (callback) => subscribe('voice:export-done', callback),

  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback) => subscribe('update:status', callback),
});
