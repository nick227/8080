import { TaskLink } from '../tasks/TaskLink'
import React, { useMemo, useState } from 'react'
import { useCalendar, useWorkflow } from '../calendar/store'
import { MaximizeIcon, PersonIcon, SearchIcon } from '../../components/icons'
import type { Seat } from '../room/roomViews'
import type { ExtendedMember } from './UserProfilePage'
import './team.css'

// Default fallback roster so the table is rich with team members even when offline
const DEFAULT_TEAM_MEMBERS: ExtendedMember[] = [
  {
    id: 'user-1',
    name: 'Alex Rivera',
    tag: '@alex',
    role: 'Senior Full-Stack Engineer',
    department: 'Engineering',
    email: 'alex.rivera@project.com',
    presence: 'online',
    activity: 'here',
    bio: 'Lead architect on real-time web audio and UI frameworks.',
    skills: ['TypeScript', 'React', 'WebSockets', 'WebAudio'],
  },
  {
    id: 'user-2',
    name: 'Sarah Chen',
    tag: '@sarah',
    role: 'Lead Product Designer',
    department: 'Design',
    email: 'sarah.chen@project.com',
    presence: 'focus',
    activity: 'recording',
    bio: 'Specializing in sleek dark modes, micro-animations, and dynamic visual design.',
    skills: ['Figma', 'UI/UX', 'Design Systems', 'CSS'],
  },
  {
    id: 'user-3',
    name: 'Marcus Vance',
    tag: '@marcus',
    role: 'Backend & Systems Engineer',
    department: 'Engineering',
    email: 'marcus.vance@project.com',
    presence: 'in_meeting',
    activity: 'typing',
    bio: 'Focused on distributed stream event routing and API performance.',
    skills: ['Go', 'Node.js', 'PostgreSQL', 'WebSockets'],
  },
  {
    id: 'user-4',
    name: 'Elena Rostova',
    tag: '@elena',
    role: 'Product Manager',
    department: 'Product',
    email: 'elena.rostova@project.com',
    presence: 'online',
    activity: 'here',
    bio: 'Driving product strategy, sprint execution, and user feedback cycles.',
    skills: ['Roadmapping', 'Agile', 'Product Analytics'],
  },
  {
    id: 'user-5',
    name: 'David Kim',
    tag: '@david',
    role: 'QA & Test Automation Lead',
    department: 'Operations',
    email: 'david.kim@project.com',
    presence: 'offline',
    activity: 'away',
    bio: 'Building comprehensive E2E playwright test suites and CI pipelines.',
    skills: ['Playwright', 'Jest', 'CI/CD', 'QA'],
  },
]

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
  const [selectedDept, setSelectedDept] = useState<string>('all')
  const [expandedUser, setExpandedUser] = useState<string | null>(null)

  const tasks = useCalendar((s) => s.tasks)
  const accomplishments = useCalendar((s) => s.accomplishments)
  const workflow = useWorkflow()

  // Merge live room seats with workspace team members
  const mergedMembers = useMemo(() => {
    const map = new Map<string, ExtendedMember>()

    // First populate default roster
    for (const member of DEFAULT_TEAM_MEMBERS) {
      map.set(member.id, { ...member })
    }

    // Merge seats from live room
    for (const seat of seats) {
      const existing = map.get(seat.id)
      if (existing) {
        existing.activity = seat.activity ?? undefined
        existing.avatarUrl = seat.avatarUrl || existing.avatarUrl
        existing.self = seat.self
        existing.guest = seat.guest
        existing.presence = 'online'
      } else {
        map.set(seat.id, {
          id: seat.id,
          name: seat.name,
          tag: seat.tag || `@${seat.name.toLowerCase().replace(/\s+/g, '')}`,
          avatarUrl: seat.avatarUrl,
          role: seat.self ? 'You (Current User)' : 'Team Member',
          department: 'Engineering',
          presence: 'online',
          activity: seat.activity ?? undefined,
          self: seat.self,
          guest: seat.guest,
        })
      }
    }

    return Array.from(map.values())
  }, [seats])

  // Filter members by search & department
  const filteredMembers = useMemo(() => {
    return mergedMembers.filter((m) => {
      const matchesSearch =
        !search.trim() ||
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        (m.tag && m.tag.toLowerCase().includes(search.toLowerCase())) ||
        (m.role && m.role.toLowerCase().includes(search.toLowerCase()))
      const matchesDept = selectedDept === 'all' || m.department?.toLowerCase() === selectedDept.toLowerCase()
      return matchesSearch && matchesDept
    })
  }, [mergedMembers, search, selectedDept])

  // Statistics
  const activeCount = mergedMembers.filter((m) => m.presence !== 'offline').length
  const totalTasksCount = tasks.length
  const totalCompletedCount = tasks.filter((t) => workflow.isDone(t.status)).length

  return (
    <div className="team-table-desk">
      {/* Header & Control Bar */}
      <div className="team-table-header">
        <div className="team-header-title-block">
          <h2>Team Workspace</h2>
          <span className="team-header-subtitle">
            {mergedMembers.length} Teammates &bull; {activeCount} Active Now &bull; {totalCompletedCount}/{totalTasksCount} Tasks Done
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

          <button type="button" className="team-btn-primary" onClick={() => onAssignTask(mergedMembers[0]?.id || '')}>
            + Assign Task
          </button>
        </div>
      </div>

      {/* Filter Chips Bar */}
      <div className="team-filters-bar">
        <span className="filter-label">Filter Department:</span>
        {['all', 'Engineering', 'Design', 'Product', 'Operations'].map((dept) => (
          <button
            key={dept}
            type="button"
            className={`team-filter-pill ${selectedDept === dept ? 'active' : ''}`}
            onClick={() => setSelectedDept(dept)}
          >
            {dept === 'all' ? 'All Departments' : dept}
          </button>
        ))}
      </div>

      {/* Main Table */}
      <div className="team-table-scroll-wrap">
        <table className="team-main-table">
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col">Role & Area</th>
              <th scope="col">Presence</th>
              <th scope="col">Daily Work / Focus</th>
              <th scope="col">Assigned Tasks</th>
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
                        <span className="area-pill">{member.department || 'Engineering'}</span>
                      </div>
                    </td>

                    {/* Presence */}
                    <td>
                      <div className="presence-block">
                        <span className={`presence-pill presence-${presenceState}`}>
                          {presenceState === 'typing'
                            ? 'Typing message...'
                            : presenceState === 'recording'
                            ? 'Recording voice'
                            : presenceState === 'focus'
                            ? 'Focus Mode'
                            : presenceState === 'in_meeting'
                            ? 'In Meeting'
                            : presenceState === 'offline'
                            ? 'Offline'
                            : 'Online - In Room'}
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
                            {memberTasks.length} Tasks ({doneTasks.length} Done)
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
                          + Assign Task
                        </button>
                        <button
                          type="button"
                          className="team-row-action-btn secondary"
                          onClick={() => onSelectUser(member)}
                          title={`View dedicated page for ${member.name}`}
                        >
                          <MaximizeIcon /> View Page
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
                            Tasks & Accomplishments for {member.name}
                            <button
                              type="button"
                              className="drawer-assign-btn"
                              onClick={() => onAssignTask(member.id)}
                            >
                              + Quick Assign Task
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
