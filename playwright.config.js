// Playwright smoke-test config — the pre-deploy functionality gate.
//
// Runs the app under `vite dev` on a DEDICATED port (5175) so it never collides
// with the interactive preview server (5174). Under vite dev the /api/* Vercel
// functions do NOT exist, so every spec mocks the API layer with route fixtures
// (see tests/smoke/mocks.js) — these tests exercise the CLIENT, not the backend.
//
// Deliberately strict for a gate: chromium only, 1 worker, 0 retries. If a spec
// flakes, fix the spec — don't retry past it.
import { defineConfig } from "@playwright/test";

// Port is overridable because `reuseExistingServer` will happily REUSE another
// worktree's dev server on the same port — several WILCO worktrees run gates at
// once, and a suite that silently grades a different branch's bundle produces
// shifting failures in specs you never touched. Set SMOKE_PORT to run in
// parallel with another checkout. (Diagnosed 09-01: a third session held 5175.)
const PORT = Number(process.env.SMOKE_PORT || 5175);

export default defineConfig({
  testDir: "tests/smoke",
  timeout: 45_000,            // per test — Stripe.js failure path alone burns ~2.5s per attempt cycle
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // The app registers a PWA service worker (public/sw.js). A live SW would
    // handle fetches OUTSIDE Playwright's route interception and silently bypass
    // the API mocks — block it. (mocks.js also stubs register() so the page's
    // unguarded register() call can't produce an unhandled-rejection console error.)
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: "chromium" }],
});
