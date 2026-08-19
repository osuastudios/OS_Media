export function GearIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="3.2" />
      <path
        strokeLinecap="round"
        d="M19.4 13a7.6 7.6 0 0 0 0-2l1.9-1.5-2-3.4-2.3.7a7.7 7.7 0 0 0-1.7-1L14.9 3h-4l-.4 2.8a7.7 7.7 0 0 0-1.7 1l-2.3-.7-2 3.4L6.4 11a7.6 7.6 0 0 0 0 2l-1.9 1.5 2 3.4 2.3-.7c.5.4 1.1.75 1.7 1l.4 2.8h4l.4-2.8c.6-.25 1.2-.6 1.7-1l2.3.7 2-3.4-1.9-1.5Z"
      />
    </svg>
  );
}

export function FolderIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.1l1.6 2h8.3a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-10.5Z"
      />
    </svg>
  );
}

export function VideoIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="6" width="12" height="12" rx="2" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m15 10 5.2-3v10L15 14" />
    </svg>
  );
}

export function MusicIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 18V5.5l10-2v12.5" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </svg>
  );
}

export function CheckCircleIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12.5 2.3 2.3 4.7-5.1" />
    </svg>
  );
}

export function XCircleIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="m9 9 6 6M15 9l-6 6" />
    </svg>
  );
}

export function SpinnerIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin ${className || ''}`} fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

export function XIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}
