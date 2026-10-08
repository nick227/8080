export type CalComment = {
  id: string
  authorName: string
  authorAvatar?: string | null
  text: string
  createdAt: string
}

export type CalWorkLog = {
  id: string
  taskKey?: string | null
  summary: string
  day: string
  time?: string | null
  authorName?: string | null
  hoursSpent?: number | null
}

export type CalTask = {
  id: string
  taskKey: string // e.g. "VC-101"
  title: string
  description?: string | null
  day: string
  time: string | null
  dueDate?: string | null
  status: 'open' | 'in_progress' | 'in_review' | 'done'
  source: string | null
  assigneeId?: string | null
  assigneeName?: string | null
  assigneeAvatar?: string | null
  priority?: 'low' | 'medium' | 'high' | 'highest'
  category?: 'feature' | 'bug' | 'task' | 'story' | 'epic' // Issue Type
  area?: 'Engineering' | 'Marketing' | 'Operations' | 'Design' | 'Product' | 'Sales' // Workspace Area
  storyPoints?: number
  sprint?: string
  sprintId?: string | null
  comments?: CalComment[]
  workLogs?: CalWorkLog[]
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
  role?: string
  avatarUrl?: string
  color?: string
}
