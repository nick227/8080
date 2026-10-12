import type { PrefabDomain } from '../schemas'

export type ManifestEntry = {
  entityType: PrefabDomain
  dbId: string
  importedAt: string
  version: number
}

export type PrefabManifest = {
  workspaceId: string
  entries: Record<string, ManifestEntry>
}

export function createEmptyManifest(workspaceId: string): PrefabManifest {
  return {
    workspaceId,
    entries: {},
  }
}

export function getManifestEntry(manifest: PrefabManifest, key: string): ManifestEntry | undefined {
  return manifest.entries[key]
}

export function recordManifestEntry(
  manifest: PrefabManifest,
  key: string,
  entityType: PrefabDomain,
  dbId: string,
  version: number,
): PrefabManifest {
  return {
    ...manifest,
    entries: {
      ...manifest.entries,
      [key]: {
        entityType,
        dbId,
        importedAt: new Date().toISOString(),
        version,
      },
    },
  }
}
