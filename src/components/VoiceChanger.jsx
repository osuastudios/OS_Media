import { useEffect, useState, useCallback, useRef } from 'react';
import {
  FolderIcon,
  UploadIcon,
  CheckCircleIcon,
  XCircleIcon,
  SpinnerIcon,
  PlayIcon,
  PauseIcon,
  MicIcon,
  XIcon,
} from './icons';

const DEFAULT_INTENSITY = 50;
const PREVIEW_DEBOUNCE_MS = 350;

const gradientButtonClass =
  'rounded-lg bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-600/20 transition-opacity hover:opacity-90 disabled:opacity-30 disabled:hover:opacity-30';
const smallButtonClass =
  'flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700';
const cardClass = 'rounded-2xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/20';

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function timestampName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function dirOf(filePath) {
  return filePath.split(/[\\/]/).slice(0, -1).join('/');
}

export default function VoiceChanger({ active }) {
  const [effectsMeta, setEffectsMeta] = useState([]);
  const [source, setSource] = useState(null);
  const [sourceError, setSourceError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const [selected, setSelected] = useState([]);
  const [volume, setVolume] = useState(1);

  const [recording, setRecording] = useState(null);
  const [savingRecording, setSavingRecording] = useState(false);
  const recorderRef = useRef(null);

  // Dos vistas previas renderizadas por ffmpeg: con los efectos y sin ellos
  // (para comparar). Se guardan por separado para poder alternar al instante.
  const [preview, setPreview] = useState({ status: 'idle' });
  const [original, setOriginal] = useState({ status: 'idle' });
  const [listenTo, setListenTo] = useState('effects');

  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  const [format, setFormat] = useState('mp3');
  const [exportJob, setExportJob] = useState(null);

  // id del trabajo vigente de cada tipo. Los avisos de trabajos sustituidos
  // (p. ej. una vista previa vieja que acaba tarde) se ignoran.
  const currentJobs = useRef({ preview: null, original: null, export: null });
  // Por si ffmpeg termina antes de que llegue la respuesta con el id.
  const earlyEvents = useRef(new Map());
  const retiredJobs = useRef(new Set());
  const handleJobEventRef = useRef(null);

  useEffect(() => {
    window.api.getVoiceEffects().then(setEffectsMeta);
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime));
    audio.addEventListener('loadedmetadata', () => setAudioDuration(audio.duration));
    audio.addEventListener('play', () => setPlaying(true));
    audio.addEventListener('pause', () => setPlaying(false));
    audio.addEventListener('ended', () => setPlaying(false));
    audioRef.current = audio;
    return () => audio.pause();
  }, []);

  useEffect(() => {
    if (!active) audioRef.current?.pause();
  }, [active]);

  handleJobEventRef.current = (kind, payload) => {
    const role = Object.keys(currentJobs.current).find((r) => currentJobs.current[r] === payload.id);
    if (!role) return;
    const setters = { preview: setPreview, original: setOriginal };
    if (role === 'export') {
      if (kind === 'progress') setExportJob((prev) => prev && { ...prev, percent: payload.percent });
      else if (payload.ok) setExportJob((prev) => ({ ...prev, done: true, outputPath: payload.outputPath, sizeBytes: payload.sizeBytes }));
      else setExportJob((prev) => ({ ...prev, done: true, error: payload.message, details: payload.details }));
    } else if (kind === 'progress') {
      setters[role]((prev) => ({ ...prev, percent: payload.percent }));
    } else if (payload.ok) {
      setters[role]((prev) => {
        if (prev.filePath) window.api.discardVoicePreview(prev.filePath);
        return { status: 'ready', url: payload.url, filePath: payload.filePath };
      });
    } else {
      setters[role]((prev) => ({ ...prev, status: 'error', error: payload.message, details: payload.details }));
    }
    if (kind === 'done') currentJobs.current[role] = null;
  };

  useEffect(() => {
    const route = (kind) => (payload) => {
      if (!payload.id) return;
      if (retiredJobs.current.has(payload.id)) {
        // Trabajo ya sustituido que llegó a terminar: se borra su archivo temporal.
        if (kind === 'done') {
          retiredJobs.current.delete(payload.id);
          if (payload.ok && payload.filePath) window.api.discardVoicePreview(payload.filePath);
        }
        return;
      }
      const known = Object.values(currentJobs.current).includes(payload.id);
      if (!known) {
        const list = earlyEvents.current.get(payload.id) || [];
        list.push([kind, payload]);
        earlyEvents.current.set(payload.id, list);
        return;
      }
      handleJobEventRef.current(kind, payload);
    };
    const unsubs = [
      window.api.onVoicePreviewProgress(route('progress')),
      window.api.onVoicePreviewDone(route('done')),
      window.api.onVoiceExportProgress(route('progress')),
      window.api.onVoiceExportDone(route('done')),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  const retireJob = useCallback((id) => {
    if (!id || id === 'pending') return;
    window.api.cancelVoiceJob(id);
    retiredJobs.current.add(id);
    const early = earlyEvents.current.get(id);
    earlyEvents.current.delete(id);
    early?.forEach(([, payload]) => {
      if (payload.ok && payload.filePath) window.api.discardVoicePreview(payload.filePath);
    });
  }, []);

  const startJob = useCallback(async (role, invoke) => {
    retireJob(currentJobs.current[role]);
    // Cada llamada se identifica con su propio marcador mientras espera el id.
    const token = {};
    currentJobs.current[role] = token;
    const { id } = await invoke();
    // Si mientras tanto se lanzó otro trabajo del mismo tipo, este sobra.
    if (currentJobs.current[role] !== token) {
      retireJob(id);
      return;
    }
    currentJobs.current[role] = id;
    const early = earlyEvents.current.get(id);
    earlyEvents.current.delete(id);
    early?.forEach(([kind, payload]) => handleJobEventRef.current(kind, payload));
  }, [retireJob]);

  const cancelAllJobs = useCallback(() => {
    for (const role of Object.keys(currentJobs.current)) {
      const id = currentJobs.current[role];
      if (typeof id === 'string') retireJob(id);
      currentJobs.current[role] = null;
    }
  }, [retireJob]);

  const loadSource = useCallback(
    (newSource) => {
      cancelAllJobs();
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      setCurrentTime(0);
      setAudioDuration(0);
      setPreview((prev) => {
        if (prev.filePath) window.api.discardVoicePreview(prev.filePath);
        return { status: 'idle' };
      });
      setOriginal((prev) => {
        if (prev.filePath) window.api.discardVoicePreview(prev.filePath);
        return { status: newSource ? 'rendering' : 'idle', percent: 0 };
      });
      setExportJob(null);
      setSourceError(null);
      setSource(newSource);
      if (!newSource?.hasVideo) setFormat((f) => (f === 'video' ? 'mp3' : f));
      if (newSource) {
        startJob('original', () =>
          window.api.makeVoicePreview({ inputPath: newSource.path, effects: [], volume: 1, duration: newSource.duration })
        );
      }
    },
    [cancelAllJobs, startJob]
  );

  const openFile = useCallback(
    async (filePath) => {
      if (!filePath) return;
      const info = await window.api.openVoiceSource(filePath);
      if (!info.ok) {
        setSourceError(info.error);
        return;
      }
      loadSource({
        path: filePath,
        name: filePath.split(/[\\/]/).pop(),
        duration: info.duration,
        hasVideo: info.hasVideo,
        isRecording: false,
      });
    },
    [loadSource]
  );

  // Vista previa con efectos: se rehace cada vez que cambian los efectos, la
  // intensidad o el volumen, esperando un momento para no lanzar un ffmpeg
  // por cada pasito del deslizador.
  useEffect(() => {
    if (!source) return;
    setPreview((prev) => ({ ...prev, status: 'rendering', percent: 0 }));
    const timer = setTimeout(() => {
      startJob('preview', () =>
        window.api.makeVoicePreview({ inputPath: source.path, effects: selected, volume, duration: source.duration })
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [source, selected, volume, startJob]);

  // Cambia el audio que suena manteniendo el punto y si estaba sonando.
  const activeUrl = listenTo === 'effects' ? preview.url : original.url;
  useEffect(() => {
    const audio = audioRef.current;
    if (!activeUrl || audio.src === activeUrl) return;
    const wasPlaying = !audio.paused;
    const at = audio.currentTime;
    audio.src = activeUrl;
    audio.addEventListener(
      'loadedmetadata',
      () => {
        audio.currentTime = Math.min(at, audio.duration || at);
        if (wasPlaying) audio.play().catch(() => {});
      },
      { once: true }
    );
  }, [activeUrl]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio.src) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const handleSeek = useCallback((e) => {
    const audio = audioRef.current;
    if (!audio.src || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * audio.duration;
  }, []);

  const toggleEffect = useCallback(
    (effect) => {
      setSelected((prev) => {
        if (prev.some((e) => e.key === effect.key)) return prev.filter((e) => e.key !== effect.key);
        const exclusiveKeys = effect.exclusive
          ? effectsMeta.filter((m) => m.exclusive === effect.exclusive).map((m) => m.key)
          : [];
        return [...prev.filter((e) => !exclusiveKeys.includes(e.key)), { key: effect.key, intensity: DEFAULT_INTENSITY }];
      });
      setListenTo('effects');
    },
    [effectsMeta]
  );

  const setIntensity = useCallback((key, intensity) => {
    setSelected((prev) => prev.map((e) => (e.key === key ? { ...e, intensity } : e)));
  }, []);

  const startRecording = useCallback(async () => {
    setSourceError(null);
    const allowed = await window.api.requestMicAccess();
    if (!allowed) {
      setSourceError('El sistema no deja usar el micrófono. Actívalo para OS Media en los ajustes de privacidad.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      setSourceError('No se pudo acceder al micrófono. Comprueba que hay uno conectado y que Windows permite usarlo.');
      return;
    }

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setRecording(null);
      if (recorder.discard || chunks.length === 0) return;
      setSavingRecording(true);
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      const result = await window.api.saveVoiceRecording(bytes);
      setSavingRecording(false);
      if (!result.ok) {
        setSourceError(result.error);
        return;
      }
      loadSource({
        path: result.filePath,
        name: 'Grabación con el micro',
        duration: result.duration,
        hasVideo: false,
        isRecording: true,
        suggestedBase: `grabacion_${timestampName()}`,
      });
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording({ startedAt: Date.now(), elapsed: 0 });
  }, [loadSource]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      setRecording((prev) => prev && { ...prev, elapsed: (Date.now() - prev.startedAt) / 1000 });
    }, 250);
    return () => clearInterval(timer);
  }, [recording?.startedAt]);

  // Si se cierra la pestaña de la app a mitad de grabación, se suelta el micro.
  useEffect(
    () => () => {
      if (recorderRef.current) {
        recorderRef.current.discard = true;
        recorderRef.current.stop();
      }
    },
    []
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      openFile(file ? window.api.getPathForFile(file) : null);
    },
    [openFile]
  );
  const handleDragOver = useCallback((e) => e.preventDefault(), []);
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    dragCounter.current += 1;
    setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) setIsDragging(false);
  }, []);

  const handleChooseFile = useCallback(async () => {
    openFile(await window.api.chooseMediaFile());
  }, [openFile]);

  const handleExport = useCallback(async () => {
    if (!source) return;
    const base = source.suggestedBase || source.name.replace(/\.[^.]+$/, '');
    const suffix = selected.length ? selected.map((e) => e.key).join('_') : 'voz';
    const choice = await window.api.chooseVoiceOutput({
      inputPath: source.path,
      format,
      suggestedName: `${base}_${suffix}`,
      isRecording: source.isRecording,
    });
    if (!choice) return;
    if (choice.error) {
      setExportJob({ done: true, error: choice.error });
      return;
    }
    setExportJob({ percent: 0, done: false });
    startJob('export', () =>
      window.api.exportVoice({
        inputPath: source.path,
        outputPath: choice.outputPath,
        effects: selected,
        volume,
        format,
        duration: source.duration,
      })
    );
  }, [source, selected, volume, format, startJob]);

  const handleCancelExport = useCallback(() => {
    const id = currentJobs.current.export;
    if (typeof id === 'string') retireJob(id);
    currentJobs.current.export = null;
    setExportJob(null);
  }, [retireJob]);

  const groups = effectsMeta.reduce((acc, effect) => {
    (acc[effect.group] ||= []).push(effect);
    return acc;
  }, {});
  const selectedMeta = effectsMeta.filter((m) => selected.some((e) => e.key === m.key));
  const shown = listenTo === 'effects' ? preview : original;
  const isExporting = exportJob && !exportJob.done;
  const totalDuration = audioDuration || source?.duration || 0;

  return (
    <div className="space-y-6">
      <section className={`${cardClass} space-y-4`}>
        {!source && !recording && !savingRecording && (
          <div className="grid gap-4 md:grid-cols-2">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onClick={handleChooseFile}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                isDragging ? 'border-brand-500 bg-brand-500/5' : 'border-neutral-700 hover:border-neutral-600'
              }`}
            >
              <UploadIcon className="h-8 w-8 text-neutral-500" />
              <p className="text-sm text-neutral-300">Arrastra un audio o vídeo aquí, o haz clic para elegirlo</p>
              <p className="text-xs text-neutral-500">MP3, WAV, M4A, OGG · MP4, MOV, MKV, WEBM</p>
            </div>
            <button
              onClick={startRecording}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-neutral-700 px-6 py-10 text-center transition-colors hover:border-logo-pink/60 hover:bg-logo-pink/5"
            >
              <MicIcon className="h-8 w-8 text-logo-pink" />
              <p className="text-sm text-neutral-300">Grabar con el micro</p>
              <p className="text-xs text-neutral-500">Graba tu voz y aplícale efectos al momento</p>
            </button>
          </div>
        )}

        {recording && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
              <span className="font-mono text-2xl text-neutral-100">{formatTime(recording.elapsed)}</span>
            </div>
            <p className="text-sm text-neutral-400">Grabando... habla cuando quieras</p>
            <button
              onClick={stopRecording}
              className="rounded-lg bg-red-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-400"
            >
              Parar grabación
            </button>
          </div>
        )}

        {savingRecording && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-400">
            <SpinnerIcon className="h-4 w-4 text-brand-400" />
            Preparando la grabación...
          </div>
        )}

        {source && !recording && !savingRecording && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {source.isRecording ? (
                <MicIcon className="h-4 w-4 shrink-0 text-logo-pink" />
              ) : (
                <UploadIcon className="h-4 w-4 shrink-0 text-neutral-500" />
              )}
              <p className="min-w-0 flex-1 truncate text-sm text-neutral-200">
                {source.name}
                <span className="text-neutral-500"> · {formatTime(source.duration)}</span>
              </p>
              <button onClick={handleChooseFile} className={smallButtonClass}>
                Otro archivo
              </button>
              <button onClick={startRecording} className={smallButtonClass}>
                <MicIcon className="h-3.5 w-3.5" />
                Grabar otra vez
              </button>
              <button
                onClick={() => loadSource(null)}
                className="rounded-md p-1.5 text-neutral-500 hover:bg-white/5 hover:text-neutral-300"
                aria-label="Quitar archivo"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                disabled={!activeUrl}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 text-white disabled:opacity-30"
                aria-label={playing ? 'Pausar' : 'Reproducir'}
              >
                {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
              </button>

              <div onClick={handleSeek} className="relative h-2 flex-1 cursor-pointer overflow-hidden rounded-full bg-neutral-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400"
                  style={{ width: `${totalDuration ? (currentTime / totalDuration) * 100 : 0}%` }}
                />
              </div>

              <span className="w-20 text-right font-mono text-xs text-neutral-400">
                {formatTime(currentTime)} / {formatTime(totalDuration)}
              </span>

              <div className="flex overflow-hidden rounded-lg border border-neutral-700 text-xs">
                {[
                  ['effects', 'Con efectos'],
                  ['original', 'Original'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setListenTo(key)}
                    className={`px-3 py-1.5 transition-colors ${
                      listenTo === key
                        ? 'bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 text-white'
                        : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-4 text-xs">
              {shown.status === 'rendering' && (
                <span className="flex items-center gap-1.5 text-neutral-400">
                  <SpinnerIcon className="h-3 w-3 text-brand-400" />
                  {listenTo === 'effects' ? 'Aplicando efectos' : 'Preparando el original'}... {shown.percent || 0}%
                </span>
              )}
              {shown.status === 'error' && <span className="text-red-400">{shown.error}</span>}
            </div>
          </div>
        )}

        {sourceError && <p className="text-sm text-red-400">{sourceError}</p>}
      </section>

      <section className={`${cardClass} space-y-5`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-200">Efectos</h2>
          {selected.length > 0 && (
            <button onClick={() => setSelected([])} className="text-xs text-neutral-400 hover:text-neutral-200">
              Quitar todos
            </button>
          )}
        </div>

        {Object.entries(groups).map(([group, effects]) => (
          <div key={group} className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{group}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {effects.map((effect) => {
                const isOn = selected.some((e) => e.key === effect.key);
                return (
                  <button
                    key={effect.key}
                    onClick={() => toggleEffect(effect)}
                    title={effect.hint}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      isOn
                        ? 'border-brand-500 bg-brand-500/10'
                        : 'border-white/5 bg-neutral-900/40 hover:border-white/15'
                    }`}
                  >
                    <span className="text-xl leading-none">{effect.emoji}</span>
                    <span className="min-w-0">
                      <span className={`block text-sm ${isOn ? 'text-white' : 'text-neutral-200'}`}>{effect.label}</span>
                      <span className="block truncate text-xs text-neutral-500">{effect.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="space-y-3 border-t border-white/5 pt-4">
          {selectedMeta
            .filter((m) => !m.noIntensity)
            .map((effect) => {
              const value = selected.find((e) => e.key === effect.key).intensity;
              return (
                <div key={effect.key} className="flex items-center gap-3">
                  <span className="w-36 truncate text-sm text-neutral-300">
                    {effect.emoji} {effect.label}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={value}
                    onChange={(e) => setIntensity(effect.key, Number(e.target.value))}
                    className="flex-1 accent-brand-500"
                    aria-label={`Intensidad de ${effect.label}`}
                  />
                  <span className="w-10 text-right font-mono text-xs text-neutral-400">{value}%</span>
                </div>
              );
            })}
          <div className="flex items-center gap-3">
            <span className="w-36 text-sm text-neutral-300">🔊 Volumen final</span>
            <input
              type="range"
              min="0"
              max="200"
              step="5"
              value={Math.round(volume * 100)}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              className="flex-1 accent-brand-500"
              aria-label="Volumen final"
            />
            <span className="w-10 text-right font-mono text-xs text-neutral-400">{Math.round(volume * 100)}%</span>
          </div>
          {selected.length === 0 && (
            <p className="text-xs text-neutral-500">Elige uno o varios efectos. Se pueden combinar (por ejemplo, Robot + Eco).</p>
          )}
        </div>
      </section>

      <section className={`${cardClass} space-y-4`}>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1.5 block text-sm text-neutral-400">Guardar como</label>
            <div className="flex overflow-hidden rounded-lg border border-neutral-700 text-sm">
              {[
                ['mp3', 'MP3'],
                ['wav', 'WAV'],
                ...(source?.hasVideo ? [['video', 'Vídeo con la voz cambiada']] : []),
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFormat(key)}
                  className={`px-3 py-2 transition-colors ${
                    format === key
                      ? 'bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 text-white'
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button onClick={handleExport} disabled={!source || isExporting} className={`ml-auto ${gradientButtonClass}`}>
            Exportar
          </button>
        </div>

        {exportJob && !exportJob.done && (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 transition-all"
                style={{ width: `${exportJob.percent || 0}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-neutral-400">
              <span>Exportando...</span>
              <span>{exportJob.percent || 0}%</span>
            </div>
            <button onClick={handleCancelExport} className="text-xs text-red-400 hover:text-red-300">
              Cancelar
            </button>
          </div>
        )}

        {exportJob?.done && !exportJob.error && (
          <div className="flex items-center gap-3">
            <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-400" />
            <p className="min-w-0 flex-1 truncate text-sm text-emerald-400">
              Guardado: {exportJob.outputPath.split(/[\\/]/).pop()} — {formatSize(exportJob.sizeBytes)}
            </p>
            <button onClick={() => window.api.openFolder(dirOf(exportJob.outputPath))} className={smallButtonClass}>
              <FolderIcon className="h-3.5 w-3.5" />
              Abrir carpeta
            </button>
          </div>
        )}

        {exportJob?.done && exportJob.error && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-red-400">
              <XCircleIcon className="h-4 w-4 shrink-0" />
              {exportJob.error}
            </p>
            {exportJob.details && (
              <>
                <button
                  onClick={() => setExportJob((prev) => ({ ...prev, showDetails: !prev.showDetails }))}
                  className="text-xs text-neutral-400 underline underline-offset-2"
                >
                  {exportJob.showDetails ? 'Ocultar detalles' : 'Ver detalles'}
                </button>
                {exportJob.showDetails && (
                  <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs text-neutral-500">
                    {exportJob.details}
                  </pre>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
