import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { primePreviewAudio, releaseStockPreview, stopStockPreview, toggleStockPreview } from './previewAudio'
import { STOCK_TRACKS, type StockTrack, stockTrack } from './stock'

export function EditSheet({ open, trackId, fitting, sourceLabel, playing, canPlay, onSelect, onClose, onTogglePlay, onPauseTake }: {
  open: boolean
  trackId: string | null
  fitting: boolean
  sourceLabel: string
  playing: boolean
  canPlay: boolean
  onSelect: (id: string | null) => void
  onClose: () => void
  onTogglePlay: () => void
  onPauseTake: () => void
}) {
  const panelRef = useRef<HTMLElement>(null)
  const { mounted, shown } = useSheetPresence(open)
  const [chosenId, setChosenId] = useState<string | null>(trackId)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const status = fitting ? 'Loading' : chosenId ? stockTrack(chosenId).name : sourceLabel
  const canApply = !!chosenId && chosenId !== trackId && !fitting

  useEffect(() => { setChosenId(trackId) }, [trackId])

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

  const apply = () => {
    if (!chosenId || !canApply) return
    primePreviewAudio()
    stopStockPreview()
    onSelect(chosenId)
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
          <p className="edit-sheet-status">{status}</p>
          <ul className="edit-sheet-list">
            {STOCK_TRACKS.map(track => (
              <li key={track.id} className="edit-sheet-row">
                <button
                  type="button"
                  className="edit-sheet-name"
                  aria-pressed={chosenId === track.id}
                  onClick={() => setChosenId(track.id)}
                >
                  {track.name}
                </button>
                <button
                  type="button"
                  className="edit-sheet-preview"
                  aria-pressed={previewId === track.id}
                  onClick={() => preview(track)}
                >
                  {previewId === track.id ? 'Pause' : 'Preview'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <footer className="edit-sheet-foot">
        <button type="button" className="edit-sheet-apply" disabled={!canApply} onClick={apply}>Apply</button>
        {trackId && <button type="button" onClick={() => onSelect(null)}>Remove</button>}
      </footer>
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
