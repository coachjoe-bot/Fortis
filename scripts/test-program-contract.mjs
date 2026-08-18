// ─── T53 #7/#8: BLOCK INFO contract reader/writer suite ──────────────────────
import { parseBlockInfo, campaignLine, stripBlockInfo } from "../src/programContract.js";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.error(`✗ ${n}`); } };

const prog = `=== BLOCK INFO ===
Goal: Bench 315 by Dec 25
Maxes used: Back Squat 405 lb (declared/tested 1RM), Bench Press ~275 lb (est. from logs), Snatch 113 kg (declared/tested 1RM)
Loading: percentages and RPE mixed
Runs: 2026-08-18 to 2026-09-14
Gate: bench 3x5 @ 275 by week 4
Campaign: Block 1 of 3 (this one): 4 wk strength base → checkpoint bench 3x5 @ 275; Block 2 of 3: 4 wk intensification; Block 3 of 3: 2 wk peak → checkpoint bench single

WILL // FALL BLOCK 1 — Strength Base
Day 1 - Push
Warm-up: standard
Bench Press 4x5 @ 75% (205 lbs)
Cool-down: stretch`;

const p = parseBlockInfo(prog);
ok(p.found, "header found");
ok(p.goal === "Bench 315 by Dec 25", `goal parsed (got "${p.goal}")`);
ok(p.loading.includes("RPE"), "loading parsed");
ok(p.runs === "2026-08-18 to 2026-09-14", "runs parsed");
ok(p.gate === "bench 3x5 @ 275 by week 4", `gate parsed (got "${p.gate}")`);
ok(parseBlockInfo("=== BLOCK INFO ===\nGoal: g\n\nDay 1").gate === null, "no gate → null");
ok(p.maxes.length === 3, `3 maxes (got ${p.maxes.length})`);
ok(p.maxes[0].lift === "Back Squat" && p.maxes[0].weight === 405 && p.maxes[0].source === "declared", "declared max parsed");
ok(p.maxes[1].source === "estimated", "estimated max tagged");
ok(p.maxes[2].unit === "kg" && p.maxes[2].weight === 113, "kg max keeps its unit");
ok(p.campaign.length === 3, `3 campaign blocks (got ${p.campaign.length})`);
ok(p.campaign[0].current === true && p.campaign[0].weeks === 4, "current block flagged with weeks");
ok(p.campaign[0].checkpoint && p.campaign[0].checkpoint.includes("275"), "checkpoint parsed");
ok(p.campaign[2].n === 3 && p.campaign[2].weeks === 2, "third block parsed");

ok(parseBlockInfo("Day 1 - Push\nBench 3x5 @ 225").found === false, "pre-contract program → found:false");
ok(parseBlockInfo("").found === false, "empty → found:false");

// writer → reader round trip
const line = campaignLine([
  { n: 1, weeks: 4, emphasis: "strength base", checkpoint: "bench 3x5 @ 275" },
  { n: 2, weeks: 4, emphasis: "intensification" },
], 1);
const rt = parseBlockInfo(`=== BLOCK INFO ===\nGoal: g\nCampaign: ${line}\n\nDay 1`);
ok(rt.campaign.length === 2 && rt.campaign[0].current && rt.campaign[0].weeks === 4, "campaignLine round-trips through the parser");
ok(campaignLine([]) === "" && campaignLine(null) === "", "empty campaign → empty line");

// stripBlockInfo — the display half of the same contract (T57): drops exactly
// the header lines parseBlockInfo reads, leaves everything else byte-identical.
const stripped = stripBlockInfo(prog);
ok(!/BLOCK INFO/.test(stripped), "strip removes the header banner");
ok(!/^Goal:/m.test(stripped) && !/^Runs:/m.test(stripped) && !/^Campaign:/m.test(stripped), "strip removes the header's key lines");
ok(/WILL \/\/ FALL BLOCK 1/.test(stripped), "strip keeps the program body");
ok(stripped.startsWith("WILL //"), "body starts clean, no leading blank");
ok(stripBlockInfo("Day 1 - Push\nBench 3x5 @ 225") === "Day 1 - Push\nBench 3x5 @ 225", "pre-contract text passes through unchanged");
ok(stripBlockInfo("") === "", "empty stays empty");

console.log(`\n${pass}/${pass + fail} passed${fail ? " — FAILED" : ""}`);
process.exit(fail ? 1 : 0);
