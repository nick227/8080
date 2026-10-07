// Communication agents (docs/agents). S0: the workspace's email senders.
import { EmailConnectionService } from '../services/agents/connections'
import { workspaceCtx } from '../lib/session'

const connections = new EmailConnectionService()

export async function listEmailConnections(request: any, reply: any) {
  return reply.send({ data: await connections.list(request.user.id, request.params.workspaceId) })
}

export async function updateEmailConnection(request: any, reply: any) {
  const { workspaceId, connectionId } = request.params
  return reply.send({ data: await connections.update(workspaceCtx(request), workspaceId, connectionId, request.body) })
}

export async function testEmailConnection(request: any, reply: any) {
  const { workspaceId, connectionId } = request.params
  return reply.send({ data: await connections.test(workspaceCtx(request), workspaceId, connectionId) })
}
