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
  hint?: string
  required?: boolean
}

export type ImportSource = {
  id: SourceId
  name: string
  blurb: string
  /** Grouping in the picker */
  category: 'file' | 'commerce' | 'crm' | 'ops' | 'advanced'
  /** Remote systems that can Keep synced (one-way into us). CSV is import-once only. */
  syncable: boolean
  /** `available` = wired today; `preview` = UI only */
  status: 'available' | 'preview'
  /** Which desks this source naturally feeds */
  targets: ('contacts' | 'inventory')[]
  fields: ConnectField[]
}

export const IMPORT_SOURCES: ImportSource[] = [
  {
    id: 'csv',
    name: 'Upload CSV',
    blurb: 'Universal escape hatch. Import once from a file.',
    category: 'file',
    syncable: false,
    status: 'available',
    targets: ['contacts', 'inventory'],
    fields: [],
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    blurb: 'Live spreadsheet tabs as a structured source.',
    category: 'file',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      {
        id: 'oauth',
        label: 'Google account',
        type: 'oauth',
        hint: 'Sign in with Google. Spreadsheet access uses OAuth — not a pasted URL alone.',
        required: true,
      },
      {
        id: 'spreadsheetId',
        label: 'Spreadsheet',
        type: 'text',
        hint: 'Pick from Drive after sign-in, or paste the spreadsheet ID.',
        required: true,
      },
      {
        id: 'sheetName',
        label: 'Sheet tab',
        type: 'text',
        hint: 'Discovered after the spreadsheet is selected.',
        required: true,
      },
      {
        id: 'range',
        label: 'Range (optional)',
        type: 'text',
        hint: 'e.g. A1:G500. Leave blank for the used range.',
      },
    ],
  },
  {
    id: 'airtable',
    name: 'Airtable',
    blurb: 'Custom bases — great for ops and contact lists.',
    category: 'crm',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      {
        id: 'token',
        label: 'Personal access token',
        type: 'password',
        hint: 'Airtable → Developer hub → Personal access tokens. Needs data.records:read.',
        required: true,
      },
      {
        id: 'baseId',
        label: 'Base',
        type: 'text',
        hint: 'Discovered after the token is validated, or paste appXXXX…',
        required: true,
      },
      {
        id: 'tableId',
        label: 'Table',
        type: 'text',
        hint: 'Discovered from the base. Contacts or products live here.',
        required: true,
      },
      {
        id: 'viewId',
        label: 'View (optional)',
        type: 'text',
        hint: 'Limit import to one view’s filtered/sorted rows.',
      },
    ],
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    blurb: 'Customers, products, and inventory from a WordPress shop.',
    category: 'commerce',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      {
        id: 'storeUrl',
        label: 'Store URL',
        type: 'url',
        hint: 'https://myshop.com — the public site root, not /wp-admin.',
        required: true,
      },
      {
        id: 'consumerKey',
        label: 'Consumer key',
        type: 'password',
        hint: 'WooCommerce → Settings → Advanced → REST API → Add key (Read).',
        required: true,
      },
      {
        id: 'consumerSecret',
        label: 'Consumer secret',
        type: 'password',
        required: true,
      },
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    blurb: 'Customers and products from a Shopify store.',
    category: 'commerce',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      {
        id: 'shop',
        label: 'Shop domain',
        type: 'text',
        hint: 'mystore.myshopify.com',
        required: true,
      },
      {
        id: 'accessToken',
        label: 'Admin API access token',
        type: 'password',
        hint: 'From a custom app with read_customers / read_products.',
        required: true,
      },
    ],
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    blurb: 'CRM contacts and companies.',
    category: 'crm',
    syncable: true,
    status: 'preview',
    targets: ['contacts'],
    fields: [
      {
        id: 'token',
        label: 'Private app token',
        type: 'password',
        hint: 'Or connect with OAuth later. Needs crm.objects.contacts read.',
        required: true,
      },
    ],
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    blurb: 'Enterprise CRM contacts and accounts.',
    category: 'crm',
    syncable: true,
    status: 'preview',
    targets: ['contacts'],
    fields: [
      {
        id: 'oauth',
        label: 'Salesforce account',
        type: 'oauth',
        hint: 'OAuth is the right path — avoid username/password in product.',
        required: true,
      },
    ],
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    blurb: 'Pipeline people and organizations.',
    category: 'crm',
    syncable: true,
    status: 'preview',
    targets: ['contacts'],
    fields: [
      {
        id: 'apiToken',
        label: 'API token',
        type: 'password',
        hint: 'Pipedrive → Personal preferences → API.',
        required: true,
      },
    ],
  },
  {
    id: 'notion',
    name: 'Notion',
    blurb: 'Database pages as contact or catalog rows.',
    category: 'crm',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      {
        id: 'token',
        label: 'Integration token',
        type: 'password',
        required: true,
      },
      {
        id: 'databaseId',
        label: 'Database ID',
        type: 'text',
        hint: 'Share the database with your Notion integration first.',
        required: true,
      },
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    blurb: 'Customers from payments.',
    category: 'commerce',
    syncable: true,
    status: 'preview',
    targets: ['contacts'],
    fields: [
      {
        id: 'apiKey',
        label: 'Restricted API key',
        type: 'password',
        hint: 'Read-only customers (and optionally products).',
        required: true,
      },
    ],
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    blurb: 'Audience members as contacts.',
    category: 'ops',
    syncable: true,
    status: 'preview',
    targets: ['contacts'],
    fields: [
      {
        id: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
      },
      {
        id: 'audienceId',
        label: 'Audience',
        type: 'text',
        hint: 'Discovered after the key is validated.',
        required: true,
      },
    ],
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    blurb: 'Customers and items from accounting.',
    category: 'ops',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      {
        id: 'oauth',
        label: 'Intuit account',
        type: 'oauth',
        hint: 'Connect with Intuit OAuth; company is chosen after sign-in.',
        required: true,
      },
    ],
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    blurb: 'Remote database — deliberate setup, not a single URL field.',
    category: 'advanced',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      { id: 'host', label: 'Host', type: 'text', required: true },
      { id: 'port', label: 'Port', type: 'text', hint: '5432', required: true },
      { id: 'database', label: 'Database', type: 'text', required: true },
      { id: 'user', label: 'User', type: 'text', required: true },
      { id: 'password', label: 'Password', type: 'password', required: true },
      {
        id: 'ssl',
        label: 'SSL mode',
        type: 'text',
        hint: 'require · prefer · disable. Private networking / SSH tunnel comes later.',
        required: true,
      },
    ],
  },
  {
    id: 'mysql',
    name: 'MySQL',
    blurb: 'Remote database — same deliberate setup as Postgres.',
    category: 'advanced',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      { id: 'host', label: 'Host', type: 'text', required: true },
      { id: 'port', label: 'Port', type: 'text', hint: '3306', required: true },
      { id: 'database', label: 'Database', type: 'text', required: true },
      { id: 'user', label: 'User', type: 'text', required: true },
      { id: 'password', label: 'Password', type: 'password', required: true },
      {
        id: 'ssl',
        label: 'SSL mode',
        type: 'text',
        hint: 'REQUIRED · PREFERRED · DISABLED.',
        required: true,
      },
    ],
  },
  {
    id: 'rest',
    name: 'REST API',
    blurb: 'Generic HTTP source — auth, path, pagination, and IDs.',
    category: 'advanced',
    syncable: true,
    status: 'preview',
    targets: ['contacts', 'inventory'],
    fields: [
      { id: 'baseUrl', label: 'Base URL', type: 'url', required: true },
      {
        id: 'authType',
        label: 'Auth type',
        type: 'text',
        hint: 'none · bearer · basic · api-key header',
        required: true,
      },
      { id: 'credential', label: 'Credential', type: 'password' },
      {
        id: 'recordsPath',
        label: 'Records JSON path',
        type: 'text',
        hint: 'e.g. data.items',
        required: true,
      },
      {
        id: 'idPath',
        label: 'Record ID path',
        type: 'text',
        hint: 'e.g. id',
        required: true,
      },
    ],
  },
]

export const SOURCE_CATEGORY_LABEL: Record<ImportSource['category'], string> = {
  file: 'Files & sheets',
  commerce: 'Commerce',
  crm: 'CRM & workspaces',
  ops: 'Marketing & books',
  advanced: 'Advanced',
}

export function sourceById(id: SourceId): ImportSource {
  const source = IMPORT_SOURCES.find((entry) => entry.id === id)
  if (!source) throw new Error(`Unknown import source: ${id}`)
  return source
}

/** Placeholder “already connected” cards for the picker layout. */
export type ConnectedPreview = {
  id: string
  sourceId: SourceId
  label: string
  detail: string
  lastSynced: string
  action: string
}

export const CONNECTED_PREVIEWS: ConnectedPreview[] = [
  {
    id: 'demo-woo',
    sourceId: 'woocommerce',
    label: 'WooCommerce',
    detail: 'myshop.com',
    lastSynced: 'Last synced 8 min ago',
    action: 'Import customers',
  },
  {
    id: 'demo-air',
    sourceId: 'airtable',
    label: 'Airtable',
    detail: 'Sales Operations',
    lastSynced: 'Connected',
    action: 'Import contacts',
  },
]
