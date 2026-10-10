import { useMemo, useState } from 'react'
import { useSession, useWorkspaceMembers } from '@project/sdk'
import { useCalendar, useWorkflow } from '../calendar/store'
import { PersonIcon } from '../../components/icons'
import type { Seat } from '../room/roomViews'
import type { ExtendedMember } from './UserProfilePage'
import { useCurrentWorkspace } from '../../app/workspace'
import { CollectionView } from '../collections/CollectionView'
import { ColumnsMenu } from '../collections/ColumnsMenu'
import { DataTable } from '../collections/DataTable'
import { matches, useTableState, useUrlSearch, type Column } from '../collections/table'
import { InviteMember } from './InviteMember'
import './team.css'

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const

type Row = ExtendedMember & { open: number; done: number; focus?: string }

/**
 * Team as a shared collection (redesign D9): the company's active members (ids are
 * WorkspaceMember ids, what task assignees reference). A row opens the member's page.
 * Presence shows only inside a room, where seats say who is here.
 */
export function TeamTableView({
  seats,
  inRoom,
  onSelectUser,
  onAssignTask,
}: {
  seats: Seat[]
  inRoom: boolean
  onSelectUser: (member: ExtendedMember) => void
  onAssignTask: (memberId: string) => void
}) {
  const tasks = useCalendar((s) => s.tasks)
  const accomplishments = useCalendar((s) => s.accomplishments)
  const workflow = useWorkflow()
  const { workspace } = useCurrentWorkspace()
  const members = useWorkspaceMembers(workspace?.id)
  const meUserId = useSession().data?.data.id
  const search = useUrlSearch()
  const [inviting, setInviting] = useState(false)
  const canInvite = workspace?.role === 'owner' || workspace?.role === 'admin'

  const rows = useMemo<Row[]>(() => {
    const here = new Map(seats.map((seat) => [seat.id, seat]))
    return (members.data ?? [])
      .filter((m) => m.status === 'active')
      .map((m) => {
        const seat = here.get(m.user.id)
        const mine = tasks.filter((t) => t.assigneeId === m.id)
        const doing = mine.find((t) => workflow.get(t.status)?.category === 'doing') ?? mine.find((t) => !workflow.isDone(t.status))
        const log = accomplishments.find((a) => a.assigneeId === m.id)
        return {
          id: m.id,
          userId: m.user.id,
          name: m.user.name,
          tag: seat?.tag,
          avatarUrl: m.user.avatarUrl ?? seat?.avatarUrl,
          role: m.title || ROLE_LABEL[m.role],
          email: m.email ?? undefined,
          presence: seat ? 'online' : 'offline',
          activity: seat?.activity ?? undefined,
          self: m.user.id === meUserId,
          open: mine.filter((t) => !workflow.isDone(t.status)).length,
          done: mine.filter((t) => workflow.isDone(t.status)).length,
          focus: doing?.title ?? log?.title,
        }
      })
  }, [members.data, seats, tasks, accomplishments, workflow, meUserId])

  const columns = useMemo<Column<Row>[]>(() => [
    {
      id: 'name', header: 'Member', width: '26%', hideable: false, sortValue: (m) => m.name,
      cell: (m) => (
        <span className="team-member-cell">
          {m.avatarUrl ? <img src={m.avatarUrl} alt="" className="team-cell-avatar" /> : <span className="team-cell-avatar-placeholder"><PersonIcon guest={false} /></span>}
          <span className="member-name-text">{m.name}</span>
          {m.self && <small className="self-tag">You</small>}
        </span>
      ),
    },
    { id: 'role', header: 'Role', cell: (m) => m.role ?? 'Member', sortValue: (m) => m.role },
    ...(inRoom ? [{ id: 'presence', header: 'Presence', cell: (m: Row) => (m.presence === 'online' ? 'In this room' : 'Not in this room'), sortValue: (m: Row) => (m.presence === 'online' ? 0 : 1) }] : []),
    { id: 'focus', header: 'Current focus', width: '28%', cell: (m) => m.focus ?? <span className="team-muted">Nothing in progress</span>, title: (m) => m.focus },
    { id: 'open', header: 'Open tasks', align: 'end', firstDir: -1, cell: (m) => m.open, sortValue: (m) => m.open },
    { id: 'done', header: 'Done', align: 'end', firstDir: -1, cell: (m) => m.done, sortValue: (m) => m.done },
    { id: 'email', header: 'Email', defaultHidden: true, cell: (m) => m.email ?? '—', sortValue: (m) => m.email ?? null },
    {
      id: 'actions', header: '', width: '9rem', hideable: false,
      cell: (m) => <button type="button" className="collection-row-action" onClick={() => onAssignTask(m.id)}>Assign task</button>,
    },
  ], [inRoom, onAssignTask])
  const table = useTableState('team', columns, { id: 'name', dir: 1 })
  const shown = table.sortRows(rows.filter((m) => matches(search.q, m.name, m.role, m.email, m.focus)))

  return (
    <CollectionView
      collection="team"
      count={rows.length}
      onNew={canInvite ? () => setInviting(true) : undefined}
      notice={inviting && workspace ? <InviteMember workspaceId={workspace.id} onClose={() => setInviting(false)} /> : undefined}
      search={{ value: search.value, onChange: search.setValue, placeholder: 'Search members, roles, focus…' }}
      view={<ColumnsMenu state={table} />}
    >
      <DataTable
        label="Team"
        rows={shown}
        getId={(m) => m.id}
        state={table}
        onOpen={onSelectUser}
        empty={!workspace ? 'Join or create a company to see its team.'
          : members.isLoading ? 'Loading members…'
            : search.q ? 'No members match this search.'
              : 'No members yet.'}
      />
    </CollectionView>
  )
}
