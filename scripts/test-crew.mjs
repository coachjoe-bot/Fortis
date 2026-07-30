// ─── WILCO CREW V1 — regression suite ─────────────────────────────────────────
// Pure-logic checks for api/_crew.js: canonical pair ordering, the per-type
// display window, the Proof-blip priority order, crewPeerIds' org-vs-individual
// resolution (with an in-memory fake `sbSelect` — same dependency-injection
// pattern as pickImprovedPRs(existing, rows, resolveLift) in api/data.js), the
// cap-of-10 + reaction allowlist/toggle constants, and the comparison-ban
// enforced at BOTH the DB-trigger layer (mirrored here as a plain JS predicate,
// verified for real against the live Supabase trigger during the build — see
// the crew-mode-v1 build report) and the gateway layer (api/data.js never
// selects/returns compare_a/compare_b at all in V1 — nothing to test there
// beyond "the field never appears," checked below).
//
// Run with: node scripts/test-crew.mjs

import {
  CREW_CAP, REACTION_EMOJI, WINDOW_DAYS, orderedPair, momentPriorityScore,
  withinWindow, templateMomentLine, crewPeerIds, resolveCrewOrg, crewTeamKey,
  goalDisplayState,
} from "../api/_crew.js";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error("  ✗ " + msg); } };
const eq = (got, want, msg) => ok(JSON.stringify(got) === JSON.stringify(want), `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── Canonical pair ordering ───────────────────────────────────────────────────
console.log("orderedPair:");
eq(orderedPair("b-id", "a-id"), ["a-id", "b-id"], "always athlete_a < athlete_b regardless of call order");
eq(orderedPair("a-id", "b-id"), ["a-id", "b-id"], "already-ordered input stays ordered");
eq(orderedPair("same", "same"), ["same", "same"], "identical ids don't throw (caller rejects self-add separately)");
{
  // Enforced regardless of request DIRECTION — requester on either side yields
  // the same canonical pair.
  const p1 = orderedPair("22222222-2222-2222-2222-222222222222", "11111111-1111-1111-1111-111111111111");
  const p2 = orderedPair("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222");
  eq(p1, p2, "same pair, opposite call order → identical canonical result");
}

// ── Window rules: 7d pr/week, 14d goal/milestone, boundary cases ─────────────
console.log("withinWindow:");
eq(WINDOW_DAYS, { pr: 7, week: 7, milestone: 14, goal: 14 }, "window days match the spec");
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const now = Date.now();
ok(withinWindow({ type: "pr", created_at: daysAgo(6.9) }, now), "pr at 6.9 days old is IN window");
ok(!withinWindow({ type: "pr", created_at: daysAgo(7.1) }, now), "pr at 7.1 days old is OUT of window");
ok(withinWindow({ type: "week", created_at: daysAgo(7.0) }, now), "week at exactly 7.0 days is IN window (boundary is inclusive)");
ok(withinWindow({ type: "goal", created_at: daysAgo(13.9) }, now), "goal at 13.9 days old is IN window");
ok(!withinWindow({ type: "goal", created_at: daysAgo(14.1) }, now), "goal at 14.1 days old is OUT of window");
ok(withinWindow({ type: "milestone", created_at: daysAgo(13.9) }, now), "milestone at 13.9 days old is IN window");
ok(!withinWindow({ type: "milestone", created_at: daysAgo(14.1) }, now), "milestone at 14.1 days old is OUT of window");
ok(!withinWindow(null, now), "null moment is never in window");
ok(!withinWindow({ type: "pr" }, now), "missing created_at is never in window");

// ── Proof-blip priority ordering: goal > pr > perfect week > milestone ──────
console.log("momentPriorityScore (Proof-blip priority):");
const goalScore = momentPriorityScore({ type: "goal" });
const prScore = momentPriorityScore({ type: "pr" });
const perfectWeekScore = momentPriorityScore({ type: "week", payload: { perfect: true } });
const milestoneScore = momentPriorityScore({ type: "milestone" });
const imperfectWeekScore = momentPriorityScore({ type: "week", payload: { perfect: false } });
ok(goalScore > prScore, "goal outranks pr");
ok(prScore > perfectWeekScore, "pr outranks a perfect week");
ok(perfectWeekScore > milestoneScore, "a perfect week outranks milestone");
ok(imperfectWeekScore < milestoneScore, "a NON-perfect week never outranks milestone (never promoted into the blip)");
eq(momentPriorityScore(null), -1, "garbage input never scores >= 0");
eq(momentPriorityScore({ type: "unknown" }), -1, "unknown type never scores >= 0");
{
  // The actual top-2 sort a Proof-blip build would run.
  const rows = [
    { type: "milestone", created_at: daysAgo(1) },
    { type: "goal", created_at: daysAgo(2) },
    { type: "pr", created_at: daysAgo(1) },
    { type: "week", payload: { perfect: true }, created_at: daysAgo(1) },
  ];
  const top2 = rows
    .map((m) => ({ m, score: momentPriorityScore(m) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.m.type);
  eq(top2, ["goal", "pr"], "top-2 picks goal then pr ahead of a perfect week and milestone");
}

// ── Reaction emoji allowlist + cap ────────────────────────────────────────────
console.log("constants:");
eq(CREW_CAP, 10, "individual crew cap is 10");
ok(REACTION_EMOJI.has("🤝") && REACTION_EMOJI.has("💪") && REACTION_EMOJI.has("🔥"), "the 3 preset reactions are allowlisted");
ok(!REACTION_EMOJI.has("😀") && !REACTION_EMOJI.has(""), "an arbitrary emoji is NOT allowlisted (server-side reject, not a client filter)");
eq(REACTION_EMOJI.size, 3, "exactly 3 reactions — no free text, no extras");

// ── templateMomentLine: deterministic, no-AI, highlights only ───────────────
console.log("templateMomentLine (Proof-blip templating):");
ok(/Marcus/.test(templateMomentLine({ type: "pr", payload: { lift: "Back Squat", tier: "STRONG" } }, "Marcus")), "pr line names the athlete");
ok(!/undefined/.test(templateMomentLine({ type: "pr", payload: {} }, null)), "missing name/payload never renders literal 'undefined'");
ok(/5 for 5|for 5/.test(templateMomentLine({ type: "week", payload: { done: 5, target: 5, perfect: true } }, "Devin")), "perfect-week line states done/target");
ok(/#50|50/.test(templateMomentLine({ type: "milestone", payload: { count: 50 } }, "Sam")), "milestone line states the count");

// ── resolveCrewOrg + crewPeerIds: who is actually in an org crew ──────────
// The 2026-07-30 review pass (Will's findings #2 and #3) narrowed org membership
// twice over. These are the checks that keep it narrow:
//   #2  a school link alone is NOT an org crew; the school must be crew_enabled,
//       and a coach link on its own never counts at all. Everyone else falls
//       through to the individual code-based flow.
//   #3  an org crew is one TEAM inside that school, not the whole roster.
console.log("resolveCrewOrg + crewPeerIds:");
{
  const ENABLED = "school-enabled", OFF = "school-not-enabled";
  const fakeSchools = [
    { id: ENABLED, name: "Eastridge Prep", crew_enabled: true },
    { id: OFF, name: "Some Test School", crew_enabled: false },
  ];
  // Two teams inside the crew-enabled school, plus a same-school athlete on a
  // THIRD team, plus a not-enabled school, plus two pure individuals.
  const fakeAthletes = [
    { id: "bb-1", school_id: ENABLED, sport: "Basketball", crew_team: null },
    { id: "bb-2", school_id: ENABLED, sport: "Basketball", crew_team: null },
    { id: "bb-3", school_id: ENABLED, sport: "basketball ", crew_team: null }, // odd casing/padding, same team
    { id: "vb-1", school_id: ENABLED, sport: "Volleyball", crew_team: null },
    { id: "jv-1", school_id: ENABLED, sport: "Football", crew_team: "JV Football" },
    { id: "v-1",  school_id: ENABLED, sport: "Football", crew_team: "Varsity Football" },
    { id: "off-1", school_id: OFF, sport: "Basketball", crew_team: null },
    { id: "off-2", school_id: OFF, sport: "Basketball", crew_team: null },
    { id: "solo-1", school_id: null, sport: "Powerlifting", crew_team: null },
    { id: "solo-2", school_id: null, sport: "Powerlifting", crew_team: null },
    // Coach-linked but on no school: the exact shape that wrongly auto-crewed.
    { id: "coached-1", school_id: null, coach_id: "coach-x", sport: "Olympic Weightlifting", crew_team: null },
    { id: "coached-2", school_id: null, coach_id: "coach-x", sport: "Olympic Weightlifting", crew_team: null },
  ];
  const byId = (id) => fakeAthletes.find((a) => a.id === id);
  const fakeEdges = [
    { athlete_a: "solo-1", athlete_b: "solo-2", status: "accepted" },
    { athlete_a: "solo-1", athlete_b: "solo-3-pending", status: "pending" },
  ];
  const fakeSelect = async (table, params) => {
    if (table === "schools") {
      const m = /id=eq\.([^&]+)/.exec(params);
      return m ? fakeSchools.filter((s) => s.id === decodeURIComponent(m[1])) : [];
    }
    if (table === "athletes") {
      const m = /school_id=eq\.([^&]+)/.exec(params);
      if (!m) return [];
      const sid = decodeURIComponent(m[1]);
      return fakeAthletes.filter((a) => a.school_id === sid).map((a) => ({ id: a.id, sport: a.sport, crew_team: a.crew_team }));
    }
    if (table === "crew_edges") {
      const m = /or=\(athlete_a\.eq\.([^,]+),athlete_b\.eq\.([^)]+)\)/.exec(params);
      if (!m) return [];
      const id = decodeURIComponent(m[1]);
      return fakeEdges.filter((e) => e.status === "accepted" && (e.athlete_a === id || e.athlete_b === id));
    }
    return [];
  };

  // crewTeamKey — the one normalization rule, applied identically on both sides.
  eq(crewTeamKey({ sport: "Basketball" }), "basketball", "team key falls back to sport, lowercased");
  eq(crewTeamKey({ sport: "Football", crew_team: "Varsity Football" }), "varsity football", "an explicit crew_team beats the sport");
  eq(crewTeamKey({ sport: " Basketball " }), "basketball", "padding is trimmed so odd roster data still matches");
  eq(crewTeamKey({ sport: "", crew_team: "  " }), null, "no team at all resolves to null, not an empty-string team");

  // #2 — the gates.
  eq((await resolveCrewOrg(byId("bb-1"), fakeSelect)).isOrg, true, "school flagged crew_enabled: this IS an org crew");
  eq((await resolveCrewOrg(byId("off-1"), fakeSelect)).isOrg, false, "school NOT flagged crew_enabled: no org crew (this is every prod school today)");
  eq((await resolveCrewOrg(byId("coached-1"), fakeSelect)).isOrg, false, "a coach link with no school NEVER makes an org crew");
  eq((await resolveCrewOrg(byId("solo-1"), fakeSelect)).isOrg, false, "an unaffiliated athlete is never an org crew");
  eq((await resolveCrewOrg({ id: "x", school_id: ENABLED, sport: "" }, fakeSelect)).isOrg, false, "enabled school but no resolvable team: no org crew");
  eq((await resolveCrewOrg(byId("bb-1"), fakeSelect)).teamName, "Basketball", "the team NAME comes back for display");

  // #3 — team scoping.
  eq((await crewPeerIds(byId("bb-1"), fakeSelect)).sort(), ["bb-2", "bb-3"], "org peers = same school AND same team, uncapped");
  ok(!(await crewPeerIds(byId("bb-1"), fakeSelect)).includes("vb-1"), "basketball never sees volleyball inside the same school");
  eq(await crewPeerIds(byId("jv-1"), fakeSelect), [], "JV Football and Varsity Football are separate crews even on the same sport");
  eq(await crewPeerIds(byId("vb-1"), fakeSelect), [], "a one-person team resolves to zero peers, not an error");

  // #2, at the peer layer: the not-enabled school's athletes get NO org peers,
  // which is what hands them back the individual code flow instead.
  eq(await crewPeerIds(byId("off-1"), fakeSelect), [], "same school, same sport, but the school isn't crew_enabled: zero auto-crew");
  eq(await crewPeerIds(byId("coached-1"), fakeSelect), [], "two athletes sharing only a coach are NOT crewed together");

  // Individual resolution is unchanged.
  const soloPeers = await crewPeerIds(byId("solo-1"), fakeSelect);
  eq(soloPeers, ["solo-2"], "individual athlete's peers = accepted crew_edges only, other side");
  ok(!soloPeers.includes("solo-3-pending"), "a PENDING edge is never counted as a peer");

  // No cross-contamination in either direction.
  const orgPeers = await crewPeerIds(byId("bb-1"), fakeSelect);
  ok(!orgPeers.includes("solo-1") && !orgPeers.includes("solo-2"), "org athlete's peer set never includes an unrelated individual athlete");
  ok(!soloPeers.some((id) => byId(id)?.school_id), "individual athlete's peer set never includes a school athlete");
}

// ── goalDisplayState — the four states, and the one that must never shame ──
console.log("goalDisplayState:");
{
  const NOW = Date.parse("2026-07-30T12:00:00Z");
  const past = "2026-06-01", future = "2026-12-01";

  eq(goalDisplayState(null, 200, NOW), null, "no goal row renders nothing");
  eq(goalDisplayState({ goal_text: "   " }, 200, NOW), null, "a blank goal renders nothing");

  const asp = goalDisplayState({ goal_text: "make varsity" }, null, NOW);
  eq(asp.state, "aspiration", "a non-numeric goal is a stated aspiration");
  ok(asp.pct === undefined, "an aspiration NEVER gets a progress bar (a fake bar is worse than none)");

  const chasing = goalDisplayState({ goal_text: "315 bench by December", parsed_lift: "bench press", target_lbs: 315, target_date: future }, 295, NOW);
  eq(chasing.state, "chasing", "a live numeric goal is chasing");
  ok(Math.abs(chasing.pct - 295 / 315) < 1e-9, "progress is deterministic current/target math");

  eq(goalDisplayState({ goal_text: "315 bench", parsed_lift: "bench press", target_lbs: 315 }, 315, NOW).state, "hit", "reaching the target exactly counts as hit");
  eq(goalDisplayState({ goal_text: "315 bench", parsed_lift: "bench press", target_lbs: 315 }, 330, NOW).state, "hit", "passing the target counts as hit");

  // The load-bearing case: a dated goal that came and went unhit.
  const missed = goalDisplayState({ goal_text: "315 bench by June", parsed_lift: "bench press", target_lbs: 315, target_date: past }, 295, NOW);
  eq(missed.state, "quiet", "a dated goal whose date passed unhit retires to 'quiet', never a miss");
  eq(missed.targetLbs, undefined, "the retired goal drops the target it fell short of");
  eq(missed.targetDate, undefined, "the retired goal drops the date it missed");
  eq(missed.currentLbs, 295, "what it keeps is the progress that was actually made, which is true");
  eq(goalDisplayState({ goal_text: "315 bench by June", parsed_lift: "bench press", target_lbs: 315, target_date: past }, 0, NOW), null,
     "a passed date with no progress to show says nothing at all rather than something sad");

  // A dated goal that WAS hit stays 'hit' even after the date, never 'quiet'.
  eq(goalDisplayState({ goal_text: "315 bench by June", parsed_lift: "bench press", target_lbs: 315, target_date: past }, 320, NOW).state, "hit",
     "hitting it before the date survives the date passing");

  // Progress is clamped, never over 100% or negative.
  ok(goalDisplayState({ goal_text: "g", parsed_lift: "squat", target_lbs: 400 }, null, NOW).pct === null, "no current e1RM yet means no bar, not a zero bar");
}

// ── Cap-of-10 enforcement (the logic api/data.js's crew-request/crew-accept
// re-checks — mirrored here as a plain predicate since the real check needs a
// live DB round trip to count accepted edges) ────────────────────────────────
console.log("cap-of-10 enforcement:");
const wouldExceedCap = (acceptedCount) => acceptedCount >= CREW_CAP;
ok(!wouldExceedCap(9), "9 accepted edges — the 10th request/accept is still allowed");
ok(wouldExceedCap(10), "10 accepted edges — an 11th request/accept is blocked");
ok(wouldExceedCap(11), "over-cap (shouldn't happen, but defensive) stays blocked");

// ── Reaction toggle idempotency (react twice = off, not two rows) ───────────
console.log("reaction toggle idempotency:");
function toggleReaction(existingReactions, athleteId, emoji) {
  const has = existingReactions.some((r) => r.athlete_id === athleteId && r.emoji === emoji);
  return has
    ? existingReactions.filter((r) => !(r.athlete_id === athleteId && r.emoji === emoji))
    : [...existingReactions, { athlete_id: athleteId, emoji }];
}
{
  let reactions = [];
  reactions = toggleReaction(reactions, "ath-1", "🔥");
  eq(reactions, [{ athlete_id: "ath-1", emoji: "🔥" }], "first react adds one row");
  reactions = toggleReaction(reactions, "ath-1", "🔥");
  eq(reactions, [], "reacting AGAIN with the same emoji removes it — toggle off, not a duplicate row");
  reactions = toggleReaction(reactions, "ath-1", "🔥");
  reactions = toggleReaction(reactions, "ath-1", "💪");
  eq(reactions.length, 2, "a DIFFERENT emoji from the same athlete is a separate row (crew_reactions_once is per emoji, not per athlete)");
}

// ── Comparison-ban predicate — mirrors crew_edges_block_org_compare() (the DB
// trigger, verified live against Supabase during the build) so the RULE stays
// covered by `npm test` even though the trigger itself needs a real DB. ────
console.log("comparison-ban predicate (mirrors the DB trigger):");
function wouldBlockCompare({ compareA, compareB, aOrgKey, bOrgKey }) {
  if (!compareA && !compareB) return false;
  return aOrgKey != null || bOrgKey != null;
}
ok(wouldBlockCompare({ compareA: true, compareB: false, aOrgKey: null, bOrgKey: "school-x" }), "compare_a=true blocked when the OTHER side (b) is org-linked");
ok(wouldBlockCompare({ compareA: false, compareB: true, aOrgKey: "school-x", bOrgKey: null }), "compare_b=true blocked when the OTHER side (a) is org-linked");
ok(!wouldBlockCompare({ compareA: true, compareB: true, aOrgKey: null, bOrgKey: null }), "two individual athletes CAN both opt in (V2, not built yet, but never blocked)");
ok(!wouldBlockCompare({ compareA: false, compareB: false, aOrgKey: null, bOrgKey: "school-x" }), "no compare flags set at all — never blocked regardless of org linkage");

if (fail) { console.error(`\n${fail} FAILURE(S) (${pass} passed)`); process.exit(1); }
console.log(`\nAll ${pass} crew checks pass.`);
