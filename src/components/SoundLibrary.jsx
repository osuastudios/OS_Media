import { useEffect, useState, useCallback, useRef } from 'react';
import {
  FolderIcon,
  SpinnerIcon,
  PlayIcon,
  PauseIcon,
  StarIcon,
  DownloadIcon,
  SearchIcon,
  CheckCircleIcon,
} from './icons';

const DURATIONS = [
  { key: 'any', label: 'Cualquiera' },
  { key: 'short', label: '< 2 s' },
  { key: 'medium', label: '2–10 s' },
  { key: 'long', label: '10–30 s' },
  { key: 'xlong', label: '> 30 s' },
];

const SORTS = [
  { key: 'popular', label: 'Más descargados' },
  { key: 'rating', label: 'Mejor valorados' },
  { key: 'relevance', label: 'Más relevantes' },
  { key: 'newest', label: 'Más recientes' },
  { key: 'shortest', label: 'Más cortos' },
];

function formatDuration(seconds) {
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s} s`;
}

// Lo que se guarda de cada favorito: suficiente para mostrarlo y descargarlo
// sin volver a consultar Freesound.
function toFavorite({ id, name, tags, username, duration, previewUrl, waveformUrl }) {
  return { id, name, tags, username, duration, previewUrl, waveformUrl };
}

const chipClass = (active) =>
  `rounded-full border px-3 py-1 text-xs transition-colors ${
    active
      ? 'border-transparent bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 text-white'
      : 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
  }`;

const smallButtonClass =
  'flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-40';

function KeySetup({ onSaved }) {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const result = await window.api.setFreesoundKey(key);
    setSaving(false);
    if (result.ok) onSaved();
    else setError(result.code === 'BAD_KEY' ? 'Esa clave no es válida. Revisa que la has copiado entera.' : result.error);
  };

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/20">
      <div>
        <h2 className="text-base font-semibold text-neutral-100">Activar la biblioteca de sonidos</h2>
        <p className="mt-1 text-sm text-neutral-400">
          La biblioteca usa Freesound, que necesita una clave gratuita. Solo hay que hacerlo una vez.
        </p>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-300">
        <li>Crea una cuenta gratis en freesound.org (o inicia sesión).</li>
        <li>
          Abre{' '}
          <button onClick={() => window.api.openFreesoundSignup()} className="text-brand-400 underline underline-offset-2">
            la página de claves de la API
          </button>
          , rellena el formulario (nombre: OS Media) y acepta.
        </li>
        <li>
          Copia el valor de <b>Client secret/Api key</b> y pégalo aquí:
        </li>
      </ol>
      <div className="flex gap-2">
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Pega aquí tu clave"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 font-mono text-sm"
        />
        <button
          onClick={handleSave}
          disabled={!key.trim() || saving}
          className="rounded-lg bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-30"
        >
          {saving ? 'Comprobando...' : 'Guardar'}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}

function SoundRow({ sound, downloaded, isFavorite, playing, progress, busy, onPlay, onSeek, onToggleFavorite, onDownload }) {
  const filePath = downloaded.wav || downloaded.mp3;

  return (
    <div
      draggable={Boolean(filePath)}
      onDragStart={(e) => {
        e.preventDefault();
        window.api.startSoundDrag(filePath);
      }}
      className={`group flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${
        playing ? 'border-brand-500/50 bg-brand-500/5' : 'border-white/5 bg-neutral-900/40 hover:border-white/10'
      } ${filePath ? 'cursor-grab active:cursor-grabbing' : ''}`}
      title={filePath ? 'Arrastra este sonido a tu programa de edición' : undefined}
    >
      <button
        onClick={onPlay}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-100 hover:bg-neutral-700"
        aria-label={playing ? 'Pausar' : 'Reproducir'}
      >
        {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm text-neutral-100">{sound.name}</p>
          {filePath && <CheckCircleIcon className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
        </div>
        <p className="truncate text-xs text-neutral-500">
          {formatDuration(sound.duration)} · {sound.tags?.join(', ')}
        </p>
      </div>

      <div
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek((e.clientX - rect.left) / rect.width);
        }}
        className="relative hidden h-10 w-56 shrink-0 cursor-pointer overflow-hidden rounded-md bg-black/30 md:block"
      >
        {sound.waveformUrl && (
          <img
            src={sound.waveformUrl}
            alt=""
            draggable={false}
            className="h-full w-full object-fill opacity-70"
          />
        )}
        {playing && (
          <div className="pointer-events-none absolute inset-y-0 left-0 bg-brand-500/30" style={{ width: `${progress * 100}%` }} />
        )}
      </div>

      <button
        onClick={onToggleFavorite}
        className={`shrink-0 rounded-md p-1.5 hover:bg-white/5 ${isFavorite ? 'text-amber-400' : 'text-neutral-500 hover:text-neutral-300'}`}
        aria-label={isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
      >
        <StarIcon className="h-4 w-4" filled={isFavorite} />
      </button>

      <div className="flex shrink-0 gap-1">
        {busy ? (
          <SpinnerIcon className="mx-6 h-4 w-4 text-brand-400" />
        ) : (
          <>
            <button onClick={() => onDownload('mp3')} className={smallButtonClass} title="Descargar en MP3">
              <DownloadIcon className="h-3.5 w-3.5" />
              MP3
            </button>
            <button onClick={() => onDownload('wav')} className={smallButtonClass} title="Descargar en WAV">
              WAV
            </button>
          </>
        )}
        {filePath && (
          <button onClick={() => window.api.showSoundFile(filePath)} className={smallButtonClass} title="Ver en la carpeta">
            <FolderIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function SoundLibrary({ active }) {
  const [info, setInfo] = useState(null);
  const [view, setView] = useState('search');
  const [queryInput, setQueryInput] = useState('');
  const [search, setSearch] = useState({ query: '', categoryKey: 'cars', duration: 'any', sort: 'popular' });
  const [results, setResults] = useState({ sounds: [], count: 0, hasMore: false, page: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [favorites, setFavorites] = useState([]);
  const [downloaded, setDownloaded] = useState({});
  const [busyIds, setBusyIds] = useState({});
  const [notice, setNotice] = useState(null);

  const [playingId, setPlayingId] = useState(null);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef(null);
  const requestRef = useRef(0);

  useEffect(() => {
    window.api.getSoundsInfo().then(setInfo);
    window.api.getSettings().then((s) => setFavorites(s.soundFavorites || []));
    window.api.getDownloadedSounds().then(setDownloaded);
  }, []);

  // Un único reproductor para toda la lista: al pulsar otro sonido se para el anterior.
  useEffect(() => {
    const audio = new Audio();
    audio.addEventListener('timeupdate', () => setProgress(audio.duration ? audio.currentTime / audio.duration : 0));
    audio.addEventListener('ended', () => {
      setPlayingId(null);
      setProgress(0);
    });
    audioRef.current = audio;
    return () => audio.pause();
  }, []);

  useEffect(() => {
    if (!active) {
      audioRef.current?.pause();
      setPlayingId(null);
    }
  }, [active]);

  const runSearch = useCallback(async (params, page = 1) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    const result = await window.api.searchSounds({ ...params, page });
    // Si mientras tanto se lanzó otra búsqueda, esta respuesta ya no vale.
    if (requestId !== requestRef.current) return;
    setLoading(false);
    if (!result.ok) {
      if (result.code === 'NO_KEY' || result.code === 'BAD_KEY') setInfo((prev) => ({ ...prev, hasKey: false }));
      setError(result);
      return;
    }
    setDownloaded((prev) => {
      const next = { ...prev };
      result.sounds.forEach((s) => {
        if (Object.keys(s.downloaded).length) next[s.id] = s.downloaded;
      });
      return next;
    });
    setResults((prev) => ({
      sounds: page === 1 ? result.sounds : [...prev.sounds, ...result.sounds.filter((s) => !prev.sounds.some((p) => p.id === s.id))],
      count: result.count,
      hasMore: result.hasMore,
      page,
    }));
  }, []);

  useEffect(() => {
    if (info?.hasKey) runSearch(search);
  }, [info?.hasKey, search, runSearch]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setView('search');
    setSearch((prev) => ({ ...prev, query: queryInput.trim(), categoryKey: queryInput.trim() ? null : prev.categoryKey || 'cars' }));
  };

  const handleCategory = (key) => {
    setView('search');
    setQueryInput('');
    setSearch((prev) => ({ ...prev, query: '', categoryKey: key }));
  };

  const handlePlay = useCallback(
    (sound) => {
      const audio = audioRef.current;
      if (playingId === sound.id) {
        audio.pause();
        setPlayingId(null);
        return;
      }
      audio.src = sound.previewUrl;
      audio.play().catch(() => setPlayingId(null));
      setPlayingId(sound.id);
      setProgress(0);
    },
    [playingId]
  );

  const handleSeek = useCallback(
    (sound, ratio) => {
      const audio = audioRef.current;
      if (playingId !== sound.id) {
        audio.src = sound.previewUrl;
        setPlayingId(sound.id);
      }
      const seekWhenReady = () => {
        audio.currentTime = ratio * (audio.duration || sound.duration);
        audio.play().catch(() => setPlayingId(null));
      };
      if (audio.readyState >= 1) seekWhenReady();
      else audio.addEventListener('loadedmetadata', seekWhenReady, { once: true });
    },
    [playingId]
  );

  const toggleFavorite = useCallback(
    (sound) => {
      const next = favorites.some((f) => f.id === sound.id)
        ? favorites.filter((f) => f.id !== sound.id)
        : [toFavorite(sound), ...favorites];
      setFavorites(next);
      window.api.setSettings({ soundFavorites: next });
    },
    [favorites]
  );

  const handleDownload = useCallback(async (sound, format) => {
    setBusyIds((prev) => ({ ...prev, [sound.id]: true }));
    const result = await window.api.downloadSound({ sound: toFavorite(sound), format });
    setBusyIds((prev) => ({ ...prev, [sound.id]: false }));
    if (result.ok) {
      setDownloaded((prev) => ({ ...prev, [sound.id]: result.downloaded }));
      setNotice({ ok: true, text: `Guardado: ${result.filePath.split(/[\\/]/).pop()} — ya puedes arrastrarlo a tu editor.` });
    } else {
      setNotice({ ok: false, text: result.error });
    }
  }, []);

  if (!info) return null;
  if (!info.hasKey) return <KeySetup onSaved={() => setInfo((prev) => ({ ...prev, hasKey: true }))} />;

  const list = view === 'favorites' ? favorites : results.sounds;
  const favoriteIds = new Set(favorites.map((f) => f.id));

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-2xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/20">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Busca en español o inglés: disparo, drift, whoosh, gritos..."
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 py-2.5 pl-9 pr-3 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Buscar
          </button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {info.categories.map((c) => (
            <button
              key={c.key}
              onClick={() => handleCategory(c.key)}
              className={chipClass(view === 'search' && !search.query && search.categoryKey === c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
          <div className="flex overflow-hidden rounded-lg border border-neutral-700 text-xs">
            {DURATIONS.map((d) => (
              <button
                key={d.key}
                onClick={() => setSearch((prev) => ({ ...prev, duration: d.key }))}
                className={`px-2.5 py-1.5 ${
                  search.duration === d.key ? 'bg-brand-500/80 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <select
            value={search.sort}
            onChange={(e) => setSearch((prev) => ({ ...prev, sort: e.target.value }))}
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>

          <div className="ml-auto flex gap-2">
            <button
              onClick={() => setView(view === 'favorites' ? 'search' : 'favorites')}
              className={`${smallButtonClass} py-1.5 ${view === 'favorites' ? 'border-amber-400/50 text-amber-300' : ''}`}
            >
              <StarIcon className="h-3.5 w-3.5" filled={view === 'favorites'} />
              Favoritos ({favorites.length})
            </button>
            <button onClick={() => window.api.openSoundsFolder()} className={`${smallButtonClass} py-1.5`}>
              <FolderIcon className="h-3.5 w-3.5" />
              Carpeta de sonidos
            </button>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-neutral-500">
          {view === 'favorites'
            ? `${favorites.length} favoritos`
            : loading && results.page === 1
              ? 'Buscando...'
              : `${results.count.toLocaleString('es-ES')} sonidos`}
        </span>
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-emerald-300">
          Solo CC0 · sin copyright, uso comercial libre, no hace falta dar crédito
        </span>
      </div>

      {notice && (
        <p className={`text-xs ${notice.ok ? 'text-emerald-400' : 'text-red-400'}`} onClick={() => setNotice(null)}>
          {notice.text}
        </p>
      )}

      {error && view === 'search' && (
        <div className="space-y-1 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
          <p className="text-sm text-red-400">{error.error}</p>
          <button onClick={() => runSearch(search)} className="text-xs text-neutral-400 underline underline-offset-2">
            Reintentar
          </button>
        </div>
      )}

      <div className="space-y-1.5">
        {list.map((sound) => (
          <SoundRow
            key={sound.id}
            sound={sound}
            downloaded={downloaded[sound.id] || {}}
            isFavorite={favoriteIds.has(sound.id)}
            playing={playingId === sound.id}
            progress={progress}
            busy={busyIds[sound.id]}
            onPlay={() => handlePlay(sound)}
            onSeek={(ratio) => handleSeek(sound, ratio)}
            onToggleFavorite={() => toggleFavorite(sound)}
            onDownload={(format) => handleDownload(sound, format)}
          />
        ))}
      </div>

      {view === 'search' && !loading && !error && results.sounds.length === 0 && (
        <p className="py-8 text-center text-sm text-neutral-500">
          No hay resultados. Prueba con otra palabra (en inglés suele haber más) o quita el filtro de duración.
        </p>
      )}
      {view === 'favorites' && favorites.length === 0 && (
        <p className="py-8 text-center text-sm text-neutral-500">Pulsa la estrella de un sonido para guardarlo aquí.</p>
      )}

      {view === 'search' && results.hasMore && (
        <div className="flex justify-center pb-2">
          <button onClick={() => runSearch(search, results.page + 1)} disabled={loading} className={`${smallButtonClass} px-4 py-2`}>
            {loading ? <SpinnerIcon className="h-3.5 w-3.5" /> : null}
            Cargar más
          </button>
        </div>
      )}
    </div>
  );
}
