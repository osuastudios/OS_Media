const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getYtDlpPath, getFfmpegPath, getDenoPath } = require('./binaries');

const QUALITY_HEIGHTS = {
  best: null,
  '1080p': 1080,
  '720p': 720,
  '480p': 480,
};

function buildDownloadArgs({ url, destDir, filenameTemplate, quality, mode, cookiesBrowser, sleepInterval }) {
  const args = [url, '--no-playlist'];

  if (mode === 'audio') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-thumbnail', '--add-metadata');
  } else {
    // Se fuerza vídeo H.264 (avc1) + audio AAC (mp4a) siempre que sea posible: es el
    // combo compatible con editores como Premiere. YouTube también ofrece VP9/AV1,
    // más eficientes pero que Premiere rechaza con "tipo de compresión no admitido".
    // "bv" (sin *) es importante: con "bv*" yt-dlp puede colar formatos combinados
    // antiguos (como el itag 18) que además son más propensos a bloqueos.
    const height = QUALITY_HEIGHTS[quality] ?? null;
    const heightFilter = height ? `[height<=${height}]` : '';
    // Algunos clientes de YouTube (p. ej. con cookies activas) solo ofrecen
    // formatos ya combinados (vídeo+audio en uno), sin pistas por separado.
    // Por eso hay un tercer nivel "b[vcodec^=avc1]" antes de rendirse del
    // todo con "b", para seguir prefiriendo H.264 en ese caso también.
    const format = `bv[vcodec^=avc1]${heightFilter}+ba[acodec^=mp4a]/bv${heightFilter}+ba/b[vcodec^=avc1]/b`;
    args.push('-f', format, '--merge-output-format', 'mp4');
  }

  args.push(
    '--ffmpeg-location', getFfmpegPath(),
    '-o', path.join(destDir, filenameTemplate),
    '--newline',
    '--progress-template', '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
  );

  if (cookiesBrowser) {
    args.push('--cookies-from-browser', cookiesBrowser);
  }
  if (sleepInterval > 0) {
    args.push('--sleep-interval', String(sleepInterval));
  }
  // yt-dlp necesita un runtime de JS para resolver los retos anti-bot de
  // YouTube en muchos vídeos; le indicamos la ruta exacta de nuestro Deno
  // gestionado en vez de confiar en que esté en el PATH del sistema.
  const denoPath = getDenoPath();
  if (fs.existsSync(denoPath)) {
    args.push('--js-runtimes', `deno:${denoPath}`);
  }
  return args;
}

// Traduce los errores más habituales de yt-dlp a un mensaje entendible.
// El texto técnico completo se guarda aparte para el desplegable "Ver detalles".
function translateError(stderr) {
  if (/HTTP Error 403|Only images are available|sabr/i.test(stderr)) {
    return 'YouTube ha bloqueado la petición. Prueba a actualizar yt-dlp con el botón de arriba, o activa las cookies del navegador en Ajustes.';
  }
  if (/Sign in to confirm|age[- ]restrict/i.test(stderr)) {
    return 'Este vídeo requiere sesión iniciada. Activa las cookies del navegador en Ajustes.';
  }
  if (/Video unavailable|This video is private/i.test(stderr)) {
    return 'El vídeo no está disponible o es privado.';
  }
  if (/ffmpeg not found|ffprobe.*not found/i.test(stderr)) {
    return 'No se encontró ffmpeg. Vuelve a abrir la app para que se descargue de nuevo.';
  }
  if (/Could not copy .* cookie database/i.test(stderr)) {
    return 'No se pudieron leer las cookies del navegador porque está abierto. Ciérralo e inténtalo de nuevo (Firefox no tiene este problema).';
  }
  if (/Failed to decrypt with DPAPI/i.test(stderr)) {
    return 'No se han podido descifrar las cookies de este navegador (problema conocido de Edge/Chrome en Windows). Prueba con Firefox en Ajustes, funciona de forma más fiable.';
  }
  return 'La descarga ha fallado. Consulta los detalles técnicos para más información.';
}

function startDownload({ url, destDir, filenameTemplate, quality, mode, cookiesBrowser, sleepInterval, onProgress, onLog }) {
  const args = buildDownloadArgs({ url, destDir, filenameTemplate, quality, mode, cookiesBrowser, sleepInterval });
  const proc = spawn(getYtDlpPath(), args, { windowsHide: true });

  let stderrBuffer = '';
  let stdoutTail = '';

  proc.stdout.on('data', (chunk) => {
    stdoutTail += chunk.toString();
    const lines = stdoutTail.split(/\r?\n/);
    stdoutTail = lines.pop();
    for (const line of lines) {
      onLog?.(line);
      const parts = line.split('|');
      if (parts.length === 3 && parts[0].includes('%')) {
        onProgress?.({ percent: parts[0].trim(), speed: parts[1].trim(), eta: parts[2].trim() });
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderrBuffer += text;
    onLog?.(text.trim());
  });

  const waitForExit = () =>
    new Promise((resolve, reject) => {
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject({ message: translateError(stderrBuffer), details: stderrBuffer || `yt-dlp terminó con código ${code}` });
        }
      });
      proc.on('error', (err) => {
        reject({ message: 'No se pudo iniciar yt-dlp.', details: err.message });
      });
    });

  return { process: proc, waitForExit };
}

module.exports = { startDownload, translateError };
