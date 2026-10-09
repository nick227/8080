// Live board updates: snapshots with versions, replay after a reconnect, reset when
// the client is too far behind. Real socket (SSE bodies can't be read via inject).
import { describe, it, expect } from 'vitest'
import http from 'http'
import { buildTestApp, asAuth, testUserId } from './helpers'
import { caller, carolId, daveId, createWorkspace, join, seedPeople } from './helpers/workspace'

const app = buildTestApp()
const call = caller(app)

type Frame = { event: string; id?: string; [k: string]: any }

function open(port: number, workspaceId: string, userId: string, lastEventId?: string) {
  return new Promise<{ status: number; next: (event: string) => Promise<Frame>; frames: Frame[]; close: () => void }>((resolve, reject) => {
    const req = http.get({ port, path: `/workspaces/${workspaceId}/tasks/stream`, headers: { ...asAuth(userId), ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}) } }, (res) => {
      let buffer = ''
      const frames: Frame[] = []
      const waiters: { event: string; resolve: (f: Frame) => void }[] = []
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        buffer += chunk
        let at
        while ((at = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, at)
          buffer = buffer.slice(at + 2)
          const event = /^event: (.+)$/m.exec(raw)?.[1]
          const data = /^data: (.+)$/m.exec(raw)?.[1]
          if (!event || !data) continue
          const frame = { ...JSON.parse(data), id: /^id: (.+)$/m.exec(raw)?.[1] }
          frames.push(frame)
          const w = waiters.findIndex((x) => x.event === event)
          if (w !== -1) waiters.splice(w, 1)[0]!.resolve(frame)
        }
      })
      let read = 0
      resolve({
        status: res.statusCode!,
        frames,
        // The next not-yet-consumed frame of this kind.
        next: (event) => new Promise((r, j) => {
          const found = frames.slice(read).find((f) => f.event === event)
          if (found) { read = frames.indexOf(found) + 1; return r(found) }
          const timer = setTimeout(() => j(new Error(`no ${event} frame`)), 5000)
          waiters.push({ event, resolve: (f) => { clearTimeout(timer); read = frames.indexOf(f) + 1; r(f) } })
        }),
        close: () => req.destroy(),
      })
    })
    req.on('error', reject)
  })
}

async function port() {
  if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' })
  return (app.server.address() as any).port as number
}

async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  const carol = await join(app, ws.id, carolId, 'carol@test.local')
  return { ws, carol, base: `/workspaces/${ws.id}/tasks` }
}

describe('task stream', () => {
  it('is for members only', async () => {
    const { ws } = await setup()
    expect((await app.inject({ method: 'GET', url: `/workspaces/${ws.id}/tasks/stream` })).statusCode).toBe(401)
    expect((await call(daveId, 'GET', `/workspaces/${ws.id}/tasks/stream`)).statusCode).toBe(404)
  })

  it('sends each change as the task’s current snapshot, and null when deleted', async () => {
    const { ws, base, carol } = await setup()
    const s = await open(await port(), ws.id, carolId)
    expect(s.status).toBe(200)
    expect((await s.next('ready')).replayed).toBe(false)

    const created = (await call(testUserId, 'POST', base, { title: 'Live' })).json().data
    let f = await s.next('task.changed')
    expect(f).toMatchObject({ type: 'task.created', taskId: created.id, task: { title: 'Live', version: 1 } })

    await call(testUserId, 'POST', `${base}/${created.id}/move`, { status: 'in_progress' })
    f = await s.next('task.changed')
    expect(f).toMatchObject({ type: 'task.moved', task: { status: 'in_progress', version: 2 } })

    await call(testUserId, 'PATCH', `${base}/${created.id}`, { assigneeMemberId: carol })
    f = await s.next('task.changed')
    expect(f.task.assignee.name).toBe('Carol')

    await call(testUserId, 'POST', `/workspaces/${ws.id}/work-logs`, { summary: 'Did it', day: '2026-10-09', taskId: created.id })
    await s.next('worklogs.changed')

    await call(testUserId, 'PUT', `/workspaces/${ws.id}/task-board`, { wipLimits: { in_progress: 2 } })
    expect((await s.next('board.updated')).wipLimits).toEqual({ in_progress: 2 })

    await call(testUserId, 'DELETE', `${base}/${created.id}`)
    f = await s.next('task.changed')
    expect(f).toMatchObject({ type: 'task.deleted', taskId: created.id, task: null })
    s.close()
  })

  it('replays what a reconnecting client missed, and resets one it cannot help', async () => {
    const { ws, base } = await setup()
    const p = await port()
    const first = await open(p, ws.id, carolId)
    await first.next('ready')
    await call(testUserId, 'POST', base, { title: 'One' })
    const seen = await first.next('task.changed')
    first.close()

    // Two changes while away.
    await call(testUserId, 'POST', base, { title: 'Two' })
    await call(testUserId, 'POST', base, { title: 'Three' })

    const again = await open(p, ws.id, carolId, seen.id)
    expect((await again.next('ready')).replayed).toBe(true)
    expect((await again.next('task.changed')).task.title).toBe('Two')
    expect((await again.next('task.changed')).task.title).toBe('Three')
    again.close()

    // An id from another server run (or far behind) can't be replayed: reconcile.
    const stranger = await open(p, ws.id, carolId, 'deadbeef:3')
    expect((await stranger.next('ready')).replayed).toBe(false)
    stranger.close()
  })

  it('an import asks viewers to reconcile instead of sending every row', async () => {
    const { ws, base } = await setup()
    const s = await open(await port(), ws.id, carolId)
    await s.next('ready')
    await call(testUserId, 'POST', `${base}/import`, { tasks: [{ title: 'a' }, { title: 'b' }] })
    expect((await s.next('reset')).reason).toBe('task.imported')
    s.close()
  })
})
