// Built-in Agent types (docs/agents/03). Each type supplies its family, allowed
// destinations, defaults, config validation, schedule and how an event is prepared.
// There is no generic workflow engine: the user customizes an instance of a type.
import type { Agent, AgentDestination, AgentEvent, AgentFamily, Workspace } from '@project/db'
import type { EmailContent, EmailTemplateKey, EmailThemeKey, MergeValues } from '@project/shared'
import type { Occurrence } from '../../lib/recurrence'

export type AgentConfig = Pick<Agent, 'recipientConfig' | 'deliveryConfig' | 'ruleConfig'>

export type EmailRecipient = {
  /** Null/invalid = a visible MISSING_EMAIL failure for this recipient, never a silent drop. */
  address: string | null
  /** Who it is, for failures ("Sarah Martinez"). */
  label: string
  contactId?: string
  memberId?: string
  /** Type-defined duplicate key; a live target with the same key on this Agent → SKIPPED. */
  dedupeKey?: string | null
  values: MergeValues
}

export type PreparedEmail = {
  subject: string
  content: EmailContent
  template: EmailTemplateKey
  theme: EmailThemeKey
  footer?: string[]
  recipients: EmailRecipient[]
}

export type Prepared =
  | { ok: true; messageId?: string | null; email?: PreparedEmail }
  // Nothing can be sent (e.g. no READY message): the event fails visibly.
  | { ok: false; code: string; summary: string }

export type PrepareContext = { agent: Agent; event: AgentEvent; workspace: Workspace; now: Date }

export type AgentTypeDef = {
  key: string
  family: AgentFamily
  name: string
  description: string
  /** Hidden from Add Agent until its source signal exists (docs/agents/05 phase 4). */
  enabled: boolean
  destinations: readonly AgentDestination[]
  defaults: (workspace: Workspace) => { name: string; templateKey: EmailTemplateKey; themeKey: EmailThemeKey } & {
    recipientConfig: object
    deliveryConfig: object
    ruleConfig: object
  }
  /** Problems with a config (empty = publishable). */
  validate: (config: AgentConfig) => string[]
  /** Scheduled types: the next occurrence strictly after `after`, in the workspace zone. */
  schedule?: (agent: Agent, after: Date, timeZone: string) => Occurrence | null
  prepare: (ctx: PrepareContext) => Promise<Prepared>
}

const types = new Map<string, AgentTypeDef>()

export function registerAgentType(def: AgentTypeDef) {
  types.set(def.key, def)
  return () => {
    if (types.get(def.key) === def) types.delete(def.key)
  }
}

export const getAgentType = (key: string) => types.get(key)
export const listAgentTypes = () => [...types.values()]
