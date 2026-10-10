// Conversations listed under a company (redesign 00-decisions.md D3): a room links to
// at most one company, only its owner adds it, the list never shows rooms the viewer
// can't see, and the room → company lookup names the company only to its members.
import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, seedRoom, testUserId, testOtherUserId, validateResponse } from './helpers'
import { caller, carolId, createWorkspace, daveId, join, seedPeople } from './helpers/workspace'
import { crossWorkspaceViolations } from '../services/workspaceIntegrity'

const app = buildTestApp()
const call = caller(app)

async function setup() {
  await seedPeople()
  const ws = await createWorkspace(app)
  await join(app, ws.id, carolId, 'carol@test.local')
  return ws
}

describe('company conversations', () => {
  it('the owner links a room; members list it; it is recorded as an action', async () => {
    const ws = await setup()
    const room = await seedRoom(app, testUserId, { title: 'Launch room' })
    const res = await call(testUserId, 'POST', `/workspaces/${ws.id}/conversations`, { roomId: room.id })
    expect(res.statusCode).toBe(201)
    await validateResponse('linkCompanyConversation', 201, res.json())
    expect(res.json().data.id).toBe(room.id)

    const list = await call(carolId, 'GET', `/workspaces/${ws.id}/conversations`)
    expect(list.statusCode).toBe(200)
    await validateResponse('listCompanyConversations', 200, list.json())
    expect(list.json().data.map((r: { id: string }) => r.id)).toEqual([room.id])
    expect(await db.actionExecution.count({ where: { workspaceId: ws.id, action: 'conversation.link' } })).toBe(1)
    expect(await crossWorkspaceViolations()).toEqual({})
  })

  it('only the room owner can link it; a room is in at most one company', async () => {
    const ws = await setup()
    const other = await createWorkspace(app, testUserId, { name: 'Other Co' })
    const carolRoom = await seedRoom(app, carolId, { title: 'Carol room' })
    const notOwner = await call(testUserId, 'POST', `/workspaces/${ws.id}/conversations`, { roomId: carolRoom.id })
    expect(notOwner.statusCode).toBe(403)
    expect(notOwner.json().code).toBe('NOT_ROOM_OWNER')

    const room = await seedRoom(app, testUserId)
    expect((await call(testUserId, 'POST', `/workspaces/${ws.id}/conversations`, { roomId: room.id })).statusCode).toBe(201)
    const again = await call(testUserId, 'POST', `/workspaces/${ws.id}/conversations`, { roomId: room.id })
    expect([again.statusCode, again.json().code]).toEqual([409, 'ALREADY_LINKED'])
    const elsewhere = await call(testUserId, 'POST', `/workspaces/${other.id}/conversations`, { roomId: room.id })
    expect([elsewhere.statusCode, elsewhere.json().code]).toEqual([409, 'ROOM_LINKED'])
  })

  it('a private room stays hidden from members who are not in it', async () => {
    const ws = await setup()
    const secret = await seedRoom(app, testUserId, { title: 'Board only', visibility: 'private' })
    const open = await seedRoom(app, testUserId, { title: 'Everyone' })
    for (const r of [secret, open]) expect((await call(testUserId, 'POST', `/workspaces/${ws.id}/conversations`, { roomId: r.id })).statusCode).toBe(201)

    const carolSees = (await call(carolId, 'GET', `/workspaces/${ws.id}/conversations`)).json().data.map((r: { id: string }) => r.id)
    expect(carolSees).toEqual([open.id])
    const aliceSees = (await call(testUserId, 'GET', `/workspaces/${ws.id}/conversations`)).json().data.map((r: { id: string }) => r.id)
    expect(new Set(aliceSees)).toEqual(new Set([secret.id, open.id]))
    // Linking didn't grant access either.
    expect((await call(carolId, 'GET', `/rooms/${secret.id}`)).statusCode).toBe(404)
  })

  it("lists the company's channel without a link row", async () => {
    const ws = await setup()
    const channel = (await call(testUserId, 'POST', `/workspaces/${ws.id}/channel`)).json().data.roomId
    const list = (await call(testUserId, 'GET', `/workspaces/${ws.id}/conversations`)).json().data.map((r: { id: string }) => r.id)
    expect(list).toContain(channel)
    const company = await call(testUserId, 'GET', `/rooms/${channel}/company`)
    expect(company.json().data).toMatchObject({ id: ws.id, channel: true })
    const link = await call(testUserId, 'POST', `/workspaces/${ws.id}/conversations`, { roomId: channel })
    expect(link.statusCode === 409 || link.statusCode === 403).toBe(true)
  })

  it('names the company only to its members', async () => {
    const ws = await setup()
    const room = await seedRoom(app, testUserId)
    expect((await call(testUserId, 'GET', `/rooms/${room.id}/company`)).json().data).toBeNull()
    await call(testUserId, 'POST', `/workspaces/${ws.id}/conversations`, { roomId: room.id })

    const member = await call(carolId, 'GET', `/rooms/${room.id}/company`)
    await validateResponse('getRoomCompany', 200, member.json())
    expect(member.json().data).toEqual({ id: ws.id, name: 'Acme Co', channel: false })
    expect((await call(daveId, 'GET', `/rooms/${room.id}/company`)).json().data).toBeNull()
    expect((await call(testOtherUserId, 'GET', `/rooms/${room.id}/company`)).json().data).toBeNull()
  })

  it('unlink: the room owner or an admin, not another member', async () => {
    const ws = await setup()
    const room = await seedRoom(app, testUserId)
    await call(testUserId, 'POST', `/workspaces/${ws.id}/conversations`, { roomId: room.id })
    expect((await call(carolId, 'DELETE', `/workspaces/${ws.id}/conversations/${room.id}`)).statusCode).toBe(403)
    const res = await call(testUserId, 'DELETE', `/workspaces/${ws.id}/conversations/${room.id}`)
    expect(res.statusCode).toBe(200)
    await validateResponse('unlinkCompanyConversation', 200, res.json())
    expect((await call(testUserId, 'GET', `/workspaces/${ws.id}/conversations`)).json().data).toEqual([])
    expect((await call(testUserId, 'DELETE', `/workspaces/${ws.id}/conversations/${room.id}`)).statusCode).toBe(404)

    // An admin can remove a member's room from the list.
    const carolRoom = await seedRoom(app, carolId)
    expect((await call(carolId, 'POST', `/workspaces/${ws.id}/conversations`, { roomId: carolRoom.id })).statusCode).toBe(201)
    expect((await call(testUserId, 'DELETE', `/workspaces/${ws.id}/conversations/${carolRoom.id}`)).statusCode).toBe(200)
  })
})
