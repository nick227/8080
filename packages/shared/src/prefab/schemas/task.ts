import type { PrefabRecord } from './meta'

export type PrefabTaskData = {
  title: string
  category: 'delivery' | 'sales' | 'finance' | 'operations' | 'governance' | string
  detail: string
  outcome: string
  minutes: number
  repeat?: number // 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
  priority?: 'low' | 'normal' | 'high'
  roleKey?: string
  documentKey?: string
}

export type PrefabTask = PrefabRecord<PrefabTaskData>
