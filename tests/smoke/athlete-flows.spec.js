// ─── T56: the gym-truth suite ─────────────────────────────────────────────────
// Every code-level gate was green on 08-18 while three athlete-visible flows
// were broken on a phone (Will's gym session). These specs assert what the
// athlete actually SEES — the today's-session opener, the zero-tap lock-screen
// pin, and the WORKOUT #N stamp — so "tests pass" and "works in the gym" stop
// being different claims.
import { test, expect } from "@playwright/test";
import { mockApi, makeAthlete, loginAsAthlete, pushupParse } from "./mocks.js";

const PROGRAM = "Day 1 - Push\nBench Press 3x5 @ 185\nDips 3x8\n\nDay 2 - Pull\nRow 3x8 @ 135";
const DRAFT = "Day 1 - Push\nBench Press 3x5 @ 185\nDips 3x8";

// Route the AI proxy per-feature on top of mockApi (newest route wins).
const aiByFeature = async (page, map) => {
  await page.route("**/api/claude", (route) => {
    const body = route.request().postDataJSON() || {};
    if (!(body.feature in map)) return route.fallback(); // mockApi serves parse/chat correctly
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: map[body.feature] }], usage: {} }) });
  });
};

test("a programmed athlete opens INTO today's session, not a generic greeting", async ({ page }) => {
  const athlete = makeAthlete({ program_text: PROGRAM });
  await mockApi(page, { athlete });
  await aiByFeature(page, { quick_log_draft: DRAFT });

  await loginAsAthlete(page, athlete);
  await expect(page.getByText(/Here's today/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Bench Press 3x5/)).toBeVisible();
  await expect(page.getByText(/what have you been up to/i)).toHaveCount(0);
});

test("a REST_DAY draft says rest day — never the generic greeting", async ({ page }) => {
  const athlete = makeAthlete({ program_text: PROGRAM });
  await mockApi(page, { athlete });
  await aiByFeature(page, { quick_log_draft: "REST_DAY" });

  await loginAsAthlete(page, athlete);
  await expect(page.getByText(/Rest day on your block/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/what have you been up to/i)).toHaveCount(0);
});

test("logging a workout stamps WORKOUT #N with the athlete's real number", async ({ page }) => {
  const athlete = makeAthlete({ total_sessions_logged: 4 }); // no program → plain greeting path
  await mockApi(page, { athlete, parseResult: pushupParse });
  // The stamp's number comes from the session-count view — serve the truth.
  await page.route("**/api/data", (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.op === "read" && String(body.table || body.params || "").includes("v_athlete_session_counts")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify([{ session_count: 5 }]) });
    }
    return route.fallback();
  });

  await loginAsAthlete(page, athlete);
  await page.getByPlaceholder(/Tell Coach Joe about your workout/).fill("Push-ups 3x20, felt good");
  await page.getByRole("button", { name: "→", exact: true }).click();

  await expect(page.locator(".stamp", { hasText: "WORKOUT" })).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".stamp")).toContainText("#5");
});

test("'put my program on my home screen' pins with ZERO taps when notifications are granted", async ({ page, context }) => {
  await context.grantPermissions(["notifications"]);
  // Headless Chromium reports Notification.permission "denied" even after a
  // grant — stub the getter so the spec exercises OUR granted branch.
  await page.addInitScript(() => {
    try { Object.defineProperty(Notification, "permission", { get: () => "granted" }); } catch (_) {}
  });
  const athlete = makeAthlete({ program_text: PROGRAM });
  await mockApi(page, { athlete });
  await aiByFeature(page, { quick_log_draft: DRAFT, joebot_chat: "You got it." });
  // mocks.js stubs SW registration into a never-resolving promise; the card path
  // awaits serviceWorker.ready → give it a resolved stand-in that records the post.
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator.serviceWorker, "ready", {
        get: () => Promise.resolve({ showNotification: async (t, o) => { window.__cardPosted = { t, o }; } }),
      });
    } catch (_) {}
  });

  await loginAsAthlete(page, athlete);
  await expect(page.getByText(/Here's today/)).toBeVisible({ timeout: 15000 });

  await page.getByPlaceholder(/Tell Coach Joe about your workout/).fill("can you put my program on my home screen?");
  await page.getByRole("button", { name: "→", exact: true }).click();

  // The APP's own confirmation — not a model claim — and no permission chip.
  await expect(page.getByText(/on your lock screen\. It clears itself/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("button", { name: /Put it on my lock screen/ })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!window.__cardPosted)).toBe(true);
});
