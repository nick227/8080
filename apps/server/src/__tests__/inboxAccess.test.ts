// Who may see an inbox item, and which actions must not mint another one.
// Alice owns the workspace. Carol is a member. Bob is a guest with no workspace.
import type { AddressInfo } from 'net'
import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testOtherUserId, testUserId } from './helpers'
import { caller, carolId, createWorkspace, join, memberId, seedPeople } from './helpers/workspace'
import { InboxService } from '../services/InboxService'

const app = buildTestApp()
const call = caller(app)
const inbox = new InboxService()

async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  await join(app, ws.id, carolId, 'carol@test.local')
  return { ws, alice: await memberId(ws.id, testUserId), carol: await memberId(ws.id, carolId) }
}

function letter(contactId: string, extra: Record<string, string> = {}) {
  return { contactId, channel: 'email', destination: 'dana@acme.com', subject: 'Hello', body: 'See you', contextType: 'contact', contextId: contactId, ...extra }
}

async function contact(workspaceId: string, displayName: string) {
  const res = await call(testUserId, 'POST', `/workspaces/${workspaceId}/contacts`, { displayName })
  expect(res.statusCode, res.body).toBe(201)
  return res.json().data as { id: string }
}

describe('inbox access', () => {
  it('gives outsiders nothing, and rejects a body that names someone else', async () => {
    const { ws, carol } = await setup()
    const item = await inbox.raise(ws.id, {
      memberId: carol, type: 'system', title: 'Yours', summary: 'Only Carol', sourceType: 'system', sourceId: 'evt', dedupeKey: 'evt', action: { verb: 'open' },
    })
    const outsider = `/workspaces/${ws.id}/inbox`
    expect((await call(testUserId, 'GET', '/workspaces/missing/inbox')).statusCode).toBe(404)
    expect((await call(testOtherUserId, 'GET', outsider)).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: outsider })).statusCode).toBe(401)
    expect((await call(testOtherUserId, 'GET', `${outsider}/stream`)).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `${outsider}/stream` })).statusCode).toBe(401)

    const other = await createWorkspace(app)
    for (const [method, url, body] of [
      ['PATCH', `${outsider}/${item.id}/star`, { starred: true }],
      ['PATCH', `${outsider}/${item.id}/read`, { unread: false }],
      ['PATCH', `${outsider}/${item.id}/archive`, { archived: true }],
      ['PATCH', `/workspaces/${other.id}/inbox/${item.id}/star`, { starred: true }],
    ] as const) {
      expect((await call(testUserId, method, url, body)).statusCode).toBe(404)
    }
    expect((await db.inboxItem.findUnique({ where: { id: item.id } }))).toMatchObject({ starred: false, unread: true, archivedAt: null })

    const spoof = await call(carolId, 'PATCH', `${outsider}/${item.id}/star`, { starred: true, unread: false })
    expect(spoof.statusCode).toBe(400)
    expect(spoof.json().code).toBe('VALIDATION')
    expect((await db.inboxItem.findUnique({ where: { id: item.id } }))?.starred).toBe(false)
  })

  it('refuses a follow-up that leaves the workspace, and a reused key that changes it', async () => {
    const { ws, alice } = await setup()
    const other = await createWorkspace(app)
    const local = await contact(ws.id, 'Dana')
    const foreign = await contact(other.id, 'Eve')
    const base = `/workspaces/${ws.id}/compose`

    expect((await call(testUserId, 'POST', base, letter(foreign.id))).json().code).toBe('INVALID_SOURCE')
    expect((await call(testUserId, 'POST', base, { ...letter(local.id), contactId: foreign.id })).json().code).toBe('INVALID_CONTACT')
    expect((await call(testUserId, 'POST', base, { ...letter(local.id), contextId: foreign.id })).json().code).toBe('INVALID_SOURCE')
    expect((await call(testUserId, 'POST', base, { ...letter(local.id), authorMemberId: alice })).statusCode).toBe(400)
    expect(await db.compose.count({ where: { workspaceId: ws.id } })).toBe(0)
    await expect(inbox.raise(ws.id, {
      memberId: alice, type: 'system', title: 'Nope', summary: 'Cross', sourceType: 'contact', sourceId: foreign.id, dedupeKey: 'cross', action: { verb: 'open' },
    })).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
    await expect(inbox.raise(ws.id, {
      memberId: await memberId(other.id, testUserId), type: 'system', title: 'Nope', summary: 'Cross', sourceType: 'system', sourceId: 'x', dedupeKey: 'cross-member', action: { verb: 'open' },
    })).rejects.toMatchObject({ code: 'INVALID_MEMBER' })

    const sent = await call(testUserId, 'POST', base, letter(local.id, { idempotencyKey: 'letter-1' }))
    expect(sent.statusCode).toBe(201)
    const again = await call(testUserId, 'POST', base, letter(local.id, { idempotencyKey: 'letter-1' }))
    expect(again.statusCode).toBe(201)
    expect(again.json().data.id).toBe(sent.json().data.id)
    expect((await call(testUserId, 'POST', base, letter(local.id, { idempotencyKey: 'letter-1', subject: 'Changed' }))).json().code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(await db.compose.count({ where: { workspaceId: ws.id } })).toBe(1)
    expect(await db.inboxItem.count({ where: { workspaceId: ws.id, title: 'Follow-up: Hello' } })).toBe(2)
  })

  it('does not announce bookkeeping, and stops telling a removed member', async () => {
    const { ws, alice, carol } = await setup()
    const item = await inbox.raise(ws.id, {
      memberId: carol, type: 'system', title: 'Quiet', summary: 'Stay', sourceType: 'system', sourceId: 'q', dedupeKey: 'quiet', action: { verb: 'open' },
    })
    const before = await db.inboxItem.count({ where: { workspaceId: ws.id } })
    expect((await call(carolId, 'PATCH', `/workspaces/${ws.id}/inbox/${item.id}/read`, { unread: false })).statusCode).toBe(200)
    expect((await call(carolId, 'PATCH', `/workspaces/${ws.id}/inbox/${item.id}/star`, { starred: true })).statusCode).toBe(200)
    expect((await call(carolId, 'PATCH', `/workspaces/${ws.id}/inbox/${item.id}/archive`, { archived: true })).statusCode).toBe(200)
    expect(await db.inboxItem.count({ where: { workspaceId: ws.id } })).toBe(before)

    const open = (await call(carolId, 'GET', `/workspaces/${ws.id}/inbox?archived=false`)).json().data as { id: string }[]
    const archived = (await call(carolId, 'GET', `/workspaces/${ws.id}/inbox?archived=true&unread=false`)).json().data as { id: string }[]
    expect(open.some((row) => row.id === item.id)).toBe(false)
    expect(archived.some((row) => row.id === item.id)).toBe(true)

    expect((await call(testUserId, 'DELETE', `/workspaces/${ws.id}/members/${carol}`)).statusCode).toBe(200)
    const stopped = await db.inboxItem.count({ where: { memberId: carol } })
    await contact(ws.id, 'After')
    expect(await db.inboxItem.count({ where: { memberId: carol } })).toBe(stopped)
    expect(await db.inboxItem.findFirst({ where: { memberId: alice, title: 'Contact added', summary: 'contact' } })).toMatchObject({ sourceType: 'contact' })
  })

  it('tells a public room only to the people in it', async () => {
    const { ws, carol } = await setup()
    const room = (await call(testUserId, 'POST', '/rooms', { title: 'Lobby', visibility: 'public' })).json().data as { id: string }
    const early = await call(testUserId, 'POST', `/rooms/${room.id}/items`, { text: 'before carol' })
    expect(early.statusCode).toBe(201)
    await call(testOtherUserId, 'POST', `/rooms/${room.id}/join`)
    const guest = await call(testOtherUserId, 'POST', `/rooms/${room.id}/items`, { text: 'from the guest' })
    expect(guest.statusCode).toBe(201)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(await db.inboxItem.findFirst({ where: { memberId: carol, dedupeKey: early.json().data.id } })).toBeNull()
    expect(await db.inboxItem.findFirst({ where: { memberId: carol, dedupeKey: guest.json().data.id } })).toBeNull()
    expect(await db.workspaceMember.count({ where: { userId: testOtherUserId } })).toBe(0)

    expect((await call(carolId, 'POST', `/rooms/${room.id}/join`)).statusCode).toBe(200)
    const later = await call(testUserId, 'POST', `/rooms/${room.id}/items`, { text: 'carol is here' })
    const note = await waitFor(() => db.inboxItem.findFirst({ where: { memberId: carol, dedupeKey: later.json().data.id as string } }))
    expect(note).toMatchObject({ type: 'conversation', sourceType: 'conversation', sourceId: room.id, unread: true, workspaceId: ws.id })
    expect(await db.inboxItem.findFirst({ where: { memberId: carol, dedupeKey: early.json().data.id } })).toBeNull()
  })

  it('streams a new item to that member and does not replay the queue', async () => {
    const { ws, carol } = await setup()
    const old = await inbox.raise(ws.id, {
      memberId: carol, type: 'system', title: 'Already there', summary: 'History', sourceType: 'system', sourceId: 'old', dedupeKey: 'old', action: { verb: 'open' },
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as AddressInfo
    const abort = new AbortController()
    const res = await fetch(`http://127.0.0.1:${port}/workspaces/${ws.id}/inbox/stream`, {
      headers: { Authorization: `Bearer ${carolId}` }, signal: abort.signal,
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const seen = watch(res.body!.getReader())
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(seen.body()).not.toContain(old.id)
    await contact(ws.id, 'Live')
    const stop = Date.now() + 1000
    while (!seen.body().includes('"title":"Contact added"') && Date.now() < stop) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(seen.body()).toContain('"title":"Contact added"')
    const payload = JSON.parse(/data: (\{.*\})/.exec(seen.body())![1]!) as { item: { memberId: string; unread: boolean; title: string } }
    expect(payload.item).toMatchObject({ memberId: carol, unread: true, title: 'Contact added' })
    abort.abort()
  })
})

function watch(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder()
  let text = ''
  const pump = async () => {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return
      if (chunk.value) text += decoder.decode(chunk.value)
    }
  }
  pump().catch(() => undefined)
  return { body: () => text }
}

async function waitFor<T>(load: () => Promise<T | null>) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const found = await load()
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return null
}
