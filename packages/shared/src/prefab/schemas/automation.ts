import type { PrefabRecord } from './meta'

export type PrefabAutomationData = {
  name: string
  family: 'scheduled' | 'followup' | 'manual' | 'team' | 'social'
  typeKey: string
  scheduleHint: string
  description: string
  config: Record<string, unknown>
  status: 'inactive'
}

export type PrefabAutomation = PrefabRecord<PrefabAutomationData>
