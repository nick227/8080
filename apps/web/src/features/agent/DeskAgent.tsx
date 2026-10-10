import { useEffect, useState } from 'react'
import { useSession } from '@project/sdk'
import { useDocuments } from '../documents/store'
import type { Desk } from '../work/sections'
import { runAgent } from './calendar'
import './agent.css'
import { useCurrentWorkspace } from '../../app/workspace'

type Line = { id: string; who: 'you' | 'agent'; text: string }

export function DeskAgent({ desk, onOpen }: { desk: Desk; onOpen: (desk: Desk) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const session = useSession()
  const ensure = useDocuments((state) => state.ensure)
  const owner = session.data?.data.displayName ?? 'You'
  const companyId = useCurrentWorkspace().workspace?.id ?? null
  useEffect(() => { ensure(owner, companyId) }, [ensure, owner, companyId])

  const send = () => {
    const said = text.trim()
    if (!said) return
    const result = runAgent(desk, said)
    const reply: Line[] = [
      { id: crypto.randomUUID(), who: 'you', text: said },
      { id: crypto.randomUUID(), who: 'agent', text: result.reply },
    ]
    setLines((current) => [...current, ...reply].slice(-8))
    setText('')
    if (result.desk) onOpen(result.desk)
  }

  return (
    <>
      <button
        type="button"
        className="desk-agent-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Ask
      </button>
      {open && (
        <section className="desk-agent" aria-label="Ask">
          <ol>
            {lines.map((line) => (
              <li key={line.id}>
                <span className="who">{line.who === 'you' ? 'You' : 'Ask'}</span>
                <span>{line.text}</span>
              </li>
            ))}
          </ol>
          <form onSubmit={(event) => { event.preventDefault(); send() }}>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Add a task, open a day, dump a sheet"
              aria-label="Ask"
              autoComplete="off"
            />
            <button type="submit" disabled={!text.trim()}>Send</button>
          </form>
        </section>
      )}
    </>
  )
}
