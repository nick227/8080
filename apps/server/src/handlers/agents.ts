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

export async function createEmailConnection(request: any, reply: any) {
  return reply.code(201).send({ data: await connections.create(workspaceCtx(request), request.params.workspaceId, request.body) })
}

export async function deleteEmailConnection(request: any, reply: any) {
  const { workspaceId, connectionId } = request.params
  return reply.send({ data: await connections.remove(workspaceCtx(request), workspaceId, connectionId) })
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

export async function previewAgentAudience(request: any, reply: any) {
  return reply.send({ data: await agents.previewAudience(request.user.id, request.params.workspaceId, request.body) })
}

import { BusinessEventService } from '../services/agents/BusinessEventService'
import { unsubscribe } from '../services/agents/suppression'
const businessEvents = new BusinessEventService()
export async function recordAgentBusinessEvent(request: any, reply: any) {
  return reply.code(201).send({ data: await businessEvents.record(workspaceCtx(request), request.params.workspaceId, request.body) })
}
export async function createAgentSuppression(request: any, reply: any) {
  return reply.code(201).send({ data: await businessEvents.suppress(workspaceCtx(request), request.params.workspaceId, request.body) })
}
export async function listAgentSuppressions(request: any, reply: any) {
  return reply.send({ data: await businessEvents.suppressions(request.user.id, request.params.workspaceId) })
}
export async function agentUnsubscribePage(request: any, reply: any) {
  // GET only confirms intent: link scanners do not change consent.
  return reply.type('text/html').header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').header('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'").send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unsubscribe</title><main><h1>Stop customer emails</h1><p>This stops customer emails from the workspace that sent you this message.</p><form method="post"><button type="submit">Unsubscribe</button></form></main></html>')
}
export async function agentUnsubscribe(request: any, reply: any) {
  await unsubscribe(request.params.token)
  return reply.type('text/html').header('Cache-Control', 'no-store').send('<!doctype html><html lang="en"><meta charset="utf-8"><title>Unsubscribed</title><main><h1>You are unsubscribed</h1><p>You will no longer receive customer emails from this workspace.</p></main></html>')
}
