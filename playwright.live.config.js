// ─── LIVE QA CONFIG — drives PRODUCTION with the seeded "Claude QA (test)" athlete ──
// Run AFTER every deploy:  npx playwright test -c playwright.live.config.js
// Needs .env.qa (written by scripts/seed-qa-athlete.mjs). Real backend, real AI:
// each run costs a few cents and writes only to the QA fixture's own rows.
import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.qa", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

export default defineConfig({
  testDir: "tests/live",
  timeout: 90_000,
  retries: 1,
  reporter: [["list"]],
  use: { baseURL: "https://app.trainwilco.com", trace: "retain-on-failure" },
});
