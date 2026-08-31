// Chat-routing regression suite — the guard rail for src/chatRouting.js.
// Run with: node scripts/test-chat-routing.mjs
//
// These are the decisions send() makes about a raw athlete message before
// anything is written. What's at stake, in order of severity:
//   • propagate1RM / hasExplicitWorkingBasis / isFullProgramEcho decide whether an
//     athlete's PROGRAM gets rewritten. A wrong answer here silently replaces
//     weights they chose, or writes a truncated program over a complete one.
//   • looksLikeWorkoutLog decides which past rows are eligible to be REWRITTEN by
//     a log correction. A false positive lets a correction target a chat message.
//   • needsAdvancedParser / looksLikeLifting only cost money (an extra parse) or
//     lose a workout to an empty parse.
// So the program-writing cases get the most coverage, and every ambiguous case is
// asserted to resolve toward "don't touch it".

import { readFileSync } from "node:fs";
import {
  needsAdvancedParser, looksLikeLifting, parseGotNothing, asksToRemember,
  looksLikeWorkoutLog, hasExplicitWorkingBasis, propagate1RM, isFullProgramEcho,
  stripFailedAttempts, asksProgramEdit,
} from "../src/chatRouting.js";
import { normalizeExName } from "../src/grit.js";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error("  ✗ " + msg); } };
const eq = (got, want, msg) => ok(Object.is(got, want), `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── model escalation ─────────────────────────────────────────────────────────
console.log("needsAdvancedParser:");
for (const m of [
  "superset bench and rows 3x10",
  "super set of curls",
  "drop set on the last one",
  "dropset to failure",
  "rest-pause bench 225",
  "rest pause set",
  "cluster set squats",
  "myo reps on lateral raises",
  "myo-rep match set",
  "3 rounds AMRAP",
  "took the last set to failure",
  "warm-up sets then 3x5",
  "warmup 135, worked up to 315",
  "ramped up to a heavy single",
  "ramping up on squats",
  "giant set of shoulders",
  "triset arms",
]) ok(needsAdvancedParser(m), `advanced: ${m}`);
for (const m of [
  "bench 5x5 at 225",
  "squat 315 for 3",
  "ran 5 miles easy",
  "my knee hurts",
]) ok(!needsAdvancedParser(m), `plain: ${m}`);
eq(needsAdvancedParser(null), false, "null message is not advanced");

console.log("looksLikeLifting:");
ok(looksLikeLifting("bench 5x5"), "set x rep");
ok(looksLikeLifting("squat @ 315"), "@ weight");
ok(looksLikeLifting("225 lbs for a triple"), "bare lbs");
ok(looksLikeLifting("100kg snatch"), "bare kg");
ok(!looksLikeLifting("felt tired today"), "prose is not lifting");
ok(!looksLikeLifting("what should I do tomorrow?"), "a question is not lifting");
eq(looksLikeLifting(undefined), false, "undefined is not lifting");

console.log("parseGotNothing:");
ok(parseGotNothing(null), "null parse is nothing");
ok(parseGotNothing({ exercises: [] }), "empty exercises is nothing");
ok(parseGotNothing({ exercises: [], run_data: null, practice_data: null, pr_attempts: [] }), "all-empty is nothing");
ok(!parseGotNothing({ exercises: [{ name: "Squat" }] }), "an exercise is something");
ok(!parseGotNothing({ exercises: [], run_data: { distance_miles: 3 } }), "a run is something");
ok(!parseGotNothing({ exercises: [], practice_data: { practice_type: "game" } }), "a practice is something");
ok(!parseGotNothing({ exercises: [], pr_attempts: [{ exercise: "Squat" }] }), "a PR attempt is something");

// ── "remember this" ──────────────────────────────────────────────────────────
// A saved note is injected into EVERY future prompt, so this gate has to be a
// real request, not a passing mention.
console.log("asksToRemember:");
for (const m of [
  "remember I train at 6am",
  "note that my knee is bad",
  "make a note — I'm allergic to nothing",
  "keep in mind I only have dumbbells",
  "don't forget my meet is in March",
  "dont forget the meet",
  "from now on use kg",
  "for future reference I lift raw",
  "going forward I'm training 5 days",
  "just so you know I'm travelling",
  "for the record I hit 405",
  "update my weight to 190",
  "update my profile",
]) ok(asksToRemember(m), `remembers: ${m}`);
for (const m of [
  "I benched 225 today",
  "do you remembering things?",
  "my knee is sore",
  "what's my program",
]) ok(!asksToRemember(m), `not a memory request: ${m}`);

// ── is this row a workout log? ───────────────────────────────────────────────
console.log("looksLikeWorkoutLog:");
ok(looksLikeWorkoutLog("Bench 5x5 225"), "set x rep log");
ok(looksLikeWorkoutLog("Squat @ 315 for a triple"), "@ weight log");
ok(looksLikeWorkoutLog("did 185 lbs on rows"), "bare lbs log");
ok(looksLikeWorkoutLog("Upper A\nBench 5x5 225\nRow 3x8"), "multi-line log");
// The failure that matters: a QUESTION mentioning numbers must never be eligible
// for a log correction to overwrite.
ok(!looksLikeWorkoutLog("what should I do after 5x5 at 225?"), "a question is not a log");
ok(!looksLikeWorkoutLog("Can I swap bench for 3x10 dumbbells"), "a request is not a log");
ok(!looksLikeWorkoutLog("How heavy should I go, 225?"), "how-question is not a log");
ok(!looksLikeWorkoutLog("Should I do 5x5 or 3x8"), "should-question is not a log");
ok(!looksLikeWorkoutLog("[Form review: squat.mp4]"), "a form review is not a log");
ok(!looksLikeWorkoutLog("felt good today"), "prose with no numbers is not a log");
ok(!looksLikeWorkoutLog(""), "empty is not a log");
ok(!looksLikeWorkoutLog(null), "null is not a log");
ok(!looksLikeWorkoutLog(42), "a non-string is not a log");
// The question test looks at the FIRST line only, so a log whose later lines ask
// something still counts as a log.
ok(looksLikeWorkoutLog("Bench 5x5 225\nwas that too light?"), "first line decides");

// ── program-write guards ─────────────────────────────────────────────────────
console.log("hasExplicitWorkingBasis:");
for (const p of [
  "Squat 5x5 @ 85% of training max",
  "Based on a TM of 405",
  "working weight 225",
  "work weight: 185",
  "Loads based on your working max",
  "numbers based off last cycle",
  "sets at 80% of working max",
]) ok(hasExplicitWorkingBasis(p), `explicit basis: ${p}`);
for (const p of [
  "Squat 5x5 @ 315",
  "Bench 3x8 @ 225\nRow 4x10 @ 155",
  "",
]) ok(!hasExplicitWorkingBasis(p), `no explicit basis: ${JSON.stringify(p)}`);
eq(hasExplicitWorkingBasis(null), false, "null program has no basis");

console.log("propagate1RM:");
{
  const prog = "DAY 1\nBack Squat 5x5 @ 315lbs\nBench Press 3x8 @ 225lbs";
  const r = propagate1RM(prog, "Back Squat", 400, 420);
  ok(r.changed, "a real rescale reports changed");
  ok(r.text.includes("330lbs"), "315 @ 400 → 330 @ 420 (rounded to 5)");
  ok(r.text.includes("Bench Press 3x8 @ 225lbs"), "a lift that didn't PR is untouched");
}
{
  // No-ops. Each of these returning `changed:true` would rewrite a program for nothing.
  const prog = "Back Squat 5x5 @ 315lbs";
  eq(propagate1RM(prog, "Back Squat", 400, 400).changed, false, "same 1RM changes nothing");
  eq(propagate1RM(prog, "Back Squat", 0, 420).changed, false, "zero old 1RM changes nothing");
  eq(propagate1RM(prog, "Back Squat", 400, 0).changed, false, "zero new 1RM changes nothing");
  eq(propagate1RM("", "Back Squat", 400, 420).changed, false, "empty program changes nothing");
  eq(propagate1RM(null, "Back Squat", 400, 420).text, null, "null program passes through");
  eq(propagate1RM(prog, "Deadlift", 400, 420).changed, false, "a lift not in the program changes nothing");
}
{
  // The two bounds ARE the safety story — see the comment on propagate1RM.
  const bar = propagate1RM("Back Squat warmup 45lbs then 5x5 @ 315lbs", "Back Squat", 400, 420);
  ok(bar.text.includes("45lbs"), "bar weight (<45) is never rescaled");
  const goal = propagate1RM("Back Squat goal 700lbs, work 5x5 @ 315lbs", "Back Squat", 400, 420);
  ok(goal.text.includes("700lbs"), "an outlier goal number (>1.5x) is never rescaled");
}
{
  // A lift name with regex metacharacters must not blow up or match wildly.
  const r = propagate1RM("Squat (high bar) 5x5 @ 315lbs\nBench 3x5 @ 225lbs", "Squat (high bar)", 400, 420);
  ok(r.changed && r.text.includes("330lbs"), "regex metacharacters in the lift name are escaped");
  ok(r.text.includes("Bench 3x5 @ 225lbs"), "the escaped name doesn't leak onto other lines");
}
{
  // Rounding lands on 5s, always.
  const r = propagate1RM("Back Squat 5x5 @ 300lbs", "Back Squat", 400, 415);
  const m = /(\d+)lbs/.exec(r.text);
  eq(Number(m[1]) % 5, 0, "rescaled weights round to the nearest 5");
}
{
  // A downward correction (a PR was a mistype and got fixed) must also propagate.
  const r = propagate1RM("Back Squat 5x5 @ 315lbs", "Back Squat", 400, 380);
  ok(r.changed && !r.text.includes("315lbs"), "a downward 1RM correction propagates too");
}

console.log("isFullProgramEcho:");
{
  const original = "DAY 1 — LOWER\n".padEnd(400, "x");
  ok(isFullProgramEcho(original, original), "an identical echo is accepted");
  ok(isFullProgramEcho(original + "\nDAY 4 — EXTRA", original), "a longer rewrite is accepted");
  ok(isFullProgramEcho(original.slice(0, 380), original), "a 95% rewrite is accepted");
  // The failure this exists to stop: a token-capped response is a PREFIX, and
  // writing it over program_text destroys everything after the cut.
  ok(!isFullProgramEcho(original.slice(0, 200), original), "a truncated (50%) echo is REJECTED");
  ok(!isFullProgramEcho("Sorry, I can't do that.", original), "a short refusal is rejected");
  ok(!isFullProgramEcho("", original), "an empty response is rejected");
  ok(!isFullProgramEcho(null, original), "null is rejected");
  ok(!isFullProgramEcho("x".repeat(59), ""), "under 60 chars is rejected even with no original");
  ok(isFullProgramEcho("x".repeat(60), ""), "60+ chars is accepted when there's nothing to lose");
}

// ─── LOG-CORRECTION PROMPT CONTRACT (T19 #1) ─────────────────────────────────
// Joe applied a correction, then flatly denied having done it on the next turn
// ("I don't actually have the ability to remove or apply fixes to logs myself").
// The cause was not missing evidence -- applyCorrection already writes "Done, log
// corrected." into the transcript and history is sent as context. It was an
// UNCONDITIONAL rule in JOEBOT_STATIC_SYS: "NEVER claim the log is already
// fixed", which binds just as hard AFTER the athlete taps Apply fix as before.
//
// The real regression suite for corrections (scripts/test-log-correction.mjs)
// needs a live athlete + PIN and bills real tokens, so it cannot run in npm test.
// These assertions guard the same defect offline by pinning the prompt CONTRACT:
// the rule must be two-state, and must never re-acquire a blanket denial. Read
// from the live file so a prompt edit cannot quietly drop it.
{
  const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const i = src.indexOf("LOG CORRECTIONS:");
  ok(i !== -1, "the LOG CORRECTIONS block still exists in JOEBOT_STATIC_SYS");
  const block = src.slice(i, i + 2600);

  ok(/BEFORE the athlete taps/i.test(block), "the rule distinguishes the BEFORE-tap state");
  ok(/AFTER the athlete taps/i.test(block), "the rule distinguishes the AFTER-tap state");
  ok(/Done, log corrected/.test(block), "the after-tap state names the exact transcript marker it keys off");
  ok(/never say you lack the ability|NEVER deny it/i.test(block),
     "the rule forbids denying a correction that was applied");

  // THE ATHLETE'S NAME rule (T57 s2 + s6): the exact-name rule must survive,
  // and it must carry the self-name clause — a live s6 probe caught Joe
  // addressing the athlete as "Joe" (his own persona name), the one substitute
  // the generic rule didn't call out.
  const nameI = src.indexOf("THE ATHLETE'S NAME:");
  ok(nameI !== -1, "the ATHLETE'S NAME rule still exists in JOEBOT_STATIC_SYS");
  const nameBlock = src.slice(nameI, nameI + 900);
  ok(/use EXACTLY that name/.test(nameBlock), "the rule pins the exact name");
  ok(/YOUR OWN name is Joe/.test(nameBlock),
     "the rule names the self-name confusion (never call the athlete Joe)");

  // The pre-tap caution must stay SCOPED. If an unconditional 'NEVER claim ...
  // already fixed' ever comes back, the original bug is back with it.
  const beforeIdx = block.indexOf("BEFORE the athlete taps");
  const afterIdx = block.indexOf("AFTER the athlete taps");
  ok(beforeIdx !== -1 && afterIdx !== -1 && beforeIdx < afterIdx,
     "before-tap guidance precedes after-tap guidance");
  ok(!/NEVER claim the log is already fixed/i.test(block),
     "the old unconditional denial rule is gone");

  // applyCorrection must keep writing the marker the prompt depends on.
  ok(/content:`Done, log corrected\./.test(src),
     "applyCorrection still writes the 'Done, log corrected.' transcript marker");
}


// ── stripFailedAttempts ──────────────────────────────────────────────────────
// The 285-bench incident (2026-08-03): a MISSED attempt parsed into exercises[]
// as a real single and the true-single pass promoted it to the athlete's actual
// 1RM. This strip is the deterministic guarantee that a failed attempt can never
// read as work performed, whatever the parser emits.
console.log("stripFailedAttempts:");
{
  const strip = (p) => stripFailedAttempts(p, normalizeExName);

  // Escalation: attempt/miss language goes to the stronger parser.
  for (const m of [
    "attempted 285 and missed it",
    "missed my 285 bench attempt",
    "failed 315 on squat",
    "went for 300, didn't get it",
    "no lift on the third attempt",
  ]) ok(needsAdvancedParser(m), `attempt language escalates: ${m}`);

  // The exact incident: double-emit of the missed bar. The set disappears, the
  // achieved:false record stays.
  const doubled = strip({
    exercises: [{ name: "Bench Press", sets: 1, reps: 1, weight: 285, unit: "lbs" }],
    pr_attempts: [{ exercise: "Bench Press", weight: 285, reps: 1, achieved: false }],
  });
  eq(doubled.exercises.length, 0, "missed single leaks into exercises -> stripped");
  eq(doubled.pr_attempts.length, 1, "the achieved:false record itself is kept");

  // Completed work in the same message survives, and the flat summary re-derives
  // off the surviving sets, not the stripped one.
  const mixed = strip({
    exercises: [{ name: "Bench Press", sets: 2, reps: 1, weight: 285, unit: "lbs",
      set_details: [{ weight: 275, reps: 1 }, { weight: 285, reps: 1 }] }],
    pr_attempts: [
      { exercise: "Bench Press", weight: 275, reps: 1, achieved: true },
      { exercise: "Bench Press", weight: 285, reps: 1, achieved: false },
    ],
  });
  eq(mixed.exercises.length, 1, "completed single survives the strip");
  eq(mixed.exercises[0].set_details.length, 1, "only the missed set is removed");
  eq(mixed.exercises[0].weight, 275, "flat top-set weight re-derived from survivors");

  // Same weight both achieved AND missed (hit it on the second try): nothing strips.
  const retried = strip({
    exercises: [{ name: "Bench Press", sets: 1, reps: 1, weight: 285, unit: "lbs" }],
    pr_attempts: [
      { exercise: "Bench Press", weight: 285, reps: 1, achieved: false },
      { exercise: "Bench Press", weight: 285, reps: 1, achieved: true },
    ],
  });
  eq(retried.exercises.length, 1, "a weight also achieved in-session is left alone");

  // "5 singles, missed the last" keeps its 4 completed sets.
  const flatMulti = strip({
    exercises: [{ name: "Deadlift", sets: 5, reps: 1, weight: 500, unit: "lbs" }],
    pr_attempts: [{ exercise: "Deadlift", weight: 500, reps: 1, achieved: false }],
  });
  eq(flatMulti.exercises[0].sets, 4, "flat multi-set entry loses one set, not all");

  // A failed TRIPLE must not delete a completed double at the same weight.
  const triple = strip({
    exercises: [{ name: "Back Squat", sets: 1, reps: 2, weight: 275, unit: "lbs" }],
    pr_attempts: [{ exercise: "Back Squat", weight: 275, reps: 3, achieved: false }],
  });
  eq(triple.exercises.length, 1, "failed rep-3 doesn't erase the completed 275x2");

  // Different lift missed -> untouched; no failed attempts -> untouched.
  const other = strip({
    exercises: [{ name: "Bench Press", sets: 3, reps: 5, weight: 225, unit: "lbs" }],
    pr_attempts: [{ exercise: "Overhead Press", weight: 185, reps: 1, achieved: false }],
  });
  eq(other.exercises.length, 1, "a miss on another lift touches nothing");
  const clean = { exercises: [{ name: "Bench Press", sets: 3, reps: 5, weight: 225 }], pr_attempts: [] };
  eq(strip(clean), clean, "no failed attempts -> parsed returned as-is");

  // Warm-up sets never strip (they're excluded from promotion anyway).
  const warm = strip({
    exercises: [{ name: "Bench Press", sets: 1, reps: 1, weight: 285, unit: "lbs",
      set_details: [{ weight: 285, reps: 1, warmup: true }, { weight: 285, reps: 1 }] }],
    pr_attempts: [{ exercise: "Bench Press", weight: 285, reps: 1, achieved: false }],
  });
  eq(warm.exercises[0].set_details.filter(s => s.warmup).length, 1, "warm-up sets are never stripped");
}

// ── prompt contracts for the failed-attempt + hierarchy fixes ────────────────
// Same style as the LOG CORRECTIONS block above: the App.jsx prompt text is a
// load-bearing contract; these fail the suite if a rewrite drops the rules.
{
  const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok(/FAILED \/ MISSED ATTEMPTS \(critical\)/.test(src),
     "parser prompt carries the failed-attempts-never-log-as-sets rule");
  ok(/stripFailedAttempts\(parsed, normalizeExName\)/.test(src),
     "finalizeWorkout runs the deterministic strip before saving/promoting");
  ok(/actual 1RM.*ALWAYS outranks an "est\." entry/.test(src),
     "chat cheat sheet declares actual-1RM-outranks-estimate");
  ok(/training number \/ training max \/ reference max \/ baseline the PROGRAM ITSELF states/.test(src),
     "chat hierarchy carries the program-training-number tier");
  ok(src.includes('training number/TM/reference max the program itself states'),
     "Quick Log edit prompt carries the program-training-number tier");
  ok(/AN EDITED WEIGHT IS NOT A NEW BASE/.test(src),
     "Quick Log declares an edited weight is not a new percentage base");
  ok(/WHERE THE ATHLETE IS IN THEIR PROGRAM/.test(src),
     "chat receives the resolved program position block");

  // W41 (Will, 08-19): an RPE prescription resolves a suggested load off the
  // athlete's actual/est. 1RM once one exists; a never-logged lift stays a
  // visible blank with the RPE kept ("@ ___ (RPE 8)"), never a guessed number.
  ok((src.match(/leave the pounds blank, "@ ___ \(RPE 8\)"/g)||[]).length >= 1,
     "chat opener: RPE with no known 1RM stays a blank with the RPE visible");
  ok(/@ ___ \(RPE 8\)"\./.test(src),
     "Quick Log draft: RPE with no cheat-sheet entry stays a blank with the RPE visible");
  ok((src.match(/RPE and reps imply off that base/g)||[]).length === 2,
     "both hierarchies resolve RPE off the actual-1RM-else-est. base");
  ok(/percentage or RPE target into a weight/.test(src),
     "cheat-sheet framing permits RPE resolution, not just percentages");
  ok(/cheat sheet exists ONLY for steps 2 and 3/.test(src),
     "Quick Log cheat-sheet scope covers the RPE step");
  ok(/RPE resolved off the lift's "\(actual 1RM\)" else "\(est\.\)" cheat-sheet entry/.test(src),
     "Quick Log edit prompt carries the RPE base rule");

  // T57 s5: a program-intent message never logs a phantom session — the ask is
  // forced deterministically and exercises are scrubbed at the choke point.
  ok(src.includes("asksProgramEdit(msg) && !fromQuickLog"),
     "an explicit program-edit ask forces program_append when the model missed it");
  ok(src.includes("parsed.exercises = []; parsed.run_data = null; parsed.pr_attempts = [];"),
     "program-intent messages have exercises/runs/attempts scrubbed before the log path");
}

// ── asksProgramEdit ───────────────────────────────────────────────────────────
console.log("asksProgramEdit:");
ok(asksProgramEdit("add a day 4 to my program please: Deadlift 4x3 @ RPE 7"), "the live phantom-session phrasing matches");
ok(asksProgramEdit("can you put this in my plan"), "put ... in my plan matches");
ok(asksProgramEdit("tack these onto my split"), "tack ... onto my split matches");
ok(asksProgramEdit("I want to add lunges to my training plan"), "add ... to my training plan matches");
ok(!asksProgramEdit("I added dips to my program yesterday and did 3x8"), "past-tense 'added' stays a log");
ok(!asksProgramEdit("can you put my program on my home screen?"), "the lock-screen ask never matches");
ok(!asksProgramEdit("did bench 3x5 at 225, felt strong"), "a plain log never matches");
ok(!asksProgramEdit("what's in my program for tomorrow?"), "a program QUESTION never matches");

// ── stripToolNameNoise (T62 leakage filter) ──────────────────────────────────
console.log("stripToolNameNoise:");
{
  const { stripToolNameNoise, KNOWN_TOOL_NAMES } = await import("../src/chatRouting.js");
  ok(stripToolNameNoise("prefill_log_sheet, pin_session_card\nAlright, day 2 push. Let's work.")
     === "Alright, day 2 push. Let's work.", "the leaked name line (Will's 08-31 screenshot) vanishes whole");
  ok(stripToolNameNoise("Solid session. Numbers are moving.") === "Solid session. Numbers are moving.", "clean text passes byte-identical");
  ok(stripToolNameNoise("I'll call prefill_log_sheet() and get your sheet ready.")
     === "I'll call and get your sheet ready.", "an inline name (with call parens) is excised, sentence kept");
  ok(stripToolNameNoise("set_position") === "", "a reply that is ONLY a tool name strips to empty");
  ok(stripToolNameNoise("pin_session_card, clear_session_card\n\nRest day today. Recover.")
     === "Rest day today. Recover.", "leading noise + blank line collapse cleanly");
  ok(stripToolNameNoise("Your max is 315. remember_fact\nKeep pushing.")
     === "Your max is 315.\nKeep pushing.", "a trailing name on a real line is trimmed with its separators");
  ok(stripToolNameNoise("The prefill_log_sheets in the gym") === "The prefill_log_sheets in the gym",
     "word-boundary: a longer identifier is not a match");
  ok(KNOWN_TOOL_NAMES.includes("show_start_buttons"), "strip list carries the new start-buttons tool");
}

if (fail) { console.error(`\n${fail} FAILURE(S) (${pass} passed)`); process.exit(1); }
console.log(`\nAll ${pass} chat-routing checks pass.`);
