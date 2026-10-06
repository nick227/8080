import type { Block, DocumentRecord } from './types'
import { dismissRecovered, useRecovery, type Recovered } from './liveBlocks'
import { useDocuments } from './store'

const NONE: Recovered[] = []

// Text that lost a same-block conflict (liveBlocks.ts). Adding it back inserts a new
// section right after the contested one — the other person's text stays as it is.
export function ConflictRecovery({ doc }: { doc: DocumentRecord }) {
  const items = useRecovery((state) => state.items[doc.id] ?? NONE)
  const change = useDocuments((state) => state.change)
  if (!items.length) return null

  const restore = (item: Recovered) => {
    change(doc.id, (current) => {
      const blocks = current.blocks ?? []
      const section: Block = { id: crypto.randomUUID(), type: 'section', level: 'body', text: item.text }
      const at = blocks.findIndex((block) => block.id === item.blockId)
      const next = at < 0 ? [...blocks, section] : [...blocks.slice(0, at + 1), section, ...blocks.slice(at + 1)]
      return { ...current, blocks: next }
    })
    dismissRecovered(doc.id, item.id)
  }

  return (
    <section className="work-recovery" aria-label="Your unsaved text">
      {items.map((item) => (
        <div key={item.id} className="work-recovery-item">
          <p className="work-recovery-label">Your unsaved text · {item.by} changed this section first</p>
          <blockquote className="work-recovery-text">{item.text}</blockquote>
          <div className="work-recovery-actions">
            <button type="button" onClick={() => restore(item)}>Add as new section</button>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(item.text)}>Copy</button>
            <button type="button" onClick={() => dismissRecovered(doc.id, item.id)}>Dismiss</button>
          </div>
        </div>
      ))}
    </section>
  )
}
