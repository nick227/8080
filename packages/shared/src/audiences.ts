/** AND between rules; OR between values within one rule. */
export type AudienceFilters = {
  stages?: string[]; categories?: string[]; tags?: string[]; assignedTo?: string[]; location?: string[]
  hasEmail?: boolean
  attributes?: { field: string; op: 'eq' | 'gte' | 'lte' | 'before_days'; value: string | number | boolean }[]
}
export type RecipientConfig = { source: 'WORKSPACE_MEMBERS' | 'CONTACTS' | 'SELECTED_CONTACTS' | 'TRIGGER_CONTACT'; filters?: AudienceFilters; ids?: string[] }
export function audienceRules(config: RecipientConfig | null, labels: Record<string, string> = {}): { key: string; label: string }[] {
  if (!config) return []
  if (config.source === 'WORKSPACE_MEMBERS') return [{ key: 'source', label: 'Everyone on the team' }]
  if (config.source === 'TRIGGER_CONTACT') return [{ key: 'source', label: 'Contact that triggered this Agent' }]
  if (config.source === 'SELECTED_CONTACTS') return [{ key: 'source', label: `${config.ids?.length ?? 0} selected contacts` }]
  const title = (key: string) => labels[key] ?? ({ stages: 'Pipeline', categories: 'Category', tags: 'Tags', assignedTo: 'Assigned to', location: 'Location', lastContactedAt: 'Last contacted', potentialValue: 'Potential value', createdAt: 'Created date', lastActivityAt: 'Last activity' } as Record<string, string>)[key] ?? key
  const rules = Object.entries(config.filters ?? {}).flatMap(([key, value]) => key === 'attributes' ? [] : [{ key, label: key === 'hasEmail' ? `Has email: ${value ? 'Yes' : 'No'}` : `${title(key)}: ${(value as string[]).map(v => labels[v] ?? v).join(', ')}` }])
  for (const [i, a] of (config.filters?.attributes ?? []).entries()) rules.push({ key: `attribute:${i}`, label: a.op === 'before_days' ? `${title(a.field)}: not in ${a.value} days (including never)` : `${title(a.field)} ${{ eq: '=', gte: '≥', lte: '≤' }[a.op]} ${a.value}` })
  return rules.length ? rules : [{ key: 'all', label: 'All active contacts' }]
}
