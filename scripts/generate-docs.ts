import { load } from 'js-yaml'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const root = resolve(__dirname, '..')
const spec = load(readFileSync(resolve(root, 'packages/api-spec/openapi.yaml'), 'utf-8')) as any
const docsDir = resolve(root, 'docs')
mkdirSync(docsDir, { recursive: true })

// ── api-reference.md ────────────────────────────────────────────────────────

const apiLines: string[] = [
  '# API Reference',
  '',
  '> Generated from `packages/api-spec/openapi.yaml`. Do not edit by hand.',
  '',
]

const byTag: Record<string, string[]> = {}

for (const [path, pathItem] of Object.entries<any>(spec.paths ?? {})) {
  for (const [method, op] of Object.entries<any>(pathItem)) {
    const tag = op.tags?.[0] ?? 'default'
    const isPublic = Array.isArray(op.security) && op.security.length === 0
    const successStatus = Object.keys(op.responses ?? {}).find(s => s.startsWith('2')) ?? '200'
    const row = `| \`${method.toUpperCase()} ${path}\` | ${op.summary ?? op.operationId} | ${isPublic ? 'Public' : 'Auth required'} | \`${successStatus}\` |`
    if (!byTag[tag]) byTag[tag] = []
    byTag[tag].push(row)
  }
}

for (const [tag, rows] of Object.entries(byTag)) {
  apiLines.push(`## ${tag.charAt(0).toUpperCase() + tag.slice(1)}`, '')
  apiLines.push('| Endpoint | Description | Auth | Success |')
  apiLines.push('|---|---|---|---|')
  apiLines.push(...rows, '')
}

writeFileSync(resolve(docsDir, 'api-reference.md'), apiLines.join('\n'))
console.log('✓ docs/api-reference.md')

// ── env-vars.md ──────────────────────────────────────────────────────────────

const envExample = readFileSync(resolve(root, '.env.example'), 'utf-8')
const envLines: string[] = [
  '# Environment Variables',
  '',
  '> Generated from `.env.example`. Do not edit by hand.',
  '',
  '| Variable | Required | Description |',
  '|---|---|---|',
]

for (const line of envExample.split('\n')) {
  if (line.startsWith('#') || !line.trim()) continue
  const [key] = line.split('=')
  envLines.push(`| \`${key.trim()}\` | Yes | — |`)
}

writeFileSync(resolve(docsDir, 'env-vars.md'), envLines.join('\n'))
console.log('✓ docs/env-vars.md')

// ── database.md ───────────────────────────────────────────────────────────────

const schema = readFileSync(resolve(root, 'packages/db/prisma/schema.prisma'), 'utf-8')
const models = [...schema.matchAll(/^model\s+(\w+)/gm)].map(m => m[1])
const enums = [...schema.matchAll(/^enum\s+(\w+)/gm)].map(m => m[1])

const dbLines: string[] = [
  '# Database',
  '',
  '> Generated from `packages/db/prisma/schema.prisma`. Do not edit by hand.',
  '',
  '## Models',
  '',
  ...models.map(m => `- \`${m}\``),
  '',
]

if (enums.length) {
  dbLines.push('## Enums', '', ...enums.map(e => `- \`${e}\``), '')
}

writeFileSync(resolve(docsDir, 'database.md'), dbLines.join('\n'))
console.log('✓ docs/database.md')

console.log('\nAll docs generated. Run again after spec/schema changes.')
