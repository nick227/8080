// Email message content for Agents (docs/agents/07 decision 5): semantic blocks the
// email presentation system renders through a template + theme. Not Documents blocks
// and never provider HTML. Text supports merge tags from MERGE_FIELDS only:
// `{{contact.firstName}}` or with a fallback, `{{contact.firstName|there}}`.

export type EmailBlock =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'image'; url: string; alt?: string; href?: string }
  | { type: 'button'; label: string; href: string }
  | { type: 'divider' }
  // A titled group of short lines with an optional link (Team reports).
  | { type: 'section'; title: string; lines: string[]; link?: { label: string; href: string } }

export type EmailContent = { version: 1; blocks: EmailBlock[] }

export const Blocks = {
  heading: (text: string): EmailBlock => ({ type: 'heading', text }),
  text: (text: string): EmailBlock => ({ type: 'text', text }),
  button: (label: string, href: string): EmailBlock => ({ type: 'button', label, href }),
  list: (items: string[]): EmailBlock => ({ type: 'list', items }),
  divider: (): EmailBlock => ({ type: 'divider' }),
  image: (url: string, alt?: string, href?: string): EmailBlock => ({ type: 'image', url, alt, href }),
  section: (title: string, lines: string[], link?: { label: string; href: string }): EmailBlock => ({ type: 'section', title, lines, link }),
}

export const EMPTY_EMAIL_CONTENT: EmailContent = { version: 1, blocks: [] }

export const MERGE_FIELDS = [
  'contact.firstName',
  'contact.fullName',
  'member.firstName',
  'member.displayName',
  'company.name',
  'company.website',
  'company.googleReviewUrl',
  'workspace.name',
] as const
export type MergeField = (typeof MERGE_FIELDS)[number]
export type MergeValues = Partial<Record<MergeField, string | null>>

export const MERGE_TAG = /\{\{\s*([a-zA-Z.]+)\s*(?:\|([^}]*))?\}\}/g

export const EMAIL_TEMPLATES = [
  { key: 'plain', name: 'Plain text' },
  { key: 'basic', name: 'Basic' },
  { key: 'bulletin', name: 'Bulletin' },
  { key: 'team_brief', name: 'Team brief' },
  { key: 'alert', name: 'Alert' },
  { key: 'transactional', name: 'Transactional' },
  { key: 'one_touch', name: 'One-touch letter' },
  { key: 'nudge', name: 'Nudge / Reminder' },
  { key: 'digest', name: 'Digest' },
  { key: 'update', name: 'Product update' },
  { key: 'event_invite', name: 'Event invite' },
  { key: 'review_request', name: 'Review request' },
  { key: 'newsletter', name: 'Newsletter' },
  { key: 'executive_report', name: 'Executive report' },
  { key: 'onboarding', name: 'Onboarding guide' },
  { key: 'case_study', name: 'Case study' },
] as const
export type EmailTemplateKey = (typeof EMAIL_TEMPLATES)[number]['key']

export const EMAIL_THEMES = [
  { key: 'company', name: 'Company' },
  { key: 'emerald', name: 'Emerald' },
  { key: 'midnight', name: 'Midnight' },
  { key: 'warm', name: 'Warm' },
  { key: 'mono', name: 'Mono' },
  { key: 'sunset', name: 'Sunset' },
  { key: 'apple', name: 'Apple Porcelain' },
  { key: 'discord', name: 'Discord Slate' },
  { key: 'monokai', name: 'Monokai Synth' },
  { key: 'brutalist', name: 'Brutalist Concrete' },
  { key: 'bauhaus', name: 'Bauhaus Primary' },
  { key: 'zen', name: 'Zen Rice Paper' },
  { key: 'editorial', name: 'Editorial Oxblood' },
  { key: 'fjord', name: 'Fjord Glacier' },
  { key: 'obsidian_gilt', name: 'Obsidian Gilt' },
  { key: 'retro_terminal', name: 'Retro Terminal' },
] as const
export type EmailThemeKey = (typeof EMAIL_THEMES)[number]['key']

const MERGE_FIELDS_SET = new Set<string>(MERGE_FIELDS)
const TEMPLATE_KEYS_SET = new Set<string>(EMAIL_TEMPLATES.map((t) => t.key))
const THEME_KEYS_SET = new Set<string>(EMAIL_THEMES.map((t) => t.key))

export const isEmailTemplateKey = (key: string): key is EmailTemplateKey => TEMPLATE_KEYS_SET.has(key)
export const isEmailThemeKey = (key: string): key is EmailThemeKey => THEME_KEYS_SET.has(key)

const LIMITS = { blocks: 60, text: 5000, short: 300, items: 30, url: 2000 }

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const isUrl = (v: unknown) => isStr(v, LIMITS.url) && /^https?:\/\/\S+$/i.test(v as string)

/** Problems with `value` as EmailContent (empty = valid), incl. unknown merge tags. */
export function emailContentProblems(value: unknown): string[] {
  const problems: string[] = []
  const v = value as EmailContent
  if (!v || typeof v !== 'object' || v.version !== 1 || !Array.isArray(v.blocks)) return ['content must be { version: 1, blocks: [] }']
  if (v.blocks.length > LIMITS.blocks) problems.push(`at most ${LIMITS.blocks} blocks`)
  const texts: string[] = []
  v.blocks.forEach((b, i) => {
    const at = `block ${i + 1}`
    switch (b?.type) {
      case 'heading':
        if (!isStr(b.text, LIMITS.short)) problems.push(`${at}: heading text`)
        else texts.push(b.text)
        break
      case 'text':
        if (!isStr(b.text, LIMITS.text)) problems.push(`${at}: text`)
        else texts.push(b.text)
        break
      case 'list':
        if (!Array.isArray(b.items) || b.items.length > LIMITS.items || !b.items.every((x) => isStr(x, LIMITS.short))) problems.push(`${at}: list items`)
        else texts.push(...b.items)
        break
      case 'image':
        if (!isUrl(b.url) || (b.alt !== undefined && !isStr(b.alt, LIMITS.short)) || (b.href !== undefined && !isUrl(b.href))) problems.push(`${at}: image`)
        break
      case 'button':
        if (!isStr(b.label, 80) || !isUrl(b.href)) problems.push(`${at}: button needs a label and an http(s) link`)
        else texts.push(b.label)
        break
      case 'divider':
        break
      case 'section':
        if (!isStr(b.title, LIMITS.short) || !Array.isArray(b.lines) || b.lines.length > LIMITS.items || !b.lines.every((x) => isStr(x, LIMITS.short)))
          problems.push(`${at}: section`)
        else if (b.link !== undefined && (!isStr(b.link.label, 80) || !isUrl(b.link.href))) problems.push(`${at}: section link`)
        else texts.push(b.title, ...b.lines)
        break
      default:
        problems.push(`${at}: unknown block type`)
    }
  })
  for (const field of unknownMergeFields(texts.join('\n'))) problems.push(`unknown merge field {{${field}}}`)
  return problems
}

export function unknownMergeFields(text: string): string[] {
  const unknown = new Set<string>()
  for (const [, field = ''] of text.matchAll(MERGE_TAG)) if (!MERGE_FIELDS_SET.has(field)) unknown.add(field)
  return [...unknown]
}

/** Replaces merge tags; a missing value uses the tag's fallback, else nothing. */
export function fillMergeTags(text: string, values: MergeValues): string {
  return text.replace(MERGE_TAG, (_, field: string, fallback?: string) => {
    const value = (values as Record<string, string | null | undefined>)[field]
    return value?.trim() ? value : (fallback ?? '').trim()
  })
}
