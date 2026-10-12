export type PrefabProvenance = 'public-domain' | 'open-government' | 'synthetic-editorial'

export type PrefabSource = {
  provenance: PrefabProvenance
  sourceUrl?: string
  license?: string
  verifiedAt?: string
}

export type PrefabRefs = {
  roles?: string[]
  documents?: string[]
  tasks?: string[]
  contacts?: string[]
  inventory?: string[]
  automations?: string[]
}

export type PrefabRecord<T> = T & {
  key: string
  packId: string
  version: number
  refs?: PrefabRefs
  source: PrefabSource
}

export type PrefabDomain = 'tasks' | 'contacts' | 'inventory' | 'team' | 'documents' | 'automations'

export type PrefabPack<T = unknown> = {
  id: string
  domain: PrefabDomain
  name: string
  description: string
  records: PrefabRecord<T>[]
}

export type PrefabBlueprint = {
  id: string
  slug: string
  name: string
  subtitle: string
  description: string
  packs: {
    tasks: string[]
    contacts: string[]
    inventory: string[]
    team: string[]
    documents: string[]
    automations: string[]
  }
}
