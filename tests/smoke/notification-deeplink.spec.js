// Smoke: a notification's destination actually opens the screen it names (T51).
//
// Every push used to carry url:"/", so this could not have been tested — there
// was nothing to land on. These cover the client half end to end in a real
// browser: the `?n=` param is captured before the URL is tidied, survives the
// login hop, and opens the right screen once history has loaded.
import { test, expect } from "@playwright/test";
import { mockApi, makeAthlete, loginAsAthlete } from "./mocks.js";

// loginAsAthlete starts at "/", so arm the target by landing on the deep link
// first — exactly what a cold tap does — and let the login flow proceed from
// there without a reload.
async function loginVia(page, athlete, target) {
  await page.goto(`/?n=${target}`);
  await page.getByRole("button", { name: "Athlete Login" }).click();
  await page.getByPlaceholder("Your name, or the email you signed up with").fill(athlete.name);
  await page.getByPlaceholder("----").fill("1234");
  await page.getByRole("button", { name: "Let's Get to Work ->" }).click();
  await page.getByText("WILCO", { exact: true }).waitFor();
}

test("a feed push lands ON the Proof tab, not the app root", async ({ page }) => {
  const athlete = makeAthlete();
  await mockApi(page, { athlete });

  await loginVia(page, athlete, "proof");

  // MY LOG opened itself, on Proof — the tab the push was announcing. Asserted on
  // the Proof tab's own CONTENT (its empty state for an athlete with no digest
  // yet), not on tab styling: what matters is which screen the athlete is looking
  // at, and this string exists nowhere else in the modal.
  await expect(page.getByText("MY WORKOUT LOG")).toBeVisible();
  await expect(page.getByText(/first letter from Coach Joe/i)).toBeVisible();
});

test("an inactivity nudge lands on the workouts list", async ({ page }) => {
  const athlete = makeAthlete();
  await mockApi(page, { athlete });

  await loginVia(page, athlete, "log");

  await expect(page.getByText("MY WORKOUT LOG")).toBeVisible();
});

test("the destination is stripped from the URL and never re-fires", async ({ page }) => {
  const athlete = makeAthlete();
  await mockApi(page, { athlete });

  await loginVia(page, athlete, "proof");
  await expect(page.getByText("MY WORKOUT LOG")).toBeVisible();

  // The param is gone from the address bar the moment it is captured, so a
  // refresh or a screenshotted URL can't re-open the screen days later.
  expect(new URL(page.url()).searchParams.get("n")).toBeNull();

  // And closing MY LOG stays closed — the target is consumed exactly once, so a
  // re-render can't yank the athlete back into it.
  await page.getByRole("button", { name: /close|✕/i }).first().click();
  await expect(page.getByText("MY WORKOUT LOG")).toBeHidden();
});

test("a hand-typed target that no push can send is ignored", async ({ page }) => {
  const athlete = makeAthlete();
  await mockApi(page, { athlete });

  await loginVia(page, athlete, "..%2Fadmin");

  // Nothing opened: an off-list target is dropped, not stored.
  await expect(page.getByText("MY WORKOUT LOG")).toBeHidden();
  await expect(page.getByPlaceholder(/Tell Coach Joe about your workout/)).toBeEnabled();
});
