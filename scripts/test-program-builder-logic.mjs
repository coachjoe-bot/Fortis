// Program Builder engine suite (pure logic, no network) — run with:
//   node scripts/test-program-builder-logic.mjs
// Covers cell/scope rules, pre-charge, the one-topic doctrine router, prompt
// parsing, and the deterministic draft validator. The credentialed AI harness
// (real drafts against these same rules) is scripts/test-program-build.mjs.

import {
  ATHLETE_CELLS, COACH_CELLS, cellsFor, blueprintPct, precharge, pickTopic,
  parseExtraction, parseInterviewerReply, validateDraft, draftUser,
} from "../src/programBuilder.js";

let fail = 0;
const bad = (msg) => { fail++; console.error("  ✗ " + msg); };
const ok = (cond, msg) => { if (!cond) bad(msg); };

// ── cells & scopes ───────────────────────────────────────────────────────────
console.log("cells & scopes:");
ok(ATHLETE_CELLS.length === 8, "athlete set has 8 cells");
ok(COACH_CELLS.some(c => c.key === "team_destination") && COACH_CELLS.some(c => c.key === "house_rules"), "coach set adds team cells");
ok(cellsFor("athlete", "full").length === 8, "athlete full = all cells");
ok(cellsFor("athlete", "short").every(c => ["goal","schedule","equipment","red_flags","handoff"].includes(c.key)), "short scope trims to block cells");
ok(cellsFor("coach", "quick").length === 3, "quick scope = 3 cells");

// ── blueprint % ──────────────────────────────────────────────────────────────
console.log("blueprint pct:");
{
  const cells = cellsFor("athlete", "quick" in {} ? "quick" : "short");
  const bp = { goal: { value: "Squat 315 by Sep 1" }, schedule: { value: "4 days" }, equipment: { value: "full gym" } };
  ok(blueprintPct(bp, cells) === Math.round(3 / cells.length * 100), "pct counts only filled cells");
  ok(blueprintPct({ ...bp, red_flags: { value: "", pending: "knee?" } }, cells) === Math.round(3 / cells.length * 100), "pending does not count as filled");
}

// ── precharge ────────────────────────────────────────────────────────────────
console.log("precharge:");
{
  const bp = precharge({
    athlete: { goal: "get stronger", training_days_per_week: 4, equipment: ["barbell", "rack"], injury_history: "old ankle sprain" },
    lastBlock: { block_summary: "4-day strength block", applied_at: "2026-07-01T00:00:00Z" },
  });
  ok(bp.goal && !bp.goal.value && bp.goal.pending === "get stronger", "known goal rides as PENDING (SMART gate decides)");
  ok(/4 days/.test(bp.schedule?.value || ""), "schedule pre-charged from signup");
  ok(/barbell/.test(bp.equipment?.value || ""), "equipment pre-charged");
  ok(/ankle/.test(bp.red_flags?.value || ""), "injury history pre-charges red flags");
  ok(/4-day strength block/.test(bp.handoff?.value || ""), "last block pre-charges hand-off");
}

// ── topic router: ONE file, priority order ───────────────────────────────────
console.log("topic router:");
ok(pickTopic({ blueprint: { red_flags: { value: "nagging knee pain" } }, viewer: "coach" }) === "return", "injury beats team");
ok(pickTopic({ blueprint: { schedule: { value: "in-season, games every friday" } } }) === "inseason", "in-season detected");
ok(pickTopic({ blueprint: {}, viewer: "coach" }) === "team", "coach defaults to team");
ok(pickTopic({ blueprint: {}, athlete: { age: 14 } }) === "youth", "young athlete routes youth");
ok(pickTopic({ blueprint: { goal: { value: "", pending: "run a faster mile" } }, athlete: { age: 22 } }) === "conditioning", "conditioning goal routes conditioning");
ok(pickTopic({ blueprint: { goal: { value: "bench 225" } }, athlete: { age: 25 } }) === null, "plain strength adult routes core-only");

// ── extractor parsing ────────────────────────────────────────────────────────
console.log("extractor parsing:");
{
  const r = parseExtraction('Here you go: {"cells":{"schedule":"5 days/week","red_flags":"None"},"goal_smart":{"ok":false,"why":"no date"}}');
  ok(r.cells.schedule === "5 days/week" && r.cells.red_flags === "None", "cells parsed through prose wrapper");
  ok(r.smart && r.smart.ok === false && /date/.test(r.smart.why), "smart verdict parsed");
  ok(parseExtraction("total garbage").cells && Object.keys(parseExtraction("garbage").cells).length === 0, "garbage degrades to empty, never throws");
}

// ── interviewer reply parsing ────────────────────────────────────────────────
console.log("interviewer parsing:");
{
  const r = parseInterviewerReply("You said 4 days at signup — still true?\nCHIPS: Yes, 4 days | More now | Fewer now");
  ok(r.chips.length === 3 && r.chips[1] === "More now", "chips split on |");
  ok(!/CHIPS:/.test(r.text), "chips line stripped from prose");
  ok(parseInterviewerReply("No chips here.").chips.length === 0, "missing chips line = no chips");
}

// ── draft validator ──────────────────────────────────────────────────────────
console.log("draft validator:");
{
  const good = `STRENGTH BLOCK — squat focus
Day 1 - Squat
Warm-up: 8 min dynamic + empty-bar squats
Back Squat 5x5 @ 80%
Leg Press 3x10
Cool-down: 5 min quad/hip stretching

Day 2 - Bench
Warm-up: 8 min dynamic + light DB press
Bench Press 5x5 @ 80%
Row 4x8
Cool-down: 5 min chest/lat stretching

Day 3 - Deadlift
Warm-up: 8 min dynamic + light pulls
Deadlift 3x5 @ 82%
Split Squat 3x8
Cool-down: 5 min hamstring stretching

Week 2: +5 lbs on mains. Deload when two sessions stall.`;
  const bp = { schedule: { value: "3 days/week" }, equipment: { value: "full gym" } };
  ok(validateDraft(good, { blueprint: bp }).ok, "well-formed draft passes");
  ok(!validateDraft(good.replace(/Warm-up:.*\n/g, ""), { blueprint: bp }).ok, "missing warm-ups fail");
  ok(!validateDraft(good, { blueprint: { ...bp, schedule: { value: "5 days/week" } } }).ok, "day count below schedule fails");
  ok(!validateDraft(good, { blueprint: { ...bp, equipment: { value: "bodyweight only, no barbell" } } }).ok, "barbell work in a no-barbell blueprint fails");
  ok(!validateDraft("too short", { blueprint: bp }).ok, "stub text fails");
}

// ── draft prompt carries the blueprint ───────────────────────────────────────
console.log("draft prompt:");
{
  const cells = cellsFor("athlete", "short");
  const bp = { goal: { value: "Squat 315 by Sept" }, schedule: { value: "4 days/week" }, equipment: { value: "home gym" }, red_flags: { value: "None" }, handoff: { value: "first block" } };
  const u = draftUser({ blueprint: bp, cells, athlete: { name: "Test", sport: "Football" } });
  ok(/Squat 315/.test(u) && /home gym/.test(u) && /Football/.test(u), "user prompt carries goal, equipment, athlete");
}

if (fail) { console.error(`\n${fail} FAILED`); process.exit(1); }
console.log("\nAll program-builder logic checks green.");
