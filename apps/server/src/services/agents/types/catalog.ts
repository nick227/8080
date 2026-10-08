import { triggerRules } from '../businessTriggers'
import type { Agent, AgentFamily } from '@project/db'
import { Blocks, type EmailBlock, type EmailTemplateKey, type EmailThemeKey } from '@project/shared'
import { nextOccurrence, recurrenceProblems, type Recurrence } from '../../../lib/recurrence'
import { effectiveAudience, intrinsicAudience, resolveRecipients } from '../recipientSelection'
import { baseValues } from '../audiences'
import { registerAgentType, type AgentConfig, type AgentTypeDef } from '../registry'

export type CatalogTypeDef = {
  key: string
  family: AgentFamily
  name: string
  description: string
  destinations: ('email' | 'internal_chat')[]
  defaultTemplate: EmailTemplateKey
  defaultTheme: EmailThemeKey
  defaultSubject: string
  defaultBody: string
  ctaLabel?: string
  repeat?: 'daily' | 'weekly' | 'monthly'
  defaultTime?: string
}

export const defineCatalogAgent = (spec: CatalogTypeDef): CatalogTypeDef => spec

export function catalogSpec(key: string): CatalogTypeDef | undefined {
  return CATALOG_TYPES.find((c) => c.key === key)
}

const CATALOG_TYPES: CatalogTypeDef[] = [
  // ── Scheduled Email ────────────────────────────────────────────────────────
  {
    key: 'company_newsletter',
    family: 'scheduled',
    name: 'Company newsletter',
    description: 'Recurring company news and customer updates.',
    destinations: ['email'],
    defaultTemplate: 'basic',
    defaultTheme: 'company',
    defaultSubject: '{{company.name}} Monthly News & Product Highlights',
    defaultBody: 'Here are the top news, product updates, and customer highlights from {{company.name}} this month.\n\nThank you for being a valued customer!',
    ctaLabel: 'Read Full Update',
    repeat: 'monthly',
    defaultTime: '09:00',
  },
  {
    key: 'sales_catalog',
    family: 'scheduled',
    name: 'Sales catalog',
    description: 'Recurring product selection and sales content.',
    destinations: ['email'],
    defaultTemplate: 'basic',
    defaultTheme: 'company',
    defaultSubject: 'Featured Selection & Catalog Highlights from {{company.name}}',
    defaultBody: 'Explore our latest featured catalog selection and special offers from {{company.name}}.\n\nReach out to our team today to request a custom quote or learn more.',
    ctaLabel: 'Browse Sales Catalog',
    repeat: 'monthly',
    defaultTime: '10:00',
  },
  {
    key: 'internal_messages',
    family: 'team',
    name: 'Friendly messages',
    description: 'Recurring internal team notices.',
    destinations: ['email', 'internal_chat'],
    defaultTemplate: 'plain',
    defaultTheme: 'company',
    defaultSubject: 'Internal Team Notice — {{company.name}}',
    defaultBody: 'Team update from {{company.name}}:\n\nPlease review this week\'s operational priorities, project schedules, and key announcements.',
    repeat: 'weekly',
    defaultTime: '09:00',
  },

  // ── Follow-ups Email ───────────────────────────────────────────────────────
  {
    key: 'welcome_new_customer',
    family: 'followup',
    name: 'Welcome a new customer',
    description: 'Auto-send a welcome message when a contact becomes a customer.',
    destinations: ['email'],
    defaultTemplate: 'basic',
    defaultTheme: 'company',
    defaultSubject: 'Welcome to {{company.name}}! We\'re excited to have you.',
    defaultBody: 'Hi {{contact.firstName|there}},\n\nWelcome to {{company.name}}! We are thrilled to welcome you as a customer.\n\nOur team is committed to ensuring you get the absolute most out of our products and services. If you ever have questions, simply reply directly to this email.',
    ctaLabel: 'Explore Your Account',
    repeat: 'daily',
    defaultTime: '09:00',
  },
  {
    key: 'ask_for_review',
    family: 'followup',
    name: 'Ask for a review',
    description: 'Check in and request a customer review after service or purchase.',
    destinations: ['email'],
    defaultTemplate: 'basic',
    defaultTheme: 'company',
    defaultSubject: 'How did we do? We\'d love your feedback!',
    defaultBody: 'Hi {{contact.firstName|there}},\n\nThank you for choosing {{company.name}}! It was a pleasure working with you on your recent purchase.\n\nCould you take 60 seconds to share your experience? Your feedback helps us continue improving and helps others discover us.',
    ctaLabel: 'Leave a Review',
    repeat: 'daily',
    defaultTime: '14:00',
  },
  {
    key: 'checkin_no_reply',
    family: 'followup',
    name: 'Check in after no reply',
    description: 'Automatic follow-up after no activity or response.',
    destinations: ['email'],
    defaultTemplate: 'plain',
    defaultTheme: 'company',
    defaultSubject: 'Following up — checking in from {{company.name}}',
    defaultBody: 'Hi {{contact.firstName|there}},\n\nI wanted to quickly check in and see if you had any questions regarding our previous discussion or if there\'s anything else we can assist you with at {{company.name}}.\n\nLet us know if you\'d like to reconnect this week!',
    repeat: 'daily',
    defaultTime: '10:00',
  },
  {
    key: 'followup_status_change',
    family: 'followup',
    name: 'Follow up after a status change',
    description: 'Send a message when a contact status changes.',
    destinations: ['email'],
    defaultTemplate: 'plain',
    defaultTheme: 'company',
    defaultSubject: 'Account Update from {{company.name}}',
    defaultBody: 'Hi {{contact.firstName|there}},\n\nWe\'ve updated your status with {{company.name}}. We\'re looking forward to working closely with you on the next steps.\n\nPlease don\'t hesitate to reach out if you have any questions.',
    repeat: 'daily',
    defaultTime: '11:00',
  },
  {
    key: 'checkin_after_service',
    family: 'followup',
    name: 'Check in after a job or service',
    description: 'Follow up after a completed service or job.',
    destinations: ['email'],
    defaultTemplate: 'basic',
    defaultTheme: 'company',
    defaultSubject: 'Checking in after your recent service with {{company.name}}',
    defaultBody: 'Hi {{contact.firstName|there}},\n\nWe wanted to make sure everything met your expectations with your recent service job.\n\nIf you have any feedback or need any follow-up assistance, please reply to let us know!',
    ctaLabel: 'Contact Support',
    repeat: 'daily',
    defaultTime: '15:00',
  },

  // ── Manual Email ───────────────────────────────────────────────────────────
  {
    key: 'company_announcement',
    family: 'manual',
    name: 'Company announcement',
    description: 'One-time broadcast company news to customers.',
    destinations: ['email'],
    defaultTemplate: 'basic',
    defaultTheme: 'company',
    defaultSubject: 'Important Announcement from {{company.name}}',
    defaultBody: 'We are excited to share a major update with all of our customers and partners.\n\nPlease review the details below.',
    ctaLabel: 'Learn More',
  },
  {
    key: 'special_offer',
    family: 'manual',
    name: 'Special offer',
    description: 'One-time promotional campaign or discount offer.',
    destinations: ['email'],
    defaultTemplate: 'basic',
    defaultTheme: 'company',
    defaultSubject: 'Exclusive Special Offer from {{company.name}}',
    defaultBody: 'Hi {{contact.firstName|there}},\n\nFor a limited time, {{company.name}} is pleased to offer an exclusive promotional discount on our services.\n\nClaim your offer today before it expires!',
    ctaLabel: 'Claim Special Offer',
  },
  {
    key: 'event_invitation',
    family: 'manual',
    name: 'Event invitation',
    description: 'Invite customers or leads to an upcoming event.',
    destinations: ['email'],
    defaultTemplate: 'basic',
    defaultTheme: 'company',
    defaultSubject: 'You\'re invited: Join {{company.name}} for our upcoming event!',
    defaultBody: 'Hi {{contact.firstName|there}},\n\nYou\'re invited to join {{company.name}} for an exclusive interactive event and live Q&A session.\n\nReserve your spot today to participate!',
    ctaLabel: 'Register Now',
  },
  {
    key: 'important_notice',
    family: 'manual',
    name: 'Important customer notice',
    description: 'Important policy, operational or service update.',
    destinations: ['email'],
    defaultTemplate: 'plain',
    defaultTheme: 'company',
    defaultSubject: 'Important Notice regarding your {{company.name}} account',
    defaultBody: 'Hi {{contact.firstName|there}},\n\nPlease take a moment to review this essential service update and policy notice from {{company.name}}.',
  },
  {
    key: 'new_product_launch',
    family: 'manual',
    name: 'New product or service',
    description: 'Introduce a new product or service offering.',
    destinations: ['email'],
    defaultTemplate: 'basic',
    defaultTheme: 'company',
    defaultSubject: 'Introducing our newest release at {{company.name}}!',
    defaultBody: 'Hi {{contact.firstName|there}},\n\nWe are thrilled to announce our latest product line and service features at {{company.name}}!\n\nBe among the first to explore the new features.',
    ctaLabel: 'Explore New Features',
  },

  // ── Scheduled Social ───────────────────────────────────────────────────────
  {
    key: 'weekly_social_post',
    family: 'social',
    name: 'Weekly social post',
    description: 'Recurring weekly post on connected social channels.',
    destinations: ['internal_chat'],
    defaultTemplate: 'plain',
    defaultTheme: 'company',
    defaultSubject: 'Weekly Social Highlight',
    defaultBody: 'Weekly highlight from {{company.name}}: check out our latest industry tips and updates!',
    repeat: 'weekly',
    defaultTime: '10:00',
  },
  {
    key: 'product_spotlight',
    family: 'social',
    name: 'Product or service spotlight',
    description: 'Highlight a featured product or service on social media.',
    destinations: ['internal_chat'],
    defaultTemplate: 'plain',
    defaultTheme: 'company',
    defaultSubject: 'Product Spotlight',
    defaultBody: 'Product Spotlight from {{company.name}}: discover how our top tools help you achieve better results.',
    repeat: 'weekly',
    defaultTime: '12:00',
  },
  {
    key: 'company_update',
    family: 'social',
    name: 'Company update',
    description: 'Regular company milestone or updates for social followers.',
    destinations: ['internal_chat'],
    defaultTemplate: 'plain',
    defaultTheme: 'company',
    defaultSubject: 'Company Milestone',
    defaultBody: 'Company update from {{company.name}}: celebrating our team\'s latest milestone and achievements!',
    repeat: 'weekly',
    defaultTime: '14:00',
  },
  {
    key: 'promotion_schedule',
    family: 'social',
    name: 'Promotion schedule',
    description: 'Scheduled promotional series across social channels.',
    destinations: ['internal_chat'],
    defaultTemplate: 'plain',
    defaultTheme: 'company',
    defaultSubject: 'Special Promotional Series',
    defaultBody: 'Promotional alert from {{company.name}}: check out this week\'s special deals!',
    repeat: 'weekly',
    defaultTime: '16:00',
  },

  // ── Manual Social ──────────────────────────────────────────────────────────
  {
    key: 'post_announcement',
    family: 'social',
    name: 'Post an announcement',
    description: 'One-time announcement posted across social channels.',
    destinations: ['internal_chat'],
    defaultTemplate: 'plain',
    defaultTheme: 'company',
    defaultSubject: 'Social Announcement',
    defaultBody: 'Exciting news from {{company.name}}! Stay tuned for upcoming product updates.',
  },
  {
    key: 'promote_product',
    family: 'social',
    name: 'Promote a product or service',
    description: 'One-time product feature or promotional social post.',
    destinations: ['internal_chat'],
    defaultTemplate: 'plain',
    defaultTheme: 'company',
    defaultSubject: 'Product Feature',
    defaultBody: 'Featured post from {{company.name}}: check out our leading service offerings today!',
  },
  {
    key: 'share_with_followers',
    family: 'social',
    name: 'Share something with followers',
    description: 'Quick update or message shared with your social audience.',
    destinations: ['internal_chat'],
    defaultTemplate: 'plain',
    defaultTheme: 'company',
    defaultSubject: 'Message to Followers',
    defaultBody: 'Quick update from {{company.name}}: thank you to all our followers for your continued support!',
  },
]

function createAgentTypeDef(spec: CatalogTypeDef): AgentTypeDef {
  return {
    key: spec.key,
    family: spec.family,
    name: spec.name,
    description: spec.description,
    enabled: true,
    destinations: spec.destinations,
    defaults: () => ({
      name: spec.name,
      templateKey: spec.defaultTemplate,
      themeKey: spec.defaultTheme,
      recipientConfig: intrinsicAudience({ family: spec.family, typeKey: spec.key }) ?? {},
      deliveryConfig: { destinations: spec.destinations },
      ruleConfig: {
        ...(spec.family !== 'followup' && spec.repeat ? { schedule: { repeat: spec.repeat, time: spec.defaultTime ?? '09:00', ...(spec.repeat === 'monthly' ? { date: 1 } : spec.repeat === 'weekly' ? { weekday: 1 } : {}) } } : {}),
        ...(spec.family === 'followup' ? { trigger: { delayDays: 0, noReplyDays: 7 } } : {}),
        customSubject: spec.defaultSubject,
        customText: spec.defaultBody,
      },
    }),
    validate: (config: AgentConfig) => {
      const problems: string[] = []
      const rules = config.ruleConfig as { schedule?: Recurrence } | null
      if (spec.family === 'followup') { try { triggerRules(config.ruleConfig) } catch (error) { problems.push((error as { message: string }).message) } }
      if (spec.family !== 'followup' && spec.repeat && rules?.schedule) {
        problems.push(...recurrenceProblems(rules.schedule).map((p) => p[0]!.toUpperCase() + p.slice(1)))
      }
      const destinations = (config.deliveryConfig as { destinations?: string[] } | null)?.destinations
      if (!destinations?.length || destinations.some(d => !spec.destinations.includes(d as 'email' | 'internal_chat'))) problems.push('Choose a supported delivery destination.')
      return problems
    },
    schedule: (agent: Agent, after: Date, timeZone: string) => {
      if (spec.family === 'followup') return null
      const rules = agent.ruleConfig as { schedule?: Recurrence } | null
      return rules?.schedule ? nextOccurrence(rules.schedule, after, timeZone) : null
    },
    prepare: async ({ agent, event, workspace, now }) => {
      const base = await baseValues(workspace)
      const preview = event.occurrenceKey === 'preview' && !event.id
      if (!preview && !effectiveAudience(agent)) return { ok: false, code: 'MISSING_AUDIENCE', summary: 'Add recipients before starting this Agent.' }
      if (!preview && effectiveAudience(agent)?.source === 'TRIGGER_CONTACT' && !(event.context as { contactId?: string } | null)?.contactId) return { ok: false, code: 'MISSING_TRIGGER_CONTACT', summary: 'This event has no trigger contact.' }
      const destinations = (agent.deliveryConfig as { destinations?: string[] } | null)?.destinations ?? spec.destinations
      if (!destinations.length || destinations.some(d => !spec.destinations.includes(d as 'email' | 'internal_chat'))) return { ok: false, code: 'INVALID_DESTINATION', summary: 'Choose a supported delivery destination.' }
      const members = !preview && destinations.includes('email') ? await resolveRecipients(agent, event, workspace, base, now) : []
      const rules = (agent.ruleConfig as { customSubject?: string; customText?: string } | null) ?? {}
      const subject = rules.customSubject?.trim() || spec.defaultSubject
      const bodyText = rules.customText?.trim() || spec.defaultBody

      const blocks: EmailBlock[] = [Blocks.text(bodyText)]
      if (spec.ctaLabel) {
        blocks.push(Blocks.button(spec.ctaLabel, '{{workspace.url}}'))
      }

      return {
        ok: true,
        ...(destinations.includes('email') || preview ? { email: {
          subject,
          content: { version: 1, blocks },
          template: agent.templateKey as EmailTemplateKey,
          theme: agent.themeKey as EmailThemeKey,
          footer: [`${agent.name} from {{company.name}}`],
          recipients: members.map((m) => ({ ...m, dedupeKey: `${event.occurrenceKey}:${m.contactId ?? m.memberId}` })),
        } } : {}),
        ...(destinations.includes('internal_chat') ? { chat: {
          text: `${subject}\n\n${bodyText}`,
          links: [],
        } } : {}),
      }
    },
  }
}

export function registerCatalogTypes() {
  const offs = CATALOG_TYPES.map((spec) => registerAgentType(createAgentTypeDef(spec)))
  return () => offs.forEach((f) => f())
}
