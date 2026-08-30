// ─── FEATURE FLAGS — parked features, one switch each ────────────────────────
// Shared by the client bundle AND the api/ functions (same import pattern as
// src/grit.js), so one constant decides both what renders and what the gateway
// will serve. Flip + deploy to revive a parked feature.

// WILCO Crew (Will, 08-20: "not polished enough — get rid of it for now").
// PARKED, not deleted: every crew surface gates on this — the MY LOG crew tab,
// moments feed + reactions, the Benchmarks power-cell friend ticks, share
// codes/invite capture, proof-feed crew blips, school auto-crew, the gateway's
// whole `op:"crew"` family, moment writes, and Joe's feature inventory.
// crew_edges/crew_moments/crew_reactions data and the QA crew fixture stay
// intact in the DB, and api/_crew.js stays pure + fully covered by
// scripts/test-crew.mjs, so flipping this back on is a one-line deploy.
export const CREW_ENABLED = false;

// T58/T59 mastermind (Will, 08-24): the tool-carrying chat brain — Joe decides
// what to DO (position, memory, program recs, log sheet, preferences) as well
// as what to say. WEB PARITY 08-29 (Will: "web and TestFlight exactly the
// same"): the native gate came off — this flag alone decides, everywhere.
export const MASTERMIND_ENABLED = true;

// T58/T59 chat-first UI (Will, 08-24): LOG/Builder/Drafts tabs dissolve into
// chat (dock bars + sheets + Builder mode + Program Recs). WEB PARITY 08-29:
// native gate removed — the flag alone decides, web included. The ONE
// deliberate platform difference is notifications: pushes + the lock-screen
// session card are native-only and web never offers them.
// ⚠️ Before Add for Review: either the App Store screenshots get retaken on
// this UI or this flips back off — the reviewer's build OTAs to it.
export const CHAT_FIRST_ENABLED = true;
