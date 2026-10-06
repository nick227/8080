/** Catalog of import/connect sources for the records slideout. Only CSV runs today. */

export type SourceId =
  | 'csv'
  | 'google-sheets'
  | 'airtable'
  | 'woocommerce'
  | 'shopify'
  | 'hubspot'
  | 'salesforce'
  | 'pipedrive'
  | 'notion'
  | 'stripe'
  | 'mailchimp'
  | 'quickbooks'
  | 'postgres'
  | 'mysql'
  | 'rest'

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
  category: 'file' | 'commerce' | 'crm' | 'ops' | 'advanced'
  syncable: boolean
  status: 'available' | 'preview'
  targets: ('contacts' | 'inventory')[]
  fields: ConnectField[]
}

export const IMPORT_SOURCES: ImportSource[] = [
  {
    id: 'csv',
    name: 'CSV',
    category: 'file',
    syncable: false,
    status: 'available',
    targets: ['contacts', 'inventory'],
    fields: [],
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    category: 'file',
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
    category: 'crm',
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
    category: 'commerce',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      { id: 'storeUrl', label: 'Store URL', type: 'url', placeholder: 'https://myshop.com' },
      { id: 'consumerKey', label: 'Consumer key', type: 'password' },
      { id: 'consumerSecret', label: 'Consumer secret', type: 'password' },
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'commerce',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      { id: 'shop', label: 'Shop', type: 'text', placeholder: 'store.myshopify.com' },
      { id: 'accessToken', label: 'Access token', type: 'password' },
    ],
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'crm',
    syncable: true,
    status: 'preview',
    targets: ['contacts'],
    fields: [{ id: 'token', label: 'Private app token', type: 'password' }],
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'crm',
    syncable: true,
    status: 'preview',
    targets: ['contacts'],
    fields: [{ id: 'oauth', label: 'Salesforce', type: 'oauth' }],
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    category: 'crm',
    syncable: true,
    status: 'preview',
    targets: ['contacts'],
    fields: [{ id: 'apiToken', label: 'API token', type: 'password' }],
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'crm',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      { id: 'token', label: 'Integration token', type: 'password' },
      { id: 'databaseId', label: 'Database ID', type: 'text' },
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'commerce',
    syncable: true,
    status: 'preview',
    targets: ['contacts'],
    fields: [{ id: 'apiKey', label: 'API key', type: 'password' }],
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    category: 'ops',
    syncable: true,
    status: 'preview',
    targets: ['contacts'],
    fields: [
      { id: 'apiKey', label: 'API key', type: 'password' },
      { id: 'audienceId', label: 'Audience', type: 'text' },
    ],
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    category: 'ops',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [{ id: 'oauth', label: 'Intuit', type: 'oauth' }],
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'advanced',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      { id: 'host', label: 'Host', type: 'text' },
      { id: 'port', label: 'Port', type: 'text', placeholder: '5432' },
      { id: 'database', label: 'Database', type: 'text' },
      { id: 'user', label: 'User', type: 'text' },
      { id: 'password', label: 'Password', type: 'password' },
      { id: 'ssl', label: 'SSL', type: 'text', placeholder: 'require' },
    ],
  },
  {
    id: 'mysql',
    name: 'MySQL',
    category: 'advanced',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      { id: 'host', label: 'Host', type: 'text' },
      { id: 'port', label: 'Port', type: 'text', placeholder: '3306' },
      { id: 'database', label: 'Database', type: 'text' },
      { id: 'user', label: 'User', type: 'text' },
      { id: 'password', label: 'Password', type: 'password' },
      { id: 'ssl', label: 'SSL', type: 'text', placeholder: 'REQUIRED' },
    ],
  },
  {
    id: 'rest',
    name: 'REST API',
    category: 'advanced',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      { id: 'baseUrl', label: 'Base URL', type: 'url', placeholder: 'https://' },
      { id: 'authType', label: 'Auth', type: 'text', placeholder: 'bearer' },
      { id: 'credential', label: 'Credential', type: 'password', optional: true },
      { id: 'recordsPath', label: 'Records path', type: 'text', placeholder: 'data.items' },
      { id: 'idPath', label: 'ID path', type: 'text', placeholder: 'id' },
    ],
  },
]

export const SOURCE_CATEGORY_LABEL: Record<ImportSource['category'], string> = {
  file: 'Files',
  commerce: 'Commerce',
  crm: 'CRM',
  ops: 'Other',
  advanced: 'Advanced',
}

export type ConnectedPreview = {
  id: string
  label: string
  detail: string
  meta: string
}

export const CONNECTED_PREVIEWS: ConnectedPreview[] = [
  { id: 'demo-woo', label: 'WooCommerce', detail: 'myshop.com', meta: '8m ago' },
  { id: 'demo-air', label: 'Airtable', detail: 'Sales Operations', meta: 'Yesterday' },
]
