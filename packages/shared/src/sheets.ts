/** Sheets made from records (doc/13 §12, A1). A sheet query is a whitelisted, typed
 *  description of rows — never SQL. People pick presets with buttons; the model may
 *  fill the same shape from a sentence, and the server validates it either way.
 *  Dates are workspace-local calendar days (YYYY-MM-DD); `to` is inclusive. */

import { LEGACY_LEAD_STATUSES } from './pipeline'
/** @deprecated Prefer workspace pipeline stages; kept for sheet presets. */
export const LEAD_STATUSES = LEGACY_LEAD_STATUSES
export type LeadStatusValue = (typeof LEAD_STATUSES)[number]

export const CONTACT_SHEET_COLUMNS = ['name', 'company', 'title', 'email', 'phone', 'leadStatus', 'leadSource', 'nextFollowUp', 'lastActivity', 'owner', 'created'] as const
export type ContactSheetColumn = typeof CONTACT_SHEET_COLUMNS[number]
export const INVENTORY_SHEET_COLUMNS = ['name', 'sku', 'category', 'price', 'quantity', 'lowStockThreshold', 'stockValue', 'location', 'available', 'status', 'updated'] as const
export type InventorySheetColumn = typeof INVENTORY_SHEET_COLUMNS[number]

export type DayWindow = { from?: string; to?: string }
export type SortDirection = 'asc' | 'desc'

export type ContactSheetQuery = {
  source: 'contacts'
  /** Required unless grouped; a grouped sheet has fixed columns. */
  columns?: ContactSheetColumn[]
  filters?: {
    /** Pipeline stage keys (workspace-scoped). */
    leadStatus?: string[]
    followUp?: DayWindow
    /** Only contacts with no follow-up date. */
    noFollowUp?: boolean
    /** Last activity before this day, or never. */
    quietSince?: string
    ownerMemberId?: string
    q?: string
  }
  groupBy?: 'leadStatus' | 'leadSource' | 'owner'
  sort?: { field: 'name' | 'nextFollowUp' | 'lastActivity' | 'created'; direction: SortDirection }
  limit?: number
}

export type InventorySheetQuery = {
  source: 'inventory'
  columns?: InventorySheetColumn[]
  filters?: {
    q?: string
    category?: string
    /** low = at or under its threshold (above zero); out = zero in stock. */
    stock?: 'low' | 'out' | 'low-or-out'
    available?: boolean
    priceMin?: number
    priceMax?: number
    /** Archived items too (default: active only). */
    includeArchived?: boolean
  }
  groupBy?: 'category'
  sort?: { field: 'name' | 'price' | 'quantity' | 'stockValue' | 'updated'; direction: SortDirection }
  limit?: number
}

export type SheetQuery = ContactSheetQuery | InventorySheetQuery

export const SHEET_MAX_ROWS = 5000

/** What a generated document was made from: enough to tell when its data has changed
 *  and to make it again. Stored as the document's provenance. */
export type SheetRecipe = {
  kind: 'artifact'
  generator: 'sheet.query'
  generatorVersion: 1
  /** The preset it came from (relative dates re-resolve on regenerate), or null. */
  preset: string | null
  /** The resolved query that ran. */
  query: SheetQuery
  /** Plain-words description of the query, as shown before it ran. */
  summary: string
  asOf: string
  timezone: string
  currency: string
  rowCount: number
  dataHash: string
  /** The document this one was regenerated from, if any. */
  previousId: string | null
}
