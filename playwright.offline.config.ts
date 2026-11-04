import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests that need data: the real app against a local Postgres
 * (migrations + seed) through e2e/support/fake-supabase.mjs. Needs the PG*
 * environment variables, like npm run test:db.
 */
const port = 3101;
const fakePort = 54399;
const env = {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${fakePort}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
  FAKE_SUPABASE_PORT: String(fakePort),
  E2E_DB_NAME: "crit_race_series_e2e",
  // Weather requests go to the stand-in server instead of api.open-meteo.com.
  OPEN_METEO_BASE_URL: `http://127.0.0.1:${fakePort}`,
};

export default defineConfig({
  testDir: "e2e/offline",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  globalSetup: "./e2e/offline/global-setup.ts",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "tablet", use: { ...devices["Pixel 7"] } }],
  webServer: [
    { command: "node e2e/support/fake-supabase.mjs", port: fakePort, env, reuseExistingServer: false },
    {
      command: `npm run build && npx next start -p ${port}`,
      port,
      env: { ...env, NEXT_DIST_DIR: ".next-e2e" },
      timeout: 300_000,
      reuseExistingServer: false,
    },
  ],
});
