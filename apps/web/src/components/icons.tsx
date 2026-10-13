import type { ReactNode } from 'react'

type MarkProps = { kind: 'audio' | 'video' }

export function LobbyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

export function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
  <circle
    cx="8"
    cy="8"
    r="5.5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
  />
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
  if (s.includes('slack')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
        <path fill="#E01E5A" d="M5.04 14.5a2.5 2.5 0 1 0-2.5 2.5h2.5v-2.5zm1.26 0a2.5 2.5 0 1 0 5 0v-6.3a2.5 2.5 0 1 0-5 0v6.3z"/>
        <path fill="#36C5F0" d="M9.5 5.04a2.5 2.5 0 1 0-2.5-2.5v2.5h2.5zm0 1.26a2.5 2.5 0 1 0 0 5h6.3a2.5 2.5 0 1 0 0-5H9.5z"/>
        <path fill="#2EB67D" d="M18.96 9.5a2.5 2.5 0 1 0 2.5-2.5h-2.5v2.5zm-1.26 0a2.5 2.5 0 1 0-5 0v6.3a2.5 2.5 0 1 0 5 0V9.5z"/>
        <path fill="#ECB22E" d="M14.5 18.96a2.5 2.5 0 1 0 2.5 2.5v-2.5h-2.5zm0-1.26a2.5 2.5 0 1 0 0-5H8.2a2.5 2.5 0 1 0 0 5h6.3z"/>
      </svg>
    )
  }
  if (s.includes('stripe')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="#635BFF" style={{ flexShrink: 0 }}>
        <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C17.652.822 15.04 0 12.056 0 6.541 0 2.873 2.924 2.873 7.828c0 5.438 4.29 6.814 8.71 8.423 2.548.91 3.541 1.608 3.541 2.68 0 .979-.906 1.542-2.316 1.542-2.33 0-5.176-1.127-7.23-2.368l-.94 5.59c1.944 1.139 5.344 1.884 8.337 1.884 5.792 0 9.773-2.775 9.773-7.854 0-5.46-4.307-6.907-8.772-8.575z"/>
      </svg>
    )
  }
  if (s.includes('airtable')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
        <path fill="#FCB400" d="M11.64 1.18 1.48 5.61a.8.8 0 0 0 0 1.46l10.16 4.43a.8.8 0 0 0 .64 0l10.16-4.43a.8.8 0 0 0 0-1.46L12.28 1.18a.8.8 0 0 0-.64 0Z"/>
        <path fill="#18BFFF" d="m12.78 12.83 8.97-3.92a.8.8 0 0 1 1.13.73v7.84a.8.8 0 0 1-.48.73l-8.97 3.92a.8.8 0 0 1-1.13-.73v-7.84a.8.8 0 0 1 .48-.73Z"/>
        <path fill="#ED3140" d="M10.86 12.83 1.89 8.91a.8.8 0 0 0-1.13.73v7.84a.8.8 0 0 0 .48.73l8.97 3.92a.8.8 0 0 0 1.13-.73v-7.84a.8.8 0 0 0-.48-.73Z"/>
      </svg>
    )
  }
  if (s.includes('youtube')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
        <path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/>
        <path fill="#FFFFFF" d="m9.545 15.568 6.273-3.568-6.273-3.568z"/>
      </svg>
    )
  }
  if (s.includes('github')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="currentColor" style={{ flexShrink: 0 }}>
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
      </svg>
    )
  }
  if (s.includes('webhook') || s.includes('api') || s.includes('curl') || s.includes('zapier')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="#FF4F00" style={{ flexShrink: 0 }}>
        <path d="M12 0 1.5 6v12L12 24l10.5-6V6L12 0zm0 2.31 8.5 4.86v9.66L12 21.69 3.5 16.83V7.17L12 2.31zM11 6v5.5H5.5v2H11V19h2v-5.5h5.5v-2H13V6h-2z"/>
      </svg>
    )
  }
  if (s.includes('instagram')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" fill="none" stroke="#E1306C" strokeWidth="2" />
        <circle cx="12" cy="12" r="4.2" fill="none" stroke="#E1306C" strokeWidth="2" />
        <circle cx="17.5" cy="6.5" r="1.2" fill="#E1306C" />
      </svg>
    )
  }
  if (s.includes('whatsapp')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="#25D366" style={{ flexShrink: 0 }}>
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-5.46-4.45-9.92-9.91-9.92zm5.76 14.14c-.24.68-1.2 1.27-1.98 1.44-.53.12-1.22.2-3.54-.76-2.96-1.23-4.87-4.23-5.02-4.43-.14-.19-1.2-1.6-1.2-3.06 0-1.46.74-2.18 1.04-2.49.24-.25.63-.36.98-.36.11 0 .22.01.32.01.28.02.42.04.61.49.24.57.82 2 .89 2.15.07.15.14.35.04.55-.1.2-.17.3-.32.47-.15.17-.31.3-.45.47-.16.18-.33.38-.15.69.18.31.8 1.32 1.71 2.13 1.18 1.05 2.14 1.39 2.45 1.54.31.15.5.12.7-.11.2-.23.85-.99 1.09-1.33.24-.34.48-.29.78-.18.3.11 1.9.9 2.23 1.07.33.17.55.25.62.37.07.12.07.7-.17 1.34z"/>
      </svg>
    )
  }
  if (s.includes('twitter') || s === 'x' || s.startsWith('x-')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="currentColor" style={{ flexShrink: 0 }}>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    )
  }
  if (s.includes('twilio')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="11" fill="#F22F46"/>
        <circle cx="8" cy="8" r="2.2" fill="#fff"/>
        <circle cx="16" cy="8" r="2.2" fill="#fff"/>
        <circle cx="8" cy="16" r="2.2" fill="#fff"/>
        <circle cx="16" cy="16" r="2.2" fill="#fff"/>
      </svg>
    )
  }
  if (s.includes('telegram')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
        <path fill="#24A1DE" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.37.74-.56 2.92-1.27 4.86-2.11 5.83-2.52 2.78-1.16 3.35-1.36 3.73-1.37.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06-.01.19-.03.43z"/>
      </svg>
    )
  }
  if (s.includes('discord')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="#5865F2" style={{ flexShrink: 0 }}>
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
      </svg>
    )
  }
  if (s.includes('threads')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="currentColor" style={{ flexShrink: 0 }}>
        <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.26 18.32 1.48 15.187 1.674 11.19 1.93 5.926 5.602 1.83 11.233 1.06c4.686-.641 9.07 1.432 11.182 5.275 1.159 2.109 1.408 4.673.719 7.412-.905 3.593-3.053 5.326-4.992 5.326-1.442 0-2.476-.893-2.686-2.329.839-.427 1.585-1.025 2.158-1.782.723-.955 1.09-2.096 1.09-3.388 0-3.39-2.584-5.918-6.425-5.918-4.148 0-6.953 2.92-6.953 7.234 0 4.195 2.658 6.945 6.617 6.945 1.821 0 3.395-.49 4.68-1.455.514 1.895 2.234 2.766 4.254 2.766 2.613 0 5.275-2.09 6.376-6.463.816-3.245.541-6.284-.799-8.723C24.08 1.936 18.99-.444 13.486.208 7.027 1.025 2.87 5.765 2.583 11.758c-.216 4.542.666 8.082 2.622 10.521C7.29 24.898 10.45 26.23 14.52 26.23h.007c3.96 0 7.35-1.37 9.81-3.96l-1.92-1.92c-1.94 2.05-4.66 3.14-7.89 3.14z"/>
      </svg>
    )
  }
  if (s.includes('pinterest')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="#E60023" style={{ flexShrink: 0 }}>
        <path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z"/>
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


/* Header destinations (D10): one 16px line set, drawn at 1.25px like the rest. */
function NavSvg({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}

export function NavHomeIcon() {
  return <NavSvg><path d="M2.5 7.25 8 2.75l5.5 4.5" /><path d="M4 6.25v7h3v-3.5h2v3.5h3v-7" /></NavSvg>
}

export function NavDataIcon() {
  return <NavSvg><ellipse cx="8" cy="3.75" rx="5" ry="1.75" /><path d="M3 3.75v8.5c0 .97 2.24 1.75 5 1.75s5-.78 5-1.75v-8.5" /><path d="M3 8c0 .97 2.24 1.75 5 1.75S13 8.97 13 8" /></NavSvg>
}

export function NavBoardIcon() {
  return <NavSvg><rect x="2" y="2.5" width="12" height="11" rx="1.25" /><path d="M6 2.5v11M10 2.5v11" /></NavSvg>
}

export function NavCalendarIcon() {
  return <NavSvg><rect x="2" y="3" width="12" height="10.5" rx="1.25" /><path d="M2 6.5h12M5.25 1.75v2.5M10.75 1.75v2.5" /></NavSvg>
}

export function NavTeamIcon() {
  return <NavSvg><circle cx="6" cy="5.5" r="2.25" /><path d="M1.75 13.25c.4-2.2 2.1-3.5 4.25-3.5s3.85 1.3 4.25 3.5" /><path d="M10.5 3.4a2.25 2.25 0 0 1 0 4.2M11.75 9.9c1.3.45 2.2 1.6 2.5 3.35" /></NavSvg>
}

export function ChatIcon() {
  return <NavSvg><path d="M13.75 7.75a5.5 5.5 0 0 1-5.5 5.5H2.75l1-1.75A5.75 5.75 0 1 1 13.75 7.75Z" /><path d="M5.5 6.5h5M5.5 9h3" /></NavSvg>
}
