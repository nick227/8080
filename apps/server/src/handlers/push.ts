// Web Push registration for the /native/ app (services/push.ts sends).
import { PushService, pushPublicKey, type PushTarget } from '../services/push'

const push = new PushService()

type Authed = { user: { id: string; isGuest: boolean } }
type Reply = { send: (body?: unknown) => unknown; status: (code: number) => { send: (body?: unknown) => unknown } }

export async function getPushConfig(_request: Authed, reply: Reply) {
  return reply.send({ data: { publicKey: pushPublicKey() } })
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
