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
      // Never send real email from tests (docs/agents/07): the dev outbox, no platform sender.
      RESEND_API_KEY: '',
      EMAIL_PLATFORM_FROM: '',
      EMAIL_TRANSPORT: '',
      // Google sign-in and Gmail: fixed fake settings, so tests never depend on (or
      // reach) real credentials from a developer's .env, and behave the same in CI.
      GOOGLE_LOGIN_CLIENT_ID: 'test-google-login-client',
      GOOGLE_LOGIN_CLIENT_SECRET: 'test-google-login-secret',
      GOOGLE_LOGIN_REDIRECT_URI: 'http://localhost:3001/auth/google/callback',
      GOOGLE_CLIENT_ID: 'test-google-gmail-client',
      GOOGLE_CLIENT_SECRET: 'test-google-gmail-secret',
      GOOGLE_REDIRECT_URI: 'http://localhost:3001/integrations/google/callback',
    },
  },
})
