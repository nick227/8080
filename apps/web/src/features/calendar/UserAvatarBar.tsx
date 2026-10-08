import { useWorkspaceMembers } from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
import { useCalendar } from './store'
import type { TeamMember } from './types'

export const DEFAULT_TEAM: TeamMember[] = [
  { id: 'user-1', name: 'Alex River', role: 'Lead Engineer', color: '#6366f1' },
  { id: 'user-2', name: 'Sarah Chen', role: 'Product Lead', color: '#10b981' },
  { id: 'user-3', name: 'Marcus Vance', role: 'Design Lead', color: '#f59e0b' },
  { id: 'user-4', name: 'Jordan Taylor', role: 'Operations', color: '#ec4899' },
  { id: 'user-5', name: 'Elena Rostova', role: 'Growth Lead', color: '#06b6d4' },
]

export function UserAvatarBar({ onAddAccomplishment }: { onAddAccomplishment?: () => void }) {
  const { workspace } = useCurrentWorkspace()
  const membersQuery = useWorkspaceMembers(workspace?.id)
  const activeUserId = useCalendar((state) => state.activeUserId)
  const setActiveUser = useCalendar((state) => state.setActiveUser)
  const tasks = useCalendar((state) => state.tasks)

  const serverMembers: TeamMember[] = (membersQuery.data ?? [])
    .filter((m) => m.status === 'active')
    .map((m, index) => ({
      id: m.id,
      name: m.user.name,
      role: 'Member',
      avatarUrl: m.user.avatarUrl ?? undefined,
      color: ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4'][index % 5],
    }))

  const team: TeamMember[] = serverMembers.length > 0 ? serverMembers : DEFAULT_TEAM

  const getTaskCount = (userId: string | 'all') => {
    if (userId === 'all') return tasks.filter((t) => t.status === 'open').length
    return tasks.filter((t) => (t.assigneeId === userId || t.assigneeName === team.find((m) => m.id === userId)?.name) && t.status === 'open').length
  }

  return (
    <div className="cal-team-bar">
      <div className="cal-avatars" role="radiogroup" aria-label="Team members">
        <button
          type="button"
          role="radio"
          aria-checked={activeUserId === 'all'}
          className={`cal-avatar-chip ${activeUserId === 'all' ? 'active' : ''}`}
          onClick={() => setActiveUser('all')}
        >
          <div className="cal-avatar-circle cal-avatar-all">
            <span>ALL</span>
          </div>
          <div className="cal-avatar-meta">
            <span className="cal-avatar-name">All Team</span>
            <span className="cal-avatar-badge">{getTaskCount('all')} open</span>
          </div>
        </button>

        {team.map((member) => {
          const active = activeUserId === member.id
          const count = getTaskCount(member.id)
          const initials = member.name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()

          return (
            <button
              key={member.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`cal-avatar-chip ${active ? 'active' : ''}`}
              onClick={() => setActiveUser(member.id)}
              title={`View ${member.name}'s calendar (${member.role})`}
            >
              <div
                className="cal-avatar-circle"
                style={{ backgroundColor: member.color || 'var(--ink-medium)' }}
              >
                {member.avatarUrl ? (
                  <img src={member.avatarUrl} alt={member.name} />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
              <div className="cal-avatar-meta">
                <span className="cal-avatar-name">{member.name}</span>
                <span className="cal-avatar-role">{member.role}</span>
              </div>
              {count > 0 && <span className="cal-avatar-count">{count}</span>}
            </button>
          )
        })}
      </div>

      {onAddAccomplishment && (
        <button
          type="button"
          className="cal-acc-btn"
          onClick={onAddAccomplishment}
          title="Log an accomplishment dynamically to days as they happen"
        >
          Log Work
        </button>
      )}
    </div>
  )
}
