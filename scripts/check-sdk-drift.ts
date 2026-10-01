import { execFileSync } from 'child_process'
import { mkdirSync, readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join, resolve } from 'path'

const root = resolve(__dirname, '..')
const specPath = resolve(__dirname, '../packages/api-spec/openapi.yaml')
const committedPath = resolve(__dirname, '../packages/sdk/src/generated/types.ts')
const tempDir = resolve(root, 'node_modules/.cache/sdk-drift')
const tempPath = join(tempDir, `types-drift-${Date.now()}.ts`)
const require = createRequire(__filename)
const openapiTypescript = join(
  dirname(require.resolve('openapi-typescript/package.json', {
    paths: [resolve(root, 'packages/sdk')],
  })),
  'bin/cli.js',
)

mkdirSync(tempDir, { recursive: true })

execFileSync(process.execPath, [openapiTypescript, specPath, '-o', tempPath], {
  cwd: root,
  stdio: 'pipe',
})

const committed = readFileSync(committedPath, 'utf8').trim()
const fresh = readFileSync(tempPath, 'utf8').trim()

if (committed !== fresh) {
  console.error('❌  SDK types are out of sync with the OpenAPI spec.')
  console.error('    Run `pnpm sdk:generate` and commit the updated types.ts')
  process.exit(1)
}

console.log('✓  SDK types match the spec')
