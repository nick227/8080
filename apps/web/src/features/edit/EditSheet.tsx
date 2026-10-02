import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { primePreviewAudio } from './previewAudio'
import { STOCK_TRACKS, stockTrack } from './stock'

export function EditSheet({ open, trackId, fitting, sourceLabel, playing, canPlay, onSelect, onReplay, onClose, onTogglePlay }: {
  open: boolean
  trackId: string | null
  fitting: boolean
  sourceLabel: string
  playing: boolean
  canPlay: boolean
  onSelect: (id: string | null) => void
  onReplay: () => void
  onClose: () => void
  onTogglePlay: () => void
}) {
  const panelRef = useRef<HTMLElement>(null)
  const { mounted, shown } = useSheetPresence(open)
  const status = fitting ? 'Loading' : trackId ? stockTrack(trackId).name : sourceLabel

  useEffect(() => {
    if (shown) panelRef.current?.focus()
  }, [shown])

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
          <p className="edit-sheet-status">{status}</p>
          <ul className="edit-sheet-list">
            {STOCK_TRACKS.map(track => (
              <li key={track.id}>
                <button
                  type="button"
                  aria-current={trackId === track.id ? 'true' : undefined}
                  onClick={() => {
                    primePreviewAudio()
                    if (trackId === track.id) {
                      if (!fitting) onReplay()
                      return
                    }
                    onSelect(track.id)
                  }}
                >
                  {track.name}
                </button>
              </li>
            ))}
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
