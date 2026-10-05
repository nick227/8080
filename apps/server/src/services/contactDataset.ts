import { createHash } from 'crypto'
import { CONTACT_COLUMNS, type ContactsQuery } from '@project/shared'
import type { Prisma } from '@project/db'
import { badRequest } from '../lib/errors'

export function validateContactsQuery(query: ContactsQuery): ContactsQuery {
  if (!query || !Array.isArray(query.columns) || !query.columns.length || query.columns.length > CONTACT_COLUMNS.length || new Set(query.columns).size !== query.columns.length || query.columns.some(c => !CONTACT_COLUMNS.includes(c))) throw badRequest('Choose unique supported contact columns', 'INVALID_DATASET_QUERY')
  const f = query.filters
  const d = f?.date
  if (d && (!['createdAt', 'updatedAt'].includes(d.field) || !Number.isFinite(Date.parse(d.from)) || !Number.isFinite(Date.parse(d.to)) || Date.parse(d.from) >= Date.parse(d.to))) throw badRequest('Date range must be an increasing half-open interval of date-time instants', 'INVALID_DATE_RANGE')
  if (f?.importBatchId !== undefined && (typeof f.importBatchId !== 'string' || !f.importBatchId || f.importBatchId.length > 64)) throw badRequest('Invalid import filter', 'INVALID_DATASET_QUERY')
  if (query.sort && (!['id', 'displayName', 'createdAt', 'updatedAt'].includes(query.sort.field) || !['asc', 'desc'].includes(query.sort.direction))) throw badRequest('Unsupported sort', 'INVALID_DATASET_QUERY')
  return query
}
export function contactsWhere(workspaceId: string, query: ContactsQuery): Prisma.ContactWhereInput {
  validateContactsQuery(query)
  const f = query.filters
  return { workspaceId, deletedAt: null, ...(f?.status ? { status: f.status } : {}), ...(f?.ownerMemberId ? { ownerMemberId: f.ownerMemberId } : {}), ...(f?.importBatchId ? { importBatchId: f.importBatchId } : {}),
    ...(f?.q ? { displayName: { contains: f.q.trim() } } : {}),
    ...(f?.date ? { [f.date.field]: { gte: new Date(f.date.from), lt: new Date(f.date.to) } } : {}) }
}
export const queryHash = (query: ContactsQuery) => createHash('sha256').update(JSON.stringify(query)).digest('hex')
export const contactsDataset = {
  key: 'contacts', version: 1, label: 'Contacts', mode: 'live', rowKey: 'id',
  columns: CONTACT_COLUMNS.map(key => ({ key, label: key, type: key.endsWith('At') ? 'datetime' : 'text', nullable: !['id', 'displayName', 'status', 'createdAt', 'updatedAt'].includes(key), writable: ['firstName', 'lastName', 'displayName', 'title'].includes(key) })),
  dateFields: ['createdAt', 'updatedAt'], sortFields: ['id', 'displayName', 'createdAt', 'updatedAt'],
  refresh: 'on_request', consistency: 'request_snapshot', maxPageSize: 100, maxMaterializedRows: 5000,
  description: 'Current canonical contacts. Date filters select records, not historical as-of values. Refetch after changes; pages are independent reads.',
} as const
