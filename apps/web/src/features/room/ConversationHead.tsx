import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadMedia, useDeleteRoom, useUpdateRoom, type Room } from '@project/sdk'
import { useUI } from '../../state/ui'
import { useShell } from '../../state/shell'
import { PlayIcon } from '../../components/icons'
import { pictureOf } from '../../utils/thumbnail'

export function ConversationHead({ room, onPlayAll }: { room: Room; onPlayAll?: () => void }) {
  const owner = room.role === 'owner'
  const update = useUpdateRoom(room.id)
  const remove = useDeleteRoom()
  const navigate = useNavigate()
  const ui = useUI()
  const fileRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(room.title)
  const [description, setDescription] = useState(room.description)
  const [armed, setArmed] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => { setTitle(room.title) }, [room.title])
  useEffect(() => { setDescription(room.description) }, [room.description])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const fail = (error: unknown, fallback: string) => {
    ui.setError(error instanceof Error ? error.message : fallback)
  }

  const cover = preview ?? pictureOf(room.thumbnail)

  const pickCover = (file: File | undefined) => {
    if (!file) return
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current)
      return URL.createObjectURL(file)
    })
    void uploadMedia({ file, type: 'image', name: file.name })
      .then((media) => update.mutateAsync({ thumbnailId: media.id }))
      .then(() => setPreview(null))
      .catch((error: unknown) => fail(error, 'Could not set cover'))
  }

  return (
    <header className="room-head">
      {(cover || owner) && (
        owner ? (
          <button type="button" className="room-cover" aria-label="Change cover" onClick={() => fileRef.current?.click()}>
            {cover ? <img src={cover} alt="" /> : <span>Add cover</span>}
          </button>
        ) : (
          <div className="room-cover">{cover && <img src={cover} alt="" />}</div>
        )
      )}
      {owner && (
        <input
          ref={fileRef}
          className="room-cover-input"
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          aria-label="Cover image"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            pickCover(file)
          }}
        />
      )}
      {owner ? (
        <input
          className="room-head-title"
          aria-label="Conversation name"
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const next = title.trim()
            if (!next || next === room.title) return
            void update.mutateAsync({ title: next }).catch((error: unknown) => fail(error, 'Could not rename'))
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
        />
      ) : (
        <h1 className="room-head-title">{room.title}</h1>
      )}
      {owner ? (
        <textarea
          className="room-head-description"
          aria-label="Description"
          value={description}
          maxLength={4000}
          rows={2}
          placeholder="Description"
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => {
            const next = description.trim()
            if (next === room.description) return
            void update.mutateAsync({ description: next }).catch((error: unknown) => fail(error, 'Could not save description'))
          }}
        />
      ) : (
        room.description.trim() ? <p className="room-head-description">{room.description}</p> : null
      )}
      {(onPlayAll || owner) && (
        <div className="room-head-actions">
          {onPlayAll && (
            <button type="button" className="room-play-all" onClick={onPlayAll}>
              <PlayIcon /> Play all
            </button>
          )}
          {owner && (
            <>
              <button
                type="button"
                aria-pressed={room.visibility === 'private'}
                onClick={() => {
                  const visibility = room.visibility === 'private' ? 'public' : 'private'
                  void update.mutateAsync({ visibility }).catch((error: unknown) => fail(error, 'Could not update visibility'))
                }}
              >
                {room.visibility === 'private' ? 'Private' : 'Public'}
              </button>
              <button
                type="button"
                data-armed={armed || undefined}
                onClick={() => {
                  if (!armed) { setArmed(true); return }
                  void remove.mutateAsync(room.id).then(() => {
                    useShell.getState().enterHome(true)
                    navigate('/')
                  }).catch((error: unknown) => fail(error, 'Could not delete'))
                }}
              >
                {armed ? 'Confirm delete' : 'Delete'}
              </button>
            </>
          )}
        </div>
      )}
    </header>
  )
}
