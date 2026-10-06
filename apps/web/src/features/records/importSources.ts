/** Import/connect sources for the records slideout. CSV runs today; the rest are UI-ready. */

export type SourceId = 'csv' | 'google-sheets' | 'airtable' | 'woocommerce'

export type ConnectField = {
  id: string
  label: string
  type: 'text' | 'password' | 'url' | 'oauth'
  placeholder?: string
  optional?: boolean
}

export type ImportSource = {
  id: SourceId
  name: string
  syncable: boolean
  status: 'available' | 'preview'
  targets: ('contacts' | 'inventory')[]
  fields: ConnectField[]
}

export const IMPORT_SOURCES: ImportSource[] = [
  {
    id: 'csv',
    name: 'CSV',
    syncable: false,
    status: 'available',
    targets: ['contacts', 'inventory'],
    fields: [],
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      { id: 'oauth', label: 'Google', type: 'oauth' },
      { id: 'spreadsheetId', label: 'Spreadsheet', type: 'text', placeholder: 'ID or name' },
      { id: 'sheetName', label: 'Tab', type: 'text' },
      { id: 'range', label: 'Range', type: 'text', placeholder: 'A1:G500', optional: true },
    ],
  },
  {
    id: 'airtable',
    name: 'Airtable',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      { id: 'token', label: 'Access token', type: 'password' },
      { id: 'baseId', label: 'Base', type: 'text', placeholder: 'app…' },
      { id: 'tableId', label: 'Table', type: 'text' },
      { id: 'viewId', label: 'View', type: 'text', optional: true },
    ],
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      { id: 'storeUrl', label: 'Store URL', type: 'url', placeholder: 'https://myshop.com' },
      { id: 'consumerKey', label: 'Consumer key', type: 'password' },
      { id: 'consumerSecret', label: 'Consumer secret', type: 'password' },
    ],
  },
]
