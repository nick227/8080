import { load } from 'js-yaml'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const specPath = resolve(__dirname, '../packages/api-spec/openapi.yaml')
const spec = load(readFileSync(specPath, 'utf-8')) as any
const outDir = resolve(__dirname, '../apps/server/src/__tests__')
mkdirSync(outDir, { recursive: true })

type OpBlock = { operationId: string; block: string }
const byTag: Record<string, OpBlock[]> = {}

for (const [path, pathItem] of Object.entries<any>(spec.paths ?? {})) {
  for (const [method, op] of Object.entries<any>(pathItem)) {
    if (!op.operationId) continue

    const tag = op.tags?.[0] ?? 'default'
    const isPublic = Array.isArray(op.security) && op.security.length === 0
    const successStatus = Object.keys(op.responses ?? {}).find(s => s.startsWith('2')) ?? '200'
    const testUrl = path.replace(/\{[^}]+\}/g, '00000000-0000-0000-0000-000000000001')

    const authTest = isPublic ? '' : `
  it('requires auth', async () => {
    const res = await app.inject({ method: '${method.toUpperCase()}', url: '${testUrl}' })
    expect(res.statusCode).toBe(401)
  })
`

    const block = `
describe('${op.operationId}', () => {${authTest}
  it('${method.toUpperCase()} ${path}', async () => {
    // TODO: seed domain data (test users are pre-seeded by buildTestApp)
    const res = await app.inject({
      method: '${method.toUpperCase()}',
      url: '${testUrl}',
      ${isPublic ? '' : "headers: asAuth(testUserId),\n      "}// payload: {},
    })
    expect(res.statusCode).toBe(${successStatus})
    await validateResponse('${op.operationId}', ${successStatus}, res.json())
  })
})
`
    if (!byTag[tag]) byTag[tag] = []
    byTag[tag].push({ operationId: op.operationId, block })
  }
}

for (const [tag, ops] of Object.entries(byTag)) {
  const outPath = resolve(outDir, `${tag}.test.ts`)

  if (existsSync(outPath)) {
    const existing = readFileSync(outPath, 'utf-8')
    const newOps = ops.filter(o => !existing.includes(`describe('${o.operationId}'`))
    if (newOps.length === 0) continue
    writeFileSync(outPath, existing + newOps.map(o => o.block).join(''))
    console.log(`✓ Appended ${newOps.length} new test(s) to ${tag}.test.ts`)
  } else {
    const header = `// Generated from openapi.yaml — fill in seeds and assertions.
// Run \`pnpm test:generate\` to add stubs for new routes.
// Both test users are pre-seeded: use testOtherUserId for cross-user permission tests.
import { describe, it, expect } from 'vitest'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId } from './helpers'

const app = buildTestApp()
`
    writeFileSync(outPath, header + ops.map(o => o.block).join(''))
    console.log(`✓ Generated ${tag}.test.ts (${ops.length} operations)`)
  }
}
