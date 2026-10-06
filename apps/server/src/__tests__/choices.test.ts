// doc/12 Slice A — bot message choices: generic options, first choice wins, locked
// answers, deterministic advancement. No workflow/profile concerns here.
import { describe, it, expect, afterEach } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId, seedRoom, seedItem, seedBotUser } from './helpers'
import { ItemService } from '../services/ItemService'
import { registerChoiceFlow, type ChoiceFlow } from '../services/ChoiceService'
import { storedActions } from '../lib/choice'
import { DEMO_FLOW, demoFlow, demoStart } from '../bots/flows/demo'
import { BOT_LIMITS } from '../bots/limits'

const app = buildTestApp()
const items = new ItemService()
const unregister: (() => void)[] = []
afterEach(() => { while (unregister.length) unregister.pop()!() })

const YES_NO = [{ id: 'yes', label: 'Yes' }, { id: 'not-now', label: 'Not now' }]

function flow(key: string, impl: ChoiceFlow) {
  unregister.push(registerChoiceFlow(key, impl))
}

async function offered(opts: { flow?: string; step?: string; forUserId?: string | null; mode?: 'one' | 'many'; options?: { id: string; label: string }[]; visibility?: 'public' | 'private' } = {}) {
  const room = await seedRoom(app, testUserId, { visibility: opts.visibility ?? 'public' })
  await seedItem(app, testUserId, room.id, { text: 'opening post' })
  const bot = await seedBotUser()
  const item = await items.send(bot.userId, room.id, { text: 'Want to start?', chat: true }, {
    actions: { flow: opts.flow ?? 'test', step: opts.step ?? 'start', mode: opts.mode, options: opts.options ?? YES_NO, forUserId: opts.forUserId },
  })
  return { room, bot, item }
}

const choose = (who: string, itemId: string, optionIds: string[]) =>
  app.inject({ method: 'POST', url: `/items/${itemId}/choice`, headers: asAuth(who), payload: { optionIds } })

const botItems = (roomId: string, botUserId: string) =>
  db.item.findMany({ where: { roomId, message: { authorId: botUserId } }, include: { message: true }, orderBy: { number: 'asc' } })

describe('offer', () => {
  it('serializes generic options (flow and step stay on the server); choice starts null', async () => {
    const { item } = await offered({ forUserId: testUserId })
    const res = await app.inject({ method: 'GET', url: `/items/${item.id}`, headers: asAuth(testUserId) })
    expect(res.statusCode).toBe(200)
    await validateResponse('getItem', 200, res.json())
    expect(res.json().data.message.actions).toEqual({ mode: 'one', options: YES_NO, forUserId: testUserId })
    expect(res.json().data.message.choice).toBeNull()
  })

  it('human messages carry no actions, and HTTP can never set them', async () => {
    const room = await seedRoom(app, testUserId)
    const human = await seedItem(app, testUserId, room.id, { text: 'hi' })
    const res = await app.inject({ method: 'GET', url: `/items/${human.id}`, headers: asAuth(testUserId) })
    expect(res.json().data.message.actions).toBeNull()
    const sneaky = await app.inject({
      method: 'POST', url: `/rooms/${room.id}/items`, headers: asAuth(testUserId),
      payload: { text: 'x', actions: { mode: 'one', options: YES_NO } },
    })
    expect(sneaky.statusCode).toBe(400)
    await expect(items.send(testUserId, room.id, { text: 'x' }, { actions: { flow: 'test', step: 's', options: YES_NO } })).rejects.toThrow('Only bots offer choices')
  })

  it('validates offers: 1–8 options, unique slug ids, labels ≤ 40, known mode', () => {
    expect(() => storedActions({ flow: 'f', step: 's', options: [] })).toThrow()
    expect(() => storedActions({ flow: 'f', step: 's', options: Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, label: 'x' })) })).toThrow()
    expect(() => storedActions({ flow: 'f', step: 's', options: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] })).toThrow()
    expect(() => storedActions({ flow: 'f', step: 's', options: [{ id: 'Not Now', label: 'A' }] })).toThrow()
    expect(() => storedActions({ flow: 'f', step: 's', options: [{ id: 'a', label: 'x'.repeat(41) }] })).toThrow()
    expect(() => storedActions({ flow: 'f', step: 's', mode: 'all' as any, options: YES_NO })).toThrow()
    expect(() => storedActions({ flow: '', step: 's', options: YES_NO })).toThrow()
    expect(storedActions({ flow: 'f', step: 's', options: [{ id: 'start', label: ' Start ' }] })).toEqual({ flow: 'f', step: 's', mode: 'one', options: [{ id: 'start', label: 'Start' }], forUserId: null })
  })
})

describe('choose', () => {
  it('records the first choice, journals item.updated, and the flow advances deterministically', async () => {
    const seen: unknown[] = []
    flow('test', { advance: (_tx, ctx) => { seen.push(ctx); return [{ text: 'Great. Pick one.', offer: { step: 'next', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] } }] } })
    const { room, bot, item } = await offered({ forUserId: testUserId })

    const res = await choose(testUserId, item.id, ['yes'])
    expect(res.statusCode).toBe(200)
    await validateResponse('chooseOption', 200, res.json())
    expect(res.json().data.message.choice).toMatchObject({ optionIds: ['yes'], userId: testUserId })
    expect(seen).toEqual([{ flow: 'test', step: 'start', optionIds: ['yes'], userId: testUserId, roomId: room.id, itemId: item.id }])

    const change = await db.roomChange.findFirst({ where: { roomId: room.id, itemId: item.id, type: 'item.updated' } })
    expect(change).toMatchObject({ actorId: testUserId })

    const posted = await botItems(room.id, bot.userId)
    expect(posted).toHaveLength(2)
    expect(posted[1]!.message.text).toBe('Great. Pick one.')
    expect(posted[1]!.chat).toBe(true) // same surface as the question
    expect(posted[1]!.message.actions).toMatchObject({ flow: 'test', step: 'next', mode: 'one', options: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })
    // The click is not a chat item.
    expect(await db.item.count({ where: { roomId: room.id, message: { authorId: testUserId } } })).toBe(1)
  })

  it('first choice wins: a repeat is a no-op, a different answer is 409, nothing advances twice', async () => {
    let advanced = 0
    flow('test', { advance: () => { advanced++; return [{ text: 'next' }] } })
    const { room, bot, item } = await offered()
    expect((await choose(testUserId, item.id, ['yes'])).statusCode).toBe(200)
    const again = await choose(testUserId, item.id, ['yes'])
    expect(again.statusCode).toBe(200)
    expect(again.json().data.message.choice.optionIds).toEqual(['yes'])
    const other = await choose(testUserId, item.id, ['not-now'])
    expect(other.statusCode).toBe(409)
    expect(other.json().code).toBe('CHOICE_CLOSED')
    // Another person (no forUserId) can't overwrite it either.
    expect((await choose(testOtherUserId, item.id, ['yes'])).json().code).toBe('CHOICE_CLOSED')
    expect(advanced).toBe(1)
    expect(await botItems(room.id, bot.userId)).toHaveLength(2)
  })

  it('two people clicking at once: exactly one wins, one follow-up', async () => {
    let advanced = 0
    flow('test', { advance: () => { advanced++; return [{ text: 'next' }] } })
    const { room, bot, item } = await offered()
    const results = await Promise.all([choose(testUserId, item.id, ['yes']), choose(testOtherUserId, item.id, ['not-now'])])
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409])
    expect(advanced).toBe(1)
    expect(await botItems(room.id, bot.userId)).toHaveLength(2)
  })

  it('forUserId: anyone else is 403 NOT_YOUR_CHOICE and the choice stays open', async () => {
    const { item } = await offered({ forUserId: testUserId })
    const res = await choose(testOtherUserId, item.id, ['yes'])
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('NOT_YOUR_CHOICE')
    expect((await choose(testUserId, item.id, ['yes'])).statusCode).toBe(200)
  })

  it('a flow can gate who chooses (canChoose)', async () => {
    flow('test', { canChoose: ({ userId }) => userId === testUserId, advance: () => [] })
    const { item } = await offered()
    expect((await choose(testOtherUserId, item.id, ['yes'])).json().code).toBe('NOT_YOUR_CHOICE')
    expect((await choose(testUserId, item.id, ['yes'])).statusCode).toBe(200)
  })

  it('validates the answer against the offer: unknown ids, and mode one vs many', async () => {
    const { item } = await offered()
    expect((await choose(testUserId, item.id, ['maybe'])).json().code).toBe('INVALID_CHOICE')
    expect((await choose(testUserId, item.id, ['yes', 'not-now'])).json().code).toBe('INVALID_CHOICE')
    expect((await choose(testUserId, item.id, [])).statusCode).toBe(400) // schema: minItems 1

    const many = await offered({ mode: 'many', options: [{ id: 'web', label: 'Web' }, { id: 'email', label: 'Email' }, { id: 'social', label: 'Social' }] })
    const res = await choose(testUserId, many.item.id, ['web', 'social'])
    expect(res.statusCode).toBe(200)
    expect(res.json().data.message.choice.optionIds).toEqual(['web', 'social'])
  })

  it('NOT_A_CHOICE for ordinary items; 404 for rooms the caller cannot see; 409 once deleted', async () => {
    const room = await seedRoom(app, testUserId)
    const human = await seedItem(app, testUserId, room.id, { text: 'hi' })
    expect((await choose(testUserId, human.id, ['yes'])).json().code).toBe('NOT_A_CHOICE')

    const hidden = await offered({ visibility: 'private' })
    expect((await choose(testOtherUserId, hidden.item.id, ['yes'])).statusCode).toBe(404)

    const gone = await offered()
    await items.delete(gone.bot.userId, gone.item.id)
    expect((await choose(testUserId, gone.item.id, ['yes'])).json().code).toBe('CHOICE_CLOSED')
  })

  it('a muted bot’s offer arrives hidden: no actions, no choice', async () => {
    const { bot, item } = await offered()
    await app.inject({ method: 'PUT', url: `/users/me/mutes/${bot.userId}`, headers: asAuth(testUserId) })
    const res = await app.inject({ method: 'GET', url: `/items/${item.id}`, headers: asAuth(testUserId) })
    expect(res.json().data.message.actions).toBeNull()
    expect(res.json().data.message.choice).toBeNull()
  })

  it('an answered bot message is a human turn: it ends a consecutive bot run', async () => {
    const room = await seedRoom(app, testUserId)
    await seedItem(app, testUserId, room.id, { text: 'opening post' })
    const bot = await seedBotUser()
    for (let i = 1; i < BOT_LIMITS.maxConsecutive; i++) await items.send(bot.userId, room.id, { text: `line ${i}`, chat: true })
    const question = await items.send(bot.userId, room.id, { text: 'Start?', chat: true }, { actions: { flow: 'test', step: 's', options: YES_NO } })
    await expect(items.send(bot.userId, room.id, { text: 'unanswered', chat: true })).rejects.toMatchObject({ code: 'BOT_CAP' })
    expect((await choose(testUserId, question.id, ['yes'])).statusCode).toBe(200)
    await expect(items.send(bot.userId, room.id, { text: 'answered', chat: true })).resolves.toBeTruthy()
  })
})

describe('demo flow (dev)', () => {
  it('Yes → tone (4 options) → channels (many) → end; Not now → Start → back to the first question', async () => {
    flow(DEMO_FLOW, demoFlow)
    const room = await seedRoom(app, testUserId)
    await seedItem(app, testUserId, room.id, { text: 'opening post' })
    const bot = await seedBotUser()
    const start = demoStart(testUserId)
    const first = await items.send(bot.userId, room.id, { text: start.text, chat: true }, { actions: { ...start.offer!, flow: DEMO_FLOW } })
    const latest = async () => (await botItems(room.id, bot.userId)).at(-1)!

    await choose(testUserId, first.id, ['not-now'])
    expect((await latest()).message.text).toMatch(/when you're ready/)
    await choose(testUserId, (await latest()).id, ['start'])
    const again = await latest()
    expect(again.message.text).toBe(start.text)

    await choose(testUserId, again.id, ['yes'])
    const tone = await latest()
    expect((tone.message.actions as any).options).toHaveLength(4)
    await choose(testUserId, tone.id, ['friendly'])
    const channels = await latest()
    expect(channels.message.text).toMatch(/^Friendly it is/)
    expect((channels.message.actions as any).mode).toBe('many')
    await choose(testUserId, channels.id, ['web', 'email'])
    const end = await latest()
    expect(end.message.text).toBe("Noted: Web, Email. That's the end of the demo.")
    expect(end.message.actions).toBeNull()
  })
})
