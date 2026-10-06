import { useEffect, useRef, useState } from 'react'
import { KindMark, MagicIcon, PersonIcon, ImageIcon } from '../../components/icons'
import { PersonName } from '../../components/PersonName'
import { useBackground } from '../../state/background'
import { BackgroundStrip } from './BackgroundStrip'
import { useLocalLive } from './live/localLive'
import type { Seat } from './roomViews'

function Face({ seat, customImage }: { seat: Seat; customImage?: string | null }) {
  const imgUrl = customImage || seat.avatarUrl
  return (
    <>
      <span className="room-seat" data-photo={imgUrl ? '' : undefined} data-activity={seat.activity ?? undefined}>
        {imgUrl ? <img src={imgUrl} alt="" /> : <PersonIcon guest={seat.guest} />}
      </span>
      <PersonName className="room-seat-name" name={seat.name} tag={seat.tag} />
    </>
  )
}

function ScreenMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M5.5 14h5M8 11.5V14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

// Shows the live session's preview element (camera, composited camera, or screen).
// The session lives at room level (live/localLive.ts), so this tile can unmount and
// remount — Grid ↔ Full — without restarting the camera or republishing.
function LivePreview() {
  const preview = useLocalLive((s) => s.preview)
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = containerRef.current
    if (!container || !preview) return
    container.appendChild(preview)
    return () => { if (preview.parentElement === container) container.removeChild(preview) }
  }, [preview])
  return <div ref={containerRef} className="room-seat-media" style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
}

export function SelfTile({ seat }: { seat: Seat }) {
  const kind = useLocalLive((s) => s.kind)
  const starting = useLocalLive((s) => s.starting)
  const error = useLocalLive((s) => s.error)
  const { startCamera, startScreen, stop } = useLocalLive.getState()
  const [menu, setMenu] = useState(false)
  const [customImage, setCustomImage] = useState<string | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const mode = useBackground((s) => s.mode)
  const live = kind !== 'off'

  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      setMenu(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  useEffect(() => { if (kind !== 'camera') setMenu(false) }, [kind])

  const toggleCamera = () => {
    setMenu(false)
    if (kind === 'camera') stop()
    else void startCamera()
  }

  const toggleScreen = () => {
    setMenu(false)
    if (kind === 'screen') stop()
    else void startScreen()
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const url = URL.createObjectURL(file)
      setCustomImage(url)
      stop() // turn off live if they override with an image
    }
    // reset so they can pick the same file again if they want
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div ref={rootRef} className={live ? 'room-cast-face room-self is-live' : 'room-cast-face room-self'} data-recording={live ? 'true' : undefined} data-live={live ? kind : undefined}>
      <div className="room-self-controls">
        <button type="button" aria-label="Upload Image" onClick={() => fileInputRef.current?.click()}>
          <ImageIcon />
        </button>
        <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleImageChange} />

        <button type="button" aria-label="Camera" aria-pressed={kind === 'camera'} disabled={starting} onClick={toggleCamera}>
          {kind === 'camera' ? <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--signal)', margin: 'auto' }} /> : <KindMark kind="video" />}
        </button>
        <button type="button" aria-label="Share screen" aria-pressed={kind === 'screen'} disabled={starting} onClick={toggleScreen}>
          <ScreenMark />
        </button>
        <button type="button" aria-label="Background" aria-pressed={menu || (kind === 'camera' && mode !== 'original')} aria-expanded={menu} disabled={kind !== 'camera'} onClick={() => setMenu((open) => !open)}>
          <MagicIcon />
        </button>
      </div>
      {menu && kind === 'camera' && (
        <div className="room-bg-menu" onClick={() => setMenu(false)}>
          <BackgroundStrip />
        </div>
      )}
      {live ? <LivePreview /> : <Face seat={seat} customImage={customImage} />}
      {live && <PersonName className="room-seat-name" name={seat.name} tag={seat.tag} />}
      {error && !live && <span className="room-live-error" role="status">{error}</span>}
    </div>
  )
}
