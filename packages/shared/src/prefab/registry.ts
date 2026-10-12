import type { PrefabBlueprint, PrefabDomain, PrefabPack, PrefabRecord } from './schemas'
import { leanServiceTeamBlueprint } from './blueprints/lean-service-team'
import { soloOperatorBlueprint } from './blueprints/solo-operator'
import { projectStudioBlueprint } from './blueprints/project-studio'
import { agencyRolesPack } from './packs/team/agency-roles'
import { soloRolesPack } from './packs/team/solo-roles'
import { studioRolesPack } from './packs/team/studio-roles'
import { agencyDeliveryTasksPack } from './packs/tasks/agency-delivery'
import { agencyOperationsTasksPack } from './packs/tasks/agency-operations'
import { soloTasksPack } from './packs/tasks/solo-tasks'
import { publicInstitutionsContactsPack } from './packs/contacts/public-institutions'
import { agencyEquipmentInventoryPack } from './packs/inventory/agency-equipment'
import { serviceCatalogInventoryPack } from './packs/inventory/service-catalog'
import { clientAgreementsPack } from './packs/documents/client-agreements'
import { agencySopsPack } from './packs/documents/agency-sops'
import { agencyWorkflowsAutomationsPack } from './packs/automations/agency-workflows'

export const ALL_PACKS: PrefabPack<any>[] = [
  agencyRolesPack,
  soloRolesPack,
  studioRolesPack,
  agencyDeliveryTasksPack,
  agencyOperationsTasksPack,
  soloTasksPack,
  publicInstitutionsContactsPack,
  agencyEquipmentInventoryPack,
  serviceCatalogInventoryPack,
  clientAgreementsPack,
  agencySopsPack,
  agencyWorkflowsAutomationsPack,
]

export const ALL_BLUEPRINTS: PrefabBlueprint[] = [
  leanServiceTeamBlueprint,
  soloOperatorBlueprint,
  projectStudioBlueprint,
]

const packsById = new Map<string, PrefabPack<any>>(ALL_PACKS.map(p => [p.id, p]))
const blueprintsByIdOrSlug = new Map<string, PrefabBlueprint>()
for (const bp of ALL_BLUEPRINTS) {
  blueprintsByIdOrSlug.set(bp.id, bp)
  blueprintsByIdOrSlug.set(bp.slug, bp)
}

const recordsByKey = new Map<string, PrefabRecord<any>>()
for (const pack of ALL_PACKS) {
  for (const record of pack.records) {
    recordsByKey.set(record.key, record)
  }
}

export function getPack(id: string): PrefabPack<any> | undefined {
  return packsById.get(id)
}

export function getPacksForDomain(domain: PrefabDomain): PrefabPack<any>[] {
  return ALL_PACKS.filter(p => p.domain === domain)
}

export function getBlueprint(idOrSlug: string): PrefabBlueprint | undefined {
  return blueprintsByIdOrSlug.get(idOrSlug)
}

export function getAllBlueprints(): PrefabBlueprint[] {
  return ALL_BLUEPRINTS
}

export function getRecord(key: string): PrefabRecord<any> | undefined {
  return recordsByKey.get(key)
}

export function getAllRecords(): PrefabRecord<any>[] {
  return Array.from(recordsByKey.values())
}
