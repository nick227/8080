// Communication agents (docs/agents): email senders (S0), agents and their activity (S1).
import { EmailConnectionService } from '../services/agents/connections'
import { AgentService } from '../services/agents/AgentService'
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

// ─── agents (S1) ─────────────────────────────────────────────────────────────────

const agents = new AgentService()

export async function listAgentTypes(request: any, reply: any) {
  return reply.send({ data: await agents.types(request.user.id, request.params.workspaceId) })
}

export async function listAgents(request: any, reply: any) {
  return reply.send({ data: await agents.list(request.user.id, request.params.workspaceId) })
}

export async function createAgent(request: any, reply: any) {
  return reply.code(201).send({ data: await agents.create(workspaceCtx(request), request.params.workspaceId, request.body) })
}

export async function getAgent(request: any, reply: any) {
  return reply.send({ data: await agents.get(request.user.id, request.params.workspaceId, request.params.agentId) })
}

export async function updateAgent(request: any, reply: any) {
  return reply.send({ data: await agents.update(workspaceCtx(request), request.params.workspaceId, request.params.agentId, request.body) })
}

export async function deleteAgent(request: any, reply: any) {
  return reply.send({ data: await agents.remove(workspaceCtx(request), request.params.workspaceId, request.params.agentId) })
}

export async function publishAgent(request: any, reply: any) {
  return reply.send({ data: await agents.publish(workspaceCtx(request), request.params.workspaceId, request.params.agentId) })
}

export async function pauseAgent(request: any, reply: any) {
  return reply.send({ data: await agents.pause(workspaceCtx(request), request.params.workspaceId, request.params.agentId) })
}

export async function previewAgent(request: any, reply: any) {
  return reply.send({ data: await agents.preview(request.user.id, request.params.workspaceId, request.params.agentId) })
}

export async function sendAgentTest(request: any, reply: any) {
  return reply.send({ data: await agents.sendTest(workspaceCtx(request), request.params.workspaceId, request.params.agentId) })
}

export async function listAgentEvents(request: any, reply: any) {
  const { agentId, cursor, limit } = request.query ?? {}
  return reply.send(await agents.events(request.user.id, request.params.workspaceId, { agentId, cursor, limit }))
}

export async function getAgentEvent(request: any, reply: any) {
  return reply.send({ data: await agents.event(request.user.id, request.params.workspaceId, request.params.eventId) })
}

export async function cancelAgentEvent(request: any, reply: any) {
  return reply.send({ data: await agents.cancelEvent(workspaceCtx(request), request.params.workspaceId, request.params.eventId) })
}
