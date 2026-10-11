const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { spawn } = require('child_process');
const { requestFollow, downloadToFile } = require('./net');
const { getFfmpegPath } = require('./binaries');
const { readSettings } = require('./settings');

// Biblioteca de efectos de sonido basada en la API de Freesound, filtrando
// SIEMPRE por licencia CC0 (dominio público): se pueden usar en vídeos
// monetizados sin pedir permiso ni dar crédito.
const API_BASE = 'https://freesound.org/apiv2';
const CC0_FILTER = 'license:"Creative Commons 0"';
const PAGE_SIZE = 30;
const FIELDS = 'id,name,tags,username,duration,previews,images,avg_rating,num_downloads';

// La clave de la API no puede ir en el código (el repo es público). Se toma
// de los ajustes del usuario o, si no, de un archivo local ignorado por git
// que se empaqueta dentro del instalador para que el equipo no tenga que
// configurar nada.
const BUNDLED_KEY_PATH = path.join(__dirname, 'freesound.local.json');

function getApiKey() {
  const fromSettings = readSettings().freesoundKey;
  if (fromSettings) return fromSettings.trim();
  try {
    return JSON.parse(fs.readFileSync(BUNDLED_KEY_PATH, 'utf8')).apiKey?.trim() || null;
  } catch {
    return null;
  }
}

// Categorías predefinidas: etiqueta en español, búsqueda en inglés (casi
// todos los sonidos de Freesound están etiquetados en inglés).
const SOUND_CATEGORIES = [
  { key: 'cars', label: 'Coches', query: 'car engine' },
  { key: 'drift', label: 'Drift / derrape', query: 'skid' },
  { key: 'carpass', label: 'Coche pasando', query: 'car passing' },
  { key: 'horn', label: 'Cláxones', query: 'car horn' },
  { key: 'motorbike', label: 'Motos', query: 'motorcycle' },
  { key: 'guns', label: 'Disparos', query: 'gunshot' },
  { key: 'reload', label: 'Recarga de armas', query: 'gun reload' },
  { key: 'explosions', label: 'Explosiones', query: 'explosion' },
  { key: 'camera', label: 'Cámara / obturador', query: 'camera shutter' },
  { key: 'talk', label: 'Gente hablando', query: 'people talking' },
  { key: 'scream', label: 'Gritos', query: 'scream' },
  { key: 'crowd', label: 'Multitud', query: 'crowd' },
  { key: 'laugh', label: 'Risas', query: 'laugh' },
  { key: 'applause', label: 'Aplausos', query: 'applause' },
  { key: 'whoosh', label: 'Whoosh / transiciones', query: 'whoosh' },
  { key: 'riser', label: 'Risers', query: 'riser' },
  { key: 'impact', label: 'Impactos / golpes', query: 'impact' },
  { key: 'punch', label: 'Puñetazos', query: 'punch' },
  { key: 'glass', label: 'Cristales rotos', query: 'glass break' },
  { key: 'footsteps', label: 'Pasos', query: 'footsteps' },
  { key: 'door', label: 'Puertas', query: 'door' },
  { key: 'ui', label: 'Notificaciones / UI', query: 'notification' },
  { key: 'click', label: 'Clicks / botones', query: 'click button' },
  { key: 'glitch', label: 'Glitch', query: 'glitch' },
  { key: 'siren', label: 'Sirenas', query: 'siren' },
  { key: 'phone', label: 'Teléfono', query: 'phone ring' },
  { key: 'rain', label: 'Lluvia / tormenta', query: 'rain thunder' },
  { key: 'wind', label: 'Viento', query: 'wind' },
  { key: 'city', label: 'Ambiente ciudad', query: 'city ambience' },
  { key: 'animals', label: 'Animales', query: 'dog bark' },
  { key: 'cash', label: 'Dinero / monedas', query: 'coins' },
  { key: 'funny', label: 'Cómicos', query: 'cartoon' },
];

// Traducción mínima de palabras habituales para que se pueda buscar en
// español. Las palabras que no están aquí se buscan tal cual.
const ES_TO_EN = {
  coche: 'car', coches: 'car', carro: 'car', motor: 'engine', derrape: 'skid', drift: 'drift',
  rueda: 'tire', ruedas: 'tire', frenazo: 'brake screech', freno: 'brake', claxon: 'horn', bocina: 'horn',
  moto: 'motorcycle', motos: 'motorcycle', camion: 'truck', camión: 'truck', avion: 'airplane', avión: 'airplane',
  helicoptero: 'helicopter', helicóptero: 'helicopter', tren: 'train', disparo: 'gunshot', disparos: 'gunshot',
  pistola: 'pistol', arma: 'gun', armas: 'gun', rifle: 'rifle', escopeta: 'shotgun', metralleta: 'machine gun',
  recarga: 'reload', bala: 'bullet', balas: 'bullet', explosion: 'explosion', explosión: 'explosion',
  bomba: 'bomb', camara: 'camera', cámara: 'camera', foto: 'camera shutter', obturador: 'shutter',
  gente: 'people', personas: 'people', hablando: 'talking', hablar: 'talking', voz: 'voice', voces: 'voices',
  grito: 'scream', gritos: 'scream', gritando: 'screaming', chillido: 'shriek', risa: 'laugh', risas: 'laugh',
  aplausos: 'applause', multitud: 'crowd', publico: 'crowd', público: 'crowd', llanto: 'crying', llorar: 'crying',
  golpe: 'hit', golpes: 'hit', impacto: 'impact', puñetazo: 'punch', patada: 'kick', cristal: 'glass',
  vidrio: 'glass', roto: 'break', romper: 'break', pasos: 'footsteps', puerta: 'door', ventana: 'window',
  notificacion: 'notification', notificación: 'notification', boton: 'button', botón: 'button', clic: 'click',
  sirena: 'siren', policia: 'police', policía: 'police', ambulancia: 'ambulance', telefono: 'phone',
  teléfono: 'phone', movil: 'phone', móvil: 'phone', lluvia: 'rain', trueno: 'thunder', tormenta: 'storm',
  viento: 'wind', agua: 'water', fuego: 'fire', ciudad: 'city', trafico: 'traffic', tráfico: 'traffic',
  perro: 'dog', gato: 'cat', pajaro: 'bird', pájaro: 'bird', pajaros: 'birds', pájaros: 'birds',
  dinero: 'money', monedas: 'coins', caja: 'cash register', campana: 'bell', reloj: 'clock', tic: 'tick',
  alarma: 'alarm', silbato: 'whistle', espada: 'sword', magia: 'magic', fantasma: 'ghost', terror: 'horror',
  miedo: 'horror', tension: 'tension', tensión: 'tension', transicion: 'transition', transición: 'transition',
  zumbido: 'buzz', estatica: 'static', estática: 'static', teclado: 'keyboard', raton: 'mouse click',
  ratón: 'mouse click', beso: 'kiss', corazon: 'heartbeat', corazón: 'heartbeat', latido: 'heartbeat',
  comer: 'eating', beber: 'drinking', tos: 'cough', estornudo: 'sneeze', respiracion: 'breathing',
  respiración: 'breathing', cocina: 'kitchen', fiesta: 'party', estadio: 'stadium', gol: 'goal crowd',
};

const DURATION_FILTERS = {
  any: null,
  short: 'duration:[0 TO 2]',
  medium: 'duration:[2 TO 10]',
  long: 'duration:[10 TO 30]',
  xlong: 'duration:[30 TO *]',
};

const SORTS = {
  popular: 'downloads_desc',
  rating: 'rating_desc',
  relevance: 'score',
  newest: 'created_desc',
  shortest: 'duration_asc',
};

function translateQuery(text) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ES_TO_EN[word.toLowerCase()] || word)
    .join(' ');
}

function getSoundsDir() {
  const destDir = readSettings().destDir || path.join(app.getPath('desktop'), 'OS Media');
  return path.join(destDir, 'Sonidos');
}

function sanitizeFileName(name) {
  return (
    name
      .replace(/\.(wav|mp3|aiff?|flac|ogg|m4a)$/i, '')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'sonido'
  );
}

// Los archivos se guardan como "<nombre>_<id>.<ext>": el id permite saber
// qué sonidos de la lista ya están descargados.
function findDownloaded(id) {
  const dir = getSoundsDir();
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return {};
  }
  const result = {};
  for (const file of files) {
    const match = file.match(/_(\d+)\.(mp3|wav)$/);
    if (match && (id === undefined || Number(match[1]) === id)) {
      result[match[1]] = { ...result[match[1]], [match[2]]: path.join(dir, file) };
    }
  }
  return result;
}

function toSound(raw) {
  return {
    id: raw.id,
    name: raw.name,
    tags: (raw.tags || []).slice(0, 6),
    username: raw.username,
    duration: raw.duration,
    rating: raw.avg_rating,
    downloads: raw.num_downloads,
    previewUrl: raw.previews?.['preview-hq-mp3'],
    waveformUrl: raw.images?.waveform_m,
  };
}

async function searchSounds({ query, categoryKey, duration = 'any', sort = 'popular', page = 1 }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('Falta la clave de Freesound');
    err.code = 'NO_KEY';
    throw err;
  }

  const category = SOUND_CATEGORIES.find((c) => c.key === categoryKey);
  const searchText = category && !query ? category.query : translateQuery(query || '');
  const filters = [CC0_FILTER, DURATION_FILTERS[duration]].filter(Boolean).join(' ');

  const params = new URLSearchParams({
    query: searchText,
    filter: filters,
    sort: SORTS[sort] || SORTS.popular,
    fields: FIELDS,
    page: String(page),
    page_size: String(PAGE_SIZE),
  });

  const res = await requestFollow(`${API_BASE}/search/?${params}`, {
    headers: { Authorization: `Token ${apiKey}` },
  });
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');

  if (res.statusCode === 401 || res.statusCode === 403) {
    const err = new Error('La clave de Freesound no es válida');
    err.code = 'BAD_KEY';
    throw err;
  }
  if (res.statusCode === 429) {
    const err = new Error('Se ha alcanzado el límite de búsquedas de Freesound. Espera un poco y vuelve a intentarlo.');
    err.code = 'RATE_LIMIT';
    throw err;
  }
  // Freesound responde 404 cuando se pide una página más allá del final.
  if (res.statusCode === 404 && page > 1) return { count: 0, sounds: [], hasMore: false, searchText };
  if (res.statusCode !== 200) throw new Error(`Freesound respondió HTTP ${res.statusCode}: ${body.slice(0, 300)}`);

  const data = JSON.parse(body);
  const downloaded = findDownloaded();
  return {
    count: data.count,
    hasMore: Boolean(data.next),
    searchText,
    sounds: data.results.map((raw) => ({ ...toSound(raw), downloaded: downloaded[raw.id] || {} })),
  };
}

function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfmpegPath(), ['-y', '-i', inputPath, '-c:a', 'pcm_s16le', '-ar', '48000', outputPath], {
      windowsHide: true,
    });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg terminó con código ${code}`))));
    proc.on('error', reject);
  });
}

// La API solo permite descargar el archivo original con login OAuth de cada
// usuario; la vista previa en MP3 de alta calidad (~128 kbps) es pública y
// sobra para efectos de sonido en vídeo. El WAV se genera a partir de ella
// para los programas de edición que lo prefieren.
async function downloadSound({ sound, format = 'mp3' }) {
  const dir = getSoundsDir();
  const base = `${sanitizeFileName(sound.name)}_${sound.id}`;
  const mp3Path = path.join(dir, `${base}.mp3`);

  if (!fs.existsSync(mp3Path)) await downloadToFile(sound.previewUrl, mp3Path);
  if (format === 'mp3') return { filePath: mp3Path };

  const wavPath = path.join(dir, `${base}.wav`);
  if (!fs.existsSync(wavPath)) await convertToWav(mp3Path, wavPath);
  return { filePath: wavPath };
}

function isInsideSoundsDir(filePath) {
  const relative = path.relative(getSoundsDir(), path.resolve(filePath));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

module.exports = {
  SOUND_CATEGORIES,
  getApiKey,
  getSoundsDir,
  searchSounds,
  downloadSound,
  findDownloaded,
  isInsideSoundsDir,
};
