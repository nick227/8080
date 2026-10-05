import { useLayoutEffect, useRef, useState } from 'react'
import type { FocusEvent } from 'react'
import { mediaKind, mediaUrl, setMediaFile } from '../media'
import { notePresence } from '../presence'
import type { Block } from '../types'
import { LEVELS, sectionLevel } from './sectionLevel'

export function SectionBlock({
  block,
  remote,
  takeFocus,
  canAttach,
  onTaken,
  onChange,
  onMove,
  onDelete,
}: {
  block: Block
  remote: boolean
  takeFocus: boolean
  canAttach: boolean
  onTaken: () => void
  onChange: (block: Block) => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
}) {
  const level = sectionLevel(block)
  const field = useRef<HTMLTextAreaElement>(null)
  const [open, setOpen] = useState(false)
  const url = mediaUrl(block.id)

  useLayoutEffect(() => {
    const node = field.current
    if (!node) return
    node.style.height = '0px'
    node.style.height = `${node.scrollHeight}px`
  }, [block.text, level])

  const taken = useRef(onTaken)
  taken.current = onTaken
  useLayoutEffect(() => {
    if (!takeFocus || !field.current) return
    setOpen(true)
    field.current.focus()
    taken.current()
  }, [takeFocus])

  const closeIfLeft = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }

  const take = (file: File | undefined) => {
    if (!file) return
    setMediaFile(block.id, file)
    onChange({ ...block, type: 'section', level, mediaName: file.name, mediaKind: mediaKind(file) })
  }

  const clearMedia = () => {
    const next = { ...block, type: 'section' as const, level }
    delete next.mediaName
    delete next.mediaKind
    onChange(next)
  }

  return (
    <section
      className="letter-section"
      data-level={level}
      data-open={open ? '' : undefined}
      data-remote={remote ? '' : undefined}
      onMouseDown={() => setOpen(true)}
      onBlur={closeIfLeft}
    >
      <div className="letter-tools" inert={!open}>
        <div className="letter-sizes" role="radiogroup" aria-label="Heading size">
          {LEVELS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={level === item.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange({ ...block, type: 'section', level: item.id })}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button type="button" aria-label="Move up" onMouseDown={(event) => event.preventDefault()} onClick={() => onMove(-1)}>Up</button>
        <button type="button" aria-label="Move down" onMouseDown={(event) => event.preventDefault()} onClick={() => onMove(1)}>Down</button>
        {canAttach && (
          <label className="letter-file">
            {block.mediaName ? 'Replace' : 'Attach'}
            <input type="file" onChange={(event) => take(event.target.files?.[0])} />
          </label>
        )}
        {block.mediaName && (
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={clearMedia}>Remove</button>
        )}
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onDelete}>Delete</button>
      </div>
      <Figure block={block} url={url} />
      <textarea
        ref={field}
        rows={1}
        aria-label={LEVELS.find((item) => item.id === level)?.label ?? 'Section'}
        value={block.text ?? ''}
        onFocus={() => { setOpen(true); notePresence({ activity: 'editing', focus: { kind: 'block', id: block.id } }) }}
        onBlur={() => notePresence({ activity: 'viewing', focus: null })}
        onChange={(event) => {
          notePresence({ activity: 'editing', focus: { kind: 'block', id: block.id } })
          onChange({ ...block, text: event.target.value })
        }}
      />
    </section>
  )
}

function Figure({ block, url }: { block: Block; url: string | undefined }) {
  if (!block.mediaName && !url) return null
  if (url && block.mediaKind === 'image') return <figure className="letter-figure"><img src={url} alt="" /></figure>
  if (url && block.mediaKind === 'video') return <figure className="letter-figure"><video src={url} controls /></figure>
  if (url && block.mediaKind === 'audio') return <figure className="letter-figure"><audio src={url} controls /></figure>
  if (url && block.mediaKind === 'file') return <p className="letter-file-name">{block.mediaName}</p>
  return <p className="letter-missing">{block.mediaName} is missing on this device</p>
}
