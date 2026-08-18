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

const posmod = await import("../src/programPosition.js");
const { parseProgramShape, sundayOnOrBefore, weeksTurnedOver, currentPosition, positionBlock, weekAheadFor, parseBlockSpan } = posmod;

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

// ─── the week ahead ──────────────────────────────────────────────────────────
// Which week counts as "ahead" depends on the day the digest runs (proof_schedule_dow
// is per-athlete). On Sunday the week has already turned; midweek it hasn't. Getting
// this wrong previews a week the athlete is already halfway through.
const wa = (o) => weekAheadFor({ programText: WEEK_COLUMNS, startedOn: at("2026-07-27T08:00:00"), ...o });

check("run on Sunday → the week that just began", (() => {
  const w = wa({ sessions: [at("2026-07-27T10:00:00")], now: at("2026-08-02T09:00:00") });
  return w.week === 2;                       // Sunday Aug 2, nothing logged yet
})());
check("run midweek → the NEXT week", (() => {
  const w = wa({ sessions: [at("2026-07-27T10:00:00")], now: at("2026-07-31T09:00:00") });
  return w.week === 2;                       // Friday of week 1 → looking at week 2
})());
check("Sunday with a session already logged → next week", (() => {
  const w = wa({ sessions: [at("2026-08-02T08:00:00")], now: at("2026-08-02T20:00:00") });
  return w.week === 3;                       // trained Sunday already → week 2 is underway
})());
check("the week ahead runs the full template", (() => {
  const w = wa({ sessions: [at("2026-07-27T10:00:00")], now: at("2026-07-31T09:00:00") });
  return w.days.length === 2 && !w.blockEnded;
})());

// Past the last week of a 4-week block → no programming ahead.
check("past the final week → blockEnded", (() => {
  const w = wa({ sessions: [], now: at("2026-08-30T09:00:00") });
  return w.blockEnded === true && w.week === null;
})());
check("the final week itself is NOT blockEnded", (() => {
  const w = wa({ sessions: [], now: at("2026-08-16T09:00:00") });
  return w.blockEnded === false && w.week === 4;
})());
// The dangerous false positive: telling someone mid-block to bin their program.
check("an unknown week never claims the block ended", (() => {
  const w = weekAheadFor({ programText: WEEK_COLUMNS, sessions: [], now: at("2026-12-01T09:00:00") });
  return w.blockEnded === false;
})());
check("a program with no week structure never ends", (() => {
  const w = weekAheadFor({ programText: NO_WEEKS, startedOn: at("2026-07-27T08:00:00"), sessions: [], now: at("2026-12-01T09:00:00") });
  return w.blockEnded === false && w.days.length === 3;
})());
check("no program → nothing to look ahead to", weekAheadFor({ programText: "", sessions: [] }) === null);

// ─── does the block end? the gate on the whole section ───────────────────────
// Will's case: an athlete on a simple repeatable week must NEVER be told their block
// finished. The failure is one-directional and relentless — it would fire every single
// digest — so "we don't know" has to mean "say nothing", not "guess".
check("a plain repeatable week is not a known span", parseBlockSpan(NO_WEEKS).known === false);
check("…so the week-ahead is withheld, not guessed", (() => {
  const w = weekAheadFor({ programText: NO_WEEKS, startedOn: at("2026-07-27T08:00:00"), sessions: [], now: at("2026-07-28T09:00:00") });
  return w.ready === false && w.needsSpan === true && w.blockEnded === false && w.week === null;
})());
check("…and it can never end, however long it runs", (() => {
  const w = weekAheadFor({ programText: NO_WEEKS, startedOn: at("2026-01-01T08:00:00"), sessions: [], now: at("2026-12-01T09:00:00") });
  return w.blockEnded === false;
})());

// Answering unlocks it. "It repeats" = a real answer, not a missing one.
check("'it repeats' is an answer", (() => {
  const w = weekAheadFor({ programText: NO_WEEKS, sessions: [], spanAnswer: { repeating: true }, now: at("2026-07-28T09:00:00") });
  return w.ready === true && w.repeating === true && w.blockEnded === false && w.days.length === 3;
})());
check("a repeating program needs no week anchor", (() => {
  const w = weekAheadFor({ programText: NO_WEEKS, sessions: [], spanAnswer: { repeating: true }, now: at("2026-12-01T09:00:00") });
  return w.ready === true && w.blockEnded === false;
})());
check("a stated length is an answer", (() => {
  const w = weekAheadFor({ programText: NO_WEEKS, startedOn: at("2026-07-27T08:00:00"), sessions: [], spanAnswer: { weeks: 6 }, now: at("2026-07-28T09:00:00") });
  return w.ready === true && w.weekCount === 6 && w.blockEnded === false;
})());
check("a stated end date ends the block when it passes", (() => {
  const w = weekAheadFor({ programText: NO_WEEKS, startedOn: at("2026-07-27T08:00:00"), sessions: [], spanAnswer: { endsAt: "2026-08-01T00:00:00" }, now: at("2026-08-05T09:00:00") });
  return w.ready === true && w.blockEnded === true;
})());
check("…and not before", (() => {
  const w = weekAheadFor({ programText: NO_WEEKS, startedOn: at("2026-07-27T08:00:00"), sessions: [], spanAnswer: { endsAt: "2026-08-30T00:00:00" }, now: at("2026-08-05T09:00:00") });
  return w.blockEnded === false;
})());
// program_history.ends_at is the authoritative store and beats everything.
check("ends_at outranks the athlete's answer", (() => {
  const w = weekAheadFor({ programText: NO_WEEKS, startedOn: at("2026-07-27T08:00:00"), sessions: [], endsAt: "2026-08-01T00:00:00", spanAnswer: { repeating: true }, now: at("2026-08-05T09:00:00") });
  return w.spanSource === "ends_at" && w.blockEnded === true;
})());

// A program that answers the question itself is never asked.
check("a stated duration needs no question", parseBlockSpan("Duration: 4 Weeks (June 30 – July 25)\nMONDAY — PUSH\nBench 3x5 @ 185").known === true);
check("'6-week block' needs no question", parseBlockSpan("6-week block\nPush\nBench 3x5 @ 185").weeks === 6);
check("numbered weeks need no question", parseBlockSpan(WEEK_SECTIONED).known === true && parseBlockSpan(WEEK_SECTIONED).weeks === 2);
check("'repeats weekly' in the text is an answer", parseBlockSpan("Push/Pull/Legs, repeats weekly\nPush\nBench 3x5 @ 185").repeating === true);
// An explicit repeat beats a week count — a 4-week wave run on loop must not end.
check("explicit repeat outranks a week count", parseBlockSpan(WEEK_COLUMNS + "\nRun this on repeat.").repeating === true);
check("Will's own program declares its length", parseBlockSpan(WILLARD).known === true && parseBlockSpan(WILLARD).weeks === 4);
// The BLOCK INFO contract states the block's dates outright (T57): a contract
// program is never unknown and its Runs end date feeds resolveBlockSpan.endsAt.
const CONTRACT = "=== BLOCK INFO ===\nGoal: Bench 315\nLoading: rpe\nRuns: 2026-08-17 to 2026-09-13\n\nDay 1 - Push\nBench 3x5 @ 245";
check("a contract Runs line is a known span", (() => {
  const s = parseBlockSpan(CONTRACT);
  return s.known === true && s.source === "text_runs" && s.endDate === "2026-09-13";
})());
check("a single Runs date reads as the end", parseBlockSpan("=== BLOCK INFO ===\nRuns: 2026-09-13\n\nDay 1\nBench 3x5 @ 245").endDate === "2026-09-13");
check("'Runs:' without dates is not a span", parseBlockSpan("Conditioning\nRuns: 3x400m hard\nDay 1\nBench 3x5 @ 245").known === false);
check("the contract end date reaches resolveBlockSpan", (() => {
  const { resolveBlockSpan } = posmod;
  const r = resolveBlockSpan({ programText: CONTRACT });
  return r.known === true && r.endsAt instanceof Date && r.endsAt.toISOString().slice(0, 10) === "2026-09-13";
})());
// …but his START is unknown, so the week still has to be asked before previewing.
check("known span + unknown week still withholds", (() => {
  const w = weekAheadFor({ programText: WILLARD, sessions: [], now: at("2026-07-28T09:00:00") });
  return w.ready === false && w.needsWeek === true && w.needsSpan === false;
})());
check("…and answering the week unlocks it", (() => {
  const w = weekAheadFor({ programText: WILLARD, override: { week: 3, at: at("2026-07-27T08:00:00") }, sessions: [], now: at("2026-07-28T09:00:00") });
  return w.ready === true && w.week === 4;
})());

// ─── "Week N of M": the header that names two numbers ────────────────────────
// The one form where the biggest week number in the text is NOT the block length. It's
// how most athletes label a program they're already partway through, and reading the N
// as the count produced the exact false "your block is over" the rest of this file
// exists to prevent — fired mid-block, every digest, with full confidence, and taking
// the Past Blocks close-out offer (flags.block_ended) with it.
const OF_FORMS = [
  ["Week 3 of 12", 12, `HYPERTROPHY — Week 3 of 12

DAY 1 — PUSH
1. Bench Press 4x8

DAY 2 — PULL
1. Row 4x8`],
  ["Wk 5 of 8", 8, `STRENGTH — Wk 5 of 8

DAY 1 — UPPER
1. Bench Press 4x5

DAY 2 — LOWER
1. Back Squat 4x5`],
  ["Week 2 of 6", 6, `Week 2 of 6

Day 1 – Full Body
Back Squat 3x5 @ 245
Day 2 – Full Body
Deadlift 3x5 @ 315`],
];

for (const [name, weeks, text] of OF_FORMS) {
  check(`"${name}": M is the block length, not N`, parseProgramShape(text).weekCount === weeks);
  check(`"${name}": span reports ${weeks} weeks, stated not counted`, (() => {
    const s = parseBlockSpan(text);
    return s.known === true && s.weeks === weeks && s.source === "text_duration";
  })());
  // Two weeks in, with M-2 still to run. The whole point: nothing here says "done".
  check(`"${name}": mid-block is not over`, (() => {
    const w = weekAheadFor({ programText: text, startedOn: at("2026-07-13T08:00:00"), sessions: [], now: at("2026-07-28T09:00:00") });
    return w.blockEnded === false && w.ready === true && w.weekCount === weeks && w.week === 4;
  })());
  // The number the athlete stated is still where they are, not a program length.
  check(`"${name}": N never becomes the count`, parseProgramShape(text).weekCount !== parseInt(name.match(/\d+/)[0], 10));
}
// It still ends when it genuinely runs out — the fix must not make blocks immortal.
check("Week 3 of 12: past week 12 the block does end", (() => {
  const w = weekAheadFor({ programText: OF_FORMS[0][2], startedOn: at("2026-01-05T08:00:00"), sessions: [], now: at("2026-07-28T09:00:00") });
  return w.blockEnded === true;
})());
// The days either side of it are unaffected — "of 12" is not a day, not an exercise.
check("Week N of M: the header isn't read as a day", parseProgramShape(OF_FORMS[0][2]).dayTemplate.length === 2);

// A lone week header states a POSITION, not a length. "Week 3" on its own can't mean a
// three-week program — that reading ends the block the week the athlete reaches it.
check("a single numbered week is not a block length", (() => {
  const s = parseProgramShape("Week 3\nDay 1 – Push\nBench 4x6 @ 185\nDay 2 – Pull\nRow 4x8 @ 155");
  return s.weekCount === 0 && s.hasWeeks === false;
})());
check("…so it's asked about, never guessed", (() => {
  const w = weekAheadFor({ programText: "Week 3\nDay 1 – Push\nBench 4x6 @ 185\nDay 2 – Pull\nRow 4x8 @ 155", startedOn: at("2026-07-13T08:00:00"), sessions: [], now: at("2026-07-28T09:00:00") });
  return w.needsSpan === true && w.blockEnded === false;
})());
// Two or more enumerated weeks still measure the block, exactly as before.
check("two numbered weeks still measure the block", parseProgramShape(WEEK_SECTIONED).weekCount === 2);
// "3 sets of 5" must not be mistaken for a span declaration.
check("'of' in set/rep prose isn't a block length", (() => {
  const s = parseBlockSpan("Push\nBench Press — week 1 of 3 sets @ 185\nRow 4x8 @ 155");
  return s.weeks !== 3 || s.source !== "text_duration";
})());

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
