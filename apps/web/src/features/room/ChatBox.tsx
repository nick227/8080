import { useEffect, useRef, useState } from 'react'
import type { LocalMedia, SendInput } from '../../api/types'
import { AttachIcon, KindMark, SendIcon } from '../../components/icons'
import { attachmentError, attachmentKind, takeYouTube, type ChatAttachment } from './chatDraft'

export function ChatBox({ onSend, onRecord }: { onSend: (input: SendInput) => Promise<boolean>, onRecord?: () => void }) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<ChatAttachment[]>([])
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const box = useRef<HTMLFormElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const depth = useRef(0)
  const youtube = takeYouTube(text).drafts.length
  const canSend = !busy && (!!text.trim() || files.length > 0)

  useEffect(() => {
    const rail = box.current?.closest('.room-rail')
    if (!rail) return
    const enter = (event: Event) => {
      const drag = event as DragEvent
      if (!drag.dataTransfer?.types.includes('Files')) return
      drag.preventDefault()
      depth.current += 1
      setOver(true)
    }
    const overing = (event: Event) => {
      const drag = event as DragEvent
      if (!drag.dataTransfer?.types.includes('Files')) return
      drag.preventDefault()
    }
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setOver(false)
    }
    const drop = (event: Event) => {
      const drag = event as DragEvent
      drag.preventDefault()
      depth.current = 0
      setOver(false)
      add(drag.dataTransfer?.files)
    }
    rail.addEventListener('dragenter', enter)
    rail.addEventListener('dragover', overing)
    rail.addEventListener('dragleave', leave)
    rail.addEventListener('drop', drop)
    return () => {
      rail.removeEventListener('dragenter', enter)
      rail.removeEventListener('dragover', overing)
      rail.removeEventListener('dragleave', leave)
      rail.removeEventListener('drop', drop)
    }
  }, [])

  const add = (list: FileList | null | undefined) => {
    if (!list?.length) return
    const next: ChatAttachment[] = []
    for (const file of list) {
      const problem = attachmentError(file)
      if (problem) { setError(problem); continue }
      const type = attachmentKind(file)
      next.push({ id: crypto.randomUUID(), file, type, previewUrl: type === 'image' ? URL.createObjectURL(file) : undefined })
    }
    if (next.length) setFiles((current) => [...current, ...next].slice(0, 10))
  }

  const remove = (id: string) => {
    setFiles((current) => {
      const found = current.find((file) => file.id === id)
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl)
      return current.filter((file) => file.id !== id)
    })
  }

  const send = async () => {
    const parsed = takeYouTube(text)
    const media: SendInput['media'] = [
      ...parsed.drafts,
      ...files.map((file): LocalMedia => ({ file: file.file, type: file.type, name: file.file.name })),
    ]
    if (!parsed.text && !media?.length) return
    setBusy(true)
    setError(undefined)
    try {
      const sent = await onSend({ text: parsed.text, media })
      if (!sent) return
      for (const file of files) if (file.previewUrl) URL.revokeObjectURL(file.previewUrl)
      setText('')
      setFiles([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setBusy(false)
      field.current?.focus()
    }
  }

  return (
    <form ref={box} className="room-chatbox" data-over={over || undefined} onSubmit={(event) => { event.preventDefault(); void send() }}>
      {over && <p className="room-chatbox-over">Drop to attach</p>}
      {files.length > 0 && (
        <ul className="room-chatbox-files">
          {files.map((file) => (
            <li key={file.id}>
              {file.previewUrl ? <img src={file.previewUrl} alt="" /> : <span>{file.type}</span>}
              <span>{file.file.name}</span>
              <button type="button" onClick={() => remove(file.id)} aria-label={`Remove ${file.file.name}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      {youtube > 0 && <p className="room-chatbox-link">{youtube === 1 ? 'YouTube link' : `${youtube} YouTube links`}</p>}
      <div className="room-chatbox-field">
        <textarea
          ref={field}
          rows={3}
          value={text}
          placeholder="Message"
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => { if (event.clipboardData.files.length) { event.preventDefault(); add(event.clipboardData.files) } }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <div className="room-chatbox-actions">
          {onRecord && (
            <button type="button" className="room-chatbox-tool" onClick={onRecord} aria-label="Record">
              <KindMark kind="audio" />
            </button>
          )}
          <label className="room-chatbox-tool" aria-label="Attach">
            <AttachIcon />
            <input type="file" multiple accept="image/*,video/*,audio/*,.pdf" onChange={(event) => { add(event.target.files); event.target.value = '' }} />
          </label>
          <button type="submit" className="room-chatbox-send" disabled={!canSend} aria-label="Send">
            <SendIcon />
          </button>
        </div>
      </div>
      {error && <p className="room-chatbox-error" role="alert">{error}</p>}
    </form>
  )
}
