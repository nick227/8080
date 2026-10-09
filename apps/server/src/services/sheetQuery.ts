// Sheet queries (doc/13 §12, A1): a whitelisted, typed query over Contacts or
// Inventory → a grid table. Rows, counts and totals are computed here, by code; the
// model at most fills a SheetQuery, which is validated like any other input.
import { createHash } from 'crypto'
import { db, type Prisma } from '@project/db'
import {
  CONTACT_SHEET_COLUMNS, INVENTORY_SHEET_COLUMNS, DEFAULT_PIPELINE_STAGES, SHEET_MAX_ROWS,
  type ContactSheetColumn, type ContactSheetQuery, type GridTable, type InventorySheetColumn, type InventorySheetQuery, type SheetQuery,
} from '@project/shared'
import { ensurePipelineStages } from './PipelineService'
import { minorDigits, sheetAsText, type CellType, type CellValue, type SheetContent } from '@project/shared'
import { badRequest } from '../lib/errors'
import { localDayKey, wallTimeToUtc } from '../lib/workspaceDay'

const invalid = (message: string) => badRequest(message, 'INVALID_SHEET_QUERY')
const DAY = /^\d{4}-\d{2}-\d{2}$/
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`))
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function keys(v: Record<string, unknown>, allowed: string[], where: string) {
  const extra = Object.keys(v).filter((k) => !allowed.includes(k))
  if (extra.length) throw invalid(`Unsupported ${where}: ${extra.join(', ')}`)
}
function text(v: unknown, max: number, what: string) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw invalid(`Invalid ${what}`)
  return v.trim()
}

export const LEAD_LABEL: Record<string, string> = Object.fromEntries(DEFAULT_PIPELINE_STAGES.map((s) => [s.key, s.label]))
const STAGE_KEY = /^[a-z][a-z0-9_-]{0,63}$/
const CONTACT_DATES = new Set<ContactSheetColumn>(['nextFollowUp', 'lastActivity', 'created'])
const INVENTORY_TYPE: Record<InventorySheetColumn, CellType> = {
  name: 'text', sku: 'text', category: 'text', price: 'money', quantity: 'number', lowStockThreshold: 'number',
  stockValue: 'money', location: 'text', available: 'boolean', status: 'text', updated: 'date',
}
const CONTACT_LABEL: Record<ContactSheetColumn, string> = {
  name: 'Name', company: 'Company', title: 'Title', email: 'Email', phone: 'Phone', leadStatus: 'Lead status', leadSource: 'Lead source',
  nextFollowUp: 'Next follow-up', lastActivity: 'Last activity', owner: 'Owner', created: 'Added',
}
const INVENTORY_LABEL = (currency: string): Record<InventorySheetColumn, string> => ({
  name: 'Name', sku: 'SKU', category: 'Category', price: `Price (${currency})`, quantity: 'In stock', lowStockThreshold: 'Low-stock level',
  stockValue: `Stock value (${currency})`, location: 'Location', available: 'Available', status: 'Status', updated: 'Updated',
})

// ─── validation ───────────────────────────────────────────────────────────────

function columnsOf<T extends string>(raw: unknown, allowed: readonly T[]): T[] {
  if (raw === undefined) throw invalid('Choose at least one column')
  if (!Array.isArray(raw) || !raw.length || raw.length > allowed.length || new Set(raw).size !== raw.length || raw.some((c) => !allowed.includes(c))) throw invalid('Choose unique supported columns')
  return raw as T[]
}
function sortOf<F extends string>(raw: unknown, fields: readonly F[]) {
  if (raw === undefined) return undefined
  if (!plain(raw)) throw invalid('Invalid sort')
  keys(raw, ['field', 'direction'], 'sort')
  if (!fields.includes(raw.field as F) || !['asc', 'desc'].includes(raw.direction as string)) throw invalid('Unsupported sort')
  return { field: raw.field as F, direction: raw.direction as 'asc' | 'desc' }
}
function limitOf(raw: unknown) {
  if (raw === undefined) return undefined
  if (!Number.isInteger(raw) || (raw as number) < 1 || (raw as number) > SHEET_MAX_ROWS) throw invalid(`Limit must be 1–${SHEET_MAX_ROWS}`)
  return raw as number
}
function windowOf(raw: unknown) {
  if (!plain(raw)) throw invalid('Invalid date window')
  keys(raw, ['from', 'to'], 'date window')
  if (raw.from === undefined && raw.to === undefined) throw invalid('A date window needs from or to')
  if ((raw.from !== undefined && !isDay(raw.from)) || (raw.to !== undefined && !isDay(raw.to))) throw invalid('Dates must be YYYY-MM-DD')
  if (raw.from && raw.to && (raw.from as string) > (raw.to as string)) throw invalid('The date window ends before it starts')
  return { ...(raw.from ? { from: raw.from as string } : {}), ...(raw.to ? { to: raw.to as string } : {}) }
}

/** The query, checked field by field; unknown fields are refused, not ignored. */
export function validateSheetQuery(raw: unknown): SheetQuery {
  if (!plain(raw)) throw invalid('A sheet query is an object')
  keys(raw, ['source', 'columns', 'filters', 'groupBy', 'sort', 'limit'], 'query field')
  if (raw.filters !== undefined && !plain(raw.filters)) throw invalid('Invalid filters')
  if (raw.groupBy !== undefined && raw.sort !== undefined) throw invalid('A grouped sheet has a fixed order')
  const f = (raw.filters ?? {}) as Record<string, unknown>
  if (raw.source === 'contacts') {
    if (raw.groupBy !== undefined && !['leadStatus', 'leadSource', 'owner'].includes(raw.groupBy as string)) throw invalid('Unsupported grouping')
    const grouped = raw.groupBy !== undefined
    keys(f, ['leadStatus', 'followUp', 'noFollowUp', 'quietSince', 'ownerMemberId', 'q'], 'contact filter')
    const filters: NonNullable<ContactSheetQuery['filters']> = {}
    if (f.leadStatus !== undefined) {
      if (!Array.isArray(f.leadStatus) || !f.leadStatus.length || f.leadStatus.some((s) => typeof s !== 'string' || !STAGE_KEY.test(s))) throw invalid('Unknown lead status')
      filters.leadStatus = [...new Set(f.leadStatus as string[])]
    }
    if (f.followUp !== undefined) filters.followUp = windowOf(f.followUp)
    if (f.noFollowUp !== undefined) { if (f.noFollowUp !== true) throw invalid('noFollowUp is true or absent'); filters.noFollowUp = true }
    if (filters.followUp && filters.noFollowUp) throw invalid('A follow-up window and "no follow-up" exclude each other')
    if (f.quietSince !== undefined) { if (!isDay(f.quietSince)) throw invalid('Dates must be YYYY-MM-DD'); filters.quietSince = f.quietSince }
    if (f.ownerMemberId !== undefined) filters.ownerMemberId = text(f.ownerMemberId, 64, 'owner')
    if (f.q !== undefined) filters.q = text(f.q, 120, 'search')
    return {
      source: 'contacts', ...(grouped ? { groupBy: raw.groupBy as ContactSheetQuery['groupBy'] } : {}),
      ...(grouped ? {} : { columns: columnsOf(raw.columns, CONTACT_SHEET_COLUMNS) }),
      ...(Object.keys(filters).length ? { filters } : {}),
      ...(raw.sort !== undefined ? { sort: sortOf(raw.sort, ['name', 'nextFollowUp', 'lastActivity', 'created'] as const) } : {}),
      ...(raw.limit !== undefined ? { limit: limitOf(raw.limit) } : {}),
    }
  }
  if (raw.source === 'inventory') {
    if (raw.groupBy !== undefined && raw.groupBy !== 'category') throw invalid('Unsupported grouping')
    const grouped = raw.groupBy !== undefined
    keys(f, ['q', 'category', 'stock', 'available', 'priceMin', 'priceMax', 'includeArchived'], 'inventory filter')
    const filters: NonNullable<InventorySheetQuery['filters']> = {}
    if (f.q !== undefined) filters.q = text(f.q, 120, 'search')
    if (f.category !== undefined) filters.category = text(f.category, 80, 'category')
    if (f.stock !== undefined) { if (!['low', 'out', 'low-or-out'].includes(f.stock as string)) throw invalid('Unknown stock filter'); filters.stock = f.stock as 'low' }
    if (f.available !== undefined) { if (typeof f.available !== 'boolean') throw invalid('available is true or false'); filters.available = f.available }
    for (const k of ['priceMin', 'priceMax'] as const) {
      if (f[k] === undefined) continue
      if (typeof f[k] !== 'number' || !Number.isFinite(f[k]) || (f[k] as number) < 0) throw invalid('Prices are numbers of zero or more')
      filters[k] = f[k] as number
    }
    if (filters.priceMin !== undefined && filters.priceMax !== undefined && filters.priceMin > filters.priceMax) throw invalid('The price range ends before it starts')
    if (f.includeArchived !== undefined) { if (f.includeArchived !== true) throw invalid('includeArchived is true or absent'); filters.includeArchived = true }
    return {
      source: 'inventory', ...(grouped ? { groupBy: 'category' as const } : {}),
      ...(grouped ? {} : { columns: columnsOf(raw.columns, INVENTORY_SHEET_COLUMNS) }),
      ...(Object.keys(filters).length ? { filters } : {}),
      ...(raw.sort !== undefined ? { sort: sortOf(raw.sort, ['name', 'price', 'quantity', 'stockValue', 'updated'] as const) } : {}),
      ...(raw.limit !== undefined ? { limit: limitOf(raw.limit) } : {}),
    }
  }
  throw invalid('A sheet reads Contacts or Inventory')
}

// ─── days ─────────────────────────────────────────────────────────────────────

const dayStart = (day: string, tz: string) => wallTimeToUtc(`${day}T00:00:00`, tz)
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const window = (w: { from?: string; to?: string }, tz: string) => ({ ...(w.from ? { gte: dayStart(w.from, tz) } : {}), ...(w.to ? { lt: dayStart(addDays(w.to, 1), tz) } : {}) })
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const cellDay = (d: Date | null, tz: string) => (d ? localDayKey(d, tz) : null)
/** A decimal amount from a query filter → minor units (prices themselves are stored exact, A4). */
const minor = (n: number, currency: string) => Math.round(n * 10 ** minorDigits(currency))
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

// ─── running ──────────────────────────────────────────────────────────────────

export type SheetContext = { workspaceId: string; timezone: string; currency: string }
export type SheetResult = { content: SheetContent; table: GridTable; rowCount: number; dataHash: string; asOf: string }

const tooLarge = (n: number) => badRequest(`That matches ${n} rows; a sheet holds at most ${SHEET_MAX_ROWS}. Narrow it down or set a limit.`, 'SHEET_TOO_LARGE')
const hashOf = (content: SheetContent) => createHash('sha256').update(JSON.stringify([content.columns, content.rows])).digest('hex')
// The typed sheet is the result; the text table (with a Total line) is its snapshot for CSV and imports.
const finish = (content: SheetContent, asOf: string): SheetResult => ({ content, table: sheetAsText(content), rowCount: content.rows.length, dataHash: hashOf(content), asOf })

async function memberNames(workspaceId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>()
  const members = await db.workspaceMember.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } })
  return new Map(members.map((m) => [m.id, m.user.profile?.displayName ?? 'Member']))
}

function contactWhere(ctx: SheetContext, q: ContactSheetQuery): Prisma.ContactWhereInput {
  const f = q.filters ?? {}
  return {
    workspaceId: ctx.workspaceId, deletedAt: null, status: 'active',
    ...(f.leadStatus ? { leadStatus: { in: f.leadStatus } } : {}),
    ...(f.followUp ? { nextFollowUp: window(f.followUp, ctx.timezone) } : {}),
    ...(f.noFollowUp ? { nextFollowUp: null } : {}),
    ...(f.quietSince ? { OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: dayStart(f.quietSince, ctx.timezone) } }] } : {}),
    ...(f.ownerMemberId ? { ownerMemberId: f.ownerMemberId } : {}),
    ...(f.q ? { displayName: { contains: f.q } } : {}),
  }
}

async function contactsSheet(ctx: SheetContext, q: ContactSheetQuery, asOf: string): Promise<SheetResult> {
  const where = contactWhere(ctx, q)
  if (q.groupBy) {
    const field = q.groupBy === 'owner' ? 'ownerMemberId' : q.groupBy
    const groups = await db.contact.groupBy({ by: [field], where, _count: { _all: true } })
    const count = new Map(groups.map((g) => [(g as Record<string, unknown>)[field] as string | null, g._count._all]))
    let rows: { key: string; label: string; n: number }[]
    if (q.groupBy === 'leadStatus') {
      await ensurePipelineStages(db, ctx.workspaceId)
      const stages = await db.pipelineStage.findMany({
        where: { workspaceId: ctx.workspaceId, archived: false },
        orderBy: [{ position: 'asc' }, { key: 'asc' }],
      })
      rows = stages
        .filter((s) => !q.filters?.leadStatus || q.filters.leadStatus.includes(s.key))
        .map((s) => ({ key: s.key, label: s.label, n: count.get(s.key) ?? 0 }))
    } else {
      const names = q.groupBy === 'owner' ? await memberNames(ctx.workspaceId, [...count.keys()].filter((k): k is string => !!k)) : null
      rows = [...count].map(([k, n]) => ({ key: k ?? '', label: k === null ? (q.groupBy === 'owner' ? 'Unassigned' : 'Not set') : names?.get(k) ?? k, n }))
        .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    }
    if (count.has(null) && q.groupBy === 'leadStatus') rows.push({ key: '', label: 'Not set', n: count.get(null)! })
    const head = { leadStatus: 'Lead status', leadSource: 'Lead source', owner: 'Owner' }[q.groupBy]
    return finish({
      schemaVersion: 1,
      columns: [{ id: 'group', label: head, type: 'text' }, { id: 'contacts', label: 'Contacts', type: 'number', total: 'sum' }],
      rows: rows.map((r, i) => ({ id: `g${i + 1}`, cells: { group: r.label, contacts: r.n } })),
    }, asOf)
  }
  const total = await db.contact.count({ where })
  if (total > SHEET_MAX_ROWS && !q.limit) throw tooLarge(total)
  const sort = q.sort ?? { field: 'name', direction: 'asc' }
  const field = { name: 'displayName', nextFollowUp: 'nextFollowUp', lastActivity: 'lastActivityAt', created: 'createdAt' }[sort.field]
  const columns = q.columns!
  const found = await db.contact.findMany({
    where, take: Math.min(q.limit ?? SHEET_MAX_ROWS, SHEET_MAX_ROWS),
    orderBy: [{ [field]: sort.direction }, { id: 'asc' }],
    select: {
      id: true, displayName: true, title: true, primaryEmail: true, primaryPhone: true, leadStatus: true, leadSource: true, nextFollowUp: true, lastActivityAt: true, ownerMemberId: true, createdAt: true,
      accounts: { where: { endedAt: null, account: { deletedAt: null } }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1, select: { account: { select: { name: true } } } },
    },
  })
  const owners = columns.includes('owner') ? await memberNames(ctx.workspaceId, [...new Set(found.map((c) => c.ownerMemberId).filter((x): x is string => !!x))]) : new Map()
  await ensurePipelineStages(db, ctx.workspaceId)
  const stageLabels = new Map(
    (await db.pipelineStage.findMany({ where: { workspaceId: ctx.workspaceId }, select: { key: true, label: true } })).map((s) => [s.key, s.label]),
  )
  const tz = ctx.timezone
  const cell = (c: typeof found[number], col: ContactSheetColumn): CellValue => {
    switch (col) {
      case 'name': return c.displayName
      case 'company': return c.accounts[0]?.account.name ?? null
      case 'title': return c.title
      case 'email': return c.primaryEmail
      case 'phone': return c.primaryPhone
      case 'leadStatus': return c.leadStatus ? stageLabels.get(c.leadStatus) ?? LEAD_LABEL[c.leadStatus] ?? c.leadStatus : null
      case 'leadSource': return c.leadSource
      case 'nextFollowUp': return cellDay(c.nextFollowUp, tz)
      case 'lastActivity': return cellDay(c.lastActivityAt, tz)
      case 'owner': return c.ownerMemberId ? owners.get(c.ownerMemberId) ?? null : null
      case 'created': return cellDay(c.createdAt, tz)
    }
  }
  const table: SheetContent = {
    schemaVersion: 1,
    columns: columns.map((id) => ({ id, label: CONTACT_LABEL[id], type: CONTACT_DATES.has(id) ? 'date' : 'text' })),
    rows: found.map((c) => ({ id: c.id, cells: Object.fromEntries(columns.map((col) => [col, cell(c, col)])) })),
  }
  return finish(table, asOf)
}

function inventoryWhere(ctx: SheetContext, q: InventorySheetQuery): Prisma.InventoryWhereInput {
  const f = q.filters ?? {}
  const stock: Prisma.InventoryWhereInput | null =
    f.stock === 'low' ? { lowStock: true } : f.stock === 'out' ? { quantity: 0 } : f.stock === 'low-or-out' ? { OR: [{ lowStock: true }, { quantity: 0 }] } : null
  return {
    workspaceId: ctx.workspaceId, ...(f.includeArchived ? {} : { status: 'active' }),
    AND: [
      ...(f.q ? [{ OR: [{ name: { contains: f.q } }, { sku: { contains: f.q } }] }] : []),
      ...(stock ? [stock] : []),
    ],
    ...(f.category ? { category: f.category } : {}),
    ...(f.available !== undefined ? { availability: f.available } : {}),
    ...(f.priceMin !== undefined || f.priceMax !== undefined ? { priceMinor: { ...(f.priceMin !== undefined ? { gte: minor(f.priceMin, ctx.currency) } : {}), ...(f.priceMax !== undefined ? { lte: minor(f.priceMax, ctx.currency) } : {}) } } : {}),
  }
}

async function inventorySheet(ctx: SheetContext, q: InventorySheetQuery, asOf: string): Promise<SheetResult> {
  const where = inventoryWhere(ctx, q)
  const total = await db.inventory.count({ where })
  if (q.groupBy) {
    if (total > SHEET_MAX_ROWS * 10) throw tooLarge(total)
    const items = await db.inventory.findMany({ where, select: { category: true, quantity: true, priceMinor: true } })
    const by = new Map<string, { items: number; units: number; value: number }>()
    for (const i of items) {
      const k = i.category ?? ''
      const g = by.get(k) ?? { items: 0, units: 0, value: 0 }
      g.items++; g.units += i.quantity ?? 0; g.value += (i.quantity ?? 0) * i.priceMinor // exact: integers
      by.set(k, g)
    }
    const rows = [...by].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    const cur = ctx.currency
    return finish({
      schemaVersion: 1,
      columns: [
        { id: 'category', label: 'Category', type: 'text' }, { id: 'items', label: 'Items', type: 'number', total: 'sum' },
        { id: 'units', label: 'Units in stock', type: 'number', total: 'sum' }, { id: 'value', label: `Stock value (${cur})`, type: 'money', currency: cur, total: 'sum' },
      ],
      rows: rows.map(([k, g], i) => ({ id: `g${i + 1}`, cells: { category: k || 'Uncategorized', items: g.items, units: g.units, value: g.value } })),
    }, asOf)
  }
  const sort = q.sort ?? { field: 'name', direction: 'asc' }
  // Stock value isn't a column, so that order is computed here over every match.
  const inMemory = sort.field === 'stockValue'
  if (total > SHEET_MAX_ROWS && (!q.limit || inMemory)) throw tooLarge(total)
  const field = { name: 'name', price: 'priceMinor', quantity: 'quantity', updated: 'updatedAt', stockValue: 'name' }[sort.field]
  let found = await db.inventory.findMany({
    where, take: inMemory ? undefined : Math.min(q.limit ?? SHEET_MAX_ROWS, SHEET_MAX_ROWS),
    orderBy: [{ [field]: inMemory ? 'asc' : sort.direction }, { id: 'asc' }],
  })
  const value = (i: typeof found[number]) => (i.quantity === null ? null : i.quantity * i.priceMinor)
  if (inMemory) {
    const dir = sort.direction === 'asc' ? 1 : -1
    found = found.sort((a, b) => ((value(a) ?? -1) - (value(b) ?? -1)) * dir).slice(0, q.limit ?? SHEET_MAX_ROWS)
  }
  const columns = q.columns!
  const cur = ctx.currency
  const cell = (i: typeof found[number], col: InventorySheetColumn): CellValue => {
    switch (col) {
      case 'name': return i.name
      case 'sku': return i.sku
      case 'category': return i.category
      case 'price': return i.priceMinor
      case 'quantity': return i.quantity
      case 'lowStockThreshold': return i.lowStockThreshold
      case 'stockValue': return value(i)
      case 'location': return i.location
      case 'available': return i.availability
      case 'status': return i.status === 'active' ? 'Active' : 'Archived'
      case 'updated': return cellDay(i.updatedAt, ctx.timezone)
    }
  }
  const labels = INVENTORY_LABEL(ctx.currency)
  const table: SheetContent = {
    schemaVersion: 1,
    columns: columns.map((id) => INVENTORY_TYPE[id] === 'money' ? { id, label: labels[id], type: 'money', currency: cur, ...(id === 'stockValue' ? { total: 'sum' as const } : {}) } : { id, label: labels[id], type: INVENTORY_TYPE[id] }),
    rows: found.map((i) => ({ id: i.id, cells: Object.fromEntries(columns.map((col) => [col, cell(i, col)])) })),
  }
  return finish(table, asOf)
}

/** Runs a validated query. The caller has checked the viewer may read records. */
export function runSheetQuery(ctx: SheetContext, query: SheetQuery, now = new Date()): Promise<SheetResult> {
  const asOf = now.toISOString()
  return query.source === 'contacts' ? contactsSheet(ctx, query, asOf) : inventorySheet(ctx, query, asOf)
}

// ─── plain words ──────────────────────────────────────────────────────────────

const orList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`)

/** The query in plain words — what the person confirms before it runs. */
export async function describeSheetQuery(ctx: SheetContext, q: SheetQuery) {
  const parts: string[] = []
  if (q.source === 'contacts') {
    const f = q.filters ?? {}
    parts.push(q.groupBy ? `Contacts counted by ${{ leadStatus: 'lead status', leadSource: 'lead source', owner: 'owner' }[q.groupBy]}` : 'Contacts')
    if (f.leadStatus) parts.push(`lead status ${orList(f.leadStatus.map((s) => LEAD_LABEL[s]!))}`)
    if (f.followUp) parts.push(f.followUp.from && f.followUp.to ? `follow-up ${shortDay(f.followUp.from)}–${shortDay(f.followUp.to)}` : f.followUp.to ? `follow-up on or before ${shortDay(f.followUp.to)}` : `follow-up on or after ${shortDay(f.followUp.from!)}`)
    if (f.noFollowUp) parts.push('no follow-up set')
    if (f.quietSince) parts.push(`no activity since ${shortDay(f.quietSince)}`)
    if (f.ownerMemberId) parts.push(`owned by ${(await memberNames(ctx.workspaceId, [f.ownerMemberId])).get(f.ownerMemberId) ?? 'an unknown member'}`)
    if (f.q) parts.push(`name contains “${f.q}”`)
    if (q.columns) parts.push(`columns: ${q.columns.map((c) => CONTACT_LABEL[c]).join(', ')}`)
    if (q.sort) parts.push(`sorted by ${CONTACT_LABEL[{ name: 'name', nextFollowUp: 'nextFollowUp', lastActivity: 'lastActivity', created: 'created' }[q.sort.field] as ContactSheetColumn].toLowerCase()}${q.sort.direction === 'desc' ? ', newest or highest first' : ''}`)
  } else {
    const f = q.filters ?? {}
    const labels = INVENTORY_LABEL(ctx.currency)
    parts.push(q.groupBy ? 'Inventory totals by category' : f.includeArchived ? 'Inventory, archived items included' : 'Inventory')
    if (f.stock) parts.push({ low: 'low on stock', out: 'out of stock', 'low-or-out': 'low or out of stock' }[f.stock])
    if (f.category) parts.push(`category “${f.category}”`)
    if (f.available !== undefined) parts.push(f.available ? 'available only' : 'unavailable only')
    if (f.priceMin !== undefined || f.priceMax !== undefined) parts.push(f.priceMin !== undefined && f.priceMax !== undefined ? `price ${money(f.priceMin)}–${money(f.priceMax)} ${ctx.currency}` : f.priceMin !== undefined ? `price ${money(f.priceMin)} ${ctx.currency} or more` : `price up to ${money(f.priceMax!)} ${ctx.currency}`)
    if (f.q) parts.push(`name or SKU contains “${f.q}”`)
    if (q.columns) parts.push(`columns: ${q.columns.map((c) => labels[c].replace(/ \(.*\)$/, '')).join(', ')}`)
    if (q.sort) parts.push(`sorted by ${labels[q.sort.field === 'updated' ? 'updated' : q.sort.field].replace(/ \(.*\)$/, '').toLowerCase()}${q.sort.direction === 'desc' ? ', highest first' : ''}`)
  }
  if (q.limit) parts.push(`first ${q.limit}`)
  return parts.join(' · ')
}

// ─── presets ──────────────────────────────────────────────────────────────────

/** What a preset needs from the workspace: today, and its open pipeline stages
 *  (stages are workspace vocabulary; never hard-code their keys). */
export type PresetContext = { today: string; openStages: string[] }
export type SheetPreset = { key: string; label: string; description: string; build: (ctx: PresetContext) => SheetQuery }
const open = (ctx: PresetContext): ContactSheetQuery['filters'] => (ctx.openStages.length ? { leadStatus: ctx.openStages } : {})

/** The common asks, one button each. Relative dates resolve against the workspace's
 *  today when the sheet is made (and again when it is regenerated). */
export const SHEET_PRESETS: SheetPreset[] = [
  {
    key: 'follow-ups-week', label: 'Follow-ups this week', description: 'Open leads with a follow-up due by Sunday, overdue ones first.',
    build: (ctx) => {
      const weekday = new Date(`${ctx.today}T12:00:00Z`).getUTCDay() // 0 = Sunday
      return { source: 'contacts', columns: ['name', 'company', 'email', 'phone', 'leadStatus', 'nextFollowUp', 'owner'], filters: { ...open(ctx), followUp: { to: addDays(ctx.today, (7 - weekday) % 7) } }, sort: { field: 'nextFollowUp', direction: 'asc' } }
    },
  },
  { key: 'leads-by-stage', label: 'Leads by stage', description: 'How many contacts are at each lead status.', build: () => ({ source: 'contacts', groupBy: 'leadStatus' }) },
  {
    key: 'gone-quiet', label: 'Gone quiet', description: 'Open leads with no activity in the last 30 days.',
    build: (ctx) => ({ source: 'contacts', columns: ['name', 'company', 'email', 'leadStatus', 'lastActivity', 'owner'], filters: { ...open(ctx), quietSince: addDays(ctx.today, -30) }, sort: { field: 'lastActivity', direction: 'asc' } }),
  },
  { key: 'low-stock', label: 'Low or out of stock', description: 'Active items at or under their low-stock level, or at zero.', build: () => ({ source: 'inventory', columns: ['name', 'sku', 'category', 'quantity', 'lowStockThreshold', 'location'], filters: { stock: 'low-or-out' }, sort: { field: 'quantity', direction: 'asc' } }) },
  { key: 'stock-by-category', label: 'Stock by category', description: 'Items, units and stock value per category, with totals.', build: () => ({ source: 'inventory', groupBy: 'category' }) },
  { key: 'price-list', label: 'Price list', description: 'Active, available items with their prices.', build: () => ({ source: 'inventory', columns: ['name', 'sku', 'category', 'price'], filters: { available: true }, sort: { field: 'name', direction: 'asc' } }) },
]
export const presetFor = (key: string) => SHEET_PRESETS.find((p) => p.key === key)
export const todayIn = (tz: string, at = new Date()) => localDayKey(at, tz)
export { shortDay }
