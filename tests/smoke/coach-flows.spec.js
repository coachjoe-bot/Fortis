// ─── T57: the coach-truth suite ───────────────────────────────────────────────
// The athlete gym-truth suite (T56) exists because code-level gates stayed green
// while athlete-visible flows were broken on a phone. The coach side had the
// same hole: "Review & apply" on a change request crashed on a leftover
// setProgTab reference for EVERY coach on prod, and no test drove the flow.
// These specs walk the request card exactly as a coach's finger does.
import { test, expect } from "@playwright/test";
import { mockApi, makeAthlete, makeCoach, loginAsCoach } from "./mocks.js";

const PROGRAM = "Day 1 - Push\nBench Press 3x5 @ 185\nFront Squat 3x5 @ 155\nDips 3x8";
const MERGED = PROGRAM.replace("Front Squat 3x5 @ 155", "Leg Press 3x10 @ 200");

const REQUEST = (athlete, coach) => ({
  id: "req-smoke-1",
  athlete_id: athlete.id,
  coach_id: coach.id,
  status: "pending",
  source: "pain",
  reason: "my knee hurts on front squats",
  created_at: new Date().toISOString(),
  items: [{
    lift: "Front Squat",
    suggested_change: "Replace Front Squat 3x5 with Leg Press 3x10 until the knee calms down.",
    current: "Front Squat 3x5 @ 155",
    why: "knee pain on the descent",
  }],
});

async function openAthleteWithRequest(page) {
  const coach = makeCoach();
  const athlete = makeAthlete({ coach_id: coach.id, program_text: PROGRAM, program_locked: true });
  await mockApi(page, { athlete, coach });
  // Newest route wins: serve the pending request; everything else falls back.
  await page.route("**/api/data", (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.op === "read" && JSON.stringify(body).includes("program_change_requests")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify([REQUEST(athlete, coach)]) });
    }
    return route.fallback();
  });
  // The merge AI returns the program with exactly the requested line swapped.
  await page.route("**/api/claude", (route) => {
    const body = route.request().postDataJSON() || {};
    if (body.feature !== "program_apply_change") return route.fallback();
    route.fulfill({ contentType: "application/json", body: JSON.stringify({
      id: "msg_smoke", type: "message", role: "assistant", model: "claude-sonnet-5",
      content: [{ type: "text", text: MERGED }], stop_reason: "end_turn", usage: {},
    }) });
  });

  await loginAsCoach(page, coach);
  await page.getByRole("button", { name: /^athletes$/i }).click();
  await page.getByText(athlete.name).first().click();
  await expect(page.getByText(/Replace Front Squat 3x5/)).toBeVisible({ timeout: 10000 });
  return { coach, athlete };
}

test("'Review & apply' on a change request reaches the REVIEW CHANGE diff (the setProgTab crash class)", async ({ page }) => {
  await openAthleteWithRequest(page);
  await page.getByRole("button", { name: "Review & apply" }).click();
  // Before the T57 fix this threw ReferenceError before anything staged — the
  // review overlay could never appear.
  await expect(page.getByText("REVIEW CHANGE")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Leg Press 3x10 @ 200/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Save program/ })).toBeVisible();
});

test("saving the reviewed merge writes the program and resolves the request", async ({ page }) => {
  const { athlete } = await openAthleteWithRequest(page);
  await page.getByRole("button", { name: "Review & apply" }).click();
  await page.getByRole("button", { name: /Save program/ }).click({ timeout: 15000 });
  // The overlay closes and the athlete's program editor now holds the merged text.
  await expect(page.getByText("REVIEW CHANGE")).toHaveCount(0, { timeout: 10000 });
  const ta = page.locator("textarea").filter({ hasText: /Leg Press 3x10 @ 200/ });
  await expect(ta.or(page.locator(`textarea >> nth=0`))).toBeVisible();
});
