// ─── CREW SHARED HELPERS ──────────────────────────────────────────────────────
// Used by api/data.js (the `crew` op) AND api/trigger-proof-feed.js (the Proof
// digest's crew blip) — one peer-resolution funnel so the two surfaces can never
// disagree about who's in whose crew (WILCO Crew build prompt §5/§9). `_`-prefixed
// so Vercel does not expose this as its own route.
//
// Two membership models, resolved by ONE function (crewPeerIds):
//   - ORG crews: automatic, team-scoped membership inside a genuine organization
//     account. Uncapped. No edges table involved. See resolveCrewOrg for the two
//     gates that make an athlete an org member at all.
//   - INDIVIDUAL crews: code-based, mutual opt-in, capped at CREW_CAP accepted
//     edges. Resolved from crew_edges. This is the DEFAULT and, until a real
//     school signs, the only behavior on prod.
// An athlete belongs to exactly ONE model — org athletes never get code-based
// edges on top of their org crew (WILCO Crew build prompt §4's "one default
// assumption" — flagged to Will in the build report, not re-litigated here).
//
// ─── 2026-07-30 REVIEW PASS (Will's findings #2 and #3) ──────────────────────
// The first build derived org membership straight off athletes.crew_org_key
// (a generated coalesce(school_id, coach_id)), which auto-crewed anyone with ANY
// school or coach link. On prod that swept up test and informally-coach-linked
// accounts and grouped real people who never asked for each other. Two fixes,
// both enforced here so no caller can route around them:
//
//   #2  An org crew now requires schools.crew_enabled = true. That column
//       defaults to false, and no prod school has it set, so auto-crew is OFF
//       everywhere today. A coach link on its own NEVER makes an org crew (a
//       private coach's roster is not an organization). Everyone who fails these
//       gates falls through to the individual code-based flow, which means they
//       get their crew code and the add-someone UI back.
//   #3  An org crew is TEAM-scoped, not school-wide: basketball sees basketball.
//       The team is athletes.crew_team when a school sets one, else the athlete's
//       own sport (crew_team_key is the generated, lowercased resolution of
//       exactly that rule).
//
// crew_org_key is deliberately left alone and still means "has any school/coach
// link." It backs the DB-level org-comparison ban (crew_edges_org_compare_guard),
// where being BROADER than org membership is the safe direction: a school-linked
// athlete on the individual flow still can never enable V2 comparison.

import { sbSelect as realSbSelect } from "./_supa.js";
// goalTargets lives in src/grit.js because the CLIENT needs it too (the goal-hit
// moment fires off it), and that module is the established client/server single
// source rather than a hand-copy that can drift.
import { goalTargets } from "./_grit.js";
export { goalTargets };

const enc = encodeURIComponent;

export const CREW_CAP = 10;
export const REACTION_EMOJI = new Set(["🤝", "💪", "🔥"]);
export const CREW_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no O/0/I/1

// Display/storage window per moment type (days). pr/week are the common,
// frequent moments — a rolling week keeps the feed fresh without a Monday wipe
// (spec: a hard weekly reset would empty the feed right when someone opens on
// Monday). goal/milestone are rare and worth lingering.
export const WINDOW_DAYS = { pr: 7, week: 7, milestone: 14, goal: 14 };

// Proof-blip priority (build prompt §"The Proof blip"): goal > pr (rank-up) >
// perfect week > milestone. Non-perfect `week` moments and anything unscored
// return -1 so they never surface in the digest highlight (still visible in the
// in-app feed, just not promoted into the weekly blip).
export function momentPriorityScore(m) {
  if (!m || typeof m !== "object") return -1;
  if (m.type === "goal") return 3;
  if (m.type === "pr") return 2;
  if (m.type === "week" && m.payload && m.payload.perfect) return 1;
  if (m.type === "milestone") return 0;
  return -1;
}

// Is `m` still inside its type's display window as of `now` (ms epoch)?
export function withinWindow(m, now = Date.now()) {
  if (!m || !m.created_at) return false;
  const days = WINDOW_DAYS[m.type] ?? 7;
  return now - new Date(m.created_at).getTime() <= days * 864e5;
}

// Canonical pair ordering for crew_edges: always athlete_a < athlete_b (plain
// string/uuid compare) so a pair can never be duplicated in both directions.
// Never trust a client-supplied order — this is computed server-side always.
export function orderedPair(idOne, idTwo) {
  const a = String(idOne), b = String(idTwo);
  return a < b ? [a, b] : [b, a];
}

// The team an athlete's org crew is scoped to (finding #3). Mirrors the DB's
// generated athletes.crew_team_key exactly — an explicit crew_team a school set,
// else the athlete's own sport, lowercased and trimmed. Kept as a JS function
// (not just a read of the generated column) so the same rule can be applied to
// rows fetched without that column and so scripts/test-crew.mjs can exercise it
// with no database. Returns null when the athlete has neither, which means they
// are on no team and get no org peers.
export function crewTeamKey(athlete) {
  if (!athlete) return null;
  const explicit = String(athlete.crew_team ?? "").trim();
  if (explicit) return explicit.toLowerCase();
  const sport = String(athlete.sport ?? "").trim();
  return sport ? sport.toLowerCase() : null;
}

// Is this athlete in an ORG crew, and if so which team? Both gates from the
// 2026-07-30 review pass live here and nowhere else, so every caller (peer
// resolution, the crew op's per-action authz, the Proof blip) agrees:
//   1. They must be on a school. A coach link alone is not an organization.
//   2. That school must be explicitly flagged crew_enabled. Default false, and
//      no prod school sets it, so auto-crew is off on prod today.
//   3. They must have a resolvable team. No team, no org crew.
// Anything short of all three means individual (code-based) crew, which is the
// safe fallback: worst case someone sees their own crew code instead of being
// silently grouped with people they never added.
export async function resolveCrewOrg(athlete, sbSelect = realSbSelect) {
  const none = { isOrg: false, schoolId: null, teamKey: null, teamName: null };
  if (!athlete || !athlete.school_id) return none;
  let school = null;
  try {
    const rows = await sbSelect("schools", `?id=eq.${enc(athlete.school_id)}&select=id,name,crew_enabled`);
    school = rows[0] || null;
  } catch { return none; } // a failed school read must fall back to the SAFE side, never to auto-crew
  if (!school || school.crew_enabled !== true) return none;
  const teamKey = crewTeamKey(athlete);
  if (!teamKey) return none;
  return { isOrg: true, schoolId: String(athlete.school_id), teamKey, teamName: String(athlete.crew_team ?? "").trim() || String(athlete.sport ?? "").trim() || null };
}

// Is Crew switched on at all for this athlete's team? A coach owns this call for
// their whole roster via coaches.crew_allowed (Will, 07-30). Only an explicit
// false turns Crew off: no coach, a missing coach row, or a failed read all mean
// allowed, which is Crew's default state everywhere else. Enforced in the
// gateway on EVERY crew action, so hiding the tab is a courtesy and this is the
// actual control.
export async function crewAllowedFor(athlete, sbSelect = realSbSelect) {
  if (!athlete || !athlete.coach_id) return true;
  try {
    const rows = await sbSelect("coaches", `?id=eq.${enc(athlete.coach_id)}&select=crew_allowed`);
    return rows[0] ? rows[0].crew_allowed !== false : true;
  } catch { return true; }
}

// Resolve the peer athlete ids for `athlete` — NEVER the caller's own id. Org
// grouping is uncapped, edge-free and scoped to one team inside one org-enabled
// school; individual grouping reads accepted crew_edges only. The two never
// cross-contaminate: an org athlete always takes the org branch, and an
// individual athlete never has a crew_edges row where the OTHER side is an org
// athlete (crew-request rejects that server-side, see api/data.js).
//
// Peers are filtered in JS off crewTeamKey rather than querying crew_team_key
// directly, so a roster row whose team was written with odd casing or padding
// still lands in the right crew (same normalization on both sides, one rule).
// A school roster is at most a few hundred rows, so the whole-school read this
// costs is cheaper than getting the match subtly wrong.
//
// `sbSelect` is injectable (defaults to the real REST helper) so
// scripts/test-crew.mjs can exercise the org-vs-individual branching and the
// no-cross-contamination guarantee with an in-memory fake — same dependency-
// injection pattern as pickImprovedPRs(existing, rows, resolveLift) in
// api/data.js and the askClaudeServer/sbSelect `deps` threaded through the
// Proof Feed engine.
export async function crewPeerIds(athlete, sbSelect = realSbSelect, org = null) {
  const resolved = org || await resolveCrewOrg(athlete, sbSelect);
  if (resolved.isOrg) {
    const rows = await sbSelect("athletes", `?school_id=eq.${enc(resolved.schoolId)}&select=id,sport,crew_team`);
    return rows
      .filter((r) => String(r.id) !== String(athlete.id) && crewTeamKey(r) === resolved.teamKey)
      .map((r) => String(r.id));
  }
  const rows = await sbSelect(
    "crew_edges",
    `?status=eq.accepted&or=(athlete_a.eq.${enc(athlete.id)},athlete_b.eq.${enc(athlete.id)})&select=athlete_a,athlete_b`
  );
  return rows.map((r) => (String(r.athlete_a) === String(athlete.id) ? String(r.athlete_b) : String(r.athlete_a)));
}

// ─── V2 COMPARISON ───────────────────────────────────────────────────────────
// Two surfaces, both mutual opt-in, both individual-crew only:
//   1. a thin tier-coloured strip riding on your own Benchmarks power cell for
//      each opted-in crewmate, positioned by how far through THEIR OWN tier they
//      are (near the end = about to rank up), coloured by their tier;
//   2. a strength-score head-to-head inside the Crew tab.
//
// Org accounts are barred from both, permanently. That is structural rather than
// a check: comparison lives on crew_edges, and an org crew is derived at read
// time with no edges at all, so there is no row for an org athlete to flip. The
// DB trigger and the gateway are the floor under that, not the mechanism.
//
// What crosses the wire for a peer is ONLY tier and within-tier position. Never
// an e1RM, never a bodyweight, never an age or gender. Schools compare ranks,
// never raw weights, and holding that line here means the client cannot leak
// what it was never sent.

// Where a lift sits INSIDE its own tier, 0..1. Mirrors the Benchmarks power
// cell's own fill math exactly (App.jsx, `fillPct`), so a strip and the tube it
// rides on can never disagree about what "most of the way through STRONG" means.
// tierCount is TIER_NAMES.length; the top tier has no ceiling in the table, so
// it borrows the same 1.25x headroom the cell uses.
export function withinTierPct(ratio, thresh, tierIdx, tierCount = 8) {
  if (!Array.isArray(thresh) || !thresh.length) return null;
  if (!Number.isFinite(ratio) || !Number.isFinite(tierIdx) || tierIdx < 0) return null;
  const isTop = tierIdx >= tierCount - 1;
  const floor = tierIdx === 0 ? 0 : thresh[tierIdx - 1];
  const ceil = isTop ? thresh[tierIdx - 1] * 1.25 : thresh[tierIdx];
  if (!Number.isFinite(floor) || !Number.isFinite(ceil) || !(ceil > floor)) return null;
  return Math.min(Math.max((ratio - floor) / (ceil - floor), 0.03), 1);
}

// Which side of an edge is this athlete, and is comparison mutually on?
// Comparison needs BOTH sides opted in: one person deciding to compare is not
// consent from the other, and a silent switch-off must never notify anyone.
export function compareStateFor(edge, myId) {
  if (!edge) return { mine: false, theirs: false, mutual: false };
  const iAmA = String(edge.athlete_a) === String(myId);
  const mine = (iAmA ? edge.compare_a : edge.compare_b) === true;
  const theirs = (iAmA ? edge.compare_b : edge.compare_a) === true;
  return { mine, theirs, mutual: mine && theirs };
}

// ─── GOAL-AT-A-GLANCE ────────────────────────────────────────────────────────
// A real goal is rarely one number. Will's own reads like a paragraph and holds
// three separate lifts, and prod goals range from "I want to bench 325 raw in 8
// weeks" to a pasted training program someone dropped in the box. The crew row
// shows the measurable parts, short, and nothing else.
//
// Every measurable target found in one goal_text lives in parsed_targets. The
// legacy parsed_lift/target_lbs columns still mirror the FIRST target so the
// goal-hit moment detection keeps working unchanged.

// The short human line for a goal with nothing measurable in it. Null when the
// text is not a goal at all (the pasted-program case), so the row shows nothing
// rather than five words of somebody's warm-up.
export function goalShortLabel(goal) {
  if (!goal) return null;
  const label = String(goal.short_label ?? "").trim();
  return label ? label : null;
}

// State of ONE target against the athlete's current e1RM for that lift.
//
// `quiet` is the load-bearing case and the reason this function exists: a dated
// target whose date passed without being hit must NEVER surface as a miss (spec
// hard rule 5 — these are minors, and the kid who falls short is exactly who the
// whole feature was shaped to protect). It drops the target and the date and
// keeps only the number they actually reached, which is true and is never a
// failure. `now` is injectable so the boundary is testable without clock tricks.
export function goalTargetState(target, currentLbs = null, now = Date.now()) {
  if (!target || !target.lift || !Number.isFinite(target.targetLbs) || target.targetLbs <= 0) return null;
  // Deliberately not Number(currentLbs): Number(null) and Number("") are both 0,
  // which would turn "we don't know this yet" into a real 0lbs and draw an empty
  // bar as if no progress had been made.
  const cur = (currentLbs === null || currentLbs === undefined || currentLbs === "" || !Number.isFinite(Number(currentLbs)))
    ? null : Number(currentLbs);
  const base = { lift: target.lift, targetLbs: target.targetLbs, currentLbs: cur };
  if (cur != null && cur >= target.targetLbs) return { ...base, state: "hit", pct: 1 };
  if (target.targetDate) {
    const due = Date.parse(`${target.targetDate}T23:59:59Z`);
    if (Number.isFinite(due) && due < now) {
      return cur != null && cur > 0 ? { lift: target.lift, currentLbs: cur, state: "quiet" } : null;
    }
  }
  return {
    ...base, state: "chasing", targetDate: target.targetDate || null,
    pct: cur != null ? Math.max(0, Math.min(1, cur / target.targetLbs)) : null,
  };
}

// How many measurable targets a crew ROW shows before it stops. A roster has to
// stay scannable; someone tracking eight lifts should not push their crewmates
// off the screen. Your own goals are never capped.
export const CREW_ROW_TARGET_CAP = 3;

// Compose what one athlete's crew row shows, across ALL of the goals they chose
// to share. Targets first (they carry a number), then short labels for the goals
// that had nothing measurable in them. Returns null when there is nothing true
// to say, so the row simply has no goal line.
export function composeGoalGlance(goalRows, currentByLift = {}, now = Date.now(), cap = CREW_ROW_TARGET_CAP) {
  const rows = Array.isArray(goalRows) ? goalRows : [];
  const targets = [];
  const seen = new Set();
  const labels = [];
  for (const g of rows) {
    for (const t of goalTargets(g)) {
      const key = t.lift.toLowerCase();
      if (seen.has(key)) continue; // the same lift named in two goals is one target
      const st = goalTargetState(t, currentByLift[key], now);
      if (!st) continue;
      seen.add(key);
      targets.push(st);
    }
    const label = goalShortLabel(g);
    if (label && !labels.includes(label)) labels.push(label);
  }
  if (!targets.length && !labels.length) return null;
  const shown = cap > 0 ? targets.slice(0, cap) : targets;
  return { targets: shown, more: Math.max(0, targets.length - shown.length), labels: labels.slice(0, 2) };
}

// One deterministic, no-AI line per moment for the Proof digest blip. Highlights
// only — never a roll-call (matters more with org rosters, which can be large).
export function templateMomentLine(m, firstName) {
  const p = (m && m.payload) || {};
  const name = firstName || "A teammate";
  if (m.type === "goal") return `${name} is closing in on ${p.goalText || p.lift || "their goal"}`;
  if (m.type === "pr") {
    const liftTxt = p.lift ? ` on ${p.lift}` : "";
    const wTxt = p.weight ? ` at ${p.weight}${p.unit || "lbs"}` : "";
    return `${name} ranked up${liftTxt}${wTxt}`;
  }
  if (m.type === "week" && p.perfect) return `${name} went ${p.done ?? "?"} for ${p.target ?? "?"}`;
  if (m.type === "milestone") return `${name} logged workout #${p.count ?? "?"}`;
  return `${name} had a moment`;
}

// A peer's goal progress needs their current e1RM for the parsed lift. Computed
// SERVER-SIDE (with the deps injected — resolveLift/bestE1RMForExercise/toLbs/
// epley1RM from src/grit.js via api/_grit.js) so only this ONE derived number
// ever crosses the trust boundary — a peer's raw workouts are never returned to
// the caller. Mirrors the exact math the Benchmarks tab uses for the athlete's
// own lifts (single source of truth — no duplicated tier/e1RM logic).
export async function bestE1rmLbsForLift(athleteId, liftId, { resolveLift, bestE1RMForExercise, toLbs, epley1RM, sbSelect = realSbSelect }) {
  if (!liftId) return 0;
  let best = 0;
  try {
    const workouts = await sbSelect("workouts", `?athlete_id=eq.${enc(athleteId)}&select=parsed_data&order=created_at.desc&limit=100`);
    for (const w of workouts) {
      const pd = typeof w.parsed_data === "string" ? JSON.parse(w.parsed_data || "{}") : (w.parsed_data || {});
      for (const ex of (pd.exercises || [])) {
        if (!ex.name || resolveLift(ex.name).id !== liftId) continue;
        const e1 = bestE1RMForExercise(ex);
        if (e1 > best) best = e1;
      }
    }
  } catch { /* best-effort — a partial read just under-reports progress, never breaks the roster */ }
  try {
    const prs = await sbSelect("prs", `?athlete_id=eq.${enc(athleteId)}&select=exercise,weight,reps,unit,estimated_1rm`);
    for (const p of prs) {
      if (resolveLift(p.exercise || "").id !== liftId) continue;
      const e1 = p.estimated_1rm || epley1RM(toLbs(p.weight, p.unit), p.reps || 1);
      if (e1 > best) best = e1;
    }
  } catch { /* best-effort */ }
  try {
    const manual = await sbSelect("manual_one_rms", `?athlete_id=eq.${enc(athleteId)}&select=normalized_exercise,exercise,weight,unit`);
    for (const m of manual) {
      if (resolveLift(m.normalized_exercise || m.exercise || "").id !== liftId) continue;
      const lbs = toLbs(m.weight, m.unit);
      if (lbs > best) best = lbs;
    }
  } catch { /* best-effort */ }
  return Math.round(best);
}

// Build the weekly Proof digest's crew blip: { text } or null when there's
// nothing to say (never "your crew was quiet" — omit the section entirely).
// Deterministic — no AI call. `athlete` needs {id, name, school_id, sport,
// crew_team} so crewPeerIds can resolve org membership + team the same way the
// gateway does (the proof cron passes a full `select=*` athlete row, so it has
// all of these). An athlete with no peers returns null and the digest simply
// omits the section.
export async function buildCrewBlip(athlete, sbSelect = realSbSelect) {
  const peers = await crewPeerIds(athlete, sbSelect);
  if (!peers.length) return null;

  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const idList = peers.map((id) => `"${id}"`).join(",");
  let rows = [];
  try {
    rows = await sbSelect(
      "crew_moments",
      `?athlete_id=in.(${idList})&created_at=gte.${enc(since)}&select=*&order=created_at.desc`
    );
  } catch {
    return null; // best-effort — a failed read must never break the digest
  }

  const now = Date.now();
  const scored = rows
    .filter((m) => withinWindow(m, now))
    .map((m) => ({ m, score: momentPriorityScore(m) }))
    .filter((x) => x.score >= 0);
  if (!scored.length) return null;

  scored.sort((a, b) => b.score - a.score || new Date(b.m.created_at) - new Date(a.m.created_at));
  const top = scored.slice(0, 2).map((x) => x.m);

  let nameById = {};
  try {
    const ids = [...new Set(top.map((m) => m.athlete_id))];
    const nameRows = await sbSelect("athletes", `?id=in.(${ids.map((id) => `"${id}"`).join(",")})&select=id,name`);
    nameById = Object.fromEntries(nameRows.map((a) => [a.id, (a.name || "").trim().split(" ")[0] || null]));
  } catch { /* names are cosmetic — fall back to "A teammate" per line */ }

  const lines = top.map((m) => templateMomentLine(m, nameById[m.athlete_id]));
  if (!lines.length) return null;
  return { text: `Your crew had a week. ${lines.join(". ")}.` };
}
