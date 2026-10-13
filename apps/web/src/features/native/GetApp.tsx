// The desktop app's way onto a phone: "Get the app" in the masthead, prominent until
// some device gets this person's notifications, then a quiet phone icon. Opt-in only:
// it shows a QR code and steps; permission is asked on the phone, after a tap there.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getPushConfig, useSession } from '@project/sdk'
import { AppQr } from './AppQr'
import { isStandalone, platform } from './install'
import './get-app.css'

export function MobileAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25">
      <rect x="3.75" y="1.5" width="8.5" height="13" rx="1.75" />
      <path d="M6.5 12.25h3" strokeLinecap="round" />
      <path d="M8 4.6v4.2M6.1 7.1 8 9l1.9-1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Featured top-level icon button on mobile masthead */
export function MobileGetAppButton() {
  const [standalone, setStandalone] = useState(false)
  const isMobile = platform() !== 'desktop'

  useEffect(() => {
    setStandalone(isStandalone())
  }, [])

  if (standalone) return null

  return (
    <Link
      to="/native/?install=1"
      className="mast-icon mast-getapp-top"
      data-featured="true"
      data-mobile-device={isMobile || undefined}
      aria-label="Get the app"
      title="Get the 8080 app"
    >
      <MobileAppIcon />
      <span className="mast-getapp-dot" aria-hidden="true" />
    </Link>
  )
}

export function GetAppButton() {
  const session = useSession()
  const user = session.data?.data
  const member = !!user && !user.isGuest
  const config = useQuery({ queryKey: ['push', 'config'], queryFn: getPushConfig, enabled: member, staleTime: 60_000 })
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    void config.refetch()
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh the count each time it opens
  }, [open])

  // On a phone there is nothing to scan: go straight to the app.
  if (platform() !== 'desktop') {
    if (isStandalone()) return null
    return (
      <Link className="mast-getapp" to="/native/?install=1" aria-label="Get the 8080 app">
        <PhoneIcon />
        <span className="mast-getapp-text">Get the app</span>
      </Link>
    )
  }
  if (!member) return null
  const devices = config.data?.devices ?? null
  const none = devices === 0
  const url = `${window.location.origin}/native/?install=1`
  return (
    <div className="getapp" ref={ref}>
      <button
        type="button"
        className="mast-getapp"
        data-attention={none || undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={none ? 'Get the app: notifications on your phone' : '8080 on your phone'}
        title={none ? 'Get notifications on your phone' : `Notifications go to ${devices} device${devices === 1 ? '' : 's'}`}
        onClick={() => setOpen((v) => !v)}
      >
        <PhoneIcon />
        {none && <span className="mast-getapp-text">Get the app</span>}
      </button>
      {open && (
        <div className="getapp-panel" role="dialog" aria-labelledby="getapp-title">
          <h2 id="getapp-title">{none || devices === null ? 'Get notified on your phone' : 'Notifications are on'}</h2>
          <p>
            {none || devices === null
              ? 'Know the moment someone mentions you, replies to you, assigns you a task or your work is blocked, even with 8080 closed.'
              : `Your notifications go to ${devices} device${devices === 1 ? '' : 's'}. Scan to add another.`}
          </p>
          <div className="getapp-body">
            <div className="getapp-qr"><AppQr text={url} /></div>
            <ol className="getapp-steps">
              <li>Scan with your phone’s camera.</li>
              <li>Add 8080 to your home screen (iPhone: Share, then Add to Home Screen).</li>
              <li>Open it and tap <strong>Turn on notifications</strong>.</li>
            </ol>
          </div>
          <a className="getapp-link" href="/native/">Or open the app in this browser</a>
        </div>
      )}
    </div>
  )
}

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="1.5" width="8" height="13" rx="1.5" />
      <path d="M7 12h2" strokeLinecap="round" />
    </svg>
  )
}
