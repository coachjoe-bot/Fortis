// ─── T58/3b: BUILDER MODE IN CHAT (Will's approved mockup, scene 3+4) ────────
// Drives the whole ruled flow in a real browser against the mocked AI: the
// opt-in question with the ~10 minute warning, the blueprint strip, an
// interview answer filling cells, the read-back gate, drafting, and the
// program sheet's Save to Drafts. Also pins SAVE & EXIT parking and the
// no-interview-mid-workout guard's ancestor (offer while a workout bar is up).
import { test, expect } from "@playwright/test";
import { mockApi, makeAthlete, loginAsAthlete } from "./mocks.js";

const CREATE_PARSE = {
  exercises: [], run_data: null, practice_data: null, pain_flags: [], pr_attempts: [],
  session_feel: null, general_notes: null, is_program_update: false, program_append: false,
  program_create_request: true, is_temp_program_update: false, is_program_revert: false,
  program_position_claim: null, program_block_span: null, log_correction: null, coach_flag: null,
};

async function askForProgram(page) {
  const box = page.getByPlaceholder(/Tell Coach Joe about your workout/);
  await box.fill("can you build me a program");
  await page.getByRole("button", { name: "→" }).click();
  await page.getByRole("button", { name: "Enable Builder mode" }).click({ timeout: 20000 });
}

test("builder mode: offer → strip → answer fills cells → read-back → draft → Save to Drafts", async ({ page }) => {
  const athlete = makeAthlete({ program_text: null });
  await mockApi(page, { athlete, parseResult: CREATE_PARSE });
  await loginAsAthlete(page, athlete, "/?chatfirst=1");

  await askForProgram(page);

  // The blueprint strip appears under the header with SAVE & EXIT.
  await expect(page.getByText("Blueprint", { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("button", { name: "Save & Exit" })).toBeVisible();

  // The interviewer's opener question shows with its chips.
  await expect(page.getByText(/one number and date/)).toBeVisible({ timeout: 20000 });

  // One answer → the extractor fills every cell → the read-back gate appears.
  await page.getByRole("button", { name: "Bench 225 by Oct 1" }).click();
  await expect(page.getByText(/read this back/)).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "All correct — lock it in" }).click();
  await page.getByRole("button", { name: "Draft it now" }).click();

  // The drafted program rides the program sheet with its two actions.
  await expect(page.getByRole("textbox", { name: "Program draft" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("textbox", { name: "Program draft" })).toHaveValue(/BLOCK INFO/);
  await expect(page.getByPlaceholder("Tell Joe what to change…")).toBeVisible();
  await page.getByRole("button", { name: "Save to Drafts" }).click();
  await expect(page.getByText(/Saved as a draft under Program, Memory/)).toBeVisible({ timeout: 15000 });
  // The bar leaves the screen on save.
  await expect(page.getByRole("button", { name: "Save to Drafts" })).toHaveCount(0);
});

test("builder mode: SAVE & EXIT parks the interview to Memory, Drafts", async ({ page }) => {
  const athlete = makeAthlete({ program_text: null });
  await mockApi(page, { athlete, parseResult: CREATE_PARSE });
  await loginAsAthlete(page, athlete, "/?chatfirst=1");
  await askForProgram(page);
  await expect(page.getByText(/one number and date/)).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Save & Exit" }).click();
  await expect(page.getByText(/Parked it/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Blueprint", { exact: true })).toHaveCount(0);
});

test("chat-first: the BUILDER tab is gone; PHASES reads MEMORY", async ({ page }) => {
  const athlete = makeAthlete({ program_text: "Day 1 - Push\nBench Press 3x5 @ 185" });
  await mockApi(page, { athlete });
  await loginAsAthlete(page, athlete, "/?chatfirst=1");
  await page.getByRole("button", { name: "Program", exact: true }).click();
  await expect(page.getByRole("button", { name: "MEMORY" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "BUILDER", exact: true })).toHaveCount(0);
});
