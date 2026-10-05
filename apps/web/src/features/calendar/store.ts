import { create } from 'zustand'
import { todayKey, shiftMonthKey } from './dates'
import type { CalTask } from './types'

const KEY = 'vc-tasks'

type State = {
  tasks: CalTask[]
  cursor: string
  view: 'month' | 'day'
  showMonth: () => void
  showDay: (day: string) => void
  goToday: () => void
  shiftMonth: (delta: number) => void
  add: (input: { title: string; day: string; time?: string | null; source?: string | null }) => void
  addMany: (titles: string[], day: string, source: string) => number
  importTasks: (rows: { title: string; day: string; time: string | null; status: 'open' | 'done' }[]) => number
  toggle: (id: string) => void
  remove: (id: string) => void
  closeMatching: (query: string, day: string) => string | null
}

function load(): CalTask[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isTask)
  } catch {
    return []
  }
}

function isTask(value: unknown): value is CalTask {
  if (!value || typeof value !== 'object') return false
  const task = value as Record<string, unknown>
  return typeof task.id === 'string'
    && typeof task.title === 'string'
    && typeof task.day === 'string'
    && (task.status === 'open' || task.status === 'done')
}

function save(tasks: CalTask[]) {
  try { localStorage.setItem(KEY, JSON.stringify(tasks)) } catch { /* keep the in-memory list */ }
}

export function orderTasks(tasks: CalTask[]): CalTask[] {
  return [...tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1
    if (a.time && b.time) return a.time.localeCompare(b.time)
    if (a.time) return -1
    if (b.time) return 1
    return 0
  })
}

export const useCalendar = create<State>((set, get) => ({
  tasks: load(),
  cursor: todayKey(),
  view: 'month',
  showMonth() {
    set({ view: 'month' })
  },
  showDay(day) {
    set({ cursor: day, view: 'day' })
  },
  goToday() {
    set({ cursor: todayKey() })
  },
  shiftMonth(delta) {
    set({ cursor: shiftMonthKey(get().cursor, delta), view: 'month' })
  },
  add(input) {
    const title = input.title.trim()
    if (!title) return
    const task: CalTask = {
      id: crypto.randomUUID(),
      title,
      day: input.day,
      time: input.time ?? null,
      status: 'open',
      source: input.source ?? null,
    }
    const tasks = [...get().tasks, task]
    save(tasks)
    set({ tasks })
  },
  importTasks(rows) {
    const existing = new Set(get().tasks.map((task) => `${task.day}\0${task.title.toLowerCase()}`))
    const next: CalTask[] = []
    for (const row of rows) {
      const title = row.title.trim()
      const key = `${row.day}\0${title.toLowerCase()}`
      if (!title || existing.has(key)) continue
      existing.add(key)
      next.push({ id: crypto.randomUUID(), title, day: row.day, time: row.time, status: row.status, source: 'import' })
    }
    if (!next.length) return 0
    const tasks = [...get().tasks, ...next]
    save(tasks)
    set({ tasks })
    return next.length
  },
  addMany(titles, day, source) {
    const existing = new Set(get().tasks.filter((task) => task.day === day).map((task) => task.title.toLowerCase()))
    const next: CalTask[] = []
    for (const title of titles) {
      const clean = title.trim()
      if (!clean || existing.has(clean.toLowerCase())) continue
      existing.add(clean.toLowerCase())
      next.push({ id: crypto.randomUUID(), title: clean, day, time: null, status: 'open', source })
    }
    if (!next.length) return 0
    const tasks = [...get().tasks, ...next]
    save(tasks)
    set({ tasks })
    return next.length
  },
  toggle(id) {
    const tasks = get().tasks.map((task) => task.id === id
      ? { ...task, status: task.status === 'open' ? 'done' as const : 'open' as const }
      : task)
    save(tasks)
    set({ tasks })
  },
  remove(id) {
    const tasks = get().tasks.filter((task) => task.id !== id)
    save(tasks)
    set({ tasks })
  },
  closeMatching(query, day) {
    const needle = query.trim().toLowerCase()
    if (!needle) return null
    const open = get().tasks.filter((task) => task.status === 'open')
    const match = open.find((task) => task.day === day && task.title.toLowerCase().includes(needle))
      ?? open.find((task) => task.title.toLowerCase().includes(needle))
    if (!match) return null
    get().toggle(match.id)
    return match.title
  },
}))

export function targetDay(): string {
  const { view, cursor } = useCalendar.getState()
  return view === 'day' ? cursor : todayKey()
}
