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

test("a skeleton never FLASHES: every skeleton root carries the hold class", async ({ page }) => {
  // Will's 09-01 phone pass: a warm login painted a full page of chat bubbles
  // for ~half a second before the real transcript landed, which reads as "some
  // other screen loaded by mistake". Skeleton roots hold at opacity 0 for 500ms
  // so a fast wait shows nothing at all. Losing that class brings the flash back.
  const athlete = makeAthlete({ program_text: PROGRAM });
  await mockApi(page, { athlete });
  await page.route("**/api/data", async (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.table === "workouts" && body.op === "read") await new Promise((r) => setTimeout(r, 4000));
    return route.fallback();
  });

  await loginAsAthlete(page, athlete);
  const chat = page.getByRole("status", { name: "Syncing feed" });
  await expect(chat).toHaveClass(/skhold/, { timeout: 15_000 });
  // and it is genuinely transparent at first paint, not merely class-tagged
  expect(await chat.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
});

test("Progress → Running with runs logged but nothing chartable shows the radar, not a lone sentence", async ({ page }) => {
  // The zero-run branch stops firing the moment ONE run exists, and every chart
  // needs 2+ points — so a single logged run used to leave a kicker over one grey
  // line in an otherwise empty pane. That was the void Will hit on 09-01.
  const athlete = makeAthlete({ program_text: PROGRAM });
  const oneRun = [{
    id: "run-1", athlete_id: athlete.id, created_at: "2026-08-28T17:30:00.000Z",
    workout_date: "2026-08-28", raw_text: "easy 3 miles",
    parsed_data: { exercises: [], run_data: { run_type: "easy", distance_miles: 3, pace_per_mile: "8:30" } },
  }];
  await mockApi(page, { athlete, dataReads: { workouts: oneRun } });

  await loginAsAthlete(page, athlete);
  await page.getByRole("button", { name: "PROGRESS", exact: true }).click();
  await page.getByRole("button", { name: /^running$/i }).first().click();

  await expect(page.getByText("AWAITING SIGNAL")).toBeVisible();
  await expect(page.locator(".radar")).toBeVisible();
  await expect(page.getByText("Log more runs to see trend charts.")).toHaveCount(0);
  // the readout is honest about what IS logged
  await expect(page.getByText(/1 run logged/)).toBeVisible();
});
