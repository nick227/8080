import { useState } from 'react'
import { capabilities, type Block, type DocumentRecord } from '../types'
import { mediaKind, mediaUrl, setMediaFile } from '../media'
import { notePresence, usePeers } from '../presence'
import { useDocuments } from '../store'

export function BlockEditor({ doc }: { doc: DocumentRecord }) {
  const change = useDocuments((state) => state.change)
  const peers = usePeers()
  const blocks = doc.blocks ?? []
  const [dragId, setDragId] = useState<string | null>(null)
  const media = capabilities(doc).attachMedia
  const hasTitle = blocks.some((block) => block.type === 'title')

  const commit = (next: Block[]) => change(doc.id, (current) => ({ ...current, blocks: next }))

  const move = (id: string, dir: -1 | 1) => {
    const index = blocks.findIndex((block) => block.id === id)
    const target = index + dir
    if (index < 0 || target < 0 || target >= blocks.length) return
    const next = [...blocks]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    commit(next)
  }

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return
    const next = [...blocks]
    const from = next.findIndex((block) => block.id === dragId)
    const to = next.findIndex((block) => block.id === targetId)
    if (from < 0 || to < 0) return
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setDragId(null)
    commit(next)
  }

  const add = (type: Block['type']) => {
    if (type === 'title' && hasTitle) return
    commit([...blocks, { id: crypto.randomUUID(), type, text: type === 'media' ? undefined : '' }])
  }

  return (
    <div className="work-blocks">
      <div className="work-bar">
        {!hasTitle && <button type="button" onClick={() => add('title')}>Title</button>}
        <button type="button" onClick={() => add('paragraph')}>Paragraph</button>
        {media && <button type="button" onClick={() => add('media')}>Media</button>}
      </div>
      {blocks.map((block) => {
        const remote = peers.some((peer) => peer.focus?.kind === 'block' && peer.focus.id === block.id)
        return (
          <article
            key={block.id}
            className="work-block"
            data-type={block.type}
            data-remote={remote ? '' : undefined}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => drop(block.id)}
          >
            <button
              type="button"
              className="work-handle"
              draggable
              aria-label="Drag to reorder"
              onDragStart={() => setDragId(block.id)}
            />
            <div className="work-block-body">
              {block.type === 'media' ? <MediaBlock block={block} onChange={(next) => commit(blocks.map((item) => item.id === block.id ? next : item))} /> : (
                <textarea
                  rows={block.type === 'title' ? 1 : 3}
                  aria-label={block.type === 'title' ? 'Title block' : 'Paragraph'}
                  value={block.text ?? ''}
                  onFocus={() => notePresence({ activity: 'editing', focus: { kind: 'block', id: block.id } })}
                  onBlur={() => notePresence({ activity: 'viewing', focus: null })}
                  onChange={(event) => {
                    notePresence({ activity: 'editing', focus: { kind: 'block', id: block.id } })
                    commit(blocks.map((item) => item.id === block.id ? { ...item, text: event.target.value } : item))
                  }}
                />
              )}
              <div className="work-block-actions">
                <button type="button" aria-label="Move up" onClick={() => move(block.id, -1)}>Up</button>
                <button type="button" aria-label="Move down" onClick={() => move(block.id, 1)}>Down</button>
                <button type="button" onClick={() => commit(blocks.filter((item) => item.id !== block.id))}>Delete</button>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function MediaBlock({ block, onChange }: { block: Block; onChange: (block: Block) => void }) {
  const url = mediaUrl(block.id)
  const take = (file: File | undefined) => {
    if (!file) return
    setMediaFile(block.id, file)
    onChange({ ...block, mediaName: file.name, mediaKind: mediaKind(file) })
  }
  return (
    <div className="work-media">
      {url && block.mediaKind === 'image' && <img src={url} alt="" />}
      {url && block.mediaKind === 'video' && <video src={url} controls />}
      {url && block.mediaKind === 'audio' && <audio src={url} controls />}
      {url && block.mediaKind === 'file' && <p>{block.mediaName}</p>}
      {!url && block.mediaName && <p className="work-missing">Missing · {block.mediaName}</p>}
      <label className="work-upload">
        {block.mediaName ? 'Replace' : 'Upload'}
        <input type="file" onChange={(event) => take(event.target.files?.[0])} />
      </label>
    </div>
  )
}
