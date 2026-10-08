import { create } from 'zustand'
import { todayKey, shiftMonthKey } from './dates'
import type { CalTask, CalAccomplishment, CalComment } from './types'

const TASKS_KEY = 'vc-tasks'
const ACCOMPLISHMENTS_KEY = 'vc-accomplishments'

type State = {
  tasks: CalTask[]
  accomplishments: CalAccomplishment[]
  cursor: string
  view: 'month' | 'day' | 'list' | 'board' | 'backlog'
  activeUserId: string | 'all'
  sprintFilter: string | 'all'
  categoryFilter: string | 'all'
  priorityFilter: string | 'all'

  showMonth: () => void
  showDay: (day: string) => void
  showList: () => void
  setView: (view: 'month' | 'day' | 'list' | 'board' | 'backlog') => void
  setActiveUser: (userId: string | 'all') => void
  setSprintFilter: (sprint: string | 'all') => void
  setCategoryFilter: (category: string | 'all') => void
  setPriorityFilter: (priority: string | 'all') => void

  goToday: () => void
  shiftMonth: (delta: number) => void

  add: (input: {
    title: string
    description?: string | null
    day: string
    time?: string | null
    source?: string | null
    assigneeId?: string | null
    assigneeName?: string | null
    assigneeAvatar?: string | null
    priority?: 'low' | 'medium' | 'high' | 'highest'
    category?: 'feature' | 'bug' | 'task' | 'story' | 'epic'
    storyPoints?: number
    sprint?: string
    taskKey?: string
  }) => CalTask

  updateTaskStatus: (id: string, status: 'open' | 'in_progress' | 'in_review' | 'done') => void
  updateTask: (id: string, patch: Partial<CalTask>) => void
  addComment: (taskId: string, text: string, authorName: string) => void

  addAccomplishment: (input: {
    title: string
    day: string
    time?: string | null
    category?: string
    taskKey?: string | null
    assigneeId?: string | null
    assigneeName?: string | null
    icon?: string
  }) => void

  addMany: (titles: string[], day: string, source: string) => number
  importTasks: (rows: { title: string; day: string; time: string | null; status: CalTask['status'] }[]) => number
  toggle: (id: string) => void
  remove: (id: string) => void
  closeMatching: (query: string, day: string) => string | null
  findTaskByNumber: (query: string) => CalTask | null
  settleTaskByNumber: (query: string) => CalTask | null
}

function generateTaskKey(tasks: CalTask[]): string {
  const nums = tasks
    .map((t) => {
      const match = t.taskKey?.match(/\d+/)
      return match ? parseInt(match[0], 10) : 0
    })
    .filter((n) => !isNaN(n))

  const max = nums.length > 0 ? Math.max(...nums) : 100
  return `VC-${max + 1}`
}

function getInitialTasks(): CalTask[] {
  const today = todayKey()
  const d = new Date()
  const yesterday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).toISOString().slice(0, 10)
  const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString().slice(0, 10)

  return [
    {
      id: 'task-1',
      taskKey: 'VC-101',
      title: 'Review System Architecture & Database Indexes',
      description: 'Perform complete query optimization and check Postgres pool sizes for peak traffic loads.',
      day: today,
      time: '09:00',
      status: 'in_progress',
      source: 'team',
      assigneeId: 'user-1',
      assigneeName: 'Alex River',
      priority: 'high',
      category: 'feature',
      storyPoints: 5,
      sprint: undefined,
      comments: [
        {
          id: 'c-1',
          authorName: 'Sarah Chen',
          text: 'Make sure to check connection latency on read replica nodes as well.',
          createdAt: '2 hours ago',
        },
      ],
    },
    {
      id: 'task-2',
      taskKey: 'VC-102',
      title: 'Backlog review & leadership sync',
      description: 'Prepare Q4 deliverables roadmap and align with product lead on upcoming design milestones.',
      day: today,
      time: '11:00',
      status: 'open',
      source: 'team',
      assigneeId: 'user-2',
      assigneeName: 'Sarah Chen',
      priority: 'medium',
      category: 'story',
      storyPoints: 3,
      sprint: undefined,
      comments: [],
    },
    {
      id: 'task-3',
      taskKey: 'VC-103',
      title: 'Design System & Navigation Component Review',
      description: 'Audit dark mode tokens and ensure WCAG AA color contrast compliance on all button surfaces.',
      day: today,
      time: '14:00',
      status: 'done',
      source: 'team',
      assigneeId: 'user-3',
      assigneeName: 'Marcus Vance',
      priority: 'highest',
      category: 'bug',
      storyPoints: 2,
      sprint: undefined,
      comments: [
        {
          id: 'c-2',
          authorName: 'Marcus Vance',
          text: 'Tokens verified and updated across all component stylesheets!',
          createdAt: 'Yesterday',
        },
      ],
    },
    {
      id: 'task-4',
      taskKey: 'VC-104',
      title: 'Q4 Infrastructure Security Audit',
      description: 'Verify OAuth2 token validation timeouts and test rate limiting rules on API endpoints.',
      day: tomorrow,
      time: '10:00',
      status: 'open',
      source: 'team',
      assigneeId: 'user-4',
      assigneeName: 'Jordan Taylor',
      priority: 'high',
      category: 'task',
      storyPoints: 8,
      sprint: undefined,
      comments: [],
    },
    {
      id: 'task-5',
      taskKey: 'VC-105',
      title: 'Enterprise Customer Onboarding Strategy',
      description: 'Draft step-by-step migration playbook for AcroCorp enterprise team onboarding.',
      day: tomorrow,
      time: '15:30',
      status: 'open',
      source: 'team',
      assigneeId: 'user-5',
      assigneeName: 'Elena Rostova',
      priority: 'medium',
      category: 'epic',
      storyPoints: 5,
      sprint: undefined,
      comments: [],
    },
    {
      id: 'task-6',
      taskKey: 'VC-106',
      title: 'Finalize SLA Agreement & Compliance Docs',
      description: 'Cross-check data privacy clause and export compliance report for legal sign-off.',
      day: yesterday,
      time: '16:00',
      status: 'done',
      source: 'team',
      assigneeId: 'user-2',
      assigneeName: 'Sarah Chen',
      priority: 'high',
      category: 'story',
      storyPoints: 3,
      sprint: undefined,
      comments: [],
    },
  ]
}

function getInitialAccomplishments(): CalAccomplishment[] {
  const today = todayKey()
  const d = new Date()
  const yesterday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).toISOString().slice(0, 10)

  return [
    {
      id: 'acc-1',
      taskKey: 'VC-105',
      title: 'Closed Enterprise Tier Contract with AcroCorp ($120k ARR)',
      day: today,
      time: '10:30',
      category: 'deal',
      assigneeId: 'user-5',
      assigneeName: 'Elena Rostova',
      icon: '🎉',
    },
    {
      id: 'acc-2',
      taskKey: 'VC-101',
      title: 'Released Voice Chat Engine v2.4 to Production',
      day: today,
      time: '13:15',
      category: 'release',
      assigneeId: 'user-1',
      assigneeName: 'Alex River',
      icon: '🚀',
    },
    {
      id: 'acc-3',
      taskKey: 'VC-104',
      title: 'Achieved 99.99% Uptime SLA Benchmark for Q3',
      day: yesterday,
      time: '17:00',
      category: 'milestone',
      assigneeId: 'user-4',
      assigneeName: 'Jordan Taylor',
      icon: '🏆',
    },
  ]
}

function loadTasks(): CalTask[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY)
    if (!raw) return getInitialTasks()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return getInitialTasks()
    return parsed.map((t: CalTask, index) => ({
      ...t,
      taskKey: t.taskKey || `VC-${101 + index}`,
      priority: t.priority || 'medium',
      category: t.category || 'task',
      storyPoints: t.storyPoints,
      sprint: t.sprint,
      comments: t.comments || [],
    }))
  } catch {
    return getInitialTasks()
  }
}

function loadAccomplishments(): CalAccomplishment[] {
  try {
    const raw = localStorage.getItem(ACCOMPLISHMENTS_KEY)
    if (!raw) return getInitialAccomplishments()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return getInitialAccomplishments()
    return parsed as CalAccomplishment[]
  } catch {
    return getInitialAccomplishments()
  }
}

function saveTasks(tasks: CalTask[]) {
  try { localStorage.setItem(TASKS_KEY, JSON.stringify(tasks)) } catch { /* ignore */ }
}

function saveAccomplishments(accs: CalAccomplishment[]) {
  try { localStorage.setItem(ACCOMPLISHMENTS_KEY, JSON.stringify(accs)) } catch { /* ignore */ }
}

export function orderTasks(tasks: CalTask[]): CalTask[] {
  return [...tasks].sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === 'done') return 1
      if (b.status === 'done') return -1
    }
    if (a.time && b.time) return a.time.localeCompare(b.time)
    if (a.time) return -1
    if (b.time) return 1
    return 0
  })
}

export const useCalendar = create<State>((set, get) => ({
  tasks: loadTasks(),
  accomplishments: loadAccomplishments(),
  cursor: todayKey(),
  view: 'month',
  activeUserId: 'all',
  sprintFilter: 'all',
  categoryFilter: 'all',
  priorityFilter: 'all',

  showMonth() {
    set({ view: 'month' })
  },
  showDay(day) {
    set({ cursor: day, view: 'day' })
  },
  showList() {
    set({ view: 'list' })
  },
  setView(view) {
    set({ view })
  },
  setActiveUser(userId) {
    set({ activeUserId: userId })
  },
  setSprintFilter(sprint) {
    set({ sprintFilter: sprint })
  },
  setCategoryFilter(category) {
    set({ categoryFilter: category })
  },
  setPriorityFilter(priority) {
    set({ priorityFilter: priority })
  },

  goToday() {
    set({ cursor: todayKey() })
  },
  shiftMonth(delta) {
    set({ cursor: shiftMonthKey(get().cursor, delta) })
  },

  add(input) {
    const title = input.title.trim()
    const taskKey = input.taskKey || generateTaskKey(get().tasks)
    const task: CalTask = {
      id: crypto.randomUUID(),
      taskKey,
      title,
      description: input.description || null,
      day: input.day,
      time: input.time ?? null,
      status: 'open',
      source: input.source ?? null,
      assigneeId: input.assigneeId ?? null,
      assigneeName: input.assigneeName ?? null,
      assigneeAvatar: input.assigneeAvatar ?? null,
      priority: input.priority || 'medium',
      category: input.category || 'task',
      storyPoints: input.storyPoints,
      sprint: input.sprint,
      comments: [],
    }
    const tasks = [...get().tasks, task]
    saveTasks(tasks)
    set({ tasks })
    return task
  },

  updateTaskStatus(id, status) {
    const tasks = get().tasks.map((task) =>
      task.id === id ? { ...task, status } : task
    )
    saveTasks(tasks)
    set({ tasks })
  },

  updateTask(id, patch) {
    const tasks = get().tasks.map((task) =>
      task.id === id ? { ...task, ...patch } : task
    )
    saveTasks(tasks)
    set({ tasks })
  },

  addComment(taskId, text, authorName) {
    const clean = text.trim()
    if (!clean) return
    const comment: CalComment = {
      id: crypto.randomUUID(),
      authorName,
      text: clean,
      createdAt: 'Just now',
    }
    const tasks = get().tasks.map((task) =>
      task.id === taskId
        ? { ...task, comments: [...(task.comments || []), comment] }
        : task
    )
    saveTasks(tasks)
    set({ tasks })
  },

  addAccomplishment(input) {
    const title = input.title.trim()
    if (!title) return
    const acc: CalAccomplishment = {
      id: crypto.randomUUID(),
      taskKey: input.taskKey ?? null,
      title,
      day: input.day,
      time: input.time ?? null,
      category: input.category ?? 'milestone',
      assigneeId: input.assigneeId ?? null,
      assigneeName: input.assigneeName ?? null,
      icon: input.icon ?? '✨',
    }
    const accomplishments = [acc, ...get().accomplishments]
    saveAccomplishments(accomplishments)
    set({ accomplishments })
  },

  importTasks(rows) {
    const existing = new Set(get().tasks.map((task) => `${task.day}\0${task.title.toLowerCase()}`))
    const next: CalTask[] = []
    let currentTasks = get().tasks
    for (const row of rows) {
      const title = row.title.trim()
      const key = `${row.day}\0${title.toLowerCase()}`
      if (!title || existing.has(key)) continue
      existing.add(key)
      const taskKey = generateTaskKey(currentTasks)
      const newTask: CalTask = {
        id: crypto.randomUUID(),
        taskKey,
        title,
        day: row.day,
        time: row.time,
        status: row.status,
        source: 'import',
        priority: 'medium',
        category: 'task',
        storyPoints: 3,
        sprint: undefined,
        comments: [],
      }
      next.push(newTask)
      currentTasks = [...currentTasks, newTask]
    }
    if (!next.length) return 0
    saveTasks(currentTasks)
    set({ tasks: currentTasks })
    return next.length
  },

  addMany(titles, day, source) {
    const existing = new Set(get().tasks.filter((task) => task.day === day).map((task) => task.title.toLowerCase()))
    const next: CalTask[] = []
    let currentTasks = get().tasks
    for (const title of titles) {
      const clean = title.trim()
      if (!clean || existing.has(clean.toLowerCase())) continue
      existing.add(clean.toLowerCase())
      const taskKey = generateTaskKey(currentTasks)
      const newTask: CalTask = {
        id: crypto.randomUUID(),
        taskKey,
        title: clean,
        day,
        time: null,
        status: 'open',
        source,
        priority: 'medium',
        category: 'task',
        storyPoints: 3,
        sprint: undefined,
        comments: [],
      }
      next.push(newTask)
      currentTasks = [...currentTasks, newTask]
    }
    if (!next.length) return 0
    saveTasks(currentTasks)
    set({ tasks: currentTasks })
    return next.length
  },

  toggle(id) {
    const tasks = get().tasks.map((task) =>
      task.id === id
        ? { ...task, status: (task.status === 'done' ? 'open' : 'done') as 'open' | 'done' }
        : task
    )
    saveTasks(tasks)
    set({ tasks })
  },

  remove(id) {
    const tasks = get().tasks.filter((task) => task.id !== id)
    saveTasks(tasks)
    set({ tasks })
  },

  closeMatching(query, day) {
    const needle = query.trim().toLowerCase()
    if (!needle) return null
    const open = get().tasks.filter((task) => task.status !== 'done')
    const match =
      open.find((task) => task.day === day && (task.title.toLowerCase().includes(needle) || task.taskKey.toLowerCase().includes(needle))) ??
      open.find((task) => task.title.toLowerCase().includes(needle) || task.taskKey.toLowerCase().includes(needle))
    if (!match) return null
    get().toggle(match.id)
    return match.title
  },

  findTaskByNumber(query) {
    const clean = query.trim().toUpperCase()
    if (!clean) return null
    const tasks = get().tasks
    return (
      tasks.find((t) => t.taskKey.toUpperCase() === clean) ||
      tasks.find((t) => t.taskKey.toUpperCase().replace(/\D/g, '') === clean.replace(/\D/g, '') && clean.replace(/\D/g, '').length > 0) ||
      tasks.find((t) => t.id === query.trim()) ||
      null
    )
  },

  settleTaskByNumber(query) {
    const task = get().findTaskByNumber(query)
    if (!task) return null
    get().updateTaskStatus(task.id, 'done')
    return task
  },
}))

export function targetDay(): string {
  const { view, cursor } = useCalendar.getState()
  return view === 'day' ? cursor : todayKey()
}
