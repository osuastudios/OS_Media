// OS Media — Made by OSUA Studio
import { useEffect, useState, useCallback } from 'react';
import Header from './components/Header';
import SettingsModal from './components/SettingsModal';
import DownloadTab from './components/DownloadTab';
import GifConverter from './components/GifConverter';
import { VideoIcon, GifIcon } from './components/icons';

const TABS = [
  { key: 'download', label: 'Descargar', icon: VideoIcon },
  { key: 'gif', label: 'Vídeo a GIF', icon: GifIcon },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('download');

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

  const [appVersion, setAppVersion] = useState(null);
  const [updateStatus, setUpdateStatus] = useState({ state: 'idle' });

  useEffect(() => {
    window.api.getSettings().then((settings) => {
      setUseCookies(settings.useCookies);
      setCookiesBrowser(settings.cookiesBrowser);
      setSleepInterval(settings.sleepInterval);
      setFilenameTemplate(settings.filenameTemplate);
    });
    window.api.getAppVersion().then(setAppVersion);
  }, []);

  useEffect(() => {
    const unsub = window.api.onUpdateStatus((status) => {
      setUpdateStatus(status);
      if (status.state === 'available') {
        window.api.downloadUpdate();
      }
    });
    return unsub;
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

  const handleCheckForUpdates = useCallback(async () => {
    setUpdateStatus({ state: 'checking' });
    const result = await window.api.checkForUpdates();
    if (!result.ok) {
      setUpdateStatus({ state: 'error', message: result.error });
    }
  }, []);

  const handleInstallUpdate = useCallback(() => {
    window.api.installUpdate();
  }, []);

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

  return (
    <div className="flex min-h-screen flex-col bg-[#0a0a14] text-neutral-100">
      <Header onOpenSettings={() => setSettingsOpen(true)} />

      <nav className="flex gap-1 border-b border-white/5 px-6 pt-3">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-neutral-900/60 text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      <main className="flex-1 overflow-y-auto px-6 py-6">
        {activeTab === 'download' && <DownloadTab ytDlpVersion={ytDlpVersion} />}
        {activeTab === 'gif' && <GifConverter />}
      </main>

      <footer className="space-y-2 border-t border-white/5 px-6 py-3 text-xs text-neutral-500">
        <div className="flex items-center justify-between">
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
        </div>

        <div className="flex items-center justify-between">
          <span>
            OS Media {appVersion ? `v${appVersion}` : ''}
            {updateStatus.state === 'checking' && ' · Buscando actualizaciones...'}
            {updateStatus.state === 'not-available' && ' · Ya tienes la última versión'}
            {updateStatus.state === 'available' && ` · Hay una versión nueva (v${updateStatus.version})`}
            {updateStatus.state === 'downloading' && ` · Descargando actualización... ${updateStatus.percent || 0}%`}
            {updateStatus.state === 'downloaded' && ` · Actualización v${updateStatus.version} lista para instalar`}
            {updateStatus.state === 'error' && ` · ${updateStatus.message}`}
          </span>

          {updateStatus.state === 'downloaded' ? (
            <button
              onClick={handleInstallUpdate}
              className="rounded-lg bg-gradient-to-r from-logo-pink via-brand-500 to-accent-400 px-3 py-1.5 font-semibold text-white hover:opacity-90"
            >
              Reiniciar y actualizar
            </button>
          ) : (
            <button
              onClick={handleCheckForUpdates}
              disabled={updateStatus.state === 'checking' || updateStatus.state === 'downloading'}
              className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
            >
              Buscar actualizaciones
            </button>
          )}
        </div>
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
