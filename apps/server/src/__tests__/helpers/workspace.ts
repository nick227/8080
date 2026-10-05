// Workspace seeds (doc/09). Alice (testUserId, registered) owns; Carol and Dave
// are registered accounts; Bob (testOtherUserId) is a guest and can never join.
import type { FastifyInstance } from 'fastify'
import { db } from '@project/db'
import { asAuth, testUserId } from './index'

export const carolId = 'ws-test-carol'
export const daveId = 'ws-test-dave'

async function seedPerson(id: string, email: string, displayName: string) {
  await db.user.upsert({ where: { id }, create: { id, email, passwordHash: 'x', isGuest: false }, update: {} })
  await db.profile.upsert({ where: { userId: id }, create: { userId: id, displayName }, update: {} })
}

export async function seedPeople() {
  await seedPerson(carolId, 'carol@test.local', 'Carol')
  await seedPerson(daveId, 'dave@test.local', 'Dave')
}

export function caller(app: FastifyInstance) {
  return (userId: string, method: string, url: string, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method: method as any, url, payload, headers: { ...asAuth(userId), ...headers } })
}

export async function createWorkspace(app: FastifyInstance, ownerId = testUserId, body: object = { name: 'Acme Co' }) {
  const res = await caller(app)(ownerId, 'POST', '/workspaces', body)
  if (res.statusCode !== 201) throw new Error(`createWorkspace failed: ${res.statusCode} ${res.body}`)
  return res.json().data as { id: string; slug: string; role: string }
}

export async function memberId(workspaceId: string, userId: string) {
  return (await db.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId, userId } } })).id
}

/** Invite (as Alice) + accept, through the API. Returns the new member id. */
export async function join(app: FastifyInstance, workspaceId: string, userId: string, email: string, role: 'admin' | 'member' = 'member') {
  const call = caller(app)
  const invite = await call(testUserId, 'POST', `/workspaces/${workspaceId}/invites`, { email, role })
  if (invite.statusCode !== 201) throw new Error(`invite failed: ${invite.statusCode} ${invite.body}`)
  const accept = await call(userId, 'POST', '/workspace-invites/accept', { token: invite.json().token })
  if (accept.statusCode !== 200) throw new Error(`accept failed: ${accept.statusCode} ${accept.body}`)
  return memberId(workspaceId, userId)
}
