// Record gallery (contact + inventory images) — transactional invariants.
import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, validateResponse, testUserId, asAuth, multipart, fileBytes } from './helpers'
import { caller, createWorkspace } from './helpers/workspace'
import { RecordImageService, MAX_RECORD_IMAGES } from '../services/RecordImageService'
import { playbackUrl } from '../lib/serialize'

const app = buildTestApp()
const call = caller(app)
const gallery = new RecordImageService()

async function setup() {
  const ws = await createWorkspace(app)
  return { ws, base: `/workspaces/${ws.id}` }
}

function uploadImage(base: string, path: string) {
  const form = multipart([{ name: 'file', value: fileBytes('image/png', 'shot'), filename: 'shot', type: 'image/png' }])
  return app.inject({
    method: 'POST',
    url: `${base}${path}`,
    headers: { ...asAuth(testUserId), ...form.headers },
    payload: form.payload,
  })
}

describe('record gallery', () => {
  it('uploads, lists, sets primary, reorders, and projects onto inventory.imageUrl', async () => {
    const { base } = await setup()
    const item = (await call(testUserId, 'POST', `${base}/inventory`, { name: 'Lamp', quantity: 3 })).json().data

    const first = await uploadImage(base, `/inventory/${item.id}/images`)
    expect(first.statusCode).toBe(201)
    await validateResponse('uploadInventoryImage', 201, first.json())
    expect(first.json().data).toMatchObject({ sortOrder: 0, isPrimary: true })

    const second = await uploadImage(base, `/inventory/${item.id}/images`)
    expect(second.statusCode).toBe(201)
    expect(second.json().data.isPrimary).toBe(false)

    const listed = await call(testUserId, 'GET', `${base}/inventory/${item.id}/images`)
    await validateResponse('listInventoryImages', 200, listed.json())
    expect(listed.json().data).toHaveLength(2)

    const parent = (await call(testUserId, 'GET', `${base}/inventory/${item.id}`)).json().data
    expect(parent.imageUrl).toBe(playbackUrl(first.json().data.mediaId))

    const setPrimary = await call(testUserId, 'PATCH', `${base}/inventory/${item.id}/images/${second.json().data.id}/primary`)
    expect(setPrimary.statusCode).toBe(200)
    expect(setPrimary.json().data.find((row: { id: string }) => row.id === second.json().data.id).isPrimary).toBe(true)
    expect((await call(testUserId, 'GET', `${base}/inventory/${item.id}`)).json().data.imageUrl).toBe(
      playbackUrl(second.json().data.mediaId),
    )

    const order = await call(testUserId, 'PATCH', `${base}/inventory/${item.id}/images/order`, {
      imageIds: [second.json().data.id, first.json().data.id],
    })
    expect(order.statusCode).toBe(200)
    expect(order.json().data.map((row: { id: string }) => row.id)).toEqual([second.json().data.id, first.json().data.id])
  })

  it('deleting primary promotes next; deleting last clears parent imageUrl', async () => {
    const { base } = await setup()
    const item = (await call(testUserId, 'POST', `${base}/inventory`, { name: 'Chair' })).json().data
    const a = (await uploadImage(base, `/inventory/${item.id}/images`)).json().data
    const b = (await uploadImage(base, `/inventory/${item.id}/images`)).json().data

    expect((await call(testUserId, 'DELETE', `${base}/inventory/${item.id}/images/${a.id}`)).statusCode).toBe(200)
    const after = (await call(testUserId, 'GET', `${base}/inventory/${item.id}/images`)).json().data
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: b.id, isPrimary: true, sortOrder: 0 })
    expect((await call(testUserId, 'GET', `${base}/inventory/${item.id}`)).json().data.imageUrl).toBe(playbackUrl(b.mediaId))

    expect((await call(testUserId, 'DELETE', `${base}/inventory/${item.id}/images/${b.id}`)).statusCode).toBe(200)
    expect((await call(testUserId, 'GET', `${base}/inventory/${item.id}/images`)).json().data).toEqual([])
    expect((await call(testUserId, 'GET', `${base}/inventory/${item.id}`)).json().data.imageUrl).toBeNull()
  })

  it('rejects reorder with omitted, foreign, or duplicate ids atomically', async () => {
    const { base } = await setup()
    const item = (await call(testUserId, 'POST', `${base}/inventory`, { name: 'Desk' })).json().data
    const a = (await uploadImage(base, `/inventory/${item.id}/images`)).json().data
    const b = (await uploadImage(base, `/inventory/${item.id}/images`)).json().data

    expect((await call(testUserId, 'PATCH', `${base}/inventory/${item.id}/images/order`, { imageIds: [a.id] })).statusCode).toBe(400)
    expect(
      (await call(testUserId, 'PATCH', `${base}/inventory/${item.id}/images/order`, { imageIds: [a.id, b.id, b.id] })).statusCode,
    ).toBe(400)
    expect(
      (await call(testUserId, 'PATCH', `${base}/inventory/${item.id}/images/order`, { imageIds: [a.id, 'missing'] })).statusCode,
    ).toBe(400)

    const listed = (await call(testUserId, 'GET', `${base}/inventory/${item.id}/images`)).json().data
    expect(listed.map((row: { id: string; sortOrder: number }) => [row.id, row.sortOrder])).toEqual([
      [a.id, 0],
      [b.id, 1],
    ])
  })

  it('cannot attach a thirteenth image under concurrent uploads at the cap', async () => {
    const { base, ws } = await setup()
    const item = (await call(testUserId, 'POST', `${base}/inventory`, { name: 'Capped' })).json().data
    for (let i = 0; i < MAX_RECORD_IMAGES - 1; i++) {
      expect((await uploadImage(base, `/inventory/${item.id}/images`)).statusCode).toBe(201)
    }
    const [one, two] = await Promise.all([
      uploadImage(base, `/inventory/${item.id}/images`),
      uploadImage(base, `/inventory/${item.id}/images`),
    ])
    const statuses = [one.statusCode, two.statusCode].sort()
    expect(statuses).toEqual([201, 409])
    const count = await db.recordImage.count({
      where: { workspaceId: ws.id, subjectType: 'inventory', subjectId: item.id },
    })
    expect(count).toBe(MAX_RECORD_IMAGES)
  })

  it('works for contacts and migrates legacy inventory playback URLs idempotently', async () => {
    const { base, ws } = await setup()
    const contact = (await call(testUserId, 'POST', `${base}/contacts`, { displayName: 'Ada' })).json().data
    const uploaded = await uploadImage(base, `/contacts/${contact.id}/images`)
    expect(uploaded.statusCode).toBe(201)
    await validateResponse('uploadContactImage', 201, uploaded.json())
    expect((await call(testUserId, 'GET', `${base}/contacts/${contact.id}`)).json().data.imageUrl).toBe(
      playbackUrl(uploaded.json().data.mediaId),
    )

    const mediaId = uploaded.json().data.mediaId
    const legacy = await db.inventory.create({
      data: {
        workspaceId: ws.id,
        name: 'Legacy',
        imageUrl: playbackUrl(mediaId),
      },
    })
    const first = await gallery.migrateLegacyInventory(ws.id)
    expect(first.created).toBe(1)
    const second = await gallery.migrateLegacyInventory(ws.id)
    expect(second.created).toBe(0)
    const rows = await db.recordImage.findMany({
      where: { workspaceId: ws.id, subjectType: 'inventory', subjectId: legacy.id },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ mediaId, isPrimary: true, sortOrder: 0 })
  })
})
