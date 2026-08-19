const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');
const { spawn } = require('child_process');
const { fetchJson, downloadToFile } = require('./net');

const YTDLP_LATEST_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function getBinDir() {
  return path.join(app.getPath('userData'), 'bin');
}

function getMetaPath() {
  return path.join(getBinDir(), 'meta.json');
}

function platformInfo() {
  return { platform: os.platform(), arch: os.arch() };
}

function getYtDlpPath() {
  const { platform } = platformInfo();
  return path.join(getBinDir(), platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

function getFfmpegPath() {
  const { platform } = platformInfo();
  return path.join(getBinDir(), platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

function getFfprobePath() {
  const { platform } = platformInfo();
  return path.join(getBinDir(), platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
}

function getDenoPath() {
  const { platform } = platformInfo();
  return path.join(getBinDir(), platform === 'win32' ? 'deno.exe' : 'deno');
}

function ytDlpDownloadUrl() {
  const { platform, arch } = platformInfo();
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
  if (platform === 'win32') return `${base}/yt-dlp.exe`;
  if (platform === 'darwin') return `${base}/yt-dlp_macos`;
  if (arch === 'arm64') return `${base}/yt-dlp_linux_aarch64`;
  return `${base}/yt-dlp_linux`;
}

// yt-dlp/FFmpeg-Builds no publica binarios de macOS, así que ahí usamos evermeet.cx
async function ffmpegDownloadUrl() {
  const { platform, arch } = platformInfo();
  const base = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download';
  if (platform === 'win32') return `${base}/ffmpeg-master-latest-win64-gpl.zip`;
  if (platform === 'linux') {
    const file =
      arch === 'arm64' ? 'ffmpeg-master-latest-linuxarm64-gpl.tar.xz' : 'ffmpeg-master-latest-linux64-gpl.tar.xz';
    return `${base}/${file}`;
  }
  const info = await fetchJson('https://evermeet.cx/ffmpeg/info/ffmpeg/release');
  return info.download.zip.url;
}

// yt-dlp necesita un runtime de JavaScript (Deno) para resolver los "retos"
// anti-bot que YouTube exige cada vez más a menudo al extraer formatos.
// Sin esto, muchas descargas fallan o se quedan con calidades incompletas.
function denoDownloadUrl() {
  const { platform, arch } = platformInfo();
  const base = 'https://github.com/denoland/deno/releases/latest/download';
  if (platform === 'win32') return `${base}/deno-x86_64-pc-windows-msvc.zip`;
  if (platform === 'darwin') {
    return arch === 'arm64' ? `${base}/deno-aarch64-apple-darwin.zip` : `${base}/deno-x86_64-apple-darwin.zip`;
  }
  return arch === 'arm64' ? `${base}/deno-aarch64-unknown-linux-gnu.zip` : `${base}/deno-x86_64-unknown-linux-gnu.zip`;
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(getMetaPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeMeta(data) {
  fs.mkdirSync(getBinDir(), { recursive: true });
  fs.writeFileSync(getMetaPath(), JSON.stringify(data, null, 2));
}

function chmodExecutable(filePath) {
  if (os.platform() !== 'win32') fs.chmodSync(filePath, 0o755);
}

function extractArchive(archivePath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    // tar (bsdtar en Windows/macOS, GNU tar en Linux) detecta el formato solo,
    // así vale tanto para los .zip de Windows/macOS como los .tar.xz de Linux.
    const proc = spawn('tar', ['-xf', archivePath, '-C', destDir], { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`No se pudo extraer el archivo descargado (tar salió con código ${code}): ${stderr}`));
    });
  });
}

function findFileRecursive(dir, matcher) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, matcher);
      if (found) return found;
    } else if (matcher(entry.name)) {
      return full;
    }
  }
  return null;
}

async function downloadYtDlp(onStatus) {
  const dest = getYtDlpPath();
  onStatus?.({ step: 'yt-dlp', state: 'downloading' });
  await downloadToFile(ytDlpDownloadUrl(), dest, (progress) => {
    onStatus?.({ step: 'yt-dlp', state: 'downloading', progress });
  });
  chmodExecutable(dest);
  onStatus?.({ step: 'yt-dlp', state: 'ready' });
}

async function ensureYtDlp(onStatus) {
  if (fs.existsSync(getYtDlpPath())) return;
  await downloadYtDlp(onStatus);
}

async function ensureFfmpeg(onStatus) {
  const dest = getFfmpegPath();
  const probeDest = getFfprobePath();
  if (fs.existsSync(dest) && fs.existsSync(probeDest)) return;

  onStatus?.({ step: 'ffmpeg', state: 'downloading' });
  const url = await ffmpegDownloadUrl();
  const tmpDir = path.join(getBinDir(), '_tmp_ffmpeg');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const archivePath = path.join(tmpDir, 'ffmpeg-download');

  await downloadToFile(url, archivePath, (progress) => {
    onStatus?.({ step: 'ffmpeg', state: 'downloading', progress });
  });

  onStatus?.({ step: 'ffmpeg', state: 'extracting' });
  const extractDir = path.join(tmpDir, 'extracted');
  await extractArchive(archivePath, extractDir);

  const ffmpegName = os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobeName = os.platform() === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const foundFfmpeg = findFileRecursive(extractDir, (name) => name === ffmpegName);
  const foundFfprobe = findFileRecursive(extractDir, (name) => name === ffprobeName);
  if (!foundFfmpeg) throw new Error('No se encontró el binario de ffmpeg dentro del archivo descargado');

  fs.mkdirSync(getBinDir(), { recursive: true });
  fs.copyFileSync(foundFfmpeg, dest);
  chmodExecutable(dest);
  if (foundFfprobe) {
    fs.copyFileSync(foundFfprobe, probeDest);
    chmodExecutable(probeDest);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  onStatus?.({ step: 'ffmpeg', state: 'ready' });
}

async function ensureDeno(onStatus) {
  const dest = getDenoPath();
  if (fs.existsSync(dest)) return;

  onStatus?.({ step: 'deno', state: 'downloading' });
  const url = denoDownloadUrl();
  const tmpDir = path.join(getBinDir(), '_tmp_deno');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const archivePath = path.join(tmpDir, 'deno-download');

  await downloadToFile(url, archivePath, (progress) => {
    onStatus?.({ step: 'deno', state: 'downloading', progress });
  });

  onStatus?.({ step: 'deno', state: 'extracting' });
  const extractDir = path.join(tmpDir, 'extracted');
  await extractArchive(archivePath, extractDir);

  const denoName = os.platform() === 'win32' ? 'deno.exe' : 'deno';
  const found = findFileRecursive(extractDir, (name) => name === denoName);
  if (!found) throw new Error('No se encontró el binario de deno dentro del archivo descargado');

  fs.mkdirSync(getBinDir(), { recursive: true });
  fs.copyFileSync(found, dest);
  chmodExecutable(dest);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  onStatus?.({ step: 'deno', state: 'ready' });
}

function getInstalledYtDlpVersion() {
  return new Promise((resolve) => {
    const ytDlpPath = getYtDlpPath();
    if (!fs.existsSync(ytDlpPath)) return resolve(null);
    const proc = spawn(ytDlpPath, ['--version'], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('close', () => resolve(out.trim() || null));
    proc.on('error', () => resolve(null));
  });
}

async function getLatestYtDlpTag() {
  const data = await fetchJson(YTDLP_LATEST_API);
  return data.tag_name;
}

async function ensureBinaries(onStatus) {
  await ensureYtDlp(onStatus);
  await ensureFfmpeg(onStatus);
  await ensureDeno(onStatus);
  const ytDlpVersion = await getInstalledYtDlpVersion();
  const meta = readMeta();
  if (!meta.lastCheck) {
    writeMeta({ ...meta, lastCheck: new Date().toISOString(), ytDlpVersion });
  }
  return {
    ytDlpVersion,
    ffmpegReady: fs.existsSync(getFfmpegPath()),
    denoReady: fs.existsSync(getDenoPath()),
  };
}

// Comprueba como mucho una vez al día si hay una versión nueva de yt-dlp
// (salvo que force: true, que la fuerza siempre, para el botón "Actualizar ahora").
async function checkAndUpdateYtDlp({ force = false, onStatus } = {}) {
  const meta = readMeta();
  const last = meta.lastCheck ? new Date(meta.lastCheck).getTime() : 0;

  if (!force && Date.now() - last < ONE_DAY_MS) {
    return { updated: false, version: await getInstalledYtDlpVersion(), skipped: true };
  }

  const currentVersion = await getInstalledYtDlpVersion();
  let latestTag = null;
  try {
    latestTag = await getLatestYtDlpTag();
  } catch (err) {
    writeMeta({ ...meta, lastCheck: new Date().toISOString() });
    if (force) throw err;
    return { updated: false, version: currentVersion, error: err.message };
  }

  const needsUpdate = force || !currentVersion || latestTag.replace(/^v/, '') !== currentVersion;
  if (!needsUpdate) {
    writeMeta({ ...meta, lastCheck: new Date().toISOString(), ytDlpVersion: currentVersion });
    return { updated: false, version: currentVersion };
  }

  await downloadYtDlp(onStatus);
  const newVersion = await getInstalledYtDlpVersion();
  writeMeta({ ...meta, lastCheck: new Date().toISOString(), ytDlpVersion: newVersion });
  return { updated: true, version: newVersion };
}

module.exports = {
  getBinDir,
  getYtDlpPath,
  getFfmpegPath,
  getFfprobePath,
  getDenoPath,
  ensureBinaries,
  checkAndUpdateYtDlp,
  getInstalledYtDlpVersion,
};
