import type { PrefabRecord } from './meta'

export type PrefabDocumentData = {
  title: string
  kind: 'doc' | 'sheet' | 'sop' | 'agreement'
  summary: string
  content: string
  requiresReview: boolean
}

export type PrefabDocument = PrefabRecord<PrefabDocumentData>
