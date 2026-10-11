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
  const to = request.body?.to || request.body?.recipient || request.query?.to
  return reply.send({ data: await connections.test(workspaceCtx(request), workspaceId, connectionId, to) })
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

import { getGoogleGmailAuthUrl, exchangeGoogleGmailCode } from '../services/googleAuth'
import { resolveSessionUser } from '../lib/session'
import { decryptSecret, encryptSecret } from '../lib/secrets'
import { authorize } from '../services/workspacePolicy'

// Gmail connect (outside the spec: a browser redirect flow). The OAuth `state` is sealed
// with the server's secret keys, so it can't be forged or edited, and expires; the
// callback must arrive in the same signed-in session, from someone who may still manage
// the workspace's senders.
const GMAIL_STATE_TTL_MS = 10 * 60_000
type GmailState = { purpose: 'gmail-connect'; workspaceId: string; userId: string; exp: number }

export async function getGoogleGmailUrl(request: any, reply: any) {
  const user = await resolveSessionUser(request)
  if (!user) return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
  const { workspaceId } = request.params
  await authorize(user.id, workspaceId, 'email.manage')
  const state: GmailState = { purpose: 'gmail-connect', workspaceId, userId: user.id, exp: Date.now() + GMAIL_STATE_TTL_MS }
  return reply.send({ data: { url: getGoogleGmailAuthUrl(encryptSecret(state)) } })
}

function openGmailState(raw: string): GmailState | null {
  try {
    const state = decryptSecret<GmailState>(raw)
    if (state?.purpose !== 'gmail-connect' || typeof state.workspaceId !== 'string' || typeof state.userId !== 'string') return null
    return typeof state.exp === 'number' && state.exp > Date.now() ? state : null
  } catch {
    return null
  }
}

export async function handleGoogleGmailCallback(request: any, reply: any) {
  const frontendUrl = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0] || 'http://localhost:5173'
  const { code, state: rawState, error } = request.query ?? {}
  const back = (workspaceId: string | null, outcome: string) =>
    reply.redirect(`${frontendUrl}${workspaceId ? `/c/${encodeURIComponent(workspaceId)}?tab=integrations&` : '/?'}${outcome}`)

  const state = typeof rawState === 'string' ? openGmailState(rawState) : null
  if (!state) return back(null, 'gmailError=invalid_state')
  if (error || !code) return back(state.workspaceId, `gmailError=${encodeURIComponent(error || 'canceled')}`)

  try {
    const user = await resolveSessionUser(request)
    if (!user || user.id !== state.userId) return back(state.workspaceId, 'gmailError=unauthorized')
    const { member } = await authorize(user.id, state.workspaceId, 'email.manage')

    const exchanged = await exchangeGoogleGmailCode(code)
    await connections.createOrUpdateGoogleConnection({
      workspaceId: state.workspaceId,
      memberId: member.id,
      emailAddress: exchanged.emailAddress,
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      expiresIn: exchanged.expiresIn,
      scope: exchanged.scope,
    })

    return back(state.workspaceId, 'gmailSuccess=1')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gmail connect failed'
    return back(state.workspaceId, `gmailError=${encodeURIComponent(msg)}`)
  }
}

