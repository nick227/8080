import {
  ApiError,
  contactImportsApi,
  inventoryImportsApi,
  type ContactImport,
  type ContactImportRow,
  type ImportProposal,
  type InventoryImport,
  type InventoryImportRow,
} from '@project/sdk'
import type { RecordKind } from './navigation'

export type ImportBatch = ContactImport | InventoryImport
export type ImportRow = ContactImportRow | InventoryImportRow
export type ImportFieldOption = { id: string; label: string }
export type ImportCounts = ContactImport['counts']

export type ImportAdapter = {
  kind: RecordKind
  title: string
  noun: string
  fields: ImportFieldOption[]
  optionsLabel?: string
  preview: (workspaceId: string, csv: string, filename: string, mapping?: Record<string, string>, options?: Record<string, string>) => Promise<ImportBatch>
  remap: (workspaceId: string, importId: string, mapping: Record<string, string>, options?: Record<string, string>) => Promise<ImportBatch>
  rows: (workspaceId: string, importId: string, proposal?: ImportProposal) => Promise<{ data: ImportRow[]; complete: boolean }>
  resolve: (workspaceId: string, importId: string, rowId: string, action: 'create' | 'use' | 'skip', matchId?: string) => Promise<ImportBatch>
  commit: (workspaceId: string, importId: string) => Promise<ImportBatch>
  cancel: (workspaceId: string, importId: string) => Promise<ImportBatch>
  matchLabel: (row: ImportRow) => string
  matchId: (row: ImportRow) => string | null
}

const CONTACT_FIELDS: ImportFieldOption[] = [
  { id: 'firstName', label: 'First name' },
  { id: 'lastName', label: 'Last name' },
  { id: 'displayName', label: 'Display name' },
  { id: 'title', label: 'Title' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'accountName', label: 'Company' },
  { id: 'externalId', label: 'External id' },
]

const INVENTORY_FIELDS: ImportFieldOption[] = [
  { id: 'name', label: 'Name' },
  { id: 'sku', label: 'SKU' },
  { id: 'description', label: 'Description' },
  { id: 'price', label: 'Price' },
  { id: 'category', label: 'Category' },
  { id: 'quantity', label: 'Quantity' },
  { id: 'availability', label: 'Availability' },
]

async function allRows(load: (cursor?: string) => Promise<{ data: ImportRow[]; meta: { nextCursor?: string | null } }>) {
  const data: ImportRow[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await load(cursor)
    data.push(...page.data)
    if (!page.meta.nextCursor) return { data, complete: true }
    cursor = page.meta.nextCursor
    if (data.length > 5000) return { data, complete: false }
  }
}

const contactImportAdapter: ImportAdapter = {
  kind: 'contacts',
  title: 'Import contacts',
  noun: 'contact',
  fields: CONTACT_FIELDS,
  preview: (workspaceId, csv, filename, mapping, options) =>
    contactImportsApi.preview(workspaceId, {
      source: { kind: 'csv', csv, filename },
      mapping: mapping as ContactImport['mapping'],
      options: options?.externalProvider ? { externalProvider: options.externalProvider } : undefined,
    }),
  remap: (workspaceId, importId, mapping, options) =>
    contactImportsApi.remap(workspaceId, importId, {
      mapping: mapping as ContactImport['mapping'],
      options: options?.externalProvider ? { externalProvider: options.externalProvider } : undefined,
    }),
  rows: async (workspaceId, importId, proposal) =>
    allRows((cursor) => contactImportsApi.rows(workspaceId, importId, { proposal, cursor, limit: 100 })),
  resolve: (workspaceId, importId, rowId, action, matchId) =>
    contactImportsApi.resolve(workspaceId, importId, rowId, { action, contactId: matchId }),
  commit: (workspaceId, importId) => contactImportsApi.commit(workspaceId, importId),
  cancel: (workspaceId, importId) => contactImportsApi.cancel(workspaceId, importId),
  matchLabel: (row) => {
    const contact = (row as ContactImportRow).contact ?? (row as ContactImportRow).candidates[0]
    return contact ? `${contact.displayName}${contact.primaryEmail ? ` · ${contact.primaryEmail}` : ''}` : 'Existing contact'
  },
  matchId: (row) => (row as ContactImportRow).proposedContactId ?? (row as ContactImportRow).candidates[0]?.id ?? null,
}

const inventoryImportAdapter: ImportAdapter = {
  kind: 'inventory',
  title: 'Import inventory',
  noun: 'item',
  fields: INVENTORY_FIELDS,
  optionsLabel: 'When a SKU already exists',
  preview: (workspaceId, csv, filename, mapping, options) =>
    inventoryImportsApi.preview(workspaceId, {
      source: { kind: 'csv', csv, filename },
      mapping: mapping as InventoryImport['mapping'],
      options: { onMatch: options?.onMatch === 'update' ? 'update' : 'skip' },
    }),
  remap: (workspaceId, importId, mapping, options) =>
    inventoryImportsApi.remap(workspaceId, importId, {
      mapping: mapping as InventoryImport['mapping'],
      options: { onMatch: options?.onMatch === 'update' ? 'update' : 'skip' },
    }),
  rows: async (workspaceId, importId, proposal) =>
    allRows((cursor) => inventoryImportsApi.rows(workspaceId, importId, { proposal, cursor, limit: 100 })),
  resolve: (workspaceId, importId, rowId, action, matchId) =>
    inventoryImportsApi.resolve(workspaceId, importId, rowId, { action, inventoryId: matchId }),
  commit: (workspaceId, importId) => inventoryImportsApi.commit(workspaceId, importId),
  cancel: (workspaceId, importId) => inventoryImportsApi.cancel(workspaceId, importId),
  matchLabel: (row) => {
    const item = (row as InventoryImportRow).item ?? (row as InventoryImportRow).candidates[0]
    return item ? `${item.name}${item.sku ? ` · ${item.sku}` : ''}` : 'Existing item'
  },
  matchId: (row) =>
    (row as InventoryImportRow).proposedInventoryId ?? (row as InventoryImportRow).candidates[0]?.id ?? null,
}

export function importAdapter(kind: RecordKind): ImportAdapter {
  return kind === 'contacts' ? contactImportAdapter : inventoryImportAdapter
}

export function importError(err: unknown) {
  if (err instanceof ApiError) return err.message
  return err instanceof Error ? err.message : 'Import failed. Try again.'
}

export const PROPOSAL_LABEL: Record<ImportProposal, string> = {
  create: 'Create',
  match: 'Match',
  review: 'Needs review',
  duplicate: 'Duplicate',
  invalid: 'Invalid',
}
