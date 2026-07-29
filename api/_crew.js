// ─── CREW SHARED HELPERS ──────────────────────────────────────────────────────
// Used by api/data.js (the `crew` op) AND api/trigger-proof-feed.js (the Proof
// digest's crew blip) — one peer-resolution funnel so the two surfaces can never
// disagree about who's in whose crew (WILCO Crew build prompt §5/§9). `_`-prefixed
// so Vercel does not expose this as its own route.
//
// Two membership models, resolved by ONE function (crewPeerIds):
//   - ORG crews: every athlete sharing a school (or, absent a school, a private
//     coach) is automatically in each other's crew. Derived at read time off
//     athletes.crew_org_key (a generated column = coalesce(school_id, coach_id)).
//     Uncapped. No edges table involved.
//   - INDIVIDUAL crews: code-based, mutual opt-in, capped at CREW_CAP accepted
//     edges. Resolved from crew_edges.
// An athlete belongs to exactly ONE model — org athletes never get code-based
// edges on top of their org crew (WILCO Crew build prompt §4's "one default
// assumption" — flagged to Will in the build report, not re-litigated here).

import { sbSelect as realSbSelect } from "./_supa.js";

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

// Resolve the peer athlete ids for `athlete` ({id, crew_org_key}) — NEVER the
// caller's own id. Org grouping is uncapped and edge-free; individual grouping
// reads accepted crew_edges only. The two never cross-contaminate: an org
// athlete's crew_org_key is non-null so it always takes the org branch, and an
// individual athlete (crew_org_key null) never has a crew_edges row where the
// OTHER side is an org athlete (crew-request rejects that server-side, see
// api/data.js's crew-request action).
//
// `sbSelect` is injectable (defaults to the real REST helper) so
// scripts/test-crew.mjs can exercise the org-vs-individual branching and the
// no-cross-contamination guarantee with an in-memory fake — same dependency-
// injection pattern as pickImprovedPRs(existing, rows, resolveLift) in
// api/data.js and the askClaudeServer/sbSelect `deps` threaded through the
// Proof Feed engine.
export async function crewPeerIds(athlete, sbSelect = realSbSelect) {
  if (athlete && athlete.crew_org_key) {
    const rows = await sbSelect("athletes", `?crew_org_key=eq.${enc(athlete.crew_org_key)}&select=id`);
    return rows.map((r) => String(r.id)).filter((id) => id !== String(athlete.id));
  }
  const rows = await sbSelect(
    "crew_edges",
    `?status=eq.accepted&or=(athlete_a.eq.${enc(athlete.id)},athlete_b.eq.${enc(athlete.id)})&select=athlete_a,athlete_b`
  );
  return rows.map((r) => (String(r.athlete_a) === String(athlete.id) ? String(r.athlete_b) : String(r.athlete_a)));
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
// Deterministic — no AI call. `athlete` needs {id, crew_org_key, name}.
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
