// Program Builder AI eval harness — REAL draft generations against fixture
// blueprints, asserting the doctrine rules deterministically. Costs tokens:
// needs ANTHROPIC_API_KEY (run with `node --env-file=.env` if the key is in
// .env, or exported). Listed in NEEDS_CREDENTIALS — not part of `npm test`.
// Re-run on every doctrine edit (docs/doctrine/README.md).
//
//   ANTHROPIC_API_KEY=... node scripts/test-program-build.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cellsFor, drafterSystem, draftUser, validateDraft } from "../src/programBuilder.js";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.log("SKIP: ANTHROPIC_API_KEY not set — this harness generates real drafts."); process.exit(0); }

const here = dirname(fileURLToPath(import.meta.url));
const doc = (f) => readFileSync(join(here, "..", "docs", "doctrine", f), "utf8");
const DOCTRINE = { core: doc("doctrine-core.md"), inseason: doc("doctrine-inseason.md"), team: doc("doctrine-team.md"), conditioning: doc("doctrine-conditioning.md"), return: doc("doctrine-return.md") };

const bp = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, source: "interview" }]));

// Fixture set from the build handoff. `extra` = fixture-specific assertions.
const FIXTURES = [
  { name: "novice 3-day", viewer: "athlete", topic: null, athlete: { name: "Novice", age: 16 },
    blueprint: bp({ goal: "Add 50 lbs to squat by December 1", schedule: "3 days/week, 60 min sessions", equipment: "full gym", red_flags: "None", non_negotiables: "None", recovery: "sleeps 8h, no sport practice right now", prep: "one standard routine", handoff: "first real program" }),
    extra: (t) => [] },
  { name: "in-season team", viewer: "coach", topic: "inseason",
    athlete: { name: "Varsity Basketball", sport: "Basketball" },
    blueprint: bp({ goal: "Maintain strength through the season, healthy for playoffs March 1", schedule: "2 lifting days/week", equipment: "school weight room, 4 racks", red_flags: "None", handoff: "off-season strength block just ended", team_destination: "playoffs March 1", season_map: "in-season now, games Tue/Fri", team_read: "tired legs, effort good", roster_spread: "12 athletes, 2 true beginners", weekly_reality: "shared 45-min window, 12 athletes 4 racks", proof: "vertical jump, retest at season end", house_rules: "no maxing during season" }),
    extra: (t) => {
      const p = [];
      if (!/maint/i.test(t)) p.push("in-season draft never says maintenance");
      if (/(RPE\s*[89])|(@ ?9[05]%)|(1RM test)|max out/i.test(t)) p.push("in-season draft programs above the RPE 6-7 ceiling");
      return p;
    } },
  { name: "hamstring red flag", viewer: "athlete", topic: "return", athlete: { name: "Flagged", age: 17, sport: "Soccer" },
    blueprint: bp({ goal: "Squat 275 by November 15", schedule: "4 days/week", equipment: "full gym", red_flags: "nagging left hamstring, gradual onset", non_negotiables: "None", recovery: "practice 4h/week", prep: "day-specific", handoff: "stalled last block when hamstring flared" }),
    extra: (t) => /hamstring/i.test(t) ? [] : ["red flag never acknowledged in draft text"] },
  { name: "45-min no-barbell", viewer: "athlete", topic: null, athlete: { name: "Busy", age: 25 },
    blueprint: bp({ goal: "Bench-press bodyweight (185) by October 1", schedule: "4 days/week, 45 min sessions", equipment: "dumbbells only, no barbell", red_flags: "None", non_negotiables: "no burpees", recovery: "high work stress", prep: "minimal", handoff: "coming off a layoff" }),
    extra: (t) => /burpee/i.test(t) ? ["programmed a movement the athlete banned (burpees)"] : [] },
  { name: "winter-break conditioning", viewer: "athlete", topic: "conditioning", athlete: { name: "Break", age: 16, sport: "Volleyball" },
    blueprint: bp({ goal: "Hold conditioning through 2-week winter break, back December 29", schedule: "3 days/week, no gym access", equipment: "bodyweight only", red_flags: "None", non_negotiables: "None", recovery: "off practice for the break", prep: "one standard routine", handoff: "mid-season maintenance block" }),
    extra: (t) => /barbell|rack|bench press \d/i.test(t) ? ["equipment violation: gym work in a bodyweight-only break plan"] : [] },
];

const gen = async (fx) => {
  const system = [
    { type: "text", text: DOCTRINE.core + (fx.topic ? `\n\n${DOCTRINE[fx.topic]}` : ""), cache_control: { type: "ephemeral" } },
    { type: "text", text: drafterSystem({ viewer: fx.viewer }) },
  ];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 3500, system, messages: [{ role: "user", content: draftUser({ blueprint: fx.blueprint, cells: cellsFor(fx.viewer, "full"), athlete: fx.athlete }) }] }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || "api error");
  return d.content?.[0]?.text || "";
};

let fail = 0;
for (const fx of FIXTURES) {
  try {
    const text = await gen(fx);
    const base = validateDraft(text, { blueprint: fx.blueprint });
    const problems = [...base.problems, ...fx.extra(text)];
    if (problems.length) { fail++; console.error(`✗ ${fx.name}\n${problems.map(p => `    - ${p}`).join("\n")}`); }
    else console.log(`✓ ${fx.name}`);
  } catch (e) { fail++; console.error(`✗ ${fx.name} — generation failed: ${e.message}`); }
}
if (fail) { console.error(`\n${fail} of ${FIXTURES.length} fixtures FAILED`); process.exit(1); }
console.log(`\nAll ${FIXTURES.length} draft fixtures green.`);
