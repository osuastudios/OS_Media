import { GearIcon } from './icons';

export default function Header({ onOpenSettings }) {
  return (
    <header className="relative overflow-hidden border-b border-white/5 px-6 py-5">
      <div className="pointer-events-none absolute -top-24 -left-20 h-56 w-56 rounded-full bg-fuchsia-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -top-24 right-10 h-56 w-56 rounded-full bg-accent-500/15 blur-3xl" />

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <img
            src="/favicon.png"
            alt="OS Media"
            className="h-14 w-14 shrink-0 rounded-xl object-cover shadow-lg shadow-brand-600/30 ring-1 ring-white/10"
          />
          <p className="max-w-md text-sm text-neutral-400">
            Bienvenido a <span className="font-semibold text-neutral-200">OsuaStudio Media Tool</span>, desarrollada
            por <span className="font-semibold text-neutral-200">OSUA</span> para sus pequeñas criaturas &lt;3
          </p>
        </div>

        <button
          onClick={onOpenSettings}
          aria-label="Ajustes"
          className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          <GearIcon className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
