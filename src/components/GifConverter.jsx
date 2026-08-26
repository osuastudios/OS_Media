import { useEffect, useState, useCallback, useRef } from 'react';
import { FolderIcon, UploadIcon, CheckCircleIcon, XCircleIcon, SpinnerIcon } from './icons';

function formatSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

const STAGE_LABELS = {
  palette: 'Analizando colores del vídeo',
  gif: 'Generando el GIF',
};

export default function GifConverter() {
  const [presets, setPresets] = useState({});
  const [presetKey, setPresetKey] = useState('discord');
  const [inputPath, setInputPath] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [conversion, setConversion] = useState(null);
  const dragCounter = useRef(0);

  useEffect(() => {
    window.api.getGifPresets().then((data) => setPresets(data));
  }, []);

  useEffect(() => {
    const unsubProgress = window.api.onGifProgress((payload) => {
      setConversion((prev) => (prev && prev.id === payload.id ? { ...prev, ...payload } : prev));
    });
    const unsubDone = window.api.onGifDone((payload) => {
      setConversion((prev) => {
        if (!prev || prev.id !== payload.id) return prev;
        if (payload.ok) return { ...prev, done: true, outputPath: payload.outputPath, sizeBytes: payload.sizeBytes };
        return { ...prev, done: true, error: payload.message, details: payload.details };
      });
    });
    return () => {
      unsubProgress();
      unsubDone();
    };
  }, []);

  const handleChooseFile = useCallback(async () => {
    const file = await window.api.chooseVideoFile();
    if (file) {
      setInputPath(file);
      setConversion(null);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file?.path) {
      setInputPath(file.path);
      setConversion(null);
    }
  }, []);

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

  const handleConvert = useCallback(async () => {
    if (!inputPath) return;
    setConversion({ id: null, stage: 'palette', percent: 0, done: false, error: null, showDetails: false });
    const result = await window.api.convertToGif({ inputPath, presetKey });
    setConversion((prev) => ({ ...prev, id: result.id }));
  }, [inputPath, presetKey]);

  const handleCancel = useCallback(() => {
    if (conversion?.id) {
      window.api.cancelGifConversion(conversion.id);
      setConversion(null);
    }
  }, [conversion]);

  const isConverting = conversion && !conversion.done;
  const fileName = inputPath ? inputPath.split(/[\\/]/).pop() : null;

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-2xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/20">
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
          {fileName ? (
            <p className="text-sm text-neutral-200">{fileName}</p>
          ) : (
            <>
              <p className="text-sm text-neutral-300">Arrastra un vídeo aquí, o haz clic para elegirlo</p>
              <p className="text-xs text-neutral-500">MP4, MOV, MKV, WEBM, AVI</p>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1.5 block text-sm text-neutral-400">Calidad / tamaño</label>
            <div className="flex overflow-hidden rounded-lg border border-neutral-700 text-sm">
              {Object.entries(presets).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPresetKey(key)}
                  className={`px-3 py-2 transition-colors ${
                    presetKey === key
                      ? 'bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 text-white'
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleConvert}
            disabled={!inputPath || isConverting}
            className="ml-auto rounded-lg bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-600/20 transition-opacity hover:opacity-90 disabled:opacity-30 disabled:hover:opacity-30"
          >
            Convertir a GIF
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          El tamaño final depende de la duración y el movimiento del vídeo — puede superar el objetivo del preset en
          clips largos o con mucha acción.
        </p>
      </section>

      {conversion && (
        <section className="space-y-3 rounded-2xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/20">
          <div className="flex items-center gap-2">
            {!conversion.done && <SpinnerIcon className="h-4 w-4 shrink-0 text-brand-400" />}
            {conversion.done && !conversion.error && <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-400" />}
            {conversion.done && conversion.error && <XCircleIcon className="h-4 w-4 shrink-0 text-red-400" />}
            <p className="truncate text-sm text-neutral-300">{fileName}</p>
          </div>

          {!conversion.done && (
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 transition-all"
                  style={{ width: `${conversion.percent || 0}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-neutral-400">
                <span>{STAGE_LABELS[conversion.stage] || 'Procesando'}</span>
                <span>{conversion.percent || 0}%</span>
              </div>
              <button onClick={handleCancel} className="text-xs text-red-400 hover:text-red-300">
                Cancelar
              </button>
            </div>
          )}

          {conversion.done && !conversion.error && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-emerald-400">
                GIF creado — {formatSize(conversion.sizeBytes)}
              </p>
              <button
                onClick={() => window.api.openFolder(conversion.outputPath.split(/[\\/]/).slice(0, -1).join('/'))}
                className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700"
              >
                <FolderIcon className="h-3.5 w-3.5" />
                Abrir carpeta
              </button>
            </div>
          )}

          {conversion.done && conversion.error && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-red-400">{conversion.error}</p>
              <button
                onClick={() => setConversion((prev) => ({ ...prev, showDetails: !prev.showDetails }))}
                className="text-xs text-neutral-400 underline underline-offset-2"
              >
                {conversion.showDetails ? 'Ocultar detalles' : 'Ver detalles'}
              </button>
              {conversion.showDetails && (
                <pre className="max-h-40 overflow-y-auto rounded-lg bg-black/40 p-3 text-xs text-neutral-500 whitespace-pre-wrap">
                  {conversion.details}
                </pre>
              )}
              <button
                onClick={handleConvert}
                className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700"
              >
                Reintentar
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
