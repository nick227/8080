import type { PrefabRecord } from './meta'

export type PrefabTeamRoleData = {
  roleTitle: string
  department: string
  responsibilities: string
  hoursPerWeek: number
  estimatedRate?: {
    amount: number
    period: 'hour' | 'month' | 'year'
    currency: 'USD'
  }
  requiredSkills: string[]
  isVacant: true
}

export type PrefabTeamRole = PrefabRecord<PrefabTeamRoleData>
