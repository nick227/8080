import { db, Prisma } from '@project/db'
import { CONTACT_FIELD_DEFAULTS, type RecipientConfig } from '@project/shared'
import { badRequest } from '../lib/errors'

const fail = () => { throw badRequest('Invalid audience rules', 'INVALID_AUDIENCE') }
export function parseAudience(value: unknown): RecipientConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const c = value as RecipientConfig
  if (!['WORKSPACE_MEMBERS', 'CONTACTS', 'SELECTED_CONTACTS', 'TRIGGER_CONTACT'].includes(c.source)) return fail()
  if (Object.keys(c).some(k => !['source', 'filters', 'ids'].includes(k))) return fail()
  if (c.ids !== undefined && (c.source !== 'SELECTED_CONTACTS' || !Array.isArray(c.ids) || c.ids.length > 1000 || c.ids.some(id => typeof id !== 'string' || !id || id.length > 64))) return fail()
  if (c.source === 'SELECTED_CONTACTS' && !c.ids?.length) return fail()
  if (c.filters !== undefined) {
    if (c.source !== 'CONTACTS' || !c.filters || typeof c.filters !== 'object' || Array.isArray(c.filters)) return fail()
    for (const [k, v] of Object.entries(c.filters)) {
      if (['stages', 'categories', 'tags', 'assignedTo', 'location'].includes(k)) {
        if (!Array.isArray(v) || !v.length || v.length > 100 || v.some(x => typeof x !== 'string' || !x.trim() || x.length > 160)) return fail()
      } else if (k === 'hasEmail') { if (typeof v !== 'boolean') return fail() }
      else if (k === 'attributes') {
        if (!Array.isArray(v) || !v.length || v.length > 30) return fail()
        for (const a of v as NonNullable<NonNullable<RecipientConfig['filters']>['attributes']>) if (!a || typeof a.field !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(a.field) || !['eq', 'gte', 'lte', 'before_days'].includes(a.op) || !['string', 'number', 'boolean'].includes(typeof a.value) || Object.keys(a).some(k => !['field', 'op', 'value'].includes(k))) return fail()
      } else return fail()
    }
  }
  return c
}

/** One query compiler shared by Contacts, audience preview and execution. */
export async function contactAudienceWhere(workspaceId: string, input: unknown, now = new Date(), triggerContactId?: string): Promise<Prisma.ContactWhereInput> {
  const c = parseAudience(input)
  const AND: Prisma.ContactWhereInput[] = []
  const where: Prisma.ContactWhereInput = { workspaceId, status: 'active', deletedAt: null, mergedIntoId: null, AND }
  if (c.source === 'SELECTED_CONTACTS') AND.push({ id: { in: [...new Set(c.ids)] } })
  else if (c.source === 'TRIGGER_CONTACT') AND.push({ id: triggerContactId ?? '__no_trigger__' })
  else if (c.source !== 'CONTACTS') return fail()
  const f = c.filters ?? {}
  if (f.stages) AND.push({ leadStatus: { in: f.stages } })
  if (f.assignedTo) AND.push({ ownerMemberId: { in: f.assignedTo } })
  if (f.tags) AND.push({ tags: { some: { workspaceId, tag: { name: { in: f.tags } } } } })
  if (f.categories) AND.push({ tags: { some: { workspaceId, tag: { name: { in: f.categories } } } } })
  for (const [key, values] of [['location', f.location]] as const) if (values) AND.push({ OR: values.map(value => ({ fieldValues: { path: `$.${key}`, equals: value } })) })
  if (f.hasEmail !== undefined) AND.push(f.hasEmail ? { primaryEmail: { not: null }, NOT: { primaryEmail: '' } } : { OR: [{ primaryEmail: null }, { primaryEmail: '' }] })
  const definitions = await db.contactFieldDefinition.findMany({ where: { workspaceId } })
  const fields = new Map<string, { type: string; archived: boolean }>(CONTACT_FIELD_DEFAULTS.map(f => [f.key, f]))
  for (const f of definitions) fields.set(f.key, { type: f.type, archived: f.archived })
  const core: Record<string, string> = { name: 'displayName', email: 'primaryEmail', createdAt: 'date', lastActivityAt: 'date' }
  for (const a of f.attributes ?? []) {
    const def = fields.get(a.field)
    const coreField = Object.hasOwn(core, a.field)
    const type = coreField && core[a.field] === 'date' ? 'date' : coreField ? 'text' : def?.type
    if (!type || def?.archived) return fail()
    const builtin = coreField || CONTACT_FIELD_DEFAULTS.some(f => f.key === a.field && !['category', 'location'].includes(f.key))
    const column = a.field === 'name' ? 'displayName' : a.field === 'email' ? 'primaryEmail' : a.field
    if (a.op === 'before_days') {
      if (type !== 'date' || typeof a.value !== 'number' || !Number.isFinite(a.value) || a.value < 0 || a.value > 36500) return fail()
      const cutoff = new Date(now.getTime() - a.value * 86400000)
      AND.push(builtin ? { OR: [{ [column]: null }, { [column]: { lt: cutoff } }] } : { OR: [{ fieldValues: { path: `$.${column}`, equals: Prisma.AnyNull } }, { fieldValues: { path: `$.${column}`, lt: cutoff.toISOString().slice(0, 10) } }] })
      continue
    }
    if (a.op !== 'eq' && !['number', 'date'].includes(type)) return fail()
    if (type === 'number' && (typeof a.value !== 'number' || !Number.isFinite(a.value))) return fail()
    if (type === 'checkbox' && typeof a.value !== 'boolean') return fail()
    if (['text', 'select', 'date'].includes(type) && typeof a.value !== 'string') return fail()
    if (type === 'date' && !Number.isFinite(Date.parse(String(a.value)))) return fail()
    const value = type === 'date' && builtin ? new Date(String(a.value)) : a.value
    AND.push((builtin ? { [column]: { [a.op === 'eq' ? 'equals' : a.op]: value } } : { fieldValues: { path: `$.${column}`, [a.op === 'eq' ? 'equals' : a.op]: value } }) as Prisma.ContactWhereInput)
  }
  return where
}
export async function audienceContacts(workspaceId: string, config: unknown, now = new Date(), triggerContactId?: string) {
  return db.contact.findMany({ where: await contactAudienceWhere(workspaceId, config, now, triggerContactId), orderBy: { id: 'asc' } })
}
export function uniqueEmailCount(contacts: { id: string; primaryEmail: string | null }[]) {
  return new Set(contacts.map(c => c.primaryEmail?.trim().toLowerCase() || `missing:${c.id}`)).size
}
