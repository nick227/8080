import { WorkspaceLoading } from '../work/WorkspaceTransition'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRemoveWorkspaceMember, useSession, useWorkspaceMembers } from '@project/sdk'
import { useCalendar, useWorkflow } from '../calendar/store'
import { PersonIcon } from '../../components/icons'
import type { Seat } from '../room/roomViews'
import type { ExtendedMember } from './UserProfilePage'
import { useCurrentWorkspace } from '../../app/workspace'
import { CollectionView } from '../collections/CollectionView'
import { ColumnsMenu } from '../collections/ColumnsMenu'
import { DataTable } from '../collections/DataTable'
import { matches, useTableState, useUrlSearch, type Column } from '../collections/table'
import { BulkMessage, SelectionBar, deleteColumn, useBulkDelete, useSelection } from '../collections/selection'
import { PeopleDialog } from './PeopleDialog'
import { FormSlideout } from '../work/FormSlideout'
import { StarterPackPicker } from '../prefab/StarterPackPicker'
import { ImportModalTabs, ApiConnectionsPanel } from '../prefab/ImportModalChrome'
import { CsvExample } from '../../components/CsvExample'
import type { PrefabTeamRole } from '@project/shared'
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
  const [importing, setImporting] = useState(false)
  const canInvite = workspace?.role === 'owner' || workspace?.role === 'admin'

  const [vacantRoles, setVacantRoles] = useState<PrefabTeamRole[]>(() => {
    if (!workspace?.id) return []
    try {
      const raw = localStorage.getItem(`team.vacant_roles:${workspace.id}`)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })

  const saveVacant = (next: PrefabTeamRole[]) => {
    setVacantRoles(next)
    if (!workspace?.id) return
    try {
      localStorage.setItem(`team.vacant_roles:${workspace.id}`, JSON.stringify(next))
    } catch {
      /* storage fallback */
    }
  }
  const latestVacant = useRef(vacantRoles)
  latestVacant.current = vacantRoles
  const removeMember = useRemoveWorkspaceMember(workspace?.id ?? '')
  // Members are removed from the company (their row is kept as `removed`); unhired roles are this browser's list.
  const removal = useBulkDelete({
    noun: { one: 'member', many: 'members' },
    verb: 'Remove',
    past: 'Removed',
    warning: 'They lose access to this company; their past work stays.',
    remove: async (id) => {
      if (!id.startsWith('vacant:')) return removeMember.mutateAsync(id)
      latestVacant.current = latestVacant.current.filter((r) => `vacant:${r.key}` !== id)
      saveVacant(latestVacant.current)
    },
  })
  const runRemoval = removal.run

  const rows = useMemo<Row[]>(() => {
    const here = new Map(seats.map((seat) => [seat.id, seat]))
    const activeRows = (members.data ?? [])
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
          presence: seat ? ('online' as const) : ('offline' as const),
          activity: seat?.activity ?? undefined,
          self: m.user.id === meUserId,
          open: mine.filter((t) => !workflow.isDone(t.status)).length,
          done: mine.filter((t) => workflow.isDone(t.status)).length,
          focus: doing?.title ?? log?.title,
        }
      })

    const vacantRows: Row[] = vacantRoles.map((role) => ({
      id: `vacant:${role.key}`,
      userId: `vacant:${role.key}`,
      name: `${role.roleTitle} (Unhired)`,
      role: role.department,
      presence: 'offline' as const,
      open: 0,
      done: 0,
      focus: `${role.hoursPerWeek}h/wk planned capacity`,
      self: false,
    }))

    return [...activeRows, ...vacantRows]
  }, [members.data, vacantRoles, seats, tasks, accomplishments, workflow, meUserId])

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
    ...(canInvite ? [deleteColumn<Row>({ verb: 'Remove', name: (m) => m.name, can: (m) => !m.self, onDelete: (m) => void runRemoval([m.id], m.name) })] : []),
  ], [inRoom, onAssignTask, canInvite, runRemoval])
  const table = useTableState('members', columns, { id: 'name', dir: 1 })
  const shown = table.sortRows(rows.filter((m) => matches(search.q, m.name, m.role, m.email, m.focus)))
  const selection = useSelection(useMemo(() => shown.map((m) => m.id), [shown]))

  const handleImportRoles = (records: any[]) => {
    const next = [...vacantRoles]
    for (const r of records) {
      if (!next.some((x) => x.key === r.key)) next.push(r as PrefabTeamRole)
    }
    saveVacant(next)
    setImporting(false)
  }

  return (
    <CollectionView
      collection="members"
      count={members.isLoading ? undefined : rows.length}
      onNew={canInvite ? () => setInviting(true) : undefined}
      onImport={canInvite ? () => setImporting(true) : undefined}
      notice={
        workspace && canInvite ? (
          <>
            {importing && (
              <ImportTeamSlideout
                onClose={() => setImporting(false)}
                onImportRoles={handleImportRoles}
              />
            )}
            <BulkMessage result={removal.result} onDismiss={removal.dismiss} />
          </>
        ) : undefined
      }
      search={{ value: search.value, onChange: search.setValue, placeholder: 'Search members, roles, focus…' }}
      view={<ColumnsMenu state={table} />}
    >
      {members.isLoading ? <WorkspaceLoading label="Loading members…" /> : members.isError && !members.data ? (
        <p role="alert">Members couldn’t load. <button type="button" className="cal-link-btn" onClick={() => void members.refetch()}>Retry</button></p>
      ) : <div className="workspace-content"><DataTable
        label="Team"
        rows={shown}
        getId={(m) => m.id}
        state={table}
        onOpen={onSelectUser}
        selection={canInvite ? { selected: selection.selected, onChange: selection.set, disabled: (m) => (m.self ? 'That’s you — leave from your profile' : false) } : undefined}
        empty={!workspace ? 'Join or create a company to see its team.'
          : search.q ? 'No members match this search.'
              : 'No members yet.'}
      /></div>}
      {inviting && <PeopleDialog workspace={workspace} onClose={() => setInviting(false)} />}
      <SelectionBar count={selection.selected.size} deleteLabel="Remove" onClear={selection.clear} busy={removal.busy} onDelete={() => void removal.run(selection.ids)} />
    </CollectionView>
  )
}

export function ImportTeamSlideout({
  onClose,
  onImportRoles,
  workspaceId,
}: {
  onClose: () => void
  onImportRoles: (records: any[]) => void
  workspaceId?: string
}) {
  const { workspace } = useCurrentWorkspace()
  const effectiveWsId = workspaceId ?? workspace?.id
  const [tab, setTab] = useState<string>('csv')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleCsvSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) {
      setError('Please provide at least one row of CSV data.')
      return
    }
    const hasHeader = lines[0].toLowerCase().includes('role') || lines[0].toLowerCase().includes('title')
    const dataLines = hasHeader ? lines.slice(1) : lines
    const parsedRoles: PrefabTeamRole[] = []
    for (const line of dataLines) {
      const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''))
      const roleTitle = parts[0]
      if (!roleTitle) continue
      const department = parts[1] || 'Operations'
      const hours = parseInt(parts[2] ?? '40', 10)
      parsedRoles.push({
        key: `custom-${crypto.randomUUID().slice(0, 8)}`,
        packId: 'custom-csv',
        version: 1,
        source: { provenance: 'synthetic-editorial' },
        roleTitle,
        department,
        hoursPerWeek: isNaN(hours) ? 40 : hours,
        responsibilities: 'Core operational responsibilities',
        requiredSkills: [],
        isVacant: true,
      })
    }
    if (parsedRoles.length === 0) {
      setError('Could not parse any valid roles from the CSV.')
      return
    }
    onImportRoles(parsedRoles)
  }

  return (
    <FormSlideout
      title="Import Team Roles"
      width="640px"
      onClose={onClose}
    >
      <ImportModalTabs
        tabs={[
          { id: 'csv', label: 'CSV Upload' },
          { id: 'api', label: 'API Connections' },
          { id: 'starter', label: 'Starter Packs' },
        ]}
        activeTab={tab}
        onSelectTab={setTab}
      />

      <div style={{ padding: 'var(--space-md) var(--space-lg)', flex: 1, overflowY: 'auto' }}>
        {tab === 'api' && (
          <ApiConnectionsPanel
            workspaceId={effectiveWsId}
            domain="team"
            onClose={onClose}
          />
        )}

        {tab === 'starter' && (
          <StarterPackPicker
            domain="team"
            confirmLabel="Add unhired roles"
            onImport={onImportRoles}
            onCancel={onClose}
          />
        )}

        {tab === 'csv' && (
          <form className="budget-form" onSubmit={handleCsvSubmit}>
            <div className="budget-form-fields">
              <div className="budget-form-field">
                <label htmlFor="team-import-csv">CSV</label>
                <textarea
                  id="team-import-csv"
                  rows={8}
                  spellCheck={false}
                  autoFocus
                  placeholder={'roleTitle,department,hoursPerWeek\nAccount Director,Client Services,40\nCreative Lead,Design,40'}
                  value={text}
                  onChange={(e) => { setText(e.target.value); setError('') }}
                />
              </div>
              <CsvExample
                example={'roleTitle,department,hoursPerWeek\nAccount Director,Client Services,40\nCreative Lead,Design,40'}
                note="Columns: roleTitle, department, hoursPerWeek (defaults to 40)."
              />
              {error && <p className="record-error" role="alert">{error}</p>}
            </div>

            <div className="record-form-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <button type="button" className="cal-btn" onClick={() => fileRef.current?.click()}>
                Choose file
              </button>
              <button type="button" className="cal-btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="prefab-import-btn" disabled={!text.trim()}>
                Import Roles
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) {
                  void file.text().then((content) => {
                    setText(content)
                    setError('')
                  })
                }
                e.target.value = ''
              }}
            />
          </form>
        )}

      </div>
    </FormSlideout>
  )
}

