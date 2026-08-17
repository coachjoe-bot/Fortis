// ─── T55 UNITS SUITE ──────────────────────────────────────────────────────────
// Locks the single-source conversion contract:
//   1. lbs↔kg round trips are lossless (display always converts from the RAW
//      stored pair, so flipping the toggle back and forth never re-rounds).
//   2. Display rounding: stats to 1 lb / 0.5 kg, working loads to 5 lb / 2.5 kg.
//   3. NO stray conversion constants outside src/units.js — the four hand-copies
//      (two different constants) are what caused the TestFlight kg leaks.
// Run: node scripts/test-units.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  LBS_PER_KG, toLbs, toKg, toDisplay, roundStat, roundLoad, fmtWeightIn,
  setDisplayUnit, getDisplayUnit, unitLabel, displayStat,
} from "../src/units.js";
import { displayWeights } from "../src/boot.js";

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.error(`✗ ${name}`); } };
const eq = (a, b, name) => ok(Object.is(a, b) || a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// 1 ── raw conversions, one constant
eq(toLbs(100, "kg"), 100 * LBS_PER_KG, "toLbs kg→lbs uses THE constant");
eq(toLbs(225, "lbs"), 225, "toLbs identity on lbs");
eq(toKg(100, "kg"), 100, "toKg identity on kg");
ok(Math.abs(toKg(220.462, "lbs") - 100) < 1e-9, "toKg lbs→kg");

// 2 ── round-trip losslessness: display from the RAW pair is stable under any
// number of toggle flips (identity when units match; derived values converge
// after one conversion and never drift again).
for (const [w, unit] of [[110, "kg"], [102.5, "kg"], [225, "lbs"], [137.5, "lbs"], [61, "kg"]]) {
  setDisplayUnit(unit); // display in the unit it was typed in → EXACT echo
  eq(toDisplay(w, unit), w, `raw pair echoes exactly in its own unit (${w}${unit})`);
  // flip 6 times: the shown number in each unit must be identical every visit
  const seen = { lbs: null, kg: null };
  for (let i = 0; i < 6; i++) {
    const du = i % 2 ? "kg" : "lbs";
    setDisplayUnit(du);
    const shown = roundStat(toDisplay(w, unit), du);
    if (seen[du] == null) seen[du] = shown;
    eq(shown, seen[du], `no cumulative rounding on flip ${i} (${w}${unit} shown as ${du})`);
  }
}

// 3 ── rounding rules
setDisplayUnit("kg");
eq(roundStat(242.51), 242.5, "stat rounds to 0.5 kg");
eq(roundLoad(101.2), 100, "load rounds to 2.5 kg");
setDisplayUnit("lbs");
eq(roundStat(242.51), 243, "stat rounds to 1 lb");
eq(roundLoad(242.51), 245, "load rounds to 5 lb");
eq(fmtWeightIn(110, "kg"), "243lbs", "kg row formatted for a lbs athlete (stat)");
setDisplayUnit("kg");
eq(fmtWeightIn(110, "kg"), "110kg", "kg row echoes exactly for a kg athlete");
eq(unitLabel(), "kg", "unitLabel follows the registry");
eq(displayStat(220.462), 100, "lbs-derived value shown in kg");

// 4 ── displayWeights honors the athlete's unit
setDisplayUnit("lbs");
eq(displayWeights("Front Squat 3x5 @ 225"), "Front Squat 3x5 @ 225 lbs", "lbs mode unchanged");
eq(displayWeights("Bench 3x5 @ 225", "kg"), "Bench 3x5 @ 102.5 kg", "kg mode converts bare loads to 2.5 kg steps");
eq(displayWeights("Bench 3x5 @ 185 (75%)", "kg"), "Bench 3x5 @ 75% (85 kg)", "kg mode converts %-sourced loads");
eq(displayWeights("Squat 5x3 @ 100kg", "kg"), "Squat 5x3 @ 100kg", "already-kg lines pass through");
eq(displayWeights("Row 3x8 @ 135 lbs", "kg"), "Row 3x8 @ 60 kg", "explicit-lbs lines convert in kg mode");

// 5 ── stray-constant gate: no 2.2… conversion literal outside units.js
const roots = ["src", "api"];
const offenders = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) { if (!/node_modules|assets/.test(p)) walk(p); continue; }
    if (!/\.(js|jsx|mjs)$/.test(f)) continue;
    if (p.endsWith("src/units.js") || p.endsWith("scripts/test-units.mjs")) continue;
    const txt = readFileSync(p, "utf8");
    for (const [i, line] of txt.split("\n").entries()) {
      if (/2\.20?4?6?2?\d*\s*[*/]|[*/]\s*2\.20?4?6?2?\d*|0\.4535/.test(line) && !/LBS_PER_KG/.test(line)) {
        offenders.push(`${p}:${i + 1}: ${line.trim().slice(0, 90)}`);
      }
    }
  }
};
roots.forEach(walk);
ok(offenders.length === 0, `no stray conversion constants outside units.js\n${offenders.join("\n")}`);

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
