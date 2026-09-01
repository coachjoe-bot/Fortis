// ─── T62-3: the loading + empty-state truth suite ─────────────────────────────
// Will's 08-31 verdict was that these states were ugly: a giant blank white card
// under "Joe's updating the sheet…", and a blank grey void where the Progress
// radar should be. Both were invisible to every existing gate — nothing asserts
// what a screen looks like while it WAITS, or when an athlete has nothing logged.
// These specs pin the system so a future change can't quietly return to a void:
//   1. a busy surface shows content-shaped skeleton bars, never an empty box
//   2. a "nothing logged yet" surface shows the radar readout, in BOTH themes
import { test, expect } from "@playwright/test";
import { mockApi, makeAthlete, loginAsAthlete } from "./mocks.js";

const PROGRAM = "Day 1 - Push\nBench Press 3x5 @ 185\nDips 3x8";

// A skeleton is present iff at least one .sk bar is painted.
const skeletons = (page) => page.locator(".sk");

test("the chat cold start paints bubble skeletons, not a bare progress bar", async ({ page }) => {
  const athlete = makeAthlete({ program_text: PROGRAM });
  // Hold the workout-history read open so the cold-start branch stays on screen.
  await mockApi(page, { athlete });
  await page.route("**/api/data", async (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.table === "workouts" && body.op === "read") await new Promise((r) => setTimeout(r, 4000));
    return route.fallback();
  });

  await loginAsAthlete(page, athlete);
  // Cold start: skeleton bars carry the wait, and the caption stays honest.
  await expect(skeletons(page).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Syncing feed")).toBeVisible();
});

test("the session sheet mid-update shows a sheet-shaped skeleton, never a blank card", async ({ page }) => {
  const athlete = makeAthlete({ program_text: PROGRAM });
  await mockApi(page, { athlete });
  // Joe never answers: the draft generation stays busy with nothing to show —
  // exactly the state Will screenshotted as a giant empty white card.
  await page.route("**/api/claude", () => new Promise(() => {}));

  await loginAsAthlete(page, athlete, "/?n=quicklog");
  const status = page.getByRole("status", { name: "Joe's updating the sheet…" });
  await expect(status).toBeVisible({ timeout: 20_000 });
  // The skeleton sketches the SHAPE of a session (title stripe + exercise lines).
  expect(await status.locator(".sk").count()).toBeGreaterThanOrEqual(5);
  // and the blank textarea that used to fill this space is gone while busy
  await expect(page.getByRole("textbox", { name: "Today's workout log" })).toHaveCount(0);
});

for (const theme of ["light", "dark"]) {
  test(`Progress empty states show the radar readout in ${theme} mode`, async ({ page }) => {
    // No workouts at all: every Progress subtab is a "nothing logged yet" state.
    const athlete = makeAthlete({ program_text: PROGRAM, total_sessions_logged: 0 });
    await page.addInitScript((t) => { try { localStorage.setItem("wilco_theme", t); } catch (_) {} }, theme);
    await mockApi(page, { athlete, workouts: [] });

    await loginAsAthlete(page, athlete);
    await page.getByRole("button", { name: "PROGRESS", exact: true }).click();

    for (const tab of [/^running$/i, /^strength$/i, /^PRs$/i]) {
      await page.getByRole("button", { name: tab }).first().click();
      await expect(page.getByText("AWAITING SIGNAL")).toBeVisible();
      // The radar dial itself is painted (it was a de-glowed near-invisible
      // hairline on light before T62 — the void Will reported).
      await expect(page.locator(".radar")).toBeVisible();
    }
  });
}
