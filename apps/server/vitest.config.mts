import { defineConfig } from 'vitest/config'
import { existsSync, readFileSync } from 'fs'
import { parseEnv } from 'util'
import { resolve, dirname } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const envFile = resolve(__dirname, '../../.env')
const env: Record<string, string | undefined> = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {}
const testDb = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL

// setup.ts wipes every table after each test — never point this at the dev DB.
if (!testDb) throw new Error('TEST_DATABASE_URL is not set (see .env.example)')
if (testDb === (process.env.DATABASE_URL ?? env.DATABASE_URL)) {
  throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL')
}

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    setupFiles: ['./src/__tests__/helpers/setup.ts'],
    fileParallelism: false, // one shared test database
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDb,
      STORAGE_PROVIDER: process.env.STORAGE_PROVIDER ?? 'local', // s3 to run against a bucket
      UPLOADS_DIR: resolve(tmpdir(), 'voice-chat-test-uploads'), // keep test files out of the dev uploads folder
      UPLOAD_MAX_SIZE_MB: '1', // small enough to exercise the limit cheaply
      PUBLIC_UPLOAD_BASE_URL: 'http://localhost:3001/uploads',
      // Never call real AI from tests. Prisma loads the root .env at runtime (via
      // packages/db/.env), but it doesn't override variables already set here.
      AI_ROUTER: 'off',
      OPENAI_API_KEY: '',
      OPENAI_ROUTER_MODEL: '',
    },
  },
})
