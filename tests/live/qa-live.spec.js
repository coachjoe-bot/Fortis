// ─── THE LIVE QA PASS (Will's ask, 08-18) ─────────────────────────────────────
// Drives the REAL production app as the seeded "Claude QA (test)" athlete: real
// gateway, real AI, real service worker. This is the layer no mock can prove —
// run it after every deploy. Reseed first if the account's state has drifted:
//   node --env-file=.env scripts/seed-qa-athlete.mjs
import { test, expect } from "@playwright/test";

const NAME = process.env.QA_ATHLETE_NAME;
const PIN = process.env.QA_ATHLETE_PIN;
test.skip(!NAME || !PIN, "seed first: node --env-file=.env scripts/seed-qa-athlete.mjs");

test("live: login → today's-session opener → zero-tap card ask → log → WORKOUT stamp", async ({ page }) => {
  // Notification.permission reads "denied" in headless; stub granted so the
  // zero-tap branch runs (the pin outcome message is asserted either way).
  await page.addInitScript(() => {
    try { Object.defineProperty(Notification, "permission", { get: () => "granted" }); } catch (_) {}
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Athlete Login/i }).click();
  await page.getByPlaceholder(/name/i).first().fill(NAME);
  await page.locator('input[type="password"], input[inputmode="numeric"]').first().fill(PIN);
  await page.getByRole("button", { name: /Let's Get to Work/i }).click();

  // 1 ── the opener: a programmed athlete lands IN today's session (or an honest
  // rest-day line) — never the generic greeting. Real AI resolves the draft.
  await expect(page.getByText(/Here's today|Rest day on your block/)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/what have you been up to/i)).toHaveCount(0);

  // 2 ── zero-tap lock-screen ask, "home screen" phrasing, real AI reply + the
  // APP's own truthful outcome line (pinned, rest day, or blocked — never silence,
  // never a model claim).
  // Dismiss any first-open interstitials (tour offer, block-end prompt) —
  // seeded away, but the harness must survive them if seeding drifts.
  for (const label of [/No thanks/i, /^Later$/i]) {
    const b = page.getByRole("button", { name: label }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }

  const composer = page.getByPlaceholder(/Tell Coach Joe about your workout/);
  await composer.fill("can you put my program on my home screen?");
  await page.getByRole("button", { name: "→", exact: true }).click();
  await expect(page.getByText(/on your lock screen|rest day on your program|blocking WILCO notifications|Couldn't pin it/i))
    .toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /Put it on my lock screen/ })).toHaveCount(0);

  // 3 ── log a small accessory session through the REAL parser; the WORKOUT #N
  // stamp must appear with a real number.
  await composer.fill("Face pulls 3x15, felt easy");
  await page.getByRole("button", { name: "→", exact: true }).click();
  await expect(page.locator(".stamp", { hasText: "WORKOUT" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".stamp")).toContainText(/#\d+/);
});
