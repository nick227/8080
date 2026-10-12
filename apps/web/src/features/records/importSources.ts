/** Import/connect sources for all workspace domains. CSV & Starter Packs run today; Google Sheets & Airtable are UI-ready. */

export type SourceId = 'starter-packs' | 'csv' | 'google-sheets' | 'airtable' | 'woocommerce'

export type SyncMode = 'once' | 'synced'

export type ConnectField = {
  id: string
  label: string
  type: 'text' | 'password' | 'url' | 'oauth'
  placeholder?: string
  optional?: boolean
}

export type ImportDomain = 'contacts' | 'inventory' | 'tasks' | 'budget' | 'team' | 'documents' | 'automations'

export type ImportSource = {
  id: SourceId
  name: string
  syncable: boolean
  status: 'available' | 'preview'
  targets: ImportDomain[]
  fields: ConnectField[]
}

const ALL_DOMAINS: ImportDomain[] = ['contacts', 'inventory', 'tasks', 'budget', 'team', 'documents', 'automations']

export const IMPORT_SOURCES: ImportSource[] = [
  {
    id: 'starter-packs',
    name: 'Starter Packs',
    syncable: false,
    status: 'available',
    targets: ALL_DOMAINS,
    fields: [],
  },
  {
    id: 'csv',
    name: 'CSV Upload',
    syncable: false,
    status: 'available',
    targets: ALL_DOMAINS,
    fields: [],
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    syncable: true,
    status: 'preview',
    targets: ALL_DOMAINS,
    fields: [
      { id: 'oauth', label: 'Google', type: 'oauth' },
      { id: 'spreadsheetId', label: 'Spreadsheet', type: 'text', placeholder: 'ID or URL' },
      { id: 'sheetName', label: 'Tab', type: 'text' },
      { id: 'range', label: 'Range', type: 'text', placeholder: 'A1:Z500', optional: true },
    ],
  },
  {
    id: 'airtable',
    name: 'Airtable',
    syncable: true,
    status: 'preview',
    targets: ALL_DOMAINS,
    fields: [
      { id: 'token', label: 'Personal access token', type: 'password' },
      { id: 'baseId', label: 'Base ID', type: 'text', placeholder: 'app…' },
      { id: 'tableId', label: 'Table / View', type: 'text' },
      { id: 'viewId', label: 'View ID', type: 'text', optional: true },
    ],
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    syncable: true,
    status: 'preview',
    targets: ['inventory'],
    fields: [
      { id: 'storeUrl', label: 'Store URL', type: 'url', placeholder: 'https://myshop.com' },
      { id: 'consumerKey', label: 'Consumer key', type: 'password' },
      { id: 'consumerSecret', label: 'Consumer secret', type: 'password' },
    ],
  },
]

