// Inbox attention queue and the shared composer (doc/11). There is no route
// that creates an inbox item; producers call InboxService.raise.
import { ComposeService } from '../services/ComposeService'
import { InboxService } from '../services/InboxService'
import { subscribeInbox } from '../services/inboxHub'
import { workspaceCtx as ctx } from '../lib/session'

const inbox = new InboxService()
const compose = new ComposeService()

type Authed = {
  user: { id: string }
  params: { workspaceId: string; inboxItemId: string }
  query: { cursor?: string; limit?: number; archived?: boolean | string; unread?: boolean | string; starred?: boolean | string }
  body: { unread?: boolean; starred?: boolean; archived?: boolean }
  cookies?: Record<string, string | undefined>
}

export async function listInboxItems(request: Authed, reply: { send: (body: unknown) => unknown }) {
  return reply.send(await inbox.list(request.user.id, request.params.workspaceId, request.query))
}

export async function readInboxItem(request: Authed, reply: { send: (body: unknown) => unknown }) {
  const { workspaceId, inboxItemId } = request.params
  return reply.send({ data: await inbox.read(ctx(request), workspaceId, inboxItemId, request.body.unread ?? false) })
}

export async function starInboxItem(request: Authed, reply: { send: (body: unknown) => unknown }) {
  const { workspaceId, inboxItemId } = request.params
  return reply.send({ data: await inbox.star(ctx(request), workspaceId, inboxItemId, request.body.starred === true) })
}

export async function archiveInboxItem(request: Authed, reply: { send: (body: unknown) => unknown }) {
  const { workspaceId, inboxItemId } = request.params
  return reply.send({ data: await inbox.archive(ctx(request), workspaceId, inboxItemId, request.body.archived !== false) })
}

export async function sendCompose(request: Authed & { body: Parameters<ComposeService['send']>[2] }, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  return reply.status(201).send({ data: await compose.send(ctx(request), request.params.workspaceId, request.body) })
}

type RawStream = {
  writeHead: (code: number, headers: Record<string, string | number | string[] | undefined>) => void
  write: (chunk: string) => boolean
  on: (event: 'close', fn: () => void) => void
  destroy: () => void
}

// SSE: `inbox.created` when an item becomes visible to this member. A 2s check
// covers a restart or a timer that came due on another tick.
export async function streamInbox(request: Authed & { raw: RawStream }, reply: { hijack: () => void; raw: RawStream; getHeaders: () => Record<string, string | number | string[] | undefined> }) {
  const { workspaceId } = request.params
  const opened = new Date()
  const first = await inbox.due(request.user.id, workspaceId, opened)
  reply.hijack()
  reply.raw.writeHead(200, {
    ...reply.getHeaders(), 'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no',
  })
  reply.raw.write('retry: 2000\n\n')
  let closed = false
  const seen = new Set<string>()
  const write = (frame: string) => {
    if (closed) return
    if (!reply.raw.write(frame)) request.raw.destroy()
  }
  const send = (item: { id: string }) => {
    if (seen.has(item.id)) return
    seen.add(item.id)
    write(`event: inbox.created\ndata: ${JSON.stringify({ type: 'inbox.created', item })}\n\n`)
  }
  const unsubscribe = subscribeInbox(first.memberId, (event) => send(event.item))
  const heartbeat = setInterval(() => write(': ping\n\n'), 25_000)
  const check = setInterval(() => {
    void inbox.due(request.user.id, workspaceId, opened).then(
      (due) => { for (const item of due.items) send(item) },
      () => request.raw.destroy(),
    )
  }, 2000)
  request.raw.on('close', () => {
    closed = true
    clearInterval(heartbeat)
    clearInterval(check)
    unsubscribe()
  })
}
