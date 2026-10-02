import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApplyIcon, PauseIcon, PlayIcon } from '../../components/icons'
import { primePreviewAudio, releaseStockPreview, stopStockPreview, toggleStockPreview } from './previewAudio'
import { STOCK_TRACKS, type StockTrack } from './stock'

export function EditSheet({ open, trackId, fitting, playing, canPlay, onSelect, onClose, onTogglePlay, onPauseTake }: {
  open: boolean
  trackId: string | null
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

  const preview = (track: StockTrack) => {
    onPauseTake()
    toggleStockPreview(track.id, track.url, setPreviewId)
  }

  const apply = (id: string) => {
    if (id === trackId || fitting) return
    primePreviewAudio()
    stopStockPreview()
    onSelect(id)
  }

  if (!mounted) return null

  return createPortal(
    <aside ref={panelRef} className={shown ? 'edit-sheet is-open' : 'edit-sheet'} role="dialog" aria-label="Edit" tabIndex={-1}>
      <div className="edit-sheet-bar">
        {canPlay ? (
          <button type="button" onClick={onTogglePlay}>{playing ? 'Pause' : 'Play'}</button>
        ) : <span />}
        <span>Edit</span>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <div className="edit-sheet-body">
        <section aria-label="Audio">
          <h2>Audio</h2>
          <p className="edit-sheet-status">Click to replace your audio</p>
          <ul className="edit-sheet-list">
            {STOCK_TRACKS.map(track => {
              const sounding = previewId === track.id
              const applied = trackId === track.id
              return (
                <li key={track.id} className="edit-sheet-row">
                  <button type="button" className="edit-sheet-name" aria-pressed={sounding} onClick={() => preview(track)}>
                    {track.name}
                  </button>
                  <button type="button" className="edit-sheet-icon" aria-label={sounding ? `Pause ${track.name}` : `Play ${track.name}`} aria-pressed={sounding} onClick={() => preview(track)}>
                    {sounding ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <button type="button" className="edit-sheet-icon edit-sheet-apply" aria-label={applied ? `${track.name} applied` : `Apply ${track.name}`} aria-pressed={applied} disabled={fitting} onClick={() => apply(track.id)}>
                    <ApplyIcon />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
      {trackId && (
        <footer className="edit-sheet-foot">
          <button type="button" onClick={() => onSelect(null)}>Remove</button>
        </footer>
      )}
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
