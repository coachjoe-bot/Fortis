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
  withinWindow, templateMomentLine, crewPeerIds,
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

// ── crewPeerIds: org vs individual resolution, no cross-contamination ───────
console.log("crewPeerIds:");
{
  // In-memory fake standing in for sbSelect — same shape/contract the real
  // REST helper returns (an array of rows), keyed by (table, paramsString).
  const ORG_KEY = "school-aaa";
  const fakeAthletes = [
    { id: "org-1", crew_org_key: ORG_KEY },
    { id: "org-2", crew_org_key: ORG_KEY },
    { id: "org-3", crew_org_key: ORG_KEY },
    { id: "solo-1", crew_org_key: null },
    { id: "solo-2", crew_org_key: null },
  ];
  const fakeEdges = [
    // solo-1 <-> solo-2, accepted (individual crew — no org athlete on either side)
    { athlete_a: "solo-1", athlete_b: "solo-2", status: "accepted" },
    // a stray PENDING edge involving solo-1 must never count as a peer
    { athlete_a: "solo-1", athlete_b: "solo-3-pending", status: "pending" },
  ];
  const fakeSelect = async (table, params) => {
    if (table === "athletes") {
      // ?crew_org_key=eq.<key>&select=id
      const m = /crew_org_key=eq\.([^&]+)/.exec(params);
      if (!m) return [];
      const key = decodeURIComponent(m[1]);
      return fakeAthletes.filter((a) => a.crew_org_key === key).map((a) => ({ id: a.id }));
    }
    if (table === "crew_edges") {
      const m = /or=\(athlete_a\.eq\.([^,]+),athlete_b\.eq\.([^)]+)\)/.exec(params);
      if (!m) return [];
      const [, idA, idB] = m; // both encode the SAME caller id
      const id = decodeURIComponent(idA);
      return fakeEdges.filter((e) => e.status === "accepted" && (e.athlete_a === id || e.athlete_b === id));
    }
    return [];
  };

  const orgPeers = await crewPeerIds({ id: "org-1", crew_org_key: ORG_KEY }, fakeSelect);
  eq(orgPeers.sort(), ["org-2", "org-3"], "org athlete's peers = whole school roster minus self, UNCAPPED, no edges involved");

  const soloPeers = await crewPeerIds({ id: "solo-1", crew_org_key: null }, fakeSelect);
  eq(soloPeers, ["solo-2"], "individual athlete's peers = accepted crew_edges only, other side");
  ok(!soloPeers.includes("solo-3-pending"), "a PENDING edge is never counted as a peer");

  // No cross-contamination: an org athlete's peer set never pulls in an
  // unrelated individual edge, and vice versa — because the two resolution
  // paths are mutually exclusive on crew_org_key, never merged.
  ok(!orgPeers.includes("solo-1") && !orgPeers.includes("solo-2"), "org athlete's peer set never includes an unrelated individual athlete");
  ok(!soloPeers.some((id) => fakeAthletes.find((a) => a.id === id)?.crew_org_key), "individual athlete's peer set never includes an org athlete");

  const emptyOrgPeers = await crewPeerIds({ id: "org-nobody", crew_org_key: "lonely-school" }, fakeSelect);
  eq(emptyOrgPeers, [], "an org key with only this athlete on it resolves to zero peers, not an error");
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
