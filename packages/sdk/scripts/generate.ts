import { execFileSync } from 'child_process'
import { mkdirSync } from 'fs'
import path from 'path'
import { createRequire } from 'module'

const specPath = path.resolve(__dirname, '../../api-spec/openapi.yaml')
const outDir = path.resolve(__dirname, '../src/generated')
const typesOut = path.resolve(outDir, 'types.ts')
const require = createRequire(__filename)
const openapiTypescript = path.join(
  path.dirname(require.resolve('openapi-typescript/package.json')),
  'bin/cli.js',
)

mkdirSync(outDir, { recursive: true })

execFileSync(process.execPath, [openapiTypescript, specPath, '-o', typesOut], { stdio: 'inherit' })
console.log('✓ TypeScript types generated → src/generated/types.ts')
