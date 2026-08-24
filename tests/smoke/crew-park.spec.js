// ─── CREW PARK (Will, 08-20: "not polished enough — get rid of it for now") ───
// Crew is hidden everywhere behind src/flags.js CREW_ENABLED=false; the code and
// data are kept for revival. This spec asserts the rendered truth of the park on
// the athlete surface. When the flag flips back on, these assertions invert —
// replace this spec with real crew coverage rather than deleting it silently.
import { test, expect } from "@playwright/test";
import { mockApi, makeAthlete, loginAsAthlete } from "./mocks.js";

test("MY LOG shows no CREW tab while crew is parked", async ({ page }) => {
  const athlete = makeAthlete({ total_sessions_logged: 4 });
  await mockApi(page, { athlete });

  await loginAsAthlete(page, athlete);
  await page.getByRole("button", { name: "MY LOG" }).click();
  await expect(page.getByText("MY WORKOUT LOG")).toBeVisible();
  // The tab bar carries workouts + proof only.
  await expect(page.getByRole("button", { name: "workouts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "proof" })).toBeVisible();
  await expect(page.getByRole("button", { name: "crew", exact: true })).toHaveCount(0);
});

test("a crew deep link falls back to the workouts tab", async ({ page }) => {
  const athlete = makeAthlete({ total_sessions_logged: 4 });
  await mockApi(page, { athlete });

  // Notification deep link ?n=crew — captured at module load, consumed at boot.
  // Same login-from-the-deep-link pattern as notification-deeplink.spec.js.
  await page.goto("/?n=crew");
  await page.getByRole("button", { name: "Athlete Login" }).click();
  await page.getByPlaceholder("Your name, or the email you signed up with").fill(athlete.name);
  await page.getByPlaceholder("----").fill("1234");
  await page.getByRole("button", { name: "Let's Get to Work ->" }).click();
  await page.getByText("WILCO", { exact: true }).waitFor();
  await expect(page.getByText("MY WORKOUT LOG")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "crew", exact: true })).toHaveCount(0);
  await expect(page.getByText("Total Workouts")).toBeVisible(); // landed on workouts
});
