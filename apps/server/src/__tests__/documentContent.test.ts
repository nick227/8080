// Shared block-document content (doc/10 §10 POC): versioned saves that never
// overwrite silently, registry access, and a live stream (updates + presence).
import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { randomUUID } from 'crypto'
import type { AddressInfo } from 'net'
import { buildTestApp, validateResponse } from './helpers'
import { caller, carolId, createWorkspace, daveId, join, seedPeople } from './helpers/workspace'
import { crossWorkspaceViolations } from '../services/workspaceIntegrity'

const app = buildTestApp()
const call = caller(app)
const blocks = (text: string) => [{ id: 'b1', type: 'title', text: 'Campaign brief' }, { id: 'b2', type: 'paragraph', text }]

async function setup() {
  const ws = await createWorkspace(app)
  await seedPeople()
  const carol = await join(app, ws.id, carolId, 'carol@test.local')
  const dave = await join(app, ws.id, daveId, 'dave@test.local')
  const docs = `/workspaces/${ws.id}/documents`
  const doc = (await call(carolId, 'POST', docs, { title: 'Brief', idempotencyKey: randomUUID(), descriptor: { surface: 'blocks', source: { kind: 'native', schemaVersion: 1 } } })).json().data
  return { ws, carol, dave, docs, doc, content: `${docs}/${doc.id}/content` }
}

describe('shared block content', () => {
  it('starts empty, saves versions, and a second reader sees them', async () => {
    const { content, doc, docs, dave } = await setup()
    const empty = await call(carolId, 'GET', content)
    await validateResponse('getDocumentContent', 200, empty.json())
    expect(empty.json().data).toEqual({ version: 0, content: null, updatedAt: null, updatedBy: null })

    const saved = await call(carolId, 'PUT', content, { expectedVersion: 0, content: blocks('Target customers') })
    expect(saved.statusCode).toBe(200)
    await validateResponse('saveDocumentContent', 200, saved.json())
    expect(saved.json().data).toMatchObject({ version: 1, content: blocks('Target customers'), updatedBy: { name: 'Carol' } })

    expect((await call(daveId, 'GET', content)).statusCode).toBe(404) // not shared with Dave yet
    await call(carolId, 'PUT', `${docs}/${doc.id}/grants/${dave}`, { role: 'editor' })
    const second = await call(daveId, 'PUT', content, { expectedVersion: 1, content: blocks('Target customers in Ohio') })
    expect(second.json().data.version).toBe(2)
    expect((await call(carolId, 'GET', content)).json().data.content[1].text).toBe('Target customers in Ohio')
  })

  it('a save based on an old version is a 409 — nothing is overwritten', async () => {
    const { content } = await setup()
    await call(carolId, 'PUT', content, { expectedVersion: 0, content: blocks('one') })
    await call(carolId, 'PUT', content, { expectedVersion: 1, content: blocks('two') })
    const stale = await call(carolId, 'PUT', content, { expectedVersion: 1, content: blocks('stale') })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().code).toBe('DOCUMENT_CONTENT_CONFLICT')
    const firstAgain = await call(carolId, 'PUT', content, { expectedVersion: 0, content: blocks('first again') })
    expect(firstAgain.json().code).toBe('DOCUMENT_CONTENT_CONFLICT')
    expect((await call(carolId, 'GET', content)).json().data).toMatchObject({ version: 2, content: blocks('two') })
  })

  it('viewers read but cannot save; only block documents; content is validated; audit has no text', async () => {
    const { content, docs, doc, dave } = await setup()
    await call(carolId, 'PUT', `${docs}/${doc.id}/grants/${dave}`, { role: 'viewer' })
    expect((await call(daveId, 'GET', content)).statusCode).toBe(200)
    expect((await call(daveId, 'PUT', content, { expectedVersion: 0, content: blocks('x') })).statusCode).toBe(403)

    const map = (await call(carolId, 'POST', docs, { title: 'Map', idempotencyKey: randomUUID(), descriptor: { surface: 'mental_map', source: { kind: 'native', schemaVersion: 1 } } })).json().data
    expect((await call(carolId, 'GET', `${docs}/${map.id}/content`)).json().code).toBe('NOT_SHARED_CONTENT')
    expect((await call(carolId, 'PUT', content, { expectedVersion: 0, content: [{ id: 'a', type: 'paragraph' }, { id: 'a', type: 'paragraph' }] })).json().code).toBe('INVALID_CONTENT')
    expect((await call(carolId, 'PUT', content, { expectedVersion: 0, content: [{ id: 'a', type: 'chart' }] })).statusCode).toBe(400)
    expect((await call(carolId, 'PUT', content, { expectedVersion: 0, content: [{ id: 'a', type: 'section', level: 'poster' }] })).statusCode).toBe(400)

    const letter = [
      { id: 'b1', type: 'section', level: 'h1', text: 'secret plan' },
      { id: 'b2', type: 'section', level: 'body', text: 'A paragraph', mediaName: 'photo.png', mediaKind: 'image' },
    ]
    await call(carolId, 'PUT', content, { expectedVersion: 0, content: letter })
    expect((await call(carolId, 'GET', content)).json().data.content).toEqual(letter)
    const audit = await db.actionExecution.findFirstOrThrow({ where: { action: 'document.content.save', status: 'succeeded' } })
    expect(JSON.stringify(audit.input)).not.toContain('secret plan')
    expect(audit.input).toMatchObject({ expectedVersion: 0, blocks: 2 })
    expect(await crossWorkspaceViolations()).toEqual({})
  })

  it('the stream shows who has it open and pushes a save at once', async () => {
    const { content, docs, doc, dave } = await setup()
    await call(carolId, 'PUT', `${docs}/${doc.id}/grants/${dave}`, { role: 'editor' })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as AddressInfo
    const abort = new AbortController()
    const res = await fetch(`http://127.0.0.1:${port}${docs}/${doc.id}/stream`, { headers: { Authorization: `Bearer ${daveId}` }, signal: abort.signal })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const until = async (pattern: RegExp, ms = 3000) => {
      const stop = Date.now() + ms
      while (!pattern.test(text) && Date.now() < stop) {
        const chunk = await Promise.race([reader.read(), new Promise<{ value?: undefined }>((r) => setTimeout(() => r({}), 200))])
        if (chunk.value) text += decoder.decode(chunk.value)
      }
      return pattern.test(text)
    }
    expect(await until(/event: document.presence\ndata: .*"name":"Dave"/)).toBe(true) // Dave sees himself connected

    const started = Date.now()
    await call(carolId, 'PUT', content, { expectedVersion: 0, content: blocks('live') })
    expect(await until(/event: document.updated\ndata: \{"type":"document.updated","version":1,"memberId":"[^"]+","name":"Carol"\}/)).toBe(true)
    expect(Date.now() - started).toBeLessThan(1000)
    abort.abort()
  })
})
