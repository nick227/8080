import { useEffect, useRef, useState } from 'react'
import { useMaybeRoomContext } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { KindMark, MagicIcon, PersonIcon } from '../../components/icons'
import { PersonName } from '../../components/PersonName'
import { useBackground } from '../../state/background'
import { openCamera } from '../previewStream'
import { currentMaskSource, effectiveMode, facingUser, loadMaskSource, startCompositor, type Compositor } from '../virtualCamera'
import { BackgroundStrip } from './BackgroundStrip'
import type { Seat } from './roomViews'

function Face({ seat }: { seat: Seat }) {
  return (
    <>
      <span className="room-seat" data-photo={seat.avatarUrl ? '' : undefined} data-activity={seat.activity ?? undefined}>
        {seat.avatarUrl ? <img src={seat.avatarUrl} alt="" /> : <PersonIcon guest={seat.guest} />}
      </span>
      <PersonName className="room-seat-name" name={seat.name} tag={seat.tag} />
    </>
  )
}

function LiveMediaPreview({ look, onFail }: { look: 'camera' | 'blur' | 'photo'; onFail: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const failRef = useRef(onFail)
  failRef.current = onFail
  const room = useMaybeRoomContext()
  const photoUrl = useBackground((s) => (look === 'photo' ? s.photo?.url ?? null : null))

  useEffect(() => {
    let stream: MediaStream | null = null
    let compositor: Compositor | null = null
    let publishedTrack: MediaStreamTrack | null = null
    let cancelled = false

    const video = document.createElement('video')
    video.autoplay = true
    video.playsInline = true
    video.muted = true
    video.style.width = '100%'
    video.style.height = '100%'
    video.style.objectFit = 'cover'

    const init = async () => {
      try {
        stream = await openCamera('')
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        if (look === 'camera') {
          video.srcObject = stream
          containerRef.current?.appendChild(video)
          publishedTrack = stream.getVideoTracks()[0] ?? null
        } else {
          const source = currentMaskSource() ?? await loadMaskSource()
          const effect = effectiveMode() === 'original' ? look : effectiveMode()
          if (effect === 'original') {
            video.srcObject = stream
            containerRef.current?.appendChild(video)
            publishedTrack = stream.getVideoTracks()[0] ?? null
          } else {
            compositor = startCompositor(
              source,
              stream,
              { mode: effect, photoUrl: effect === 'photo' ? photoUrl : null, mirror: facingUser(stream), fixedSize: true },
              (msg) => console.warn('Compositor unavailable:', msg),
            )
            compositor.preview.style.width = '100%'
            compositor.preview.style.height = '100%'
            compositor.preview.style.objectFit = 'cover'
            containerRef.current?.appendChild(compositor.preview)
            publishedTrack = compositor.stream.getVideoTracks()[0] ?? null
          }
        }
        if (room && publishedTrack) await room.localParticipant.publishTrack(publishedTrack, { name: 'camera', source: Track.Source.Camera })
      } catch (err) {
        console.error('Failed to acquire media:', err)
        failRef.current()
      }
    }

    void init()

    return () => {
      cancelled = true
      if (publishedTrack && room) room.localParticipant.unpublishTrack(publishedTrack).catch(console.error)
      stream?.getTracks().forEach((track) => track.stop())
      compositor?.stop()
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [look, photoUrl, room])

  return <div ref={containerRef} className="room-seat-media" style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
}

export function SelfTile({ seat }: { seat: Seat }) {
  const [cameraOn, setCameraOn] = useState(false)
  const [menu, setMenu] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const mode = useBackground((s) => s.mode)
  const look = !cameraOn || mode === 'original' ? 'camera' : mode

  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      setMenu(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  useEffect(() => {
    if (!cameraOn) return
    const timeout = window.setTimeout(() => {
      setCameraOn(false)
      setMenu(false)
      window.alert('Demo Safety Protection: Your 5-minute streaming limit has been reached to conserve minutes. Premium memberships coming soon!')
    }, 5 * 60 * 1000)
    return () => window.clearTimeout(timeout)
  }, [cameraOn])

  const toggleCamera = () => {
    setMenu(false)
    setCameraOn((on) => !on)
  }

  return (
    <div ref={rootRef} className={cameraOn ? 'room-cast-face room-self is-live' : 'room-cast-face room-self'} data-recording={cameraOn ? 'true' : undefined}>
      <div className="room-self-controls">
        <button type="button" aria-label="Camera" aria-pressed={cameraOn} onClick={toggleCamera}>
          <KindMark kind="video" />
        </button>
        <button type="button" aria-label="Background" aria-pressed={menu || (cameraOn && mode !== 'original')} aria-expanded={menu} disabled={!cameraOn} onClick={() => setMenu((open) => !open)}>
          <MagicIcon />
        </button>
      </div>
      {menu && cameraOn && (
        <div className="room-bg-menu" onClick={() => setMenu(false)}>
          <BackgroundStrip />
        </div>
      )}
      {cameraOn ? <LiveMediaPreview look={look} onFail={() => { setCameraOn(false); setMenu(false) }} /> : <Face seat={seat} />}
      {cameraOn && <PersonName className="room-seat-name" name={seat.name} tag={seat.tag} />}
    </div>
  )
}
