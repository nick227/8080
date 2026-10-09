import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { keys, tasksApi, useSession, useTasks, useWorkspaceMembers, type ImportTaskRow } from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
import { LOCAL_TASKS_KEY, useCalendar } from './store'
import type { TeamMember } from './types'

// Teammates' changes arrive on the next poll (and on window focus).
const POLL_MS = 15_000

/** Keeps the calendar store fed with the workspace's tasks while a task surface is open. */
export function useTaskSync() {
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id
  const query = useTasks(workspaceId, { refetchInterval: POLL_MS })
  const queryClient = useQueryClient()
  const hydrate = useCalendar((s) => s.hydrate)
  useEffect(() => {
    if (!workspaceId || !query.data) return
    hydrate(workspaceId, query.data, () => void queryClient.invalidateQueries({ queryKey: keys.tasks(workspaceId) }))
  }, [workspaceId, query.data, hydrate, queryClient])
  return { error: query.isError ? (query.error as Error).message : null, retry: () => void query.refetch() }
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

/** Offers to move tasks saved only in this browser into the workspace, once. */
export function useLocalTasks() {
  const workspaceId = useCalendar((s) => s.workspaceId)
  const refresh = useCalendar((s) => s.refresh)
  const [local, setLocal] = useState(readLocal)
  const [state, setState] = useState<'idle' | 'moving' | 'failed'>('idle')

  const forget = () => {
    try { localStorage.removeItem(LOCAL_TASKS_KEY) } catch { /* ignore */ }
    setLocal([])
  }

  const move = async () => {
    if (!workspaceId || !local.length) return
    setState('moving')
    try {
      // One key per set of local tasks: a retry after a lost answer adds nothing twice.
      const key = `local-tasks:${hash(local.map((t) => t.id).sort().join(','))}`
      for (let i = 0; i < local.length; i += 500) {
        await tasksApi.import(workspaceId, { tasks: local.slice(i, i + 500).map(toRow), idempotencyKey: `${key}:${i}` })
      }
      forget()
      setState('idle')
      refresh?.()
    } catch {
      setState('failed')
    }
  }

  return { count: local.length, state, move, discard: forget }
}
