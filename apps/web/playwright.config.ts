import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:15173',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Configure fake media devices for all projects to support media testing natively */
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    },
    
    /* Automatically grant permissions for camera and microphone */
    permissions: ['camera', 'microphone'],
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Own fresh servers so a long-running dev process cannot serve stale modules.
  webServer: [
    {
      command: 'pnpm --filter server dev',
      cwd: '../..',
      url: 'http://localhost:13001/health',
      reuseExistingServer: false,
      env: {
        PORT: '13001',
        PUBLIC_API_URL: 'http://localhost:13001',
        PUBLIC_UPLOAD_BASE_URL: 'http://localhost:13001/uploads',
        CORS_ORIGIN: 'http://localhost:15173',
        RATE_LIMITS: 'off',
        BOTS: 'off',
        AGENTS_SCHEDULER: 'off',
      },
    },
    {
      command: 'pnpm exec vite --host 0.0.0.0 --port 15173 --strictPort',
      url: 'http://localhost:15173',
      reuseExistingServer: false,
      env: { VITE_API_URL: 'http://localhost:13001' },
    },
  ],
});
