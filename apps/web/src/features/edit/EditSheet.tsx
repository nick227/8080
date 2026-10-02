import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApplyIcon, PauseIcon, PlayIcon } from '../../components/icons'
import { primePreviewAudio, releaseStockPreview, stopStockPreview, toggleStockPreview } from './previewAudio'
import { STOCK_IMAGES, STOCK_TRACKS, type StockImage, type StockTrack } from './stock'

type PictureKind = 'audio' | 'video' | 'image' | 'text'

export function EditSheet({ open, trackId, pictureKind, uploadUrl, fitting, onSelect, onUpload, onClose, onPauseTake }: {
  open: boolean
  trackId: string | null
  pictureKind?: PictureKind
  uploadUrl?: string | null
  fitting: boolean
  onSelect: (id: string | null) => void
  onUpload: (file: File) => void
  onClose: () => void
  onPauseTake: () => void
}) {
  const panelRef = useRef<HTMLElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { mounted, shown } = useSheetPresence(open)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const stills = pictureKind === 'audio' || pictureKind === 'text'

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

  const images: StockImage[] = uploadUrl
    ? [...STOCK_IMAGES, { id: 'upload', name: 'Yours', url: uploadUrl }]
    : STOCK_IMAGES

  return createPortal(
    <aside ref={panelRef} className={shown ? 'edit-sheet is-open' : 'edit-sheet'} role="dialog" aria-label="Edit" tabIndex={-1}>
      <div className="edit-sheet-body">
        <section aria-label={stills ? 'Image' : 'Audio'}>
          <h2>{stills ? 'Image' : 'Audio'}</h2>
          <p className="edit-sheet-status">{stills ? (pictureKind === 'text' ? 'Place behind your text' : 'Add a stock image') : 'Replace your audio'}</p>
          {stills ? (
            <>
              <ul className="edit-sheet-stills">
                {images.map(image => {
                  const applied = trackId === image.id
                  return (
                    <li key={image.id}>
                      <button type="button" className="edit-sheet-still" aria-pressed={applied} disabled={fitting} onClick={() => (image.id === 'upload' ? onSelect(null) : apply(image.id))}>
                        <img src={image.url} alt="" />
                        <span>{image.name}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <button type="button" className="edit-sheet-upload" disabled={fitting} onClick={() => fileRef.current?.click()}>Upload image</button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                stopStockPreview()
                onUpload(file)
              }} />
            </>
          ) : (
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
          )}
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
