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

console.log(`\n${pass}/${pass + fail} passed${fail ? " — FAILED" : ""}`);
process.exit(fail ? 1 : 0);
