// W18-3 trial-clock regression suite (Will's 08-20 ruling).
// Guards the pure logic in src/tiers.js plus the source contracts that make the
// design hold: the server stamp in api/identity.js, the trial-aware weekly-report
// filter, and the athlete-facing trial copy (the sentence read before a card is
// entered is money copy — same doctrine as test-billing-terms).
// Run with: node scripts/test-tier-trial.mjs

import { readFileSync } from "node:fs";
import { effectiveTier, trialActive, TRIAL_DAYS } from "../src/tiers.js";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error("  ✗ " + msg); } };
const eq = (got, want, msg) => ok(Object.is(got, want), `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const past   = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

console.log("effectiveTier:");
eq(effectiveTier({ tier: "free", trial_ends_at: future }), "pro",  "free inside the trial window presents as pro");
eq(effectiveTier({ tier: "free", trial_ends_at: past }),   "free", "expired trial silently answers free again");
eq(effectiveTier({ tier: "free", trial_ends_at: null }),   "free", "no stamp (pre-W18 account) stays free");
eq(effectiveTier({ tier: "free" }),                        "free", "missing column stays free");
eq(effectiveTier({ tier: "pro",   trial_ends_at: past }),  "pro",  "a paid tier is never touched by the clock");
eq(effectiveTier({ tier: "elite", trial_ends_at: future }), "elite", "elite passes through unchanged");
eq(effectiveTier({ tier: "school", trial_ends_at: future }), "school", "school passes through unchanged");
eq(effectiveTier({ trial_ends_at: future }), "pro", "tier missing entirely defaults to free, so the clock applies");
eq(effectiveTier(null), "free", "null athlete is free");
eq(effectiveTier({ tier: "free", trial_ends_at: "not-a-date" }), "free", "garbage timestamp never elevates");

console.log("trialActive:");
ok(trialActive({ tier: "free", trial_ends_at: future }) === true,  "free + future stamp = active trial");
ok(trialActive({ tier: "free", trial_ends_at: past }) === false,   "expired = not active");
ok(trialActive({ tier: "pro",  trial_ends_at: future }) === false, "paid tier is never 'on the free trial'");
ok(trialActive(null) === false, "null athlete = not active");
eq(TRIAL_DAYS, 7, "the trial is 7 days (Will's ruling — not 14, not 30)");

// ── source contracts ─────────────────────────────────────────────────────────
console.log("source contracts:");
{
  const identity = readFileSync(new URL("../api/identity.js", import.meta.url), "utf8");
  ok(identity.includes("row.trial_ends_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)"),
     "identity.js stamps a 7-day trial_ends_at at account creation");
  ok(/if \(!body\.isSchool\) row\.trial_ends_at/.test(identity),
     "school signups never get the trial stamp");

  const data = readFileSync(new URL("../api/data.js", import.meta.url), "utf8");
  ok(!/ATHLETE_COL_ALLOW[\s\S]{0,2000}trial_ends_at/.test(data.slice(0, data.indexOf("ATHLETE_COL_ALLOW") + 3000)) || !data.includes("trial_ends_at"),
     "trial_ends_at is NOT athlete-writable (absent from api/data.js entirely)");

  const weekly = readFileSync(new URL("../api/send-weekly-report.js", import.meta.url), "utf8");
  ok(weekly.includes("and(tier.eq.free,trial_ends_at.gt."),
     "weekly report includes free athletes still inside the trial window");

  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok(app.includes("Every plan starts with a 7-day free trial"),
     "the plan step states the universal 7-day trial");
  ok(app.includes("You won't be billed for ${trialDays} days"),
     "the card step says plainly that billing waits out the trial (Will's exact ask)");
  ok(app.includes("Starts with 7 days of Pro, no card needed"),
     "the FREE card is honest about what the trial grants");
  ok(!app.includes('No session memory (fresh start each login)'),
     "the stale free-card line is gone");
  // Feature gating reads effectiveTier; billing reconciliation must keep the raw tier.
  ok((app.match(/effectiveTier\(/g) || []).length >= 12, "the gating call sites moved to effectiveTier");
  ok(app.includes('const localPaid = athlete.tier==="pro" || athlete.tier==="elite"'),
     "the webhook-lag guard still reads the RAW tier (billing truth, not feature gating)");

  const boot = readFileSync(new URL("../src/boot.js", import.meta.url), "utf8");
  ok(boot.includes("effectiveTier(a) !== \"free\""),
     "the today's-session opener is trial-aware");
}

console.log(`\n${fail === 0 ? `All ${pass} checks green.` : `${fail} FAILED (${pass} passed)`}`);
process.exit(fail === 0 ? 0 : 1);
