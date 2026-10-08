/** Default sales pipeline. Workspaces can rename, reorder, add, and archive stages. */
export type PipelineStageKind = 'open' | 'won' | 'lost'

export type PipelineStageDef = {
  key: string
  label: string
  position: number
  kind: PipelineStageKind
  archived: boolean
  system: boolean
}

export const DEFAULT_PIPELINE_STAGES: Omit<PipelineStageDef, 'archived'>[] = [
  { key: 'contacted', label: 'Contacted', position: 0, kind: 'open', system: true },
  { key: 'presentation', label: 'Presentation', position: 1, kind: 'open', system: true },
  { key: 'interested', label: 'Interested', position: 2, kind: 'open', system: true },
  { key: 'not_interested', label: 'Not Interested', position: 3, kind: 'lost', system: true },
]

/** Compatibility export for the standard pipeline; workspace definitions are authoritative. */
export const LEGACY_LEAD_STATUSES = DEFAULT_PIPELINE_STAGES.map((s) => s.key)
export type LegacyLeadStatus = (typeof LEGACY_LEAD_STATUSES)[number]
