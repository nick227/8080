// Team family (docs/agents/06): Daily Team Brief and Daily Customer Report. Audience
// = active workspace members; destinations = email and/or company chat; one event
// fans out to both. The report is built once per event from deterministic sections.
import type { Agent, Workspace } from '@project/db'
import type { EmailBlock, EmailContent, EmailTemplateKey, EmailThemeKey } from '@project/shared'
import type { MessageLink } from '../../../lib/choice'
import { nextOccurrence, recurrenceProblems, type Recurrence } from '../../../lib/recurrence'
import { baseValues, workspaceMembers } from '../audiences'
import { registerAgentType, type AgentConfig, type AgentTypeDef } from '../registry'
import { BRIEF_SECTIONS, CUSTOMER_SECTIONS, type ReportSection, type SectionDef } from '../reports'

export const DESTINATIONS = ['email', 'internal_chat'] as const
export type Destination = (typeof DESTINATIONS)[number]

export type TeamDelivery = { destinations: Destination[] }
export type TeamRules = { schedule: Extract<Recurrence, { repeat: 'daily' }>; include: string[] }

const CHAT_TEXT_CAP = 3000
const CHAT_LINES_PER_SECTION = 3

export type Report = {
  subject: string
  content: EmailContent
  chat: { text: string; links: MessageLink[] }
  sections: ReportSection[]
}

type TeamSpec = {
  key: string
  name: string
  description: string
  sections: SectionDef[]
  time: string
  template: EmailTemplateKey
  theme: EmailThemeKey
}

const SPECS: TeamSpec[] = [
  {
    key: 'daily_team_brief',
    name: 'Daily team brief',
    description: 'A short morning view of what matters today, by email and in company chat.',
    sections: BRIEF_SECTIONS,
    time: '08:00',
    template: 'team_brief',
    theme: 'company',
  },
  {
    key: 'daily_customer_report',
    name: 'Daily customer report',
    description: 'New contacts, stage changes and follow-ups, at the end of the day.',
    sections: CUSTOMER_SECTIONS,
    time: '17:00',
    template: 'team_brief',
    theme: 'company',
  },
]

export const teamSpec = (typeKey: string) => SPECS.find((s) => s.key === typeKey)
export const isTeamType = (typeKey: string) => !!teamSpec(typeKey)

export const teamDelivery = (agent: Pick<Agent, 'deliveryConfig'>) => agent.deliveryConfig as unknown as TeamDelivery
export const teamRules = (agent: Pick<Agent, 'ruleConfig'>) => agent.ruleConfig as unknown as TeamRules

function validate(spec: TeamSpec, config: AgentConfig): string[] {
  const problems: string[] = []
  const delivery = config.deliveryConfig as Partial<TeamDelivery> | null
  const rules = config.ruleConfig as Partial<TeamRules> | null
  const destinations = Array.isArray(delivery?.destinations) ? delivery.destinations : []
  if (!destinations.length || !destinations.every((d) => (DESTINATIONS as readonly string[]).includes(d)) || new Set(destinations).size !== destinations.length)
    problems.push('Choose email, company chat, or both')
  if (rules?.schedule?.repeat !== 'daily') problems.push('Daily reports repeat daily')
  else problems.push(...recurrenceProblems(rules.schedule).map((p) => p[0]!.toUpperCase() + p.slice(1)))
  const include = Array.isArray(rules?.include) ? rules.include : []
  if (!include.length) problems.push('Include at least one section')
  if (!include.every((k) => spec.sections.some((s) => s.key === k))) problems.push('Unknown section')
  return problems
}

const dayLabel = (at: Date, timeZone: string) => new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(at)
const shortDay = (at: Date, timeZone: string) => new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(at)

/** The report as of `at`: email blocks and the company-chat post carry the same facts. */
export async function buildReport(spec: TeamSpec, workspace: Workspace, include: string[], at: Date): Promise<Report> {
  const chosen = spec.sections.filter((s) => include.includes(s.key))
  const sections = await Promise.all(chosen.map((s) => s.build(workspace, at)))
  const day = dayLabel(at, workspace.timezone)
  const busy = sections.filter((s) => s.count)
  const summary = busy.length ? busy.map((s) => `${s.title}: ${s.count}`).join(' · ') : 'Nothing needs attention today.'

  const blocks: EmailBlock[] = [
    { type: 'text', text: `${day}\n${summary}` },
    ...sections.map((s): EmailBlock => ({ type: 'section', title: s.count ? `${s.title} · ${s.count}` : s.title, lines: s.lines })),
  ]
  const appUrl = (process.env.APP_URL ?? process.env.CORS_ORIGIN ?? '').split(',')[0]?.trim()
  if (appUrl && /^https?:\/\//.test(appUrl)) blocks.push({ type: 'button', label: 'Open {{workspace.name}}', href: appUrl })

  // Company chat shows a message as one paragraph (line breaks collapse), so the post
  // is written as sentences: the busy sections with their first few items.
  const named = busy.map((s) => `${s.title}: ${s.count} (${s.lines.slice(0, CHAT_LINES_PER_SECTION).join('; ')})`)
  const quiet = busy.length && busy.length < sections.length ? ' Nothing else needs attention.' : ''
  const chatText = `${spec.name} · ${day}. ${busy.length ? `${named.join('. ')}.${quiet}` : 'Nothing needs attention today.'}`
  const links = sections.flatMap((s) => s.links)
  const seen = new Set<string>()
  return {
    subject: `${spec.name} · ${shortDay(at, workspace.timezone)}`,
    content: { version: 1, blocks },
    chat: {
      text: chatText.slice(0, CHAT_TEXT_CAP),
      links: links.filter((l) => !seen.has(`${l.type}:${l.id}`) && seen.add(`${l.type}:${l.id}`)).slice(0, 6),
    },
    sections,
  }
}

export const teamFooter = (spec: TeamSpec) => [`${spec.name} from {{company.name}}, sent to the members of {{workspace.name}}.`]

function teamType(spec: TeamSpec): AgentTypeDef {
  return {
    key: spec.key,
    family: 'team',
    name: spec.name,
    description: spec.description,
    enabled: true,
    destinations: DESTINATIONS,
    defaults: () => ({
      name: spec.name,
      templateKey: spec.template,
      themeKey: spec.theme,
      recipientConfig: { source: 'WORKSPACE_MEMBERS' },
      deliveryConfig: { destinations: ['email', 'internal_chat'] } satisfies TeamDelivery,
      ruleConfig: { schedule: { repeat: 'daily', time: spec.time }, include: spec.sections.map((s) => s.key) } satisfies TeamRules,
    }),
    validate: (config) => validate(spec, config),
    schedule: (agent, after, timeZone) => nextOccurrence(teamRules(agent).schedule, after, timeZone),
    prepare: async ({ agent, event, workspace }) => {
      const destinations = teamDelivery(agent).destinations
      const report = await buildReport(spec, workspace, teamRules(agent).include, event.scheduledFor)
      const base = await baseValues(workspace)
      return {
        ok: true,
        ...(destinations.includes('email')
          ? {
              email: {
                subject: report.subject,
                content: report.content,
                template: agent.templateKey as EmailTemplateKey,
                theme: agent.themeKey as EmailThemeKey,
                footer: teamFooter(spec),
                // One report per member per occurrence, however often it is prepared.
                recipients: (await workspaceMembers(workspace, base)).map((r) => ({ ...r, dedupeKey: `${event.occurrenceKey}:${r.memberId}` })),
              },
            }
          : {}),
        ...(destinations.includes('internal_chat') ? { chat: report.chat } : {}),
      }
    },
  }
}

export function registerTeamTypes() {
  const off = SPECS.map((spec) => registerAgentType(teamType(spec)))
  return () => off.forEach((f) => f())
}
