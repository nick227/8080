import { useEffect, useRef, useState, type DragEvent } from 'react'
import {
  ApiError,
  useDeleteRecordImage,
  useRecordImages,
  useReorderRecordImages,
  useSetRecordImagePrimary,
  useUploadRecordImage,
  type RecordImage,
} from '@project/sdk'
import type { RecordGalleryKind } from '@project/sdk'

export function RecordGallery({
  workspaceId,
  kind,
  recordId,
  name,
}: {
  workspaceId: string
  kind: RecordGalleryKind
  recordId: string
  name: string
}) {
  const images = useRecordImages(workspaceId, kind, recordId)
  const upload = useUploadRecordImage(workspaceId, kind, recordId)
  const reorder = useReorderRecordImages(workspaceId, kind, recordId)
  const setPrimary = useSetRecordImagePrimary(workspaceId, kind, recordId)
  const remove = useDeleteRecordImage(workspaceId, kind, recordId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState(false)
  const [error, setError] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const rows = images.data ?? []
  const selected = rows.find((row) => row.id === selectedId) ?? rows.find((row) => row.isPrimary) ?? rows[0]
  useEffect(() => {
    if (selected && !rows.some((row) => row.id === selected.id)) setSelectedId(rows[0]?.id ?? null)
  }, [rows, selected])
  useEffect(() => {
    if (!lightbox) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(false)
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const index = rows.findIndex((row) => row.id === selected?.id)
        if (index < 0) return
        const next = event.key === 'ArrowRight' ? rows[index + 1] ?? rows[0] : rows[index - 1] ?? rows[rows.length - 1]
        if (next) setSelectedId(next.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, rows, selected?.id])

  const fail = (err: unknown) =>
    setError(
      err instanceof ApiError && err.code === 'GALLERY_FULL'
        ? 'This record already has 12 images.'
        : err instanceof Error
          ? err.message
          : 'Could not update the gallery.',
    )

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      const created = await upload.mutateAsync(file)
      setSelectedId(created.id)
    } catch (err) {
      fail(err)
    }
  }

  const onDropReorder = async (overId: string) => {
    if (!dragId || dragId === overId) return
    const ids = rows.map((row) => row.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(overId)
    if (from < 0 || to < 0) return
    ids.splice(from, 1)
    ids.splice(to, 0, dragId)
    setDragId(null)
    setError('')
    try {
      await reorder.mutateAsync(ids)
    } catch (err) {
      fail(err)
    }
  }

  const busy = upload.isPending || reorder.isPending || setPrimary.isPending || remove.isPending

  return (
    <section className="record-gallery" aria-label="Gallery">
      <header className="record-gallery-head">
        <h2>Gallery</h2>
        <span>
          {rows.length}/{12}
        </span>
      </header>
      {selected ? (
        <button type="button" className="record-gallery-hero" onClick={() => setLightbox(true)} disabled={busy}>
          <img src={selected.url} alt="" />
          {selected.isPrimary && <em>Primary</em>}
        </button>
      ) : (
        <button type="button" className="record-gallery-empty" onClick={() => fileRef.current?.click()} disabled={busy}>
          <span aria-hidden="true">
            {name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((word) => word[0])
              .join('')
              .toUpperCase() || '·'}
          </span>
          <strong>Add a photo</strong>
          <small>Products and people both look better with one.</small>
        </button>
      )}
      <div className="record-gallery-strip" role="list">
        {rows.map((row) => (
          <Thumb
            key={row.id}
            row={row}
            active={row.id === selected?.id}
            dragging={dragId === row.id}
            disabled={busy}
            onSelect={() => setSelectedId(row.id)}
            onDragStart={() => setDragId(row.id)}
            onDragEnd={() => setDragId(null)}
            onDrop={() => void onDropReorder(row.id)}
          />
        ))}
        <button
          type="button"
          className="record-gallery-add"
          aria-label="Add image"
          disabled={busy || rows.length >= 12}
          onClick={() => fileRef.current?.click()}
        >
          +
        </button>
      </div>
      {selected && (
        <div className="record-gallery-actions">
          {!selected.isPrimary && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError('')
                setPrimary.mutate(selected.id, { onError: fail })
              }}
            >
              Make primary
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm('Remove this image?')) return
              setError('')
              remove.mutate(selected.id, {
                onSuccess: () => setSelectedId(null),
                onError: fail,
              })
            }}
          >
            Remove
          </button>
        </div>
      )}
      {error && (
        <p className="record-error" role="alert">
          {error}
        </p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          void onFile(file)
        }}
      />
      {lightbox && selected && (
        <div className="record-gallery-lightbox" role="dialog" aria-modal="true" aria-label="Image">
          <button type="button" className="record-gallery-lightbox-close" onClick={() => setLightbox(false)}>
            Close
          </button>
          <img src={selected.url} alt="" />
        </div>
      )}
    </section>
  )
}

function Thumb({
  row,
  active,
  dragging,
  disabled,
  onSelect,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  row: RecordImage
  active: boolean
  dragging: boolean
  disabled: boolean
  onSelect: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDrop: () => void
}) {
  return (
    <button
      type="button"
      role="listitem"
      className="record-gallery-thumb"
      aria-pressed={active}
      data-primary={row.isPrimary || undefined}
      data-dragging={dragging || undefined}
      disabled={disabled}
      draggable={!disabled}
      onClick={onSelect}
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
    >
      <img src={row.url} alt="" draggable={false} />
    </button>
  )
}
