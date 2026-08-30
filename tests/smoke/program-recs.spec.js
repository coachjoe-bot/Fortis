// ─── PROGRAM RECS (Will's 08-28 design) ──────────────────────────────────────
// Staged program changes under chat-first: the pattern gate (first mention =
// watched note, repeat/severity = rec), the rec bar + sheet (week-tagged swaps,
// collapsible WHY, hard durations), deterministic apply with instant local
// sync, and boot restore of an un-parked rec.
import { test, expect } from "@playwright/test";
import { mockApi, makeAthlete, loginAsAthlete, emptyParse } from "./mocks.js";

const PROGRAM = "Day 1 - Push\nBench Press 3x5 @ 185\nOverhead Press 3x8 @ 95\n\nDay 2 - Pull\nDeadlift 3x5 @ 275\nBarbell Row 3x8 @ 155";
const DRAFT_REPLY = "Week 1, Day 1: Push. Heavy bench day.\n===\nDay 1 - Push\n\nBench Press 3x5 @ 185\nOverhead Press 3x8 @ 95";
const painParse = (msg) => ({ ...emptyParse, coach_flag: "pain", general_notes: msg });

const REC_ROW = (athleteId) => ({
  id: "rec-row-1",
  athlete_id: athleteId,
  owner_type: "athlete",
  title: "Pec swap",
  status: "rec",
  draft_text: "",
  transcript: [],
  updated_at: new Date().toISOString(),
  blueprint: { rec: {
    v: 1, title: "Pec swap", origin: "pain", duration: "2w", parked: false,
    why: "Pec pain two weeks running, floor press cuts the stretch.",
    swaps: [{ week: null, day: "Day 1 - Push", find: "Bench Press 3x5 @ 185", replace: "Floor Press 3x5 @ 165" }],
  } },
});

test("rec: boot restores the bar, the sheet shows the tagged swap, Apply lands byte-for-byte", async ({ page }) => {
  const athlete = makeAthlete({ program_text: PROGRAM });
  const { calls } = await mockApi(page, {
    athlete, chatReply: DRAFT_REPLY,
    dataReads: { program_drafts: (body) => String(body.params || "").includes('status=in.("rec"') ? [REC_ROW(athlete.id)] : [] },
  });
  await loginAsAthlete(page, athlete, "/?chatfirst=1&mastermind=1");

  // The bar survives restarts: it comes back on boot for an un-parked rec.
  const bar = page.getByText("PROGRAM REC — Pec swap").first();
  await expect(bar).toBeVisible({ timeout: 15000 });

  // Open the sheet: WHY strip, the struck original with its day tag, the
  // editable replacement, hard duration chips (no Permanent anywhere).
  await bar.click();
  await expect(page.getByText("Pec pain two weeks running", { exact: false })).toBeVisible();
  await expect(page.getByText("Day 1 - Push — replacing")).toBeVisible();
  await expect(page.getByText("Bench Press 3x5 @ 185").first()).toBeVisible();
  const repl = page.getByRole("textbox", { name: "Replacement 1" });
  await expect(repl).toHaveValue("Floor Press 3x5 @ 165");
  await expect(page.getByRole("button", { name: "2 weeks" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rest of block" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Permanent" })).toHaveCount(0);
  // The composer is the scope tool now — no scope chips.
  await expect(page.getByPlaceholder("I also want to change…")).toBeVisible();

  // Hand edit is verbatim, then Apply: deterministic swap + instant sync.
  await repl.fill("Floor Press 4x5 @ 160");
  await page.getByRole("button", { name: "Apply to Program" }).click();
  await expect(page.getByText(/Applied\./).first()).toBeVisible({ timeout: 15000 });

  const write = calls.find((c) => c.body?.op === "update" && c.body?.table === "athletes" && c.body?.data?.program_text);
  expect(write).toBeTruthy();
  expect(write.body.data.program_text).toContain("Floor Press 4x5 @ 160");
  expect(write.body.data.program_text).not.toContain("Bench Press 3x5 @ 185");
  expect(write.body.data.program_text).toContain("Overhead Press 3x8 @ 95"); // everything else untouched
});

test("rec pattern gate: a first pain mention is NOTED (watched note), never a rec", async ({ page }) => {
  const msg = "my knee felt a little cranky on squats today";
  const athlete = makeAthlete({ program_text: PROGRAM });
  const { calls } = await mockApi(page, { athlete, chatReply: DRAFT_REPLY, parseResult: painParse(msg) });
  await loginAsAthlete(page, athlete, "/?chatfirst=1&mastermind=1");

  await page.getByPlaceholder(/Tell Coach Joe about your workout/).fill(msg);
  await page.getByRole("button", { name: "→" }).click();
  await expect(page.getByText("Noted. One rough day doesn't change the plan", { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/PROGRAM REC —/)).toHaveCount(0);

  const noted = calls.find((c) => c.body?.op === "insert" && c.body?.table === "athlete_memory");
  expect(noted).toBeTruthy();
  expect(noted.body.data.content).toContain("Watching:");
  expect(noted.body.data.content).toContain("(pain)");
});

test("rec pattern gate: a repeat on a watched issue drafts the rec and raises the bar", async ({ page }) => {
  const msg = "knee is bugging me on squats again";
  const athlete = makeAthlete({ program_text: PROGRAM });
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const inTwoWeeks = new Date(Date.now() + 13 * 86400000).toISOString();
  await mockApi(page, {
    athlete, chatReply: DRAFT_REPLY, parseResult: painParse(msg),
    dataReads: { athlete_memory: [{ id: "mem-1", athlete_id: athlete.id, status: "active",
      content: `Watching: knee squats (pain) reported ${yesterday} - a repeat within 2 weeks earns a program rec`,
      kind: "situational", expires_at: inTwoWeeks, updated_at: new Date().toISOString() }] },
    recDraftReply: JSON.stringify({ title: "Knee - box squat swap", why: "Knee talked two sessions running.", duration: "2w",
      swaps: [{ week: null, day: "Day 2 - Pull", find: "Deadlift 3x5 @ 275", replace: "Block Pull 3x5 @ 245" }] }),
  });
  await loginAsAthlete(page, athlete, "/?chatfirst=1&mastermind=1");

  await page.getByPlaceholder(/Tell Coach Joe about your workout/).fill(msg);
  await page.getByRole("button", { name: "→" }).click();
  await expect(page.getByText("That's twice now", { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("PROGRAM REC — Knee - box squat swap").first()).toBeVisible({ timeout: 15000 });
});

test("rec pattern gate: clearly serious language skips the gate on the first report", async ({ page }) => {
  const msg = "sharp pain in my knee on squats, had to stop the set";
  const athlete = makeAthlete({ program_text: PROGRAM });
  await mockApi(page, {
    athlete, chatReply: DRAFT_REPLY, parseResult: painParse(msg),
    recDraftReply: JSON.stringify({ title: "Knee protection", why: "Sharp pain is a stop sign.", duration: "1w",
      swaps: [{ week: null, day: "Day 2 - Pull", find: "Deadlift 3x5 @ 275", replace: "Hip Thrust 3x8 @ 185" }] }),
  });
  await loginAsAthlete(page, athlete, "/?chatfirst=1&mastermind=1");

  await page.getByPlaceholder(/Tell Coach Joe about your workout/).fill(msg);
  await page.getByRole("button", { name: "→" }).click();
  await expect(page.getByText("not something to train through blind", { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("PROGRAM REC — Knee protection").first()).toBeVisible({ timeout: 15000 });
});
