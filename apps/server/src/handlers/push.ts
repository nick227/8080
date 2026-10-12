// Web Push registration for the /native/ app (services/push.ts sends).
import { authorize } from '../services/authorization'
import { PushService, acknowledge, deliveryDiagnostics, pushPublicKey, type AckEvent, type PushTarget } from '../services/push'

const push = new PushService()

type Authed = { user: { id: string; isGuest: boolean } }
type Reply = { send: (body?: unknown) => unknown; status: (code: number) => { send: (body?: unknown) => unknown } }

export async function getPushConfig(request: Authed, reply: Reply) {
  return reply.send({ data: { publicKey: pushPublicKey(), devices: await push.devices(request.user.id) } })
}

export async function subscribePush(request: Authed & { body: PushTarget & { userAgent?: string } }, reply: Reply) {
  return reply.status(201).send({ data: await push.subscribe(request.user, request.body) })
}

export async function unsubscribePush(request: Authed & { query: { endpoint: string } }, reply: Reply) {
  await push.unsubscribe(request.user.id, request.query.endpoint)
  return reply.status(204).send()
}

export async function testPush(request: Authed, reply: Reply) {
  return reply.send({ data: await push.test(request.user.id) })
}

/** The device's service worker reports a delivery displayed or opened (signed, no session). */
export async function acknowledgePushDelivery(request: { params: { deliveryId: string }; body: { token: string; event: AckEvent } }, reply: Reply) {
  await acknowledge(request.params.deliveryId, request.body.token, request.body.event)
  return reply.status(204).send()
}

export async function getPushDiagnostics(request: Authed & { query: { days?: number; status?: string; userId?: string; limit?: number } }, reply: Reply & { header: (k: string, v: string) => Reply }) {
  await authorize(request.user.id, { scope: 'platform', permission: 'diagnostics.read' })
  return reply.header('Cache-Control', 'no-store').send({ data: await deliveryDiagnostics(request.query) })
}
