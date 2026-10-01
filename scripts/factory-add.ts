import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { homedir } from 'os'

type CopyEntry = { from: string; to: string }
type Manifest = {
  name: string
  type: string
  description?: string
  requires?: string[]
  deps?: Record<string, string[]>
  copy?: CopyEntry[]
  patches?: {
    env?: string
    schema?: string
    openapi?: string
  }
  exports?: Record<string, string[]>
  manual?: string[]
}

type Args = {
  kind: 'plugin' | 'frontend-pack'
  name: string
  target: string
  templates: string
}

function parseArgs(): Args {
  const raw = process.argv.slice(2)
  const kindArg = raw.shift()
  const name = raw.shift()
  if (!kindArg || !name || !['plugin', 'frontend-pack', 'pack'].includes(kindArg)) {
    throw new Error('Usage: pnpm factory:add <plugin|frontend-pack> <name-or-path> [--target .] [--templates /path/to/skill]')
  }

  let target = process.cwd()
  let templates = process.env.NICK_WEBAPP_FACTORY_ROOT ?? ''
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--target') target = raw[++i]
    else if (raw[i] === '--templates') templates = raw[++i]
  }

  return {
    kind: kindArg === 'plugin' ? 'plugin' : 'frontend-pack',
    name,
    target: resolve(target),
    templates: findTemplateRoot(templates),
  }
}

function findTemplateRoot(explicit?: string) {
  const candidates = [
    explicit,
    process.cwd(),
    join(process.cwd(), '..'),
    join(homedir(), '.claude', 'skills', 'nick-webapp-factory'),
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    const root = resolve(candidate)
    if (existsSync(join(root, 'templates'))) return root
  }

  throw new Error('Could not find skill templates. Set NICK_WEBAPP_FACTORY_ROOT or pass --templates /path/to/nick-webapp-factory.')
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function listManifestPaths(root: string, dir: string, fileName: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listManifestPaths(root, full, fileName))
    else if (entry === fileName) out.push(full)
  }
  return out
}

function findManifest(args: Args) {
  if (args.kind === 'plugin') {
    const path = join(args.templates, 'templates', 'plugins', args.name, 'plugin.manifest.json')
    if (!existsSync(path)) throw new Error(`Plugin manifest not found: ${relative(args.templates, path)}`)
    return { manifestPath: path, sourceDir: dirname(path) }
  }

  const packRoot = join(args.templates, 'templates', 'frontend-packs')
  const direct = join(packRoot, args.name, 'pack.manifest.json')
  if (existsSync(direct)) return { manifestPath: direct, sourceDir: dirname(direct) }

  const matches = listManifestPaths(args.templates, packRoot, 'pack.manifest.json')
    .filter(path => {
      const manifest = readJson<Manifest>(path)
      return manifest.name === args.name || relative(packRoot, dirname(path)) === args.name
    })

  if (matches.length === 0) throw new Error(`Frontend pack manifest not found: ${args.name}`)
  if (matches.length > 1) {
    throw new Error(
      `Frontend pack name is ambiguous: ${args.name}\n` +
      matches.map(path => `  - ${relative(packRoot, dirname(path))}`).join('\n')
    )
  }
  return { manifestPath: matches[0], sourceDir: dirname(matches[0]) }
}

function copyFile(source: string, dest: string) {
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(source, dest)
}

function appendPatchIfPresent(sourceDir: string, target: string, pluginName: string, patch?: string) {
  if (!patch) return false
  const source = join(sourceDir, patch)
  if (!existsSync(source)) return false

  for (const file of ['.env.example', '.env']) {
    const dest = join(target, file)
    if (!existsSync(dest)) continue
    const marker = `# --- ${pluginName} env ---`
    const current = readFileSync(dest, 'utf8')
    if (current.includes(marker)) continue
    const body = readFileSync(source, 'utf8').trim()
    writeFileSync(dest, `${current.trimEnd()}\n\n${marker}\n${body}\n`)
  }
  return true
}

function copyPendingPatch(sourceDir: string, target: string, namespace: string, patch?: string) {
  if (!patch) return
  const source = join(sourceDir, patch)
  if (!existsSync(source)) return
  copyFile(source, join(target, 'docs', 'pending-patches', namespace, patch))
}

function main() {
  const args = parseArgs()
  const found = findManifest(args)
  const manifest = readJson<Manifest>(found.manifestPath)
  const namespace = `${args.kind}-${manifest.name}`
  const copied: string[] = []

  for (const entry of manifest.copy ?? []) {
    const source = join(found.sourceDir, entry.from)
    const dest = join(args.target, entry.to)
    if (!existsSync(source)) throw new Error(`Missing source file in manifest: ${entry.from}`)
    copyFile(source, dest)
    copied.push(entry.to)
  }

  const envAppended = appendPatchIfPresent(found.sourceDir, args.target, manifest.name, manifest.patches?.env)
  copyPendingPatch(found.sourceDir, args.target, namespace, manifest.patches?.schema)
  copyPendingPatch(found.sourceDir, args.target, namespace, manifest.patches?.openapi)

  console.log(`Added ${args.kind}: ${manifest.name}`)
  if (copied.length) {
    console.log('\nCopied files:')
    copied.forEach(file => console.log(`  - ${file}`))
  }
  if (envAppended) console.log('\nAppended env vars to existing .env files.')

  if (manifest.patches?.schema || manifest.patches?.openapi) {
    console.log(`\nPending structured patches copied to docs/pending-patches/${namespace}/`)
  }

  if (manifest.deps && Object.keys(manifest.deps).length) {
    console.log('\nPackage dependencies to install:')
    for (const [scope, deps] of Object.entries(manifest.deps)) {
      if (deps.length) console.log(`  ${scope}: ${deps.join(' ')}`)
    }
  }

  if (manifest.exports && Object.keys(manifest.exports).length) {
    console.log('\nBarrel exports to add:')
    for (const [file, exports] of Object.entries(manifest.exports)) {
      if (exports.length) console.log(`  ${file}: ${exports.join(', ')}`)
    }
  }

  if (manifest.manual?.length) {
    console.log('\nManual follow-up:')
    manifest.manual.forEach(item => console.log(`  - ${item}`))
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
