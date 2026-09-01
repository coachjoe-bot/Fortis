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
  // SERIAL, always. Every spec logs in, and the login limiter counts attempts
  // per IP+name: parallel workers race it (each inserts an attempt row before
  // any of them succeeds and resets the counter), so the suite trips its own
  // 429 and every spec then fails at the header assertion — which reads exactly
  // like a catastrophic app regression. Successful logins reset the counter, so
  // one-at-a-time never accumulates. (Diagnosed 09-01.)
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "https://app.trainwilco.com", trace: "retain-on-failure" },
});
