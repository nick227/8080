import { load } from 'js-yaml'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const root = resolve(__dirname, '..')
const specPath = resolve(root, 'packages/api-spec/openapi.yaml')
const spec = load(readFileSync(specPath, 'utf-8')) as any
const pagesDir = resolve(root, 'apps/web/src/pages')
const appPath = resolve(root, 'apps/web/src/App.tsx')

mkdirSync(pagesDir, { recursive: true })

// ---------------------------------------------------------------------------
// Field inference
// ---------------------------------------------------------------------------

type FieldType = 'text' | 'email' | 'password' | 'textarea' | 'url' | 'tel'

interface InferredField {
  name: string
  label: string
  type: FieldType
  voice: boolean
  required: boolean
  rows?: number
  zodExpr: string
}

function inferFieldType(name: string, schema: any): { type: FieldType; voice: boolean } {
  const n = name.toLowerCase()

  if (schema.format === 'email' || n.includes('email'))
    return { type: 'email', voice: false }
  if (schema.format === 'password' || /password|passwd/.test(n))
    return { type: 'password', voice: false }
  if (/phone|tel|mobile/.test(n))
    return { type: 'tel', voice: false }
  if (schema.format === 'uri' || /url|website|link|avatar|image|photo|cover/.test(n))
    return { type: 'url', voice: false }

  const longText =
    (schema.maxLength && schema.maxLength > 200) ||
    /bio|body|description|content|message|note|about|summary/.test(n)
  if (longText)
    return { type: 'textarea', voice: true }

  const voiceText = /^name$|title|about|summary|bio|body|description|content|message|note/.test(n)
  return { type: 'text', voice: voiceText }
}

function buildZodExpr(type: FieldType, schema: any, required: boolean): string {
  let expr: string
  switch (type) {
    case 'email':
      expr = 'z.string().email()'
      break
    case 'password':
      expr = `z.string().min(${schema.minLength ?? 8})`
      break
    case 'url':
      expr = 'z.string().url()'
      break
    case 'tel':
      expr = 'z.string()'
      break
    case 'textarea':
    case 'text':
    default: {
      let s = 'z.string()'
      if (schema.minLength) s += `.min(${schema.minLength})`
      if (schema.maxLength) s += `.max(${schema.maxLength})`
      expr = s
      break
    }
  }
  return required ? expr : `${expr}.optional().or(z.literal(''))`
}

const SKIP_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt', 'authorId', 'userId'])

function extractFields(requestBody: any): InferredField[] {
  const schema = resolveSchema(requestBody?.content?.['application/json']?.schema)
  if (!schema?.properties) return []

  const required: string[] = schema.required ?? []

  return Object.entries<any>(schema.properties)
    .filter(([name]) => !SKIP_FIELDS.has(name))
    .map(([name, prop]) => {
      const isRequired = required.includes(name)
      const { type, voice } = inferFieldType(name, prop)
      const label = name
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (c) => c.toUpperCase())
        .trim()
      return {
        name,
        label,
        type,
        voice,
        required: isRequired,
        rows: type === 'textarea' ? 4 : undefined,
        zodExpr: buildZodExpr(type, prop, isRequired),
      }
    })
}

function renderFieldConfigs(fields: InferredField[]): string {
  if (fields.length === 0) return '[]'
  const lines = fields.map((f) => {
    const parts = [
      `name: '${f.name}'`,
      `label: '${f.label}'`,
      `type: '${f.type}'`,
      `voice: ${f.voice}`,
      `required: ${f.required}`,
    ]
    if (f.rows) parts.push(`rows: ${f.rows}`)
    return `  { ${parts.join(', ')} },`
  })
  return `[\n${lines.join('\n')}\n]`
}

function renderZodSchema(fields: InferredField[]): string {
  if (fields.length === 0) return 'z.object({})'
  const lines = fields.map((f) => `  ${f.name}: ${f.zodExpr},`)
  return `z.object({\n${lines.join('\n')}\n})`
}

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

type Pattern = 'list' | 'detail' | 'create-form' | 'edit-form' | 'auth' | 'skip'

const SKIP_OP_IDS = /logout|^getCurrentUser$|readAll|markRead|^toggleFollow$|^toggleReaction$/i
const SKIP_PATHS = /\/reactions|\/follows\/[^/]+$/

function detectPattern(path: string, method: string, op: any): Pattern {
  if (method === 'delete') return 'skip'
  if (SKIP_OP_IDS.test(op.operationId)) return 'skip'
  if (SKIP_PATHS.test(path)) return 'skip'

  if (/login|register|signup/i.test(op.operationId)) return 'auth'

  if (method === 'post') return 'create-form'
  if (method === 'put' || method === 'patch') return 'edit-form'
  if (method === 'get') return path.includes('{') ? 'detail' : 'list'

  return 'skip'
}

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

function toHookName(operationId: string, method: string): string {
  if (method === 'get') {
    // Strip leading get/list/fetch verb so: getFeed → useFeed, listUsers → useUsers
    const stripped = operationId.replace(/^(get|list|fetch)([A-Z])/, (_, _v, c: string) =>
      c.toLowerCase()
    )
    return 'use' + stripped.charAt(0).toUpperCase() + stripped.slice(1)
  }
  return 'use' + operationId.charAt(0).toUpperCase() + operationId.slice(1)
}

function toPageName(operationId: string, method: string): string {
  if (method === 'get') {
    // Strip leading verb: getFeed → FeedPage, listUsers → UsersPage
    const stripped = operationId.replace(/^(get|list|fetch)([A-Z])/, (_, _v, c: string) =>
      c.toLowerCase()
    )
    const base = stripped.charAt(0).toUpperCase() + stripped.slice(1)
    return base.endsWith('Page') ? base : base + 'Page'
  }
  // Mutations keep the verb to prevent collisions: createPost → CreatePostPage
  const base = operationId.charAt(0).toUpperCase() + operationId.slice(1)
  return base.endsWith('Page') ? base : base + 'Page'
}

function toRouteSegment(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ':$1')
}

function toPageRoute(path: string, pattern: Pattern, operationId: string): string {
  if (pattern === 'auth') {
    if (/register|signup/i.test(operationId)) return '/register'
    if (/login|signin/i.test(operationId)) return '/login'
  }
  return toRouteSegment(path)
}

function firstPathParam(path: string): string {
  const m = path.match(/\{([^}]+)\}/)
  return m ? m[1] : 'id'
}

function resolveRef(ref: string): any {
  const parts = ref.replace(/^#\//, '').split('/')
  return parts.reduce((current, part) => current?.[part], spec)
}

function resolveSchema(schema: any): any {
  if (schema?.$ref) return resolveRef(schema.$ref)
  return schema
}

function resolveParameter(param: any): any {
  if (param?.$ref) return resolveRef(param.$ref)
  return param
}

function successResponseSchema(op: any): any {
  const status = Object.keys(op.responses ?? {}).find((s) => s.startsWith('2')) ?? '200'
  return resolveSchema(op.responses?.[status]?.content?.['application/json']?.schema)
}

function queryParamNames(op: any): Set<string> {
  return new Set(
    (op.parameters ?? [])
      .map(resolveParameter)
      .filter((param: any) => param?.in === 'query')
      .map((param: any) => param.name)
  )
}

function hasPaginatedEnvelope(op: any): boolean {
  const schema = successResponseSchema(op)
  const meta = resolveSchema(schema?.properties?.meta)
  return Boolean(
    schema?.properties?.data?.type === 'array' &&
      meta?.properties?.nextCursor &&
      meta?.properties?.hasMore
  )
}

// ---------------------------------------------------------------------------
// Page generators
// ---------------------------------------------------------------------------

function genListPage(name: string, hook: string, op: any): string {
  const title = name.replace(/Page$/, '').replace(/([A-Z])/g, ' $1').trim()
  const params = queryParamNames(op)
  const hasSearch = params.has('q')
  const isPaginated = params.has('cursor') || hasPaginatedEnvelope(op)
  const reactImport = hasSearch ? "import { useState } from 'react'\n" : ''
  const inputImport = hasSearch ? "import { Input } from '@/components/ui/Input'\n" : ''
  const hookArgs = hasSearch ? 'q ? { q } : undefined' : ''
  const hookCall = `${hook}(${hookArgs})`
  const dataAccess = isPaginated
    ? 'data?.pages.flatMap((page) => page.data) ?? []'
    : 'data?.data ?? []'
  const paginationBits = isPaginated
    ? ', fetchNextPage, hasNextPage, isFetchingNextPage'
    : ''
  const searchBlock = hasSearch
    ? `
      <Input
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Search ${title.toLowerCase()}..."
        className="w-full"
      />`
    : ''
  const loadMoreBlock = isPaginated
    ? `
      {hasNextPage && (
        <button
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="w-full py-3 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {isFetchingNextPage ? 'Loading...' : 'Load more'}
        </button>
      )}`
    : ''

  return `${reactImport}import { ${hook} } from '@project/sdk'
import { Card, CardContent } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
${inputImport}import { List } from 'lucide-react'

export function ${name}() {
  ${hasSearch ? "const [q, setQ] = useState('')" : ''}
  const { data, isLoading${paginationBits} } = ${hookCall}

  if (isLoading) return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  )

  const items = ${dataAccess}

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">${title}</h1>
${searchBlock}
      {items.length === 0 ? (
        <EmptyState
          icon={List}
          title="Nothing here yet"
          description="Items will appear here once created."
        />
      ) : (
        items.map((item: any) => (
          <Card key={item.id}>
            <CardContent className="py-4">
              {/* TODO: replace with real fields */}
              <pre className="text-xs text-muted-foreground overflow-auto">
                {JSON.stringify(item, null, 2)}
              </pre>
            </CardContent>
          </Card>
        ))
      )}
${loadMoreBlock}
    </div>
  )
}
`
}

function genDetailPage(name: string, hook: string, _op: any, path: string): string {
  const param = firstPathParam(path)
  const title = name.replace(/Page$/, '').replace(/([A-Z])/g, ' $1').trim()
  return `import { useParams } from 'react-router-dom'
import { ${hook} } from '@project/sdk'
import { Card, CardContent } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

export function ${name}() {
  const { ${param} } = useParams<{ ${param}: string }>()
  const { data, isLoading } = ${hook}(${param}!)

  if (isLoading) return <Skeleton className="h-48 w-full" />

  const item = data?.data
  if (!item) return <p className="text-muted-foreground">Not found.</p>

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">${title}</h1>
      <Card>
        <CardContent className="py-4">
          {/* TODO: replace with real fields */}
          <pre className="text-xs text-muted-foreground overflow-auto">
            {JSON.stringify(item, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
`
}

function genCreateFormPage(name: string, hook: string, fields: InferredField[]): string {
  const title = name.replace(/^Create/, '').replace(/Page$/, '').replace(/([A-Z])/g, ' $1').trim()
  const fieldConfigs = renderFieldConfigs(fields)
  const schema = renderZodSchema(fields)
  return `import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { ${hook} } from '@project/sdk'
import { Form } from '@/components/ui/Form'
import type { FieldConfig } from '@/components/ui/Form'

const schema = ${schema}
type FormData = z.infer<typeof schema>

const fields: FieldConfig[] = ${fieldConfigs}

export function ${name}() {
  const navigate = useNavigate()
  const mutation = ${hook}()

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New ${title}</h1>
      <Form<FormData>
        fields={fields}
        schema={schema}
        onSubmit={async (data) => {
          await mutation.mutateAsync(data)
          navigate(-1)
        }}
        isLoading={mutation.isPending}
        submitLabel="Create ${title}"
      />
    </div>
  )
}
`
}

function genEditFormPage(
  name: string,
  queryHook: string,
  mutationHook: string,
  fields: InferredField[],
  path: string,
): string {
  const param = firstPathParam(path)
  const title = name
    .replace(/^(Update|Edit|Patch)/, '')
    .replace(/Page$/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
  const fieldConfigs = renderFieldConfigs(fields)
  const schema = renderZodSchema(fields)
  return `import { useParams, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { ${queryHook}, ${mutationHook} } from '@project/sdk'
import { Form } from '@/components/ui/Form'
import { Skeleton } from '@/components/ui/Skeleton'
import type { FieldConfig } from '@/components/ui/Form'

const schema = ${schema}
type FormData = z.infer<typeof schema>

const fields: FieldConfig[] = ${fieldConfigs}

export function ${name}() {
  const { ${param} } = useParams<{ ${param}: string }>()
  const navigate = useNavigate()
  const { data, isLoading } = ${queryHook}(${param}!)
  const mutation = ${mutationHook}()

  if (isLoading) return <Skeleton className="h-48 w-full" />

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Edit ${title}</h1>
      <Form<FormData>
        fields={fields}
        schema={schema}
        defaultValues={data?.data as Partial<FormData>}
        onSubmit={async (formData) => {
          await mutation.mutateAsync({ ${param}: ${param}!, ...formData })
          navigate(-1)
        }}
        isLoading={mutation.isPending}
        submitLabel="Save Changes"
      />
    </div>
  )
}
`
}

function genAuthPage(name: string, hook: string, fields: InferredField[], isLogin: boolean): string {
  const title = isLogin ? 'Sign In' : 'Create Account'
  const altText = isLogin ? "Don't have an account?" : 'Already have an account?'
  const altLink = isLogin ? '/register' : '/login'
  const altLabel = isLogin ? 'Sign Up' : 'Sign In'
  const fieldConfigs = renderFieldConfigs(fields)
  const schema = renderZodSchema(fields)
  return `import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { ${hook} } from '@project/sdk'
import { Form } from '@/components/ui/Form'
import { Card, CardContent } from '@/components/ui/Card'
import type { FieldConfig } from '@/components/ui/Form'

const schema = ${schema}
type FormData = z.infer<typeof schema>

const fields: FieldConfig[] = ${fieldConfigs}

export function ${name}() {
  const navigate = useNavigate()
  const mutation = ${hook}()

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">${title}</h1>
        </div>
        <Card>
          <CardContent className="py-6">
            <Form<FormData>
              fields={fields}
              schema={schema}
              onSubmit={async (data) => {
                await mutation.mutateAsync(data)
                navigate('/')
              }}
              isLoading={mutation.isPending}
              submitLabel="${title}"
            />
          </CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">
          ${altText}{' '}
          <Link to="${altLink}" className="text-primary hover:underline">
            ${altLabel}
          </Link>
        </p>
      </div>
    </div>
  )
}
`
}

// ---------------------------------------------------------------------------
// App.tsx generator
// ---------------------------------------------------------------------------

interface PageEntry {
  name: string
  route: string
  isAuth: boolean
}

function genAppTsx(pages: PageEntry[]): string {
  const authPages = pages.filter((p) => p.isAuth)
  const protectedPages = pages.filter((p) => !p.isAuth)
  const firstProtectedRoute = protectedPages[0]?.route ?? '/'
  const rootIndexRoute = protectedPages.some((p) => p.route === '/')
    ? ''
    : `          <Route index element={<Navigate to="${firstProtectedRoute}" replace />} />\n`

  const imports = pages
    .map((p) => `import { ${p.name} } from '@/pages/${p.name}'`)
    .join('\n')

  const authRoutes = authPages
    .map((p) => `        <Route path="${p.route}" element={<${p.name} />} />`)
    .join('\n')

  const protectedRoutes = protectedPages
    .map((p) => `          <Route path="${p.route}" element={<${p.name} />} />`)
    .join('\n')

  return `import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
${imports}
import { AuthGuard } from '@/lib/AuthGuard'
import { Shell } from '@/components/layout/Shell'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public / auth routes */}
${authRoutes}

        {/* Protected routes */}
        <Route element={<AuthGuard />}>
          <Route element={<Shell />}>
${rootIndexRoute}${protectedRoutes}
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="${firstProtectedRoute}" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Build a path → GET operationId map for edit-form query hook lookups
const getOpByPath: Record<string, string> = {}
for (const [path, pathItem] of Object.entries<any>(spec.paths ?? {})) {
  const getOp = (pathItem as any).get
  if (getOp?.operationId) getOpByPath[path] = getOp.operationId
}

const pages: PageEntry[] = []
let generated = 0
let skipped = 0

for (const [path, pathItem] of Object.entries<any>(spec.paths ?? {})) {
  for (const [method, op] of Object.entries<any>(pathItem)) {
    if (!op.operationId) continue

    const pattern = detectPattern(path, method, op)
    if (pattern === 'skip') continue

    const name = toPageName(op.operationId, method)
    const hook = toHookName(op.operationId, method)
    const route = toPageRoute(path, pattern, op.operationId)
    const outPath = resolve(pagesDir, `${name}.tsx`)
    const fields = extractFields(op.requestBody)

    if (existsSync(outPath)) {
      console.log(`  Skipped  ${name}.tsx`)
      skipped++
    } else {
      let content = ''
      switch (pattern) {
        case 'list':
          content = genListPage(name, hook, op)
          break
        case 'detail':
          content = genDetailPage(name, hook, op, path)
          break
        case 'create-form':
          content = genCreateFormPage(name, hook, fields)
          break
        case 'edit-form': {
          // Find the GET hook for this path so the edit form can pre-fill
          const getOpId = getOpByPath[path] ?? op.operationId.replace(/^(update|edit|patch)/i, 'get')
          const queryHook = toHookName(getOpId, 'get')
          content = genEditFormPage(name, queryHook, hook, fields, path)
          break
        }
        case 'auth': {
          const isLogin = /login/i.test(op.operationId)
          content = genAuthPage(name, hook, fields, isLogin)
          break
        }
      }
      writeFileSync(outPath, content)
      console.log(`  Created  ${name}.tsx  (${pattern})`)
      generated++
    }

    pages.push({ name, route, isAuth: pattern === 'auth' })
  }
}

// App.tsx — only generate if it doesn't exist
if (existsSync(appPath)) {
  console.log(`  Skipped  App.tsx`)
} else {
  writeFileSync(appPath, genAppTsx(pages))
  console.log(`  Created  App.tsx`)
}

console.log(`\nDone — ${generated} created, ${skipped} skipped. Run \`pnpm dev\` to see them.`)
