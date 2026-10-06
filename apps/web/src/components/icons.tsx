type MarkProps = { kind: 'audio' | 'video' }

export function LobbyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

export function PersonIcon({ guest }: { guest: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="5.4" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.25" strokeDasharray={guest ? '2.1 1.5' : undefined} />
      <path d="M3.25 13.25c.85-2.15 2.45-3.15 4.75-3.15s3.9 1 4.75 3.15" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

export function MagicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 1.8 9.05 6.15 13.6 8 9.05 9.85 8 14.2 6.95 9.85 2.4 8l4.55-1.85L8 1.8Z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  )
}

export function KindMark({ kind }: MarkProps) {
  if (kind === 'video') {
    return (
      <svg className="kind-mark" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        <rect x="1.5" y="4" width="9" height="8" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <path d="M10.5 7.2 14.2 5.4v5.2L10.5 8.8" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg className="kind-mark" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <rect x="6" y="1.8" width="4" height="7.2" rx="2" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M4.2 7.6a3.8 3.8 0 0 0 7.6 0M8 11.4V14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

export function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M5.2 3.4v9.2L12.6 8 5.2 3.4Z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  )
}

export function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M5.2 3.4v9.2M10.8 3.4v9.2" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

export function ApplyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M3.4 8.2 6.4 11.2 12.6 4.6" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function MinimizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M2 6h8" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

export function ReplyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M6.2 4.2 3 7.4l3.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.4 7.4H9.2a3.4 3.4 0 0 1 3.4 3.4v1" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 450ms cubic-bezier(.22,1,.36,1)' }}>
      <path d="M2.2 4.4 6 8l3.8-3.6" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <circle cx="6.75" cy="6.75" r="4.15" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M10 10.1 13.3 13.4" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

export function ImageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M4.5 7.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M2 10l3.5-3.5L14 11" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M2.4 8h9.2M8.2 4.4 11.8 8 8.2 11.6" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AttachIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M13.2 8.1 7.6 13.7a3.2 3.2 0 0 1-4.5-4.5l6.1-6.1a2.1 2.1 0 0 1 3 3L6.5 11.8a1 1 0 0 1-1.4-1.4l5.2-5.2" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
