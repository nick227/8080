import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMyWorkspaces } from '@project/sdk'
import { chooseWorkspace, useCurrentWorkspace } from '../../app/workspace'
import { useShell } from '../../state/shell'
import { DESKS, NAV_GROUPS, type Desk } from '../work/sections'
import './command.css'

const OPEN_EVENT = '8080:command-palette'

/** Opens the palette from a visible control (touch has no Ctrl/Cmd+K). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

type Command = { id: string; label: string; hint: string; words: string; run: () => void }

// Extra words people use for a destination (doc 08 §2: automations are found by what they do).
const SYNONYMS: Partial<Record<Desk, string>> = {
  agents: 'automations agents email scheduled email newsletter team brief customer report messaging',
  tasks: 'tasks todo issues tickets work',
  board: 'board kanban columns',
  calendar: 'calendar schedule due dates',
  contacts: 'contacts people customers leads crm',
  inventory: 'inventory products catalog stock items',
  team: 'team members people colleagues',
  documents: 'documents docs files sheets maps',
  company: 'company overview profile settings integrations senders vocabulary',
}

function groupOf(desk: Desk) {
  return NAV_GROUPS.find((g) => g.desks.includes(desk))?.label ?? (desk === 'company' ? 'Company' : 'Stream')
}

/** Cmd/Ctrl+K: jump to any desk, company, the account page or the Lobby. Navigation only. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const openRef = useRef(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { workspace } = useCurrentWorkspace()
  const companies = useMyWorkspaces().data ?? []

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        // Remember where focus was only when opening; when closing it is our own input.
        if (!openRef.current) returnFocus.current = document.activeElement as HTMLElement | null
        setOpen((v) => !v)
      }
    }
    const onOpen = () => {
      if (openRef.current) return
      returnFocus.current = document.activeElement as HTMLElement | null
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_EVENT, onOpen)
    }
  }, [])
  useEffect(() => { openRef.current = open }, [open])
  // Escape closes even before focus has reached the input.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])
  useEffect(() => {
    if (open) { setQuery(''); setActive(0); requestAnimationFrame(() => input.current?.focus()) }
    else returnFocus.current?.focus?.()
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = []
    const room = location.pathname.match(/^\/room\/[^/]+/)?.[0]
    // In a room, desks open in place (its chat stays); elsewhere on the company's own page.
    const goDesk = (desk: Desk, extra: Record<string, string> = {}) => {
      if (room) navigate({ pathname: room, search: new URLSearchParams({ desk, ...extra }).toString() })
      else if (workspace) navigate({ pathname: desk === 'company' ? `/c/${workspace.id}` : `/c/${workspace.id}/${desk}`, search: new URLSearchParams(extra).toString() })
    }
    if (workspace) {
      for (const d of DESKS) {
        if (d.id === 'stream') continue
        const label = d.id === 'company' ? `${workspace.name} overview` : d.label
        list.push({ id: `desk:${d.id}`, label, hint: groupOf(d.id), words: `${label} ${SYNONYMS[d.id] ?? ''}`, run: () => goDesk(d.id) })
      }
      list.push({ id: 'new-automation', label: 'New automation', hint: 'Automations', words: 'new automation create agent schedule email scheduled email newsletter team brief customer report', run: () => goDesk('agents', { add: '1' }) })
      for (const c of companies) {
        if (c.id === workspace.id) continue
        list.push({ id: `company:${c.id}`, label: `Switch to ${c.name}`, hint: 'Company', words: `switch company ${c.name}`, run: () => { chooseWorkspace(c.id); navigate(`/c/${c.id}`) } })
      }
    }
    list.push({ id: 'lobby', label: 'Lobby', hint: 'Conversations', words: 'lobby home conversations rooms stream', run: () => { navigate('/'); useShell.getState().showLobby() } })
    list.push({ id: 'account', label: 'Account', hint: 'You', words: 'account profile name avatar sign out settings', run: () => navigate('/account') })
    return list
  }, [workspace, companies, location.pathname, navigate])

  const shown = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return commands
    return commands.filter((c) => terms.every((t) => c.words.toLowerCase().includes(t) || c.label.toLowerCase().includes(t)))
  }, [commands, query])
  useEffect(() => setActive(0), [query])

  if (!open) return null
  const run = (c: Command | undefined) => {
    if (!c) return
    setOpen(false)
    c.run()
  }
  return (
    <>
      <button type="button" className="command-dismiss" aria-label="Close" tabIndex={-1} onClick={() => setOpen(false)} />
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Go to">
        <input
          ref={input}
          className="command-input"
          role="combobox"
          aria-label="Go to"
          aria-expanded="true"
          aria-controls="command-list"
          aria-activedescendant={shown[active] ? `command-${shown[active].id}` : undefined}
          placeholder="Go to… (try “scheduled email”)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab') e.preventDefault() // modal: focus stays on the input
            else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); run(shown[active]) }
          }}
        />
        <ul id="command-list" role="listbox" className="command-list">
          {shown.length === 0 && <li className="command-empty">No matches.</li>}
          {shown.map((c, i) => (
            <li
              key={c.id}
              id={`command-${c.id}`}
              role="option"
              aria-selected={i === active}
              className="command-option"
              onMouseMove={() => setActive(i)}
              onClick={() => run(c)}
            >
              <span>{c.label}</span>
              <span className="command-hint">{c.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
