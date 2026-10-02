import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApplyIcon, PauseIcon, PlayIcon } from '../../components/icons'
import { primePreviewAudio, releaseStockPreview, stopStockPreview, toggleStockPreview } from './previewAudio'
import { STOCK_TRACKS, STOCK_IMAGES, type StockTrack, type StockImage } from './stock'

export function EditSheet({ open, trackId, pictureKind, fitting, playing, canPlay, onSelect, onClose, onTogglePlay, onPauseTake }: {
  open: boolean
  trackId: string | null
  pictureKind?: 'audio' | 'video' | 'image'
  fitting: boolean
  playing: boolean
  canPlay: boolean
  onSelect: (id: string | null) => void
  onClose: () => void
  onTogglePlay: () => void
  onPauseTake: () => void
}) {
  const panelRef = useRef<HTMLElement>(null)
  const { mounted, shown } = useSheetPresence(open)
  const [previewId, setPreviewId] = useState<string | null>(null)

  useEffect(() => {
    if (shown) panelRef.current?.focus()
  }, [shown])

  useEffect(() => {
    if (!open) stopStockPreview()
  }, [open])

  useEffect(() => () => releaseStockPreview(), [])

  const preview = (track: StockTrack | StockImage) => {
    if (pictureKind === 'audio') return apply(track.id)
    onPauseTake()
    toggleStockPreview(track.id, track.url, setPreviewId)
  }

  const apply = (id: string) => {
    if (fitting) return
    if (id === trackId) {
      onSelect(null)
      return
    }
    primePreviewAudio()
    stopStockPreview()
    onSelect(id)
  }

  if (!mounted) return null

  return createPortal(
    <aside ref={panelRef} className={shown ? 'edit-sheet is-open' : 'edit-sheet'} role="dialog" aria-label="Edit" tabIndex={-1}>
      <div className="edit-sheet-body">
        <section aria-label={pictureKind === 'audio' ? 'Image' : 'Audio'}>
          <h2>{pictureKind === 'audio' ? 'Image' : 'Audio'}</h2>
          <p className="edit-sheet-status">{pictureKind === 'audio' ? 'Add a stock image' : 'Replace your audio'}</p>
          <ul className="edit-sheet-list">
            {(pictureKind === 'audio' ? STOCK_IMAGES : STOCK_TRACKS).map(track => {
              const sounding = previewId === track.id
              const applied = trackId === track.id
              return (
                <li key={track.id} className="edit-sheet-row">
                  <button type="button" className="edit-sheet-name" aria-pressed={sounding} onClick={() => preview(track)}>
                    {track.name}
                  </button>
                  {pictureKind !== 'audio' && (
                    <button type="button" className="edit-sheet-icon" aria-label={sounding ? `Pause ${track.name}` : `Play ${track.name}`} aria-pressed={sounding} onClick={() => preview(track as StockTrack)}>
                      {sounding ? <PauseIcon /> : <PlayIcon />}
                    </button>
                  )}
                  <button type="button" className="edit-sheet-icon edit-sheet-apply" aria-label={applied ? `${track.name} applied` : `Apply ${track.name}`} aria-pressed={applied} disabled={fitting} onClick={() => apply(track.id)}>
                    <ApplyIcon />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
      <div className="edit-sheet-bar">
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </aside>,
    document.body,
  )
}

function useSheetPresence(open: boolean) {
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!open) {
      setShown(false)
      const timer = window.setTimeout(() => setMounted(false), 220)
      return () => window.clearTimeout(timer)
    }
    setMounted(true)
  }, [open])

  useEffect(() => {
    if (!mounted || !open) return
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [mounted, open])

  return { mounted, shown }
}
