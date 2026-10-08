// Record galleries (contact + inventory + company images).
import { MediaService, type StoredFile } from '../services/MediaService'
import { RecordImageService, type GallerySubject } from '../services/RecordImageService'
import { badRequest } from '../lib/errors'
import { authorize } from '../services/workspacePolicy'

const gallery = new RecordImageService()
const mediaService = new MediaService()

async function uploadParts(request: any): Promise<StoredFile> {
  let stored: StoredFile | undefined
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname === 'file' && !stored) stored = await mediaService.store(part)
        else part.file.resume()
      }
    }
    if (!stored) throw badRequest('Missing "file" field', 'MISSING_FILE')
    return stored
  } catch (err) {
    if (stored) await mediaService.discard(stored)
    throw err
  }
}

function subjectFromContact(request: any): { workspaceId: string; subjectType: GallerySubject; subjectId: string } {
  return { workspaceId: request.params.workspaceId, subjectType: 'contact', subjectId: request.params.contactId }
}

function subjectFromInventory(request: any): { workspaceId: string; subjectType: GallerySubject; subjectId: string } {
  return { workspaceId: request.params.workspaceId, subjectType: 'inventory', subjectId: request.params.inventoryId }
}

function subjectFromCompany(request: any): { workspaceId: string; subjectType: GallerySubject; subjectId: string } {
  const workspaceId = request.params.workspaceId as string
  return { workspaceId, subjectType: 'company', subjectId: workspaceId }
}

export async function listContactImages(request: any, reply: any) {
  const s = subjectFromContact(request)
  return reply.send(await gallery.list(request.user.id, s.workspaceId, s.subjectType, s.subjectId))
}

export async function uploadContactImage(request: any, reply: any) {
  const s = subjectFromContact(request)
  // Who may add images is decided before the upload is read or stored: outsiders get
  // 404 (not a parser error), and nothing of theirs touches storage.
  await authorize(request.user.id, s.workspaceId, 'record.write')
  const stored = await uploadParts(request)
  try {
    return reply.status(201).send({ data: await gallery.attach(request.user.id, s.workspaceId, s.subjectType, s.subjectId, stored) })
  } catch (err) {
    await mediaService.discard(stored).catch(() => undefined)
    throw err
  }
}

export async function reorderContactImages(request: any, reply: any) {
  const s = subjectFromContact(request)
  return reply.send(await gallery.reorder(request.user.id, s.workspaceId, s.subjectType, s.subjectId, request.body.imageIds))
}

export async function setContactImagePrimary(request: any, reply: any) {
  const s = subjectFromContact(request)
  return reply.send(await gallery.setPrimary(request.user.id, s.workspaceId, s.subjectType, s.subjectId, request.params.imageId))
}

export async function deleteContactImage(request: any, reply: any) {
  const s = subjectFromContact(request)
  await gallery.remove(request.user.id, s.workspaceId, s.subjectType, s.subjectId, request.params.imageId)
  return reply.send({ data: null })
}

export async function listInventoryImages(request: any, reply: any) {
  const s = subjectFromInventory(request)
  return reply.send(await gallery.list(request.user.id, s.workspaceId, s.subjectType, s.subjectId))
}

export async function uploadInventoryImage(request: any, reply: any) {
  const s = subjectFromInventory(request)
  // Who may add images is decided before the upload is read or stored: outsiders get
  // 404 (not a parser error), and nothing of theirs touches storage.
  await authorize(request.user.id, s.workspaceId, 'record.write')
  const stored = await uploadParts(request)
  try {
    return reply.status(201).send({ data: await gallery.attach(request.user.id, s.workspaceId, s.subjectType, s.subjectId, stored) })
  } catch (err) {
    await mediaService.discard(stored).catch(() => undefined)
    throw err
  }
}

export async function reorderInventoryImages(request: any, reply: any) {
  const s = subjectFromInventory(request)
  return reply.send(await gallery.reorder(request.user.id, s.workspaceId, s.subjectType, s.subjectId, request.body.imageIds))
}

export async function setInventoryImagePrimary(request: any, reply: any) {
  const s = subjectFromInventory(request)
  return reply.send(await gallery.setPrimary(request.user.id, s.workspaceId, s.subjectType, s.subjectId, request.params.imageId))
}

export async function deleteInventoryImage(request: any, reply: any) {
  const s = subjectFromInventory(request)
  await gallery.remove(request.user.id, s.workspaceId, s.subjectType, s.subjectId, request.params.imageId)
  return reply.send({ data: null })
}

export async function listCompanyImages(request: any, reply: any) {
  const s = subjectFromCompany(request)
  return reply.send(await gallery.list(request.user.id, s.workspaceId, s.subjectType, s.subjectId))
}

export async function uploadCompanyImage(request: any, reply: any) {
  const s = subjectFromCompany(request)
  await authorize(request.user.id, s.workspaceId, 'companyProfile.edit')
  const stored = await uploadParts(request)
  try {
    return reply.status(201).send({ data: await gallery.attach(request.user.id, s.workspaceId, s.subjectType, s.subjectId, stored) })
  } catch (err) {
    await mediaService.discard(stored).catch(() => undefined)
    throw err
  }
}

export async function reorderCompanyImages(request: any, reply: any) {
  const s = subjectFromCompany(request)
  return reply.send(await gallery.reorder(request.user.id, s.workspaceId, s.subjectType, s.subjectId, request.body.imageIds))
}

export async function setCompanyImagePrimary(request: any, reply: any) {
  const s = subjectFromCompany(request)
  return reply.send(await gallery.setPrimary(request.user.id, s.workspaceId, s.subjectType, s.subjectId, request.params.imageId))
}

export async function deleteCompanyImage(request: any, reply: any) {
  const s = subjectFromCompany(request)
  await gallery.remove(request.user.id, s.workspaceId, s.subjectType, s.subjectId, request.params.imageId)
  return reply.send({ data: null })
}
