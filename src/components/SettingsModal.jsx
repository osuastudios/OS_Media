import { XIcon } from './icons';

const BROWSERS = [
  { value: 'firefox', label: 'Firefox (recomendado)' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'edge', label: 'Edge' },
  { value: 'brave', label: 'Brave' },
];

export default function SettingsModal({
  open,
  onClose,
  useCookies,
  onToggleCookies,
  cookiesBrowser,
  onChangeCookiesBrowser,
  sleepInterval,
  onChangeSleepInterval,
  filenameTemplate,
  onChangeFilenameTemplate,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900 p-6 shadow-2xl shadow-black/50">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold">Ajustes</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-full p-1.5 text-neutral-500 hover:bg-white/5 hover:text-white"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-neutral-200">
              <input
                type="checkbox"
                checked={useCookies}
                onChange={(e) => onToggleCookies(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-600 bg-neutral-800 text-brand-500 focus:ring-brand-500"
              />
              Usar cookies del navegador
            </label>
            <p className="mt-1 text-xs text-neutral-500">Ayuda cuando YouTube bloquea la descarga.</p>
            <select
              value={cookiesBrowser}
              onChange={(e) => onChangeCookiesBrowser(e.target.value)}
              disabled={!useCookies}
              className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm disabled:opacity-40"
            >
              {BROWSERS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-200">Intervalo entre descargas</label>
            <p className="mb-2 text-xs text-neutral-500">
              Segundos de espera antes de cada descarga, para reducir el riesgo de bloqueo.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="60"
                value={sleepInterval}
                onChange={(e) => onChangeSleepInterval(Number(e.target.value))}
                className="w-24 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm"
              />
              <span className="text-xs text-neutral-500">segundos</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-200">Plantilla de nombre de archivo</label>
            <p className="mb-2 text-xs text-neutral-500">
              Usa los marcadores de yt-dlp, p. ej. <code className="text-neutral-400">%(title)s</code>.
            </p>
            <input
              type="text"
              value={filenameTemplate}
              onChange={(e) => onChangeFilenameTemplate(e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 font-mono text-sm"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
