import type { PrefabBlueprint, PrefabDomain, PrefabPack, PrefabRecord } from '../schemas'
import { getBlueprint, getPack, getRecord } from '../registry'
import type { PrefabManifest } from './manifest'

export type ResolvedImportPlan = {
  blueprint?: PrefabBlueprint
  packs: PrefabPack<any>[]
  recordsByDomain: Record<PrefabDomain, PrefabRecord<any>[]>
  totalCount: number
  unresolvedRefs: Array<{
    recordKey: string
    refType: string
    targetKey: string
  }>
  alreadyImportedKeys: string[]
}

const DOMAIN_IMPORT_ORDER: PrefabDomain[] = [
  'team',
  'documents',
  'inventory',
  'contacts',
  'tasks',
  'automations',
]

/**
 * Resolves a full Blueprint or specific Pack IDs into an ordered, validated import plan.
 */
export function resolveImportPlan({
  blueprintId,
  packIds,
  manifest,
}: {
  blueprintId?: string
  packIds?: string[]
  manifest?: PrefabManifest
}): ResolvedImportPlan {
  const blueprint = blueprintId ? getBlueprint(blueprintId) : undefined
  const targetPackIds = new Set<string>()

  if (blueprint) {
    for (const ids of Object.values(blueprint.packs)) {
      for (const id of ids) targetPackIds.add(id)
    }
  }

  if (packIds) {
    for (const id of packIds) targetPackIds.add(id)
  }

  const packs: PrefabPack<any>[] = []
  for (const packId of targetPackIds) {
    const pack = getPack(packId)
    if (pack) packs.push(pack)
  }

  const recordsByDomain: Record<PrefabDomain, PrefabRecord<any>[]> = {
    team: [],
    documents: [],
    inventory: [],
    contacts: [],
    tasks: [],
    automations: [],
  }

  const selectedRecordKeys = new Set<string>()

  for (const domain of DOMAIN_IMPORT_ORDER) {
    const domainPacks = packs.filter((p) => p.domain === domain)
    for (const p of domainPacks) {
      for (const r of p.records) {
        recordsByDomain[domain].push(r)
        selectedRecordKeys.add(r.key)
      }
    }
  }

  let totalCount = 0
  for (const records of Object.values(recordsByDomain)) {
    totalCount += records.length
  }

  // Check references against selected records and manifest
  const unresolvedRefs: ResolvedImportPlan['unresolvedRefs'] = []
  const alreadyImportedKeys: string[] = []

  for (const records of Object.values(recordsByDomain)) {
    for (const record of records) {
      if (manifest?.entries[record.key]) {
        alreadyImportedKeys.push(record.key)
      }

      if (record.refs) {
        const refEntries = Object.entries(record.refs) as [string, string[] | undefined][];
        for (const [refType, targetKeys] of refEntries) {
          if (!Array.isArray(targetKeys)) continue;
          if (!targetKeys) continue
          for (const targetKey of targetKeys) {
            const isSelected = selectedRecordKeys.has(targetKey)
            const isImported = Boolean(manifest?.entries[targetKey])
            const existsInRegistry = Boolean(getRecord(targetKey))

            if (!isSelected && !isImported) {
              unresolvedRefs.push({
                recordKey: record.key,
                refType,
                targetKey,
              })
            }
          }
        }
      }
    }
  }

  return {
    blueprint,
    packs,
    recordsByDomain,
    totalCount,
    unresolvedRefs,
    alreadyImportedKeys,
  }
}
