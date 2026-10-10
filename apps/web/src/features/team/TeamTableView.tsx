import { TaskLink } from '../tasks/TaskLink'
import React, { useMemo, useState } from 'react'
import { useSession, useWorkspaceMembers } from '@project/sdk'
import { useCurrentWorkspace } from '../../app/workspace'
import { useCalendar, useWorkflow } from '../calendar/store'
import { MaximizeIcon, PersonIcon, SearchIcon } from '../../components/icons'
import type { Seat } from '../room/roomViews'
import type { ExtendedMember } from './UserProfilePage'
import './team.css'


const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const

export function TeamTableView({
  seats,
  onSelectUser,
  onAssignTask,
}: {
  seats: Seat[]
  onSelectUser: (member: ExtendedMember) => void
  onAssignTask: (memberId: string) => void
}) {
  const [search, setSearch] = useState('')
  const [expandedUser, setExpandedUser] = useState<string | null>(null)

  const tasks = useCalendar((s) => s.tasks)
  const accomplishments = useCalendar((s) => s.accomplishments)
  const workflow = useWorkflow()

  // Rows are the company's active members (ids = WorkspaceMember ids, what task
  // assignees reference); the room's seats only add who is here right now.
  const { workspace } = useCurrentWorkspace()
  const members = useWorkspaceMembers(workspace?.id)
  const meUserId = useSession().data?.data.id
  const mergedMembers = useMemo(() => {
    const here = new Map(seats.map((seat) => [seat.id, seat]))
    return (members.data ?? [])
      .filter((m) => m.status === 'active')
      .map((m): ExtendedMember => {
        const seat = here.get(m.user.id)
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
        }
      })
  }, [members.data, seats, meUserId])

  // Filter members by search & department
  const filteredMembers = useMemo(() => {
    return mergedMembers.filter((m) => {
      const matchesSearch =
        !search.trim() ||
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        (m.tag && m.tag.toLowerCase().includes(search.toLowerCase())) ||
        (m.role && m.role.toLowerCase().includes(search.toLowerCase()))
      return matchesSearch
    })
  }, [mergedMembers, search])

  // Statistics
  const activeCount = mergedMembers.filter((m) => m.presence !== 'offline').length
  const totalTasksCount = tasks.length
  const totalCompletedCount = tasks.filter((t) => workflow.isDone(t.status)).length

  return (
    <div className="team-table-desk">
      {/* Header & Control Bar */}
      <div className="team-table-header">
        <div className="team-header-title-block">
          <h2>Team</h2>
          <span className="team-header-subtitle">
            {mergedMembers.length} {mergedMembers.length === 1 ? 'member' : 'members'} &bull; {activeCount} here now &bull; {totalCompletedCount}/{totalTasksCount} tasks done
          </span>
        </div>

        <div className="team-header-actions">
          {/* Search box */}
          <div className="team-table-search">
            <SearchIcon />
            <input
              type="text"
              placeholder="Search team members, roles, tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="search-clear" onClick={() => setSearch('')}>
                ×
              </button>
            )}
          </div>

          <button type="button" className="team-btn-primary" onClick={() => onAssignTask('')}>
            + Assign task
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="team-table-scroll-wrap">
        <table className="team-main-table">
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col">Role</th>
              <th scope="col">Presence</th>
              <th scope="col">Daily work / focus</th>
              <th scope="col">Assigned tasks</th>
              <th scope="col" className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredMembers.map((member) => {
              // Tasks for member
              const memberTasks = tasks.filter(
                (t) =>
                  t.assigneeId === member.id ||
                  (t.assigneeName && t.assigneeName.toLowerCase() === member.name.toLowerCase())
              )
              const doneTasks = memberTasks.filter((t) => workflow.isDone(t.status))
              const inProgressTask = memberTasks.find((t) => !workflow.isDone(t.status))

              // Accomplishments for member
              const memberLogs = accomplishments.filter(
                (acc) =>
                  acc.assigneeId === member.id ||
                  (acc.assigneeName && acc.assigneeName.toLowerCase() === member.name.toLowerCase())
              )
              const latestLog = memberLogs[0]

              const presenceState = member.activity ?? member.presence ?? 'online'
              const isExpanded = expandedUser === member.id

              return (
                <React.Fragment key={member.id}>
                  <tr className={`team-row ${isExpanded ? 'expanded' : ''}`}>
                    {/* Member Column (Links to User Page) */}
                    <td>
                      <button
                        type="button"
                        className="team-member-cell-btn"
                        onClick={() => onSelectUser(member)}
                        title={`Open dedicated summary page for ${member.name}`}
                      >
                        <div className="team-avatar-badge-wrap">
                          {member.avatarUrl ? (
                            <img src={member.avatarUrl} alt={member.name} className="team-cell-avatar" />
                          ) : (
                            <div className="team-cell-avatar-placeholder">
                              <PersonIcon guest={Boolean(member.guest)} />
                            </div>
                          )}
                          <span
                            className={`cell-presence-indicator ${
                              presenceState === 'offline' ? 'offline' : 'online'
                            }`}
                          />
                        </div>
                        <div className="team-member-name-block">
                          <span className="member-name-text">{member.name}</span>
                          {member.tag && <span className="member-tag-text">{member.tag}</span>}
                          {member.self && <small className="self-tag">You</small>}
                        </div>
                      </button>
                    </td>

                    {/* Role & Area */}
                    <td>
                      <div className="role-area-block">
                        <span className="role-title">{member.role || 'Member'}</span>
                        {member.department && <span className="area-pill">{member.department}</span>}
                      </div>
                    </td>

                    {/* Presence */}
                    <td>
                      <div className="presence-block">
                        <span className={`presence-pill presence-${presenceState}`}>
                          {presenceState === 'typing'
                            ? 'Typing…'
                            : presenceState === 'recording'
                            ? 'Recording'
                            : presenceState === 'focus'
                            ? 'Focus mode'
                            : presenceState === 'in_meeting'
                            ? 'In a meeting'
                            : presenceState === 'offline'
                            ? 'Not in this room'
                            : 'In this room'}
                        </span>
                      </div>
                    </td>

                    {/* Daily Work / Focus */}
                    <td>
                      <div className="daily-work-block">
                        {inProgressTask ? (
                          <span className="work-focus-title" title={inProgressTask.title}>
                            <span className="focus-icon">⚡</span> {inProgressTask.title}
                          </span>
                        ) : latestLog ? (
                          <span className="work-log-title" title={latestLog.title}>
                            <span className="focus-icon">✅</span> {latestLog.title}
                          </span>
                        ) : (
                          <span className="work-empty-text">No active focus logged today</span>
                        )}
                      </div>
                    </td>

                    {/* Tasks & Workload */}
                    <td>
                      <div className="workload-block">
                        <button
                          type="button"
                          className="workload-summary-pill"
                          onClick={() => setExpandedUser(isExpanded ? null : member.id)}
                          title="Click to expand member's task list"
                        >
                          <span className="workload-count">
                            {memberTasks.length} {memberTasks.length === 1 ? 'task' : 'tasks'} ({doneTasks.length} done)
                          </span>
                          <span className="workload-arrow">{isExpanded ? '▲' : '▼'}</span>
                        </button>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="text-right">
                      <div className="table-actions-cell">
                        <button
                          type="button"
                          className="team-row-action-btn primary"
                          onClick={() => onAssignTask(member.id)}
                          title={`Assign task to ${member.name}`}
                        >
                          + Assign task
                        </button>
                        <button
                          type="button"
                          className="team-row-action-btn secondary"
                          onClick={() => onSelectUser(member)}
                          title={`View dedicated page for ${member.name}`}
                        >
                          <MaximizeIcon /> View page
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded Task Drawer Row */}
                  {isExpanded && (
                    <tr className="team-drawer-row">
                      <td colSpan={6}>
                        <div className="drawer-container">
                          <h4>
                            Tasks & accomplishments for {member.name}
                            <button
                              type="button"
                              className="drawer-assign-btn"
                              onClick={() => onAssignTask(member.id)}
                            >
                              + Assign task
                            </button>
                          </h4>

                          {memberTasks.length === 0 ? (
                            <p className="drawer-empty">No tasks assigned yet.</p>
                          ) : (
                            <div className="drawer-tasks-grid">
                              {memberTasks.map((t) => (
                                <div key={t.id} className="drawer-task-card">
                                  <span className="drawer-task-key">#{t.taskKey}</span>
                                  {t.pending ? <span className="drawer-task-title">{t.title}</span> : <TaskLink taskKey={t.taskKey} className="drawer-task-title">{t.title}</TaskLink>}
                                  <span className={`priority-pill priority-${t.priority || 'medium'}`}>
                                    {t.priority}
                                  </span>
                                  <span className="drawer-task-status">{t.status}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
            {filteredMembers.length === 0 && (
              <tr>
                <td colSpan={6} className="team-empty">
                  {!workspace ? 'Join or create a company to see its team.'
                    : members.isLoading ? 'Loading members…'
                      : search.trim() ? 'No members match this search.'
                        : 'No members yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {filteredMembers.length === 0 && (
          <div className="team-table-empty">
            <p>No team members found matching your search filter.</p>
          </div>
        )}
      </div>
    </div>
  )
}
