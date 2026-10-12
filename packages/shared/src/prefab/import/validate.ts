import { ALL_PACKS, ALL_BLUEPRINTS, getRecord } from '../registry'
import type { PrefabContact, PrefabAutomation, PrefabTeamRole, PrefabTask } from '../schemas'

export type ValidationReport = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validatePrefabRegistry(): ValidationReport {
  const errors: string[] = []
  const warnings: string[] = []
  const seenKeys = new Set<string>()

  // 1. Pack and record integrity
  for (const pack of ALL_PACKS) {
    if (!pack.id || !pack.name || !pack.domain) {
      errors.push(`Pack missing identity: ${JSON.stringify(pack)}`)
      continue
    }

    if (pack.records.length === 0) {
      warnings.push(`Pack ${pack.id} contains no records`)
    }

    for (const record of pack.records) {
      if (!record.key) {
        errors.push(`Record in ${pack.id} missing key`)
        continue
      }

      if (seenKeys.has(record.key)) {
        errors.push(`Duplicate key detected across registry: ${record.key}`)
      }
      seenKeys.add(record.key)

      if (record.packId !== pack.id) {
        errors.push(`Record ${record.key} packId mismatch: expected ${pack.id}, got ${record.packId}`)
      }

      // 2. Cross-reference integrity
      if (record.refs) {
        const refEntries = Object.entries(record.refs) as [string, string[] | undefined][];
        for (const [refGroup, targetKeys] of refEntries) {
          if (!Array.isArray(targetKeys)) continue;
          if (!targetKeys) continue
          for (const targetKey of targetKeys) {
            const targetRecord = getRecord(targetKey)
            if (!targetRecord) {
              errors.push(`Record ${record.key} references non-existent key in ${refGroup}: ${targetKey}`)
            }
          }
        }
      }

      // 3. Domain-specific safety and data ethics rules
      if (pack.domain === 'contacts') {
        const contact = record as PrefabContact
        if (!contact.isHypothetical) {
          errors.push(`Contact ${record.key} must be marked isHypothetical: true`)
        }
        if (!contact.source.provenance) {
          errors.push(`Contact ${record.key} missing provenance source`)
        }
      }

      if (pack.domain === 'team') {
        const role = record as PrefabTeamRole
        if (!role.isVacant) {
          errors.push(`Team role ${record.key} must be marked isVacant: true`)
        }
        if (role.hoursPerWeek <= 0) {
          errors.push(`Team role ${record.key} has invalid hoursPerWeek: ${role.hoursPerWeek}`)
        }
      }

      if (pack.domain === 'automations') {
        const auto = record as PrefabAutomation
        if (auto.status !== 'inactive') {
          errors.push(`Automation ${record.key} must initialize with status: 'inactive'`)
        }
      }

      if (pack.domain === 'tasks') {
        const task = record as PrefabTask
        if (!task.title?.trim() || !task.outcome?.trim()) {
          errors.push(`Task ${record.key} missing title or outcome`)
        }
        if (task.minutes <= 0) {
          errors.push(`Task ${record.key} minutes must be > 0`)
        }
      }
    }
  }

  // 4. Blueprint integrity
  for (const bp of ALL_BLUEPRINTS) {
    for (const [domain, packIds] of Object.entries(bp.packs)) {
      for (const packId of packIds) {
        const pack = ALL_PACKS.find(p => p.id === packId)
        if (!pack) {
          errors.push(`Blueprint ${bp.id} references non-existent pack ${packId} in ${domain}`)
        } else if (pack.domain !== domain) {
          errors.push(`Blueprint ${bp.id} pack ${packId} domain mismatch: expected ${domain}, got ${pack.domain}`)
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
