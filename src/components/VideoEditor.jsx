import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import {
  FolderIcon,
  UploadIcon,
  CheckCircleIcon,
  XCircleIcon,
  SpinnerIcon,
  ScissorsIcon,
  PlayIcon,
  PauseIcon,
  TrashIcon,
  UndoIcon,
  VolumeIcon,
} from './icons';

// Duración mínima de un tramo: evita tramos de 0 segundos al arrastrar bordes o cortar.
const MIN_SEGMENT = 0.1;
const THUMBNAIL_COUNT = 24;
const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
// Ancho aproximado de cada miniatura de la tira, en píxeles.
const TILE_WIDTH = 96;
// Zoom máximo: con vídeos cortos no tiene sentido ampliar más de lo que permite
// ver ~2 segundos a lo ancho.
const MAX_ZOOM = 200;
const MIN_LABEL_SPACING = 70;

// Sustituye las miniaturas que no se pudieron generar por la más cercana,
// para que la tira no tenga huecos.
function fillThumbnailGaps(thumbs) {
  return thumbs.map((src, i) => {
    if (src) return src;
    for (let d = 1; d < thumbs.length; d++) {
      if (thumbs[i - d]) return thumbs[i - d];
      if (thumbs[i + d]) return thumbs[i + d];
    }
    return null;
  });
}

function formatTime(seconds, withTenths = true) {
  const safe = Math.max(0, seconds || 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const tenths = Math.floor((safe * 10) % 10);
  const base = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return withTenths ? `${base}.${tenths}` : base;
}

function formatSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function findSegmentAt(segments, t) {
  return segments.findIndex((s) => t >= s.start && t < s.end);
}

const toolButtonClass =
  'flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-30 disabled:hover:bg-neutral-800';

export default function VideoEditor({ active }) {
  const [video, setVideo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [thumbnails, setThumbnails] = useState([]);
  const [preview, setPreview] = useState(null);

  const [segments, setSegments] = useState([]);
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  // 1 = volumen original, 0 = sin sonido, 2 = doble. Afecta a la vista previa y a la exportación.
  const [volume, setVolume] = useState(1);
  const [exportJob, setExportJob] = useState(null);

  const [zoom, setZoom] = useState(1);
  const [viewWidth, setViewWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const videoRef = useRef(null);
  const timelineRef = useRef(null);
  const segmentsRef = useRef(segments);
  const pointerRef = useRef(null);
  const dragCounter = useRef(0);
  const openPathRef = useRef(null);
  const scrollRef = useRef(null);
  const zoomAnchorRef = useRef(null);
  const wheelHandlerRef = useRef(null);
  const audioGraphRef = useRef(null);
  const lastVolumeRef = useRef(1);
  segmentsRef.current = segments;

  const duration = video?.duration || 0;
  const keptDuration = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const isExporting = exportJob && !exportJob.done;
  const playerSrc = video ? (preview ? preview.url : video.url) : null;
  const maxZoom = Math.min(MAX_ZOOM, Math.max(1, duration / 2));
  const trackWidth = viewWidth * zoom;

  // --- Carga del vídeo -------------------------------------------------------

  const openVideo = useCallback(async (inputPath) => {
    if (!inputPath) return;
    openPathRef.current = inputPath;
    setIsLoading(true);
    setLoadError(null);
    const result = await window.api.openVideoInEditor(inputPath);
    setIsLoading(false);
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setVideo({ inputPath, url: result.url, duration: result.duration, hasAudio: result.hasAudio });
    setSegments([{ start: 0, end: result.duration }]);
    setHistory([]);
    setSelected(0);
    setCurrentTime(0);
    setPlaying(false);
    setThumbnails([]);
    setPreview(null);
    setExportJob(null);
    setVolume(1);
    setZoom(1);

    const thumbs = await window.api.getEditorThumbnails({
      inputPath,
      duration: result.duration,
      count: THUMBNAIL_COUNT,
    });
    // Si mientras tanto se abrió otro vídeo, estas miniaturas ya no sirven.
    if (openPathRef.current === inputPath) setThumbnails(thumbs);
  }, []);

  const handleChooseFile = useCallback(async () => {
    const file = await window.api.chooseVideoFile();
    if (file) openVideo(file);
  }, [openVideo]);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) openVideo(window.api.getPathForFile(file));
    },
    [openVideo]
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

  // Si el reproductor interno no entiende el códec, se genera una copia ligera
  // solo para previsualizar. La exportación sigue usando el original.
  const handleVideoError = useCallback(async () => {
    if (!video || preview) return;
    setPreview({ id: null, percent: 0, url: null, error: null });
    const result = await window.api.makeEditorPreview({ inputPath: video.inputPath, duration: video.duration });
    setPreview((prev) => (prev ? { ...prev, id: result.id } : prev));
  }, [video, preview]);

  useEffect(() => {
    const unsubs = [
      window.api.onEditorPreviewProgress((payload) => {
        setPreview((prev) => (prev && prev.id === payload.id ? { ...prev, percent: payload.percent } : prev));
      }),
      window.api.onEditorPreviewDone((payload) => {
        setPreview((prev) => {
          if (!prev || prev.id !== payload.id) return prev;
          return payload.ok ? { ...prev, url: payload.url } : { ...prev, error: payload.message };
        });
      }),
      window.api.onEditorExportProgress((payload) => {
        setExportJob((prev) => (prev && prev.id === payload.id ? { ...prev, percent: payload.percent } : prev));
      }),
      window.api.onEditorExportDone((payload) => {
        setExportJob((prev) => {
          if (!prev || prev.id !== payload.id) return prev;
          if (payload.ok) return { ...prev, done: true, outputPath: payload.outputPath, sizeBytes: payload.sizeBytes };
          return { ...prev, done: true, error: payload.message, details: payload.details };
        });
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  // --- Reproducción ----------------------------------------------------------

  const seek = useCallback(
    (t) => {
      const clamped = Math.min(Math.max(0, t), duration);
      if (videoRef.current) videoRef.current.currentTime = clamped;
      setCurrentTime(clamped);
    },
    [duration]
  );

  // Mientras se reproduce, se saltan las partes eliminadas para que la vista
  // previa sea igual que el resultado final.
  useEffect(() => {
    if (!playing) return undefined;
    let frame;
    const tick = () => {
      const el = videoRef.current;
      const segs = segmentsRef.current;
      if (!el || segs.length === 0) return;
      let t = el.currentTime;
      if (findSegmentAt(segs, t) === -1) {
        const next = segs.find((s) => s.start > t);
        if (next) {
          t = next.start;
          el.currentTime = t;
        } else {
          t = segs[segs.length - 1].end;
          el.pause();
          el.currentTime = t;
        }
      }
      setCurrentTime(t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // <video>.volume no pasa del 100 %, así que el audio pasa por un nodo de
  // ganancia de Web Audio. Cada elemento <video> solo se puede conectar una vez.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let graph = audioGraphRef.current;
    if (graph?.element !== el) {
      const ctx = graph?.ctx || new AudioContext();
      const gain = ctx.createGain();
      ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
      graph = { ctx, element: el, gain };
      audioGraphRef.current = graph;
    }
    graph.gain.gain.value = volume;
  }, [volume, playerSrc]);

  const toggleMute = useCallback(() => {
    if (volume > 0) {
      lastVolumeRef.current = volume;
      setVolume(0);
    } else {
      setVolume(lastVolumeRef.current || 1);
    }
  }, [volume]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el || segments.length === 0) return;
    audioGraphRef.current?.ctx.resume();
    if (!el.paused) {
      el.pause();
      return;
    }
    const t = el.currentTime;
    if (findSegmentAt(segments, t) === -1) {
      const next = segments.find((s) => s.start > t) || segments[0];
      el.currentTime = next.start;
    }
    el.play();
  }, [segments]);

  useEffect(() => {
    if (!active) videoRef.current?.pause();
  }, [active]);

  // --- Edición ---------------------------------------------------------------

  const commit = useCallback(
    (next) => {
      setHistory((h) => [...h.slice(-49), segments]);
      setSegments(next);
    },
    [segments]
  );

  const splitIndex = segments.findIndex(
    (s) => currentTime > s.start + MIN_SEGMENT && currentTime < s.end - MIN_SEGMENT
  );

  const handleSplit = useCallback(() => {
    if (splitIndex === -1) return;
    const s = segments[splitIndex];
    commit([
      ...segments.slice(0, splitIndex),
      { start: s.start, end: currentTime },
      { start: currentTime, end: s.end },
      ...segments.slice(splitIndex + 1),
    ]);
    setSelected(splitIndex + 1);
  }, [splitIndex, segments, currentTime, commit]);

  const handleDelete = useCallback(() => {
    if (segments.length <= 1 || !segments[selected]) return;
    commit(segments.filter((_, i) => i !== selected));
    setSelected(Math.min(selected, segments.length - 2));
  }, [segments, selected, commit]);

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setSegments(previous);
    setSelected((sel) => Math.min(sel, previous.length - 1));
  }, [history]);

  const handleReset = useCallback(() => {
    commit([{ start: 0, end: duration }]);
    setSelected(0);
  }, [duration, commit]);

  // --- Línea de tiempo -------------------------------------------------------

  const timeFromClientX = useCallback(
    (clientX) => {
      const rect = timelineRef.current.getBoundingClientRect();
      const ratio = Math.min(Math.max(0, (clientX - rect.left) / rect.width), 1);
      return ratio * duration;
    },
    [duration]
  );

  const handleTimelinePointerDown = useCallback(
    (e) => {
      if (!video || e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const { handle, index } = e.target.dataset;
      const t = timeFromClientX(e.clientX);

      if (handle) {
        videoRef.current?.pause();
        pointerRef.current = { mode: handle, index: Number(index), snapshot: segments };
        setSelected(Number(index));
        return;
      }

      if (index !== undefined) setSelected(Number(index));
      pointerRef.current = { mode: 'scrub' };
      seek(t);
    },
    [video, segments, timeFromClientX, seek]
  );

  const handleTimelinePointerMove = useCallback(
    (e) => {
      const drag = pointerRef.current;
      if (!drag) return;
      const t = timeFromClientX(e.clientX);

      if (drag.mode === 'scrub') {
        seek(t);
        return;
      }

      const segs = segmentsRef.current;
      const i = drag.index;
      const s = segs[i];
      let next;
      if (drag.mode === 'start') {
        const min = i > 0 ? segs[i - 1].end : 0;
        next = { ...s, start: Math.min(Math.max(t, min), s.end - MIN_SEGMENT) };
        seek(next.start);
      } else {
        const max = i < segs.length - 1 ? segs[i + 1].start : duration;
        next = { ...s, end: Math.max(Math.min(t, max), s.start + MIN_SEGMENT) };
        seek(next.end);
      }
      setSegments(segs.map((seg, j) => (j === i ? next : seg)));
    },
    [timeFromClientX, seek, duration]
  );

  const handleTimelinePointerUp = useCallback(() => {
    const drag = pointerRef.current;
    pointerRef.current = null;
    // El arrastre de un borde se guarda en el historial como un único paso.
    if (drag && drag.mode !== 'scrub' && drag.snapshot !== segmentsRef.current) {
      setHistory((h) => [...h.slice(-49), drag.snapshot]);
    }
  }, []);

  const gaps = [];
  segments.forEach((s, i) => {
    const prevEnd = i === 0 ? 0 : segments[i - 1].end;
    if (s.start > prevEnd) gaps.push({ start: prevEnd, end: s.start });
  });
  const lastEnd = segments.length ? segments[segments.length - 1].end : 0;
  if (lastEnd < duration) gaps.push({ start: lastEnd, end: duration });

  // --- Zoom de la línea de tiempo -------------------------------------------

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => setViewWidth(el.clientWidth));
    observer.observe(el);
    setViewWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [video]);

  // anchor = { time, offset }: el instante que debe quedarse en la misma
  // posición de la pantalla (offset en px desde el borde izquierdo) al ampliar.
  const applyZoom = useCallback(
    (next, anchor) => {
      zoomAnchorRef.current = anchor;
      setZoom(Math.min(Math.max(1, next), maxZoom));
    },
    [maxZoom]
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    if (!el || !anchor || !duration) return;
    el.scrollLeft = (anchor.time / duration) * el.clientWidth * zoom - anchor.offset;
    setScrollLeft(el.scrollLeft);
  }, [zoom, duration]);

  // Los botones y atajos amplían alrededor del cabezal (o del centro si no se ve).
  const zoomBy = useCallback(
    (factor) => {
      const el = scrollRef.current;
      if (!el || !duration) return;
      const playheadX = (currentTime / duration) * el.clientWidth * zoom - el.scrollLeft;
      const visible = playheadX >= 0 && playheadX <= el.clientWidth;
      const offset = visible ? playheadX : el.clientWidth / 2;
      const time = visible ? currentTime : ((el.scrollLeft + offset) / (el.clientWidth * zoom)) * duration;
      applyZoom(zoom * factor, { time, offset });
    },
    [applyZoom, currentTime, duration, zoom]
  );

  // Ctrl + rueda amplía alrededor del ratón; la rueda sola desplaza la línea de
  // tiempo cuando está ampliada. Se registra a mano porque React añade los
  // eventos de rueda como pasivos y no dejaría cancelar el scroll de la página.
  wheelHandlerRef.current = (e) => {
    const el = scrollRef.current;
    if (!el || !duration) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const offset = e.clientX - el.getBoundingClientRect().left;
      const time = ((el.scrollLeft + offset) / (el.clientWidth * zoom)) * duration;
      applyZoom(zoom * Math.exp(-e.deltaY * 0.0025), { time, offset });
    } else if (zoom > 1 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (e) => wheelHandlerRef.current?.(e);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [video]);

  // Al reproducir con zoom, la vista sigue al cabezal.
  useEffect(() => {
    const el = scrollRef.current;
    if (!playing || zoom === 1 || !el || !duration) return;
    const x = (currentTime / duration) * el.clientWidth * zoom;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 16) {
      el.scrollLeft = x - el.clientWidth * 0.1;
    }
  }, [currentTime, playing, zoom, duration]);

  // Solo se dibujan las marcas y miniaturas cercanas a la zona visible: con
  // mucho zoom la línea de tiempo puede medir cientos de miles de píxeles.
  const visibleFrom = scrollLeft - viewWidth;
  const visibleTo = scrollLeft + viewWidth * 2;

  const rulerStep = RULER_STEPS.find((step) => (step / duration) * trackWidth >= MIN_LABEL_SPACING) || 3600;
  const rulerMarks = [];
  if (duration && trackWidth) {
    for (let i = 0; i * rulerStep <= duration; i++) {
      const t = i * rulerStep;
      const x = (t / duration) * trackWidth;
      if (x >= visibleFrom && x <= visibleTo) rulerMarks.push(t);
    }
  }

  const filledThumbnails = fillThumbnailGaps(thumbnails);
  const tileCount = Math.max(1, Math.round(trackWidth / TILE_WIDTH));
  const tileWidth = trackWidth / tileCount;
  const tiles = [];
  if (filledThumbnails.length && trackWidth) {
    const first = Math.max(0, Math.floor(visibleFrom / tileWidth));
    const last = Math.min(tileCount - 1, Math.ceil(visibleTo / tileWidth));
    for (let i = first; i <= last; i++) {
      const thumbIndex = Math.min(
        filledThumbnails.length - 1,
        Math.floor(((i + 0.5) / tileCount) * filledThumbnails.length)
      );
      tiles.push({ i, src: filledThumbnails[thumbIndex] });
    }
  }

  // --- Atajos de teclado -----------------------------------------------------

  useEffect(() => {
    if (!active || !video) return undefined;
    const onKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      // Evita que Espacio también "pulse" el último botón que tenía el foco.
      if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 's' || e.key === 'S') {
        handleSplit();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDelete();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (e.key === '+' || e.key === '=') {
        zoomBy(1.5);
      } else if (e.key === '-') {
        zoomBy(1 / 1.5);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        seek(currentTime + (e.key === 'ArrowLeft' ? -step : step));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, video, togglePlay, handleSplit, handleDelete, handleUndo, seek, currentTime, zoomBy]);

  // --- Exportación -----------------------------------------------------------

  const handleExport = useCallback(async () => {
    if (!video || segments.length === 0) return;
    videoRef.current?.pause();
    const choice = await window.api.chooseEditorOutput(video.inputPath);
    if (!choice) return;
    if (choice.error) {
      setExportJob({ done: true, error: choice.error });
      return;
    }
    setExportJob({ id: null, percent: 0, done: false, error: null, showDetails: false });
    const result = await window.api.exportEditedVideo({
      inputPath: video.inputPath,
      outputPath: choice.outputPath,
      segments,
      hasAudio: video.hasAudio,
      volume,
    });
    setExportJob((prev) => (prev ? { ...prev, id: result.id } : prev));
  }, [video, segments, volume]);

  const handleCancelExport = useCallback(() => {
    if (exportJob?.id) {
      window.api.cancelEditorJob(exportJob.id);
      setExportJob(null);
    }
  }, [exportJob]);

  // --- Render ----------------------------------------------------------------

  const dropZone = (
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
      {isLoading ? (
        <SpinnerIcon className="h-8 w-8 text-brand-400" />
      ) : (
        <UploadIcon className="h-8 w-8 text-neutral-500" />
      )}
      <p className="text-sm text-neutral-300">
        {isLoading ? 'Abriendo vídeo...' : 'Arrastra un vídeo aquí, o haz clic para elegirlo'}
      </p>
      <p className="text-xs text-neutral-500">MP4, MOV, MKV, WEBM, AVI</p>
      {loadError && <p className="text-sm text-red-400">{loadError}</p>}
    </div>
  );

  if (!video) {
    return (
      <section className="rounded-2xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/20">
        {dropZone}
      </section>
    );
  }

  const fileName = video.inputPath.split(/[\\/]/).pop();
  const pct = (t) => `${(t / duration) * 100}%`;

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-2xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/20">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm text-neutral-300">{fileName}</p>
          <button onClick={handleChooseFile} className={toolButtonClass} disabled={isExporting}>
            <FolderIcon className="h-3.5 w-3.5" />
            Abrir otro vídeo
          </button>
        </div>
        {loadError && <p className="text-sm text-red-400">{loadError}</p>}

        <div
          className="relative flex items-center justify-center overflow-hidden rounded-xl bg-black"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          {playerSrc && (
            <video
              ref={videoRef}
              src={playerSrc}
              crossOrigin="anonymous"
              className="max-h-[45vh] w-full cursor-pointer object-contain"
              onClick={togglePlay}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onSeeked={(e) => !playing && setCurrentTime(e.currentTarget.currentTime)}
              onError={handleVideoError}
            />
          )}
          {preview && !preview.url && (
            <div className="flex aspect-video w-full max-w-xl flex-col items-center justify-center gap-3 p-6 text-center">
              {preview.error ? (
                <p className="text-sm text-red-400">{preview.error}</p>
              ) : (
                <>
                  <SpinnerIcon className="h-6 w-6 text-brand-400" />
                  <p className="text-sm text-neutral-300">
                    Este vídeo usa un formato que el reproductor no muestra directamente.
                    <br />
                    Preparando vista previa... {preview.percent}%
                  </p>
                  <p className="text-xs text-neutral-500">El vídeo exportado mantendrá la calidad del original.</p>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={togglePlay}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 text-white hover:opacity-90"
            title="Reproducir / pausar (Espacio)"
          >
            {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
          </button>
          <span className="w-36 font-mono text-xs text-neutral-400">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <button onClick={handleSplit} disabled={splitIndex === -1} className={toolButtonClass} title="Cortar en la posición actual (S)">
            <ScissorsIcon className="h-3.5 w-3.5" />
            Cortar aquí
          </button>
          <button
            onClick={handleDelete}
            disabled={segments.length <= 1}
            className={toolButtonClass}
            title={segments.length <= 1 ? 'Debe quedar al menos un tramo' : 'Eliminar el tramo seleccionado (Supr)'}
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Eliminar tramo
          </button>
          <button onClick={handleUndo} disabled={history.length === 0} className={toolButtonClass} title="Deshacer (Ctrl+Z)">
            <UndoIcon className="h-3.5 w-3.5" />
            Deshacer
          </button>
          <button onClick={handleReset} className={toolButtonClass} title="Volver al vídeo completo">
            Restablecer
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-4">
            {video.hasAudio && (
              <div className="flex items-center gap-2" title="Volumen del vídeo. También se aplica al exportar (doble clic: 100 %)">
                <button
                  onClick={toggleMute}
                  className="rounded-md p-1 text-neutral-300 hover:bg-white/5 hover:text-white"
                  aria-label={volume === 0 ? 'Activar sonido' : 'Silenciar'}
                >
                  <VolumeIcon className="h-4 w-4" muted={volume === 0} />
                </button>
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="5"
                  value={Math.round(volume * 100)}
                  onChange={(e) => setVolume(Number(e.target.value) / 100)}
                  onDoubleClick={() => setVolume(1)}
                  className="w-24 accent-brand-500"
                  aria-label="Volumen"
                />
                <span className={`w-10 font-mono text-xs ${volume > 1 ? 'text-amber-400' : 'text-neutral-400'}`}>
                  {Math.round(volume * 100)}%
                </span>
              </div>
            )}

            <div className="flex items-center gap-1.5" title="Zoom de la línea de tiempo (Ctrl + rueda, o teclas + y −)">
              <button
                onClick={() => zoomBy(1 / 1.5)}
                disabled={zoom <= 1}
                className={`${toolButtonClass} px-2`}
                aria-label="Alejar"
              >
                −
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={maxZoom > 1 ? Math.log(zoom) / Math.log(maxZoom) : 0}
                onChange={(e) => {
                  const el = scrollRef.current;
                  const offset = el ? el.clientWidth / 2 : 0;
                  const time = el ? ((el.scrollLeft + offset) / (el.clientWidth * zoom)) * duration : 0;
                  applyZoom(Math.pow(maxZoom, Number(e.target.value)), { time, offset });
                }}
                disabled={maxZoom <= 1}
                className="w-24 accent-brand-500"
                aria-label="Zoom"
              />
              <button
                onClick={() => zoomBy(1.5)}
                disabled={zoom >= maxZoom}
                className={`${toolButtonClass} px-2`}
                aria-label="Ampliar"
              >
                +
              </button>
              <button
                onClick={() => applyZoom(1, { time: 0, offset: 0 })}
                disabled={zoom <= 1}
                className={toolButtonClass}
                title="Ver el vídeo completo"
              >
                Ajustar
              </button>
            </div>
          </div>
        </div>

        <div className="select-none space-y-1">
          <div
            ref={scrollRef}
            onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
            className="timeline-scroll overflow-x-auto pb-1"
          >
          <div className="space-y-1" style={{ width: `${zoom * 100}%` }}>
          <div className="relative h-4 text-[10px] text-neutral-500">
            {rulerMarks.map((t) => (
              <span
                key={t}
                className={`absolute whitespace-nowrap ${t === 0 ? '' : t + rulerStep > duration ? '-translate-x-full' : '-translate-x-1/2'}`}
                style={{ left: pct(t) }}
              >
                {formatTime(t, rulerStep < 1)}
              </span>
            ))}
          </div>

          <div
            ref={timelineRef}
            onPointerDown={handleTimelinePointerDown}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={handleTimelinePointerUp}
            onPointerCancel={handleTimelinePointerUp}
            className="relative h-16 cursor-pointer touch-none overflow-hidden rounded-lg bg-neutral-800"
          >
            <div className="pointer-events-none absolute inset-0">
              {tiles.map(({ i, src }) =>
                src ? (
                  <img
                    key={i}
                    src={src}
                    alt=""
                    className="absolute inset-y-0 h-full object-cover"
                    style={{ left: i * tileWidth, width: tileWidth }}
                    draggable={false}
                  />
                ) : null
              )}
            </div>
            {/* Las partes que no se exportarán se ven oscurecidas y rayadas. */}
            {gaps.map((g) => (
              <div
                key={g.start}
                className="pointer-events-none absolute inset-y-0 bg-black/75"
                style={{
                  left: pct(g.start),
                  width: pct(g.end - g.start),
                  backgroundImage:
                    'repeating-linear-gradient(135deg, transparent 0 6px, rgba(255,255,255,0.06) 6px 12px)',
                }}
              />
            ))}

            {segments.map((s, i) => (
              <div
                key={i}
                data-index={i}
                className={`absolute inset-y-0 rounded-md border-2 ${
                  i === selected ? 'border-brand-400 bg-brand-500/10' : 'border-neutral-300/60'
                }`}
                style={{ left: pct(s.start), width: pct(s.end - s.start) }}
              >
                <div
                  data-handle="start"
                  data-index={i}
                  className={`absolute inset-y-0 left-0 w-2 cursor-ew-resize ${i === selected ? 'bg-brand-400' : 'bg-neutral-300/60'}`}
                />
                <div
                  data-handle="end"
                  data-index={i}
                  className={`absolute inset-y-0 right-0 w-2 cursor-ew-resize ${i === selected ? 'bg-brand-400' : 'bg-neutral-300/60'}`}
                />
              </div>
            ))}

            <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent-400" style={{ left: pct(currentTime) }}>
              <div className="absolute -top-0.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-accent-400" />
            </div>
          </div>
          </div>
          </div>

          <p className="pt-1 text-xs text-neutral-500">
            Arrastra los bordes de un tramo para recortarlo. Usa <b>Cortar aquí</b> para dividirlo y <b>Eliminar tramo</b>{' '}
            para quitar partes. Ctrl + rueda del ratón amplía la línea de tiempo. Atajos: Espacio, S, Supr, Ctrl+Z, + y −
            (zoom), flechas (±1 s, con Mayús ±5 s).
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/20">
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-sm text-neutral-300">
            Duración final: <span className="font-mono">{formatTime(keptDuration)}</span>
            <span className="text-neutral-500">
              {' '}
              · {segments.length} {segments.length === 1 ? 'tramo' : 'tramos'}
            </span>
          </div>
          {video.hasAudio && (
            <span className="text-sm text-neutral-400">
              {volume === 0 ? 'Sin sonido' : `Volumen: ${Math.round(volume * 100)} %`}
            </span>
          )}
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="ml-auto rounded-lg bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-600/20 transition-opacity hover:opacity-90 disabled:opacity-30 disabled:hover:opacity-30"
          >
            Exportar vídeo
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
              <span className="flex items-center gap-1.5">
                <SpinnerIcon className="h-3.5 w-3.5 text-brand-400" />
                Exportando vídeo
              </span>
              <span>{exportJob.percent || 0}%</span>
            </div>
            <button onClick={handleCancelExport} className="text-xs text-red-400 hover:text-red-300">
              Cancelar
            </button>
          </div>
        )}

        {exportJob?.done && !exportJob.error && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-400">
              <CheckCircleIcon className="h-4 w-4" />
              Vídeo exportado — {formatSize(exportJob.sizeBytes)}
            </p>
            <button
              onClick={() => window.api.openFolder(exportJob.outputPath.split(/[\\/]/).slice(0, -1).join('/'))}
              className={toolButtonClass}
            >
              <FolderIcon className="h-3.5 w-3.5" />
              Abrir carpeta
            </button>
          </div>
        )}

        {exportJob?.done && exportJob.error && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-red-400">
              <XCircleIcon className="h-4 w-4" />
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
