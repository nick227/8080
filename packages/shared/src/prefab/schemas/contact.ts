import type { PrefabRecord } from './meta'

export type PrefabContactData = {
  firstName: string
  lastName: string
  displayName: string
  title: string
  email: string
  phone: string
  accountName: string
  location?: string
  stage: 'lead' | 'contacted' | 'qualified' | 'proposalSent' | 'won'
  isHypothetical: true
  notes?: string
}

export type PrefabContact = PrefabRecord<PrefabContactData>
