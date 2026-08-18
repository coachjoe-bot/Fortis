// ─── T53 #4: ratio sheet + rate-of-progress — pure-math suite ────────────────
import { strengthRatios, ratioLimitersLine, rateOfProgress } from "../src/grit.js";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.error(`✗ ${n}`); } };

const lifts = [
  { key: "back squat", name: "Back Squat", e1rm: 400, actual: true },
  { key: "front squat", name: "Front Squat", e1rm: 300 },      // 0.75 → low
  { key: "bench press", name: "Bench Press", e1rm: 275 },      // 0.6875 → in-band
  { key: "deadlift", name: "Deadlift", e1rm: 380 },            // 0.95 → low
  { key: "snatch", name: "Snatch", e1rm: 250 },                // 0.625 → in-band
];
const rs = strengthRatios(lifts);
ok(rs.length === 4, `computes every ratio with both numbers present (got ${rs.length})`);
ok(rs[0].flag !== "in-band", "limiters sort first");
const dl = rs.find(r => r.den === "back squat" && r.num === "deadlift");
ok(dl && dl.flag === "low", "deadlift 0.95x squat flags low");
const bench = rs.find(r => r.num === "bench press");
ok(bench && bench.flag === "in-band", "bench 0.69x squat is in-band");
ok(strengthRatios([{ key: "back squat", e1rm: 400 }]).length === 0, "no ratio from one number");
ok(ratioLimitersLine(lifts).includes("Front squat"), "limiters line names the front squat gap");
ok(ratioLimitersLine([]) === "", "empty lifts → empty line");

// rate of progress: 300 → 330 over 6 weeks = 5 lb/wk observed
const mk = (iso, w, r) => ({ created_at: iso, parsed_data: { exercises: [{ name: "Bench Press", weight: w, reps: r, unit: "lbs", sets: 1 }] } });
const rows = [mk("2026-07-05T12:00:00Z", 300, 1), mk("2026-08-16T12:00:00Z", 330, 1)];
const rp = rateOfProgress(rows, "bench", 0, null);
ok(rp.known && rp.current === 330, `current from best e1RM (got ${rp.current})`);
ok(Math.abs(rp.observedPerWeek - 5) < 0.8, `observed ~5 lb/wk (got ${rp.observedPerWeek})`);
const goal = rateOfProgress(rows, "bench", 500, "2026-10-01");
ok(goal.known && goal.requiredPerWeek > 20 && goal.feasible === false, "a 170 lb jump in 6 weeks reads infeasible");
const goal2 = rateOfProgress(rows, "bench", 340, "2026-12-01");
ok(goal2.feasible === true, "a 10 lb jump over 15 weeks reads feasible");
ok(rateOfProgress([mk("2026-08-16T12:00:00Z", 300, 1)], "bench").known === false, "one data point → unknown");

// ── W39.4 signal-state logic (appended here — same pure-math suite family) ──
{
  const { nextSignalState, clearedSignal, AUTO_SET_THRESHOLD } = await import("../src/trainingPrefs.js");
  let row = null;
  let st = nextSignalState(row, "loading_language", "percent");
  ok(st.count === 1 && !st.autoSet, "first signal counts, no auto-set");
  row = { signals: st.signals };
  st = nextSignalState(row, "loading_language", "percent");
  ok(st.count === 2 && !st.autoSet, "second signal counts");
  row = { signals: st.signals };
  st = nextSignalState(row, "loading_language", "percent");
  ok(st.count === AUTO_SET_THRESHOLD && st.autoSet, "third consistent signal auto-sets");
  ok(!("loading_language=percent" in st.signals), "applied counter retires");
  ok(nextSignalState({ signals: { "loading_language=rpe": 2 } }, "loading_language", "percent").count === 1,
     "a DIFFERENT value starts its own counter");
  const cleared = clearedSignal({ signals: { "loading_language=percent": 2 } }, "loading_language", "percent");
  ok(!("loading_language=percent" in cleared), "explicit decline zeroes the counter");
}

// ── W39.5 feasibility engine ──
{
  const { goalLiftFromText, goalTargetLbs, feasibilityLine } = await import("../src/grit.js");
  ok(goalLiftFromText("Bench 315 by December 25")?.id === "bench press", "goal lift: bench (date words trimmed)");
  ok(goalLiftFromText("Front squat 275 by October")?.id === "front squat", "goal lift: front squat beats bare squat");
  ok(goalLiftFromText("get generally stronger") === null, "no lift → null");
  ok(goalTargetLbs("Bench 315 by December 25") === 315, "target ignores the date's 25");
  ok(Math.abs(goalTargetLbs("snatch 120kg") - 264.55) < 0.1, "kg target converts");
  const gen = (iso, w, r) => ({ created_at: iso, parsed_data: { exercises: [{ name: "Bench Press", weight: w, reps: r, unit: "lbs", sets: 1 }] } });
  const hist = [gen("2026-06-20T12:00:00Z", 245, 3), gen("2026-07-01T12:00:00Z", 250, 3), gen("2026-07-10T12:00:00Z", 255, 2),
                gen("2026-07-20T12:00:00Z", 255, 3), gen("2026-08-01T12:00:00Z", 260, 2), gen("2026-08-15T12:00:00Z", 265, 2)];
  const full = feasibilityLine(hist, "Bench 315 by December 25", "2026-08-18 to 2026-12-25");
  ok(/trend \+/.test(full) && /UNREALISTIC|TIGHT|ON TRACK/.test(full), `full argument with verdict (got "${full.slice(0, 80)}…")`);
  const light = feasibilityLine(hist.slice(0, 3), "Bench 315 by December 25", "2026-08-18 to 2026-12-25");
  ok(/not enough logged/.test(light) && /NO claims/.test(light), "below the gate → light touch, no data claims");
  ok(feasibilityLine(hist, "get stronger", "") === "", "no lift/target → no line");
}

console.log(`\n${pass}/${pass + fail} passed${fail ? " — FAILED" : ""}`);
process.exit(fail ? 1 : 0);
