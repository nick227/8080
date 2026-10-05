// Inbox attention queue and the shared composer (doc/11). There is no route
// that creates an inbox item; producers call InboxService.raise.
import { ComposeService } from '../services/ComposeService'
import { InboxService } from '../services/InboxService'
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
