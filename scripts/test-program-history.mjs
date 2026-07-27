// programHistory regression suite — run with: node scripts/test-program-history.mjs
// Covers the block-vs-tweak decision in snapshotProgramHistory with mocked data/AI
// deps. Deterministic, no network. Part of the Program Builder Phase B ship gate
// (docs/program-builder-build-handoff.md).

import { snapshotProgramHistory, startNextBlock, digestWorkouts, changedRatio, NEW_BLOCK_RATIO } from "../src/programHistory.js";

let fail = 0;
const bad = (msg) => { fail++; console.error("  ✗ " + msg); };
const ok = (cond, msg) => { if (!cond) bad(msg); };

const PROGRAM = `Week 1
Day 1 - Squat Day
Back Squat 5x5 @225
Leg Press 3x10
Leg Curl 3x12

Day 2 - Bench Day
Bench Press 5x5 @185
Incline DB Press 3x10
Tricep Pushdown 3x15

Day 3 - Deadlift Day
Deadlift 3x5 @275
Barbell Row 4x8
Face Pull 3x15`;

const REWRITE = `BLOCK 2 — INTENSIFICATION
Mon: Comp Squat 5x3 @ 85%, Pause Squat 3x3
Wed: Comp Bench 5x3 @ 85%, CG Bench 3x5
Fri: Deadlift 4x2 @ 87%, Block Pull 3x3
Sat: Upper accessories + carries`;

// Mock harness: latest = the program_history row sbRead returns; closeBlock's
// extra reads (workouts for the recap digest, athlete_goals) return empty by
// default. calls are recorded per table.
function harness(latestRow, { haikuFails = false, workouts = [] } = {}) {
  const calls = { inserts: [], updates: [], asked: 0 };
  const deps = {
    sbRead: async (table) => {
      if (table === "program_history") return latestRow ? [latestRow] : [];
      if (table === "workouts") return workouts;
      return [];
    },
    sbInsert: async (table, data) => { calls.inserts.push({ table, data }); return [{}]; },
    sbUpdateWhere: async (table, params, data) => { calls.updates.push({ table, params, data }); return [{}]; },
    askClaude: async () => { calls.asked++; if (haikuFails) throw new Error("boom"); return "4-day strength block — squat/bench 5s"; },
  };
  return { calls, deps };
}
const openBlock = (text) => ({ id: "blk-1", program_text: text, completed_at: null, applied_at: "2026-07-01T00:00:00Z" });
// closeBlock now writes completed_at first, then (best-effort) block_recap in a
// second update — assertions pick the writes apart instead of counting them.
const closes = (calls) => calls.updates.filter((u) => u.data && u.data.completed_at);
const recaps = (calls) => calls.updates.filter((u) => u.data && u.data.block_recap);

// ── changedRatio sanity ──────────────────────────────────────────────────────
console.log("changedRatio:");
ok(changedRatio(PROGRAM, PROGRAM) === 0, "identical text → 0");
ok(changedRatio(PROGRAM, REWRITE) > 0.9, "total rewrite → ~1");
{
  const tweak = PROGRAM.replace("@225", "@235");
  const r = changedRatio(PROGRAM, tweak);
  ok(r > 0 && r < NEW_BLOCK_RATIO, `one-line weight bump stays under the block threshold (got ${r.toFixed(2)})`);
}

// ── first save → new block with summary ──────────────────────────────────────
console.log("first save:");
{
  const { calls, deps } = harness(null);
  await snapshotProgramHistory({ athleteId: "a1", text: PROGRAM, source: "chat_save" }, deps);
  ok(calls.inserts.length === 1, "inserts exactly one row");
  ok(calls.inserts[0]?.data.source === "chat_save", "carries the source");
  ok(calls.inserts[0]?.data.block_summary?.includes("strength block"), "carries the Haiku summary");
  ok(calls.updates.length === 0, "no previous block to close");
}

// ── no-op save ───────────────────────────────────────────────────────────────
console.log("no-op save:");
{
  const { calls, deps } = harness(openBlock(PROGRAM));
  await snapshotProgramHistory({ athleteId: "a1", text: PROGRAM, source: "manual_edit" }, deps);
  ok(calls.inserts.length === 0 && calls.updates.length === 0 && calls.asked === 0, "identical text writes nothing");
}

// ── tweak → update the open block in place ───────────────────────────────────
console.log("tweak (PR propagation):");
{
  const tweaked = PROGRAM.replace("@225", "@235").replace("@185", "@190");
  const { calls, deps } = harness(openBlock(PROGRAM));
  await snapshotProgramHistory({ athleteId: "a1", text: tweaked, source: "pr_propagation" }, deps);
  ok(calls.inserts.length === 0, "no new block for a weight bump");
  ok(calls.updates.length === 1 && calls.updates[0].data.program_text === tweaked, "open block text updated in place");
  ok(!("completed_at" in (calls.updates[0]?.data || {})), "open block stays open");
  ok(calls.asked === 0, "no Haiku spend on a tweak");
}

// ── rewrite → close old block, open new ──────────────────────────────────────
console.log("rewrite:");
{
  const { calls, deps } = harness(openBlock(PROGRAM));
  await snapshotProgramHistory({ athleteId: "a1", text: REWRITE, source: "coach_save" }, deps);
  ok(closes(calls).length === 1, "previous block closed");
  ok(recaps(calls).length === 1, "closed block got its recap");
  ok(calls.inserts.length === 1 && calls.inserts[0].data.program_text === REWRITE.trim(), "new block inserted");
}

// ── closed latest never evolves in place ─────────────────────────────────────
console.log("closed latest:");
{
  const closed = { ...openBlock(PROGRAM), completed_at: "2026-07-20T00:00:00Z" };
  const tweaked = PROGRAM.replace("@225", "@235");
  const { calls, deps } = harness(closed);
  await snapshotProgramHistory({ athleteId: "a1", text: tweaked, source: "manual_edit" }, deps);
  ok(calls.inserts.length === 1, "similar save after a close still opens a NEW block");
  ok(closes(calls).length === 0, "the already-closed block is left alone");
}

// ── forceNewBlock overrides similarity ───────────────────────────────────────
console.log("forceNewBlock:");
{
  const nearSame = PROGRAM.replace("@225", "@230");
  const { calls, deps } = harness(openBlock(PROGRAM));
  await snapshotProgramHistory({ athleteId: "a1", text: nearSame, source: "chat_replace", forceNewBlock: true }, deps);
  ok(calls.inserts.length === 1, "explicit replace always opens a new block");
  ok(closes(calls).length === 1, "and closes the old one");
}

// ── cleared program → close only ─────────────────────────────────────────────
console.log("cleared program:");
{
  const { calls, deps } = harness(openBlock(PROGRAM));
  await snapshotProgramHistory({ athleteId: "a1", text: "", source: "manual_edit" }, deps);
  ok(calls.inserts.length === 0, "no row for an empty program");
  ok(closes(calls).length === 1, "open block closed");
}

// ── AI failure never costs the snapshot or the close ─────────────────────────
console.log("summary failure:");
{
  const { calls, deps } = harness(null, { haikuFails: true });
  await snapshotProgramHistory({ athleteId: "a1", text: PROGRAM, source: "chat_save" }, deps);
  ok(calls.inserts.length === 1 && calls.inserts[0].data.block_summary === null, "row lands with a null summary");
}
{
  const { calls, deps } = harness(openBlock(PROGRAM), { haikuFails: true });
  await snapshotProgramHistory({ athleteId: "a1", text: REWRITE, source: "coach_save" }, deps);
  ok(closes(calls).length === 1, "recap failure still stamps completed_at");
  ok(recaps(calls).length === 0, "no recap written on AI failure");
  ok(calls.inserts.length === 1, "new block still lands");
}

// ── startNextBlock: same text, explicit boundary ─────────────────────────────
console.log("startNextBlock:");
{
  const { calls, deps } = harness(openBlock(PROGRAM), { workouts: [
    { created_at: "2026-07-03T18:00:00Z", parsed_data: { exercises: [{ name: "Back Squat", sets: 5, reps: 5, weight: 225 }] } },
  ] });
  const did = await startNextBlock({ athleteId: "a1", programText: PROGRAM }, deps);
  ok(did === true, "transition happens on an open block");
  ok(closes(calls).length === 1, "old block closed");
  ok(recaps(calls).length === 1, "old block recapped from the logs");
  ok(calls.inserts.length === 1 && calls.inserts[0].data.source === "next_block", "new row opens with source next_block");
  ok(calls.inserts[0].data.program_text === PROGRAM.trim() || calls.inserts[0].data.program_text === PROGRAM, "same program text carries over");
}
{
  const closed = { ...openBlock(PROGRAM), completed_at: "2026-07-20T00:00:00Z" };
  const { calls, deps } = harness(closed);
  const did = await startNextBlock({ athleteId: "a1", programText: PROGRAM }, deps);
  ok(did === false && calls.inserts.length === 0 && calls.updates.length === 0, "no open block → no-op");
}

// ── digestWorkouts formatting ────────────────────────────────────────────────
console.log("digestWorkouts:");
{
  const d = digestWorkouts([
    { created_at: "2026-07-03T18:00:00Z", parsed_data: { exercises: [{ name: "Back Squat", sets: 5, reps: 5, weight: 225 }, { name: "Pull-Up", sets: 3, reps: 10, weight: null }] } },
    { created_at: "2026-07-04T18:00:00Z", parsed_data: {} },
  ]);
  ok(/2026-07-03: Back Squat 5x5 @225, Pull-Up 3x10/.test(d), `session line formatted (got "${d}")`);
  ok(!/2026-07-04/.test(d), "empty session omitted");
  ok(digestWorkouts([]) === "" && digestWorkouts(null) === "", "empty/garbage input → empty digest");
}

if (fail) { console.error(`\n${fail} FAILED`); process.exit(1); }
console.log("\nAll program-history checks green.");
