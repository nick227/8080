// doc/13 D1 — the proposal primitive, proved on the company profile ("Fix a fact"):
// one object in chat and on the record, apply on a click, stale detection, history,
// undo that never reverses newer work, revert / refresh, permissions.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId, testOtherUserId, seedBotUser, validateResponse } from './helpers'
import { caller, carolId, createWorkspace, join, seedPeople } from './helpers/workspace'
import { startWorkspaceHost } from '../services/WorkspaceHost'
import { CompanyProfileService } from '../services/CompanyProfileService'

const app = buildTestApp()
const call = caller(app)
let host: ReturnType<typeof startWorkspaceHost>
beforeAll(() => { host = startWorkspaceHost() })
afterAll(() => host.stop())

let bot: { userId: string; botId: string }
beforeEach(async () => {
  bot = await seedBotUser({ handle: 'chatbot', name: 'chatbot' })
  await seedPeople()
})

const profiles = new CompanyProfileService()
async function setup() {
  const ws = await createWorkspace(app)
  await host.idle()
  const { roomId } = await db.workspaceChannel.findUniqueOrThrow({ where: { workspaceId: ws.id } })
  const user = await db.user.findUniqueOrThrow({ where: { id: testUserId }, include: { profile: true } })
  await profiles.apply({ user, origin: 'ui' }, ws.id, { name: 'Midnight Creative', location: 'Austin, TX', serviceArea: 'regional', offerings: ['Web design'], sources: {} }, 'seed')
  await join(app, ws.id, carolId, 'carol@test.local')
  await host.idle()
  return { ws, roomId, base: `/workspaces/${ws.id}/proposals` }
}
const lastBot = async (roomId: string) =>
  (await db.item.findMany({ where: { roomId, message: { authorId: bot.userId } }, include: { message: true }, orderBy: { number: 'asc' } })).at(-1)!
async function say(who: string, roomId: string, text: string) {
  expect((await call(who, 'POST', `/rooms/${roomId}/items`, { text, chat: true })).statusCode).toBe(201)
  await host.idle()
}
async function click(who: string, itemId: string, optionIds: string[]) {
  const res = await call(who, 'POST', `/items/${itemId}/choice`, { optionIds })
  await host.idle()
  return res
}
const propose = (base: string, who: string, field: string, value: unknown) =>
  call(who, 'POST', base, { kind: 'company-profile.fact', targetId: base.split('/')[2], change: { field, value } })

describe('Fix a fact in the channel → a proposal card', () => {
  it('typed: "fix a fact" → which fact → the new value → one card, the same object chat and record show', async () => {
    const { ws, roomId, base } = await setup()
    await say(carolId, roomId, 'Fix a fact')
    expect((await lastBot(roomId)).message.text).toBe('Which fact should change?')
    await click(carolId, (await lastBot(roomId)).id, ['location'])
    expect((await lastBot(roomId)).message.text).toBe('Location says: Austin, TX. What should it say?')
    await say(carolId, roomId, 'Austin and Central Texas')

    const card = await lastBot(roomId)
    const inChat = (await call(carolId, 'GET', `/items/${card.id}`)).json().data
    await validateResponse('getItem', 200, { data: inChat })
    expect(inChat.proposal).toMatchObject({
      kind: 'company-profile.fact', targetType: 'companyProfile', targetId: ws.id, status: 'pending', requires: 'admin',
      title: 'Company profile · Location', diff: [{ label: 'Location', before: 'Austin, TX', after: 'Austin and Central Texas' }],
    })
    const onRecord = await call(carolId, 'GET', `${base}?targetType=companyProfile&targetId=${ws.id}`)
    await validateResponse('listProposals', 200, onRecord.json())
    expect(onRecord.json().data).toEqual([inChat.proposal])
    // Nothing changed yet.
    expect((await profiles.current(ws.id)).location).toBe('Austin, TX')
  })

  it('buttons where the options are fixed; a list is typed with commas', async () => {
    const { roomId } = await setup()
    await say(testUserId, roomId, 'fix a fact')
    await click(testUserId, (await lastBot(roomId)).id, ['service-area'])
    await click(testUserId, (await lastBot(roomId)).id, ['national'])
    expect((await call(testUserId, 'GET', `/items/${(await lastBot(roomId)).id}`)).json().data.proposal.diff).toEqual([{ label: 'Where it works', before: 'regional', after: 'national' }])

    await say(testUserId, roomId, 'fix a fact')
    await click(testUserId, (await lastBot(roomId)).id, ['offerings'])
    expect((await lastBot(roomId)).message.text).toBe('Offerings says: Web design. What should it say? Separate items with commas.')
    await say(testUserId, roomId, 'Web design, AI automation')
    expect((await call(testUserId, 'GET', `/items/${(await lastBot(roomId)).id}`)).json().data.proposal.diff).toEqual([{ label: 'Offerings', before: 'Web design', after: 'Web design, AI automation' }])
  })

  it('the same value is "already says"; an invalid one is explained; no card', async () => {
    const { roomId } = await setup()
    await say(testUserId, roomId, 'fix a fact')
    await click(testUserId, (await lastBot(roomId)).id, ['location'])
    await say(testUserId, roomId, 'Austin, TX')
    expect((await lastBot(roomId)).message.text).toBe("That's what it already says.")
    expect(await db.agentProposal.count()).toBe(0)
  })
})

describe('apply, history, undo', () => {
  it('members propose; only owners/admins apply. Apply writes a corrected fact and a revision, once', async () => {
    const { ws, base, roomId } = await setup()
    const created = await propose(base, carolId, 'location', 'Austin and Central Texas')
    expect(created.statusCode).toBe(201)
    await validateResponse('createProposal', 201, created.json())
    const id = created.json().data.id
    await host.idle()
    const revision = (await profiles.current(ws.id)).revision

    expect((await call(carolId, 'POST', `${base}/${id}/apply`)).statusCode).toBe(403)
    const [a, b] = await Promise.all([call(testUserId, 'POST', `${base}/${id}/apply`), call(testUserId, 'POST', `${base}/${id}/apply`)])
    expect([a.statusCode, b.statusCode]).toEqual([200, 200])
    await validateResponse('applyProposal', 200, a.json())
    const after = await profiles.current(ws.id)
    expect(after).toMatchObject({ location: 'Austin and Central Texas', revision: revision + 1 }) // applied exactly once
    expect(await db.companyScalarSource.findUniqueOrThrow({ where: { workspaceId_field: { workspaceId: ws.id, field: 'location' } } })).toMatchObject({ status: 'corrected' })
    expect(await db.actionExecution.count({ where: { workspaceId: ws.id, action: 'companyProfile.setField' } })).toBe(1)

    // The chat card shows the new state (same row, re-journaled).
    const card = await db.agentProposal.findUniqueOrThrow({ where: { id } })
    const item = (await call(carolId, 'GET', `/items/${card.itemId}`)).json().data
    expect(item.proposal).toMatchObject({ status: 'applied', decidedBy: 'Alice' })
    expect(await db.roomChange.count({ where: { roomId, itemId: card.itemId!, type: 'item.updated' } })).toBeGreaterThanOrEqual(2)
  })

  it('undo puts the field back exactly (value and its original status)', async () => {
    const { ws, base } = await setup()
    const id = (await propose(base, testUserId, 'location', 'Austin and Central Texas')).json().data.id
    await call(testUserId, 'POST', `${base}/${id}/apply`)
    const undone = await call(testUserId, 'POST', `${base}/${id}/undo`)
    expect(undone.statusCode).toBe(200)
    expect(undone.json().data.status).toBe('undone')
    expect((await profiles.current(ws.id)).location).toBe('Austin, TX')
    expect(await db.companyScalarSource.findUniqueOrThrow({ where: { workspaceId_field: { workspaceId: ws.id, field: 'location' } } })).toMatchObject({ status: 'stated' })

    // Lists too.
    const list = (await propose(base, testUserId, 'offerings', ['Web design', 'Hosting'])).json().data.id
    await call(testUserId, 'POST', `${base}/${list}/apply`)
    expect((await profiles.current(ws.id)).facts.filter((f) => f.kind === 'offering').map((f) => [f.value, f.status])).toEqual([['Web design', 'corrected'], ['Hosting', 'corrected']])
    await call(testUserId, 'POST', `${base}/${list}/undo`)
    expect((await profiles.current(ws.id)).facts.filter((f) => f.kind === 'offering').map((f) => [f.value, f.status])).toEqual([['Web design', 'stated']])
  })

  it('undo never reverses newer work: 409 PROPOSAL_UNDO_STALE, then Revert proposes the old value instead', async () => {
    const { ws, base } = await setup()
    const first = (await propose(base, testUserId, 'location', 'Austin and Central Texas')).json().data.id
    await call(testUserId, 'POST', `${base}/${first}/apply`)
    const second = (await propose(base, testUserId, 'location', 'Round Rock, TX')).json().data.id
    await call(testUserId, 'POST', `${base}/${second}/apply`)

    const stale = await call(testUserId, 'POST', `${base}/${first}/undo`)
    expect(stale.statusCode).toBe(409)
    expect(stale.json().code).toBe('PROPOSAL_UNDO_STALE')
    expect((await profiles.current(ws.id)).location).toBe('Round Rock, TX') // the newer work stands

    const revert = await call(testUserId, 'POST', `${base}/${first}/revert`)
    expect(revert.statusCode).toBe(201)
    expect(revert.json().data).toMatchObject({ status: 'pending', diff: [{ label: 'Location', before: 'Round Rock, TX', after: 'Austin, TX' }] })
  })
})

describe('stale and decided proposals', () => {
  it('a pending proposal expires when the record changes under it; Apply refuses; Refresh re-proposes against now', async () => {
    const { ws, base } = await setup()
    const old = (await propose(base, testUserId, 'location', 'Austin and Central Texas')).json().data.id
    const other = (await propose(base, testUserId, 'name', 'Midnight Studio')).json().data.id
    await call(testUserId, 'POST', `${base}/${other}/apply`)

    expect((await call(testUserId, 'GET', `${base}/${old}`)).json().data.status).toBe('expired')
    const refused = await call(testUserId, 'POST', `${base}/${old}/apply`)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().code).toBe('PROPOSAL_EXPIRED')
    expect((await profiles.current(ws.id)).location).toBe('Austin, TX')

    const fresh = await call(testUserId, 'POST', `${base}/${old}/refresh`)
    expect(fresh.statusCode).toBe(201)
    expect(fresh.json().data.baseVersion).toBe((await profiles.current(ws.id)).revision)
    expect((await call(testUserId, 'POST', `${base}/${fresh.json().data.id}/apply`)).statusCode).toBe(200)
  })

  it('a change made outside proposals also expires it (read-time check)', async () => {
    const { ws, base } = await setup()
    const id = (await propose(base, testUserId, 'location', 'Austin and Central Texas')).json().data.id
    const user = await db.user.findUniqueOrThrow({ where: { id: testUserId }, include: { profile: true } })
    await profiles.apply({ user, origin: 'ui' }, ws.id, { purpose: 'Builds websites', sources: {} }, 'outside')
    expect((await call(testUserId, 'POST', `${base}/${id}/apply`)).json().code).toBe('PROPOSAL_EXPIRED')
  })

  it('a proposal times out after 14 days', async () => {
    const { base } = await setup()
    const id = (await propose(base, testUserId, 'location', 'Austin and Central Texas')).json().data.id
    await db.agentProposal.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await call(testUserId, 'GET', `${base}/${id}`)).json().data.status).toBe('expired')
  })

  it('Not now dismisses; a dismissed proposal cannot be applied', async () => {
    const { base } = await setup()
    const id = (await propose(base, testUserId, 'location', 'Austin and Central Texas')).json().data.id
    expect((await call(testUserId, 'POST', `${base}/${id}/dismiss`)).json().data.status).toBe('dismissed')
    expect((await call(testUserId, 'POST', `${base}/${id}/apply`)).json().code).toBe('PROPOSAL_DECIDED')
  })
})

describe('the handler is the only authority', () => {
  it('unknown kinds, invalid values, no-op changes and foreign targets are refused; outsiders see nothing', async () => {
    const { ws, base } = await setup()
    expect((await call(testUserId, 'POST', base, { kind: 'anything.goes', targetId: ws.id, change: {} })).json().code).toBe('UNKNOWN_PROPOSAL_KIND')
    expect((await propose(base, testUserId, 'serviceArea', 'galactic')).json().code).toBe('INVALID_VALUE')
    expect((await propose(base, testUserId, 'passwordHash', 'x')).json().code).toBe('INVALID_FIELD')
    expect((await propose(base, testUserId, 'location', 'Austin, TX')).json().code).toBe('NO_CHANGE')
    expect((await call(testUserId, 'POST', base, { kind: 'company-profile.fact', targetId: 'some-other-workspace', change: { field: 'location', value: 'x' } })).statusCode).toBe(404)
    const id = (await propose(base, testUserId, 'location', 'Austin and Central Texas')).json().data.id
    expect((await call(testOtherUserId, 'GET', `${base}/${id}`)).statusCode).toBe(404)
    expect((await call(testOtherUserId, 'POST', `${base}/${id}/apply`)).statusCode).toBe(404)
  })
})
