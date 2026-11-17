// End-to-end tests of the interface: the real app on a test port, the scripted
// model (TUTOR_MOCK=1) and a throwaway data folder. Your own data is not touched.
// Run: npm run test:e2e   (uses the installed Chrome; PW_CHANNEL=msedge for Edge)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 3199;
const dataDir = process.env.TUTOR_E2E_DATA ?? fs.mkdtempSync(path.join(os.tmpdir(), "tutor-e2e-"));
process.env.TUTOR_E2E_DATA = dataDir;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PW_CHANNEL ?? "chrome",
    locale: "ru-RU",
    viewport: { width: 1280, height: 860 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node scripts/run.mjs start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "ignore",
    env: {
      ...(process.env as Record<string, string>),
      TUTOR_MOCK: "1",
      TUTOR_DATA_DIR: dataDir,
      TUTOR_SECRETS_FILE: path.join(dataDir, "secrets.json"),
    },
  },
});
