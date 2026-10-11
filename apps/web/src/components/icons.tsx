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

export function MaximizeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M3 6.5V3h3.5M13 6.5V3H9.5M3 9.5V13h3.5M13 9.5V13H9.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function GridViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="2" width="5" height="5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <rect x="9" y="2" width="5" height="5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <rect x="2" y="9" width="5" height="5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <rect x="9" y="9" width="5" height="5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.25" />
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

export function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h8A1.5 1.5 0 0 1 14 2.5v11A1.5 1.5 0 0 1 12.5 15h-8A1.5 1.5 0 0 1 3 13.5v-11Z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M6 1v14M8.5 5h3.5M8.5 8.5h3.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

export function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function UserCardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="6" cy="7" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M3.8 11a2.2 2.2 0 0 1 4.4 0M10 6.5h2.5M10 9h2" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

export function BuildingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M2.5 14h11M3.5 14V3.5A1 1 0 0 1 4.5 2.5h7a1 1 0 0 1 1 1V14M6 5.5h1M9 5.5h1M6 8.5h1M9 8.5h1M7.5 14v-2.5h1V14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function GalleryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="5.5" cy="5.5" r="1.25" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M2 11.5l3.5-3.5 3 3 2.5-2.5 3 3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ChartMetricsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M2.5 13.5h11M4 11V7.5M7.5 11V4.5M11 11V2.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M8 5v3.25l2.25 1.25" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function PlugIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M6 2v3M10 2v3M4 5h8v2.5a4 4 0 0 1-8 0V5zM8 11.5v2.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.8.8M11.8 11.8l.8.8M3.4 12.6l.8-.8M11.8 4.2l.8-.8" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

export function IntegrationBrandIcon({ service }: { service: string }) {
  const s = service.toLowerCase()
  if (s.includes('google')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
        <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
        <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.15C3.26 21.3 7.37 24 12 24z"/>
        <path fill="#FBBC05" d="M5.28 14.24c-.25-.72-.38-1.49-.38-2.24s.13-1.52.38-2.24V6.61H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.39l3.99-3.15z"/>
        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.26 2.7 1.29 6.61l3.99 3.15c.95-2.85 3.6-4.96 6.72-4.96z"/>
      </svg>
    )
  }
  if (s.includes('hubspot')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="#FF7A59" style={{ flexShrink: 0 }}>
        <path d="M18.4 8.7a2.7 2.7 0 1 0-2.4 3.9v3.4l-3.2 2a2.3 2.3 0 1 0 1.2 2.1l3.7-2.3a2.7 2.7 0 0 0 3.1-2.4V8.7zm-2.7-3.9a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2zM7.5 10.8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/>
      </svg>
    )
  }
  if (s.includes('linkedin')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="#0A66C2" style={{ flexShrink: 0 }}>
        <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/>
      </svg>
    )
  }
  if (s.includes('meta') || s.includes('facebook')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="#0081FB" style={{ flexShrink: 0 }}>
        <path d="M12 2.04C6.5 2.04 2 6.53 2 12.06C2 17.06 5.66 21.21 10.44 21.96V14.96H7.9V12.06H10.44V9.85C10.44 7.34 11.93 5.96 14.22 5.96C15.31 5.96 16.45 6.15 16.45 6.15V8.62H15.19C13.95 8.62 13.56 9.39 13.56 10.18V12.06H16.34L15.89 14.96H13.56V21.96A10 10 0 0 0 22 12.06C22 6.53 17.5 2.04 12 2.04Z"/>
      </svg>
    )
  }
  if (s.includes('microsoft')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
        <path fill="#F25022" d="M1 1h10v10H1z"/>
        <path fill="#7FBA00" d="M13 1h10v10H13z"/>
        <path fill="#00A4EF" d="M1 13h10v10H1z"/>
        <path fill="#FFB900" d="M13 13h10v10H13z"/>
      </svg>
    )
  }
  if (s.includes('salesforce')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="#00A1E0" style={{ flexShrink: 0 }}>
        <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4c-3.72 0-6.85 2.76-7.46 6.36C1.97 10.74 0 13.14 0 16c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
      </svg>
    )
  }
  if (s.includes('shopify')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="#96BF48" style={{ flexShrink: 0 }}>
        <path d="M15.34 3.96c0 0-1.3-.35-2.58.42l-1.3 3.99h4.37s.24-2.82-.49-4.41zM20.5 7.6l-3.32-.97L13.88 2.2c-.37-.8-1.28-1.24-2.14-1.04C11.37 1.25 7.7 2.3 7.7 2.3s-.54.38-.5.99c.04.57 2.5 2.1 2.5 2.1L4.85 8.92c-.8.26-1.35 1-1.35 1.84l1 10.73c.08.88.8 1.57 1.69 1.57h11.62c.89 0 1.61-.69 1.69-1.57l1-10.73c.09-1-.62-1.92-1.6-2.16z"/>
      </svg>
    )
  }
  if (s.includes('tiktok')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="currentColor" style={{ flexShrink: 0 }}>
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 1 1-5.2-1.74 2.89 2.89 0 0 1 2.31-1.42V9.05a6.34 6.34 0 1 0 6.34 6.34V8.71a8.28 8.28 0 0 0 4.77 1.5V6.69z"/>
      </svg>
    )
  }
  if (s.includes('woocommerce')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="#96588A" style={{ flexShrink: 0 }}>
        <path d="M22 6.5c0-1.93-1.57-3.5-3.5-3.5H5.5C3.57 3 2 4.57 2 6.5v11c0 1.93 1.57 3.5 3.5 3.5h13c1.93 0 3.5-1.57 3.5-3.5v-11zM6.5 15.5L4 8.5h2.5l1.5 4.5 1.8-4.5H12l-3.5 7h-2zM17.5 15.5l-2-4.5-1.5 4.5h-2l3.5-7h2l2.5 7h-2.5z"/>
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

export function WorkflowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2.5" width="3.25" height="11" rx="0.75" stroke="currentColor" strokeWidth="1.25" />
      <rect x="6.5" y="2.5" width="3.25" height="7" rx="0.75" stroke="currentColor" strokeWidth="1.25" />
      <rect x="11" y="2.5" width="3" height="9.5" rx="0.75" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

export function BellIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 1.75a3.25 3.25 0 0 0-3.25 3.25v2.33c0 .54-.2 1.06-.57 1.45l-.76.8a.75.75 0 0 0 .54 1.27h8.08a.75.75 0 0 0 .54-1.27l-.76-.8a2.12 2.12 0 0 1-.58-1.45V5A3.25 3.25 0 0 0 8 1.75Z" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 13.25a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

