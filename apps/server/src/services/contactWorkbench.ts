import { audienceContacts } from './contactAudience'
import { db, Prisma, type RecordStatus } from '@project/db'
import { CONTACT_FIELD_DEFAULTS, CONTACT_FOCUSES, CONTACT_SORTS, type ContactFieldDefinition, type ContactSort } from '@project/shared'
import { badRequest } from '../lib/errors'
import { decodeKeyCursor, encodeKeyCursor, normalizeLimit, page } from '../lib/pagination'
import { contactInclude, toContact } from '../lib/serialize'
import { localDayBounds } from '../lib/workspaceDay'
import { createHash } from 'crypto'
import { ensurePipelineStages } from './PipelineService'

export type WorkbenchQuery = {
  audience?: string
  q?: string; status?: RecordStatus; leadStatus?: string; ownerMemberId?: string; tagId?: string; accountId?: string
  focus?: typeof CONTACT_FOCUSES[number]; sort?: ContactSort; dir?: 'asc' | 'desc'
  thenSort?: ContactSort; thenDir?: 'asc' | 'desc'
  milestone?: 'contacted' | 'qualified' | 'proposalSent' | 'won'; checked?: boolean
  cursor?: string; limit?: number
}

// Only constant, allowlisted SQL expressions may be interpolated as identifiers.
const expressions: Record<ContactSort, string> = {
  name: 'c.displayName',
  company: "(SELECT a.name FROM ContactAccount ca JOIN Account a ON a.id = ca.accountId WHERE ca.contactId = c.id AND ca.endedAt IS NULL AND a.deletedAt IS NULL ORDER BY ca.isPrimary DESC, a.name ASC, ca.id ASC LIMIT 1)",
  owner: '(SELECT COALESCE(p.displayName, u.email) FROM WorkspaceMember m JOIN User u ON u.id = m.userId LEFT JOIN Profile p ON p.userId = u.id WHERE m.id = c.ownerMemberId)',
  stage: 'c.leadStatus',
  followUp: 'c.nextFollowUp', lastContacted: 'c.lastContactedAt', interestedIn: 'c.interestedIn',
  contacted: 'c.contacted', qualified: 'c.qualified', proposalSent: 'c.proposalSent', won: 'c.won',
  potentialValue: 'c.potentialValue', priority: "FIELD(c.priority, 'low', 'normal', 'high')",
  updated: 'c.updatedAt', activity: 'c.lastActivityAt',
}
const sql = Prisma.sql
const and = (parts: Prisma.Sql[]) => Prisma.join(parts, ' AND ')
const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`

export async function listWorkbench(workspaceId: string, timezone: string, opts: WorkbenchQuery) {
  const sort = opts.sort ?? 'name'
  const dir = opts.dir === 'desc' ? 'desc' : 'asc'
  if (!CONTACT_SORTS.includes(sort) || (opts.thenSort && !CONTACT_SORTS.includes(opts.thenSort))) throw badRequest('Unknown sort', 'INVALID_SORT')
  if (opts.focus && !CONTACT_FOCUSES.includes(opts.focus)) throw badRequest('Unknown contact focus', 'INVALID_FOCUS')
  if (opts.milestone && !['contacted', 'qualified', 'proposalSent', 'won'].includes(opts.milestone)) throw badRequest('Unknown milestone')
  await ensurePipelineStages(db, workspaceId)
  const stageKeys = (await db.pipelineStage.findMany({
    where: { workspaceId },
    orderBy: [{ position: 'asc' }, { key: 'asc' }],
    select: { key: true, kind: true },
  }))
  if (opts.leadStatus && !stageKeys.some(s => s.key === opts.leadStatus)) throw badRequest('Unknown pipeline stage', 'INVALID_STAGE')
  if (sort === 'stage' || opts.thenSort === 'stage') {
    const ordered = stageKeys.map((s) => s.key).filter((k) => /^[a-z0-9_-]+$/i.test(k))
    expressions.stage = ordered.length
      ? `FIELD(c.leadStatus, ${ordered.map((k) => `'${k.replace(/'/g, '')}'`).join(', ')})`
      : 'c.leadStatus'
  }
  const { start, end } = localDayBounds(timezone)
  const filters = [sql`c.workspaceId = ${workspaceId}`, sql`c.deletedAt IS NULL`, sql`c.status = ${opts.status ?? 'active'}`]
  if (opts.leadStatus) filters.push(sql`c.leadStatus = ${opts.leadStatus}`)
  if (opts.ownerMemberId) filters.push(sql`c.ownerMemberId = ${opts.ownerMemberId}`)
  if (opts.tagId) filters.push(sql`EXISTS (SELECT 1 FROM ContactTag ct WHERE ct.contactId = c.id AND ct.tagId = ${opts.tagId})`)
  if (opts.accountId) filters.push(sql`EXISTS (SELECT 1 FROM ContactAccount ca WHERE ca.contactId = c.id AND ca.accountId = ${opts.accountId} AND ca.endedAt IS NULL)`)
  if (opts.milestone) filters.push(sql`${Prisma.raw(expressions[opts.milestone])} = ${opts.checked === true}`)
  if (opts.focus === 'unassigned') filters.push(sql`c.ownerMemberId IS NULL`)
  if (opts.focus === 'neverContacted') filters.push(sql`c.lastContactedAt IS NULL AND c.contacted = false`)
  if (opts.focus === 'waitingOnUs') filters.push(sql`c.waitingOn = 'us'`)
  if (opts.focus === 'needsProposal') filters.push(sql`c.qualified = true AND c.proposalSent = false AND c.won = false`)
  if (opts.focus === 'due' || opts.focus === 'overdue') {
    filters.push(sql`c.won = false AND EXISTS (SELECT 1 FROM PipelineStage ps WHERE ps.workspaceId = ${workspaceId} AND ps.key = c.leadStatus AND ps.archived = false AND ps.kind = 'open')`)
    filters.push(opts.focus === 'due' ? sql`c.nextFollowUp >= ${start} AND c.nextFollowUp < ${end}` : sql`c.nextFollowUp < ${start}`)
  }
  if (opts.q?.trim()) {
    const term = like(opts.q.trim())
    filters.push(sql`(c.displayName LIKE ${term} OR c.interestedIn LIKE ${term}
      OR EXISTS (SELECT 1 FROM ContactPoint cp WHERE cp.contactId = c.id AND (cp.value LIKE ${term} OR cp.normalized LIKE ${term}))
      OR EXISTS (SELECT 1 FROM ContactAccount ca JOIN Account a ON a.id = ca.accountId WHERE ca.contactId = c.id AND ca.endedAt IS NULL AND a.deletedAt IS NULL AND a.name LIKE ${term})
      OR EXISTS (SELECT 1 FROM Interest i JOIN Inventory inv ON inv.id = i.inventoryId WHERE i.contactId = c.id AND inv.name LIKE ${term}))`)
  }
  if (opts.audience) {
    let config: unknown
    try { config = JSON.parse(opts.audience) } catch { throw badRequest('Invalid audience') }
    const ids = (await audienceContacts(workspaceId, config)).map(c => c.id)
    filters.push(ids.length ? sql`c.id IN (${Prisma.join(ids)})` : sql`1 = 0`)
  }
  const baseWhere = and(filters)
  const keys: { expr: Prisma.Sql; dir: 'asc' | 'desc'; date?: boolean }[] = []
  const addSort = (key: ContactSort, direction: 'asc' | 'desc') => {
    const expr = Prisma.raw(expressions[key])
    // Unset dates/values last, except never-contacted first for oldest outreach.
    keys.push({ expr: sql`(${expr} IS NULL)`, dir: key === 'lastContacted' && direction === 'asc' ? 'desc' : 'asc' })
    keys.push({ expr, dir: direction, date: ['followUp', 'lastContacted', 'activity', 'updated'].includes(key) })
  }
  addSort(sort, dir)
  if (opts.thenSort && opts.thenSort !== sort) addSort(opts.thenSort, opts.thenDir === 'desc' ? 'desc' : 'asc')
  if (sort !== 'name' && opts.thenSort !== 'name') keys.push({ expr: sql`c.displayName`, dir: 'asc' })
  keys.push({ expr: sql`c.id`, dir: 'asc' })
  const { cursor: ignored, limit: ignoredLimit, ...signature } = opts
  const hash = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries({ workspaceId, ...signature }).sort(([a], [b]) => a.localeCompare(b))))).digest('hex')
  const cursor = decodeKeyCursor<{ hash: string; values: (string | number | null)[] }>(opts.cursor)
  if (cursor) {
    if (cursor.hash !== hash || !Array.isArray(cursor.values) || cursor.values.length !== keys.length || cursor.values.some(v => v !== null && typeof v !== 'string' && typeof v !== 'number')) throw badRequest('Invalid cursor')
    const values = cursor.values.map((value, i) => value !== null && keys[i]!.date ? new Date(value) : value)
    if (values.some(v => v instanceof Date && !Number.isFinite(v.getTime()))) throw badRequest('Invalid cursor')
    const after = keys.map((key, i) => sql`(${and([
      ...keys.slice(0, i).map((prev, j) => sql`${prev.expr} <=> ${values[j]}`),
      sql`${key.expr} ${Prisma.raw(key.dir === 'asc' ? '>' : '<')} ${values[i]}`,
    ])})`)
    filters.push(sql`(${Prisma.join(after, ' OR ')})`)
  }
  const limit = normalizeLimit(opts.limit)
  type Ordered = { id: string; [key: string]: unknown }
  const [ordered, total] = await Promise.all([
    db.$queryRaw<Ordered[]>(sql`SELECT c.id, ${Prisma.join(keys.map((key, i) => sql`${key.expr} AS ${Prisma.raw(`k${i}`)}`))}
      FROM Contact c WHERE ${and(filters)} ORDER BY ${Prisma.join(keys.map(key => sql`${key.expr} ${Prisma.raw(key.dir)}`))} LIMIT ${limit + 1}`),
    db.$queryRaw<{ total: bigint }[]>(sql`SELECT COUNT(*) AS total FROM Contact c WHERE ${baseWhere}`),
  ])
  const result = page(ordered, limit, last => encodeKeyCursor({ hash, values: keys.map((_, i) => {
    const value = last[`k${i}`]
    return value instanceof Date ? value.toISOString() : value == null ? null : String(value)
  }) }))
  const rows = await db.contact.findMany({ where: { workspaceId, id: { in: result.data.map(r => r.id) } }, include: contactInclude })
  const byId = new Map(rows.map(row => [row.id, row]))
  return { data: result.data.flatMap(row => byId.has(row.id) ? [toContact(byId.get(row.id)!)] : []), meta: { ...result.meta, total: Number(total[0]!.total) } }
}

export async function contactFieldDefinitions(workspaceId: string): Promise<ContactFieldDefinition[]> {
  const overrides = await db.contactFieldDefinition.findMany({ where: { workspaceId } })
  const fields = new Map(CONTACT_FIELD_DEFAULTS.map(field => [field.key, field]))
  for (const row of overrides) {
    const builtin = fields.get(row.key)
    fields.set(row.key, { key: row.key, label: row.label, type: builtin?.type ?? row.type as ContactFieldDefinition['type'],
      numberConfig: (row.numberConfig ?? builtin?.numberConfig ?? undefined) as ContactFieldDefinition['numberConfig'],
      options: Array.isArray(row.options) ? row.options as ContactFieldDefinition['options'] : builtin?.options ?? [], position: row.position, archived: row.archived })
  }
  return [...fields.values()].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
}

export async function validateWorkbenchInput(workspaceId: string, input: Record<string, unknown>) {
  const fields = await contactFieldDefinitions(workspaceId)
  if (input.contactLog && input.logContact !== true) throw badRequest('Log details require completed outreach', 'INVALID_CONTACT_LOG')
  if (input.undoLogContact && (input.logContact || !('contacted' in input) || !('lastContactedAt' in input))) throw badRequest('Undo requires the previous outreach values', 'INVALID_CONTACT_LOG')
  for (const key of ['priority', 'waitingOn']) {
    if (input[key] != null && !fields.find(f => f.key === key)?.options.some(o => o.value === input[key])) throw badRequest(`Invalid ${key}`, 'INVALID_FIELD_VALUE')
  }
  if (input.lastContactedAt && new Date(String(input.lastContactedAt)).getTime() > Date.now() + 60_000) throw badRequest('Last contacted cannot be in the future', 'INVALID_CONTACT_DATE')
  if (input.fieldValues && typeof input.fieldValues === 'object') {
    for (const [key, value] of Object.entries(input.fieldValues)) {
      const field = fields.find(f => f.key === key && !f.archived && (!CONTACT_FIELD_DEFAULTS.some(b => b.key === key) || ['category', 'location'].includes(key)))
      if (!field) throw badRequest(`Unknown field: ${key}`, 'INVALID_FIELD_VALUE')
      if (value === null) continue
      const valid = field.type === 'checkbox' ? typeof value === 'boolean'
        : field.type === 'number' ? validNumber(value, field.numberConfig)
        : field.type === 'select' ? field.options.some(o => o.value === value)
        : field.type === 'date' ? typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
        : typeof value === 'string' && value.length <= 1000
      if (!valid) throw badRequest(`Invalid value for ${field.label}`, 'INVALID_FIELD_VALUE')
    }
  }
}

function validNumber(value: unknown, config?: ContactFieldDefinition['numberConfig']) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (config?.minimum != null && value < config.minimum) return false
  if (config?.maximum != null && value > config.maximum) return false
  if (config?.precision != null) {
    const scaled = value * 10 ** config.precision
    if (Math.abs(scaled - Math.round(scaled)) > 1e-7) return false
  }
  return true
}
