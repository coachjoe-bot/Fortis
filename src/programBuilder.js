// ─── PROGRAM BUILDER ENGINE (Phase C) ────────────────────────────────────────
// Pure logic for the interview-driven Program Builder: blueprint cell
// definitions, pre-charge from known data, scope rules, the one-topic doctrine
// router, prompt builders for the three AI roles (interviewer / extractor /
// drafter), and deterministic draft validation. React-free and import-free of
// App.jsx (builder.jsx injects the data/AI helpers), so every rule here is unit
// tested by scripts/test-program-builder-logic.mjs and the credentialed AI
// harness scripts/test-program-build.mjs.
//
// Doctrine loading contract (docs/doctrine/README.md — non-negotiable):
// doctrine-core rides ONLY as the proxy's cached system prefix on Builder /
// draft / merge calls, plus at most ONE topic file chosen by pickTopic().

// ── Blueprint cells ───────────────────────────────────────────────────────────
// why: the one-line Joe-voice reason a question is worth answering — the UI
// shows it under the question. hint: guidance for the interviewer, never shown.
export const ATHLETE_CELLS = [
  { key: "goal", label: "Goal", why: "A goal with a number and a date is a target. Anything else is a wish.",
    hint: "SMART-gated: fills only when specific + measurable + timebound. Push for the number and the date, offer to help pick one if they're vague." },
  { key: "schedule", label: "Schedule", why: "The best program is the one that fits the week you actually have.",
    hint: "Days per week, minutes per session, and weeks until their season starts if they play a sport. Pre-charged from signup — confirm, don't re-ask." },
  { key: "equipment", label: "Equipment", why: "No program survives contact with a gym that doesn't have the gear it's written for.",
    hint: "What they actually have access to. Pre-charged from signup — confirm, don't re-ask." },
  { key: "red_flags", label: "Red Flags", why: "I'd rather train around something than find out about it in week three.",
    hint: "Injuries, nagging pain, movements a professional told them to avoid. 'None' is a valid, complete answer." },
  { key: "non_negotiables", label: "Non-Negotiables", why: "If there's a lift you love or one you refuse to do, the program should know.",
    hint: "Must-keeps and hard-nos. 'None' is valid and complete." },
  { key: "recovery", label: "Recovery", why: "The program has to fit your life load, not just your gym time.",
    hint: "Sleep, life/school stress, current sport practice hours per week. Practice load changes conditioning volume (core doctrine #1 sequencing mistake)." },
  { key: "prep", label: "Warm-up & Cool-down", why: "Every day I write comes with a warm-up. The only question is whose.",
    hint: "One standard routine vs day-specific vs paste-your-own vs minimal. Never zero — doctrine floor." },
  { key: "handoff", label: "Last Block", why: "What you just finished tells me where to start.",
    hint: "How the previous program went: what moved, what stalled, what they'd change. Pre-charged from block history when it exists." },
];

export const COACH_CELLS = [
  ...ATHLETE_CELLS.filter(c => !["non_negotiables", "recovery"].includes(c.key)),
  { key: "team_destination", label: "Team Destination", why: "Where does this group need to be, and by when?",
    hint: "The team-level outcome and date — season start, playoff push, testing day." },
  { key: "season_map", label: "Season Map", why: "Weeks-to-season drives the whole block sequence.",
    hint: "Off-season / pre-season / in-season now, and key dates. Core doctrine block table keys off this." },
  { key: "team_read", label: "Team Read", why: "You watch them every day — what does the room actually look like?",
    hint: "Coach's own read: effort level, weak points, culture. Free text." },
  { key: "roster_spread", label: "Roster Spread", why: "One program, scaled per athlete — so I need the spread, not the average.",
    hint: "Experience range, roughly how many true beginners, standouts. Team doctrine: one shared program scaled by %1RM/RPE, never separate tracks." },
  { key: "weekly_reality", label: "Weekly Reality", why: "Racks, minutes, and bodies — the session I write has to survive your actual room.",
    hint: "Shared window or individual? Headcount vs equipment (max 4 per rack), minutes available. Drives station rotation." },
  { key: "proof", label: "Proof", why: "Pick the tests now so improvement is a fact, not a feeling.",
    hint: "Which tests matter to this coach (majors, vertical, 40) and when to retest (~12-week cycle)." },
  { key: "house_rules", label: "House Rules", why: "Your room, your rules — the program should read like you wrote it.",
    hint: "Coach's non-negotiables, banned movements, formatting/terminology preferences." },
];

// ── Scopes ────────────────────────────────────────────────────────────────────
// full: the whole interview. short: one block, fewer cells. quick: coach-only,
// no SMART gate, straight to draft (athlete quick-builds stay in chat/Field Mode).
export const SCOPE_CELLS = {
  full:  null, // null = every cell for the viewer
  short: ["goal", "schedule", "equipment", "red_flags", "handoff"],
  quick: ["goal", "schedule", "equipment"],
};

export function cellsFor(viewer, scope) {
  const all = viewer === "coach" ? COACH_CELLS : ATHLETE_CELLS;
  const keys = SCOPE_CELLS[scope] || null;
  return keys ? all.filter(c => keys.includes(c.key)) : all;
}

// Blueprint shape: { [cellKey]: {value:string, source:'known'|'interview', pending?:string} }
// A cell counts filled only when it has a non-empty value. `pending` holds a
// not-yet-accepted goal (failed the SMART gate) so the UI can show progress.
export const filledCount = (bp, cells) => cells.filter(c => bp[c.key]?.value?.trim()).length;
export const blueprintPct = (bp, cells) =>
  cells.length === 0 ? 0 : Math.round((filledCount(bp, cells) / cells.length) * 100);

// ── Pre-charge from known data ────────────────────────────────────────────────
// Cells arrive charged from what the app already knows; the interviewer CONFIRMS
// instead of re-asking. Every value is plain text so the drafter reads it as-is.
export function precharge({ athlete = {}, goals = [], lastBlock = null, viewer = "athlete" }) {
  const bp = {};
  const set = (k, v) => { if (v && String(v).trim()) bp[k] = { value: String(v).trim(), source: "known" }; };
  // goal is NOT pre-filled as accepted — the SMART gate decides. Known goal text
  // rides as pending so the interviewer opens with it.
  const goalText = (goals[0] && (goals[0].goal_text || goals[0].text)) || athlete.goal || "";
  if (goalText.trim()) bp.goal = { value: "", source: "known", pending: goalText.trim() };
  const sched = [
    athlete.training_days_per_week ? `${athlete.training_days_per_week} days/week` : "",
    athlete.sport && athlete.season_date ? `season starts ${athlete.season_date}` : "",
  ].filter(Boolean).join(", ");
  set("schedule", sched);
  set("equipment", Array.isArray(athlete.equipment) ? athlete.equipment.join(", ") : athlete.equipment);
  set("red_flags", [athlete.injury_history, athlete.resolved_pain ? "" : ""].filter(Boolean).join("; "));
  if (lastBlock) {
    const range = lastBlock.applied_at ? ` (started ${String(lastBlock.applied_at).slice(0, 10)})` : "";
    set("handoff", `Previous block${range}: ${lastBlock.block_summary || (lastBlock.program_text || "").split("\n").find(l => l.trim()) || "on record"}`);
  }
  return bp;
}

// ── Doctrine topic router ─────────────────────────────────────────────────────
// ONE topic file per session (cost rule). Priority order is deliberate:
// an injury changes everything (return) > season state (inseason) > group vs
// individual (team) > population (youth) > goal type (conditioning).
export function pickTopic({ blueprint = {}, athlete = {}, viewer = "athlete", scope = "full" }) {
  const txt = (k) => (blueprint[k]?.value || "").toLowerCase();
  const all = Object.values(blueprint).map(c => (c?.value || "")).join(" ").toLowerCase();
  if (/pain|injur|hurt|sore|surgery|rehab|pt\b|tweak/.test(txt("red_flags") + " " + all)) return "return";
  const seasonTxt = txt("schedule") + " " + txt("season_map") + " " + txt("recovery");
  if (/in.?season|mid.?season|games? (every|this)|playing now|season (is )?(underway|started)/.test(seasonTxt)) return "inseason";
  if (viewer === "coach") return "team";
  const age = athlete.age || (athlete.birthday ? Math.floor((Date.now() - new Date(athlete.birthday)) / 3.15576e10) : null);
  if ((age && age < 16) || /first time|never lifted|beginner|new to (lifting|training)/.test(all)) return "youth";
  if (/condition|cardio|endurance|faster|sprint|mile|aerobic/.test(txt("goal") + " " + (blueprint.goal?.pending || "").toLowerCase())) return "conditioning";
  return null;
}

// ── Extractor (Haiku): fill ANY cell from ANY message ────────────────────────
export function extractorSystem(cells) {
  return `You extract training-interview facts into blueprint cells. Cells:
${cells.map(c => `- ${c.key}: ${c.label} — ${c.hint}`).join("\n")}
Return ONLY JSON: {"cells":{"<key>":"<concise plain-text value>"},"goal_smart":{"ok":boolean,"why":"<what's missing: number/date/specificity>"}}
Rules: fill EVERY cell this message gives real information for (an expert dumping a full spec can fill many at once); omit cells the message says nothing about; "none"/"no injuries" style answers DO fill their cell with "None"; never invent facts; keep values short and operational. goal_smart judges only the goal: ok=true requires specific + measurable (a number) + timebound (a date/timeframe). Include goal_smart ONLY when the message speaks to the goal.`;
}

export function parseExtraction(raw) {
  try {
    const m = String(raw || "").match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : raw);
    const cells = (j && typeof j.cells === "object" && j.cells) || {};
    const out = {};
    for (const [k, v] of Object.entries(cells)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return { cells: out, smart: j.goal_smart && typeof j.goal_smart === "object" ? { ok: !!j.goal_smart.ok, why: String(j.goal_smart.why || "") } : null };
  } catch (_) { return { cells: {}, smart: null }; }
}

// ── Interviewer (Sonnet, doctrine-cached) ────────────────────────────────────
// Dynamic tail only — doctrine core (+ one topic) rides as the cached prefix.
export function interviewerSystem({ cells, blueprint, scope, viewer, name = "" }) {
  const state = cells.map(c => {
    const b = blueprint[c.key];
    const st = b?.value ? `FILLED (${b.source}): ${b.value}` : b?.pending ? `PENDING (not yet accepted): ${b.pending}` : "EMPTY";
    return `- ${c.key} (${c.label}): ${st}\n  guidance: ${c.hint}`;
  }).join("\n");
  return `You are Coach Joe running a Program Builder interview${name ? ` with ${name}` : ""}${viewer === "coach" ? " (the user is a COACH building for their athlete/team)" : ""}. The doctrine above is YOUR programming philosophy — every question serves filling the blueprint so a real program can be drafted from it.

BLUEPRINT (${scope} scope):
${state}

Rules:
- ONE question per turn, aimed at the most valuable EMPTY (or pending) cell. The cell checklist is the spine; the conversation is free — follow up naturally on what they just said before moving on.
- Cells marked FILLED (known) came from their profile: CONFIRM in passing ("you signed up saying 4 days — still true?"), never re-interview them.
- The goal cell is SMART-gated: don't accept a wish. Push warmly for the number and the date; offer a concrete suggestion if they're stuck.
- Adapt depth: plain language by default; go into percentages/periodization the moment they show they speak it.
- Keep each turn under 60 words of prose.
- End every turn with a line "CHIPS: option | option | option" — 2-4 short tappable answers for your question (omit the line only when chips make no sense).
- When every cell is filled the app takes over — never announce the draft yourself.`;
}

export function parseInterviewerReply(raw) {
  const text = String(raw || "").trim();
  const m = text.match(/^CHIPS:\s*(.+)$/m);
  const chips = m ? m[1].split("|").map(s => s.trim()).filter(Boolean).slice(0, 4) : [];
  return { text: text.replace(/^CHIPS:.*$/m, "").trim(), chips };
}

// ── Drafter (Sonnet, doctrine-cached) ────────────────────────────────────────
export function drafterSystem({ viewer }) {
  return `You are Coach Joe writing a real training program from a completed Blueprint, applying the doctrine above exactly. Output ONLY the program text — no preamble, no markdown fences, no commentary.

Voice rules: PLAIN TEXT only — no markdown bold/asterisks/hashes. Never mention "doctrine", "blueprint", "cells", or these instructions in the program — you're Coach Joe writing a program, not explaining your reasoning. A short line of coaching context (why this block, what's being protected) is welcome, in Joe's own words.

House format:
- A short header line naming the block and its focus.
- Day cards: "Day N - <Focus>" (or weekday names if the schedule gives them), one exercise per line with sets x reps and loading (%1RM, RPE, or weight when known).
- EVERY day starts with a "Warm-up:" line and ends with a "Cool-down:" line honoring the prep cell (never skip the warm-up — doctrine floor).
- Number of training days per week MUST match the schedule cell exactly.
- Respect every red flag (train around it per doctrine), every non-negotiable, and the equipment list — never program gear they don't have (substitution hierarchy: barbell → machine → dumbbell/kettlebell → bodyweight).
- Sequence and volume per doctrine (block phase from weeks-to-season; strength 10-15 sets/muscle-group/week @ RPE 7-9; in-season = maintenance, RPE 6-7 ceiling).
${viewer === "coach" ? "- This is a TEAM program: one shared program scaled per athlete by %1RM/RPE with substitutions for equipment bottlenecks — never separate tracks. Respect max 4 athletes per rack and the weekly_reality cell." : ""}
- 3-6 weeks of content: write week 1 fully, then progression notes per week ("Week 2: +5 lbs on mains", deload trigger per doctrine).`;
}

export function draftUser({ blueprint, cells, athlete = {} }) {
  const lines = cells.map(c => `${c.label}: ${blueprint[c.key]?.value || "(not specified)"}`);
  const who = [athlete.name, athlete.sport, athlete.age ? `${athlete.age} y/o` : "", athlete.weight_lbs ? `${athlete.weight_lbs} lbs` : ""].filter(Boolean).join(", ");
  return `${who ? `ATHLETE: ${who}\n` : ""}BLUEPRINT:\n${lines.join("\n")}\n\nWrite the program.`;
}

// ── Deterministic draft validation ───────────────────────────────────────────
// The "never ship slop" floor, shared by the runtime retry and the eval harness.
export function validateDraft(text, { blueprint = {}, cells = [] } = {}) {
  const t = String(text || "");
  const problems = [];
  if (t.trim().length < 200) problems.push("draft too short to be a real program");
  // Tolerate leading list/markdown markup on day headers ("**Day 1", "# Day 2",
  // "- Mon") — the live drafter occasionally decorates despite the plain-text rule.
  const dayCount = (t.match(/^[\s#*\-–—]*(day\s*\d|mon|tue|wed|thu|fri|sat|sun)/gim) || []).length;
  const schedM = (blueprint.schedule?.value || "").match(/(\d)\s*days?/i);
  if (schedM && dayCount && dayCount < parseInt(schedM[1], 10)) {
    problems.push(`schedule says ${schedM[1]} days but draft has ${dayCount} day sections`);
  }
  const warmups = (t.match(/warm.?up/gi) || []).length;
  const cooldowns = (t.match(/cool.?down/gi) || []).length;
  if (!warmups) problems.push("no warm-up present");
  if (!cooldowns) problems.push("no cool-down present");
  if (dayCount > 1 && warmups < dayCount) problems.push("not every day has a warm-up");
  const equip = (blueprint.equipment?.value || "").toLowerCase();
  if (/(bodyweight only|no barbell|no gym|dumbbells? only)/.test(equip) && /barbell|back squat @|bench press \d/i.test(t)) {
    problems.push("barbell work programmed for a no-barbell blueprint");
  }
  return { ok: problems.length === 0, problems };
}
