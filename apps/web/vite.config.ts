import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Self-hosted MediaPipe runtime for the virtual background (features/virtualCamera.ts):
// served from node_modules in dev and copied into the build — no CDN at runtime and
// nothing committed. FilesetResolver picks the SIMD or no-SIMD pair itself.
const require = createRequire(import.meta.url)
// Not every package exports ./package.json: walk up from its entry file instead.
const pkgVersion = (name: string) => {
  for (let dir = dirname(require.resolve(name)); dir !== dirname(dir); dir = dirname(dir)) {
    const file = join(dir, 'package.json')
    if (!existsSync(file)) continue
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version: string }
    if (pkg.name === name) return pkg.version
  }
  throw new Error(`version of ${name} not found`)
}

// Large runtime assets live at versioned URLs, so production can cache them forever
// (`immutable`, see longCache below) and a dependency/model bump changes the URL.
const MEDIAPIPE_BASE = `vendor/mediapipe-${pkgVersion('@mediapipe/tasks-vision')}`
const MEDIAPIPE_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']

function mediapipeRuntime(): Plugin {
  const wasmDir = join(dirname(require.resolve('@mediapipe/tasks-vision')), 'wasm')
  return {
    name: 'mediapipe-runtime',
    configureServer(server) {
      server.middlewares.use(`/${MEDIAPIPE_BASE}/`, (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]!.replace(/^\//, '')
        if (!MEDIAPIPE_FILES.includes(name)) return next()
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        createReadStream(join(wasmDir, name)).pipe(res)
      })
    },
    generateBundle() {
      for (const name of MEDIAPIPE_FILES) {
        this.emitFile({ type: 'asset', fileName: `${MEDIAPIPE_BASE}/${name}`, source: readFileSync(join(wasmDir, name)) })
      }
    },
  }
}

// ONNX Runtime Web's WASM binaries (MIT), for the MODNet mask source: served from
// node_modules in dev and copied into the build at /ort/ — self-hosted like MediaPipe.
// The WebGPU build (onnxruntime-web/webgpu) loads exactly the asyncify pair.
const ORT_FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']
const ORT_BASE = `vendor/ort-${pkgVersion('onnxruntime-web')}`

function ortRuntime(): Plugin {
  const dist = join(dirname(require.resolve('onnxruntime-web')), '..', 'dist')
  const distDir = existsSync(join(dist, ORT_FILES[0]!)) ? dist : dirname(require.resolve('onnxruntime-web'))
  return {
    name: 'ort-runtime',
    configureServer(server) {
      server.middlewares.use(`/${ORT_BASE}/`, (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]!.replace(/^\//, '')
        if (!ORT_FILES.includes(name)) return next()
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        createReadStream(join(distDir, name)).pipe(res)
      })
    },
    generateBundle() {
      for (const name of ORT_FILES) this.emitFile({ type: 'asset', fileName: `${ORT_BASE}/${name}`, source: readFileSync(join(distDir, name)) })
    },
  }
}

// MODNet weights (Apache-2.0; notice in public/models/MODNET-NOTICE.txt): not in git
// (26 MB). Fetched once from a pinned revision, checked against its SHA-256, cached in
// node_modules/.cache, then served by the dev server and emitted into the build — so
// production self-hosts it and nothing third-party is requested at runtime. If the
// download fails, CI/production builds fail (requireModel); local builds continue
// without it and the app falls back to MediaPipe (loudly warned).
const MODNET = {
  url: 'https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model.onnx',
  sha256: '07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9',
}
const MODNET_PATH = `models/modnet-${MODNET.sha256.slice(0, 12)}.onnx`

// A missing model is a hard build error in CI and on Railway (or with
// VBG_REQUIRE_MODEL=1): otherwise an upstream outage would silently ship an app that
// only has MediaPipe. Local builds warn and continue.
const requireModel = () => !!(process.env.CI || process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.VBG_REQUIRE_MODEL === '1')

function modnetModel(): Plugin {
  const cacheFile = join(__dirname, 'node_modules', '.cache', 'models', `modnet-${MODNET.sha256.slice(0, 12)}.onnx`)
  let pending: Promise<string | null> | null = null
  const verified = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex') === MODNET.sha256
  const ensure = () => (pending ??= (async () => {
    if (existsSync(cacheFile) && verified(readFileSync(cacheFile))) return cacheFile
    try {
      const response = await fetch(MODNET.url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      if (!verified(bytes)) throw new Error('checksum mismatch')
      mkdirSync(dirname(cacheFile), { recursive: true })
      writeFileSync(cacheFile, bytes)
      return cacheFile
    } catch (error) {
      console.warn(`\n[modnet-model] could not fetch MODNet (${(error as Error).message}); the app will use MediaPipe.\n`)
      pending = null
      return null
    }
  })())
  return {
    name: 'modnet-model',
    configureServer(server) {
      server.middlewares.use(`/${MODNET_PATH}`, (_req, res, next) => {
        void ensure().then((file) => {
          if (!file) return next()
          res.setHeader('Content-Type', 'application/octet-stream')
          res.setHeader('Content-Length', String(statSync(file).size))
          createReadStream(file).pipe(res)
        })
      })
    },
    async generateBundle() {
      const file = await ensure()
      if (file) this.emitFile({ type: 'asset', fileName: MODNET_PATH, source: readFileSync(file) })
      else if (requireModel()) this.error('MODNet model could not be fetched or verified (required in CI/production; set nothing to change this, or fix the network/pin)')
    },
  }
}

// Evaluation-only weights (GPL-3.0 RVM): served by the dev server from .dev-models/
// (gitignored) and never emitted into a build.
function devModels(): Plugin {
  return {
    name: 'dev-models',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev-models/', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]!.replace(/^\//, '')
        const file = join(__dirname, '.dev-models', name)
        if (!/^[\w.-]+\.onnx$/.test(name) || !existsSync(file)) return next()
        res.setHeader('Content-Type', 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
  }
}

// Production (`vite preview`): versioned runtime assets and Vite's hashed /assets/ are
// cached for a year as immutable, so returning users never re-download the ~53 MB.
function longCache(): Plugin {
  const immutable = (url: string) => url.startsWith('/vendor/') || url.startsWith('/assets/') || /^\/models\/modnet-[0-9a-f]{12}\.onnx/.test(url)
  return {
    name: 'long-cache',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (immutable(req.url ?? '')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), mediapipeRuntime(), ortRuntime(), modnetModel(), devModels(), longCache()],
  // The app reads these versioned asset URLs (features/vbg) — one source of truth.
  define: {
    __VBG_ASSETS__: JSON.stringify({ mediapipe: `/${MEDIAPIPE_BASE}`, ort: `/${ORT_BASE}/`, modnet: `/${MODNET_PATH}` }),
  },
  // ONNX Runtime loads its own WASM glue at runtime from /ort/; don't pre-bundle it.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  server: {
    allowedHosts: true,
  },
})
