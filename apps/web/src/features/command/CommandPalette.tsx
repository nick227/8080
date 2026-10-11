import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getApiClient, unwrap, useContacts, useInventory, useMyWorkspaces, useTasks } from '@project/sdk'
import { useQuery } from '@tanstack/react-query'
import { chooseWorkspace, useCurrentWorkspace } from '../../app/workspace'
import { useShell } from '../../state/shell'
import { useDocuments } from '../documents/store'
import { matches } from '../collections/table'
import { DESKS, isCollection, type Desk } from '../work/sections'
import './command.css'

const OPEN_EVENT = '8080:command-palette'

/** Opens the palette from a visible control (touch has no Ctrl/Cmd+K). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

/** `group` heads its section of the list; `detail` is a muted second part (a contact's email). */
type Command = { id: string; label: string; hint: string; words: string; run: () => void; group?: string; detail?: string }

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
  return isCollection(desk) ? 'List' : desk === 'company' ? 'Company' : desk === 'board' || desk === 'calendar' ? 'Work' : 'Stream'
}

const RECORD_LIMIT = 5
const PLACES = 'Go to'

/**
 * Records matching the query (Phase 4): contacts, inventory and documents searched by
 * the API, tasks matched in the cached list. Only while the palette is open and the
 * query has two or more characters; waits for typing to pause. `pending` until the
 * results for the current text are in: earlier results are never shown (Enter would
 * open them).
 */
function useRecordResults(workspaceId: string | undefined, query: string, open: boolean): { records: Command[]; pending: boolean } {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const text = open ? query.trim() : ''
  useEffect(() => {
    // Closing clears at once, so reopening never repeats the last search.
    if (!text) { setQ(''); return }
    const timer = window.setTimeout(() => setQ(text), 200)
    return () => window.clearTimeout(timer)
  }, [text])
  const id = q.length >= 2 ? workspaceId : undefined
  const contacts = useContacts(id, { q, limit: RECORD_LIMIT })
  const inventory = useInventory(id, { q, limit: RECORD_LIMIT })
  const tasks = useTasks(id)
  const documents = useQuery({
    queryKey: ['palette-documents', id ?? '', q],
    enabled: !!id,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/documents', { params: { path: { workspaceId: id! }, query: { q } } })).data,
  })
  const searching = !!workspaceId && text.length >= 2
  const current = searching && q === text
  const fetching = contacts.isFetching || inventory.isFetching || documents.isFetching || tasks.isLoading
  const records = useMemo(() => {
    if (!current || !id) return []
    const list: Command[] = []
    for (const t of (tasks.data ?? []).filter((t) => matches(q, t.taskKey, t.title)).slice(0, RECORD_LIMIT)) {
      list.push({ id: `task:${t.id}`, group: 'Tasks', label: t.title, detail: t.taskKey, hint: 'Task', words: '', run: () => navigate(`/c/${id}/tasks/${encodeURIComponent(t.taskKey)}`) })
    }
    for (const c of contacts.data?.pages[0]?.data ?? []) {
      const detail = c.primaryEmail ?? c.accounts?.[0]?.name ?? c.title ?? undefined
      list.push({ id: `contact:${c.id}`, group: 'Contacts', label: c.displayName, detail, hint: 'Contact', words: '', run: () => navigate({ pathname: `/c/${id}/contacts`, search: `?record=${encodeURIComponent(c.id)}` }) })
    }
    for (const d of (documents.data ?? []).slice(0, RECORD_LIMIT)) {
      list.push({ id: `document:${d.id}`, group: 'Documents', label: d.title || 'Untitled', hint: 'Document', words: '', run: () => { void useDocuments.getState().openFromLink(id, d.id).finally(() => navigate(`/c/${id}/documents`)) } })
    }
    for (const item of inventory.data?.pages[0]?.data ?? []) {
      list.push({ id: `inventory:${item.id}`, group: 'Inventory', label: item.name, detail: item.sku ?? undefined, hint: 'Item', words: '', run: () => navigate({ pathname: `/c/${id}/inventory`, search: `?record=${encodeURIComponent(item.id)}` }) })
    }
    return list
  }, [current, id, q, tasks.data, contacts.data, documents.data, inventory.data, navigate])
  return { records, pending: searching && (!current || fetching) }
}

/** Cmd/Ctrl+K: jump to any desk, company, record, the account page or the Lobby. Navigation only. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const openRef = useRef(false)
  const navigate = useNavigate()
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
    // Desks live on the company's page (its channel is in the rail there).
    const goDesk = (desk: Desk, extra: Record<string, string> = {}) => {
      if (workspace) navigate({ pathname: desk === 'company' ? `/c/${workspace.id}` : `/c/${workspace.id}/${desk}`, search: new URLSearchParams(extra).toString() })
    }
    if (workspace) {
      for (const d of DESKS) {
        if (d.id === 'stream') continue
        const label = d.id === 'company' ? `${workspace.name} overview` : d.label
        list.push({ id: `desk:${d.id}`, label, hint: groupOf(d.id), words: `${label} ${SYNONYMS[d.id] ?? ''}`, run: () => goDesk(d.id) })
      }
      list.push({ id: 'conversations', label: `${workspace.name} channel`, hint: 'Stream', words: 'channel company channel stream chat conversation', run: () => navigate(`/c/${workspace.id}/conversations`) })
      list.push({ id: 'new-automation', label: 'New automation', hint: 'Automations', words: 'new automation create agent schedule email scheduled email newsletter team brief customer report', run: () => goDesk('agents', { add: '1' }) })
      for (const c of companies) {
        if (c.id === workspace.id) continue
        list.push({ id: `company:${c.id}`, label: `Switch to ${c.name}`, hint: 'Company', words: `switch company ${c.name}`, run: () => { chooseWorkspace(c.id); navigate(`/c/${c.id}`) } })
      }
    }
    list.push({ id: 'lobby', label: 'Lobby', hint: 'Conversations', words: 'lobby home conversations rooms stream', run: () => { navigate('/'); useShell.getState().showLobby() } })
    list.push({ id: 'account', label: 'Account', hint: 'You', words: 'account profile name avatar sign out settings', run: () => navigate('/account') })
    return list
  }, [workspace, companies, navigate])
  const { records, pending } = useRecordResults(workspace?.id, query, open)

  const shown = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return commands
    // Places first, then records (already matched by their own search).
    return [...commands.filter((c) => terms.every((t) => c.words.toLowerCase().includes(t) || c.label.toLowerCase().includes(t))), ...records]
  }, [commands, records, query])
  useEffect(() => setActive(0), [query])
  // Results arrive after typing pauses; keep the highlight on an existing option.
  useEffect(() => setActive((i) => Math.min(i, Math.max(0, shown.length - 1))), [shown.length])

  if (!open) return null
  // Sections in list order; arrow keys run straight through them (one flat index).
  const groups: { name: string; items: { c: Command; i: number }[] }[] = []
  shown.forEach((c, i) => {
    const name = c.group ?? PLACES
    const last = groups[groups.length - 1]
    if (last?.name === name) last.items.push({ c, i })
    else groups.push({ name, items: [{ c, i }] })
  })
  const grouped = groups.length > 1 || groups[0]?.name !== PLACES
  const run = (c: Command | undefined) => {
    if (!c) return
    setOpen(false)
    c.run()
  }
  return (
    <>
      <button type="button" className="command-dismiss" aria-label="Close" tabIndex={-1} onClick={() => setOpen(false)} />
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Go to or find">
        <input
          ref={input}
          className="command-input"
          role="combobox"
          aria-label="Go to or find"
          aria-expanded="true"
          aria-controls="command-list"
          aria-activedescendant={shown[active] ? `command-${shown[active].id}` : undefined}
          placeholder={workspace ? `Go to or find in ${workspace.name}…` : 'Go to…'}
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
          {groups.map((g) => (
            <li key={g.name} role="presentation" className="command-group">
              {grouped && <div className="command-group-label" aria-hidden>{g.name}</div>}
              <ul role="group" aria-label={g.name}>
                {g.items.map(({ c, i }) => (
                  <li
                    key={c.id}
                    id={`command-${c.id}`}
                    role="option"
                    aria-selected={i === active}
                    className="command-option"
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(c)}
                  >
                    <span className="command-label">{c.label}{c.detail && <span className="command-detail"> {c.detail}</span>}</span>
                    {c.group ? null : <span className="command-hint">{c.hint}</span>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {pending && <li role="presentation" className="command-empty" aria-live="polite">Searching…</li>}
          {shown.length === 0 && !pending && <li role="presentation" className="command-empty">No matches.</li>}
        </ul>
      </div>
    </>
  )
}
