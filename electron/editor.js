const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Readable } = require('stream');
const { getFfmpegPath, getFfprobePath } = require('./binaries');
const { runFfmpeg } = require('./gif');

// Esquema propio para que el <video> del renderer pueda leer archivos locales.
// El renderer nunca recibe rutas arbitrarias servibles: solo se sirven los
// archivos registrados explícitamente (elegidos o arrastrados por el usuario),
// identificados por un token aleatorio.
const VIDEO_SCHEME = 'osmedia';

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

const registeredVideos = new Map();
const previewFiles = new Set();

function registerVideo(filePath) {
  const token = crypto.randomBytes(12).toString('hex');
  registeredVideos.set(token, filePath);
  return `${VIDEO_SCHEME}://video/${token}`;
}

// Responde con soporte de Range (206), imprescindible para poder saltar a
// cualquier punto del vídeo sin descargarlo entero.
async function handleVideoRequest(request) {
  const token = new URL(request.url).pathname.replace(/^\//, '');
  const filePath = registeredVideos.get(token);
  if (!filePath) return new Response('Not found', { status: 404 });

  let size;
  try {
    ({ size } = await fs.promises.stat(filePath));
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const headers = {
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
  };

  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  if (!range) {
    const stream = Readable.toWeb(fs.createReadStream(filePath));
    return new Response(stream, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
  }

  let start = range[1] ? Number(range[1]) : 0;
  let end = range[2] ? Number(range[2]) : size - 1;
  if (!range[1] && range[2]) {
    start = Math.max(0, size - Number(range[2]));
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
  return new Response(stream, {
    status: 206,
    headers: {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    },
  });
}

function probeVideo(inputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      getFfprobePath(),
      ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', inputPath],
      { windowsHide: true }
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('close', (code) => {
      try {
        const data = JSON.parse(out);
        const duration = parseFloat(data.format?.duration);
        const streams = data.streams || [];
        if (code !== 0 || Number.isNaN(duration)) throw new Error();
        resolve({
          duration,
          hasVideo: streams.some((s) => s.codec_type === 'video'),
          hasAudio: streams.some((s) => s.codec_type === 'audio'),
        });
      } catch {
        reject(new Error(err || 'No se pudo leer la información del vídeo'));
      }
    });
    proc.on('error', reject);
  });
}

function grabFrame(inputPath, seconds, height) {
  return new Promise((resolve) => {
    const proc = spawn(
      getFfmpegPath(),
      [
        '-ss', seconds.toFixed(3),
        '-i', inputPath,
        '-frames:v', '1',
        '-vf', `scale=-2:${height}`,
        '-f', 'image2pipe',
        '-c:v', 'mjpeg',
        '-q:v', '5',
        'pipe:1',
      ],
      { windowsHide: true }
    );
    const chunks = [];
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.on('close', (code) => {
      const buffer = Buffer.concat(chunks);
      resolve(code === 0 && buffer.length > 0 ? `data:image/jpeg;base64,${buffer.toString('base64')}` : null);
    });
    proc.on('error', () => resolve(null));
  });
}

// Miniaturas para la tira de la línea de tiempo. Se lanzan de pocas en pocas
// para no saturar el equipo con decenas de ffmpeg a la vez.
async function getThumbnails(inputPath, { duration, count = 12, height = 56 }) {
  const times = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * duration);
  const results = new Array(count).fill(null);
  const concurrency = 4;
  let next = 0;
  async function worker() {
    while (next < count) {
      const index = next++;
      results[index] = await grabFrame(inputPath, times[index], height);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// Versión ligera en H.264 para previsualizar vídeos cuyo códec no puede
// reproducir el navegador interno (p. ej. HEVC de móviles o AVI antiguos).
// Solo se usa para ver; la exportación siempre parte del archivo original.
function createPreview({ inputPath, duration, onProgress }) {
  let currentProcess = null;
  let cancelled = false;
  const outputPath = path.join(os.tmpdir(), `os-media-preview-${Date.now()}.mp4`);
  previewFiles.add(outputPath);

  const promise = runFfmpeg(
    [
      '-y',
      '-i', inputPath,
      '-vf', 'scale=-2:trunc(min(720\\,ih)/2)*2',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      '-g', '15',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-progress', 'pipe:1',
      outputPath,
    ],
    {
      durationSeconds: duration,
      onProgress,
      registerProcess: (proc) => {
        currentProcess = proc;
        if (cancelled) proc.kill();
      },
    }
  ).then(() => ({ outputPath }));

  return {
    promise,
    cancel: () => {
      cancelled = true;
      currentProcess?.kill();
    },
  };
}

function cleanupPreviews() {
  for (const file of previewFiles) fs.rmSync(file, { force: true });
  previewFiles.clear();
}

// Cada tramo conservado entra como una entrada separada con -ss/-t (búsqueda
// rápida y precisa al recodificar) y luego se unen con el filtro concat.
function exportVideo({ inputPath, outputPath, segments, hasAudio, removeAudio, onProgress }) {
  let currentProcess = null;
  let cancelled = false;

  const includeAudio = hasAudio && !removeAudio;
  const inputArgs = [];
  const concatInputs = [];
  segments.forEach((segment, i) => {
    inputArgs.push('-ss', segment.start.toFixed(3), '-t', (segment.end - segment.start).toFixed(3), '-i', inputPath);
    concatInputs.push(includeAudio ? `[${i}:v:0][${i}:a:0]` : `[${i}:v:0]`);
  });

  const filter =
    `${concatInputs.join('')}concat=n=${segments.length}:v=1:a=${includeAudio ? 1 : 0}` +
    (includeAudio ? '[cv][outa];' : '[cv];') +
    '[cv]scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[outv]';

  const totalDuration = segments.reduce((sum, s) => sum + (s.end - s.start), 0);

  const args = [
    '-y',
    ...inputArgs,
    '-filter_complex', filter,
    '-map', '[outv]',
    ...(includeAudio ? ['-map', '[outa]', '-c:a', 'aac', '-b:a', '192k'] : []),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    outputPath,
  ];

  const promise = runFfmpeg(args, {
    durationSeconds: totalDuration,
    onProgress,
    registerProcess: (proc) => {
      currentProcess = proc;
      if (cancelled) proc.kill();
    },
  })
    .then(() => ({ outputPath, sizeBytes: fs.statSync(outputPath).size }))
    .catch((err) => {
      fs.rmSync(outputPath, { force: true });
      throw err;
    });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      currentProcess?.kill();
    },
  };
}

module.exports = {
  VIDEO_SCHEME,
  registerVideo,
  handleVideoRequest,
  probeVideo,
  getThumbnails,
  createPreview,
  cleanupPreviews,
  exportVideo,
};
