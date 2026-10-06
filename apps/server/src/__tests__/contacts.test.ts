// Slice 1 of doc/09: contacts, accounts, tags, the matcher (D2), notes (D10),
// record links to conversations (§6), merge, and timelines (Q-B).
// Alice owns the workspace, Carol and Dave are members, Bob is an outsider guest.
import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { randomUUID } from 'crypto'
import { buildTestApp, validateResponse, testUserId, testOtherUserId, seedRoom, seedItem } from './helpers'
import { caller, carolId, createWorkspace, daveId, join, memberId, seedPeople } from './helpers/workspace'
import { crossWorkspaceViolations } from '../services/workspaceIntegrity'

const app = buildTestApp()
const call = caller(app)

async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  const carol = await join(app, ws.id, carolId, 'carol@test.local')
  const dave = await join(app, ws.id, daveId, 'dave@test.local')
  const base = `/workspaces/${ws.id}`
  return { ws, base, carol, dave, alice: await memberId(ws.id, testUserId) }
}

async function contact(base: string, body: object, as = testUserId) {
  const res = await call(as, 'POST', `${base}/contacts`, body)
  if (res.statusCode !== 201) throw new Error(`create contact: ${res.statusCode} ${res.body}`)
  return res.json() as { data: any; duplicates: any[] }
}

async function account(base: string, body: object, as = testUserId) {
  const res = await call(as, 'POST', `${base}/accounts`, body)
  if (res.statusCode !== 201) throw new Error(`create account: ${res.statusCode} ${res.body}`)
  return res.json() as { data: any; duplicates: any[] }
}

const email = (value: string, extra: object = {}) => ({ kind: 'email', value, ...extra })
const timelineTypes = async (url: string, as = testUserId) => (await call(as, 'GET', url)).json().data.map((a: any) => a.type)

describe('contacts', () => {
  it('filters lead stages before pagination and keeps lifecycle filtering independent', async () => {
    const { base } = await setup()
    await contact(base, { displayName: 'A new lead', leadStatus: 'new' })
    const first = await contact(base, { displayName: 'B qualified', leadStatus: 'qualified' })
    const second = await contact(base, { displayName: 'C qualified', leadStatus: 'qualified' })
    const archived = await contact(base, { displayName: 'D archived', leadStatus: 'qualified', status: 'archived' })
    const page = await call(testUserId, 'GET', `${base}/contacts?leadStatus=qualified&limit=1`)
    expect(page.statusCode).toBe(200)
    expect(page.json().data.map((row: any) => row.id)).toEqual([first.data.id])
    const next = await call(testUserId, 'GET', `${base}/contacts?leadStatus=qualified&limit=1&cursor=${encodeURIComponent(page.json().meta.nextCursor)}`)
    expect(next.json().data.map((row: any) => row.id)).toEqual([second.data.id])
    expect(next.json().meta.nextCursor).toBeNull()
    const archive = await call(testUserId, 'GET', `${base}/contacts?leadStatus=qualified&status=archived`)
    expect(archive.json().data.map((row: any) => row.id)).toEqual([archived.data.id])
    expect((await call(testUserId, 'GET', `${base}/contacts?leadStatus=invalid`)).statusCode).toBe(400)
  })

  it('creates a contact: derived name and primaries, normalised points, role addresses shared, audit + timeline', async () => {
    const { base } = await setup()
    const res = await call(testUserId, 'POST', base + '/contacts', {
      firstName: 'Dana',
      lastName: 'Ruiz',
      points: [email('Dana@Acme.com'), email('info@acme.com'), { kind: 'phone', value: '+1 (555) 010-0200' }, email('dana@acme.com')],
    })
    expect(res.statusCode).toBe(201)
    await validateResponse('createContact', 201, res.json())
    const c = res.json().data
    expect(c).toMatchObject({ displayName: 'Dana Ruiz', primaryEmail: 'Dana@Acme.com', primaryPhone: '+1 (555) 010-0200', origin: 'api' })
    expect(c.points.map((p: any) => [p.kind, p.value, p.isPrimary, p.shared])).toEqual([
      ['email', 'Dana@Acme.com', true, false],
      ['email', 'info@acme.com', false, true], // role address: shared by default
      ['phone', '+1 (555) 010-0200', true, false],
    ]) // the repeated dana@ (different case) was dropped
    expect((await db.contactPoint.findFirstOrThrow({ where: { contactId: c.id, kind: 'phone' } })).normalized).toBe('+15550100200')

    expect(await timelineTypes(`${base}/contacts/${c.id}/timeline`)).toEqual(['contact.created'])
    expect((await db.actionExecution.findFirstOrThrow({ where: { action: 'contact.create' } })).targetId).toBe(c.id)
  })

  it('needs a name, email or phone; refuses bad emails, foreign owners and foreign tags', async () => {
    const { base } = await setup()
    const other = await createWorkspace(app, testUserId, { name: 'Other' })
    const foreignTag = (await call(testUserId, 'POST', `/workspaces/${other.id}/tags`, { name: 'vip' })).json().data
    expect((await call(testUserId, 'POST', base + '/contacts', { title: 'CEO' })).json().code).toBe('EMPTY_CONTACT')
    expect((await call(testUserId, 'POST', base + '/contacts', { points: [email('not-an-email')] })).json().code).toBe('INVALID_EMAIL')
    expect((await call(testUserId, 'POST', base + '/contacts', { displayName: 'X', ownerMemberId: await memberId(other.id, testUserId) })).json().code).toBe('INVALID_OWNER')
    expect((await call(testUserId, 'POST', base + '/contacts', { displayName: 'X', tagIds: [foreignTag.id] })).json().code).toBe('INVALID_TAG')
    expect((await contact(base, { points: [email('solo@x.io')] })).data.displayName).toBe('solo@x.io')
  })

  it('never refuses a likely duplicate, but reports it', async () => {
    const { base } = await setup()
    const first = await contact(base, { displayName: 'Dana', points: [email('dana@acme.com')] })
    const second = await contact(base, { displayName: 'Dana R.', points: [email('DANA@acme.com')] })
    expect(second.duplicates.map((d) => d.id)).toEqual([first.data.id])
    // A shared address is not evidence of the same person.
    const third = await contact(base, { displayName: 'Someone', points: [email('info@acme.com')] })
    const fourth = await contact(base, { displayName: 'Someone else', points: [email('info@acme.com')] })
    expect(third.duplicates).toEqual([])
    expect(fourth.duplicates).toEqual([])
    const dupes = await call(testUserId, 'GET', `${base}/contacts/${first.data.id}/duplicates`)
    await validateResponse('listContactDuplicates', 200, dupes.json())
    expect(dupes.json().data.map((d: any) => d.id)).toEqual([second.data.id])
  })

  it('lists by name with search by name or email prefix, filters, and keyset pages', async () => {
    const { base } = await setup()
    for (const [name, mail] of [['Cy', 'cy@b.io'], ['Ann', 'ann@a.io'], ['Bea', 'zed@c.io']]) await contact(base, { displayName: name, points: [email(mail!)] })
    await contact(base, { displayName: 'Archie', status: 'archived' })

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const qs: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
      const res = await call(carolId, 'GET', `${base}/contacts?limit=2${qs}`)
      await validateResponse('listContacts', 200, res.json())
      seen.push(...res.json().data.map((c: any) => c.displayName))
      cursor = res.json().meta.nextCursor
    } while (cursor)
    expect(seen).toEqual(['Ann', 'Bea', 'Cy'])

    expect((await call(carolId, 'GET', `${base}/contacts?q=ze`)).json().data.map((c: any) => c.displayName)).toEqual(['Bea'])
    expect((await call(carolId, 'GET', `${base}/contacts?q=nn`)).json().data.map((c: any) => c.displayName)).toEqual(['Ann'])
    expect((await call(carolId, 'GET', `${base}/contacts?status=archived`)).json().data.map((c: any) => c.displayName)).toEqual(['Archie'])
  })

  it('updates: points replace and re-derive primaries; owner change is on the timeline; field diffs are audited', async () => {
    const { base, carol } = await setup()
    const c = (await contact(base, { firstName: 'Dana', points: [email('old@acme.com')] })).data
    const res = await call(carolId, 'PATCH', `${base}/contacts/${c.id}`, { points: [email('new@acme.com')], ownerMemberId: carol, lastName: 'Ruiz' })
    expect(res.statusCode).toBe(200)
    await validateResponse('updateContact', 200, res.json())
    expect(res.json().data).toMatchObject({ primaryEmail: 'new@acme.com', displayName: 'Dana Ruiz', ownerMemberId: carol })
    expect(await timelineTypes(`${base}/contacts/${c.id}/timeline`)).toEqual(['owner.changed', 'contact.created'])
    const audit = await db.actionExecution.findFirstOrThrow({ where: { action: 'contact.update' } })
    expect(audit.changes).toMatchObject({ points: [['email:old@acme.com'], ['email:new@acme.com']], ownerMemberId: [null, carol], lastName: [null, 'Ruiz'] })
    // The old address no longer matches anyone.
    expect((await call(testUserId, 'GET', `${base}/contacts/match?email=old@acme.com`)).json().data.result).toBe('none')
  })

  it('deleting is for admins and the record owner; a deleted contact stops matching', async () => {
    const { base, carol } = await setup()
    const mine = (await contact(base, { displayName: 'Carol’s', ownerMemberId: carol, points: [email('c1@x.io')] })).data
    const unowned = (await contact(base, { displayName: 'Nobody’s' })).data
    expect((await call(daveId, 'DELETE', `${base}/contacts/${mine.id}`)).statusCode).toBe(403)
    expect((await call(carolId, 'DELETE', `${base}/contacts/${unowned.id}`)).statusCode).toBe(403)
    expect((await call(carolId, 'DELETE', `${base}/contacts/${mine.id}`)).statusCode).toBe(200)
    expect((await call(testUserId, 'DELETE', `${base}/contacts/${unowned.id}`)).statusCode).toBe(200)
    expect((await call(carolId, 'GET', `${base}/contacts/${mine.id}`)).statusCode).toBe(404)
    expect((await call(carolId, 'GET', `${base}/contacts/match?email=c1@x.io`)).json().data.result).toBe('none')
  })
})

describe('matcher (D2)', () => {
  it('exactly one personal holder matches; several are ambiguous; shared-only never matches; domain picks the account', async () => {
    const { base } = await setup()
    const dana = (await contact(base, { displayName: 'Dana', points: [email('dana@acme.com')] })).data
    await contact(base, { displayName: 'Lee', points: [email('lee@acme.com')] })
    await contact(base, { displayName: 'Lee twin', points: [email('lee@acme.com')] })
    await contact(base, { displayName: 'Front desk', points: [email('info@acme.com')] })
    const acme = (await account(base, { name: 'Acme', domain: 'https://www.ACME.com/about' })).data

    const match = async (address: string) => {
      const res = await call(carolId, 'GET', `${base}/contacts/match?email=${encodeURIComponent(address)}`)
      await validateResponse('matchContact', 200, res.json())
      return res.json().data
    }
    expect(await match('Dana@acme.com')).toMatchObject({ result: 'match', matchId: dana.id, account: { result: 'match', matchId: acme.id } })
    expect(await match('lee@acme.com')).toMatchObject({ result: 'ambiguous', matchId: null })
    expect((await match('lee@acme.com')).contacts).toHaveLength(2)
    expect(await match('info@acme.com')).toMatchObject({ result: 'shared', matchId: null })
    expect(await match('new@acme.com')).toMatchObject({ result: 'none', account: { result: 'match' } })
    expect(await match('someone@gmail.com')).toMatchObject({ result: 'none', account: { result: 'none' } })
  })
})

describe('accounts', () => {
  it('normalises the domain, reports same-domain accounts, refuses personal mail domains and parent cycles', async () => {
    const { base } = await setup()
    const acme = await account(base, { name: 'Acme', domain: 'acme.com' })
    expect(acme.data).toMatchObject({ name: 'Acme', domain: 'acme.com', type: 'prospect', contactCount: 0 })
    await validateResponse('createAccount', 201, { data: acme.data, duplicates: acme.duplicates })
    const eu = await account(base, { name: 'Acme EU', domain: 'www.Acme.com', parentAccountId: acme.data.id })
    expect(eu.duplicates.map((d) => d.id)).toEqual([acme.data.id]) // subsidiaries share domains: a signal, not a block
    expect((await call(testUserId, 'POST', `${base}/accounts`, { name: 'Gmail people', domain: 'gmail.com' })).json().code).toBe('FREE_MAIL_DOMAIN')
    expect((await call(testUserId, 'PATCH', `${base}/accounts/${acme.data.id}`, { parentAccountId: eu.data.id })).json().code).toBe('INVALID_PARENT')
    const updated = await call(carolId, 'PATCH', `${base}/accounts/${acme.data.id}`, { type: 'customer' })
    await validateResponse('updateAccount', 200, updated.json())
    expect(await timelineTypes(`${base}/accounts/${acme.data.id}/timeline`)).toEqual(['account.type_changed', 'account.created'])
  })

  it('people at an account: one primary, job changes keep history, and their activity shows on the account', async () => {
    const { base } = await setup()
    const acme = (await account(base, { name: 'Acme' })).data
    const globex = (await account(base, { name: 'Globex' })).data
    const dana = (await contact(base, { displayName: 'Dana', accounts: [{ accountId: acme.id, role: 'CTO' }] })).data
    expect(dana.accounts).toMatchObject([{ accountId: acme.id, name: 'Acme', role: 'CTO', isPrimary: true }])

    const moved = await call(carolId, 'PUT', `${base}/contacts/${dana.id}/accounts/${globex.id}`, { isPrimary: true })
    expect(moved.statusCode).toBe(200)
    await validateResponse('setContactAccount', 200, moved.json())
    expect(moved.json().data.accounts.map((a: any) => [a.name, a.isPrimary])).toEqual([['Acme', false], ['Globex', true]])

    await call(carolId, 'PUT', `${base}/contacts/${dana.id}/accounts/${acme.id}`, { endedAt: '2026-09-30T00:00:00.000Z' })
    expect((await call(carolId, 'GET', `${base}/accounts/${acme.id}`)).json().data.contactCount).toBe(0)
    expect((await call(carolId, 'GET', `${base}/accounts/${globex.id}`)).json().data.contactCount).toBe(1)
    expect((await call(carolId, 'GET', `${base}/contacts?accountId=${globex.id}`)).json().data.map((c: any) => c.id)).toEqual([dana.id])

    // Globex's timeline includes what happens to the people there since they joined — not Dana's creation at Acme.
    await call(carolId, 'POST', `${base}/notes`, { contactIds: [dana.id], text: 'Moved to Globex' })
    expect(await timelineTypes(`${base}/accounts/${globex.id}/timeline`)).toEqual(['note.added', 'contact.account_ended', 'contact.account_added', 'account.created'])
    expect(await timelineTypes(`${base}/accounts/${acme.id}/timeline`)).toEqual(['contact.account_ended', 'contact.created', 'account.created'])
    expect(await timelineTypes(`${base}/contacts/${dana.id}/timeline`)).toEqual(['note.added', 'contact.account_ended', 'contact.account_added', 'contact.created'])

    const removed = await call(carolId, 'DELETE', `${base}/contacts/${dana.id}/accounts/${acme.id}`)
    expect(removed.json().data.accounts.map((a: any) => a.name)).toEqual(['Globex'])
  })
})

describe('tags', () => {
  it('members create and apply tags; renaming and deleting are admin-only', async () => {
    const { base } = await setup()
    const vip = await call(carolId, 'POST', `${base}/tags`, { name: 'VIP', color: '#f00' })
    expect(vip.statusCode).toBe(201)
    await validateResponse('createTag', 201, vip.json())
    expect((await call(carolId, 'POST', `${base}/tags`, { name: 'VIP' })).json().code).toBe('TAG_NAME_TAKEN')
    const c = (await contact(base, { displayName: 'Dana', tagIds: [vip.json().data.id] }, carolId)).data
    expect(c.tags.map((t: any) => t.name)).toEqual(['VIP'])
    expect((await call(carolId, 'GET', `${base}/contacts?tagId=${vip.json().data.id}`)).json().data).toHaveLength(1)

    expect((await call(carolId, 'PATCH', `${base}/tags/${vip.json().data.id}`, { name: 'Key' })).statusCode).toBe(403)
    expect((await call(testUserId, 'DELETE', `${base}/tags/${vip.json().data.id}`)).statusCode).toBe(200)
    expect((await call(carolId, 'GET', `${base}/contacts/${c.id}`)).json().data.tags).toEqual([])
  })
})

describe('notes (D10)', () => {
  async function voice(ownerId: string) {
    return db.media.create({ data: { ownerId, kind: 'audio', storageKey: `${randomUUID()}.webm`, mimeType: 'audio/webm', size: 1, duration: 4.2 } })
  }

  it('a voice note on a contact and an account: playable by every member, on both timelines', async () => {
    const { base, carol } = await setup()
    const acme = (await account(base, { name: 'Acme' })).data
    const dana = (await contact(base, { displayName: 'Dana' })).data
    const clip = await voice(carolId)

    const res = await call(carolId, 'POST', `${base}/notes`, { text: 'Wants a demo', mediaIds: [clip.id], contactIds: [dana.id], accountIds: [acme.id] })
    expect(res.statusCode).toBe(201)
    await validateResponse('createNote', 201, res.json())
    const note = res.json().data
    expect(note).toMatchObject({ authorMemberId: carol, text: 'Wants a demo', contentRemoved: false, subjects: [`account:${acme.id}`, `contact:${dana.id}`].sort() })
    expect(note.media[0].url).toContain(`/media/${clip.id}/playback?token=`) // tokened: plays for any member

    const listed = await call(daveId, 'GET', `${base}/notes?contactId=${dana.id}`)
    await validateResponse('listNotes', 200, listed.json())
    expect(listed.json().data.map((n: any) => n.id)).toEqual([note.id])
    expect(await timelineTypes(`${base}/contacts/${dana.id}/timeline`, daveId)).toEqual(['note.added', 'contact.created'])
    expect(await timelineTypes(`${base}/accounts/${acme.id}/timeline`, daveId)).toEqual(['note.added', 'account.created'])

    // Someone else's upload can't be attached.
    const alices = await voice(testUserId)
    expect((await call(carolId, 'POST', `${base}/notes`, { mediaIds: [alices.id], contactIds: [dana.id] })).json().code).toBe('INVALID_MEDIA')
    expect((await call(carolId, 'POST', `${base}/notes`, { text: 'orphan' })).json().code).toBe('NO_SUBJECT')
  })

  it('only the author or an admin deletes; an unshared note is purged and leaves the timeline', async () => {
    const { base } = await setup()
    const dana = (await contact(base, { displayName: 'Dana' })).data
    const clip = await voice(carolId)
    const note = (await call(carolId, 'POST', `${base}/notes`, { mediaIds: [clip.id], contactIds: [dana.id] })).json().data
    expect((await call(daveId, 'DELETE', `${base}/notes/${note.id}`)).statusCode).toBe(403)
    expect((await call(carolId, 'DELETE', `${base}/notes/${note.id}`)).statusCode).toBe(200)
    expect((await call(carolId, 'GET', `${base}/notes/${note.id}`)).statusCode).toBe(404)
    expect(await db.media.findUnique({ where: { id: clip.id } })).toBeNull() // purged
    expect(await timelineTypes(`${base}/contacts/${dana.id}/timeline`)).toEqual(['contact.created'])
  })

  it('sharing places the capture in a room; deleting the note keeps that placement; deleting the capture in the room empties the note', async () => {
    const { base } = await setup()
    const dana = (await contact(base, { displayName: 'Dana' })).data
    const room = await seedRoom(app, carolId)
    const kept = (await call(carolId, 'POST', `${base}/notes`, { text: 'Call recap', contactIds: [dana.id] })).json().data
    expect((await call(daveId, 'POST', `${base}/notes/${kept.id}/share`, { roomIds: [room.id] })).statusCode).toBe(403) // author only
    const shared = await call(carolId, 'POST', `${base}/notes/${kept.id}/share`, { roomIds: [room.id] })
    expect(shared.statusCode).toBe(201)
    await validateResponse('shareNote', 201, shared.json())
    const item = shared.json().data[0]
    expect(item).toMatchObject({ roomId: room.id, messageId: kept.messageId })
    expect(await timelineTypes(`${base}/contacts/${dana.id}/timeline`)).toEqual(['note.shared', 'note.added', 'contact.created'])

    await call(carolId, 'DELETE', `${base}/notes/${kept.id}`)
    const placement = await call(carolId, 'GET', `/items/${item.id}`)
    expect(placement.json().data).toMatchObject({ deletedAt: null, message: { text: 'Call recap' } })

    const second = (await call(carolId, 'POST', `${base}/notes`, { text: 'Second', contactIds: [dana.id] })).json().data
    const placed = (await call(carolId, 'POST', `${base}/notes/${second.id}/share`, { roomIds: [room.id] })).json().data[0]
    await call(carolId, 'DELETE', `/items/${placed.id}`)
    expect((await call(daveId, 'GET', `${base}/notes/${second.id}`)).json().data).toMatchObject({ text: null, media: [], contentRemoved: true })
  })
})

describe('links to conversations (§6)', () => {
  it('a conversation linked to a contact shows on its timeline; unlinking removes it and records that', async () => {
    const { base } = await setup()
    const dana = (await contact(base, { displayName: 'Dana' })).data
    const room = await seedRoom(app, carolId, { title: 'Demo call' })
    const item = await seedItem(app, carolId, room.id)

    const link = await call(daveId, 'POST', `${base}/links`, { contactId: dana.id, roomId: room.id, itemId: item.id })
    expect(link.statusCode).toBe(201)
    await validateResponse('createRecordLink', 201, link.json())
    expect(link.json().data).toMatchObject({ subject: { type: 'contact', id: dana.id, name: 'Dana' }, object: { type: 'item', room: { id: room.id, title: 'Demo call' }, itemId: item.id } })
    expect((await call(daveId, 'POST', `${base}/links`, { contactId: dana.id, roomId: room.id, itemId: item.id })).json().code).toBe('ALREADY_LINKED')

    const tl = (await call(daveId, 'GET', `${base}/contacts/${dana.id}/timeline`)).json().data
    expect(tl[0]).toMatchObject({ type: 'conversation.linked', roomId: room.id, itemId: item.id })

    const listed = await call(daveId, 'GET', `${base}/links?contactId=${dana.id}`)
    await validateResponse('listRecordLinks', 200, listed.json())
    expect((await call(daveId, 'DELETE', `${base}/links/${link.json().data.id}`)).statusCode).toBe(200)
    expect(await timelineTypes(`${base}/contacts/${dana.id}/timeline`)).toEqual(['link.removed', 'contact.created'])
    expect((await call(daveId, 'GET', `${base}/links?contactId=${dana.id}`)).json().data).toEqual([])
  })

  it('the room tile shows links only to members of the record’s workspace; private rooms stay anonymous', async () => {
    const { base } = await setup()
    const dana = (await contact(base, { displayName: 'Dana' })).data
    const open = await seedRoom(app, carolId, { title: 'Open room' })
    const secret = await seedRoom(app, carolId, { title: 'Secret room', visibility: 'private' })

    expect((await call(daveId, 'POST', `${base}/links`, { contactId: dana.id, roomId: secret.id })).statusCode).toBe(404) // can't link what you can't see
    await call(carolId, 'POST', `${base}/links`, { contactId: dana.id, roomId: open.id })
    await call(carolId, 'POST', `${base}/links`, { contactId: dana.id, roomId: secret.id })

    const tile = await call(daveId, 'GET', `/rooms/${open.id}/links`)
    expect(tile.statusCode).toBe(200)
    await validateResponse('listRoomLinks', 200, tile.json())
    expect(tile.json().data.map((l: any) => l.subject.name)).toEqual(['Dana'])
    expect((await call(testOtherUserId, 'GET', `/rooms/${open.id}/links`)).json().data).toEqual([]) // not in the workspace

    // Dave is in the workspace but not the private room: the link is there, the room is not named.
    const links = (await call(daveId, 'GET', `${base}/links?contactId=${dana.id}`)).json().data
    expect(links.map((l: any) => l.object.room?.title ?? null).sort()).toEqual([null, 'Open room'].sort())
    const tl = (await call(daveId, 'GET', `${base}/contacts/${dana.id}/timeline`)).json().data
    expect(tl.filter((a: any) => a.type === 'conversation.linked').map((a: any) => a.roomId)).toEqual([null, open.id])
  })

  it('linking an existing note to another record puts it on that timeline at its original time', async () => {
    const { base } = await setup()
    const dana = (await contact(base, { displayName: 'Dana' })).data
    const acme = (await account(base, { name: 'Acme' })).data
    const note = (await call(carolId, 'POST', `${base}/notes`, { text: 'Budget approved', contactIds: [dana.id] })).json().data
    await call(carolId, 'POST', `${base}/links`, { accountId: acme.id, noteId: note.id })
    expect(await timelineTypes(`${base}/accounts/${acme.id}/timeline`)).toEqual(['note.added', 'account.created'])
    expect((await call(carolId, 'GET', `${base}/notes?accountId=${acme.id}`)).json().data.map((n: any) => n.id)).toEqual([note.id])
  })
})

describe('merge', () => {
  it('folds a duplicate in: points, accounts, tags, links and timeline move; the old id resolves to the survivor', async () => {
    const { base, carol } = await setup()
    const acme = (await account(base, { name: 'Acme' })).data
    const globex = (await account(base, { name: 'Globex' })).data
    const vip = (await call(carolId, 'POST', `${base}/tags`, { name: 'VIP' })).json().data
    const keep = (await contact(base, { displayName: 'Dana Ruiz', points: [email('dana@acme.com')], accounts: [{ accountId: acme.id }] })).data
    const dupe = (await contact(base, { displayName: 'D. Ruiz', ownerMemberId: carol, points: [email('dana@acme.com'), email('dana@home.io')], accounts: [{ accountId: acme.id }, { accountId: globex.id }], tagIds: [vip.id] })).data
    await call(carolId, 'POST', `${base}/notes`, { text: 'Met at the expo', contactIds: [dupe.id] })
    const room = await seedRoom(app, carolId)
    await call(carolId, 'POST', `${base}/links`, { contactId: dupe.id, roomId: room.id })
    await call(carolId, 'POST', `${base}/links`, { contactId: keep.id, roomId: room.id }) // same link on both → one survives

    expect((await call(daveId, 'POST', `${base}/contacts/${keep.id}/merge`, { mergeContactId: dupe.id })).statusCode).toBe(403) // not dupe's owner
    const merged = await call(carolId, 'POST', `${base}/contacts/${keep.id}/merge`, { mergeContactId: dupe.id })
    expect(merged.statusCode).toBe(200)
    await validateResponse('mergeContacts', 200, merged.json())
    const c = merged.json().data
    expect(c.points.map((p: any) => p.value)).toEqual(['dana@acme.com', 'dana@home.io'])
    expect(c.primaryEmail).toBe('dana@acme.com')
    expect(c.accounts.map((a: any) => a.name).sort()).toEqual(['Acme', 'Globex'])
    expect(c.tags.map((t: any) => t.name)).toEqual(['VIP'])

    expect((await call(carolId, 'GET', `${base}/contacts/${dupe.id}`)).json().data.id).toBe(keep.id)
    expect((await call(carolId, 'GET', `${base}/contacts/match?email=dana@acme.com`)).json().data).toMatchObject({ result: 'match', matchId: keep.id })
    const links = (await call(carolId, 'GET', `${base}/links?contactId=${keep.id}`)).json().data
    expect(links.map((l: any) => l.object.type).sort()).toEqual(['note', 'room']) // the shared room link was deduplicated
    expect((await call(carolId, 'GET', `${base}/notes?contactId=${keep.id}`)).json().data).toHaveLength(1)
    const types = await timelineTypes(`${base}/contacts/${keep.id}/timeline`)
    expect(types[0]).toBe('contact.merged')
    expect(types.filter((t: string) => t === 'note.added')).toHaveLength(1)
    expect(types.filter((t: string) => t === 'contact.created')).toHaveLength(2) // both histories, one timeline
  })
})

describe('workspace boundary', () => {
  it('records of one workspace never reach another', async () => {
    const { base } = await setup()
    const other = await createWorkspace(app, testUserId, { name: 'Other' })
    const theirs = (await contact(`/workspaces/${other.id}`, { displayName: 'Theirs' })).data
    const theirAccount = (await account(`/workspaces/${other.id}`, { name: 'Their Co' })).data
    const mine = (await contact(base, { displayName: 'Mine' })).data

    expect((await call(testUserId, 'GET', `${base}/contacts/${theirs.id}`)).statusCode).toBe(404)
    expect((await call(testUserId, 'POST', `${base}/notes`, { text: 'x', contactIds: [theirs.id] })).statusCode).toBe(404)
    expect((await call(testUserId, 'POST', `${base}/links`, { contactId: theirs.id, roomId: (await seedRoom(app, testUserId)).id })).statusCode).toBe(404)
    expect((await call(testUserId, 'PUT', `${base}/contacts/${mine.id}/accounts/${theirAccount.id}`, {})).statusCode).toBe(404)
    expect((await call(testUserId, 'POST', `${base}/contacts/${mine.id}/merge`, { mergeContactId: theirs.id })).statusCode).toBe(404)
    expect((await call(testUserId, 'GET', `${base}/contacts/match?email=x@y.io`)).statusCode).toBe(200)
    expect((await call(testOtherUserId, 'GET', `${base}/contacts`)).statusCode).toBe(404) // outsider

    expect(await crossWorkspaceViolations()).toEqual({})
  })
})
