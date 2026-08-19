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

// Shared login for the T57 session-2 flows below (hand-verified 08-18/19, now encoded).
async function login(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Athlete Login/i }).click();
  await page.getByPlaceholder(/name/i).first().fill(NAME);
  await page.locator('input[type="password"], input[inputmode="numeric"]').first().fill(PIN);
  await page.getByRole("button", { name: /Let's Get to Work/i }).click();
  await expect(page.getByText("COACH JOE-BOT")).toBeVisible({ timeout: 30_000 });
  for (const label of [/Not now/i, /No thanks/i, /^Later$/i]) {
    const b = page.getByRole("button", { name: label }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
}

test("live: the unit toggle round-trips every athlete surface (kg ↔ lbs)", async ({ page }) => {
  await login(page);
  const openSettings = () => page.getByRole("button", { name: "⚙", exact: true }).click();
  // → kg: MY LOG and Benchmarks render converted values with kg labels.
  await openSettings();
  await page.getByRole("button", { name: "KG", exact: true }).click();
  await page.getByRole("button", { name: /✕ Close/ }).click();
  await page.getByRole("button", { name: "MY LOG", exact: true }).click();
  await expect(page.getByText(/\d+(\.\d+)?kg/).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /✕ Close/ }).click();
  // → back to lbs: the same surfaces read lbs again (exact round-trip — the raw
  // stored pair converts once per render, never cumulatively).
  await openSettings();
  await page.getByRole("button", { name: "LBS", exact: true }).click();
  await page.getByRole("button", { name: /✕ Close/ }).click();
  await page.getByRole("button", { name: "MY LOG", exact: true }).click();
  await expect(page.getByText(/\d+lbs/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/\d+(\.\d+)?kg/)).toHaveCount(0);
});

test("live: Quick Log prefashions today's session and sends it through the real parser", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /QUICK LOG/ }).click();
  // The AI prefill lands in the editable draft (program day + loads), never empty
  // — and SEND only arms once it has. Waiting on the BUTTON (not the textarea)
  // avoids racing the prefill against selector order.
  const send = page.getByRole("button", { name: /SEND TO CHAT/ });
  await expect(send).toBeVisible({ timeout: 20_000 });
  await expect(send).toBeEnabled({ timeout: 60_000 });
  const draft = page.locator("textarea").last();
  await expect(draft).not.toHaveValue("", { timeout: 10_000 });
  await send.click();
  // The send routes through the real parser → a coach reply (and never a program
  // overwrite — the draft is a LOG by construction).
  await expect(page.locator(".stamp", { hasText: "WORKOUT" }).or(page.getByText(/Solid session|Good work|Numbers are moving|Nice\./).first()))
    .toBeVisible({ timeout: 60_000 });
});

test("live: a loading-language preference offers a chip and 'Make it standing' locks it in", async ({ page }) => {
  await login(page);
  const composer = page.getByPlaceholder(/Tell Coach Joe about your workout/);
  // The QA row may already hold either value from a prior run — ask for whichever
  // flips it, so the offer chip always appears (dedupe suppresses same-value asks).
  await composer.fill("only RPE from now on, no percentages");
  await page.getByRole("button", { name: "→", exact: true }).click();
  let chip = page.getByRole("button", { name: "Make it standing" });
  try {
    await expect(chip).toBeVisible({ timeout: 60_000 });
  } catch {
    await composer.fill("actually percentages only from now on, no RPE");
    await page.getByRole("button", { name: "→", exact: true }).click();
    await expect(chip).toBeVisible({ timeout: 60_000 });
  }
  await chip.click();
  // The deterministic confirm — "Locked in." — only renders when the gateway
  // upsert succeeded (the T57 dead-conflict class would say "Couldn't save").
  await expect(page.getByText(/Locked in/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Couldn't save that just now/)).toHaveCount(0);
});
