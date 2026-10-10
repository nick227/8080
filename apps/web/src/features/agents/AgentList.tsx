import { useMemo, useState, type ReactNode } from 'react'
import { useAgents, type Agent } from '@project/sdk'
import { CollectionView } from '../collections/CollectionView'
import { ColumnsMenu, FilterChips } from '../collections/ColumnsMenu'
import { DataTable } from '../collections/DataTable'
import { matches, useTableState, useUrlSearch, type Column } from '../collections/table'
import { destinationsLine, scheduleLine, when } from './format'

const STATUS: Record<string, string> = { active: 'Active', paused: 'Paused', draft: 'Draft', archived: 'Archived' }
const FAMILY_LABEL: Record<string, string> = { team: 'Team', scheduled: 'Scheduled', followup: 'Follow-ups', manual: 'Manual', social: 'Social' }
type Show = 'all' | 'active' | 'draft' | 'paused' | 'attention'

const attentionOf = (a: Agent) => [
  a.sender.status !== 'active' ? 'Sender needs attention' : '',
  a.lastEvent?.status === 'failed' ? 'Last run failed' : '',
].filter(Boolean).join(' · ')

/** Automations as a shared collection (redesign D9): same frame and table as every list. */
export function AgentList({ workspaceId, timeZone, canManage, onOpen, onAdd, activity }: {
  workspaceId: string
  timeZone: string
  canManage: boolean
  onOpen: (agentId: string) => void
  onAdd: () => void
  /** Recent run history, shown under the list. */
  activity?: ReactNode
}) {
  const agents = useAgents(workspaceId)
  const search = useUrlSearch()
  const [show, setShow] = useState<Show>('all')
  const columns = useMemo<Column<Agent>[]>(() => [
    { id: 'name', header: 'Name', width: '22%', cell: (a) => a.name, sortValue: (a) => a.name, title: (a) => a.name, hideable: false },
    { id: 'type', header: 'Type', cell: (a) => FAMILY_LABEL[a.family] ?? a.family, sortValue: (a) => FAMILY_LABEL[a.family] ?? a.family },
    { id: 'schedule', header: 'Schedule', cell: (a) => scheduleLine(a.schedule) || 'Manual / on demand', title: (a) => scheduleLine(a.schedule) || undefined },
    { id: 'recipients', header: 'Recipients', align: 'end', cell: (a) => a.recipientCount, sortValue: (a) => a.recipientCount },
    { id: 'status', header: 'Status', cell: (a) => <span className="agents-chip" data-status={a.status}>{STATUS[a.status] ?? a.status}</span>, sortValue: (a) => STATUS[a.status] ?? a.status },
    { id: 'next', header: 'Next delivery', firstDir: 1, cell: (a) => (a.status === 'active' && a.nextEvent ? when(a.nextEvent.scheduledFor, timeZone) : a.status === 'paused' ? 'Paused' : '—'), sortValue: (a) => (a.status === 'active' && a.nextEvent ? a.nextEvent.scheduledFor : null) },
    { id: 'attention', header: 'Attention', cell: (a) => { const t = attentionOf(a); return t ? <span className="agents-status-bad">{t}</span> : '—' }, title: (a) => attentionOf(a) || undefined },
    { id: 'sender', header: 'Sender', defaultHidden: true, cell: (a) => a.sender.label, sortValue: (a) => a.sender.label, title: (a) => a.sender.label },
    { id: 'channel', header: 'Channel', defaultHidden: true, cell: (a) => destinationsLine(a.destinations.filter((d) => d !== 'internal_chat')) || '—' },
  ], [timeZone])
  const table = useTableState('agents', columns, { id: 'name', dir: 1 })

  const all = agents.data ?? []
  const counts = {
    all: all.length,
    active: all.filter((a) => a.status === 'active').length,
    draft: all.filter((a) => a.status === 'draft').length,
    paused: all.filter((a) => a.status === 'paused').length,
    attention: all.filter((a) => attentionOf(a)).length,
  }
  const rows = table.sortRows(all.filter((a) =>
    (show === 'all' || (show === 'attention' ? !!attentionOf(a) : a.status === show)) &&
    matches(search.q, a.name, FAMILY_LABEL[a.family], a.sender.label, scheduleLine(a.schedule)),
  ))

  return (
    <CollectionView
      collection="agents"
      count={all.length}
      onNew={canManage ? onAdd : undefined}
      search={{ value: search.value, onChange: search.setValue, placeholder: 'Search automations…' }}
      filters={<FilterChips label="Show" value={show} onChange={setShow} options={[
        { id: 'all', label: 'All', count: counts.all },
        { id: 'active', label: 'Active', count: counts.active },
        { id: 'draft', label: 'Draft', count: counts.draft },
        { id: 'paused', label: 'Paused', count: counts.paused },
        { id: 'attention', label: 'Needs attention', count: counts.attention },
      ]} />}
      view={<ColumnsMenu state={table} />}
      notice={<p className="collection-note">Scheduled team briefs, reports and emails.</p>}
    >
      {agents.isLoading ? <p className="collection-note" role="status">Loading automations…</p>
        : agents.isError ? <p className="collection-note" role="alert">Couldn’t load automations.</p>
          : (
            <DataTable
              label="Automations"
              rows={rows}
              getId={(a) => a.id}
              state={table}
              onOpen={(a) => onOpen(a.id)}
              empty={all.length === 0 ? (canManage ? 'No automations yet. Start one with + New automation.' : 'No automations yet.') : 'No automations match.'}
            />
          )}
      {activity}
    </CollectionView>
  )
}
