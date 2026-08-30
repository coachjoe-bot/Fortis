// ─── T58 CHAT-FIRST: the dock + inline log sheet (Will's approved mockup) ────
// Drives the flag's preview override (?chatfirst=1 — the same surface Will
// previews on web before the native flag flips) through the ruled flow:
// opener start question → bar + sheet → composer edits-only → FINISH WORKOUT.
// Also pins the two global kills that shipped un-gated: the suggestion marquee
// and (under chat-first) the LOG nav button.
import { test, expect } from "@playwright/test";
import { mockApi, makeAthlete, loginAsAthlete } from "./mocks.js";

const PROGRAM = "Day 1 - Push\nBench Press 3x5 @ 185\nOverhead Press 3x8 @ 95\n\nDay 2 - Pull\nDeadlift 3x5 @ 275\nBarbell Row 3x8 @ 155";
// splitQuickLogReply shape: focus note === log — what the opener/QL generator returns.
const DRAFT_REPLY = "Week 1, Day 1: Push. Heavy bench day.\n===\nDay 1 - Push\n\nBench Press 3x5 @ 185\nOverhead Press 3x8 @ 95";

test("the marquee is dead everywhere — nothing auto-scrolls above the composer", async ({ page }) => {
  const athlete = makeAthlete({ program_text: null });
  await mockApi(page, { athlete });
  await loginAsAthlete(page, athlete);
  await expect(page.getByText("I'm at the hotel gym")).toHaveCount(0);
  await expect(page.getByText("Review my program and tell me what you think.")).toHaveCount(0);
});

test("chat-first: LOG button gone, opener start → bar → sheet → finish sends the log", async ({ page }) => {
  const athlete = makeAthlete({ program_text: PROGRAM });
  await mockApi(page, { athlete, chatReply: DRAFT_REPLY });
  await loginAsAthlete(page, athlete, "/?chatfirst=1");

  // The LOG nav button dissolved into chat.
  await expect(page.getByRole("button", { name: "LOG", exact: true })).toHaveCount(0);

  // The opener asks the start question (the chips STAY — only the marquee died).
  await page.getByRole("button", { name: "Start Workout" }).click();

  // The bar appears above the composer, titled with the session's day label.
  const bar = page.getByText("Day 1 - Push", { exact: true }).first();
  await expect(bar).toBeVisible({ timeout: 15000 });

  // Tap the bar: the sheet slides up — ONE editable sheet (a single textarea),
  // the focus note above it, and the composer becomes the edit box.
  await bar.click();
  const sheetText = page.getByRole("textbox", { name: "Today's workout log" });
  await expect(sheetText).toBeVisible();
  await expect(sheetText).toHaveValue(/Bench Press 3x5 @ 185/);
  await expect(page.getByPlaceholder("Tell Joe what to change…")).toBeVisible();

  // The date line: a real date input capped at today, with the ⓘ explainer —
  // a TAP toggle now (title-attr tooltips don't exist on iOS; Will 08-25).
  await expect(page.getByLabel("Logging for date")).toBeVisible();
  const info = page.getByRole("button", { name: "What is this date for?" });
  await expect(info).toBeVisible();
  await info.click();
  await expect(page.getByText("Logging a workout for another day? Adjust the date.")).toBeVisible();
  await info.click();
  await expect(page.getByText("Logging a workout for another day? Adjust the date.")).toHaveCount(0);

  // Direct edit on the sheet auto-saves (typing works; no per-exercise boxes).
  await sheetText.fill("Day 1 - Push\n\nBench Press 3x5 @ 190\nOverhead Press 3x8 @ 95");

  // FINISH WORKOUT sends the sheet to chat as the log and takes the bar down.
  await page.getByRole("button", { name: "Finish Workout" }).click();
  await expect(page.getByText("Bench Press 3x5 @ 190")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Finish Workout" })).toHaveCount(0);
});

test("chat-first: the ✕ takes the bar off the screen without sending anything", async ({ page }) => {
  const athlete = makeAthlete({ program_text: PROGRAM });
  await mockApi(page, { athlete, chatReply: DRAFT_REPLY });
  await loginAsAthlete(page, athlete, "/?chatfirst=1");
  await page.getByRole("button", { name: "Start Workout" }).click();
  const bar = page.getByText("Day 1 - Push", { exact: true }).first();
  await expect(bar).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Take it off the screen", exact: true }).click();
  await expect(page.getByText("Day 1 - Push", { exact: true })).toHaveCount(0);
});

test("web without the override keeps the tab UI: LOG button present", async ({ page }) => {
  const athlete = makeAthlete({ program_text: PROGRAM });
  await mockApi(page, { athlete, chatReply: DRAFT_REPLY });
  await loginAsAthlete(page, athlete);
  await expect(page.getByRole("button", { name: "LOG", exact: true })).toBeVisible();
});

test("chat-first: a kg athlete's sheet shows the draft in kg (Will 08-25 — the log follows Settings)", async ({ page }) => {
  const athlete = makeAthlete({ program_text: PROGRAM, weight_unit: "kg" });
  await mockApi(page, { athlete, chatReply: DRAFT_REPLY });
  await loginAsAthlete(page, athlete, "/?chatfirst=1");
  await page.getByRole("button", { name: "Start Workout" }).click();
  const bar = page.getByText("Day 1 - Push", { exact: true }).first();
  await expect(bar).toBeVisible({ timeout: 15000 });
  await bar.click();
  // The draft engine writes lbs; the sheet converts to the Settings unit,
  // number-first with an explicit suffix (draftInUnit): 185 lbs -> 85 kg.
  const sheetText = page.getByRole("textbox", { name: "Today's workout log" });
  await expect(sheetText).toHaveValue(/Bench Press 3x5 @ 85 kg/);
  await expect(sheetText).toHaveValue(/Overhead Press 3x8 @ 42\.5 kg/);
});

test("chat-first: the quicklog deep link lands on the chat sheet, never the old Quick Log screen (Will 08-25)", async ({ page }) => {
  const athlete = makeAthlete({ program_text: PROGRAM });
  await mockApi(page, { athlete, chatReply: DRAFT_REPLY });
  await loginAsAthlete(page, athlete, "/?chatfirst=1&n=quicklog");
  // The chat-first log sheet opens with the drafted session…
  const sheetText = page.getByRole("textbox", { name: "Today's workout log" });
  await expect(sheetText).toBeVisible({ timeout: 15000 });
  await expect(sheetText).toHaveValue(/Bench Press 3x5 @ 185/, { timeout: 15000 });
  // …and the composer is in edits-only mode — the sheet, not the legacy modal.
  await expect(page.getByPlaceholder("Tell Joe what to change…")).toBeVisible();
});
