export type IntegrationCategory =
  | 'communication'
  | 'social'
  | 'productivity'
  | 'crm'
  | 'commerce'
  | 'developer'

export type IntegrationDef = {
  id: string
  name: string
  category: IntegrationCategory
  categoryLabel: string
  description: string
  service: string
  isNativeEmail?: boolean
  emailStrategy?: 'platform' | 'google' | 'microsoft' | 'smtp' | 'resend_domain'
  configFields: {
    key: string
    label: string
    type: 'text' | 'password' | 'select'
    placeholder: string
    defaultValue?: string
    options?: string[]
  }[]
  helpNote: string
}

export const INTEGRATIONS_CATALOG: IntegrationDef[] = [
  // Communication
  {
    id: '8080-platform',
    name: '8080 Platform Mail',
    category: 'communication',
    categoryLabel: 'Communication',
    description: 'Built-in outbound email delivery for morning briefings, workspace invitations, and team reminders.',
    service: 'platform',
    isNativeEmail: true,
    emailStrategy: 'platform',
    configFields: [
      { key: 'from', label: 'Sender Identity', type: 'text', placeholder: '8080 System Sender', defaultValue: '8080 Platform Default' },
    ],
    helpNote: 'Provided out-of-the-box by 8080. Works with no extra setup.',
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace / Gmail',
    category: 'communication',
    categoryLabel: 'Communication',
    description: 'Send automated executive briefings, client notifications, and team alerts directly from your Google account.',
    service: 'google',
    isNativeEmail: true,
    emailStrategy: 'google',
    configFields: [
      { key: 'email', label: 'Google Workspace Account', type: 'text', placeholder: 'name@yourcompany.com' },
    ],
    helpNote: 'Connects securely via Google OAuth. Briefings will appear as sent from your own team address.',
  },
  {
    id: 'microsoft-365',
    name: 'Microsoft 365 / Outlook',
    category: 'communication',
    categoryLabel: 'Communication',
    description: 'Enterprise Exchange integration for corporate email delivery, shared mailboxes, and meeting notifications.',
    service: 'microsoft',
    isNativeEmail: true,
    emailStrategy: 'microsoft',
    configFields: [
      { key: 'tenantId', label: 'Azure Tenant ID', type: 'text', placeholder: 'e.g. 72f988bf-86f1-41af-91ab-…' },
      { key: 'mailbox', label: 'Primary Mailbox', type: 'text', placeholder: 'briefs@yourcompany.com' },
    ],
    helpNote: 'Authorizes through Azure AD / Microsoft Graph API for single tenant or multi-tenant mail routing.',
  },
  {
    id: 'custom-smtp',
    name: 'Custom SMTP Relay',
    category: 'communication',
    categoryLabel: 'Communication',
    description: 'Route outbound notifications and customer emails through your own private mail server or transactional relay.',
    service: 'smtp',
    isNativeEmail: true,
    emailStrategy: 'smtp',
    configFields: [
      { key: 'host', label: 'SMTP Host', type: 'text', placeholder: 'smtp.example.com' },
      { key: 'port', label: 'Port', type: 'select', placeholder: '587', options: ['587', '465', '2525', '25'] },
      { key: 'from', label: 'From Address', type: 'text', placeholder: 'notifications@example.com' },
    ],
    helpNote: 'Supports STARTTLS and TLS encryption with full username/password or app password authentication.',
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'communication',
    categoryLabel: 'Communication',
    description: 'Dispatch daily AI briefs, priority task mentions, and pipeline stage changes directly to team channels.',
    service: 'slack',
    configFields: [
      { key: 'channel', label: 'Default Notification Channel', type: 'text', placeholder: '#company-updates', defaultValue: '#general' },
      { key: 'webhookUrl', label: 'Incoming Webhook URL', type: 'password', placeholder: 'https://hooks.slack.com/services/…' },
    ],
    helpNote: 'Broadcasts executive summaries and urgent alerts into designated public or private Slack channels.',
  },

  // Social Media & Inbound Messaging Hub
  {
    id: 'instagram',
    name: 'Instagram Professional',
    category: 'social',
    categoryLabel: 'Social & Messaging',
    description: 'Schedule feed posts, reels, and triage inbound customer direct messages and comment threads via Meta Graph API.',
    service: 'instagram',
    configFields: [
      { key: 'accountHandle', label: 'Instagram Handle', type: 'text', placeholder: '@brandname' },
      { key: 'metaPageId', label: 'Connected Facebook Page ID', type: 'text', placeholder: '1098234710293' },
    ],
    helpNote: 'Requires an Instagram Professional or Creator account linked to a Meta Business Suite page.',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    category: 'social',
    categoryLabel: 'Social & Messaging',
    description: 'Inbound customer chat inbox, automated AI support replies, and transactional broadcast notifications via WhatsApp Cloud API.',
    service: 'whatsapp',
    configFields: [
      { key: 'phoneNumberId', label: 'WhatsApp Phone Number ID', type: 'text', placeholder: '100609349281726' },
      { key: 'wabaId', label: 'WhatsApp Business Account ID (WABA)', type: 'text', placeholder: '192837465019283' },
    ],
    helpNote: 'Connects directly to Meta WhatsApp Cloud API for verified customer conversations and broadcast campaigns.',
  },
  {
    id: 'x-twitter',
    name: 'X (Twitter)',
    category: 'social',
    categoryLabel: 'Social & Messaging',
    description: 'Schedule tweets & multi-post threads, monitor brand keywords/mentions, and handle inbound direct messages.',
    service: 'twitter',
    configFields: [
      { key: 'handle', label: 'X Handle', type: 'text', placeholder: '@brandname' },
      { key: 'bearerToken', label: 'API v2 Bearer Token / App Key', type: 'password', placeholder: 'AAAAAAAAAAAAAAAAAAAAA…' },
    ],
    helpNote: 'Uses Twitter API v2 endpoints to publish media tweets and ingest inbound customer service direct messages.',
  },
  {
    id: 'facebook-pages',
    name: 'Facebook Pages & Messenger',
    category: 'social',
    categoryLabel: 'Social & Messaging',
    description: 'Publish scheduled company page updates, receive inbound Messenger inquiries, and auto-reply to post comments.',
    service: 'facebook',
    configFields: [
      { key: 'pageId', label: 'Facebook Page ID', type: 'text', placeholder: '109283746501928' },
      { key: 'pageAccessToken', label: 'Page Access Token', type: 'password', placeholder: 'EAAB…' },
    ],
    helpNote: 'Centralizes customer inquiries sent to your corporate Facebook page into the unified workspace inbox.',
  },
  {
    id: 'twilio-sms',
    name: 'Twilio SMS & Messaging',
    category: 'social',
    categoryLabel: 'Social & Messaging',
    description: 'Two-way customer SMS/MMS texting, automated appointment reminders, verification codes, and text broadcasts.',
    service: 'twilio',
    configFields: [
      { key: 'accountSid', label: 'Twilio Account SID', type: 'text', placeholder: 'ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' },
      { key: 'phoneNumber', label: 'Twilio Phone Number / Short Code', type: 'text', placeholder: '+1 (555) 000-8080' },
    ],
    helpNote: 'Routes customer text messages into workspace threads and supports automated outbound SMS drip campaigns.',
  },
  {
    id: 'telegram',
    name: 'Telegram Channels & Bot',
    category: 'social',
    categoryLabel: 'Social & Messaging',
    description: 'Broadcast scheduled alerts to public channels, run customer service bots, and receive real-time incident reports.',
    service: 'telegram',
    configFields: [
      { key: 'botToken', label: 'BotFather Token', type: 'password', placeholder: '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ' },
      { key: 'channelUsername', label: 'Channel / Chat ID', type: 'text', placeholder: '@brand_announcements or -100123456789' },
    ],
    helpNote: 'Connect your custom Telegram bot to automate messaging, broadcast news, and triage direct user commands.',
  },
  {
    id: 'discord',
    name: 'Discord Community',
    category: 'social',
    categoryLabel: 'Social & Messaging',
    description: 'Publish announcement posts to Discord channels, sync support forum threads, and alert teams on VIP member events.',
    service: 'discord',
    configFields: [
      { key: 'webhookUrl', label: 'Channel Webhook URL', type: 'password', placeholder: 'https://discord.com/api/webhooks/…' },
      { key: 'channelName', label: 'Target Channel', type: 'text', placeholder: '#announcements', defaultValue: '#announcements' },
    ],
    helpNote: 'Integrates server webhooks or bot applications to publish rich embeds and listen for community questions.',
  },
  {
    id: 'tiktok',
    name: 'TikTok Business',
    category: 'social',
    categoryLabel: 'Social & Messaging',
    description: 'Schedule video posts via TikTok Content Posting API, monitor trending sound usage, and moderate video comments.',
    service: 'tiktok',
    configFields: [
      { key: 'advertiserId', label: 'Business Account / Advertiser ID', type: 'text', placeholder: 'e.g. 7192837465019' },
      { key: 'accessToken', label: 'TikTok Marketing / Posting Token', type: 'password', placeholder: 'act.xxxxxxxx' },
    ],
    helpNote: 'Automate distribution of branded video content and sync audience engagement metrics.',
  },
  {
    id: 'threads',
    name: 'Threads (Meta)',
    category: 'social',
    categoryLabel: 'Social & Messaging',
    description: 'Schedule conversational posts, cross-publish updates from X or LinkedIn, and reply to community threads via Threads API.',
    service: 'threads',
    configFields: [
      { key: 'threadsUser', label: 'Threads Profile Handle', type: 'text', placeholder: '@brandname' },
    ],
    helpNote: 'Connects to Meta Threads API for scheduled text, image, and link posts.',
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    category: 'social',
    categoryLabel: 'Social & Messaging',
    description: 'Schedule rich product pins, sync Shopify & WooCommerce catalogs, and drive organic visual discovery traffic.',
    service: 'pinterest',
    configFields: [
      { key: 'boardId', label: 'Default Board ID or URL', type: 'text', placeholder: 'brand/featured-products' },
    ],
    helpNote: 'Auto-publishes image and video pins with outbound destination links back to your storefront.',
  },

  // Productivity
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'productivity',
    categoryLabel: 'Productivity',
    description: '2-way synchronization between 8080 tasks, scheduled project deadlines, and Google Calendar events.',
    service: 'google',
    configFields: [
      { key: 'calendarId', label: 'Primary Calendar ID', type: 'text', placeholder: 'primary or c_188…@group.calendar.google.com', defaultValue: 'primary' },
    ],
    helpNote: 'Tasks with due dates automatically block out time on your schedule, keeping teams in sync.',
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    category: 'productivity',
    categoryLabel: 'Productivity',
    description: 'Live 2-way spreadsheet syncing for customer contacts, inventory SKUs, and financial ledger items.',
    service: 'google',
    configFields: [
      { key: 'sheetId', label: 'Spreadsheet ID or URL', type: 'text', placeholder: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms' },
      { key: 'tabName', label: 'Tab / Worksheet Name', type: 'text', placeholder: 'Sheet1', defaultValue: 'Contacts' },
    ],
    helpNote: 'Rows updated in Google Sheets reflect automatically in your workspace tables and vice-versa.',
  },
  {
    id: 'google-drive',
    name: 'Google Drive & Docs',
    category: 'productivity',
    categoryLabel: 'Productivity',
    description: 'Store document attachments, signed agreements, and meeting transcripts in shared corporate Drive folders.',
    service: 'google',
    configFields: [
      { key: 'folderId', label: 'Target Folder ID', type: 'text', placeholder: 'e.g. 1a2b3c4d5e…' },
    ],
    helpNote: 'Export living documents and spreadsheets directly to Google Drive with automated backup archiving.',
  },
  {
    id: 'airtable',
    name: 'Airtable',
    category: 'productivity',
    categoryLabel: 'Productivity',
    description: 'Import bases, link relational tables, and stream live updates from Airtable views into 8080 boards.',
    service: 'airtable',
    configFields: [
      { key: 'baseId', label: 'Base ID', type: 'text', placeholder: 'appXXXXXXXXXXXXXX' },
      { key: 'tableName', label: 'Table / View Name', type: 'text', placeholder: 'Opportunities', defaultValue: 'Deals' },
      { key: 'token', label: 'Personal Access Token', type: 'password', placeholder: 'pat…' },
    ],
    helpNote: 'Ideal for migrating legacy trackers or maintaining dual-write pipelines with Airtable bases.',
  },

  // CRM & Sales
  {
    id: 'hubspot',
    name: 'HubSpot CRM',
    category: 'crm',
    categoryLabel: 'CRM & Sales',
    description: 'Sync contacts, lead pipeline stages, and company accounts between HubSpot and 8080 CRM in real-time.',
    service: 'hubspot',
    configFields: [
      { key: 'portalId', label: 'HubSpot Portal ID', type: 'text', placeholder: 'e.g. 12345678' },
      { key: 'apiKey', label: 'Private App Access Token', type: 'password', placeholder: 'pat-na1-…' },
    ],
    helpNote: 'Keep sales reps, notes, and task activities synchronized between both CRM platforms.',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'crm',
    categoryLabel: 'CRM & Sales',
    description: 'Enterprise customer relationship sync for accounts, opportunities, contact lifecycle, and activity history.',
    service: 'salesforce',
    configFields: [
      { key: 'instanceUrl', label: 'Salesforce Instance URL', type: 'text', placeholder: 'https://company.my.salesforce.com' },
      { key: 'consumerKey', label: 'Connected App Consumer Key', type: 'text', placeholder: '3MVG9…' },
    ],
    helpNote: 'Automates bi-directional sync of high-value client records and executive pipeline dashboards.',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    category: 'social',
    categoryLabel: 'Social & Messaging',
    description: 'Publish company page updates, schedule executive thought leadership posts, and enrich contact profiles.',
    service: 'linkedin',
    configFields: [
      { key: 'companyPageId', label: 'Company Page ID or Vanity URL', type: 'text', placeholder: 'e.g. company-name' },
    ],
    helpNote: 'Automatically pulls verified company details and lets team members publish corporate updates.',
  },

  // Commerce & Finance
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'commerce',
    categoryLabel: 'Commerce',
    description: 'Accept customer payments, generate one-click payment links, and monitor live MRR / cash flow in Budgets.',
    service: 'stripe',
    configFields: [
      { key: 'publishableKey', label: 'Publishable Key', type: 'text', placeholder: 'pk_live_… or pk_test_…' },
      { key: 'secretKey', label: 'Restricted API Key', type: 'password', placeholder: 'rk_live_…' },
    ],
    helpNote: 'Invoices created in 8080 include instant Stripe payment links, updating budget records upon payout.',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'commerce',
    categoryLabel: 'Commerce',
    description: 'Sync store product catalogs, live inventory SKU quantities, low stock alerts, and customer purchase records.',
    service: 'shopify',
    configFields: [
      { key: 'shopUrl', label: 'Myshopify Store Domain', type: 'text', placeholder: 'your-brand.myshopify.com' },
      { key: 'adminToken', label: 'Admin API Access Token', type: 'password', placeholder: 'shpat_…' },
    ],
    helpNote: 'Changes in 8080 Inventory immediately reflect in your Shopify store stock levels.',
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    category: 'commerce',
    categoryLabel: 'Commerce',
    description: 'Connect WordPress WooCommerce stores to manage products, inventory stock counts, and orders.',
    service: 'woocommerce',
    configFields: [
      { key: 'siteUrl', label: 'WordPress Site URL', type: 'text', placeholder: 'https://example.com' },
      { key: 'consumerKey', label: 'Consumer Key', type: 'text', placeholder: 'ck_…' },
      { key: 'consumerSecret', label: 'Consumer Secret', type: 'password', placeholder: 'cs_…' },
    ],
    helpNote: 'Synchronizes product inventory and order events using WooCommerce REST API v3.',
  },

  // Media & Developer
  {
    id: 'youtube',
    name: 'YouTube',
    category: 'developer',
    categoryLabel: 'Media & Live',
    description: 'Host live streaming video, embed training video resources, and broadcast recorded meeting archives.',
    service: 'youtube',
    configFields: [
      { key: 'channelId', label: 'Channel ID / URL', type: 'text', placeholder: 'UC… or @company' },
    ],
    helpNote: 'Enables real-time YouTube video embeds in document tabs, room floors, and daily team briefs.',
  },
  {
    id: 'rest-api',
    name: 'Inbound REST API & Webhooks',
    category: 'developer',
    categoryLabel: 'Developer',
    description: 'Push tasks, contacts, inventory, and ledger items programmatically via JSON HTTP POST endpoints.',
    service: 'webhook',
    configFields: [
      { key: 'apiKey', label: 'Workspace API Key', type: 'text', placeholder: 'ws_live_…', defaultValue: 'ws_key_auto_generated' },
    ],
    helpNote: 'Use with curl, Zapier, Make.com, or internal backend services to ingest data into 8080.',
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'developer',
    categoryLabel: 'Developer',
    description: 'Link pull requests and commits to tasks, automate issue triage, and notify teams on release merges.',
    service: 'github',
    configFields: [
      { key: 'repo', label: 'Repository (owner/repo)', type: 'text', placeholder: 'acme-inc/core-app' },
      { key: 'pat', label: 'Personal Access Token', type: 'password', placeholder: 'ghp_…' },
    ],
    helpNote: 'Links commits and branch status with 8080 task cards across Kanban boards and roadmaps.',
  },
]
