const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function setupUpdater(onStatus) {
  autoUpdater.on('checking-for-update', () => {
    onStatus({ state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    onStatus({ state: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    onStatus({ state: 'not-available' });
  });
  autoUpdater.on('download-progress', (progress) => {
    onStatus({ state: 'downloading', percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    onStatus({ state: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    onStatus({ state: 'error', message: err.message });
  });
}

async function checkForUpdates() {
  // Fuera de una app empaquetada (npm run dev, o la carpeta win-unpacked suelta)
  // no existen los metadatos que electron-updater necesita; evitamos el error.
  if (!app.isPackaged) {
    return { ok: false, error: 'Buscar actualizaciones solo funciona en la app instalada.' };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function downloadUpdate() {
  return autoUpdater.downloadUpdate();
}

function quitAndInstall() {
  autoUpdater.quitAndInstall();
}

module.exports = { setupUpdater, checkForUpdates, downloadUpdate, quitAndInstall };
