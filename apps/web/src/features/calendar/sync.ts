import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { keys, tasksApi, useSession, useTasks, useWorkLogs, useWorkspaceMembers, workLogsApi, type ImportTaskRow, type ImportWorkLogRow } from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
import { LOCAL_LOGS_KEY, LOCAL_TASKS_KEY, useCalendar } from './store'
import type { CalAccomplishment, TeamMember } from './types'

// Teammates' changes arrive on the next poll (and on window focus).
const POLL_MS = 15_000

/** Keeps the calendar store fed with the workspace's tasks while a task surface is open. */
export function useTaskSync() {
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id
  const query = useTasks(workspaceId, { refetchInterval: POLL_MS })
  const logs = useWorkLogs(workspaceId, { refetchInterval: POLL_MS })
  const queryClient = useQueryClient()
  const hydrate = useCalendar((s) => s.hydrate)
  const hydrateLogs = useCalendar((s) => s.hydrateLogs)
  useEffect(() => {
    if (!workspaceId || !query.data) return
    hydrate(workspaceId, query.data, () => {
      void queryClient.invalidateQueries({ queryKey: keys.tasks(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: keys.workLogs(workspaceId) })
    })
  }, [workspaceId, query.data, hydrate, queryClient])
  // After hydrate: the logs belong to the workspace the store has switched to.
  const tasksReady = !!query.data
  useEffect(() => {
    if (workspaceId && logs.data && tasksReady) hydrateLogs(workspaceId, logs.data)
  }, [workspaceId, logs.data, tasksReady, hydrateLogs])
  return { error: query.isError ? (query.error as Error).message : null, retry: () => void query.refetch() }
}

/** Whether the viewer may delete a work entry (mirrors the server: admins, its author, its member). */
export function useCanDeleteLog() {
  const { workspace } = useCurrentWorkspace()
  const { meId } = useTeam()
  const admin = workspace?.role === 'owner' || workspace?.role === 'admin'
  return (entry: CalAccomplishment) => !entry.pending && (admin || (!!meId && (entry.authorMemberId === meId || entry.assigneeId === meId)))
}

/** Active workspace members, for assignee pickers and the member filter. */
export function useTeam(): { team: TeamMember[]; meId: string | null } {
  const { workspace } = useCurrentWorkspace()
  const members = useWorkspaceMembers(workspace?.id)
  const session = useSession()
  const userId = session.data?.data.id
  return useMemo(() => {
    const active = (members.data ?? []).filter((m) => m.status === 'active')
    return {
      team: active.map((m) => ({ id: m.id, name: m.user.name, avatarUrl: m.user.avatarUrl })),
      meId: active.find((m) => m.user.id === userId)?.id ?? null,
    }
  }, [members.data, userId])
}

// ─── tasks saved in this browser before tasks lived on the server ────────────

type LocalTask = {
  id: string
  title?: string
  description?: string | null
  day?: string
  time?: string | null
  dueDate?: string | null
  status?: string
  priority?: string
  category?: string
  area?: string | null
  storyPoints?: number
}

// The old built-in demo tickets (task-1…6) are not the person's work.
const DEMO = /^task-\d$/
const STATUSES = ['open', 'in_progress', 'in_review', 'done']
const PRIORITIES = ['low', 'medium', 'high', 'highest']
const TYPES = ['task', 'feature', 'bug', 'story', 'epic']
const DAY = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

// FNV-1a, 32-bit: a short stable name for a set of ids.
function hash(text: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

function readLocal(): LocalTask[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LOCAL_TASKS_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as LocalTask[]).filter((t) => t && !DEMO.test(t.id) && t.title?.trim()) : []
  } catch {
    return []
  }
}

type LocalLog = { id: string; title?: string; day?: string; time?: string | null; taskKey?: string | null; category?: string }
const LOG_CATEGORIES = ['work', 'milestone', 'release', 'deal', 'meeting']

function readLocalLogs(): LocalLog[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LOCAL_LOGS_KEY) ?? '[]')
    // The old demo entries (acc-1…3) aren't the person's work.
    return Array.isArray(parsed) ? (parsed as LocalLog[]).filter((a) => a && !/^acc-\d$/.test(a.id) && a.title?.trim() && a.day && DAY.test(a.day)) : []
  } catch {
    return []
  }
}

function toLogRow(a: LocalLog): ImportWorkLogRow {
  return {
    summary: a.title!.trim().slice(0, 500),
    day: a.day!,
    time: a.time && CLOCK.test(a.time) ? a.time : null,
    category: (LOG_CATEGORIES.includes(a.category ?? '') ? a.category : 'work') as ImportWorkLogRow['category'],
    taskKey: a.taskKey?.slice(0, 32) ?? null,
  }
}

function toRow(t: LocalTask): ImportTaskRow {
  const day = t.day && DAY.test(t.day) ? t.day : null
  return {
    title: t.title!.trim().slice(0, 255),
    description: t.description ?? null,
    status: (STATUSES.includes(t.status ?? '') ? t.status : 'open') as ImportTaskRow['status'],
    priority: (PRIORITIES.includes(t.priority ?? '') ? t.priority : 'medium') as ImportTaskRow['priority'],
    issueType: (TYPES.includes(t.category ?? '') ? t.category : 'task') as ImportTaskRow['issueType'],
    area: t.area ?? null,
    storyPoints: typeof t.storyPoints === 'number' ? t.storyPoints : null,
    scheduledDate: day,
    scheduledTime: day && t.time && CLOCK.test(t.time) ? t.time : null,
    dueDate: t.dueDate && DAY.test(t.dueDate) ? t.dueDate : null,
    source: 'this browser',
  }
}

/** Offers to move tasks and work entries saved only in this browser into the workspace, once. */
export function useLocalTasks() {
  const workspaceId = useCalendar((s) => s.workspaceId)
  const refresh = useCalendar((s) => s.refresh)
  const [local, setLocal] = useState(readLocal)
  const [logs, setLogs] = useState(readLocalLogs)
  const [state, setState] = useState<'idle' | 'moving' | 'failed'>('idle')

  const forget = () => {
    try {
      localStorage.removeItem(LOCAL_TASKS_KEY)
      localStorage.removeItem(LOCAL_LOGS_KEY)
    } catch { /* ignore */ }
    setLocal([])
    setLogs([])
  }

  const move = async () => {
    if (!workspaceId || (!local.length && !logs.length)) return
    setState('moving')
    try {
      // One key per set of local items: a retry after a lost answer adds nothing twice.
      const key = `local-tasks:${hash(local.map((t) => t.id).sort().join(','))}`
      for (let i = 0; i < local.length; i += 500) {
        await tasksApi.import(workspaceId, { tasks: local.slice(i, i + 500).map(toRow), idempotencyKey: `${key}:${i}` })
      }
      // Moved tasks get new keys, so entries keep their old key as history.
      const logKey = `local-logs:${hash(logs.map((a) => a.id).sort().join(','))}`
      for (let i = 0; i < logs.length; i += 500) {
        await workLogsApi.import(workspaceId, { entries: logs.slice(i, i + 500).map(toLogRow), idempotencyKey: `${logKey}:${i}` })
      }
      forget()
      setState('idle')
      refresh?.()
    } catch {
      setState('failed')
    }
  }

  return { count: local.length, logCount: logs.length, state, move, discard: forget }
}
