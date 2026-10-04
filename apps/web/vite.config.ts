import { createReadStream, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Self-hosted MediaPipe runtime for the virtual background (features/virtualCamera.ts):
// served from node_modules in dev and copied into the build — no CDN at runtime and
// nothing committed. FilesetResolver picks the SIMD or no-SIMD pair itself.
const MEDIAPIPE_BASE = 'mediapipe'
const MEDIAPIPE_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']

function mediapipeRuntime(): Plugin {
  const wasmDir = join(dirname(createRequire(import.meta.url).resolve('@mediapipe/tasks-vision')), 'wasm')
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

export default defineConfig({
  plugins: [react(), mediapipeRuntime()],
  server: {
    allowedHosts: true,
  },
})
