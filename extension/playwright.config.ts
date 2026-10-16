import { defineConfig } from "@playwright/test";

// End-to-end: the built extension in Chromium, against a running job-copilot API, with Greenhouse and Lever
// pages served from test/fixtures by request interception. No live site is contacted (design 15.1).
//   E2E_API=http://localhost:8000 E2E_TOKEN=... npm run e2e
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
});
