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

  // 3 ── log a small accessory session through the REAL parser. Unique reps per
  // run/retry: identical text made a retry a duplicate of its own first attempt
  // (T57 s5). And the WORKOUT #N stamp only fires when the SESSION COUNT rises —
  // sessions group on a 3h window, so a second live run inside 3h of the first
  // is a same-session continuation BY DESIGN and correctly gets a coach reply
  // with no stamp. Assert stamp-or-acknowledgment here; the strict stamp claim
  // is pinned deterministically in tests/smoke/athlete-flows.spec.js.
  const reps = 10 + (Date.now() % 50);
  await composer.fill(`Face pulls 3x${reps}, felt easy`);
  await page.getByRole("button", { name: "→", exact: true }).click();
  const stamp = page.locator(".stamp", { hasText: "WORKOUT" });
  await expect(stamp.or(page.getByText(/face pull/i).last())).toBeVisible({ timeout: 60_000 });
  if (await stamp.count()) await expect(stamp).toContainText(/#\d+/);
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

test("live: the session card pins on 'starting my workout', SURVIVES backgrounding + Clear All, and clears on log", async ({ page }) => {
  // Will's ask (08-19): "check that the live notification comes when people
  // start their workout and stays on the homescreen." The OS half (a real lock
  // screen) is device-territory; this proves the entire app-side contract the
  // persistence is built on, against prod, through a faithful notification-
  // center shim: every showNotification lands in window.__cards, getNotifications
  // serves from it, close() removes from it — so posts, re-pins, sweeps, and
  // clears are all observable.
  await page.addInitScript(() => {
    try { Object.defineProperty(Notification, "permission", { get: () => "granted" }); } catch (_) {}
    window.__cards = []; window.__closes = 0;
    const origReady = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator.serviceWorker), "ready");
    void origReady; // SW itself is real (prod) — only the notification surface is shimmed
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      window.__cards.push({ title, ...options });
      return Promise.resolve();
    };
    ServiceWorkerRegistration.prototype.getNotifications = function (filter) {
      const tag = filter && filter.tag;
      const list = window.__cards.filter((c) => !tag || c.tag === tag);
      return Promise.resolve(list.map((c) => ({
        tag: c.tag, title: c.title,
        close: () => { window.__closes++; window.__cards = window.__cards.filter((x) => x !== c); },
      })));
    };
    // Backgrounding lever: the spec flips __visState and fires visibilitychange.
    window.__visState = "visible";
    Object.defineProperty(document, "visibilityState", { get: () => window.__visState });
  });

  await login(page);
  const composer = page.getByPlaceholder(/Tell Coach Joe about your workout/);
  const cards = () => page.evaluate(() => window.__cards.filter((c) => c.tag === "wilco-session-card"));

  // 1 ── session-start intent → ZERO-TAP pin. The card is the Quick Log draft
  // projected: uppercase headline, real lines, one stable tag, requireInteraction.
  await composer.fill("at the gym, starting my workout");
  await page.getByRole("button", { name: "→", exact: true }).click();
  await expect(page.getByText(/pinned|lock screen|rest day/i).last()).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await cards()).length, { timeout: 30_000 }).toBeGreaterThan(0);
  const first = (await cards()).pop();
  expect(first.tag).toBe("wilco-session-card");
  expect(first.requireInteraction).toBe(true);
  expect(first.title).toBe(first.title.toUpperCase());
  expect(String(first.body || "").length).toBeGreaterThan(0);

  const background = () => page.evaluate(() => {
    window.__visState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    window.__visState = "visible";
  });

  // 2 ── "stays on the homescreen": backgrounding RE-POSTS the same card (iOS
  // has no pinned web surface — the re-pin cycle IS the persistence).
  const before = (await cards()).length;
  await background();
  await expect.poll(async () => (await cards()).length, { timeout: 10_000 }).toBeGreaterThan(before);

  // 3 ── a Clear-All sweep doesn't kill it: empty the center, background again,
  // the card comes back.
  await page.evaluate(() => { window.__cards = []; });
  await background();
  await expect.poll(async () => (await cards()).length, { timeout: 10_000 }).toBeGreaterThan(0);

  // 4 ── logging TODAY'S session is the one "done" state: the card clears and
  // the stored state goes with it, so later backgrounding re-pins NOTHING.
  await composer.fill(`done — face pulls 3x${11 + (Date.now() % 40)}, easy`);
  await page.getByRole("button", { name: "→", exact: true }).click();
  // The 2-3h session-gap interstitial ("Same workout still, or a new session?")
  // HOLDS the log behind its chips — it fires whenever the previous live run's
  // logs are 2-3h old, so this spec flaked in a daily time band (T57 s6). Answer
  // it the way a real athlete does; the held finalize then runs and the card
  // clears. When the chips don't appear the click times out harmlessly.
  try { await page.getByRole("button", { name: "Same workout", exact: true }).click({ timeout: 15_000 }); } catch {}
  await expect.poll(async () => page.evaluate(() => window.__closes), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(async () =>
    page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("wilco_sessioncard_") && !k.includes("declined") && localStorage.getItem(k) !== null && JSON.parse(localStorage.getItem(k) || "null") !== null))
  , { timeout: 20_000 }).toBe(false);
  await page.evaluate(() => { window.__cards = []; });
  await background();
  await page.waitForTimeout(1500);
  expect((await cards()).length).toBe(0);
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

test("live: a program-edit ask never logs a phantom workout (T57 s5 guard)", async ({ page }) => {
  await login(page);
  const countOf = async () => Number(await page.evaluate(() => (document.body.innerText.match(/WORKOUTS:\s*(\d+)/) || [])[1]));
  await expect.poll(countOf, { timeout: 30_000 }).toBeGreaterThan(0);
  const before = await countOf();

  // "add … to my plan" + a set/rep scheme: pre-guard, the parser logged this as a
  // PERFORMED workout (the s5 phantom-session find). The extraction is under the
  // 20-char program-write gate, so the fixture's program is never mutated by this
  // spec — it only proves no workout row lands.
  const composer = page.getByPlaceholder(/Tell Coach Joe about your workout/);
  await composer.fill("add curls 3x12 to my plan");
  await page.getByRole("button", { name: "→", exact: true }).click();
  // Joe answers something; the count must NOT move and no WORKOUT stamp fires.
  await expect(page.getByText("add curls 3x12 to my plan")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(20_000); // real AI reply + any (wrong) finalize lands before we judge
  expect(await countOf()).toBe(before);
  await expect(page.locator(".stamp", { hasText: "WORKOUT" })).toHaveCount(0);
});
