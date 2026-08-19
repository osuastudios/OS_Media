import { useEffect, useState, useCallback } from 'react';
import Header from './components/Header';
import SettingsModal from './components/SettingsModal';
import {
  FolderIcon,
  VideoIcon,
  MusicIcon,
  CheckCircleIcon,
  XCircleIcon,
  SpinnerIcon,
} from './components/icons';

const QUALITIES = [
  { value: 'best', label: 'Mejor disponible' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
];

export default function App() {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState('video');
  const [quality, setQuality] = useState('best');
  const [destDir, setDestDir] = useState(null);

  const [useCookies, setUseCookies] = useState(false);
  const [cookiesBrowser, setCookiesBrowser] = useState('firefox');
  const [sleepInterval, setSleepInterval] = useState(3);
  const [filenameTemplate, setFilenameTemplate] = useState('%(title)s.%(ext)s');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [ytDlpVersion, setYtDlpVersion] = useState(null);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [denoReady, setDenoReady] = useState(false);
  const [binariesMessage, setBinariesMessage] = useState('Comprobando yt-dlp, ffmpeg y deno...');
  const [updating, setUpdating] = useState(false);

  const [download, setDownload] = useState(null);

  useEffect(() => {
    window.api.getSettings().then((settings) => {
      setDestDir(settings.destDir);
      setUseCookies(settings.useCookies);
      setCookiesBrowser(settings.cookiesBrowser);
      setSleepInterval(settings.sleepInterval);
      setFilenameTemplate(settings.filenameTemplate);
    });
  }, []);

  useEffect(() => {
    const unsubStatus = window.api.onBinariesStatus((status) => {
      if (status.step === 'yt-dlp' && status.state === 'downloading') {
        setBinariesMessage(`Descargando yt-dlp... ${status.progress ? Math.round(status.progress * 100) + '%' : ''}`);
      } else if (status.step === 'ffmpeg' && status.state === 'downloading') {
        setBinariesMessage(`Descargando ffmpeg... ${status.progress ? Math.round(status.progress * 100) + '%' : ''}`);
      } else if (status.step === 'ffmpeg' && status.state === 'extracting') {
        setBinariesMessage('Extrayendo ffmpeg...');
      } else if (status.step === 'deno' && status.state === 'downloading') {
        setBinariesMessage(`Descargando deno... ${status.progress ? Math.round(status.progress * 100) + '%' : ''}`);
      } else if (status.step === 'deno' && status.state === 'extracting') {
        setBinariesMessage('Extrayendo deno...');
      } else if (status.step === 'binaries' && status.state === 'error') {
        setBinariesMessage(`Error preparando binarios: ${status.message}`);
      }
    });

    const unsubReady = window.api.onBinariesReady((info) => {
      setYtDlpVersion(info.ytDlpVersion);
      setFfmpegReady(info.ffmpegReady);
      setDenoReady(info.denoReady);
      setBinariesMessage('Todo listo');
    });

    window.api.getBinariesInfo().then((info) => {
      if (info.ytDlpVersion) {
        setYtDlpVersion(info.ytDlpVersion);
        setFfmpegReady(info.ffmpegReady);
        setDenoReady(info.denoReady);
        setBinariesMessage('Todo listo');
      }
    });

    return () => {
      unsubStatus();
      unsubReady();
    };
  }, []);

  useEffect(() => {
    const unsubProgress = window.api.onDownloadProgress((payload) => {
      setDownload((prev) => (prev && prev.id === payload.id ? { ...prev, ...payload } : prev));
    });
    const unsubDone = window.api.onDownloadDone((payload) => {
      setDownload((prev) => {
        if (!prev || prev.id !== payload.id) return prev;
        if (payload.ok) return { ...prev, done: true, destDir: payload.destDir };
        return { ...prev, done: true, error: payload.message, details: payload.details };
      });
    });
    return () => {
      unsubProgress();
      unsubDone();
    };
  }, []);

  const handleChooseFolder = useCallback(async () => {
    const folder = await window.api.chooseFolder();
    if (folder) setDestDir(folder);
  }, []);

  const handleToggleCookies = useCallback((checked) => {
    setUseCookies(checked);
    window.api.setSettings({ useCookies: checked });
  }, []);

  const handleChangeCookiesBrowser = useCallback((browser) => {
    setCookiesBrowser(browser);
    window.api.setSettings({ cookiesBrowser: browser });
  }, []);

  const handleChangeSleepInterval = useCallback((value) => {
    setSleepInterval(value);
    window.api.setSettings({ sleepInterval: value });
  }, []);

  const handleChangeFilenameTemplate = useCallback((value) => {
    setFilenameTemplate(value);
    window.api.setSettings({ filenameTemplate: value });
  }, []);

  const handleDownload = useCallback(async () => {
    if (!url.trim()) return;
    setDownload({ id: null, percent: '0%', speed: '', eta: '', error: null, done: false, showDetails: false });
    const result = await window.api.startDownload({
      url: url.trim(),
      mode,
      quality,
      destDir,
    });
    setDownload((prev) => ({ ...prev, id: result.id, destDir: result.destDir }));
  }, [url, mode, quality, destDir]);

  const handleCancel = useCallback(() => {
    if (download?.id) {
      window.api.cancelDownload(download.id);
      setDownload(null);
    }
  }, [download]);

  const handleUpdateYtDlp = useCallback(async () => {
    setUpdating(true);
    setBinariesMessage('Actualizando yt-dlp...');
    const result = await window.api.updateYtDlpNow();
    setUpdating(false);
    if (result.ok) {
      setYtDlpVersion(result.version);
      setBinariesMessage(result.updated ? 'yt-dlp actualizado' : 'yt-dlp ya estaba actualizado');
    } else {
      setBinariesMessage(`No se pudo actualizar: ${result.error}`);
    }
  }, []);

  const isDownloading = download && !download.done;

  return (
    <div className="flex min-h-screen flex-col bg-[#0a0a14] text-neutral-100">
      <Header onOpenSettings={() => setSettingsOpen(true)} />

      <main className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
        <section className="space-y-4 rounded-2xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/20">
          <div>
            <label className="mb-1.5 block text-sm text-neutral-400">URL del vídeo</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1.5 block text-sm text-neutral-400">Modo</label>
              <div className="flex overflow-hidden rounded-lg border border-neutral-700 text-sm">
                <button
                  type="button"
                  onClick={() => setMode('video')}
                  className={`flex items-center gap-1.5 px-3 py-2 transition-colors ${
                    mode === 'video'
                      ? 'bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 text-white'
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  <VideoIcon className="h-4 w-4" />
                  Vídeo
                </button>
                <button
                  type="button"
                  onClick={() => setMode('audio')}
                  className={`flex items-center gap-1.5 px-3 py-2 transition-colors ${
                    mode === 'audio'
                      ? 'bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 text-white'
                      : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  <MusicIcon className="h-4 w-4" />
                  MP3
                </button>
              </div>
            </div>

            {mode === 'video' && (
              <div>
                <label className="mb-1.5 block text-sm text-neutral-400">Calidad</label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm"
                >
                  {QUALITIES.map((q) => (
                    <option key={q.value} value={q.value}>
                      {q.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm text-neutral-400">Carpeta de destino</label>
              <button
                onClick={handleChooseFolder}
                className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
              >
                <FolderIcon className="h-4 w-4 text-neutral-400" />
                <span className="max-w-[220px] truncate">{destDir ? destDir : 'Escritorio/OS Media (por defecto)'}</span>
              </button>
            </div>

            <button
              onClick={handleDownload}
              disabled={!url.trim() || isDownloading || !ytDlpVersion}
              className="ml-auto rounded-lg bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-600/20 transition-opacity hover:opacity-90 disabled:opacity-30 disabled:hover:opacity-30"
            >
              Descargar
            </button>
          </div>
        </section>

        {download && (
          <section className="space-y-3 rounded-2xl border border-white/10 bg-neutral-900/60 p-5 shadow-lg shadow-black/20">
            <div className="flex items-center gap-2">
              {!download.done && <SpinnerIcon className="h-4 w-4 shrink-0 text-brand-400" />}
              {download.done && !download.error && <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-400" />}
              {download.done && download.error && <XCircleIcon className="h-4 w-4 shrink-0 text-red-400" />}
              <p className="truncate text-sm text-neutral-300">{url}</p>
            </div>

            {!download.done && (
              <div className="space-y-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 transition-all"
                    style={{ width: download.percent || '0%' }}
                  />
                </div>
                <div className="flex justify-between text-xs text-neutral-400">
                  <span>{download.percent}</span>
                  <span>{download.speed}</span>
                  <span>{download.eta}</span>
                </div>
                <button onClick={handleCancel} className="text-xs text-red-400 hover:text-red-300">
                  Cancelar
                </button>
              </div>
            )}

            {download.done && !download.error && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-emerald-400">Descarga completada</p>
                <button
                  onClick={() => window.api.openFolder(download.destDir)}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700"
                >
                  <FolderIcon className="h-3.5 w-3.5" />
                  Abrir carpeta
                </button>
              </div>
            )}

            {download.done && download.error && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-red-400">{download.error}</p>
                <button
                  onClick={() => setDownload((prev) => ({ ...prev, showDetails: !prev.showDetails }))}
                  className="text-xs text-neutral-400 underline underline-offset-2"
                >
                  {download.showDetails ? 'Ocultar detalles' : 'Ver detalles'}
                </button>
                {download.showDetails && (
                  <pre className="max-h-40 overflow-y-auto rounded-lg bg-black/40 p-3 text-xs text-neutral-500 whitespace-pre-wrap">
                    {download.details}
                  </pre>
                )}
                <button
                  onClick={handleDownload}
                  className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700"
                >
                  Reintentar
                </button>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="flex items-center justify-between border-t border-white/5 px-6 py-3 text-xs text-neutral-500">
        <span>
          yt-dlp: {ytDlpVersion || '—'} · ffmpeg: {ffmpegReady ? 'listo' : '—'} · deno:{' '}
          {denoReady ? 'listo' : '—'} · {binariesMessage}
        </span>
        <button
          onClick={handleUpdateYtDlp}
          disabled={updating}
          className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
        >
          Actualizar yt-dlp ahora
        </button>
      </footer>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        useCookies={useCookies}
        onToggleCookies={handleToggleCookies}
        cookiesBrowser={cookiesBrowser}
        onChangeCookiesBrowser={handleChangeCookiesBrowser}
        sleepInterval={sleepInterval}
        onChangeSleepInterval={handleChangeSleepInterval}
        filenameTemplate={filenameTemplate}
        onChangeFilenameTemplate={handleChangeFilenameTemplate}
      />
    </div>
  );
}
