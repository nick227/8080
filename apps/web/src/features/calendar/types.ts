export type TaskStatus = 'open' | 'in_progress' | 'in_review' | 'done'
export type TaskType = 'feature' | 'bug' | 'task' | 'story' | 'epic'
export type TaskPriority = 'low' | 'medium' | 'high' | 'highest'

export type CalWorkLog = {
  id: string
  taskKey?: string | null
  summary: string
  day: string
  time?: string | null
  authorName?: string | null
  hoursSpent?: number | null
}

/** A workspace task as every Calendar/Boards view sees it (server Task, flattened). */
export type CalTask = {
  id: string
  taskKey: string // e.g. "VC-101"; "…" while the server is still creating it
  title: string
  description?: string | null
  /** Scheduled calendar day (YYYY-MM-DD); null = on the board only. */
  day: string | null
  time: string | null
  dueDate?: string | null
  status: TaskStatus
  source: string | null
  /** WorkspaceMember id */
  assigneeId?: string | null
  assigneeName?: string | null
  assigneeAvatar?: string | null
  priority?: TaskPriority
  category?: TaskType // Issue type
  area?: string | null // Workspace area (Engineering, Marketing…)
  storyPoints?: number | null
  /** Order inside the status column (ascending). */
  rank: number
  version: number
  commentCount: number
  resolvedAt?: string | null
  updatedAt?: string
  /** True until the server has confirmed the create. */
  pending?: boolean
}

export type CalAccomplishment = {
  id: string
  taskKey?: string | null
  title: string
  day: string
  time: string | null
  category: string
  assigneeId?: string | null
  assigneeName?: string | null
  icon?: string
}

export type TeamMember = {
  id: string
  name: string
  avatarUrl?: string | null
}

export const AREAS = ['Engineering', 'Marketing', 'Operations', 'Design', 'Product', 'Sales'] as const
export const TASK_TYPES: TaskType[] = ['task', 'feature', 'bug', 'story', 'epic']
export const STATUSES: { id: TaskStatus; title: string }[] = [
  { id: 'open', title: 'To do' },
  { id: 'in_progress', title: 'In progress' },
  { id: 'in_review', title: 'In review' },
  { id: 'done', title: 'Done' },
]
