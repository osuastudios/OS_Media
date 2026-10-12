// OS Media — Made by OSUA Studio
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { ensureBinaries, checkAndUpdateYtDlp, getInstalledYtDlpVersion, getFfmpegPath, getDenoPath } = require('./binaries');
const { startDownload } = require('./ytdlp');
const { readSettings, writeSettings } = require('./settings');
const { GIF_PRESETS, convertToGif } = require('./gif');
const {
  VIDEO_SCHEME,
  registerVideo,
  handleVideoRequest,
  probeVideo,
  getThumbnails,
  createPreview,
  cleanupPreviews,
  exportVideo,
} = require('./editor');
const {
  SOUND_CATEGORIES,
  getApiKey,
  getSoundsDir,
  searchSounds,
  downloadSound,
  findDownloaded,
  isInsideSoundsDir,
} = require('./sounds');
const { setupUpdater, checkForUpdates, downloadUpdate, quitAndInstall } = require('./updater');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
const activeDownloads = new Map();
const activeGifConversions = new Map();
const activeEditorJobs = new Map();

// Debe registrarse antes de que la app esté lista: permite que el <video> del
// editor lea archivos locales con saltos (stream) desde cualquier origen.
protocol.registerSchemesAsPrivileged([
  { scheme: VIDEO_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
]);

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
  protocol.handle(VIDEO_SCHEME, handleVideoRequest);
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

app.on('will-quit', cleanupPreviews);

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

function trackEditorJob(channel, { promise, cancel }, buildDonePayload, errorMessage) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  activeEditorJobs.set(id, cancel);
  promise
    .then((result) => {
      mainWindow?.webContents.send(channel, { id, ok: true, ...buildDonePayload(result) });
    })
    .catch((err) => {
      if (err.cancelled) return;
      mainWindow?.webContents.send(channel, { id, ok: false, message: errorMessage, details: err.message });
    })
    .finally(() => {
      activeEditorJobs.delete(id);
    });
  return id;
}

ipcMain.handle('editor:open', async (_event, inputPath) => {
  try {
    const info = await probeVideo(inputPath);
    if (!info.hasVideo) return { ok: false, error: 'El archivo no contiene vídeo.' };
    return { ok: true, ...info, url: registerVideo(inputPath) };
  } catch (err) {
    return { ok: false, error: 'No se pudo abrir el archivo. Comprueba que es un vídeo válido.', details: err.message };
  }
});

ipcMain.handle('editor:thumbnails', async (_event, { inputPath, duration, count }) =>
  getThumbnails(inputPath, { duration, count })
);

ipcMain.handle('editor:make-preview', async (_event, { inputPath, duration }) => {
  let id;
  const job = createPreview({
    inputPath,
    duration,
    onProgress: (percent) => mainWindow?.webContents.send('editor:preview-progress', { id, percent }),
  });
  id = trackEditorJob(
    'editor:preview-done',
    job,
    ({ outputPath }) => ({ url: registerVideo(outputPath) }),
    'No se pudo preparar la vista previa de este vídeo.'
  );
  return { id };
});

ipcMain.handle('editor:choose-output', async (_event, inputPath) => {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(dir, `${base}_editado.mp4`),
    filters: [{ name: 'Vídeo MP4', extensions: ['mp4'] }],
  });
  if (result.canceled || !result.filePath) return null;
  if (path.resolve(result.filePath) === path.resolve(inputPath)) {
    return { error: 'Elige un nombre distinto al del vídeo original.' };
  }
  return { outputPath: result.filePath };
});

ipcMain.handle('editor:export', async (_event, options) => {
  let id;
  const job = exportVideo({
    ...options,
    onProgress: (percent) => mainWindow?.webContents.send('editor:export-progress', { id, percent }),
  });
  id = trackEditorJob(
    'editor:export-done',
    job,
    ({ outputPath, sizeBytes }) => ({ outputPath, sizeBytes }),
    'No se pudo exportar el vídeo.'
  );
  return { id };
});

ipcMain.handle('editor:cancel', async (_event, id) => {
  const cancel = activeEditorJobs.get(id);
  if (cancel) {
    cancel();
    activeEditorJobs.delete(id);
    return true;
  }
  return false;
});

ipcMain.handle('sounds:get-info', async () => ({
  categories: SOUND_CATEGORIES.map(({ key, label }) => ({ key, label })),
  hasKey: Boolean(getApiKey()),
}));

ipcMain.handle('sounds:set-key', async (_event, key) => {
  writeSettings({ freesoundKey: key?.trim() || null });
  try {
    await searchSounds({ query: 'test' });
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err.code, error: err.message };
  }
});

ipcMain.handle('sounds:search', async (_event, options) => {
  try {
    return { ok: true, ...(await searchSounds(options)) };
  } catch (err) {
    return {
      ok: false,
      code: err.code,
      error: err.code ? err.message : 'No se pudo conectar con la biblioteca de sonidos. Comprueba tu conexión.',
      details: err.message,
    };
  }
});

ipcMain.handle('sounds:download', async (_event, { sound, format }) => {
  try {
    const { filePath } = await downloadSound({ sound, format });
    return { ok: true, filePath, downloaded: findDownloaded(sound.id)[sound.id] || {} };
  } catch (err) {
    return { ok: false, error: 'No se pudo descargar el sonido.', details: err.message };
  }
});

ipcMain.handle('sounds:downloaded', async () => findDownloaded());

ipcMain.handle('shell:open-freesound', async () => {
  shell.openExternal('https://freesound.org/apiv2/apply/');
});

ipcMain.handle('sounds:open-folder', async () => {
  const dir = getSoundsDir();
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
});

ipcMain.handle('sounds:show-file', async (_event, filePath) => {
  if (isInsideSoundsDir(filePath) && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
});

// Arrastrar un sonido descargado desde la app directamente a Premiere,
// CapCut, DaVinci, etc. Solo se permiten archivos de la carpeta de sonidos.
const dragIcon = nativeImage.createFromPath(path.join(__dirname, 'drag-icon.png'));
ipcMain.on('sounds:start-drag', (event, filePath) => {
  if (!isInsideSoundsDir(filePath) || !fs.existsSync(filePath)) return;
  event.sender.startDrag({ file: filePath, icon: dragIcon });
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
