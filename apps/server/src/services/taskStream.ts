// Live board updates for one workspace, built on workspaceEvents (the recorded
// Activity rows, published after commit). One process, like inboxHub.
//
// Each frame carries an id `<boot>:<seq>`. A reconnecting client sends the last id
// it saw: if it is from this process and still in the buffer, the missed frames are
// replayed; otherwise it gets `reset` and reconciles with one list fetch. Task frames
// carry the task's current snapshot (read once per event, not per client) with its
// version, so clients can ignore anything older than what they hold.
import { randomUUID } from 'crypto'
import { db } from '@project/db'
import { taskInclude, toTask } from './TaskService'
import { subscribeWorkspace, type WorkspaceEvent } from './workspaceEvents'

const BOOT = randomUUID().slice(0, 8)
const BUFFER = 500
// Keep a channel's buffer this long after its last viewer leaves, so a quick
// reconnect (network blip, reload) still replays instead of resetting.
const LINGER_MS = 60_000

export type TaskFrame = { id: string; seq: number; event: string; data: Record<string, unknown> }
type Send = (frame: TaskFrame) => void

type Channel = {
  seq: number
  buffer: TaskFrame[]
  clients: Set<Send>
  unsubscribe: () => void
  // Events are turned into frames one at a time, so frame order = event order.
  queue: Promise<void>
  linger?: ReturnType<typeof setTimeout>
}

const channels = new Map<string, Channel>()

async function framesFor(workspaceId: string, e: WorkspaceEvent): Promise<{ event: string; data: Record<string, unknown> }[]> {
  const base = { activityId: e.activityId, type: e.type, actorMemberId: e.actorMemberId, occurredAt: e.occurredAt }
  const out: { event: string; data: Record<string, unknown> }[] = []
  if (e.taskId) {
    const row = await db.workTask.findFirst({ where: { id: e.taskId, workspaceId }, include: taskInclude })
    out.push({ event: 'task.changed', data: { ...base, taskId: e.taskId, task: row && !row.deletedAt ? toTask(row) : null } })
  }
  if (e.type.startsWith('worklog.')) out.push({ event: 'worklogs.changed', data: base })
  if (e.type === 'task.board.updated') {
    const board = await db.taskBoardSettings.findUnique({ where: { workspaceId } })
    out.push({ event: 'board.updated', data: { ...base, wipLimits: board?.wipLimits ?? {} } })
  }
  // Many tasks at once (import) or ranks rewritten (column renumbered): cheaper to reconcile.
  if (e.type === 'task.imported' || e.type === 'task.column.renumbered') out.push({ event: 'reset', data: { ...base, reason: e.type } })
  return out
}

function channelFor(workspaceId: string): Channel {
  let ch = channels.get(workspaceId)
  if (ch) {
    if (ch.linger) clearTimeout(ch.linger)
    ch.linger = undefined
    return ch
  }
  const created: Channel = { seq: 0, buffer: [], clients: new Set(), unsubscribe: () => {}, queue: Promise.resolve() }
  created.unsubscribe = subscribeWorkspace(workspaceId, (e) => {
    created.queue = created.queue
      .then(async () => {
        for (const f of await framesFor(workspaceId, e)) {
          const seq = ++created.seq
          const frame: TaskFrame = { id: `${BOOT}:${seq}`, seq, ...f }
          created.buffer.push(frame)
          if (created.buffer.length > BUFFER) created.buffer.shift()
          for (const send of created.clients) send(frame)
        }
      })
      .catch(() => {
        // A failed read must not stall the channel: tell viewers to reconcile.
        const seq = ++created.seq
        const frame: TaskFrame = { id: `${BOOT}:${seq}`, seq, event: 'reset', data: { reason: 'error' } }
        created.buffer.push(frame)
        for (const send of created.clients) send(frame)
      })
  })
  channels.set(workspaceId, created)
  return created
}

/**
 * Join a workspace's task stream. Returns the frames to replay (null = the client
 * must reconcile: no usable last id) and an unsubscribe function.
 */
export function joinTaskStream(workspaceId: string, lastEventId: string | null, send: Send) {
  const ch = channelFor(workspaceId)
  let replay: TaskFrame[] | null = null
  const [boot, raw] = (lastEventId ?? '').split(':')
  const last = Number(raw)
  if (boot === BOOT && Number.isInteger(last) && last >= 0) {
    const first = ch.buffer[0]?.seq ?? ch.seq + 1
    // Everything after `last` is still buffered (or nothing happened since).
    if (last >= first - 1 && last <= ch.seq) replay = ch.buffer.filter((f) => f.seq > last)
  }
  ch.clients.add(send)
  return {
    replay,
    current: `${BOOT}:${ch.seq}`,
    leave: () => {
      ch.clients.delete(send)
      if (ch.clients.size) return
      ch.linger = setTimeout(() => {
        if (ch.clients.size) return
        ch.unsubscribe()
        channels.delete(workspaceId)
      }, LINGER_MS)
      ch.linger.unref?.()
    },
  }
}

/** Test hook: let queued events finish turning into frames. */
export async function drainTaskStream(workspaceId: string) {
  await channels.get(workspaceId)?.queue
}
