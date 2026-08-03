import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const frontendDir = __dirname
const backendDir = path.resolve(frontendDir, '../backend')
const frontendPort = Number(process.env.E2E_FRONTEND_PORT ?? 3100)
const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 8100)
const supabasePort = Number(process.env.E2E_SUPABASE_PORT ?? 54329)
const baseURL = `http://127.0.0.1:${frontendPort}`
const backendURL = `http://127.0.0.1:${backendPort}`
const supabaseURL = `http://127.0.0.1:${supabasePort}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Three explicit processes make local runs deterministic: Playwright no
  // longer mistakes an unrelated service on port 3000 for OnlyPoker, and the
  // guest journeys do not require live Supabase credentials. The stub only
  // represents a signed-out auth service; account/OAuth flows remain outside
  // this suite.
  webServer: [
    {
      command: 'node e2e/supabase-stub.mjs',
      cwd: frontendDir,
      env: { SUPABASE_STUB_PORT: String(supabasePort) },
      url: `${supabaseURL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `uv run --frozen uvicorn main:asgi_app --host 127.0.0.1 --port ${backendPort}`,
      cwd: backendDir,
      url: `${backendURL}/api/openapi.json`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm exec next dev --hostname 127.0.0.1 --port ${frontendPort}`,
      cwd: frontendDir,
      env: {
        POKER_DEV_PROXY: '1',
        POKER_BACKEND_URL: backendURL,
        NEXT_PUBLIC_SUPABASE_URL: supabaseURL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.test-signature',
      },
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      // Local development already has Chrome; CI images can either provide the
      // stable channel or install it with Playwright's standard setup step.
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
})
