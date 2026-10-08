// Contacts, accounts, tags, notes and record links (doc/09 slice 1).
import { AccountService } from '../services/AccountService'
import { ContactService } from '../services/ContactService'
import { LinkService } from '../services/LinkService'
import { NoteService } from '../services/NoteService'
import { TagService } from '../services/TagService'
import { workspaceCtx as ctx } from '../lib/session'

const contacts = new ContactService()
const accounts = new AccountService()
const tags = new TagService()
const notes = new NoteService()
const links = new LinkService()


// ─── contacts ────────────────────────────────────────────────────────────────

export async function listContacts(request: any, reply: any) {
  return reply.send(await contacts.list(request.user.id, request.params.workspaceId, request.query))
}

export async function countContacts(request: any, reply: any) {
  return reply.send(await contacts.counts(request.user.id, request.params.workspaceId))
}

export async function bulkUpdateContacts(request: any, reply: any) {
  return reply.send(await contacts.bulk(request.user.id, request.params.workspaceId, request.body))
}

export async function createContact(request: any, reply: any) {
  return reply.status(201).send(await contacts.create(ctx(request), request.params.workspaceId, request.body))
}

export async function matchContact(request: any, reply: any) {
  return reply.send({ data: await contacts.match(request.user.id, request.params.workspaceId, request.query.email) })
}

export async function getContact(request: any, reply: any) {
  return reply.send({ data: await contacts.get(request.user.id, request.params.workspaceId, request.params.contactId) })
}

export async function updateContact(request: any, reply: any) {
  const { workspaceId, contactId } = request.params
  return reply.send({ data: await contacts.update(ctx(request), workspaceId, contactId, request.body) })
}

export async function deleteContact(request: any, reply: any) {
  await contacts.remove(ctx(request), request.params.workspaceId, request.params.contactId)
  return reply.send({ data: null })
}

export async function listContactDuplicates(request: any, reply: any) {
  return reply.send({ data: await contacts.duplicates(request.user.id, request.params.workspaceId, request.params.contactId) })
}

export async function mergeContacts(request: any, reply: any) {
  const { workspaceId, contactId } = request.params
  return reply.send({ data: await contacts.merge(ctx(request), workspaceId, contactId, request.body.mergeContactId) })
}

export async function getContactTimeline(request: any, reply: any) {
  return reply.send(await contacts.timeline(request.user.id, request.params.workspaceId, request.params.contactId, request.query))
}

export async function setContactAccount(request: any, reply: any) {
  const { workspaceId, contactId, accountId } = request.params
  return reply.send({ data: await contacts.setAccount(ctx(request), workspaceId, contactId, accountId, request.body ?? {}) })
}

export async function removeContactAccount(request: any, reply: any) {
  const { workspaceId, contactId, accountId } = request.params
  return reply.send({ data: await contacts.removeAccount(ctx(request), workspaceId, contactId, accountId) })
}

// ─── accounts ────────────────────────────────────────────────────────────────

export async function listAccounts(request: any, reply: any) {
  return reply.send(await accounts.list(request.user.id, request.params.workspaceId, request.query))
}

export async function createAccount(request: any, reply: any) {
  return reply.status(201).send(await accounts.create(ctx(request), request.params.workspaceId, request.body))
}

export async function getAccount(request: any, reply: any) {
  return reply.send({ data: await accounts.get(request.user.id, request.params.workspaceId, request.params.accountId) })
}

export async function updateAccount(request: any, reply: any) {
  const { workspaceId, accountId } = request.params
  return reply.send({ data: await accounts.update(ctx(request), workspaceId, accountId, request.body) })
}

export async function deleteAccount(request: any, reply: any) {
  await accounts.remove(ctx(request), request.params.workspaceId, request.params.accountId)
  return reply.send({ data: null })
}

export async function getAccountTimeline(request: any, reply: any) {
  return reply.send(await accounts.timeline(request.user.id, request.params.workspaceId, request.params.accountId, request.query))
}

// ─── tags ────────────────────────────────────────────────────────────────────

export async function listTags(request: any, reply: any) {
  return reply.send({ data: await tags.list(request.user.id, request.params.workspaceId) })
}

export async function createTag(request: any, reply: any) {
  return reply.status(201).send({ data: await tags.create(ctx(request), request.params.workspaceId, request.body) })
}

export async function updateTag(request: any, reply: any) {
  const { workspaceId, tagId } = request.params
  return reply.send({ data: await tags.update(ctx(request), workspaceId, tagId, request.body) })
}

export async function deleteTag(request: any, reply: any) {
  await tags.remove(ctx(request), request.params.workspaceId, request.params.tagId)
  return reply.send({ data: null })
}

// ─── notes ───────────────────────────────────────────────────────────────────

export async function listNotes(request: any, reply: any) {
  return reply.send(await notes.list(request.user.id, request.params.workspaceId, request.query))
}

export async function createNote(request: any, reply: any) {
  return reply.status(201).send({ data: await notes.create(ctx(request), request.params.workspaceId, request.body) })
}

export async function getNote(request: any, reply: any) {
  return reply.send({ data: await notes.get(request.user.id, request.params.workspaceId, request.params.noteId) })
}

export async function updateNote(request: any, reply: any) {
  const { workspaceId, noteId } = request.params
  return reply.send({ data: await notes.update(ctx(request), workspaceId, noteId, request.body) })
}

export async function deleteNote(request: any, reply: any) {
  await notes.remove(ctx(request), request.params.workspaceId, request.params.noteId)
  return reply.send({ data: null })
}

export async function shareNote(request: any, reply: any) {
  const { workspaceId, noteId } = request.params
  return reply.status(201).send({ data: await notes.share(ctx(request), workspaceId, noteId, request.body.roomIds) })
}

// ─── record links ────────────────────────────────────────────────────────────

export async function listRecordLinks(request: any, reply: any) {
  return reply.send({ data: await links.list(request.user.id, request.params.workspaceId, request.query) })
}

export async function createRecordLink(request: any, reply: any) {
  return reply.status(201).send({ data: await links.create(ctx(request), request.params.workspaceId, request.body) })
}

export async function deleteRecordLink(request: any, reply: any) {
  await links.remove(ctx(request), request.params.workspaceId, request.params.linkId)
  return reply.send({ data: null })
}

export async function listRoomLinks(request: any, reply: any) {
  return reply.send({ data: await links.forRoom(request.user.id, request.params.roomId) })
}

export async function listContactFields(request: any, reply: any) {
  return reply.send(await contacts.fields(request.user.id, request.params.workspaceId))
}
