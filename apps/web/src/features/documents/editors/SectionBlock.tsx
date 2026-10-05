import { useLayoutEffect, useRef, useState } from 'react'
import type { FocusEvent } from 'react'
import { mediaUrl } from '../media'
import { notePresence } from '../presence'
import type { Block } from '../types'
import { LEVELS, sectionLevel } from './sectionLevel'

export function SectionBlock({
  block,
  remote,
  takeFocus,
  onTaken,
  onChange,
  onMove,
  onDelete,
}: {
  block: Block
  remote: boolean
  takeFocus: boolean
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

  const hold = (event: { preventDefault: () => void }) => event.preventDefault()

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
        <div className="letter-sizes" role="radiogroup" aria-label="Size">
          {LEVELS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              data-mark={item.label}
              aria-label={item.name}
              aria-checked={level === item.id}
              onMouseDown={hold}
              onClick={() => onChange({ ...block, type: 'section', level: item.id })}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="letter-moves">
          <button type="button" aria-label="Move up" onMouseDown={hold} onClick={() => onMove(-1)}>↑</button>
          <button type="button" aria-label="Move down" onMouseDown={hold} onClick={() => onMove(1)}>↓</button>
          <button type="button" aria-label="Delete" onMouseDown={hold} onClick={onDelete}>×</button>
        </div>
      </div>
      <Figure block={block} url={url} />
      <textarea
        ref={field}
        rows={1}
        aria-label={LEVELS.find((item) => item.id === level)?.name ?? 'Section'}
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
