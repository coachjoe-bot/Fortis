// Lock-screen session card suite (T40) — guards the pure layer of
// src/sessionCard.js: the chat-offer intent match, draft→card projection, and
// the staleness rule. Run with: node scripts/test-session-card.mjs
//
// The card's design rule (Will, 2026-08-10): a PROJECTION of the Quick Log
// draft, real weights never percentages, no progress state, gone when logged.

import { asksTodaysWorkout, asksClearCard, buildSessionCard, sessionCardIsLive, SESSION_CARD_MAX_AGE_MS } from "../src/sessionCard.js";

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
};

// ── offer intent ─────────────────────────────────────────────────────────────
console.log("asksTodaysWorkout:");
[
  "What's my workout today?",
  "whats today's workout",
  "what's on for today",
  "What am I doing today",
  "show me today's session",
  "That is what I did yesterday, what's today's workout?",
  "start my workout",
].forEach((m) => ok(asksTodaysWorkout(m), `matches: "${m}"`));
[
  "What did I do for tricep rope push downs last time?",
  "how's my bench progressing",
  "Bench Press 5x5 @ 225",   // a log, not a question
  "review my program and tell me what you think",
  "I'm on week 3 day 2",
].forEach((m) => ok(!asksTodaysWorkout(m), `ignores: "${m}"`));

// ── explicit removal intent ──────────────────────────────────────────────────
// (Only ever consulted while a card is actually pinned — the caller gates it —
// so the bar is "never misses a real removal ask", not "never matches else".)
console.log("asksClearCard:");
[
  "take it off my lock screen",
  "clear the lock screen",
  "remove the notification",
  "get rid of the card",
  "take the pin down",
  "you can take that lockscreen thing off",
].forEach((m) => ok(asksClearCard(m), `matches: "${m}"`));
[
  "what's my workout today",
  "Bench Press 5x5 @ 225",
  "my phone died mid workout",
  "clear communication is key coach",
].forEach((m) => ok(!asksClearCard(m), `ignores: "${m}"`));

// ── draft → card projection ──────────────────────────────────────────────────
console.log("buildSessionCard:");
{
  const draft = [
    "Day 1 – Push A",
    "",
    "Bench Press 5x5 @ 225 (75%)",
    "Overhead Press 4x8 @ 115",
    "Incline DB Press 3x10 @ 80 (last time)",
    "Dips 3x12",
    "Triceps Rope Pushdown 3x12 @ 70 (RPE 8)",
  ].join("\n");
  const card = buildSessionCard(draft, { week: 3 });
  ok(!!card, "builds a card from a standard draft");
  ok(card.title === "DAY 1 – PUSH A · WEEK 3", `title carries the week, uppercased headline-style (got "${card.title}")`);
  ok(/Bench Press 5x5 @ 225$/m.test(card.body), "source tag (75%) stripped — weights, never percentages");
  ok(/Incline DB Press 3x10 @ 80$/m.test(card.body), "(last time) tag stripped");
  ok(/Triceps Rope Pushdown 3x12 @ 70$/m.test(card.body), "(RPE 8) tag stripped");
  ok(card.body.split("\n").length === 5, "every exercise line present");
}
{
  const card = buildSessionCard("Week 3 Day 6 - Oly + Legs\n\nSnatch 4x1 @ 185", { week: 3 });
  ok(card.title === "WEEK 3 DAY 6 - OLY + LEGS", "no duplicate week tag when the label states one");
}
{
  const card = buildSessionCard("Upper B\n\nWeighted Dips 3x8 @ ___\nPush-ups 3x20", {});
  ok(/@ ___$/m.test(card.body), "a fill-in blank survives (never a guessed number)");
  ok(/Push-ups 3x20$/m.test(card.body), "bodyweight lines untouched");
}
ok(buildSessionCard("", { week: 1 }) === null, "empty draft → no card");
ok(buildSessionCard("Day 1 – Push A", { week: 1 }) === null, "label with no exercises → no card");

// ── staleness rule ───────────────────────────────────────────────────────────
console.log("sessionCardIsLive:");
{
  const now = Date.now();
  const today = new Date(now).toLocaleDateString();
  ok(sessionCardIsLive({ day: today, startedAt: now - 60_000 }, now), "fresh same-day card is live");
  ok(!sessionCardIsLive({ day: today, startedAt: now - SESSION_CARD_MAX_AGE_MS - 1 }, now), "a card past the age cap is stale");
  ok(!sessionCardIsLive({ day: "1/1/2020", startedAt: now - 60_000 }, now), "yesterday's card is stale whatever its age");
  ok(!sessionCardIsLive(null, now), "no state → not live");
}

// ── workout start clock (T62 duration) ───────────────────────────────────────
console.log("workout start clock:");
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const { markWorkoutStart, workoutStartAt, clearWorkoutStart, workoutDurationSeconds } = await import("../src/sessionCard.js");
  const now = Date.now();
  ok(workoutStartAt("a1", now) === null, "no stamp, no card → no start clock");
  markWorkoutStart("a1", now - 60 * 60_000);
  ok(workoutStartAt("a1", now) === now - 60 * 60_000, "stamp reads back");
  markWorkoutStart("a1", now - 5 * 60_000);
  ok(workoutStartAt("a1", now) === now - 60 * 60_000, "FIRST start of the day wins (re-pin never restarts the clock)");
  clearWorkoutStart("a1");
  ok(workoutStartAt("a1", now) === null, "cleared clock is gone");
  markWorkoutStart("a2", now - SESSION_CARD_MAX_AGE_MS - 60_000);
  ok(workoutStartAt("a2", now) === null, "a stamp past the draft window is dead");
  markWorkoutStart("a2", now); // a dead stamp is replaceable
  ok(workoutStartAt("a2", now) === now, "a dead stamp gives way to a fresh start");
  // duration rule
  ok(workoutDurationSeconds(now - 45 * 60_000, now) === 45 * 60, "a 45-minute session records 45 minutes");
  ok(workoutDurationSeconds(now - 2 * 60_000, now) === null, "under 5 minutes = typed-after-the-fact, no duration");
  ok(workoutDurationSeconds(now - SESSION_CARD_MAX_AGE_MS - 1000, now) === null, "past the 8h window = abandoned clock, no duration");
  ok(workoutDurationSeconds(null, now) === null, "no clock, no duration, never garbage");
}

console.log(`\n${fail === 0 ? `All ${pass} green.` : `${fail} FAILED, ${pass} passed`}`);
process.exit(fail === 0 ? 0 : 1);
