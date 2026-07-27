// Program-position regression suite — the guard rail for src/programPosition.js.
// Run with: node scripts/test-program-position.mjs
//
// What's at stake: this module decides which workout the athlete is shown when they
// open the app. Get it wrong and Joe confidently prescribes the wrong session — the
// exact failure Will has been correcting by hand for weeks. The rules that MOVE the
// athlete forward (the Sunday turnover, a logged session, a stated override) are the
// ones with teeth, so they carry the most cases here.
//
// All dates are LOCAL and deliberately anchored to real 2026 calendar weeks:
//   Sun Jul 26 · Mon Jul 27 … Sat Aug 1 · Sun Aug 2 · Sun Aug 9

const { parseProgramShape, sundayOnOrBefore, weeksTurnedOver, currentPosition, positionBlock }
  = await import("../src/programPosition.js");

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); } };

const at = (s) => new Date(s).getTime();

// ─── program shapes ──────────────────────────────────────────────────────────
// A: week-sectioned. The template is ONE week's days, not every day in the block.
const WEEK_SECTIONED = `Block II — Strength

Week 1
Day 1 – Push A
Bench Press 4x6 @ 185
Incline DB Press 3x10 @ 60
Day 2 – Pull A
Barbell Row 4x8 @ 155
Lat Pulldown 3x10 @ 120
Day 3 – Legs A
Back Squat 5x5 @ 245

Week 2
Day 1 – Push A
Bench Press 4x6 @ 195
Day 2 – Pull A
Barbell Row 4x8 @ 165
Day 3 – Legs A
Back Squat 5x5 @ 255`;

const shapeA = parseProgramShape(WEEK_SECTIONED);
check("A: template is one week, not the whole block", shapeA.dayTemplate.length === 3);
check("A: day labels in program order", shapeA.dayTemplate[0].includes("Day 1") && shapeA.dayTemplate[2].includes("Day 3"));
check("A: week count found", shapeA.weekCount === 2 && shapeA.hasWeeks);

// B: one day list, loads carried in per-week columns.
const WEEK_COLUMNS = `4-Week Bench Block

Day 1 – Upper
Bench Press 3x5 (Wk1 65%, Wk2 70%, Wk3 75%, Wk4 80%)
Barbell Row 3x8 @ 155
Day 2 – Lower
Back Squat 3x5 (Wk1 70%, Wk2 75%)
Romanian Deadlift 3x8 @ 185`;
const shapeB = parseProgramShape(WEEK_COLUMNS);
check("B: day list is the template", shapeB.dayTemplate.length === 2);
check("B: per-week columns don't become days", !shapeB.dayTemplate.some(d => /wk\s*\d/i.test(d)));
// The block's length is declared only inside the load columns here.
check("B: inline Wk columns give the week count", shapeB.weekCount === 4 && shapeB.hasWeeks);
// One passing mention of a week is prose, not a structure.
check("a lone 'week 1' isn't a week structure", parseProgramShape("Push\nBench 4x6 @ 185\nRow 4x8 @ 155\nSquat 5x5 @ 245\n(start this week 1 day at a time)").hasWeeks === false);

// C: no weeks at all.
const NO_WEEKS = `Push
Bench Press 4x6 @ 185
Overhead Press 3x8 @ 95
Pull
Barbell Row 4x8 @ 155
Legs
Back Squat 5x5 @ 245`;
const shapeC = parseProgramShape(NO_WEEKS);
check("C: three days, no week structure", shapeC.dayTemplate.length === 3 && !shapeC.hasWeeks);
check("C: week count is zero", shapeC.weekCount === 0);

// An exercise line must never be mistaken for a day header — that would shift every
// subsequent day by one and silently prescribe the wrong session.
check("exercise lines are not day headers", !shapeA.dayTemplate.some(d => /\d+\s*x\s*\d+/.test(d)));
check("empty program doesn't crash", parseProgramShape("").dayTemplate.length === 0);
check("null program doesn't crash", parseProgramShape(null).dayTemplate.length === 0);

// D: Will's OWN program (WILLARD // SUMMER 2025 v2), trimmed but structurally exact.
// This is the layout that broke the first parser: weekday day-headers, ALL-CAPS
// section headers nested inside each day, per-week load columns, and two blocks that
// repeat the same weekdays with slightly different wording. Every one of those
// section headers ("BENCH — PYRAMID", "SQUAT — LOADING", "CORE") is a plausible day
// name in isolation, and reading them as days would shift every session.
const WILLARD = `WILLARD // SUMMER 2025 — v2

REFERENCE — 1RM BASELINES
Bench Press 285lbs Back Squat 185kg

BLOCK II — INTENSIFICATION

Duration: 4 Weeks (June 30 – July 25)

MONDAY — PUSH A
BENCH — PYRAMID
Bench Press — 5 sets climbing: 67% / 72% / 77% / 82% / 88-92%
Wk1 top set: 88% | Wk2: 89% | Wk3: 91% | Wk4: 93%
OVERHEAD
Push Press (regular grip) — 5×3 @72% (Wk1-2), 76% (Wk3-4)
TRICEPS / FINISHER
Close-Grip Bench — 2×6

TUESDAY — PULL A
PULLS OFF FLOOR
Snatch Pull (floor) — 5×3
CORE / LOW BACK
Back Extension — 3×12

WEDNESDAY — OLY + LEGS (moderate)
OLYMPIC — TECHNICAL
Snatch — 6×2
SQUAT — LOADING
Back Squat — 4×4 @78%

THURSDAY — PUSH B
BENCH — VOLUME
Bench Press — 5×5 @75%

FRIDAY — PULL B
DEADLIFT — HEAVY
Deadlift — 4×3 @85%

SATURDAY — OLY + LEGS (heavy)
OLYMPIC — FROM FLOOR
Clean and Jerk — 5×2
SQUAT — CLIMBING
Front Squat — 4×3

BLOCK III — PEAKING

MONDAY — PUSH A
BENCH — PYRAMID
Bench Press — 5 sets climbing
WEDNESDAY — OLY + LEGS
SQUAT
Back Squat — 3×3`;

const shapeD = parseProgramShape(WILLARD);
check("D: six training days, not fifteen", shapeD.dayTemplate.length === 6);
check("D: days are the weekdays", shapeD.dayTemplate[0].startsWith("MONDAY") && shapeD.dayTemplate[5].startsWith("SATURDAY"));
// The specific false positives that broke the first version.
check("D: section headers are not days", !shapeD.dayTemplate.some(d => /^(BENCH|SQUAT|OVERHEAD|CORE|DEADLIFT|OLYMPIC|TRICEPS|PULLS)\b/i.test(d)));
check("D: 'Bench Press — 5 sets climbing' is not a day", !shapeD.dayTemplate.some(d => /5 sets/i.test(d)));
// Block III repeats MONDAY/WEDNESDAY with different wording — one entry each.
check("D: repeated weekdays across blocks collapse", shapeD.dayTemplate.filter(d => /^MONDAY/i.test(d)).length === 1);
check("D: wording drift doesn't split a day", shapeD.dayTemplate.filter(d => /^WEDNESDAY/i.test(d)).length === 1);
check("D: week count from the Wk columns", shapeD.weekCount === 4 && shapeD.hasWeeks);

// And it resolves to a real position rather than an empty template.
check("D: resolves a usable day", (() => {
  const p = currentPosition({ programText: WILLARD, startedOn: at("2026-07-27T08:00:00"), sessions: [at("2026-07-27T10:00:00")], now: at("2026-07-28T09:00:00") });
  return p.week === 1 && p.day === 2 && /TUESDAY/i.test(p.label);
})());

// ─── calendar ────────────────────────────────────────────────────────────────
check("Sunday maps to itself", sundayOnOrBefore(new Date("2026-07-26T15:00:00")).getDate() === 26);
check("Monday maps back to Sunday", sundayOnOrBefore(new Date("2026-07-27T09:00:00")).getDate() === 26);
check("Saturday maps back to Sunday", sundayOnOrBefore(new Date("2026-08-01T23:00:00")).getDate() === 26);
check("no turnover within a week", weeksTurnedOver(at("2026-07-27T09:00:00"), at("2026-08-01T09:00:00")) === 0);
check("one turnover across Sunday", weeksTurnedOver(at("2026-07-27T09:00:00"), at("2026-08-02T09:00:00")) === 1);
check("two turnovers across two Sundays", weeksTurnedOver(at("2026-07-27T09:00:00"), at("2026-08-09T09:00:00")) === 2);
// Elapsed-days/7 would say 0 here — six days apart, but a Sunday sits between them.
check("a mid-gap Sunday counts even under 7 days", weeksTurnedOver(at("2026-07-28T09:00:00"), at("2026-08-03T09:00:00")) === 1);

// ─── position: the day advances by SESSIONS ──────────────────────────────────
const pos = (o) => currentPosition({ programText: WEEK_SECTIONED, startedOn: at("2026-07-27T08:00:00"), ...o });

check("fresh start is week 1 day 1", (() => {
  const p = pos({ sessions: [], now: at("2026-07-27T09:00:00") });
  return p.week === 1 && p.day === 1 && p.label.includes("Push A");
})());

check("one logged session → day 2", (() => {
  const p = pos({ sessions: [at("2026-07-27T10:00:00")], now: at("2026-07-28T09:00:00") });
  return p.week === 1 && p.day === 2 && p.label.includes("Pull A");
})());

// Rest days are simply days with no log — four days off must not advance anything.
check("rest days don't advance the day", (() => {
  const p = pos({ sessions: [at("2026-07-27T10:00:00")], now: at("2026-08-01T09:00:00") });
  return p.week === 1 && p.day === 2;
})());

check("logging past the last day holds, never wraps", (() => {
  const p = pos({ sessions: ["2026-07-27T10:00:00", "2026-07-28T10:00:00", "2026-07-29T10:00:00", "2026-07-30T10:00:00"].map(at), now: at("2026-07-31T09:00:00") });
  return p.day === 3;
})());

// ─── position: the week turns on SUNDAY ──────────────────────────────────────
check("Sunday turns the week and resets to day 1", (() => {
  const p = pos({ sessions: [at("2026-07-27T10:00:00"), at("2026-07-28T10:00:00")], now: at("2026-08-02T09:00:00") });
  return p.week === 2 && p.day === 1;
})());

// Will's rule: unlogged sessions from last week are missed and the program moves on.
check("a week trained only once still turns over", (() => {
  const p = pos({ sessions: [at("2026-07-27T10:00:00")], now: at("2026-08-02T09:00:00") });
  return p.week === 2 && p.day === 1 && p.missedLastWeek === 2;
})());

check("a fully trained week reports nothing missed", (() => {
  const p = pos({ sessions: ["2026-07-27T10:00:00", "2026-07-29T10:00:00", "2026-07-31T10:00:00"].map(at), now: at("2026-08-02T09:00:00") });
  return p.week === 2 && p.missedLastWeek === 0;
})());

// The long-layoff case the old daysSince heuristic mangled worst. Run against the
// 4-week block so the answer isn't masked by the end-of-program clamp.
check("three weeks away lands on week 4 day 1", (() => {
  const p = currentPosition({ programText: WEEK_COLUMNS, startedOn: at("2026-07-27T08:00:00"), sessions: [at("2026-07-27T10:00:00")], now: at("2026-08-16T09:00:00") });
  return p.day === 1 && p.week === 4 && !p.blockComplete;
})());

check("running past the last week holds and flags the block done", (() => {
  const p = pos({ sessions: [], now: at("2026-09-06T09:00:00") });
  return p.week === 2 && p.weekCount === 2 && p.blockComplete;
})());

// ─── position: the athlete outranks the derivation ───────────────────────────
check("a stated day is taken as-is", (() => {
  const p = pos({ sessions: [at("2026-07-27T10:00:00")], override: { week: 1, day: 3, at: at("2026-07-28T08:00:00") }, now: at("2026-07-28T09:00:00") });
  return p.day === 3 && p.label.includes("Legs A");
})());

check("the session after a stated day is the next one", (() => {
  const p = pos({ sessions: [at("2026-07-27T10:00:00"), at("2026-07-28T12:00:00")], override: { week: 1, day: 1, at: at("2026-07-28T08:00:00") }, now: at("2026-07-29T09:00:00") });
  return p.day === 2;
})());

check("a stated week is taken as-is", (() => {
  const p = pos({ sessions: [], override: { week: 2, day: 1, at: at("2026-07-27T08:00:00") }, now: at("2026-07-27T09:00:00") });
  return p.week === 2;
})());

// An override is a statement about THIS week, not a freeze on the program.
check("Sunday still turns the week after an override", (() => {
  const p = pos({ sessions: [], override: { week: 1, day: 3, at: at("2026-07-28T08:00:00") }, now: at("2026-08-02T09:00:00") });
  return p.week === 2 && p.day === 1;
})());

// ─── an unknown week is never asserted ───────────────────────────────────────
// With no anchor and no claim we genuinely do not know the week. Saying "Week 1"
// anyway is how an athlete three weeks into a block gets shown week 1's loads with
// total confidence — the exact failure this replaces.
check("no anchor → week is not claimed as known", (() => {
  const p = currentPosition({ programText: WILLARD, sessions: [at("2026-07-27T10:00:00")], now: at("2026-07-28T09:00:00") });
  return p.weekKnown === false && p.day === 2;
})());
check("an anchor makes the week known", (() => {
  const p = currentPosition({ programText: WILLARD, startedOn: at("2026-07-27T08:00:00"), sessions: [], now: at("2026-07-28T09:00:00") });
  return p.weekKnown === true && p.week === 1;
})());
check("a stated week makes it known", (() => {
  const p = currentPosition({ programText: WILLARD, override: { week: 3, at: at("2026-07-27T08:00:00") }, sessions: [], now: at("2026-07-28T09:00:00") });
  return p.weekKnown === true && p.week === 3;
})());
check("an unknown week can't complete a block", (() => {
  const p = currentPosition({ programText: WILLARD, sessions: [], now: at("2026-12-01T09:00:00") });
  return p.blockComplete === false;
})());
const unknownBlock = positionBlock(currentPosition({ programText: WILLARD, sessions: [], now: at("2026-07-27T09:00:00") }));
check("block says the week is unknown and asks", /is NOT known/.test(unknownBlock) && /Do NOT assume Week 1/.test(unknownBlock));
check("block still states the day confidently", /Day 1/.test(unknownBlock) && !/Week 1, Day/.test(unknownBlock));

// ─── the prompt block ────────────────────────────────────────────────────────
const block = positionBlock(pos({ sessions: [at("2026-07-27T10:00:00")], now: at("2026-07-28T09:00:00") }));
check("block states the resolved day", /Week 1, Day 2/.test(block));
check("block forbids re-deriving", /Do NOT re-derive/.test(block));
check("block names the week to read loads from", /WEEK 1 column/.test(block));
const blockNoWeeks = positionBlock(currentPosition({ programText: NO_WEEKS, sessions: [], now: at("2026-07-27T09:00:00") }));
check("no-week program says nothing about weeks", !/Week \d/.test(blockNoWeeks) && /Day 1/.test(blockNoWeeks));
check("no program → no block", positionBlock(currentPosition({ programText: "", sessions: [] })) === "");
const missedBlock = positionBlock(pos({ sessions: [at("2026-07-27T10:00:00")], now: at("2026-08-02T09:00:00") }));
check("block reports missed sessions as moved-on", /missed 2 programmed sessions/.test(missedBlock) && /MOVED ON/.test(missedBlock));

console.log(`\n${fail === 0 ? "✓" : "✗"} program position: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
