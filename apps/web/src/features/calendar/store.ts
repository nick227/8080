import { create } from 'zustand'
import { tasksApi, workLogsApi, type CreateTaskInput, type ImportTaskRow, type Task, type UpdateTaskInput, type WorkLog } from '@project/sdk'
import { matchesUrgency, type UrgencyKey } from '@project/shared'
import { todayKey, shiftMonthKey } from './dates'
import { WORK_CATEGORIES, type CalAccomplishment, type CalTask, type TaskPriority, type TaskStatus, type TaskType, type WorkCategory } from './types'

// Tasks belong to the workspace (server). This store keeps the copy every view
// reads, so a move or edit shows at once; the server answer then replaces it.
// `useTaskSync` (sync.ts) feeds it: live snapshots from the task stream
// (`applyServer`), and full lists for reconciliation (`hydrate`).
//
// Conflict rules: a server snapshot replaces the local card only if its version is
// at least the local one (late or reordered answers never win over newer state).
// While a card has its own writes in flight, snapshots for it are held (newest
// wins) and applied when those writes settle.

/** Tasks and work entries saved in this browser before they lived on the server. */
export const LOCAL_TASKS_KEY = 'vc-tasks'
export const LOCAL_LOGS_KEY = 'vc-accomplishments'
const RANK_STEP = 1024

export type View = 'month' | 'day' | 'list' | 'board' | 'backlog'

export type Filters = {
  /** WorkspaceMember ids; 'unassigned' matches tasks without one. */
  members: string[]
  types: TaskType[]
  areas: string[]
  priorities: TaskPriority[]
  /** Needs attention (shared definitions in @project/shared taskUrgency): any of these. */
  urgency: UrgencyKey[]
  search: string
}

export const NO_FILTERS: Filters = { members: [], types: [], areas: [], priorities: [], urgency: [], search: '' }

export type Notice = { id: number; text: string; undo?: () => void }

export type NewWorkLog = {
  title: string
  taskKey?: string | null
  day: string
  time?: string | null
  category?: WorkCategory
  hoursSpent?: number | null
  taskId?: string | null
  /** Move the task to done in the same change. */
  completeTask?: boolean
  assigneeId?: string | null
  assigneeName?: string | null
}

export type NewTask = {
  title: string
  description?: string | null
  day?: string | null
  time?: string | null
  status?: TaskStatus
  source?: string | null
  assigneeId?: string | null
  assigneeName?: string | null
  assigneeAvatar?: string | null
  priority?: TaskPriority
  category?: TaskType
  area?: string | null
  storyPoints?: number | null
  dueDate?: string | null
  afterTaskId?: string | null
  beforeTaskId?: string | null
}

type Placement = { afterTaskId?: string | null; beforeTaskId?: string | null }

type State = {
  workspaceId: string | null
  tasks: CalTask[]
  loaded: boolean
  syncing: boolean
  notice: Notice | null
  refresh: (() => void) | null
  accomplishments: CalAccomplishment[]
  cursor: string
  view: View
  filters: Filters

  hydrate: (workspaceId: string, tasks: Task[], refresh: () => void) => void
  /** One task's server state from the live stream (null = deleted). */
  applyServer: (taskId: string, task: Task | null) => void
  hydrateLogs: (workspaceId: string, logs: WorkLog[]) => void
  showMonth: () => void
  showDay: (day: string) => void
  showList: () => void
  setView: (view: View) => void
  setFilters: (patch: Partial<Filters>) => void
  clearFilters: () => void
  say: (text: string, undo?: () => void) => void
  dismiss: () => void

  goToday: () => void
  shiftMonth: (delta: number) => void

  add: (input: NewTask) => CalTask | null
  updateTaskStatus: (id: string, status: TaskStatus) => void
  moveTask: (id: string, status: TaskStatus, place: Placement) => void
  updateTask: (id: string, patch: Partial<CalTask>) => void
  block: (id: string, reason: string) => void
  unblock: (id: string) => void

  addAccomplishment: (input: NewWorkLog) => void
  removeAccomplishment: (id: string) => void

  addMany: (titles: string[], day: string, source: string) => number
  importTasks: (rows: { title: string; day: string; time: string | null; status: TaskStatus }[]) => number
  toggle: (id: string) => void
  remove: (id: string) => void
  restore: (task: CalTask) => void
  closeMatching: (query: string, day: string) => string | null
  findTaskByNumber: (query: string) => CalTask | null
  settleTaskByNumber: (query: string) => CalTask | null
}

export function fromServer(t: Task): CalTask {
  return {
    id: t.id,
    taskKey: t.taskKey,
    title: t.title,
    description: t.description,
    day: t.scheduledDate,
    time: t.scheduledTime,
    dueDate: t.dueDate,
    status: t.status,
    source: t.source,
    assigneeId: t.assigneeMemberId,
    assigneeName: t.assignee?.name ?? null,
    assigneeAvatar: t.assignee?.avatarUrl ?? null,
    priority: t.priority,
    category: t.issueType,
    area: t.area,
    storyPoints: t.storyPoints,
    rank: t.rank,
    version: t.version,
    commentCount: t.commentCount,
    resolvedAt: t.resolvedAt,
    blocked: t.blocked ? { since: t.blocked.since, reason: t.blocked.reason, byName: t.blocked.byName } : null,
    updatedAt: t.updatedAt,
  }
}

/** The fields of a local edit the server understands. */
function toUpdate(patch: Partial<CalTask>): UpdateTaskInput {
  const out: UpdateTaskInput = {}
  if ('title' in patch && patch.title !== undefined) out.title = patch.title
  if ('description' in patch) out.description = patch.description ?? null
  if ('status' in patch && patch.status) out.status = patch.status
  if ('category' in patch && patch.category) out.issueType = patch.category
  if ('area' in patch) out.area = patch.area ?? null
  if ('priority' in patch && patch.priority) out.priority = patch.priority
  if ('storyPoints' in patch) out.storyPoints = patch.storyPoints ?? null
  if ('day' in patch) out.scheduledDate = patch.day || null
  if ('time' in patch) out.scheduledTime = patch.time || null
  if ('dueDate' in patch) out.dueDate = patch.dueDate || null
  if ('assigneeId' in patch) out.assigneeMemberId = patch.assigneeId || null
  return out
}

function toRow(t: NewTask): ImportTaskRow {
  return {
    title: t.title,
    description: t.description ?? null,
    status: t.status ?? 'open',
    issueType: t.category ?? 'task',
    area: t.area ?? null,
    priority: t.priority ?? 'medium',
    storyPoints: t.storyPoints ?? null,
    scheduledDate: t.day ?? null,
    scheduledTime: t.day ? t.time ?? null : null,
    dueDate: t.dueDate ?? null,
    assigneeMemberId: t.assigneeId ?? null,
    source: t.source ?? null,
  }
}

export function columnOf(tasks: CalTask[], status: TaskStatus, exceptId?: string) {
  return tasks.filter((t) => t.status === status && t.id !== exceptId).sort((a, b) => a.rank - b.rank)
}

/** The rank a card gets between its neighbours (mirrors the server; the server's answer wins). */
function rankBetween(tasks: CalTask[], status: TaskStatus, place: Placement, movingId?: string) {
  const column = columnOf(tasks, status, movingId)
  const above = place.afterTaskId ? column.find((t) => t.id === place.afterTaskId)?.rank ?? null : null
  const below = place.beforeTaskId ? column.find((t) => t.id === place.beforeTaskId)?.rank ?? null : null
  if (above === null && below === null) return (column.at(-1)?.rank ?? 0) + RANK_STEP
  if (above === null) return below! - RANK_STEP
  if (below === null) return above + RANK_STEP
  return (above + below) / 2
}

export function applyFilters(tasks: CalTask[], f: Filters, ctx = { today: todayKey(), now: Date.now() }): CalTask[] {
  const needle = f.search.trim().toLowerCase()
  return tasks.filter((t) => {
    if (f.members.length && !f.members.includes(t.assigneeId ?? 'unassigned')) return false
    if (f.types.length && !f.types.includes(t.category ?? 'task')) return false
    if (f.areas.length && !f.areas.includes(t.area ?? '')) return false
    if (f.priorities.length && !f.priorities.includes(t.priority ?? 'medium')) return false
    if (!matchesUrgency(t, f.urgency, ctx)) return false
    if (needle && !t.title.toLowerCase().includes(needle) && !t.taskKey.toLowerCase().includes(needle)) return false
    return true
  })
}

export const filtersActive = (f: Filters) =>
  f.members.length + f.types.length + f.areas.length + f.priorities.length + f.urgency.length > 0 || f.search.trim() !== ''

export const workIcon = (category: string) => WORK_CATEGORIES.find((c) => c.id === category)?.icon ?? '✨'

export function logFromServer(l: WorkLog): CalAccomplishment {
  return {
    id: l.id,
    taskId: l.taskId,
    taskKey: l.taskKey,
    title: l.summary,
    day: l.day,
    time: l.time,
    category: l.category,
    hoursSpent: l.hoursSpent,
    assigneeId: l.memberId,
    assigneeName: l.member?.name ?? null,
    authorMemberId: l.authorMemberId,
    icon: workIcon(l.category),
  }
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

// Writes in flight per card (by its current id), and the newest server snapshot
// that arrived meanwhile. A temporary id is aliased to the real one once created.
const writing = new Map<string, number>()
const held = new Map<string, Task | null>()
const aliases = new Map<string, string>()
// Creates/imports in flight: a snapshot for an unknown id may be our own new card,
// and a full list can't be merged safely until they land.
let creates = 0
let reconcileAfter = false
// Cards the server confirmed recently: a list fetched before that may not have them.
const confirmedAt = new Map<string, number>()
const CONFIRM_GRACE_MS = 15_000
let logWrites = 0
// A card created moments ago has a temporary id until the server answers.
const creating = new Map<string, Promise<string>>()
let noticeId = 0

const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')

export const useCalendar = create<State>((set, get) => {
  const replaceTask = (id: string, next: CalTask | null) =>
    set({ tasks: next ? get().tasks.map((t) => (t.id === id ? next : t)) : get().tasks.filter((t) => t.id !== id) })

  const realId = (id: string) => creating.get(id) ?? Promise.resolve(id)

  const keyOf = (id: string) => aliases.get(id) ?? id

  /** Keep the newest snapshot for a card that is busy (null = deleted; a later task means restored). */
  const hold = (id: string, task: Task | null) => {
    const prev = held.get(id)
    if (task === null || prev === undefined || prev === null || task.version >= prev.version) held.set(id, task)
  }

  const flush = (id: string) => {
    if (!held.has(id)) return
    const task = held.get(id)!
    held.delete(id)
    get().applyServer(id, task)
  }

  /**
   * Runs a server write. `taskId` marks the card busy until it settles; `snapshot`
   * picks the server's answer for that card. On failure, says why and reconciles.
   */
  function send<T>(
    what: string,
    run: (workspaceId: string) => Promise<T>,
    opts: { taskId?: string; snapshot?: (value: T) => Task | null; onDone?: (value: T) => void; onFail?: (err: unknown) => void; logs?: boolean } = {},
  ) {
    const workspaceId = get().workspaceId
    if (!workspaceId) {
      opts.onFail?.(new Error('no workspace'))
      get().say('Tasks are still loading. Try again in a moment.')
      return
    }
    if (opts.taskId) writing.set(keyOf(opts.taskId), (writing.get(keyOf(opts.taskId)) ?? 0) + 1)
    if (opts.logs) logWrites++
    set({ syncing: true })
    run(workspaceId)
      .then((value) => {
        opts.onDone?.(value)
        if (opts.taskId && opts.snapshot) hold(keyOf(opts.taskId), opts.snapshot(value))
      })
      .catch((err) => {
        opts.onFail?.(err)
        get().say(`Couldn't ${what}: ${message(err)}`)
        // The server's state wins after a refused or failed write.
        get().refresh?.()
      })
      .finally(() => {
        if (opts.logs) logWrites--
        if (opts.taskId) {
          const key = keyOf(opts.taskId)
          const left = (writing.get(key) ?? 1) - 1
          if (left > 0) writing.set(key, left)
          else {
            writing.delete(key)
            flush(key)
          }
        }
        if (!writing.size && !creates && !logWrites) set({ syncing: false })
      })
  }

  /** A create or import has landed: apply what waited on it. */
  const createSettled = () => {
    creates--
    if (creates) return
    for (const id of [...held.keys()]) if (!writing.has(id)) flush(id)
    if (reconcileAfter) {
      reconcileAfter = false
      get().refresh?.()
    }
  }

  const patchLocal = (id: string, patch: Partial<CalTask>) =>
    set({ tasks: get().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })

  const importRows = (rows: NewTask[], what: string) => {
    if (!rows.length) return 0
    const temps: CalTask[] = rows.map((row, i) => ({
      ...draft(row),
      rank: rankBetween(get().tasks, row.status ?? 'open', {}) + i * RANK_STEP,
    }))
    set({ tasks: [...get().tasks, ...temps] })
    creates++
    const ids = new Set(temps.map((t) => t.id))
    send(what, (ws) => tasksApi.import(ws, { tasks: rows.map(toRow) }).finally(createSettled), {
      onDone: (created) => {
        const real = new Set(created.map((t) => t.id))
        const now = Date.now()
        real.forEach((id) => confirmedAt.set(id, now))
        set({ tasks: [...get().tasks.filter((t) => !ids.has(t.id) && !real.has(t.id)), ...created.map(fromServer)] })
      },
      onFail: () => set({ tasks: get().tasks.filter((t) => !ids.has(t.id)) }),
    })
    return rows.length
  }

  return {
    workspaceId: null,
    tasks: [],
    loaded: false,
    syncing: false,
    notice: null,
    refresh: null,
    accomplishments: [],
    cursor: todayKey(),
    view: 'month',
    filters: NO_FILTERS,

    hydrate(workspaceId, tasks, refresh) {
      if (get().workspaceId !== workspaceId) set({ workspaceId, tasks: [], loaded: false })
      set({ refresh })
      if (!get().loaded) {
        set({ tasks: tasks.map(fromServer), loaded: true })
        return
      }
      // A full list can't tell our in-flight new cards from others: merge after they land.
      if (creates) {
        reconcileAfter = true
        return
      }
      const server = new Map(tasks.map((t) => [t.id, t]))
      const now = Date.now()
      const next: CalTask[] = []
      for (const local of get().tasks) {
        const remote = server.get(local.id)
        server.delete(local.id)
        if (writing.has(local.id)) {
          // Busy card: keep what the person sees; the list's view waits its turn.
          hold(local.id, remote ?? null)
          next.push(local)
        } else if (remote) {
          next.push(remote.version >= local.version ? fromServer(remote) : local)
        } else if (local.pending || now - (confirmedAt.get(local.id) ?? 0) < CONFIRM_GRACE_MS) {
          next.push(local)
        }
        // else: deleted elsewhere.
      }
      for (const remote of server.values()) {
        if (writing.has(remote.id)) hold(remote.id, remote) // e.g. our own delete in flight
        else next.push(fromServer(remote))
      }
      set({ tasks: next })
    },

    applyServer(taskId, task) {
      const id = keyOf(taskId)
      if (writing.has(id)) {
        hold(id, task)
        return
      }
      const local = get().tasks.find((t) => t.id === id)
      if (!local) {
        if (task === null) return
        // Maybe our own new card, still under its temporary id: wait for it.
        if (creates) {
          hold(id, task)
          return
        }
        set({ tasks: [...get().tasks, fromServer(task)] })
        return
      }
      if (task === null) replaceTask(id, null)
      else if (task.version >= local.version) replaceTask(id, fromServer(task))
    },

    hydrateLogs(workspaceId, logs) {
      if (logWrites || get().workspaceId !== workspaceId) return
      const waiting = get().accomplishments.filter((a) => a.pending)
      set({ accomplishments: [...waiting, ...logs.map(logFromServer)] })
    },

    showMonth() { set({ view: 'month' }) },
    showDay(day) { set({ cursor: day, view: 'day' }) },
    showList() { set({ view: 'list' }) },
    setView(view) { set({ view }) },
    setFilters(patch) { set({ filters: { ...get().filters, ...patch } }) },
    clearFilters() { set({ filters: NO_FILTERS }) },
    say(text, undo) { set({ notice: { id: ++noticeId, text, undo } }) },
    dismiss() { set({ notice: null }) },

    goToday() { set({ cursor: todayKey() }) },
    shiftMonth(delta) { set({ cursor: shiftMonthKey(get().cursor, delta) }) },

    add(input) {
      const title = input.title.trim()
      if (!title) return null
      const status = input.status ?? 'open'
      const temp: CalTask = { ...draft({ ...input, title }), rank: rankBetween(get().tasks, status, input) }
      set({ tasks: [...get().tasks, temp] })
      let resolve!: (id: string) => void
      let reject!: (err: unknown) => void
      const real = new Promise<string>((res, rej) => { resolve = res; reject = rej })
      real.catch(() => { /* the create reports its own failure */ })
      creating.set(temp.id, real)
      const body: CreateTaskInput = { ...toRow({ ...input, title }), afterTaskId: input.afterTaskId ?? null, beforeTaskId: input.beforeTaskId ?? null }
      delete (body as { source?: unknown }).source
      creates++
      send('add the task', async (ws) => {
        // Neighbours that are still being created themselves: place by their real ids.
        body.afterTaskId = body.afterTaskId ? await realId(body.afterTaskId) : null
        body.beforeTaskId = body.beforeTaskId ? await realId(body.beforeTaskId) : null
        return tasksApi.create(ws, body)
      }, {
        onDone: (task) => {
          // Writes queued on the temporary id now belong to the real one.
          aliases.set(temp.id, task.id)
          if (writing.has(temp.id)) {
            writing.set(task.id, writing.get(temp.id)!)
            writing.delete(temp.id)
          }
          confirmedAt.set(task.id, Date.now())
          // Keep any move made while it was being created (its write follows).
          const local = get().tasks.find((t) => t.id === temp.id)
          set({ tasks: get().tasks.filter((t) => t.id !== task.id) }) // a stream copy that beat the answer
          replaceTask(temp.id, local ? { ...fromServer(task), status: local.status, rank: local.rank } : fromServer(task))
          resolve(task.id)
          creating.delete(temp.id)
          createSettled()
        },
        onFail: (err) => {
          // Writes queued behind this card fail with it.
          replaceTask(temp.id, null)
          reject(err)
          creating.delete(temp.id)
          createSettled()
        },
      })
      return temp
    },

    updateTaskStatus(id, status) {
      get().moveTask(id, status, {})
    },

    moveTask(id, status, place) {
      const task = get().tasks.find((t) => t.id === id)
      if (!task) return
      const rank = rankBetween(get().tasks, status, place, id)
      if (task.status === status && task.rank === rank) return
      patchLocal(id, { status, rank, resolvedAt: status === 'done' ? task.resolvedAt ?? new Date().toISOString() : null })
      send('move the task', async (ws) =>
        tasksApi.move(ws, await realId(id), {
          status,
          afterTaskId: place.afterTaskId ? await realId(place.afterTaskId) : null,
          beforeTaskId: place.beforeTaskId ? await realId(place.beforeTaskId) : null,
        }),
        { taskId: id, snapshot: (t) => t },
      )
    },

    updateTask(id, patch) {
      const task = get().tasks.find((t) => t.id === id)
      if (!task) return
      const body = toUpdate(patch)
      if (!Object.keys(body).length) return
      // A new column through the editor = bottom of that column (as the server does).
      const moved = patch.status && patch.status !== task.status ? { rank: rankBetween(get().tasks, patch.status, {}, id) } : {}
      patchLocal(id, { ...patch, ...moved, ...(patch.day === null ? { time: null } : {}) })
      send('save the task', async (ws) => tasksApi.update(ws, await realId(id), body), { taskId: id, snapshot: (t) => t })
    },

    block(id, reason) {
      const task = get().tasks.find((t) => t.id === id)
      const clean = reason.trim()
      if (!task || !clean) return
      patchLocal(id, { blocked: { since: task.blocked?.since ?? new Date().toISOString(), reason: clean.slice(0, 280), byName: task.blocked?.byName ?? null } })
      send('mark the task blocked', async (ws) => tasksApi.block(ws, await realId(id), clean), { taskId: id, snapshot: (t) => t })
    },

    unblock(id) {
      const task = get().tasks.find((t) => t.id === id)
      if (!task?.blocked) return
      patchLocal(id, { blocked: null })
      send('unblock the task', async (ws) => tasksApi.unblock(ws, await realId(id)), { taskId: id, snapshot: (t) => t })
    },

    addAccomplishment(input) {
      const title = input.title.trim()
      if (!title) return
      const temp: CalAccomplishment = {
        id: `tmp-${crypto.randomUUID()}`,
        taskId: input.taskId ?? null,
        taskKey: input.taskId ? get().tasks.find((t) => t.id === input.taskId)?.taskKey ?? null : null,
        title,
        day: input.day,
        time: input.time ?? null,
        category: input.category ?? 'work',
        hoursSpent: input.hoursSpent ?? null,
        assigneeId: input.assigneeId ?? null,
        assigneeName: input.assigneeName ?? null,
        icon: workIcon(input.category ?? 'work'),
        pending: true,
      }
      set({ accomplishments: [temp, ...get().accomplishments] })
      const task = input.completeTask && input.taskId ? get().tasks.find((t) => t.id === input.taskId) : null
      if (task && task.status !== 'done') {
        patchLocal(task.id, { status: 'done', rank: rankBetween(get().tasks, 'done', {}, task.id), resolvedAt: new Date().toISOString() })
      }
      const drop = () => set({ accomplishments: get().accomplishments.filter((a) => a.id !== temp.id) })
      send('log the work', async (ws) => workLogsApi.create(ws, {
        summary: title,
        day: input.day,
        time: input.time || null,
        category: input.category ?? 'work',
        hoursSpent: input.hoursSpent ?? null,
        memberId: input.assigneeId ?? null,
        taskId: input.taskId ? await realId(input.taskId) : null,
        completeTask: !!task,
      }), {
        logs: true,
        onDone: (log) => set({ accomplishments: get().accomplishments.map((a) => (a.id === temp.id ? logFromServer(log) : a)) }),
        onFail: drop,
      })
    },

    removeAccomplishment(id) {
      const entry = get().accomplishments.find((a) => a.id === id)
      if (!entry || entry.pending) return
      set({ accomplishments: get().accomplishments.filter((a) => a.id !== id) })
      send('delete the entry', (ws) => workLogsApi.remove(ws, id), { logs: true })
      get().say('Deleted the work entry', () => {
        get().dismiss()
        get().addAccomplishment({ title: entry.title, day: entry.day, time: entry.time, category: entry.category, hoursSpent: entry.hoursSpent, taskId: entry.taskId, assigneeId: entry.assigneeId, assigneeName: entry.assigneeName })
      })
    },

    importTasks(rows) {
      const existing = new Set(get().tasks.map((task) => `${task.day}\0${task.title.toLowerCase()}`))
      const fresh: NewTask[] = []
      for (const row of rows) {
        const title = row.title.trim()
        const key = `${row.day}\0${title.toLowerCase()}`
        if (!title || existing.has(key)) continue
        existing.add(key)
        fresh.push({ title, day: row.day, time: row.time, status: row.status, source: 'import' })
      }
      return importRows(fresh, 'import the tasks')
    },

    addMany(titles, day, source) {
      const existing = new Set(get().tasks.filter((task) => task.day === day).map((task) => task.title.toLowerCase()))
      const fresh: NewTask[] = []
      for (const title of titles) {
        const clean = title.trim()
        if (!clean || existing.has(clean.toLowerCase())) continue
        existing.add(clean.toLowerCase())
        fresh.push({ title: clean, day, source })
      }
      return importRows(fresh, 'add the tasks')
    },

    toggle(id) {
      const task = get().tasks.find((t) => t.id === id)
      if (task) get().moveTask(id, task.status === 'done' ? 'open' : 'done', {})
    },

    remove(id) {
      const task = get().tasks.find((t) => t.id === id)
      if (!task) return
      replaceTask(id, null)
      send('delete the task', async (ws) => tasksApi.remove(ws, await realId(id)), { taskId: id, snapshot: () => null })
      get().say(`Deleted ${task.taskKey}`, () => get().restore(task))
    },

    restore(task) {
      if (!get().tasks.some((t) => t.id === task.id)) set({ tasks: [...get().tasks, task] })
      get().dismiss()
      send('restore the task', async (ws) => tasksApi.restore(ws, await realId(task.id)), { taskId: task.id, snapshot: (t) => t })
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
      const digits = clean.replace(/\D/g, '')
      return (
        tasks.find((t) => t.taskKey.toUpperCase() === clean) ||
        tasks.find((t) => digits.length > 0 && t.taskKey.toUpperCase().replace(/\D/g, '') === digits) ||
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
  }
})

function draft(input: NewTask): CalTask {
  return {
    id: `tmp-${crypto.randomUUID()}`,
    taskKey: '…',
    title: input.title.trim(),
    description: input.description ?? null,
    day: input.day ?? null,
    time: input.day ? input.time ?? null : null,
    dueDate: input.dueDate ?? null,
    status: input.status ?? 'open',
    source: input.source ?? null,
    assigneeId: input.assigneeId ?? null,
    assigneeName: input.assigneeName ?? null,
    assigneeAvatar: input.assigneeAvatar ?? null,
    priority: input.priority ?? 'medium',
    category: input.category ?? 'task',
    area: input.area ?? null,
    storyPoints: input.storyPoints ?? null,
    rank: 0,
    version: 1,
    commentCount: 0,
    pending: true,
  }
}

export function targetDay(): string {
  const { view, cursor } = useCalendar.getState()
  return view === 'day' ? cursor : todayKey()
}
