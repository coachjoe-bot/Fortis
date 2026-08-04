// Program-EDIT AI eval harness (T32d) — measures whether the shipped
// "program_apply_change" contract changes ONLY what was asked.
//
// Runs the EXACT prompt + model + guard the app ships (the athlete self-apply /
// coach runMerge twins, Sonnet 5, mergeGuard) against fixture programs and a
// battery of edit requests, then scores the result MECHANICALLY with lineDiff:
//   1. did the requested change land, and
//   2. did anything else change (collateral — the thing Will doesn't trust).
//
// Costs tokens: needs ANTHROPIC_API_KEY or ANTHROPIC_KEY (run with
// `node --env-file=path/to/.env scripts/test-program-edit-eval.mjs`). SKIPs
// without a key — deliberately NOT part of `npm test`, same as
// test-program-build.mjs. Re-run whenever the merge prompt or mergeGuard change.
import { lineDiff, diffStats, findPlacement, mergeGuard, mergeSystemPrompt } from "../src/programDiff.js";

// Two ways to reach a model, matching how this repo actually holds keys:
//   direct — ANTHROPIC_API_KEY / ANTHROPIC_KEY in the environment.
//   proxy  — no local key (prod's is Vercel-only): authenticate as the public
//            demo athlete and go through a deployment's own /api/claude, which
//            runs the SAME allowlist/model params the app uses. Default base is
//            the sales demo (its Coach Joe streams live, so its key is real).
const KEY = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY;
const PROXY_BASE = process.env.EVAL_PROXY_BASE || "https://wilco-sales-demo.vercel.app";
const PROXY_LOGIN = { name: process.env.EVAL_PROXY_NAME || "Marcus Ellison", pin: process.env.EVAL_PROXY_PIN || "1234" };
let proxyAuth = null;
const proxyLogin = async () => {
  const r = await fetch(`${PROXY_BASE}/api/identity`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "athlete-login", ...PROXY_LOGIN }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.athlete?.id) throw new Error(`proxy login failed: ${d.error || d.reason || r.status}`);
  return { role: "athlete", id: d.athlete.id, pin: PROXY_LOGIN.pin, token: d.token };
};
if (!KEY) {
  if (process.env.EVAL_AUTH_ID && process.env.EVAL_AUTH_PIN) {
    // Direct athlete auth (id+pin) — for a disposable eval athlete when the
    // deployment's identity fixtures don't cover a login-by-name path.
    proxyAuth = { role: "athlete", id: process.env.EVAL_AUTH_ID, pin: process.env.EVAL_AUTH_PIN };
    console.log(`(no local key — routing via ${PROXY_BASE} as athlete ${proxyAuth.id.slice(0, 8)}…)`);
  } else {
    try { proxyAuth = await proxyLogin(); console.log(`(no local key — routing via ${PROXY_BASE} as ${PROXY_LOGIN.name})`); }
    catch (e) { console.log(`SKIP: no ANTHROPIC key and proxy unavailable (${e.message}).`); process.exit(0); }
  }
}

// The shipped merge contract, imported from the SAME module the app uses —
// what this harness measures is definitionally what ships.
const MERGE_SYS = mergeSystemPrompt;

const applyEdit = async ({ program, request, lift, owner = "athlete" }) => {
  const placement = lift ? findPlacement(program, lift) : null;
  const parts = [`CURRENT PROGRAM:\n${program}`, `\nREQUESTED CHANGE: ${request}`];
  if (placement) parts.push(`\nTARGET: ${placement.dayLabel || "unspecified day"}, currently "${placement.currentLine}"`);
  let text;
  if (KEY) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 4000, system: MERGE_SYS(owner), messages: [{ role: "user", content: parts.join("\n") }] }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || "api error");
    text = d.content?.[0]?.text || "";
  } else {
    // Same body shape App.jsx's askClaude sends; api/claude.js validates the
    // model against its allowlist and applies the app's real inference params.
    const r = await fetch(`${PROXY_BASE}/api/claude`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: proxyAuth, model: "claude-sonnet-5", max_tokens: 4000, system: MERGE_SYS(owner),
        messages: [{ role: "user", content: [{ type: "text", text: parts.join("\n") }] }], feature: "program_apply_change" }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `proxy ${r.status}`);
    text = d.content?.[0]?.text || d.text || "";
  }
  return mergeGuard(program, text);
};

// ── fixtures ─────────────────────────────────────────────────────────────────

// Will-shaped: %-based with a training-number table (the case he actually runs).
const OLY = `BLOCK II — Weeks 5-8 (4 days/week)
1RM Used: Snatch 250 | Clean & Jerk 305 | Back Squat 425 | Bench 275

Day 1 – Snatch + Squat
Snatch 5x2 @ 70%
Snatch Pull 3x3 @ 90%
Back Squat 5x3 @ 75%
Ab wheel 3x12

Day 2 – Clean & Jerk
Clean & Jerk 6x1 @ 75%
Front Squat 4x2 @ 80%
Push Press 3x5 @ 65%
Weighted Plank 3x45s

Day 3 – Push A
Bench Press 5x1 (climbing) @ 185/205/225/245/275
Strict Press 3x5 @ 95/115/135
Lat Raises 3x12 @ 35
Bottoms up KB press 3x5 ea @ 25
Finisher: 50 push ups

Day 4 – Pulls + Legs
Deadlift 4x2 @ 80%
Snatch-Grip RDL 3x6 @ 60%
Pull-ups 4x8
Farmer Carry 4x40yd heavy`;

// Simple novice linear plan, fixed weights.
const NOVICE = `STARTING STRENGTH — 3 days/week

Workout A
Squat 3x5 @ 185
Bench Press 3x5 @ 135
Barbell Row 3x5 @ 115

Workout B
Squat 3x5 @ 185
Overhead Press 3x5 @ 85
Deadlift 1x5 @ 225

Notes: add 5 lbs to squat each session, 5 lbs upper lifts each week.
Warm up with empty bar x10 before every lift.`;

// Block program with per-week columns (the format the QL prompt warns about).
const BLOCK = `HYPERTROPHY BLOCK (Weeks: Jun 30-Jul 25)
        Wk1     Wk2     Wk3     Wk4
Day 1 – Upper
Bench Press     4x8@65% 4x8@67% 5x8@70% 3x8@60%
Incline DB      3x10    3x12    4x10    3x10
Cable Row       4x10    4x10    4x12    3x10
Curls           3x12    3x12    3x15    3x12

Day 2 – Lower
Squat           4x8@65% 4x8@67% 5x8@70% 3x8@60%
RDL             3x8     3x10    4x8     3x8
Leg Press       3x12    3x15    4x12    3x12
Calves          4x15    4x15    4x15    4x15

Day 3 – Full
Deadlift        3x5@70% 3x5@72% 4x5@75% 2x5@65%
OHP             4x6     4x8     5x6     3x6
Chin-ups        4xAMRAP 4xAMRAP 4xAMRAP 3xAMRAP
Ab wheel        3x10    3x12    3x15    3x10`;

// ── edit battery ─────────────────────────────────────────────────────────────
// check(diff, guard) returns problem strings. `sameOutside` asserts zero
// changed lines outside the named day section — the collateral test.

const lines = (t) => t.split("\n");
// Which "Day N"/"Workout X" section each source line index sits in.
const sectionOf = (program) => {
  const ls = lines(program);
  let cur = "(preamble)";
  const map = [];
  for (const l of ls) {
    if (/^(Day |Workout )/i.test(l.trim())) cur = l.trim();
    map.push(cur);
  }
  return (idx) => map[Math.min(idx, map.length - 1)];
};

// Collateral: every del/add outside the allowed section(s).
const collateral = (program, diff, allowedSections) => {
  const sec = sectionOf(program);
  const out = [];
  let oldIdx = 0;
  let curSection = "(preamble)";
  for (const d of diff) {
    if (d.type !== "add") {
      curSection = sec(oldIdx);
      oldIdx++;
    }
    if (d.type === "same") continue;
    if (!d.text.trim()) continue; // blank separator lines moving around is never collateral
    // adds attach to the section of the surrounding old-line cursor
    const section = curSection;
    if (!allowedSections.some((a) => section.toLowerCase().includes(a.toLowerCase()))) {
      out.push(`${d.type === "del" ? "-" : "+"} [${section}] ${d.text.trim().slice(0, 60)}`);
    }
  }
  return out;
};

const CASES = [
  // ── remove one line ──
  { name: "OLY: remove ab wheel from Day 1", program: OLY, lift: "Ab wheel",
    request: "Take the ab wheel out of Day 1.",
    check: (p, g) => {
      const probs = [];
      if (/ab wheel/i.test(g.text.split("Day 2")[0])) probs.push("ab wheel still in Day 1");
      probs.push(...collateral(p, lineDiff(p, g.text), ["Day 1"]));
      return probs;
    } },
  { name: "NOVICE: remove barbell row", program: NOVICE, lift: "Barbell Row",
    request: "Remove the barbell row.",
    check: (p, g) => {
      const probs = [];
      if (/barbell row/i.test(g.text)) probs.push("barbell row still present");
      probs.push(...collateral(p, lineDiff(p, g.text), ["Workout A"]));
      return probs;
    } },
  // ── remove a whole day ──
  { name: "OLY: remove Day 4 entirely", program: OLY, lift: null,
    request: "Drop Day 4 completely, I'm going to 3 days a week.",
    check: (p, g) => {
      const probs = [];
      if (/Day 4|Deadlift 4x2|Farmer Carry/i.test(g.text)) probs.push("Day 4 content survives");
      // allowed: Day 4 section + the header line (4 days/week may legitimately become 3)
      probs.push(...collateral(p, lineDiff(p, g.text), ["Day 4", "(preamble)"]));
      return probs;
    } },
  // ── swap a movement ──
  { name: "BLOCK: swap leg press for hack squat", program: BLOCK, lift: "Leg Press",
    request: "Swap the leg press for hack squats, same sets and reps.",
    check: (p, g) => {
      const probs = [];
      if (/leg press/i.test(g.text)) probs.push("leg press still present");
      if (!/hack squat/i.test(g.text)) probs.push("hack squat never added");
      const row = lines(g.text).find((l) => /hack squat/i.test(l)) || "";
      if (!/3x12.*3x15.*4x12.*3x12/.test(row.replace(/\s+/g, " "))) probs.push("week columns not carried over on the swapped line");
      probs.push(...collateral(p, lineDiff(p, g.text), ["Day 2"]));
      return probs;
    } },
  // ── change sets×reps on one slot ──
  { name: "NOVICE: deadlift 1x5 -> 2x3", program: NOVICE, lift: "Deadlift",
    request: "Change deadlift to 2 sets of 3.",
    check: (p, g) => {
      const probs = [];
      if (!/Deadlift 2x3 @ 225/.test(g.text)) probs.push("deadlift line not exactly '2x3 @ 225' (weight must carry over)");
      probs.push(...collateral(p, lineDiff(p, g.text), ["Workout B"]));
      return probs;
    } },
  // ── change ONE training number (the highest-stakes case) ──
  { name: "OLY: snatch 1RM 250 -> 255, nothing else", program: OLY, lift: "Snatch",
    request: "Update my snatch number to 255.",
    check: (p, g) => {
      const probs = [];
      if (!/Snatch 255/.test(g.text)) probs.push("1RM Used line not updated to Snatch 255");
      if (!/Clean & Jerk 305/.test(g.text) || !/Back Squat 425/.test(g.text) || !/Bench 275/.test(g.text)) probs.push("another baseline number changed");
      if (!/Snatch 5x2 @ 70%/.test(g.text)) probs.push("percentages were rewritten (they must stay relative)");
      probs.push(...collateral(p, lineDiff(p, g.text), ["(preamble)"]));
      return probs;
    } },
  // ── add where it belongs ──
  { name: "NOVICE: add chin-ups to workout B", program: NOVICE, lift: "Chin-ups",
    request: "Add 3x8 chin-ups to workout B.",
    check: (p, g) => {
      const probs = [];
      const wb = g.text.split(/Workout B/i)[1] || "";
      if (!/chin-?ups? 3x8|3x8 chin/i.test(wb.split(/Notes:/i)[0])) probs.push("chin-ups not added under Workout B");
      probs.push(...collateral(p, lineDiff(p, g.text), ["Workout B"]));
      return probs;
    } },
  // ── the fear case: vague-ish request must not trigger a rewrite ──
  { name: "BLOCK: make week 4 a bit easier (deload tweak)", program: BLOCK, lift: null,
    request: "Make week 4 a little lighter on the main lifts, it's my deload.",
    check: (p, g) => {
      const probs = [];
      // Main-lift wk4 cells may change; accessory rows and weeks 1-3 cells must not.
      const before = lines(p), after = lines(g.text);
      for (const l of ["Incline DB", "Cable Row", "Curls", "RDL", "Leg Press", "Calves", "OHP", "Chin-ups", "Ab wheel"]) {
        const b = before.find((x) => x.startsWith(l));
        const a = after.find((x) => x.startsWith(l));
        if (b && a !== b) probs.push(`accessory row rewritten: ${l}`);
        if (b && !a) probs.push(`accessory row deleted: ${l}`);
      }
      for (const main of ["Bench Press", "Squat", "Deadlift"]) {
        const b = (before.find((x) => x.startsWith(main)) || "").replace(/\s+/g, " ").split(" ").slice(1, 4).join(" ");
        const a = (after.find((x) => x.startsWith(main)) || "").replace(/\s+/g, " ").split(" ").slice(1, 4).join(" ");
        if (b && b !== a) probs.push(`weeks 1-3 cells changed on ${main}`);
      }
      return probs;
    } },
];

// ── run ──────────────────────────────────────────────────────────────────────
const RUNS = Number(process.env.EVAL_RUNS || 1); // bump for variance measurement
let fail = 0, guardRejects = 0;
for (const c of CASES) {
  for (let r = 0; r < RUNS; r++) {
    const label = RUNS > 1 ? `${c.name} [run ${r + 1}]` : c.name;
    try {
      const guard = await applyEdit({ program: c.program, request: c.request, lift: c.lift });
      if (!guard.ok) { guardRejects++; console.log(`◦ ${label} — mergeGuard rejected: ${guard.reason}`); continue; }
      const probs = c.check(c.program, guard);
      const st = diffStats(lineDiff(c.program, guard.text));
      if (probs.length) { fail++; console.error(`✗ ${label} (±${st.added}/${st.removed} lines)\n${probs.map((x) => `    - ${x}`).join("\n")}`); }
      else console.log(`✓ ${label} (±${st.added}/${st.removed} lines)`);
    } catch (e) { fail++; console.error(`✗ ${label} — call failed: ${e.message}`); }
  }
}
console.log(`\n${fail ? `${fail} case(s) FAILED` : "All edit cases clean"}${guardRejects ? ` (${guardRejects} guard-rejected — safe but needs a retry UX)` : ""}.`);
process.exit(fail ? 1 : 0);
