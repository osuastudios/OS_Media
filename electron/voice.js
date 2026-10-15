const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { getFfmpegPath } = require('./binaries');
const { runFfmpeg } = require('./gif');

// Todo el audio se pasa a este formato al entrar en la cadena, para que los
// filtros que generan sonido propio (el ruido de la radio) encajen sin más.
const SAMPLE_RATE = 48000;

// Cada efecto recibe la intensidad como t (0 = suave, 1 = a tope) y devuelve
// una cadena de filtros de ffmpeg. La lista va en el orden en que se aplican
// al combinar varios: primero lo que cambia la voz, después el "aparato" por
// el que suena, la distorsión, el ambiente y, al final, darle la vuelta.
// Los de un mismo `exclusive` no se pueden activar a la vez (subir y bajar el
// tono a la vez se anularía).
const VOICE_EFFECTS = [
  {
    key: 'ardilla',
    label: 'Ardilla',
    emoji: '🐿️',
    group: 'Voz',
    hint: 'Voz aguda, sin cambiar la velocidad',
    exclusive: 'pitch',
    build: (t, ctx) => pitchShift(3 + t * 9, ctx),
  },
  {
    key: 'monstruo',
    label: 'Monstruo',
    emoji: '👹',
    group: 'Voz',
    hint: 'Voz grave y oscura',
    exclusive: 'pitch',
    build: (t, ctx) => `${pitchShift(-(3 + t * 9), ctx)},equalizer=f=140:t=q:w=1:g=${(2 + t * 4).toFixed(1)}`,
  },
  {
    key: 'robot',
    label: 'Robot',
    emoji: '🤖',
    group: 'Voz',
    hint: 'Voz metálica, tipo vocoder',
    // Se mezcla con la voz original: con poca intensidad se entiende mejor.
    graph: (inLabel, outLabel, t, id) => {
      const wet = 0.4 + t * 0.6;
      return (
        `[${inLabel}]asplit=2[${id}d][${id}w];` +
        `[${id}w]afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75,volume=14dB[${id}r];` +
        `[${id}d][${id}r]amix=inputs=2:weights='${(1 - wet).toFixed(2)} ${wet.toFixed(2)}':normalize=0[${outLabel}]`
      );
    },
  },
  {
    key: 'altavoz',
    label: 'Altavoz',
    emoji: '📢',
    group: 'Dónde suena',
    hint: 'Megáfono o altavoz de estación',
    build: (t) =>
      `highpass=f=${Math.round(500 + t * 300)},lowpass=f=${Math.round(4500 - t * 1500)},` +
      `equalizer=f=2000:t=q:w=1:g=6,volume=${(6 + t * 12).toFixed(1)}dB,asoftclip=type=tanh`,
  },
  {
    key: 'telefono',
    label: 'Teléfono',
    emoji: '📞',
    group: 'Dónde suena',
    hint: 'Como una llamada de móvil',
    build: (t) => {
      const low = Math.round(300 + t * 300);
      const high = Math.round(3400 - t * 800);
      return `highpass=f=${low},highpass=f=${low},lowpass=f=${high},lowpass=f=${high},volume=${(3 + t * 6).toFixed(1)}dB,asoftclip=type=tanh`;
    },
  },
  {
    key: 'radio',
    label: 'Walkie / radio',
    emoji: '📻',
    group: 'Dónde suena',
    hint: 'Radio de policía, con ruido de fondo',
    graph: (inLabel, outLabel, t, id) => {
      const noise = (0.008 + t * 0.03).toFixed(3);
      return (
        `[${inLabel}]highpass=f=600,highpass=f=600,lowpass=f=2600,lowpass=f=2600,` +
        `volume=${(10 + t * 14).toFixed(1)}dB,asoftclip=type=tanh,volume=-4dB[${id}v];` +
        `anoisesrc=color=pink:amplitude=${noise}:sample_rate=${SAMPLE_RATE},` +
        `aformat=sample_fmts=fltp:channel_layouts=stereo,highpass=f=500,lowpass=f=3000[${id}n];` +
        `[${id}v][${id}n]amix=inputs=2:duration=first:normalize=0[${outLabel}]`
      );
    },
  },
  {
    key: 'agua',
    label: 'Bajo el agua',
    emoji: '🌊',
    group: 'Dónde suena',
    hint: 'Sonido apagado y ondulante',
    build: (t) => {
      const cut = Math.round(1000 - t * 600);
      return `lowpass=f=${cut},lowpass=f=${cut},vibrato=f=${(3 + t * 3).toFixed(1)}:d=${(0.2 + t * 0.4).toFixed(2)},aecho=0.8:0.7:30:0.3,volume=4dB`;
    },
  },
  {
    key: 'distorsion',
    label: 'Distorsión',
    emoji: '🔥',
    group: 'Destroza',
    hint: 'Saturado, como un micro reventado',
    build: (t) =>
      `highpass=f=80,volume=${(10 + t * 25).toFixed(1)}dB,asoftclip=type=tanh,` +
      `volume=${(-(4 + t * 10)).toFixed(1)}dB,lowpass=f=${Math.round(8000 - t * 3000)}`,
  },
  {
    key: 'retro',
    label: '8-bit',
    emoji: '👾',
    group: 'Destroza',
    hint: 'Como una consola antigua',
    build: (t) =>
      `acrusher=bits=${(6 - t * 3).toFixed(1)}:mode=lin:samples=${4 + Math.round(t * 10)}:aa=0`,
  },
  {
    key: 'eco',
    label: 'Eco',
    emoji: '🏔️',
    group: 'Ambiente',
    hint: 'Repeticiones, como gritar en la montaña',
    tail: (t) => ((150 + t * 350) * 3) / 1000 + 0.5,
    build: (t) => {
      const delay = Math.round(150 + t * 350);
      const decay = 0.35 + t * 0.25;
      return `aecho=0.8:0.9:${delay}|${delay * 2}|${delay * 3}:${decay.toFixed(2)}|${(decay ** 2).toFixed(2)}|${(decay ** 3).toFixed(2)}`;
    },
  },
  {
    key: 'catedral',
    label: 'Catedral',
    emoji: '⛪',
    group: 'Ambiente',
    hint: 'Reverberación de sala enorme',
    tail: (t) => (487 * (0.6 + t * 0.8)) / 1000 + 1,
    build: (t) => {
      const taps = [37, 61, 89, 113, 151, 199, 251, 313, 397, 487];
      const size = 0.6 + t * 0.8;
      const strength = 0.35 + t * 0.25;
      const delays = taps.map((ms) => Math.round(ms * size)).join('|');
      const decays = taps.map((_, i) => (strength * 0.85 ** i).toFixed(3)).join('|');
      return `aecho=0.8:0.6:${delays}:${decays}`;
    },
  },
  {
    key: 'reves',
    label: 'Al revés',
    emoji: '⏪',
    group: 'Extra',
    hint: 'Reproduce el audio de atrás hacia delante',
    noIntensity: true,
    build: () => 'areverse',
  },
];

const EFFECTS_BY_KEY = Object.fromEntries(VOICE_EFFECTS.map((e) => [e.key, e]));

// rubberband cambia el tono con mucha más calidad, pero no todas las builds
// de ffmpeg lo traen (la de macOS puede no tenerlo). Sin él se usa el truco
// clásico: cambiar la frecuencia de muestreo y compensar la velocidad.
let rubberbandPromise = null;
function hasRubberband() {
  if (!rubberbandPromise) {
    rubberbandPromise = new Promise((resolve) => {
      const proc = spawn(getFfmpegPath(), ['-hide_banner', '-filters'], { windowsHide: true });
      let out = '';
      proc.stdout.on('data', (d) => (out += d.toString()));
      proc.on('close', () => resolve(/\srubberband\s/.test(out)));
      proc.on('error', () => resolve(false));
    });
  }
  return rubberbandPromise;
}

function pitchShift(semitones, { rubberband }) {
  const ratio = 2 ** (semitones / 12);
  if (rubberband) return `rubberband=pitch=${ratio.toFixed(4)}`;
  return `asetrate=${Math.round(SAMPLE_RATE * ratio)},aresample=${SAMPLE_RATE},atempo=${(1 / ratio).toFixed(4)}`;
}

// effects: [{ key, intensity (0-100) }]. volume: 1 = original, 2 = doble.
// Devuelve un filter_complex que parte de [0:a:0] y termina en [out].
function buildFilterGraph({ effects, volume = 1, padTail, rubberband }) {
  const ctx = { rubberband };
  const parts = [`[0:a:0]aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo[s0]`];
  let label = 's0';
  let tail = 0;

  const ordered = VOICE_EFFECTS.filter((def) => effects.some((e) => e.key === def.key));
  ordered.forEach((def, i) => {
    const intensity = effects.find((e) => e.key === def.key).intensity;
    const t = Math.min(100, Math.max(0, Number(intensity) || 0)) / 100;
    const next = `s${i + 1}`;
    if (def.graph) parts.push(def.graph(label, next, t, `e${i}`));
    else parts.push(`[${label}]${def.build(t, ctx)}[${next}]`);
    if (def.tail) tail = Math.max(tail, def.tail(t));
    label = next;
  });

  const pad = padTail && tail > 0 ? `apad=pad_dur=${tail.toFixed(2)},` : '';
  // El limitador evita que la distorsión o el volumen alto saturen el archivo.
  // latency=1 compensa su retardo para no desincronizar el audio del vídeo.
  parts.push(
    `[${label}]${pad}volume=${Number(volume).toFixed(2)},alimiter=limit=0.95:level=0:latency=1[out]`
  );
  return parts.join(';');
}

const tempFiles = new Set();

function tempPath(ext) {
  const file = path.join(os.tmpdir(), `os-media-voz-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`);
  tempFiles.add(file);
  return file;
}

function removeTempFile(file) {
  if (!tempFiles.has(file)) return;
  try {
    fs.rmSync(file, { force: true });
    tempFiles.delete(file);
  } catch {
    // Puede seguir abierto por el reproductor; se borra al cerrar la app.
  }
}

function cleanupVoiceTemp() {
  for (const file of tempFiles) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // Si no se puede borrar ahora, el sistema limpiará la carpeta temporal.
    }
  }
  tempFiles.clear();
}

// MediaRecorder entrega WebM sin duración en la cabecera, y ffprobe no la
// sabría leer; se pasa a WAV para que el resto del flujo funcione igual que
// con un archivo subido.
async function saveRecording(bytes) {
  const webmPath = tempPath('webm');
  const wavPath = tempPath('wav');
  fs.writeFileSync(webmPath, Buffer.from(bytes));
  try {
    await runFfmpeg(['-y', '-i', webmPath, '-c:a', 'pcm_s16le', wavPath]);
  } finally {
    removeTempFile(webmPath);
  }
  return wavPath;
}

const VIDEO_AUDIO_CODECS = {
  '.mp4': 'aac',
  '.m4v': 'aac',
  '.mov': 'aac',
  '.mkv': 'aac',
  '.webm': 'libopus',
  '.avi': 'libmp3lame',
};

// format: 'mp3' | 'wav' | 'video' (copia la imagen tal cual y solo cambia el audio).
function renderVoice({ inputPath, outputPath, effects, volume, format, duration, onProgress }) {
  let currentProcess = null;
  let cancelled = false;

  const promise = (async () => {
    const rubberband = await hasRubberband();
    const keepVideo = format === 'video';
    const graph = buildFilterGraph({ effects, volume, padTail: !keepVideo, rubberband });

    let outputArgs;
    if (keepVideo) {
      const ext = path.extname(outputPath).toLowerCase();
      outputArgs = [
        '-map', '0:v:0',
        '-map', '[out]',
        '-c:v', 'copy',
        '-c:a', VIDEO_AUDIO_CODECS[ext] || 'aac',
        '-b:a', '192k',
        ...(['.mp4', '.m4v', '.mov'].includes(ext) ? ['-movflags', '+faststart'] : []),
        // El eco y la reverb alargan el audio; con vídeo no debe pasar del final de la imagen.
        '-shortest',
      ];
    } else if (format === 'wav') {
      outputArgs = ['-map', '[out]', '-vn', '-c:a', 'pcm_s16le'];
    } else {
      outputArgs = ['-map', '[out]', '-vn', '-c:a', 'libmp3lame', '-q:a', '2'];
    }

    await runFfmpeg(
      ['-y', '-i', inputPath, '-filter_complex', graph, ...outputArgs, '-progress', 'pipe:1', outputPath],
      {
        durationSeconds: duration,
        onProgress,
        registerProcess: (proc) => {
          currentProcess = proc;
          if (cancelled) proc.kill();
        },
      }
    );
    return { outputPath, sizeBytes: fs.statSync(outputPath).size };
  })().catch((err) => {
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

// Vista previa: se renderiza con exactamente la misma cadena que la
// exportación, así lo que se oye es lo que se guarda.
function renderVoicePreview({ inputPath, effects, volume, duration, onProgress }) {
  const outputPath = tempPath('mp3');
  const job = renderVoice({ inputPath, outputPath, effects, volume, format: 'mp3', duration, onProgress });
  job.promise.catch(() => removeTempFile(outputPath));
  return job;
}

module.exports = {
  VOICE_EFFECTS: VOICE_EFFECTS.map(({ key, label, emoji, group, hint, exclusive, noIntensity }) => ({
    key,
    label,
    emoji,
    group,
    hint,
    exclusive: exclusive || null,
    noIntensity: Boolean(noIntensity),
  })),
  EFFECTS_BY_KEY,
  buildFilterGraph,
  hasRubberband,
  saveRecording,
  renderVoice,
  renderVoicePreview,
  removeTempFile,
  cleanupVoiceTemp,
};
