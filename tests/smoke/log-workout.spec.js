// Smoke: log a workout — type a workout sentence, submit, coach reply + saved
// confirmation appear, and the workout write actually hits the data gateway.
import { test, expect } from "@playwright/test";
import { mockApi, makeAthlete, loginAsAthlete, pushupParse } from "./mocks.js";

test("logging a workout replies, confirms the save, and writes to the gateway", async ({ page }) => {
  const athlete = makeAthlete(); // pro: workouts persist (free tier skips the insert)
  const reply = "Push-ups banked. Three sets of twenty is honest work.";
  const { calls } = await mockApi(page, { athlete, parseResult: pushupParse, chatReply: reply });

  await loginAsAthlete(page, athlete);
  await expect(page.getByText(/Tell me about your first workout/)).toBeVisible();

  const workoutMsg = "Push-ups 3x20, felt good";
  await page.getByPlaceholder(/Tell Coach Joe about your workout/).fill(workoutMsg);
  await page.getByRole("button", { name: "→", exact: true }).click();

  // The user bubble and the coach's reply round-trip through the mocked AI proxy.
  await expect(page.getByText(workoutMsg)).toBeVisible();
  await expect(page.getByText(reply)).toBeVisible();

  // No separate save-badge assertion: the header ✓ was removed on purpose
  // (silent save + haptic), the WORKOUT #N stamp self-clears in ~2.6s, and the
  // header counter reads the server session-count view, which the mock pins at
  // its fixture value. The coach reply above plus the gateway insert below are
  // the save confirmation.

  // And the persistence call itself: an op:"insert" into `workouts` carrying the
  // raw message and the parsed exercises.
  await expect
    .poll(() => calls.some((c) =>
      c.url.endsWith("/api/data") &&
      c.body?.op === "insert" &&
      c.body?.table === "workouts" &&
      c.body?.data?.raw_message === workoutMsg &&
      c.body?.data?.parsed_data?.exercises?.[0]?.name === "Push-Up"
    ))
    .toBe(true);
});
