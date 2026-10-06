// doc/12 Slice B, AI off: public welcome → creator-only setup → deterministic
// questions → stored profile → template company description → native document →
// bot posts the link. Plus the rails around it.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, validateResponse, testUserId, testOtherUserId, seedBotUser } from './helpers'
import { caller, carolId, createWorkspace, join, memberId, seedPeople } from './helpers/workspace'
import { startWorkspaceHost } from '../services/WorkspaceHost'
import { STEPS, nextStep, splitList, startRun } from '../bots/flows/companyProfile'
import { companyDescription } from '../bots/flows/companyDescription'
import { GUARDS } from '../bots/guards'
import { crossWorkspaceViolations } from '../services/workspaceIntegrity'
import { subscribe } from '../services/documentHub'

// The shared channel also carries curated workspace activity (activityEvent.ts);
// these tests follow the workflows' own lines.
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

async function workspace() {
  const ws = await createWorkspace(app)
  await host.idle()
  const channel = await db.workspaceChannel.findUniqueOrThrow({ where: { workspaceId: ws.id } })
  return { ws, roomId: channel.roomId }
}
const botItems = (roomId: string) =>
  db.item.findMany({ where: { roomId, message: { authorId: bot.userId, OR: [{ workflow: null }, { workflow: { not: 'workspace-activity' } }] } }, include: { message: true }, orderBy: { number: 'asc' } })
const lastBot = async (roomId: string) => (await botItems(roomId)).at(-1)!
async function click(userId: string, itemId: string, optionIds: string[]) {
  const res = await call(userId, 'POST', `/items/${itemId}/choice`, { optionIds })
  await host.idle()
  return res
}
async function say(userId: string, roomId: string, text: string) {
  const res = await call(userId, 'POST', `/rooms/${roomId}/items`, { text, chat: true })
  expect(res.statusCode).toBe(201)
  await host.idle()
  return res.json().data
}
/** Answers the current question: a click for choices, a typed line for text. */
async function answer(roomId: string, value: string | string[]) {
  const q = await lastBot(roomId)
  if (Array.isArray(value)) expect((await click(testUserId, q.id, value)).statusCode).toBe(200)
  else await say(testUserId, roomId, value)
  return lastBot(roomId)
}

const INTERVIEW: [string, string | string[]][] = [
  ['name', 'Midnight Creative'],
  ['area', ['regional']],
  ['location', 'Austin, TX'],
  ['purpose', 'we build websites and automate busywork for small businesses'],
  ['offerings', 'Web design, AI automation; hosting'],
  ['customers', ['businesses', 'nonprofits']],
  ['differentiator', 'fast custom work with real technical depth'],
  ['tone', ['friendly']],
  ['audience', ['customers']],
  ['length', ['medium']],
]

describe('the whole path (AI off)', () => {
  it('welcome → setup → questions → profile → template document → link', async () => {
    const { ws, roomId } = await workspace()
    const room = await db.room.findUniqueOrThrow({ where: { id: roomId }, include: { members: true } })
    expect(room.visibility).toBe('private')
    expect(room.members.map((m) => m.userId)).toEqual([testUserId])

    // Public welcome, addressed to the creator.
    const welcome = await lastBot(roomId)
    expect(welcome.message.text).toMatch(/^Welcome, Alice\./)
    expect(welcome.message).toMatchObject({ workflow: 'company-profile', actions: { step: 'start', forUserId: testUserId } })
    const got = await call(testUserId, 'GET', `/items/${welcome.id}`)
    expect(got.json().data.message.actions.options.map((o: any) => o.label)).toEqual(['Set up company profile', 'Later'])

    await click(testUserId, welcome.id, ['setup'])
    let question = await lastBot(roomId)
    expect(question.message.text).toBe("What's your company called?")
    for (const [step, value] of INTERVIEW) {
      const run = await db.workflowRun.findFirstOrThrow({ where: { workspaceId: ws.id } })
      expect(run.stepId).toBe(step)
      question = await answer(roomId, value)
    }

    // The link, as the last line.
    const link = await lastBot(roomId)
    expect(link.message.text).toMatch(/^I created Midnight Creative — Company Description and saved what I learned/)
    const res = await call(testUserId, 'GET', `/items/${link.id}`)
    await validateResponse('getItem', 200, res.json())
    const [docLink] = res.json().data.message.links
    expect(docLink).toMatchObject({ type: 'document', workspaceId: ws.id, title: 'Midnight Creative — Company Description' })

    // One line for one completion: the workspace activity record points at the
    // workflow's own summary instead of posting a second line.
    await host.idle()
    const event = await db.activityEvent.findFirstOrThrow({ where: { workspaceId: ws.id, type: 'workflow.completed' } })
    expect(event.itemId).toBe(link.id)
    expect(await db.item.count({ where: { roomId, message: { workflow: 'workspace-activity' } } })).toBe(0)

    // A native block document with the template content, linked to the channel.
    const doc = await db.document.findUniqueOrThrow({ where: { id: docLink.id }, include: { content: true, rooms: true } })
    expect(doc).toMatchObject({ workspaceId: ws.id, surface: 'blocks', sourceKind: 'native', workspaceAccess: 'viewer' })
    expect(doc.provenance).toMatchObject({ kind: 'chatbot_workflow', workflow: 'company-profile', generator: 'template', profileRevision: 1, brief: { audience: 'customers', length: 'medium' } })
    expect(doc.rooms.map((r) => r.roomId)).toEqual([roomId])
    const blocks = doc.content!.content as { level: string; text: string }[]
    expect(blocks[0]).toMatchObject({ level: 'h1', text: 'Midnight Creative' })
    expect(blocks[1]!.text).toBe('Midnight Creative is a team based in Austin, TX and works across the region. We build websites and automate busywork for small businesses. It serves businesses and nonprofits.')
    expect(blocks[2]!.text).toBe('What it offers: Web design, AI automation and hosting. Fast custom work with real technical depth. Get in touch to see how Midnight Creative can help.')
    const opened = await call(testUserId, 'GET', `/workspaces/${ws.id}/documents/${doc.id}/content`)
    expect(opened.statusCode).toBe(200)
    // The workflow wrote it; that doesn't show Alice as editing it (within the 4 s window).
    const seen: any[] = []
    const off = subscribe(doc.id, { memberId: await memberId(ws.id, testUserId), name: 'Alice', send: (e) => seen.push(e) })
    off()
    expect(seen[0]).toMatchObject({ type: 'document.presence', people: [{ name: 'Alice', editing: false }] })

    // The stored profile: stated facts, one revision, every value traced to its answer.
    const profile = await call(testUserId, 'GET', `/workspaces/${ws.id}/company-profile`)
    expect(profile.statusCode).toBe(200)
    await validateResponse('getCompanyProfile', 200, profile.json())
    expect(profile.json().data).toMatchObject({
      revision: 1, name: 'Midnight Creative', location: 'Austin, TX', serviceArea: 'regional',
      purpose: 'we build websites and automate busywork for small businesses', brandVoice: 'friendly',
    })
    const facts = profile.json().data.facts.map((f: any) => [f.kind, f.value, f.status])
    expect(facts).toEqual([
      ['offering', 'Web design', 'stated'], ['offering', 'AI automation', 'stated'], ['offering', 'hosting', 'stated'],
      ['customer', 'Businesses', 'stated'], ['customer', 'Nonprofits', 'stated'],
      ['differentiator', 'fast custom work with real technical depth', 'stated'],
    ])
    const sources = await db.companyScalarSource.findMany({ where: { workspaceId: ws.id } })
    expect(sources).toHaveLength(5)
    const answers = await db.workflowAnswer.findMany({ where: { id: { in: sources.map((s) => s.sourceAnswerId!) } } })
    expect(answers.find((a) => a.stepId === 'name')).toMatchObject({ kind: 'text', raw: 'Midnight Creative' })
    expect(await db.companyProfileRevision.count({ where: { workspaceId: ws.id } })).toBe(1)

    // Audited as the person who answered, through the assistant.
    const exec = await db.actionExecution.findMany({ where: { workspaceId: ws.id, origin: 'assistant' }, orderBy: { requestedAt: 'asc' } })
    expect(exec.map((e) => e.action)).toEqual(['companyProfile.update', 'document.create', 'document.content.save', 'document.room.link'])
    expect(exec.every((e) => e.actorKind === 'member' && e.actorUserId === testUserId)).toBe(true)
    // Shared in the same action that created it — before the link was posted.
    expect(exec.find((e) => e.action === 'document.create')!.input).toMatchObject({ workspaceAccess: 'viewer' })
    expect(exec.find((e) => e.action === 'document.create')!.finishedAt!.getTime()).toBeLessThanOrEqual(link.createdAt.getTime())

    const run = await db.workflowRun.findFirstOrThrow({ where: { workspaceId: ws.id } })
    expect(run).toMatchObject({ status: 'done', stepId: 'done' })
    expect((run.state as any).documentId).toBe(doc.id)

    // Every bot line ran on the workflow allowance, and the integrity checks hold.
    expect((await botItems(roomId)).every((i) => i.message.workflow === 'company-profile')).toBe(true)
    expect(await crossWorkspaceViolations()).toEqual({})
  })
})

describe('the channel is public to members, the setup is the creator’s', () => {
  it('members are welcomed publicly; they see the creator’s setup but cannot answer it', async () => {
    const { ws, roomId } = await workspace()
    const welcome = await lastBot(roomId)
    await join(app, ws.id, carolId, 'carol@test.local')
    await host.idle()
    expect(await db.roomMember.count({ where: { roomId, userId: carolId } })).toBe(1)
    const hello = await lastBot(roomId)
    expect(hello.message).toMatchObject({ text: 'Welcome, Carol.', workflow: 'workspace-welcome' })

    // Carol sees Alice's welcome (transparent) but it isn't hers to answer.
    expect((await call(carolId, 'GET', `/rooms/${roomId}/items`)).json().data.map((i: any) => i.id)).toContain(welcome.id)
    expect((await click(carolId, welcome.id, ['setup'])).json().code).toBe('NOT_YOUR_CHOICE')
    // Her own intro is hers.
    expect((await click(carolId, hello.id, ['intro'])).statusCode).toBe(200)
    expect((await lastBot(roomId)).message.text).toMatch(/^I welcome everyone who joins/)
    // Nobody is welcomed twice, however often the channel is opened.
    for (const who of [testUserId, carolId]) {
      const res = await call(who, 'POST', `/workspaces/${ws.id}/channel`)
      expect(res.statusCode).toBe(200)
      await validateResponse('openWorkspaceChannel', 200, res.json())
      expect(res.json().data.roomId).toBe(roomId)
    }
    await host.idle()
    expect((await botItems(roomId)).filter((i) => i.message.text?.startsWith('Welcome,'))).toHaveLength(2)
  })

  it('guests never see the channel; non-members get 404', async () => {
    const { ws, roomId } = await workspace()
    expect((await call(testOtherUserId, 'GET', `/rooms/${roomId}/items`)).statusCode).toBe(404)
    expect((await call(testOtherUserId, 'POST', `/workspaces/${ws.id}/channel`)).statusCode).toBe(404)
    expect((await call(testOtherUserId, 'GET', `/workspaces/${ws.id}/company-profile`)).statusCode).toBe(404)
  })

  it('another member typing during a text question is ordinary chat, not an answer', async () => {
    const { ws, roomId } = await workspace()
    await join(app, ws.id, carolId, 'carol@test.local')
    await host.idle()
    await click(testUserId, (await botItems(roomId))[0]!.id, ['setup'])
    await say(carolId, roomId, 'Carol Corp')
    const run = await db.workflowRun.findFirstOrThrow({ where: { workspaceId: ws.id } })
    expect(run.stepId).toBe('name')
    expect(await db.workflowAnswer.count({ where: { runId: run.id, stepId: 'name' } })).toBe(0)
  })

  it('a workspace made before the channel existed gets it, and the welcome, on first open', async () => {
    const ws = await createWorkspace(app) // the listener is running, so remove what it made
    await host.idle()
    await db.workflowRun.deleteMany()
    await db.botOnce.deleteMany()
    await db.workspaceChannel.deleteMany()
    const res = await call(testUserId, 'POST', `/workspaces/${ws.id}/channel`)
    await host.idle()
    expect((await lastBot(res.json().data.roomId)).message.text).toMatch(/^Welcome, Alice\./)
  })
})

describe('a workspace workflow\u2019s document belongs to the workspace audience', () => {
  async function described() {
    const { ws, roomId } = await workspace()
    await click(testUserId, (await lastBot(roomId)).id, ['setup'])
    for (const [, value] of INTERVIEW) await answer(roomId, value)
    const link = (await call(testUserId, 'GET', `/items/${(await lastBot(roomId)).id}`)).json().data.message.links[0]
    return { ws, roomId, docId: link.id as string }
  }
  const docUrl = (wsId: string, docId: string) => `/workspaces/${wsId}/documents/${docId}`

  it('every member — including people who join later — can open it; plain members only read', async () => {
    const { ws, docId } = await described()
    await join(app, ws.id, carolId, 'carol@test.local') // joined after it was written
    await host.idle()
    const list = await call(carolId, 'GET', `/workspaces/${ws.id}/documents`)
    expect(list.json().data.map((d: any) => d.id)).toContain(docId)
    const got = await call(carolId, 'GET', docUrl(ws.id, docId))
    expect(got.statusCode).toBe(200)
    await validateResponse('getDocument', 200, got.json())
    expect(got.json().data).toMatchObject({ workspaceAccess: 'viewer', capabilities: { manageAccess: false, editMetadata: false } })
    const content = await call(carolId, 'GET', `${docUrl(ws.id, docId)}/content`)
    expect(content.statusCode).toBe(200)
    expect(JSON.stringify(content.json().data.content)).toContain('Midnight Creative is a team based in Austin')
    expect((await call(carolId, 'PUT', `${docUrl(ws.id, docId)}/content`, { expectedVersion: content.json().data.version, content: [] })).statusCode).toBe(403)
  })

  it('owners/admins can broaden it to editors or narrow it to private; members cannot change it', async () => {
    const { ws, docId } = await described()
    await join(app, ws.id, carolId, 'carol@test.local')
    const access = (who: string, role: string | null) => call(who, 'PUT', `${docUrl(ws.id, docId)}/workspace-access`, { role })
    expect((await access(carolId, 'editor')).statusCode).toBe(403)

    const broadened = await access(testUserId, 'editor')
    expect(broadened.statusCode).toBe(200)
    await validateResponse('setDocumentWorkspaceAccess', 200, broadened.json())
    const version = (await call(carolId, 'GET', `${docUrl(ws.id, docId)}/content`)).json().data.version
    expect((await call(carolId, 'PUT', `${docUrl(ws.id, docId)}/content`, { expectedVersion: version, content: [{ id: 'x', type: 'section', level: 'body', text: 'Carol was here' }] })).statusCode).toBe(200)

    expect((await access(testUserId, null)).statusCode).toBe(200)
    expect((await call(carolId, 'GET', docUrl(ws.id, docId))).statusCode).toBe(404)
    expect((await call(carolId, 'GET', `/workspaces/${ws.id}/documents`)).json().data.map((d: any) => d.id)).not.toContain(docId)
    // A per-member grant still works under a private audience.
    expect((await call(testUserId, 'PUT', `${docUrl(ws.id, docId)}/grants/${await memberId(ws.id, carolId)}`, { role: 'viewer' })).statusCode).toBe(200)
    expect((await call(carolId, 'GET', docUrl(ws.id, docId))).statusCode).toBe(200)
    const audit = await db.actionExecution.findMany({ where: { workspaceId: ws.id, action: 'document.workspaceAccess' }, orderBy: { requestedAt: 'asc' } })
    expect(audit.map((a) => (a.input as any).role)).toEqual(['editor', null])
  })

  it('a document a person creates stays private unless shared', async () => {
    const { ws } = await workspace()
    await join(app, ws.id, carolId, 'carol@test.local')
    const mine = await call(testUserId, 'POST', `/workspaces/${ws.id}/documents`, { title: 'My notes', descriptor: { surface: 'blocks', source: { kind: 'native', schemaVersion: 1 } }, idempotencyKey: 'mine-1' })
    expect(mine.statusCode).toBe(201)
    expect(mine.json().data.workspaceAccess).toBeNull()
    expect((await call(carolId, 'GET', docUrl(ws.id, mine.json().data.id))).statusCode).toBe(404)
  })
})

describe('deterministic steps', () => {
  it('Later pauses; the new offer resumes at the start', async () => {
    const { ws, roomId } = await workspace()
    await click(testUserId, (await lastBot(roomId)).id, ['later'])
    const later = await lastBot(roomId)
    expect(later.message.text).toBe("No problem. Whenever you're ready:")
    expect((await db.workflowRun.findFirstOrThrow({ where: { workspaceId: ws.id } })).status).toBe('paused')
    await click(testUserId, later.id, ['setup'])
    expect((await lastBot(roomId)).message.text).toBe("What's your company called?")
  })

  it('an old question can’t be answered once the run moved on (STEP_CLOSED rolls the click back)', async () => {
    const { roomId } = await workspace()
    const welcome = await lastBot(roomId)
    await click(testUserId, welcome.id, ['later'])
    const offer = await lastBot(roomId)
    await click(testUserId, offer.id, ['setup']) // now on "name"
    // Forge a stale offer for a step the run already passed.
    const stale = await db.item.findUniqueOrThrow({ where: { id: welcome.id } })
    await db.$executeRaw`UPDATE Message SET choice = NULL WHERE id = ${stale.messageId}`
    const res = await click(testUserId, welcome.id, ['setup'])
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('STEP_CLOSED')
    expect((await db.message.findUniqueOrThrow({ where: { id: stale.messageId } })).choice).toBeNull()
  })

  it('text answers: too long is asked again; a voice note gets "please type"; nothing advances', async () => {
    const { ws, roomId } = await workspace()
    await click(testUserId, (await lastBot(roomId)).id, ['setup'])
    await say(testUserId, roomId, 'x'.repeat(201))
    expect((await lastBot(roomId)).message.text).toBe("That's a bit long — can you keep it under 200 characters?")
    const media = await db.media.create({ data: { ownerId: testUserId, kind: 'audio', storageKey: 'note.webm', mimeType: 'audio/webm', size: 1 } })
    expect((await call(testUserId, 'POST', `/rooms/${roomId}/items`, { mediaIds: [media.id], chat: true })).statusCode).toBe(201)
    await host.idle()
    expect((await lastBot(roomId)).message.text).toBe('For now, please type your answer.')
    expect((await db.workflowRun.findFirstOrThrow({ where: { workspaceId: ws.id } })).stepId).toBe('name')
  })

  it('a later run reuses the profile: only the brief is asked again', async () => {
    const { ws, roomId } = await workspace()
    await click(testUserId, (await lastBot(roomId)).id, ['setup'])
    for (const [, value] of INTERVIEW) await answer(roomId, value)
    const run = await startRun({ workspaceId: ws.id, memberId: await memberId(ws.id, testUserId), userId: testUserId, roomId })
    expect(nextStep((run.state as any).draft)?.id).toBe('audience')
  })

  it('a failed generation offers Try again, which finishes the same run', async () => {
    const { ws, roomId } = await workspace()
    await click(testUserId, (await lastBot(roomId)).id, ['setup'])
    for (const [, value] of INTERVIEW.slice(0, -1)) await answer(roomId, value)
    // Corrupt a stored answer so saving the profile fails (an answered field isn't
    // asked again — removing one would just re-ask it).
    const run = await db.workflowRun.findFirstOrThrow({ where: { workspaceId: ws.id } })
    const state = run.state as any
    await db.workflowRun.update({ where: { id: run.id }, data: { state: { ...state, draft: { ...state.draft, brandVoice: 'loud' } } } })
    await click(testUserId, (await lastBot(roomId)).id, ['short'])
    const failed = await lastBot(roomId)
    expect(failed.message.text).toBe("I couldn't create the document just now.")
    expect(await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: 'failed', stepId: 'retry' })
    expect(await db.document.count({ where: { workspaceId: ws.id } })).toBe(0)

    const broken = (await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).state as any
    await db.workflowRun.update({ where: { id: run.id }, data: { state: { ...broken, draft: { ...broken.draft, brandVoice: 'friendly' } } } })
    await click(testUserId, failed.id, ['retry'])
    expect((await lastBot(roomId)).message.text).toMatch(/^I created Midnight Creative/)
    expect((await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('done')
    expect(await db.document.count({ where: { workspaceId: ws.id } })).toBe(1)
  })
})

describe('pieces', () => {
  it('splitList splits on explicit separators only', () => {
    expect(splitList('Web design, AI automation; hosting\nSEO')).toEqual(['Web design', 'AI automation', 'hosting', 'SEO'])
    expect(splitList('Research and development')).toEqual(['Research and development'])
  })

  it('the interview order is fixed and the brief is never pre-filled', () => {
    expect(STEPS.map((s) => s.id)).toEqual(INTERVIEW.map(([id]) => id))
    expect(nextStep({ name: 'x', serviceArea: 'local', location: 'y', purpose: 'z', offerings: ['a'], customers: ['b'], differentiators: ['c'], brandVoice: 'bold' })?.id).toBe('audience')
  })

  it('the template is deterministic and follows length, voice and audience', () => {
    const p = { name: 'Acme', location: 'Boston', serviceArea: 'national' as const, purpose: 'makes widgets', brandVoice: 'bold' as const, offerings: ['Widgets'], customers: ['Businesses'], differentiators: ['handmade'] }
    const short = companyDescription(p, { audience: 'investors', length: 'short' })
    expect(short).toEqual(companyDescription(p, { audience: 'investors', length: 'short' }))
    expect(short.blocks.map((b) => b.text)).toEqual(['Acme', 'Acme, based in Boston, does things its own way and works nationwide. Makes widgets. Acme is building on that focus and growing its reach.'])
    expect(companyDescription(p, { audience: 'general', length: 'detailed' }).blocks).toHaveLength(5)
  })

  it('chatbot’s ordinary chatter stays out of workspace channels', async () => {
    const { roomId } = await workspace()
    const ctx = { roomId, botId: bot.botId, subjects: new Set<string>(), trigger: {} } as any
    expect(await GUARDS.notWorkspaceChannel!(ctx, undefined)).toBe('workspace-channel')
    expect(await GUARDS.notWorkspaceChannel!({ ...ctx, roomId: 'elsewhere' }, undefined)).toBe(true)
  })
})
