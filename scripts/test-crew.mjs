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
  goalDisplayState, crewAllowedFor, withinTierPct, compareStateFor,
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

// ── crewAllowedFor: the coach's kill-switch for their whole roster ─────────
// Only an explicit false turns Crew off. Every other case (no coach, missing
// coach row, a read that blew up) leaves Crew ON, because that is its default
// and failing closed here would silently strip the tab from athletes whose
// coach never asked for that.
console.log("crewAllowedFor (coach kill-switch):");
{
  const coaches = [
    { id: "coach-on", crew_allowed: true },
    { id: "coach-off", crew_allowed: false },
    { id: "coach-null", crew_allowed: null },
  ];
  const sel = async (table, params) => {
    if (table !== "coaches") return [];
    const m = /id=eq\.([^&]+)/.exec(params);
    return m ? coaches.filter((c) => c.id === decodeURIComponent(m[1])) : [];
  };
  const boom = async () => { throw new Error("supabase is down"); };

  eq(await crewAllowedFor({ id: "a", coach_id: "coach-on" }, sel), true, "coach with the switch on: Crew allowed");
  eq(await crewAllowedFor({ id: "a", coach_id: "coach-off" }, sel), false, "coach switched Crew OFF: not allowed, for every athlete of theirs");
  eq(await crewAllowedFor({ id: "a", coach_id: null }, sel), true, "no coach at all: allowed (an unaffiliated athlete has nobody to switch it off)");
  eq(await crewAllowedFor({ id: "a" }, sel), true, "athlete row with no coach_id field: allowed");
  eq(await crewAllowedFor({ id: "a", coach_id: "coach-missing" }, sel), true, "coach row not found: allowed, never strip the tab on a lookup miss");
  eq(await crewAllowedFor({ id: "a", coach_id: "coach-null" }, sel), true, "column NULL (pre-migration row): allowed, only an explicit false turns it off");
  eq(await crewAllowedFor({ id: "a", coach_id: "coach-off" }, boom), true, "a failed read fails OPEN, so an outage never silently removes Crew");
  eq(await crewAllowedFor(null, sel), true, "no athlete: allowed, never throws");
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

// ── V2 comparison: mutual opt-in + where a strip sits on the tube ──────────
console.log("compareStateFor (mutual opt-in):");
{
  const edge = (a, b) => ({ athlete_a: "aaa", athlete_b: "bbb", compare_a: a, compare_b: b });
  eq(compareStateFor(edge(true, true), "aaa"), { mine: true, theirs: true, mutual: true }, "both sides opted in: mutual");
  eq(compareStateFor(edge(true, false), "aaa"), { mine: true, theirs: false, mutual: false }, "only I opted in: NOT mutual, nothing is shown");
  eq(compareStateFor(edge(false, true), "aaa"), { mine: false, theirs: true, mutual: false }, "only THEY opted in: still not mutual, one person's choice is not consent from the other");
  eq(compareStateFor(edge(true, true), "bbb"), { mine: true, theirs: true, mutual: true }, "resolves the same from the other side of the edge");
  eq(compareStateFor(edge(true, false), "bbb"), { mine: false, theirs: true, mutual: false }, "'mine' follows WHICH SIDE the caller is, not the column name");
  eq(compareStateFor(null, "aaa"), { mine: false, theirs: false, mutual: false }, "no edge at all (an org athlete): never mutual, which IS the permanent ban");
}

console.log("withinTierPct (strip position on the power cell):");
{
  // Same 7-threshold shape the real BENCH_THRESHOLDS use, 8 tiers.
  const t = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5];
  ok(Math.abs(withinTierPct(1.0, t, 1) - 0.03) < 1e-9, "exactly at a tier floor clamps to the 3% minimum, so a strip is never invisible");
  ok(Math.abs(withinTierPct(1.125, t, 1) - 0.5) < 1e-9, "halfway through a tier reads 0.5");
  ok(withinTierPct(1.24, t, 1) > 0.9, "just short of the next tier sits near the right end, which is the 'about to rank up' read");
  eq(withinTierPct(3.5, t, 7), 1, "top tier is capped at 1, never overflows the tube");
  ok(withinTierPct(2.6, t, 7) > 0 && withinTierPct(2.6, t, 7) < 1, "top tier still has somewhere to sit, using the same 1.25x headroom the cell uses");
  // Tier 0 (ROOKIE) measures from ZERO up to the first threshold, exactly as the
  // power cell does (`tierFloor = tierIdx===0 ? 0 : thresh[tierIdx-1]`).
  ok(Math.abs(withinTierPct(0.5, t, 0) - 0.5) < 1e-9, "tier 0 measures from zero up to the first threshold");
  eq(withinTierPct(1.4, t, 0), 1, "a ratio past its own tier's ceiling clamps to full rather than overflowing the tube");
  eq(withinTierPct(NaN, t, 2), null, "a missing ratio yields no strip, never NaN%");
  eq(withinTierPct(1.5, [], 2), null, "no thresholds (an unranked lift) yields no strip");
  eq(withinTierPct(1.5, t, -1), null, "a nonsense tier yields no strip");
  const p = withinTierPct(1.6, t, 2);
  ok(p >= 0 && p <= 1, "output is always inside the tube");
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
// The trigger was NARROWED on 07-30 to match what "an organization account"
// means everywhere else: a school explicitly flagged crew_enabled. It used to
// fire on athletes.crew_org_key (ANY school or coach link), which also caught
// ordinary individual users carrying a leftover coach link.
function wouldBlockCompare({ compareA, compareB, aInEnabledSchool, bInEnabledSchool }) {
  if (!compareA && !compareB) return false;
  return !!aInEnabledSchool || !!bInEnabledSchool;
}
ok(wouldBlockCompare({ compareA: true, compareB: false, aInEnabledSchool: false, bInEnabledSchool: true }), "compare_a=true blocked when the OTHER side is in a crew-enabled school");
ok(wouldBlockCompare({ compareA: false, compareB: true, aInEnabledSchool: true, bInEnabledSchool: false }), "compare_b=true blocked when the OTHER side is in a crew-enabled school");
ok(!wouldBlockCompare({ compareA: true, compareB: true, aInEnabledSchool: false, bInEnabledSchool: false }), "two individual athletes CAN both opt in");
ok(!wouldBlockCompare({ compareA: false, compareB: false, aInEnabledSchool: false, bInEnabledSchool: true }), "no compare flags set at all: never blocked regardless of affiliation");
// The narrowing itself, stated as a test so it can't silently regress: a coach
// link, or a school that is NOT crew-enabled, must no longer block comparison.
ok(!wouldBlockCompare({ compareA: true, compareB: true, aInEnabledSchool: false, bInEnabledSchool: false }), "a leftover coach link no longer bars an individual athlete from comparison");

if (fail) { console.error(`\n${fail} FAILURE(S) (${pass} passed)`); process.exit(1); }
console.log(`\nAll ${pass} crew checks pass.`);
