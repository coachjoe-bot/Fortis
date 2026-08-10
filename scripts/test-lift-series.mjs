// Check-in chart series regression suite — guards liftSeriesPoints (src/grit.js).
// Run with: node scripts/test-lift-series.mjs
//
// Born from Will's 2026-08-10 monthly edition: the "Snatch · est. 1RM" chart
// showed ~270 lbs for an athlete who has never snatched near that, because the
// old inline series matched lifts by SUBSTRING — "snatch" absorbed Snatch-Grip
// Deadlift and Snatch Pull entries and Epley-inflated their rep work. It also
// printed the same x-axis date twice when a day had two matching entries.

import { liftSeriesPoints, epley1RM } from "../src/grit.js";

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
};

const w = (dateIso, exercises) => ({ created_at: dateIso, parsed_data: { exercises } });
const ex = (name, weight, reps, sets = 1) => ({ name, weight, reps, sets, unit: "lbs" });

// ── Taxonomy-exact matching ──────────────────────────────────────────────────
console.log("taxonomy-exact matching:");
{
  const rows = [
    w("2026-07-10T10:00:00Z", [ex("Snatch", 185, 1)]),
    // The contaminators: same substring, different lifts. 250x5 snatch-grip DL
    // Epley-inflates to ~292 — the exact phantom-270 class of point.
    w("2026-07-12T10:00:00Z", [ex("Snatch-Grip Deadlift", 250, 5)]),
    w("2026-07-14T10:00:00Z", [ex("Snatch Pull", 225, 3)]),
    w("2026-07-16T10:00:00Z", [ex("Snatch", 190, 2)]),
  ];
  const pts = liftSeriesPoints(rows, "Snatch");
  ok(pts.length === 2, `snatch series has 2 points, not 4 (got ${pts.length})`);
  ok(pts.every((p) => p.y < 220), `no point near the phantom 270 (max ${Math.max(...pts.map((p) => p.y))})`);
}
{
  // Aliases of the SAME lift must still land in one series.
  const rows = [
    w("2026-07-10T10:00:00Z", [ex("clean & jerk", 225, 1)]),
    w("2026-07-12T10:00:00Z", [ex("Clean and Jerk", 235, 1)]),
    w("2026-07-14T10:00:00Z", [ex("C&J", 240, 1)]),
  ];
  const pts = liftSeriesPoints(rows, "Clean and Jerk");
  ok(pts.length === 3, `C&J aliases collapse into one 3-point series (got ${pts.length})`);
}

// ── One point per day, no duplicate labels ───────────────────────────────────
console.log("one point per day:");
{
  const rows = [
    w("2026-07-21T09:00:00Z", [ex("Bench Press", 225, 5)]),
    w("2026-07-21T18:00:00Z", [ex("Bench Press", 235, 3)]),
    w("2026-07-22T10:00:00Z", [ex("Bench Press", 245, 1)]),
  ];
  const pts = liftSeriesPoints(rows, "Bench Press");
  ok(pts.length === 2, `two same-day sessions collapse to one point (got ${pts.length})`);
  const labels = pts.map((p) => p.label);
  ok(new Set(labels).size === labels.length, `no duplicate x-axis labels (${labels.join(", ")})`);
  ok(pts[0].y === Math.max(epley1RM(225, 5), epley1RM(235, 3)), "same-day point keeps the day's MAX e1RM");
}

// ── Rep-capped e1RM (matches every other progress surface) ───────────────────
console.log("rep cap:");
{
  const rows = [
    w("2026-07-10T10:00:00Z", [ex("Back Squat", 135, 20)]), // endurance set — no 1RM signal
    w("2026-07-12T10:00:00Z", [ex("Back Squat", 275, 3)]),
  ];
  const pts = liftSeriesPoints(rows, "Back Squat");
  ok(pts.length === 1, `a 20-rep set never mints an e1RM point (got ${pts.length})`);
}

// ── Window + ordering ────────────────────────────────────────────────────────
console.log("window + ordering:");
{
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(w(`2026-07-${String(i + 1).padStart(2, "0")}T10:00:00Z`, [ex("Deadlift", 300 + i * 5, 1)]));
  // Deliberately shuffled input — series must sort by date itself.
  rows.reverse();
  const pts = liftSeriesPoints(rows, "Deadlift");
  ok(pts.length === 8, `caps at the last 8 days (got ${pts.length})`);
  ok(pts[pts.length - 1].y === 355 && pts[0].y === 320, "keeps the MOST RECENT 8, oldest→newest");
}

console.log(`\n${fail === 0 ? `All ${pass} green.` : `${fail} FAILED, ${pass} passed`}`);
process.exit(fail === 0 ? 0 : 1);
