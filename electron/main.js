// OS Media — Made by OSUA Studio
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { ensureBinaries, checkAndUpdateYtDlp, getInstalledYtDlpVersion, getFfmpegPath, getDenoPath } = require('./binaries');
const { startDownload } = require('./ytdlp');
const { readSettings, writeSettings } = require('./settings');
const { GIF_PRESETS, convertToGif } = require('./gif');
const { setupUpdater, checkForUpdates, downloadUpdate, quitAndInstall } = require('./updater');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
const activeDownloads = new Map();
const activeGifConversions = new Map();

const iconPath = path.join(__dirname, '..', 'build', 'icon.png');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#0a0a0f',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function sendStatus(status) {
  mainWindow?.webContents.send('binaries:status', status);
}

app.whenReady().then(async () => {
  createWindow();

  setupUpdater((status) => {
    mainWindow?.webContents.send('update:status', status);
  });

  try {
    const info = await ensureBinaries(sendStatus);
    mainWindow?.webContents.send('binaries:ready', info);

    checkAndUpdateYtDlp({ onStatus: sendStatus })
      .then((result) => {
        if (result.updated) {
          mainWindow?.webContents.send('binaries:ready', {
            ytDlpVersion: result.version,
            ffmpegReady: fs.existsSync(getFfmpegPath()),
            denoReady: fs.existsSync(getDenoPath()),
          });
        }
      })
      .catch(() => {});
  } catch (err) {
    sendStatus({ step: 'binaries', state: 'error', message: err.message });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('binaries:get-info', async () => {
  const ytDlpVersion = await getInstalledYtDlpVersion();
  return {
    ytDlpVersion,
    ffmpegReady: fs.existsSync(getFfmpegPath()),
    denoReady: fs.existsSync(getDenoPath()),
  };
});

ipcMain.handle('binaries:update-ytdlp', async () => {
  try {
    const result = await checkAndUpdateYtDlp({ force: true, onStatus: sendStatus });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('dialog:choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  writeSettings({ destDir: result.filePaths[0] });
  return result.filePaths[0];
});

ipcMain.handle('settings:get', async () => readSettings());

ipcMain.handle('settings:set', async (_event, partial) => writeSettings(partial));

ipcMain.handle('shell:open-folder', async (_event, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) {
    shell.openPath(folderPath);
  }
});

ipcMain.handle('download:start', async (_event, options) => {
  const settings = readSettings();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const destDir = options.destDir || settings.destDir || path.join(app.getPath('desktop'), 'OS Media');
  fs.mkdirSync(destDir, { recursive: true });

  const { process: proc, waitForExit } = startDownload({
    url: options.url,
    destDir,
    filenameTemplate: settings.filenameTemplate || '%(title)s.%(ext)s',
    quality: options.quality || 'best',
    mode: options.mode || 'video',
    cookiesBrowser: settings.useCookies ? settings.cookiesBrowser : null,
    sleepInterval: settings.sleepInterval,
    onProgress: (progress) => {
      mainWindow?.webContents.send('download:progress', { id, ...progress });
    },
  });

  activeDownloads.set(id, proc);

  waitForExit()
    .then(() => {
      mainWindow?.webContents.send('download:done', { id, ok: true, destDir });
    })
    .catch((err) => {
      mainWindow?.webContents.send('download:done', {
        id,
        ok: false,
        message: err.message,
        details: err.details,
      });
    })
    .finally(() => {
      activeDownloads.delete(id);
    });

  return { id, destDir };
});

ipcMain.handle('download:cancel', async (_event, id) => {
  const proc = activeDownloads.get(id);
  if (proc) {
    proc.kill();
    activeDownloads.delete(id);
    return true;
  }
  return false;
});

ipcMain.handle('gif:get-presets', async () => GIF_PRESETS);

ipcMain.handle('dialog:choose-video', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Vídeos', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('gif:convert', async (_event, { inputPath, presetKey }) => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { promise, cancel } = convertToGif({
    inputPath,
    presetKey,
    onProgress: (progress) => {
      mainWindow?.webContents.send('gif:progress', { id, ...progress });
    },
  });

  activeGifConversions.set(id, cancel);

  promise
    .then(({ outputPath, sizeBytes }) => {
      mainWindow?.webContents.send('gif:done', { id, ok: true, outputPath, sizeBytes });
    })
    .catch((err) => {
      if (err.cancelled) return;
      mainWindow?.webContents.send('gif:done', {
        id,
        ok: false,
        message: 'No se pudo convertir el vídeo a GIF. Comprueba que el archivo es un vídeo válido.',
        details: err.message,
      });
    })
    .finally(() => {
      activeGifConversions.delete(id);
    });

  return { id };
});

ipcMain.handle('gif:cancel', async (_event, id) => {
  const cancel = activeGifConversions.get(id);
  if (cancel) {
    cancel();
    activeGifConversions.delete(id);
    return true;
  }
  return false;
});

ipcMain.handle('app:get-version', async () => app.getVersion());

ipcMain.handle('update:check', async () => checkForUpdates());

ipcMain.handle('update:download', async () => {
  try {
    await downloadUpdate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('update:install', async () => {
  quitAndInstall();
});
