const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getFfmpegPath, getFfprobePath } = require('./binaries');

// Objetivos aproximados: el tamaño final depende del contenido y duración
// del vídeo, así que estos son puntos de partida razonables, no garantías.
const GIF_PRESETS = {
  discord: { label: 'Discord normal (~8MB)', fps: 10, width: 320 },
  nitro: { label: 'Discord Nitro (~50MB)', fps: 15, width: 480 },
  max: { label: 'Máxima calidad', fps: 20, width: 640 },
};

function getVideoDuration(inputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      getFfprobePath(),
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inputPath],
      { windowsHide: true }
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('close', (code) => {
      const seconds = parseFloat(out.trim());
      if (code === 0 && !Number.isNaN(seconds)) resolve(seconds);
      else reject(new Error(err || 'No se pudo leer la duración del vídeo'));
    });
    proc.on('error', reject);
  });
}

function runFfmpeg(args, { durationSeconds, onProgress, registerProcess } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfmpegPath(), args, { windowsHide: true });
    registerProcess?.(proc);
    let stderrBuffer = '';
    let stdoutTail = '';

    proc.stdout.on('data', (chunk) => {
      stdoutTail += chunk.toString();
      const lines = stdoutTail.split(/\r?\n/);
      stdoutTail = lines.pop();
      for (const line of lines) {
        const match = line.match(/^out_time_ms=(\d+)/);
        if (match && durationSeconds > 0) {
          const doneSeconds = Number(match[1]) / 1_000_000;
          const percent = Math.min(100, Math.round((doneSeconds / durationSeconds) * 100));
          onProgress?.(percent);
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else if (proc.killed) reject(Object.assign(new Error('cancelado'), { cancelled: true }));
      else reject(new Error(stderrBuffer || `ffmpeg terminó con código ${code}`));
    });
    proc.on('error', reject);
  });
}

// Devuelve { promise, cancel } en vez de solo una promesa, porque la conversión
// encadena dos procesos de ffmpeg (paleta y GIF final) y cancelar debe poder
// matar el que esté activo en cada momento, no solo el primero.
function convertToGif({ inputPath, presetKey, onProgress }) {
  let currentProcess = null;
  let cancelled = false;

  const promise = (async () => {
    const preset = GIF_PRESETS[presetKey] || GIF_PRESETS.discord;
    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(dir, `${base}.gif`);
    const palettePath = path.join(dir, `.${base}-palette-${Date.now()}.png`);

    const durationSeconds = await getVideoDuration(inputPath);
    const scaleFilter = `scale=${preset.width}:-1:flags=lanczos`;
    const registerProcess = (proc) => {
      currentProcess = proc;
      if (cancelled) proc.kill();
    };

    try {
      onProgress?.({ stage: 'palette', percent: 0 });
      await runFfmpeg(
        ['-y', '-i', inputPath, '-vf', `fps=${preset.fps},${scaleFilter},palettegen`, '-update', '1', palettePath],
        { durationSeconds, registerProcess }
      );

      onProgress?.({ stage: 'gif', percent: 0 });
      await runFfmpeg(
        [
          '-y',
          '-i', inputPath,
          '-i', palettePath,
          '-filter_complex', `fps=${preset.fps},${scaleFilter}[x];[x][1:v]paletteuse`,
          '-progress', 'pipe:1',
          outputPath,
        ],
        { durationSeconds, onProgress: (percent) => onProgress?.({ stage: 'gif', percent }), registerProcess }
      );
    } finally {
      fs.rmSync(palettePath, { force: true });
    }

    const { size } = fs.statSync(outputPath);
    return { outputPath, sizeBytes: size };
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      currentProcess?.kill();
    },
  };
}

module.exports = { GIF_PRESETS, convertToGif };
