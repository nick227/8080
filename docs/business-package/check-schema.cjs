const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')
const serverRequire = createRequire(resolve(__dirname, '../../apps/server/package.json'))
const Ajv = serverRequire('ajv/dist/2020').default
const addFormats = serverRequire('ajv-formats')
const base = resolve(__dirname, '../../apps/web/public/schemas/business-package')
const schema = JSON.parse(readFileSync(resolve(base, '0.1.0.schema.json'), 'utf8'))
const example = JSON.parse(readFileSync(resolve(base, 'fieldwork-studio.example.json'), 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: true })
addFormats(ajv)
const validate = ajv.compile(schema)
assert.equal(validate(example), true, JSON.stringify(validate.errors))
for (const [label, mutate] of [
  ['unsupported schema version', x => { x.schemaVersion = '99.0.0' }],
  ['numeric money', x => { x.budgets[0].lines[0].plannedAmount = 100.1 }],
  ['negative money', x => { x.budgets[0].lines[0].plannedAmount = '-1.00' }],
  ['active budget claim', x => { x.budgets[0].capability = 'live' }],
  ['invalid date', x => { x.demo.referenceDate = '2026-02-30' }],
  ['ambiguous date basis', x => { x.schedules[0].start.date = '2026-10-01' }],
  ['unknown executable field', x => { x.script = 'run something' }],
  ['people cannot grant permissions', x => { x.people[0].workspaceRole = 'owner' }],
  ['invalid profile kind', x => { x.profile.kind = 'verified' }],
]) {
  const invalid = structuredClone(example)
  mutate(invalid)
  assert.equal(validate(invalid), false, label)
}
const minimal = structuredClone(example)
for (const field of ['plan', 'documents', 'budgets', 'demo']) delete minimal[field]
for (const field of ['people', 'tasks', 'milestones', 'schedules']) minimal[field] = []
assert.equal(validate(minimal), true, JSON.stringify(validate.errors))
console.log('Business package draft: full and minimal examples pass; nine invalid structures rejected. Semantic/import validation is not implemented by this checker.')
