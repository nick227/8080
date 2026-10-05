import { useRef, type MouseEvent } from 'react'
import { capabilities, type Block, type DocumentRecord } from '../types'
import { usePeers } from '../presence'
import { useDocuments } from '../store'
import { usePresence, type Person } from '../liveBlocks'
import { SectionBlock } from './SectionBlock'
import '../live.css'
import './letter.css'

export function BlockEditor({ doc }: { doc: DocumentRecord }) {
  const change = useDocuments((state) => state.change)
  const me = useDocuments((state) => state.me)
  const status = useDocuments((state) => state.status)
  const live = doc.shared?.kind === 'native'
  const others = usePresence((state) => state.people[doc.id] ?? NOBODY).filter((person) => person.memberId !== me)
  const peers = usePeers()
  const blocks = doc.blocks ?? []
  const pending = useRef<string | null>(null)
  const media = capabilities(doc).attachMedia

  const edit = (recipe: (blocks: Block[]) => Block[]) => {
    change(doc.id, (current) => ({ ...current, blocks: recipe(current.blocks ?? []) }))
  }

  const add = () => {
    const id = crypto.randomUUID()
    pending.current = id
    edit((current) => [...current, { id, type: 'section', level: 'body', text: '' }])
  }

  const focusPage = (event: MouseEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    const areas = event.currentTarget.querySelectorAll('textarea')
    const last = areas[areas.length - 1] as HTMLTextAreaElement | undefined
    if (last) last.focus()
    else add()
  }

  return (
    <div className="letter-desk">
      <div className="letter-scroll">
        {live && (
          <div className="work-sync">
            <span className="work-presence" aria-live="polite">{others.length ? presenceLine(others) : ''}</span>
            <span className="work-sync-state" role="status" data-conflict={/^Conflict/.test(status) ? '' : undefined}>{status}</span>
          </div>
        )}
        <article className="letter-sheet" aria-label="Page" onMouseDown={focusPage}>
          {blocks.map((block) => (
            <SectionBlock
              key={block.id}
              block={block}
              remote={peers.some((peer) => peer.focus?.kind === 'block' && peer.focus.id === block.id)}
              takeFocus={pending.current === block.id}
              canAttach={media}
              onTaken={() => { pending.current = null }}
              onChange={(next) => edit((current) => current.map((item) => item.id === block.id ? next : item))}
              onMove={(dir) => edit((current) => move(current, block.id, dir))}
              onDelete={() => edit((current) => current.filter((item) => item.id !== block.id))}
            />
          ))}
        </article>
      </div>
      <button type="button" className="letter-add" aria-label="Add section" onClick={add}>+</button>
    </div>
  )
}

const NOBODY: Person[] = []

function move(blocks: Block[], id: string, dir: -1 | 1) {
  const index = blocks.findIndex((block) => block.id === id)
  const target = index + dir
  if (index < 0 || target < 0 || target >= blocks.length) return blocks
  const next = [...blocks]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

function presenceLine(others: Person[]) {
  const names = (list: Person[]) => list.map((person) => person.name).join(', ')
  const editing = others.filter((person) => person.editing)
  if (editing.length) return `${names(editing)} ${editing.length === 1 ? 'is' : 'are'} editing`
  return `${names(others)} ${others.length === 1 ? 'is' : 'are'} here`
}
