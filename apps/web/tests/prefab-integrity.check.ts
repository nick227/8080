import assert from 'node:assert/strict'
import {
  validatePrefabRegistry,
  ALL_PACKS,
  ALL_BLUEPRINTS,
  getBlueprint,
  resolveImportPlan,
  createEmptyManifest,
  recordManifestEntry,
} from '@project/shared'

console.log('Testing Prefab Data Architecture and Registry Integrity...')

// 1. Registry validation
const report = validatePrefabRegistry()
if (!report.valid) {
  console.error('Validation errors:', report.errors)
}
assert.equal(report.valid, true, 'Prefab registry should be valid without errors')
assert.equal(report.errors.length, 0, 'Should have zero validation errors')
console.log('✔ Registry validation passed with zero errors')

// 2. Blueprint completeness
const leanBlueprint = getBlueprint('lean-service-team')
assert.ok(leanBlueprint, 'Lean Service Team blueprint must be defined')
assert.equal(leanBlueprint.slug, 'lean-service-team')

// 3. Plan Resolution across all 6 domains
const plan = resolveImportPlan({ blueprintId: 'lean-service-team' })
assert.equal(plan.unresolvedRefs.length, 0, 'All cross-domain references in blueprint must resolve')

// Check each domain
assert.equal(plan.recordsByDomain.team.length, 5, 'Must have 5 unhired agency roles')
assert.equal(plan.recordsByDomain.documents.length, 4, 'Must have 4 agreements/SOPs')
assert.equal(plan.recordsByDomain.tasks.length, 8, 'Must have 8 structured tasks')
assert.equal(plan.recordsByDomain.contacts.length, 4, 'Must have 4 public domain contacts')
assert.equal(plan.recordsByDomain.inventory.length, 7, 'Must have 7 equipment and service catalog items')
assert.equal(plan.recordsByDomain.automations.length, 3, 'Must have 3 inactive automation recipes')
assert.equal(plan.totalCount, 31, 'Total record count must be 31 across all 6 domains')
console.log('✔ Lean Service Team resolved 31 records across all 6 domains with 0 broken references')

// 4. Data Ethics and Safety Checks
for (const contact of plan.recordsByDomain.contacts as any[]) {
  assert.equal(contact.isHypothetical, true, 'Contact must be marked hypothetical')
  assert.ok(contact.source.provenance, 'Contact must have declared provenance')
}
for (const role of plan.recordsByDomain.team as any[]) {
  assert.equal(role.isVacant, true, 'Role must be marked vacant/unhired')
}
for (const auto of plan.recordsByDomain.automations as any[]) {
  assert.equal(auto.status, 'inactive', 'Automation must be inactive')
}
console.log('✔ Data ethics and safety constraints verified (hypothetical contacts, vacant roles, inactive automations)')

// 5. Standalone Domain Pack Import Resolution
const tasksOnlyPlan = resolveImportPlan({ packIds: ['pack.tasks.agency-delivery'] })
assert.equal(tasksOnlyPlan.recordsByDomain.tasks.length, 4)
assert.ok(tasksOnlyPlan.unresolvedRefs.length > 0, 'Should report missing role references when importing tasks standalone')

// 6. Manifest persistence simulation
let manifest = createEmptyManifest('ws-test-123')
manifest = recordManifestEntry(manifest, 'role:lead-engineer', 'team', 'db-user-1', 1)
manifest = recordManifestEntry(manifest, 'doc:sow-template', 'documents', 'db-doc-1', 1)

const tasksWithManifestPlan = resolveImportPlan({
  packIds: ['pack.tasks.agency-delivery'],
  manifest,
})
const remainingUnresolved = tasksWithManifestPlan.unresolvedRefs.filter(
  r => r.recordKey === 'task:sprint-demo-prep'
)
assert.equal(remainingUnresolved.length, 0, 'Refs should resolve against workspace manifest')
console.log('✔ Manifest resolution verified: independent imports successfully map to existing DB IDs')

// 7. Verify Blueprint Budgets across all three operational models
import { blueprints, scenarioData } from '../src/features/blueprints/data'
assert.equal(blueprints.length, 3, 'Must have 3 operational blueprints')
for (const bp of blueprints) {
  const sc = scenarioData(bp, '90')
  assert.ok(sc.budget.length >= 6, `${bp.slug} must have at least 6 budget items`)
  assert.ok(sc.budget.some(b => b.direction === 'income'), `${bp.slug} must have income items`)
  assert.ok(sc.budget.some(b => b.direction === 'expense'), `${bp.slug} must have expense items`)
}
console.log('✔ Blueprint budget models verified across Solo Operator, Lean Service Team, and Project Studio')

console.log('\nAll 7 Domain Import Modal & Blueprint linkages verified successfully!')


